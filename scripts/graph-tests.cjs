'use strict';
// Tests for task F6: the knowledge graph. No test calls a real service: the extractor answers through the model service with a fake provider.
//  1. Seeding without a model: one proposition per outcome, one chain per relation, ids stable across a package update; the view model
//     (single-premise arrows, implication nodes for joint premises), filters and search; evidence states and memory strength.
//  2. Growth: the transcript of a live session (only steps not yet extracted), nearby records, the extractor through the prompt file and
//     the model service, refusals, review (accept, edit, "same idea as", reject), chains resolved, coverage; notes import.
//  3. Entry points: practice targets from nodes; the probe reads the evidence and starts near the edge.
// With KARTOTEK_BACKUP=<export> and a content folder, the graph of the real studies is built from a copy and counted (read only).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPrompts } = require('../desktop/models/prompts');
const { createModelService } = require('../desktop/models/service');
const { validate } = require('../desktop/models/schema');
const { loadEngine } = require('./study-model-tests.cjs');
const { pkgFixture, learner, runProbe } = require('./probe-tests.cjs');

const root = path.join(__dirname, '..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const NOW = Date.UTC(2026, 10, 19, 9);
const plain = (o) => JSON.parse(JSON.stringify(o));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);
const fakeEncrypt = async (s) => Buffer.from('ENC1' + Buffer.from(s, 'utf8').toString('base64').split('').reverse().join(''));
const fakeDecrypt = async (b) => Buffer.from(b.toString().slice(4).split('').reverse().join(''), 'base64').toString('utf8');
async function t(list, name, fn) { try { await fn(); list.push(name); } catch (e) { e.message = name + ': ' + e.message; throw e; } }

// A state with the fixture study imported as a Study v2 record (progress, a card per topic)
function stateWithStudy(w) {
  const st = w.KStore.emptyState(), pkg = pkgFixture();
  pkg.parts.forEach((p) => p.kazanimlar.forEach((k) => { k.blocks = [{ type: 'text', md: 'Text', refs: k.outcomes.map(() => 'U1') }]; k.recall = { prompt: 'Recall ' + k.kazanim_id + '?', model_answer: 'a', key_points: ['p'] }; }));
  st.etuts.fx = { etut_id: 'fx', package: pkg, progress: w.KCycle.newProgress(), card_map: {} };
  return { st, pkg, et: st.etuts.fx };
}
// A live session with two taught steps (attached to the fixture study)
function liveSession(w, st) {
  const s = w.KPlan.newSession(st, { goal_words: 'Do k9', attached: { etut_id: 'fx', topics: ['k9'] }, now: NOW });
  s.status = 'teach';
  const step = (n, md) => ({ n, node: 'n' + n, at: NOW, predict: { stem: 'What has to give ' + n + '?', kind: 'open', options: [], answer: { text: 'x' } }, teach: [{ md, resolves: 'About it.', refs: ['U17'], uncertain: [] }], check: [{ stem: 'Check ' + n, options: [{ id: 'a', text: 'right ' + n }, { id: 'b', text: 'wrong' }], key: 'a', answer: { choice: 'a' }, correct: true }], repairs: 0, outcome: 'right', closed_at: NOW });
  s.steps = [step(1, 'Topic k9 rests on k2: the idea of k2 gives a rule for k9 cases.'), step(2, 'Combining that rule with k8 gives the full k9 procedure.')];
  return s;
}

