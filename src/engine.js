/*
 * Kartotek DSR engine (dsr-v1)
 * ---------------------------------------------------------------
 * A pure (side-effect-free) implementation of the D-S-R (difficulty, stability,
 * retrievability) model from the PDF specification. It is independent of the UI
 * and storage; the same functions are used for live reviews, parameter fitting
 * (replay) and tests.
 *
 * Forgetting curve : R(t,S) = (1 + t / (9S))^-1        → R(S,S) = 0.90
 * Target interval  : I = 9S (1/R* − 1)
 * Difficulty       : D' = clip(1,10, D + a_r·1(y=0) + a_h·1(q=0.6) − a_e·1(q=1.3) + a_t·slow)
 *                    D' ← (1−μ)D' + μ·D_default
 * Success          : G = exp(w0 − w1·D − w2·ln(1+S) + w3(1−R) + w4(q−1))
 *                    S' = clip(S_min, S_max, S(1 + G·k)),  k = min(1, t/S)  (early-review damping)
 * Lapse            : S' = max(S_min, S [f0 − f1(1−R)])
 * Priority         : P = wr·max(0,R*−R) + wo·O + wm·M + we·E + wc·C
 */
(function (global) {
  'use strict';

  var DAY = 86400000;
  var MIN = 60000;
  var VERSION = 'dsr-v1';

  var DEFAULT_PARAMS = {
    // Initial memory state
    new_card_difficulty: 5.0,
    new_card_stability_days: 0.25,
    min_stability_days: 0.15,
    max_stability_days: 3650,
    min_difficulty: 1.0,
    max_difficulty: 10.0,
    easy_graduating_stability_days: 3.0,
    // Stability growth on successful recall
    w0: 1.4, w1: 0.08, w2: 0.25, w3: 1.0, w4: 0.35,
    early_review_damping: true,
    // Stability drop on failed recall
    f0: 0.55, f1: 0.15,
    // Difficulty update
    a_r: 0.7, a_h: 0.15, a_e: 0.1, a_t: 0.15, mu: 0.02,
    // "Easy" correction by response time (multiple of the personal median)
    easy_slow_ratio_good: 2.5,
    easy_slow_ratio_hard: 5.0,
    idle_response_ms: 120000,
    // Interval
    lambda: 0,
    max_fuzz_percent: 0.05,
    critical_target_retention: 0.93,
    // Priority weights
    wr: 100, wo: 10, wm: 5, we: 20, wc: 15,
    exam_horizon_days: 30,
    // Load balancing
    minimum_safety_retrievability: 0.72,
    max_load_shift_days: 3
  };

  var DEFAULT_SETTINGS = {
    target_retention_default: 0.9,
    daily_review_limit: 200,
    daily_new_card_limit: 20,
    max_session_minutes: 30,
    learning_steps_minutes: [10, 1440],
    relearning_steps_minutes: [10, 1440],
    max_interval_days: 3650,
    minimum_review_interval_minutes: 10,
    exam_date: null,
    exam_target_retention: 0.94,
    weekend_load_multiplier: 1.2,
    day_start_hour: 4,
    learn_ahead_minutes: 20,
    // Metacognitive prompt level for study sessions (Rule 24): auto | full | short | minimal
    prompt_level: 'auto'
  };

  var RATINGS = {
    again: { y: 0, q: 0.0 },
    hard: { y: 1, q: 0.6 },
    good: { y: 1, q: 1.0 },
    easy: { y: 1, q: 1.3 }
  };
  var RATING_ORDER = ['again', 'hard', 'good', 'easy'];

  // ---------------------------------------------------------------- helpers
  function clip(lo, hi, x) { return Math.min(hi, Math.max(lo, x)); }
  function near(a, b) { return Math.abs(a - b) < 1e-9; }
  // Fixed-decimal number for UI text (name kept for compatibility)
  function trNum(x, d) { return Number(x).toFixed(d == null ? 2 : d); }

  function median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function uid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // Local day: the calendar day starting at day_start_hour (default 04:00)
  function dayIndex(ts, startHour) {
    var d = new Date(ts - (startHour || 0) * 3600000);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  }
  function dayStart(idx, startHour) {
    var d = new Date(idx * DAY);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), startHour || 0).getTime();
  }
  function isWeekendDay(idx) {
    var wd = new Date(idx * DAY).getUTCDay();
    return wd === 0 || wd === 6;
  }
  function parseExamDate(d) {
    if (!d) return null;
    var p = String(d).split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return null;
    return new Date(p[0], p[1] - 1, p[2], 9, 0, 0).getTime(); // exam assumed at 09:00
  }
  // The exam a card is studied for: env.examDateOf(card) (one date per exam section) wins over the global settings.exam_date
  function examTimestamp(settings, card, env) {
    if (card && env && typeof env.examDateOf === 'function') {
      var own = env.examDateOf(card);
      if (own) return parseExamDate(own);
    }
    return parseExamDate(settings && settings.exam_date);
  }
  function dailyReviewLimit(settings, idx) {
    var base = settings.daily_review_limit;
    return Math.round(isWeekendDay(idx) ? base * settings.weekend_load_multiplier : base);
  }

  // ---------------------------------------------------------------- memory model
  function retrievability(t, S) {
    if (!(S > 0)) return 0;
    if (t <= 0) return 1;
    return 1 / (1 + t / (9 * S));
  }

  function intervalForRetention(S, R) {
    return 9 * S * (1 / R - 1);
  }

  function interpretRating(input, medianMs, P) {
    var base = RATINGS[input.rating];
    if (!base) throw new Error('Invalid rating: ' + input.rating);
    var y = base.y, q = base.q, slow = 0, notes = [];
    var rt = input.response_time_ms;
    if (rt != null && medianMs) {
      if (rt > P.idle_response_ms) {
        notes.push('Response time ' + Math.round(rt / 1000) + ' s: treated as distraction, no slowness penalty applied.');
      } else {
        slow = clip(0, 1, (rt - medianMs) / medianMs);
        if (input.rating === 'easy') {
          var ratio = rt / medianMs;
          if (ratio >= P.easy_slow_ratio_hard) {
            q = 0.6;
            notes.push('“Easy” was chosen but the time was ' + trNum(ratio, 1) + '× the personal median: quality counted as “Hard” (0.6).');
          } else if (ratio >= P.easy_slow_ratio_good) {
            q = 1.0;
            notes.push('“Easy” was chosen but the time was ' + trNum(ratio, 1) + '× the personal median: quality counted as “Good” (1.0).');
          }
        }
      }
    }
    if (y === 1 && input.hint_used && q > 0.6) {
      q = 0.6;
      notes.push('Hint used: quality capped at “Hard” (0.6).');
    }
    return { y: y, q: q, slow_score: slow, notes: notes };
  }

  function updateDifficulty(D, y, q, slow, P) {
    var d = D +
      P.a_r * (y === 0 ? 1 : 0) +
      P.a_h * (near(q, 0.6) ? 1 : 0) -
      P.a_e * (near(q, 1.3) ? 1 : 0) +
      P.a_t * slow;
    d = clip(P.min_difficulty, P.max_difficulty, d);
    return (1 - P.mu) * d + P.mu * P.new_card_difficulty;
  }

  function stabilityGrowth(S, D, R, q, P) {
    return Math.exp(P.w0 - P.w1 * D - P.w2 * Math.log(1 + S) + P.w3 * (1 - R) + P.w4 * (q - 1));
  }

  function stabilityAfterSuccess(S, D, R, q, t, P) {
    var G = stabilityGrowth(S, D, R, q, P);
    var k = P.early_review_damping ? Math.min(1, t / S) : 1;
    return { S: clip(P.min_stability_days, P.max_stability_days, S * (1 + G * k)), G: G, k: k };
  }

  function stabilityAfterLapse(S, R, P) {
    return Math.max(P.min_stability_days, S * (P.f0 - P.f1 * (1 - R)));
  }

  // Memory effect of a single review. Live reviews and parameter fitting use the same function.
  // mem: {S, D} or null (never-seen card). ev: {t, y, q, slow, from_state, to_state, rating}
  function memoryStep(mem, ev, P) {
    if (!mem) {
      var D0 = updateDifficulty(P.new_card_difficulty, ev.y, ev.q, ev.slow, P);
      var S0 = P.new_card_stability_days;
      if (ev.to_state === 'review') S0 = Math.max(S0, P.easy_graduating_stability_days);
      return { S: S0, D: D0, R: null, G: null, k: 0, kind: 'init' };
    }
    var R = retrievability(ev.t, mem.S);
    var D = updateDifficulty(mem.D, ev.y, ev.q, ev.slow, P);
    if (ev.y === 0) {
      return { S: stabilityAfterLapse(mem.S, R, P), D: D, R: R, G: null, k: null, kind: 'lapse' };
    }
    var r = stabilityAfterSuccess(mem.S, D, R, ev.q, ev.t, P);
    var S = r.S;
    if (ev.rating === 'easy' && ev.to_state === 'review' && (ev.from_state === 'learning' || ev.from_state === 'new')) {
      S = Math.max(S, P.easy_graduating_stability_days);
    }
    return { S: S, D: D, R: R, G: r.G, k: r.k, kind: 'success' };
  }

  function effectiveTargetRetention(settings, card, now, P, env) {
    var R = settings.target_retention_default, notes = [];
    var ex = examTimestamp(settings, card, env);
    if (ex && ex > now && (ex - now) / DAY <= 7) {
      R = Math.max(R, settings.exam_target_retention);
      notes.push('Exam in ≤ 7 days: R* = ' + trNum(R, 2));
    }
    if (card && card.importance >= 5 && R < P.critical_target_retention) {
      R = P.critical_target_retention;
      notes.push('Critical card (importance 5): R* = ' + trNum(R, 2));
    }
    return { R: R, notes: notes };
  }

  // ---------------------------------------------------------------- interval planning
  // ctx: {S, D, targetR, now, importance, fromRelearning, rng, loadByDay}
  function planReviewInterval(ctx, settings, P) {
    var steps = [];
    var h = settings.day_start_hour;
    var I = intervalForRetention(ctx.S, ctx.targetR);
    steps.push(['I_target = 9·S·(1/R* − 1)', I]);
    if (P.lambda > 0) {
      I = I / (1 + P.lambda * ctx.D);
      steps.push(['Difficulty adjustment ÷ (1 + λD)', I]);
    }
    var Imax = settings.max_interval_days;
    var clipped = clip(1, Imax, I);
    if (!near(clipped, I)) steps.push(['clip(I_min = 1 d, I_max = ' + Imax + ' d)', clipped]);
    I = clipped;

    if (ctx.rng && P.max_fuzz_percent > 0 && I >= 1) {
      var eps = (ctx.rng() * 2 - 1) * P.max_fuzz_percent;
      I = clip(1, Imax, I * (1 + eps));
      steps.push(['Random fuzz ε = ' + (eps < 0 ? '−' : '+') + trNum(Math.abs(eps * 100), 1) + '%', I]);
    }

    var ex = ctx.examTs !== undefined ? ctx.examTs : examTimestamp(settings);
    var daysToExam = ex && ex > ctx.now ? (ex - ctx.now) / DAY : null;
    if (daysToExam != null && daysToExam > 1 && I > daysToExam - 1) {
      I = daysToExam - 1;
      steps.push(['Exam horizon: last review 1 day before the exam', I]);
    }

    var due = ctx.now + I * DAY;
    var nearExam = daysToExam != null && daysToExam <= 7;
    var mayShift = ctx.loadByDay && I >= 3 && !ctx.fromRelearning &&
      !((ctx.importance || 3) >= 4 && nearExam) && (ctx.importance || 3) < 4;
    if (mayShift) {
      var d0 = dayIndex(due, h);
      var load = function (d) { return ctx.loadByDay[d] || 0; };
      if (load(d0) >= dailyReviewLimit(settings, d0)) {
        var maxShift = Math.min(P.max_load_shift_days, Math.floor(I * 0.15));
        var best = 0, bestLoad = load(d0);
        for (var s = 1; s <= maxShift; s++) {
          for (var sign = -1; sign <= 1; sign += 2) {
            var tDays = I + sign * s;
            if (tDays < 1) continue;
            if (retrievability(tDays, ctx.S) < P.minimum_safety_retrievability) continue;
            if (ex && ctx.now + tDays * DAY > ex - DAY && daysToExam != null) continue;
            var l = load(d0 + sign * s);
            if (l < bestLoad) { best = sign * s; bestLoad = l; }
          }
        }
        if (best !== 0) {
          I += best;
          due = ctx.now + I * DAY;
          steps.push(['Load balancing: ' + (best > 0 ? '+' : '') + best + ' d (target day full)', I]);
        }
      }
    }
    return { days: I, due_at: due, steps: steps };
  }

  function stepAt(steps, i, fallback) {
    if (!steps || !steps.length) return fallback;
    return steps[Math.min(i, steps.length - 1)];
  }

  // ---------------------------------------------------------------- review processing
  // env: {settings, params, now, rng, medianMs, loadByDay, cardEvents, sessionId}
  function processReview(card, mem, input, env) {
    var st = env.settings, P = env.params, now = env.now;
    var from = mem.state;
    var t = mem.last_reviewed_at ? Math.max(0, (now - mem.last_reviewed_at) / DAY) : 0;
    var rating = input.rating;
    var interp = interpretRating(input, env.medianMs, P);
    var y = interp.y, q = interp.q;
    var minStep = st.minimum_review_interval_minutes;

    // 1) State machine
    var to, stepIdx = mem.step_index || 0, delayMin = null;
    var lsteps = from === 'relearning' ? st.relearning_steps_minutes : st.learning_steps_minutes;
    if (from === 'new' || from === 'learning' || from === 'relearning') {
      if (from === 'new') stepIdx = 0;
      var stepState = from === 'relearning' ? 'relearning' : 'learning';
      if (rating === 'again') { to = stepState; stepIdx = 0; delayMin = stepAt(lsteps, 0, minStep); }
      else if (rating === 'hard') { to = stepState; delayMin = stepAt(lsteps, stepIdx, minStep); }
      else if (rating === 'good' && stepIdx + 1 < lsteps.length) { to = stepState; stepIdx += 1; delayMin = lsteps[stepIdx]; }
      else { to = 'review'; stepIdx = 0; }
    } else if (from === 'review') {
      if (y === 0) { to = 'relearning'; stepIdx = 0; delayMin = stepAt(st.relearning_steps_minutes, 0, minStep); }
      else to = 'review';
    } else {
      throw new Error('Unhandled state: ' + from);
    }

    // 2) Memory update
    var prev = from === 'new' ? null : { S: mem.stability_days, D: mem.difficulty };
    var upd = memoryStep(prev, { t: t, y: y, q: q, slow: interp.slow_score, from_state: from, to_state: to, rating: rating }, P);

    var m = Object.assign({}, mem);
    m.difficulty = upd.D;
    m.stability_days = upd.S;
    m.total_reviews = (mem.total_reviews || 0) + 1;
    m.successful_reviews = (mem.successful_reviews || 0) + y;
    if (from === 'review' && y === 0) m.lapse_count = (mem.lapse_count || 0) + 1;
    if ((from === 'review' || from === 'relearning') && y === 0) m.consecutive_lapses = (mem.consecutive_lapses || 0) + 1;
    if (from === 'review' && y === 1) m.consecutive_lapses = 0;
    var rt = input.response_time_ms;
    if (rt != null && rt <= P.idle_response_ms) {
      var n = m.total_reviews;
      m.mean_response_time_ms = Math.round(((mem.mean_response_time_ms || rt) * (n - 1) + rt) / n);
    }

    // 3) Scheduling
    var target = effectiveTargetRetention(st, card, now, P, env);
    var plan = null, due, intervalDays;
    if (to === 'review') {
      plan = planReviewInterval({
        S: m.stability_days, D: m.difficulty, targetR: target.R, now: now,
        importance: card.importance, fromRelearning: from === 'relearning',
        rng: env.rng, loadByDay: env.loadByDay, examTs: examTimestamp(st, card, env)
      }, st, P);
      due = plan.due_at;
      intervalDays = plan.days;
    } else {
      var mins = Math.max(1, delayMin);
      due = now + mins * MIN;
      intervalDays = mins / 1440;
    }

    m.state = to;
    m.step_index = stepIdx;
    m.last_reviewed_at = now;
    m.due_at = due;
    m.last_interval_days = intervalDays;
    m.retrievability = upd.R == null ? 1 : upd.R;
    m.target_retention = target.R;
    if (from === 'new') m.introduced_at = now;
    m.model_version = VERSION;

    var event = {
      review_id: uid(),
      card_id: card.card_id,
      deck_id: card.deck_id,
      reviewed_at: now,
      elapsed_days: t,
      predicted_retrievability: upd.R,
      rating: rating,
      effective_quality: q,
      recall_result: y,
      response_time_ms: rt == null ? null : Math.round(rt),
      slow_score: interp.slow_score,
      hint_used: !!input.hint_used,
      answer_revealed_before_attempt: false,
      from_state: from,
      to_state: to,
      old_difficulty: prev ? prev.D : null,
      new_difficulty: m.difficulty,
      old_stability_days: prev ? prev.S : null,
      new_stability_days: m.stability_days,
      scheduled_interval_days: intervalDays,
      scheduled_due_at: due,
      target_retention: target.R,
      session_id: env.sessionId || null,
      scheduler_version: VERSION
    };
    // Study-session events: source, signal type and question id (source, signal, question_id, etut_id)
    if (input.meta) Object.keys(input.meta).forEach(function (k) { event[k] = input.meta[k]; });

    var events = (env.cardEvents || []).concat([event]);
    var flags = contentFlags(card, m, events, env.medianMs, now);
    m.content_flags = flags;
    m.needs_content_review = flags.length > 0;

    return {
      mem: m,
      event: event,
      trace: {
        from: from, to: to, t: t, y: y, q: q, rating: rating,
        slow: interp.slow_score, notes: interp.notes.concat(target.notes),
        R: upd.R, G: upd.G, k: upd.k, kind: upd.kind,
        D_old: prev ? prev.D : null, D_new: m.difficulty,
        S_old: prev ? prev.S : null, S_new: m.stability_days,
        targetR: target.R, plan: plan, delayMin: delayMin,
        due_at: due, interval_days: intervalDays,
        consecutive_lapses: m.consecutive_lapses || 0
      }
    };
  }

  // "Next interval" preview under the buttons (without fuzz or load balancing)
  function previewIntervals(card, mem, env) {
    var out = {};
    var quiet = Object.assign({}, env, { rng: null, loadByDay: null, cardEvents: [] });
    RATING_ORDER.forEach(function (r) {
      var res = processReview(card, mem, { rating: r, response_time_ms: null, hint_used: env.hintUsed }, quiet);
      out[r] = res.mem.due_at - env.now;
    });
    return out;
  }

  // ---------------------------------------------------------------- content problem detection
  function contentFlags(card, mem, events, medianMs, now) {
    var reasons = [];
    var fails14 = events.filter(function (e) { return e.recall_result === 0 && now - e.reviewed_at <= 14 * DAY; }).length;
    if (fails14 >= 3) reasons.push(fails14 + ' failures in the last 14 days');
    var last5 = events.slice(-5);
    var hard = last5.filter(function (e) { return e.rating === 'hard'; }).length;
    if (last5.length >= 5 && hard >= 3) reasons.push(hard + ' of the last 5 reviews were “Hard”');
    var times = events.map(function (e) { return e.response_time_ms; }).filter(function (x) { return x != null; });
    if (medianMs && times.length >= 3 && median(times) > 3 * medianMs) reasons.push('Response time over 3× the personal median');
    var total = mem.total_reviews || 0;
    if (total >= 5 && (mem.successful_reviews || 0) / total < 0.5) reasons.push('Success rate below 50%');
    // Model answers of study objective cards are deliberately 1–3 sentences: format warnings do not apply
    if (card.card_type !== 'kazanim') {
      if ((card.front || '').length > 200 || (card.back || '').length > 300) reasons.push('Front/back side too long');
      if (looksMultiFact(card.back || '')) reasons.push('May be asking for more than one independent fact');
    }
    if ((mem.consecutive_lapses || 0) >= 3) reasons.push(mem.consecutive_lapses + ' consecutive failures');
    return reasons;
  }

  function looksMultiFact(text) {
    var lines = text.split(/\n/).filter(function (l) { return l.trim(); }).length;
    var seps = (text.match(/[;,•]/g) || []).length;
    return lines >= 3 || seps >= 3;
  }

  // Consecutive lapse policy (PDF table)
  function lapsePolicy(consecutive) {
    if (consecutive >= 4) return { level: 4, text: 'Intervention recommended instead of automatic review: suspend the card or rewrite its content.' };
    if (consecutive === 3) return { level: 3, text: 'Card sent to quality review. Try splitting the card or studying the underlying concept first.' };
    if (consecutive === 2) return { level: 2, text: 'This card looks hard; would you like to add a hint?' };
    if (consecutive === 1) return { level: 1, text: 'Study the correct answer; the card will be asked again shortly.' };
    return null;
  }

  // ---------------------------------------------------------------- priority and queue
  function priority(card, mem, env, targetR) {
    var P = env.params, now = env.now;
    var t = mem.last_reviewed_at ? Math.max(0, (now - mem.last_reviewed_at) / DAY) : 0;
    var R = retrievability(t, mem.stability_days);
    var risk = Math.max(0, targetR - R);
    var overdueDays = Math.max(0, (now - mem.due_at) / DAY);
    var O = Math.log(1 + overdueDays);
    var M = (card.importance || 3) / 5;
    var E = 0;
    var ex = examTimestamp(env.settings, card, env);
    if (ex && ex > now) {
      var T = (ex - now) / DAY;
      var prox = clip(0, 1, 1 - T / P.exam_horizon_days);
      E = prox * (1 - retrievability(t + T, mem.stability_days));
    }
    var C = (mem.state === 'relearning' ? 1 : 0) + Math.min(1, (mem.consecutive_lapses || 0) / 2);
    var parts = { risk: P.wr * risk, overdue: P.wo * O, importance: P.wm * M, exam: P.we * E, lapse: P.wc * C };
    var total = parts.risk + parts.overdue + parts.importance + parts.exam + parts.lapse;
    return { total: total, parts: parts, R: R, overdueDays: overdueDays };
  }

  function interleave(list, cardsById) {
    var tagCount = {};
    list.forEach(function (it) {
      (cardsById[it.card_id].tags || []).forEach(function (tg) { tagCount[tg] = (tagCount[tg] || 0) + 1; });
    });
    var specific = function (tg) { return tagCount[tg] <= Math.max(2, list.length * 0.3); };
    function similar(a, b) {
      var ca = cardsById[a.card_id], cb = cardsById[b.card_id];
      if (ca.note_id && ca.note_id === cb.note_id) return true;
      return (ca.tags || []).some(function (tg) { return specific(tg) && (cb.tags || []).indexOf(tg) >= 0; });
    }
    var pool = list.slice(), out = [];
    while (pool.length) {
      var idx = 0;
      if (out.length) {
        var prev = out[out.length - 1];
        for (var i = 0; i < Math.min(pool.length, 6); i++) {
          if (!similar(prev, pool[i])) { idx = i; break; }
        }
      }
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  // state: {cards, mem, reviews}; opts: {deckId} or {deckIds: [...]} (an exam section: its decks share the global daily limits)
  function buildQueue(state, env, opts) {
    var st = env.settings, now = env.now, h = st.day_start_hour;
    var today = dayIndex(now, h);
    var tomorrow = dayStart(today + 1, h);
    var reviewDone = 0, newDone = 0, newDoneBy = {};
    // Per-exam new-card budgets: opts.newGroupOf(deck_id) -> exam key, opts.newLimits {key: n} (null = no own budget)
    var groupOf = function (deckId) { return opts && typeof opts.newGroupOf === 'function' ? opts.newGroupOf(deckId) : null; };
    var newLimits = (opts && opts.newLimits) || {};
    for (var i = state.reviews.length - 1; i >= 0; i--) {
      var e = state.reviews[i];
      if (dayIndex(e.reviewed_at, h) !== today) { if (e.reviewed_at < now - 2 * DAY) break; continue; }
      if (opts && opts.deckId && e.deck_id !== opts.deckId) continue;
      if (e.source === 'etut' || e.source === 'lesson' || e.source === 'mindmap') continue; // study sessions and lesson tests are separate activities: they do not use up the daily review/new-card limits
      if (e.from_state === 'review') reviewDone++;
      if (e.from_state === 'new') {
        newDone++;
        var gk = groupOf(e.deck_id);
        if (gk) newDoneBy[gk] = (newDoneBy[gk] || 0) + 1;
      }
    }
    var learnDue = [], learnAhead = [], dueReview = [], fresh = [];
    Object.keys(state.cards).forEach(function (id) {
      var card = state.cards[id], mem = state.mem[id];
      if (!mem || mem.suspended) return;
      if (opts && opts.deckId && card.deck_id !== opts.deckId) return;
      if (opts && opts.deckIds && opts.deckIds.indexOf(card.deck_id) < 0) return;
      if (mem.state === 'new') { fresh.push({ card_id: id, kind: 'new', order: card.created_at }); return; }
      if (mem.state === 'learning' || mem.state === 'relearning') {
        var item = { card_id: id, kind: mem.state, due_at: mem.due_at };
        if (mem.due_at <= now) learnDue.push(item);
        // Learning ahead never shows a card twice in a row: at least the minimum interval must have passed since it was last seen
        else if (mem.due_at <= now + st.learn_ahead_minutes * MIN &&
          now - (mem.last_reviewed_at || 0) >= st.minimum_review_interval_minutes * MIN) learnAhead.push(item);
        return;
      }
      if (mem.due_at < tomorrow) {
        var tr = effectiveTargetRetention(st, card, now, env.params, env);
        var pr = priority(card, mem, env, tr.R);
        dueReview.push({ card_id: id, kind: 'review', due_at: mem.due_at, priority: pr.total, parts: pr.parts, R: pr.R, overdueDays: pr.overdueDays });
      }
    });
    learnDue.sort(function (a, b) {
      var ra = a.kind === 'relearning' ? 0 : 1, rb = b.kind === 'relearning' ? 0 : 1;
      return ra - rb || a.due_at - b.due_at;
    });
    learnAhead.sort(function (a, b) { return a.due_at - b.due_at; });
    dueReview.sort(function (a, b) { return b.priority - a.priority; });

    var reviewLimit = dailyReviewLimit(st, today);
    var reviewRemaining = Math.max(0, reviewLimit - reviewDone);
    var reviews = dueReview.slice(0, reviewRemaining);

    var newLimit = st.daily_new_card_limit, newNotes = [];
    var ex = opts && opts.examTs !== undefined ? opts.examTs : examTimestamp(st);
    if (ex && ex > now) {
      var dx = (ex - now) / DAY;
      if (dx <= 2) { newLimit = 0; newNotes.push('Exam in ≤ 2 days: new cards paused'); }
      else if (dx <= 7) { newLimit = Math.floor(newLimit / 2); newNotes.push('Exam in ≤ 7 days: new-card limit halved'); }
    }
    if (dueReview.length >= reviewLimit) { newLimit = 0; newNotes.push('Pending review load exceeds the limit: clearing the backlog first'); }
    else if (dueReview.length >= 0.8 * reviewLimit) { newLimit = Math.floor(newLimit / 2); newNotes.push('High review load: new-card limit halved'); }
    // A scoped queue (one exam section) uses that exam's own budget when it has one
    var scopeKey = opts && opts.scopeKey;
    if (scopeKey && newLimits[scopeKey] != null) {
      newLimit = Math.min(newLimit, newLimits[scopeKey]);
      newDone = newDoneBy[scopeKey] || 0;
    }
    var newRemaining = Math.max(0, newLimit - newDone);
    fresh.sort(function (a, b) { return a.order - b.order; });
    var news = [], takenBy = {};
    for (var fi = 0; fi < fresh.length && news.length < newRemaining; fi++) {
      var gk2 = groupOf(state.cards[fresh[fi].card_id].deck_id);
      if (gk2 && newLimits[gk2] != null) {
        var used = (newDoneBy[gk2] || 0) + (takenBy[gk2] || 0);
        if (used >= newLimits[gk2]) continue;
        takenBy[gk2] = (takenBy[gk2] || 0) + 1;
      }
      news.push(fresh[fi]);
    }

    var order = learnDue.concat(interleave(reviews.concat(news), state.cards));
    var usingAhead = false;
    if (!order.length && learnAhead.length) { order = learnAhead.slice(); usingAhead = true; }

    var nextLearn = null;
    Object.keys(state.mem).forEach(function (id) {
      var m = state.mem[id];
      if (!m || m.suspended || (m.state !== 'learning' && m.state !== 'relearning')) return;
      if (opts && opts.deckId && state.cards[id].deck_id !== opts.deckId) return;
      if (m.due_at > now && (nextLearn == null || m.due_at < nextLearn)) nextLearn = m.due_at;
    });

    return {
      order: order,
      counts: { learning: learnDue.length, review: reviews.length, fresh: news.length },
      totals: { dueReview: dueReview.length, freshAvailable: fresh.length, reviewDone: reviewDone, newDone: newDone, reviewLimit: reviewLimit, newLimit: newLimit },
      dueReview: dueReview,
      newNotes: newNotes,
      usingAhead: usingAhead,
      nextLearnAt: nextLearn
    };
  }

  // ---------------------------------------------------------------- study-session signals
  // Recall: the user's own rating. Quiz / final test: correctness + confidence.
  // confidence: 'guess' | 'unsure' | 'sure'
  function mapEtutSignal(sig) {
    if (sig.signal === 'recall') return { rating: sig.rating, misconception: false };
    if (!sig.correct) return { rating: 'again', misconception: sig.confidence === 'sure' };
    return { rating: sig.confidence === 'sure' ? 'good' : 'hard', misconception: false };
  }
  // Calibration and fitting score only recall predictions; recognising an option is easier
  function isRecallSignal(e) { return !e.signal || e.signal === 'recall'; }

  // ---------------------------------------------------------------- measurement and calibration
  function calibration(events, sinceTs) {
    var ev = events.filter(function (e) {
      return e.from_state === 'review' && e.predicted_retrievability != null && e.reviewed_at >= (sinceTs || 0) && isRecallSignal(e);
    });
    var n = ev.length;
    if (!n) return { review_count: 0 };
    var edges = [0, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0001];
    var bins = edges.slice(0, -1).map(function (lo, i) { return { lo: lo, hi: Math.min(1, edges[i + 1]), n: 0, pred: 0, obs: 0 }; });
    var sp = 0, sy = 0, brier = 0, ll = 0;
    ev.forEach(function (e) {
      var p = clip(1e-4, 1 - 1e-4, e.predicted_retrievability), y = e.recall_result;
      sp += p; sy += y;
      brier += (p - y) * (p - y);
      ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      for (var i = 0; i < bins.length; i++) {
        if (p >= bins[i].lo && p < edges[i + 1]) { bins[i].n++; bins[i].pred += p; bins[i].obs += y; break; }
      }
    });
    bins.forEach(function (b) { if (b.n) { b.pred /= b.n; b.obs /= b.n; } });
    var ece = bins.reduce(function (a, b) { return a + (b.n ? b.n * Math.abs(b.pred - b.obs) : 0); }, 0) / n;
    var mp = sp / n, mo = sy / n, status;
    if (n < 30) status = 'insufficient';
    else if (Math.abs(mp - mo) <= 0.03 && ece <= 0.06) status = 'well_calibrated';
    else status = mp > mo ? 'overconfident' : 'underconfident';
    return {
      review_count: n, predicted_retention: mp, observed_retention: mo,
      brier_score: brier / n, log_loss: ll / n, ece: ece, bins: bins, model_status: status
    };
  }

  // ---------------------------------------------------------------- parameter fitting
  var FIT_KEYS = ['w0', 'w1', 'w2', 'w3', 'w4', 'a_r', 'a_h', 'a_e', 'a_t', 'f0', 'f1'];
  var FIT_BOUNDS = {
    w0: [0, 3], w1: [0, 0.5], w2: [0, 1], w3: [0, 3], w4: [0, 1.5],
    a_r: [0, 2], a_h: [0, 1], a_e: [0, 1], a_t: [0, 1], f0: [0.1, 0.95], f1: [0, 0.5]
  };

  function groupByCard(events) {
    var by = {};
    events.forEach(function (e) { (by[e.card_id] = by[e.card_id] || []).push(e); });
    Object.keys(by).forEach(function (k) { by[k].sort(function (a, b) { return a.reviewed_at - b.reviewed_at; }); });
    return by;
  }

  // Replays history with the given parameters; produces a predicted R for each "review" repetition.
  function replayPredictions(byCard, P) {
    var out = [];
    Object.keys(byCard).forEach(function (id) {
      var mem = null, prevTs = null;
      byCard[id].forEach(function (e) {
        var t = prevTs == null ? 0 : Math.max(0, (e.reviewed_at - prevTs) / DAY);
        if (mem && e.from_state === 'review' && isRecallSignal(e)) out.push({ p: retrievability(t, mem.S), y: e.recall_result, ts: e.reviewed_at });
        mem = memoryStep(mem, {
          t: t, y: e.recall_result, q: e.effective_quality, slow: e.slow_score || 0,
          from_state: e.from_state, to_state: e.to_state, rating: e.rating
        }, P);
        prevTs = e.reviewed_at;
      });
    });
    return out;
  }

  function lossOf(preds) {
    if (!preds.length) return { ll: NaN, brier: NaN, n: 0 };
    var ll = 0, br = 0;
    preds.forEach(function (x) {
      var p = clip(1e-4, 1 - 1e-4, x.p);
      ll += -(x.y * Math.log(p) + (1 - x.y) * Math.log(1 - p));
      br += (p - x.y) * (p - x.y);
    });
    return { ll: ll / preds.length, brier: br / preds.length, n: preds.length };
  }

  function fitParams(events, baseParams, defaults) {
    var byCard = groupByCard(events);
    var all = replayPredictions(byCard, baseParams);
    var n = all.length;
    if (n < 100) return { status: 'insufficient', n: n };
    var times = all.map(function (x) { return x.ts; }).sort(function (a, b) { return a - b; });
    var split = times[Math.floor(n * 0.8)];
    var reg = 0.05;
    var prior = defaults || DEFAULT_PARAMS;

    function evaluate(P) {
      var preds = replayPredictions(byCard, P);
      var tr = [], te = [];
      preds.forEach(function (x) { (x.ts < split ? tr : te).push(x); });
      return { train: lossOf(tr), test: lossOf(te) };
    }
    function objective(P) {
      var l = evaluate(P).train.ll, pen = 0;
      FIT_KEYS.forEach(function (k) {
        var r = FIT_BOUNDS[k][1] - FIT_BOUNDS[k][0];
        pen += Math.pow((P[k] - prior[k]) / r, 2);
      });
      return l + reg * pen;
    }

    var cur = Object.assign({}, baseParams);
    var best = objective(cur);
    var step = {};
    FIT_KEYS.forEach(function (k) { step[k] = (FIT_BOUNDS[k][1] - FIT_BOUNDS[k][0]) * 0.1; });
    for (var sweep = 0; sweep < 30; sweep++) {
      var improved = false;
      FIT_KEYS.forEach(function (k) {
        [1, -1].forEach(function (dir) {
          var cand = Object.assign({}, cur);
          cand[k] = clip(FIT_BOUNDS[k][0], FIT_BOUNDS[k][1], cur[k] + dir * step[k]);
          if (near(cand[k], cur[k])) return;
          var v = objective(cand);
          if (v < best - 1e-7) { best = v; cur = cand; improved = true; }
        });
      });
      if (!improved) {
        var tiny = true;
        FIT_KEYS.forEach(function (k) { step[k] *= 0.5; if (step[k] > (FIT_BOUNDS[k][1] - FIT_BOUNDS[k][0]) * 0.002) tiny = false; });
        if (tiny) break;
      }
    }

    // Fitting policy: 100–500 reviews → low weight on personal parameters
    var weight = n > 500 ? 1 : 0.3;
    var blended = Object.assign({}, baseParams);
    FIT_KEYS.forEach(function (k) { blended[k] = baseParams[k] + weight * (cur[k] - baseParams[k]); });

    var before = evaluate(baseParams), after = evaluate(blended);
    return {
      status: 'ok', n: n, weight: weight, split: split,
      params: blended, before: before, after: after,
      improved: after.test.n > 0 && after.test.ll < before.test.ll
    };
  }

  global.DSR = {
    VERSION: VERSION, DAY: DAY, MIN: MIN,
    DEFAULT_PARAMS: DEFAULT_PARAMS, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    RATINGS: RATINGS, RATING_ORDER: RATING_ORDER, FIT_KEYS: FIT_KEYS, FIT_BOUNDS: FIT_BOUNDS,
    clip: clip, trNum: trNum, median: median, mulberry32: mulberry32, uid: uid,
    dayIndex: dayIndex, dayStart: dayStart, examTimestamp: examTimestamp, parseExamDate: parseExamDate, dailyReviewLimit: dailyReviewLimit,
    retrievability: retrievability, intervalForRetention: intervalForRetention,
    interpretRating: interpretRating, updateDifficulty: updateDifficulty,
    stabilityGrowth: stabilityGrowth, stabilityAfterSuccess: stabilityAfterSuccess, stabilityAfterLapse: stabilityAfterLapse,
    memoryStep: memoryStep, effectiveTargetRetention: effectiveTargetRetention,
    planReviewInterval: planReviewInterval, processReview: processReview, previewIntervals: previewIntervals,
    contentFlags: contentFlags, lapsePolicy: lapsePolicy,
    priority: priority, buildQueue: buildQueue, interleave: interleave,
    mapEtutSignal: mapEtutSignal, isRecallSignal: isRecallSignal,
    calibration: calibration, groupByCard: groupByCard, replayPredictions: replayPredictions, lossOf: lossOf, fitParams: fitParams
  };
})(typeof window !== 'undefined' ? window : this);
