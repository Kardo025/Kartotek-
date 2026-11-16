'use strict';
// End-of-lesson tests written in the app (task E3, LESSON-TEST-RULES.md): parts and objectives, then per part the write-from-memory
// item, the test items and the re-test pool (fixed format: 4 options, a correct index, solutions, distractor notes), checked by
// KLesson.validateLesson; correct positions spread evenly; every multiple-choice item solved again without its key.
const fs = require('fs');
const path = require('path');
const { S } = require('./schemas');
const C = require('./common');
const study = require('./study');

const STEPS = [['read', 'Read the sources'], ['transcribe', 'Read page images (vision)'], ['outline', 'Parts and objectives'], ['items', 'Recall, test and re-test items'],
  ['verify', 'Verification (solve without the key)'], ['save', 'Save the draft']];
const TEST_COUNT = { fact: [1, 1], concept: [2, 2], problem: [2, 3] };
const LETTERS = ['a', 'b', 'c', 'd'];

async function prepare(ctx) {
  const r = ctx.request;
  if (!Array.isArray(r.files) || !r.files.length) throw new Error('Choose at least one source file (transcript, notes or slides).');
  ctx.data.sources = await ctx.extract.extractSources(r.files, { imageDir: path.join(ctx.dir, 'pages') });
  ctx.job.title = r.title || ctx.data.sources[0].title;
  ctx.data.id = r.id || C.slug(ctx.job.title) ;
  ctx.plan(STEPS);
  const read = ctx.job.steps.find((s) => s.id === 'read');
  read.status = 'done';
  read.detail = ctx.data.sources.map((s) => s.name + ': ' + s.pages.length + ' ' + (s.unit === 'page' ? 'pages' : s.unit + 's')).join('; ');
}

function estimate(ctx) {
  const chars = ctx.data.sources.reduce((a, s) => a + s.pages.reduce((b, p) => b + (p.text || '').length, 0), 0);
  const O = Math.max(2, Math.min(24, Math.round(chars / 2200))), P = Math.max(1, Math.ceil(O / 4));
  const unreliable = ctx.data.sources.reduce((a, s) => a + s.pages.filter((p) => !p.reliable && p.image).length, 0);
  const rows = [
    { step: 'Page images', slot: 'vision', calls: unreliable, input: unreliable * 2200, output: unreliable * 700 },
    { step: 'Outline', slot: 'strong', calls: 1, input: Math.round(chars / 3) + 1500, output: O * 120 },
    { step: 'Items', slot: 'strong', calls: P, input: P * (Math.round(chars / 3 / P) + 2500), output: O * 5 * 260 },
    { step: 'Verification', slot: 'strong', calls: Math.ceil(O * 5 / 4), input: Math.ceil(O * 5 / 4) * (Math.round(chars / 3) + 800), output: O * 5 * 200 },
  ].map((x) => Object.assign(x, { input: Math.round(x.input * 1.25), output: Math.round(x.output * 1.25) }));
  return { rows: rows.filter((x) => x.calls > 0), note: 'About ' + O + ' objectives expected.' };
}

function assemble(d) {
  return {
    lesson_id: d.id, title: d.title, version: 1, created_at: new Date().toISOString().slice(0, 10),
    sources: d.sources.map((s) => ({ file: s.name, type: s.type === 'transcript' ? 'transcript' : s.type === 'pptx' ? 'slides' : 'notes' })),
    parts: (d.parts || []).map((p) => ({ part_id: p.part_id, title: p.title, refs: p.refs, objectives: p.objectives.map((o) => Object.assign({}, o, (d.objItems || {})[o.objective_id] || { recall: null, items: [] })) })),
  };
}

