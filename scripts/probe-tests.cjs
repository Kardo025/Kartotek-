'use strict';
// Tests for task F3: the probe (Find my level), the plan map and live sessions. No test calls a real service: the prober and the planner
// answer through the model service with a fake provider, and a scripted learner answers the questions.
//  1. Strands and seeding from a package; the question-selection loop (bracketing rules, allowed targets, inference, budget).
//  2. The result per strand for several learners, each found in fewer than 15 questions; grading in code; refusals of bad questions.
//  3. The whole loop through the prompt file and the model service (fake provider), retry with the failed checks, no learner text in the log.
//  4. The packaged plan map: colours from the probe, skipping only what is held (counts complete, stays in the final test), gap found.
//  5. Live sessions: the planner's map checked, versions kept, accept, change request, a gap inserted; the store containers and counts.
// With KARTOTEK_BACKUP=<path to a real export> step 5 also normalises a copy of that file (read only, in memory).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPrompts } = require('../desktop/models/prompts');
const { createModelService } = require('../desktop/models/service');
const { validate } = require('../desktop/models/schema');
const { loadEngine } = require('./study-model-tests.cjs');

const root = path.join(__dirname, '..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const NOW = Date.UTC(2026, 10, 16, 9);
const plain = (o) => JSON.parse(JSON.stringify(o));
// values from the engine's window are another realm's objects: compare them as plain JSON
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const fakeEncrypt = async (s) => Buffer.from('ENC1' + Buffer.from(s, 'utf8').toString('base64').split('').reverse().join(''));
const fakeDecrypt = async (b) => Buffer.from(b.toString().slice(4).split('').reverse().join(''), 'base64').toString('utf8');
async function t(list, name, fn) { try { await fn(); list.push(name); } catch (e) { e.message = name + ': ' + e.message; throw e; } }

// A synthetic Study v2 package: 5 parts in a prerequisite chain (p4 also needs p2), 3-4 topics each, one relation across parts
function pkgFixture() {
  const parts = [], outcomes = [], units = [];
  const sizes = [4, 3, 4, 3, 3];
  let n = 0, u = 0;
  sizes.forEach((size, pi) => {
    const pid = 'p' + (pi + 1), ks = [];
    for (let ti = 0; ti < size; ti++) {
      n++;
      const kid = 'k' + n;
      const myUnits = ['U' + (++u), 'U' + (++u)];
      myUnits.forEach((id) => units.push({ id, source: 'S1', loc: 'slide ' + id.slice(1), type: 'definition', text: 'Text of ' + id + ' about topic ' + kid + '.', disposition: 'included' }));
      outcomes.push({ id: 'LO-' + n, part_id: pid, kazanim_id: kid, object: 'concept', performance: 'Do topic ' + kid + '.', units: myUnits, relations: [], criteria: [{ id: 'C-' + n, text: 'Can do ' + kid + '.' }], status: 'covered' });
      ks.push({ kazanim_id: kid, title: 'Topic ' + kid, outcomes: ['LO-' + n] });
    }
    parts.push({ part_id: pid, title: 'Part ' + (pi + 1) + ' title', prerequisites: pi === 0 ? [] : pi === 3 ? ['p2', 'p3'] : ['p' + pi], kazanimlar: ks });
  });
  // R1: U3 (k2, part 1) relates to U17 (k9, part 3), listed by LO-9; R2 only covers LO-5's units (a self-link)
  outcomes[8].relations = ['R1'];
  outcomes[4].relations = ['R2'];
  const relations = [
    { id: 'R1', from: 'idea of k2', to: 'idea of k9', type: 'dependency', units: ['U3', 'U17'] },
    { id: 'R2', from: 'a', to: 'b', type: 'comparative', units: ['U9'] },
  ];
  return { etut_id: 'fx', title: 'Fixture study', schema_version: 2, workflow: 'cycle-v2', units, outcomes, relations, parts, final_test: [] };
}

// A scripted learner: per strand, how many levels from the bottom they hold, and how sure they are
function learner(profile, opts) {
  const o = opts || {};
  return (p, q, KP) => {
    const s = p.strands.find((x) => x.id === q.strand), L = s.levels.findIndex((l) => l.id === q.level);
    const knows = L < (profile[q.strand] == null ? s.levels.length : profile[q.strand]);
    if (!knows && o.dontKnow) return { dont_know: true };
    const wrong = q.options.find((x) => x.id !== q.key).id;
    return knows ? { choice: q.key, confidence_pct: o.sure == null ? 85 : o.sure, thinking: 'I worked it out.' } : { choice: wrong, confidence_pct: o.wrongConf == null ? 30 : o.wrongConf, thinking: 'Not sure, guessed.' };
  };
}
// The prober as a fake model would answer when it follows the recommendation
function followReply(KP, p, n) {
  const ph = KP.phase(p);
  if (ph === 'goal') return { kind: 'goal_question', goal_concrete: '', goal_question: { stem: 'What do you need most?', options: ['Solve the exam problems', 'Explain the ideas'] }, strands: [], question: emptyQ(), last_answer: { misconception: '', note: '' } };
  if (ph === 'strands') return { kind: 'strands', goal_concrete: '', goal_question: { stem: '', options: [] }, strands: [{ id: 'basics', label: 'Basics', levels: ['one', 'two', 'three'] }, { id: 'advanced', label: 'Advanced', levels: ['four', 'five', 'six', 'seven'] }], question: emptyQ(), last_answer: { misconception: '', note: '' } };
  const r = KP.recommend(p);
  return { kind: 'question', goal_concrete: '', goal_question: { stem: '', options: [] }, strands: [],
    question: { strand: r.strand, level: r.level, intent: r.intent, stem: 'Question ' + n + ' on ' + r.level + ' (' + r.intent + ')?', options: [{ id: 'A', text: 'The right one', wrong_model: '' }, { id: 'B', text: 'Wrong because of model B', wrong_model: 'confuses B' }, { id: 'C', text: 'Wrong because of model C', wrong_model: 'confuses C' }], key: 'A', why: r.why, difficulty: 3 },
    last_answer: { misconception: '', note: 'noted' } };
}
const emptyQ = () => ({ strand: '', level: '', intent: 'probe', stem: '', options: [], key: '', why: '', difficulty: 1 });
// Runs a probe without a model: the reply comes from followReply, the answers from the learner. → { p, res }
function runProbe(w, p, answer, max) {
  const KP = w.KProbe;
  let n = 0, rng = () => 0.37;
  while (n++ < (max || 40)) {
    const ph = KP.phase(p);
    if (ph === 'done') break;
    const json = followReply(KP, p, n);
    const c = KP.checkReply(p, json);
    assert.ok(c.ok, 'the following reply is accepted: ' + c.problems.join(' '));
    const q = KP.applyReply(p, json, { now: NOW + n, rng });
    if (json.kind === 'goal_question') KP.answerGoal(p, q.id, { choice: 0 }, NOW + n);
    else if (json.kind === 'question') KP.answer(p, q.id, answer(p, q, KP), NOW + n);
  }
  return { p, res: KP.finish(p, NOW + 100) };
}

// ---------------------------------------------------------------- 1. strands, seeding, the selection loop
async function engineTests() {
  const ok = [];
  const w = loadEngine();
  try {
    const KP = w.KProbe, KG = w.KGraph, pkg = pkgFixture();
    await t(ok, 'seeding: one proposition per outcome, one chain per relation (conclusion = the listing outcome, premises = other covering outcomes, else a self-link)', () => {
      const g = KG.seed(pkg);
      assert.strictEqual(g.nodes.length, pkg.outcomes.length);
      assert.strictEqual(g.nodes[0].id, 'pkg:fx:LO-1');
      assert.strictEqual(g.nodes[0].statement, 'Can do k1.');
      const r1 = g.chains.find((c) => c.relation_id === 'R1'), r2 = g.chains.find((c) => c.relation_id === 'R2');
      assert.strictEqual(r1.conclusion, 'pkg:fx:LO-9');
      eq(plain(r1.premises), ['pkg:fx:LO-2']);
      assert.ok(r2.self && r2.premises.length === 0 && r2.conclusion === 'pkg:fx:LO-5');
    });
    await t(ok, 'the topic map: order edges inside a part, prerequisite edges between parts, related edges from relations', () => {
      const m = KG.topicMap(pkg);
      assert.strictEqual(m.nodes.length, 17);
      assert.ok(m.edges.some((e) => e.from === 'k1' && e.to === 'k2' && e.kind === 'order'));
      assert.ok(m.edges.some((e) => e.from === 'k4' && e.to === 'k5' && e.kind === 'prereq'));
      assert.ok(m.edges.some((e) => e.from === 'k2' && e.to === 'k9' && e.kind === 'related'));
      eq(plain(KG.dependsOn(pkg, 'k5').sort()), ['k1', 'k2', 'k3', 'k4']);
    });
    await t(ok, 'strands: parts in prerequisite order, topics as levels, prerequisites and relations as "builds on"; scopes cut what is probed', () => {
      const all = KP.strandsFor(pkg, { kind: 'study' });
      eq(all.map((s) => s.id), ['p1', 'p2', 'p3', 'p4', 'p5']);
      eq(all[0].levels.map((l) => l.id), ['k1', 'k2', 'k3', 'k4']);
      eq(plain(all[2].after.sort()), ['p1', 'p2'], 'p3 builds on p2 and, through R1, on p1');
      eq(plain(all[3].after.sort()), ['p2', 'p3']);
      assert.ok(/Do topic k1\. Criteria: Can do k1\./.test(all[0].levels[0].detail));
      eq(KP.strandsFor(pkg, { kind: 'part', part_id: 'p3' }).map((s) => s.id), ['p1', 'p2', 'p3']);
      const tp = KP.strandsFor(pkg, { kind: 'topics', kids: ['k9'] });
      eq(tp.map((s) => s.id + ':' + s.levels.length), ['p1:4', 'p2:3', 'p3:2'], 'the chosen topic\'s part only up to that topic');
    });
    await t(ok, 'the bracketing rules: enter near the top; confident right jumps; hesitant right steps; a miss narrows down; a confident miss digs once; a low-confidence right is confirmed', () => {
      const p = KP.newProbe({ mode: 'packaged', strands: KP.strandsFor(pkg, { kind: 'part', part_id: 'p1' }), now: NOW });
      p.goal.concrete = 'x';
      const ask = (level, ans, intent) => {
        const r = KP.recommend(p);
        assert.strictEqual(r.level, level, 'recommended ' + r.level + ' (' + r.why + ')');
        if (intent) assert.strictEqual(r.intent, intent);
        const q = KP.applyReply(p, { kind: 'question', goal_concrete: '', goal_question: { stem: '', options: [] }, strands: [], question: { strand: r.strand, level: r.level, intent: r.intent, stem: 'S' + p.questions.length, options: [{ id: 'A', text: 'a', wrong_model: '' }, { id: 'B', text: 'b', wrong_model: 'm' }], key: 'A', why: '', difficulty: 2 }, last_answer: { misconception: '', note: '' } }, { now: NOW, rng: () => 0.9 });
        KP.answer(p, q.id, ans === 'right-low' ? { choice: q.key, confidence_pct: 20 } : ans === 'right' ? { choice: q.key, confidence_pct: 60 } : ans === 'wrong-sure' ? { choice: q.options.find((o) => o.id !== q.key).id, confidence_pct: 90 } : { choice: q.options.find((o) => o.id !== q.key).id, confidence_pct: 30 }, NOW);
      };
      ask('k3', 'right-low');              // 4 levels: round(3 * 0.75) = 2 → k3
      ask('k3', 'right', 'confirm');       // a lucky-looking right answer is confirmed at the same level
      ask('k4', 'wrong-sure');             // held k3 (two right answers): hesitant → one step up
      ask('k4', 'wrong', 'dig');           // a confident miss: once more at the same level
      assert.strictEqual(KP.recommend(p), null, 'p1 located: held up to k3, first miss k4');
      assert.ok(KP.bracket(p, p.strands[0]).located);
      const res = KP.result(p).strands[0];
      assert.strictEqual(res.held_up_to.id, 'k3'); assert.strictEqual(res.first_miss.id, 'k4'); assert.strictEqual(res.status, 'edge');
      assert.strictEqual(res.misconceptions.length, 1, 'the confident miss is listed as a misunderstanding');
    });
    await t(ok, 'never inside bracketed territory: the allowed targets shrink with every answer and a refused target is named', () => {
      const p = KP.newProbe({ mode: 'packaged', strands: KP.strandsFor(pkg, { kind: 'part', part_id: 'p1' }), now: NOW });
      p.goal.concrete = 'x';
      eq(KP.allowedTargets(p).map((x) => x.level), ['k1', 'k2', 'k3', 'k4']);
      const q = KP.applyReply(p, followReply(KP, p, 1), { now: NOW });
      KP.answer(p, q.id, { choice: q.key, confidence_pct: 90 }, NOW);                  // k3 held
      eq(KP.allowedTargets(p).map((x) => x.level), ['k4']);
      const bad = followReply(KP, p, 2); bad.question.level = 'k1';
      const c = KP.checkReply(p, bad);
      assert.ok(!c.ok && /k1 · probe is not allowed/.test(c.problems.join(' ')));
    });
    await t(ok, 'strands inform each other: a strand whose every prerequisite is missing from its first level is inferred missing without a question', () => {
      const { res } = runProbe(w, KP.newProbe({ mode: 'packaged', strands: KP.strandsFor(pkg, { kind: 'study' }), now: NOW }), learner({ p1: 0, p2: 0, p3: 0, p4: 0, p5: 0 }));
      eq(res.strands.map((r) => r.status + (r.inferred ? '*' : '')), ['missing', 'missing*', 'missing*', 'missing*', 'missing*']);
      assert.ok(res.asked <= 4, 'asked ' + res.asked);
    });
    await t(ok, 'the budget: the probe stops at 15 questions (goal questions included) even when strands are still open', () => {
      const p = KP.newProbe({ mode: 'packaged', strands: KP.strandsFor(pkg, { kind: 'study' }), now: NOW, budget: 15 });
      // a learner whose answers keep every strand open as long as possible: right but at 20 % (fragile), then wrong
      const { res } = runProbe(w, p, (pp, q) => (q.intent === 'confirm' ? { choice: q.options.find((o) => o.id !== q.key).id, confidence_pct: 50 } : { choice: q.key, confidence_pct: 20 }), 60);
      assert.ok(res.asked <= 15, 'asked ' + res.asked);
    });
  } finally { w.close(); }
  return ok;
}

// ---------------------------------------------------------------- 2. results per strand, grading, refusals
async function resultTests() {
  const ok = [];
  const w = loadEngine();
  try {
    const KP = w.KProbe, pkg = pkgFixture();
    const cases = [
      ['knows everything', {}, { p1: 'held:k4:-', p2: 'held:k7:-', p3: 'held:k11:-', p4: 'held:k14:-', p5: 'held:k17:-' }],
      ['parts 1-2 held, part 3 up to its second topic, nothing later', { p1: 99, p2: 99, p3: 2, p4: 0, p5: 0 }, { p1: 'held:k4:-', p2: 'held:k7:-', p3: 'edge:k9:k10', p4: 'missing:-:k12', p5: 'missing:-:k15' }],
      ['part 1 held, one topic of every later part', { p1: 99, p2: 1, p3: 1, p4: 1, p5: 1 }, { p1: 'held:k4:-', p2: 'edge:k5:k6', p3: 'edge:k8:k9', p4: 'edge:k12:k13', p5: 'edge:k15:k16' }],
      ['nothing beyond the first topic of part 1', { p1: 1, p2: 0, p3: 0, p4: 0, p5: 0 }, { p1: 'edge:k1:k2', p2: 'missing:-:k5', p3: 'missing:-:k8', p4: 'missing:-:k12', p5: 'missing:-:k15' }],
    ];
    for (const [name, profile, want] of cases) {
      await t(ok, 'result per strand, ' + name + ': located correctly in fewer than 15 questions', () => {
        const { res } = runProbe(w, KP.newProbe({ mode: 'packaged', strands: KP.strandsFor(pkg, { kind: 'study' }), now: NOW }), learner(profile));
        const got = {};
        res.strands.forEach((r) => { got[r.strand] = r.status + ':' + (r.held_up_to ? r.held_up_to.id : '-') + ':' + (r.first_miss ? r.first_miss.id : '-'); });
        eq(got, want);
        assert.ok(res.asked < 15, 'asked ' + res.asked);
        assert.ok(res.complete && res.closing.length > 20);
      });
    }
    await t(ok, '"I don\'t know" is a miss with no confidence, never a misunderstanding; the level map shows held, the edge and what is missing', () => {
      const { p, res } = runProbe(w, KP.newProbe({ mode: 'packaged', strands: KP.strandsFor(pkg, { kind: 'part', part_id: 'p2' }), now: NOW }), learner({ p1: 99, p2: 1 }, { dontKnow: true }));
      const dk = p.questions.filter((q) => q.answer.dont_know);
      assert.ok(dk.length >= 1 && dk.every((q) => q.correct === false && q.answer.confidence_pct === null));
      assert.strictEqual(res.strands[1].misconceptions.length, 0);
      eq(plain(res.levels), { k1: 'held', k2: 'held', k3: 'held', k4: 'held', k5: 'held', k6: 'edge', k7: 'missing' });
    });
    await t(ok, 'a guess is a gap: the model\'s "misconception" is kept only for a wrong answer at 40 % or more; letter prefixes are removed and line breaks kept', () => {
      const p = KP.newProbe({ mode: 'packaged', strands: KP.strandsFor(pkg, { kind: 'study' }), now: NOW });
      p.goal.concrete = 'x';
      // the reply that asks question n+1 carries the model's note about answer n
      const step = (right, conf, mis) => {
        const r = followReply(KP, p, p.questions.length + 1);
        r.question.stem = 'Which table is right (' + p.questions.length + ')?\n\n| A | Y |\n|---|---|\n| 0 | 1 |';
        r.question.options[0].text = 'A. The right one';
        r.last_answer = { misconception: mis, note: 'n' };
        const q = KP.applyReply(p, r, { now: NOW, rng: () => 0.99 });
        KP.answer(p, q.id, { choice: right ? q.key : q.options.find((o) => o.id !== q.key).id, confidence_pct: conf }, NOW);
        return q;
      };
      const q1 = step(false, 20, '');     // k3, a 20 % guess
      step(true, 90, 'Thinks X');         // its reply's note about q1 → not kept as a misconception
      const q3 = step(false, 70, '');     // a 70 % miss
      step(false, 30, 'Thinks Y');        // the dig; its note about q3 → kept
      assert.strictEqual(q1.observation.misconception, '');
      assert.strictEqual(q3.observation.misconception, 'Thinks Y');
      assert.ok(q1.stem.includes('\n| A | Y |') && q1.options.some((o) => o.text === 'The right one'));
    });
    await t(ok, 'grading in code: Kartotek shuffles the options and keeps the key; an answer is graded once against it and cannot change', () => {
      const p = KP.newProbe({ mode: 'packaged', strands: KP.strandsFor(pkg, { kind: 'part', part_id: 'p1' }), now: NOW });
      p.goal.concrete = 'x';
      const json = followReply(KP, p, 1);
      const q = KP.applyReply(p, json, { now: NOW, rng: () => 0 });
      eq(q.options.map((o) => o.id), ['a', 'b', 'c']);
      assert.strictEqual(q.options.find((o) => o.id === q.key).text, 'The right one');
      assert.ok(q.origin === 'generated' && q.validation === 'unverified');
      assert.throws(() => KP.answer(p, q.id, { choice: q.key }, NOW), /confidence/);
      KP.answer(p, q.id, { choice: q.key, confidence_pct: 70 }, NOW);
      assert.strictEqual(q.correct, true);
      assert.throws(() => KP.answer(p, q.id, { choice: 'b', confidence_pct: 70 }, NOW), /already answered/);
    });
    await t(ok, 'bad questions are refused with readable reasons: wrong kind, duplicate or banned options, no key, a repeated stem, "Something else" in the goal', () => {
      const p = KP.newProbe({ mode: 'packaged', strands: KP.strandsFor(pkg, { kind: 'part', part_id: 'p1' }), now: NOW });
      const g = followReply(KP, p, 1);
      g.goal_question.options = ['A thing', 'a thing', 'Something else.'];
      let c = KP.checkReply(p, g);
      assert.ok(/appears twice/.test(c.problems.join(' ')) && /Something else/.test(c.problems.join(' ')));
      assert.ok(/must be "goal_question" or "question"/.test(KP.checkReply(p, { kind: 'strands' }).problems[0]));
      p.goal.concrete = 'x';
      const q = followReply(KP, p, 1);
      q.question.options = [{ id: 'A', text: 'Same', wrong_model: '' }, { id: 'B', text: 'same', wrong_model: '' }, { id: 'C', text: 'All of the above', wrong_model: '' }];
      q.question.key = 'Z';
      c = KP.checkReply(p, q);
      const all = c.problems.join(' ');
      assert.ok(/same text/.test(all) && /not allowed/.test(all) && /key must be/.test(all), all);
      const sym = followReply(KP, p, 1);
      sym.question.options = [{ id: 'A', text: 'A ∧ B', wrong_model: '' }, { id: 'B', text: 'A ∨ B', wrong_model: 'or for and' }, { id: 'C', text: '¬A ∧ B', wrong_model: 'negation' }];
      assert.ok(KP.checkReply(p, sym).ok, 'options that differ only in symbols are different options: ' + KP.checkReply(p, sym).problems.join(' '));
      const good = followReply(KP, p, 1);
      KP.answer(p, KP.applyReply(p, good, { now: NOW }).id, { choice: 'a', confidence_pct: 10 }, NOW);
      const again = followReply(KP, p, 1); again.question.stem = good.question.stem;
      assert.ok(/already asked/.test(KP.checkReply(p, again).problems.join(' ')));
    });
    await t(ok, 'without a model: the self-rating list is stored as a probe with source "self" and gives the same result shape', () => {
      const strands = KP.strandsFor(pkg, { kind: 'part', part_id: 'p2' });
      const p = KP.selfProbe({ mode: 'packaged', strands, scope: { kind: 'part', part_id: 'p2' } }, { k1: 'yes', k2: 'yes', k3: 'yes', k4: 'yes', k5: 'yes', k6: 'no', k7: 'no', bogus: 'maybe' }, NOW);
      assert.strictEqual(p.source, 'self');
      assert.ok(!('bogus' in p.self_ratings));
      eq(p.result.strands.map((r) => r.status), ['held', 'edge']);
      assert.strictEqual(p.result.levels.k6, 'edge');
    });
    await t(ok, 'a free live session: the model proposes the strands (checked), then the probe brackets them', () => {
      const p = KP.newProbe({ mode: 'live', goal_words: 'Understand Fourier series', now: NOW });
      assert.ok(KP.checkStrands([{ id: 'Bad Id', label: '', levels: ['x'] }]).length >= 3);
      const { res } = runProbe(w, p, learner({ basics: 99, advanced: 2 }));
      assert.strictEqual(p.strands_from, 'model');
      assert.strictEqual(p.goal.questions.length, 2, 'a live probe asks up to two goal questions');
      eq(res.strands.map((r) => r.status + ':' + (r.first_miss ? r.first_miss.label : '-')), ['held:-', 'edge:six']);
    });
  } finally { w.close(); }
  return ok;
}

// ---------------------------------------------------------------- 3. through the prompt file and the model service
async function serviceTests() {
  const ok = [];
  const dir = tmp('kartotek-f3-models-');
  const w = loadEngine();
  try {
    const KP = w.KProbe, KPl = w.KPlan, pkg = pkgFixture();
    const prompts = createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: dir });
    const calls = [];
    let respond = null;
    const fake = (cfg) => ({
      kind: 'api', cfg, capabilities: () => ({ stream: true, structured: 'native', images: true, webSearch: false }), listModels: async () => [{ id: 'fake-model-1', label: 'Fake' }],
      run: async (req) => { calls.push(req); const json = respond(req, calls.length); return { text: JSON.stringify(json), json, usage: { input: 1200, output: 400, cacheRead: 0, cacheWrite: 0 }, model: 'fake-model-1', stopReason: 'end_turn', costKind: 'api' }; },
    });
    const S = createModelService({ dir, now: () => NOW, encrypt: fakeEncrypt, decrypt: fakeDecrypt, prompts, adapters: { anthropic: fake, 'openai-compatible': fake, cli: fake } });
    await S.saveProvider({ id: 'claude', kind: 'anthropic', label: 'Fake provider' }, 'sk-test-f3-not-real');
    await S.setSlot('strong', 'claude', 'fake-model-1');
    const ask = async (id, v) => {
      const p = prompts.render(id, v);
      const res = await S.run({ feature: id, slot: p.slot, messages: [{ role: 'user', content: p.text }], schema: p.schema, promptId: p.promptId, promptVersion: p.promptVersion, promptHash: p.promptHash || undefined });
      return { json: res.json, meta: { provider: res.provider, providerLabel: res.providerLabel, model: res.model, costUsd: res.costUsd, costKind: res.costKind }, prompt: { promptId: p.promptId, promptVersion: p.promptVersion, promptHash: p.promptHash } };
    };
    const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('');

    await t(ok, 'prober and planner are shipped prompts with a strict schema each, the strong slot, and the shared fragments composed in (D16)', () => {
      const l = prompts.list();
      ['prober', 'planner'].forEach((id) => {
        const x = l.find((p) => p.id === id);
        assert.ok(x && x.slot === 'strong' && x.schema && !x.draft, id);
      });
      assert.ok(l.some((p) => p.id === 'shared-voice' && p.fragment), 'fragments are listed so they can be edited on their own');
      const r = prompts.render('prober', { goal: 'G', strands: 'S', material: 'M', history: 'H', task: 'T', problems: 'none' });
      const voice = r.text.indexOf('## Voice'), conf = r.text.indexOf('## Confidence'), json = r.text.indexOf('Answer with JSON only');
      assert.ok(voice > 0 && conf > voice && json > conf, 'fragments sit before the closing JSON paragraph');
      assert.ok(r.text.indexOf('## Accuracy') < 0, 'the prober does not include the accuracy fragment (it has no "uncertain" list)');
      assert.ok(prompts.render('planner', { goal: 'G', probe_result: 'P', material: 'M', change_request: 'none', problems: 'none' }).text.indexOf('## Accuracy') > 0);
      prompts.saveOverride('shared-voice', '## Voice\n\nEdited voice.');
      const r2 = prompts.render('prober', { goal: 'G', strands: 'S', material: 'M', history: 'H', task: 'T', problems: 'none' });
      assert.ok(r2.text.includes('Edited voice.') && r2.promptHash, 'an edited fragment is used and marks the prompt as edited');
      prompts.resetOverride('shared-voice');
      const walk = (s, where) => {
        if (!s || typeof s !== 'object') return;
        if (s.type === 'object') { assert.strictEqual(s.additionalProperties, false, where); eq((s.required || []).slice().sort(), Object.keys(s.properties || {}).sort(), where); }
        Object.keys(s.properties || {}).forEach((k) => walk(s.properties[k], where + '.' + k));
        if (s.items) walk(s.items, where + '[]');
      };
      walk(prompts.get('prober').schema, 'prober'); walk(prompts.get('planner').schema, 'planner');
    });
    await t(ok, 'the whole probe through the model service: the request carries the recommendation and the thinking; replies are schema-valid; the result is located', async () => {
      const et = { etut_id: 'fx', package: pkg, progress: w.KCycle.newProgress() };
      const p = KP.newProbe({ mode: 'packaged', scope: { kind: 'study' }, strands: KP.strandsFor(pkg, { kind: 'study' }), etut_id: 'fx', now: NOW });
      KPl.addProbe(et, p);
      const profile = learner({ p1: 99, p2: 99, p3: 2, p4: 0, p5: 0 });
      respond = (req, n) => {
        const txt = textOf(req);
        if (/Make the goal concrete/.test(txt) && KP.phase(p) === 'goal') return followReply(KP, p, n);
        const m = /Recommended target: strand (\S+), level (\S+), intent (\w+)/.exec(txt);
        assert.ok(m, 'the request names the recommended target');
        const r = followReply(KP, p, n);
        assert.strictEqual(r.question.level, m[2]);
        return r;
      };
      let guard = 0;
      while (KP.phase(p) !== 'done' && guard++ < 30) {
        const r = await ask('prober', KP.proberInputs(p, { pkg }));
        eq(validate(prompts.get('prober').schema, r.json), []);
        const q = KP.applyReply(p, r.json, { now: NOW, meta: r.meta, prompt: r.prompt });
        if (r.json.kind === 'goal_question') KP.answerGoal(p, q.id, { choice: 1 }, NOW);
        else KP.answer(p, q.id, profile(p, q, KP), NOW);
      }
      const res = KP.finish(p, NOW + 1);
      assert.strictEqual(res.strands[2].status, 'edge');
      assert.ok(res.asked < 15);
      const last = textOf(calls[calls.length - 1]);
      assert.ok(/Thinking: I worked it out\./.test(last) && /confidence 85 %/.test(last), 'the history carries the confidence and the thinking');
      assert.ok(/U1 \[slide 1\]: Text of U1/.test(last), 'the material is the package\'s units');
      assert.strictEqual(p.generator.length, calls.length);
      assert.ok(p.questions.every((q) => q.by.provider === 'Fake provider' && q.by.model === 'fake-model-1' && q.by.prompt.id === 'prober'));
      const usage = fs.readdirSync(dir).filter((f) => /usage/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
      assert.ok(!/I worked it out/.test(usage), 'no learner text in the usage log');
    });
    await t(ok, 'a refused question is asked again with the failed checks in {{problems}}', async () => {
      const p = KP.newProbe({ mode: 'packaged', strands: KP.strandsFor(pkg, { kind: 'part', part_id: 'p1' }), now: NOW });
      p.goal.concrete = 'x';
      const q0 = KP.applyReply(p, followReply(KP, p, 1), { now: NOW });
      KP.answer(p, q0.id, { choice: q0.key, confidence_pct: 90 }, NOW);
      let n = 0;
      respond = (req) => { n++; const r = followReply(KP, p, 10 + n); if (n === 1) r.question.level = 'k1'; return r; };
      let problems = [], applied = null;
      for (let i = 0; i < 2 && !applied; i++) {
        const r = await ask('prober', KP.proberInputs(p, { pkg, problems }));
        const c = KP.checkReply(p, r.json);
        if (c.ok) applied = KP.applyReply(p, r.json, { now: NOW });
        else problems = c.problems;
      }
      assert.ok(applied && applied.level === 'k4');
      assert.ok(/k1 · probe is not allowed now/.test(textOf(calls[calls.length - 1])), 'the second request lists what failed');
    });
    await t(ok, 'the planner through the model service: its map is checked (cycle, unknown dependency, unknown unit, no goal), versions are kept, a gap is inserted', async () => {
      const st = w.KStore.emptyState();
      const s = KPl.newSession(st, { goal_words: 'Understand topic k9', attached: { etut_id: 'fx', topics: ['k9'] }, now: NOW });
      s.probe = KP.newProbe({ mode: 'live', session_id: s.id, strands: KP.strandsFor(pkg, { kind: 'topics', kids: ['k9'] }), scope: { kind: 'topics', kids: ['k9'] }, now: NOW });
      runProbe(w, s.probe, learner({ p1: 99, p2: 99, p3: 1 }));
      KPl.probeDone(s, NOW);
      assert.strictEqual(s.status, 'plan');
      const units = KPl.unitSet(pkg);
      const bad = { approach: 'A', nodes: [{ id: 'a', label: 'A', kind: 'learn', depends_on: ['b'], units: ['U1'], why: '', mode: 'socratic' }, { id: 'b', label: 'B', kind: 'learn', depends_on: ['a', 'zz'], units: ['U99'], why: '', mode: 'socratic' }], uncertain: [] };
      const pr = KPl.checkPlan(bad, { units }).join(' ');
      assert.ok(/goal/.test(pr) && /"zz"/.test(pr) && /U99/.test(pr), pr);
      const cyc = { approach: 'A', nodes: [{ id: 'a', label: 'A', kind: 'learn', depends_on: ['g'], units: ['U1'], why: '', mode: 'socratic' }, { id: 'g', label: 'G', kind: 'goal', depends_on: ['a'], units: ['U17'], why: '', mode: 'expository' }], uncertain: [] };
      assert.ok(/cycle/.test(KPl.checkPlan(cyc, { units }).join(' ')));
      const good = { approach: 'From what you hold in parts 1 and 2 to k9.', uncertain: ['check U17'], nodes: [
        { id: 'held-basics', label: 'Parts 1 and 2', kind: 'held', depends_on: [], units: [], why: 'held', mode: 'expository' },
        { id: 'idea-k8', label: 'The idea of k8', kind: 'learn', depends_on: ['held-basics'], units: ['U15'], why: 'first miss region', mode: 'socratic' },
        { id: 'goal-k9', label: 'Do k9', kind: 'goal', depends_on: ['idea-k8'], units: ['U17'], why: 'the goal', mode: 'expository' }] };
      respond = (req) => { const txt = textOf(req); assert.ok(/first miss: Topic k9/.test(txt) || /first miss/.test(txt), 'the probe result is in the request'); return good; };
      const r = await ask('planner', KPl.plannerInputs(s, { material: KPl.attachedMaterial(pkg, ['k9']) }));
      eq(KPl.checkPlan(r.json, { units }), []);
      KPl.addPlanVersion(s, r.json, { reason: 'first', meta: r.meta, prompt: r.prompt, now: NOW });
      assert.strictEqual(s.plan.position, 'idea-k8', '"you are here" starts at the first node to learn');
      const changed = plain(good); changed.nodes[1].label = 'The idea of k8, slower';
      respond = (req) => { assert.ok(/slower please/.test(textOf(req)) && /The current map \(version 1\)/.test(textOf(req))); return changed; };
      const r2 = await ask('planner', KPl.plannerInputs(s, { material: '', change_request: 'slower please' }));
      KPl.addPlanVersion(s, r2.json, { reason: 'change', change_request: 'slower please', now: NOW + 1 });
      KPl.acceptPlan(s, NOW + 2);
      assert.strictEqual(s.status, 'teach');
      const id = KPl.insertGap(s, { before: 'goal-k9', label: 'Reading the k9 diagram', why: 'a check showed it is missing' }, NOW + 3);
      assert.strictEqual(s.plan.versions.length, 3, 'every version is kept');
      assert.strictEqual(s.plan.versions[0].nodes[1].label, 'The idea of k8');
      const v3 = KPl.currentPlan(s);
      assert.ok(v3.nodes.find((n) => n.id === 'goal-k9').depends_on.indexOf(id) >= 0 && v3.reason === 'gap' && s.plan.position === id);
      eq(KPl.checkPlan({ approach: 'x', nodes: v3.nodes }, null), []);
      const m = KPl.liveMap(s);
      assert.ok(m.nodes.find((n) => n.id === id).status === 'gap_found' && m.edges.some((e) => e.from === id && e.to === 'goal-k9'));
      assert.ok(s.usage.calls >= 1);
    });
  } finally { w.close(); rm(dir); }
  return ok;
}

