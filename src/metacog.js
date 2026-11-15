/*
 * Kartotek metacognition calculations (pure, UI-independent)
 * Rule 10: calibration gap · Rule 11: error types · Rule 13: adaptation order
 * Rule 24: fading prompts · Rule 25: judging a strategy by its outcome
 */
(function (global) {
  'use strict';
  var KEtut = global.KEtut;

  // Rule 11 error types, each with a concrete control step based on Rule 13
  var ERROR_TYPES = [
    { id: 'bilgi_eksikligi', label: 'Missing knowledge', action: 'Go back to the basic concept: reread the objective, then close the notes and explain it in your own words (Rule 13 · 2).', reread: true },
    { id: 'kavram_yanilgisi', label: 'Misconception', action: 'Write the correct and the wrong idea side by side; compare the solution with the distractor note and think of a counterexample (Rules 11, 17).', reread: true },
    { id: 'soruyu_yanlis_anlama', label: 'Misread the question', action: 'Before looking at the options, write in one sentence what the question asks; mark key words such as “not” or “false”.' },
    { id: 'dikkatsizlik', label: 'Carelessness', action: 'Do a 5-second check before answering: match your chosen option back to the question stem. Remove distractions and shorten the session.' },
    { id: 'islem_hatasi', label: 'Calculation error', action: 'Solve by writing out each step; run a sanity check on the result (magnitude, unit, sign).' },
    { id: 'zaman', label: 'Time management problem', action: 'Split the work into shorter, spaced sessions; shrink the duration or scope in the next plan (Rule 13 · 5).' },
    { id: 'strateji', label: 'Wrong strategy choice', action: 'Pick the strategy that fits the task type (Rule 12): fact → retrieval; concept → self-explanation + example; problem → worked example + mixed questions.' },
    { id: 'geri_getirememe', label: 'Could not retrieve it', action: 'Do more retrieval practice: this objective will be asked again in the second round and its review interval will shorten (Rules 9, 14).' }
  ];
  var ERROR_BY_ID = {};
  ERROR_TYPES.forEach(function (t) { ERROR_BY_ID[t.id] = t; });

  var STRATEGY_TR = { explain: 'Self-explanation', teach: 'Explaining as if teaching', retry: 'Second-round retrieval' };

  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }

  // Rule 10: calibration gap = predicted success − actual success
  function interpretGap(gap) {
    if (gap == null || isNaN(gap)) return null;
    if (Math.abs(gap) <= 0.10) return { id: 'isabetli', label: 'Accurate', level: 'ok', text: 'Your prediction is close to reality; your monitoring is accurate.' };
    if (gap > 0) return { id: 'asiri_guven', label: 'Overconfident', level: 'warn', text: 'Your prediction is above reality. Test yourself more and analyse your errors.' };
    return { id: 'dusuk_guven', label: 'Underconfident', level: 'warn', text: 'Your prediction is below reality. Look at the evidence of success and the strategy that worked; you know more than you think.' };
  }
  function predictionGap(predictedRatio, actualRatio) {
    var gap = predictedRatio - actualRatio;
    return Object.assign({ gap: gap, predicted_ratio: predictedRatio, actual_ratio: actualRatio }, interpretGap(gap));
  }

  function activeEtuts(state) {
    return Object.keys(state.etuts || {}).map(function (id) { return state.etuts[id]; })
      .filter(function (e) { return e && !e.removed && e.package && e.progress; });
  }
  // The metacognition views read legacy (v1) study data only; Study v2 keeps its own evidence (src/study-v2.js)
  function legacyEtuts(state) {
    return activeEtuts(state).filter(function (e) { return !(global.KCycle && global.KCycle.isV2(e.package)); });
  }

  function questionsFor(et, key) {
    if (key === 'final') return et.package.final_test;
    var p = et.package.parts[Number(String(key).split(':')[1])];
    return p ? p.quiz : null;
  }

  // Outcome of a prediction (once all questions are answered)
  function predictionOutcome(et, key) {
    var pr = et.progress, p = pr.predictions && pr.predictions[key];
    var qs = questionsFor(et, key);
    if (!p || !qs) return null;
    var ans = qs.map(function (q) { return pr.answers[q.q_id]; }).filter(Boolean);
    var correct = ans.filter(function (a) { return a.correct; }).length;
    var out = { key: key, predicted: p.predicted, n: qs.length, correct: correct, answered: ans.length, at: p.at, complete: ans.length === qs.length };
    if (out.complete) Object.assign(out, predictionGap(p.predicted / qs.length, correct / qs.length));
    return out;
  }

  function predictionsList(state) {
    var out = [];
    legacyEtuts(state).forEach(function (et) {
      Object.keys(et.progress.predictions || {}).forEach(function (key) {
        var o = predictionOutcome(et, key);
        if (!o || !o.complete) return;
        o.etut = et.package.title;
        o.label = key === 'final' ? 'Final test' : 'Part ' + (Number(key.split(':')[1]) + 1) + ' quiz';
        out.push(o);
      });
    });
    return out.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
  }

  // JOL (judgment of learning) compared with the actual key-point coverage
  function jolEntries(state) {
    var out = [];
    legacyEtuts(state).forEach(function (et) {
      Object.keys(et.progress.jol || {}).forEach(function (kid) {
        var j = et.progress.jol[kid];
        if (j && j.jol != null && j.actual != null) out.push({ etut: et.package.title, kazanim_id: kid, jol: j.jol, actual: j.actual });
      });
    });
    return out;
  }
  function jolBins(entries) {
    var edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
    var bins = edges.slice(0, -1).map(function (lo, i) { return { lo: lo, hi: Math.min(1, edges[i + 1]), n: 0, pred: 0, obs: 0 }; });
    entries.forEach(function (e) {
      for (var i = 0; i < bins.length; i++) {
        if (e.jol >= bins[i].lo && e.jol < edges[i + 1]) { bins[i].n++; bins[i].pred += e.jol; bins[i].obs += e.actual; break; }
      }
    });
    bins.forEach(function (b) { if (b.n) { b.pred /= b.n; b.obs /= b.n; } });
    var gap = entries.length ? mean(entries.map(function (e) { return e.jol - e.actual; })) : null;
    return { bins: bins, n: entries.length, mean_gap: gap };
  }

  function allAnswers(state) {
    var out = [];
    legacyEtuts(state).forEach(function (et) {
      var byId = {};
      et.package.parts.forEach(function (p, pi) { p.quiz.forEach(function (q) { byId[q.q_id] = { q: q, where: 'Part ' + (pi + 1) }; }); });
      et.package.final_test.forEach(function (q) { byId[q.q_id] = { q: q, where: 'Final test' }; });
      Object.keys(et.progress.answers || {}).forEach(function (qid) {
        var a = et.progress.answers[qid], info = byId[qid];
        if (!a || !info) return;
        var k = KEtut.findKazanim(et.package, info.q.kazanim_id);
        out.push({ etut: et.package.title, etut_id: et.etut_id, q_id: qid, where: info.where, stem: info.q.stem, kazanim: k ? k.title : '', answer: a });
      });
    });
    return out;
  }

  function confidenceAccuracy(state) {
    var res = { guess: { n: 0, correct: 0 }, unsure: { n: 0, correct: 0 }, sure: { n: 0, correct: 0 } };
    allAnswers(state).forEach(function (x) {
      var c = res[x.answer.confidence];
      if (c) { c.n++; if (x.answer.correct) c.correct++; }
    });
    return res;
  }

  function errorLog(state) {
    return allAnswers(state).filter(function (x) { return !x.answer.correct && x.answer.error; })
      .sort(function (a, b) { return (b.answer.at || 0) - (a.answer.at || 0); });
  }

  function errorDistribution(state) {
    var counts = {};
    errorLog(state).forEach(function (x) { counts[x.answer.error.type] = (counts[x.answer.error.type] || 0) + 1; });
    return ERROR_TYPES.map(function (t) { return { id: t.id, label: t.label, count: counts[t.id] || 0, action: t.action }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  // Rule 25: judge a strategy by retention in the later real reviews
  function strategyEffect(state) {
    var rows = { explain: { w: [0, 0], wo: [0, 0] }, teach: { w: [0, 0], wo: [0, 0] }, retry: { w: [0, 0], wo: [0, 0] } };
    legacyEtuts(state).forEach(function (et) {
      var pr = et.progress;
      et.package.parts.forEach(function (p, pi) {
        p.kazanimlar.forEach(function (k) {
          var cid = et.card_map[k.kazanim_id];
          if (!cid) return;
          var later = state.reviews.filter(function (e) { return e.card_id === cid && e.source !== 'etut' && e.from_state === 'review'; });
          if (!later.length) return;
          var ok = later.filter(function (e) { return e.recall_result === 1; }).length;
          var flags = {
            explain: !!(pr.explains[k.kazanim_id] && pr.explains[k.kazanim_id].length),
            teach: !!(pr.teach[pi] && pr.teach[pi].coverage != null),
            retry: !!(pr.retry[pi] && pr.retry[pi].kids.indexOf(k.kazanim_id) >= 0)
          };
          Object.keys(flags).forEach(function (s) { var b = rows[s][flags[s] ? 'w' : 'wo']; b[0] += ok; b[1] += later.length; });
        });
      });
    });
    return Object.keys(rows).map(function (s) {
      var r = rows[s];
      return {
        strategy: s, label: STRATEGY_TR[s],
        with: { n: r.w[1], rate: r.w[1] ? r.w[0] / r.w[1] : null },
        without: { n: r.wo[1], rate: r.wo[1] ? r.wo[0] / r.wo[1] : null },
        early: r.w[1] < 10 || r.wo[1] < 10
      };
    });
  }

  // Rule 24: fade prompts gradually; return to full detail if calibration worsens
  var LEVEL_TR = { full: 'full', short: 'short', minimal: 'minimal' };
  function promptLevel(state) {
    var setting = (state.settings && state.settings.prompt_level) || 'auto';
    var experience = 0;
    legacyEtuts(state).forEach(function (et) { experience += Object.keys(et.progress.journal || {}).length; });
    var gaps = predictionsList(state).slice(-5).map(function (o) { return Math.abs(o.gap); });
    var meanGap = mean(gaps);
    var out = { experience: experience, mean_gap: meanGap, auto: setting === 'auto' };
    if (setting !== 'auto' && LEVEL_TR[setting]) return Object.assign(out, { level: setting, reason: 'Chosen manually in Settings.' });
    if (experience < 3) return Object.assign(out, { level: 'full', reason: 'Prompts are full for the first 3 parts (' + experience + '/3 completed).' });
    if (meanGap != null && meanGap > 0.20) return Object.assign(out, { level: 'full', reason: 'Mean gap in recent predictions is ' + Math.round(meanGap * 100) + '%: back to full prompts.' });
    if (experience >= 8 && meanGap != null && meanGap <= 0.10) return Object.assign(out, { level: 'minimal', reason: experience + ' parts completed and your predictions are accurate (mean gap ' + Math.round(meanGap * 100) + '%).' });
    if (meanGap == null || meanGap <= 0.15) return Object.assign(out, { level: 'short', reason: experience + ' parts completed' + (meanGap == null ? '.' : '; mean prediction gap ' + Math.round(meanGap * 100) + '%.') });
    return Object.assign(out, { level: 'full', reason: 'Prediction gap ' + Math.round(meanGap * 100) + '%: prompts stay full.' });
  }

  // Rule 13: order for changing the method when a strategy is not working, filled in from the data
  function diagnose13(state, et, partIdx) {
    var pr = et.progress, part = et.package.parts[partIdx], plan = pr.plans[partIdx];
    var errs = part.quiz.map(function (q) { return pr.answers[q.q_id]; }).filter(function (a) { return a && !a.correct && a.error; });
    var counts = {};
    errs.forEach(function (a) { counts[a.error.type] = (counts[a.error.type] || 0) + 1; });
    var repeated = Object.keys(counts).filter(function (t) { return counts[t] >= 2; });
    var priors = part.kazanimlar.map(function (k) { return pr.prior[k.kazanim_id]; }).filter(function (x) { return x != null; });
    var avgPrior = mean(priors);
    var recallTexts = part.kazanimlar.map(function (k) { return (pr.recalls[k.kazanim_id] || {}).text || ''; });
    var emptyRecalls = recallTexts.filter(function (t) { return t.trim().length < 15; }).length;
    var phase = (pr.phase_ms && pr.phase_ms[partIdx]) || {};
    var budget = KEtut.phaseBudget(plan && plan.duration);
    var totalMin = Object.keys(phase).reduce(function (s, k) { return s + phase[k]; }, 0) / 60000;
    var budgetTotal = Object.keys(budget).reduce(function (s, k) { return s + budget[k]; }, 0);
    return [
      { step: 1, q: 'Is the goal unclear?', flag: !plan || !plan.goal || plan.goal.trim().length < 25,
        note: plan && plan.goal ? 'Goal: “' + plan.goal + '”' : 'No plan was saved for this part.', fix: 'Write a measurable goal: what will you be able to do, and how will you test it?' },
      { step: 2, q: 'Is prior knowledge missing?', flag: (avgPrior != null && avgPrior < 1) || !!counts.bilgi_eksikligi,
        note: avgPrior == null ? 'No prior-knowledge check was done.' : 'Mean prior knowledge ' + avgPrior.toFixed(1) + '/3' + (counts.bilgi_eksikligi ? ' · ' + counts.bilgi_eksikligi + ' missing-knowledge error(s)' : ''), fix: 'Go back to the basic concepts; reread the objectives.' },
      { step: 3, q: 'Is the method passive?', flag: emptyRecalls > part.kazanimlar.length / 2,
        note: emptyRecalls + '/' + part.kazanimlar.length + ' recall answers are very short or empty.', fix: 'Retrieve by writing before looking at the answer; do not skip the self-explanation prompts.' },
      { step: 4, q: 'Is an error repeating?', flag: repeated.length > 0,
        note: repeated.length ? repeated.map(function (t) { return ERROR_BY_ID[t].label + ' ×' + counts[t]; }).join(', ') : 'No repeated error type.', fix: repeated.length ? ERROR_BY_ID[repeated[0]].action : '' },
      { step: 5, q: 'Is time running short?', flag: (totalMin > budgetTotal * 1.2) || !!counts.zaman,
        note: Math.round(totalMin) + ' min spent on this part (plan: ' + budgetTotal + ' min).', fix: 'Split it into short, spaced sessions.' },
      { step: 6, q: 'Is feedback missing?', flag: false,
        note: 'Every question showed its solution and distractor explanations.', fix: '' }
    ];
  }

  global.KMeta = {
    ERROR_TYPES: ERROR_TYPES, ERROR_BY_ID: ERROR_BY_ID, STRATEGY_TR: STRATEGY_TR, LEVEL_TR: LEVEL_TR,
    interpretGap: interpretGap, predictionGap: predictionGap, predictionOutcome: predictionOutcome, predictionsList: predictionsList,
    jolEntries: jolEntries, jolBins: jolBins, confidenceAccuracy: confidenceAccuracy,
    allAnswers: allAnswers, errorLog: errorLog, errorDistribution: errorDistribution,
    strategyEffect: strategyEffect, promptLevel: promptLevel, diagnose13: diagnose13, activeEtuts: activeEtuts
  };
})(typeof window !== 'undefined' ? window : this);