// ---------------------------------------------------------------- 1. seeding, view, evidence
async function seedTests() {
  const ok = [];
  const w = loadEngine();
  try {
    const KG = w.KGraph;
    await t(ok, 'the seeded graph: one proposition per outcome with its origin (study, topic, pages), one chain per relation; ids stay stable after a package update', () => {
      const { st, pkg } = stateWithStudy(w);
      const g = KG.build(st, { filter: 'all' });
      assert.strictEqual(g.nodes.length, pkg.outcomes.length);
      const n9 = g.nodes.find((n) => n.id === 'pkg:fx:LO-9');
      assert.ok(n9.study === 'Fixture study' && n9.topic === 'Topic k9' && n9.pages.length === 2 && n9.kind === 'package');
      assert.strictEqual(g.chains.length, pkg.relations.length);
      const before = g.nodes.map((n) => n.id).concat(g.chains.map((c) => c.id));
      // a package update: new version, reworded texts, a new outcome added at the end
      const upd = plain(pkg); upd.version = 2; upd.title = 'Fixture study, second edition';
      upd.outcomes.forEach((o) => { o.performance = o.performance + ' (reworded)'; });
      upd.outcomes.push({ id: 'LO-18', part_id: 'p5', kazanim_id: 'k17', performance: 'New outcome', units: ['U33'], relations: [], criteria: [{ id: 'C-18', text: 'new' }], status: 'covered' });
      st.etuts.fx.package = upd;
      const after = KG.build(st, { filter: 'all' });
      const ids = after.nodes.map((n) => n.id).concat(after.chains.map((c) => c.id));
      assert.ok(before.every((id) => ids.indexOf(id) >= 0), 'every old id is still there');
      assert.ok(ids.indexOf('pkg:fx:LO-18') >= 0);
    });
    await t(ok, 'the view: a single-premise chain is an arrow, joint premises meet in an implication node; filters by study, exam and "mine"; search dims the rest', () => {
      const { st, pkg } = stateWithStudy(w);
      pkg.relations.push({ id: 'R3', from: 'k2 and k5', to: 'k9', type: 'dependency', units: ['U3', 'U9', 'U17'] });
      pkg.outcomes[8].relations.push('R3');
      const g = KG.build(st, { filter: 'all' }), vm = KG.viewModel(g, {});
      const and = vm.nodes.find((n) => n.id === 'and:pkg:fx:R3');
      assert.ok(and && and.small, 'R3 has two premises: an implication node');
      assert.ok(vm.edges.some((e) => e.from === 'pkg:fx:LO-2' && e.to === 'pkg:fx:LO-9' && e.chain === 'pkg:fx:R1'), 'R1: one premise, a direct arrow');
      assert.ok(vm.edges.some((e) => e.to === 'and:pkg:fx:R3') && vm.edges.some((e) => e.from === 'and:pkg:fx:R3' && e.to === 'pkg:fx:LO-9'));
      assert.strictEqual(KG.build(st, { filter: 'study:fx' }).nodes.length, 17);
      assert.strictEqual(KG.build(st, { filter: 'exam:cents' }).nodes.length, 0);
      assert.strictEqual(KG.build(st, { filter: 'mine' }).nodes.length, 0);
      const s = KG.viewModel(g, { search: 'k9' });
      assert.ok(s.nodes.find((n) => n.id === 'pkg:fx:LO-9').match && s.nodes.find((n) => n.id === 'pkg:fx:LO-1').dim);
      KG.hide(st, 'pkg:fx:LO-1');
      assert.ok(!KG.build(st, { filter: 'all' }).nodes.some((n) => n.id === 'pkg:fx:LO-1'));
      KG.unhide(st, 'pkg:fx:LO-1');
    });
    await t(ok, 'each node shows its outcome\'s evidence state (from the outcome report) and its topic card\'s memory strength from the scheduler', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'samples', 'studies', 'sample-cycle-v2', 'etut.json'), 'utf8'));
      const st = w.KStore.emptyState();
      const et = w.KEtut.importPackage(st, pkg, { now: NOW }).etut;
      w.KCycle.migrate(et.progress, et.package);
      const idx = w.KCycle.itemIndex(et.package, null);
      const item = Object.values(idx).find((it) => it.use !== 'final' && (it.validation || 'unverified') === 'verified' && it.format === 'mcq_single');
      const a = w.KCycle.startAttempt(et, item, 'check', NOW);
      w.KCycle.commit(et, a, { choice: item.key.slice(), confidence: 'sure', confidence_pct: 90 }, item, NOW + 1000);
      w.KCycle.send(st, et, a, item, { now: NOW + 1000, settings: st.settings, params: st.params, dayStartHour: 4 });
      const g = w.KGraph.build(st, { filter: 'all' });
      const hit = g.nodes.find((n) => (item.outcomes || []).indexOf(n.outcome_id) >= 0);
      assert.ok(hit.evidence.state === 'independent', 'evidence: ' + hit.evidence.state);
      const withMem = g.nodes.filter((n) => n.memory);
      assert.ok(withMem.length >= 1 && withMem[0].memory.R > 0 && withMem[0].memory.R <= 1, 'memory strength from DSR');
      assert.ok(/memory \d+ %/.test(w.KGraph.viewModel(g, {}).nodes.find((n) => n.id === withMem[0].id).sub));
    });
    const real = process.env.KARTOTEK_BACKUP;
    let contentDir = process.env.KARTOTEK_CONTENT;
    try { if (!contentDir) contentDir = JSON.parse(fs.readFileSync(path.join(root, 'kartotek.config.json'), 'utf8')).contentDir; } catch (e) { /* none */ }
    if (real && contentDir && fs.existsSync(path.join(contentDir, 'studies'))) {
      await t(ok, 'the graph of the real studies (a copy of the backup with the content folder\'s packages): counted, evidence and memory read', () => {
        const file = JSON.parse(fs.readFileSync(real, 'utf8').replace(/^﻿/, ''));
        const st = w.KStore.normalize(plain(file.state || file));
        let attached = 0;
        Object.keys(st.etuts).forEach((id) => {
          const f = path.join(contentDir, 'studies', id, 'etut.json');
          if (!st.etuts[id].package && fs.existsSync(f)) { st.etuts[id].package = JSON.parse(fs.readFileSync(f, 'utf8')); attached++; }
          if (st.etuts[id].progress) w.KCycle.migrate(st.etuts[id].progress, st.etuts[id].package || null);
        });
        const t0 = Date.now(), g = w.KGraph.build(st, { filter: 'all' }), vm = w.KGraph.viewModel(g, {}), ms = Date.now() - t0;
        const states = {};
        g.nodes.forEach((n) => { states[n.evidence.state] = (states[n.evidence.state] || 0) + 1; });
        console.log('  real studies: ' + w.KGraph.studiesOf(st).length + ' Study v2 studies, ' + g.nodes.length + ' propositions, ' + g.chains.length + ' chains, ' + vm.nodes.length + ' nodes and ' + vm.edges.length + ' edges in the view; built in ' + ms + ' ms; evidence ' + JSON.stringify(states) + '; ' + g.nodes.filter((n) => n.memory).length + ' with memory strength');
        assert.ok(g.nodes.length > 0);
      });
    } else console.log('  real studies: not run (set KARTOTEK_BACKUP and have a content folder)');
  } finally { w.close(); }
  return ok;
}

