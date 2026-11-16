'use strict';
// Tests for run-time content loading (task C2): the Node content service on fixture folders, and the reload scenario in a jsdom
// window with the real engine: saved state + content at start-up and after "Reload content".
//
// With KARTOTEK_BACKUP=<path to a real export> the reload scenario runs on a COPY of that file (it is read, never written);
// without it, a synthetic backup is built from the samples.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');
const content = require('../desktop/content');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const samples = path.join(root, 'samples');

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 1)); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

// ---------------------------------------------------------------- content service
function serviceTests() {
  let n = 0;
  const t = (name, fn) => { try { fn(); n++; } catch (e) { e.message = name + ': ' + e.message; throw e; } };
  const dir = tmp('kartotek-content-');
  try {
    const sample = JSON.parse(fs.readFileSync(path.join(samples, 'studies', 'sample-cycle-v2', 'etut.json'), 'utf8'));
    write(path.join(dir, 'studies', 'good', 'etut.json'), Object.assign(clone(sample), { etut_id: 'good', title: 'Good' }));
    write(path.join(dir, 'studies', 'good', 'extras', 'a.json'), { schema: 'kstudy-extra-1', etut_id: 'good' });
    write(path.join(dir, 'studies', 'broken', 'etut.json'), '{ not json');
    write(path.join(dir, 'studies', 'sample-cycle-v2', 'etut.json'), Object.assign(clone(sample), { title: 'My own copy' }));
    write(path.join(dir, 'mindmaps', 'Bad_Name', 'map.json'), {});
    write(path.join(dir, 'mindmaps', 'ok-map', 'map.json'), { schema: 'kmind-map-1' });
    write(path.join(dir, 'mindmaps', 'ok-map', 'views', 'a.jpeg'), 'x');
    write(path.join(dir, 'exam', 'tud-apply.json'), { milestones: [] });
    write(path.join(dir, 'big', 'x'), '');
    write(path.join(dir, 'studies', 'huge', 'etut.json'), Buffer.alloc(content.MAX_JSON_BYTES + 1, 32));

    const r = content.loadContent({ contentDir: dir, contentFrom: 'settings', samplesDir: samples });
    t('studies: good and the content copy of a sample are loaded; the sample with the same id is hidden', () => {
      const ids = r.etuts.map((e) => e.data.etut_id).sort();
      assert.deepStrictEqual(ids, ['good', 'ornek-dsr', 'sample-cycle-v2']);
      assert.strictEqual(r.etuts.find((e) => e.data.etut_id === 'sample-cycle-v2').data.title, 'My own copy');
    });
    t('a broken JSON file and an oversized file become problems and do not stop the rest', () => {
      const msgs = r.problems.map((p) => p.message);
      assert.ok(msgs.some((m) => /not valid JSON/.test(m)));
      assert.ok(msgs.some((m) => /larger than/.test(m)));
      assert.ok(r.etuts.length >= 2);
    });
    t('mind-map folder names are checked; a good one loads with its folder', () => {
      assert.deepStrictEqual(r.mindmaps.map((m) => m.data.map_id), ['ok-map']);
      assert.ok(r.problems.some((p) => p.kind === 'mind map' && /folder name/.test(p.message)));
    });
    t('extras follow their study; the exam plan is read', () => {
      assert.strictEqual(r.extras.length, 1);
      assert.deepStrictEqual(r.exam.data, { milestones: [] });
    });
    t('without a content folder only the samples are shown', () => {
      const s = content.loadContent({ contentDir: null, samplesDir: samples });
      assert.deepStrictEqual(s.etuts.map((e) => e.data.etut_id).sort(), ['ornek-dsr', 'sample-cycle-v2']);
    });
    t('nothing is ever written to the content folder', () => {
      assert.ok(!fs.existsSync(path.join(dir, 'settings.json')));
    });

    t('resolveContentDir: settings beat the environment, a missing folder is reported and skipped', () => {
      const a = content.resolveContentDir({ settings: { contentDir: dir }, env: { KARTOTEK_CONTENT: os.tmpdir() }, dev: false });
      assert.strictEqual(a.dir, path.resolve(dir)); assert.strictEqual(a.from, 'settings');
      const b = content.resolveContentDir({ settings: { contentDir: path.join(dir, 'nope') }, env: { KARTOTEK_CONTENT: dir }, dev: false });
      assert.strictEqual(b.dir, path.resolve(dir)); assert.strictEqual(b.from, 'KARTOTEK_CONTENT'); assert.ok(/nope$/.test(b.missing));
      const c = content.resolveContentDir({ settings: {}, env: {}, dev: false });
      assert.strictEqual(c.dir, null);
    });
    t('resolveContentDir: the default folder is used last, only when it exists, and is never reported as missing', () => {
      const a = content.resolveContentDir({ settings: {}, env: {}, dev: false, defaultDir: dir });
      assert.strictEqual(a.dir, path.resolve(dir)); assert.strictEqual(a.from, 'default');
      const b = content.resolveContentDir({ settings: {}, env: {}, dev: false, defaultDir: path.join(dir, 'absent') });
      assert.strictEqual(b.dir, null); assert.strictEqual(b.missing, null);
      const c = content.resolveContentDir({ settings: { contentDir: dir }, env: {}, dev: false, defaultDir: os.tmpdir() });
      assert.strictEqual(c.from, 'settings');
    });
    t('photos: only images inside the map folder; every escape is refused', () => {
      assert.ok(content.resolvePhoto(dir, 'mindmaps', '/ok-map/views/a.jpeg'));
      for (const [host, p] of [['mindmaps', '/ok-map/../../studies/good/etut.json'], ['mindmaps', '/ok-map/..%2f..%2fstudies%2fgood%2fetut.json'], ['mindmaps', '/ok-map/views/..\\..\\x.jpeg'],
        ['mindmaps', '/ok-map/%2e%2e/%2e%2e/x.png'], ['mindmaps', '/ok-map/map.json'], ['mindmaps', '/Bad_Name/x.png'], ['studies', '/good/x.png'], ['mindmaps', '/ok-map'], ['mindmaps', '/%00.png']]) {
        assert.strictEqual(content.resolvePhoto(dir, host, p), null, host + p);
      }
      assert.strictEqual(content.resolvePhoto(null, 'mindmaps', '/ok-map/views/a.jpeg'), null);
    });
  } finally { rm(dir); }
  return n;
}

