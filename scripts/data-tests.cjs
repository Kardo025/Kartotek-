'use strict';
// Tests for learner data in files (task C3, ARCHITECTURE.md section 4).
//  1. The data store in Node (desktop/data.js): state <-> files, safe writes, crash recovery, revert, lock, backups and retention.
//  2. The engine in a jsdom window with the real data store behind a bridge (desktop/data-api.js, the same calls main.js registers):
//     first-run import of an old backup, every older saved shape normalize() still migrates, edits written as change sets,
//     a read-back that differs (refused and reverted), restore of a dated backup, and the review queue compared with the old app.
//
// With KARTOTEK_BACKUP=<path to a real export> the import and the queue comparison also run on that file. It is only read: the
// test works on a temp profile and never writes to the file or its folder.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');
const data = require('../desktop/data');
const { makeDataApi } = require('../desktop/data-api');
const content = require('../desktop/content');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const samples = path.join(root, 'samples');
const DAY = 86400000;

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const clone = (x) => JSON.parse(JSON.stringify(x));
const canon = data.canonical;
// Same data and the same key order of cards, memory, review log and the four maps (lists and the review queue follow that order)
function sameState(a, b, msg) {
  assert.strictEqual(canon(a), canon(b), msg + ': data differs');
  for (const k of ['cards', 'mem', 'etuts', 'lessons', 'mocks', 'mindmaps']) assert.strictEqual(Object.keys(a[k] || {}).join(), Object.keys(b[k] || {}).join(), msg + ': key order of ' + k + ' differs');
  assert.strictEqual((a.reviews || []).map((e) => e.review_id).join(), (b.reviews || []).map((e) => e.review_id).join(), msg + ': review order differs');
}

// ---------------------------------------------------------------- synthetic states: every record type
function richState() {
  const cards = {}, mem = {};
  for (let i = 0; i < 230; i++) {
    const id = 'card' + i;
    cards[id] = { card_id: id, deck_id: i % 2 ? 'd1' : 'd2', front: 'F' + i, back: 'B' + i, tags: ['t'], status: 'active', created_at: 1000 + i, chunk: 'c' + Math.floor(i / 80) };
    mem[id] = { card_id: id, state: i % 3 ? 'review' : 'new', due_at: 5000 + i, stability_days: 2 + i / 10, difficulty: 5 };
  }
  mem.orphan = { card_id: 'orphan', state: 'review' }; // a memory record whose card was deleted: kept as it is
  const reviews = [];
  for (let k = 0; k < 4500; k++) reviews.push({ review_id: 'r' + k, card_id: 'card' + (k % 230), reviewed_at: 10000 + k, rating: 'good', from_state: 'review', source: k % 50 === 0 ? 'lesson' : undefined });
  return {
    version: 1, lang: 'en', settings: { target_retention_default: 0.9, daily_review_limit: 200 }, params: { w0: 1, w1: 2 },
    decks: { d1: { deck_id: 'd1', name: 'One' }, d2: { deck_id: 'd2', name: 'Two' } }, cards, mem, reviews,
    etuts: {
      'study-a': { etut_id: 'study-a', progress: { v: 'c2', cv: 2, attempts: [{ id: 'a1' }, { id: 'a2' }], stage: 'learn' }, pkg_ref: { version: 2, bundled: true } },
      'Legacy Ü': { etut_id: 'Legacy Ü', package: { title: 'old' }, progress: { v: 3, answers: { q1: { ok: true }, q2: { ok: false } } } },
      CON: { etut_id: 'CON', progress: { v: 'c2', attempts: [] } },
    },
    lessons: { 'lesson-1': { lesson_id: 'lesson-1', card_map: { k1: 'card1' }, deck_id: 'd1' }, gone: { lesson_id: 'gone', removed: true } },
    mocks: { 'mock-1': { mock_id: 'mock-1', attempts: [{ id: 'm1', result: { score: 3 } }], current: null } },
    mindmaps: { 'cs-map': { map_id: 'cs-map', versions: [{ v: 1 }, { v: 2 }], corrections: [{ id: 'c' }], attempts: [{ id: 'x' }], turns: [], requests: [] } },
    cents: { sel: ['read', 'math'], done: { 'at1.1': 1 }, selV: 2, examDate: '2027-03-11' },
    tud: { sel: ['math'], apply: { steps: { s1: true, s2: false }, docs: { d1: true }, q: {} } },
    param_history: [{ at: 1, params: {} }], created_at: 1, last_backup_at: null,
    future_key: { kept: true }, // a key a newer version might add: must survive the round trip
  };
}

