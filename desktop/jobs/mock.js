'use strict';
// Mock exams written in the app (task E3, MOCK-RULES.md): the exam's sections, question counts, minutes, option count and scoring
// come from the request (the window takes them from KCents); questions are written section by section in batches of up to 10,
// checked by KMock.validateMock, correct positions spread evenly, and every question solved again without its key.
const fs = require('fs');
const path = require('path');
const { S } = require('./schemas');
const C = require('./common');
const study = require('./study');

const STEPS = [['read', 'Read the sources'], ['transcribe', 'Read page images (vision)'], ['sections', 'Questions per section'], ['verify', 'Verification (solve without the key)'], ['save', 'Save the draft']];
const BATCH = 10;

async function prepare(ctx) {
  const r = ctx.request;
  if (!r.exam || !Array.isArray(r.sections) || !r.sections.length) throw new Error('The mock exam needs its exam and sections.');
  const files = (r.files || []).concat(C.uniq(r.sections.reduce((a, s) => a.concat((s.topics || []).map((t) => t.extract).filter(Boolean)), [])));
  ctx.data.sources = files.length ? await ctx.extract.extractSources(files, { imageDir: path.join(ctx.dir, 'pages') }) : [];
  ctx.data.id = r.id; ctx.job.title = r.title || r.id;
  ctx.plan(STEPS);
  const read = ctx.job.steps.find((s) => s.id === 'read');
  read.status = 'done';
  read.detail = ctx.data.sources.length ? ctx.data.sources.map((s) => s.name).join(', ') : 'No source files: the questions follow the syllabus topics.';
}

function estimate(ctx) {
  const n = ctx.request.sections.reduce((a, s) => a + s.questions, 0);
  const calls = ctx.request.sections.reduce((a, s) => a + Math.ceil(s.questions / BATCH), 0);
  const chars = ctx.data.sources.reduce((a, s) => a + s.pages.reduce((b, p) => b + (p.text || '').length, 0), 0);
  const per = Math.min(14000, Math.round(chars / Math.max(1, calls))) / 3;
  return { rows: [
    { step: 'Questions', slot: 'strong', calls: Math.round(calls * 1.2), input: Math.round(calls * (2500 + per) * 1.25), output: Math.round(n * 330 * 1.25) },
    { step: 'Verification', slot: 'strong', calls: Math.ceil(n / 4), input: Math.ceil(n / 4) * 2500, output: n * 220 },
  ], note: n + ' questions in ' + ctx.request.sections.length + ' sections.' };
}

function assemble(d, r) {
  return { mock_id: d.id, exam: r.exam, title: r.title, version: 1, created_at: new Date().toISOString().slice(0, 10), kind: r.past ? 'past_paper' : 'generated', source: r.source || undefined,
    scoring: r.scoring || { correct: 1, wrong: r.exam === 'cents' ? -0.25 : 0, blank: 0 },
    sections: r.sections.map((s) => ({ section_id: s.section_id, name: s.name, minutes: s.minutes, questions: (d.questions || {})[s.section_id] || [] })) };
}