// ---------------------------------------------------------------- engine in a window, with a fake bridge
function makeWindow(loadFn) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  w.KARTOTEK_DEFER_BOOT = true;
  w.kartotek = { content: { load: loadFn, chooseFolder: async () => ({ ok: true, value: { changed: false } }), openFolder: async () => ({ ok: true, value: null }), onChanged: () => () => {} } };
  const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    if (m[1] === 'ui.js') continue;
    w.eval(fs.readFileSync(path.join(src, m[1]), 'utf8') + '\n//# sourceURL=src/' + m[1]);
  }
  return w;
}

const bridgeFrom = (getter) => async () => ({ ok: true, value: getter() });
const asItems = (arr, kind) => arr.map((data, i) => ({ path: 'fixture/' + kind + '/' + i, mtime: 0, source: 'content', data }));
function payload(o) {
  return { contentDir: 'fixture', contentFrom: 'settings', missingDir: null, samplesDir: null,
    etuts: asItems(o.etuts || [], 'study'), extras: asItems(o.extras || [], 'extra'), lessons: asItems(o.lessons || [], 'lesson'), mocks: asItems(o.mocks || [], 'mock'),
    mindmaps: asItems(o.mindmaps || [], 'mind'), exam: null, problems: o.problems || [] };
}

// attempts and answers across every study record (Study v2 attempts, legacy answers)
function countAttempts(state) {
  let n = 0;
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    for (const k of Object.keys(x)) {
      if (k === 'attempts' && Array.isArray(x[k])) n += x[k].length;
      else if (k === 'answers' && x[k] && typeof x[k] === 'object') n += Object.keys(x[k]).length;
      walk(x[k]);
    }
  };
  walk(state.etuts);
  return n;
}
const counts = (s) => ({ cards: Object.keys(s.cards).length, reviews: s.reviews.length, attempts: countAttempts(s), studies: Object.keys(s.etuts).length });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Study progress without what migrate() adds (E2: two empty lists; F1, cv 3: four empty containers, cv itself, and "thinking" copied
// from an attempt's "working"); nothing else may differ
const noE2 = (p) => {
  const c = JSON.parse(JSON.stringify(p));
  ['followups', 'feynman_feedback', 'reading_thinking', 'topic_mode', 'live', 'skipped', 'probes'].forEach((k) => { if (c && c[k] && !Object.keys(c[k]).length) delete c[k]; });
  if (c) delete c.cv;
  ((c && c.attempts) || []).forEach((a) => { delete a.thinking; });
  return c;
};

async function reloadScenario() {
  const sampleSet = content.loadContent({ contentDir: null, samplesDir: samples });
  const A = sampleSet.etuts.map((e) => e.data);
  const v2 = A.find((p) => p.etut_id === 'sample-cycle-v2');
  const log = [];
  let current = { etuts: A };

  // 1. a saved state: the real backup (a copy of it, in memory) or a synthetic one with progress and attempts
  const w1 = makeWindow(bridgeFrom(() => payload(current)));
  let backupText;
  if (process.env.KARTOTEK_BACKUP) {
    backupText = fs.readFileSync(process.env.KARTOTEK_BACKUP, 'utf8');
    log.push('backup: the real file (read as a copy)');
  } else {
    w1.App.store.replaceState(w1.KStore.buildSampleState(new Date(2026, 8, 27, 16, 30).getTime()));
    await w1.KHost.ready();
    w1.App.importContent();
    const S = w1.App.S;
    S.etuts['ornek-dsr'].progress.answers = Object.assign({}, S.etuts['ornek-dsr'].progress.answers, { q1: { ok: true }, q2: { ok: false } });
    const rec = S.etuts['sample-cycle-v2'];
    rec.progress.attempts = (rec.progress.attempts || []).concat([{ id: 'a1', q_id: 'x', ts: 1 }, { id: 'a2', q_id: 'y', ts: 2 }, { id: 'a3', q_id: 'x', ts: 3 }]);
    backupText = JSON.stringify(S); // what App.exportBackup writes
    log.push('backup: synthetic (sample decks and review log, 2 studies, 5 answers and attempts)');
  }
  const backup = JSON.parse(backupText);
  const before = counts(backup);

  // 2. start the app on that backup with run-time content: the same content as before
  const w2 = makeWindow(bridgeFrom(() => payload(current)));
  w2.App.store.replaceState(JSON.parse(backupText));
  await w2.KHost.ready();
  w2.App.importContent();
  const afterStart = clone(w2.App.S);
  assert.deepStrictEqual(counts(afterStart), counts(backup), 'start-up with unchanged content changes the counts');
  assert.ok(same(afterStart.cards, backup.cards) && same(afterStart.mem, backup.mem) && same(afterStart.reviews, backup.reviews), 'cards, memory or review log changed at start-up');
  assert.ok(Object.keys(backup.etuts).every((id) => same(afterStart.etuts[id], backup.etuts[id])), 'a study record changed at start-up');

  // 3. Reload content with a new study folder and a broken one
  const extra = clone(v2); extra.etut_id = 'new-study'; extra.title = 'New study';
  const broken = clone(v2); broken.etut_id = 'broken-study'; delete broken.title;
  const stateBeforeReload = clone(w2.App.S);
  current = { etuts: A.concat([extra, broken]), problems: [{ kind: 'study', path: 'fixture/study/broken.json', message: 'The file is not valid JSON: x' }] };
  await w2.KHost.reload();
  w2.App.importContent();
  const S2 = w2.App.S;
  assert.ok(S2.etuts['new-study'] && S2.etuts['new-study'].package, 'the new study did not appear');
  assert.ok(!S2.etuts['broken-study'], 'the invalid study reached the saved state');
  const probs = w2.KHost.problems();
  assert.ok(probs.some((p) => p.id === 'broken-study' && p.level === 'error' && /title/.test(p.messages.join(' '))), 'the invalid study is not listed with its errors');
  assert.ok(probs.some((p) => /not valid JSON/.test(p.messages[0])), 'the parse problem from the content service is not listed');
  const oldIds = Object.keys(stateBeforeReload.cards);
  assert.ok(oldIds.every((id) => same(S2.cards[id], stateBeforeReload.cards[id]) && same(S2.mem[id], stateBeforeReload.mem[id])), 'an existing card changed');
  assert.ok(same(S2.reviews, stateBeforeReload.reviews), 'the review log changed');
  assert.ok(Object.keys(stateBeforeReload.etuts).every((id) => same(S2.etuts[id], stateBeforeReload.etuts[id])), 'an existing study record changed');
  const newCards = Object.keys(S2.cards).filter((id) => !(id in stateBeforeReload.cards));
  const kz = w2.KEtut.flatKazanimlar(extra).length;
  assert.strictEqual(newCards.length, kz, 'new cards are only the new study objectives');
  assert.ok(newCards.every((id) => S2.cards[id].tags[0] === 'new-study'));
  // Study v2 packages attach by reference: the saved state of the new study holds no package
  assert.ok(!JSON.stringify(S2.etuts['new-study']).includes('"parts"'), 'a Study v2 package was copied into the saved state');
  const grown = JSON.stringify(S2).length - JSON.stringify(stateBeforeReload).length;
  log.push('reload with a new study: +' + newCards.length + ' cards, saved state +' + grown + ' characters, 1 invalid study listed, nothing existing changed');

  // 4. a changed version of an existing study updates the package and keeps progress
  const bumped = clone(v2); bumped.version = (bumped.version || 1) + 1; bumped.title = 'Sample changed';
  current = { etuts: A.filter((p) => p.etut_id !== 'sample-cycle-v2').concat([bumped]) };
  const progBefore = clone(w2.App.S.etuts['sample-cycle-v2'].progress);
  await w2.KHost.reload();
  w2.App.importContent();
  assert.ok(same(noE2(w2.App.S.etuts['sample-cycle-v2'].progress), noE2(progBefore)), 'progress changed when the study version changed');
  assert.strictEqual(w2.App.S.etuts['sample-cycle-v2'].package.title, 'Sample changed');
  assert.strictEqual(countAttempts(w2.App.S), before.attempts, 'attempts changed');

  // 5. the study folder disappears: the package detaches, the record, its cards and attempts stay; it comes back with the package
  current = { etuts: A.filter((p) => p.etut_id !== 'sample-cycle-v2') };
  await w2.KHost.reload();
  w2.App.importContent();
  assert.ok(!w2.App.S.etuts['sample-cycle-v2'].package, 'a deleted study stayed attached');
  assert.strictEqual(w2.KMeta.activeEtuts(w2.App.S).some((e) => e.etut_id === 'sample-cycle-v2'), false);
  assert.strictEqual(countAttempts(w2.App.S), before.attempts, 'attempts were lost when the folder was removed');
  current = { etuts: A };
  await w2.KHost.reload();
  w2.App.importContent();
  assert.ok(w2.App.S.etuts['sample-cycle-v2'].package, 'the study did not come back');
  assert.ok(same(noE2(w2.App.S.etuts['sample-cycle-v2'].progress), noE2(progBefore)));
  const end = counts(w2.App.S);
  assert.deepStrictEqual(end.attempts, before.attempts);
  assert.strictEqual(end.reviews, before.reviews);
  assert.ok(end.cards >= before.cards);
  log.push('before: ' + JSON.stringify(before) + ' · after: ' + JSON.stringify(end));
  for (const w of [w1, w2]) w.close();
  return log;
}

async function run() {
  const results = [];
  const k = serviceTests();
  results.push('Content service tests: ' + k + '/' + k + ' passed');
  const log = await reloadScenario();
  results.push('Reload scenario passed (' + log.join('; ') + ')');
  return results;
}

module.exports = { run };
