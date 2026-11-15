'use strict';
// Tests for task D2: the read-only Euro apply connection (desktop/euroapply.js) and the combined Planning timeline (ui/src/plan.js).
// All data is synthetic. A fixture Euro apply folder also holds fields Kartotek must never read, to prove the projection.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const euro = require('../desktop/euroapply');

const SECRET = 'SECRET-DO-NOT-READ-' + crypto.randomBytes(4).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => JSON.parse(JSON.stringify(x));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 1)); };
function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }

// A small Euro apply data file in the shape of data/universities.json, with extra fields that are not to be read
function universitiesFile() {
  const tl = (id, date, label, kind, extra) => Object.assign({ id, date, label, kind, est: false, checked: '2026-11-01', src: SECRET, url: 'https://example.org/' + id, note: '' }, extra || {});
  return {
    schema: 'euroapply.universities/1', updated: '2026-11-07', note: SECRET, statusValues: ['Planned', 'Applied', 'Accepted', 'Rejected', 'Waitlist'],
    universities: [
      { id: 'tudelft', name: 'TU Delft', city: 'Delft', country: 'NL', priority: 'main', lngLat: [4, 52], living: { rent: SECRET }, costs: { tuition: SECRET }, k2: { x: SECRET }, k3: { x: SECRET },
        programs: [{ id: 'tudelft-ae', name: 'Aerospace Engineering', status: 'Planned', fee: SECRET, requirements: [{ k: SECRET }], timeline: [{ date: '2027-01-15', label: 'Registration deadline', kind: 'deadline', est: false, url: 'https://example.org/p1', note: '23:59' }] }],
        timeline: [
          tl('t-open', '2026-10-01', 'Registration open', 'open', { est: true }),
          tl('t-deadline', '2027-01-15T23:59:00+01:00', 'Registration deadline', 'deadline'),
          tl('t-test', '2027-03-11', 'Selection test (online, proctored)', 'exam'),
          tl('t-pay', '2027-07-01', 'Confirmation statement and full payment', 'payment'),
          tl('t-nodate', '', 'An item without a date', 'other'),
        ] },
      { id: 'alpha', name: 'Alpha University', city: 'Alphaville', country: 'GB', priority: 'normal',
        programs: [{ id: 'alpha-a', name: 'Course A', status: 'Planned', timeline: [{ date: '2027-02-01', label: 'Course A open day', kind: 'other' }] }, { id: 'alpha-b', name: 'Course B', status: 'Planned', timeline: [{ date: '2027-02-01', label: 'Course A open day', kind: 'other' }] }],
        timeline: [tl('a-deadline', '2027-01-15', 'Application deadline on the same day', 'deadline', { est: true }), tl('a-late', '2027-09-01', 'A deadline far away', 'deadline')] },
      { id: 'beta', name: 'Beta Institute', city: 'Betaburg', country: 'FI', priority: 'normal',
        programs: [{ id: 'beta-a', name: 'Rejected course', status: 'Rejected' }], timeline: [tl('b-deadline', '2027-01-20', 'Deadline of a rejected programme', 'deadline')] },
    ],
  };
}

// The Application page's plan: [date, group, title, note, flags]
const PLAN = {
  milestones: [
    ['2027-01-15', 'tud', 'Application closes', 'Registration must be complete by 23:59', 'crit'],
    ['2027-03-11', 'tud', 'Selection exam', 'Online and proctored', 'crit'],
    ['2027-01-15', 'other', 'A different deadline on the same day', 'Alpha University paperwork, nothing in common with the Delft items', ''],
    ['2027-05-24', 'visa', 'Visa file is sent', 'From the end of May', 'approx'],
  ],
  steps: [
    ['Nov-Dec 2026', 'Collect the documents', 'Everything in the checklist.'],
    ['Before 15 Jan', 'Send the registration', 'Online.'],
    ['Mid-June (1 Jul latest)', 'Pay', 'In full.'],
    ['someday', 'A step without a date', ''],
    ['15 Feb', 'A ticked step', ''],
  ],
};