// ---------------------------------------------------------------- 4. the packaged plan map, skipping, no scheduler
async function mapTests() {
  const ok = [];
  const w = loadEngine();
  try {
    const KP = w.KProbe, KPl = w.KPlan, K = w.KCycle;
    // the sample study of the repository (one part, two topics) imported as the app does it
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'samples', 'studies', 'sample-cycle-v2', 'etut.json'), 'utf8'));
    const st = w.KStore.emptyState();
    const et = w.KEtut.importPackage(st, pkg, { now: NOW }).etut;
    K.migrate(et.progress, et.package);
    const kids = et.package.parts[0].kazanimlar.map((k) => k.kazanim_id);
    const before = { reviews: st.reviews.length, cards: Object.keys(st.cards).length, mem: JSON.stringify(st.mem) };

    await t(ok, 'before a probe the map shows every topic as not probed, with "you are here" on the current topic', () => {
      const m = KPl.packagedMap(et, null);
      assert.strictEqual(m.nodes.length, kids.length);
      assert.ok(m.nodes.every((n) => n.status === 'open') && !m.probed);
      assert.ok(m.nodes[0].current && m.position === kids[0]);
    });
    await t(ok, 'after a probe: held topics are coloured and can be skipped; a skipped topic counts as complete, next() passes it, and the final test still covers it', () => {
      const p = KP.newProbe({ mode: 'packaged', strands: KP.strandsFor(et.package, { kind: 'study' }), etut_id: et.etut_id, now: NOW });
      KPl.addProbe(et, p);
      runProbe(w, p, learner({ [et.package.parts[0].part_id]: 1 }));
      const m = KPl.packagedMap(et, null);
      eq(m.nodes.map((n) => n.status), ['held', 'edge']);
      assert.ok(KPl.canSkip(et, kids[0]) && !KPl.canSkip(et, kids[1]));
      assert.throws(() => KPl.skip(et, kids[1], NOW), /Only a topic the probe found held/);
      KPl.skip(et, kids[0], NOW);
      assert.ok(K.cycleDone(et, kids[0]) && !K.topicsLeft(et).some((t) => t.kid === kids[0]));
      const blueprint = JSON.stringify(K.blueprint(et.package));
      assert.ok(blueprint.length > 2, 'the final blueprint is computed from the package, untouched by skipping');
      const rep = K.report(st, et, NOW, null);
      const row = rep.rows.find((r) => r.kazanim_id === kids[0]);
      assert.ok(row.skipped && row.probe === 'held' && rep.process.skipped.indexOf(kids[0]) >= 0 && rep.process.probes === 1);
      // next() from the topic before a skipped one goes past it: put the learner on topic 2's Evaluating, then skip... (one part: End opens)
      et.progress.topic = 1; et.progress.stage = 'evaluate';
      K.next(et, NOW);
      assert.ok(K.isEnd(et.progress.stage), 'with topic 1 skipped and topic 2 done, End opens');
      KPl.unskip(et, kids[0]);
      assert.ok(!KPl.isSkipped(et, kids[0]) && et.progress.skip_log.length === 1, 'stopping a skip keeps the record');
    });
    await t(ok, 'the map is redrawn from real evidence: a topic the probe found held whose Applying answers need work shows "gap found"', () => {
      const idx = K.itemIndex(et.package, null);
      const item = Object.values(idx).find((it) => it.use !== 'final' && it.kazanim_id === kids[0] && (it.validation || 'unverified') === 'verified' && it.format === 'mcq_single');
      assert.ok(item, 'the sample has a verified item on topic 1');
      const a = K.startAttempt(et, item, 'practice', NOW);
      const wrong = item.options.find((o) => (item.key || []).indexOf(o.id) < 0).id;
      K.commit(et, a, { choice: [wrong], confidence: 'sure', confidence_pct: 90 }, item, NOW + 10);
      const m = KPl.packagedMap(et, null);
      assert.strictEqual(m.nodes[0].status, 'gap_found');
    });
    await t(ok, 'nothing of the probe reaches the scheduler: no review event, no card, no memory change, and the probe is in the progress as generated material', () => {
      assert.strictEqual(st.reviews.length, before.reviews);
      assert.strictEqual(Object.keys(st.cards).length, before.cards);
      assert.strictEqual(JSON.stringify(st.mem), before.mem);
      assert.ok(et.progress.probes.length === 1 && et.progress.probes[0].questions.every((q) => q.origin === 'generated'));
    });
  } finally { w.close(); }
  return ok;
}

