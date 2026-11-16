/*
 * Kartotek side questions and research requests (KSide, task F7, LEARNING-PROTOCOL.md 3.11, 3.12). Pure, UI-independent.
 */
// Side questions: a panel beside a lesson, an item in Practice mode, a live session or a practice problem. It sends what is on screen as
// context (an open item or problem without its key and solution) with the question, answers briefly and never changes the main flow.
// Opening it during an open attempt is recorded as help, exactly like the lesson pane (KCycle.useHelp(attempt, "side")). It is not
// offered in the final test or in "Check without help". The exchanges are kept: progress.side (studies), session.side (live and practice).
//
// Research requests: a claim to check against the web (the researcher, a background job in desktop\jobs\research.js). The requests and
// their briefs live in state.research.requests, keyed by id, with the place they came from (an explanation, a live teaching step, a
// practice problem, a side answer, a writing job). A brief is only shown with its sources; a brief without sources is not a verdict.
(function (global) {
  'use strict';

  function squash(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { s = squash(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function uid(p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function unitsOf(pkg) { var o = {}; ((pkg && pkg.units) || []).forEach(function (u) { o[u.id] = u; }); return o; }
  function blockText(b) {
    if (!b) return '';
    if (b.md) return String(b.md);
    if (b.type === 'table' && b.rows) return b.rows.map(function (r) { return r.join(' | '); }).join('\n');
    if (b.items) return b.items.map(function (x) { return typeof x === 'string' ? x : squash(x.md || x.text || ''); }).join('\n');
    return squash(b.text || b.caption || b.alt || '');
  }

  // ------------------------------------------------------------------ contexts (what is on screen)
  // A topic's lesson (Learn & digest): its blocks with their references, and the source units they cite
  function lessonContext(pkg, kid) {
    var k = null;
    (pkg.parts || []).forEach(function (p) { (p.kazanimlar || []).forEach(function (x) { if (x.kazanim_id === kid) k = x; }); });
    if (!k) return null;
    var units = unitsOf(pkg), refs = [], parts = ['Lesson: ' + squash(k.title)];
    (k.blocks || []).forEach(function (b, i) {
      var t = blockText(b);
      if (t) refs.push('block ' + (i + 1));
      if (t) parts.push('[block ' + (i + 1) + (b.refs && b.refs.length ? ', refs ' + b.refs.join(', ') : '') + '] ' + clip(t, 1600));
      (b.refs || []).forEach(function (r) { if (refs.indexOf(r) < 0) refs.push(r); });
    });
    var src = refs.filter(function (r) { return units[r]; }).map(function (r) { return r + ' [' + (units[r].loc || '') + ']: ' + clip(units[r].text, 600); });
    if (src.length) parts.push('Source units the lesson cites:\n' + src.join('\n'));
    return { kind: 'lesson', ref: { etut_id: pkg.etut_id, kid: kid }, text: parts.join('\n\n'), refs: refs.concat(refs.map(function (r) { return units[r] && units[r].loc; }).filter(Boolean)), open: false };
  }
  // An item of the study: while the attempt is open its key, solution and notes are left out
  function itemContext(pkg, item, attempt) {
    var open = !attempt || !attempt.committed_at, units = unitsOf(pkg);
    var lines = ['Question: ' + squash(item.stem)];
    if (item.options) lines.push('Options: ' + item.options.map(function (o) { return o.id + ') ' + squash(o.md); }).join(' | '));
    if (!open) {
      if (item.key) lines.push('Key: ' + [].concat(item.key).join(', '));
      if (item.solution) lines.push('Solution: ' + clip(item.solution, 1500));
    }
    var refs = (item.units || []).slice();
    var src = refs.filter(function (r) { return units[r]; }).map(function (r) { return r + ' [' + (units[r].loc || '') + ']: ' + clip(units[r].text, 600); });
    if (src.length) lines.push('Source units:\n' + src.join('\n'));
    return { kind: 'item', ref: { etut_id: pkg.etut_id, q_id: item.q_id, attempt: attempt ? attempt.id : null }, text: lines.join('\n'), refs: refs, open: open };
  }
  // A live teaching step: the prediction, the teaching and, once shown, the check (its key only after it was answered)
  function liveContext(s, st, pkg) {
    if (!st) return { kind: 'live', ref: { session: s.id }, text: 'Live session: ' + squash(s.title), refs: [], open: false };
    var lines = ['Live session: ' + squash(s.title), 'Prediction asked: ' + squash(st.predict.stem)], refs = [], open = false;
    st.teach.forEach(function (t, i) { lines.push('Teaching' + (i ? ' (again)' : '') + ': ' + clip(t.md, 1500)); (t.refs || []).forEach(function (r) { if (refs.indexOf(r) < 0) refs.push(r); }); });
    var c = st.check[st.check.length - 1];
    if (c && c.read_at) {
      lines.push('Check: ' + squash(c.stem) + ' | options: ' + c.options.map(function (o) { return o.id + ') ' + squash(o.text); }).join(' '));
      if (c.answer) lines.push('Key: ' + c.key); else open = true;
    }
    var units = unitsOf(pkg);
    refs.forEach(function (r) { if (units[r]) lines.push(r + ' [' + (units[r].loc || '') + ']: ' + clip(units[r].text, 500)); });
    return { kind: 'live', ref: { session: s.id, step: st.n }, text: lines.join('\n'), refs: refs, open: open };
  }
  // A practice problem: its solution only after the problem has ended
  function practiceContext(s, p) {
    if (!p) return { kind: 'practice', ref: { session: s.id }, text: 'Practice: ' + squash(s.title), refs: [], open: false };
    var open = p.status === 'open', lines = ['Practice problem: ' + squash(p.statement)];
    if (!open && p.model_solution) lines.push('Solution: ' + clip(p.model_solution, 1500));
    return { kind: 'practice', ref: { session: s.id, problem: p.id }, text: lines.join('\n'), refs: [], open: open };
  }

  // Values for prompts\side-answerer.md
  // The first sentence of a Markdown text that states something, as the default claim of "Check this": headings, rules, code, list
  // marks, emphasis and links are dropped (a heading such as "# What is X?" is not a claim)
  function firstClaim(md) {
    var lines = String(md || '').replace(/```[\s\S]*?```/g, ' ').split(/\n/), out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l || /^#{1,6}\s/.test(l) || /^([-*_]\s*){3,}$/.test(l) || /^\|/.test(l) || /^>/.test(l) && !out.length && /\?\s*$/.test(l)) { if (out.length) break; continue; }
      l = l.replace(/^([-*+]|\d+[.)])\s+/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/^>\s*/, '');
      out.push(l);
      var joined = out.join(' '), m = joined.match(/^.*?[.!](?=\s|$)/);
      if (m && m[0].length >= 20) return m[0].slice(0, 400);
    }
    return out.join(' ').slice(0, 400);
  }

  function askInputs(ctx, question, history) {
    var h = (history || []).slice(-3).map(function (x) { return 'Q: ' + clip(x.q, 300) + '\nA: ' + clip(x.answer, 600); }).join('\n');
    return { context: ctx.text + (ctx.open ? '\n\n(This question or problem is still open: its answer and solution are hidden on purpose.)' : '') + (h ? '\n\nEarlier side questions here:\n' + h : ''), question: clip(question, 1200) };
  }
  // → problems []
  function checkAnswer(ctx, json) {
    var j = json || {}, problems = [];
    if (!squash(j.answer_md)) problems.push('answer_md is empty.');
    if (squash(j.answer_md).split(' ').length > 260) problems.push('The answer is too long: answer briefly (the learner can ask more).');
    return problems;
  }
  // Keeps the exchange. target: the list to append to (progress.side or session.side)
  function record(list, ctx, question, json, meta) {
    var m = meta && meta.meta || {}, pr = meta && meta.prompt || {};
    var known = {};
    (ctx.refs || []).forEach(function (r) { known[r] = true; });
    var e = { id: uid('sq'), at: (meta && meta.now) || Date.now(), context: ctx.kind, ref: ctx.ref, q: clip(question, 1200), answer: String(json.answer_md || '').trim().slice(0, 4000),
      // a reference the context does not hold is dropped (the answer may only cite what was on screen)
      uses: (json.uses || []).map(squash).filter(function (u) { return known[u]; }), beyond_source: !!json.beyond_source, uncertain: !!json.uncertain, during_open: !!ctx.open,
      origin: 'generated', validation: 'unverified', by: { provider: m.providerLabel || m.provider || null, model: m.model || null, prompt: { id: pr.promptId || 'side-answerer', version: pr.promptVersion || null } } };
    list.push(e);
    return e;
  }

  // ------------------------------------------------------------------ research requests (state.research)
  function researchOf(state) {
    if (!state.research || typeof state.research !== 'object') state.research = {};
    state.research.requests = state.research.requests || {};
    return state.research;
  }
  // target: { kind: "explanation" | "live" | "practice" | "side" | "job", ...ids } — the place a brief belongs to
  function newRequest(state, o) {
    var r = { id: uid('rq'), claim: clip(o.claim, 600), context: clip(o.context, 2000), sources: clip(o.sources, 800), target: o.target || null,
      status: 'starting', job_id: null, brief: null, error: null, at: o.now || Date.now() };
    researchOf(state).requests[r.id] = r;
    return r;
  }
  function requestsFor(state, match) {
    var all = researchOf(state).requests;
    return Object.keys(all).map(function (k) { return all[k]; }).filter(function (r) { return r.target && Object.keys(match).every(function (k) { return r.target[k] === match[k]; }); })
      .sort(function (a, b) { return a.at - b.at; });
  }
  // A finished job's result → the request (a brief is only kept with at least one source)
  function applyJob(state, reqId, job) {
    var r = researchOf(state).requests[reqId];
    if (!r || !job) return null;
    r.job_id = job.id;
    if (job.status === 'done' && job.result && job.result.brief) {
      var b = job.result.brief;
      r.brief = b; r.status = (b.sources || []).length ? 'done' : 'no_sources'; r.mode = job.result.mode || null; r.done_at = job.finished_at || Date.now();
      r.by = job.result.by || null;
    } else if (job.status === 'failed') { r.status = 'failed'; r.error = job.error || 'The research failed.'; }
    else r.status = job.status === 'paused' ? 'paused' : 'running';
    return r;
  }

  global.KSide = {
    lessonContext: lessonContext, itemContext: itemContext, liveContext: liveContext, practiceContext: practiceContext,
    askInputs: askInputs, checkAnswer: checkAnswer, record: record, firstClaim: firstClaim,
    researchOf: researchOf, newRequest: newRequest, requestsFor: requestsFor, applyJob: applyJob
  };
})(typeof window !== 'undefined' ? window : this);
