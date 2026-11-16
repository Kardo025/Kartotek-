'use strict';
// Tests for the writing jobs (task E3). No real model is called: a scripted fake model service answers every step from the prompt
// it receives (as a careful model would), and can be told to make mistakes so the check-and-repair loops, the audit repair, the
// verification pass (match, mismatch, fix), pause and resume, the estimate and the saved draft are exercised.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { createJobService } = require('../desktop/jobs/service');
const { createChecks } = require('../desktop/jobs/engine');
const extract = require('../desktop/jobs/extract');
const study = require('../desktop/jobs/study');
const lesson = require('../desktop/jobs/lesson');
const mock = require('../desktop/jobs/mock');
const mind = require('../desktop/jobs/mind');
const { createPrompts } = require('../desktop/models/prompts');
const { validate } = require('../desktop/models/schema');
const { S } = require('../desktop/jobs/schemas');

// ---------------------------------------------------------------- the fake model
function textOf(req) { return req.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'))).join('\n'); }
function firstText(req) { const m = req.messages[0]; return typeof m.content === 'string' ? m.content : m.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'); }
const all = (re, s) => { const out = []; let m; const r = new RegExp(re.source, re.flags.indexOf('g') >= 0 ? re.flags : re.flags + 'g'); while ((m = r.exec(s))) out.push(m); return out; };

function fakeModels(opt) {
  opt = opt || {};
  const calls = [];
  const keys = {};          // stem -> key, so the fake solver can answer like an independent solver would
  let n = 0;
  const item = (crit, units, i, tag) => {
    const stem = 'Question ' + tag + '-' + i + ' about ' + crit + '?';
    const fmt = i % 3 === 2 ? 'numeric' : i % 3 === 1 ? 'typed' : 'mcq_single';
    const it = { format: fmt, performance: 'identify', difficulty: 'medium', origin: 'generated', source_ref: '', units, criteria: [crit], integrates: [], stem,
      options: [], key: [], option_notes: [], numeric: { value: 0, tol: 0, unit: '' }, rubric: { criteria: [], accept: [], contradictions: [], model: '' }, hints: ['Look at the definition.'], steps: [], solution: 'Because the source says so (p. 1).' };
    if (fmt === 'mcq_single') { it.options = [{ id: 'a', md: 'Alpha' }, { id: 'b', md: 'Beta' }, { id: 'c', md: 'Gamma' }]; it.key = ['b']; it.option_notes = [{ id: 'a', note: 'No.' }, { id: 'b', note: 'Correct (p. 1).' }, { id: 'c', note: 'No.' }]; keys[stem] = { choice: ['b'] }; }
    if (fmt === 'numeric') { it.numeric = { value: 4.2, tol: 0.05, unit: 'm' }; keys[stem] = { number: '4.2' }; }
    if (fmt === 'typed') { it.rubric = { criteria: [{ id: crit, text: 'States the idea.', required: true }], accept: [], contradictions: [], model: 'The idea.' }; keys[stem] = { answer: 'The idea, stated.' }; }
    return it;
  };
  async function run(req) {
    n++;
    calls.push(req);
    if (opt.failAt && n === opt.failAt) { const e = new Error('Network down'); e.code = 'network'; throw e; }
    if (opt.onCall) await opt.onCall(n, req);
    const t = firstText(req), followup = req.messages.length > 1;
    let json = opt.answer ? opt.answer(req, n) : undefined;
    if (json === undefined) switch (req.promptId) {
      case 'source-transcribe': json = { text: 'Transcribed page text: a definition of flux.', unreadable: [], figures: [] }; break;
      case 'study-units': {
        const pages = all(/\[(S\d+) (p\.|slide|section|part) (\d+)\]/, t);
        const units = [];
        pages.forEach((m) => { units.push({ source: m[1], loc: m[2] + ' ' + m[3], type: 'definition', text: 'Definition on page ' + m[3] + '.', disposition: 'included', reason: '' }); units.push({ source: m[1], loc: m[2] + ' ' + m[3], type: 'relation', text: 'A second idea on page ' + m[3] + '.', disposition: 'included', reason: '' }); });
        // mistake on purpose: a too-long paraphrase in the first answer
        if (opt.unitMistake && !followup) units[0].text = Array(40).fill('word').join(' ');
        json = { title: 'Fake study', conventions: [], units, gaps: [], not_covered: [] };
        break;
      }
      case 'study-relations': { const us = all(/^(U\d+) \[/m, t).map((m) => m[1]); json = { relations: us.length > 1 ? [{ from: 'a', to: 'b', type: 'dependency', direction: 'forward', conditions: [], units: us.slice(0, 2) }] : [] }; break; }
      case 'study-outline': {
        const us = all(/^(U\d+) \[/m, t).map((m) => m[1]);
        const rs = all(/^(R\d+):/m, t).map((m) => m[1]);
        const topics = us.map((u, i) => ({ title: 'Topic ' + (i + 1), kind: 'kavram', objective: 'Without notes, explain ' + u + '.', outcomes: [{ performance: 'Explain ' + u, object: 'concept', conditions: 'without notes', units: [u], relations: i === 0 ? rs : [], criteria: ['States ' + u + '.', 'Gives an example of ' + u + '.'] }] }));
        // mistake on purpose: the first answer leaves the last unit out
        if (opt.outlineMistake && !followup) topics.pop();
        json = { title: 'Fake study', parts: [{ title: 'Part one', topics: topics.slice(0, 3) }].concat(topics.length > 3 ? [{ title: 'Part two', topics: topics.slice(3) }] : []), unresolved_units: [] };
        break;
      }
      case 'study-topic': {
        const us = all(/^(U\d+) \[/m, t).map((m) => m[1]);
        const cs = all(/^\s+(C-\d+):/m, t).map((m) => m[1]);
        json = { priming: { summary_md: 'A **short** preview (p. 1).', keywords: [{ term: 'flux', definition: 'a flow', ref: 'p. 1' }], purpose: 'Why it matters.', prereq: '' },
          blocks: [{ type: 'text', title: '', md: 'Teaching text (p. 1).', tone: 'none', items: [], columns: [], rows: [], problem: '', steps: [], answer: '', refs: us, slides: [1] },
            { type: 'compare', title: 'Contrast', md: '', tone: 'none', items: [], columns: ['A', 'B'], rows: [['1', '2']], problem: '', steps: [], answer: '', refs: us.slice(0, 1), slides: [1] }],
          recall: { prompt: 'Explain it.', model_answer: 'It is a flow.', key_points: ['flow', 'definition'], origin: 'generated', source_ref: '' }, feynman: { prompt: 'Explain it to a friend who…', criteria: cs.slice(0, 1) } };
        if (opt.topicMistake && !followup) json.blocks = [];
        break;
      }
      case 'study-part': {
        const cs = all(/^\s+(C-\d+):/m, t).map((m) => m[1]);
        const us = all(/^(U\d+) \[/m, t).map((m) => m[1]);
        json = { orientation: { place: 'First', purpose: 'To do things.', prereq: '' }, summary: { md: 'One. Two. Three. Four. Five sentences here.', keywords: [1, 2, 3, 4, 5].map((i) => ({ term: 't' + i, definition: 'd' + i, ref: 'p. 1' })) },
          connect_blocks: [{ type: 'keypoints', title: 'Putting the part together', md: '', tone: 'none', items: ['They connect.'], columns: [], rows: [], problem: '', steps: [], answer: '', refs: us.slice(0, 2), slides: [] }], feynman: { prompt: 'Explain the part.', criteria: cs.slice(0, 2) } };
        break;
      }
      case 'study-items': case 'study-final': {
        const cs = all(/^\s+(C-\d+):/m, t).map((m) => m[1]);
        const us = all(/^(U\d+) \[/m, t).map((m) => m[1]);
        const tag = req.promptId === 'study-final' ? 'F' + n : 'P' + n;
        json = { items: cs.map((c, i) => item(c, us.slice(0, 1), i, tag)) };
        // mistake on purpose: the first answer misses a criterion and has a single-answer item with two keys
        if (opt.itemsMistake && !followup && req.promptId === 'study-items') { json.items = json.items.slice(1); if (json.items[0] && json.items[0].format === 'mcq_single') json.items[0].key = ['a', 'b']; }
        break;
      }
      case 'study-connect': {
        const kids = all(/^- (k\d+) \(/m, t).map((m) => m[1]);
        const latest = (/topic of this part:\n```text\n([^\n]+)/.exec(t) || [])[1] || '';
        const own = latest.split(',').map((s) => s.trim()).filter(Boolean);
        const cs = all(/^\s+(C-\d+):/m, t).map((m) => m[1]);
        const k2 = own[own.length - 1], k1 = kids.find((k) => k !== k2);
        const it = item(cs[cs.length - 1], [], 0, 'C' + n);
        it.integrates = [k1, k2];
        json = { items: k1 && k2 ? [it] : [] };
        break;
      }
      case 'item-solve': {
        const items = JSON.parse((/Questions:\n```text\n([\s\S]*?)\n```/.exec(t) || [])[1] || '[]');
        json = { answers: items.map((q) => {
          const k = keys[q.stem] || {};
          const wrong = opt.solveWrong && opt.solveWrong(q, n);
          return { ref: q.ref, choice: wrong ? ['a'] : (k.choice || []), answer: k.answer || 'x', number: wrong ? '99' : (k.number || ''), confidence: 'sure', reasoning: 'From p. 1.' };
        }) };
        break;
      }
      case 'item-judge': json = { criteria: all(/"id": "(C-\d+)"/, t).map((m) => ({ id: m[1], met: true, quote: 'The idea' })), contradiction: false, note: '' }; break;
      case 'item-fix': json = { verdict: 'key_correct', note: 'The solver slipped.', item: JSON.parse((/key:\n```text\n([\s\S]*?)\n```/.exec(t) || [])[1]) }; break;
      case 'job-repair': throw new Error('job-repair is a follow-up text, not a call');
      default: json = {};
    }
    if (req.schema) { const e = validate(req.schema, json); if (e.length) throw new Error('Fake model answer does not match the schema of ' + req.promptId + ': ' + e.slice(0, 3).join('; ')); }
    return { text: JSON.stringify(json), json, usage: { input: Math.round(textOf(req).length / 4), output: Math.round(JSON.stringify(json).length / 4), cacheRead: 0, cacheWrite: 0 },
      costUsd: 0.001, costKind: 'api', provider: 'fake', providerLabel: 'Fake', model: 'fake-model', durationMs: 5, stopReason: 'end_turn' };
  }
  return {
    calls, keys,
    run, cancel: () => true,
    estimate: async (t, u) => ({ configured: true, providerLabel: 'Fake', model: 'fake-model', costKind: 'api', costUsd: (u.input * 2 + u.output * 10) / 1e6 }),
  };
}

// ---------------------------------------------------------------- fixtures
function tmp(name) { return fs.mkdtempSync(path.join(os.tmpdir(), 'kartotek-jobs-' + name + '-')); }
function textSource(dir, pages) {
  const f = path.join(dir, 'lecture.md');
  fs.writeFileSync(f, pages.join('\n'));
  return f;
}
function waitFor(svc, id, statuses, ms) {
  const until = Date.now() + (ms || 20000);
  return new Promise((resolve, reject) => {
    const tick = () => {
      const j = svc.get(id);
      if (statuses.indexOf(j.status) >= 0) return resolve(j);
      if (Date.now() > until) return reject(new Error('Timed out at status ' + j.status + ' ' + (j.error || '')));
      setTimeout(tick, 10);
    };
    tick();
  });
}
function service(dir, models, contentDir) {
  return createJobService({
    dir, models, prompts: createPrompts({ shippedDir: path.join(ROOT, 'prompts'), userDir: dir }),
    pipelines: { study, lesson, mock, 'mind-read': mind.read, 'mind-coach': mind.coach },
    checks: createChecks(path.join(ROOT, 'src')), extract, content: { dir: () => contentDir }, files: { rules: (n) => fs.readFileSync(path.join(ROOT, n), 'utf8') },
  });
}

// ---------------------------------------------------------------- tests
async function main() {
  const results = [];
  const t = async (name, fn) => {
    try { await fn(); results.push([true, name]); } catch (e) { results.push([false, name, e]); }
  };

  await t('schemas use the strict subset (objects closed, every property required)', async () => {
    const walk = (s, at) => {
      if (!s || typeof s !== 'object') return;
      if (s.type === 'object' && s.properties) {
        assert.strictEqual(s.additionalProperties, false, at + ': additionalProperties');
        assert.deepStrictEqual(s.required.slice().sort(), Object.keys(s.properties).sort(), at + ': required');
        Object.keys(s.properties).forEach((k) => walk(s.properties[k], at + '.' + k));
      }
      if (s.items) walk(s.items, at + '[]');
      ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'].forEach((k) => assert.ok(!(k in s), at + ' uses ' + k));
    };
    Object.keys(S).forEach((k) => walk(S[k], k));
  });

  await t('every job prompt file renders with its variables and has no unknown placeholders', async () => {
    const P = createPrompts({ shippedDir: path.join(ROOT, 'prompts'), userDir: tmp('p') });
    const ids = ['job-repair', 'source-transcribe', 'study-units', 'study-relations', 'study-outline', 'study-topic', 'study-part', 'study-items', 'study-connect', 'study-final', 'item-solve', 'item-judge', 'item-fix', 'lesson-outline', 'lesson-items', 'mock-section', 'mind-read', 'mind-coach'];
    ids.forEach((id) => {
      const meta = P.list().find((x) => x.id === id);
      assert.ok(meta, 'missing prompt ' + id);
      const vars = {}; meta.variables.forEach((v) => { vars[v] = 'X'; });
      const r = P.render(id, vars);
      assert.ok(!/\{\{/.test(r.text), id + ' left a placeholder');
    });
  });

  await t('unit ids written into learner text are removed, id fields are kept', async () => {
    const C = require('../desktop/jobs/common');
    assert.strictEqual(C.stripIds('Each bit adds bit × 2^i (U11). See (U9, U10) and [U3, U4] here (units U2 and U5).'), 'Each bit adds bit × 2^i. See and here.');
    const x = C.stripDeep({ md: 'Value (U9).', refs: ['U9'], items: ['A (U1)'], units: ['U1'] });
    assert.deepStrictEqual(x, { md: 'Value.', refs: ['U9'], items: ['A'], units: ['U1'] });
  });

  await t('found in the real run: a number in the written answer counts when the number field is empty; a numeric key the solution never reaches is a problem', async () => {
    const C = require('../desktop/jobs/common');
    assert.strictEqual(C.compare({ format: 'numeric', numeric: { value: 185, tol: 0 } }, { number: '.', answer: 'The weighted sum is 185.', confidence: 'sure' }).match, true);
    const known = { criteria: { 'C-1': 1 }, units: {} };
    const raw = { format: 'numeric', stem: 'How are the two steps related?', criteria: ['C-1'], units: [], numeric: { value: 0, tol: 0, unit: '' }, solution: 'The specification decides the table.' };
    assert.ok(C.itemProblems(raw, 'Item 1', known).some((p) => /never arrives at the key 0/.test(p)));
    raw.numeric.value = 65536; raw.solution = '2^(2^4) = 2^16 = 65,536 functions (p. 26).';
    assert.deepStrictEqual(C.itemProblems(raw, 'Item 1', known), []);
  });

  await t('extract: text files, .docx and .pptx (zip) and the text-layer quality check', async () => {
    const dir = tmp('x');
    const f = textSource(dir, ['Line one.', 'Line two.']);
    const s = await extract.extractSources([f], {});
    assert.strictEqual(s[0].id, 'S1'); assert.strictEqual(s[0].pages.length, 1); assert.ok(/Line two/.test(s[0].pages[0].text));
    assert.strictEqual(extract.textQuality('').reliable, false);
    assert.strictEqual(extract.textQuality('���� broken text layer with many replacement characters ��').reliable, false);
    assert.strictEqual(extract.textQuality('A normal sentence about thermodynamics and the first law, with numbers 1.5 and 2.').reliable, true);
    // a hand-made .pptx: two slides in presentation order 2, 1, with speaker notes on the first
    const zip = makeZip({
      'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId2"/><p:sldId id="2" r:id="rId1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="slide" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Second &amp; last</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>First slide</a:t></a:r><a:r><a:t> title</a:t></a:r></a:p></p:sld>',
      'ppt/slides/_rels/slide2.xml.rels': '<Relationships><Relationship Id="rId9" Type="http://x/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
      'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:p><a:r><a:t>Say this</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:notes>',
    });
    const slides = extract.readPptx(zip);
    assert.deepStrictEqual(slides.map((x) => x.text), ['First slide title\n[Speaker notes] Say this', 'Second & last']);
    const docx = makeZip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p></w:body></w:document>' });
    assert.strictEqual(extract.readDocx(docx)[0].text, 'Hello world');
    await assert.rejects(() => extract.extractSources([path.join(dir, 'old.ppt')].map((p) => { fs.writeFileSync(p, 'x'); return p; }), {}), /old binary Office file/);
  });

  await t('extract: a real PDF through pdf.js, with page images for pages without a text layer', async () => {
    const dir = tmp('pdf');
    const f = path.join(dir, 'two.pdf');
    fs.writeFileSync(f, makePdf(['Kinematics: velocity is the rate of change of position with time, measured in metres per second.', '']));
    const s = await extract.extractSources([f], { imageDir: path.join(dir, 'img') });
    assert.strictEqual(s[0].pages.length, 2);
    assert.ok(/velocity is the rate of change/.test(s[0].pages[0].text));
    assert.strictEqual(s[0].pages[0].reliable, true);
    assert.strictEqual(s[0].pages[1].reliable, false);
    assert.ok(s[0].pages[1].image && fs.statSync(s[0].pages[1].image).size > 100, 'the empty page is rendered to an image');
    const png = fs.readFileSync(s[0].pages[1].image);
    assert.strictEqual(png.slice(1, 4).toString(), 'PNG');
  });

  await t('study job: estimate first, then every step; checks and repairs; 0 blockers; saved with the writer', async () => {
    const dir = tmp('s'), content = tmp('c');
    const f = textSource(dir, ['[page 1]', 'Flux is the flow through a surface.', '', 'Velocity is change of position per time.']);
    const models = fakeModels({ unitMistake: true, outlineMistake: true, itemsMistake: true, topicMistake: true });
    const svc = service(dir, models, content);
    const job = await svc.create('study', { files: [f], title: 'Fake lecture' }, null);
    assert.strictEqual(job.status, 'ready', job.error);
    assert.strictEqual(models.calls.length, 0, 'nothing is sent before Start');
    assert.ok(job.estimate.calls > 0 && job.estimate.input > 0 && job.estimate.output > 0 && typeof job.estimate.costUsd === 'number');
    svc.start(job.id);
    const done = await waitFor(svc, job.id, ['done', 'failed']);
    assert.strictEqual(done.status, 'done', done.error);
    assert.ok(done.totals.calls > 5 && done.totals.costUsd > 0);
    const repaired = done.steps.reduce((a, s) => a.concat(s.tasks.filter((x) => x.attempts > 0).map((x) => s.id)), []);
    ['units', 'outline', 'topics', 'items'].forEach((s) => assert.ok(repaired.indexOf(s) >= 0, 'a repair happened in ' + s + ' (' + repaired.join(',') + ')'));
    assert.ok(done.result.saved, done.result.where);
    assert.strictEqual(done.result.certified, true, JSON.stringify(done.result.blockers));
    const pkg = JSON.parse(fs.readFileSync(path.join(content, 'studies', 'fake-lecture', 'etut.json'), 'utf8'));
    const checks = createChecks(path.join(ROOT, 'src'));
    assert.strictEqual(checks.studyValidate(pkg).errors.length, 0);
    assert.strictEqual(checks.studyAudit(pkg).blockers.length, 0);
    assert.strictEqual(pkg.generated_by.writers[0].writer, 'Fake · fake-model');
    assert.ok(pkg.generated_by.verification.verified > 0);
    assert.ok(fs.existsSync(path.join(content, 'studies', 'fake-lecture', 'source.md')));
    assert.ok(fs.existsSync(path.join(content, 'sources', 'fake-lecture', 'lecture.md')), 'a copy of the source file');
    // every model item started unverified and only the verification pass changed that
    const items = pkg.parts.reduce((a, p) => a.concat(p.items), []).concat(pkg.final_test);
    items.forEach((it) => assert.ok(it.validation === 'verified' ? /Solved again without the key/.test(it.validation_note) : true));
  });

  await t('verification: a wrong independent answer disputes the item; a fix round re-checks it', async () => {
    const dir = tmp('v'), content = tmp('c');
    const f = textSource(dir, ['Flux is the flow through a surface.', 'Velocity is change of position per time.']);
    let wrongOnce = {};
    const models = fakeModels({ solveWrong: (q) => { if (/^Question P/.test(q.stem) && /-0 about/.test(q.stem) && !wrongOnce[q.stem]) { wrongOnce[q.stem] = true; return true; } return false; } });
    const svc = service(dir, models, content);
    const job = await svc.create('study', { files: [f], title: 'Verify me' }, null);
    svc.start(job.id);
    const done = await waitFor(svc, job.id, ['done', 'failed']);
    assert.strictEqual(done.status, 'done', done.error);
    const pkg = JSON.parse(fs.readFileSync(path.join(content, 'studies', 'verify-me', 'etut.json'), 'utf8'));
    const items = pkg.parts.reduce((a, p) => a.concat(p.items), []);
    const fixed = items.filter((it) => /Re-examined: the key was judged correct/.test(it.validation_note || ''));
    assert.ok(fixed.length > 0, 'disputed items went through the fix round');
    fixed.forEach((it) => assert.strictEqual(it.validation, 'verified'));
    assert.ok(models.calls.some((c) => c.promptId === 'item-fix'));
  });

  await t('verification: an item that stays wrong is saved as disputed and never verified', async () => {
    const dir = tmp('v2'), content = tmp('c');
    const f = textSource(dir, ['Flux is the flow through a surface.']);
    const models = fakeModels({ solveWrong: (q) => /^Question F/.test(q.stem) && /-0 about/.test(q.stem) });
    const svc = service(dir, models, content);
    const job = await svc.create('study', { files: [f], title: 'Stays wrong' }, null);
    svc.start(job.id);
    const done = await waitFor(svc, job.id, ['done', 'failed']);
    assert.strictEqual(done.status, 'done', done.error);
    const pkg = JSON.parse(fs.readFileSync(path.join(content, 'studies', 'stays-wrong', 'etut.json'), 'utf8'));
    const bad = pkg.final_test.filter((it) => /-0 about/.test(it.stem));
    assert.ok(bad.length && bad.every((it) => it.validation === 'disputed' && /did not match/.test(it.validation_note)));
    assert.ok(pkg.generated_by.verification.disputed >= bad.length);
  });

  await t('pause and resume: finished tasks are not run again; a closed app resumes from job.json', async () => {
    const dir = tmp('r'), content = tmp('c');
    const f = textSource(dir, ['Flux is the flow through a surface.', 'Velocity is change of position per time.']);
    let svcRef = null, jobId = null, paused = false;
    const models = fakeModels({ onCall: async (n, req) => { if (!paused && req.promptId === 'study-topic') { paused = true; svcRef.pause(jobId); const e = new Error('cancelled'); e.code = 'cancelled'; throw e; } } });
    const svc = service(dir, models, content);
    svcRef = svc;
    const job = await svc.create('study', { files: [f], title: 'Resume me' }, null);
    jobId = job.id;
    svc.start(job.id);
    const p = await waitFor(svc, job.id, ['paused', 'failed', 'done']);
    assert.strictEqual(p.status, 'paused', p.error);
    const before = models.calls.filter((c) => c.promptId === 'study-units').length;
    // a new service on the same folder = Kartotek restarted
    const svc2 = service(dir, models, content);
    assert.strictEqual(svc2.get(job.id).status, 'paused');
    svc2.start(job.id);
    const done = await waitFor(svc2, job.id, ['done', 'failed']);
    assert.strictEqual(done.status, 'done', done.error);
    assert.strictEqual(models.calls.filter((c) => c.promptId === 'study-units').length, before, 'the units step was not asked again');
  });

  await t('a failed call leaves the job resumable (failed, then Start continues)', async () => {
    const dir = tmp('f'), content = tmp('c');
    const f = textSource(dir, ['Flux is the flow through a surface.']);
    const models = fakeModels({ failAt: 3 });
    const svc = service(dir, models, content);
    const job = await svc.create('study', { files: [f], title: 'Fails once' }, null);
    svc.start(job.id);
    const failed = await waitFor(svc, job.id, ['failed', 'done']);
    assert.strictEqual(failed.status, 'failed'); assert.ok(/Network down/.test(failed.error));
    svc.start(job.id);
    const done = await waitFor(svc, job.id, ['done', 'failed']);
    assert.strictEqual(done.status, 'done', done.error);
  });

  await t('a study job with a provider chosen for the job sends that target, and the vision slot for page images', async () => {
    const dir = tmp('t'), content = tmp('c');
    const f = path.join(dir, 'scan.pdf');
    fs.writeFileSync(f, makePdf(['', 'Some readable text about the first law of thermodynamics for the page two layer here.']));
    const models = fakeModels();
    const svc = service(dir, models, content);
    const job = await svc.create('study', { files: [f], title: 'Targets' }, { target: { providerId: 'ollama', model: 'qwen3.6:35b-a3b' }, visionTarget: { providerId: 'ollama', model: 'gemma4:12b' } });
    svc.start(job.id);
    const done = await waitFor(svc, job.id, ['done', 'failed']);
    assert.strictEqual(done.status, 'done', done.error);
    const tr = models.calls.filter((c) => c.promptId === 'source-transcribe');
    assert.strictEqual(tr.length, 1);
    assert.deepStrictEqual(tr[0].target, { providerId: 'ollama', model: 'gemma4:12b' });
    assert.ok(tr[0].messages[0].content.some((c) => c.type === 'image' && c.mime === 'image/png'));
    assert.ok(models.calls.filter((c) => c.promptId !== 'source-transcribe').every((c) => c.target && c.target.model === 'qwen3.6:35b-a3b'));
  });

  await t('lesson job: 4 options, balanced correct positions, verified items, valid for KLesson', async () => {
    const dir = tmp('l'), content = tmp('c');
    const f = textSource(dir, ['Flux is the flow through a surface.', 'Velocity is change of position per time.']);
    const models = fakeModels({ answer: lessonAnswers });
    const svc = service(dir, models, content);
    const job = await svc.create('lesson', { files: [f], title: 'Lesson one' }, null);
    assert.strictEqual(job.status, 'ready', job.error);
    svc.start(job.id);
    const done = await waitFor(svc, job.id, ['done', 'failed']);
    assert.strictEqual(done.status, 'done', done.error);
    const pkg = JSON.parse(fs.readFileSync(path.join(content, 'lessons', 'lesson-one', 'lesson.json'), 'utf8'));
    const checks = createChecks(path.join(ROOT, 'src'));
    assert.deepStrictEqual(checks.lessonValidate(pkg), []);
    const items = pkg.parts.reduce((a, p) => a.concat(p.objectives.reduce((b, o) => b.concat(o.items), [])), []);
    const counts = [0, 0, 0, 0]; items.forEach((q) => counts[q.correct]++);
    assert.ok(Math.max.apply(null, counts) - Math.min.apply(null, counts) <= 1, 'balanced: ' + counts);
    assert.ok(items.every((q) => q.validation === 'verified'));
    assert.ok(pkg.generated_by && pkg.generated_by.writers.length);
  });

  await t('mock job: the exam\'s sections and counts, 5 options for CEnT-S, valid for KMock', async () => {
    const dir = tmp('m'), content = tmp('c');
    const models = fakeModels({ answer: mockAnswers });
    const svc = service(dir, models, content);
    const sections = [{ section_id: 'math', name: 'Mathematics', minutes: 30, questions: 3, topics: [{ id: 'm1', name: 'Fractions' }] }, { section_id: 'phys', name: 'Physics', minutes: 10, questions: 2, topics: [{ id: 'p1', name: 'Speed' }] }];
    const job = await svc.create('mock', { exam: 'cents', id: 'cents-mock-9', title: 'CEnT-S mock 9', options: 5, scoring: { correct: 1, wrong: -0.25, blank: 0 }, sections, files: [] }, null);
    assert.strictEqual(job.status, 'ready', job.error);
    svc.start(job.id);
    const done = await waitFor(svc, job.id, ['done', 'failed']);
    assert.strictEqual(done.status, 'done', done.error);
    const pkg = JSON.parse(fs.readFileSync(path.join(content, 'mocks', 'cents-mock-9', 'mock.json'), 'utf8'));
    const checks = createChecks(path.join(ROOT, 'src'));
    assert.deepStrictEqual(checks.mockValidate(pkg), []);
    assert.deepStrictEqual(pkg.sections.map((s) => s.questions.length), [3, 2]);
    assert.ok(pkg.sections.every((s) => s.questions.every((q) => q.options.length === 5)));
  });

  await t('mind-map reading and coaching use the vision slot and pass KMind\'s validators before they are written', async () => {
    const dir = tmp('mm'), content = tmp('c');
    const photo = path.join(dir, 'A.png');
    fs.writeFileSync(photo, tinyPng());
    const models = fakeModels({ answer: mindAnswers });
    const svc = service(dir, models, content);
    const job = await svc.create('mind-read', { mapId: 'my-map', title: 'My map', language: 'en', views: [{ id: 'A', role: 'overview', file: photo, name: 'A.png' }], prompt: 'Read my map.', rq: 'rq-1' }, null);
    assert.strictEqual(job.status, 'ready', job.error);
    svc.start(job.id);
    const done = await waitFor(svc, job.id, ['done', 'failed']);
    assert.strictEqual(done.status, 'done', done.error);
    const call = models.calls.find((c) => c.promptId === 'mind-read');
    assert.strictEqual(call.slot, 'vision');
    assert.ok(call.messages[0].content.some((c) => c.type === 'image'));
    const map = JSON.parse(fs.readFileSync(path.join(content, 'mindmaps', 'my-map', 'map.json'), 'utf8'));
    assert.strictEqual(map.parser.indexOf('Fake'), 0);
    assert.ok(fs.existsSync(path.join(content, 'mindmaps', 'my-map', 'views', 'A-overview.png')));
    const job2 = await svc.create('mind-coach', { mapId: 'my-map', turn: 1, rq: 'rq-2', prompt: 'Coach me.', views: [{ id: 'A', file: path.join(content, 'mindmaps', 'my-map', 'views', 'A-overview.png') }] }, null);
    svc.start(job2.id);
    const done2 = await waitFor(svc, job2.id, ['done', 'failed']);
    assert.strictEqual(done2.status, 'done', done2.error);
    assert.ok(fs.existsSync(path.join(content, 'mindmaps', 'my-map', 'turns', '001.json')));
  });

  let ok = 0;
  results.forEach(([pass, name, e]) => { if (pass) ok++; else console.log('  FAIL ' + name + ': ' + (e && e.stack || e)); });
  console.log('Writing jobs (fake model): ' + ok + '/' + results.length + ' passed');
  return ok === results.length;
}

// ---------------------------------------------------------------- answers of the fake model for lessons, mocks and mind maps
function lessonAnswers(req) {
  const t = firstText(req);
  if (req.promptId === 'lesson-outline') return { title: 'Lesson one', parts: [{ title: 'Part', refs: ['p. 1'], objectives: [{ title: 'Flux', kind: 'concept', objective: 'Without notes, explain flux.', refs: ['p. 1'] }, { title: 'Velocity', kind: 'problem', objective: 'Without notes, compute velocity.', refs: ['p. 2'] }] }], not_covered: [] };
  if (req.promptId === 'lesson-items') {
    const refs = all(/^(o\d+):/m, t).map((m) => m[1]);
    return { objectives: refs.map((r) => ({ ref: r, recall: { prompt: 'Explain.', model_answer: 'Answer.', key_points: ['a', 'b'] },
      items: [0, 1, 2, 3].map((i) => ({ role: i < 2 ? 'test' : 'retest', level: 'understand', stem: 'Lesson question ' + r + '-' + i + '?', options: ['w', 'x', 'y', 'z'], correct: 0, solution: 'Because (p. 1).', distractor_notes: ['Correct.', 'No.', 'No.', 'No.'] })) })) };
  }
  if (req.promptId === 'item-solve') {
    const items = JSON.parse((/Questions:\n```text\n([\s\S]*?)\n```/.exec(t) || [])[1] || '[]');
    // the fake solver knows the right option by its text: "w" was written as correct
    return { answers: items.map((q) => ({ ref: q.ref, choice: [q.options.find((o) => o.md === 'w').id], answer: 'w', number: '', confidence: 'sure', reasoning: 'p. 1' })) };
  }
  return undefined;
}
function mockAnswers(req) {
  const t = firstText(req);
  if (req.promptId === 'mock-section') {
    const count = Number((/Write exactly (\d+) questions/.exec(t) || [])[1] || 1);
    const opts = Number((/each with exactly (\d+) options/.exec(t) || [])[1] || 5);
    const topic = (/\[(\w+)\]/.exec(t) || [])[1] || 'x';
    return { questions: Array.from({ length: count }, (x, i) => ({ item_id: topic, passage_id: '', passage: '', stem: 'Mock question ' + i + '?', options: Array.from({ length: opts }, (y, k) => (k === 0 ? 'right' : 'wrong ' + k)), correct: 0, solution: 'Because.', refs: [] })) };
  }
  if (req.promptId === 'item-solve') {
    const items = JSON.parse((/Questions:\n```text\n([\s\S]*?)\n```/.exec(t) || [])[1] || '[]');
    return { answers: items.map((q) => ({ ref: q.ref, choice: [q.options.find((o) => o.md === 'right').id], answer: 'right', number: '', confidence: 'sure', reasoning: '' })) };
  }
  return undefined;
}
function mindAnswers(req) {
  if (req.promptId === 'mind-read') {
    return { schema: 'kmind-map-1', map_id: 'my-map', parse_rev: 1, parsed_at: '2026-11-16T10:00:00Z', parser: 'x', title: 'My map', subject: null, language: 'en', goal: null,
      views: [{ id: 'A', file: 'views/A-overview.png', role: 'overview', role_source: 'learner', order: 1, width: 4, height: 4, sha256: 'x', same_revision: null, quality: { usable: true, issues: [] } }],
      regions: [{ id: 'r1', view: 'A', box: [0.1, 0.1, 0.2, 0.2] }],
      observations: [{ id: 'o1', kind: 'text', regions: ['r1'], raw: 'Flux', normalized: 'Flux', candidates: [], text_role: 'concept', from: [], to: [], direction: null, exits_view: false, style: { ink: 'black' }, uncertainty: [], verification: 'visually_supported' }],
      correspondences: [], objects: [], learner_map: { concepts: [{ id: 'k1', label: 'Flux', term: 'Flux', observations: ['o1'], uncertain: false }], groups: [], relations: [], open_questions: [] },
      questions: [], scope: { status: 'partial', possible_unseen: true, unreviewed: [], assessable: ['representation'], withheld: [] }, report: '**Reading status** fine.' };
  }
  if (req.promptId === 'mind-coach') {
    return { schema: 'kmind-turn-1', map_id: 'my-map', turn: 1, request_id: 'rq-2', created_at: '2026-11-16T10:00:00Z', based_on_version: 1, parse_rev: 1, mode: 'coach', state: 'RELATE',
      scope: { views: ['A'], included: ['o1'], unresolved: [], possible_unseen: true, assessable: [], withheld: [], status: 'partial' },
      message: 'What does flux depend on?', observation: null, withheld: [], next_action: { type: 'explain_relation', prompt: 'What does flux depend on?', hint_level: 0, answer_exposed: false, exposed_ids: [] }, patch: null, targets: [], warnings: [] };
  }
  return undefined;
}

// ---------------------------------------------------------------- tiny file makers (zip, pdf, png)
function crc32(buf) { let c, crc = 0xFFFFFFFF; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const zlib = require('zlib');
  const locals = [], centrals = [];
  let offset = 0;
  Object.keys(files).forEach((name) => {
    const data = Buffer.from(files[name], 'utf8'), comp = zlib.deflateRawSync(data), nb = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nb, comp); centrals.push(ch, nb);
    offset += 30 + nb.length + comp.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}
// A minimal PDF with one text line per page (empty string = a page with no text layer, only a drawn rectangle)
function makePdf(pages) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  const pagesId = objs.length + 1 + pages.length * 2;
  pages.forEach((text) => {
    const content = text ? 'BT /F1 9 Tf 40 700 Td (' + text.replace(/[()\\]/g, '') + ') Tj ET' : '0.2 0.2 0.2 rg 100 500 200 100 re f';
    const c = add('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    kids.push(add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 612 792] /Contents ' + c + ' 0 R /Resources << /Font << /F1 ' + font + ' 0 R >> >> >>'));
  });
  add('<< /Type /Pages /Kids [' + kids.map((k) => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>');
  const catalog = add('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
function tinyPng() { return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAAGB8BBaR+dRMAAAAASUVORK5CYII=', 'base64'); }

if (require.main === module) main().then((ok) => process.exit(ok ? 0 : 1));
module.exports = { main };