async function run(ctx) {
  const d = ctx.data, r = ctx.request, L = ctx.limits;
  ctx.plan(STEPS);
  await study.transcribeStep(ctx, d);
  const full = C.sourceText(d.sources);

  await ctx.step('outline', 'Parts and objectives', async (step) => {
    const res = await ctx.task(step, 'outline', 'Parts and objectives', async (task) => (await C.askChecked(ctx, task, { prompt: 'lesson-outline', schema: S.lessonOutline, maxOutputTokens: 6000, feature: 'job:lesson:outline',
      vars: { manifest: C.manifest(d.sources), text: full } }, outlineProblems, L.repairs)).json);
    d.title = r.title || res.title || ctx.job.title;
    ctx.job.title = d.title;
    let o = 0;
    d.parts = res.parts.map((p, i) => ({ part_id: 'p' + (i + 1), title: p.title, refs: p.refs || [], objectives: p.objectives.map((x) => ({ objective_id: 'o' + (++o), kind: x.kind, title: x.title, objective: x.objective, refs: x.refs || [] })) }));
    d.not_covered = res.not_covered || [];
    step.detail = d.parts.length + ' parts, ' + o + ' objectives';
  });

  await ctx.step('items', 'Recall, test and re-test items', async (step) => {
    d.objItems = d.objItems || {};
    for (const p of d.parts) {
      const res = await ctx.task(step, p.part_id, p.title, async (task) => (await C.askChecked(ctx, task, { prompt: 'lesson-items', schema: S.lessonItems, maxOutputTokens: 14000, feature: 'job:lesson:items',
        vars: { lesson: d.title, part: p.title, objectives: p.objectives.map((o) => o.objective_id + ': ' + o.title + ' (' + o.kind + '): ' + o.objective + ' · refs ' + o.refs.join(', ')).join('\n'), text: full } },
      (j) => itemProblems(j, p).concat(lessonCheck(ctx, d, p, j)), L.repairs)).json);
      applyItems(d, p, res);
    }
    const all = allItems(d);
    C.balanceCorrect(all, 4);
    step.detail = all.length + ' multiple-choice items';
  });

  await ctx.step('verify', 'Verification (solve without the key)', async (step) => {
    const items = allItems(d);
    for (let i = 0; i < items.length; i += 4) {
      const batch = items.slice(i, i + 4);
      const out = await ctx.task(step, 'solve-' + (i / 4 + 1), 'Solve ' + batch.map((q) => q.q_id).join(', '), async () => solve(ctx, d, batch, full));
      batch.forEach((q) => verdict(q, (out || {})[q.q_id]));
    }
    // one fix round: a disputed item is re-examined; if the key was wrong it is corrected and solved again
    for (const q of allItems(d).filter((x) => x.validation === 'disputed')) {
      if (L.fixRounds < 1) break;
      const res = await ctx.task(step, 'fix-' + q.q_id, 'Re-examine ' + q.q_id, async () => fix(ctx, q, full));
      if (res && res.correct != null && res.correct !== q.correct) { q.correct = res.correct; q.solution = res.solution || q.solution; q.distractor_notes = res.notes || q.distractor_notes; }
      if (res && res.recheck) {
        const out = await ctx.task(step, 'resolve-' + q.q_id, 'Solve ' + q.q_id + ' again', async () => solve(ctx, d, [q], full));
        verdict(q, (out || {})[q.q_id], res.note);
      }
    }
    const all = allItems(d);
    step.detail = all.filter((q) => q.validation === 'verified').length + ' verified, ' + all.filter((q) => q.validation === 'disputed').length + ' disputed (of ' + all.length + ')';
  });

  let result = null;
  await ctx.step('save', 'Save the draft', async (step) => { result = save(ctx, d); step.detail = result.where; });
  return result;
}