// ---------------------------------------------------------------- 1. the data store in Node
async function storeTests() {
  let n = 0;
  const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = name + ': ' + e.message; throw e; } };
  let clock = Date.UTC(2026, 10, 15, 9, 0, 0);
  const now = () => clock;

  await t('state -> parts -> state is lossless (orphan memory, unknown keys, odd ids, 3 review chunks)', () => {
    const s = richState();
    const parts = data.stateToParts(s);
    assert.ok(parts['reviews/r2'] && !parts['reviews/r3'], 'review chunks of 2,000');
    assert.ok(parts['cards/_orphans'], 'orphan memory kept');
    sameState(data.partsToState(parts), s, 'round trip');
    assert.strictEqual(data.fileId('study-a'), 'study-a');
    assert.ok(data.fileId('CON').startsWith('~') && data.fileId('Legacy Ü').startsWith('~') && data.fileId('Study').startsWith('~'));
    assert.notStrictEqual(data.fileId('Ab'), data.fileId('ab'));
  });

  const dir = tmp('kartotek-data-');
  try {
    await t('an empty folder loads as "empty"; replaceAll + confirm writes it; a new store reads the same state', async () => {
      const a = data.createDataStore({ dir, now });
      const l = a.load();
      assert.strictEqual(l.status, 'empty');
      const r = await a.replaceAll(richState(), 'first-start');
      assert.ok(r.ok && canon(r.state) === canon(richState()));
      assert.strictEqual(r.backup, null, 'no backup of nothing');
      await a.confirm(r.generation);
      a.unlock();
      const b = data.createDataStore({ dir, now });
      const l2 = b.load();
      assert.strictEqual(l2.status, 'ok');
      assert.strictEqual(canon(l2.state), canon(richState()));
      b.unlock();
    });

    await t('change sets: one card chunk, appended reviews, Undo (last review removed), a deleted study, meta', async () => {
      const s = data.createDataStore({ dir, now });
      const expected = s.load().state;
      expected.cards.card5.front = 'changed';
      const chunk = {};
      Object.keys(expected.cards).forEach((id) => { if (expected.cards[id].chunk === 'c0') chunk[id] = { card: expected.cards[id], mem: expected.mem[id] }; });
      for (let k = 0; k < 600; k++) expected.reviews.push({ review_id: 'n' + k, card_id: 'card1', reviewed_at: 99999 + k });
      expected.reviews.pop(); // Undo
      delete expected.etuts.CON;
      expected.settings.daily_review_limit = 150;
      const meta = {};
      Object.keys(expected).forEach((k) => { if (['cards', 'mem', 'reviews', 'etuts', 'lessons', 'mocks', 'mindmaps'].indexOf(k) < 0) meta[k] = expected[k]; });
      const from = 2; // reviews changed from index 4500, i.e. chunk 2
      const chunks = [];
      for (let k = from; k * 2000 < expected.reviews.length; k++) chunks.push(expected.reviews.slice(k * 2000, (k + 1) * 2000));
      await s.write({ meta, chunks: { c0: chunk }, reviews: { from, chunks, total: Math.ceil(expected.reviews.length / 2000) }, etuts: { CON: null } });
      s.unlock();
      const again = data.createDataStore({ dir, now });
      assert.strictEqual(canon(again.load().state), canon(expected));
      again.unlock();
    });

    await t('a daily backup is made before the first write of a day, in the old backup format', async () => {
      const s = data.createDataStore({ dir, now });
      const before = s.load().state;
      clock += DAY;
      await s.write({ meta: Object.assign({}, data.stateToParts(before).meta, { lang: 'en' }) });
      const today = new Date(clock).toISOString().slice(0, 10);
      const daily = s.listBackups().filter((b) => b.reason === 'daily' && b.day === today);
      assert.strictEqual(daily.length, 1);
      const text = s.readBackup(daily[0].id);
      assert.strictEqual(canon(JSON.parse(text)), canon(before), 'the backup holds the state before the write');
      await s.write({ meta: data.stateToParts(before).meta });
      assert.strictEqual(s.listBackups().filter((b) => b.reason === 'daily' && b.day === today).length, 1, 'only one daily per day');
      s.unlock();
    });

    await t('a crash before the manifest is written leaves the previous state complete; the stray files are removed later', async () => {
      const s = data.createDataStore({ dir, now });
      const before = s.load().state;
      const p = s._paths();
      // what a crash in the middle of a write leaves: new generation files without a manifest naming them
      fs.writeFileSync(path.join(p.dataDir, 'meta.g999.json'), '{"half":');
      fs.writeFileSync(path.join(p.dataDir, 'cards', 'c0.g999.json.123.tmp'), 'x');
      s.unlock();
      const s2 = data.createDataStore({ dir, now });
      const l = s2.load();
      assert.strictEqual(l.status, 'ok');
      assert.strictEqual(canon(l.state), canon(before));
      await s2.write({ meta: data.stateToParts(before).meta });
      assert.ok(!fs.existsSync(path.join(p.dataDir, 'meta.g999.json')) && !fs.existsSync(path.join(p.dataDir, 'cards', 'c0.g999.json.123.tmp')), 'stray files removed after a good write');
      s2.unlock();
    });

    await t('a damaged current manifest or file falls back to the previous manifest ("recovered")', async () => {
      const s = data.createDataStore({ dir, now });
      const st = s.load().state;
      const old = clone(st);
      st.settings.daily_review_limit = 77;
      await s.write({ meta: data.stateToParts(st).meta });
      const p = s._paths();
      const m = JSON.parse(fs.readFileSync(path.join(p.dataDir, 'manifest.json'), 'utf8'));
      fs.writeFileSync(path.join(p.dataDir, m.files.meta.file), '{"tampered":true}'); // checksum no longer matches
      s.unlock();
      const s2 = data.createDataStore({ dir, now });
      const l = s2.load();
      assert.strictEqual(l.status, 'recovered');
      assert.strictEqual(canon(l.state), canon(old), 'the previous complete state');
      assert.ok(l.problems.some((x) => /checksum/.test(x)));
      assert.ok(fs.readdirSync(p.dataDir).some((f) => f.startsWith('manifest.damaged-')), 'the damaged manifest is kept aside');
      s2.unlock();
    });

    await t('both manifests damaged: "damaged", and nothing is deleted', async () => {
      const d2 = tmp('kartotek-data-dmg-');
      try {
        const s = data.createDataStore({ dir: d2, now });
        s.load();
        const r = await s.replaceAll(richState(), 'x'); await s.confirm(r.generation);
        await s.write({ meta: data.stateToParts(richState()).meta });
        const p = s._paths();
        s.unlock();
        const files = fs.readdirSync(p.dataDir);
        for (const f of files.filter((x) => /^meta\.g\d+\.json$/.test(x))) fs.writeFileSync(path.join(p.dataDir, f), 'garbage');
        const s2 = data.createDataStore({ dir: d2, now });
        const l = s2.load();
        assert.strictEqual(l.status, 'damaged');
        assert.deepStrictEqual(fs.readdirSync(p.dataDir).filter((f) => f !== '.lock').sort(), files.filter((f) => f !== '.lock').sort(), 'no file was removed');
        s2.unlock();
      } finally { rm(d2); }
    });

    await t('replaceAll then revert returns to the previous data; the rejected files are kept aside', async () => {
      const s = data.createDataStore({ dir, now });
      const before = s.load().state;
      const r = await s.replaceAll({ version: 1, cards: {}, mem: {}, reviews: [] }, 'import');
      assert.ok(r.backup && /before-import/.test(r.backup), 'a backup before the import');
      await assert.rejects(() => s.write({ meta: {} }), /waiting/);
      const v = await s.revert(r.generation);
      assert.ok(fs.existsSync(path.join(v.keptIn, 'manifest.json')));
      s.unlock();
      const s2 = data.createDataStore({ dir, now });
      assert.strictEqual(canon(s2.load().state), canon(before));
      s2.unlock();
    });

    await t('a second Kartotek on the same folder is refused while the first runs', () => {
      const p = path.join(dir, 'data', '.lock');
      fs.writeFileSync(p, String(process.ppid)); // a process that is alive
      const s = data.createDataStore({ dir, now });
      assert.throws(() => s.load(), /Another Kartotek/);
      fs.writeFileSync(p, '999999'); // a process that is gone: stale lock
      const s2 = data.createDataStore({ dir, now });
      assert.strictEqual(s2.load().status, 'ok');
      s2.unlock();
    });

    await t('no size ceiling: a state of more than 12 million characters is written and read back', async () => {
      const d3 = tmp('kartotek-data-big-');
      try {
        const big = richState();
        for (let k = 0; k < 60000; k++) big.reviews.push({ review_id: 'big' + k, card_id: 'card' + (k % 230), reviewed_at: 50000 + k, rating: 'good', note: 'x'.repeat(120) });
        assert.ok(JSON.stringify(big).length > 12e6);
        const s = data.createDataStore({ dir: d3, now });
        s.load();
        const r = await s.replaceAll(big, 'x');
        assert.ok(r.ok && r.state.reviews.length === big.reviews.length);
        await s.confirm(r.generation);
        s.unlock();
      } finally { rm(d3); }
    });
  } finally { rm(dir); }

  await t('backup retention over 400 days: 14 daily, 8 weekly, 12 monthly, before-imports for 90 days, newest five', async () => {
    const d4 = tmp('kartotek-data-ret-');
    try {
      let c = Date.UTC(2025, 9, 1, 8);
      const s = data.createDataStore({ dir: d4, now: () => c });
      s.load();
      const small = { version: 1, settings: {}, params: {}, decks: {}, cards: {}, mem: {}, reviews: [] }; // retention only: keep it small and fast
      const r = await s.replaceAll(small, 'x'); await s.confirm(r.generation);
      const meta = data.stateToParts(small).meta;
      for (let day = 0; day < 400; day++) {
        c += DAY;
        await s.write({ meta });
        if (day % 30 === 0) await s.backupNow('before-import');
      }
      const list = s.listBackups();
      const dailies = list.filter((b) => b.reason === 'daily');
      assert.ok(dailies.length <= 14 + 8 + 13 + 1 && dailies.length >= 20, 'dailies kept: ' + dailies.length);
      assert.ok(dailies.filter((b) => c - b.at <= 14 * DAY).length >= 14, 'last 14 days all kept');
      assert.ok(dailies.some((b) => c - b.at > 300 * DAY), 'a monthly from 10 months ago kept');
      const imports = list.filter((b) => b.reason === 'before-import');
      assert.ok(imports.every((b) => c - b.at <= 90 * DAY || list.slice(0, 5).includes(b)), 'old before-import backups pruned');
      assert.ok(imports.length >= 2);
      s.unlock();
    } finally { rm(d4); }
  });
  return n;
}

