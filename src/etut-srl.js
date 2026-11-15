/*
 * Kartotek Study: shared UI helpers and self-regulation (SRL) screens
 * Session plan (R6–7, 19) · warm-up and second-round retrieval (R9, 15–16) · JOL · self-explanation (R17)
 * generating examples / practice (R12) · score prediction (R10) · error log (R11, 13) · explain as if teaching (R14, 23)
 * learning journal and study reflection (R18, 20) · focus mode and phase timer (R19) · prompt level (R24)
 */
(function (global) {
  'use strict';
  var App = global.App, DSR = global.DSR, KEtut = global.KEtut, KMeta = global.KMeta;
  var esc = App.esc, dec = App.dec, pct = App.pct, fmtDays = App.fmtDays, fmtDate = App.fmtDate;
  var md = KEtut.renderMd;
  var DAY = DSR.DAY;
  var U = App.EtutUI = {};

  // Transient on-screen state (not saved): typed text, selections
  var ui = U.ui = { key: null, shownAt: Date.now(), form: {}, last: null };
  U.resetUi = function (key) {
    var keepLast = ui.key === key ? ui.last : null;
    U.ui = ui = { key: key, shownAt: Date.now(), form: {}, last: keepLast };
    return ui;
  };
  U.getUi = function () { return ui; };

  U.inl = function (s) { return md(s).replace(/^<p>|<\/p>$/g, ''); };
  // Consecutive slides become a range, separate ones are listed: [4, 7] → “Slides 4, 7”, [12, 14, 15] → “Slides 12, 14–15”.
  // For a book (package.source.unit = 'page') the numbers are pages: “p. 545”, “pp. 545–548”.
  // With package.source.page_offset (PDF page = printed page + offset) the stored PDF pages are shown as printed pages.
  U.slidesRef = function (sl) {
    if (!sl || !sl.length) return '';
    var off = U.refUnit === 'page' && U.refOffset ? U.refOffset : 0;
    if (off) sl = sl.map(function (x) { return x - off; });
    var n = sl.slice().sort(function (a, b) { return a - b; }).filter(function (x, i, arr) { return i === 0 || x !== arr[i - 1]; });
    var runs = [], start = n[0];
    for (var i = 1; i <= n.length; i++) {
      if (i < n.length && n[i] === n[i - 1] + 1) continue;
      runs.push(start === n[i - 1] ? String(start) : start + '–' + n[i - 1]);
      start = n[i];
    }
    var pages = U.refUnit === 'page';
    return '<span class="slides-ref">' + (pages ? (n.length === 1 ? 'p. ' : 'pp. ') : (n.length === 1 ? 'Slide ' : 'Slides ')) + runs.join(', ') + '</span>';
  };
  U.env = function (now) { return App.env(now, { medianMs: App.medianFor('kazanim'), loadByDay: App.loadByDay() }); };
  U.commit = function (et, extra) { App.store.commit(Object.assign({ etuts: [et.etut_id] }, extra || {})); };
  U.level = function () { return KMeta.promptLevel(App.S); };
  U.levelChip = function (lv) {
    return '<span class="pill level-chip" title="' + esc(lv.reason) + '">Prompts: ' + KMeta.LEVEL_TR[lv.level] + (lv.auto ? ' · auto' : '') + '</span>';
  };

  U.record = function (et, kazanimId, sig) {
    var S = App.S, now = Date.now();
    var r = KEtut.recordSignal(S, et.etut_id, kazanimId, sig, U.env(now));
    if (r.error) {
      // If the card was deleted, re-import the package to repair it, then try again
      var fix = KEtut.importPackage(S, et.package);
      App.store.commit({ meta: true, etuts: [et.etut_id], cards: fix.created || [] });
      r = KEtut.recordSignal(S, et.etut_id, kazanimId, sig, U.env(now));
      if (r.error) { App.toast(r.error); return null; }
    }
    App.store.commit({ etuts: [et.etut_id], cards: [r.card_id], reviewsFrom: S.reviews.length - 1 });
    return r;
  };

  U.traceLine = function (r) {
    if (!r || !r.res) return '';
    var t = r.res.trace;
    return '<div class="etut-trace small"><span class="lvl ' + (r.rating === 'again' ? 'bad"><i>!!</i>' : r.rating === 'hard' ? 'warn"><i>!</i>' : 'ok"><i>✓</i>') +
      'DSR: ' + esc(App.RATING_TR[r.rating]) + '</span>' +
      'stability S: ' + (t.S_old == null ? 'initial' : dec(t.S_old, 2)) + ' → ' + dec(t.S_new, 2) + ' d · difficulty D: ' + (t.D_old == null ? 'initial' : dec(t.D_old, 2)) + ' → ' + dec(t.D_new, 2) +
      ' · next review <b>' + fmtDate(t.due_at) + '</b> (' + fmtDays(t.interval_days) + ')</div>';
  };

  // Scale buttons: data-set sets ui.form[name] = value
  U.scale = function (name, opts, current, cls) {
    return '<div class="scale ' + (cls || '') + '" role="radiogroup">' + opts.map(function (o) {
      var on = String(current) === String(o.v);
      return '<button type="button" class="btn small scale-btn' + (on ? ' on' : '') + '" data-set="' + esc(name) + '" data-val="' + esc(o.v) + '" role="radio" aria-checked="' + on + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' + esc(o.label) + '</button>';
    }).join('') + '</div>';
  };

  // ------------------------------------------------------------------ blocks
  U.blockHtml = function (b) {
    var ref = b.slides ? ' ' + U.slidesRef(b.slides) : '';
    var inl = U.inl;
    switch (b.type) {
      case 'text': return '<div class="blk blk-text">' + md(b.md) + ref + '</div>';
      case 'analogy': return '<div class="blk blk-box blk-analogy"><span class="blk-label">Analogy</span>' + md(b.md) + '</div>';
      case 'example': return '<div class="blk blk-box blk-example"><span class="blk-label">Example</span>' + md(b.md) + ref + '</div>';
      case 'callout': return '<div class="blk blk-box blk-callout" data-tone="' + esc(b.tone || 'ipucu') + '"><span class="blk-label">' + (b.tone === 'dikkat' ? 'Watch out' : 'Tip') + '</span>' + md(b.md) + '</div>';
      case 'keypoints': return '<div class="blk blk-keypoints">' + (b.title ? '<h3>' + esc(b.title) + '</h3>' : '') + '<ul>' + (b.items || []).map(function (x) { return '<li>' + inl(x) + '</li>'; }).join('') + '</ul>' + ref + '</div>';
      case 'steps':
        return '<div class="blk blk-steps">' + (b.title ? '<h3>' + esc(b.title) + '</h3>' : '') + '<ol>' + (b.items || []).map(function (x) { return '<li><span>' + inl(x) + '</span></li>'; }).join('') + '</ol>' + ref + '</div>';
      case 'compare':
        return '<div class="blk blk-compare">' + (b.title ? '<h3>' + esc(b.title) + '</h3>' : '') + '<div class="table-wrap"><table class="data wrap"><thead><tr>' +
          (b.columns || []).map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          (b.rows || []).map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inl(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
          '</tbody></table></div>' + ref + '</div>';
      case 'tree':
        var node = function (n) {
          if (typeof n === 'string') return '<li>' + esc(n) + '</li>';
          return '<li>' + esc(n.label || n.root || '') + (n.children && n.children.length ? '<ul>' + n.children.map(node).join('') + '</ul>' : '') + '</li>';
        };
        return '<div class="blk blk-tree"><ul><li><b>' + esc(b.root) + '</b><ul>' + (b.children || []).map(node).join('') + '</ul></li></ul>' + ref + '</div>';
      case 'anim':
        // Frame-based animation (etut-anim.js): the learner plays, pauses and scrubs; nothing autoplays
        var asvg = KEtut.sanitizeSvg(b.svg);
        if (!asvg) return '';
        var spec = { duration: b.duration, fps: b.fps || 30, vars: b.vars || {} };
        var scenes = (b.scenes || []).map(function (s, i) {
          return '<div class="kt-anim-scene" data-from="' + s.from + '" data-to="' + s.to + '"><button type="button" class="kt-anim-jump" data-from="' + s.from + '" aria-label="Go to step ' + (i + 1) + '">' + (i + 1) + '</button><div>' + inl(s.md) + '</div></div>';
        }).join('');
        return '<figure class="blk blk-anim kt-anim" data-anim="' + esc(JSON.stringify(spec)) + '">' + (b.title ? '<h3>' + esc(b.title) + '</h3>' : '') + asvg +
          '<div class="kt-anim-bar"><button type="button" class="btn small kt-anim-play" aria-pressed="false" aria-label="Play the animation"><i aria-hidden="true"></i><span>Play</span></button>' +
          '<input type="range" class="kt-anim-range" min="0" max="1" step="1" value="0" aria-label="Animation time"><span class="kt-anim-time small muted">0.0 s</span></div>' +
          (scenes ? '<div class="kt-anim-scenes">' + scenes + '</div>' : '') +
          (b.caption ? '<figcaption>' + esc(b.caption) + '</figcaption>' : '') + ref + '</figure>';
      case 'svg':
        var svg = KEtut.sanitizeSvg(b.svg);
        return svg ? '<figure class="blk blk-svg">' + svg + (b.caption ? '<figcaption>' + esc(b.caption) + '</figcaption>' : '') + '</figure>' : '';
      case 'worked':
        // Worked example: each step's “why” starts collapsed; explain it yourself first (Rule 17)
        return '<div class="blk blk-box blk-worked"><span class="blk-label">Worked example</span><div class="worked-problem">' + md(b.problem) + '</div><ol class="worked-steps">' +
          (b.steps || []).map(function (s) {
            return '<li><div>' + inl(s.do) + '</div>' + (s.why ? '<details><summary>Why? Think first, then open</summary>' + md(s.why) + '</details>' : '') + '</li>';
          }).join('') + '</ol>' + (b.answer ? '<p class="worked-answer"><b>Result:</b> ' + inl(b.answer) + '</p>' : '') + ref + '</div>';
      default: return '';
    }
  };

  // ------------------------------------------------------------------ focus mode and phase timer (Rule 19)
  U.focusOn = function () { return document.body.classList.contains('focus-mode'); };
  U.setFocus = function (on) {
    document.body.classList.toggle('focus-mode', !!on);
    App.setPref('kartotek-focus', on ? '1' : '0');
    if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      try { document.documentElement.requestFullscreen().catch(function () {}); } catch (e) { /* fullscreen not supported */ }
    }
    if (!on && document.fullscreenElement && document.exitFullscreen) { try { document.exitFullscreen().catch(function () {}); } catch (e) { /* ignore */ } }
  };

  function phaseKey(pr) { return pr.stage === 'final' || pr.stage === 'final_review' || pr.stage === 'done' ? 'final' : String(pr.part); }

  U.timerHtml = function (et) {
    return '<div class="phase-timer" id="phase-timer" aria-live="off">' + U.timerText(et) + '</div>';
  };
  U.timerText = function (et) {
    var pr = et.progress, key = phaseKey(pr), plan = pr.plans[pr.part];
    var ms = (pr.phase_ms && pr.phase_ms[key]) || {};
    var total = Object.keys(ms).reduce(function (s, k) { return s + ms[k]; }, 0);
    if (key === 'final' || !plan) return '<span class="muted">Time: ' + Math.round(total / 60000) + ' min</span>';
    var budget = KEtut.phaseBudget(plan.duration);
    var ph = KEtut.phaseOf(pr, { errorOpen: ui.errorOpen });
    var label = KEtut.PHASES.filter(function (p) { return p.id === ph; })[0].label;
    var used = (ms[ph] || 0) / 60000, over = used > budget[ph];
    var note = 'This phase’s time is up; consider moving to the next phase.';
    return '<span class="' + (over ? 'over' : '') + '">Phase: <b>' + esc(label) + '</b> ' + Math.floor(used) + '/' + budget[ph] + ' min</span>' +
      '<span class="muted"> · total ' + Math.floor(total / 60000) + '/' + plan.duration + ' min</span>' +
      (over ? '<span class="over-note"> · ' + note + '</span>' : '');
  };

  var tick = 0;
  setInterval(function () {
    if ((App.baseTab ? App.baseTab() : App.tab) !== 'etut' || !App.etutOpen || document.hidden) return;
    var et = App.S.etuts && App.S.etuts[App.etutOpen];
    if (!et || et.removed || !et.progress || et.progress.stage === 'done') return;
    var pr = et.progress, key = phaseKey(pr);
    var ph = KEtut.phaseOf(pr, { errorOpen: ui.errorOpen });
    pr.phase_ms[key] = pr.phase_ms[key] || {};
    pr.phase_ms[key][ph] = (pr.phase_ms[key][ph] || 0) + 1000;
    var el = document.getElementById('phase-timer');
    if (el) el.innerHTML = U.timerText(et);
    var t = document.getElementById('etut-timer');
    if (t && ui.shownAt) t.textContent = Math.floor((Date.now() - ui.shownAt) / 1000) + ' s';
    if (++tick % 30 === 0) U.commit(et);
  }, 1000);

  // ------------------------------------------------------------------ 1 · session plan (Rules 6, 7, 19)
  var PRIOR = [{ v: 0, label: '0 · None' }, { v: 1, label: '1 · Heard of it' }, { v: 2, label: '2 · Can explain a bit' }, { v: 3, label: '3 · Confidently' }];
  U.PRIOR_TR = ['none', 'heard of it', 'can explain a bit', 'can explain confidently'];
  // The “from last session” note was removed from the plan; the built ui.js still calls this until ui/ is rebuilt
  U.lastChange = function () { return null; };

  // Only what the study flow uses: prior knowledge (monitoring table, Rule 13 diagnosis), the success criterion
  // (decides whether the diagnosis opens) and the session length (phase timer)
  U.planHtml = function (et, lv) {
    var pr = et.progress, part = KEtut.currentPart(et), goal = KEtut.autoGoal(part), f = ui.form;
    if (f.criterion == null) {
      var old = pr.plans[pr.part] || {};
      f.criterion = String(old.criterion != null ? old.criterion : goal.criterion);
      f.duration = String(old.duration || 90);
      part.kazanimlar.forEach(function (k) { if (pr.prior[k.kazanim_id] != null) f['prior:' + k.kazanim_id] = String(pr.prior[k.kazanim_id]); });
    }
    var budget = KEtut.phaseBudget(Number(f.duration));
    var priorReq = part.kazanimlar.map(function (k) { return 'prior:' + k.kazanim_id; }).join(',');
    var durations = [{ v: 30, label: '30 min' }, { v: 45, label: '45 min' }, { v: 60, label: '60 min' }, { v: 90, label: '90 min' }];
    var sPrior = '<section class="plan-q"><h3>What do I already know about each objective?</h3>' +
      '<p class="small muted">Rate each objective honestly; it will be compared with your actual recall at the end.</p>' +
      '<div class="prior-list">' + part.kazanimlar.map(function (k) {
        return '<div class="prior-row"><span>' + esc(k.title) + '</span>' + U.scale('prior:' + k.kazanim_id, PRIOR, f['prior:' + k.kazanim_id]) + '</div>';
      }).join('') + '</div></section>';
    var sTest = '<section class="plan-q"><h3>Success criterion</h3>' +
      '<p>Closed-book recall after each objective, then a ' + goal.n + '-question quiz. At least ' +
      '<input class="input num-input" type="number" min="1" max="' + goal.n + '" data-f="criterion" value="' + esc(f.criterion) + '" aria-label="Success criterion"> correct.</p></section>';
    var sTime = '<section class="plan-q"><h3>Session length</h3>' + U.scale('duration', durations, f.duration) +
      '<p class="small muted phase-plan">' + KEtut.PHASES.map(function (p) { return esc(p.label) + ' ' + budget[p.id] + ' min'; }).join(' · ') + '</p></section>';
    var head = '<div class="kz-head"><div class="row"><span class="pill">Part ' + (pr.part + 1) + '/' + et.package.parts.length + ' · Session plan</span>' + U.levelChip(lv) + '</div>' +
      '<h2>' + esc(part.title) + '</h2></div>';
    var minimal = lv.level === 'minimal';
    var body = minimal ? sTime + '<details class="panel"><summary>Rate prior knowledge and set the criterion</summary>' + sPrior + sTest + '</details>' : sPrior + sTest + sTime;
    return head + '<div class="plan-form stack">' + body + '</div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="plan-save" data-req="' + (minimal ? '' : priorReq) + '">Save plan and start</button><span class="small muted req-hint"></span></div>';
  };

  U.savePlan = function (et) {
    var pr = et.progress, part = KEtut.currentPart(et), f = ui.form, n = part.quiz.length;
    part.kazanimlar.forEach(function (k) {
      var v = f['prior:' + k.kazanim_id];
      if (v != null && v !== '') pr.prior[k.kazanim_id] = Number(v);
    });
    var crit = DSR.clip(1, n, parseInt(f.criterion, 10) || KEtut.autoGoal(part).criterion);
    pr.plans[pr.part] = {
      goal: KEtut.autoGoal(part, crit).text, criterion: crit, n: n,
      duration: Number(f.duration) || 90, level: U.level().level, at: Date.now()
    };
  };

  // ------------------------------------------------------------------ recall (shared by learn, warm-up, second round)
  // loc: {k, phase:'recall'|'check'|'rated', saved, round, label}
  U.recallHtml = function (et, loc) {
    var k = loc.k, rc = loc.saved;
    var prompt = '<div class="recall-card"><span class="blk-label">' + esc(loc.label || 'Recall') + '</span><p class="recall-q">' + U.inl(k.recall.prompt) + '</p></div>';
    if (loc.phase === 'recall') {
      return prompt +
        '<label class="field">Your answer<textarea id="recall-text" data-f="draft" rows="4" placeholder="Write as much as you remember in your own words. If you remember nothing, leave it empty and check.">' + esc(ui.form.draft || '') + '</textarea></label>' +
        '<div class="row etut-actions"><button class="btn primary" data-act="rc-check">Check</button><span class="timer" id="etut-timer">0 s</span></div>';
    }
    var kp = k.recall.key_points || [];
    var answer = rc ? rc.text : (ui.form.draft || '');
    var compare = '<div class="grid2 feedback">' +
      '<div class="panel"><h3>Your answer</h3><p class="user-answer">' + (answer ? esc(answer) : '<span class="muted">Left empty</span>') + '</p></div>' +
      '<div class="panel"><h3>Model answer</h3>' + md(k.recall.model_answer) +
      (kp.length ? '<p class="small muted" style="margin-top:8px">Tick the key points that are in your answer:</p><ul class="kp-check">' + kp.map(function (p, i) {
        var on = rc ? (rc.checked || []).indexOf(i) >= 0 : !!ui.form['kp:' + i];
        return '<li><label><input type="checkbox" data-f="kp:' + i + '"' + (on ? ' checked' : '') + (rc ? ' disabled' : '') + '> ' + U.inl(p) + '</label></li>';
      }).join('') + '</ul>' : '') + '</div></div>';
    if (loc.phase === 'check') {
      var card = App.S.cards[et.card_map[k.kazanim_id]], mem = App.S.mem[et.card_map[k.kazanim_id]];
      var pv = card && mem ? DSR.previewIntervals(card, mem, U.env(Date.now())) : null;
      return prompt + compare + '<p class="small" id="suggest">' + U.suggestText(kp) + '</p>' +
        '<div class="answer-bar">' + DSR.RATING_ORDER.map(function (r, i) {
          return '<button class="rate ' + r + '" data-rc-rate="' + r + '"><b>' + App.RATING_TR[r] + '</b><small>' + (pv ? App.fmtMs(pv[r]) : '') + '</small><kbd>' + (i + 1) + '</kbd></button>';
        }).join('') + '</div>';
    }
    return prompt + compare + U.traceLine(ui.last) +
      '<div class="row etut-actions"><button class="btn primary" data-act="rc-next">' + esc(loc.nextLabel || 'Continue') + '</button></div>';
  };
  U.checkedKp = function (kp) { return kp.map(function (_, i) { return i; }).filter(function (i) { return !!ui.form['kp:' + i]; }); };
  U.suggestText = function (kp) {
    if (!kp.length) return 'Compare with the model answer and rate yourself honestly.';
    var n = U.checkedKp(kp).length;
    var s = n === 0 ? 'again' : n < kp.length / 2 ? 'hard' : 'good';
    return 'Points ticked: ' + n + '/' + kp.length + ' · suggestion: <b>' + App.RATING_TR[s] + '</b>. Choose Easy only if you recalled it quickly and completely. A feeling of familiarity is not evidence (Rule 8).';
  };

  // ------------------------------------------------------------------ JOL: recall prediction
  U.jolHtml = function (et, k) {
    var opts = [];
    for (var v = 0; v <= 100; v += 10) opts.push({ v: v, label: v + '%' });
    return '<div class="panel stack"><h3>Recall prediction</h3>' +
      '<p>The lesson text will be hidden in a moment. How likely are you to explain the objective <b>' + esc(k.title) + '</b> without notes?</p>' +
      U.scale('jol', opts, ui.form.jol, 'scale-wide') +
      '<p class="small muted">Your prediction is compared with the share of key points you tick during recall. It does not affect DSR; it only measures how accurately you monitor yourself.</p></div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="jol-save" data-req="jol">Save prediction, go to recall</button></div>';
  };

  // ------------------------------------------------------------------ self-explanation (Rule 17)
  U.explainHtml = function (et, k, lv) {
    var pr = et.progress, limit = KEtut.explainLimit(k, lv.level), item = k.self_explain[pr.ei];
    var head = '<div class="panel stack"><h3>Self-explanation ' + (limit > 1 ? (pr.ei + 1) + '/' + limit : '') + '</h3>' +
      '<p class="explain-q">' + U.inl(item.prompt) + '</p>';
    if (!ui.form.revealed) {
      return head + '<textarea class="input" rows="4" data-f="explain" placeholder="Explain it in your own words, without looking at the notes.">' + esc(ui.form.explain || '') + '</textarea>' +
        '<p class="small muted">Questions: Why is this true? What does it connect to? When does it not hold? How would I apply it to a new example?</p></div>' +
        '<div class="row etut-actions"><button class="btn primary" data-act="explain-reveal" data-req="' + (lv.level === 'minimal' ? '' : 'explain@10') + '">Compare my explanation</button>' +
        (lv.level === 'minimal' ? '<button class="btn" data-act="explain-skip">Skip</button>' : '') + '</div>';
    }
    return head + '<div class="grid2 feedback"><div class="panel"><h3>Your explanation</h3><p class="user-answer">' + esc(ui.form.explain || '-') + '</p></div>' +
      '<div class="panel"><h3>Explanation based on the slides</h3>' + md(item.reference) + '</div></div>' +
      '<p class="small">Does your explanation match it?</p>' + U.scale('self', [{ v: 'evet', label: 'Yes' }, { v: 'kismen', label: 'Partly' }, { v: 'hayir', label: 'No' }], ui.form.self) + '</div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="explain-next" data-req="self">Continue</button></div>';
  };

  // ------------------------------------------------------------------ produce: example / draft / performance attempt (Rules 12, 23)
  U.produceHtml = function (et, k) {
    var p = k.produce, label = KEtut.PRODUCE_TR[k.kind || 'kavram'];
    var head = '<div class="panel stack"><h3>' + esc(label) + '</h3><p>' + U.inl(p.prompt) + '</p>';
    if (!ui.form.revealed) {
      return head + '<textarea class="input" rows="5" data-f="produce" placeholder="Write your own example or attempt.">' + esc(ui.form.produce || '') + '</textarea></div>' +
        '<div class="row etut-actions"><button class="btn primary" data-act="produce-check" data-req="produce@10">Assess against the rubric</button></div>';
    }
    return head + '<p class="user-answer">' + esc(ui.form.produce) + '</p>' +
      '<p class="small muted">Rubric (Rule 23): tick the items you met.</p><ul class="kp-check">' + p.rubric.map(function (r, i) {
        return '<li><label><input type="checkbox" data-f="rb:' + i + '"' + (ui.form['rb:' + i] ? ' checked' : '') + '> ' + U.inl(r) + '</label></li>';
      }).join('') + '</ul></div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="produce-next">Continue</button></div>';
  };

  // ------------------------------------------------------------------ practice (problem type)
  U.practiceHtml = function (et, k) {
    var pr = et.progress, q = k.practice[pr.pi], saved = pr.practice[q.q_id];
    var head = '<div class="panel stack"><h3>Practice ' + (k.practice.length > 1 ? (pr.pi + 1) + '/' + k.practice.length : '') + '</h3><div class="q-stem">' + md(q.stem) + '</div>';
    if (q.options) {
      var opts = '<ol class="opts">' + q.options.map(function (o, i) {
        var cls = 'opt';
        if (saved) cls += i === q.correct ? ' correct' : i === saved.choice ? ' wrong' : ' dim';
        else if (String(ui.form.choice) === String(i)) cls += ' selected';
        return '<li><button class="' + cls + '" data-set="choice" data-val="' + i + '"' + (saved ? ' disabled' : '') + '><span class="letter">' + 'ABCD'[i] + '</span><span class="opt-body">' + U.inl(o) + '</span></button></li>';
      }).join('') + '</ol>';
      if (!saved) return head + opts + '</div><div class="row etut-actions"><button class="btn primary" data-act="practice-check" data-req="choice">Check</button></div>';
      return head + opts + '<p class="verdict">' + (saved.correct ? '<span class="lvl ok"><i>✓</i>Correct</span>' : '<span class="lvl bad"><i>!!</i>Wrong</span>') + '</p>' +
        '<div class="panel"><h3>Solution</h3>' + md(q.solution) + '</div></div>' +
        '<div class="row etut-actions"><button class="btn primary" data-act="practice-next">Continue</button></div>';
    }
    if (!saved) {
      return head + '<textarea class="input" rows="4" data-f="ptext" placeholder="Write your solution step by step.">' + esc(ui.form.ptext || '') + '</textarea></div>' +
        '<div class="row etut-actions"><button class="btn primary" data-act="practice-check" data-req="ptext@5">Show solution</button></div>';
    }
    return head + '<div class="grid2 feedback"><div class="panel"><h3>Your solution</h3><p class="user-answer">' + esc(saved.text) + '</p></div><div class="panel"><h3>Solution</h3>' + md(q.solution) + '</div></div>' +
      '<p class="small">Was your solution correct?</p>' + U.scale('pself', [{ v: 'dogru', label: 'Correct' }, { v: 'kismen', label: 'Partly' }, { v: 'yanlis', label: 'Wrong' }], ui.form.pself || saved.self) + '</div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="practice-next" data-req="pself">Continue</button></div>';
  };

  // ------------------------------------------------------------------ score prediction (Rule 10)
  U.predictHtml = function (et, n, isFinal) {
    var opts = [];
    for (var i = 0; i <= n; i++) opts.push({ v: i, label: String(i) });
    return '<div class="panel stack"><h3>Prediction before the ' + (isFinal ? 'final test' : 'quiz') + '</h3>' +
      '<p>How many of the ' + n + ' questions do you think you will get right?</p>' + U.scale('predict', opts, ui.form.predict, 'scale-wide') +
      '<p class="small muted">When the test ends, your prediction is compared with the actual result: calibration gap = predicted success − actual success (Rule 10).</p></div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="predict-save" data-req="predict">Save prediction and start</button></div>';
  };

  U.gapHtml = function (o, title) {
    if (!o) return '';
    if (!o.complete) return '<div class="panel"><h3>' + esc(title) + '</h3><p class="small muted">Prediction: ' + o.predicted + '/' + o.n + ' · will be compared when the test is complete.</p></div>';
    return '<div class="panel stack"><h3>' + esc(title) + '</h3>' +
      '<p><span class="lvl ' + o.level + '"><i>' + (o.level === 'ok' ? '✓' : '!') + '</i>' + esc(o.label) + '</span>' +
      'Predicted <b>' + o.predicted + '/' + o.n + '</b> (' + pct(o.predicted_ratio) + ') · actual <b>' + o.correct + '/' + o.n + '</b> (' + pct(o.actual_ratio) + ') · gap <b>' + (o.gap > 0 ? '+' : '') + dec(o.gap * 100, 0) + ' points</b></p>' +
      '<p class="small">' + esc(o.text) + '</p></div>';
  };

  // ------------------------------------------------------------------ error log (Rule 11) + adaptation (Rule 13)
  U.errorLogHtml = function (et, q, ans, lv, k) {
    if (ans.error) {
      var t = KMeta.ERROR_BY_ID[ans.error.type];
      return '<div class="panel stack errlog"><h3>Error log</h3>' +
        '<p><span class="lvl warn"><i>!</i>' + esc(t.label) + '</span>' + (ans.error.cause ? 'Cause: ' + esc(ans.error.cause) : '') + '</p>' +
        (ans.error.step ? '<p class="small">Next time: <b>' + esc(ans.error.step) + '</b></p>' : '') +
        '<div class="blk-box blk-callout" data-tone="ipucu"><span class="blk-label">Suggested adaptation</span><p>' + esc(t.action) + '</p></div>' +
        (t.reread && k ? '<details class="reread"><summary>Reread the objective: ' + esc(k.title) + '</summary>' + k.blocks.map(U.blockHtml).join('') + '</details>' : '') + '</div>';
    }
    if (ui.form.errtype == null && ans.confidence === 'sure') ui.form.errtype = 'kavram_yanilgisi';
    var need = lv.level === 'minimal' ? 'errtype' : 'errtype,errcause@3,errstep@3';
    return '<div class="panel stack errlog"><h3>Error log</h3><p class="small muted">An error is not a failure; it is a source of data (Rule 11).' +
      (ans.confidence === 'sure' ? ' Wrong although you were sure: “misconception” is suggested; change it if you like.' : '') + '</p>' +
      '<p class="small"><b>1 · Type of error</b></p>' + U.scale('errtype', KMeta.ERROR_TYPES.map(function (t) { return { v: t.id, label: t.label }; }), ui.form.errtype, 'scale-wrap') +
      '<label class="field">2 · Cause of the error<textarea class="input" rows="2" data-f="errcause" placeholder="Why did you pick this option; what was missing?">' + esc(ui.form.errcause || '') + '</textarea></label>' +
      '<label class="field">3 · The concrete step I will take next time<textarea class="input" rows="2" data-f="errstep" placeholder="For example: I will restate the question stem in my own words.">' + esc(ui.form.errstep || '') + '</textarea></label>' +
      '<div class="row"><button class="btn primary" data-act="error-save" data-req="' + need + '">Complete the error entry</button><span class="small muted req-hint"></span></div></div>';
  };

  // ------------------------------------------------------------------ priming: part summary, keywords and the Questions list
  U.qlistHtml = function (et, pi, heading) {
    var pr = et.progress, list = KEtut.qlistOf(pr, pi), c = KEtut.qlistCounts(pr, pi);
    var rows = list.map(function (q) {
      return '<li class="ql-row"' + (q.done ? ' data-done="1"' : '') + '>' +
        '<label class="ql-check"><input type="checkbox" data-ql-check="' + pi + ':' + esc(q.id) + '"' + (q.done ? ' checked' : '') + ' aria-label="Answered: ' + esc(q.text) + '"><span>' + esc(q.text) + '</span></label>' +
        '<textarea class="input ql-answer" rows="2" data-ql-answer="' + pi + ':' + esc(q.id) + '" placeholder="The answer, in your own words" aria-label="Answer: ' + esc(q.text) + '">' + esc(q.answer || '') + '</textarea>' +
        '<button class="btn small ql-del" data-ql-del="' + pi + ':' + esc(q.id) + '" aria-label="Delete: ' + esc(q.text) + '" title="Delete">×</button></li>';
    }).join('');
    return '<section class="ql"><div class="ql-head"><h3>' + esc(heading || 'Questions list') + '</h3><span class="small muted">' + c.done + '/' + c.total + ' ticked</span></div>' +
      (rows ? '<ul class="ql-items">' + rows + '</ul>' : '<p class="small muted">No questions yet. Write what you want this part to answer.</p>') +
      '<div class="row ql-add"><input class="input" data-ql-new="' + pi + '" placeholder="Write a question…" aria-label="New question"><button class="btn small" data-ql-add="' + pi + '">Add</button></div></section>';
  };
  U.primingHtml = function (et, lv) {
    var pr = et.progress, part = KEtut.currentPart(et), sm = part.summary || {}, kw = sm.keywords || [];
    return '<div class="kz-head"><div class="row"><span class="pill">Part ' + (pr.part + 1) + '/' + et.package.parts.length + ' · Priming</span>' + U.levelChip(lv) + '</div>' +
      '<h2>' + esc(part.title) + '</h2><p class="small muted">Read what this part covers, then write the questions you want it to answer. The Questions list stays open for the whole part: tick a question when you can answer it and write the answer next to it.</p></div>' +
      (sm.md ? '<div class="panel stack"><h3>Summary</h3>' + md(sm.md) + '</div>' : '') +
      (kw.length ? '<div class="panel stack"><h3>Keywords</h3><dl class="kw-list">' + kw.map(function (w) { return '<div><dt><b>' + esc(w.term) + '</b></dt><dd>' + esc(w.definition) + '</dd></div>'; }).join('') + '</dl></div>' : '') +
      '<div class="panel">' + U.qlistHtml(et, pr.part) + '</div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="priming-next">Start the lesson</button></div>';
  };
  // Under every later screen of the part; in the final stages, every part's list
  U.qlistDockHtml = function (et) {
    var pr = et.progress, inFinal = ['final', 'final_review', 'done'].indexOf(pr.stage) >= 0;
    if (!inFinal && (pr.stage === 'plan' || pr.stage === 'priming')) return '';
    var pis = inFinal ? et.package.parts.map(function (_, i) { return i; }) : [pr.part];
    var total = 0, done = 0;
    pis.forEach(function (i) { var c = KEtut.qlistCounts(pr, i); total += c.total; done += c.done; });
    if (inFinal && !total) return '';
    return '<details class="panel ql-dock"' + (App.pref('kartotek-qlist-open') !== '0' ? ' open' : '') + '><summary>Questions list <span class="small muted">· ' + done + '/' + total + ' ticked</span></summary>' +
      pis.map(function (i) { return U.qlistHtml(et, i, inFinal ? 'Part ' + (i + 1) + ': ' + et.package.parts[i].title : 'Part ' + (i + 1)); }).join('') + '</details>';
  };
  U.bindQlist = function (root, et, rerender) {
    var pr = et.progress;
    function ref(s) { var i = s.indexOf(':'); return { pi: Number(s.slice(0, i)), id: s.slice(i + 1) }; }
    root.querySelectorAll('[data-ql-check]').forEach(function (b) { b.addEventListener('change', function () { var r = ref(b.dataset.qlCheck); KEtut.qlistSet(pr, r.pi, r.id, { done: b.checked }); U.commit(et); rerender(); }); });
    root.querySelectorAll('[data-ql-answer]').forEach(function (t) {
      t.addEventListener('input', function () { var r = ref(t.dataset.qlAnswer); KEtut.qlistSet(pr, r.pi, r.id, { answer: t.value }); });
      t.addEventListener('blur', function () { U.commit(et); });
    });
    root.querySelectorAll('[data-ql-del]').forEach(function (b) { b.addEventListener('click', function () { var r = ref(b.dataset.qlDel); KEtut.qlistRemove(pr, r.pi, r.id); U.commit(et); rerender(); }); });
    function add(pi) { var inp = root.querySelector('[data-ql-new="' + pi + '"]'); if (inp && KEtut.qlistAdd(pr, pi, inp.value)) { U.commit(et); rerender(); } }
    root.querySelectorAll('[data-ql-add]').forEach(function (b) { b.addEventListener('click', function () { add(b.dataset.qlAdd); }); });
    root.querySelectorAll('[data-ql-new]').forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(i.dataset.qlNew); } }); });
    var dock = root.querySelector('.ql-dock');
    if (dock) dock.addEventListener('toggle', function () { App.setPref('kartotek-qlist-open', dock.open ? '1' : '0'); });
  };

  // ------------------------------------------------------------------ explain as if teaching (Rules 14, 23)
  U.teachRubric = function (part) {
    if (part.teach && part.teach.rubric) return part.teach.rubric;
    var items = part.kazanimlar.map(function (k) { return k.title; });
    ((part.summary && part.summary.keywords) || []).forEach(function (w) { if (items.indexOf(w.term) < 0) items.push(w.term); });
    return items.slice(0, 8);
  };
  U.teachHtml = function (et) {
    var pr = et.progress, part = KEtut.currentPart(et), rubric = U.teachRubric(part);
    var prompt = (part.teach && part.teach.prompt) || 'Write this part out without notes, as if explaining it to a friend who knows nothing about the topic.';
    var head = '<div class="kz-head"><span class="pill">Part ' + (pr.part + 1) + ' · Explain as if teaching</span><h2>' + esc(part.title) + '</h2></div>' +
      '<div class="recall-card"><span class="blk-label">Teaching task</span><p class="recall-q">' + U.inl(prompt) + '</p></div>';
    if (!ui.form.revealed) {
      return head + '<textarea class="input" rows="8" data-f="teach" placeholder="Start from the main ideas, then add cause–effect relations and an example.">' + esc(ui.form.teach || '') + '</textarea>' +
        '<div class="row etut-actions"><button class="btn primary" data-act="teach-check" data-req="teach@40">Assess against the rubric</button><span class="small muted">Lesson texts are hidden at this step.</span></div>';
    }
    return head + '<div class="grid2 feedback"><div class="panel"><h3>Your explanation</h3><p class="user-answer">' + esc(ui.form.teach) + '</p></div>' +
      '<div class="panel"><h3>Rubric</h3><p class="small muted">Tick the items your explanation clearly covers (Rule 23).</p><ul class="kp-check">' + rubric.map(function (r, i) {
        return '<li><label><input type="checkbox" data-f="rb:' + i + '"' + (ui.form['rb:' + i] ? ' checked' : '') + '> ' + U.inl(r) + '</label></li>';
      }).join('') + '</ul></div></div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="teach-save">Save and go to the reflection</button></div>';
  };

  // ------------------------------------------------------------------ learning journal (Rules 18, 20)
  U.partFacts = function (et, pi) {
    var S = App.S, pr = et.progress, part = et.package.parts[pi], now = Date.now();
    var res = KEtut.partResult(et, pi);
    var plan = pr.plans[pi];
    var good = [], hard = [], dues = [];
    part.kazanimlar.forEach(function (k) {
      var r = pr.recalls[k.kazanim_id];
      var wrong = part.quiz.some(function (q) { return q.kazanim_id === k.kazanim_id && pr.answers[q.q_id] && !pr.answers[q.q_id].correct; });
      if (r && (r.rating === 'good' || r.rating === 'easy') && !wrong) good.push(k.title); else hard.push(k.title);
      var m = S.mem[et.card_map[k.kazanim_id]];
      if (m && m.due_at) dues.push(m.due_at);
    });
    var used = ['Retrieval'];
    if (part.kazanimlar.some(function (k) { return pr.explains[k.kazanim_id]; })) used.push('Self-explanation');
    if (part.kazanimlar.some(function (k) { return pr.produce[k.kazanim_id]; })) used.push('Generating examples');
    if (part.kazanimlar.some(function (k) { return (k.practice || []).some(function (q) { return pr.practice[q.q_id]; }); })) used.push('Worked example + practice');
    if (pr.retry[pi]) used.push('Second round');
    if (pr.teach[pi]) used.push('Explaining as if teaching');
    var jols = part.kazanimlar.map(function (k) { return pr.jol[k.kazanim_id]; }).filter(function (j) { return j && j.actual != null; });
    return {
      goal: plan ? plan.goal : KEtut.autoGoal(part).text, result: res, prediction: KMeta.predictionOutcome(et, 'quiz:' + pi),
      jol_gap: jols.length ? jols.reduce(function (s, j) { return s + (j.jol - j.actual); }, 0) / jols.length : null,
      good: good, hard: hard, review_at: dues.length ? Math.min.apply(null, dues) : null, used: used, now: now
    };
  };

  // pre: the part's results, shown between the heading and the journal fields
  U.journalHtml = function (et, lv, pre) {
    var pr = et.progress, part = KEtut.currentPart(et), F = U.partFacts(et, pr.part), f = ui.form;
    if (f.explainable == null) { f.explainable = F.good.join('\n'); f.struggled = F.hard.join('\n'); }
    // Goal, quiz result and prediction gap are in the results above; only what they do not show is repeated here
    var auto = '<div class="panel journal-auto"><h3>Filled in automatically</h3><dl class="facts">' +
      '<div><dt>Recall prediction (JOL) gap</dt><dd>' + (F.jol_gap != null ? (F.jol_gap > 0 ? '+' : '') + dec(F.jol_gap * 100, 0) + ' points' : '-') + '</dd></div>' +
      '<div><dt>Review date</dt><dd>' + (F.review_at ? fmtDate(F.review_at) : '-') + '</dd></div>' +
      '<div><dt>Strategies I used</dt><dd>' + esc(F.used.join(', ')) + '</dd></div></dl></div>';
    var qExpl = '<label class="field">What can I explain without notes?<textarea class="input" rows="3" data-f="explainable">' + esc(f.explainable) + '</textarea></label>';
    var qStr = '<label class="field">Which question or concept did I struggle with?<textarea class="input" rows="3" data-f="struggled">' + esc(f.struggled) + '</textarea></label>' +
      '<label class="field">What was the evidence of the difficulty?<textarea class="input" rows="2" data-f="evidence" placeholder="For example: I got question 3 wrong even though I was sure.">' + esc(f.evidence || '') + '</textarea></label>';
    var qStrat = '<div class="field"><span>Which strategy worked?</span>' + U.scale('strategy', F.used.map(function (s) { return { v: s, label: s }; }), f.strategy, 'scale-wrap') + '</div>';
    var qChange = '<label class="field"><b>The one thing I will change next session</b><textarea class="input" rows="2" data-f="change" placeholder="A single, concrete change.">' + esc(f.change || '') + '</textarea></label>';
    var fields = lv.level === 'full' ? qExpl + qStr + qStrat + qChange : lv.level === 'short' ? qStr + qStrat + qChange : qChange;
    return '<div class="kz-head"><div class="row"><span class="pill">Part ' + (pr.part + 1) + ' · Learning journal</span>' + U.levelChip(lv) + '</div><h2>' + esc(part.title) + '</h2></div>' +
      (pre || '') + '<h3>Learning journal</h3>' + auto + '<div class="panel stack">' + fields + '</div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="journal-save" data-req="change@5">' +
      (pr.part + 1 < et.package.parts.length ? 'Save the journal and plan the next part' : 'Save the journal and go to the final test') + '</button><span class="small muted req-hint"></span></div>';
  };

  U.saveJournal = function (et) {
    var pr = et.progress, F = U.partFacts(et, pr.part), f = ui.form;
    pr.journal[pr.part] = {
      goal: F.goal, correct: F.result.correct, n: F.result.n, criterion: F.result.criterion, met: F.result.met,
      predicted: F.prediction ? F.prediction.predicted : null, gap: F.prediction && F.prediction.complete ? F.prediction.gap : null,
      jol_gap: F.jol_gap, review_at: F.review_at, used: F.used,
      explainable: f.explainable || '', struggled: f.struggled || '', evidence: f.evidence || '', strategy: f.strategy || '',
      change: String(f.change || '').trim(), at: Date.now()
    };
  };

  // ------------------------------------------------------------------ study reflection (E1–E4)
  U.finalFacts = function (et) {
    var pr = et.progress, fin = et.package.final_test;
    var ans = fin.map(function (q) { return pr.answers[q.q_id]; }).filter(Boolean);
    var correct = ans.filter(function (a) { return a.correct; }).length;
    var over = Object.keys(pr.jol || {}).map(function (kid) { var j = pr.jol[kid]; return j && j.actual != null ? { kid: kid, gap: j.jol - j.actual } : null; })
      .filter(function (x) { return x && x.gap > 0.2; }).sort(function (a, b) { return b.gap - a.gap; }).slice(0, 3)
      .map(function (x) { var k = KEtut.findKazanim(et.package, x.kid); return (k ? k.title : x.kid) + ' (JOL +' + Math.round(x.gap * 100) + ' points)'; });
    var preds = Object.keys(pr.predictions || {}).map(function (key) { return KMeta.predictionOutcome(et, key); }).filter(function (o) { return o && o.complete && o.id !== 'isabetli'; })
      .map(function (o) { return (o.key === 'final' ? 'Final test' : 'Part ' + (Number(o.key.split(':')[1]) + 1) + ' quiz') + ': ' + o.label.toLowerCase() + ' (' + (o.gap > 0 ? '+' : '') + Math.round(o.gap * 100) + ' points)'; });
    return { correct: correct, n: fin.length, ratio: fin.length ? correct / fin.length : 0, prediction: KMeta.predictionOutcome(et, 'final'), mispredicted: preds.concat(over) };
  };

  U.finalReviewHtml = function (et, lv) {
    var F = U.finalFacts(et), f = ui.form;
    if (f.mispredicted == null) f.mispredicted = F.mispredicted.join('\n');
    var suggest = F.ratio >= 0.75 ? 'evet' : F.ratio >= 0.5 ? 'kismen' : 'hayir';
    var yn = [{ v: 'evet', label: 'Yes' }, { v: 'kismen', label: 'Partly' }, { v: 'hayir', label: 'No' }];
    var strategies = ['Retrieval', 'Self-explanation', 'Generating examples', 'Worked example + practice', 'Second round', 'Explaining as if teaching'];
    return '<div class="kz-head"><div class="row"><span class="pill">Study reflection</span>' + U.levelChip(lv) + '</div><h2>' + esc(et.package.title) + '</h2></div>' +
      U.gapHtml(F.prediction, 'Final test: prediction and actual') +
      '<div class="panel stack">' +
      '<div class="field"><span><b>E1 · Did I reach my goal?</b> Final test ' + F.correct + '/' + F.n + ' (suggestion: ' + { evet: 'Yes', kismen: 'Partly', hayir: 'No' }[suggest] + ')</span>' +
      U.scale('goal_met', yn, f.goal_met) + '</div>' +
      (lv.level === 'minimal' ? '' : '<div class="field"><span><b>E2 · Which strategy worked?</b></span>' + U.scale('strategy', strategies.map(function (s) { return { v: s, label: s }; }), f.strategy, 'scale-wrap') + '</div>' +
        '<label class="field"><b>E3 · What did I mispredict?</b><textarea class="input" rows="3" data-f="mispredicted">' + esc(f.mispredicted) + '</textarea></label>') +
      '<label class="field"><b>E4 · How will I change my next study session?</b><textarea class="input" rows="2" data-f="change">' + esc(f.change || '') + '</textarea></label></div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="final-review-save" data-req="goal_met,change@5">Save the reflection and see results</button><span class="small muted req-hint"></span></div>';
  };
})(window);