function outlineProblems(j) {
  const p = [];
  if (!j.parts.length) p.push('Write at least one part.');
  j.parts.forEach((pt, i) => {
    if (pt.objectives.length < 1) p.push('Part ' + (i + 1) + ' has no objectives.');
    if (pt.objectives.length > 6) p.push('Part ' + (i + 1) + ' has ' + pt.objectives.length + ' objectives; use 2–6 per part (split the part).');
    pt.objectives.forEach((o, k) => {
      if (!o.refs.length) p.push('Part ' + (i + 1) + ' objective ' + (k + 1) + ': give refs (where it is in the sources).');
      if (!/^without notes/i.test(o.objective.trim())) p.push('Part ' + (i + 1) + ' objective ' + (k + 1) + ': the objective starts "Without notes, …".');
    });
  });
  return p;
}
function itemProblems(j, part) {
  const p = [];
  const want = part.objectives.map((o) => o.objective_id);
  const got = (j.objectives || []).map((o) => o.ref);
  want.forEach((id) => { if (got.indexOf(id) < 0) p.push('Objective ' + id + ' is missing; write its recall item and its items.'); });
  (j.objectives || []).forEach((o) => {
    const obj = part.objectives.find((x) => x.objective_id === o.ref);
    if (!obj) { p.push('Unknown objective ref ' + o.ref + ' (use: ' + want.join(', ') + ').'); return; }
    if (!o.recall.prompt || !o.recall.model_answer || !(o.recall.key_points || []).length) p.push(o.ref + ': the recall item needs a prompt, a model answer and 2–4 key points.');
    const tests = o.items.filter((q) => q.role === 'test').length, retests = o.items.filter((q) => q.role === 'retest').length;
    const [lo, hi] = TEST_COUNT[obj.kind] || [1, 3];
    if (tests < lo || tests > hi) p.push(o.ref + ' (' + obj.kind + '): write ' + (lo === hi ? lo : lo + '–' + hi) + ' test item' + (hi > 1 ? 's' : '') + ' (you wrote ' + tests + ').');
    if (retests < 2 || retests > 3) p.push(o.ref + ': write 2–3 retest items (you wrote ' + retests + ').');
    o.items.forEach((q, k) => {
      const at = o.ref + ' item ' + (k + 1);
      if (q.options.length !== 4) p.push(at + ': exactly 4 options.');
      if (!(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4)) p.push(at + ': correct must be 0, 1, 2 or 3.');
      if (q.distractor_notes.length !== 4) p.push(at + ': distractor_notes has 4 entries.');
      else if (!/^correct/i.test(String(q.distractor_notes[q.correct] || '').trim())) p.push(at + ': the note at the correct index starts with "Correct".');
      if (/all of the above|none of the above/i.test(q.options.join(' '))) p.push(at + ': no "all/none of the above".');
      if (!q.solution) p.push(at + ': write the solution.');
    });
  });
  return p;
}
function applyItems(d, part, j) {
  (j.objectives || []).forEach((o) => {
    const obj = part.objectives.find((x) => x.objective_id === o.ref);
    if (!obj) return;
    let t = 0, rt = 0;
    d.objItems[o.ref] = {
      recall: { prompt: o.recall.prompt, model_answer: o.recall.model_answer, key_points: o.recall.key_points },
      items: o.items.map((q) => ({ q_id: o.ref + '-' + (q.role === 'test' ? 't' + (++t) : 'r' + (++rt)), role: q.role, level: q.level, stem: q.stem, options: q.options.slice(0, 4), correct: q.correct, solution: q.solution, distractor_notes: q.distractor_notes.slice(0, 4), validation: 'unverified' })),
    };
  });
}
function lessonCheck(ctx, d, part, j) {
  const dd = Object.assign({}, d, { objItems: Object.assign({}, d.objItems) });
  try { applyItems(dd, part, j); } catch (e) { return []; }
  const pi = d.parts.indexOf(part) + 1;
  return ctx.checks.lessonValidate(assemble(dd)).filter((m) => m.indexOf('Part ' + pi + ' ') === 0 || m.indexOf('Part ' + pi + ':') === 0);
}
function allItems(d) { return Object.values(d.objItems || {}).reduce((a, o) => a.concat(o.items), []); }