// ---------------------------------------------------------------- 2. engine in a window with the real data store
function makeWindow({ contentPayload, dataApi, localState }) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  w.KARTOTEK_DEFER_BOOT = true;
  w.kartotek = { content: { load: async () => ({ ok: true, value: contentPayload }), chooseFolder: async () => ({ ok: true, value: {} }), openFolder: async () => ({ ok: true }), onChanged: () => () => {} } };
  if (dataApi) w.kartotek.data = dataApi;
  if (localState) w.localStorage.setItem('kartotek-dsr-v1', typeof localState === 'string' ? localState : JSON.stringify(localState));
  const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    if (m[1] === 'ui.js') continue;
    w.eval(fs.readFileSync(path.join(src, m[1]), 'utf8') + '\n//# sourceURL=src/' + m[1]);
  }
  return w;
}
function contentPayloadFrom(dir) {
  const v = content.loadContent({ contentDir: dir, contentFrom: dir ? 'settings' : null, samplesDir: samples });
  return v;
}
// Starts a window like the desktop app: content first, then the data files, then init + content import
async function desktopStart(opts) {
  const w = makeWindow(opts);
  await w.KHost.ready();
  await w.App.store.prepare();
  w.App.store.init();
  if (!w.App.store.setupPending) w.App.importContent();
  return w;
}
// The old browser app: localStorage, then the content import
async function browserStart(opts) {
  const w = makeWindow(opts);
  await w.KHost.ready();
  w.App.store.init();
  w.App.importContent();
  return w;
}
function seededRng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
function queueOf(w, now) {
  const App = w.App;
  const env = App.env(now, { rng: seededRng(7) });
  const q = w.DSR.buildQueue(App.S, env, App.queueOpts());
  // the order the Review screen shows, plus the counts and limits it reports
  return { order: q.order.map((x) => x.card_id + ':' + x.kind), counts: q.counts, totals: q.totals };
}
async function settle(w) { await w.App.store.flushNow(); }

