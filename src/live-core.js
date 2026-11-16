/*
 * Kartotek live teaching (KLive, task F4, LEARNING-PROTOCOL.md 1.2, 3.7). Pure, UI-independent.
 */
// After the probe and the plan, a live session teaches one reasoning step per turn:
//   1. Predict: a question about the next step before it is taught; the learner answers with thinking and confidence.
//   2. Teach: a short explanation that resolves the prediction and builds only on what the learner holds; written together with
//      3. Check: a closed question that needs the step applied, shown only after the learner says they have read the explanation.
//      Kartotek grades it against the key the model committed to. A miss means repair (the step taught another way, a new check)
//      before anything is built on it; a repair may reveal a missing foundation, which is inserted into the plan as a new version.
// The plan map follows the position (the node of the current step). Every question, answer, thinking text and confidence is kept in
// the session's transcript (state.sessions). Nothing here creates or rates a card, and nothing changes an outcome's evidence state
// (decision D1: a live session is "session evidence" only). Claims the model is unsure of are kept with the step and can be queued for
// the researcher (task F7: session.research, status "queued").
//
// Where the material comes from:
//   attached session: the chosen topics' source units (and the topics they build on), cited by unit id
//   own files: pages of the learner's files read locally (cached outside the learner data; only names and hashes are stored)
//   free session: no material; the teacher marks anything it is unsure of
(function (global) {
  'use strict';

  var BANNED = /\b(all|none|both|neither) of (the )?(above|these|them)\b|^i don'?t know$|^something else$/i;
  var MAX_WORDS = 220;          // "no walls of text": the prompt asks for about 150 words; more than this is refused
  function squash(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { s = squash(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function lines(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
  function norm(s) { return squash(s).toLowerCase().replace(/[.,;:!?]+$/, ''); }
  function unletter(s) { return String(s).replace(/^\(?[A-Ea-e][.)]\s+/, ''); }
  function words(s) { return squash(String(s || '').replace(/[#*_`>|$\\]/g, ' ')).split(' ').filter(Boolean).length; }
  function PL() { return global.KPlan; }
  function KG() { return global.KGraph; }
  function uid(p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ------------------------------------------------------------------ material
  // Own files: material = { files: [{ id: 'S1', name, unit }], pages: [{ ref: 'S1 p. 4', src, n, text }] } (read in the main process)
  // A label per unit kind: page → "p.", slide → "slide", section → "section", part → "part"
  function refLabel(src, unit, n) { return src + ' ' + (unit === 'slide' ? 'slide ' : unit === 'section' ? 'section ' : unit === 'part' ? 'part ' : 'p. ') + n; }
  function score(text, focus) {
    var f = {};
    squash(focus).toLowerCase().split(/[^a-z0-9À-ɏ]+/).filter(function (w) { return w.length > 3; }).forEach(function (w) { f[w] = 1; });
    var hits = 0;
    String(text).toLowerCase().split(/[^a-z0-9À-ɏ]+/).forEach(function (w) { if (f[w]) hits++; });
    return hits;
  }
  // The pages most related to a focus text, in reading order, within a character budget
  function filePages(material, focus, cap) {
    if (!material || !material.pages || !material.pages.length) return '';
    var budget = cap || 9000;
    var ranked = material.pages.map(function (p, i) { return { p: p, i: i, s: focus ? score(p.text, focus) : 0 }; })
      .sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    var pick = [], total = 0;
    ranked.forEach(function (r) { var t = clip(r.p.text, 1800); if (total + t.length > budget) return; total += t.length; pick.push({ i: r.i, line: '[' + r.p.ref + '] ' + t }); });
    pick.sort(function (a, b) { return a.i - b.i; });
    return pick.map(function (x) { return x.line; }).join('\n\n');
  }
  // An outline of the files (the first part of every page), for the probe and the planner
  function fileOutline(material, cap) {
    if (!material || !material.pages) return '';
    var budget = cap || 14000, out = [], total = 0;
    material.pages.forEach(function (p) { var line = '[' + p.ref + '] ' + clip(p.text, 360); if (total + line.length > budget) return; total += line.length; out.push(line); });
    return 'Files: ' + material.files.map(function (f) { return f.id + ' = ' + f.name; }).join(', ') + '\n' + out.join('\n');
  }
  // The references a reply may cite: unit ids (attached) or page labels (own files)
  function refSet(s, ctx) {
    var o = {};
    if (ctx && ctx.pkg) (ctx.pkg.units || []).forEach(function (u) { o[u.id] = true; });
    if (ctx && ctx.material) (ctx.material.pages || []).forEach(function (p) { o[p.ref] = true; });
    return o;
  }
  function sourceKind(s, ctx) { return ctx && ctx.pkg ? 'package' : ctx && ctx.material && ctx.material.pages && ctx.material.pages.length ? 'files' : 'none'; }

  // ------------------------------------------------------------------ the loop's state
  function stepsOf(s) { if (!Array.isArray(s.steps)) s.steps = []; return s.steps; }
  function lastStep(s) { var st = stepsOf(s); return st[st.length - 1] || null; }
  function attemptOf(st) { return st && st.check.length ? st.check[st.check.length - 1] : null; }
  function stepDone(st) { return !!st && !!st.closed_at; }
  // "predict" (ask the model for the next prediction) | "answer_predict" | "teach" | "read" | "answer_check" | "feedback" | "repair" |
  // "review" (the goal was reached: the self-report) | "paused" | "done" | "not_ready" (no accepted plan)
  function phase(s) {
    if (s.status === 'paused') return 'paused';
    if (s.status === 'done') return 'done';
    if (s.status === 'review') return 'review';
    var v = PL().currentPlan(s);
    if (!v || !v.accepted_at || s.status !== 'teach') return 'not_ready';
    var st = lastStep(s);
    if (!st || stepDone(st)) return 'predict';
    if (!st.predict.answer) return 'answer_predict';
    if (!st.teach.length) return 'teach';
    var a = attemptOf(st);
    if (!a) return st.teach[st.teach.length - 1].gap ? 'predict' : 'teach';
    if (!a.read_at) return 'read';
    if (!a.answer) return 'answer_check';
    if (!a.continued_at) return 'feedback';
    return a.correct ? 'predict' : 'repair';
  }
  // The call the window must make now: "predict" | "teach" | "repair" | null (waiting for the learner)
  function needsCall(s) { var p = phase(s); return p === 'predict' || p === 'teach' || p === 'repair' ? p : null; }

  // ------------------------------------------------------------------ the request (prompts\teacher.md)
  function planText(s) {
    var v = PL().currentPlan(s);
    if (!v) return '(no plan)';
    return 'Approach: ' + v.approach + '\nNodes (id, kind, label, needs):\n' + v.nodes.map(function (n) {
      return '- ' + n.id + ' (' + n.kind + (n.mode ? ', ' + n.mode : '') + ') ' + n.label + (n.depends_on.length ? ' ← needs ' + n.depends_on.join(', ') : '') + (n.units && n.units.length ? ' [' + n.units.join(', ') + ']' : '');
    }).join('\n');
  }
  function heldText(s) {
    var v = PL().currentPlan(s), out = [];
    if (v) v.nodes.forEach(function (n) { if (n.kind === 'held') out.push('- ' + n.label + ' (held: found by the probe)'); });
    stepsOf(s).forEach(function (st) { if (st.outcome === 'right') out.push('- step ' + st.n + ' on ' + st.node + ': "' + clip(st.check[st.check.length - 1].stem, 140) + '" answered right without repair'); });
    return out.length ? out.join('\n') : '(nothing held yet beyond the probe)';
  }
  function optText(q, id) { var o = (q.options || []).filter(function (x) { return x.id === id; })[0]; return o ? id + ') ' + o.text : id; }
  function answerLine(q, a) {
    if (!a) return '(not answered)';
    var what = a.dont_know ? '"I don\'t know"' : q.kind === 'open' ? 'wrote: "' + clip(a.text, 600) + '"' : 'chose ' + optText(q, a.choice) + (q.key ? (a.choice === q.key ? ' (right)' : ' (wrong; key ' + q.key + ')') : '');
    return what + (a.dont_know ? '' : ', confidence ' + a.confidence_pct + ' %') + '; thinking: ' + (squash(a.thinking) || '(empty)');
  }
  function historyText(s, maxDetailed) {
    var st = stepsOf(s), n = maxDetailed || 5, out = [];
    st.forEach(function (x, i) {
      if (i < st.length - n) { out.push('Step ' + x.n + ' (' + x.node + '): ' + (x.outcome || 'open') + (x.repairs ? ', ' + x.repairs + ' repair(s)' : '')); return; }
      var lines2 = ['Step ' + x.n + ' on node ' + x.node + ':', '  Predict: ' + clip(x.predict.stem, 400), '  Learner: ' + answerLine(x.predict, x.predict.answer)];
      x.teach.forEach(function (t, j) {
        lines2.push('  Teach' + (j ? ' (repair ' + j + ')' : '') + ': ' + clip(t.md, 900) + (t.gap ? ' [gap found: ' + t.gap.label + ']' : ''));
        var c = x.check[j];
        if (c) lines2.push('  Check: ' + clip(c.stem, 300) + ' | options: ' + c.options.map(function (o) { return o.id + ') ' + clip(o.text, 80); }).join(' ') + '\n  Learner: ' + answerLine(c, c.answer));
      });
      out.push(lines2.join('\n'));
    });
    (s.side || []).slice(-3).forEach(function (q) { out.push('Side question (answered by a helper, not by the learner): ' + clip(q.q, 200)); });
    return out.length ? out.join('\n\n') : 'none: this is the first step';
  }
  function learnerTurn(s) {
    var st = lastStep(s);
    // only for the first step after a "not yet" (later steps carry their own answers)
    if (s.end && s.end.feels_obvious === 'not_yet' && s.status === 'teach' && (!st || stepDone(st)) && !stepsOf(s).some(function (x) { return x.at > s.end.answered_at; })) return 'The learner said the goal does not feel obviously true yet; continue with what still needs a step.';
    if (!st) return 'none yet';
    var a = attemptOf(st);
    if (a && a.answer) return 'Check answer: ' + answerLine(a, a.answer);
    if (st.predict.answer) return 'Prediction: ' + answerLine(st.predict, st.predict.answer);
    return 'none yet';
  }
  var TASKS = {
    predict: 'PREDICT. Start the next reasoning step. Choose the node it is about (the "you are here" node or the next one the learner is ready for: every node it needs is held or taught) and set "node". Ask one prediction question about the step before it is taught: point at the problem the current state cannot handle and let the learner try to discover the next move. It may be multiple choice (kind "choice", 2 to 5 options, the key if there is one) or open (kind "open", no options). Reveal nothing. If every node up to the goal has been taught and checked and the goal now follows, answer with phase "done" instead.',
    teach: 'TEACH and CHECK. The learner has answered the prediction of the current step. Answer with phase "teach": resolve the prediction explicitly in "resolves" (what they predicted, what is true, why, in their own words where you can), then teach the one step in "md" (about 150 words at most, Markdown, no headings), with the references you used in "refs". Then write the check in "check": a closed multiple-choice question (2 to 5 options, one key) that needs the step applied to a new case, built so that each wrong option is the answer of a specific wrong model ("wrong_model"). The learner sees the check only after reading.',
    repair: 'REPAIR. The learner missed the check of the current step. Answer with phase "teach": diagnose from the chosen option, the confidence and the thinking which wrong model they hold, say it plainly in "resolves", teach the same step another way in "md" (about 150 words at most), and write a new check (a new case, not a reworded copy). If the miss shows that a foundation the plan assumed is missing, fill "gap" (label, why, before = the node that needs it) and leave the check empty: the foundation is taught first.'
  };
  // ctx: { pkg, material (own files), problems, research }
  function teacherInputs(s, task, ctx) {
    ctx = ctx || {};
    var v = PL().currentPlan(s), pos = s.plan && s.plan.position, node = v && v.nodes.filter(function (n) { return n.id === pos; })[0];
    var st = lastStep(s), cur = st && !stepDone(st) && v ? v.nodes.filter(function (n) { return n.id === st.node; })[0] : null;
    var focus = [s.goal.concrete || s.goal.learner_words, node && node.label, node && node.why, cur && cur.label].filter(Boolean).join(' ');
    var kind = sourceKind(s, ctx), material;
    if (kind === 'package') {
      var units = {};
      (ctx.pkg.units || []).forEach(function (u) { units[u.id] = u; });
      var ids = [];
      (v ? v.nodes : []).forEach(function (n) { if (n.kind !== 'held') (n.units || []).forEach(function (u) { if (ids.indexOf(u) < 0) ids.push(u); }); });
      if (s.attached && s.attached.topics) KG().topicsOf(ctx.pkg).forEach(function (t) { if (s.attached.topics.indexOf(t.kid) >= 0) t.units.forEach(function (u) { if (ids.indexOf(u) < 0) ids.push(u); }); });
      var total = 0, out = [];
      ids.forEach(function (id) { var u = units[id]; if (!u || total > 16000) return; var line = id + ' [' + (u.loc || 'no location') + ']: ' + clip(u.text, 700); total += line.length; out.push(line); });
      if ((ctx.pkg.conventions || []).length) out.unshift('Conventions: ' + ctx.pkg.conventions.map(squash).join(' | '));
      material = 'Source units of the study "' + ctx.pkg.title + '". Use nothing else; cite unit ids in "refs":\n' + out.join('\n');
    } else if (kind === 'files') {
      material = 'Pages of the learner\'s own files, the most related first in reading order. Use them as the source; cite page labels exactly as written in brackets (for example "S1 p. 4") in "refs":\n' + filePages(ctx.material, focus, 10000);
    } else material = '(a free session: no source material. Teach from what you know; put every claim you are not sure of in "uncertain".)';
    var probs = ctx.problems && ctx.problems.length ? ctx.problems.map(function (x) { return '- ' + x; }).join('\n') : 'none';
    return {
      plan: planText(s), position: 'You are here: ' + (pos || '(none)') + (node ? ' (' + node.label + ')' : '') + (cur && cur.id !== pos ? '\nCurrent step is on: ' + cur.id : '') + '\nSteps so far: ' + stepsOf(s).length,
      held: heldText(s), material: material, history: historyText(s), learner_turn: learnerTurn(s), task: TASKS[task], problems: probs
    };
  }

  // ------------------------------------------------------------------ checking a reply
  function optionProblems(opts, key, at, requireKey) {
    var problems = [], ids = {}, texts = {};
    if (!Array.isArray(opts) || opts.length < 2 || opts.length > 5) { problems.push(at + ' needs 2 to 5 options.'); return problems; }
    opts.forEach(function (o, i) {
      var id = squash(o && o.id), tx = squash(o && o.text);
      if (!id) problems.push(at + ': option ' + (i + 1) + ' has no id.');
      else if (ids[id]) problems.push(at + ': option id "' + id + '" is used twice.');
      ids[id] = 1;
      if (!tx) problems.push(at + ': option ' + (id || i + 1) + ' has no text.');
      else if (texts[norm(tx)]) problems.push(at + ': two options have the same text: "' + clip(tx, 80) + '".');
      else if (BANNED.test(norm(tx))) problems.push(at + ': option "' + tx + '" is not allowed (no "all/none of the above"; Kartotek adds "I don\'t know" itself).');
      texts[norm(tx)] = 1;
    });
    if (requireKey && !ids[squash(key)]) problems.push(at + ': "key" must be the id of exactly one option.');
    if (!requireKey && squash(key) && !ids[squash(key)]) problems.push(at + ': "key" is not one of the options (leave it empty if there is no single right prediction).');
    return problems;
  }
  function checkReply(s, task, json, ctx) {
    var j = json || {}, problems = [], v = PL().currentPlan(s);
    var nodes = {}; (v ? v.nodes : []).forEach(function (n) { nodes[n.id] = n; });
    var refs = refSet(s, ctx), kind = sourceKind(s, ctx);
    if (task === 'predict') {
      if (j.phase === 'done') {
        var goal = (v ? v.nodes : []).filter(function (n) { return n.kind === 'goal'; })[0];
        var goalTaught = goal && stepsOf(s).some(function (st) { return st.node === goal.id && (st.outcome === 'right' || st.outcome === 'right_after_repair'); });
        if (!goalTaught) problems.push('"done" is only possible once the goal node (' + (goal ? goal.id : '?') + ') has a step whose check was answered right. Ask the next prediction instead.');
        return { ok: !problems.length, problems: problems, kind: 'done' };
      }
      if (j.phase !== 'predict') return { ok: false, problems: ['"phase" must be "predict" (or "done" when the goal is reached) at this step.'] };
      var n = nodes[j.node];
      if (!n) problems.push('"node" must be a node of the current plan (' + Object.keys(nodes).join(', ') + ').');
      else if (n.kind === 'held') problems.push('Node "' + j.node + '" is held already: teach a node to learn or the goal.');
      var q = j.question || {};
      if (!squash(q.stem)) problems.push('question.stem is empty.');
      else if (stepsOf(s).some(function (st) { return norm(st.predict.stem) === norm(q.stem); })) problems.push('This prediction was already asked; ask a new one.');
      if (q.kind === 'choice') problems = problems.concat(optionProblems(q.options, q.key, 'The prediction', false));
      else if (q.kind !== 'open') problems.push('question.kind must be "choice" or "open".');
      return { ok: !problems.length, problems: problems, kind: 'predict' };
    }
    // teach / repair
    if (j.phase !== 'teach') return { ok: false, problems: ['"phase" must be "teach" at this step.'] };
    var t = j.teach || {}, gap = t.gap && squash(t.gap.label) ? t.gap : null;
    if (!squash(t.md)) problems.push('teach.md is empty.');
    else if (words(t.md) > MAX_WORDS) problems.push('teach.md has ' + words(t.md) + ' words; keep it to about 150 (at most ' + MAX_WORDS + '). One step, one fact.');
    if (task === 'teach' && !squash(t.resolves)) problems.push('teach.resolves is empty: resolve the learner\'s prediction first.');
    (t.refs || []).forEach(function (r) { if (kind !== 'none' && !refs[squash(r)]) problems.push('Reference "' + r + '" is not in the material (cite ' + (kind === 'package' ? 'unit ids such as U4' : 'page labels such as S1 p. 4') + ').'); });
    if (kind !== 'none' && !(t.refs || []).length && !gap) problems.push('teach.refs is empty: cite the ' + (kind === 'package' ? 'units' : 'pages') + ' the explanation rests on.');
    if (gap) {
      if (task !== 'repair') problems.push('A gap can only be reported in a repair.');
      var cur = lastStep(s);
      var before = squash(gap.before) || (cur && cur.node);
      if (!nodes[before]) problems.push('gap.before must be a node of the plan.');
    } else {
      var c = j.check || {};
      if (!squash(c.stem)) problems.push('check.stem is empty.');
      problems = problems.concat(optionProblems(c.options, c.key, 'The check', true));
      var st2 = lastStep(s);
      if (st2 && squash(c.stem) && (norm(c.stem) === norm(st2.predict.stem) || st2.check.some(function (x) { return norm(x.stem) === norm(c.stem); }))) problems.push('The check repeats an earlier question; ask about a new case.');
    }
    return { ok: !problems.length, problems: problems, kind: gap ? 'gap' : 'teach' };
  }

  // ------------------------------------------------------------------ applying a reply and the learner's actions
  function shuffle(a, rng) { var r = rng || Math.random; for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function prepQuestion(q, rng, kind) {
    if (kind === 'open') return { stem: lines(q.stem), kind: 'open', options: [], key: null };
    var letters = 'abcde', key = null;
    var opts = shuffle((q.options || []).map(function (o) { return { from: squash(o.id), text: unletter(lines(o.text)), wrong_model: squash(o.wrong_model) }; }), rng)
      .map(function (o, i) { if (squash(q.key) && o.from === squash(q.key)) key = letters[i]; return { id: letters[i], text: o.text, wrong_model: o.from === squash(q.key) ? '' : o.wrong_model }; });
    return { stem: lines(q.stem), kind: 'choice', options: opts, key: key };
  }
  function byOf(ctx) {
    var m = (ctx && ctx.meta) || {}, pr = (ctx && ctx.prompt) || {};
    return { provider: m.providerLabel || m.provider || null, model: m.model || null, prompt: { id: pr.promptId || 'teacher', version: pr.promptVersion || null, hash: pr.promptHash || null },
      cost_usd: typeof m.costUsd === 'number' ? m.costUsd : null, cost_kind: m.costKind || null };
  }
  function count(s, by) {
    s.usage = s.usage || { calls: 0, cost_usd: 0 };
    s.usage.calls++;
    if (typeof by.cost_usd === 'number') s.usage.cost_usd = Math.round((s.usage.cost_usd + by.cost_usd) * 1e6) / 1e6;
    s.generator = s.generator || [];
    s.generator.push({ at: Date.now(), provider: by.provider, model: by.model, prompt_id: by.prompt.id, prompt_version: by.prompt.version });
  }
  // ctx: { now, meta, prompt, rng, pkg, material }
  function applyReply(s, task, json, ctx) {
    ctx = ctx || {};
    var c = checkReply(s, task, json, ctx);
    if (!c.ok) throw new Error('KLive.applyReply: ' + c.problems.join(' '));
    var now = ctx.now || Date.now(), by = byOf(ctx);
    count(s, by);
    s.updated_at = now;
    if (c.kind === 'done') {
      s.status = 'review';
      s.end = { at: now, summary: clip(json.done_summary, 1200), feels_obvious: null, by: by };
      return { kind: 'done' };
    }
    if (c.kind === 'predict') {
      var q = prepQuestion(json.question, ctx.rng, json.question.kind);
      var st = { n: stepsOf(s).length + 1, node: json.node, at: now, predict: Object.assign(q, { why: clip(json.question.why, 600), answer: null, correct: null, origin: 'generated', validation: 'unverified', by: by }),
        teach: [], check: [], repairs: 0, outcome: null, closed_at: null };
      s.steps.push(st);
      try { PL().setPosition(s, json.node, now); } catch (e) { /* checked above */ }
      return { kind: 'predict', step: st };
    }
    var cur = lastStep(s), t = json.teach;
    var entry = { md: lines(t.md), resolves: lines(t.resolves), refs: (t.refs || []).map(squash).filter(Boolean), uncertain: (t.uncertain || []).map(function (x) { return clip(x, 400); }).filter(Boolean),
      repair: task === 'repair', at: now, origin: 'generated', validation: 'unverified', by: by, gap: null };
    cur.teach.push(entry);
    if (task === 'repair') cur.repairs++;
    if (c.kind === 'gap') {
      var g = { before: squash(t.gap.before) || cur.node, label: clip(t.gap.label, 120), why: clip(t.gap.why, 400) };
      entry.gap = g;
      g.inserted = PL().insertGap(s, g, now);
      cur.outcome = 'gap'; cur.closed_at = now;
      return { kind: 'gap', inserted: g.inserted };
    }
    var chk = prepQuestion(json.check, ctx.rng, 'choice');
    cur.check.push(Object.assign(chk, { read_at: null, answer: null, correct: null, continued_at: null, help: [], at: now, origin: 'generated', validation: 'unverified', by: by }));
    return { kind: 'teach' };
  }
  // The learner's answer: { choice | text, confidence_pct, dont_know, thinking }
  function cleanAnswer(q, a, now) {
    a = a || {};
    var dk = !!a.dont_know;
    if (!dk && q.kind === 'open' && !squash(a.text)) throw new Error('Write your prediction, or choose "I don\'t know".');
    if (!dk && q.kind !== 'open' && !q.options.some(function (o) { return o.id === a.choice; })) throw new Error('Choose an option, or "I don\'t know".');
    var conf = dk ? null : Math.round(Number(a.confidence_pct));
    if (!dk && !(conf >= 0 && conf <= 100)) throw new Error('Set how sure you are first.');
    return { choice: dk || q.kind === 'open' ? null : a.choice, text: q.kind === 'open' && !dk ? String(a.text).slice(0, 4000) : '', dont_know: dk, confidence_pct: conf, thinking: String(a.thinking || '').slice(0, 4000), at: now || Date.now() };
  }
  function answerPredict(s, a, now) {
    var st = lastStep(s);
    if (!st || phase(s) !== 'answer_predict') throw new Error('There is no open prediction.');
    st.predict.answer = cleanAnswer(st.predict, a, now);
    st.predict.correct = st.predict.kind === 'choice' && st.predict.key ? (!st.predict.answer.dont_know && st.predict.answer.choice === st.predict.key) : null;
    s.updated_at = st.predict.answer.at;
    return st;
  }
  // "I've read it": the check becomes visible (its time is kept: a check shown without reading time is noted)
  function markRead(s, now) {
    var a = attemptOf(lastStep(s));
    if (!a || phase(s) !== 'read') throw new Error('There is nothing to read now.');
    a.read_at = now || Date.now();
    s.updated_at = a.read_at;
  }
  function answerCheck(s, a, now) {
    var st = lastStep(s), c = attemptOf(st);
    if (!c || phase(s) !== 'answer_check') throw new Error('There is no open check.');
    c.answer = cleanAnswer(c, a, now);
    c.correct = !c.answer.dont_know && c.answer.choice === c.key;
    if (c.correct) st.outcome = st.repairs ? 'right_after_repair' : 'right';
    s.updated_at = c.answer.at;
    return c;
  }
  // After the feedback: a right check closes the step; a miss leads to a repair
  function continueStep(s, now) {
    var st = lastStep(s), c = attemptOf(st);
    if (!c || phase(s) !== 'feedback') throw new Error('Nothing to continue.');
    c.continued_at = now || Date.now();
    if (c.correct) st.closed_at = c.continued_at;
    s.updated_at = c.continued_at;
  }
  function pause(s, now) { if (s.status === 'paused' || s.status === 'done') return; s.paused_from = s.status; s.status = 'paused'; s.paused_at = now || Date.now(); s.updated_at = s.paused_at; (s.pauses = s.pauses || []).push({ at: s.paused_at, from: s.paused_from }); }
  function resume(s, now) { if (s.status !== 'paused') return; s.status = s.paused_from || 'teach'; s.paused_from = null; s.updated_at = now || Date.now(); (s.pauses || []).slice(-1).forEach(function (p) { p.resumed_at = s.updated_at; }); }
  // The end of a session (D14): "Does this now feel obviously true?" — a self-report, never evidence
  function endReport(s, feels, now) {
    if (s.status !== 'review') throw new Error('The session has not reached its goal.');
    s.end.feels_obvious = feels === 'yes' ? 'yes' : 'not_yet';
    s.end.answered_at = now || Date.now();
    s.status = feels === 'yes' ? 'done' : 'teach';
    s.updated_at = s.end.answered_at;
  }
  // Hook for the researcher (task F7): a claim the teacher marked as unsure, queued with its context and references
  function queueResearch(s, stepN, teachIdx, claim, now) {
    var st = stepsOf(s).filter(function (x) { return x.n === stepN; })[0], t = st && st.teach[teachIdx];
    if (!t || t.uncertain.indexOf(claim) < 0) throw new Error('No such unsure claim.');
    s.research = s.research || [];
    var have = s.research.filter(function (r) { return r.step === stepN && r.claim === claim; })[0];
    if (have) return have;
    var r = { id: uid('rq'), claim: claim, context: clip(t.md, 1200), refs: t.refs.slice(), step: stepN, teach: teachIdx, status: 'queued', at: now || Date.now(), brief: null };
    s.research.push(r);
    return r;
  }

  // ------------------------------------------------------------------ summaries (session evidence, never states)
  function summary(s) {
    var st = stepsOf(s), done = st.filter(function (x) { return x.outcome === 'right' || x.outcome === 'right_after_repair'; });
    return {
      steps: st.length, completed: done.length, right_first: st.filter(function (x) { return x.outcome === 'right'; }).length,
      after_repair: st.filter(function (x) { return x.outcome === 'right_after_repair'; }).length, gaps: st.filter(function (x) { return x.outcome === 'gap'; }).length,
      repairs: st.reduce(function (a, x) { return a + (x.repairs || 0); }, 0),
      predictions_right: st.filter(function (x) { return x.predict.correct === true; }).length, predictions_scored: st.filter(function (x) { return x.predict.correct !== null && x.predict.answer; }).length
    };
  }
  // Every answer of the session with confidence, for the "generated questions" calibration view (never the main one)
  function confidenceRecords(s) {
    var out = [];
    stepsOf(s).forEach(function (st) {
      if (st.predict.answer && st.predict.correct !== null && !st.predict.answer.dont_know) out.push({ kind: 'predict', pct: st.predict.answer.confidence_pct, correct: st.predict.correct });
      st.check.forEach(function (c) { if (c.answer && !c.answer.dont_know) out.push({ kind: 'check', pct: c.answer.confidence_pct, correct: c.correct }); });
    });
    return out;
  }

  global.KLive = {
    MAX_WORDS: MAX_WORDS, refLabel: refLabel, filePages: filePages, fileOutline: fileOutline, sourceKind: sourceKind,
    phase: phase, needsCall: needsCall, lastStep: lastStep, attemptOf: attemptOf, teacherInputs: teacherInputs, checkReply: checkReply, applyReply: applyReply,
    answerPredict: answerPredict, markRead: markRead, answerCheck: answerCheck, continueStep: continueStep, pause: pause, resume: resume, endReport: endReport,
    queueResearch: queueResearch, summary: summary, confidenceRecords: confidenceRecords
  };
})(typeof window !== 'undefined' ? window : this);
