'use strict';
// Tests for task F7: side questions and the researcher. No test calls a real service or the web: the side answerer and the researcher
// answer through the model service with a fake provider, the search service and the link check are stand-ins.
//  1. Side questions: what is on screen is the context (an open item without its key), the answer cites only what was on screen, the
//     exchange is kept, opening the panel during an open attempt is help like the lesson pane (and not eligible for DSR), never in the
//     final test, nothing else changes.
//  2. The researcher: availability (provider web search, a search key, neither), the key mode (searches, URLs only from the results,
//     links checked), the provider mode (the web search tool switched on), refusals (invented URL, long quote, a verdict without
//     sources), the request in state.research updated from the job.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPrompts } = require('../desktop/models/prompts');
const { createModelService } = require('../desktop/models/service');
const { createJobService } = require('../desktop/jobs/service');
const { checkLink } = require('../desktop/links');
const research = require('../desktop/jobs/research');
const { loadEngine } = require('./study-model-tests.cjs');

const root = path.join(__dirname, '..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const NOW = Date.UTC(2026, 10, 20, 9);
const plain = (o) => JSON.parse(JSON.stringify(o));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const fakeEncrypt = async (s) => Buffer.from('ENC1' + Buffer.from(s, 'utf8').toString('base64').split('').reverse().join(''));
const fakeDecrypt = async (b) => Buffer.from(b.toString().slice(4).split('').reverse().join(''), 'base64').toString('utf8');
async function t(list, name, fn) { try { await fn(); list.push(name); } catch (e) { e.message = name + ': ' + e.message; throw e; } }
const waitFor = async (fn, ms) => { const end = Date.now() + (ms || 5000); while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

function sample(w) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'samples', 'studies', 'sample-cycle-v2', 'etut.json'), 'utf8'));
  const st = w.KStore.emptyState();
  const et = w.KEtut.importPackage(st, pkg, { now: NOW }).etut;
  w.KCycle.migrate(et.progress, et.package);
  return { st, et, pkg, idx: w.KCycle.itemIndex(et.package, null) };
}
// a model service whose fake provider can (or cannot) search the web
async function service(dir, respond, opts) {
  const prompts = createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: dir });
  const calls = [];
  const fake = (cfg) => ({ kind: 'api', cfg, capabilities: () => ({ stream: true, structured: 'native', images: true, webSearch: !!(opts && opts.webSearch) }), listModels: async () => [{ id: 'fake-model-1', label: 'Fake' }],
    run: async (req) => { calls.push(req); const json = respond(req, calls.length); return { text: JSON.stringify(json), json, usage: { input: 800, output: 300, cacheRead: 0, cacheWrite: 0 }, model: 'fake-model-1', stopReason: 'end_turn', costKind: 'api' }; } });
  const fetchStub = async (url, o) => {
    if (/api\.search\.brave\.com/.test(url)) {
      if (o.headers['X-Subscription-Token'] !== 'brave-test-key') return { ok: false, status: 401, json: async () => ({}) };
      const q = decodeURIComponent(url.split('q=')[1]);
      return { ok: true, status: 200, json: async () => ({ web: { results: [{ title: 'Boolean algebra (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Boolean_algebra', description: 'Absorption law: A + AB = A <b>holds</b>.' },
        { title: 'Course notes: ' + q.slice(0, 20), url: 'https://example.edu/notes/boolean.pdf', description: 'The absorption laws follow from distributivity.' }] } }) };
    }
    throw new Error('unexpected fetch ' + url);
  };
  const S = createModelService({ dir, now: () => NOW, encrypt: fakeEncrypt, decrypt: fakeDecrypt, prompts, fetch: fetchStub, adapters: { anthropic: fake, 'openai-compatible': fake, cli: fake } });
  await S.saveProvider({ id: 'claude', kind: 'anthropic', label: 'Fake provider' }, 'sk-test-f7-not-real');
  await S.setSlot('strong', 'claude', 'fake-model-1'); await S.setSlot('fast', 'claude', 'fake-model-1');
  return { S, prompts, calls };
}