// Older saved shapes that normalize() and the study importers still migrate
function legacyStates(w) {
  const base = () => clone(w.KStore.buildSampleState(Date.UTC(2026, 8, 27, 14)));
  const out = [];
  let s = base(); delete s.lang; Object.values(s.decks).forEach((d) => { if (d.deck_id === 'sample-fr') d.name = 'Örnek · Temel Fransızca kelimeler'; });
  out.push(['no lang, Turkish sample deck names (before 2026-10)', s]);
  s = base(); s.cents = { sel: ['math', 'bio'], done: { 'at1.1': 1 } }; out.push(['CEnT-S selection before the Reading section (no selV)', s]);
  s = base(); delete s.mocks; delete s.mindmaps; delete s.lessons; delete s.tud; out.push(['before lesson tests, mocks, mind maps and the TU Delft section', s]);
  s = base(); Object.keys(s.mem).slice(0, 5).forEach((id) => delete s.mem[id]); out.push(['cards without a memory record', s]);
  s = base(); s.reviews = s.reviews.slice().reverse(); out.push(['review log out of order', s]);
  s = base(); s.etuts = { 'old-v1': { etut_id: 'old-v1', package: { etut_id: 'old-v1', title: 'Old', parts: [] }, progress: { v: 1, part: 0, stage: 'quiz', answers: { a: { ok: true } } } },
    'old-v3': { etut_id: 'old-v3', progress: { v: 3, part: 0, stage: 'priming', k: 2, sub: 'rated', answers: {}, priming: { 0: { big: 'x' } } } },
    'v2-partlevel': { etut_id: 'v2-partlevel', progress: { v: 'c2', part: 0, stage: 'learn', attempts: [{ id: 'z1', q_id: 'q' }] } } };
  out.push(['legacy study progress (v1, v3) and Study v2 progress without cv', s]);
  return out;
}

