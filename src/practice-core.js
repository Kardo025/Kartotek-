/*
 * Kartotek adaptive practice (KPractice, task F5, LEARNING-PROTOCOL.md 3.8, 3.9). Pure, UI-independent.
 */
// Practice runs (state.sessions, kind "practice"): Evaluating of a topic, free practice from the Study library, and problems the learner
// brings. One problem at a time:
//   the code chooses the demand (targets, difficulty, retest) → the coach writes the problem and its solution → the coach solves it again
//   and fixes the solution (or rejects the problem) before it is shown → the learner works in the thinking field and claims an answer →
//   the coach decides whether it is solved (checked in code against the committed answer) → otherwise hints from the hint ladder (F2).
// Difficulty is one number, 1 to 6, made of how many ideas a problem combines and how unfamiliar its setting is; it goes one notch up after
// a clean solve, holds after a helped solve and goes one notch down after a miss. From the third problem on, problems that combine ideas
// mix in an earlier topic of the same part. Every missed problem comes back once in a different setting before the run ends.
// Generated problems never reach the scheduler and never change an outcome's evidence state (D1: session evidence only); a learner can
// report a problem (disputed), which leaves it out of every count.
(function (global) {
  'use strict';

  var LEVELS = [
    null,
    { level: 1, ideas: 1, setting: 'familiar', mode: 'recall' },
    { level: 2, ideas: 1, setting: 'new', mode: 'recall' },
    { level: 3, ideas: 2, setting: 'familiar', mode: 'discrimination' },
    { level: 4, ideas: 2, setting: 'new', mode: 'composition' },
    { level: 5, ideas: 3, setting: 'new', mode: 'composition' },
    { level: 6, ideas: 3, setting: 'far', mode: 'composition' }
  ];
  var SETTING_TEXT = {
    familiar: 'the kind of situation the lesson used, with new values',
    new: 'a kind of situation not used yet for these ideas in this run',
    far: 'an unfamiliar context (another field or an everyday situation) where the ideas still apply'
  };
  var RUN = 5;
  function squash(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { s = squash(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function lines(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
  function uid(p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function KG() { return global.KGraph; }
  function KC() { return global.KCycle; }

  // ------------------------------------------------------------------ targets
  // The outcomes of a topic, then those of the earlier topics of the same part (earlier: true)
  function targetsFor(pkg, kid) {
    var topics = KG().topicsOf(pkg), here = topics.filter(function (t) { return t.kid === kid; })[0];
    if (!here) return [];
    var mk = function (t, earlier) { return t.outcomes.map(function (o) { return { id: o.id, label: squash(o.performance), criteria: (o.criteria || []).map(function (c) { return squash(c.text); }), units: (o.units || []).slice(), kid: t.kid, topic: squash(t.title), earlier: earlier }; }); };
    var out = mk(here, false);
    topics.filter(function (t) { return t.part_id === here.part_id && t.ti < here.ti; }).forEach(function (t) { out = out.concat(mk(t, true)); });
    return out;
  }
  // Free practice in the learner's words: one target per line
  function targetsFromWords(text) {
    return String(text || '').split(/\n+/).map(squash).filter(Boolean).slice(0, 8).map(function (l, i) { return { id: 't' + (i + 1), label: clip(l, 200), criteria: [], units: [], kid: null, topic: '', earlier: false }; });
  }

  // ------------------------------------------------------------------ the session
  // opts: { purpose: "evaluating" | "free", title, etut_id, kids, targets, length, now }
  function newSession(state, opts) {
    var now = opts.now || Date.now();
    if (!state.sessions || typeof state.sessions !== 'object') state.sessions = {};
    var s = {
      id: uid('ls'), kind: 'practice', purpose: opts.purpose === 'evaluating' ? 'evaluating' : 'free', title: clip(opts.title || 'Practice', 120),
      created_at: now, updated_at: now, status: 'practice',
      attached: opts.etut_id ? { etut_id: opts.etut_id, topics: (opts.kids || []).slice() } : null,
      targets: opts.targets || [], length: opts.length || RUN, problems: [], generator: [], usage: { calls: 0, cost_usd: 0 }
    };
    state.sessions[s.id] = s;
    return s;
  }
  function problemsOf(s) { if (!Array.isArray(s.problems)) s.problems = []; return s.problems; }
  // The problems that count: not reported, not the learner's own, not a draft the coach rejected in its own check
  function counted(s) { return problemsOf(s).filter(function (p) { return !p.disputed && p.origin !== 'learner' && p.status !== 'rejected'; }); }
  function lastProblem(s) { var l = problemsOf(s); return l[l.length - 1] || null; }
  function missed(p) { return p.outcome === 'given_up' || p.outcome === 'moved_on'; }
  function hintTop(p) { var top = -1; (p.help || []).forEach(function (h) { if (h.kind === 'model_hint') { var n = KC().RUNGS.indexOf(h.level); if (n > top) top = n; } }); return top; }

  // ------------------------------------------------------------------ choosing the next demand (code)
  function levelNow(s) {
    var lvl = 1;
    counted(s).forEach(function (p) {
      if (p.retest_of || !p.outcome) return;
      if (p.outcome === 'solved') lvl = Math.min(6, (p.difficulty ? p.difficulty.level : lvl) + 1);
      else if (p.outcome === 'solved_with_hints') lvl = p.difficulty ? p.difficulty.level : lvl;
      else lvl = Math.max(1, (p.difficulty ? p.difficulty.level : lvl) - 1);
    });
    return lvl;
  }
  function targetStats(s) {
    var st = {};
    s.targets.forEach(function (t, i) { st[t.id] = { score: 0, last: -1, order: i, t: t }; });
    counted(s).forEach(function (p, i) {
      (p.targets || []).forEach(function (id) {
        var x = st[id]; if (!x) return;
        x.last = i;
        if (p.outcome === 'solved') x.score += 1; else if (p.outcome === 'solved_with_hints') x.score += 0.5; else if (missed(p)) x.score -= 2;
      });
    });
    return st;
  }
  function pick(list, st) {
    return list.slice().sort(function (a, b) { var x = st[a.id], y = st[b.id]; return x.score - y.score || x.last - y.last || x.order - y.order; })[0] || null;
  }
  // { level, ideas, setting, mode, targets: [ids], retest_of } or null when the run is complete
  function nextSpec(s) {
    var main = counted(s).filter(function (p) { return !p.retest_of; });
    if (main.length < s.length) {
      var L = LEVELS[levelNow(s)], st = targetStats(s);
      var cur = s.targets.filter(function (t) { return !t.earlier; }), early = s.targets.filter(function (t) { return t.earlier; });
      var first = pick(cur.length ? cur : s.targets, st), chosen = first ? [first.id] : [];
      for (var k = 1; k < L.ideas; k++) {
        var rest = (main.length >= 2 && early.length && !chosen.some(function (id) { return st[id] && st[id].t.earlier; }) ? early : cur.concat(early)).filter(function (t) { return chosen.indexOf(t.id) < 0; });
        var nx = pick(rest, st);
        if (nx) chosen.push(nx.id);
      }
      return { level: L.level, ideas: L.ideas, setting: L.setting, mode: L.mode, targets: chosen, retest_of: null };
    }
    var back = counted(s).filter(function (p) { return !p.retest_of && missed(p) && !counted(s).some(function (q) { return q.retest_of === p.id; }); })[0];
    if (back) {
      var d = back.difficulty || LEVELS[1];
      return { level: d.level, ideas: d.ideas, setting: d.setting === 'familiar' ? 'new' : 'far', mode: d.mode, targets: (back.targets || []).slice(), retest_of: back.id };
    }
    return null;
  }

  // "write" (ask for the next problem) | "check" (the coach solves its draft again) | "own" (the coach solves the learner's problem) |
  // "work" (the learner works) | "verdict" (a claimed answer waits for the coach) | "between" (ended; "Next problem") |
  // "complete" (the run is over: finish) | "done" | "paused"
  function phase(s) {
    if (s.status === 'done') return 'done';
    if (s.status === 'paused') return 'paused';
    var p = lastProblem(s);
    if (p && p.status === 'draft') return 'check';
    if (p && p.status === 'own_draft') return 'own';
    if (p && p.status === 'open') { var sub = (p.submissions || []).slice(-1)[0]; return sub && !sub.verdict ? 'verdict' : 'work'; }
    if (p && p.status === 'ended' && !p.next_at) return 'between';
    if (s.own_pending) return 'own';
    // three drafts in a row rejected by the coach's own check: stop and say so instead of looping
    var l = problemsOf(s), r = 0;
    for (var i = l.length - 1; i >= (s.retry_from || 0) && l[i].status === 'rejected'; i--) r++;
    if (r >= 3) return 'stuck';
    return nextSpec(s) ? 'write' : 'complete';
  }
  function needsCall(s) { var p = phase(s); return p === 'write' || p === 'check' || p === 'verdict' || p === 'own' ? p : null; }

  // ------------------------------------------------------------------ the coach's request (prompts\practice-coach.md)
  function targetsText(s) {
    return s.targets.map(function (t) { return '- ' + t.id + ': ' + t.label + (t.topic ? ' (topic: ' + t.topic + (t.earlier ? ', an earlier topic' : '') + ')' : '') + (t.criteria.length ? '\n  Criteria: ' + t.criteria.join(' | ') : ''); }).join('\n');
  }
  function materialText(s, ctx) {
    if (ctx && ctx.pkg) {
      var units = {}, ids = [], out = [], total = 0;
      (ctx.pkg.units || []).forEach(function (u) { units[u.id] = u; });
      s.targets.forEach(function (t) { t.units.forEach(function (u) { if (ids.indexOf(u) < 0) ids.push(u); }); });
      ids.forEach(function (id) { var u = units[id]; if (!u || total > 14000) return; var l = id + ' [' + (u.loc || '') + ']: ' + clip(u.text, 700); total += l.length; out.push(l); });
      if ((ctx.pkg.conventions || []).length) out.unshift('Conventions: ' + ctx.pkg.conventions.map(squash).join(' | '));
      return 'Source units of the study "' + ctx.pkg.title + '" (problems stay within them and use their notation):\n' + out.join('\n');
    }
    return '(free practice: no source material; stay within what the targets name and mark nothing as settled that you are unsure of)';
  }
  function problemLine(p, i) {
    var sub = (p.submissions || []).slice(-1)[0];
    return 'P' + (i + 1) + (p.origin === 'learner' ? ' (the learner\'s own problem)' : '') + ' [targets ' + (p.targets || []).join(', ') + '; ' + (p.difficulty ? 'level ' + p.difficulty.level + ', ' + p.difficulty.ideas + ' idea(s), ' + p.difficulty.setting + ' setting, ' + p.mode : '') + (p.retest_of ? '; retest' : '') + ']'
      + '\n  Setting: ' + clip(p.setting, 160) + '\n  Statement: ' + clip(p.statement, 500)
      + '\n  Outcome: ' + (p.outcome || 'open') + (hintTop(p) >= 0 ? ', highest hint ' + KC().RUNGS[hintTop(p)] : '') + (p.disputed ? ' (reported by the learner as faulty)' : '')
      + (sub ? '\n  Last claim: ' + clip(sub.answer || '(no separate answer)', 200) + ' → ' + (sub.verdict ? sub.verdict.result : 'waiting') : '');
  }
  function historyText(s) { var l = problemsOf(s); return l.length ? l.map(problemLine).join('\n') : 'none: this is the first problem'; }
  function learnerTurn(s) {
    var p = lastProblem(s);
    if (!p || p.status !== 'open') return 'Next problem';
    var sub = (p.submissions || []).slice(-1)[0];
    if (!sub) return 'nothing yet';
    return 'Claimed answer: ' + (squash(sub.answer) || '(none in the answer box; read the thinking)') + (sub.confidence_pct != null ? ', confidence ' + sub.confidence_pct + ' %' : '') + '\nThinking:\n' + (sub.thinking || '(empty)')
      + ((p.help || []).length ? '\nHints given so far: ' + p.help.map(function (h) { return h.level + ': ' + clip(h.text, 200); }).join(' | ') : '');
  }
  function taskText(s, task) {
    var p = lastProblem(s);
    if (task === 'write') {
      var sp = nextSpec(s), names = sp.targets.map(function (id) { var t = s.targets.filter(function (x) { return x.id === id; })[0]; return id + (t ? ' (' + t.label + ')' : ''); });
      var orig = sp.retest_of ? problemsOf(s).filter(function (x) { return x.id === sp.retest_of; })[0] : null;
      return 'WRITE a new problem. Answer with task "problem".\nTargets (exactly these): ' + names.join('; ') + '.\nDifficulty: level ' + sp.level + ' of 6 = ' + sp.ideas + ' idea(s) combined, setting: ' + SETTING_TEXT[sp.setting] + '. Mode: ' + sp.mode + '.\n'
        + (orig ? 'This is a RETEST of P' + (problemsOf(s).indexOf(orig) + 1) + ', which the learner missed: the same ideas in a clearly different setting (not "' + clip(orig.setting, 120) + '"), never a reworded copy.\n' : '')
        + 'Aim for a problem this learner can solve with effort. Solve it yourself and commit the model solution step by step and the final answer.';
    }
    if (task === 'check') return 'CHECK your own problem before the learner sees it. Answer with task "check". Solve the statement below again from scratch, without trusting the draft solution, then compare: fix the solution or the answer if the draft was wrong, and set "sound" to false if the problem is ambiguous, unsolvable from what it states, needs something outside the material, or can be solved by a shortcut that skips its targets.\nStatement:\n' + p.statement + '\nDraft solution:\n' + p.model_solution + '\nDraft answer: ' + (p.answer || '(none)');
    if (task === 'verdict') return 'JUDGE the learner\'s claimed answer. Answer with task "verdict": "solved" only if the reasoning and the answer are right (a right number from a wrong method is not solved); "not_yet" when it is incomplete or wrong. Localise the first break without giving the correction. Committed model solution (for you only):\n' + p.model_solution + '\nCommitted answer: ' + (p.answer || '(none)');
    if (task === 'own') return 'The learner brought their OWN problem. Answer with task "own": solve it first, step by step, with the final answer; say whether it is solvable and unambiguous from what is given ("solvable"; if not, "issue" says what is missing); list which of the targets (ids) any correct solution must use (may be empty).\nThe problem as given:\n' + (s.own_pending ? s.own_pending.text : p ? p.statement : '');
    return '';
  }
  function coachInputs(s, task, ctx) {
    var probs = ctx && ctx.problems && ctx.problems.length ? ctx.problems.map(function (x) { return '- ' + x; }).join('\n') : 'none';
    return { outcomes: targetsText(s), material: materialText(s, ctx), history: historyText(s), learner_turn: learnerTurn(s), task: taskText(s, task), problems: probs };
  }

  // ------------------------------------------------------------------ checking and applying the coach's replies
  function numberIn(s) { var m = String(s || '').replace(/(\d)[\s,](?=\d{3}\b)/g, '$1').match(/[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?/i); return m ? Number(m[0]) : null; }
  function sameNumber(a, b) { if (a == null || b == null) return true; var d = Math.abs(a - b), m = Math.max(Math.abs(a), Math.abs(b)); return d <= 1e-9 || d / m <= 0.01; }
  function checkReply(s, task, json, ctx) {
    var j = json || {}, problems = [], ids = {};
    s.targets.forEach(function (t) { ids[t.id] = true; });
    var p = lastProblem(s);
    if (task === 'write') {
      if (j.task !== 'problem') return { ok: false, problems: ['"task" must be "problem".'] };
      var q = j.problem || {}, sp = nextSpec(s);
      if (!squash(q.statement)) problems.push('problem.statement is empty.');
      if (squash(q.statement).length > 3000) problems.push('problem.statement is too long.');
      if (!squash(q.solution)) problems.push('problem.solution is empty: solve the problem and commit the solution before posing it.');
      var tg = (q.targets || []).map(squash);
      if (!tg.length) problems.push('problem.targets is empty.');
      tg.forEach(function (t) { if (!ids[t]) problems.push('Target "' + t + '" is not one of the targets.'); });
      if (sp && sp.targets.some(function (t) { return tg.indexOf(t) < 0; })) problems.push('The problem must use exactly these targets: ' + sp.targets.join(', ') + '.');
      if (problemsOf(s).some(function (x) { return squash(x.statement).toLowerCase() === squash(q.statement).toLowerCase(); })) problems.push('This problem was already given; write a new one.');
      return { ok: !problems.length, problems: problems };
    }
    if (task === 'check') {
      if (j.task !== 'check') return { ok: false, problems: ['"task" must be "check".'] };
      var c = j.check || {};
      if (typeof c.sound !== 'boolean') problems.push('check.sound must be true or false.');
      if (c.sound && !squash(c.solution)) problems.push('check.solution is empty.');
      if (c.sound === false && !squash(c.issue)) problems.push('check.issue must say what is wrong with the problem.');
      return { ok: !problems.length, problems: problems };
    }
    if (task === 'verdict') {
      if (j.task !== 'verdict') return { ok: false, problems: ['"task" must be "verdict".'] };
      var v = j.verdict || {}, sub = p && (p.submissions || []).slice(-1)[0];
      if (['solved', 'not_yet'].indexOf(v.result) < 0) problems.push('verdict.result must be "solved" or "not_yet".');
      if (v.result === 'not_yet' && !squash(v.first_break)) problems.push('verdict.first_break must localise where the work first goes wrong (without the correction).');
      // a "solved" against the committed number is refused: the answer box disagrees with the answer the coach committed to
      if (v.result === 'solved' && sub && p.answer && squash(sub.answer) && numberIn(p.answer) != null && numberIn(sub.answer) != null && !sameNumber(numberIn(p.answer), numberIn(sub.answer))) {
        problems.push('The learner\'s answer (' + squash(sub.answer) + ') does not match the committed answer (' + squash(p.answer) + '), so it cannot be "solved". Judge again.');
      }
      if (v.result === 'solved' && sub && !squash(sub.answer) && !squash(sub.thinking)) problems.push('There is no work to call solved.');
      return { ok: !problems.length, problems: problems };
    }
    if (task === 'own') {
      if (j.task !== 'own') return { ok: false, problems: ['"task" must be "own".'] };
      var o = j.own || {};
      if (typeof o.solvable !== 'boolean') problems.push('own.solvable must be true or false.');
      if (o.solvable && !squash(o.solution)) problems.push('own.solution is empty: solve the problem first.');
      if (o.solvable === false && !squash(o.issue)) problems.push('own.issue must say what is missing or ambiguous.');
      (o.targets || []).forEach(function (t) { if (!ids[squash(t)]) problems.push('Target "' + t + '" is not one of the targets.'); });
      return { ok: !problems.length, problems: problems };
    }
    return { ok: false, problems: ['unknown task'] };
  }
  function byOf(ctx) {
    var m = (ctx && ctx.meta) || {}, pr = (ctx && ctx.prompt) || {};
    return { provider: m.providerLabel || m.provider || null, model: m.model || null, prompt: { id: pr.promptId || 'practice-coach', version: pr.promptVersion || null, hash: pr.promptHash || null },
      cost_usd: typeof m.costUsd === 'number' ? m.costUsd : null, cost_kind: m.costKind || null };
  }
  function count(s, by, now) {
    s.usage = s.usage || { calls: 0, cost_usd: 0 };
    s.usage.calls++;
    if (typeof by.cost_usd === 'number') s.usage.cost_usd = Math.round((s.usage.cost_usd + by.cost_usd) * 1e6) / 1e6;
    (s.generator = s.generator || []).push({ at: now, provider: by.provider, model: by.model, prompt_id: by.prompt.id, prompt_version: by.prompt.version });
    s.updated_at = now;
  }
  // ctx: { now, meta, prompt }
  function applyReply(s, task, json, ctx) {
    ctx = ctx || {};
    var c = checkReply(s, task, json, ctx);
    if (!c.ok) throw new Error('KPractice.applyReply: ' + c.problems.join(' '));
    var now = ctx.now || Date.now(), by = byOf(ctx), p = lastProblem(s);
    count(s, by, now);
    if (task === 'write') {
      var sp = nextSpec(s), q = json.problem;
      var np = { id: uid('pp'), n: problemsOf(s).length + 1, origin: 'generated', validation: 'unverified', status: 'draft', targets: (q.targets || []).map(squash),
        mode: sp.mode, template: squash(q.template) || null, difficulty: { level: sp.level, ideas: sp.ideas, setting: sp.setting }, setting: clip(q.setting, 300), statement: lines(q.statement),
        model_solution: lines(q.solution), answer: clip(q.answer, 300), draft: { solution: lines(q.solution), answer: clip(q.answer, 300) }, check: null, retest_of: sp.retest_of,
        submissions: [], help: [], outcome: null, highest_rung: null, at: now, by: by, rejected: [] };
      problemsOf(s).push(np);
      return np;
    }
    if (task === 'check') {
      var ck = json.check;
      p.check = { at: now, sound: ck.sound, issue: clip(ck.issue, 600), // "changed" = the check changed the committed answer (a reworded solution is not a correction)
        changed: !!ck.sound && !!squash(ck.answer) && squash(ck.answer).toLowerCase() !== squash(p.answer).toLowerCase(), reworded: !!ck.sound && lines(ck.solution) !== p.model_solution, by: by };
      if (!ck.sound) {
        // a rejected draft is kept in the record and never shown; the same demand is written again
        p.status = 'rejected';
        return p;
      }
      p.model_solution = lines(ck.solution);
      p.answer = clip(ck.answer, 300) || p.answer;
      p.status = 'open';
      p.shown_at = now;
      return p;
    }
    if (task === 'verdict') {
      var sub = p.submissions[p.submissions.length - 1], v = json.verdict;
      sub.verdict = { result: v.result, first_break: clip(v.first_break, 600), feedback: clip(v.feedback, 800), moves: clip(v.moves, 600), at: now, by: by };
      if (v.result === 'solved') endProblem(p, hintTop(p) >= 0 ? 'solved_with_hints' : 'solved', now);
      return sub;
    }
    if (task === 'own') {
      var o = json.own, pend = s.own_pending;
      var op = { id: uid('pp'), n: problemsOf(s).length + 1, origin: 'learner', validation: 'unverified', status: o.solvable ? 'open' : 'ended', targets: (o.targets || []).map(squash),
        mode: null, template: null, difficulty: null, setting: pend && pend.source ? 'from ' + pend.source : 'pasted by the learner', statement: lines(pend ? pend.text : ''),
        model_solution: lines(o.solution), answer: clip(o.answer, 300), solvable: !!o.solvable, issue: clip(o.issue, 600), retest_of: null,
        submissions: [], help: [], outcome: o.solvable ? null : 'unsolvable', highest_rung: null, at: now, shown_at: now, by: by, ended_at: o.solvable ? null : now };
      problemsOf(s).push(op);
      s.own_pending = null;
      return op;
    }
  }
  function endProblem(p, outcome, now) {
    p.status = 'ended'; p.outcome = outcome; p.ended_at = now || Date.now();
    var top = hintTop(p);
    p.highest_rung = top >= 0 ? KC().RUNGS[top] : null;
  }

  // ------------------------------------------------------------------ the learner
  function openProblem(s) { var p = lastProblem(s); if (!p || p.status !== 'open') throw new Error('There is no open problem.'); return p; }
  // A claimed answer: { thinking, answer, confidence_pct } (the answer box is optional; the thinking holds the work)
  function submit(s, a, now) {
    var p = openProblem(s);
    if (phase(s) !== 'work') throw new Error('Wait for the verdict on your last answer.');
    a = a || {};
    if (!squash(a.thinking) && !squash(a.answer)) throw new Error('Write your work in the thinking field first.');
    var conf = a.confidence_pct == null || a.confidence_pct === '' ? null : Math.round(Number(a.confidence_pct));
    p.submissions.push({ at: now || Date.now(), thinking: String(a.thinking || '').slice(0, 6000), answer: String(a.answer || '').slice(0, 600), confidence_pct: conf >= 0 && conf <= 100 ? conf : null, hints_before: hintTop(p), verdict: null });
    s.updated_at = now || Date.now();
    return p;
  }
  function giveUp(s, now) { var p = openProblem(s); endProblem(p, (p.submissions || []).length || (p.help || []).length ? 'given_up' : 'moved_on', now); s.updated_at = p.ended_at; return p; }
  function nextProblem(s, now) { var p = lastProblem(s); if (!p || p.status !== 'ended') throw new Error('Finish this problem first.'); p.next_at = now || Date.now(); s.updated_at = p.next_at; }
  // "My own problem": text pasted or read from a file; the coach solves it first
  function bringOwn(s, text, source, now) {
    if (!squash(text)) throw new Error('Paste or choose the problem first.');
    var ph = phase(s);
    if (ph === 'work' || ph === 'verdict' || ph === 'check') throw new Error('Finish or give up the open problem first.');
    var p = lastProblem(s);
    if (p && p.status === 'ended' && !p.next_at) p.next_at = now || Date.now();
    s.own_pending = { text: String(text).slice(0, 8000), source: source ? clip(source, 120) : null, at: now || Date.now() };
    s.updated_at = s.own_pending.at;
  }
  // "Report a problem": the problem is kept with the report and leaves every count; a learner can withdraw it
  function dispute(s, pid, note, now) {
    var p = problemsOf(s).filter(function (x) { return x.id === pid; })[0];
    if (!p) throw new Error('No such problem.');
    p.disputed = { at: now || Date.now(), note: clip(note, 600) };
    if (p.status === 'open') endProblem(p, 'moved_on', now);
    s.updated_at = p.disputed.at;
    return p;
  }
  function undispute(s, pid, now) {
    var p = problemsOf(s).filter(function (x) { return x.id === pid; })[0];
    if (!p || !p.disputed) return;
    (p.dispute_log = p.dispute_log || []).push({ report: p.disputed, withdrawn_at: now || Date.now() });
    delete p.disputed;
  }
  function pause(s, now) { if (s.status !== 'practice') return; s.status = 'paused'; s.updated_at = now || Date.now(); (s.pauses = s.pauses || []).push({ at: s.updated_at }); }
  function resume(s, now) { if (s.status !== 'paused') return; s.status = 'practice'; s.updated_at = now || Date.now(); (s.pauses || []).slice(-1).forEach(function (x) { x.resumed_at = s.updated_at; }); }
  // After "stuck": the learner asks for another try (the rejected drafts stay in the record)
  function retry(s) { s.retry_from = problemsOf(s).length; }
  function finish(s, now) { s.status = 'done'; s.finished_at = now || Date.now(); s.updated_at = s.finished_at; }

  // ------------------------------------------------------------------ hints (the ladder of task F2, through prompts\hint-giver.md)
  function itemLike(p) {
    var num = numberIn(p.answer);
    return num != null && squash(p.answer).replace(/[^0-9.\-+e]/gi, '').length >= squash(p.answer).length * 0.5
      ? { format: 'numeric', numeric: { value: num, tol: 0, unit: '' }, solution: p.model_solution, stem: p.statement }
      : { format: 'typed', rubric: { model: p.answer || '' }, solution: p.model_solution, stem: p.statement };
  }
  function nextRung(p) {
    var R = KC().RUNGS, top = -1;
    (p.help || []).forEach(function (h) { if (h.kind === 'model_hint') { var n = R.indexOf(h.requested || h.level); if (n > top) top = n; } });
    return top + 1 < R.length ? R[top + 1] : null;
  }
  function hintInputs(s, draft, requested, problems) {
    var p = openProblem(s);
    draft = draft || {};
    var given = (p.help || []).filter(function (h) { return h.kind === 'model_hint'; }).map(function (h) { return h.level + ': ' + h.text; }).join('\n');
    return { item: 'Problem: ' + p.statement + '\nModel solution: ' + p.model_solution + '\nAnswer: ' + (p.answer || '(none)') + '\nTargets: ' + p.targets.map(function (id) { var t = s.targets.filter(function (x) { return x.id === id; })[0]; return t ? t.label : id; }).join(' | '),
      response: squash(draft.answer) || 'nothing yet', thinking: squash(draft.thinking) || 'nothing written', given: given || 'none', requested: requested, problems: problems && problems.length ? problems.join('\n') : 'none' };
  }
  function recordHint(s, json, ctx) {
    ctx = ctx || {};
    var p = openProblem(s), R = KC().RUNGS, req = ctx.requested, r = json && json.rung, hint = String(json && json.hint || '').trim();
    if (!hint) return { ok: false, error: 'The hint was empty.', problems: ['the hint was empty'] };
    var repair = req === 'statement_repair';
    if (repair ? r !== 'statement_repair' : (R.indexOf(r) < 0 || R.indexOf(r) > R.indexOf(req))) return { ok: false, error: 'The model gave rung ' + r + ' although ' + req + ' was asked for.', problems: ['you gave ' + r + ' but only ' + req + ' may be given'] };
    if (repair && squash(json.reveals)) return { ok: false, error: 'The repair of the wording revealed part of the solution.', problems: ['a statement repair must reveal nothing'] };
    var leaks = KC().hintLeaks(itemLike(p), repair ? 'R0' : r, hint);
    if (leaks.length) return { ok: false, error: 'The hint gave away more than ' + (repair ? 'the wording' : r) + ' allows (' + leaks.join('; ') + ').', problems: leaks };
    var entry = { kind: repair ? 'statement_repair' : 'model_hint', level: repair ? 'statement_repair' : r, requested: req, at: ctx.now || Date.now(), text: hint.slice(0, 1200),
      stuck_at: clip(json.stuck_at, 300), reveals: clip(json.reveals, 200), by: byOf({ meta: ctx.meta, prompt: ctx.prompt || { promptId: 'hint-giver' } }) };
    p.help.push(entry);
    count(s, entry.by, entry.at);
    return { ok: true, entry: entry };
  }

  // ------------------------------------------------------------------ Evaluating, summaries, evidence
  // A packaged Evaluating run that ends completes the topic's cycle ("practised"); skipping stays "deferred_by_user"
  function evaluatingFor(et, kid) { var id = (et.progress.evaluating_sessions || {})[kid]; return id || null; }
  function linkEvaluating(et, kid, s) { et.progress.evaluating_sessions = et.progress.evaluating_sessions || {}; et.progress.evaluating_sessions[kid] = s.id; }
  function completeEvaluating(et, kid, s, now) {
    finish(s, now);
    et.progress.evaluating = et.progress.evaluating || {};
    et.progress.evaluating[kid] = 'practised';
  }
  function summary(s) {
    var c = counted(s), own = problemsOf(s).filter(function (p) { return p.origin === 'learner' && !p.disputed; });
    return {
      problems: c.length, ended: c.filter(function (p) { return p.status === 'ended'; }).length,
      solved: c.filter(function (p) { return p.outcome === 'solved'; }).length, with_hints: c.filter(function (p) { return p.outcome === 'solved_with_hints'; }).length,
      missed: c.filter(missed).length, retests: c.filter(function (p) { return p.retest_of; }).length, disputed: problemsOf(s).filter(function (p) { return p.disputed; }).length,
      own: own.length, levels: c.filter(function (p) { return p.difficulty; }).map(function (p) { return p.difficulty.level; }), rejected: problemsOf(s).filter(function (p) { return p.status === 'rejected'; }).length
    };
  }
  function confidenceRecords(s) {
    var out = [];
    counted(s).forEach(function (p) { (p.submissions || []).forEach(function (sub) { if (sub.verdict && sub.confidence_pct != null) out.push({ kind: 'practice', pct: sub.confidence_pct, correct: sub.verdict.result === 'solved' }); }); });
    return out;
  }

  global.KPractice = {
    LEVELS: LEVELS, SETTING_TEXT: SETTING_TEXT, RUN: RUN, targetsFor: targetsFor, targetsFromWords: targetsFromWords, newSession: newSession,
    nextSpec: nextSpec, levelNow: levelNow, phase: phase, needsCall: needsCall, lastProblem: lastProblem, coachInputs: coachInputs, checkReply: checkReply, applyReply: applyReply,
    submit: submit, giveUp: giveUp, nextProblem: nextProblem, bringOwn: bringOwn, dispute: dispute, undispute: undispute, pause: pause, resume: resume, finish: finish, retry: retry,
    nextRung: nextRung, hintInputs: hintInputs, recordHint: recordHint, hintTop: hintTop,
    evaluatingFor: evaluatingFor, linkEvaluating: linkEvaluating, completeEvaluating: completeEvaluating, summary: summary, confidenceRecords: confidenceRecords
  };
})(typeof window !== 'undefined' ? window : this);