async function run(ctx) {
  const d = ctx.data, r = ctx.request, L = ctx.limits, K = r.options || (r.exam === 'cents' ? 5 : 4);
  ctx.plan(STEPS);
  await study.transcribeStep(ctx, d);
  d.questions = d.questions || {};
  await ctx.step('sections', 'Questions per section', async (step) => {
    for (const s of r.sections) {
      const list = [];
      for (let b = 0; b * BATCH < s.questions; b++) {
        const count = Math.min(BATCH, s.questions - b * BATCH);
        const topics = s.topics || [];
        const files = new Set(topics.map((t) => t.extract && require('path').basename(t.extract)).filter(Boolean));
        const text = d.sources.length ? C.sourceText(d.sources.filter((src) => !files.size || files.has(src.name) || (r.files || []).some((f) => require('path').basename(f) === src.name))).slice(0, 42000) : '(no source pages: write from the syllabus topics, at the level of the real exam)';
        const res = await ctx.task(step, s.section_id + '-' + (b + 1), s.name + (s.questions > BATCH ? ' · batch ' + (b + 1) : ''), async (task) => (await C.askChecked(ctx, task, { prompt: 'mock-section', schema: S.mockQuestions, maxOutputTokens: 14000, feature: 'job:mock:section',
          vars: { exam: r.examLabel || r.exam, section: s.name + ' (' + s.minutes + ' minutes for ' + s.questions + ' questions in the real exam)', count: 'Write exactly ' + count + ' questions, each with exactly ' + K + ' options and one correct option.',
            topics: topics.map((t) => '[' + t.id + '] ' + t.name).join('\n') || '(any topic of this section)', avoid: list.concat((r.avoid || [])).map((q) => '- ' + String(q.stem || q).slice(0, 160)).join('\n') || '(none)',
            mode: r.past ? 'Transcribe the attached past paper exactly as written (stems, options, correct answers when given). If the paper has no key, solve every question and say so in the solution.' : 'Write new questions. Mostly application questions, a few harder ones; no trick questions. ' + (s.section_id === 'read' ? 'Reading: write original B2-level English texts (non-fiction, literary or journalistic) in "passage", 2–3 questions per text sharing a "passage_id"; use item_id "rc-1".' : 'Leave "passage" and "passage_id" empty.'),
            text } },
        (j) => questionProblems(j, count, K, topics, s.section_id), L.repairs)).json);
        res.questions.forEach((q) => list.push(q));
      }
      d.questions[s.section_id] = list.map((q, i) => {
        const out = { q_id: s.section_id + '-' + (i + 1), stem: q.stem, options: q.options.slice(0, K), correct: q.correct, solution: q.solution, validation: 'unverified' };
        if (q.item_id) out.item_id = q.item_id;
        if (q.passage_id) { out.passage_id = q.passage_id; if (q.passage) out.passage = q.passage; }
        if ((q.refs || []).length) out.refs = q.refs;
        return out;
      });
    }
    const all = allQ(d, r);
    C.balanceCorrect(all, K);
    const errs = ctx.checks.mockValidate(assemble(d, r));
    if (errs.length) ctx.log('warn', 'KMock.validateMock: ' + errs.slice(0, 5).join('; '));
    step.detail = all.length + ' questions';
  });

  await ctx.step('verify', 'Verification (solve without the key)', async (step) => {
    const all = allQ(d, r);
    for (let i = 0; i < all.length; i += 4) {
      const batch = all.slice(i, i + 4);
      const out = await ctx.task(step, 'solve-' + (i / 4 + 1), 'Solve ' + batch.map((q) => q.q_id).join(', '), async () => {
        const res = await ctx.ask({ prompt: 'item-solve', schema: S.solve, maxOutputTokens: 6000, feature: 'job:verify:solve', effort: 'high',
          vars: { items: JSON.stringify(batch.map((q) => ({ ref: q.q_id, format: 'mcq_single', stem: (q.passage ? q.passage + '\n\n' : '') + q.stem, options: q.options.map((o, k) => ({ id: String.fromCharCode(97 + k), md: o })) })), null, 1), conventions: '(none)', text: d.sources.length ? C.sourceText(d.sources).slice(0, 30000) : '(no source pages)' } });
        const o = {}; ((res.json && res.json.answers) || []).forEach((a) => { o[a.ref] = a; }); return o;
      });
      batch.forEach((q) => {
        const a = (out || {})[q.q_id];
        const idx = a && (a.choice || []).length === 1 ? String(a.choice[0]).trim().charCodeAt(0) - 97 : -1;
        if (a && a.confidence !== 'cannot_solve' && idx === q.correct) { q.validation = 'verified'; q.validation_note = 'Solved again without the key; the answer matched.'; }
        else { q.validation = 'disputed'; q.validation_note = 'The independent solution chose ' + (idx >= 0 && idx < q.options.length ? '"' + q.options[idx] + '"' : 'nothing') + '.' + (a && a.reasoning ? ' Solver: ' + String(a.reasoning).slice(0, 300) : ''); }
      });
    }
    step.detail = all.filter((q) => q.validation === 'verified').length + ' verified, ' + all.filter((q) => q.validation === 'disputed').length + ' disputed (of ' + all.length + ')';
  });

  let result = null;
  await ctx.step('save', 'Save the draft', async (step) => {
    const pkg = assemble(d, r);
    const all = allQ(d, r);
    pkg.generated_by = { app: 'Kartotek', job: ctx.job.id, kind: 'mock', created_at: new Date(ctx.now()).toISOString(), writers: Object.keys(ctx.job.writers || {}).map((w) => ({ writer: w, calls: ctx.job.writers[w] })),
      verification: { verified: all.filter((q) => q.validation === 'verified').length, disputed: all.filter((q) => q.validation === 'disputed').length, items: all.length } };
    const errors = ctx.checks.mockValidate(pkg);
    const text = JSON.stringify(pkg, null, 1);
    fs.writeFileSync(path.join(ctx.dir, 'mock.json'), text);
    const contentDir = ctx.content && ctx.content.dir();
    result = { mock_id: pkg.mock_id, title: pkg.title, errors: errors.slice(0, 40), verification: pkg.generated_by.verification };
    if (errors.length) result.where = 'Not saved to the content folder: ' + errors.length + ' problems remain. The draft is in the job folder.';
    else if (!contentDir) result.where = 'No content folder is set. The draft is in the job folder.';
    else {
      const folder = path.join(contentDir, 'mocks', pkg.mock_id);
      fs.mkdirSync(folder, { recursive: true });
      const target = path.join(folder, 'mock.json');
      if (fs.existsSync(target)) fs.copyFileSync(target, path.join(folder, 'mock.before-' + ctx.job.id + '.json'));
      fs.writeFileSync(target + '.tmp', text); fs.renameSync(target + '.tmp', target);
      result.saved = true; result.where = 'mocks\\' + pkg.mock_id + '\\mock.json in the content folder';
    }
    step.detail = result.where;
  });
  return result;
}

function questionProblems(j, count, K, topics, sectionId) {
  const p = [];
  const ids = topics.map((t) => t.id);
  if (j.questions.length !== count) p.push('Write exactly ' + count + ' questions (you wrote ' + j.questions.length + ').');
  j.questions.forEach((q, i) => {
    const at = 'Question ' + (i + 1);
    if (q.options.length !== K) p.push(at + ': exactly ' + K + ' options.');
    if (!(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < K)) p.push(at + ': correct is the index of the right option (0–' + (K - 1) + ').');
    if (!String(q.stem || '').trim() || !String(q.solution || '').trim()) p.push(at + ': stem and solution are required.');
    if (/all of the above|none of the above/i.test(q.options.join(' '))) p.push(at + ': no "all/none of the above".');
    if (sectionId !== 'read' && ids.length && q.item_id && ids.indexOf(q.item_id) < 0) p.push(at + ': item_id "' + q.item_id + '" is not one of ' + ids.join(', ') + '.');
    if (sectionId === 'read' && !String(q.passage || '').trim() && !String(q.passage_id || '').trim()) p.push(at + ': a reading question needs its passage (or the passage_id of an earlier question with the same text).');
  });
  return p;
}
function allQ(d, r) { return r.sections.reduce((a, s) => a.concat((d.questions || {})[s.section_id] || []), []); }

module.exports = { prepare, estimate, run, assemble };
