/*
 * Kartotek study core (UI-independent)
 * - Validates the study package (etut.json) and turns objectives into Kartotek cards.
 * - Runs the stage machine of the self-regulated learning (SRL) cycle:
 *   plan → [warm-up] → priming → learn → quiz → [second round] → teach → journal … → final test → reflection → results
 * - Priming: the part summary with its keywords, and the student’s Questions list (open for the whole part).
 * - Writes recall, quiz and final-test answers to the objective card as DSR events.
 * - Provides a safe Markdown subset and an SVG sanitiser for package texts.
 */
(function (global) {
  'use strict';
  var DSR = global.DSR, KStore = global.KStore;
  var DAY = DSR.DAY;

  var BLOCK_TYPES = ['text', 'analogy', 'example', 'keypoints', 'callout', 'steps', 'compare', 'tree', 'svg', 'worked', 'anim'];
  var KINDS = ['olgu', 'kavram', 'problem', 'yazma', 'uygulama'];
  var KIND_TR = { olgu: 'Fact / term', kavram: 'Concept / relation', problem: 'Problem solving', yazma: 'Writing / argument', uygulama: 'Applied skill' };
  // Rule 12: strategy by task type
  var KIND_STRATEGY = {
    olgu: 'retrieval + spaced review',
    kavram: 'self-explanation + generating examples',
    problem: 'worked example + practice + error analysis',
    yazma: 'draft + rubric-based self-assessment',
    uygulama: 'performance attempt + checklist'
  };
  var PRODUCE_TR = { kavram: 'Generate your own example', yazma: 'Write a draft', uygulama: 'Performance attempt', problem: 'Set up your own problem', olgu: 'Generate your own example' };
  var CONFIDENCE_TR = { guess: 'Guess', unsure: 'Unsure', sure: 'Sure' };
  var STAGE_TR = {
    plan: 'Session plan', warmup: 'Warm-up', priming: 'Priming', learn: 'Lesson', quiz: 'Quiz', retry: 'Second round',
    teach: 'Explain as if teaching', journal: 'Learning journal',
    final: 'Final test', final_review: 'Study reflection', done: 'Completed'
  };
  var PART_STAGES = ['plan', 'warmup', 'priming', 'learn', 'quiz', 'retry', 'teach', 'journal'];
  // Rule 19: the phases of a session; priming is a short reading of the part summary and the first questions
  var PHASES = [
    { id: 'plan', label: 'Goal and prior knowledge' },
    { id: 'priming', label: 'Priming' },
    { id: 'active', label: 'Active study' },
    { id: 'retrieval', label: 'Closed-book retrieval / questions' },
    { id: 'errors', label: 'Error check' },
    { id: 'reflect', label: 'Reflection and planning' }
  ];
  var PHASE_BUDGET = {
    30: { plan: 2, priming: 2, active: 11, retrieval: 8, errors: 4, reflect: 3 },
    45: { plan: 2, priming: 3, active: 18, retrieval: 13, errors: 5, reflect: 4 },
    60: { plan: 3, priming: 4, active: 21, retrieval: 18, errors: 9, reflect: 5 },
    90: { plan: 3, priming: 5, active: 35, retrieval: 26, errors: 13, reflect: 8 }
  };

  // ------------------------------------------------------------------ validation
  function validatePackage(p) {
    var errs = [];
    function need(cond, msg) { if (!cond) errs.push(msg); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) return ['The package is not a JSON object.'];
    // Study v2 (cycle workflow, STUDY-RULES.md §v2): its own structural rules (src/study-v2.js)
    if (global.KCycle && global.KCycle.isV2(p)) return global.KCycle.validate(p).errors;
    need(typeof p.etut_id === 'string' && /^[A-Za-z0-9_.~:@+-]{1,120}$/.test(p.etut_id), 'etut_id is missing or invalid (letters, digits and - _ . are allowed).');
    need(typeof p.title === 'string' && p.title.trim().length > 0, 'title is missing.');
    need(Array.isArray(p.parts) && p.parts.length > 0, 'parts must contain at least one part.');
    var kids = {}, qids = {};
    function checkQ(q, at, practice) {
      if (!q || typeof q !== 'object') { errs.push(at + ': not a question object.'); return; }
      need(q.q_id && !qids[q.q_id], at + ': q_id is missing or repeated.');
      qids[q.q_id] = true;
      if (!practice) need(!!kids[q.kazanim_id], at + ': kazanim_id must refer to a defined objective.');
      if (!practice || q.options != null) {
        need(Array.isArray(q.options) && q.options.length === 4, at + ': there must be exactly 4 options.');
        need(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4, at + ': correct must be between 0 and 3.');
      }
      need(!!(q.stem && q.solution), at + ': stem and solution are required.');
    }
    function checkRubric(o, at) {
      need(!!o && !!o.prompt && Array.isArray(o.rubric) && o.rubric.length > 0, at + ': a prompt and at least one rubric item are required.');
    }
    (p.parts || []).forEach(function (part, pi) {
      var at = 'Part ' + (pi + 1);
      if (!part || typeof part !== 'object') { errs.push(at + ': not a part object.'); return; }
      need(!!(part.part_id && part.title), at + ': part_id and title are required.');
      need(Array.isArray(part.kazanimlar) && part.kazanimlar.length > 0, at + ': at least one objective is required.');
      (part.kazanimlar || []).forEach(function (k, ki) {
        var kat = at + ' / objective ' + (ki + 1);
        need(!!(k && k.kazanim_id) && !kids[k.kazanim_id], kat + ': kazanim_id is missing or repeated.');
        if (k && k.kazanim_id) kids[k.kazanim_id] = true;
        need(!!(k && k.title), kat + ': title is required.');
        need(!!k && Array.isArray(k.blocks) && k.blocks.length > 0, kat + ': blocks is empty.');
        ((k && k.blocks) || []).forEach(function (b, bi) {
          var ok = !!b && BLOCK_TYPES.indexOf(b.type) >= 0;
          need(ok, kat + ': block ' + (bi + 1) + ' has an unknown type (' + (b && b.type) + ').');
          if (ok && b.type === 'worked') {
            need(!!b.problem && Array.isArray(b.steps) && b.steps.length > 0 && b.steps.every(function (s) { return s && s.do; }), kat + ': a worked example must contain a problem and steps.');
          }
          if (ok && b.type === 'anim' && global.KAnim) {
            global.KAnim.check(b).forEach(function (e) { errs.push(kat + ' / animation: ' + e); });
          }
        });
        need(!!(k && k.recall && k.recall.prompt && k.recall.model_answer), kat + ': recall.prompt and recall.model_answer are required.');
        if (!k) return;
        if (k.kind != null) need(KINDS.indexOf(k.kind) >= 0, kat + ': invalid kind (' + k.kind + '); valid kinds: ' + KINDS.join(', ') + '.');
        if (k.self_explain != null) need(Array.isArray(k.self_explain) && k.self_explain.every(function (x) { return x && x.prompt && x.reference; }), kat + ': self_explain items must contain a prompt and a reference.');
        if (k.produce != null) checkRubric(k.produce, kat + ' / produce');
        if (k.practice != null) {
          need(Array.isArray(k.practice), kat + ': practice must be an array.');
          (Array.isArray(k.practice) ? k.practice : []).forEach(function (q, qi) { checkQ(q, kat + ' / practice ' + (qi + 1), true); });
        }
      });
      need(Array.isArray(part.quiz) && part.quiz.length > 0, at + ': quiz must contain at least one question.');
      (part.quiz || []).forEach(function (q, qi) { checkQ(q, at + ' / quiz ' + (qi + 1)); });
      if (part.teach != null) checkRubric(part.teach, at + ' / teach');
      if (part.summary != null) {
        var sm = part.summary;
        need(!!sm && typeof sm.md === 'string' && sm.md.trim().length > 0, at + ' / summary: md is required.');
        if (sm && sm.keywords != null) need(Array.isArray(sm.keywords) && sm.keywords.every(function (w) { return w && w.term && w.definition; }), at + ' / summary: keywords need a term and a definition.');
      }
    });
    need(Array.isArray(p.final_test) && p.final_test.length > 0, 'final_test must contain at least one question.');
    (p.final_test || []).forEach(function (q, qi) { checkQ(q, 'Final test ' + (qi + 1)); });
    return errs;
  }

  function flatKazanimlar(pkg) {
    var out = [];
    pkg.parts.forEach(function (part, pi) {
      part.kazanimlar.forEach(function (k, ki) { out.push(Object.assign({ part_id: part.part_id, part_index: pi, index_in_part: ki }, k)); });
    });
    return out;
  }

  function findKazanim(pkg, kazanimId) {
    var all = flatKazanimlar(pkg);
    for (var i = 0; i < all.length; i++) if (all[i].kazanim_id === kazanimId) return all[i];
    return null;
  }

  // ------------------------------------------------------------------ progress
  function newProgress() {
    return {
      v: 5,
      part: 0, stage: 'plan', k: 0, sub: 'read', qi: 0, ei: 0, pi: 0,
      answers: {}, recalls: {}, misconceptions: {},
      final_order: null, started_at: null, finished_at: null,
      plans: {}, prior: {}, jol: {}, explains: {}, produce: {}, practice: {},
      predictions: {}, retry: {}, teach: {}, journal: {}, final_review: null,
      warmup: {}, phase_ms: {}, final_open_at: null, qlist: {}
    };
  }

  // Older progress records: missing fields are added and the current position is kept.
  // v3 removed the summary stage; a record that stopped there continues with the journal.
  // v4 removed the old priming map (kept aside in priming_old); v5 brings priming back as the part summary plus the Questions list (qlist).
  function migrateProgress(p) {
    if (p && p.v === 'c2') return p; // Study v2 progress is migrated by KCycle.migrate
    if (!p || typeof p !== 'object') return newProgress();
    var base = newProgress();
    Object.keys(base).forEach(function (k) { if (p[k] === undefined) p[k] = base[k]; });
    if (p.stage === 'summary') p.stage = 'journal';
    if (p.priming) { if (Object.keys(p.priming).length) p.priming_old = p.priming; delete p.priming; }
    p.v = 5;
    return p;
  }

  function currentPart(et) { return et.package.parts[et.progress.part]; }
  function currentKazanim(et) { var p = currentPart(et); return p && p.kazanimlar[et.progress.k]; }

  // Steps inside an objective: shown only when there is content (Rule 12: activities by task type)
  function learnSteps(k) {
    var s = ['read'];
    if (k.practice && k.practice.length) s.push('practice');
    if (k.self_explain && k.self_explain.length) s.push('explain');
    if (k.produce) s.push('produce');
    s.push('jol', 'recall', 'check', 'rated');
    return s;
  }

  function explainLimit(k, level) {
    var n = (k.self_explain || []).length;
    return level === 'full' ? n : Math.min(1, n);
  }

  // Objectives from earlier parts with the lowest R (Rules 15–16: spaced and interleaved retrieval)
  function warmupPick(state, et, partIdx, now, n) {
    var cands = [];
    et.package.parts.slice(0, partIdx).forEach(function (p) {
      p.kazanimlar.forEach(function (k) {
        var cid = et.card_map[k.kazanim_id], m = cid && state.mem[cid];
        if (!m || m.state === 'new' || m.suspended || !m.last_reviewed_at) return;
        cands.push({ kid: k.kazanim_id, R: DSR.retrievability((now - m.last_reviewed_at) / DAY, m.stability_days) });
      });
    });
    cands.sort(function (a, b) { return a.R - b.R; });
    return cands.slice(0, n).map(function (c) { return c.kid; });
  }

  // Second round: objectives whose recall was Again/Hard or that had a wrong quiz answer (Rules 9, 13)
  function retryQueue(et, partIdx) {
    var part = et.package.parts[partIdx], pr = et.progress, out = [];
    part.kazanimlar.forEach(function (k) {
      var r = pr.recalls[k.kazanim_id];
      var weak = r && (r.rating === 'again' || r.rating === 'hard');
      var wrong = part.quiz.some(function (q) { return q.kazanim_id === k.kazanim_id && pr.answers[q.q_id] && !pr.answers[q.q_id].correct; });
      if (weak || wrong) out.push(k.kazanim_id);
    });
    return out;
  }

  // Rule 7: a visible, measurable, performance-based goal
  function autoGoal(part, criterion) {
    var n = part.quiz.length, crit = criterion || Math.ceil(n * 0.75);
    var kn = part.kazanimlar.length;
    return {
      text: 'By the end of this part I will explain the ' + kn + ' objective' + (kn === 1 ? '' : 's') + ' without notes and answer at least ' + crit + ' of ' + n + ' questions correctly.',
      criterion: crit, n: n,
      objectives: part.kazanimlar.map(function (k) { return k.objective || k.title; })
    };
  }

  function partStrategies(part) {
    var seen = {};
    part.kazanimlar.forEach(function (k) { var kind = k.kind || 'kavram'; seen[kind] = (seen[kind] || 0) + 1; });
    return Object.keys(seen).map(function (kind) { return { kind: kind, count: seen[kind], label: KIND_TR[kind], strategy: KIND_STRATEGY[kind] }; });
  }

  // 90 minutes is the user's preferred session length and the default
  function phaseBudget(duration) { return PHASE_BUDGET[duration] || PHASE_BUDGET[90]; }

  // The final test opens at the start of the study day, delayDays after now (0 = now), so it measures what lasts, not what is fresh
  function finalOpenAt(now, delayDays, dayStartHour) {
    var d = Math.max(0, Math.round(Number(delayDays) || 0));
    return d === 0 ? now : DSR.dayStart(DSR.dayIndex(now, dayStartHour) + d, dayStartHour);
  }

  // Which phase? (Rule 19) Derived from the stage and sub-step
  function phaseOf(pr, extra) {
    if (pr.stage === 'plan') return 'plan';
    if (pr.stage === 'priming') return 'priming';
    if (pr.stage === 'learn') return ['read', 'practice', 'explain', 'produce'].indexOf(pr.sub) >= 0 ? 'active' : 'retrieval';
    if (pr.stage === 'warmup' || pr.stage === 'teach') return 'retrieval';
    if (pr.stage === 'quiz' || pr.stage === 'final') return extra && extra.errorOpen ? 'errors' : 'retrieval';
    if (pr.stage === 'retry') return 'errors';
    return 'reflect';
  }

  function partResult(et, partIdx) {
    var pr = et.progress, part = et.package.parts[partIdx];
    var ans = part.quiz.map(function (q) { return pr.answers[q.q_id]; }).filter(Boolean);
    var correct = ans.filter(function (a) { return a.correct; }).length;
    var plan = pr.plans[partIdx];
    var crit = plan && plan.criterion != null ? plan.criterion : autoGoal(part).criterion;
    return { correct: correct, answered: ans.length, n: part.quiz.length, criterion: crit, met: ans.length === part.quiz.length && correct >= crit };
  }

  // ------------------------------------------------------------------ Questions list (written in priming, open for the whole part)
  // pr.qlist[partIndex] = [{ id, text, done, answer, at, done_at }]
  function qlistOf(pr, partIdx) {
    if (!pr.qlist) pr.qlist = {};
    if (!Array.isArray(pr.qlist[partIdx])) pr.qlist[partIdx] = [];
    return pr.qlist[partIdx];
  }
  function qlistAdd(pr, partIdx, text, now) {
    var t = String(text || '').trim();
    if (!t) return null;
    now = now || Date.now();
    var list = qlistOf(pr, partIdx);
    var item = { id: 'q' + now.toString(36) + '-' + list.length, text: t, done: false, answer: '', at: now, done_at: null };
    list.push(item);
    return item;
  }
  function qlistSet(pr, partIdx, id, patch, now) {
    var item = qlistOf(pr, partIdx).filter(function (x) { return x.id === id; })[0];
    if (!item) return null;
    if (patch.text != null && String(patch.text).trim()) item.text = String(patch.text).trim();
    if (patch.answer != null) item.answer = String(patch.answer);
    if (patch.done != null && !!patch.done !== item.done) { item.done = !!patch.done; item.done_at = item.done ? (now || Date.now()) : null; }
    return item;
  }
  function qlistRemove(pr, partIdx, id) {
    var list = qlistOf(pr, partIdx), i = list.map(function (x) { return x.id; }).indexOf(id);
    if (i >= 0) list.splice(i, 1);
    return i >= 0;
  }
  function qlistCounts(pr, partIdx) {
    var list = (pr.qlist && pr.qlist[partIdx]) || [];
    return { total: list.length, done: list.filter(function (x) { return x.done; }).length, answered: list.filter(function (x) { return String(x.answer || '').trim(); }).length };
  }

  // Moves to the next stage and prepares the queues it needs
  function goNext(state, et, now) {
    var pr = et.progress, pkg = et.package;
    now = now || Date.now();
    switch (pr.stage) {
      case 'plan':
        var picks = pr.part > 0 ? warmupPick(state, et, pr.part, now, 2) : [];
        if (picks.length) { pr.warmup[pr.part] = { kids: picks, i: 0, sub: 'recall', results: {} }; pr.stage = 'warmup'; }
        else pr.stage = 'priming';
        break;
      case 'warmup': pr.stage = 'priming'; break;
      case 'priming': startLearn(pr); break;
      case 'learn': pr.stage = 'quiz'; pr.qi = 0; pr.sub = 'predict'; break;
      case 'quiz':
        var q = retryQueue(et, pr.part);
        if (q.length) { pr.retry[pr.part] = { kids: q, i: 0, sub: 'recall', results: {} }; pr.stage = 'retry'; }
        else { pr.stage = 'teach'; pr.sub = 'write'; }
        break;
      case 'retry': pr.stage = 'teach'; pr.sub = 'write'; break;
      case 'teach': pr.stage = 'journal'; break;
      case 'journal':
        if (pr.part + 1 < pkg.parts.length) { pr.part += 1; pr.stage = 'plan'; pr.k = 0; pr.sub = 'read'; pr.qi = 0; }
        else {
          pr.stage = 'final'; pr.qi = 0; pr.sub = 'predict';
          if (!pr.final_order) pr.final_order = shuffled(pkg.final_test.map(function (x) { return x.q_id; }));
        }
        break;
      case 'final': pr.stage = 'final_review'; break;
      case 'final_review': pr.stage = 'done'; pr.finished_at = now; break;
      default: break;
    }
    return pr.stage;
  }
  function startLearn(pr) { pr.stage = 'learn'; pr.k = 0; pr.sub = 'read'; pr.ei = 0; pr.pi = 0; }

  // Next step inside the objective; when the objective is done, the next objective or the quiz
  function advanceLearn(state, et, now) {
    var pr = et.progress, part = currentPart(et), k = currentKazanim(et);
    var steps = learnSteps(k), idx = steps.indexOf(pr.sub);
    if (idx >= 0 && idx + 1 < steps.length) { pr.sub = steps[idx + 1]; pr.ei = 0; pr.pi = 0; return; }
    if (pr.k + 1 < part.kazanimlar.length) { pr.k += 1; pr.sub = 'read'; pr.ei = 0; pr.pi = 0; return; }
    goNext(state, et, now);
  }

  // ------------------------------------------------------------------ import
  // If the same package is loaded again, cards and memory state are kept and only the content is updated.
  function importPackage(state, pkg, opts) {
    var errs = validatePackage(pkg);
    if (errs.length) return { errors: errs };
    var now = (opts && opts.now) || Date.now();
    state.etuts = state.etuts || {};
    var existing = state.etuts[pkg.etut_id];
    var deckId = existing && existing.deck_id && state.decks[existing.deck_id] ? existing.deck_id : 'etut-' + pkg.etut_id;
    if (!state.decks[deckId]) {
      state.decks[deckId] = { deck_id: deckId, name: 'Study: ' + pkg.title, created_at: now, etut_id: pkg.etut_id, sample: !!pkg.sample };
    } else {
      state.decks[deckId].name = 'Study: ' + pkg.title;
    }
    var map = Object.assign({}, (existing && existing.card_map) || {});
    var created = [], updated = [];
    flatKazanimlar(pkg).forEach(function (k, i) {
      var fields = {
        deck_id: deckId,
        front: k.recall.prompt,
        back: k.recall.model_answer,
        hint: k.title,
        explanation: (k.recall.key_points || []).map(function (x) { return '• ' + x; }).join('\n'),
        tags: [pkg.etut_id, k.part_id],
        importance: 3, card_type: 'kazanim', created_at: now + i
      };
      var cid = map[k.kazanim_id];
      if (cid && state.cards[cid]) {
        var c = state.cards[cid];
        ['front', 'back', 'hint', 'explanation', 'tags'].forEach(function (f) { c[f] = fields[f]; });
        c.updated_at = now;
        updated.push(cid);
      } else {
        var nc = KStore.makeCard(state, fields);
        map[k.kazanim_id] = nc.card_id;
        created.push(nc.card_id);
      }
    });
    state.etuts[pkg.etut_id] = {
      etut_id: pkg.etut_id, package: pkg, card_map: map, deck_id: deckId,
      imported_at: existing && existing.imported_at ? existing.imported_at : now, updated_at: now,
      progress: global.KCycle && global.KCycle.isV2(pkg)
        ? global.KCycle.migrate(existing && existing.progress)
        : existing && existing.progress ? migrateProgress(existing.progress) : newProgress()
    };
    return { errors: [], created: created, updated: updated, deckId: deckId, etut: state.etuts[pkg.etut_id] };
  }

  // ------------------------------------------------------------------ writing answers to DSR
  // sig: {signal:'recall', rating, response_time_ms, round?} or {signal:'quiz'|'final', correct, confidence, question_id}
  function recordSignal(state, etutId, kazanimId, sig, env) {
    var et = state.etuts[etutId];
    var cid = et && et.card_map[kazanimId];
    var card = cid && state.cards[cid], mem = cid && state.mem[cid];
    if (!card || !mem) return { error: 'The card for this objective was not found; it may have been deleted. Reload the study package.' };
    var mapped = DSR.mapEtutSignal(sig);
    var res = DSR.processReview(card, mem, {
      rating: mapped.rating,
      response_time_ms: sig.signal === 'recall' ? sig.response_time_ms : null,
      hint_used: false,
      meta: {
        source: 'etut', signal: sig.signal, etut_id: etutId, kazanim_id: kazanimId,
        question_id: sig.question_id || null, confidence: sig.confidence || null, round: sig.round || null
      }
    }, Object.assign({}, env, { cardEvents: state.reviews.filter(function (e) { return e.card_id === cid; }) }));
    state.mem[cid] = res.mem;
    state.reviews.push(res.event);
    if (mapped.misconception) (et.progress.misconceptions = et.progress.misconceptions || {})[kazanimId] = true;
    return { res: res, rating: mapped.rating, misconception: mapped.misconception, card_id: cid };
  }

  // The objective's performance within the study and its current memory state
  function kazanimStatus(state, et, kazanimId, now) {
    var cid = et.card_map[kazanimId], mem = cid && state.mem[cid];
    var pkg = et.package, pr = et.progress;
    var qs = [];
    pkg.parts.forEach(function (p) { (p.quiz || []).forEach(function (q) { if (q.kazanim_id === kazanimId) qs.push(q.q_id); }); });
    (pkg.final_test || []).forEach(function (q) { if (q.kazanim_id === kazanimId) qs.push(q.q_id); });
    var answered = qs.filter(function (id) { return pr.answers && pr.answers[id]; });
    var correct = answered.filter(function (id) { return pr.answers[id].correct; }).length;
    var recall = pr.recalls && pr.recalls[kazanimId];
    var out = { card_id: cid, recall_rating: recall ? recall.rating : null, answered: answered.length, correct: correct, total_q: qs.length, misconception: !!(pr.misconceptions && pr.misconceptions[kazanimId]) };
    if (!mem || mem.state === 'new') { out.level = null; return out; }
    out.R = DSR.retrievability((now - mem.last_reviewed_at) / DAY, mem.stability_days);
    out.S = mem.stability_days; out.D = mem.difficulty; out.due_at = mem.due_at; out.state = mem.state;
    out.interval_days = mem.last_interval_days;
    if (out.misconception || mem.state === 'relearning' || (mem.state === 'learning' && mem.step_index === 0)) out.level = 'bad';
    // “Strong” threshold is 2.5 days: a 3-day interval can drop to 2.85 days with ±5% fuzz
    else if (mem.state === 'review' && mem.last_interval_days >= 2.5) out.level = 'ok';
    else out.level = 'warn';
    return out;
  }
  var LEVEL_TR = { ok: 'strong', warn: 'reinforce', bad: 'study again' };

  function shuffled(arr, rng) {
    var a = arr.slice(), r = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // ------------------------------------------------------------------ safe Markdown subset
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function inline(s, kw) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, kw ? '<mark class="kw">$1</mark>' : '<strong>$1</strong>')
      // Italic only for *…* opened after whitespace, so expressions such as “R* = 0.90” are not broken
      .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/`([^`]+?)`/g, '<code>$1</code>');
  }
  // opts.keywords: true → **…** is highlighted as a keyword
  function renderMd(md, opts) {
    var kw = !!(opts && opts.keywords);
    var lines = String(md == null ? '' : md).split(/\r?\n/);
    var html = [], para = [], list = null, listTag = null;
    function flushPara() { if (para.length) { html.push('<p>' + para.map(function (l) { return inline(l, kw); }).join('<br>') + '</p>'); para = []; } }
    function flushList() { if (list) { html.push('<' + listTag + '>' + list.join('') + '</' + listTag + '>'); list = null; listTag = null; } }
    lines.forEach(function (line) {
      var ul = line.match(/^\s*[-•]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        flushPara();
        var tag = ul ? 'ul' : 'ol';
        if (listTag && listTag !== tag) flushList();
        list = list || []; listTag = tag;
        list.push('<li>' + inline((ul || ol)[1], kw) + '</li>');
      } else if (!line.trim()) { flushPara(); flushList(); }
      else { flushList(); para.push(line); }
    });
    flushPara(); flushList();
    return html.join('');
  }

  // Cleans the SVG in a package: no scripts, external resources or event attributes remain
  function sanitizeSvg(str) {
    if (typeof DOMParser === 'undefined' || typeof str !== 'string') return '';
    var doc = new DOMParser().parseFromString(str, 'image/svg+xml');
    var root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return '';
    Array.prototype.slice.call(root.querySelectorAll('script, foreignObject, iframe, image, use, a, animate, set')).forEach(function (n) { n.parentNode.removeChild(n); });
    var all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    all.forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var n = a.name.toLowerCase();
        if (n.indexOf('on') === 0 || n === 'href' || n === 'xlink:href' || /url\s*\(\s*['"]?\s*(?!#)/i.test(a.value)) el.removeAttribute(a.name);
      });
    });
    root.setAttribute('class', 'etut-svg');
    root.setAttribute('role', 'img');
    return new XMLSerializer().serializeToString(root);
  }

  global.KEtut = {
    BLOCK_TYPES: BLOCK_TYPES, KINDS: KINDS, KIND_TR: KIND_TR, KIND_STRATEGY: KIND_STRATEGY, PRODUCE_TR: PRODUCE_TR,
    CONFIDENCE_TR: CONFIDENCE_TR, STAGE_TR: STAGE_TR, LEVEL_TR: LEVEL_TR, PART_STAGES: PART_STAGES, PHASES: PHASES,
    validatePackage: validatePackage, flatKazanimlar: flatKazanimlar, findKazanim: findKazanim,
    newProgress: newProgress, migrateProgress: migrateProgress, currentPart: currentPart, currentKazanim: currentKazanim,
    learnSteps: learnSteps, explainLimit: explainLimit, warmupPick: warmupPick, retryQueue: retryQueue,
    autoGoal: autoGoal, partStrategies: partStrategies, phaseBudget: phaseBudget, finalOpenAt: finalOpenAt, phaseOf: phaseOf, partResult: partResult,
    goNext: goNext, advanceLearn: advanceLearn,
    qlistOf: qlistOf, qlistAdd: qlistAdd, qlistSet: qlistSet, qlistRemove: qlistRemove, qlistCounts: qlistCounts,
    importPackage: importPackage, recordSignal: recordSignal, kazanimStatus: kazanimStatus, shuffled: shuffled,
    renderMd: renderMd, sanitizeSvg: sanitizeSvg, esc: esc
  };
})(typeof window !== 'undefined' ? window : this);
