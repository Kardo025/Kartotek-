/*
 * Kartotek end-of-lesson test core (UI-independent)
 * - Validates a lesson-test package (lesson.json) and turns every objective into a Kartotek card.
 *   The cards stay suspended until the test is taken, so they never reach the Review queue untested.
 * - A measurement (the test or a re-test) scores each objective from its items and writes ONE DSR event
 *   per objective: several answers in the same minute would barely change S (early-review damping) and
 *   would produce order-dependent state changes, while their mean is the more reliable measurement.
 * - Picks re-test questions from the unused pool and projects each objective's review calendar with the engine.
 */
(function (global) {
  'use strict';
  var DSR = global.DSR, KStore = global.KStore;
  var DAY = DSR.DAY;

  var KINDS = ['fact', 'concept', 'problem'];
  var ROLES = ['test', 'retest'];
  var ITEM_LEVELS = ['understand', 'apply', 'transfer', 'calculate'];
  var MAX_ITEMS = 4;        // items per objective in one measurement, the write-from-memory item included
  var RETEST_MCQ = 2;       // multiple-choice items per objective in a re-test
  var MCQ_SCORE = { sure: 1, unsure: 0.7, guess: 0.4 };
  var THRESHOLDS = { mastered: 0.9, learned: 0.7, partly: 0.45 };
  var LEVELS = {
    mastered: { label: 'Mastered', rating: 'easy', tone: 'ok', note: 'score ≥ 90% with no wrong answer' },
    learned: { label: 'Learned', rating: 'good', tone: 'ok', note: 'score ≥ 70%' },
    partly: { label: 'Partly learned', rating: 'hard', tone: 'warn', note: 'score ≥ 45%' },
    not: { label: 'Not learned', rating: 'again', tone: 'bad', note: 'score < 45%, or a confident wrong answer' }
  };
  var LEVEL_ORDER = ['mastered', 'learned', 'partly', 'not'];
  var SELF_TR = ['Not at all', 'A little', 'Mostly', 'Fully'];
  var SUSPEND_REASON = 'lesson_test';

  // ------------------------------------------------------------------ validation
  function validateLesson(p) {
    var errs = [];
    function need(cond, msg) { if (!cond) errs.push(msg); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) return ['The package is not a JSON object.'];
    need(typeof p.lesson_id === 'string' && /^[A-Za-z0-9_.~:@+-]{1,120}$/.test(p.lesson_id), 'lesson_id is missing or invalid (letters, digits and - _ . are allowed).');
    need(typeof p.title === 'string' && p.title.trim().length > 0, 'title is missing.');
    need(Array.isArray(p.parts) && p.parts.length > 0, 'parts must contain at least one part.');
    var oids = {}, qids = {};
    (p.parts || []).forEach(function (part, pi) {
      var at = 'Part ' + (pi + 1);
      if (!part || typeof part !== 'object') { errs.push(at + ': not a part object.'); return; }
      need(!!(part.part_id && part.title), at + ': part_id and title are required.');
      need(Array.isArray(part.objectives) && part.objectives.length > 0, at + ': at least one objective is required.');
      (part.objectives || []).forEach(function (o, oi) {
        var oat = at + ' / objective ' + (oi + 1);
        if (!o || typeof o !== 'object') { errs.push(oat + ': not an objective object.'); return; }
        need(!!o.objective_id && !oids[o.objective_id], oat + ': objective_id is missing or repeated.');
        if (o.objective_id) oids[o.objective_id] = true;
        need(!!o.title, oat + ': title is required.');
        if (o.kind != null) need(KINDS.indexOf(o.kind) >= 0, oat + ': invalid kind (' + o.kind + '); valid kinds: ' + KINDS.join(', ') + '.');
        if (o.refs != null) need(Array.isArray(o.refs) && o.refs.every(function (r) { return typeof r === 'string'; }), oat + ': refs must be a list of texts.');
        var rc = o.recall;
        need(!!(rc && rc.prompt && rc.model_answer && Array.isArray(rc.key_points) && rc.key_points.length > 0),
          oat + ': recall needs a prompt, a model_answer and at least one key point.');
        var items = Array.isArray(o.items) ? o.items : [];
        need(Array.isArray(o.items), oat + ': items must be a list.');
        var nTest = 0;
        items.forEach(function (q, qi) {
          var qat = oat + ' / item ' + (qi + 1);
          if (!q || typeof q !== 'object') { errs.push(qat + ': not a question object.'); return; }
          need(!!q.q_id && !qids[q.q_id], qat + ': q_id is missing or repeated.');
          if (q.q_id) qids[q.q_id] = true;
          need(ROLES.indexOf(q.role) >= 0, qat + ': role must be test or retest.');
          if (q.role === 'test') nTest++;
          if (q.level != null) need(ITEM_LEVELS.indexOf(q.level) >= 0, qat + ': invalid level (' + q.level + ').');
          need(!!(q.stem && q.solution), qat + ': stem and solution are required.');
          need(Array.isArray(q.options) && q.options.length === 4, qat + ': there must be exactly 4 options.');
          need(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4, qat + ': correct must be between 0 and 3.');
          if (q.distractor_notes != null) need(Array.isArray(q.distractor_notes) && q.distractor_notes.length === 4, qat + ': distractor_notes must have 4 entries.');
        });
        need(nTest >= 1 && nTest <= MAX_ITEMS - 1, oat + ': 1–' + (MAX_ITEMS - 1) + ' test items are required (with the write-from-memory item at most ' + MAX_ITEMS + ' per objective).');
      });
    });
    return errs;
  }

  function flatObjectives(pkg) {
    var out = [], n = 0;
    pkg.parts.forEach(function (part, pi) {
      part.objectives.forEach(function (o) { n++; out.push(Object.assign({ part_id: part.part_id, part_index: pi, n: n }, o)); });
    });
    return out;
  }
  function findObjective(pkg, oid) {
    var all = flatObjectives(pkg);
    for (var i = 0; i < all.length; i++) if (all[i].objective_id === oid) return all[i];
    return null;
  }
  function findItem(pkg, qid) {
    var hit = null;
    pkg.parts.forEach(function (p) { p.objectives.forEach(function (o) { (o.items || []).forEach(function (q) { if (q.q_id === qid) hit = { q: q, o: o }; }); }); });
    return hit;
  }
  function countItems(pkg) {
    var c = { objectives: 0, recall: 0, test: 0, retest: 0 };
    flatObjectives(pkg).forEach(function (o) {
      c.objectives++; c.recall++;
      (o.items || []).forEach(function (q) { c[q.role]++; });
    });
    c.questions = c.recall + c.test;
    c.minutes = Math.round(c.recall * 2 + c.test * 1);
    return c;
  }

  // ------------------------------------------------------------------ progress
  function newProgress() {
    return { v: 1, stage: 'intro', self: {}, run: null, runs: [], started_at: null, tested_at: null };
  }

  // ------------------------------------------------------------------ import
  // Loading the same package again keeps the cards and their memory state and only updates the content.
  function importLesson(state, pkg, opts) {
    var errs = validateLesson(pkg);
    if (errs.length) return { errors: errs };
    var now = (opts && opts.now) || Date.now();
    state.lessons = state.lessons || {};
    var existing = state.lessons[pkg.lesson_id];
    var deckId = existing && existing.deck_id && state.decks[existing.deck_id] ? existing.deck_id : 'lesson-' + pkg.lesson_id;
    if (!state.decks[deckId]) state.decks[deckId] = { deck_id: deckId, name: 'Lesson test: ' + pkg.title, created_at: now, lesson_id: pkg.lesson_id };
    else state.decks[deckId].name = 'Lesson test: ' + pkg.title;
    var map = Object.assign({}, (existing && existing.card_map) || {});
    var created = [], updated = [];
    flatObjectives(pkg).forEach(function (o, i) {
      var fields = {
        deck_id: deckId,
        front: o.recall.prompt,
        back: o.recall.model_answer,
        hint: o.title,
        explanation: (o.recall.key_points || []).map(function (x) { return '• ' + x; }).join('\n'),
        tags: [pkg.lesson_id, o.part_id],
        importance: 3, card_type: 'kazanim', created_at: now + i
      };
      var cid = map[o.objective_id];
      if (cid && state.cards[cid]) {
        var c = state.cards[cid];
        ['front', 'back', 'hint', 'explanation', 'tags'].forEach(function (f) { c[f] = fields[f]; });
        c.updated_at = now;
        updated.push(cid);
      } else {
        var nc = KStore.makeCard(state, fields);
        // Not in the Review queue until the objective has been measured
        state.mem[nc.card_id].suspended = true;
        state.mem[nc.card_id].suspended_reason = SUSPEND_REASON;
        map[o.objective_id] = nc.card_id;
        created.push(nc.card_id);
      }
    });
    state.lessons[pkg.lesson_id] = {
      lesson_id: pkg.lesson_id, package: pkg, card_map: map, deck_id: deckId,
      imported_at: existing && existing.imported_at ? existing.imported_at : now, updated_at: now,
      progress: existing && existing.progress ? existing.progress : newProgress()
    };
    return { errors: [], created: created, updated: updated, deckId: deckId, lesson: state.lessons[pkg.lesson_id] };
  }

  // ------------------------------------------------------------------ building a measurement run
  function shuffled(arr, rng) {
    var a = arr.slice(), r = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // Every multiple-choice item an objective has been asked, with the latest answer
  function askedHistory(lesson, oid) {
    var out = {};
    (lesson.progress.runs || []).forEach(function (run) {
      (run.order || []).forEach(function (it) {
        if (it.oid !== oid || it.type !== 'mcq') return;
        var a = run.answers[it.key];
        out[it.q_id] = { at: run.finished_at || run.started_at, correct: !!(a && a.correct) };
      });
    });
    return out;
  }

  // Re-test items: unused re-test questions first; when the pool is used up, the ones answered wrong longest ago, then the oldest correct ones
  function retestItems(lesson, oid, n) {
    var o = findObjective(lesson.package, oid), asked = askedHistory(lesson, oid);
    var items = o.items || [];
    var fresh = items.filter(function (q) { return q.role === 'retest' && !asked[q.q_id]; })
      .concat(items.filter(function (q) { return q.role === 'test' && !asked[q.q_id]; }));
    var seen = items.filter(function (q) { return asked[q.q_id]; }).sort(function (a, b) {
      var x = asked[a.q_id], y = asked[b.q_id];
      return (x.correct === y.correct ? 0 : x.correct ? 1 : -1) || x.at - y.at;
    });
    return fresh.concat(seen).slice(0, n == null ? RETEST_MCQ : n);
  }

  // A run: in each part, first the write-from-memory items (so options cannot cue them), then the part's multiple-choice items shuffled
  function makeRun(lesson, kind, oids, now, rng) {
    var pkg = lesson.package, want = {};
    oids.forEach(function (id) { want[id] = true; });
    var order = [];
    pkg.parts.forEach(function (part) {
      var objs = part.objectives.filter(function (o) { return want[o.objective_id]; });
      if (!objs.length) return;
      objs.forEach(function (o) { order.push({ key: 'r:' + o.objective_id, oid: o.objective_id, type: 'recall', part_id: part.part_id }); });
      var mcq = [];
      objs.forEach(function (o) {
        var qs = kind === 'test' ? (o.items || []).filter(function (q) { return q.role === 'test'; }) : retestItems(lesson, o.objective_id);
        qs.slice(0, MAX_ITEMS - 1).forEach(function (q) { mcq.push({ key: 'q:' + q.q_id, oid: o.objective_id, type: 'mcq', q_id: q.q_id, part_id: part.part_id }); });
      });
      order = order.concat(shuffled(mcq, rng));
    });
    return { run_id: DSR.uid(), kind: kind, objectives: oids.slice(), order: order, i: 0, answers: {}, checks: {}, phase: 'answer', started_at: now || Date.now(), finished_at: null, results: {} };
  }

  function startTest(lesson, now, rng) {
    var pr = lesson.progress;
    pr.run = makeRun(lesson, 'test', flatObjectives(lesson.package).map(function (o) { return o.objective_id; }), now, rng);
    pr.stage = 'run';
    if (!pr.started_at) pr.started_at = now || Date.now();
    return pr.run;
  }

  function startRetest(state, lesson, now, rng) {
    var due = dueObjectives(state, lesson, now || Date.now());
    if (!due.length) return null;
    lesson.progress.run = makeRun(lesson, 'retest', due, now, rng);
    lesson.progress.stage = 'run';
    return lesson.progress.run;
  }

  // ------------------------------------------------------------------ scoring
  // answer: {type:'recall', text} with coverage, or {type:'mcq', choice, dont_know, confidence, correct}
  function scoreItem(ans, keyPointsTotal, checked) {
    if (!ans) return { score: 0, wrong: true, misconception: false };
    if (ans.type === 'recall') {
      var wrote = String(ans.text || '').trim().length >= 3;
      var cov = wrote && keyPointsTotal ? Math.min(1, (checked || []).length / keyPointsTotal) : 0;
      return { score: cov, wrong: false, misconception: false, coverage: cov };
    }
    if (ans.dont_know) return { score: 0, wrong: true, misconception: false };
    if (!ans.correct) return { score: 0, wrong: true, misconception: ans.confidence === 'sure' };
    return { score: MCQ_SCORE[ans.confidence] == null ? MCQ_SCORE.guess : MCQ_SCORE[ans.confidence], wrong: false, misconception: false };
  }

  function levelOf(score, misconception, hasWrong) {
    if (misconception) return 'not';
    if (score >= THRESHOLDS.mastered && !hasWrong) return 'mastered';
    if (score >= THRESHOLDS.learned) return 'learned';
    if (score >= THRESHOLDS.partly) return 'partly';
    return 'not';
  }
  function ratingFor(level) { return LEVELS[level].rating; }

  function scoreObjective(lesson, run, oid) {
    var o = findObjective(lesson.package, oid), kp = o.recall.key_points || [];
    var parts = run.order.filter(function (it) { return it.oid === oid; }).map(function (it) {
      var s = scoreItem(run.answers[it.key], kp.length, run.checks[oid]);
      return Object.assign({ key: it.key, type: it.type, q_id: it.q_id || null }, s);
    });
    var score = parts.length ? parts.reduce(function (a, p) { return a + p.score; }, 0) / parts.length : 0;
    var mis = parts.some(function (p) { return p.misconception; }), wrong = parts.some(function (p) { return p.wrong; });
    var level = levelOf(score, mis, wrong);
    return { score: score, level: level, rating: ratingFor(level), misconception: mis, items: parts };
  }

  // ------------------------------------------------------------------ writing a measurement to DSR
  function recordMeasurement(state, lessonId, oid, result, kind, env) {
    var ls = state.lessons[lessonId];
    var cid = ls && ls.card_map[oid];
    var card = cid && state.cards[cid], mem = cid && state.mem[cid];
    if (!card || !mem) return { error: 'The card for this objective was not found; it may have been deleted. Load the lesson test again.' };
    if (mem.suspended && mem.suspended_reason === SUSPEND_REASON) { mem.suspended = false; delete mem.suspended_reason; }
    var res = DSR.processReview(card, mem, {
      rating: result.rating, response_time_ms: null, hint_used: false,
      meta: { source: 'lesson', signal: kind === 'retest' ? 'retest' : 'lesson', lesson_id: lessonId, objective_id: oid, score: Math.round(result.score * 1000) / 1000, level: result.level }
    }, Object.assign({}, env, { cardEvents: state.reviews.filter(function (e) { return e.card_id === cid; }) }));
    state.mem[cid] = res.mem;
    state.reviews.push(res.event);
    return { res: res, card_id: cid };
  }

  // Scores every objective of the run, writes one DSR event each and closes the run
  function finishRun(state, lesson, env) {
    var pr = lesson.progress, run = pr.run, cards = [], now = env.now;
    run.objectives.forEach(function (oid) {
      var r = scoreObjective(lesson, run, oid);
      var rec = recordMeasurement(state, lesson.lesson_id, oid, r, run.kind, env);
      if (rec.error) { r.error = rec.error; run.results[oid] = r; return; }
      var t = rec.res.trace;
      r.card_id = rec.card_id; r.due_at = t.due_at; r.interval_days = t.interval_days;
      r.S = t.S_new; r.D = t.D_new; r.state = t.to; r.review_id = rec.res.event.review_id;
      run.results[oid] = r;
      cards.push(rec.card_id);
    });
    run.phase = 'done'; run.finished_at = now;
    pr.runs.push(run);
    pr.run = null;
    pr.stage = 'results';
    if (run.kind === 'test' && !pr.tested_at) pr.tested_at = now;
    return { run: run, cards: cards };
  }

  // Latest measurement of each objective (test or re-test)
  function latestResults(lesson) {
    var out = {};
    (lesson.progress.runs || []).forEach(function (run) {
      Object.keys(run.results || {}).forEach(function (oid) { out[oid] = Object.assign({ at: run.finished_at, kind: run.kind, run_id: run.run_id }, run.results[oid]); });
    });
    return out;
  }

  // ------------------------------------------------------------------ calendar
  function tomorrowStart(state, now) {
    var h = state.settings.day_start_hour;
    return DSR.dayStart(DSR.dayIndex(now, h) + 1, h);
  }

  function dueObjectives(state, lesson, now) {
    if (!lesson.progress.tested_at) return [];
    var until = tomorrowStart(state, now);
    return flatObjectives(lesson.package).map(function (o) { return o.objective_id; }).filter(function (oid) {
      var m = state.mem[lesson.card_map[oid]];
      return m && !m.suspended && m.state !== 'new' && m.due_at && m.due_at < until;
    });
  }

  // Expected review path: every future review is assumed to be rated “Good” (no fuzz, no load shifting)
  function projectSchedule(card, mem, env, opts) {
    opts = opts || {};
    var days = opts.days == null ? 60 : opts.days, max = opts.max == null ? 6 : opts.max;
    var out = [];
    if (!card || !mem || mem.state === 'new' || mem.suspended || !mem.due_at) return out;
    var quiet = Object.assign({}, env, { rng: null, loadByDay: null, cardEvents: [], medianMs: null });
    var m = Object.assign({}, mem), horizon = env.now + days * DAY;
    for (var i = 0; i < max && m.due_at <= horizon; i++) {
      var at = Math.max(m.due_at, env.now);
      out.push({ at: m.due_at, gap_days: m.last_reviewed_at ? (m.due_at - m.last_reviewed_at) / DAY : null, state: m.state, overdue: m.due_at < env.now });
      m = DSR.processReview(card, m, { rating: 'good', response_time_ms: null }, Object.assign({}, quiet, { now: at })).mem;
    }
    return out;
  }

  // Past measurements and reviews of one objective's card
  function objectiveHistory(state, lesson, oid) {
    var cid = lesson.card_map[oid];
    return state.reviews.filter(function (e) { return e.card_id === cid; }).map(function (e) {
      return { at: e.reviewed_at, kind: e.source === 'lesson' ? (e.signal === 'retest' ? 'retest' : 'test') : (e.source === 'etut' ? 'study' : 'review'), rating: e.rating, level: e.level || null, score: e.score == null ? null : e.score, interval_days: e.scheduled_interval_days };
    });
  }

  // Calendar grid from the Monday of the current week: planned reviews of each objective per day
  function lessonCalendar(state, lesson, env, weeks) {
    var h = state.settings.day_start_hour, now = env.now;
    var today = DSR.dayIndex(now, h);
    var wd = (new Date(DSR.dayStart(today, h)).getDay() + 6) % 7;   // 0 = Monday
    var first = today - wd, n = (weeks || 5) * 7;
    var latest = latestResults(lesson);
    var days = [];
    for (var i = 0; i < n; i++) days.push({ idx: first + i, at: DSR.dayStart(first + i, h), today: first + i === today, past: first + i < today, items: [] });
    flatObjectives(lesson.package).forEach(function (o) {
      var cid = lesson.card_map[o.objective_id];
      var plan = projectSchedule(state.cards[cid], state.mem[cid], env, { days: n, max: 12 });
      plan.forEach(function (p, j) {
        var d = Math.max(DSR.dayIndex(p.at, h), today) - first;
        if (d >= 0 && d < n) days[d].items.push({ oid: o.objective_id, n: o.n, title: o.title, level: latest[o.objective_id] ? latest[o.objective_id].level : null, next: j === 0, overdue: p.overdue });
      });
    });
    return { first: first, days: days };
  }

  // Self-assessment against the measured level
  function selfFlag(selfValue, level) {
    if (selfValue == null || !level) return null;
    if (selfValue >= 2 && (level === 'partly' || level === 'not')) return { tone: 'warn', text: 'thought you knew it' };
    if (selfValue <= 1 && (level === 'mastered' || level === 'learned')) return { tone: 'ok', text: 'better than you thought' };
    return { tone: 'ok', text: 'accurate self-assessment' };
  }

  global.KLesson = {
    KINDS: KINDS, ROLES: ROLES, MAX_ITEMS: MAX_ITEMS, RETEST_MCQ: RETEST_MCQ, MCQ_SCORE: MCQ_SCORE, THRESHOLDS: THRESHOLDS,
    LEVELS: LEVELS, LEVEL_ORDER: LEVEL_ORDER, SELF_TR: SELF_TR, SUSPEND_REASON: SUSPEND_REASON,
    validateLesson: validateLesson, flatObjectives: flatObjectives, findObjective: findObjective, findItem: findItem, countItems: countItems,
    newProgress: newProgress, importLesson: importLesson,
    makeRun: makeRun, startTest: startTest, startRetest: startRetest, retestItems: retestItems,
    scoreItem: scoreItem, levelOf: levelOf, ratingFor: ratingFor, scoreObjective: scoreObjective,
    recordMeasurement: recordMeasurement, finishRun: finishRun, latestResults: latestResults,
    dueObjectives: dueObjectives, projectSchedule: projectSchedule, objectiveHistory: objectiveHistory,
    lessonCalendar: lessonCalendar, selfFlag: selfFlag
  };
})(typeof window !== 'undefined' ? window : this);
