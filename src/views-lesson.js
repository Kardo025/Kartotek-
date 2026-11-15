/* Kartotek: End-of-Lesson Test tab — library, test runner, self-check, results and per-objective review calendar */
(function (global) {
  'use strict';
  var App = global.App, DSR = global.DSR, KEtut = global.KEtut, KLesson = global.KLesson, U = App.EtutUI;
  var esc = App.esc, pct = App.pct, dec = App.dec, fmtDays = App.fmtDays, fmtDate = App.fmtDate, toast = App.toast;
  var md = KEtut.renderMd, inl = U.inl;
  var DAY = DSR.DAY;
  var LETTERS = ['A', 'B', 'C', 'D'];
  var CONF = KEtut.CONFIDENCE_TR;
  var LV = KLesson.LEVELS;
  var TONE = { mastered: 'ok', learned: 'mid', partly: 'warn', not: 'bad' };
  var MARK = { mastered: '✓', learned: '✓', partly: '!', not: '!!' };
  var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  App.lessonOpen = null;

  // Transient screen state (not saved): typed text and selections
  var ui = { key: null, form: {}, shownAt: Date.now() };
  function resetUi(key) { ui = { key: key, form: {}, shownAt: Date.now() }; }

  function commit(ls, extra) { App.store.commit(Object.assign({ lessons: [ls.lesson_id] }, extra || {})); }
  function activeLessons() {
    var S = App.S;
    return Object.keys(S.lessons || {}).map(function (id) { return S.lessons[id]; })
      .filter(function (l) { return l && !l.removed && l.package; })
      .sort(function (a, b) { return (b.imported_at || 0) - (a.imported_at || 0); });
  }
  function levelBadge(level) {
    if (!level) return '<span class="muted">-</span>';
    return '<span class="lvl ' + TONE[level] + '"><i>' + MARK[level] + '</i>' + LV[level].label + '</span>';
  }
  function refsText(refs) { return (refs || []).map(esc).join(' · '); }
  function shortWhen(ts, now) {
    var S = App.S, h = S.settings.day_start_hour;
    var d = DSR.dayIndex(ts, h) - DSR.dayIndex(now, h);
    var time = new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (d <= 0) return 'today ' + time;
    if (d === 1) return 'tomorrow';
    return new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // ------------------------------------------------------------------ package loading
  function importFromObject(pkg, fromBundle) {
    var S = App.S, ex = S.lessons && S.lessons[pkg.lesson_id];
    var r = KLesson.importLesson(S, pkg);
    if (r.errors.length) return r;
    App.store.commit({ meta: true, lessons: [pkg.lesson_id], cards: r.created.concat(r.updated) });
    if (!fromBundle) toast((ex && !ex.removed ? 'Lesson test updated: ' : 'Lesson test loaded: ') + pkg.title + ' · ' + KLesson.flatObjectives(pkg).length + ' objectives');
    return r;
  }
  App.importLessonObject = importFromObject;

  // Imports the lesson tests embedded in the bundled file (does not bring back deleted ones; updates to a new version)
  App.importBundledLessons = function () {
    var S = App.S;
    App.bundledLessons = global.KHost.list('lessons');
    App.bundledLessons.forEach(function (pkg) {
      if (!pkg || !pkg.lesson_id) return;
      var ex = S.lessons && S.lessons[pkg.lesson_id];
      if (ex && (ex.removed || (ex.package && ex.package.version === pkg.version && ex.package.created_at === pkg.created_at))) return;
      importFromObject(pkg, true);
    });
  };

  // ------------------------------------------------------------------ library
  function nextReviewAt(ls) {
    var S = App.S, best = null;
    Object.keys(ls.card_map).forEach(function (oid) {
      var m = S.mem[ls.card_map[oid]];
      if (m && !m.suspended && m.state !== 'new' && m.due_at && (best == null || m.due_at < best)) best = m.due_at;
    });
    return best;
  }
  function levelCounts(ls) {
    var c = { mastered: 0, learned: 0, partly: 0, not: 0, mis: 0 }, latest = KLesson.latestResults(ls);
    Object.keys(latest).forEach(function (oid) { c[latest[oid].level]++; if (latest[oid].misconception) c.mis++; });
    return c;
  }
  function statusLine(ls, now) {
    var pr = ls.progress, run = pr.run;
    if (pr.stage === 'run' && run) return (run.kind === 'retest' ? 'Re-test' : 'Test') + ' in progress · ' + (run.phase === 'check' ? 'self-check' : 'question ' + (run.i + 1) + '/' + run.order.length);
    if (!pr.tested_at) return 'Not taken yet';
    var next = nextReviewAt(ls);
    return 'Tested ' + fmtDate(pr.tested_at) + (next ? ' · next review ' + fmtDate(next) + (next > now ? ' (in ' + fmtDays((next - now) / DAY) + ')' : ' (due now)') : '');
  }
  function sourcesText(pkg) {
    return (pkg.sources || []).map(function (s) { return esc(s.file || '') + (s.type ? ' <span class="muted">(' + esc(s.type) + ')</span>' : ''); }).join(' · ') || 'sources not given';
  }

  function libraryHtml() {
    var now = Date.now(), list = activeLessons();
    var body = list.map(function (ls) {
      var pkg = ls.package, c = KLesson.countItems(pkg), pr = ls.progress;
      var due = KLesson.dueObjectives(App.S, ls, now).length, lc = levelCounts(ls);
      var primary = pr.stage === 'run' ? 'Continue' : pr.tested_at ? 'See results and calendar' : 'Start the test';
      return '<div class="panel etut-item">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start">' +
        '<div class="stack" style="gap:4px;min-width:0"><h2>' + esc(pkg.title) + '</h2>' +
        '<p class="small muted">' + (pkg.lesson_date ? 'Lesson ' + esc(pkg.lesson_date) + ' · ' : '') + sourcesText(pkg) + '</p>' +
        '<p class="small muted">' + pkg.parts.length + ' parts · ' + c.objectives + ' objectives · ' + c.questions + ' questions · about ' + c.minutes + ' min</p></div>' +
        '<div class="row">' +
        '<button class="btn primary" data-open="' + esc(ls.lesson_id) + '">' + primary + '</button>' +
        (due && pr.stage !== 'run' ? '<button class="btn" data-retest="' + esc(ls.lesson_id) + '">Re-test due (' + due + ')</button><button class="btn" data-cards="' + esc(ls.lesson_id) + '">Review cards (' + due + ')</button>' : '') +
        '<button class="btn small danger" data-del="' + esc(ls.lesson_id) + '">Delete</button></div></div>' +
        (pr.tested_at ? '<div class="row lvl-row">' + KLesson.LEVEL_ORDER.map(function (l) { return lc[l] ? '<span class="lvl ' + TONE[l] + '"><i></i><b class="lvl-n">' + lc[l] + '</b>' + LV[l].label + '</span>' : ''; }).join('') +
          (lc.mis ? '<span class="pill flag">' + lc.mis + ' misconception' + (lc.mis === 1 ? '' : 's') + '</span>' : '') + '</div>' : '') +
        '<p class="small muted">' + esc(statusLine(ls, now)) + '</p></div>';
    }).join('') || '<div class="panel empty-state"><h2>No lesson tests yet</h2>' +
      '<ol class="empty-steps"><li>Right after a lesson, send the transcript, the lecture notes or the slides. One source is enough; several are better.</li>' +
      '<li>The test is prepared from them: each objective of the lesson gets 2 to 4 questions.</li>' +
      '<li>Take it here. Every objective then gets its own review calendar.</li></ol>' +
      '<p class="small muted">A prepared lesson-test package (.json) can also be loaded with the button above.</p></div>';
    var removed = (App.bundledLessons || []).filter(function (pkg) { var e = App.S.lessons && App.S.lessons[pkg.lesson_id]; return e && e.removed; });
    if (removed.length) {
      body += '<div class="panel stack"><h3>Deleted lesson tests</h3>' + removed.map(function (pkg) {
        return '<div class="row" style="justify-content:space-between"><span>' + esc(pkg.title) + '</span><button class="btn small primary" data-restore="' + esc(pkg.lesson_id) + '">Add again</button></div>';
      }).join('') + '<p class="small muted">Adding a lesson test again starts it over; its objective cards and their review history are reused.</p></div>';
    }
    return '<div class="stack">' +
      '<div class="panel stack"><div class="row" style="justify-content:space-between">' +
      '<div class="stack" style="gap:4px"><h2>End-of-Lesson Test</h2><p class="small muted">Right after a lesson, measure every objective once: what you have fully learned and what you have not. Each objective then gets its own review calendar from the DSR algorithm, and you review it on the Review tab or re-test it here with new questions.</p></div>' +
      '<label class="btn">Load lesson test (.json)<input type="file" id="lesson-file" accept=".json,application/json" hidden></label></div>' +
      '<div id="lesson-errors"></div></div>' + body + '</div>';
  }

  function bindLibrary(root) {
    var S = App.S;
    root.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () { App.lessonOpen = b.dataset.open; resetUi(null); App.render(); window.scrollTo(0, 0); });
    });
    root.querySelectorAll('[data-retest]').forEach(function (b) {
      b.addEventListener('click', function () {
        var ls = S.lessons[b.dataset.retest];
        if (!KLesson.startRetest(S, ls, Date.now())) { toast('No objective is due for a re-test.'); return; }
        commit(ls); App.lessonOpen = ls.lesson_id; resetUi(null); App.render(); window.scrollTo(0, 0);
      });
    });
    root.querySelectorAll('[data-cards]').forEach(function (b) {
      b.addEventListener('click', function () { var ls = S.lessons[b.dataset.cards]; App.studyDeck = ls.deck_id; App.session.current = null; App.switchTab('study'); });
    });
    root.querySelectorAll('[data-restore]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.restore;
        var pkg = (App.bundledLessons || []).filter(function (p) { return p.lesson_id === id; })[0];
        if (!pkg) return;
        // Reuse the old objective cards (tagged with the lesson id, created in objective order) so no duplicates appear
        var deckId = 'lesson-' + id, objs = KLesson.flatObjectives(pkg);
        var old = Object.keys(S.cards).map(function (cid) { return S.cards[cid]; })
          .filter(function (c) { return c.deck_id === deckId && (c.tags || [])[0] === id; })
          .sort(function (a, c) { return a.created_at - c.created_at; });
        var map = {};
        if (old.length === objs.length) objs.forEach(function (o, i) { map[o.objective_id] = old[i].card_id; });
        S.lessons[id] = { lesson_id: id, card_map: map, deck_id: S.decks[deckId] ? deckId : null };
        var r = importFromObject(pkg, false);
        if (r.errors && r.errors.length) { toast('The lesson test could not be added: ' + r.errors[0]); return; }
        App.render();
      });
    });
    root.querySelectorAll('[data-del]').forEach(function (b) {
      App.armConfirm(b, 'Delete this lesson test? (cards are kept)', function () {
        var id = b.dataset.del;
        S.lessons[id] = { lesson_id: id, removed: true, removed_at: Date.now() };
        App.store.commit({ lessons: [id] });
        toast('Lesson test deleted; its objective cards remain in the Cards tab.');
        App.render();
      });
    });
    var file = root.querySelector('#lesson-file');
    file.addEventListener('change', function () {
      var f = file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var box = root.querySelector('#lesson-errors'), pkg;
        try { pkg = JSON.parse(reader.result); } catch (e) {
          box.innerHTML = '<p class="small"><span class="lvl bad"><i>!!</i>Error</span>The file could not be read as JSON: ' + esc(e.message) + '</p>';
          return;
        }
        var r = importFromObject(pkg, false);
        if (r.errors.length) {
          box.innerHTML = '<div class="small"><span class="lvl bad"><i>!!</i>Invalid package</span><ul>' + r.errors.slice(0, 12).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
          return;
        }
        App.render();
      };
      reader.readAsText(f);
    });
  }

  // ------------------------------------------------------------------ intro and self-assessment
  function introHtml(ls) {
    var pkg = ls.package, c = KLesson.countItems(pkg), pr = ls.progress;
    var rows = KLesson.flatObjectives(pkg).map(function (o) {
      var cur = ui.form['self:' + o.objective_id] != null ? ui.form['self:' + o.objective_id] : pr.self[o.objective_id];
      return '<tr><td class="front"><span class="obj-n">' + o.n + '</span>' + esc(o.title) + '</td><td>' +
        U.scale('self:' + o.objective_id, KLesson.SELF_TR.map(function (t, i) { return { v: i, label: t }; }), cur) + '</td></tr>';
    }).join('');
    return '<div class="kz-head">' +
      '<p class="small muted">' + (pkg.lesson_date ? 'Lesson ' + esc(pkg.lesson_date) + ' · ' : '') + sourcesText(pkg) + '</p></div>' +
      '<div class="panel stack"><h3>How the test works</h3><ul class="lesson-rules">' +
      '<li>Each of the ' + c.objectives + ' objectives is measured with 2–4 questions: first you <b>write from memory</b>, then you answer <b>multiple-choice</b> questions and say how sure you are.</li>' +
      '<li>No notes. <b>Solutions appear only at the end</b>, so one answer cannot give away the next.</li>' +
      '<li>Choose <b>Don’t know</b> rather than guessing: a lucky guess would hide a gap.</li>' +
      '<li>At the end you compare what you wrote with the model answers. Every objective then gets a level and its own DSR review calendar.</li></ul>' +
      '<p class="small muted">' + c.questions + ' questions · about ' + c.minutes + ' minutes</p></div>' +
      '<div class="panel stack"><h3>Before you start: how well do you think you learned each objective? (optional)</h3>' +
      '<p class="small muted">Your answers are compared with the result, so you can see where a feeling of knowing was misleading.</p>' +
      '<div class="table-wrap"><table class="data self-table"><tbody>' + rows + '</tbody></table></div></div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="start">Start the test</button><span class="small muted">You can skip the self-assessment.</span></div>';
  }

  // ------------------------------------------------------------------ test runner
  function itemHtml(ls) {
    var pkg = ls.package, run = ls.progress.run, it = run.order[run.i];
    var o = KLesson.findObjective(pkg, it.oid);
    var part = pkg.parts.filter(function (p) { return p.part_id === it.part_id; })[0];
    var n = run.order.length, last = run.i === n - 1;
    var head = '<div class="kz-head"><div class="row"><span class="pill">' + (run.kind === 'retest' ? 'Re-test' : 'Test') + ' · question ' + (run.i + 1) + '/' + n + '</span>' +
      '<span class="pill">' + (it.type === 'recall' ? 'write from memory' : 'multiple choice') + '</span></div>' +
      '<p class="small muted">Part ' + (pkg.parts.indexOf(part) + 1) + ': ' + esc(part.title) + '</p></div>' +
      '<div class="etut-progress" aria-label="Progress"><i style="width:' + (run.i / n * 100).toFixed(1) + '%"></i></div>';
    var nextLabel = last ? 'Finish and check my answers' : 'Next question';
    if (it.type === 'recall') {
      return head + '<div class="q-stem">' + md(o.recall.prompt) + '</div>' +
        '<label class="field">Write from memory, in your own words<textarea class="input" id="lesson-text" data-f="text" rows="7" placeholder="Everything you remember about it">' + esc(ui.form.text || '') + '</textarea></label>' +
        '<div class="row etut-actions"><button class="btn primary" data-act="next" data-req="text@3">' + nextLabel + '</button>' +
        '<button class="btn" data-act="cant">I can’t recall it</button><span class="small muted req-hint"></span></div>';
    }
    var q = KLesson.findItem(pkg, it.q_id).q;
    var opts = '<ol class="opts">' + q.options.map(function (op, i) {
      var on = String(ui.form.choice) === String(i);
      return '<li><button class="opt' + (on ? ' selected' : '') + '" data-set="choice" data-val="' + i + '" role="radio" aria-checked="' + on + '"><span class="letter">' + LETTERS[i] + '</span><span class="opt-body">' + inl(op) + '</span></button></li>';
    }).join('') + '</ol>';
    return head + '<div class="q-stem">' + md(q.stem) + '</div>' + opts +
      '<div class="row conf-row"><span class="small muted">How sure are you?</span>' +
      U.scale('conf', ['guess', 'unsure', 'sure'].map(function (c) { return { v: c, label: CONF[c] }; }), ui.form.conf) + '</div>' +
      '<div class="row etut-actions"><button class="btn primary" data-act="next" data-req="choice,conf">' + nextLabel + '</button>' +
      '<button class="btn" data-act="dontknow">Don’t know</button><span class="small muted req-hint"></span></div>';
  }

  function checkHtml(ls) {
    var pkg = ls.package, run = ls.progress.run;
    var blocks = run.order.filter(function (it) { return it.type === 'recall'; }).map(function (it) {
      var o = KLesson.findObjective(pkg, it.oid), a = run.answers[it.key] || {}, text = String(a.text || '').trim();
      var wrote = text.length >= 3;
      var kp = o.recall.key_points.map(function (p, i) {
        var name = 'kp:' + o.objective_id + ':' + i;
        return '<li><label><input type="checkbox" data-f="' + esc(name) + '"' + (ui.form[name] ? ' checked' : '') + (wrote ? '' : ' disabled') + '> ' + inl(p) + '</label></li>';
      }).join('');
      return '<div class="panel stack lesson-check"><div class="obj-title"><span class="obj-n">' + o.n + '</span>' + esc(o.title) + '</div>' +
        '<div class="small muted">' + md(o.recall.prompt) + '</div>' +
        '<div class="grid2"><div class="stack" style="gap:4px"><span class="small muted">Your answer</span>' + (wrote ? '<p class="user-answer">' + esc(text) + '</p>' : '<p class="muted">No answer, so this counts as not recalled.</p>') + '</div>' +
        '<div class="stack" style="gap:4px"><span class="small muted">Model answer</span>' + md(o.recall.model_answer) + '</div></div>' +
        '<p class="small muted">Tick the key points your answer really contains:</p><ul class="kp-check">' + kp + '</ul></div>';
    }).join('');
    return '<div class="kz-head"><h2>Compare what you wrote with the model answers</h2>' +
      '<p class="muted">Tick only what your answer actually says. A feeling of familiarity is not evidence. The multiple-choice answers are scored automatically.</p></div>' +
      blocks + '<div class="row etut-actions"><button class="btn primary" data-act="score">Score the test and plan my reviews</button></div>';
  }

  // ------------------------------------------------------------------ results and calendar
  function itemsSummary(r) {
    return (r.items || []).map(function (p) {
      if (p.type === 'recall') return '<span class="tl past">Recall ' + pct(p.coverage || 0) + '</span>';
      return '<span class="tl past ' + (p.wrong ? 'is-wrong' : 'is-right') + '">' + (p.wrong ? (p.misconception ? 'wrong, sure' : 'wrong') : 'right') + '</span>';
    }).join('');
  }

  function whyText(r, mem, now) {
    if (!r || r.error) return '';
    var parts = [LV[r.level].label + ' (' + pct(r.score) + ') → DSR rating ' + App.RATING_TR[r.rating]];
    if (r.state === 'review') parts.push('interval I = 9·S·(1/R* − 1) = ' + fmtDays(r.interval_days));
    else parts.push('learning step ' + fmtDays(r.interval_days));
    parts.push('S ' + fmtDays(r.S) + ' · D ' + dec(r.D, 2));
    if (mem && mem.last_reviewed_at && mem.last_reviewed_at > (r.at || 0)) parts.push('updated since by a later review');
    return parts.join(' · ');
  }

  function objectiveRow(ls, o, r, now, env) {
    var S = App.S, cid = ls.card_map[o.objective_id], mem = S.mem[cid], card = S.cards[cid];
    var plan = KLesson.projectSchedule(card, mem, env, { days: 60, max: 6 });
    var hist = KLesson.objectiveHistory(S, ls, o.objective_id);
    var flag = KLesson.selfFlag(ls.progress.self[o.objective_id], r && r.level);
    var R = mem && mem.last_reviewed_at && mem.state !== 'new' ? DSR.retrievability((now - mem.last_reviewed_at) / DAY, mem.stability_days) : null;
    var past = hist.map(function (h) {
      var label = h.kind === 'test' ? 'test' : h.kind === 'retest' ? 're-test' : h.kind;
      return '<span class="tl past" title="' + esc(fmtDate(h.at)) + '">' + esc(new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) + ' · ' + label + ' · ' + (h.level ? LV[h.level].label : App.RATING_TR[h.rating]) + '</span>';
    });
    var future = plan.map(function (p, i) {
      return '<span class="tl' + (i === 0 ? ' next' : '') + (p.overdue ? ' overdue' : '') + '" title="' + esc(fmtDate(p.at)) + '">' + (i === 0 ? 'next: ' : '') + esc(shortWhen(Math.max(p.at, now), now)) + (p.gap_days != null ? ' · ' + (i === 0 ? '' : '+') + fmtDays(p.gap_days) : '') + '</span>';
    });
    var weak = r && (r.level === 'partly' || r.level === 'not');
    return '<div class="panel stack lesson-obj" id="obj-' + esc(o.objective_id) + '">' +
      '<div class="row" style="justify-content:space-between;align-items:flex-start">' +
      '<div class="stack" style="gap:2px;min-width:0"><div class="obj-title"><span class="obj-n">' + o.n + '</span>' + esc(o.title) + '</div>' +
      (o.refs && o.refs.length ? '<p class="small muted">' + refsText(o.refs) + '</p>' : '') + '</div>' +
      '<div class="row" style="gap:6px">' + levelBadge(r && r.level) + (r ? '<span class="pill">' + pct(r.score) + '</span>' : '') +
      (r && r.misconception ? '<span class="pill flag">misconception</span>' : '') +
      (flag ? '<span class="lvl ' + flag.tone + '"><i>' + (flag.tone === 'ok' ? '✓' : '!') + '</i>' + esc(flag.text) + '</span>' : '') + '</div></div>' +
      (r ? '<div class="timeline"><span class="small muted">Answers:</span>' + itemsSummary(r) + '</div>' : '') +
      '<p class="small"><b>Next review:</b> ' + (mem && mem.due_at && !mem.suspended ? esc(fmtDate(mem.due_at)) + (mem.due_at > now ? ' <span class="muted">(in ' + fmtDays((mem.due_at - now) / DAY) + ')</span>' : ' <span class="muted">(due now)</span>') : '-') +
      (R != null ? ' · <span class="muted">R now ' + dec(R, 2) + '</span>' : '') + '</p>' +
      (r ? '<p class="small muted">Why: ' + esc(whyText(r, mem, now)) + '</p>' : '') +
      '<div class="timeline">' + past.concat(future).join('<span class="tl-arrow" aria-hidden="true"></span>') + '</div>' +
      (plan.length ? '<p class="small muted">Planned dates assume each review succeeds (“Good”); a failed review brings the objective back sooner and the plan is recalculated.</p>' : '') +
      (weak ? '<p class="small"><b>Restudy first:</b> ' + (o.refs && o.refs.length ? refsText(o.refs) : 'the part of the lesson on this objective') + '</p>' : '') +
      '</div>';
  }

  function calendarHtml(ls, env, now) {
    var cal = KLesson.lessonCalendar(App.S, ls, env, 5);
    var any = cal.days.some(function (d) { return d.items.length; });
    if (!any) return '';
    var chip = function (it, withTitle) {
      return '<span class="cal-chip' + (it.next ? ' next' : '') + '" data-level="' + esc(it.level || '') + '" title="' + esc(it.n + ' · ' + it.title + (it.level ? ' · ' + LV[it.level].label : '')) + '">' + it.n + '</span>' +
        (withTitle ? '<span class="cal-obj-title">' + esc(it.title) + '</span>' : '');
    };
    var grid = WEEKDAYS.map(function (w) { return '<div class="cal-wd">' + w + '</div>'; }).join('') + cal.days.map(function (d) {
      var dt = new Date(d.at), label = dt.getDate() === 1 || d === cal.days[0] ? dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : String(dt.getDate());
      return '<div class="cal-day' + (d.today ? ' today' : '') + (d.past ? ' past' : '') + '" style="--i:' + cal.days.indexOf(d) + '"><span class="cal-date">' + esc(label) + (d.today ? ' · today' : '') + '</span>' +
        '<div class="cal-items">' + d.items.map(function (it) { return chip(it, false); }).join('') + '</div></div>';
    }).join('');
    var list = cal.days.filter(function (d) { return d.items.length && !d.past; }).map(function (d) {
      return '<li><span class="cal-when">' + esc(d.today ? 'Today' : new Date(d.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })) + '</span>' +
        '<span class="cal-objs">' + d.items.map(function (it) { return '<span class="cal-obj">' + chip(it, true) + '</span>'; }).join('') + '</span></li>';
    }).join('');
    return '<div class="panel stack"><h3>Review calendar · next 5 weeks</h3>' +
      '<div class="cal" role="img" aria-label="Planned objective reviews per day">' + grid + '</div><ol class="cal-list">' + list + '</ol>' +
      '<div class="legend">' + KLesson.LEVEL_ORDER.map(function (l) { return '<span><i class="cal-dot" data-level="' + l + '"></i>' + LV[l].label + '</span>'; }).join('') +
      '<span><i class="cal-dot next"></i>next review</span></div>' +
      '<p class="small muted">Numbers are objectives. Every planned review is computed by the DSR engine from the objective’s current memory state; reviewing on the Review tab or re-testing here updates the calendar.</p></div>';
  }

  function reviewDetailsHtml(ls) {
    var pkg = ls.package, runs = ls.progress.runs;
    if (!runs.length) return '';
    var run = runs[runs.length - 1];
    var body = run.objectives.map(function (oid) {
      var o = KLesson.findObjective(pkg, oid), r = run.results[oid] || {};
      var items = run.order.filter(function (it) { return it.oid === oid; }).map(function (it) {
        var a = run.answers[it.key] || {};
        if (it.type === 'recall') {
          var chk = run.checks[oid] || [];
          return '<div class="stack" style="gap:4px"><span class="small muted">Write from memory · ' + esc(o.recall.prompt) + '</span>' +
            '<p class="user-answer">' + (String(a.text || '').trim() ? esc(a.text) : '<span class="muted">No answer</span>') + '</p>' +
            '<div class="small"><b>Model answer:</b> ' + inl(o.recall.model_answer) + '</div>' +
            '<ul class="kp-check">' + o.recall.key_points.map(function (p, i) { return '<li class="' + (chk.indexOf(i) >= 0 ? 'kp-yes' : 'kp-no') + '">' + inl(p) + '</li>'; }).join('') + '</ul></div>';
        }
        var q = KLesson.findItem(pkg, it.q_id).q;
        var opts = '<ol class="opts">' + q.options.map(function (op, i) {
          var cls = 'opt' + (i === q.correct ? ' correct' : i === a.choice ? ' wrong' : ' dim');
          var note = q.distractor_notes && q.distractor_notes[i] ? '<span class="opt-note">' + inl(q.distractor_notes[i]) + '</span>' : '';
          var mark = i === q.correct ? '<span class="opt-mark">Correct answer</span>' : i === a.choice ? '<span class="opt-mark">Your choice</span>' : '';
          return '<li><button class="' + cls + '" disabled><span class="letter">' + LETTERS[i] + '</span><span class="opt-body">' + inl(op) + mark + note + '</span></button></li>';
        }).join('') + '</ol>';
        return '<div class="stack" style="gap:6px"><div class="q-stem small-stem">' + md(q.stem) + '</div>' + opts +
          '<p class="small">' + (a.dont_know ? 'You chose “Don’t know”.' : 'Your confidence: ' + esc(CONF[a.confidence] || '-') + (a.correct ? '' : a.confidence === 'sure' ? ' · wrong although sure: a sign of a misconception' : '')) + '</p>' +
          '<div class="small"><b>Solution:</b> ' + md(q.solution) + '</div></div>';
      }).join('<hr class="soft">');
      return '<details class="lesson-review"><summary><span class="obj-n">' + o.n + '</span>' + esc(o.title) + ' ' + levelBadge(r.level) + '</summary><div class="stack">' + items + '</div></details>';
    }).join('');
    return '<div class="panel stack"><h3>Answers and solutions · ' + (run.kind === 'retest' ? 're-test' : 'test') + ' of ' + esc(fmtDate(run.finished_at)) + '</h3>' + body + '</div>';
  }

  function resultsHtml(ls) {
    var S = App.S, pkg = ls.package, pr = ls.progress, now = Date.now(), env = U.env(now);
    var latest = KLesson.latestResults(ls), lc = levelCounts(ls);
    var objs = KLesson.flatObjectives(pkg);
    var last = pr.runs[pr.runs.length - 1];
    var due = KLesson.dueObjectives(S, ls, now);
    var partRows = pkg.parts.map(function (p) {
      var rs = p.objectives.map(function (o) { return latest[o.objective_id]; }).filter(Boolean);
      var f = rs.length ? rs.reduce(function (a, r) { return a + r.score; }, 0) / rs.length : 0;
      return '<div class="part-bar"><span>' + esc(p.title) + '</span><span class="bar"><i style="width:' + (f * 100).toFixed(0) + '%"></i></span><span class="num">' + pct(f) + '</span></div>';
    }).join('');
    var selfRows = objs.map(function (o) {
      var f = KLesson.selfFlag(pr.self[o.objective_id], latest[o.objective_id] && latest[o.objective_id].level);
      return f && f.tone === 'warn' ? '<li><span class="obj-n">' + o.n + '</span>' + esc(o.title) + ' · you said “' + esc(KLesson.SELF_TR[pr.self[o.objective_id]]) + '”, measured ' + esc(LV[latest[o.objective_id].level].label) + '</li>' : '';
    }).join('');
    var hasSelf = Object.keys(pr.self || {}).length > 0;
    var sorted = objs.slice().sort(function (a, b) {
      var ma = S.mem[ls.card_map[a.objective_id]], mb = S.mem[ls.card_map[b.objective_id]];
      return ((ma && ma.due_at) || Infinity) - ((mb && mb.due_at) || Infinity) || a.n - b.n;
    });
    return '<div class="kz-head"><h2>' + (last && last.kind === 'retest' ? 'Re-test results' : 'Test results') + '</h2>' +
      '<p class="small muted">' + (last ? (last.kind === 'retest' ? 'Re-test of ' + last.objectives.length + ' objective' + (last.objectives.length === 1 ? '' : 's') + ' · ' : 'Test · ') + esc(fmtDate(last.finished_at)) : '') + '</p></div>' +
      '<div class="kpis">' + KLesson.LEVEL_ORDER.map(function (l) {
        return '<div class="kpi"><div class="label">' + LV[l].label + '</div><div class="value">' + lc[l] + '</div><div class="sub">' + esc(LV[l].note) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="grid2"><div class="panel"><h3>Score by part</h3>' + partRows +
      (lc.mis ? '<p class="small" style="margin-top:8px"><span class="pill flag">' + lc.mis + ' misconception' + (lc.mis === 1 ? '' : 's') + '</span> A wrong answer given with “Sure” shows a wrong belief; restudy those objectives first.</p>' : '') + '</div>' +
      '<div class="panel stack"><h3>Your self-assessment</h3>' + (hasSelf ? (selfRows ? '<p class="small">You thought you knew these, but the test shows gaps:</p><ul class="small self-miss">' + selfRows + '</ul>' : '<p class="small">Your self-assessment matched the result, or you underestimated yourself.</p>') : '<p class="small muted">You skipped the self-assessment before the test.</p>') + '</div></div>' +
      calendarHtml(ls, env, now) +
      '<h3 style="margin-top:8px">Objectives · measurement and review plan</h3>' +
      sorted.map(function (o) { return objectiveRow(ls, o, latest[o.objective_id], now, env); }).join('') +
      reviewDetailsHtml(ls) +
      '<div class="row etut-actions">' +
      (due.length ? '<button class="btn primary" data-act="retest">Re-test due objectives (' + due.length + ')</button><button class="btn" data-act="review-cards">Review due objectives on the Review tab</button>' : '<button class="btn" data-act="review-cards">Open this lesson on the Review tab</button>') +
      '<button class="btn" data-act="library">Back to lesson tests</button></div>' +
      '<p class="small muted">Levels: ' + KLesson.LEVEL_ORDER.map(function (l) { return LV[l].label + ' = ' + LV[l].note + ' → ' + App.RATING_TR[LV[l].rating]; }).join(' · ') +
      '. Multiple choice counts 1 when correct and sure, 0.7 unsure, 0.4 guessed, 0 when wrong or “Don’t know”; writing from memory counts the share of key points.</p>';
  }

  // ------------------------------------------------------------------ main view
  App.views.lesson = function (root) {
    var S = App.S;
    var ls = App.lessonOpen && S.lessons && S.lessons[App.lessonOpen];
    if (!ls || ls.removed || !ls.package) {
      App.lessonOpen = null;
      root.innerHTML = libraryHtml();
      bindLibrary(root);
      return;
    }
    var pr = ls.progress, run = pr.run;
    var key = ls.lesson_id + ':' + pr.stage + ':' + (run ? run.run_id + ':' + run.phase + ':' + run.i : '');
    var fresh = ui.key !== key;   // a new screen (not a re-render of the same one) slides in
    if (fresh) resetUi(key);
    var body;
    if (pr.stage === 'run' && run) body = run.phase === 'check' ? checkHtml(ls) : itemHtml(ls);
    else if (pr.stage === 'results' || pr.runs.length) body = resultsHtml(ls);
    else body = introHtml(ls);
    root.innerHTML = '<div class="etut-head"><button class="btn small" data-act="library">‹ Lesson tests</button>' +
      '<div class="etut-title"><h2>' + esc(ls.package.title) + '</h2><p class="small muted">' + esc(statusLine(ls, Date.now())) + '</p></div></div>' +
      '<div class="etut-body lesson-body' + (fresh ? ' screen-enter' : '') + '">' + body + '</div>';
    bind(root, ls);
  };

  // Required fields: data-req="name,name@minLength"
  var REQ_TR = { text: 'your answer (at least 3 characters)', choice: 'option', conf: 'confidence' };
  function updateReq(root) {
    root.querySelectorAll('[data-req]').forEach(function (btn) {
      var missing = btn.dataset.req.split(',').filter(Boolean).filter(function (r) {
        var m = r.match(/^(.*)@(\d+)$/), name = m ? m[1] : r, min = m ? Number(m[2]) : 1, v = ui.form[name];
        return v == null || String(v).trim().length < min;
      }).map(function (r) { return REQ_TR[r.replace(/@\d+$/, '')] || r; });
      btn.disabled = missing.length > 0;
      var hint = btn.parentNode.querySelector('.req-hint');
      if (hint) hint.textContent = missing.length ? 'Missing: ' + missing.join(', ') : '';
    });
  }

  function bind(root, ls) {
    root.querySelectorAll('[data-act]').forEach(function (b) { b.addEventListener('click', function () { act(b.dataset.act, ls); }); });
    root.querySelectorAll('[data-f]').forEach(function (el) {
      var name = el.dataset.f;
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', function () {
        ui.form[name] = el.type === 'checkbox' ? el.checked : el.value;
        updateReq(root);
      });
    });
    root.querySelectorAll('[data-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        var name = b.dataset.set;
        ui.form[name] = b.dataset.val;
        root.querySelectorAll('[data-set="' + name + '"]').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('on', on);
          if (x.classList.contains('opt')) x.classList.toggle('selected', on);
          x.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        updateReq(root);
      });
    });
    var ta = root.querySelector('#lesson-text');
    if (ta) ta.focus();
    updateReq(root);
  }

  function saveAnswer(ls, ans) {
    var run = ls.progress.run, it = run.order[run.i];
    run.answers[it.key] = Object.assign({ type: it.type, ms: Date.now() - ui.shownAt, at: Date.now() }, ans);
    run.i += 1;
    if (run.i >= run.order.length) { run.i = run.order.length - 1; run.phase = 'check'; }
    commit(ls);
    App.render(); window.scrollTo(0, 0);
  }

  function act(a, ls) {
    var S = App.S, pr = ls.progress, run = pr.run;
    switch (a) {
      case 'library': App.lessonOpen = null; resetUi(null); App.render(); window.scrollTo(0, 0); return;
      case 'start': {
        Object.keys(ui.form).forEach(function (k) { if (/^self:/.test(k)) pr.self[k.slice(5)] = Number(ui.form[k]); });
        KLesson.startTest(ls, Date.now());
        commit(ls); App.render(); window.scrollTo(0, 0); return;
      }
      case 'next': {
        var it = run.order[run.i];
        if (it.type === 'recall') {
          if (String(ui.form.text || '').trim().length < 3) return;
          return saveAnswer(ls, { text: String(ui.form.text).trim() });
        }
        if (ui.form.choice == null || !ui.form.conf) return;
        var q = KLesson.findItem(ls.package, it.q_id).q, choice = Number(ui.form.choice);
        return saveAnswer(ls, { choice: choice, correct: choice === q.correct, confidence: ui.form.conf, dont_know: false });
      }
      case 'cant': return saveAnswer(ls, { text: '' });
      case 'dontknow': return saveAnswer(ls, { choice: null, correct: false, confidence: null, dont_know: true });
      case 'score': {
        run.objectives.forEach(function (oid) {
          var o = KLesson.findObjective(ls.package, oid);
          run.checks[oid] = o.recall.key_points.map(function (_, i) { return i; }).filter(function (i) { return !!ui.form['kp:' + oid + ':' + i]; });
        });
        var from = S.reviews.length;
        var res = KLesson.finishRun(S, ls, U.env(Date.now()));
        commit(ls, { cards: res.cards, reviewsFrom: from });
        var errs = res.run.objectives.filter(function (oid) { return res.run.results[oid].error; });
        if (errs.length) toast(res.run.results[errs[0]].error);
        else toast(res.cards.length + ' objective' + (res.cards.length === 1 ? '' : 's') + ' measured; the review calendar is ready.');
        App.render(); window.scrollTo(0, 0); return;
      }
      case 'retest': {
        if (!KLesson.startRetest(S, ls, Date.now())) { toast('No objective is due for a re-test.'); return; }
        commit(ls); App.render(); window.scrollTo(0, 0); return;
      }
      case 'review-cards': App.studyDeck = ls.deck_id; App.session.current = null; App.switchTab('study'); return;
      default: return;
    }
  }
})(window);