// ---------------------------------------------------------------- 2. growth through the model service
async function growthTests() {
  const ok = [];
  const dir = tmp('kartotek-f6-models-');
  const w = loadEngine();
  try {
    const KG = w.KGraph;
    const prompts = createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: dir });
    let respond = null;
    const calls = [];
    const fake = (cfg) => ({ kind: 'api', cfg, capabilities: () => ({ stream: true, structured: 'native', images: true, webSearch: false }), listModels: async () => [{ id: 'fake-model-1', label: 'Fake' }],
      run: async (req) => { calls.push(req); const json = respond(req); return { text: JSON.stringify(json), json, usage: { input: 3000, output: 600, cacheRead: 0, cacheWrite: 0 }, model: 'fake-model-1', stopReason: 'end_turn', costKind: 'api' }; } });
    const S = createModelService({ dir, now: () => NOW, encrypt: fakeEncrypt, decrypt: fakeDecrypt, prompts, adapters: { anthropic: fake, 'openai-compatible': fake, cli: fake } });
    await S.saveProvider({ id: 'claude', kind: 'anthropic', label: 'Fake provider' }, 'sk-test-f6-not-real');
    await S.setSlot('strong', 'claude', 'fake-model-1');
    const ask = async (v) => { const p = prompts.render('graph-extractor', v); const res = await S.run({ feature: 'graph-extractor', slot: p.slot, messages: [{ role: 'user', content: p.text }], schema: p.schema, promptId: p.promptId, promptVersion: p.promptVersion }); return { json: res.json, meta: { provider: res.provider, providerLabel: res.providerLabel, model: res.model }, prompt: { promptId: p.promptId, promptVersion: p.promptVersion } }; };
    const textOf = (req) => req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('');

    await t(ok, 'the extractor prompt is shipped (version 3, strong slot, strict schema)', () => {
      const l = prompts.list().find((p) => p.id === 'graph-extractor');
      assert.ok(l && l.slot === 'strong' && l.schema && !l.draft && l.version >= 3);
      const walk = (s, where) => { if (!s || typeof s !== 'object') return; if (s.type === 'object') { assert.strictEqual(s.additionalProperties, false, where); eq((s.required || []).slice().sort(), Object.keys(s.properties || {}).sort(), where); } Object.keys(s.properties || {}).forEach((x) => walk(s.properties[x], where + '.' + x)); if (s.items) walk(s.items, where + '[]'); };
      walk(prompts.get('graph-extractor').schema, 'graph-extractor');
    });
    await t(ok, 'extraction of a live session: transcript and nearby records in the request, refusals, review (accept, edit, same idea, reject), chains linked to existing ideas, coverage', async () => {
      const { st } = stateWithStudy(w);
      const s = liveSession(w, st);
      const inp = KG.extractorInputs(st, { session: s });
      eq(inp.turns, ['step 1', 'step 2']);
      assert.ok(/\[step 2\] Teaching: About it\.\nCombining that rule with k8/.test(inp.values.transcript));
      assert.ok(/E\d+ \| Do topic k9/.test(inp.values.nearby) && Object.values(inp.handles).indexOf('pkg:fx:LO-9') >= 0, 'the attached study\'s records are nearby, under short handles');
      const h9 = Object.keys(inp.handles).find((k) => inp.handles[k] === 'pkg:fx:LO-9');
      assert.strictEqual(KG.checkExtraction(st, { propositions: [{ name: 'x', statement: 'A rule for k9.', turn: 'step 1', link_to: h9, related: [], confidence: 'clear' }], chains: [] }, inp).length, 0, 'a handle is accepted and mapped back');
      const reply = { propositions: [
        { name: 'Rule from k2', statement: 'The idea of k2 gives a rule for every k9 case.', turn: 'step 1', link_to: '', related: ['pkg:fx:LO-2', 'pkg:fx:LO-9'], confidence: 'clear' },
        { name: 'k9 procedure', statement: 'Combining the k2 rule with k8 yields the full k9 procedure.', turn: 'step 2', link_to: '', related: ['pkg:fx:LO-9'], confidence: 'clear' },
        { name: 'Doing k9', statement: 'Do topic k9 reliably.', turn: 'step 2', link_to: 'pkg:fx:LO-9', related: [], confidence: 'tentative' },
        { name: 'Session fact', statement: 'The learner now understands k9.', turn: 'step 2', link_to: '', related: [], confidence: 'clear' }],
        chains: [{ premises: ['new:0', 'pkg:fx:LO-8'], conclusion: 'new:1', text: 'The k2 rule with k8 gives the procedure.', turn: 'step 2' },
          { premises: ['pkg:fx:LO-2'], conclusion: 'new:0', text: 'k2 gives the rule.', turn: 'step 1' }] };
      let first = true;
      respond = () => {
        if (first) { first = false; const bad = plain(reply); bad.chains.push({ premises: ['new:9'], conclusion: 'pkg:fx:NOPE', text: '', turn: 'step 7' }); return bad; }
        const good = plain(reply); good.propositions.pop(); return good;
      };
      let problems = [], json = null, r;
      for (let n = 0; n < 2 && !json; n++) {
        r = await ask(KG.extractorInputs(st, { session: s }, { problems }).values);
        assert.deepStrictEqual(validate(prompts.get('graph-extractor').schema, r.json), []);
        const pr = KG.checkExtraction(st, r.json, inp);
        if (!pr.length) json = r.json; else problems = pr;
      }
      assert.ok(problems.some((p) => /about the learner/.test(p)) && problems.some((p) => /new:9/.test(p)) && problems.some((p) => /pkg:fx:NOPE/.test(p)), problems.join(' '));
      assert.ok(/about the learner/.test(textOf(calls[calls.length - 1])), 'the second request lists the failed checks');
      const rec = KG.addProposal(st, { session: s }, json, inp, { now: NOW, meta: r.meta, prompt: r.prompt });
      KG.markExtracted(s, inp.turns, NOW);
      assert.ok(rec.propositions[0].candidates.length >= 1, 'local identity candidates');
      assert.strictEqual(KG.extractorInputs(st, { session: s }).turns.length, 0, 'coverage: the same steps are not extracted again');
      // review: accept 0 edited, accept 1, "same idea" 2 (→ alias on LO-9); chain 0 accepted, chain 1 rejected
      const out = KG.applyReview(st, rec.id, { props: { 0: { action: 'accept', name: 'The k2 rule', statement: 'The idea of k2 gives a rule for every k9 case.' }, 1: { action: 'accept', links: [] }, 2: { action: 'same', same: 'pkg:fx:LO-9' } }, chains: { 0: 'accept', 1: 'reject' } }, NOW);
      eq(KG.graphOf(st).nodes[out.nodes[1]].links, [], 'a link the learner unticked is not saved');
      assert.ok(out.nodes.length === 2 && out.aliases === 1 && out.chains.length === 1, JSON.stringify(out));
      const g = KG.graphOf(st), n0 = g.nodes[out.nodes[0]];
      assert.ok(n0.name === 'The k2 rule' && n0.edited && n0.origin.session === s.id && n0.origin.turn === 'step 1');
      eq(n0.links.sort(), ['pkg:fx:LO-2', 'pkg:fx:LO-9']);
      const ch = g.chains[out.chains[0]];
      eq(ch.premises, [out.nodes[0], 'pkg:fx:LO-8']);
      assert.strictEqual(ch.conclusion, out.nodes[1]);
      eq(g.aliases['pkg:fx:LO-9'], ['Do topic k9 reliably.']);
      assert.ok(g.pending.length === 0 && g.log.length === 1);
      const full = KG.build(st, { filter: 'all' }), vm = KG.viewModel(full, {});
      assert.ok(full.nodes.some((n) => n.kind === 'learner' && n.evidence.state === 'session'));
      assert.ok(vm.nodes.some((n) => /^and:c-/.test(n.id)), 'the accepted two-premise chain is drawn through an implication node');
      assert.ok(vm.edges.some((e) => e.kind === 'related' && e.from === 'pkg:fx:LO-2' && e.to === out.nodes[0]), 'the new node links to an existing one');
      assert.strictEqual(KG.build(st, { filter: 'study:fx' }).nodes.filter((n) => n.kind === 'learner').length, 2, 'linked learner nodes show with their study');
      assert.strictEqual(st.reviews.length, 0, 'nothing reaches the scheduler');
    });
    await t(ok, 'a small model\'s labels: propositions named "new:k" and chains that use those labels are read by label; names come from the statements', () => {
      const j = KG.normalizeExtraction({ propositions: [{ name: 'new:0', statement: 'Axioms: commutativity and more.' }, { name: 'new:4', statement: 'Identity law: X·1 = X.' }, { name: 'new:2', statement: 'Absorption law: X + X·Y = X.' }],
        chains: [{ premises: ['new:4'], conclusion: 'new:2', text: 't' }] });
      eq(j.propositions.map((p) => p.name), ['Axioms', 'Identity law', 'Absorption law']);
      eq(j.chains[0].premises, ['new:1']);
      assert.strictEqual(j.chains[0].conclusion, 'new:2');
      const untouched = KG.normalizeExtraction({ propositions: [{ name: 'A rule', statement: 'x' }], chains: [{ premises: ['new:0'], conclusion: 'pkg:a', text: 't' }] });
      assert.ok(!untouched.repaired && untouched.propositions[0].name === 'A rule');
    });
    await t(ok, 'notes import (D15): the same extractor and review; a chain whose idea was rejected is skipped', async () => {
      const { st } = stateWithStudy(w);
      const notes = { name: 'my notes', text: 'Bandwidth B limits the symbol rate to 2B. With M levels each symbol carries log2 M bits.' };
      const inp = KG.extractorInputs(st, { notes });
      eq(inp.turns, ['notes']);
      respond = () => ({ propositions: [{ name: 'Nyquist rate', statement: 'A channel of bandwidth B carries at most 2B symbols per second.', turn: 'notes', link_to: '', related: [], confidence: 'clear' },
        { name: 'Bits per symbol', statement: 'A symbol with M levels carries log2 M bits.', turn: 'notes', link_to: '', related: [], confidence: 'clear' }],
        chains: [{ premises: ['new:0', 'new:1'], conclusion: 'new:1', text: 'bad', turn: 'notes' }, { premises: ['new:0'], conclusion: 'new:1', text: 'x', turn: 'notes' }] });
      const r = await ask(inp.values);
      const pr = KG.checkExtraction(st, r.json, inp);
      assert.ok(/conclusion is also a premise/.test(pr.join(' ')));
      r.json.chains.shift();
      const rec = KG.addProposal(st, { notes }, r.json, inp, { now: NOW });
      const out = KG.applyReview(st, rec.id, { props: { 0: { action: 'accept' }, 1: { action: 'reject' } }, chains: { 0: 'accept' } }, NOW);
      assert.ok(out.nodes.length === 1 && out.chains.length === 0 && out.skipped.length === 1);
      assert.strictEqual(KG.graphOf(st).nodes[out.nodes[0]].origin.notes, 'my notes');
    });
  } finally { w.close(); rm(dir); }
  return ok;
}