async function solve(ctx, d, items, full) {
  const r = await ctx.ask({ prompt: 'item-solve', schema: S.solve, maxOutputTokens: 6000, feature: 'job:verify:solve', effort: 'high',
    vars: { items: JSON.stringify(items.map((q) => ({ ref: q.q_id, format: 'mcq_single', stem: q.stem, options: q.options.map((o, i) => ({ id: LETTERS[i], md: o })) })), null, 1), conventions: '(none)', text: full } });
  const out = {};
  ((r.json && r.json.answers) || []).forEach((a) => { out[a.ref] = a; });
  return out;
}
function verdict(q, ans, note) {
  const choice = ans && (ans.choice || [])[0];
  const idx = LETTERS.indexOf(String(choice || '').trim());
  if (ans && ans.confidence !== 'cannot_solve' && idx === q.correct && (ans.choice || []).length === 1) { q.validation = 'verified'; q.validation_note = 'Solved again without the key; the answer matched.' + (note ? ' ' + note : ''); }
  else { q.validation = 'disputed'; q.validation_note = 'The independent solution did not match (it chose ' + (idx >= 0 ? q.options[idx] : 'nothing') + ').' + (ans && ans.reasoning ? ' Solver: ' + String(ans.reasoning).slice(0, 300) : '') + (note ? ' ' + note : ''); }
}
async function fix(ctx, q, full) {
  const raw = { format: 'mcq_single', performance: 'identify', difficulty: 'medium', origin: 'generated', source_ref: '', units: [], criteria: ['C-1'], integrates: [], stem: q.stem,
    options: q.options.map((o, i) => ({ id: LETTERS[i], md: o })), key: [LETTERS[q.correct]], option_notes: q.distractor_notes.map((n, i) => ({ id: LETTERS[i], note: n })),
    numeric: { value: 0, tol: 0, unit: '' }, rubric: { criteria: [], accept: [], contradictions: [], model: '' }, hints: [], steps: [], solution: q.solution };
  const r = await ctx.ask({ prompt: 'item-fix', schema: S.fix, maxOutputTokens: 4000, feature: 'job:verify:fix', effort: 'high', vars: { item: JSON.stringify(raw, null, 1), dispute: q.validation_note, text: full } });
  const j = r.json;
  if (!j) return null;
  if (j.verdict === 'item_fixed' && j.item && j.item.options && j.item.options.length === 4 && (j.item.key || []).length === 1) {
    const ids = j.item.options.map((o) => o.id);
    const k = ids.indexOf(j.item.key[0]);
    if (k < 0) return { recheck: false };
    q.stem = j.item.stem; q.options = j.item.options.map((o) => o.md);
    const notes = ids.map((id) => ((j.item.option_notes || []).find((n) => n.id === id) || {}).note || '');
    return { recheck: true, correct: k, solution: j.item.solution, notes, note: 'Rewritten after the dispute: ' + String(j.note || '').slice(0, 200) };
  }
  if (j.verdict === 'key_correct') return { recheck: true, note: 'Re-examined: the key was judged correct.' };
  return { recheck: false };
}

function save(ctx, d) {
  const pkg = assemble(d);
  const all = allItems(d);
  pkg.generated_by = { app: 'Kartotek', job: ctx.job.id, kind: 'lesson', created_at: new Date(ctx.now()).toISOString(),
    writers: Object.keys(ctx.job.writers || {}).map((w) => ({ writer: w, calls: ctx.job.writers[w] })),
    verification: { verified: all.filter((q) => q.validation === 'verified').length, disputed: all.filter((q) => q.validation === 'disputed').length, items: all.length } };
  const errors = ctx.checks.lessonValidate(pkg);
  const text = JSON.stringify(pkg, null, 1);
  fs.writeFileSync(path.join(ctx.dir, 'lesson.json'), text);
  const base = { lesson_id: pkg.lesson_id, title: pkg.title, errors: errors.slice(0, 40), verification: pkg.generated_by.verification };
  const contentDir = ctx.content && ctx.content.dir();
  if (errors.length) return Object.assign(base, { saved: false, where: 'Not saved to the content folder: ' + errors.length + ' problems remain. The draft is in the job folder.' });
  if (!contentDir) return Object.assign(base, { saved: false, where: 'No content folder is set. The draft is in the job folder.' });
  const folder = path.join(contentDir, 'lessons', pkg.lesson_id);
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, 'lesson.json');
  if (fs.existsSync(target)) fs.copyFileSync(target, path.join(folder, 'lesson.before-' + ctx.job.id + '.json'));
  fs.writeFileSync(target + '.tmp', text); fs.renameSync(target + '.tmp', target);
  fs.writeFileSync(path.join(folder, 'source.md'), '# ' + pkg.title + '\n\n' + C.sourceText(d.sources) + '\n\n## Not covered\n\n' + (d.not_covered || []).map((x) => '- ' + x).join('\n') + '\n');
  return Object.assign(base, { saved: true, where: 'lessons\\' + pkg.lesson_id + '\\lesson.json in the content folder' });
}

module.exports = { prepare, estimate, run, assemble };