// ---------------------------------------------------------------- 1. side questions
async function sideTests() {
  const ok = [];
  const dir = tmp('kartotek-f7-side-');
  const w = loadEngine();
  try {
    const KS = w.KSide, K = w.KCycle;
    await t(ok, 'contexts: the lesson with its blocks and cited units; an open item without its key or solution, which appear once it is answered', () => {
      const { et, pkg, idx } = sample(w);
      const kid = pkg.parts[0].kazanimlar[0].kazanim_id;
      const lc = KS.lessonContext(pkg, kid);
      assert.ok(lc.kind === 'lesson' && /\[block 1/.test(lc.text) && lc.refs.indexOf('block 1') >= 0);
      const item = Object.values(idx).find((it) => it.use !== 'final' && it.format === 'mcq_single');
      const a = K.startAttempt(et, item, 'practice', NOW);
      const open = KS.itemContext(pkg, item, a);
      assert.ok(open.open && !/Key:/.test(open.text) && !/Solution:/.test(open.text));
      K.commit(et, a, { choice: item.key.slice(), confidence_pct: 90 }, item, NOW + 1000);
      const done = KS.itemContext(pkg, item, a);
      assert.ok(!done.open && /Key:/.test(done.text));
      assert.ok(/still open/.test(KS.askInputs(open, 'Why?').context));
    });
    await t(ok, 'opening the panel during an open attempt is help like the lesson pane: assisted, not eligible for DSR; never in the final test or after answering', () => {
      const { et, idx } = sample(w);
      const item = Object.values(idx).find((it) => it.use !== 'final' && it.format === 'mcq_single' && (it.validation || 'unverified') === 'verified');
      const a = K.startAttempt(et, item, 'practice', NOW);
      assert.ok(K.useHelp(a, 'side'));
      assert.ok(a.side_open && a.help.some((h) => h.kind === 'side_panel') && K.assisted(a));
      K.commit(et, a, { choice: item.key.slice(), confidence_pct: 90 }, item, NOW + 1000);
      const el = K.eligibility(a, item);
      assert.ok(!el.eligible && /side questions open/.test(el.reason), el.reason);
      const fin = K.startAttempt(et, item, 'final', NOW);
      assert.ok(!K.useHelp(fin, 'side') && !fin.side_open, 'the final test has no side panel');
      const later = K.startAttempt(et, item, 'practice', NOW + 5000);
      K.commit(et, later, { choice: item.key.slice(), confidence_pct: 90 }, item, NOW + 6000);
      assert.ok(!K.useHelp(later, 'side') && !K.assisted(later), 'after answering, opening it is not help');
    });
    await t(ok, 'a side question through the prompt file and the model service: answered from the lesson, references kept only when they were on screen, stored, nothing else changed', async () => {
      const { et, pkg } = sample(w);
      const kid = pkg.parts[0].kazanimlar[0].kazanim_id;
      const ctx = KS.lessonContext(pkg, kid);
      const { S, prompts, calls } = await service(dir, () => ({ answer_md: 'Both switches must be on (block 1).', uses: ['block 1', 'U99'], beyond_source: false, uncertain: false }));
      const before = JSON.stringify(et.progress.attempts);
      const p = prompts.render('side-answerer', KS.askInputs(ctx, 'When is the gate open?'));
      assert.ok(p.slot === 'fast' && p.schema && /When is the gate open\?/.test(p.text) && p.text.indexOf(ctx.text.split('\n')[0]) > 0);
      const res = await S.run({ feature: 'side-answerer', slot: p.slot, messages: [{ role: 'user', content: p.text }], schema: p.schema, promptId: p.promptId, promptVersion: p.promptVersion });
      eq(KS.checkAnswer(ctx, res.json), []);
      et.progress.side = et.progress.side || [];
      const e = KS.record(et.progress.side, ctx, 'When is the gate open?', res.json, { meta: { provider: res.provider, model: res.model }, now: NOW });
      eq(e.uses, ['block 1']);
      assert.ok(e.context === 'lesson' && e.origin === 'generated' && et.progress.side.length === 1);
      assert.strictEqual(JSON.stringify(et.progress.attempts), before, 'the main flow did not change');
      assert.strictEqual(calls[0].schema.required.indexOf('answer_md') >= 0, true);
      assert.ok(KS.checkAnswer(ctx, { answer_md: 'word '.repeat(300) }).length === 1, 'a long answer is refused');
    });
    await t(ok, 'the default claim of "Check this" is the first sentence that states something, never a heading', () => {
      assert.strictEqual(KS.firstClaim('# What are VIH and VIL?\n\n- **VIH** is the *minimum* input voltage read as a logical **1**.  \n- VIL is the max.'), 'VIH is the minimum input voltage read as a logical 1.');
      assert.strictEqual(KS.firstClaim('A NAND gate is universal. Any function can be built.'), 'A NAND gate is universal.');
      assert.strictEqual(KS.firstClaim('## Only a heading?'), '');
    });
    await t(ok, 'live and practice contexts hide an unanswered check and an open problem\'s solution', () => {
      const s = { id: 'ls-x', title: 'T', steps: [] };
      const st = { n: 1, predict: { stem: 'P?' }, teach: [{ md: 'Teach.', refs: [] }], check: [{ stem: 'C?', options: [{ id: 'a', text: 'x' }], key: 'a', read_at: NOW, answer: null }] };
      const lc = KS.liveContext(s, st, null);
      assert.ok(lc.open && !/Key:/.test(lc.text));
      const pc = KS.practiceContext({ id: 'ls-y', title: 'P' }, { id: 'pp', status: 'open', statement: 'Find x.', model_solution: 'x = 2' });
      assert.ok(pc.open && !/x = 2/.test(pc.text));
    });
  } finally { w.close(); rm(dir); }
  return ok;
}

// ---------------------------------------------------------------- 2. the researcher
async function researchTests() {
  const ok = [];
  const w = loadEngine();
  const dirs = [];
  const mk = () => { const d = tmp('kartotek-f7-res-'); dirs.push(d); return d; };
  try {
    await t(ok, 'availability: the provider\'s web search, else a search key, else nothing (and "Check this" stays hidden)', async () => {
      const a = await service(mk(), () => ({}), { webSearch: true });
      eq((await a.S.searchStatus()).mode, 'provider');
      const b = await service(mk(), () => ({}), { webSearch: false });
      eq((await b.S.searchStatus()).mode, null);
      await b.S.setSearchKey('brave-test-key');
      const st = await b.S.searchStatus();
      assert.ok(st.mode === 'key' && st.hasKey && !JSON.stringify(st).includes('brave-test-key'), 'the key is never returned');
      await b.S.clearSearchKey();
      eq((await b.S.searchStatus()).mode, null);
    });
    await t(ok, 'the key mode end to end: three searches, a brief citing only the results, an invented URL refused and repaired, links checked, the request updated', async () => {
      const d = mk();
      let n = 0;
      const { S, calls } = await service(d, (req) => {
        n++;
        const txt = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('');
        assert.ok(/Boolean algebra \(Wikipedia\)/.test(txt) || n > 1, 'the results are in the request');
        assert.ok(!req.webSearch, 'no provider search in key mode');
        const brief = { verdict: 'supported', summary: 'The absorption law A + AB = A holds in Boolean algebra.', findings: [{ text: 'It follows from distributivity.', sources: [1, 2] }],
          sources: [{ title: 'Boolean algebra', url: 'https://en.wikipedia.org/wiki/Boolean_algebra', quote: 'Absorption law: A + AB = A holds.' }, { title: 'Notes', url: 'https://example.edu/notes/boolean.pdf', quote: 'The absorption laws follow from distributivity.' }] };
        if (n === 1) brief.sources[1].url = 'https://invented.example.com/page';
        return brief;
      }, { webSearch: false });
      await S.setSearchKey('brave-test-key');
      const links = [];
      const prompts = createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: d });
      const jobs = createJobService({ dir: d, models: S, prompts, pipelines: { research }, research: { status: () => S.searchStatus(), search: (q) => S.search(q), checkLink: async (u) => { links.push(u); return { ok: !/example\.edu/.test(u), status: /example\.edu/.test(u) ? 404 : 200 }; } } });
      const st = w.KStore.emptyState();
      const req = w.KSide.newRequest(st, { claim: 'A + A·B = A for all Boolean A, B', context: 'An explanation', target: { kind: 'explanation', attempt: 'at-1', n: 0 }, now: NOW });
      const job = await jobs.create('research', { claim: req.claim, context: req.context, sources: 'L1 slide 30' });
      assert.ok(job.estimate && /Three searches/.test(job.estimate.note));
      jobs.start(job.id);
      assert.ok(await waitFor(() => { const j = jobs.get(job.id); return j.status === 'done' || j.status === 'failed'; }, 8000));
      const done = jobs.get(job.id);
      assert.strictEqual(done.status, 'done', done.error || '');
      assert.strictEqual(n, 2, 'one repair: the invented URL was refused');
      assert.ok(/not one of the search results/.test(calls[1].messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('')));
      const b = done.result.brief;
      assert.ok(b.sources.length === 2 && b.sources[0].working === true && b.sources[1].working === false && b.sources[1].status === 404);
      eq(links, ['https://en.wikipedia.org/wiki/Boolean_algebra', 'https://example.edu/notes/boolean.pdf']);
      w.KSide.applyJob(st, req.id, done);
      const r = w.KSide.researchOf(st).requests[req.id];
      assert.ok(r.status === 'done' && r.brief.verdict === 'supported' && r.mode === 'key');
      eq(w.KSide.requestsFor(st, { kind: 'explanation', attempt: 'at-1' }).map((x) => x.id), [req.id]);
    });
    await t(ok, 'the provider mode: one call with the web search tool switched on; a verdict without sources or a long quote is refused', async () => {
      const d = mk();
      const { S, calls } = await service(d, () => ({ verdict: 'unclear', summary: 'Nothing reliable found.', findings: [], sources: [] }), { webSearch: true });
      const prompts = createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: d });
      const jobs = createJobService({ dir: d, models: S, prompts, pipelines: { research }, research: { status: () => S.searchStatus(), search: () => { throw new Error('no key search in provider mode'); }, checkLink: async () => ({ ok: true, status: 200 }) } });
      const job = await jobs.create('research', { claim: 'Some claim about gates', context: '' });
      jobs.start(job.id);
      assert.ok(await waitFor(() => jobs.get(job.id).status === 'done', 8000), jobs.get(job.id).error || '');
      assert.ok(calls[0].webSearch === true, 'the request asks for web search');
      assert.ok(!jobs.get(job.id).steps.some((s) => s.id === 'search'), 'no search step');
      const p = research.checkBrief({ verdict: 'supported', summary: 's', findings: [{ text: 'x', sources: [3] }], sources: [{ title: 't', url: 'not a url', quote: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix' }] }, null).join(' ');
      assert.ok(/not a web address/.test(p) && /longer than 25 words/.test(p) && /cites source 3/.test(p), p);
      assert.ok(/needs at least one source/.test(research.checkBrief({ verdict: 'contradicted', summary: 's', findings: [], sources: [] }, null).join(' ')));
      const st = w.KStore.emptyState(), rq = w.KSide.newRequest(st, { claim: 'c', target: { kind: 'live', session: 'ls-1' } });
      w.KSide.applyJob(st, rq.id, jobs.get(job.id));
      assert.strictEqual(w.KSide.researchOf(st).requests[rq.id].status, 'no_sources', 'a brief without sources is not a verdict');
    });
    await t(ok, 'without web search or a key the job refuses to start, and the search key never reaches a request or the job record', async () => {
      const d = mk();
      const { S } = await service(d, () => ({}), { webSearch: false });
      const prompts = createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: d });
      const jobs = createJobService({ dir: d, models: S, prompts, pipelines: { research }, research: { status: () => S.searchStatus(), search: (q) => S.search(q), checkLink: async () => ({ ok: true }) } });
      const no = await jobs.create('research', { claim: 'x y z claim' });
      assert.ok(no.status === 'failed' && /web search/.test(no.error), 'the job refuses: ' + no.error);
      await S.setSearchKey('brave-test-key');
      const job = await jobs.create('research', { claim: 'x y z claim' });
      const raw = fs.readFileSync(path.join(d, 'jobs', job.id, 'job.json'), 'utf8');
      assert.ok(!raw.includes('brave-test-key'));
      eq(research.queries({ claim: 'x' }), ['x', 'x textbook definition', 'x lecture notes']);
    });
    await t(ok, 'the link check: an answering link, a refused HEAD that answers to GET, a dead link, a non-web address', async () => {
      const f = async (url, o) => {
        if (/dead/.test(url)) throw new Error('down');
        if (/nohead/.test(url) && o.method === 'HEAD') return { status: 405 };
        return { status: 200 };
      };
      eq(await checkLink('https://ok.example/', { fetch: f }), { ok: true, status: 200 });
      eq(await checkLink('https://nohead.example/', { fetch: f }), { ok: true, status: 200 });
      assert.strictEqual((await checkLink('https://dead.example/', { fetch: f })).ok, false);
      assert.strictEqual((await checkLink('javascript:alert(1)', { fetch: f })).ok, false);
    });
    await t(ok, 'a refused search key says why: Brave\'s 422 SUBSCRIPTION_TOKEN_INVALID is a key problem, its detail shown, the key never in the message', async () => {
      const d = mk(), { S } = await service(d, () => ({}));
      await S.setSearchKey('brave-wrong-key-123');
      const f422 = async () => ({ ok: false, status: 422, json: async () => ({ error: { code: 'SUBSCRIPTION_TOKEN_INVALID', detail: 'The provided subscription token is invalid.' } }) });
      let err = null; try { await S.search('noise margin', { fetch: f422 }); } catch (e) { err = e; }
      assert.ok(err && err.code === 'auth' && /422 SUBSCRIPTION_TOKEN_INVALID/.test(err.message) && /token is invalid/.test(err.message) && !err.message.includes('brave-wrong-key-123'), err && err.message);
      const f500 = async () => ({ ok: false, status: 500, json: async () => { throw new Error('no body'); } });
      err = null; try { await S.search('noise margin', { fetch: f500 }); } catch (e) { err = e; }
      assert.ok(err && err.code === 'provider' && /answered 500/.test(err.message), err && err.message);
    });
  } finally { w.close(); dirs.forEach(rm); }
  return ok;
}

async function run() {
  const out = [];
  for (const [label, fn] of [['Side questions', sideTests], ['Researcher (fake provider, stand-in search)', researchTests]]) {
    const ok = await fn();
    out.push(label + ': ' + ok.length + '/' + ok.length + ' passed');
  }
  return out;
}
module.exports = { run };
if (require.main === module) run().then((l) => l.forEach((x) => console.log(x)), (e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