// ---------------------------------------------------------------- 3. entry points
async function entryTests() {
  const ok = [];
  const w = loadEngine();
  try {
    await t(ok, '"Practise these": nodes become practice targets (outcomes with criteria and units; own ideas by their statement)', () => {
      const { st } = stateWithStudy(w);
      const g = w.KGraph.build(st, { filter: 'all' });
      const t1 = w.KGraph.targetOf(st, g.nodes.find((n) => n.id === 'pkg:fx:LO-9'));
      assert.ok(t1.id === 'LO-9' && t1.criteria.length === 1 && t1.units.length === 2 && t1.kid === 'k9');
      const t2 = w.KGraph.targetOf(st, { id: 'g-x', kind: 'learner', name: 'Rule', statement: 'A rule.' });
      assert.ok(t2.id === 'g-x' && /Rule: A rule\./.test(t2.label));
      const s = w.KPractice.newSession(st, { purpose: 'free', etut_id: 'fx', kids: ['k9'], targets: [t1, t2], now: NOW });
      assert.ok(w.KPractice.nextSpec(s).targets.length === 1 && w.KPractice.phase(s) === 'write');
    });
    await t(ok, 'the probe reads the evidence: a topic held in Kartotek counts as held without a question, so the probe starts above it, near the edge', () => {
      const KP = w.KProbe, pkg = pkgFixture();
      const strands = KP.strandsFor(pkg, { kind: 'part', part_id: 'p1' });
      const cold = KP.newProbe({ mode: 'packaged', strands, now: NOW }), warm = KP.newProbe({ mode: 'packaged', strands, now: NOW, known: { k1: 'held', k2: 'held', k3: 'held' } });
      cold.goal.concrete = warm.goal.concrete = 'x';
      assert.strictEqual(KP.recommend(cold).level, 'k3');
      assert.strictEqual(KP.recommend(warm).level, 'k4', 'held k1-k3 from the evidence: the first question is on k4');
      assert.ok(/held by the evidence in Kartotek/.test(KP.proberInputs(warm, { pkg }).strands));
      const { res } = runProbe(w, warm, learner({ p1: 4 }));
      assert.ok(res.strands[0].status === 'held' && res.asked <= 2, 'asked ' + res.asked);
      // and from a real study: topics whose outcomes are all shown without help are "held"
      const { st, et } = stateWithStudy(w);
      eq(w.KGraph.topicEvidence(st, et, null), {});
    });
  } finally { w.close(); }
  return ok;
}

async function run() {
  const out = [];
  for (const [label, fn] of [['Knowledge graph: seeding, view, evidence', seedTests], ['Knowledge graph: growth and review (fake provider)', growthTests], ['Knowledge graph: practice and probe entry points', entryTests]]) {
    const ok = await fn();
    out.push(label + ': ' + ok.length + '/' + ok.length + ' passed');
  }
  return out;
}
module.exports = { run };
if (require.main === module) run().then((l) => l.forEach((x) => console.log(x)), (e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