// ---------------------------------------------------------------- 5. the store: containers, counts, migration
async function storeTests() {
  const ok = [];
  const w = loadEngine();
  try {
    const KS = w.KStore;
    await t(ok, 'normalize gives an older save empty sessions and graph containers and changes nothing else; it is idempotent', () => {
      const old = plain(KS.normalize(KS.emptyState()));
      delete old.sessions; delete old.graph;
      const n = plain(KS.normalize(plain(old)));
      Object.keys(old).forEach((k) => assert.strictEqual(JSON.stringify(n[k]), JSON.stringify(old[k]), k));
      eq(Object.keys(n).filter((k) => !(k in old)).sort(), ['graph', 'sessions']);
      eq(n.graph, { nodes: {}, chains: {}, hidden: [] });
      assert.strictEqual(JSON.stringify(KS.normalize(plain(n))), JSON.stringify(n));
      const kept = KS.normalize({ cards: {}, reviews: [], sessions: { 'ls-1': { id: 'ls-1', kind: 'live' } }, graph: { nodes: { g1: { id: 'g1' } } } });
      assert.ok(kept.sessions['ls-1'] && kept.graph.nodes.g1 && Array.isArray(kept.graph.hidden), 'existing records are kept');
    });
    await t(ok, 'the import report counts probes, live sessions and graph records', () => {
      const s = KS.emptyState();
      s.etuts.x = { etut_id: 'x', progress: { v: 'c2', attempts: [], probes: [{ id: 'pr-1' }, { id: 'pr-2' }] } };
      s.sessions = { a: { id: 'a' } }; s.graph = { nodes: { g: {} }, chains: { c: {} }, hidden: [] };
      const c = KS.countRecords(s);
      assert.ok(c.studyProbes === 2 && c.liveSessions === 1 && c.graphRecords === 2);
    });
    const real = process.env.KARTOTEK_BACKUP;
    if (real) {
      await t(ok, 'a copy of the real backup: normalize adds only the two empty containers; every Study v2 progress gains only the empty probe list', () => {
        const file = JSON.parse(fs.readFileSync(real, 'utf8').replace(/^﻿/, ''));
        const state = file.state || file;
        const once = plain(KS.normalize(plain(state)));
        const n = plain(KS.normalize(plain(state)));
        const base = plain(KS.normalize(plain(Object.assign({}, state, { sessions: undefined, graph: undefined }))));
        assert.ok(n.sessions && n.graph && JSON.stringify(n) === JSON.stringify(once));
        Object.keys(state).forEach((k) => { if (k !== 'sessions' && k !== 'graph') assert.strictEqual(JSON.stringify(n[k]), JSON.stringify(base[k]), k); });
        let m = 0;
        Object.keys(n.etuts || {}).forEach((id) => {
          const pr = n.etuts[id].progress;
          if (!pr || pr.v !== 'c2') return;
          const before = plain(pr), after = w.KCycle.migrate(plain(pr), null);
          assert.ok(Array.isArray(after.probes) && after.probes.length === (before.probes || []).length, id);
          m++;
        });
        const c = KS.countRecords(n);
        console.log('  real backup: normalised in memory; ' + m + ' Study v2 progress record(s); probes ' + c.studyProbes + ', live sessions ' + c.liveSessions + ', graph records ' + c.graphRecords);
      });
    } else console.log('  real backup: not run (set KARTOTEK_BACKUP to the path of an export)');
  } finally { w.close(); }
  return ok;
}

async function run() {
  const out = [];
  for (const [label, fn] of [['Probe engine (selection loop)', engineTests], ['Probe results per strand', resultTests], ['Probe and planner (fake provider)', serviceTests], ['Plan map and skipping', mapTests], ['Sessions and graph in the store', storeTests]]) {
    const ok = await fn();
    out.push(label + ': ' + ok.length + '/' + ok.length + ' passed');
  }
  return out;
}

module.exports = { run, pkgFixture, learner, followReply, runProbe };
if (require.main === module) run().then((l) => l.forEach((x) => console.log(x)), (e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
