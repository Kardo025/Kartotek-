'use strict';
// Tests for task F5: adaptive practice (Evaluating, free practice, your own problem). No test calls a real service: the coach and the
// hint giver answer through the model service with a fake provider, and a scripted learner works the problems.
//  1. The coach prompt file: strong slot, strict schema, shared fragments.
//  2. Choosing the demand in code: difficulty up after a clean solve, held after hints, down after a miss; earlier topics mixed in from
//     the third problem; every miss back once in a new setting; the run ends.
//  3. A whole Evaluating run through the model service: the coach's own check rejects one draft and corrects another, a wrong claim gets
//     "not yet" with the first break, a hint from the ladder, a right claim is "solved", a "solved" against the committed number is
//     refused, giving up, the retest; finishing completes the topic's cycle as "practised"; nothing reaches the scheduler.
//  4. Your own problem, "Report a problem", the records, the report row.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPrompts } = require('../desktop/models/prompts');
const { createModelService } = require('../desktop/models/service');
const { validate } = require('../desktop/models/schema');
const { loadEngine } = require('./study-model-tests.cjs');
const { pkgFixture } = require('./probe-tests.cjs');

const root = path.join(__dirname, '..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const NOW = Date.UTC(2026, 10, 18, 9);
const plain = (o) => JSON.parse(JSON.stringify(o));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const fakeEncrypt = async (s) => Buffer.from('ENC1' + Buffer.from(s, 'utf8').toString('base64').split('').reverse().join(''));
const fakeDecrypt = async (b) => Buffer.from(b.toString().slice(4).split('').reverse().join(''), 'base64').toString('utf8');
async function t(list, name, fn) { try { await fn(); list.push(name); } catch (e) { e.message = name + ': ' + e.message; throw e; } }

const E = { problem: { statement: '', setting: '', template: '', targets: [], solution: '', answer: '', uncertain: [] }, check: { sound: true, issue: '', solution: '', answer: '' }, verdict: { result: 'not_yet', moves: '', first_break: '', feedback: '' }, own: { solvable: true, issue: '', solution: '', answer: '', targets: [] } };
const reply = (task, part) => Object.assign(plain(E), { task }, { [task === 'write' ? 'problem' : task]: Object.assign(plain(E[task === 'write' ? 'problem' : task]), part) });
function writeReply(KPr, s, n) { const sp = KPr.nextSpec(s); return reply('problem', { statement: 'Problem ' + n + ': with ' + sp.ideas + ' idea(s) in a ' + sp.setting + ' setting, find x.', setting: 'setting ' + n, template: '', targets: sp.targets, solution: 'Step 1. Step 2. x = ' + (10 + n), answer: String(10 + n) }); }
// The engine's own task names → the reply "task" field
const as = (task, part) => { const r = reply(task === 'write' ? 'write' : task, part); r.task = task === 'write' ? 'problem' : task; return r; };

function evaluatingSession(w, kid) {
  const KPr = w.KPractice, pkg = pkgFixture(), st = w.KStore.emptyState();
  const s = KPr.newSession(st, { purpose: 'evaluating', title: 'Evaluating', etut_id: 'fx', kids: [kid || 'k3'], targets: KPr.targetsFor(pkg, kid || 'k3'), now: NOW });
  return { st, s, pkg, KPr };
}
// Runs problems without a model: the learner solves (clean | hints | miss) per a script; returns the levels seen
function drive(w, s, script) {
  const KPr = w.KPractice, levels = [];
  let n = 0, guard = 0;
  while (guard++ < 100) {
    const ph = KPr.phase(s);
    if (ph === 'complete') break;
    if (ph === 'write') { KPr.applyReply(s, 'write', as('write', writeReply(KPr, s, ++n).problem), { now: NOW + n }); continue; }
    if (ph === 'check') { KPr.applyReply(s, 'check', as('check', { sound: true, solution: KPr.lastProblem(s).model_solution, answer: KPr.lastProblem(s).answer }), { now: NOW + n }); continue; }
    if (ph === 'between') { KPr.nextProblem(s, NOW + n); continue; }
    const p = KPr.lastProblem(s), how = script[(p.retest_of ? 'r' : '') + n] || script.default || 'clean';
    levels.push((p.retest_of ? 'r' : '') + p.difficulty.level);
    if (how === 'miss') { KPr.giveUp(s, NOW + n); continue; }
    if (how === 'hints') p.help.push({ kind: 'model_hint', level: 'R1', requested: 'R1', text: 'look again', at: NOW });
    KPr.submit(s, { thinking: 'worked it', answer: p.answer }, NOW + n);
    KPr.applyReply(s, 'verdict', as('verdict', { result: 'solved', moves: 'm', first_break: '', feedback: 'ok' }), { now: NOW + n });
  }
  return levels;
}

// ---------------------------------------------------------------- 1 and 2
async function engineTests() {
  const ok = [];
  const w = loadEngine();
  const dir = tmp('kartotek-f5-p-');
  try {
    await t(ok, 'the coach prompt is shipped (version 3, strong slot, strict schema, no $ref) with the shared fragments', () => {
      const prompts = createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: dir });
      const l = prompts.list().find((p) => p.id === 'practice-coach');
      assert.ok(l && l.slot === 'strong' && l.schema && !l.draft && l.version >= 3);
      const r = prompts.render('practice-coach', { outcomes: 'O', material: 'M', history: 'H', learner_turn: 'L', task: 'T', problems: 'none' });
      assert.ok(r.text.indexOf('## Voice') > 0 && r.text.indexOf('## Voice') < r.text.indexOf('Answer with JSON only'));
      const walk = (s, where) => { if (!s || typeof s !== 'object') return; assert.ok(!s.$ref, where); if (s.type === 'object') { assert.strictEqual(s.additionalProperties, false, where); eq((s.required || []).slice().sort(), Object.keys(s.properties || {}).sort(), where); } Object.keys(s.properties || {}).forEach((x) => walk(s.properties[x], where + '.' + x)); if (s.items) walk(s.items, where + '[]'); };
      walk(prompts.get('practice-coach').schema, 'practice-coach');
    });
    await t(ok, 'targets: the topic\'s outcomes first, then the earlier topics of the same part (marked earlier)', () => {
      const { s } = evaluatingSession(w, 'k3');
      eq(s.targets.map((x) => x.id + (x.earlier ? '*' : '')), ['LO-3', 'LO-1*', 'LO-2*']);
    });
    await t(ok, 'five clean solves give five problems of rising difficulty (levels 1 to 5); ideas and settings follow the level', () => {
      const { s, KPr } = evaluatingSession(w);
      eq(drive(w, s, {}), ['1', '2', '3', '4', '5']);
      eq(s.problems.map((p) => p.difficulty.ideas + ':' + p.difficulty.setting), ['1:familiar', '1:new', '2:familiar', '2:new', '3:new']);
      assert.strictEqual(KPr.phase(s), 'complete');
    });
    await t(ok, 'after hints the level holds, after a miss it drops; every miss comes back once, in a different setting, before the run ends', () => {
      const { s, KPr } = evaluatingSession(w);
      const lv = drive(w, s, { 1: 'clean', 2: 'hints', 3: 'miss', 4: 'clean', 5: 'clean' });
      eq(lv, ['1', '2', '2', '1', '2', 'r2']);
      const miss = s.problems.find((p) => p.outcome === 'given_up' || p.outcome === 'moved_on'), back = s.problems.find((p) => p.retest_of === miss.id);
      assert.ok(back && back.difficulty.setting !== miss.difficulty.setting && back.difficulty.level === miss.difficulty.level);
      eq(back.targets, miss.targets);
      assert.ok(/RETEST/.test(KPr.coachInputs(Object.assign(plain(s), { problems: s.problems.slice(0, 5) }), 'write', {}).task), 'the retest request says so');
    });
    await t(ok, 'from the third problem on, a problem that combines ideas mixes in an earlier topic of the same part', () => {
      const { s } = evaluatingSession(w);
      drive(w, s, {});
      const third = s.problems[2], fourth = s.problems[3];
      assert.ok(third.targets.length === 2 && third.targets.indexOf('LO-3') >= 0 && third.targets.some((x) => /LO-[12]/.test(x)), JSON.stringify(third.targets));
      assert.ok(fourth.targets.some((x) => /LO-[12]/.test(x)));
      assert.ok(s.problems[0].targets.length === 1 && s.problems[0].targets[0] === 'LO-3', 'the first problem is on the topic itself');
    });
  } finally { w.close(); rm(dir); }
  return ok;
}

