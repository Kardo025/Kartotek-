'use strict';
// Shared pieces of the writing jobs (task E3): source text for prompts, the check-and-repair loop, item clean-up and the
// verification pass (a second call solves each item without its key; only a match makes the item "verified").

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const sentences = (md) => String(md || '').replace(/\*\*/g, '').split(/[.!?](\s|$)/).filter((x) => x && x.trim().length > 2).length;
const uniq = (a) => Array.from(new Set(a));
function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'study';
}

// ---- source text
// "p. 5", "pp. 5–6", "slide 4", "section 2" -> page numbers
function pagesOfLoc(loc) {
  const out = [];
  const s = String(loc || '');
  const re = /(\d+)\s*(?:[–\-]\s*(\d+))?/g;
  let m;
  while ((m = re.exec(s))) {
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let i = a; i <= Math.min(b, a + 30); i++) out.push(i);
  }
  return out;
}
const unitWord = (src) => (src.unit === 'slide' ? 'slide' : src.unit === 'page' ? 'p.' : src.unit);
function pageText(p) { return p.transcribed != null ? p.transcribed : p.text; }
// The text of the chosen pages, each with a marker the model cites: [S1 p. 3]
function sourceText(sources, pick) {
  const out = [];
  sources.forEach((src) => {
    src.pages.forEach((p) => {
      if (pick && !pick(src, p)) return;
      const t = pageText(p);
      out.push('[' + src.id + ' ' + unitWord(src) + ' ' + p.n + ']' + (p.transcribed != null ? ' (read from the page image)' : '') + (p.unreadable ? ' (UNREADABLE: ' + p.unreadable + ')' : '') + '\n' + (t || '(no text)'));
    });
  });
  return out.join('\n\n');
}
function manifest(sources) {
  return sources.map((s) => s.id + ': "' + s.name + '" (' + s.type + ', ' + s.pages.length + ' ' + (s.unit === 'page' ? 'pages' : s.unit + 's') + ', cite as "' + unitWord(s) + ' N")').join('\n');
}
// Pages cited by a set of units (with one neighbouring page on each side, so a definition split over two pages stays whole)
function pagesForUnits(sources, units) {
  const want = {};
  units.forEach((u) => {
    pagesOfLoc(u.loc).forEach((n) => { [n - 1, n, n + 1].forEach((k) => { want[u.source + ':' + k] = true; }); });
  });
  return (src, p) => !!want[src.id + ':' + p.n];
}
// Splits all pages into chunks of at most `max` characters (pages are never split)
function chunkPages(sources, max) {
  const chunks = [];
  let cur = [], size = 0;
  sources.forEach((src) => src.pages.forEach((p) => {
    const len = (pageText(p) || '').length + 30;
    if (size + len > max && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push({ src: src.id, n: p.n }); size += len;
  }));
  if (cur.length) chunks.push(cur);
  return chunks;
}

// ---- asking with checks: the model answers, the checks list problems, the model repairs (at most `repairs` times)
// An answer that does not match the schema even after the model layer's own repair call (a long answer cut off, a small model
// losing the shape) counts as one more problem to repair here instead of stopping the job; only the last attempt throws.
async function askOnce(ctx, o, last) {
  try { return await ctx.ask(o); } catch (e) {
    if (e && e.code === 'schema' && !last) { ctx.log('warn', 'The answer did not match the required shape: ' + String(e.message).slice(0, 200)); return { json: null, text: '', schemaError: e.message }; }
    throw e;
  }
}
async function askChecked(ctx, task, o, checkFn, repairs) {
  let r = await askOnce(ctx, o, repairs < 1);
  let json = r.json, problems = r.schemaError ? ['Your answer was not complete, valid JSON in the required shape (' + String(r.schemaError).slice(0, 300) + '). Keep the answer shorter if needed.'] : safeCheck(checkFn, json);
  let n = 0;
  while (problems.length && n < repairs) {
    n++;
    task.attempts = n; task.problems = problems.slice(0, 20);
    ctx.log('info', task.label + ': ' + problems.length + ' problem' + (problems.length > 1 ? 's' : '') + ' found, asking for a repair (' + n + ' of ' + repairs + ')');
    // only the latest answer and its problems travel back, so the conversation stays short for small local models;
    // after an answer that was not JSON at all, the task is simply asked again
    const messages = json ? [{ role: 'assistant', content: JSON.stringify(json) }, { role: 'user', content: ctx.render('job-repair', { problems: problems.slice(0, 40).map((p) => '- ' + p).join('\n') }) }] : [];
    r = await askOnce(ctx, Object.assign({}, o, { messages }), n >= repairs);
    json = r.json;
    problems = r.schemaError ? ['Your answer was not complete, valid JSON in the required shape.'] : safeCheck(checkFn, json);
  }
  if (json == null) throw Object.assign(new Error(task.label + ': no valid answer after ' + n + ' repairs.'), { code: 'schema' });
  task.problems = problems.slice(0, 20);
  task.writer = r.providerLabel + ' · ' + (r.model || 'default model');
  if (problems.length) ctx.log('warn', task.label + ': ' + problems.length + ' problem' + (problems.length > 1 ? 's' : '') + ' left after ' + n + ' repair' + (n === 1 ? '' : 's') + '.');
  return { json, problems, writer: task.writer };
}
function safeCheck(fn, json) {
  if (json === undefined || json === null) return ['The answer was not valid JSON.'];
  try { return fn(json) || []; } catch (e) { return ['The answer could not be checked: ' + e.message]; }
}

// ---- Study v2 items (STUDY-RULES.md v2.5): the flat model shape -> the package shape
function cleanItem(raw, fixed) {
  const it = { q_id: fixed.q_id, version: fixed.version || 1, origin: raw.origin, source_ref: raw.source_ref || null, units: uniq(raw.units || []),
    format: raw.format, kazanim_id: fixed.kazanim_id, outcomes: fixed.outcomes, criteria: uniq(raw.criteria || []), performance: raw.performance,
    difficulty: raw.difficulty, stem: raw.stem };
  if (raw.format === 'mcq_single' || raw.format === 'mcq_multi') {
    it.options = (raw.options || []).map((o) => ({ id: String(o.id).trim(), md: o.md }));
    it.key = uniq((raw.key || []).map((k) => String(k).trim()));
    it.keep_order = false;
    it.option_notes = {};
    (raw.option_notes || []).forEach((n) => { if (n && n.id != null) it.option_notes[String(n.id).trim()] = n.note; });
  } else if (raw.format === 'numeric') {
    it.numeric = { value: Number(raw.numeric && raw.numeric.value), tol: Math.abs(Number(raw.numeric && raw.numeric.tol) || 0), unit: (raw.numeric && raw.numeric.unit) || '' };
  } else if (raw.format === 'typed') {
    const r = raw.rubric || {};
    it.rubric = { criteria: (r.criteria || []).map((c) => ({ id: c.id, text: c.text, required: c.required !== false })), accept: r.accept || [], contradictions: r.contradictions || [], model: r.model || '' };
  }
  if ((raw.hints || []).length) it.hints = raw.hints.slice(0, 3);
  if ((raw.steps || []).length) it.steps = raw.steps;
  it.solution = raw.solution || '';
  if (raw.integrates && raw.integrates.length >= 2) it.integrates = uniq(raw.integrates);
  it.family = fixed.family || ('f-' + fixed.q_id);
  it.use = fixed.use;
  it.validation = 'unverified';
  it.validation_note = 'Written by a model; not checked yet.';
  return it;
}

// Problems of one model item (flat shape), before clean-up
function itemProblems(raw, at, known) {
  const p = [];
  const label = at;
  if (!String(raw.stem || '').trim()) p.push(label + ': the stem is empty.');
  if (/all of the above|none of the above/i.test(JSON.stringify(raw.options || []))) p.push(label + ': never use "all of the above" or "none of the above".');
  const crit = raw.criteria || [];
  if (!crit.length) p.push(label + ': list the criterion ids this item assesses in "criteria".');
  crit.forEach((c) => { if (known.criteria && !known.criteria[c]) p.push(label + ': unknown criterion "' + c + '" (use only: ' + Object.keys(known.criteria).join(', ') + ').'); });
  (raw.units || []).forEach((u) => { if (known.units && !known.units[u]) p.push(label + ': unknown unit "' + u + '".'); });
  if (raw.format === 'mcq_single' || raw.format === 'mcq_multi') {
    const ids = (raw.options || []).map((o) => String(o.id).trim());
    if (ids.length < 2 || ids.length > 6) p.push(label + ': use 2 to 6 options.');
    if (uniq(ids).length !== ids.length || ids.some((x) => !x)) p.push(label + ': option ids must be unique and not empty.');
    const key = uniq((raw.key || []).map((k) => String(k).trim()));
    if (!key.length || key.some((k) => ids.indexOf(k) < 0)) p.push(label + ': "key" must list option ids.');
    if (raw.format === 'mcq_single' && key.length !== 1) p.push(label + ': a single-answer item has exactly one key.');
    if (raw.format === 'mcq_multi' && (key.length < 2 || key.length >= ids.length)) p.push(label + ': a select-all item needs at least 2 keys and at least one option that is not a key.');
    const noted = (raw.option_notes || []).map((n) => String(n.id).trim());
    const missing = ids.filter((id) => noted.indexOf(id) < 0);
    if (missing.length) p.push(label + ': option_notes has no note for option ' + missing.join(', ') + '.');
  } else if (raw.format === 'numeric') {
    if (!raw.numeric || !isFinite(Number(raw.numeric.value))) p.push(label + ': numeric.value must be a number.');
    if (!raw.numeric || !(Number(raw.numeric.tol) >= 0)) p.push(label + ': numeric.tol must be zero or more.');
  } else if (raw.format === 'typed') {
    const rc = (raw.rubric && raw.rubric.criteria) || [];
    if (!rc.length || !rc.some((c) => c.required !== false)) p.push(label + ': a written item needs rubric.criteria with at least one required criterion.');
    if (!String(raw.rubric && raw.rubric.model || '').trim()) p.push(label + ': a written item needs rubric.model (a model answer).');
  }
  if (!String(raw.solution || '').trim() && raw.format !== 'typed') p.push(label + ': write a solution.');
  return p;
}

// ---- verification: solve without the key, compare
function stripKey(it) {
  const out = { ref: it.q_id, format: it.format, stem: it.stem };
  if (it.options) out.options = it.options.map((o) => ({ id: o.id, md: o.md }));
  if (it.format === 'mcq_multi') out.note = 'Select all options that are correct.';
  if (it.format === 'numeric') out.unit = it.numeric && it.numeric.unit || '';
  if (it.figure) out.figure = it.figure.caption || '';
  return out;
}
function firstNumber(s) {
  const m = /[-+]?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?/i.exec(String(s || '').replace(/(\d)\s(?=\d{3}\b)/g, '$1'));
  return m ? Number(m[0].replace(',', '.')) : NaN;
}
// The independent answer against the key: { match: true|false|null (needs the judge), detail }
function compare(it, ans) {
  if (!ans) return { match: false, detail: 'no independent answer' };
  if (ans.confidence === 'cannot_solve') return { match: false, detail: 'the solver could not solve it from the source: ' + (ans.reasoning || '').slice(0, 200) };
  if (it.format === 'mcq_single' || it.format === 'mcq_multi') {
    const a = uniq((ans.choice || []).map((x) => String(x).trim())).sort(), k = uniq(it.key).sort();
    return { match: a.length === k.length && a.every((x, i) => x === k[i]), detail: 'independent answer ' + (a.join(', ') || 'none') + ', key ' + k.join(', ') };
  }
  if (it.format === 'numeric') {
    const x = firstNumber(ans.number || ans.answer);
    const v = it.numeric.value, tol = Math.max(it.numeric.tol, Math.abs(v) * 1e-9);
    return { match: isFinite(x) && Math.abs(x - v) <= tol, detail: 'independent answer ' + (isFinite(x) ? x : '"' + String(ans.number || ans.answer).slice(0, 40) + '"') + ', key ' + v + ' ± ' + it.numeric.tol };
  }
  return { match: null, detail: 'written answer: needs the rubric check' };
}

// 4-option fixed formats (lesson tests, mock exams): the app does not shuffle, so the correct positions are spread evenly by
// moving options (and their notes) deterministically
function balanceCorrect(items, nOptions) {
  let k = 0;
  items.forEach((q) => {
    if (!Array.isArray(q.options) || q.options.length !== nOptions || !Number.isInteger(q.correct)) return;
    const want = k % nOptions; k++;
    if (q.correct === want) return;
    const swap = (a) => { if (Array.isArray(a) && a.length === nOptions) { const t = a[want]; a[want] = a[q.correct]; a[q.correct] = t; } };
    swap(q.options); swap(q.distractor_notes);
    q.correct = want;
  });
}

module.exports = { words, sentences, uniq, slug, pagesOfLoc, sourceText, manifest, pagesForUnits, chunkPages, pageText, unitWord,
  askChecked, cleanItem, itemProblems, stripKey, compare, firstNumber, balanceCorrect };
