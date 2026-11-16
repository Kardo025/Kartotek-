/*
 * Kartotek probe (KProbe, task F3, LEARNING-PROTOCOL.md 3.5). Pure, UI-independent.
 */
// "Find my level" in Priming and the required first step of a live session: adaptive multiple-choice questions, one at a time, that find
// for each prerequisite strand the hardest thing the learner reliably gets right (the floor) and the first thing they get wrong (the edge).
//
// Who decides what:
//  - The strands come from the package (parts in prerequisite order, their topics as levels from easiest to hardest, relations as
//    cross-links) or, in a free live session, from the model (checked here).
//  - The code keeps the bracket of every strand from the graded answers and recommends the next target with the bracketing rules (enter
//    near the top, jump up after a confident right answer, step up gently after a hesitant one, confirm a lucky-looking right answer,
//    narrow down after a miss, dig once into a confident miss). The model writes the question and may pick another allowed target when
//    the learner's thinking shows a reason; it can never ask inside territory that is already bracketed.
//  - Every answer is graded here against the key the model committed to before the learner answered.
//  - The probe stops when every strand is located or the question budget (decision D4: 15, goal questions included) is used, or when the
//    learner stops it.
// Probe answers never reach the scheduler, never change an outcome's evidence state and are stored as generated, unverified material.
(function (global) {
  'use strict';

  var BUDGET = 15;
  var GOAL_MAX = { packaged: 1, live: 2 };
  var HELD = 40;        // a right answer at or above this confidence counts as held (below it: a guess, held only after a second right one)
  var DIG = 60;         // a wrong answer at or above this confidence is a committed misunderstanding worth one more question
  var JUMP = 80;        // a right answer at or above this confidence jumps up sharply
  var BANNED = /\b(all|none|both|neither) of (the )?(above|these|them)\b|^i don'?t know$|^something else$/i;

  function squash(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { s = squash(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  // For comparing texts: case, spacing and trailing punctuation are ignored, but every symbol counts ("A ∧ B" is not "A ∨ B")
  function norm(s) { return squash(s).toLowerCase().replace(/[.,;:!?]+$/, '').replace(/\s+/g, ' '); }
  function uid(p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  // Question text keeps its line breaks (a truth table, a worked step); only stray spaces and long gaps go
  function lines(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }
  // "A. text" / "b) text" → "text": Kartotek shows its own letters (the options are shuffled)
  function unletter(s) { return String(s).replace(/^\(?[A-Ea-e][.)]\s+/, ''); }
  function num(x) { return typeof x === 'number' && isFinite(x) ? x : null; }
  function G() { return global.KGraph; }

  // ------------------------------------------------------------------ strands
  // scope: { kind: "study" } | { kind: "part", part_id } | { kind: "topics", kids: [...] }
  // → [{ id, label, part_id, after: [strand ids it builds on], levels: [{ id, label, detail, units, related: [text] }] }]
  function strandsFor(pkg, scope) {
    scope = scope || { kind: 'study' };
    var K = G(), order = K.partOrder(pkg).parts, topics = K.topicsOf(pkg), include = {}, upTo = {};
    if (scope.kind === 'part') {
      include[scope.part_id] = true;
      K.prereqClosure(pkg, scope.part_id).forEach(function (q) { include[q] = true; });
    } else if (scope.kind === 'topics') {
      (scope.kids || []).forEach(function (kid) {
        var t = topics.filter(function (x) { return x.kid === kid; })[0];
        if (!t) return;
        include[t.part_id] = true;
        upTo[t.part_id] = Math.max(upTo[t.part_id] == null ? -1 : upTo[t.part_id], t.ti);
        K.prereqClosure(pkg, t.part_id).forEach(function (q) { include[q] = true; });
      });
    } else order.forEach(function (p) { include[p.part_id] = true; });
    var map = K.topicMap(pkg), partOf = {}, rel = {};
    topics.forEach(function (t) { partOf[t.kid] = t.part_id; });
    map.edges.forEach(function (e) { if (e.kind === 'related') (rel[e.to] = rel[e.to] || []).push({ from: e.from, text: e.label, ids: e.relations }); });
    var pos = {};
    order.forEach(function (p, i) { pos[p.part_id] = i; });
    var strands = [];
    order.forEach(function (p) {
      if (!include[p.part_id]) return;
      var levels = topics.filter(function (t) { return t.part_id === p.part_id && (upTo[p.part_id] == null || t.ti <= upTo[p.part_id]); }).map(function (t) {
        return {
          id: t.kid, label: squash(t.title),
          detail: t.outcomes.map(function (o) { return clip(o.performance, 200) + ((o.criteria || []).length ? ' Criteria: ' + o.criteria.map(function (c) { return clip(c.text, 160); }).join(' | ') : ''); }).join(' / '),
          units: t.units.slice(),
          related: (rel[t.kid] || []).map(function (r) { return r.from + ': ' + clip(r.text, 140); })
        };
      });
      if (!levels.length) return;
      var after = (p.prerequisites || []).filter(function (q) { return include[q]; });
      // a relation from a topic of an earlier included part is a dependency too ("strands inform each other")
      levels.forEach(function (l) {
        (rel[l.id] || []).forEach(function (r) {
          var q = partOf[r.from];
          if (q && q !== p.part_id && include[q] && pos[q] < pos[p.part_id] && after.indexOf(q) < 0) after.push(q);
        });
      });
      strands.push({ id: p.part_id, label: squash(p.title), part_id: p.part_id, after: after, levels: levels });
    });
    return strands;
  }

  // Strands proposed by the model in a free live session: [{ id, label, levels: [text] }]
  function checkStrands(list) {
    var problems = [], seen = {};
    if (!Array.isArray(list) || !list.length) return ['"strands" must list 1 to 5 strands.'];
    if (list.length > 5) problems.push('At most 5 strands.');
    list.forEach(function (s, i) {
      var at = 'Strand ' + (i + 1);
      if (!s || typeof s !== 'object') { problems.push(at + ' is not an object.'); return; }
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(s.id || ''))) problems.push(at + ': id must be lowercase words joined by hyphens.');
      else if (seen[s.id]) problems.push(at + ': id "' + s.id + '" is used twice.');
      seen[s.id] = true;
      if (!squash(s.label)) problems.push(at + ': label is empty.');
      var lv = Array.isArray(s.levels) ? s.levels.map(squash).filter(Boolean) : [];
      if (lv.length < 2 || lv.length > 6) problems.push(at + ': needs 2 to 6 levels, easiest first.');
      var u = {};
      lv.forEach(function (x) { if (u[norm(x)]) problems.push(at + ': level "' + x + '" appears twice.'); u[norm(x)] = 1; });
    });
    return problems;
  }
  function strandsFromModel(list) {
    return list.map(function (s) {
      return { id: s.id, label: squash(s.label), after: [], levels: s.levels.map(squash).filter(Boolean).map(function (x, i) { return { id: s.id + '-' + (i + 1), label: x, detail: '', units: [], related: [] }; }) };
    });
  }

  // ------------------------------------------------------------------ the probe record
  // opts: { mode: "packaged" | "live", scope, strands (packaged / attached: from strandsFor), goal_words, etut_id, session_id, now, budget }
  function newProbe(opts) {
    var now = opts.now || Date.now(), mode = opts.mode === 'live' ? 'live' : 'packaged';
    return {
      id: uid('pr'), kind: 'probe', source: 'model', mode: mode, created_at: now, updated_at: now, finished_at: null,
      etut_id: opts.etut_id || null, session_id: opts.session_id || null, scope: opts.scope || null,
      budget: opts.budget || BUDGET, goal_max: GOAL_MAX[mode],
      goal: { learner_words: squash(opts.goal_words), concrete: '', questions: [] },
      strands: opts.strands || [], strands_from: opts.strands && opts.strands.length ? 'package' : null,
      questions: [], status: 'goal', result: null, generator: [],
      // task F6: what the learner's evidence already shows per level (topic): { kid: "held" } from KGraph.topicEvidence; a held level
      // counts as held without a question, so the probe starts near the edge ("strands held solidly need no re-probing")
      known: opts.known || {}
    };
  }

  function asked(p) { return p.goal.questions.length + p.questions.length; }
  function left(p) { return Math.max(0, p.budget - asked(p)); }
  function strandById(p, id) { return p.strands.filter(function (s) { return s.id === id; })[0] || null; }
  function levelIndex(s, levelId) { for (var i = 0; i < s.levels.length; i++) if (s.levels[i].id === levelId) return i; return -1; }
  function pending(p) {
    var g = p.goal.questions[p.goal.questions.length - 1];
    if (g && g.choice == null && g.other == null) return { kind: 'goal', q: g };
    var q = p.questions[p.questions.length - 1];
    if (q && !q.answer) return { kind: 'question', q: q };
    return null;
  }
  // Answered questions that count: a question the learner reported as wrongly keyed is kept in the record but measures nothing
  function answered(p, sid) { return p.questions.filter(function (q) { return q.answer && !q.disputed && (!sid || q.strand === sid); }); }

  // ------------------------------------------------------------------ evidence and brackets
  // Verdict of one level: "held" | "fragile" (one right answer below 40 % confidence) | "mixed" (right and wrong) | "missed" | "open"
  function levelVerdict(p, sid, levelId) {
    if (p.source === 'self') {
      var r = (p.self_ratings || {})[levelId];
      return r === 'yes' ? 'held' : r === 'no' ? 'missed' : r === 'unsure' ? 'fragile' : 'open';
    }
    var sure = 0, low = 0, miss = 0;
    answered(p, sid).forEach(function (q) {
      if (q.level !== levelId) return;
      if (q.correct) { if ((q.answer.confidence_pct || 0) >= HELD) sure++; else low++; } else miss++;
    });
    if (!miss && !sure && !low && p.known && p.known[levelId] === 'held') return 'held';
    if (miss && (sure || low)) return 'mixed';
    if (sure || low >= 2) return 'held';
    if (low) return 'fragile';
    if (miss) return 'missed';
    return 'open';
  }
  // { lo: highest held level (-1 = none), hi: first level above lo that was missed (n = none), verdicts, holes: missed levels below lo }
  function bracket(p, s) {
    var n = s.levels.length, v = s.levels.map(function (l) { return levelVerdict(p, s.id, l.id); }), lo = -1, hi = n, holes = [];
    v.forEach(function (x, i) { if (x === 'held') lo = i; });
    for (var i = lo + 1; i < n; i++) if (v[i] === 'missed' || v[i] === 'mixed') { hi = i; break; }
    for (var j = 0; j < lo; j++) if (v[j] === 'missed' || v[j] === 'mixed') holes.push(j);
    return { lo: lo, hi: hi, n: n, verdicts: v, holes: holes, located: hi - lo === 1 };
  }
  // A strand nobody asked about whose every prerequisite strand is missing from its first level is missing too (inferred, not asked)
  function inferredMissing(p, s) {
    if (!s.after || !s.after.length || answered(p, s.id).length) return false;
    if (s.levels.some(function (l) { return p.known && p.known[l.id] === 'held'; })) return false;
    return s.after.every(function (id) {
      var a = strandById(p, id);
      if (!a) return false;
      if (inferredMissing(p, a)) return true;
      var b = bracket(p, a);
      return b.located && b.hi === 0;
    });
  }
  // A strand is still open while it is not located, or while its latest answer is a confident miss that was not dug into yet
  // ("misunderstandings matter most: find their extent before moving on")
  function open(p) { return p.strands.filter(function (s) { return (!bracket(p, s).located && !inferredMissing(p, s)) || needsDig(p, s); }); }
  function needsDig(p, s) {
    var mine = answered(p, s.id), q = mine[mine.length - 1];
    return !!q && !q.correct && !q.answer.dont_know && (q.answer.confidence_pct || 0) >= DIG && digs(p, s.id, q.level) === 0 && q.intent !== 'dig';
  }

  function digs(p, sid, levelId) { return p.questions.filter(function (q) { return q.strand === sid && q.level === levelId && q.intent === 'dig'; }).length; }
  function confirms(p, sid, levelId) { return p.questions.filter(function (q) { return q.strand === sid && q.level === levelId && q.intent === 'confirm'; }).length; }

  // Where a strand is entered: near the top, or as high as the strands located so far suggest ("strands inform each other")
  function entryLevel(p, s, b) {
    var n = s.levels.length;
    if (n === 1) return 0;
    var located = p.strands.filter(function (x) { return x !== s && bracket(p, x).located; });
    var r = 0.75;
    if (located.length) {
      r = located.reduce(function (a, x) { var bx = bracket(p, x); return a + (bx.lo + 1) / bx.n; }, 0) / located.length;
      r = Math.min(1, Math.max(0.34, r));
    }
    return clamp(Math.round((n - 1) * r), b);
  }
  function clamp(i, b) { return Math.min(b.hi - 1, Math.max(b.lo + 1, i)); }

  // The code's choice of the next target: { strand, level, intent: "probe" | "dig" | "confirm", why } or null when the probe is done
  function recommend(p) {
    if (left(p) <= 0) return null;
    var cands = open(p);
    if (!cands.length) return null;
    var last = answered(p).slice(-1)[0];
    var s = last && cands.indexOf(strandById(p, last.strand)) >= 0 ? strandById(p, last.strand) : cands[0];
    var b = bracket(p, s), mine = answered(p, s.id), q = mine[mine.length - 1];
    var t, intent = 'probe', why;
    if (!q) { t = entryLevel(p, s, b); why = 'First question on "' + s.label + '": entered near the top of what it covers.'; }
    else if (strandById(p, last.strand) !== s) { t = clamp(Math.floor((b.lo + b.hi) / 2), b); why = 'Back to "' + s.label + '": the middle of what is still open there.'; }
    else {
      var L = levelIndex(s, q.level), conf = q.answer.confidence_pct || 0, lbl = s.levels[L] ? s.levels[L].label : q.level;
      if (needsDig(p, s)) {
        return { strand: s.id, level: q.level, intent: 'dig', why: 'A confident miss on "' + lbl + '" (' + conf + ' %): one more question there to find how far the misunderstanding reaches.' };
      }
      if (q.correct && b.verdicts[L] === 'fragile' && confirms(p, s.id, q.level) === 0) {
        return { strand: s.id, level: q.level, intent: 'confirm', why: 'Right on "' + lbl + '" but at ' + conf + ' % confidence: one more question there before counting it as held.' };
      }
      if (q.correct && conf >= JUMP) { t = L + Math.max(1, Math.ceil((b.hi - 1 - L) * 0.67)); why = 'Right and confident on "' + lbl + '": jumping up.'; }
      else if (q.correct) { t = L + 1; why = 'Right but hesitant on "' + lbl + '": one step up.'; }
      else { t = Math.floor((b.lo + b.hi) / 2); why = (q.answer.dont_know ? '"I don\'t know" on "' : 'A miss on "') + lbl + '": narrowing down below it.'; }
      t = clamp(t, b);
    }
    if (!q && last && strandById(p, last.strand) !== s) why = '"' + strandById(p, last.strand).label + '" is located. ' + why;
    return { strand: s.id, level: s.levels[t].id, intent: intent, why: why };
  }

  // Every target the model may choose: inside the open bracket of an unlocated strand, a confirm on a fragile level there, a dig at its edge
  function allowedTargets(p) {
    var out = [];
    open(p).forEach(function (s) {
      var b = bracket(p, s);
      if (needsDig(p, s)) { var lq = answered(p, s.id).slice(-1)[0]; out.push({ strand: s.id, level: lq.level, intent: 'dig' }); }
      for (var i = b.lo + 1; i < b.hi; i++) out.push({ strand: s.id, level: s.levels[i].id, intent: b.verdicts[i] === 'fragile' ? 'confirm' : 'probe' });
      if (b.hi < b.n && digs(p, s.id, s.levels[b.hi].id) === 0 && answered(p, s.id).some(function (q) { return q.level === s.levels[b.hi].id && !q.correct && !q.answer.dont_know; })) {
        out.push({ strand: s.id, level: s.levels[b.hi].id, intent: 'dig' });
      }
    });
    var seen = {};
    return out.filter(function (t) { var k = t.strand + '|' + t.level + '|' + t.intent; if (seen[k]) return false; seen[k] = 1; return true; });
  }
  function isAllowed(p, strand, level, intent) {
    return allowedTargets(p).some(function (t) {
      if (t.strand !== strand || t.level !== level) return false;
      if (intent === 'dig') return t.intent === 'dig';
      return t.intent !== 'dig';
    });
  }

  // "goal" | "strands" | "question" | "answer" (waiting for the learner) | "done"
  function phase(p) {
    if (p.status === 'done' || p.status === 'stopped') return 'done';
    if (pending(p)) return 'answer';
    if (!p.goal.concrete) return left(p) > 0 && p.goal.questions.length < p.goal_max ? 'goal' : (concludeGoal(p), phase(p));
    if (!p.strands.length) return 'strands';
    return recommend(p) ? 'question' : 'done';
  }
  function concludeGoal(p) {
    if (p.goal.concrete) return;
    var picks = p.goal.questions.map(function (g) { return g.other != null ? squash(g.other) : g.options[g.choice]; }).filter(Boolean);
    p.goal.concrete = picks.length ? picks.join('; ') : (p.goal.learner_words || 'Be able to do what this study teaches');
  }

  // ------------------------------------------------------------------ model request and reply
  function goalText(p) {
    return 'In the learner\'s words: ' + (p.goal.learner_words || '(none given)') + '\nConcrete goal: ' + (p.goal.concrete || '(not agreed yet)') +
      (p.goal.questions.length ? '\nGoal questions so far:\n' + p.goal.questions.map(function (g, i) {
        return (i + 1) + '. ' + g.stem + ' → ' + (g.other != null ? 'something else: ' + g.other : g.choice != null ? g.options[g.choice] : '(not answered)');
      }).join('\n') : '');
  }
  function strandsText(p) {
    if (!p.strands.length) return '(none yet: a free session; propose them)';
    return p.strands.map(function (s) {
      var b = bracket(p, s), inf = inferredMissing(p, s);
      var head = s.id + ' · ' + s.label + (s.after && s.after.length ? ' (builds on ' + s.after.join(', ') + ')' : '');
      var state = inf ? 'missing (inferred: every strand it builds on is missing)' : b.located
        ? 'located: ' + (b.lo >= 0 ? 'held up to ' + s.levels[b.lo].id : 'nothing held') + (b.hi < b.n ? ', first miss at ' + s.levels[b.hi].id : ', every level held')
        : 'open: ' + (b.lo >= 0 ? 'held up to ' + s.levels[b.lo].id : 'no floor yet') + (b.hi < b.n ? ', missed at ' + s.levels[b.hi].id : ', no miss yet');
      return head + '\n  Status: ' + state + '\n  Levels, easiest first:\n' + s.levels.map(function (l, i) {
        return '   ' + (i + 1) + '. [' + l.id + '] ' + l.label + ' — ' + b.verdicts[i] + (p.known && p.known[l.id] === 'held' ? ' (held by the evidence in Kartotek)' : '') + (l.detail ? '\n      ' + clip(l.detail, 600) : '') +
          (l.related && l.related.length ? '\n      Builds on: ' + l.related.join('; ') : '');
      }).join('\n');
    }).join('\n\n');
  }
  function historyText(p) {
    if (!p.questions.length) return 'none';
    return p.questions.map(function (q, i) {
      var a = q.answer, opt = function (id) { var o = q.options.filter(function (x) { return x.id === id; })[0]; return o ? id + ') ' + o.text : id; };
      return 'Q' + (i + 1) + ' [strand ' + q.strand + ', level ' + q.level + ', ' + q.intent + '] ' + q.stem + '\n  Options: ' + q.options.map(function (o) { return o.id + ') ' + o.text; }).join('  ') +
        '\n  Key: ' + q.key + (a ? '\n  Learner: ' + (a.dont_know ? '"I don\'t know"' : 'chose ' + opt(a.choice) + ' (' + (q.correct ? 'right' : 'wrong') + '), confidence ' + a.confidence_pct + ' %') +
          '\n  Thinking: ' + (squash(a.thinking) || '(empty)') : '\n  (not answered yet)');
    }).join('\n');
  }
  // material: unit texts the questions may draw on (a package's units or the learner's files), built by the caller or from the package
  function materialText(p, pkg, max) {
    if (!pkg) return '(no source material: a free session; ask about what the goal clearly needs and nothing obscure)';
    var units = {}, out = [], total = 0, cap = max || 14000;
    (pkg.units || []).forEach(function (u) { units[u.id] = u; });
    var ids = [];
    open(p).concat(p.strands).forEach(function (s) { s.levels.forEach(function (l) { (l.units || []).forEach(function (u) { if (ids.indexOf(u) < 0) ids.push(u); }); }); });
    ids.forEach(function (id) {
      var u = units[id];
      if (!u || total > cap) return;
      var line = id + ' [' + (u.loc || 'no location') + ']: ' + clip(u.text, 500);
      total += line.length; out.push(line);
    });
    if ((pkg.conventions || []).length) out.unshift('Conventions: ' + pkg.conventions.map(squash).join(' | '));
    return out.join('\n') || '(no unit text)';
  }
  function taskText(p) {
    var ph = phase(p);
    if (ph === 'goal') {
      return 'Make the goal concrete. Answer with kind "goal_question": one multiple-choice question with 2 to 5 concrete options (Kartotek adds "Something else" itself). ' +
        (p.mode === 'packaged' ? 'This is a packaged study: the options are concrete things the study teaches. ' : '') +
        'If the goal is already concrete, set "goal_concrete" instead and answer with kind "' + (p.strands.length ? 'question' : 'strands') + '" as described below.' +
        ' Goal questions left: ' + (p.goal_max - p.goal.questions.length) + '. Questions left in the whole probe: ' + left(p) + '.' +
        (p.strands.length ? '\nThe question step, if you skip the goal question: ' + questionTask(p) : '\nThe strands step, if you skip the goal question: ' + STRANDS_TASK);
    }
    if (ph === 'strands') return STRANDS_TASK;
    if (ph === 'question') return questionTask(p);
    return 'Nothing to ask.';
  }
  var STRANDS_TASK = 'Reason out the strands this goal depends on. Answer with kind "strands": 1 to 5 strands, each with an id (lowercase words joined by hyphens), a label and 2 to 6 levels from easiest to hardest.';
  function questionTask(p) {
    var r = recommend(p), allowed = allowedTargets(p);
    if (!r) return 'Nothing to ask.';
    return 'Ask the next probe question. Answer with kind "question". Questions left in the budget: ' + left(p) + '.\n' +
      'Recommended target: strand ' + r.strand + ', level ' + r.level + ', intent ' + r.intent + ' (' + r.why + ').\n' +
      'Follow it unless the learner\'s last thinking gives a reason to choose another allowed target; then say why in "why".\n' +
      'Allowed targets (strand · level · intent): ' + allowed.map(function (t) { return t.strand + ' · ' + t.level + ' · ' + t.intent; }).join('; ') + '.\n' +
      'Also set "last_answer" about the learner\'s latest answer: a misunderstanding it shows (empty if none) and a short neutral note.';
  }
  // Values for prompts\prober.md
  function proberInputs(p, ctx) {
    ctx = ctx || {};
    var probs = ctx.problems && ctx.problems.length ? ctx.problems.map(function (x) { return '- ' + x; }).join('\n') : 'none';
    return { goal: goalText(p), strands: strandsText(p), material: ctx.material != null ? String(ctx.material) : materialText(p, ctx.pkg), history: historyText(p), task: taskText(p), problems: probs };
  }

  // Checks a prober reply against the step the probe is in. → { ok, kind, problems: [] }
  function checkReply(p, json) {
    var problems = [], ph = phase(p), j = json || {};
    var kind = j.kind;
    var concrete = squash(j.goal_concrete);
    var want = ph === 'goal' ? ['goal_question', p.strands.length ? 'question' : 'strands'] : [ph];
    if (want.indexOf(kind) < 0) return { ok: false, kind: kind, problems: ['"kind" must be ' + want.map(function (x) { return '"' + x + '"'; }).join(' or ') + ' at this step.'] };
    if (ph === 'goal' && kind !== 'goal_question' && !concrete) problems.push('Skipping the goal question needs "goal_concrete".');
    if (kind === 'goal_question') {
      var g = j.goal_question || {};
      if (!squash(g.stem)) problems.push('goal_question.stem is empty.');
      var go = Array.isArray(g.options) ? g.options.map(squash) : [];
      if (go.length < 2 || go.length > 5) problems.push('goal_question needs 2 to 5 options.');
      var gs = {};
      go.forEach(function (o) { if (!o) problems.push('A goal option is empty.'); else if (gs[norm(o)]) problems.push('Goal option "' + o + '" appears twice.'); else if (BANNED.test(norm(o))) problems.push('Leave out "' + o + '": Kartotek adds "Something else" itself.'); gs[norm(o)] = 1; });
    }
    if (kind === 'strands') problems = problems.concat(checkStrands(j.strands));
    if (kind === 'question') {
      var q = j.question || {};
      if (!strandById(p, q.strand)) problems.push('question.strand "' + q.strand + '" is not one of the strands.');
      else if (levelIndex(strandById(p, q.strand), q.level) < 0) problems.push('question.level "' + q.level + '" is not a level of strand ' + q.strand + '.');
      else if (['probe', 'dig', 'confirm'].indexOf(q.intent) < 0) problems.push('question.intent must be probe, dig or confirm.');
      else if (!isAllowed(p, q.strand, q.level, q.intent)) problems.push('Target ' + q.strand + ' · ' + q.level + ' · ' + q.intent + ' is not allowed now (already bracketed). Choose one of the allowed targets.');
      if (!squash(q.stem)) problems.push('question.stem is empty.');
      else if (squash(q.stem).length > 1500) problems.push('question.stem is too long (1500 characters at most).');
      else if (p.questions.some(function (x) { return norm(x.stem) === norm(q.stem); })) problems.push('This question was already asked; ask a new one.');
      var opts = Array.isArray(q.options) ? q.options : [], ids = {}, texts = {};
      if (opts.length < 2 || opts.length > 5) problems.push('question needs 2 to 5 options.');
      opts.forEach(function (o, i) {
        var id = squash(o && o.id), tx = squash(o && o.text);
        if (!id) problems.push('Option ' + (i + 1) + ' has no id.');
        else if (ids[id]) problems.push('Option id "' + id + '" is used twice.');
        ids[id] = 1;
        if (!tx) problems.push('Option ' + (id || i + 1) + ' has no text.');
        else if (texts[norm(tx)]) problems.push('Two options have the same text: "' + clip(tx, 80) + '".');
        else if (BANNED.test(norm(tx))) problems.push('Option "' + tx + '" is not allowed (no "all/none of the above"; Kartotek adds "I don\'t know" itself).');
        else if (tx.length > 500) problems.push('Option ' + id + ' is too long.');
        texts[norm(tx)] = 1;
      });
      if (!ids[squash(q.key)]) problems.push('question.key must be the id of exactly one option.');
    }
    return { ok: !problems.length, kind: kind, problems: problems };
  }

  function shuffle(a, rng) {
    var r = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function genMeta(ctx) {
    var m = (ctx && ctx.meta) || {}, pr = (ctx && ctx.prompt) || {};
    return { provider: m.providerLabel || m.provider || null, provider_id: m.provider || null, model: m.model || null,
      prompt: { id: pr.promptId || 'prober', version: pr.promptVersion || null, hash: pr.promptHash || null },
      cost_usd: typeof m.costUsd === 'number' ? m.costUsd : null, cost_kind: m.costKind || null };
  }
  // Applies a checked reply. ctx: { now, meta, prompt, rng }. → the new question (goal or probe), or null for strands
  function applyReply(p, json, ctx) {
    ctx = ctx || {};
    var now = ctx.now || Date.now(), by = genMeta(ctx), j = json, out = null;
    var c = checkReply(p, j);
    if (!c.ok) throw new Error('KProbe.applyReply: ' + c.problems.join(' '));
    if (j.last_answer && typeof j.last_answer === 'object') {
      var last = answered(p).slice(-1)[0];
      if (last && !last.observation && (squash(j.last_answer.misconception) || squash(j.last_answer.note))) {
        // A guess is a gap, not a misunderstanding: a misconception is only kept for a wrong answer given with 40 % confidence or more
        var mayMis = !last.correct && !last.answer.dont_know && (last.answer.confidence_pct || 0) >= HELD;
        last.observation = { misconception: mayMis ? clip(j.last_answer.misconception, 400) : '', note: clip(j.last_answer.note, 400) };
      }
    }
    if (squash(j.goal_concrete) && !p.goal.concrete && c.kind !== 'goal_question') p.goal.concrete = clip(j.goal_concrete, 400);
    if (c.kind === 'goal_question') {
      out = { id: uid('pg'), stem: lines(j.goal_question.stem), options: j.goal_question.options.map(function (o) { return unletter(squash(o)); }), choice: null, other: null, asked_at: now, answered_at: null,
        origin: 'generated', validation: 'unverified', by: by };
      p.goal.questions.push(out);
    } else if (c.kind === 'strands') {
      p.strands = strandsFromModel(j.strands); p.strands_from = 'model';
      p.strands_by = by;
    } else {
      var q = j.question, letters = 'abcde';
      var opts = shuffle(q.options.map(function (o) { return { from: squash(o.id), text: unletter(lines(o.text)), wrong_model: squash(o.wrong_model) }; }), ctx.rng);
      var key = null;
      opts = opts.map(function (o, i) { if (o.from === squash(q.key)) key = letters[i]; return { id: letters[i], text: o.text, wrong_model: o.from === squash(q.key) ? '' : o.wrong_model }; });
      out = { id: uid('pq'), strand: q.strand, level: q.level, intent: q.intent, stem: lines(q.stem), options: opts, key: key, why: clip(q.why, 600),
        difficulty: num(q.difficulty), asked_at: now, answer: null, correct: null, observation: null, origin: 'generated', validation: 'unverified', by: by };
      p.questions.push(out);
      p.status = 'probing';
    }
    p.generator.push({ at: now, provider: by.provider, model: by.model, prompt: by.prompt, cost_usd: by.cost_usd, cost_kind: by.cost_kind });
    p.updated_at = now;
    return out;
  }

  // The learner's answer to a goal question: { choice: index } or { other: text }
  function answerGoal(p, gid, a, now) {
    var g = p.goal.questions.filter(function (x) { return x.id === gid; })[0];
    if (!g) throw new Error('No such goal question.');
    if (g.choice != null || g.other != null) throw new Error('This goal question is already answered.');
    if (a && a.other != null && squash(a.other)) g.other = clip(a.other, 400);
    else if (a && a.choice >= 0 && a.choice < g.options.length) g.choice = a.choice;
    else throw new Error('Choose an option or write what you want.');
    g.answered_at = now || Date.now();
    p.updated_at = g.answered_at;
    if (p.goal.questions.length >= p.goal_max) concludeGoal(p);
    return g;
  }
  // The learner's answer to a probe question: { choice, confidence_pct, dont_know, thinking }. Graded here against the committed key.
  function answer(p, qid, a, now) {
    var q = p.questions.filter(function (x) { return x.id === qid; })[0];
    if (!q) throw new Error('No such question.');
    if (q.answer) throw new Error('This question is already answered.');
    a = a || {};
    var dk = !!a.dont_know;
    if (!dk && !q.options.some(function (o) { return o.id === a.choice; })) throw new Error('Choose an option or "I don\'t know".');
    var conf = dk ? null : Math.round(Number(a.confidence_pct));
    if (!dk && !(conf >= 0 && conf <= 100)) throw new Error('Set your confidence first.');
    q.answer = { choice: dk ? null : a.choice, dont_know: dk, confidence_pct: conf, thinking: String(a.thinking || '').slice(0, 4000), at: now || Date.now() };
    q.correct = !dk && a.choice === q.key;
    p.updated_at = q.answer.at;
    return q;
  }

  // ------------------------------------------------------------------ result
  function strandResult(p, s) {
    var b = bracket(p, s), inf = inferredMissing(p, s), mine = answered(p, s.id);
    var status = inf ? 'missing' : b.located ? (b.lo === b.n - 1 ? 'held' : b.hi === 0 ? 'missing' : 'edge') : 'open';
    var mis = [];
    mine.forEach(function (q) {
      if (!q.correct && !q.answer.dont_know && q.answer.confidence_pct >= DIG) {
        var o = q.options.filter(function (x) { return x.id === q.answer.choice; })[0];
        mis.push('Chose "' + (o ? o.text : q.answer.choice) + '" at ' + q.answer.confidence_pct + ' % confidence' + (o && o.wrong_model ? ': ' + o.wrong_model : '') + '.');
      }
      if (q.observation && q.observation.misconception) mis.push(q.observation.misconception);
    });
    var seen = {};
    mis = mis.filter(function (m) { var k = norm(m); if (seen[k]) return false; seen[k] = 1; return true; });
    var lv = function (i) { return i >= 0 && i < b.n ? { id: s.levels[i].id, label: s.levels[i].label } : null; };
    return {
      strand: s.id, label: s.label, status: status, inferred: inf, located: b.located || inf,
      held_up_to: inf ? null : lv(b.lo), first_miss: inf ? lv(0) : lv(b.hi),
      fragile: b.verdicts.map(function (v, i) { return v === 'fragile' || v === 'mixed' ? s.levels[i].label : null; }).filter(Boolean),
      gaps: b.holes.map(function (i) { return s.levels[i].label; }), misconceptions: mis,
      asked: mine.length, levels: s.levels.length
    };
  }
  // Per level (topic) status: "held" | "edge" (the first thing missed: where learning starts) | "missing" | "open" | "fragile" | "gap" (missed below the floor)
  function levelStatus(p) {
    var out = {};
    p.strands.forEach(function (s) {
      var b = bracket(p, s), inf = inferredMissing(p, s);
      s.levels.forEach(function (l, i) {
        if (inf) out[l.id] = 'missing';
        else if (i <= b.lo) out[l.id] = b.verdicts[i] === 'missed' || b.verdicts[i] === 'mixed' ? 'gap' : 'held';
        else if (i === b.hi) out[l.id] = 'edge';
        else if (i > b.hi) out[l.id] = 'missing';
        else out[l.id] = b.verdicts[i] === 'fragile' ? 'fragile' : 'open';
      });
    });
    return out;
  }
  function closing(res) {
    var bits = [];
    var held = res.strands.filter(function (r) { return r.status === 'held'; }), edge = res.strands.filter(function (r) { return r.status === 'edge'; });
    var miss = res.strands.filter(function (r) { return r.status === 'missing'; }), op = res.strands.filter(function (r) { return r.status === 'open'; });
    if (held.length) bits.push('Held throughout: ' + held.map(function (r) { return r.label; }).join(', ') + '.');
    edge.forEach(function (r) { bits.push(r.label + ': held up to "' + r.held_up_to.label + '", first miss at "' + r.first_miss.label + '".'); });
    if (miss.length) bits.push('Not held yet: ' + miss.map(function (r) { return r.label + (r.inferred ? ' (inferred from what it builds on)' : ''); }).join(', ') + '.');
    if (op.length) bits.push('Not located within the questions: ' + op.map(function (r) { return r.label; }).join(', ') + '.');
    var m = res.strands.reduce(function (a, r) { return a + r.misconceptions.length; }, 0);
    if (m) bits.push(m === 1 ? 'One misunderstanding showed up.' : m + ' misunderstandings showed up.');
    return bits.join(' ');
  }
  function result(p) {
    var strands = p.strands.map(function (s) { return strandResult(p, s); });
    var res = { goal: p.goal.concrete || p.goal.learner_words || '', asked: asked(p), budget: p.budget, source: p.source,
      strands: strands, levels: levelStatus(p), complete: strands.every(function (r) { return r.located; }),
      disputed: p.questions.filter(function (q) { return q.disputed; }).length };
    res.closing = closing(res) + (res.disputed ? ' ' + (res.disputed === 1 ? 'One question was' : res.disputed + ' questions were') + ' reported as wrongly keyed and left out.' : '');
    return res;
  }
  // Ends the probe: "done" when nothing is left to ask, "stopped" when the learner ends it early. Keeps a snapshot of the result.
  function finish(p, now, stopped) {
    if (p.status === 'done' || p.status === 'stopped') return p.result;
    var pend = pending(p);
    if (pend && pend.kind === 'goal') p.goal.questions.pop();      // an unanswered goal question was never seen as a measurement
    concludeGoal(p);
    p.status = stopped && phase(p) !== 'done' ? 'stopped' : 'done';
    p.finished_at = now || Date.now();
    p.result = result(p);
    return p.result;
  }

  // Without a model (packaged): the topics of the scope as a self-rating list. ratings: { kid: "yes" | "unsure" | "no" }
  // After the probe the learner sees the keys and may report one as wrong (a generated key is unverified). The question stays in the
  // record with the report; it leaves the brackets and the result is computed again. A report can be withdrawn the same way.
  function dispute(p, qid, note, now) {
    var q = p.questions.filter(function (x) { return x.id === qid; })[0];
    if (!q || !q.answer) throw new Error('Only an answered question can be reported.');
    if (p.status !== 'done' && p.status !== 'stopped') throw new Error('Report a question after the probe has ended.');
    q.disputed = { at: now || Date.now(), note: clip(note, 600) };
    p.result = result(p);
    p.updated_at = q.disputed.at;
    return p.result;
  }
  function undispute(p, qid, now) {
    var q = p.questions.filter(function (x) { return x.id === qid; })[0];
    if (!q || !q.disputed) return p.result;
    p.dispute_log = p.dispute_log || [];
    p.dispute_log.push({ q: qid, report: q.disputed, withdrawn_at: now || Date.now() });
    delete q.disputed;
    p.result = result(p);
    return p.result;
  }

  function selfProbe(opts, ratings, now) {
    var p = newProbe(opts);
    p.source = 'self'; p.self_ratings = {};
    Object.keys(ratings || {}).forEach(function (k) { if (['yes', 'unsure', 'no'].indexOf(ratings[k]) >= 0) p.self_ratings[k] = ratings[k]; });
    p.goal.concrete = p.goal.learner_words || 'Be able to do what this study teaches';
    p.status = 'done'; p.finished_at = now || Date.now();
    p.result = result(p);
    return p;
  }

  global.KProbe = {
    BUDGET: BUDGET, GOAL_MAX: GOAL_MAX, HELD: HELD, DIG: DIG, JUMP: JUMP,
    strandsFor: strandsFor, checkStrands: checkStrands, newProbe: newProbe, asked: asked, left: left, pending: pending, phase: phase,
    levelVerdict: levelVerdict, bracket: bracket, inferredMissing: inferredMissing, recommend: recommend, allowedTargets: allowedTargets,
    proberInputs: proberInputs, checkReply: checkReply, applyReply: applyReply, answerGoal: answerGoal, answer: answer,
    result: result, levelStatus: levelStatus, finish: finish, selfProbe: selfProbe, dispute: dispute, undispute: undispute
  };
})(typeof window !== 'undefined' ? window : this);