// ---------------------------------------------------------------- 3. a whole run through the model service
async function serviceTests() {
  const ok = [];
  const dir = tmp('kartotek-f5-models-');
  const w = loadEngine();
  try {
    const prompts = createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: dir });
    const calls = [];
    let respond = null;
    const fake = (cfg) => ({ kind: 'api', cfg, capabilities: () => ({ stream: true, structured: 'native', images: true, webSearch: false }), listModels: async () => [{ id: 'fake-model-1', label: 'Fake' }],
      run: async (req) => { calls.push(req); const json = respond(req, calls.length); return { text: JSON.stringify(json), json, usage: { input: 1500, output: 400, cacheRead: 0, cacheWrite: 0 }, model: 'fake-model-1', stopReason: 'end_turn', costKind: 'api' }; } });
    const S = createModelService({ dir, now: () => NOW, encrypt: fakeEncrypt, decrypt: fakeDecrypt, prompts, adapters: { anthropic: fake, 'openai-compatible': fake, cli: fake } });
    await S.saveProvider({ id: 'claude', kind: 'anthropic', label: 'Fake provider' }, 'sk-test-f5-not-real');
    await S.setSlot('strong', 'claude', 'fake-model-1'); await S.setSlot('fast', 'claude', 'fake-model-1');
    const ask = async (id, v) => {
      const p = prompts.render(id, v);
      const res = await S.run({ feature: id, slot: p.slot, messages: [{ role: 'user', content: p.text }], schema: p.schema, promptId: p.promptId, promptVersion: p.promptVersion });
      return { json: res.json, meta: { provider: res.provider, providerLabel: res.providerLabel, model: res.model, costUsd: res.costUsd, costKind: res.costKind }, prompt: { promptId: p.promptId, promptVersion: p.promptVersion } };
    };
    const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('');

    await t(ok, 'an Evaluating run end to end: own check (one draft rejected, one corrected), not yet → hint → solved with hints, a wrong "solved" refused, give up, retest, finish → "practised"', async () => {
      const K = w.KCycle, KPr = w.KPractice;
      // a real Study v2 package so the topic cycle and the report run
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'samples', 'studies', 'sample-cycle-v2', 'etut.json'), 'utf8'));
      const st = w.KStore.emptyState();
      const et = w.KEtut.importPackage(st, pkg, { now: NOW }).etut;
      K.migrate(et.progress, et.package);
      const kid = pkg.parts[0].kazanimlar[1] ? pkg.parts[0].kazanimlar[1].kazanim_id : pkg.parts[0].kazanimlar[0].kazanim_id;
      const s = KPr.newSession(st, { purpose: 'evaluating', title: 'Evaluating', etut_id: et.etut_id, kids: [kid], targets: KPr.targetsFor(et.package, kid), now: NOW });
      KPr.linkEvaluating(et, kid, s);
      const reviews = st.reviews.length;
      let checks = 0, n = 0;
      respond = (req) => {
        const txt = textOf(req);
        if (/"rung"/.test(JSON.stringify(req.schema || {}))) return { rung: 'R0', stuck_at: 'which rule applies', hint: 'Look at what the problem gives you about the inputs again.', reveals: '' };
        if (/\nWRITE a new problem|```text\nWRITE a new problem/.test(txt)) return writeReply(KPr, s, ++n);
        if (/CHECK your own problem/.test(txt)) {
          checks++;
          if (checks === 1) return as('check', { sound: false, issue: 'Solvable by guessing without the target.', solution: '', answer: '' });
          if (checks === 2) return as('check', { sound: true, issue: '', solution: 'Corrected: x = 99', answer: '99' });
          return as('check', { sound: true, issue: '', solution: KPr.lastProblem(s).model_solution, answer: KPr.lastProblem(s).answer });
        }
        if (/JUDGE the learner/.test(txt)) {
          const sub = KPr.lastProblem(s).submissions.slice(-1)[0];
          return sub.answer === KPr.lastProblem(s).answer ? as('verdict', { result: 'solved', moves: 'used the rule', first_break: '', feedback: 'The rule carried it.' })
            : as('verdict', { result: 'not_yet', moves: 'stopped early', first_break: 'The second step uses the wrong case.', feedback: '' });
        }
        throw new Error('unexpected request');
      };
      const run = async (task) => { const r = await ask('practice-coach', KPr.coachInputs(s, task, { pkg: et.package })); assert.deepStrictEqual(validate(prompts.get('practice-coach').schema, r.json), []); const c = KPr.checkReply(s, task, r.json, { pkg: et.package }); assert.ok(c.ok, task + ': ' + c.problems.join(' ')); KPr.applyReply(s, task, r.json, { now: NOW, meta: r.meta, prompt: r.prompt }); return r; };
      let guard = 0, script = 0, refused = false;
      while (guard++ < 80) {
        const ph = KPr.phase(s);
        if (ph === 'complete') break;
        if (KPr.needsCall(s) && ph !== 'verdict') { await run(ph); continue; }
        if (ph === 'between') { KPr.nextProblem(s, NOW); continue; }
        const p = KPr.lastProblem(s);
        if (ph === 'work') {
          script++;
          if (script === 1) { KPr.submit(s, { thinking: 'I think it is 5 because of the first rule.', answer: '5', confidence_pct: 60 }, NOW); continue; }       // wrong
          if (script === 2) {                                                                                                                                   // a hint, then right
            const r = await ask('hint-giver', KPr.hintInputs(s, { thinking: 'stuck', answer: '' }, KPr.nextRung(p), []));
            assert.ok(KPr.recordHint(s, r.json, { requested: 'R0', now: NOW, meta: r.meta, prompt: r.prompt }).ok);
            KPr.submit(s, { thinking: 'With the hint: second rule.', answer: p.answer, confidence_pct: 80 }, NOW); continue;
          }
          if (script === 4) { KPr.giveUp(s, NOW); continue; }                                                                                                 // a miss
          KPr.submit(s, { thinking: 'Applied the rule.', answer: p.answer, confidence_pct: 90 }, NOW); continue;
        }
        if (ph === 'verdict') {
          if (!refused) {
            // the coach says "solved" although the answer box disagrees with the committed number: refused, judged again
            const bad = as('verdict', { result: 'solved', moves: 'm', first_break: '', feedback: 'fine' });
            const c = KPr.checkReply(s, 'verdict', bad, {});
            assert.ok(!c.ok && /does not match the committed answer/.test(c.problems.join(' ')));
            refused = true;
          }
          await run('verdict'); continue;
        }
        throw new Error('phase ' + ph);
      }
      const m = KPr.summary(s);
      assert.strictEqual(KPr.phase(s), 'complete');
      assert.strictEqual(m.rejected, 1, 'one draft rejected by the coach\'s own check, never shown');
      const corrected = s.problems.find((p) => p.check && p.check.changed);
      assert.ok(corrected && corrected.answer === '99' && corrected.draft.answer !== '99', 'the check corrected the committed answer before it was shown');
      const first = s.problems.filter((p) => p.status !== 'rejected')[0];
      assert.ok(first.submissions[0].verdict.result === 'not_yet' && /second step/.test(first.submissions[0].verdict.first_break) && first.outcome === 'solved_with_hints' && first.highest_rung === 'R0');
      assert.ok(m.missed === 1 && m.retests === 1 && m.problems === 6, JSON.stringify(m));
      s.problems.filter((p) => p.status !== 'rejected').forEach((p) => assert.ok(p.model_solution && p.targets.length && p.outcome && p.origin === 'generated' && p.validation === 'unverified' && p.by.model === 'fake-model-1', 'record of ' + p.n));
      // finishing: the topic cycle is complete as "practised", and next() keeps it
      KPr.completeEvaluating(et, kid, s, NOW + 1);
      assert.ok(et.progress.evaluating[kid] === 'practised' && K.cycleDone(et, kid) && s.status === 'done');
      const pos = w.KGraph.topicsOf(et.package).find((x) => x.kid === kid);
      K.goto(et, pos.pi, pos.ti, 'evaluate', NOW); K.next(et, NOW);
      assert.strictEqual(et.progress.evaluating[kid], 'practised');
      assert.strictEqual(st.reviews.length, reviews, 'no review event');
      const rep = K.report(st, et, NOW, null);
      assert.ok(rep.process.practice.length === 1 && rep.process.practice[0].problems === 6 && rep.process.practice[0].purpose === 'evaluating');
      const usage = fs.readdirSync(dir).filter((f) => /usage/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
      assert.ok(!/first rule/.test(usage), 'no learner text in the usage log');
      assert.ok(/Thinking:\nI think it is 5/.test(textOf(calls.find((c) => /JUDGE/.test(textOf(c))))), 'the verdict request carries the thinking');
    });
    await t(ok, 'skipping Evaluating is still recorded as deferred_by_user', () => {
      const K = w.KCycle;
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'samples', 'studies', 'sample-cycle-v2', 'etut.json'), 'utf8'));
      const st = w.KStore.emptyState(), et = w.KEtut.importPackage(st, pkg, { now: NOW }).etut;
      K.migrate(et.progress, et.package);
      const kid = pkg.parts[0].kazanimlar[0].kazanim_id;
      K.goto(et, 0, 0, 'evaluate', NOW); K.next(et, NOW);
      assert.strictEqual(et.progress.evaluating[kid], 'deferred_by_user');
    });
  } finally { w.close(); rm(dir); }
  return ok;
}

// ---------------------------------------------------------------- 4. own problem, reports, refusals
async function miscTests() {
  const ok = [];
  const w = loadEngine();
  try {
    await t(ok, 'your own problem: the coach solves it first, then the usual work and verdict; an unsolvable one is said so and ended; it never counts as generated practice', () => {
      const { s, KPr } = evaluatingSession(w);
      KPr.bringOwn(s, 'A 12 V source drives 4 Ω. Find the current.', null, NOW);
      assert.strictEqual(KPr.phase(s), 'own');
      assert.ok(/OWN problem/.test(KPr.coachInputs(s, 'own', {}).task) && /12 V source/.test(KPr.coachInputs(s, 'own', {}).task));
      KPr.applyReply(s, 'own', as('own', { solvable: true, issue: '', solution: 'I = V/R = 3 A', answer: '3 A', targets: ['LO-3'] }), { now: NOW });
      const p = KPr.lastProblem(s);
      assert.ok(p.origin === 'learner' && p.statement.startsWith('A 12 V') && p.status === 'open');
      KPr.submit(s, { thinking: 'Ohm', answer: '3 A' }, NOW);
      KPr.applyReply(s, 'verdict', as('verdict', { result: 'solved', moves: 'Ohm', first_break: '', feedback: '' }), { now: NOW });
      assert.ok(p.outcome === 'solved' && KPr.summary(s).problems === 0 && KPr.summary(s).own === 1);
      KPr.nextProblem(s, NOW);
      KPr.bringOwn(s, 'Find x.', null, NOW);
      KPr.applyReply(s, 'own', as('own', { solvable: false, issue: 'Nothing about x is given.', solution: '', answer: '', targets: [] }), { now: NOW });
      assert.ok(KPr.lastProblem(s).outcome === 'unsolvable' && KPr.phase(s) === 'between');
      assert.throws(() => KPr.bringOwn(s, '   ', null, NOW), /Paste or choose/);
    });
    await t(ok, '"Report a problem" marks it disputed and leaves every count (an open one ends); withdrawing restores it', () => {
      const { s, KPr } = evaluatingSession(w);
      drive(w, s, { default: 'clean' });
      const before = KPr.summary(s).solved;
      KPr.dispute(s, s.problems[1].id, 'The solution uses the wrong sign.', NOW);
      assert.ok(KPr.summary(s).solved === before - 1 && KPr.summary(s).disputed === 1 && s.problems[1].disputed.note === 'The solution uses the wrong sign.');
      KPr.undispute(s, s.problems[1].id, NOW);
      assert.ok(KPr.summary(s).solved === before && s.problems[1].dispute_log.length === 1);
    });
    await t(ok, 'refused replies: wrong targets, no solution, a repeated problem, an unclear check, a "not yet" without the first break; the learner needs work before a claim', () => {
      const { s, KPr } = evaluatingSession(w);
      const good = writeReply(KPr, s, 1);
      const bad = plain(good); bad.problem.targets = ['LO-9']; bad.problem.solution = '';
      const all = KPr.checkReply(s, 'write', bad, {}).problems.join(' ');
      assert.ok(/LO-9/.test(all) && /exactly these targets/.test(all) && /solution is empty/.test(all), all);
      KPr.applyReply(s, 'write', good, { now: NOW });
      assert.ok(/sound must be/.test(KPr.checkReply(s, 'check', as('check', { sound: 'yes' }), {}).problems.join(' ')));
      assert.ok(/issue must say/.test(KPr.checkReply(s, 'check', as('check', { sound: false, issue: '' }), {}).problems.join(' ')));
      KPr.applyReply(s, 'check', as('check', { sound: true, solution: 'x = 11', answer: '11' }), { now: NOW });
      assert.throws(() => KPr.submit(s, { thinking: '', answer: '' }, NOW), /Write your work/);
      KPr.submit(s, { thinking: 'try', answer: '7' }, NOW);
      assert.ok(/first_break must/.test(KPr.checkReply(s, 'verdict', as('verdict', { result: 'not_yet', first_break: '' }), {}).problems.join(' ')));
      KPr.applyReply(s, 'verdict', as('verdict', { result: 'not_yet', first_break: 'Step 2.' }), { now: NOW });
      KPr.giveUp(s, NOW); KPr.nextProblem(s, NOW);
      const again = plain(good);
      assert.ok(/already given/.test(KPr.checkReply(s, 'write', again, {}).problems.join(' ')));
    });
    await t(ok, 'three drafts rejected in a row stop the run with "stuck" instead of looping; "Write another one" continues', () => {
      const { s, KPr } = evaluatingSession(w);
      for (let i = 0; i < 3; i++) { KPr.applyReply(s, 'write', writeReply(KPr, s, i + 1), { now: NOW }); KPr.applyReply(s, 'check', as('check', { sound: false, issue: 'bad' }), { now: NOW }); }
      assert.ok(KPr.phase(s) === 'stuck' && KPr.needsCall(s) === null);
      KPr.retry(s);
      assert.strictEqual(KPr.phase(s), 'write');
    });
    await t(ok, 'pause and resume keep the run where it was; a JSON round trip (a restart) gives the same phase', () => {
      const { st, s, KPr } = evaluatingSession(w);
      KPr.applyReply(s, 'write', writeReply(KPr, s, 1), { now: NOW });
      KPr.applyReply(s, 'check', as('check', { sound: true, solution: 'x = 11', answer: '11' }), { now: NOW });
      KPr.pause(s, NOW);
      assert.ok(KPr.phase(s) === 'paused' && KPr.needsCall(s) === null);
      KPr.resume(s, NOW);
      const back = w.KStore.normalize(JSON.parse(JSON.stringify(st))).sessions[s.id];
      assert.strictEqual(KPr.phase(back), 'work');
    });
  } finally { w.close(); }
  return ok;
}

async function run() {
  const out = [];
  for (const [label, fn] of [['Practice: choosing the demand', engineTests], ['Practice through the model service (fake provider)', serviceTests], ['Practice: own problem, reports, refusals, resume', miscTests]]) {
    const ok = await fn();
    out.push(label + ': ' + ok.length + '/' + ok.length + ' passed');
  }
  return out;
}
module.exports = { run };
if (require.main === module) run().then((l) => l.forEach((x) => console.log(x)), (e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