async function windowTests() {
  const log = [];
  let n = 0;
  const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = name + ': ' + e.message; throw e; } };
  const payload = contentPayloadFrom(null);

  await t('first start: empty folder -> setup pending, nothing written; import of an old backup -> every count matches; restart reads the same', async () => {
    const prof = tmp('kartotek-prof-');
    try {
      let store = null;
      const api = makeDataApi(() => store || (store = data.createDataStore({ dir: prof })));
      const w = await desktopStart({ contentPayload: payload, dataApi: api });
      assert.strictEqual(w.App.store.mode, 'file');
      assert.ok(w.App.store.setupPending);
      w.App.store.commit({ meta: true }); await settle(w);
      assert.ok(!fs.existsSync(path.join(prof, 'data', 'manifest.json')), 'nothing is written before the owner chooses');
      // an old backup: what App.exportBackup wrote in the browser app
      const b = await browserStart({ contentPayload: payload, localState: w.KStore.buildSampleState(Date.UTC(2026, 8, 27, 16)) });
      const backupText = JSON.stringify(b.App.S);
      const rep = await w.App.store.replaceFromSource(JSON.parse(backupText), { reason: 'first-import', sourceText: backupText, label: 'kartotek-backup-test' });
      assert.ok(rep.ok, 'report not ok: ' + rep.error + ' ' + JSON.stringify(rep.rows.filter((r) => !r.ok)));
      assert.ok(rep.identical && rep.rows.every((r) => r.ok));
      assert.ok(fs.readdirSync(path.join(prof, 'backups')).some((f) => /imported-kartotek-backup-test/.test(f)), 'a copy of the imported file is kept');
      w.App.importContent(); await settle(w);
      const st = clone(w.App.S);
      store.unlock(); store = null;
      const w2 = await desktopStart({ contentPayload: payload, dataApi: api });
      sameState(w2.App.S, st, 'restart reads exactly the saved state');
      const now = Date.UTC(2026, 8, 28, 9);
      assert.strictEqual(JSON.stringify(queueOf(w2, now)), JSON.stringify(queueOf(b, now)), 'the review queue differs from the old app'); // as JSON: two windows are separate realms
      log.push('synthetic backup: ' + rep.rows.filter((r) => ['cards', 'reviews', 'studies', 'studyAttempts'].includes(r.key)).map((r) => r.key + ' ' + r.before + '→' + r.after).join(', '));
      for (const x of [w, w2, b]) x.close();
      store.unlock();
    } finally { rm(prof); }
  });

  await t('every older saved shape imports with matching counts, and what the study importers migrate is written and read back', async () => {
    const probe = makeWindow({ contentPayload: payload });
    const cases = legacyStates(probe);
    probe.close();
    for (const [label, legacy] of cases) {
      const prof = tmp('kartotek-legacy-');
      try {
        let store = null;
        const api = makeDataApi(() => store || (store = data.createDataStore({ dir: prof })));
        const w = await desktopStart({ contentPayload: payload, dataApi: api });
        const rep = await w.App.store.replaceFromSource(clone(legacy), { reason: 'first-import' });
        assert.ok(rep.ok, label + ': ' + rep.error + ' ' + JSON.stringify(rep.rows.filter((r) => !r.ok)));
        w.App.importContent(); // migrates legacy study progress records, as at every start
        w.App.store.markAll(); await settle(w);
        const st = clone(w.App.S);
        store.unlock(); store = null;
        const w2 = await desktopStart({ contentPayload: payload, dataApi: api });
        sameState(w2.App.S, st, label + ': restart');
        const migrated = rep.rows.filter((r) => r.migrated).map((r) => r.key);
        log.push(label + ': ok' + (migrated.length ? ' (migrated: ' + migrated.join(', ') + ')' : ''));
        w.close(); w2.close(); store.unlock();
      } finally { rm(prof); }
    }
  });

  await t('edits are written as change sets: a new card, reviews, Undo, a study record, a deleted card', async () => {
    const prof = tmp('kartotek-edit-');
    try {
      let store = null;
      const api = makeDataApi(() => store || (store = data.createDataStore({ dir: prof })));
      const w = await desktopStart({ contentPayload: payload, dataApi: api });
      await w.App.store.replaceFromSource(w.KStore.buildSampleState(Date.UTC(2026, 8, 27, 16)), { reason: 'first-start' });
      w.App.importContent(); await settle(w);
      const S = w.App.S, St = w.App.store, K = w.KStore;
      const card = K.makeCard(S, { deck_id: Object.keys(S.decks)[0], front: 'new front', back: 'new back' });
      St.commit({ cards: [card.card_id] });
      const from = S.reviews.length;
      for (let k = 0; k < 3; k++) S.reviews.push({ review_id: 'e' + k, card_id: card.card_id, reviewed_at: Date.now() + k, rating: 'good', from_state: 'new' });
      St.commit({ reviewsFrom: from });
      S.reviews.pop(); St.commit({ reviewsFrom: S.reviews.length }); // Undo
      const sid = Object.keys(S.etuts)[0];
      S.etuts[sid].note_test = 'kept';
      St.commit({ etuts: [sid] });
      const victim = Object.keys(S.cards)[3], chunk = S.cards[victim].chunk;
      delete S.cards[victim]; delete S.mem[victim];
      St.commit({ chunks: [chunk] });
      S.settings.daily_review_limit = 123; St.commit({ meta: true });
      await settle(w);
      const st = clone(S);
      store.unlock(); store = null;
      const w2 = await desktopStart({ contentPayload: payload, dataApi: api });
      sameState(w2.App.S, st, 'edits');
      w.close(); w2.close(); store.unlock();
    } finally { rm(prof); }
  });

  await t('the window splits the state into exactly the parts the main process writes', () => {
    const w = makeWindow({ contentPayload: payload });
    const s = richState();
    const a = w.KStore.stateToParts(JSON.parse(JSON.stringify(s)));
    const b = data.stateToParts(s);
    assert.strictEqual(JSON.stringify(Object.keys(a).sort()), JSON.stringify(Object.keys(b).sort()));
    Object.keys(b).forEach((k) => assert.strictEqual(JSON.stringify(a[k]), JSON.stringify(b[k]), 'part ' + k));
    w.close();
  });

  await t('a change made without commit() is still saved (as the old whole-state save did), and only changed parts are sent', async () => {
    const prof = tmp('kartotek-untracked-');
    try {
      let store = null;
      const api = makeDataApi(() => store || (store = data.createDataStore({ dir: prof })));
      const sent = [];
      const spy = Object.assign({}, api, { write: async (cs) => { sent.push(Object.keys(cs.parts || {})); return api.write(cs); } });
      const w = await desktopStart({ contentPayload: payload, dataApi: spy });
      await w.App.store.replaceFromSource(w.KStore.buildSampleState(Date.UTC(2026, 8, 27, 16)), { reason: 'first-start' });
      w.App.importContent(); await settle(w);
      sent.length = 0;
      const S = w.App.S;
      const id = Object.keys(S.cards)[0];
      S.cards[id].front = 'changed without commit';
      await settle(w);
      assert.deepStrictEqual(sent, [['cards/' + (S.cards[id].chunk || 'c0')]], 'only the changed card chunk is written: ' + JSON.stringify(sent));
      await settle(w);
      assert.strictEqual(sent.length, 1, 'nothing is written when nothing changed');
      const st = clone(S);
      store.unlock(); store = null;
      const w2 = await desktopStart({ contentPayload: payload, dataApi: api });
      sameState(w2.App.S, st, 'untracked change');
      w.close(); w2.close(); store.unlock();
    } finally { rm(prof); }
  });

  await t('a read-back that differs is refused, the previous data stays, and the report names the difference', async () => {
    const prof = tmp('kartotek-bad-');
    try {
      let store = null;
      const real = makeDataApi(() => store || (store = data.createDataStore({ dir: prof })));
      const w = await desktopStart({ contentPayload: payload, dataApi: real });
      await w.App.store.replaceFromSource(w.KStore.buildSampleState(Date.UTC(2026, 8, 27, 16)), { reason: 'first-start' });
      w.App.importContent(); await settle(w);
      const before = clone(w.App.S);
      // a faulty write: one review event lost on the way
      const faulty = Object.assign({}, real, { replaceAll: async (...args) => { const r = await real.replaceAll(...args); if (r.ok && r.value.state) r.value.state.reviews.pop(); return r; } });
      w.kartotek.data = faulty;
      const other = w.KStore.buildSampleState(Date.UTC(2026, 9, 2, 10));
      const rep = await w.App.store.replaceFromSource(other, { reason: 'import' });
      assert.ok(!rep.ok);
      assert.ok(rep.rows.some((r) => r.key === 'reviews' && !r.ok), 'the review row differs');
      assert.strictEqual(canon(w.App.S), canon(before), 'the window kept the previous state');
      store.unlock(); store = null;
      const w2 = await desktopStart({ contentPayload: payload, dataApi: real });
      assert.strictEqual(canon(w2.App.S), canon(before), 'the files hold the previous state');
      w.close(); w2.close(); store.unlock();
    } finally { rm(prof); }
  });

  await t('restore a dated backup: the pre-restore state is backed up, the backup comes back exactly', async () => {
    const prof = tmp('kartotek-restore-');
    try {
      let clock = Date.UTC(2026, 10, 10, 8);
      let store = null;
      const api = makeDataApi(() => store || (store = data.createDataStore({ dir: prof, now: () => clock })));
      const w = await desktopStart({ contentPayload: payload, dataApi: api });
      await w.App.store.replaceFromSource(w.KStore.buildSampleState(Date.UTC(2026, 8, 27, 16)), { reason: 'first-start' });
      w.App.importContent(); await settle(w);
      const monday = clone(w.App.S);
      clock += DAY;
      w.App.S.settings.daily_review_limit = 9; w.App.store.commit({ meta: true }); await settle(w); // the daily backup of "monday" is made here
      const list = (await api.listBackups()).value;
      const daily = list.find((b) => b.reason === 'daily');
      const text = (await api.readBackup(daily.id)).value;
      assert.strictEqual(canon(JSON.parse(text)), canon(monday));
      const rep = await w.App.store.replaceFromSource(JSON.parse(text), { reason: 'restore' });
      assert.ok(rep.ok && /before-restore/.test(rep.backup));
      assert.strictEqual(canon(w.App.S), canon(w.KStore.normalize(JSON.parse(text))));
      w.close(); store.unlock();
    } finally { rm(prof); }
  });

  // ---- the owner's real backup (read only)
  if (process.env.KARTOTEK_BACKUP) {
    await t('the real backup: import report, restart and the review queue for today compared with the old app', async () => {
      const file = path.resolve(process.env.KARTOTEK_BACKUP);
      const statBefore = fs.statSync(file);
      const text = fs.readFileSync(file, 'utf8');
      const prof = tmp('kartotek-real-');
      try {
        // the content the owner's app uses (kartotek.config.json / KARTOTEK_CONTENT), else the samples
        const found = content.resolveContentDir({ settings: {}, env: process.env, dev: true, repoRoot: root });
        const realPayload = contentPayloadFrom(found.dir);
        let store = null;
        const api = makeDataApi(() => store || (store = data.createDataStore({ dir: prof })));
        const w = await desktopStart({ contentPayload: realPayload, dataApi: api });
        const rep = await w.App.store.replaceFromSource(JSON.parse(text), { reason: 'first-import', sourceText: text, label: 'real-backup' });
        log.push('REAL BACKUP REPORT (' + path.basename(file) + ', content: ' + (found.dir ? 'your content folder' : 'samples') + ')');
        rep.rows.forEach((r) => log.push('  ' + (r.ok ? 'ok  ' : 'DIFF') + ' ' + r.label + ': ' + r.before + ' -> ' + r.after + (r.migrated ? ' (migration)' : '')));
        log.push('  whole state identical: ' + rep.identical);
        assert.ok(rep.ok, 'the real import was refused: ' + rep.error);
        w.App.importContent(); await settle(w);
        const st = clone(w.App.S);
        store.unlock(); store = null;
        const w2 = await desktopStart({ contentPayload: realPayload, dataApi: api });
        sameState(w2.App.S, st, 'real backup restart');
        const old = await browserStart({ contentPayload: realPayload, localState: text });
        const now = Date.now();
        const qa = queueOf(old, now), qb = queueOf(w2, now);
        log.push('  review queue for now: old app ' + qa.order.length + ' cards ' + JSON.stringify(qa.counts) + ', desktop ' + qb.order.length + ' cards ' + JSON.stringify(qb.counts) + ', identical: ' + (JSON.stringify(qa) === JSON.stringify(qb)));
        assert.strictEqual(JSON.stringify(qb), JSON.stringify(qa), 'the review queue differs from the old app');
        for (const x of [w, w2, old]) x.close();
        store.unlock();
      } finally { rm(prof); }
      const statAfter = fs.statSync(file);
      assert.ok(statAfter.mtimeMs === statBefore.mtimeMs && statAfter.size === statBefore.size, 'the original file changed');
    });
  } else {
    log.push('real backup: not run (set KARTOTEK_BACKUP to the path of an export)');
  }
  return { n, log };
}

async function run() {
  const out = [];
  const k = await storeTests();
  out.push('Data store tests: ' + k + '/' + k + ' passed');
  const r = await windowTests();
  out.push('Data import and window tests: ' + r.n + '/' + r.n + ' passed');
  r.log.forEach((l) => out.push('  ' + l));
  return out;
}

module.exports = { run };
if (require.main === module) run().then((l) => l.forEach((x) => console.log(x)), (e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
