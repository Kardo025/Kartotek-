'use strict';
// Tests for task F4: step-by-step teaching in a live session. No test calls a real service: the teacher answers through the model service
// with a fake provider, and a scripted learner answers.
//  1. The teacher prompt file: strong slot, strict schema, shared fragments composed in.
//  2. A whole session of ten steps through the prompt file and the model service: predict → teach + check → read → answer; a miss is
//     repaired; a repair that finds a missing foundation inserts it into the map; the position follows; "done" only after the goal is
//     checked; the self-report; the transcript keeps every question, answer, thinking text and confidence; nothing reaches the scheduler.
//  3. Refusals: too long, unknown references, a held node, "done" too early, a repeated check, banned options.
//  4. Pause, resume and a restart in the middle of every phase (the session survives a JSON round trip and continues where it was).
//  5. Own files: read locally, cached outside the learner data, cited by page label; the research hook; the report row.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPrompts } = require('../desktop/models/prompts');
const { createModelService } = require('../desktop/models/service');
const { validate } = require('../desktop/models/schema');
const { createLiveFiles } = require('../desktop/live');
const { loadEngine } = require('./study-model-tests.cjs');
const { pkgFixture, learner, runProbe } = require('./probe-tests.cjs');

const root = path.join(__dirname, '..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const NOW = Date.UTC(2026, 10, 17, 9);
const plain = (o) => JSON.parse(JSON.stringify(o));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const fakeEncrypt = async (s) => Buffer.from('ENC1' + Buffer.from(s, 'utf8').toString('base64').split('').reverse().join(''));
const fakeDecrypt = async (b) => Buffer.from(b.toString().slice(4).split('').reverse().join(''), 'base64').toString('utf8');
async function t(list, name, fn) { try { await fn(); list.push(name); } catch (e) { e.message = name + ': ' + e.message; throw e; } }

const PLAN = { approach: 'From parts 1-2 to k9 in three stations.', uncertain: [], nodes: [
  { id: 'held-basics', label: 'Parts 1 and 2', kind: 'held', depends_on: [], units: [], why: 'held', mode: 'expository' },
  { id: 'n1', label: 'Idea one', kind: 'learn', depends_on: ['held-basics'], units: ['U15'], why: 'first', mode: 'socratic' },
  { id: 'n2', label: 'Idea two', kind: 'learn', depends_on: ['n1'], units: ['U16'], why: 'second', mode: 'socratic' },
  { id: 'n3', label: 'Idea three', kind: 'learn', depends_on: ['n2'], units: ['U17'], why: 'third', mode: 'expository' },
  { id: 'goal-k9', label: 'Do k9', kind: 'goal', depends_on: ['n3'], units: ['U18'], why: 'the goal', mode: 'expository' }] };

// An attached session past the probe and with an accepted plan
function readySession(w, opts) {
  const KP = w.KProbe, KPl = w.KPlan, pkg = pkgFixture(), st = w.KStore.emptyState();
  const s = KPl.newSession(st, { goal_words: 'Do k9', attached: { etut_id: 'fx', topics: ['k9'] }, now: NOW });
  s.probe = KP.newProbe({ mode: 'live', session_id: s.id, strands: KP.strandsFor(pkg, { kind: 'topics', kids: ['k9'] }), scope: { kind: 'topics', kids: ['k9'] }, now: NOW });
  runProbe(w, s.probe, learner({ p1: 99, p2: 99, p3: 0 }));
  KPl.probeDone(s, NOW);
  KPl.addPlanVersion(s, plain((opts && opts.plan) || PLAN), { reason: 'first', now: NOW });
  KPl.acceptPlan(s, NOW);
  return { st, s, pkg };
}

const opt3 = (a, b, c) => [{ id: 'A', text: a, wrong_model: '' }, { id: 'B', text: b, wrong_model: 'confuses one and two' }, { id: 'C', text: c, wrong_model: 'thinks it always holds' }];
const EMPTY_T = { resolves: '', md: '', refs: [], uncertain: [], gap: { label: '', why: '', before: '' } };
const EMPTY_Q = { kind: 'open', stem: '', options: [], key: '', why: '' };
const EMPTY_C = { stem: '', options: [], key: '' };
// The fake teacher: each learn node gets two steps, the goal one; the first check of n2 is missed (repaired), the first repair of n3 finds a gap
function teacherReply(w, s, task, n) {
  const KL = w.KLive, KPl = w.KPlan, v = KPl.currentPlan(s);
  const rights = {};
  (s.steps || []).forEach((st) => { if (st.outcome === 'right' || st.outcome === 'right_after_repair') rights[st.node] = (rights[st.node] || 0) + 1; });
  if (task === 'predict') {
    const order = ['n1', 'n2'].concat(v.nodes.filter((x) => x.kind === 'learn' && ['n1', 'n2', 'n3'].indexOf(x.id) < 0).map((x) => x.id), ['n3', 'goal-k9']);
    const next = order.find((id) => v.nodes.some((x) => x.id === id) && (rights[id] || 0) < (id === 'goal-k9' ? 1 : 2));
    if (!next) return { phase: 'done', node: '', question: EMPTY_Q, teach: EMPTY_T, check: EMPTY_C, done_summary: 'Built k9 from parts 1 and 2 in three stations.' };
    const choice = n % 2 === 0;
    return { phase: 'predict', node: next, teach: EMPTY_T, check: EMPTY_C, done_summary: '',
      question: choice ? { kind: 'choice', stem: 'Prediction ' + n + ' about ' + next + ': what has to give?', options: opt3('The rule', 'The other rule', 'Nothing'), key: 'A', why: 'w' } : { kind: 'open', stem: 'Prediction ' + n + ' about ' + next + ': what would you try?', options: [], key: '', why: 'w' } };
  }
  const st = KL.lastStep(s);
  if (task === 'repair' && st.node === 'n3' && !v.nodes.some((x) => /^missing/.test(x.id))) {
    return { phase: 'teach', node: st.node, question: EMPTY_Q, check: EMPTY_C, done_summary: '', teach: { resolves: 'Your choice shows the basics of k8 are not there yet.', md: 'We step back to the basics first.', refs: [], uncertain: [], gap: { label: 'Missing basics of k8', why: 'the check showed it', before: 'n3' } } };
  }
  return { phase: 'teach', node: st.node, question: EMPTY_Q, done_summary: '',
    teach: { resolves: task === 'repair' ? 'You chose the other rule: that is the wrong model.' : 'You predicted it; here is why.', md: 'The **step** on ' + st.node + ', taught ' + (task === 'repair' ? 'another way' : 'once') + '. It follows from what you hold (U15).', refs: ['U15'], uncertain: n === 3 ? ['Whether U15 covers the edge case'] : [], gap: { label: '', why: '', before: '' } },
    check: { stem: 'Check ' + n + ' on ' + st.node + ': apply it to a new case.', options: opt3('Right case', 'Wrong case', 'Other case'), key: 'A' } };
}

// ---------------------------------------------------------------- 1 and 2: the prompt file and a whole session through the model service
async function sessionTests() {
  const ok = [];
  const dir = tmp('kartotek-f4-models-');
  const w = loadEngine();
  try {
    const KL = w.KLive, KPl = w.KPlan;
    const prompts = createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: dir });
    const calls = [];
    let respond = null;
    const fake = (cfg) => ({ kind: 'api', cfg, capabilities: () => ({ stream: true, structured: 'native', images: true, webSearch: false }), listModels: async () => [{ id: 'fake-model-1', label: 'Fake' }],
      run: async (req) => { calls.push(req); const json = respond(req, calls.length); return { text: JSON.stringify(json), json, usage: { input: 2000, output: 500, cacheRead: 0, cacheWrite: 0 }, model: 'fake-model-1', stopReason: 'end_turn', costKind: 'api' }; } });
    const S = createModelService({ dir, now: () => NOW, encrypt: fakeEncrypt, decrypt: fakeDecrypt, prompts, adapters: { anthropic: fake, 'openai-compatible': fake, cli: fake } });
    await S.saveProvider({ id: 'claude', kind: 'anthropic', label: 'Fake provider' }, 'sk-test-f4-not-real');
    await S.setSlot('strong', 'claude', 'fake-model-1');
    const ask = async (v) => {
      const p = prompts.render('teacher', v);
      const res = await S.run({ feature: 'teacher', slot: p.slot, messages: [{ role: 'user', content: p.text }], schema: p.schema, promptId: p.promptId, promptVersion: p.promptVersion });
      return { json: res.json, meta: { provider: res.provider, providerLabel: res.providerLabel, model: res.model, costUsd: res.costUsd, costKind: res.costKind }, prompt: { promptId: p.promptId, promptVersion: p.promptVersion } };
    };
    const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('');

    await t(ok, 'the teacher prompt is shipped (version 3, strong slot, strict schema) with the shared fragments before its closing JSON paragraph', () => {
      const l = prompts.list().find((p) => p.id === 'teacher');
      assert.ok(l && l.slot === 'strong' && l.schema && !l.draft && l.version >= 3);
      const r = prompts.render('teacher', { plan: 'P', position: 'X', held: 'H', material: 'M', history: 'none', learner_turn: 'none', task: 'T', problems: 'none' });
      const i = r.text.indexOf('## Voice'), j = r.text.indexOf('## Side conversations'), k = r.text.indexOf('Answer with JSON only');
      assert.ok(i > 0 && j > i && k > j);
      const walk = (s, where) => { if (!s || typeof s !== 'object') return; assert.ok(!s.$ref, where + ': no $ref'); if (s.type === 'object') { assert.strictEqual(s.additionalProperties, false, where); eq((s.required || []).slice().sort(), Object.keys(s.properties || {}).sort(), where); } Object.keys(s.properties || {}).forEach((x) => walk(s.properties[x], where + '.' + x)); if (s.items) walk(s.items, where + '[]'); };
      walk(prompts.get('teacher').schema, 'teacher');
    });

    await t(ok, 'a whole session of ten steps: predict, teach and check, a repair, a missing foundation inserted, the position follows, done only after the goal, the self-report', async () => {
      const { st, s, pkg } = readySession(w);
      const reviews = st.reviews.length;
      let n = 0;
      respond = (req) => { const txt = textOf(req); const task = /\nREPAIR\./.test(txt) || /```text\nREPAIR\./.test(txt) ? 'repair' : /TEACH and CHECK\./.test(txt) ? 'teach' : 'predict'; return teacherReply(w, s, task, ++n); };
      const misses = { n2: 1, n3: 1 };
      const positions = [];
      let guard = 0;
      while (guard++ < 80) {
        const ph = KL.phase(s);
        if (ph === 'review') break;
        const need = KL.needsCall(s);
        if (need) {
          const r = await ask(KL.teacherInputs(s, need, { pkg }));
          assert.deepStrictEqual(validate(prompts.get('teacher').schema, r.json), []);
          const c = KL.checkReply(s, need, r.json, { pkg });
          assert.ok(c.ok, need + ': ' + c.problems.join(' '));
          KL.applyReply(s, need, r.json, { now: NOW + guard, meta: r.meta, prompt: r.prompt, pkg, rng: () => 0.5 });
          if (need === 'predict') positions.push(s.plan.position);
          continue;
        }
        const cur = KL.lastStep(s);
        if (ph === 'answer_predict') KL.answerPredict(s, cur.predict.kind === 'open' ? { text: 'I would try the rule from part 2.', confidence_pct: 55, thinking: 'It looked like the last case.' } : { choice: cur.predict.key, confidence_pct: 70, thinking: 'Guessing from the pattern.' }, NOW + guard);
        else if (ph === 'read') KL.markRead(s, NOW + guard);
        else if (ph === 'answer_check') {
          const a = KL.attemptOf(cur), miss = misses[cur.node] && cur.repairs === 0 && !cur.check.slice(0, -1).length;
          if (miss) misses[cur.node]--;
          KL.answerCheck(s, { choice: miss ? a.options.find((o) => o.id !== a.key).id : a.key, confidence_pct: miss ? 80 : 90, thinking: miss ? 'Applied the other rule.' : 'Applied the step.' }, NOW + guard);
        } else if (ph === 'feedback') KL.continueStep(s, NOW + guard);
        else throw new Error('unexpected phase ' + ph);
      }
      const sum = KL.summary(s);
      assert.strictEqual(KL.phase(s), 'review');
      assert.ok(sum.steps >= 8, 'steps: ' + sum.steps);
      assert.strictEqual(sum.gaps, 1, 'one missing foundation');
      assert.ok(sum.after_repair >= 1 && sum.right_first >= 6, JSON.stringify(sum));
      const v = KPl.currentPlan(s);
      assert.ok(v.reason === 'gap' && v.nodes.some((x) => /^missing-basics/.test(x.id)), 'the gap is a new plan version');
      assert.ok(positions.some((p) => /^missing-basics/.test(p)), 'the position moved to the missing foundation');
      assert.ok(positions.indexOf('goal-k9') > positions.lastIndexOf('n3'), 'the goal comes after n3');
      const map = KPl.liveMap(s);
      assert.ok(map.nodes.filter((x) => x.status === 'taught').length >= 4, 'taught nodes are drawn as taught');
      // the transcript: every answer has its confidence and thinking; every model turn its generator
      s.steps.forEach((x) => {
        assert.ok(x.predict.answer && x.predict.answer.thinking && x.predict.answer.confidence_pct != null, 'step ' + x.n + ' prediction');
        x.check.forEach((c) => assert.ok(c.answer && c.answer.thinking && c.answer.confidence_pct != null && c.read_at && c.read_at <= c.answer.at, 'step ' + x.n + ' check'));
        x.teach.forEach((tt) => assert.ok(tt.by.model === 'fake-model-1' && tt.origin === 'generated' && tt.validation === 'unverified'));
      });
      assert.ok(s.steps.some((x) => x.predict.kind === 'open') && s.steps.some((x) => x.predict.kind === 'choice'));
      KL.endReport(s, 'yes', NOW + 999);
      assert.ok(s.status === 'done' && s.end.feels_obvious === 'yes' && /Built k9/.test(s.end.summary));
      assert.strictEqual(st.reviews.length, reviews, 'no review event');
      assert.strictEqual(Object.keys(st.cards).length, 0, 'no card');
      const last = textOf(calls[calls.length - 1]);
      assert.ok(/U15 \[slide 15\]: Text of U15/.test(last), 'the material is the study\'s units');
      assert.ok(/thinking: Applied the step\./.test(last), 'the history carries the thinking');
      const usage = fs.readdirSync(dir).filter((f) => /usage/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
      assert.ok(!/Applied the step/.test(usage), 'no learner text in the usage log');
      assert.strictEqual(s.usage.calls, calls.length + s.probe.generator.length, 'the session counts every call, the probe calls too');
    });

    await t(ok, '"Not yet" at the end keeps teaching and tells the teacher so', async () => {
      const { s, pkg } = readySession(w);
      s.status = 'review'; s.end = { at: NOW, summary: 'x', feels_obvious: null };
      KL.endReport(s, 'not_yet', NOW + 1);
      assert.strictEqual(s.status, 'teach');
      assert.ok(/does not feel obviously true yet/.test(KL.teacherInputs(s, 'predict', { pkg }).learner_turn));
      // only the first step after "not yet" carries the note; once a step has been taught after it, the teacher may finish again
      KL.applyReply(s, 'predict', teacherReply(w, s, 'predict', 1), { pkg, now: NOW + 5 });
      KL.answerPredict(s, { text: 'x', confidence_pct: 50 }, NOW + 6);
      KL.applyReply(s, 'teach', teacherReply(w, s, 'teach', 2), { pkg, now: NOW + 7 });
      KL.markRead(s, NOW + 8); KL.answerCheck(s, { choice: KL.attemptOf(KL.lastStep(s)).key, confidence_pct: 90 }, NOW + 9); KL.continueStep(s, NOW + 10);
      assert.ok(!/does not feel obviously true yet/.test(KL.teacherInputs(s, 'predict', { pkg }).learner_turn));
    });
  } finally { w.close(); rm(dir); }
  return ok;
}

// ---------------------------------------------------------------- 3. refusals
async function refusalTests() {
  const ok = [];
  const w = loadEngine();
  try {
    const KL = w.KLive;
    await t(ok, 'refused: a held node, an unknown node, "done" before the goal is checked, a repeated prediction', () => {
      const { s, pkg } = readySession(w);
      const p = teacherReply(w, s, 'predict', 1);
      p.node = 'held-basics';
      assert.ok(/held already/.test(KL.checkReply(s, 'predict', p, { pkg }).problems.join(' ')));
      p.node = 'nowhere';
      assert.ok(/must be a node of the current plan/.test(KL.checkReply(s, 'predict', p, { pkg }).problems.join(' ')));
      assert.ok(/only possible once the goal node/.test(KL.checkReply(s, 'predict', { phase: 'done' }, { pkg }).problems.join(' ')));
      const good = teacherReply(w, s, 'predict', 1);
      KL.applyReply(s, 'predict', good, { pkg, now: NOW });
      KL.answerPredict(s, { text: 'x', confidence_pct: 40 }, NOW);
      KL.applyReply(s, 'teach', teacherReply(w, s, 'teach', 2), { pkg, now: NOW });
      KL.markRead(s, NOW); KL.answerCheck(s, { choice: KL.attemptOf(KL.lastStep(s)).key, confidence_pct: 90 }, NOW); KL.continueStep(s, NOW);
      assert.ok(/already asked/.test(KL.checkReply(s, 'predict', good, { pkg }).problems.join(' ')));
    });
    await t(ok, 'refused: a wall of text, references outside the material, no references, a check that repeats the prediction, banned or duplicate options, a gap outside a repair', () => {
      const { s, pkg } = readySession(w);
      KL.applyReply(s, 'predict', teacherReply(w, s, 'predict', 1), { pkg, now: NOW });
      KL.answerPredict(s, { text: 'x', confidence_pct: 40 }, NOW);
      const r = teacherReply(w, s, 'teach', 2);
      r.teach.md = 'word '.repeat(260);
      r.teach.refs = ['U999'];
      r.check.stem = KL.lastStep(s).predict.stem;
      r.check.options = [{ id: 'A', text: 'Same', wrong_model: '' }, { id: 'B', text: 'same.', wrong_model: '' }, { id: 'C', text: 'None of the above', wrong_model: '' }];
      const all = KL.checkReply(s, 'teach', r, { pkg }).problems.join(' ');
      assert.ok(/260 words/.test(all) && /U999/.test(all) && /repeats an earlier question/.test(all) && /same text/.test(all) && /not allowed/.test(all), all);
      const noRefs = teacherReply(w, s, 'teach', 2); noRefs.teach.refs = [];
      assert.ok(/refs is empty/.test(KL.checkReply(s, 'teach', noRefs, { pkg }).problems.join(' ')));
      const gap = teacherReply(w, s, 'teach', 2); gap.teach.gap = { label: 'x', why: 'y', before: 'n1' };
      assert.ok(/only be reported in a repair/.test(KL.checkReply(s, 'teach', gap, { pkg }).problems.join(' ')));
      assert.ok(KL.checkReply(s, 'teach', teacherReply(w, s, 'teach', 2), { pkg }).ok, 'the good reply passes');
    });
    await t(ok, 'the learner\'s answers are checked: a confidence is needed (or "I don\'t know"), an open prediction needs text, nothing can be answered twice or out of turn', () => {
      const { s, pkg } = readySession(w);
      KL.applyReply(s, 'predict', teacherReply(w, s, 'predict', 1), { pkg, now: NOW });
      assert.throws(() => KL.markRead(s, NOW), /nothing to read/);
      assert.throws(() => KL.answerPredict(s, { text: '', confidence_pct: 50 }, NOW), /Write your prediction/);
      assert.throws(() => KL.answerPredict(s, { text: 'x' }, NOW), /how sure/);
      KL.answerPredict(s, { dont_know: true }, NOW);
      assert.strictEqual(KL.lastStep(s).predict.answer.confidence_pct, null);
      assert.throws(() => KL.answerPredict(s, { text: 'y', confidence_pct: 50 }, NOW), /no open prediction/);
    });
  } finally { w.close(); }
  return ok;
}

// ---------------------------------------------------------------- 4. pause, resume, restart in every phase
async function resumeTests() {
  const ok = [];
  const w = loadEngine();
  try {
    const KL = w.KLive;
    await t(ok, 'a restart in the middle of every phase: the saved session (a JSON round trip) is in the same phase and continues from there', () => {
      const { st, s, pkg } = readySession(w);
      const seen = [];
      const restart = () => { const copy = JSON.parse(JSON.stringify(st)); const n = w.KStore.normalize(copy); return n.sessions[s.id]; };
      const steps = [
        () => KL.applyReply(s, 'predict', teacherReply(w, s, 'predict', 1), { pkg, now: NOW }),
        () => KL.answerPredict(s, { text: 'my idea', confidence_pct: 60, thinking: 'because' }, NOW),
        () => KL.applyReply(s, 'teach', teacherReply(w, s, 'teach', 2), { pkg, now: NOW }),
        () => KL.markRead(s, NOW),
        () => KL.answerCheck(s, { choice: KL.attemptOf(KL.lastStep(s)).options.find((o) => o.id !== KL.attemptOf(KL.lastStep(s)).key).id, confidence_pct: 70, thinking: 'hm' }, NOW),
        () => KL.continueStep(s, NOW),
        () => KL.applyReply(s, 'repair', teacherReply(w, s, 'repair', 3), { pkg, now: NOW }),
      ];
      seen.push(KL.phase(restart()));
      steps.forEach((f) => { f(); const r = restart(); seen.push(KL.phase(r)); assert.strictEqual(KL.phase(r), KL.phase(s)); eq(r.steps, s.steps); });
      eq(seen, ['predict', 'answer_predict', 'teach', 'read', 'answer_check', 'feedback', 'repair', 'read']);
    });
    await t(ok, 'pause and resume: paused keeps the phase, nothing is asked while paused, resume returns to where it was, and every pause is logged', () => {
      const { s, pkg } = readySession(w);
      KL.applyReply(s, 'predict', teacherReply(w, s, 'predict', 1), { pkg, now: NOW });
      KL.pause(s, NOW + 5);
      assert.ok(KL.phase(s) === 'paused' && KL.needsCall(s) === null && s.paused_from === 'teach');
      KL.resume(s, NOW + 9);
      assert.ok(KL.phase(s) === 'answer_predict' && s.pauses.length === 1 && s.pauses[0].resumed_at === NOW + 9);
    });
  } finally { w.close(); }
  return ok;
}

// ---------------------------------------------------------------- 5. own files, research hook, report row
async function filesTests() {
  const ok = [];
  const w = loadEngine();
  const dir = tmp('kartotek-f4-files-');
  try {
    const KL = w.KLive, KPl = w.KPlan;
    await t(ok, 'own files are read locally, cached outside the learner data (names and hashes only in the session), and cited by page label', async () => {
      const src = path.join(dir, 'lecture.txt');
      fs.writeFileSync(src, 'Bandwidth is the range of frequencies a channel passes.\n'.repeat(30) + '\n' + 'Nyquist: a channel of bandwidth B carries at most 2B symbols per second.\n'.repeat(150));
      const lf = createLiveFiles({ dir, extract: require('../desktop/jobs/extract') });
      assert.throws(() => lf.get('../etc'), /Unknown session/);
      const st = w.KStore.emptyState();
      const s = KPl.newSession(st, { goal_words: 'Understand Nyquist', now: NOW });
      const r = await lf.read(s.id, [src]);
      assert.ok(r.files[0].sha256.length === 64 && r.files[0].name === 'lecture.txt' && r.pages >= 2);
      const material = lf.get(s.id);
      assert.ok(material.pages[0].ref === 'S1 section 1' && fs.existsSync(path.join(dir, 'live', s.id, 'material.json')));
      s.files = r.files;
      assert.ok(!JSON.stringify(st).includes('Nyquist: a channel'), 'the file text is not in the learner data');
      // planned and accepted, then one teaching turn cites a page label
      s.probe = { status: 'done', goal: { concrete: 'Nyquist' }, result: { strands: [], asked: 0, closing: '' } };
      s.status = 'plan';
      KPl.addPlanVersion(s, { approach: 'a', nodes: [{ id: 'bw', label: 'Bandwidth', kind: 'learn', depends_on: [], units: [], why: '', mode: 'socratic' }, { id: 'nyq', label: 'Nyquist', kind: 'goal', depends_on: ['bw'], units: [], why: '', mode: 'expository' }], uncertain: [] }, { now: NOW });
      KPl.acceptPlan(s, NOW);
      const inputs = KL.teacherInputs(s, 'predict', { material });
      assert.ok(/\[S1 section \d+\] .*Nyquist/.test(inputs.material) && /cite page labels/.test(inputs.material));
      assert.ok(KL.fileOutline(material).startsWith('Files: S1 = lecture.txt'));
      KL.applyReply(s, 'predict', { phase: 'predict', node: 'bw', question: { kind: 'open', stem: 'What limits a channel?', options: [], key: '', why: '' }, teach: EMPTY_T, check: EMPTY_C, done_summary: '' }, { material, now: NOW });
      KL.answerPredict(s, { text: 'noise', confidence_pct: 30 }, NOW);
      const tr = { phase: 'teach', node: 'bw', question: EMPTY_Q, done_summary: '', teach: { resolves: 'Noise matters too, but here the range of frequencies does.', md: 'Bandwidth is the range a channel passes.', refs: ['S1 section 1'], uncertain: ['Whether the course uses Hz or rad/s'], gap: { label: '', why: '', before: '' } }, check: { stem: 'A channel passes 0-4 kHz. Its bandwidth?', options: opt3('4 kHz', '8 kHz', '2 kHz'), key: 'A' } };
      assert.ok(KL.checkReply(s, 'teach', tr, { material }).ok);
      const bad = plain(tr); bad.teach.refs = ['S2 p. 9'];
      assert.ok(/not in the material/.test(KL.checkReply(s, 'teach', bad, { material }).problems.join(' ')));
      KL.applyReply(s, 'teach', tr, { material, now: NOW });
      // the researcher hook (F7)
      const q = KL.queueResearch(s, 1, 0, 'Whether the course uses Hz or rad/s', NOW);
      assert.ok(q.status === 'queued' && q.refs[0] === 'S1 section 1' && /range a channel passes/.test(q.context));
      assert.strictEqual(KL.queueResearch(s, 1, 0, 'Whether the course uses Hz or rad/s', NOW), q, 'queued once');
      assert.throws(() => KL.queueResearch(s, 1, 0, 'made up', NOW), /No such unsure claim/);
    });
    await t(ok, 'the report of an attached study lists its live sessions as session evidence; the outcome states do not change', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'samples', 'studies', 'sample-cycle-v2', 'etut.json'), 'utf8'));
      const st = w.KStore.emptyState();
      const et = w.KEtut.importPackage(st, pkg, { now: NOW }).etut;
      w.KCycle.migrate(et.progress, et.package);
      const before = w.KCycle.report(st, et, NOW, null).rows.map((r) => r.state);
      const s = KPl.newSession(st, { goal_words: 'x', attached: { etut_id: et.etut_id, topics: [pkg.parts[0].kazanimlar[0].kazanim_id] }, now: NOW });
      s.steps = [{ n: 1, node: 'a', predict: { answer: {}, correct: null }, teach: [{}], check: [{ correct: true }], repairs: 0, outcome: 'right', closed_at: NOW }];
      const rep = w.KCycle.report(st, et, NOW, null);
      assert.ok(rep.process.live.length === 1 && rep.process.live[0].steps === 1 && rep.process.live[0].right_first === 1);
      eq(rep.rows.map((r) => r.state), before);
    });
  } finally { w.close(); rm(dir); }
  return ok;
}

async function run() {
  const out = [];
  for (const [label, fn] of [['Live teaching through the model service (fake provider)', sessionTests], ['Live teaching refusals', refusalTests], ['Live sessions: pause, resume, restart', resumeTests], ['Live sessions: own files, research hook, report', filesTests]]) {
    const ok = await fn();
    out.push(label + ': ' + ok.length + '/' + ok.length + ' passed');
  }
  return out;
}

module.exports = { run };
if (require.main === module) run().then((l) => l.forEach((x) => console.log(x)), (e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
