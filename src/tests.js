/* Required test scenarios and formula examples from the specification. Run from the Algorithm tab. */
(function (global) {
  'use strict';
  var DSR = global.DSR, KStore = global.KStore, KEtut = global.KEtut;
  var DAY = DSR.DAY, MIN = DSR.MIN;

  function baseEnv(now, extra) {
    return Object.assign({
      settings: JSON.parse(JSON.stringify(DSR.DEFAULT_SETTINGS)),
      params: JSON.parse(JSON.stringify(DSR.DEFAULT_PARAMS)),
      now: now, rng: null, medianMs: 4000, cardEvents: []
    }, extra || {});
  }
  function card(extra) { return Object.assign({ card_id: 'c1', deck_id: 'd', front: 'chien', back: 'dog', importance: 3, tags: [] }, extra || {}); }
  function reviewMem(S, D, lastAgoDays, now, extra) {
    return Object.assign(KStore.newMem('c1', DSR.DEFAULT_PARAMS), {
      state: 'review', stability_days: S, difficulty: D, last_reviewed_at: now - lastAgoDays * DAY,
      due_at: now, total_reviews: 5, successful_reviews: 5
    }, extra || {});
  }
  function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

  var NOW = new Date(2026, 8, 27, 16, 30).getTime();

  var tests = [
    ['Forgetting curve: R(S, S) = 0.90', function () {
      var r = DSR.retrievability(30, 30);
      return { pass: approx(r, 0.9), detail: 'R = ' + r.toFixed(4) };
    }],
    ['Target interval example: S = 30, R* = 0.90 → 30 days; R* = 0.85 → ≈ 47.65 days', function () {
      var a = DSR.intervalForRetention(30, 0.9), b = DSR.intervalForRetention(30, 0.85);
      return { pass: approx(a, 30) && approx(b, 47.647, 0.01), detail: a.toFixed(2) + ' d, ' + b.toFixed(2) + ' d' };
    }],
    ['Lapse example: S = 20, R = 0.85 → S′ = 10.55 days', function () {
      var s = DSR.stabilityAfterLapse(20, 0.85, DSR.DEFAULT_PARAMS);
      return { pass: approx(s, 10.55, 1e-9), detail: 'S′ = ' + s.toFixed(4) };
    }],
    ['New card with again → asked again after 10 min, card stays in learning', function () {
      var r = DSR.processReview(card(), KStore.newMem('c1', DSR.DEFAULT_PARAMS), { rating: 'again', response_time_ms: 5000 }, baseEnv(NOW));
      return { pass: r.mem.state === 'learning' && approx(r.mem.due_at - NOW, 10 * MIN), detail: r.mem.state + ', ' + ((r.mem.due_at - NOW) / MIN) + ' min' };
    }],
    ['New card with two successful learning steps → review', function () {
      var m = KStore.newMem('c1', DSR.DEFAULT_PARAMS);
      var r1 = DSR.processReview(card(), m, { rating: 'good', response_time_ms: 4000 }, baseEnv(NOW));
      var t2 = r1.mem.due_at;
      var r2 = DSR.processReview(card(), r1.mem, { rating: 'good', response_time_ms: 4000 }, baseEnv(t2));
      return {
        pass: r1.mem.state === 'learning' && r2.mem.state === 'review' && r2.mem.due_at - t2 >= DAY - 1,
        detail: r1.mem.state + ' → ' + r2.mem.state + ', first interval ' + ((r2.mem.due_at - t2) / DAY).toFixed(2) + ' d, S = ' + r2.mem.stability_days.toFixed(2)
      };
    }],
    ['Wrong answer on a review card → S drops, relearning starts, a short review is planned', function () {
      var m = reviewMem(20, 5, 20, NOW);
      var r = DSR.processReview(card(), m, { rating: 'again', response_time_ms: 6000 }, baseEnv(NOW));
      return {
        pass: r.mem.stability_days < 20 && r.mem.state === 'relearning' && r.mem.due_at - NOW <= 10 * MIN && r.mem.lapse_count === 1,
        detail: 'S 20 → ' + r.mem.stability_days.toFixed(2) + ', ' + r.mem.state + ', ' + ((r.mem.due_at - NOW) / MIN) + ' min'
      };
    }],
    ['Good on a review card at low R → S grows strongly (more than at high R)', function () {
      var low = DSR.processReview(card(), reviewMem(10, 5, 40, NOW), { rating: 'good', response_time_ms: 4000 }, baseEnv(NOW));
      var high = DSR.processReview(card(), reviewMem(10, 5, 10, NOW), { rating: 'good', response_time_ms: 4000 }, baseEnv(NOW));
      var gl = low.mem.stability_days / 10, gh = high.mem.stability_days / 10;
      return { pass: gl > gh && gl > 2, detail: 'R ' + low.trace.R.toFixed(2) + ' → ×' + gl.toFixed(2) + ' ; R ' + high.trace.R.toFixed(2) + ' → ×' + gh.toFixed(2) };
    }],
    ['Easy with very high S → the interval grows but is capped at the maximum interval', function () {
      var env = baseEnv(NOW);
      env.settings.max_interval_days = 365;
      var r = DSR.processReview(card(), reviewMem(3000, 2, 3000, NOW), { rating: 'easy', response_time_ms: 2000 }, env);
      return { pass: r.mem.last_interval_days <= 365 + 1e-9 && r.mem.stability_days > 3000, detail: 'S = ' + r.mem.stability_days.toFixed(0) + ', I = ' + r.mem.last_interval_days.toFixed(1) + ' d' };
    }],
    ['Low-R card two days before the exam → high priority in exam mode', function () {
      var env = baseEnv(NOW);
      var mem = reviewMem(3, 6, 5, NOW);
      var without = DSR.priority(card(), mem, env, 0.9);
      var exam = new Date(NOW + 2 * DAY);
      env.settings.exam_date = exam.getFullYear() + '-' + String(exam.getMonth() + 1).padStart(2, '0') + '-' + String(exam.getDate()).padStart(2, '0');
      var tr = DSR.effectiveTargetRetention(env.settings, card(), NOW, env.params);
      var withExam = DSR.priority(card(), mem, env, tr.R);
      return { pass: withExam.total > without.total && tr.R >= 0.94, detail: 'P ' + without.total.toFixed(1) + ' → ' + withExam.total.toFixed(1) + ', R* = ' + tr.R.toFixed(2) };
    }],
    ['500 cards piled on one day → a low-risk card is shifted within the load-balancing window', function () {
      var env = baseEnv(NOW);
      var h = env.settings.day_start_hour;
      var I = DSR.intervalForRetention(30, 0.9);
      var target = DSR.dayIndex(NOW + I * DAY, h);
      var load = {}; load[target] = 500;
      var plan = DSR.planReviewInterval({ S: 30, D: 5, targetR: 0.9, now: NOW, importance: 3, rng: null, loadByDay: load }, env.settings, env.params);
      var shifted = DSR.dayIndex(plan.due_at, h) !== target;
      var R = DSR.retrievability(plan.days, 30);
      return { pass: shifted && R >= env.params.minimum_safety_retrievability, detail: 'I ' + I.toFixed(1) + ' → ' + plan.days.toFixed(1) + ' d, R = ' + R.toFixed(3) };
    }],
    ['Four consecutive failures → the card is sent to quality review', function () {
      var env = baseEnv(NOW), mem = reviewMem(15, 5, 15, NOW), events = [], t = NOW, r;
      for (var i = 0; i < 4; i++) {
        env = baseEnv(t, { cardEvents: events });
        r = DSR.processReview(card(), mem, { rating: 'again', response_time_ms: 7000 }, env);
        events = events.concat([r.event]);
        mem = r.mem; t = mem.due_at + MIN;
      }
      var pol = DSR.lapsePolicy(mem.consecutive_lapses);
      return { pass: mem.needs_content_review && mem.consecutive_lapses === 4 && pol.level === 4, detail: 'consecutive = ' + mem.consecutive_lapses + ', reasons: ' + mem.content_flags.join(' · ') };
    }],
    ['Time zone / day boundary: due_at falls on the right day relative to the local day start (04:00)', function () {
      var h = 4, ok = true, det = [];
      for (var k = 0; k < 5; k++) {
        var idx = DSR.dayIndex(NOW, h) + k * 37;
        var s = DSR.dayStart(idx, h);
        ok = ok && DSR.dayIndex(s, h) === idx && DSR.dayIndex(s - 1, h) === idx - 1 && new Date(s).getHours() === h;
      }
      var at0330 = new Date(2026, 8, 28, 3, 30).getTime(), at0430 = new Date(2026, 8, 28, 4, 30).getTime();
      ok = ok && DSR.dayIndex(at0430, h) - DSR.dayIndex(at0330, h) === 1;
      det.push('03:30 counted as the previous day, 04:30 as the new day');
      return { pass: ok, detail: det.join('') };
    }],
    ['Relearning steps do not lift S above its pre-lapse value (early-review damping)', function () {
      var mem = reviewMem(20, 5, 20 * 1.1, NOW);
      var r1 = DSR.processReview(card(), mem, { rating: 'again', response_time_ms: 6000 }, baseEnv(NOW));
      var t = r1.mem.due_at;
      var r2 = DSR.processReview(card(), r1.mem, { rating: 'good', response_time_ms: 4000 }, baseEnv(t));
      var t3 = r2.mem.due_at;
      var r3 = DSR.processReview(card(), r2.mem, { rating: 'good', response_time_ms: 4000 }, baseEnv(t3));
      return { pass: r3.mem.state === 'review' && r3.mem.stability_days < 20, detail: 'S: 20 → ' + r1.mem.stability_days.toFixed(2) + ' → ' + r2.mem.stability_days.toFixed(2) + ' → ' + r3.mem.stability_days.toFixed(2) };
    }],
    ['Interval order: hard ≤ good ≤ easy', function () {
      var env = baseEnv(NOW);
      var pv = DSR.previewIntervals(card(), reviewMem(8, 5, 8, NOW), env);
      return { pass: pv.again < pv.hard && pv.hard <= pv.good && pv.good <= pv.easy, detail: ['again', 'hard', 'good', 'easy'].map(function (k) { return k + ' ' + (pv[k] / DAY).toFixed(2) + 'd'; }).join(', ') };
    }],
    ['A slow “easy” and a hint lower the quality factor', function () {
      var P = DSR.DEFAULT_PARAMS;
      var slow = DSR.interpretRating({ rating: 'easy', response_time_ms: 25000 }, 4000, P);
      var hint = DSR.interpretRating({ rating: 'good', response_time_ms: 3000, hint_used: true }, 4000, P);
      return { pass: slow.q === 0.6 && hint.q === 0.6 && slow.slow_score === 1, detail: 'easy@25s → q = ' + slow.q + '; good+hint → q = ' + hint.q };
    }],
    ['Difficulty stays within 1–10 and reverts to the mean', function () {
      var P = DSR.DEFAULT_PARAMS, d = 5;
      for (var i = 0; i < 40; i++) d = DSR.updateDifficulty(d, 0, 0, 1, P);
      var hi = d;
      for (var j = 0; j < 200; j++) d = DSR.updateDifficulty(d, 1, 1.0, 0, P);
      return { pass: hi <= 10 && hi > 9 && d < hi && d >= 1, detail: 'repeated misses → ' + hi.toFixed(2) + ', then 200 good → ' + d.toFixed(2) };
    }],
    ['Queue order: learning steps → prioritised reviews → new cards', function () {
      var st = KStore.emptyState();
      ['a', 'b', 'c'].forEach(function (k, i) { KStore.makeCard(st, { card_id: k, deck_id: 'd', front: k, back: k, created_at: NOW - 1000 + i }); });
      st.mem.a = Object.assign(st.mem.a, { state: 'review', stability_days: 5, last_reviewed_at: NOW - 9 * DAY, due_at: NOW - 3 * DAY });
      st.mem.b = Object.assign(st.mem.b, { state: 'relearning', stability_days: 2, last_reviewed_at: NOW - 11 * MIN, due_at: NOW - MIN });
      var q = DSR.buildQueue(st, baseEnv(NOW), {});
      var ids = q.order.map(function (x) { return x.card_id; }).join(',');
      return { pass: ids === 'b,a,c', detail: 'order: ' + ids };
    }]
  ];

  // ------------------------------------------------------------------ study tests
  function miniPkg() {
    var q = function (id, k, c) { return { q_id: id, kazanim_id: k, stem: 'Question ' + id, options: ['a', 'b', 'c', 'd'], correct: c, solution: 'Solution', distractor_notes: ['', '', '', ''] }; };
    var kz = function (id) { return { kazanim_id: id, title: 'Objective ' + id, slides: [1], blocks: [{ type: 'text', md: 'Text' }], recall: { prompt: 'Question ' + id + '?', model_answer: 'Answer ' + id, key_points: ['n1', 'n2'] } }; };
    return {
      etut_id: 'test-etut', title: 'Test study', version: 1, created_at: '2026-09-29',
      parts: [{ part_id: 'p1', title: 'Part 1', slides: [1, 2], kazanimlar: [kz('k1'), kz('k2')], quiz: [q('q1', 'k1', 0), q('q2', 'k2', 1)],
        priming: { terms: [{ term: 'term', definition: 'definition' }], reference: { big_picture: 'Objective k1 leads to objective k2.', concepts: ['Alpha', 'Beta', 'Gamma'], links: [{ from: 'Alpha', rel: 'causes', to: 'Beta' }, { from: 'Beta', rel: 'part_of', to: 'Gamma' }], chain: ['a', 'b', 'c'], compare: { x: 'Alpha', y: 'Beta', md: 'differ' } } } }],
      final_test: [q('f1', 'k1', 2), q('f2', 'k2', 3)]
    };
  }
  function etutEnvAt(now) { return baseEnv(now, { medianMs: null }); }

  tests.push(
    ['Study signal → DSR rating (every row of the table)', function () {
      var m = DSR.mapEtutSignal;
      var rows = [
        [m({ signal: 'recall', rating: 'easy' }).rating, 'easy'],
        [m({ signal: 'quiz', correct: false, confidence: 'unsure' }).rating, 'again'],
        [m({ signal: 'quiz', correct: false, confidence: 'sure' }).misconception, true],
        [m({ signal: 'final', correct: true, confidence: 'guess' }).rating, 'hard'],
        [m({ signal: 'quiz', correct: true, confidence: 'unsure' }).rating, 'hard'],
        [m({ signal: 'final', correct: true, confidence: 'sure' }).rating, 'good']
      ];
      var ok = rows.every(function (r) { return r[0] === r[1]; });
      return { pass: ok, detail: rows.map(function (r) { return String(r[0]); }).join(' · ') };
    }],
    ['Study package validation: missing fields are rejected, a valid package is accepted', function () {
      var good = KEtut.validatePackage(miniPkg());
      var bad = miniPkg();
      bad.parts[0].quiz[0].options = ['a', 'b', 'c'];
      bad.final_test[0].kazanim_id = 'none';
      delete bad.parts[0].kazanimlar[1].recall;
      var errs = KEtut.validatePackage(bad);
      return { pass: good.length === 0 && errs.length === 3, detail: 'valid: ' + good.length + ' errors; broken: ' + errs.length + ' errors' };
    }],
    ['Objectives become cards; reloading keeps the same cards', function () {
      var st = KStore.emptyState();
      var r1 = KEtut.importPackage(st, miniPkg(), { now: NOW });
      var map1 = JSON.stringify(r1.etut.card_map);
      var r2 = KEtut.importPackage(st, miniPkg(), { now: NOW + 1000 });
      var c = st.cards[r1.etut.card_map.k1];
      return {
        pass: r1.created.length === 2 && r2.created.length === 0 && JSON.stringify(r2.etut.card_map) === map1 && c.card_type === 'kazanim' && c.deck_id === 'etut-test-etut' && st.mem[c.card_id].state === 'new',
        detail: 'first: ' + r1.created.length + ' cards, second: ' + r2.created.length + ' new, ' + r2.updated.length + ' updated'
      };
    }],
    ['Study flow: recall Good → quiz correct + Sure → test correct + Sure ≈ next day', function () {
      var st = KStore.emptyState(), r = KEtut.importPackage(st, miniPkg(), { now: NOW }), t = NOW;
      KEtut.recordSignal(st, 'test-etut', 'k1', { signal: 'recall', rating: 'good', response_time_ms: 20000 }, etutEnvAt(t));
      t += 5 * MIN;
      KEtut.recordSignal(st, 'test-etut', 'k1', { signal: 'quiz', correct: true, confidence: 'sure', question_id: 'q1' }, etutEnvAt(t));
      t += 15 * MIN;
      var last = KEtut.recordSignal(st, 'test-etut', 'k1', { signal: 'final', correct: true, confidence: 'sure', question_id: 'f1' }, etutEnvAt(t));
      var m = st.mem[r.etut.card_map.k1], d = (m.due_at - t) / DAY;
      var ev = st.reviews[st.reviews.length - 1];
      return { pass: m.state === 'review' && d > 0.9 && d < 1.2 && ev.source === 'etut' && ev.signal === 'final' && ev.question_id === 'f1' && !!last.res, detail: m.state + ', next review ' + d.toFixed(2) + ' d, S = ' + m.stability_days.toFixed(2) };
    }],
    ['Study: recall Easy → objective ≈ 3 days later', function () {
      var st = KStore.emptyState(), r = KEtut.importPackage(st, miniPkg(), { now: NOW });
      KEtut.recordSignal(st, 'test-etut', 'k2', { signal: 'recall', rating: 'easy', response_time_ms: 8000 }, etutEnvAt(NOW));
      var m = st.mem[r.etut.card_map.k2], d = (m.due_at - NOW) / DAY;
      return { pass: m.state === 'review' && d > 2.9 && d < 3.1, detail: m.state + ', ' + d.toFixed(2) + ' d' };
    }],
    ['Study: wrong + Sure → misconception flag and asked again after 10 min', function () {
      var st = KStore.emptyState(), r = KEtut.importPackage(st, miniPkg(), { now: NOW });
      KEtut.recordSignal(st, 'test-etut', 'k1', { signal: 'recall', rating: 'good', response_time_ms: 15000 }, etutEnvAt(NOW));
      var res = KEtut.recordSignal(st, 'test-etut', 'k1', { signal: 'quiz', correct: false, confidence: 'sure', question_id: 'q1' }, etutEnvAt(NOW + 5 * MIN));
      var m = st.mem[r.etut.card_map.k1];
      return { pass: res.misconception && st.etuts['test-etut'].progress.misconceptions.k1 === true && m.state === 'learning' && Math.abs(m.due_at - (NOW + 15 * MIN)) < 1000, detail: 'state ' + m.state + ', flag: ' + res.misconception };
    }],
    ['Calibration scores only recall signals; study events do not use up the daily limit', function () {
      var base = { from_state: 'review', predicted_retrievability: 0.9, recall_result: 0, reviewed_at: NOW };
      var c1 = DSR.calibration([Object.assign({ signal: 'quiz' }, base), Object.assign({ signal: 'final' }, base)], 0);
      var c2 = DSR.calibration([Object.assign({ signal: 'recall' }, base), base], 0);
      var st = KStore.emptyState();
      KStore.makeCard(st, { card_id: 'x', deck_id: 'd', front: 'x', back: 'y', created_at: NOW - 1000 });
      st.reviews.push(Object.assign({ card_id: 'x', deck_id: 'd', source: 'etut', signal: 'recall' }, base, { from_state: 'new', reviewed_at: NOW - MIN }));
      var q = DSR.buildQueue(st, baseEnv(NOW), {});
      return { pass: c1.review_count === 0 && c2.review_count === 2 && q.totals.newDone === 0, detail: 'quiz/test: ' + c1.review_count + ', recall: ' + c2.review_count + ', new today: ' + q.totals.newDone };
    }],
    ['Markdown is safe: HTML is escaped, **keywords** are highlighted; SVG is stripped of scripts', function () {
      var h = KEtut.renderMd('<img src=x onerror=alert(1)> **term**', { keywords: true });
      var svg = KEtut.sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><scr' + 'ipt>alert(2)</scr' + 'ipt><rect width="10" height="10" onclick="x()"/></svg>');
      return { pass: h.indexOf('<img') < 0 && h.indexOf('<mark class="kw">term</mark>') >= 0 && svg.indexOf('script') < 0 && svg.indexOf('onload') < 0 && svg.indexOf('onclick') < 0 && svg.indexOf('<rect') >= 0, detail: h.slice(0, 60) + '…' };
    }],
    ['Slide references list separate slides and join consecutive ones into ranges', function () {
      var ref = global.App && global.App.EtutUI && global.App.EtutUI.slidesRef;
      if (!ref) return { pass: false, detail: 'the study UI is not loaded' };
      // The unit follows the last opened study (a book uses pages), so test with slides and put it back afterwards
      var EU = global.App.EtutUI, unit = EU.refUnit, off = EU.refOffset;
      EU.refUnit = 'slide'; EU.refOffset = 0;
      var r, pg;
      try {
        r = [[4, 7], [9, 10, 11], [12, 14, 15], [26], [11, 9, 10, 9]].map(function (x) { return ref(x).replace(/<[^>]+>/g, ''); });
        // a book extract with page_offset 12: PDF pages 29–31 are printed pp. 17–19
        EU.refUnit = 'page'; EU.refOffset = 12; pg = ref([29, 30, 31]).replace(/<[^>]+>/g, '');
      } finally { EU.refUnit = unit; EU.refOffset = off; }
      if (pg !== 'pp. 17–19') return { pass: false, detail: 'page_offset: ' + pg };
      return { pass: r.join(' | ') === 'Slides 4, 7 | Slides 9–11 | Slides 12, 14–15 | Slide 26 | Slides 9–11', detail: r.join(' · ') };
    }]
  );

  // ------------------------------------------------------------------ self-regulation (SRL) tests
  var KMeta = global.KMeta;
  function etWithProgress(fill) {
    var st = KStore.emptyState(), r = KEtut.importPackage(st, miniPkg(), { now: NOW });
    if (fill) fill(r.etut.progress, st, r.etut);
    return { st: st, et: r.etut };
  }

  tests.push(
    ['Rule 10: calibration gap interpretation (overconfident / underconfident / accurate)', function () {
      var a = KMeta.predictionGap(0.9, 0.5), b = KMeta.predictionGap(0.5, 0.9), c = KMeta.predictionGap(0.8, 0.75);
      return { pass: a.id === 'asiri_guven' && b.id === 'dusuk_guven' && c.id === 'isabetli' && Math.abs(a.gap - 0.4) < 1e-9, detail: a.label + ' · ' + b.label + ' · ' + c.label };
    }],
    ['Rules 11/13: each of the 8 error types has a concrete adaptation', function () {
      var ok = KMeta.ERROR_TYPES.length === 8 && KMeta.ERROR_TYPES.every(function (t) { return t.label && t.action && t.action.length > 20; });
      return { pass: ok, detail: KMeta.ERROR_TYPES.map(function (t) { return t.label; }).join(', ') };
    }],
    ['Rule 24: prompt level fades with experience and calibration, and returns when it worsens', function () {
      function stateWith(journals, gap, setting) {
        var x = etWithProgress(function (pr) {
          for (var i = 0; i < journals; i++) pr.journal[i] = { change: 'x', at: NOW + i };
          if (gap != null) {
            pr.predictions['quiz:0'] = { predicted: 2, at: NOW };
            pr.answers.q1 = { correct: gap < 0.25, confidence: 'sure' };
            pr.answers.q2 = { correct: gap < 0.75, confidence: 'sure' };
          }
        });
        if (setting) x.st.settings.prompt_level = setting;
        return x.st;
      }
      var l1 = KMeta.promptLevel(stateWith(1, null)).level;
      var l2 = KMeta.promptLevel(stateWith(4, 0)).level;
      var l3 = KMeta.promptLevel(stateWith(9, 0)).level;
      var l4 = KMeta.promptLevel(stateWith(9, 0.5)).level;
      var l5 = KMeta.promptLevel(stateWith(1, null, 'minimal')).level;
      return { pass: l1 === 'full' && l2 === 'short' && l3 === 'minimal' && l4 === 'full' && l5 === 'minimal', detail: [l1, l2, l3, l4, l5].join(' → ') };
    }],
    ['Second round: objectives with Again/Hard recall or a wrong quiz answer are selected', function () {
      var x = etWithProgress(function (pr) {
        pr.recalls.k1 = { rating: 'again' };
        pr.recalls.k2 = { rating: 'good' };
        pr.answers.q2 = { correct: false, confidence: 'unsure' };
      });
      var q = KEtut.retryQueue(x.et, 0);
      var y = etWithProgress(function (pr) { pr.recalls.k1 = { rating: 'good' }; pr.recalls.k2 = { rating: 'easy' }; pr.answers.q1 = { correct: true }; });
      return { pass: q.join(',') === 'k1,k2' && KEtut.retryQueue(y.et, 0).length === 0, detail: 'queue: ' + q.join(', ') };
    }],
    ['Warm-up: objectives from earlier parts with the lowest R are selected', function () {
      var pkg = miniPkg();
      pkg.parts.push({ part_id: 'p2', title: 'Part 2', kazanimlar: [{ kazanim_id: 'k3', title: 'K3', blocks: [{ type: 'text', md: 'x' }], recall: { prompt: 'p', model_answer: 'm' } }], quiz: [{ q_id: 'q3', kazanim_id: 'k3', stem: 's', options: ['a', 'b', 'c', 'd'], correct: 0, solution: 'x' }] });
      var st = KStore.emptyState(), et = KEtut.importPackage(st, pkg, { now: NOW }).etut;
      var m1 = st.mem[et.card_map.k1], m2 = st.mem[et.card_map.k2];
      Object.assign(m1, { state: 'review', stability_days: 1, last_reviewed_at: NOW - 3 * DAY });
      Object.assign(m2, { state: 'review', stability_days: 10, last_reviewed_at: NOW - 3 * DAY });
      var pick = KEtut.warmupPick(st, et, 1, NOW, 2), none = KEtut.warmupPick(st, et, 0, NOW, 2);
      return { pass: pick.join(',') === 'k1,k2' && none.length === 0, detail: 'order: ' + pick.join(', ') };
    }],
    ['Schema: kind, self-explanation, produce, practice, worked example and teach fields are validated', function () {
      var p = miniPkg(), k = p.parts[0].kazanimlar[0];
      k.kind = 'problem';
      k.self_explain = [{ prompt: 'Why?', reference: 'Because' }];
      k.produce = { prompt: 'Generate an example', rubric: ['criterion'] };
      k.practice = [{ q_id: 'pr1', stem: 's', options: ['a', 'b', 'c', 'd'], correct: 1, solution: 'x' }, { q_id: 'pr2', stem: 'open', solution: 'y' }];
      k.blocks.push({ type: 'worked', problem: 'P', steps: [{ do: 'a', why: 'b' }], answer: 'c' });
      p.parts[0].teach = { prompt: 'Explain', rubric: ['r1'] };
      var good = KEtut.validatePackage(p);
      var bad = JSON.parse(JSON.stringify(p));
      bad.parts[0].kazanimlar[0].kind = 'style';
      bad.parts[0].kazanimlar[0].practice[0].options = ['a', 'b', 'c'];
      bad.parts[0].kazanimlar[0].blocks.push({ type: 'worked', problem: 'P', steps: [] });
      var errs = KEtut.validatePackage(bad);
      return { pass: good.length === 0 && errs.length === 3, detail: 'valid: ' + good.length + ' errors; broken: ' + errs.length + ' errors' };
    }],
    ['Stage order: plan → priming → learn → quiz → second round → teach → journal → final test → reflection → done', function () {
      var x = etWithProgress(), st = x.st, et = x.et, pr = et.progress, seq = [pr.stage];
      KEtut.goNext(st, et, NOW); seq.push(pr.stage);
      KEtut.goNext(st, et, NOW); seq.push(pr.stage);
      pr.recalls.k1 = { rating: 'again' };
      KEtut.goNext(st, et, NOW); seq.push(pr.stage);
      KEtut.goNext(st, et, NOW); seq.push(pr.stage);
      ['teach', 'journal', 'final', 'final_review', 'done'].forEach(function () { KEtut.goNext(st, et, NOW); seq.push(pr.stage); });
      var expect = 'plan,priming,learn,quiz,retry,teach,journal,final,final_review,done';
      return { pass: seq.join(',') === expect && pr.final_order.length === 2 && pr.finished_at === NOW, detail: seq.join(' → ') };
    }],
    ['Warm-up retrieval of earlier parts comes after the plan and before priming; priming is followed by the lesson', function () {
      var pkg = miniPkg();
      pkg.parts.push({ part_id: 'p2', title: 'Part 2', kazanimlar: [{ kazanim_id: 'k3', title: 'K3', blocks: [{ type: 'text', md: 'x' }], recall: { prompt: 'p', model_answer: 'm' } }], quiz: [{ q_id: 'q3', kazanim_id: 'k3', stem: 's', options: ['a', 'b', 'c', 'd'], correct: 0, solution: 'x' }] });
      var st = KStore.emptyState(), et = KEtut.importPackage(st, pkg, { now: NOW }).etut, pr = et.progress;
      Object.assign(st.mem[et.card_map.k1], { state: 'review', stability_days: 1, last_reviewed_at: NOW - 3 * DAY });
      pr.part = 1; pr.stage = 'plan';
      var seq = [pr.stage];
      for (var i = 0; i < 3; i++) { KEtut.goNext(st, et, NOW); seq.push(pr.stage); }
      return { pass: seq.join(',') === 'plan,warmup,priming,learn' && pr.k === 0 && pr.sub === 'read', detail: seq.join(' → ') };
    }],
    ['Questions list: add, tick, answer and remove; empty questions are ignored; summary is validated when present', function () {
      var pr = KEtut.newProgress();
      var a = KEtut.qlistAdd(pr, 0, '  Why is √2 irrational?  ', NOW), none = KEtut.qlistAdd(pr, 0, '   ', NOW);
      var b = KEtut.qlistAdd(pr, 0, 'Is 0 a natural number?', NOW + 1);
      KEtut.qlistSet(pr, 0, a.id, { done: true, answer: '2 is not a perfect square' }, NOW + 5);
      var c1 = KEtut.qlistCounts(pr, 0);
      KEtut.qlistSet(pr, 0, a.id, { done: false });
      KEtut.qlistRemove(pr, 0, b.id);
      var c2 = KEtut.qlistCounts(pr, 0), other = KEtut.qlistCounts(pr, 1);
      var p = miniPkg(); p.parts[0].summary = { md: 'Summary with a **term**.', keywords: [{ term: 'term', definition: 'definition' }] };
      var bad = JSON.parse(JSON.stringify(p)); bad.parts[0].summary = { md: '', keywords: [{ term: 'x' }] };
      var ok = KEtut.validatePackage(p).length === 0, errs = KEtut.validatePackage(bad).length;
      return { pass: a.text === 'Why is √2 irrational?' && none === null && c1.total === 2 && c1.done === 1 && c1.answered === 1 && pr.qlist[0][0].done_at === null &&
          c2.total === 1 && c2.done === 0 && c2.answered === 1 && other.total === 0 && ok && errs === 2,
        detail: 'after tick ' + c1.done + '/' + c1.total + ' · after untick and remove ' + c2.done + '/' + c2.total + ' (answer kept) · summary errors on a broken one: ' + errs };
    }],
    ['Animation blocks: clamped keyframe interpolation, safe expressions and package checks (Remotion-style timing)', function () {
      var I = KAnim.interpolate, kf = [[1, 0], [3, 10]];
      var clamp = I(0, kf, 'linear') === 0 && I(5, kf, 'linear') === 10 && I(2, kf, 'linear') === 5;
      var eased = I(2, kf, 'out') > 5 && I(2, kf, 'inOut') > 4.9 && I(2, kf, 'inOut') < 5.1 && Math.abs(I(3, kf, 'spring') - 10) < 1e-9;
      var E = KAnim.evaluate, env = { a: Math.PI / 2 };
      var ex = Math.abs(E('cos(a)^2 + sin(a)^2', env) - 1) < 1e-12 && E("a > 1 ? 'big' : 'small'", env) === 'big' && E("'θ = ' + fix(a*180/pi, 0) + '°'", env) === 'θ = 90°' && E('-2^2', env) === -4;
      var arc = KAnim.FN.arc(0, 0, 1, 0, Math.PI / 2);
      var unsafe = false; try { E('constructor', {}); E('alert(1)', {}); } catch (e) { unsafe = true; }
      var good = { type: 'anim', duration: 2, vars: { a: { kf: [[0, 0], [2, 1]] } }, svg: '<svg viewBox="0 0 10 10"><line data-a="x2: 10*a"/></svg>' };
      var bad = { type: 'anim', duration: 0, vars: { a: { kf: [[0]] } }, svg: '<svg><text data-t="nope("/></svg>' };
      return { pass: clamp && eased && ex && /^M 1 0 A 1 1 0 0 0 /.test(arc) && unsafe && KAnim.check(good).length === 0 && KAnim.check(bad).length === 3,
        detail: 'clamp ' + clamp + ' · easing ' + eased + ' · expressions ' + ex + ' · arc ' + arc.slice(0, 22) + '… · unknown functions rejected ' + unsafe + ' · bad spec errors ' + KAnim.check(bad).length };
    }],
    ['Steps inside an objective open according to its content (Rule 12)', function () {
      var base = { recall: {} };
      var fact = KEtut.learnSteps(base).join(',');
      var prob = KEtut.learnSteps({ practice: [{}], self_explain: [{}], produce: {} }).join(',');
      return { pass: fact === 'read,jol,recall,check,rated' && prob === 'read,practice,explain,produce,jol,recall,check,rated', detail: fact + ' | ' + prob };
    }],
    ['Old progress records are migrated and the current position is kept; a record at the removed summary continues with the journal; old priming maps are kept aside', function () {
      var old = { part: 1, stage: 'quiz', k: 0, sub: 'rated', qi: 2, answers: { a: 1 }, recalls: {}, misconceptions: {} };
      var p = KEtut.migrateProgress(old);
      var s = KEtut.migrateProgress({ v: 2, part: 0, stage: 'summary', answers: {} });
      var m = KEtut.migrateProgress({ v: 3, part: 0, stage: 'priming', k: 2, sub: 'rated', answers: {}, priming: { 0: { big: 'x' } } });
      return { pass: p.v === 5 && typeof p.qlist === 'object' && p.stage === 'quiz' && p.qi === 2 && p.answers.a === 1 && typeof p.plans === 'object' && typeof p.journal === 'object' && typeof p.phase_ms === 'object' && p.priming === undefined &&
          s.stage === 'journal' && m.stage === 'priming' && m.priming === undefined && m.priming_old[0].big === 'x',
        detail: 'v' + p.v + ', ' + p.stage + ', question ' + p.qi + ' · summary → ' + s.stage + ' · priming map → priming_old' };
    }],
    ['JOL bins and strategy effect (“too early to interpret” for small samples)', function () {
      var x = etWithProgress(function (pr) {
        pr.jol.k1 = { jol: 0.9, actual: 0.5 };
        pr.jol.k2 = { jol: 0.3, actual: 0.5 };
        pr.explains.k1 = [{ text: 'a', self: 'evet' }];
      });
      var bins = KMeta.jolBins(KMeta.jolEntries(x.st));
      var cid = x.et.card_map.k1;
      [1, 0, 1].forEach(function (y, i) { x.st.reviews.push({ card_id: cid, from_state: 'review', recall_result: y, reviewed_at: NOW + i }); });
      var eff = KMeta.strategyEffect(x.st).filter(function (s) { return s.strategy === 'explain'; })[0];
      return {
        pass: bins.n === 2 && Math.abs(bins.mean_gap - 0.1) < 1e-9 && bins.bins[4].n === 1 && bins.bins[1].n === 1 && eff.with.n === 3 && eff.early === true,
        detail: 'JOL gap ' + (bins.mean_gap * 100).toFixed(0) + ' points · explanation group n=' + eff.with.n + ', early=' + eff.early
      };
    }]
  );

  // ------------------------------------------------------------------ end-of-lesson test
  function miniLesson() {
    var mcq = function (id, role, c) { return { q_id: id, role: role, level: 'understand', stem: 'Question ' + id, options: ['a', 'b', 'c', 'd'], correct: c, solution: 'Solution ' + id, distractor_notes: ['', '', '', ''] }; };
    var obj = function (id, items) { return { objective_id: id, kind: 'concept', title: 'Objective ' + id, objective: 'Explain ' + id, refs: ['slide 1'], recall: { prompt: 'Explain ' + id + '.', model_answer: 'Answer ' + id, key_points: ['a', 'b', 'c'] }, items: items }; };
    return {
      lesson_id: 'test-lesson', title: 'Test lesson', version: 1, created_at: '2026-09-29', sources: [{ file: 'notes.pdf', type: 'notes' }],
      parts: [
        { part_id: 'p1', title: 'Part 1', objectives: [
          obj('o1', [mcq('o1a', 'test', 0), mcq('o1b', 'test', 1), mcq('o1r1', 'retest', 2), mcq('o1r2', 'retest', 3), mcq('o1r3', 'retest', 0)]),
          obj('o2', [mcq('o2a', 'test', 2), mcq('o2r1', 'retest', 1)])] },
        { part_id: 'p2', title: 'Part 2', objectives: [
          obj('o3', [mcq('o3a', 'test', 3), mcq('o3b', 'test', 0)]),
          obj('o4', [mcq('o4a', 'test', 1)])] }
      ]
    };
  }
  // plan: oid → {text, checks:[…], mcq: 'sure'|'unsure'|'guess'|'wrong'|'wrongsure'|'dk' or {q_id: …}}
  function answerRun(run, pkg, plan) {
    var KL = global.KLesson;
    run.order.forEach(function (it) {
      var p = plan[it.oid] || {};
      if (it.type === 'recall') { run.answers[it.key] = { type: 'recall', text: p.text == null ? 'my answer' : p.text }; run.checks[it.oid] = p.checks || [0, 1, 2]; return; }
      var q = KL.findItem(pkg, it.q_id).q, how = typeof p.mcq === 'object' ? p.mcq[it.q_id] : (p.mcq || 'sure');
      if (how === 'dk') run.answers[it.key] = { type: 'mcq', choice: null, dont_know: true, correct: false, confidence: null };
      else if (how === 'wrong' || how === 'wrongsure') run.answers[it.key] = { type: 'mcq', choice: (q.correct + 1) % 4, correct: false, confidence: how === 'wrong' ? 'unsure' : 'sure' };
      else run.answers[it.key] = { type: 'mcq', choice: q.correct, correct: true, confidence: how };
    });
    run.phase = 'check';
  }
  // Test taken at NOW: o1 mastered, o2 learned, o3 partly learned, o4 not learned (confident wrong answer)
  function takenLesson() {
    var KL = global.KLesson, st = KStore.emptyState(), pkg = miniLesson();
    var r = KL.importLesson(st, pkg, { now: NOW }), ls = r.lesson;
    KL.startTest(ls, NOW, function () { return 0.3; });
    answerRun(ls.progress.run, pkg, {
      o1: { mcq: 'sure' }, o2: { mcq: 'unsure' },
      o3: { checks: [0, 1], mcq: { o3a: 'sure', o3b: 'wrong' } },
      o4: { text: '', mcq: 'wrongsure' }
    });
    var fin = KL.finishRun(st, ls, baseEnv(NOW, { medianMs: null }));
    return { st: st, ls: ls, pkg: pkg, fin: fin, imported: r };
  }

  tests.push(
    ['Lesson test package: at most 4 items per objective; broken packages are rejected', function () {
      var KL = global.KLesson, ok = KL.validateLesson(miniLesson());
      var tooMany = miniLesson(); tooMany.parts[0].objectives[0].items.forEach(function (q) { q.role = 'test'; });
      var noRecall = miniLesson(); delete noRecall.parts[0].objectives[1].recall;
      var threeOpts = miniLesson(); threeOpts.parts[1].objectives[0].items[0].options = ['a', 'b', 'c'];
      var dupe = miniLesson(); dupe.parts[1].objectives[1].items[0].q_id = 'o1a';
      var bad = [tooMany, noRecall, threeOpts, dupe].map(function (p) { return KL.validateLesson(p).length; });
      return { pass: ok.length === 0 && bad.every(function (n) { return n > 0; }), detail: 'valid: ' + ok.length + ' errors · broken packages: ' + bad.join(', ') + ' errors' };
    }],
    ['Lesson test scoring: item scores, levels and DSR ratings (misconception, Don’t know)', function () {
      var KL = global.KLesson, s = function (a) { return KL.scoreItem(Object.assign({ type: 'mcq' }, a), 0, []); };
      var items = [s({ correct: true, confidence: 'sure' }).score, s({ correct: true, confidence: 'unsure' }).score, s({ correct: true, confidence: 'guess' }).score,
        s({ correct: false, confidence: 'unsure' }).score, s({ dont_know: true }).score];
      var mis = s({ correct: false, confidence: 'sure' }).misconception && !s({ dont_know: true }).misconception;
      var rec = KL.scoreItem({ type: 'recall', text: 'something' }, 3, [0, 2]).score, empty = KL.scoreItem({ type: 'recall', text: '' }, 3, [0, 1, 2]).score;
      var lv = [KL.levelOf(0.95, false, false), KL.levelOf(0.95, false, true), KL.levelOf(0.72, false, true), KL.levelOf(0.5, false, true), KL.levelOf(0.3, false, false), KL.levelOf(1, true, true)];
      var rt = ['mastered', 'learned', 'partly', 'not'].map(KL.ratingFor).join(',');
      var flag = KL.selfFlag(3, 'not').text + ' / ' + KL.selfFlag(0, 'mastered').text;
      return {
        pass: items.join(',') === '1,0.7,0.4,0,0' && mis && approx(rec, 2 / 3) && empty === 0 &&
          lv.join(',') === 'mastered,learned,learned,partly,not,not' && rt === 'easy,good,hard,again' && flag === 'thought you knew it / better than you thought',
        detail: 'items ' + items.join('/') + ' · recall ' + rec.toFixed(2) + ' · levels ' + lv.join(', ') + ' · ratings ' + rt
      };
    }],
    ['Lesson test: cards wait until measured; one DSR event per objective; first intervals 3 d / 1 d / 10 min', function () {
      var KL = global.KLesson, st = KStore.emptyState(), r = KL.importLesson(st, miniLesson(), { now: NOW });
      var waiting = r.created.every(function (cid) { return st.mem[cid].suspended && st.mem[cid].suspended_reason === KL.SUSPEND_REASON; });
      var q0 = DSR.buildQueue(st, baseEnv(NOW));
      var x = takenLesson(), res = x.fin.run.results, map = x.ls.card_map;
      var gap = function (oid) { return (x.st.mem[map[oid]].due_at - NOW) / MIN; };
      var levels = ['o1', 'o2', 'o3', 'o4'].map(function (o) { return res[o].level + '/' + res[o].rating; }).join(', ');
      var ev = x.st.reviews.filter(function (e) { return e.source === 'lesson' && e.signal === 'lesson'; });
      var open = Object.keys(map).every(function (o) { return !x.st.mem[map[o]].suspended; });
      var q1 = DSR.buildQueue(x.st, baseEnv(NOW + MIN));
      return {
        pass: waiting && q0.totals.freshAvailable === 0 && q0.order.length === 0 && levels === 'mastered/easy, learned/good, partly/hard, not/again' &&
          approx(gap('o1'), 3 * 1440) && approx(gap('o2'), 1440) && approx(gap('o3'), 10) && approx(gap('o4'), 10) &&
          ev.length === 4 && open && res.o4.misconception && q1.totals.newDone === 0 && q1.totals.reviewDone === 0,
        detail: levels + ' · first reviews in ' + ['o1', 'o2', 'o3', 'o4'].map(function (o) { return App.fmtDays(gap(o) / 1440); }).join(' / ') + ' · events ' + ev.length + ' · daily limits used: ' + q1.totals.newDone
      };
    }],
    ['Lesson test calendar: projected reviews come from the DSR engine and move further apart', function () {
      var KL = global.KLesson, x = takenLesson(), env = baseEnv(NOW, { medianMs: null });
      var plan = function (oid) { var cid = x.ls.card_map[oid]; return KL.projectSchedule(x.st.cards[cid], x.st.mem[cid], env, { days: 60, max: 6 }); };
      var a = plan('o4'), e = plan('o1');
      var rising = function (p) { for (var i = 1; i < p.length; i++) if (!(p[i].at > p[i - 1].at)) return false; return p.length > 2; };
      var cal = KL.lessonCalendar(x.st, x.ls, env, 5);
      var nexts = cal.days.reduce(function (s, d) { return s + d.items.filter(function (it) { return it.next; }).length; }, 0);
      return {
        pass: rising(a) && rising(e) && approx(a[0].at - NOW, 10 * MIN) && approx(a[1].at - a[0].at, DAY, 1000) && approx(e[0].at - NOW, 3 * DAY) && e[1].gap_days > 3 &&
          nexts === 4 && cal.days.filter(function (d) { return d.today; }).length === 1,
        detail: 'not learned: ' + a.map(function (p) { return App.fmtDays((p.at - NOW) / DAY); }).join(' → ') + ' · mastered: ' + e.map(function (p) { return App.fmtDays((p.at - NOW) / DAY); }).join(' → ')
      };
    }],
    ['Re-test: unused questions first, then the ones answered wrong; ≤ 4 items per objective; write-from-memory first', function () {
      var KL = global.KLesson, x = takenLesson(), T = NOW + 4 * DAY;
      var testRun = x.fin.run;
      var recallFirst = function (run) {
        return x.pkg.parts.every(function (p) {
          var idx = run.order.map(function (it, i) { return it.part_id === p.part_id ? i : -1; }).filter(function (i) { return i >= 0; });
          var rec = idx.filter(function (i) { return run.order[i].type === 'recall'; }), mcq = idx.filter(function (i) { return run.order[i].type === 'mcq'; });
          return !rec.length || !mcq.length || Math.max.apply(null, rec) < Math.min.apply(null, mcq);
        });
      };
      var due = KL.dueObjectives(x.st, x.ls, T).length;
      var run = KL.startRetest(x.st, x.ls, T, function () { return 0.5; });
      var qs = function (oid) { return run.order.filter(function (it) { return it.oid === oid && it.type === 'mcq'; }).map(function (it) { return it.q_id; }).sort().join(','); };
      var perObj = ['o1', 'o2', 'o3', 'o4'].map(function (o) { return run.order.filter(function (it) { return it.oid === o; }).length; });
      answerRun(run, x.pkg, {});
      KL.finishRun(x.st, x.ls, baseEnv(T, { medianMs: null }));
      var re = x.st.reviews.filter(function (e) { return e.signal === 'retest'; }).length;
      var second = KL.retestItems(x.ls, 'o1').map(function (q) { return q.q_id; }).join(',');
      var o3 = KL.retestItems(x.ls, 'o3').map(function (q) { return q.q_id; });
      return {
        pass: recallFirst(testRun) && recallFirst(run) && due === 4 && qs('o1') === 'o1r1,o1r2' && qs('o2') === 'o2a,o2r1' && qs('o3') === 'o3a,o3b' &&
          perObj.every(function (n) { return n <= KL.MAX_ITEMS; }) && re === 4 && second === 'o1r3,o1a',
        detail: 'due ' + due + ' · o1: ' + qs('o1') + ' · items per objective ' + perObj.join('/') + ' · re-test events ' + re + ' · next o1 re-test: ' + second + ' · o3 pool: ' + o3.join(',')
      };
    }]
  );

  tests.push(
    ['Drawer signal position: log scale from now to 60 days, monotonic, clamped', function () {
      var pos = global.App.signalPos, days = [0, 0.007, 0.25, 1, 3, 7, 14, 30, 59, 60, 400];
      var ps = days.map(pos), mono = ps.every(function (p, i) { return i === 0 || p >= ps[i - 1]; });
      var edges = pos(0) === 0 && pos(-3) === 0 && pos(NaN) === 0 && pos(null) === 0 && pos(undefined) === 0 && Math.abs(pos(60) - 1) < 1e-9 && pos(400) === 1;
      var ticks = [1, 7, 30].map(function (d) { return pos(d).toFixed(2); });
      return { pass: mono && edges && ps.every(function (p) { return p >= 0 && p <= 1; }), detail: 'ticks 1 d / 1 w / 1 mo at ' + ticks.join(' / ') + ' of the rail · 0 and invalid → 0 · 60 d and more → 1' };
    }],
    ['Deck guide colours: 1–6, distinct for the first six decks, stable for unknown ids', function () {
      var gi = global.App.guideIndex, ids = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'];
      var listed = ids.map(function (id) { return gi(id, ids); });
      var distinct = listed.slice(0, 6).filter(function (g, i, a) { return a.indexOf(g) === i; }).length === 6;
      var hashed = ['d_1', 'sample-bio', 'sample-chem', 'z9', null].map(function (id) { return gi(id); });
      var stable = hashed.every(function (g, i) { return g === gi(['d_1', 'sample-bio', 'sample-chem', 'z9', null][i]); });
      var inRange = listed.concat(hashed).every(function (g) { return g >= 1 && g <= 6 && g === Math.floor(g); });
      return { pass: distinct && stable && inRange && listed[6] === listed[0] && hashed.filter(function (g, i, a) { return a.indexOf(g) === i; }).length > 1, detail: 'listed decks → ' + listed.join(',') + ' · unknown ids → ' + hashed.join(',') };
    }]
  );

  tests.push(
    ['Final test opens at the start of a later study day; 90 minutes is the default session budget', function () {
      var h = 4, now = DSR.dayStart(100, h) + 15 * 3600 * 1000;
      var a = KEtut.finalOpenAt(now, 0, h), b = KEtut.finalOpenAt(now, 1, h), c = KEtut.finalOpenAt(now, 7, h);
      var budget = KEtut.phaseBudget(90), total = Object.keys(budget).reduce(function (s, k) { return s + budget[k]; }, 0);
      return { pass: a === now && b === DSR.dayStart(101, h) && c === DSR.dayStart(107, h) && total === 90 && KEtut.phaseBudget(undefined) === budget,
        detail: 'now → now · 1 day → next day start · 7 days → +7 · 90-min budget sums to ' + total };
    }]
  );

  // ------------------------------------------------------------------ Study v2 (cycle workflow, src/study-v2.js)
  function miniV2() {
    var crit = function (id) { return { id: id, text: 'Criterion ' + id }; };
    var mc = function (id, k, crits, use, extra) {
      return Object.assign({ q_id: id, version: 1, origin: 'generated', format: 'mcq_single', kazanim_id: k, outcomes: ['LO-1'], criteria: crits,
        stem: 'Item ' + id, options: [{ id: 'a', md: 'A' }, { id: 'b', md: 'B' }, { id: 'c', md: 'C' }], key: ['b'], solution: 'B', family: 'f-' + id, use: use, validation: 'verified' }, extra || {});
    };
    return {
      etut_id: 'test-v2', title: 'Test v2', version: 1, created_at: '2026-10-07', schema_version: 2, workflow: 'cycle-v2',
      units: [{ id: 'U1', source: 'S1', loc: 'p. 1', type: 'proposition', text: 'x', disposition: 'included' }],
      outcomes: [{ id: 'LO-1', part_id: 'p1', kazanim_id: 'k1', object: 'concept', performance: 'Explain x', units: ['U1'], criteria: [crit('C-1')], status: 'covered' }],
      parts: [{ part_id: 'p1', title: 'Part', kazanimlar: [{ kazanim_id: 'k1', title: 'Objective', outcomes: ['LO-1'], blocks: [{ type: 'text', md: 'Text', refs: ['U1'] }],
        recall: { prompt: 'Recall?', model_answer: 'Answer', key_points: ['p'] } }],
        summary: { md: 'One. Two. Three. Four. Five.', keywords: [] }, feynman: { prompt: 'Explain', criteria: ['C-1'] },
        items: [mc('i1', 'k1', ['C-1'], 'practice'), mc('i2', 'k1', ['C-1'], 'practice', { format: 'mcq_multi', options: [{ id: 'a', md: 'A' }, { id: 'b', md: 'B' }, { id: 'c', md: 'C' }, { id: 'd', md: 'D' }], key: ['a', 'b'] })] }],
      final_test: [mc('F1', 'k1', ['C-1'], 'final')]
    };
  }
  tests.push(
    ['Study v2: package validates, the ledger is certified, a criterion missing from the final test blocks certification', function () {
      var K = global.KCycle, p = miniV2(), a = K.audit(p), q = JSON.parse(JSON.stringify(p));
      q.final_test[0].criteria = [];
      var b = K.audit(q);
      return { pass: KEtut.validatePackage(p).length === 0 && a.certified && !b.certified && b.blockers.some(function (x) { return /C-1/.test(x); }),
        detail: 'complete: ' + a.blockers.length + ' blockers · without final criterion: ' + b.blockers.length + ' blocker(s)' };
    }],
    ['Study v2 → DSR: unassisted correct + Sure → Good; a hint makes it assisted (not sent); recall keeps the learner rating', function () {
      var K = global.KCycle, st = KStore.emptyState(), r = KEtut.importPackage(st, miniV2(), { now: NOW }), et = r.etut, idx = K.itemIndex(et.package);
      var a1 = K.startAttempt(et, idx.i1, 'practice', NOW);
      K.commit(et, a1, { choice: ['b'], confidence: 'sure' }, idx.i1, NOW + 20000);
      K.send(st, et, a1, idx.i1, etutEnvAt(NOW + 20000));
      var a2 = K.startAttempt(et, idx.i2, 'practice', NOW + 30000);
      K.useHelp(a2, 'hint');
      K.commit(et, a2, { choice: ['a', 'b'], confidence: 'sure' }, idx.i2, NOW + 40000);
      K.send(st, et, a2, idx.i2, etutEnvAt(NOW + 40000));
      var ri = idx['recall:k1'], a3 = K.startAttempt(et, ri, 'practice', NOW + 50000);
      K.commit(et, a3, { text: 'Answer' }, ri, NOW + 60000); K.setRecall(a3, 'hard', [0]);
      K.send(st, et, a3, ri, etutEnvAt(NOW + 60000));
      var ev = st.reviews;
      return { pass: ev.length === 2 && ev[0].rating === 'good' && ev[0].signal === 'quiz' && ev[0].attempt_id === a1.id && a2.dsr.status === 'not_sent' && ev[1].signal === 'recall' && ev[1].rating === 'hard' && DSR.isRecallSignal(ev[1]) && !DSR.isRecallSignal(ev[0]),
        detail: ev.length + ' events: ' + ev.map(function (e) { return e.signal + '/' + e.rating; }).join(', ') + ' · hinted attempt: ' + (a2.dsr && a2.dsr.reason) };
    }],
    ['Study v2: select-all compares sets; options are shuffled by stable id; a bundled package is not stored in the save', function () {
      var K = global.KCycle, st = KStore.emptyState(), r = KEtut.importPackage(st, miniV2(), { now: NOW }), et = r.etut, idx = K.itemIndex(et.package);
      var a = K.startAttempt(et, idx.i2, 'check', NOW, { rng: function () { return 0.1; } });
      K.commit(et, a, { choice: ['a', 'c'], confidence: 'sure' }, idx.i2, NOW + 1000);
      var s = a.result.set, pkg = et.package;
      K.attachPackage(et, pkg);
      var saved = JSON.parse(JSON.stringify(st.etuts['test-v2']));
      return { pass: a.result.correct === false && s.ok.join() === 'a' && s.missed.join() === 'b' && s.wrong.join() === 'c' && s.left.join() === 'd' && a.order.slice().sort().join() === 'a,b,c,d' && !saved.package && et.package === pkg && saved.pkg_ref.version === 1,
        detail: 'ok ' + s.ok + ' · missed ' + s.missed + ' · wrong ' + s.wrong + ' · order ' + a.order.join('') + ' · saved without package: ' + !saved.package };
    }],
    ['Study v2 topic cycles: each topic runs its own cycle, a connecting item waits for its latest topic, End opens only after every topic', function () {
      var K = global.KCycle, p = miniV2();
      p.parts[0].kazanimlar.push({ kazanim_id: 'k2', title: 'Second', outcomes: [], blocks: [{ type: 'text', md: 'More', refs: ['U1'] }], recall: { prompt: 'R2?', model_answer: 'A2' } });
      p.parts[0].items.push({ q_id: 'i3', version: 1, origin: 'generated', format: 'mcq_single', kazanim_id: 'k2', integrates: ['k1', 'k2'], outcomes: ['LO-1'], criteria: ['C-1'],
        stem: 'Both', options: [{ id: 'a', md: 'A' }, { id: 'b', md: 'B' }], key: ['a'], solution: 'A', family: 'f-i3', use: 'practice', validation: 'verified' });
      var st = KStore.emptyState(), et = KEtut.importPackage(st, p, { now: NOW }).etut, pr = et.progress;
      var t1 = K.topicItems(p, 0, 0).map(function (x) { return x.q_id; }).join(), t2 = K.topicItems(p, 0, 1).map(function (x) { return x.q_id; }).join();
      var locked = K.goto(et, 0, 0, 'end') === false;
      K.goto(et, 0, 1, 'apply', NOW); var jumped = pr.topic === 1 && pr.stage === 'apply';
      K.goto(et, 0, 0, 'evaluate', NOW); K.next(et, NOW); var onTo2 = pr.topic === 1 && pr.stage === 'priming';
      K.goto(et, 0, 1, 'evaluate', NOW); K.next(et, NOW);
      var bad = JSON.parse(JSON.stringify(p)); bad.parts[0].items[2].integrates = ['k2'];
      return { pass: t1 === 'recall:k1,i1,i2' && t2 === 'recall:k2,i3' && locked && jumped && onTo2 && pr.stage === 'final_plan' && K.validate(bad).errors.some(function (e) { return /integrates/.test(e); }),
        detail: 'topic 1: ' + t1 + ' · topic 2: ' + t2 + ' · End locked at first: ' + locked + ' · free jump: ' + jumped + ' · after both topics: ' + pr.stage };
    }],
    ['Study, lesson and mind-map events do not use up the Review daily limits; mind-map checks are not recall signals', function () {
      var st = KStore.emptyState(), env = baseEnv(NOW + 60000);
      ['etut', 'lesson', 'mindmap', null].forEach(function (src, i) { st.reviews.push({ card_id: 'c' + i, deck_id: 'd', reviewed_at: NOW, from_state: 'review', rating: 'good', source: src, signal: src === 'mindmap' ? 'mindmap_check' : undefined }); });
      var q = DSR.buildQueue(st, env, {});
      var mm = st.reviews[2];
      return { pass: q.totals.reviewDone === 1 && !DSR.isRecallSignal(mm), detail: 'reviews counted today: ' + q.totals.reviewDone + ' (only the Review-tab one) · mind-map check is recall signal: ' + DSR.isRecallSignal(mm) };
    }]
  );

  // ------------------------------------------------------------------ Study v2 with a model (task E2): what the engine does with the answers
  function typedV2() {
    var p = miniV2();
    p.outcomes[0].criteria.push({ id: 'C-2', text: 'Criterion C-2' });
    p.parts[0].items.push({ q_id: 't1', version: 1, origin: 'generated', format: 'typed', kazanim_id: 'k1', outcomes: ['LO-1'], criteria: ['C-1', 'C-2'], units: ['U1'],
      stem: 'Is the gate open with A on and B off? Say why.',
      rubric: { criteria: [{ id: 'C-1', text: 'Says closed.', required: true }, { id: 'C-2', text: 'Gives the reason: B is off.', required: true }], accept: [], contradictions: ['Says open'], model: 'Closed, because B is off.' },
      solution: 'Closed.', family: 'f-t1', use: 'practice', validation: 'verified' });
    return p;
  }
  var clone2 = function (x) { return JSON.parse(JSON.stringify(x)); };
  var META = { provider: 'fake', providerLabel: 'Fake provider', model: 'fake-model-1', costUsd: 0.002, costKind: 'api' };
  var PROMPT = { promptId: 'x', promptVersion: 1, promptHash: null };
  function answeredTyped(text, now) {
    var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, typedV2(), { now: NOW }).etut, idx = K.itemIndex(et.package);
    var a = K.startAttempt(et, idx.t1, 'practice', now || NOW);
    K.commit(et, a, { text: text, confidence: 'sure' }, idx.t1, (now || NOW) + 1000);
    return { K: K, st: st, et: et, item: idx.t1, a: a };
  }
  tests.push(
    ['In-app Explain: the answer is saved on the attempt, an earlier one is kept, and nothing the scheduler reads changes', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, miniV2(), { now: NOW }).etut, idx = K.itemIndex(et.package);
      var a = K.startAttempt(et, idx.i1, 'practice', NOW);
      var early = K.saveExplanation(a, { explanation_md: 'x' }, {});
      K.commit(et, a, { choice: ['b'], confidence: 'sure' }, idx.i1, NOW + 1000);
      var before = JSON.stringify([a.result, a.grading, a.dsr, a.confidence, a.hints, a.committed_at]), elig = JSON.stringify(K.eligibility(a, idx.i1));
      var inp = K.explainInputs(et, a, idx.i1, 'deep', { note: 'why B?' });
      var s1 = K.saveExplanation(a, { explanation_md: 'First **text**.', item_status: 'consistent', item_note: '', refs: ['p. 1'], next_steps: ['Reread p. 1'] }, { depth: 'deep', note: 'why B?', now: NOW + 2000, meta: META, prompt: PROMPT });
      var s2 = K.saveExplanation(a, { explanation_md: 'Second.', item_status: 'disputed', item_note: 'The key is odd.', refs: [], next_steps: [] }, { now: NOW + 3000, meta: META, prompt: PROMPT });
      var empty = K.saveExplanation(a, { explanation_md: '   ' }, {});
      var after = JSON.stringify([a.result, a.grading, a.dsr, a.confidence, a.hints, a.committed_at]);
      var list = K.explanationsOf(a, { explanations: { x: 1 } }), withFile = K.explanationsOf(a, { explanations: (function () { var o = {}; o[a.id] = { md: 'From a file', refs: [] }; return o; })() });
      var c = [!early.ok, s1.ok, s2.ok, !empty.ok, a.explanations.length === 2, a.explanations[0].md === 'First **text**.', a.explanations[0].by.model === 'fake-model-1', a.explanations[0].by.provider === 'Fake provider',
        a.explanations[1].item_status === 'disputed', before === after, elig === JSON.stringify(K.eligibility(a, idx.i1)), K.eligibility(a, idx.i1).eligible,
        /Question: Item i1/.test(inp.attempt), /Depth: deep/.test(inp.attempt), /My question: why B\?/.test(inp.attempt), /U1 \[p\. 1\]: x/.test(inp.sources), /Text/.test(inp.sources),
        list.length === 2, withFile.length === 3, withFile[0].from_file === true];
      return { pass: c.every(Boolean),
        detail: 'explanations kept: ' + a.explanations.length + ' · result, grading, dsr and eligibility unchanged: ' + (before === after) + ' · request facts carry the question, depth and note · checks ' + c.map(Number).join('') };
    }],
    ['Practice this again: model items go through validateExtra, stay in the learner data, show as follow-up practice and never reach DSR', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, miniV2(), { now: NOW }).etut, idx = K.itemIndex(et.package);
      var a = K.startAttempt(et, idx.i1, 'practice', NOW);
      K.commit(et, a, { choice: ['a'], confidence: 'sure' }, idx.i1, NOW + 1000);
      var good = { items: [
        { format: 'mcq_single', stem: 'Which switch setting closes the gate?', options: [{ id: 'a', md: 'Both on', note: 'Opens it.' }, { id: 'b', md: 'B off', note: 'Correct.' }, { id: 'c', md: 'Display on', note: 'Irrelevant.' }], key: ['b'], numeric_value: 0, numeric_tol: 0, numeric_unit: '', rubric_criteria: [], model_answer: '', accept: [], contradictions: [], solution: 'B off closes it.', hints: ['Think of the rule.'], units: ['U1', 'U9'], difference: 'A new situation.' },
        { format: 'numeric', stem: 'How many of the 4 settings open the gate?', options: [], key: [], numeric_value: 1, numeric_tol: 0, numeric_unit: '', rubric_criteria: [], model_answer: '', accept: [], contradictions: [], solution: 'One.', hints: [], units: [], difference: 'Counting.' }] };
      var b = K.buildFollowups(et, a, idx.i1, good, { now: NOW + 5000, meta: META, prompt: PROMPT });
      var bad = clone2(good); bad.items[0].key = ['a', 'b']; bad.items[0].stem = idx.i1.stem; bad.items[1].numeric_value = 'many';
      var rb = K.buildFollowups(et, a, idx.i1, bad, {});
      var dup = clone2(good); dup.items = [dup.items[0], clone2(dup.items[0])];
      var rd = K.buildFollowups(et, a, idx.i1, dup, {});
      K.storeFollowups(et, a, b.items);
      var b2 = K.buildFollowups(et, a, idx.i1, good, { now: NOW + 9000 });
      var ex = K.withFollowups(et, null), ix = K.itemIndex(et.package, ex), q = b.items[0].q_id;
      var fa = K.startAttempt(et, ix[q], 'practice', NOW + 10000);
      K.commit(et, fa, { choice: ['b'], confidence: 'sure' }, ix[q], NOW + 11000);
      var el = K.eligibility(fa, ix[q]), sent = K.send(st, et, fa, ix[q], etutEnvAt(NOW + 11000));
      var gone = clone2(et); delete gone.package; gone.package = clone2(et.package); gone.package.parts[0].kazanimlar[0].kazanim_id = 'k-gone';
      var stale = K.withFollowups(gone, null);
      return { pass: !b.problems.length && b.items.length === 2 && b.items[0].followup_of === a.id && b.items[0].validation === 'unverified' && b.items[0].use === 'practice' && b.items[0].part_id === 'p1' && b.items[0].units.join() === 'U1'
        && b.items[0].option_notes.b === 'Correct.' && b.items[0].made_by.model === 'fake-model-1'
        && rb.items.length === 0 && rb.problems.length >= 2 && rd.items.length === 0 && rd.problems.some(function (p) { return /repeats/.test(p); })
        && et.progress.followups[q] && a.followup_items.length === 2 && b2.items[0].q_id !== q
        && ix[q] && ix[q].followup_of === a.id && !el.eligible && /follow-up/i.test(el.reason) && st.reviews.length === 0 && !sent.eligible
        && !(stale && stale.items && stale.items[q]),
        detail: 'valid set kept (' + b.items.length + ' items, unverified, follow-up of the attempt) · broken set: ' + rb.problems.length + ' problems, nothing kept · follow-up attempt: ' + el.reason + ' · reviews sent: ' + st.reviews.length };
    }],
    ['Typed answers: a model proposal needs real quotes; confirmed as proposed it is recorded as "model" with provider and model, changed it is "self"; DSR rule unchanged', function () {
      var t = answeredTyped('The gate is closed, because switch B is off.');
      var K = t.K, p = K.checkGradingProposal(t.item, t.a, { summary: 'Both there.', criteria: [
        { id: 'C-1', mark: 'met', quote: 'the gate is closed', reason: 'It says closed.' },
        { id: 'C-2', mark: 'met', quote: 'because switch B is off', reason: 'Gives the reason.' }] });
      var fake = K.checkGradingProposal(t.item, t.a, { summary: '', criteria: [
        { id: 'C-1', mark: 'met', quote: 'words that are not in the answer', reason: 'x' }, { id: 'C-9', mark: 'met', quote: 'b', reason: '' }] });
      var inputs = K.gradingInputs(t.item, t.a);
      K.confirmModelGrading(t.a, t.item, p, p.marks, { now: NOW + 5000, meta: META, prompt: PROMPT });
      // the same marks given by the learner alone
      var s = answeredTyped('The gate is closed, because switch B is off.');
      K.setCriteria(s.a, s.item, { 'C-1': 'met', 'C-2': 'met' });
      // the learner changes one mark of the proposal
      var c = answeredTyped('The gate is closed, because switch B is off.');
      var pc = K.checkGradingProposal(c.item, c.a, { summary: '', criteria: [{ id: 'C-1', mark: 'met', quote: 'the gate is closed', reason: '' }, { id: 'C-2', mark: 'met', quote: 'switch B is off', reason: '' }] });
      K.confirmModelGrading(c.a, c.item, pc, { 'C-1': 'met', 'C-2': 'not' }, { meta: META, prompt: PROMPT });
      // a "not met" whose quote is not in the answer loses the quote and keeps its mark
      var u = answeredTyped('Closed.');
      var pu = K.checkGradingProposal(u.item, u.a, { summary: '', criteria: [{ id: 'C-1', mark: 'met', quote: 'Closed.', reason: '' }, { id: 'C-2', mark: 'not_met', quote: 'switch B is off', reason: 'No reason given.' }] });
      K.confirmModelGrading(u.a, u.item, pu, pu.marks, { meta: META, prompt: PROMPT });
      var strip = function (e) { return { eligible: e.eligible, signal: e.signal, rating: e.rating }; };
      return { pass: p.marks['C-1'] === 'met' && p.marks['C-2'] === 'met' && fake.marks['C-1'] === 'unsure' && fake.marks['C-2'] === 'unsure' && fake.rows[0].quote === '' && fake.notes.length >= 2
        && t.a.grading === 'model' && t.a.model_grading.by.provider === 'Fake provider' && t.a.model_grading.by.model === 'fake-model-1' && t.a.model_grading.changed.length === 0 && t.a.result.correct === true
        && s.a.grading === 'self' && JSON.stringify(strip(K.eligibility(t.a, t.item))) === JSON.stringify(strip(K.eligibility(s.a, s.item))) && K.eligibility(t.a, t.item).eligible
        && c.a.grading === 'self' && c.a.model_grading.changed.join() === 'C-2' && c.a.result.correct === false
        && u.a.result.criteria['C-1'] === 'met' && u.a.result.criteria['C-2'] === 'not' && u.a.result.correct === false
        && /Says closed\./.test(inputs.criteria) && /Closed, because B is off\./.test(inputs.model_answer) && /Says open/.test(inputs.rules),
        detail: 'unquoted "met" → ' + fake.marks['C-1'] + ' · confirmed as proposed: ' + t.a.grading + ' (' + t.a.model_grading.by.provider + ', ' + t.a.model_grading.by.model + ') · same marks by hand: ' + s.a.grading + ', same eligibility · one mark changed: ' + c.a.grading + ' (changed ' + c.a.model_grading.changed + ')' };
    }],
    ['Feynman feedback: a quote must be in the learner\'s text, "covered" needs one, versions and "satisfied" are never touched', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, miniV2(), { now: NOW }).etut, pr = et.progress;
      K.migrate(pr, et.package);
      var text = 'The gate opens only when both switches are on. I think the display decides it.';
      pr.feynman.k1 = [{ n: 1, text: text, at: NOW }]; pr.satisfied.k1 = null;
      var k = et.package.parts[0].kazanimlar[0], inp = K.feynmanInputs(et, k, pr.feynman.k1[0]);
      var before = JSON.stringify([pr.feynman, pr.satisfied]);
      var rec = K.checkFeynmanFeedback(text, inp._ids, { criteria: [{ id: 'C-1', status: 'covered', quote: 'only when both switches are on', comment: 'Says the condition.' }], misstatements: [{ quote: 'the display decides it', comment: 'The source says the switches decide.' }, { quote: 'a sentence nobody wrote', comment: 'x' }], questions: ['What if A is off?'], overall: 'A good start.' });
      var fake = K.checkFeynmanFeedback(text, inp._ids, { criteria: [{ id: 'C-1', status: 'covered', quote: 'invented words', comment: '' }], misstatements: [], questions: [], overall: '' });
      var none = K.checkFeynmanFeedback(text, inp._ids, { criteria: [], misstatements: [], questions: [], overall: '' });
      K.saveFeynmanFeedback(et, 'k1', 1, rec, { now: NOW + 9, meta: META, prompt: PROMPT });
      K.saveFeynmanFeedback(et, 'k1', 1, fake, { now: NOW + 10, meta: META, prompt: PROMPT });
      return { pass: inp._ids.join() === 'C-1' && /C-1: Criterion C-1/.test(inp.criteria) && inp.explanation === text && /Text/.test(inp.sources)
        && rec.criteria[0].status === 'covered' && rec.criteria[0].quote === 'only when both switches are on' && rec.misstatements.length === 1 && rec.questions.length === 1
        && fake.criteria[0].status === 'unclear' && fake.criteria[0].quote === '' && fake.notes.length === 1 && none.criteria[0].status === 'unclear'
        && pr.feynman_feedback.k1.length === 2 && pr.feynman_feedback.k1[0].by.model === 'fake-model-1' && before === JSON.stringify([pr.feynman, pr.satisfied]),
        detail: 'real quote kept · invented quote dropped (status ' + fake.criteria[0].status + ') · invented sentence in misstatements dropped · feedback kept per version, versions and "satisfied" unchanged' };
    }],
    ['Learner data: older study progress gets the two new empty lists and every other field is unchanged; a card question carries the card and its study text', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, miniV2(), { now: NOW }).etut;
      var old = { v: 'c2', cv: 2, part: 0, topic: 0, stage: 'apply', started_at: NOW, finished_at: null, duration: 60, phase_ms: { apply: 5 }, seen: {}, notes: { k1: 'n' }, qlist: {}, feynman: { k1: [{ n: 1, text: 't', at: 1 }] },
        satisfied: {}, maps: {}, evaluating: {}, mode: 'practice', attempts: [{ id: 'at-1', q_id: 'i1', committed_at: 5, result: { correct: true }, grading: 'auto', dsr: { status: 'sent' }, explain_requested: 7 }], current: null, final: null, warmup: null, visit_n: 3, misconceptions: { k1: true } };
      var copy = clone2(old), m = K.migrate(clone2(old), et.package);
      var kept = m.cv === 3 && Object.keys(copy).every(function (k) { return k === 'cv' || JSON.stringify(m[k]) === JSON.stringify(copy[k]); });
      var again = JSON.stringify(K.migrate(clone2(m), et.package)) === JSON.stringify(m);
      var card = st.cards[et.card_map.k1], ask = global.KPrep.cardAskInputs(st, card, '  ');
      var withQ = global.KPrep.cardAskInputs(st, card, 'Why B?');
      return { pass: kept && again && JSON.stringify(m.followups) === '{}' && JSON.stringify(m.feynman_feedback) === '{}' && ask.card.indexOf('Front: ' + card.front) === 0 && /Back: /.test(ask.card)
        && /U1 \[p\. 1\]: x/.test(ask.sources) && /Lesson text of this topic/.test(ask.sources) && /Explain why the answer/.test(ask.question) && withQ.question === 'Why B?',
        detail: 'all ' + Object.keys(copy).length + ' earlier fields identical after migrate: ' + kept + ' · migrating twice changes nothing: ' + again + ' · card question has the card, its source units and lesson text' };
    }]
  );

  // ------------------------------------------------------------------ thinking fields and the 0-100 confidence (task F1)
  tests.push(
    ['Confidence 0-100: the bands are 0-39 guess, 40-79 unsure, 80-100 sure; a word keeps itself and gets no number; the scheduler rule is unchanged', function () {
      var b = function (x) { return KEtut.confBand(x); };
      var bands = [b(0), b(39), b(40), b(79), b(80), b(100), b(null), b(''), b(101), b(-1), b('x')];
      var w = KEtut.confidenceOf('unsure'), n = KEtut.confidenceOf(79.6), nn = KEtut.confidenceOf(null);
      // the same rule as before for every number: only "sure" turns a right answer into Good and a wrong one into a misconception
      var rule = true, i;
      for (i = 0; i <= 100; i++) {
        var band = KEtut.confBand(i), r = DSR.mapEtutSignal({ signal: 'quiz', correct: true, confidence: band }), x = DSR.mapEtutSignal({ signal: 'quiz', correct: false, confidence: band });
        if ((r.rating === 'good') !== (i >= 80) || r.rating === 'again' || x.rating !== 'again' || x.misconception !== (i >= 80)) rule = false;
      }
      return { pass: bands.join() === 'guess,guess,unsure,unsure,sure,sure,,,,,' && w.confidence === 'unsure' && w.confidence_pct === null && n.confidence === 'sure' && n.confidence_pct === 80 && nn.confidence === null && rule && KEtut.BAND_PCT.sure === 90,
        detail: 'bands at 0, 39, 40, 79, 80, 100: ' + bands.slice(0, 6).join(' ') + ' · out of range or empty: none · scheduler rule holds for all 101 values: ' + rule };
    }],
    ['A new attempt keeps the thinking text and a numeric confidence; the word band goes to the scheduler; the text never changes evidence', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, miniV2(), { now: NOW }).etut, idx = K.itemIndex(et.package);
      var a = K.startAttempt(et, idx.i1, 'practice', NOW), long = new Array(4100).join('x');
      K.commit(et, a, { choice: ['b'], thinking: long, confidence_pct: 85 }, idx.i1, NOW + 1000);
      var el = K.eligibility(a, idx.i1);
      K.send(st, et, a, idx.i1, etutEnvAt(NOW + 1000));
      var b = K.startAttempt(et, idx.i1, 'practice', NOW + 5000);
      K.commit(et, b, { choice: ['b'], confidence: 'sure', working: 'old style' }, idx.i1, NOW + 6000);   // an older caller still works
      var c = K.startAttempt(et, idx.i2, 'practice', NOW + 7000);
      K.commit(et, c, { choice: ['a', 'b'], confidence_pct: 79 }, idx.i2, NOW + 8000);
      var empty = K.startAttempt(et, idx.i2, 'practice', NOW + 9000);
      K.commit(et, empty, { choice: ['a', 'b'], confidence_pct: 90, thinking: '   ' }, idx.i2, NOW + 9500);
      return { pass: a.confidence === 'sure' && a.confidence_pct === 85 && a.thinking.length === 4000 && a.response.working === a.thinking && a.thinking_at === NOW + 1000 && el.eligible && el.rating === 'good'
        && b.confidence === 'sure' && b.confidence_pct === null && b.thinking === 'old style'
        && c.confidence === 'unsure' && c.confidence_pct === 79 && K.eligibility(c, idx.i2).rating === 'hard' && c.thinking === undefined && empty.thinking === undefined
        && st.reviews.length === 1 && st.reviews[0].confidence === 'sure',
        detail: '85 → ' + a.confidence + '/Good, thinking kept (' + a.thinking.length + ' characters, cap 4000) and mirrored into working · 79 → ' + c.confidence + '/Hard · an empty thinking box stores nothing · an old caller with a word still works' };
    }],
    ['"I don\'t know": not correct, no confidence, eligible as Again without the misconception flag; free recall is unaffected', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, typedV2(), { now: NOW }).etut, idx = K.itemIndex(et.package);
      var a = K.startAttempt(et, idx.i1, 'practice', NOW);
      K.commit(et, a, { dont_know: true, thinking: 'no idea where to start' }, idx.i1, NOW + 1000);
      var el = K.eligibility(a, idx.i1); K.send(st, et, a, idx.i1, etutEnvAt(NOW + 1000));
      var t = K.startAttempt(et, idx.t1, 'practice', NOW + 2000);
      K.commit(et, t, { dont_know: true }, idx.t1, NOW + 3000);
      var tel = K.eligibility(t, idx.t1);
      var n = K.startAttempt(et, idx.i2, 'practice', NOW + 4000);
      K.commit(et, n, { dont_know: true }, idx.i2, NOW + 5000);
      var ri = idx['recall:k1'], r = K.startAttempt(et, ri, 'practice', NOW + 6000);
      K.commit(et, r, { text: 'Answer', dont_know: true }, ri, NOW + 7000);
      return { pass: a.dont_know === true && a.confidence === null && a.confidence_pct === null && a.result.correct === false && a.grading === 'auto' && el.eligible && el.rating === 'again' && !el.misconception
        && st.reviews.length === 1 && st.reviews[0].rating === 'again' && !(et.progress.misconceptions && et.progress.misconceptions.k1)
        && t.result.correct === false && t.result.criteria['C-1'] === 'not' && tel.eligible && n.result.set.missed.join() === 'a,b'
        && !r.dont_know && r.result.correct === null && a.thinking === 'no idea where to start',
        detail: 'MCQ and typed: ' + el.rating + ', misconception flag ' + !!el.misconception + ' · typed criteria all "not" · free recall ignores it (' + (r.dont_know ? 'no' : 'yes') + ')' };
    }],
    ['The help log: every hint, step, solution and lesson is recorded with its time, makes the attempt assisted, and the old counters are still written', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, miniV2(), { now: NOW }).etut, idx = K.itemIndex(et.package);
      var a = K.startAttempt(et, idx.i1, 'practice', NOW), none = K.assisted(a);
      K.useHelp(a, 'hint'); K.useHelp(a, 'solution'); K.useHelp(a, 'pane');
      K.commit(et, a, { choice: ['b'], confidence_pct: 90 }, idx.i1, NOW + 1000);
      var logged = JSON.stringify(a.help.map(function (h) { return h.kind; }));
      var old = { hints: 0, steps: 0, solution_shown: false, pane_open: false }, oldAssisted = K.assisted(old);
      var viaLog = K.assisted({ hints: 0, steps: 0, help: [{ kind: 'model_hint' }] });
      return { pass: !none && K.assisted(a) && logged === '["pkg_hint","solution","lesson_pane"]' && a.hints === 1 && a.solution_shown === true && a.pane_open === true && !oldAssisted && viaLog && !K.eligibility(a, idx.i1).eligible,
        detail: 'logged ' + logged + ' · counters kept · an old record without a log reads as before' };
    }],
    ['Migration cv 2 → 3: new containers, "thinking" copied from an old "working", nothing removed, no confidence number invented, idempotent', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, miniV2(), { now: NOW }).etut;
      var old = { v: 'c2', cv: 2, part: 0, topic: 0, stage: 'apply', started_at: NOW, finished_at: null, duration: 60, phase_ms: {}, seen: {}, notes: { k1: 'n' }, qlist: {}, feynman: {}, satisfied: {}, maps: {}, evaluating: {}, mode: 'practice',
        attempts: [{ id: 'a1', q_id: 'i1', committed_at: 5, confidence: 'sure', response: { choice: ['b'], text: '', working: 'I thought of the rule', number: null }, result: { correct: true }, grading: 'auto', dsr: { status: 'sent' } },
          { id: 'a2', q_id: 'i2', committed_at: 6, confidence: 'unsure', response: { choice: ['a'], text: '', working: '', number: null }, result: { correct: false }, grading: 'auto' }],
        current: null, final: null, warmup: null, visit_n: 1, misconceptions: {} };
      var copy = clone2(old), m = K.migrate(clone2(old), et.package), again = JSON.stringify(K.migrate(clone2(m), et.package)) === JSON.stringify(m);
      var same = Object.keys(copy).every(function (k) { return k === 'cv' || k === 'attempts' || JSON.stringify(m[k]) === JSON.stringify(copy[k]); });
      var a1 = m.attempts[0], a2 = m.attempts[1], strip = function (a) { var c = clone2(a); delete c.thinking; return JSON.stringify(c); };
      // progress from before topic cycles (no cv) ends at 3 as well
      var legacy = clone2(old); delete legacy.cv; legacy.topic = undefined;
      var ml = K.migrate(legacy, et.package);
      return { pass: m.cv === 3 && same && again && a1.thinking === 'I thought of the rule' && a1.response.working === 'I thought of the rule' && a2.thinking === undefined && strip(a1) === JSON.stringify(copy.attempts[0]) && strip(a2) === JSON.stringify(copy.attempts[1])
        && a1.confidence === 'sure' && a1.confidence_pct === undefined && JSON.stringify([m.reading_thinking, m.topic_mode, m.live, m.skipped]) === '[{},{},{},{}]' && ml.cv === 3,
        detail: 'cv 2 → ' + m.cv + ' · working kept and copied to thinking · the answer without working untouched · old "sure" has no number · migrating twice changes nothing: ' + again };
    }],
    ['Calibration: banded table over study items, lesson tests and older answers; the fine view uses only numbered, unassisted answers; "I don\'t know" is left out', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, miniV2(), { now: NOW }).etut, idx = K.itemIndex(et.package);
      var go = function (item, choice, pct, word, help) {
        var a = K.startAttempt(et, item, 'practice', NOW + et.progress.attempts.length * 100000);
        if (help) K.useHelp(a, 'hint');
        K.commit(et, a, { choice: choice, confidence_pct: pct, confidence: word }, item, NOW + 1);
        return a;
      };
      go(idx.i1, ['b'], 90);           // right, 90
      go(idx.i1, ['a'], 90);           // wrong, 90
      go(idx.i1, ['b'], 30);           // right, 30
      go(idx.i1, ['b'], 95, null, true);  // right, assisted: banded yes, fine no
      go(idx.i1, ['b'], null, 'sure'); // an old word record: banded only
      var dk = K.startAttempt(et, idx.i1, 'practice', NOW + 9e6); K.commit(et, dk, { dont_know: true }, idx.i1, NOW + 9e6 + 1);
      var fu = K.startAttempt(et, idx.i1, 'practice', NOW + 9e7); fu.followup_of = 'x'; K.commit(et, fu, { choice: ['b'], confidence_pct: 50 }, idx.i1, NOW + 9e7 + 1);
      st.lessons.l1 = { progress: { runs: [{ answers: { 'q:1': { type: 'mcq', confidence: 'sure', confidence_pct: 82, correct: true }, 'q:2': { type: 'mcq', confidence: 'guess', correct: false }, 'q:3': { type: 'mcq', dont_know: true, confidence: null, correct: false }, 'r:1': { type: 'recall', text: 'x' } } }] } };
      var rec = KMeta.confidenceRecords(st), band = KMeta.confidenceAccuracy(st), fine = KMeta.confidenceCurve(st);
      var bin90 = fine.bins[9], bin30 = fine.bins[3], bin80 = fine.bins[8];
      // Brier: (0.9-1)^2 + (0.9-0)^2 + (0.3-1)^2 + (0.82-1)^2 over 4 answers
      var brier = (0.01 + 0.81 + 0.49 + 0.0324) / 4;
      return { pass: rec.length === 7 && band.sure.n === 5 && band.sure.correct === 4 && band.unsure.n === 0 && band.guess.n === 2 && band.guess.correct === 1
        && fine.n === 4 && bin90.n === 2 && bin90.correct === 1 && bin30.n === 1 && bin80.n === 1 && Math.abs(fine.brier - brier) < 1e-9 && Math.abs(fine.accuracy - 0.75) < 1e-9 && Math.abs(fine.mean_conf - (90 + 90 + 30 + 82) / 4) < 1e-9,
        detail: 'records ' + rec.length + ' (study 5 incl. assisted and a word-only one, lesson 2) · banded: sure ' + band.sure.correct + '/' + band.sure.n + ', guess ' + band.guess.correct + '/' + band.guess.n + ' · fine view n=' + fine.n + ', Brier ' + (fine.brier == null ? '-' : fine.brier.toFixed(3)) };
    }],
    ['Thinking while reading: versions per topic, an unchanged or empty text saves nothing, 4000 characters at most', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, miniV2(), { now: NOW }).etut;
      var r1 = K.saveReadingThinking(et, 'k1', 'first note', NOW), same = K.saveReadingThinking(et, 'k1', 'first note', NOW + 1), blank = K.saveReadingThinking(et, 'k1', '   ', NOW + 2);
      var r2 = K.saveReadingThinking(et, 'k1', new Array(4100).join('y'), NOW + 3), l = et.progress.reading_thinking.k1;
      return { pass: r1.n === 1 && same === null && blank === null && r2.n === 2 && l.length === 2 && l[0].text === 'first note' && l[1].text.length === 4000 && l[1].at === NOW + 3,
        detail: 'versions: ' + l.length + ' · unchanged and empty texts saved nothing · cap ' + l[1].text.length };
    }]
  );

  // ------------------------------------------------------------------ the hint ladder (task F2)
  function hintReply(rung, hint, reveals) { return { rung: rung, stuck_at: 'Which switch settings keep the gate closed', hint: hint, reveals: reveals || '' }; }
  tests.push(
    ['Hint ladder: each request is one rung higher (R0 to R5), every rung is recorded with its level, and the ladder ends after R5', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, typedV2(), { now: NOW }).etut, idx = K.itemIndex(et.package);
      var a = K.startAttempt(et, idx.i1, 'practice', NOW), asked = [], texts = ['Re-read the rule.', 'Think about how the two switches relate.', 'It is one of the combining rules.', 'Use the rule that needs both conditions.', 'Check each setting against it.', 'With B off the second condition fails.'];
      var seq = [], r;
      for (var i = 0; i < 7; i++) {
        var req = K.nextRung(a);
        seq.push(req);
        if (!req) break;
        r = K.recordModelHint(a, idx.i1, hintReply(req, texts[i]), { requested: req, now: NOW + i, meta: META, prompt: PROMPT });
        asked.push(r.ok);
      }
      var inp = K.hintInputs(et, a, idx.i1, { choice: ['a'], thinking: 'maybe it is open' }, 'R0');
      return { pass: seq.join() === 'R0,R1,R2,R3,R4,R5,' && asked.every(Boolean) && a.help.length === 6 && a.help.map(function (h) { return h.level; }).join() === 'R0,R1,R2,R3,R4,R5' && a.model_hints === 5
        && K.modelHintLevel(a) === 'R5' && a.help[2].by.model === 'fake-model-1' && a.help[0].text === 'Re-read the rule.' && /R4: Check each setting/.test(inp.given) && /R0: Re-read/.test(inp.given) && /maybe it is open/.test(inp.thinking) && inp.requested === 'R0',
        detail: 'requests: ' + seq.join(' ') + ' · levels recorded: ' + a.help.map(function (h) { return h.level; }).join(' ') + ' · the next request lists the earlier rungs' };
    }],
    ['Hint ladder: any model hint (R0 too) makes the attempt assisted and not DSR-eligible like a package hint; a statement repair does not; Check mode and answered attempts get none', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, miniV2(), { now: NOW }).etut, idx = K.itemIndex(et.package);
      var a = K.startAttempt(et, idx.i1, 'practice', NOW), r = K.recordModelHint(a, idx.i1, hintReply('R0', 'Look at the options again.'), { requested: 'R0', now: NOW, meta: META, prompt: PROMPT });
      K.commit(et, a, { choice: ['b'], confidence_pct: 90 }, idx.i1, NOW + 1000);
      var el = K.eligibility(a, idx.i1), sent = K.send(st, et, a, idx.i1, etutEnvAt(NOW + 1000));
      var b = K.startAttempt(et, idx.i2, 'practice', NOW + 5000), rep = K.recordModelHint(b, idx.i2, { rung: 'statement_repair', stuck_at: 'The wording', hint: 'It asks which option states the rule; give one letter.', reveals: '' }, { requested: 'statement_repair', now: NOW + 5001, meta: META, prompt: PROMPT });
      K.commit(et, b, { choice: ['a', 'b'], confidence_pct: 90 }, idx.i2, NOW + 6000);
      var elb = K.eligibility(b, idx.i2);
      var c = K.startAttempt(et, idx.i1, 'check', NOW + 7000), chk = K.recordModelHint(c, idx.i1, hintReply('R0', 'x y z'), { requested: 'R0' });
      var d = K.startAttempt(et, idx.i1, 'practice', NOW + 8000); K.commit(et, d, { choice: ['b'], confidence_pct: 90 }, idx.i1, NOW + 9000);
      var late = K.recordModelHint(d, idx.i1, hintReply('R0', 'x y z'), { requested: 'R0' });
      return { pass: r.ok && K.assisted(a) && a.model_hints === 0 && !el.eligible && /Assisted \(.*model hint R0/.test(el.reason) && !sent.eligible && st.reviews.length === 0 && a.hints === 0
        && rep.ok && !K.assisted(b) && b.help[0].kind === 'statement_repair' && b.model_hints === undefined && elb.eligible && !chk.ok && !late.ok,
        detail: 'R0: ' + el.reason + ' · repair only: eligible ' + elb.eligible + ' · Check mode: ' + (chk.ok ? 'allowed' : 'refused') + ' · after answering: ' + (late.ok ? 'allowed' : 'refused') };
    }],
    ['Hint ladder: a reply above the requested rung, one that names the answer or copies the solution below R3, or a repair that reveals something is refused and recorded nowhere', function () {
      var K = global.KCycle, st = KStore.emptyState(), et = KEtut.importPackage(st, miniV2(), { now: NOW }).etut, idx = K.itemIndex(et.package);
      var num = { q_id: 'n1', format: 'numeric', stem: 'How many settings open the gate?', numeric: { value: 12, tol: 0, unit: '' }, solution: 'Count the settings where both switches are on and the gate is therefore open in the rule.' };
      var a = K.startAttempt(et, idx.i1, 'practice', NOW), rec = function (reply, req, item) { return K.recordModelHint(a, item || idx.i1, reply, { requested: req, now: NOW, meta: META, prompt: PROMPT }); };
      var high = rec(hintReply('R3', 'Use the rule that needs both.'), 'R1');
      var number = rec(hintReply('R1', 'The answer is 12 in total.'), 'R1', num);
      var copied = rec(hintReply('R2', 'Remember to count the settings where both switches are on and the gate is therefore open in the rule.'), 'R2', num);
      var keyText = rec(hintReply('R1', 'The correct choice is B, as you can see.'), 'R1', Object.assign({}, idx.i1, { options: [{ id: 'a', md: 'A' }, { id: 'b', md: 'The correct choice is B' }, { id: 'c', md: 'C' }], key: ['b'] }));
      var repair = rec({ rung: 'statement_repair', stuck_at: 'x', hint: 'It asks for a count.', reveals: 'the rule to use' }, 'statement_repair');
      var empty = rec(hintReply('R0', '   '), 'R0');
      var ok3 = rec(hintReply('R3', 'The answer is 12 in total.'), 'R3', num);   // at R3 the number is still not allowed
      var fine = rec(hintReply('R1', 'Think about what makes the gate open.'), 'R1', num);
      return { pass: !high.ok && !number.ok && /numeric answer/.test(number.problems[0]) && !copied.ok && /solution/.test(copied.problems[0]) && !keyText.ok && !repair.ok && !empty.ok && !ok3.ok && fine.ok && a.help.length === 1,
        detail: 'refused: rung too high, the number, copied solution, the key text, a repair that reveals, an empty hint · kept: ' + a.help.length };
    }]
  );

  tests.push(
    ['Backup file: the export is the whole saved state and survives a round trip; inspectBackup rejects foreign or newer files', function () {
      var st = KStore.buildSampleState(NOW);
      st.etuts.s1 = { etut_id: 's1', progress: { answers: { q1: { ok: true } } }, card_map: {} };
      st.lessons.l1 = { lesson_id: 'l1' }; st.mocks.m1 = { mock_id: 'm1' }; st.mindmaps.mm1 = { map_id: 'mm1', attempts: [{ id: 'a1' }] };
      st.cents.done = { 'at1.1': true }; st.tud.apply = { ticked: { x: 1 } };
      var file = JSON.stringify(st), back = JSON.parse(file), info = KStore.inspectBackup(back);
      var again = JSON.stringify(KStore.normalize(back)), same = JSON.parse(again);
      var kept = ['decks', 'cards', 'mem', 'etuts', 'lessons', 'mocks', 'mindmaps', 'cents', 'tud', 'settings', 'params'].every(function (k) { return JSON.stringify(same[k]) === JSON.stringify(st[k]); })
        && same.reviews.length === st.reviews.length;
      var bad = [null, [], {}, { cards: {}, reviews: {} }, { cards: {}, reviews: [], version: 99 }].map(function (x) { return KStore.inspectBackup(x).ok; });
      return { pass: info.ok && info.counts.cards === Object.keys(st.cards).length && info.counts.studies === 1 && info.counts.lessonTests === 1 && info.counts.mocks === 1 && info.counts.mindMaps === 1 && kept && bad.every(function (b) { return b === false; }),
        detail: 'cards ' + info.counts.cards + ' · reviews ' + info.counts.reviews + ' · records kept after import: ' + kept + ' · rejected: ' + bad.filter(function (b) { return !b; }).length + '/5' };
    }]
  );

  function runAll() {
    return tests.map(function (t) {
      try {
        var r = t[1]();
        return { name: t[0], pass: !!r.pass, detail: r.detail };
      } catch (e) {
        return { name: t[0], pass: false, detail: 'Error: ' + (e && e.message) };
      }
    });
  }

  global.KTests = { runAll: runAll };
})(window);