async function run() {
  let n = 0;
  const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = name + ': ' + e.message; throw e; } };
  const root = tmp('kartotek-euro-');
  const folder = path.join(root, 'EuroApply');
  put(path.join(folder, 'data', 'universities.json'), universitiesFile());
  put(path.join(folder, 'data', 'profile.json'), { name: SECRET });
  put(path.join(folder, 'tools', 'serve.ps1'), '# fixture');
  fs.mkdirSync(path.join(folder, 'app', 'node_modules'), { recursive: true });
  const listing = () => fs.readdirSync(folder, { recursive: true }).sort().join('|');
  const before = { listing: listing(), hash: crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, 'data', 'universities.json'))).digest('hex') };

  // ---------------------------------------------------------------- the connection
  await t('checkFolder: unset, missing, wrong folder, good folder, and what only limits Kartotek', async () => {
    assert.strictEqual(euro.checkFolder(null).ok, false);
    assert.strictEqual(euro.checkFolder(path.join(root, 'nope')).ok, false);
    const wrong = tmp('kartotek-euro-wrong-'); assert.ok(/universities\.json/.test(euro.checkFolder(wrong).blocking[0])); fs.rmdirSync(wrong);
    const good = euro.checkFolder(folder); assert.ok(good.ok); assert.deepStrictEqual(good.notes, []);
    const bare = tmp('kartotek-euro-bare-'); put(path.join(bare, 'data', 'universities.json'), '{}');
    const c = euro.checkFolder(bare); assert.ok(c.ok && c.notes.length === 2 && /serve\.ps1/.test(c.notes[0]) && /node_modules/.test(c.notes[1]));
    fs.rmSync(bare, { recursive: true, force: true });
  });

  await t('readUniversities returns only the listed fields, never the rest of the file', async () => {
    const r = await euro.readUniversities(folder);
    assert.ok(r.ok);
    const text = JSON.stringify(r.value);
    assert.ok(!text.includes(SECRET), 'a field that must not be read leaked');
    for (const k of ['lngLat', 'living', 'costs', 'k2', 'k3', 'fee', 'requirements', 'src']) assert.ok(!text.includes('"' + k + '"'), k + ' leaked');
    assert.strictEqual(r.value.schema, 'euroapply.universities/1');
    assert.strictEqual(r.value.universities.length, 3);
    const d = r.value.universities[0];
    assert.deepStrictEqual(Object.keys(d).sort(), ['id', 'name', 'programs', 'timeline']);
    assert.deepStrictEqual(Object.keys(r.value).sort(), ['schema', 'universities', 'updated']);
    assert.deepStrictEqual(Object.keys(d.timeline[0]).sort(), ['checked', 'date', 'est', 'id', 'kind', 'label', 'note', 'url']);
    assert.strictEqual(d.timeline[0].est, true);
  });

  await t('links must be https: anything else is dropped', async () => {
    const f = clone(universitiesFile()); f.universities[0].timeline[0].url = 'javascript:alert(1)'; f.universities[0].timeline[1].url = 'http://example.org/';
    const p = euro.project(f);
    assert.strictEqual(p.universities[0].timeline[0].url, ''); assert.strictEqual(p.universities[0].timeline[1].url, '');
  });

  await t('unknown or newer schema, wrong shape and a missing folder are reported with a reason', async () => {
    const dir = tmp('kartotek-euro-schema-'); const file = path.join(dir, 'data', 'universities.json');
    put(file, { schema: 'something/1', universities: [] }); let r = await euro.readUniversities(dir, { retryMs: 10 }); assert.ok(!r.ok && r.code === 'schema');
    put(file, { schema: 'euroapply.universities/2', universities: [] }); r = await euro.readUniversities(dir, { retryMs: 10 }); assert.ok(!r.ok && r.code === 'schema' && /newer/.test(r.message));
    put(file, { schema: 'euroapply.universities/1' }); r = await euro.readUniversities(dir, { retryMs: 10 }); assert.ok(!r.ok && r.code === 'shape');
    put(file, '[1,2]'); r = await euro.readUniversities(dir, { retryMs: 10 }); assert.ok(!r.ok && r.code === 'shape');
    r = await euro.readUniversities(path.join(dir, 'missing'), { retryMs: 10 }); assert.ok(!r.ok && r.code === 'folder');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t('a half-written file is retried once, then reported', async () => {
    const dir = tmp('kartotek-euro-retry-'); const file = path.join(dir, 'data', 'universities.json');
    put(file, '{ "schema": "euroapply.universities/1", "universities": [ {');
    setTimeout(() => put(file, universitiesFile()), 120); // Euro apply finishes saving
    let r = await euro.readUniversities(dir, { retryMs: 500 }); assert.ok(r.ok, 'the retry did not recover: ' + JSON.stringify(r));
    put(file, '{ broken'); r = await euro.readUniversities(dir, { retryMs: 50 }); assert.ok(!r.ok && r.code === 'read' && /try again/.test(r.message));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t('the server: ping, start through the launcher, and a launcher that does not start it', async () => {
    const port = await freePort();
    assert.strictEqual(await euro.ping(300, port), false);
    const dir = tmp('kartotek-euro-serve-');
    // the fixture launcher starts a tiny server (from a script file) that stops by itself after a few seconds
    const srv = path.join(dir, 'srv.js');
    put(srv, "require('http').createServer((q, r) => r.end('ok')).listen(" + port + ", '127.0.0.1'); setTimeout(() => process.exit(0), 8000);\n");
    put(path.join(dir, 'tools', 'serve.ps1'), "Start-Process -WindowStyle Hidden -FilePath '" + process.execPath.replace(/'/g, "''") + "' -ArgumentList '\"" + srv.replace(/'/g, "''") + "\"' -RedirectStandardOutput '" + path.join(dir, 'out.log') + "' -RedirectStandardError '" + path.join(dir, 'err.log') + "'\nStart-Sleep -Seconds 10 # like the real launcher: logs to files, keeps running\n");
    const r = await euro.startServer(dir, { port, waitMs: 12000 });
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(await euro.ping(500, port), true);
    const dir2 = tmp('kartotek-euro-serve2-'); put(path.join(dir2, 'tools', 'serve.ps1'), '# does nothing\n');
    const port2 = await freePort(); const r2 = await euro.startServer(dir2, { port: port2, waitMs: 1500 });
    assert.ok(!r2.ok && /did not answer/.test(r2.error));
    const r3 = await euro.startServer(path.join(dir2, 'none'), { port: port2, waitMs: 100 }); assert.ok(!r3.ok && /serve\.ps1/.test(r3.error));
    // the fixture launcher and its server still run for a few seconds and hold their folder: remove it afterwards, best effort
    setTimeout(() => { for (const d of [dir, dir2]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* the OS cleans the temp folder later */ } } }, 12000).unref();
  });

  await t('nothing was written into the Euro apply folder', async () => {
    assert.strictEqual(listing(), before.listing);
    assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, 'data', 'universities.json'))).digest('hex'), before.hash);
  });

  // ---------------------------------------------------------------- the timeline
  const plan = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'src', 'plan.js')).href);
  const NOW = new Date(2026, 10, 15, 10, 0).getTime(); // 15 Nov 2026
  const euroResult = { ok: true, value: euro.project(universitiesFile()) };
  const exams = [
    { id: 'cents', label: 'CEnT-S', examTs: new Date(2026, 10, 25, 16, 30).getTime(), days: 10, left: 1500, perDay: 215, topicsPerDay: 6.1, status: 'behind' },
    { id: 'tud', label: 'TU Delft AE Prep', examTs: null },
  ];
  const base = { now: NOW, windowDays: null, exams, plan: PLAN, ticks: { steps: { 4: 1 } }, euro: euroResult };

  await t('loose dates of steps: first day or month, next occurrence, approximate without a day, no false months', async () => {
    const d = (s) => plan.looseDate(s, NOW);
    const ymd = (x) => new Date(x.ts).getFullYear() + '-' + (new Date(x.ts).getMonth() + 1) + '-' + new Date(x.ts).getDate();
    assert.strictEqual(ymd(d('Before 15 Jan')), '2027-1-15'); assert.strictEqual(d('Before 15 Jan').approx, false);
    assert.strictEqual(ymd(d('22-25 Jan')), '2027-1-22');
    assert.strictEqual(ymd(d('15 Feb · 25 Feb · 11 Mar')), '2027-2-15');
    assert.strictEqual(ymd(d('Mid-June (1 Jul latest)')), '2027-6-15'); assert.strictEqual(d('Mid-June (1 Jul latest)').approx, true);
    assert.strictEqual(ymd(d('End of Feb')), '2027-2-25');
    assert.strictEqual(ymd(d('Sep 2027')), '2027-9-1');
    assert.strictEqual(ymd(d('Nov-Dec 2026')), '2026-11-1');
    assert.strictEqual(ymd(d('31 Aug')), '2027-8-31');
    assert.strictEqual(d('someday'), null); assert.strictEqual(d('Market research in autumn'), null); assert.strictEqual(d(''), null);
  });

  await t('exams: a dated exam is always a row with its pace; an exam without a date is listed as undated', async () => {
    const r = plan.buildTimeline(Object.assign({}, base, { windowDays: 5 }));
    const ex = r.rows.find((x) => x.uid === 'exam:cents');
    assert.ok(ex && /10 days left/.test(ex.detail) && /215 a day/.test(ex.detail) && /behind/.test(ex.detail) && ex.link.tab === 'cents');
    assert.ok(r.undated.some((x) => x.uid === 'exam:tud' && /no exam date/.test(x.title)));
  });

  await t('Euro apply rows: live programmes only, undated items skipped, repeated dates shown once, estimated marked', async () => {
    const r = plan.buildTimeline(base);
    const titles = r.rows.filter((x) => x.source === 'euroapply').map((x) => x.title);
    assert.ok(!titles.some((x) => /rejected/i.test(x)), 'a rejected programme\'s deadline is shown');
    assert.ok(!titles.some((x) => /without a date/.test(x)));
    assert.strictEqual(titles.filter((x) => /open day/.test(x)).length, 1, 'a date repeated by two programmes of one university shows twice');
    assert.ok(r.rows.find((x) => x.title === 'Registration open' ) === undefined, 'a past item (1 Oct) is shown');
    assert.ok(r.rows.find((x) => /Application deadline on the same day/.test(x.title)).est === true);
    assert.strictEqual(r.euro.universities, 2);
  });

  await t('a TU Delft item in both apps is one row, owned by Euro apply, saying it is also on the Application page', async () => {
    const r = plan.buildTimeline(base);
    const reg = r.rows.filter((x) => /Registration deadline/.test(x.title));
    assert.strictEqual(reg.length, 1, 'shown ' + reg.length + ' times');
    assert.strictEqual(reg[0].owner, 'Euro apply'); assert.strictEqual(reg[0].also.where, 'Application page'); assert.strictEqual(reg[0].also.tab, 'tud-apply');
    assert.ok(!r.rows.some((x) => x.source === 'kartotek' && x.title === 'Application closes'), 'the Application page copy is still shown');
    const sel = r.rows.filter((x) => /Selection/.test(x.title)); assert.strictEqual(sel.length, 1); assert.strictEqual(sel[0].owner, 'Euro apply'); assert.ok(sel[0].also);
    // not merged: only on the Application page, or same day but nothing in common, or another university
    assert.ok(r.rows.some((x) => x.title === 'Visa file is sent' && x.owner === 'Kartotek' && x.link.tab === 'tud-apply'));
    assert.ok(r.rows.some((x) => x.title === 'A different deadline on the same day' && x.owner === 'Kartotek'));
    const alpha = r.rows.find((x) => /Application deadline on the same day/.test(x.title)); assert.ok(alpha && !alpha.also && alpha.owner === 'Euro apply');
    // the payment item exists only in Euro apply
    assert.ok(!r.rows.find((x) => /full payment/.test(x.title)).also);
  });

  await t('one deadline carried by several universities is one row that names them', async () => {
    const f = clone(universitiesFile());
    for (const u of f.universities.slice(1, 2)) u.timeline.push({ id: 'shared', date: '2027-02-10', label: 'Shared sitting', kind: 'exam', est: false });
    f.universities.push({ id: 'gamma', name: 'Gamma College', city: 'G', country: 'IE', priority: 'normal', programs: [{ id: 'g1', name: 'G', status: 'Planned' }], timeline: [{ id: 'shared', date: '2027-02-10', label: 'Shared sitting', kind: 'exam', est: true }] });
    const r = plan.buildTimeline(Object.assign({}, base, { euro: { ok: true, value: euro.project(f) } }));
    const rows = r.rows.filter((x) => x.title === 'Shared sitting');
    assert.strictEqual(rows.length, 1);
    assert.ok(/Alpha University/.test(rows[0].detail) && /Gamma College/.test(rows[0].detail) && rows[0].ownerWhere === '2 universities');
    assert.strictEqual(rows[0].est, false, 'estimated only when every university says so');
  });

  await t('open steps: ticked ones are gone, past ones are due now, loose dates sit on the timeline, the rest is undated', async () => {
    const r = plan.buildTimeline(base);
    const steps = r.rows.filter((x) => x.kind === 'step');
    assert.deepStrictEqual(steps.map((x) => x.title).sort(), ['Step: Collect the documents', 'Step: Pay', 'Step: Send the registration']);
    const due = steps.find((x) => /Collect/.test(x.title)); assert.ok(due.overdue && due.day === '2026-11-15' && /was due/.test(due.detail));
    const pay = steps.find((x) => /Pay$/.test(x.title)); assert.ok(pay.est && pay.day === '2027-06-15');
    assert.ok(r.undated.some((x) => /A step without a date/.test(x.title)));
    assert.ok(!r.rows.concat(r.undated).some((x) => /ticked/.test(x.title)));
    assert.ok(steps.every((x) => x.link.tab === 'tud-apply' && x.owner === 'Kartotek'));
  });

  await t('the window limits dated rows but never the exams; rows are in date order', async () => {
    const all = plan.buildTimeline(base), short = plan.buildTimeline(Object.assign({}, base, { windowDays: 60 }));
    assert.ok(short.rows.length < all.rows.length);
    assert.ok(short.rows.every((x) => x.uid.startsWith('exam:') || x.ts <= NOW + 61 * 864e5));
    for (const r of [all, short]) for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i - 1].ts <= r.rows[i].ts, 'not in date order at ' + i);
  });

  await t('without Euro apply data the page still has Kartotek\'s own rows and says what is missing', async () => {
    for (const [euroIn, why] of [[null, 'The Euro apply folder is not set.'], [{ ok: false, code: 'read', message: 'data/universities.json could not be read' }, null]]) {
      const r = plan.buildTimeline(Object.assign({}, base, { euro: euroIn, euroWhy: why }));
      assert.ok(r.missing.some((m) => m.what === 'Euro apply deadlines' && m.why.length > 10));
      assert.ok(r.rows.some((x) => x.uid === 'exam:cents') && r.rows.some((x) => x.title === 'Application closes' && x.owner === 'Kartotek'), 'Kartotek rows are gone');
      assert.ok(!r.rows.some((x) => x.source === 'euroapply'));
    }
    const noPlan = plan.buildTimeline(Object.assign({}, base, { plan: null }));
    assert.ok(noPlan.missing.some((m) => /Application page/.test(m.what)) && noPlan.rows.some((x) => x.source === 'euroapply'));
    const nothing = plan.buildTimeline({ now: NOW, exams, plan: null, ticks: {}, euro: null, euroWhy: 'Euro apply is only available in the desktop app.' });
    assert.strictEqual(nothing.missing.length, 2); assert.ok(nothing.rows.some((x) => x.uid === 'exam:cents'));
  });

  await t('the Euro apply rows can be switched off', async () => {
    const r = plan.buildTimeline(Object.assign({}, base, { showEuro: false }));
    assert.ok(!r.rows.some((x) => x.source === 'euroapply'));
    assert.ok(r.rows.some((x) => x.title === 'Application closes'), 'without Euro apply rows the Application page keeps its own');
  });

  fs.rmSync(root, { recursive: true, force: true });
  return n;
}

module.exports = { run };
