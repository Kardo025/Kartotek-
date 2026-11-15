/* Kartotek: Study tab — library, SRL stage router and main screens */
(function (global) {
  'use strict';
  var App = global.App, DSR = global.DSR, KEtut = global.KEtut, KMeta = global.KMeta, U = App.EtutUI;
  var esc = App.esc, dec = App.dec, pct = App.pct, fmtDays = App.fmtDays, fmtDate = App.fmtDate, toast = App.toast;
  var md = KEtut.renderMd;
  var DAY = DSR.DAY;
  var LETTERS = ['A', 'B', 'C', 'D'];

  App.etutOpen = null;
  App.etutLibTab = 'etutler';

  function activeEtuts() { return KMeta.activeEtuts(App.S); }

  // ------------------------------------------------------------------ package loading
  function importFromObject(pkg, fromBundle) {
    var S = App.S;
    var ex = S.etuts && S.etuts[pkg.etut_id];
    var r = KEtut.importPackage(S, pkg);
    if (r.errors.length) return r;
    App.store.commit({ meta: true, etuts: [pkg.etut_id], cards: r.created.concat(r.updated) });
    if (!fromBundle) toast((ex && !ex.removed ? 'Study updated: ' : 'Study loaded: ') + pkg.title + ' · ' + KEtut.flatKazanimlar(pkg).length + ' objectives');
    return r;
  }

  // Imports the studies embedded in the bundled file (does not bring back deleted ones; updates to a new version)
  App.importBundledEtuts = function () {
    var S = App.S;
    Object.keys(S.etuts || {}).forEach(function (id) { var e = S.etuts[id]; if (e && e.progress) KEtut.migrateProgress(e.progress); });
    // The packages come from KHost (src/host.js): the content folder in the desktop app, the embedded tags in the browser page.
    // Only packages that passed the validators are in the list.
    var list = global.KHost.list('etuts');
    App.bundledEtuts = list;
    var KC = global.KCycle;
    (Array.isArray(list) ? list : []).forEach(function (pkg) {
      if (!pkg || !pkg.etut_id) return;
      var ex = S.etuts && S.etuts[pkg.etut_id];
      var v2 = !!(KC && KC.isV2(pkg));
      if (ex && ex.removed) return;
      // Study v2: the package lives in this HTML file; the saved state keeps only its version (02-impact §A4)
      if (v2 && KC.bundledMatches(ex, pkg)) { KC.attachPackage(ex, pkg); return; }
      if (ex && ex.package && ex.package.version === pkg.version && ex.package.created_at === pkg.created_at) {
        if (v2) { KC.attachPackage(ex, pkg); App.store.commit({ etuts: [pkg.etut_id] }); }
        return;
      }
      importFromObject(pkg, true);
      if (v2 && S.etuts[pkg.etut_id] && !S.etuts[pkg.etut_id].removed) { KC.attachPackage(S.etuts[pkg.etut_id], pkg); App.store.commit({ etuts: [pkg.etut_id] }); }
    });
    // Repair: a Study v2 package whose saved progress is a legacy record (left by the library's Restart before 2026-10-07)
    // gets a cycle progress; a record that holds answers is kept as archived progress by KCycle.migrate.
    if (KC) Object.keys(S.etuts || {}).forEach(function (id) {
      var e = S.etuts[id];
      if (!e || e.removed || !e.package || !KC.isV2(e.package) || !e.progress || e.progress.v === 'c2') return;
      e.progress = Object.keys(e.progress.answers || {}).length ? KC.migrate(e.progress) : KC.newProgress();
      App.store.commit({ etuts: [id] });
    });
    // A Study v2 package that is no longer in the content (deleted, renamed or broken): detach it from its saved record. The record,
    // its cards and its progress stay in the saved state and come back when the package does.
    var present = {};
    list.forEach(function (pkg) { present[pkg.etut_id] = true; });
    Object.keys(S.etuts || {}).forEach(function (id) {
      var e = S.etuts[id];
      if (e && e.pkg_ref && e.pkg_ref.bundled && !present[id] && e.package) e.package = undefined;
    });
    var extras = global.KHost.list('extras');
    App.studyExtras = KC ? KC.indexExtras(extras, function (id) { var e = S.etuts && S.etuts[id]; return e && !e.removed && e.package; }) : {};
  };

  // ------------------------------------------------------------------ progress summary
  function progressFraction(et) {
    var pkg = et.package, pr = et.progress, total = 0, done = 0;
    var order = KEtut.PART_STAGES;
    pkg.parts.forEach(function (p, i) {
      var units = order.length + p.kazanimlar.length + p.quiz.length;
      total += units;
      if (i < pr.part || ['final', 'final_review', 'done'].indexOf(pr.stage) >= 0) done += units;
      else if (i === pr.part) {
        var si = order.indexOf(pr.stage);
        done += Math.max(0, si);
        if (pr.stage === 'learn') done += pr.k;
        else if (si > order.indexOf('learn')) done += p.kazanimlar.length;
        if (pr.stage === 'quiz') done += pr.qi;
        else if (si > order.indexOf('quiz')) done += p.quiz.length;
      }
    });
    total += pkg.final_test.length + 1;
    if (pr.stage === 'final') done += pr.qi;
    if (pr.stage === 'final_review') done += pkg.final_test.length;
    if (pr.stage === 'done') done = total;
    return total ? Math.min(1, done / total) : 0;
  }

  function progressLabel(et) {
    var pr = et.progress, pkg = et.package;
    if (!pr.started_at) return 'Not started';
    if (pr.stage === 'done') return 'Completed';
    if (pr.stage === 'final' && pr.sub === 'predict' && pr.final_open_at && Date.now() < pr.final_open_at) return 'Final test · opens ' + fmtDate(pr.final_open_at);
    if (pr.stage === 'final') return 'Final test' + (pr.sub === 'q' ? ' · question ' + (pr.qi + 1) + '/' + pkg.final_test.length : '');
    if (pr.stage === 'final_review') return 'Study reflection';
    return 'Part ' + (pr.part + 1) + '/' + pkg.parts.length + ' · ' + KEtut.STAGE_TR[pr.stage];
  }

  function dueCount(et, now) {
    var S = App.S, tomorrow = DSR.dayStart(DSR.dayIndex(now, S.settings.day_start_hour) + 1, S.settings.day_start_hour);
    return Object.keys(et.card_map).filter(function (k) {
      var m = S.mem[et.card_map[k]];
      return m && !m.suspended && m.state !== 'new' && m.due_at && m.due_at < tomorrow;
    }).length;
  }

  // ------------------------------------------------------------------ library: studies, learning journal, error log
  function libTabs() {
    var tabs = [['etutler', 'Studies'], ['gunluk', 'My learning journal'], ['hatalar', 'My error log']];
    return '<div class="lib-tabs" role="tablist">' + tabs.map(function (t) {
      return '<button class="btn small' + (App.etutLibTab === t[0] ? ' on' : '') + '" data-lib="' + t[0] + '" role="tab" aria-selected="' + (App.etutLibTab === t[0]) + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }

  function libraryHtml() {
    var list = activeEtuts(), now = Date.now();
    var body;
    if (App.etutLibTab === 'gunluk') body = journalListHtml();
    else if (App.etutLibTab === 'hatalar') body = errorListHtml();
    else {
      body = (list.map(function (et) {
        var pkg = et.package, frac = progressFraction(et), src = pkg.source || {}, due = dueCount(et, now);
        return '<div class="panel etut-item">' +
          '<div class="row" style="justify-content:space-between;align-items:flex-start">' +
          '<div class="stack" style="gap:4px;min-width:0"><h2>' + esc(pkg.title) + (pkg.sample ? ' <span class="pill">sample</span>' : '') + '</h2>' +
          '<p class="small muted">' + esc(src.file || 'source not given') + (src.type ? ' · ' + esc(src.type.toUpperCase()) : '') + (src.slide_count ? ' · ' + src.slide_count + (src.unit === 'page' ? ' pages' : ' slides') : '') +
          ' · ' + pkg.parts.length + ' parts · ' + KEtut.flatKazanimlar(pkg).length + ' objectives · ' + (pkg.parts.reduce(function (a, p) { return a + p.quiz.length; }, 0) + pkg.final_test.length) + ' questions</p></div>' +
          '<div class="row">' +
          '<button class="btn primary" data-open="' + esc(et.etut_id) + '">' + (et.progress.started_at ? (et.progress.stage === 'done' ? 'See results' : 'Continue') : 'Start') + '</button>' +
          (due ? '<button class="btn" data-study="' + esc(et.etut_id) + '">' + due + ' objective review' + (due === 1 ? '' : 's') + '</button>' : '') +
          (et.progress.started_at ? '<button class="btn small" data-restart="' + esc(et.etut_id) + '">Restart</button>' : '') +
          '<button class="btn small danger" data-del="' + esc(et.etut_id) + '">Delete</button></div></div>' +
          '<div class="etut-progress" aria-label="Progress ' + Math.round(frac * 100) + '%"><i style="width:' + (frac * 100).toFixed(1) + '%"></i></div>' +
          '<p class="small muted">' + esc(progressLabel(et)) + '</p></div>';
      }).join('')) || '<div class="panel"><p class="muted">No studies yet. When you provide a slide deck, the prepared study appears here; or load a study package.</p></div>';
      var removed = (App.bundledEtuts || []).filter(function (pkg) { var e = App.S.etuts && App.S.etuts[pkg.etut_id]; return e && e.removed; });
      if (removed.length) {
        body += '<details class="panel stack removed-box"' + (App.pref('kartotek-removed-open') === '1' ? ' open' : '') + ' ontoggle="App.setPref(&quot;kartotek-removed-open&quot;, this.open ? &quot;1&quot; : &quot;0&quot;)"><summary><h3>Deleted studies (' + removed.length + ')</h3></summary>' + removed.map(function (pkg) {
          return '<div class="row" style="justify-content:space-between"><span>' + esc(pkg.title) + '</span><button class="btn small primary" data-restore="' + esc(pkg.etut_id) + '">Add again</button></div>';
        }).join('') + '<p class="small muted">Adding a study again starts it from part 1; its objective cards and their review history are reused.</p></details>';
      }
    }
    return '<div class="stack">' +
      '<div class="panel stack"><div class="row" style="justify-content:space-between">' +
      '<div class="stack" style="gap:4px"><h2>Studies</h2><p class="small muted">Each part is a self-regulation cycle: plan, learn and retrieve, test yourself, analyse your errors, reflect. Every answer is written to the objective’s DSR card.</p></div>' +
      '<label class="btn">Load study package (.json)<input type="file" id="etut-file" accept=".json,application/json" hidden></label></div>' +
      libTabs() + '<div id="etut-errors"></div></div>' + body + '</div>';
  }

  function journalListHtml() {
    var rows = [];
    activeEtuts().forEach(function (et) {
      Object.keys(et.progress.journal || {}).forEach(function (k) { rows.push({ et: et, part: Number(k), j: et.progress.journal[k] }); });
      if (et.progress.final_review) rows.push({ et: et, part: null, j: et.progress.final_review });
    });
    rows.sort(function (a, b) { return (b.j.at || 0) - (a.j.at || 0); });
    if (!rows.length) return '<div class="panel"><p class="muted">No journal entries yet. A learning journal is filled in at the end of each part (Rule 20).</p></div>';
    return rows.map(function (r) {
      var j = r.j, title = r.part == null ? 'Study reflection' : 'Part ' + (r.part + 1) + ': ' + (r.et.package.parts[r.part] || {}).title;
      var dl = r.part == null
        ? [['Did I reach my goal?', { evet: 'Yes', kismen: 'Partly', hayir: 'No' }[j.goal_met] || '-'], ['Strategy that worked', j.strategy], ['What did I mispredict?', j.mispredicted]]
        : [['Goal', j.goal], ['Performance', j.n ? j.correct + '/' + j.n + ' (criterion ' + j.criterion + ')' : '-'],
          ['Prediction gap', j.gap == null ? '-' : (j.gap > 0 ? '+' : '') + dec(j.gap * 100, 0) + ' points'],
          ['What I can explain without notes', j.explainable], ['What I struggled with', j.struggled], ['Evidence of the difficulty', j.evidence],
          ['Strategy that worked', j.strategy], ['Review date', j.review_at ? fmtDate(j.review_at) : '-']];
      return '<div class="panel journal-card"><div class="row" style="justify-content:space-between"><h3>' + esc(r.et.package.title) + ' · ' + esc(title) + '</h3><span class="small muted">' + fmtDate(j.at) + '</span></div>' +
        '<dl class="facts">' + dl.filter(function (x) { return x[1]; }).map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]).replace(/\n/g, '<br>') + '</dd></div>'; }).join('') + '</dl>' +
        '<p class="change-line"><b>The one thing I will change:</b> ' + esc(j.change || '-') + '</p></div>';
    }).join('');
  }

  function errorListHtml() {
    var log = KMeta.errorLog(App.S), dist = KMeta.errorDistribution(App.S).filter(function (d) { return d.count; });
    if (!log.length) return '<div class="panel"><p class="muted">No error entries yet. For wrong answers, the error type, its cause and your next step are collected here (Rule 11).</p></div>';
    var top = dist[0];
    return '<div class="panel stack"><h3>Error types</h3><div class="row">' + dist.map(function (d) { return '<span class="pill">' + esc(d.label) + ' · ' + d.count + '</span>'; }).join('') + '</div>' +
      '<div class="blk-box blk-callout" data-tone="ipucu"><span class="blk-label">Most frequent: ' + esc(top.label) + '</span><p>' + esc(top.action) + '</p></div></div>' +
      '<div class="table-wrap"><table class="data wrap"><thead><tr><th>Date</th><th>Study</th><th>Question</th><th>Type</th><th>Cause</th><th>Concrete step</th></tr></thead><tbody>' +
      log.map(function (x) {
        var e = x.answer.error;
        return '<tr><td>' + fmtDate(x.answer.at) + '</td><td>' + esc(x.etut) + '<br><span class="small muted">' + esc(x.where) + '</span></td><td>' + U.inl(x.stem) + '</td>' +
          '<td>' + esc((KMeta.ERROR_BY_ID[e.type] || {}).label || e.type) + '</td><td>' + esc(e.cause || '-') + '</td><td>' + esc(e.step || '-') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function bindLibrary(root) {
    var S = App.S;
    root.querySelectorAll('[data-lib]').forEach(function (b) { b.addEventListener('click', function () { App.etutLibTab = b.dataset.lib; App.render(); }); });
    root.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        App.etutOpen = b.dataset.open;
        var et = S.etuts[App.etutOpen];
        App.render(); window.scrollTo(0, 0);
      });
    });
    root.querySelectorAll('[data-study]').forEach(function (b) {
      b.addEventListener('click', function () { var et = S.etuts[b.dataset.study]; App.studyDeck = et.deck_id; App.session.current = null; App.switchTab('study'); });
    });
    root.querySelectorAll('[data-restore]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.restore;
        var pkg = (App.bundledEtuts || []).filter(function (p) { return p.etut_id === id; })[0];
        if (!pkg) return;
        // Reuse the old objective cards (tagged with the study id, created in objective order) so no duplicates appear
        var deckId = 'etut-' + id, kz = KEtut.flatKazanimlar(pkg);
        var old = Object.keys(S.cards).map(function (cid) { return S.cards[cid]; })
          .filter(function (c) { return c.deck_id === deckId && c.card_type === 'kazanim' && (c.tags || [])[0] === id; })
          .sort(function (a, c) { return a.created_at - c.created_at; });
        var map = {};
        if (old.length === kz.length) kz.forEach(function (k, i) { map[k.kazanim_id] = old[i].card_id; });
        S.etuts[id] = { etut_id: id, card_map: map, deck_id: S.decks[deckId] ? deckId : null };
        var r = importFromObject(pkg, false);
        if (r.errors && r.errors.length) { toast('The study could not be added: ' + r.errors[0]); return; }
        App.render();
      });
    });
    root.querySelectorAll('[data-restart]').forEach(function (b) {
      App.armConfirm(b, 'Restart from part 1?', function () {
        var et = S.etuts[b.dataset.restart];
        et.progress = KEtut.newProgress();
        App.store.commit({ etuts: [et.etut_id] });
        U.resetUi(null);
        toast('The study restarts from part 1; the DSR history was kept.');
        App.render();
      });
    });
    root.querySelectorAll('[data-del]').forEach(function (b) {
      App.armConfirm(b, 'Delete this study? (cards are kept)', function () {
        var id = b.dataset.del;
        S.etuts[id] = { etut_id: id, removed: true, removed_at: Date.now() };
        App.store.commit({ etuts: [id] });
        toast('Study deleted; its objective cards remain in the Cards tab.');
        App.render();
      });
    });
    var file = root.querySelector('#etut-file');
    file.addEventListener('change', function () {
      var f = file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var box = root.querySelector('#etut-errors'), pkg;
        try { pkg = JSON.parse(reader.result); } catch (e) {
          box.innerHTML = '<p class="small"><span class="lvl bad"><i>!!</i>Error</span>The file could not be read as JSON: ' + esc(e.message) + '</p>';
          return;
        }
        var r = importFromObject(pkg, false);
        if (r.errors.length) {
          box.innerHTML = '<div class="small"><span class="lvl bad"><i>!!</i>Invalid package</span><ul>' + r.errors.slice(0, 12).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
          return;
        }
        App.etutLibTab = 'etutler';
        App.render();
      };
      reader.readAsText(f);
    });
  }

  // ------------------------------------------------------------------ stage key and stepper
  function recallLoc(et) {
    var pr = et.progress;
    if (pr.stage === 'learn') {
      var k = KEtut.currentKazanim(et);
      return {
        k: k, phase: pr.sub, saved: pr.recalls[k.kazanim_id], round: null, label: 'Recall',
        setPhase: function (p) { pr.sub = p; }, save: function (r) { pr.recalls[k.kazanim_id] = r; },
        nextLabel: KEtut.currentPart(et).kazanimlar.length - 1 === pr.k ? 'Go to the quiz' : 'Next objective', key: 'rc:learn:' + pr.part + ':' + pr.k
      };
    }
    var box = (pr.stage === 'warmup' ? pr.warmup : pr.retry)[pr.part];
    var kid = box.kids[box.i], kz = KEtut.findKazanim(et.package, kid);
    return {
      k: kz, phase: box.sub, saved: box.results[kid], round: pr.stage,
      label: pr.stage === 'warmup' ? 'Warm-up ' + (box.i + 1) + '/' + box.kids.length + ' · from an earlier part' : 'Second round ' + (box.i + 1) + '/' + box.kids.length,
      setPhase: function (p) { box.sub = p; }, save: function (r) { box.results[kid] = r; },
      nextLabel: box.i + 1 < box.kids.length ? 'Next question' : 'Continue', key: 'rc:' + pr.stage + ':' + pr.part + ':' + box.i
    };
  }

  function viewKey(et) {
    var pr = et.progress;
    if (pr.stage === 'warmup' || pr.stage === 'retry' || (pr.stage === 'learn' && ['recall', 'check', 'rated'].indexOf(pr.sub) >= 0)) return recallLoc(et).key;
    return [pr.stage, pr.part, pr.k, pr.sub, pr.qi, pr.ei, pr.pi].join(':');
  }

  function stepper(et) {
    var pkg = et.package, pr = et.progress;
    var inFinal = ['final', 'final_review', 'done'].indexOf(pr.stage) >= 0;
    var parts = pkg.parts.map(function (p, i) {
      var st = inFinal || i < pr.part ? 'done' : i === pr.part ? 'current' : 'next';
      return '<li data-st="' + st + '"><span class="n">' + (st === 'done' ? '✓' : i + 1) + '</span>' + esc(p.title) + '</li>';
    });
    var fst = pr.stage === 'done' ? 'done' : inFinal ? 'current' : 'next';
    parts.push('<li data-st="' + fst + '"><span class="n">' + (fst === 'done' ? '✓' : 'T') + '</span>Final test</li>');
    var stages = '';
    if (!inFinal) {
      // The warm-up only appears in parts that have one; the second round belongs to Test
      var order = [['plan', 'Plan']];
      if (pr.stage === 'warmup' || pr.warmup[pr.part]) order.push(['warmup', 'Warm-up']);
      order.push(['priming', 'Priming'], ['learn', 'Learn'], ['quiz', 'Test'], ['teach', 'Teach'], ['journal', 'Reflect']);
      var ids = order.map(function (s) { return s[0]; });
      var cur = ids.indexOf(pr.stage === 'retry' ? 'quiz' : pr.stage);
      stages = '<ol class="etut-stages" aria-label="Part stages">' + order.map(function (s, i) {
        return '<li data-st="' + (i < cur ? 'done' : i === cur ? 'current' : 'next') + '">' + s[1] + '</li>';
      }).join('') + '</ol>';
    }
    return '<ol class="etut-parts" aria-label="Parts">' + parts.join('') + '</ol>' + stages;
  }

  // ------------------------------------------------------------------ learn
  function kazanimHead(et, k) {
    var pr = et.progress, part = KEtut.currentPart(et), kind = k.kind || 'kavram';
    return '<div class="kz-head"><div class="row"><span class="pill">Objective ' + (pr.k + 1) + '/' + part.kazanimlar.length + '</span>' +
      '<span class="pill kind-pill" title="' + esc(KEtut.KIND_STRATEGY[kind]) + '">' + esc(KEtut.KIND_TR[kind]) + '</span>' + U.slidesRef(k.slides) + '</div>' +
      '<h2>' + esc(k.title) + '</h2>' + (k.objective ? '<p class="muted">' + esc(k.objective) + '</p>' : '') + '</div>';
  }

  function learnHtml(et, lv) {
    var pr = et.progress, k = KEtut.currentKazanim(et);
    var head = kazanimHead(et, k);
    if (pr.sub === 'read') {
      var steps = KEtut.learnSteps(k), next = steps[1];
      var label = { practice: 'Go to practice', explain: 'Go to self-explanation', produce: 'Go to: ' + KEtut.PRODUCE_TR[k.kind || 'kavram'].toLowerCase(), jol: 'Get ready for recall' }[next] || 'Continue';
      return head + '<div class="kz-blocks">' + k.blocks.map(U.blockHtml).join('') + '</div>' +
        '<div class="row etut-actions"><button class="btn primary" data-act="next-sub">' + esc(label) + '</button>' +
        '<span class="small muted">The lesson text is hidden on the recall screen; you will write the answer from memory.</span></div>';
    }
    if (pr.sub === 'practice') return head + U.practiceHtml(et, k);
    if (pr.sub === 'explain') return head + U.explainHtml(et, k, lv);
    if (pr.sub === 'produce') return head + U.produceHtml(et, k);
    if (pr.sub === 'jol') return head + U.jolHtml(et, k);
    return head + U.recallHtml(et, recallLoc(et));
  }

  function roundHtml(et) {
    var pr = et.progress, loc = recallLoc(et);
    var intro = pr.stage === 'warmup'
      ? '<p class="small muted">Before starting the new part, retrieve without notes the objectives from earlier parts that are most at risk of being forgotten (Rules 15–16).</p>'
      : '<p class="small muted">Before you explain the part as if teaching it, retrieve again without notes the objectives you struggled with or got wrong in the quiz (Rules 9, 13).</p>';
    return '<div class="kz-head"><span class="pill">' + esc(KEtut.STAGE_TR[pr.stage]) + '</span><h2>' + esc(loc.k.title) + '</h2>' + intro + '</div>' + U.recallHtml(et, loc);
  }

  // ------------------------------------------------------------------ quiz and final test
  function currentQuestion(et) {
    var pr = et.progress, pkg = et.package;
    if (pr.stage === 'quiz') { var qs = pkg.parts[pr.part].quiz; return { q: qs[pr.qi], n: qs.length }; }
    var byId = {};
    pkg.final_test.forEach(function (q) { byId[q.q_id] = q; });
    return { q: byId[pr.final_order[pr.qi]], n: pr.final_order.length };
  }

  function questionHtml(et, lv) {
    var pr = et.progress, ui = U.getUi();
    var isFinal = pr.stage === 'final';
    if (pr.sub === 'predict') {
      ui.errorOpen = false;
      var n = isFinal ? et.package.final_test.length : et.package.parts[pr.part].quiz.length;
      var top = '<div class="kz-head"><span class="pill">' + (isFinal ? 'Final test' : 'Part ' + (pr.part + 1) + ' quiz') + '</span><h2>' + (isFinal ? esc(et.package.title) : esc(KEtut.currentPart(et).title)) + '</h2></div>';
      // The final test is taken after a delay the student chooses, so it measures what lasts (spacing)
      if (isFinal && !pr.predictions.final) {
        if (pr.final_open_at == null) {
          if (ui.form.fdelay == null) ui.form.fdelay = '1';
          var days = [{ v: 1, label: 'Tomorrow' }, { v: 2, label: 'In 2 days' }, { v: 3, label: 'In 3 days' }, { v: 7, label: 'In a week' }, { v: 0, label: 'Now' }];
          return top + '<div class="panel stack"><h3>When will you take the final test?</h3>' +
            '<p>Right after studying, the material is still fresh, so the test would measure what you remember today. After a gap it measures what has stayed.</p>' +
            U.scale('fdelay', days, ui.form.fdelay) +
            '<p class="small muted">Until then, the objective reviews in Review keep the material active.</p></div>' +
            '<div class="row etut-actions"><button class="btn primary" data-act="final-plan" data-req="fdelay">Save</button></div>';
        }
        if (Date.now() < pr.final_open_at) {
          return top + '<div class="panel stack"><h3>The final test opens on ' + esc(fmtDate(pr.final_open_at)) + '</h3>' +
            '<p>Come back then and take it without looking at your notes first.</p></div>' +
            '<div class="row etut-actions"><button class="btn primary" data-act="study-cards">Open objective reviews in Review</button>' +
            '<button class="btn" data-act="final-now">Start now anyway</button></div>';
        }
      }
      return top + U.predictHtml(et, n, isFinal);
    }
    var cq = currentQuestion(et), q = cq.q;
    var k = KEtut.findKazanim(et.package, q.kazanim_id);
    var ans = pr.answers[q.q_id];
    var head = '<div class="kz-head"><div class="row"><span class="pill">' + (isFinal ? 'Final test' : 'Quiz') + ' · Question ' + (pr.qi + 1) + '/' + cq.n + '</span>' +
      (q.level ? '<span class="pill">' + esc(q.level) + '</span>' : '') + '</div>' +
      '<p class="small muted">Objective: ' + esc(k ? k.title : q.kazanim_id) + '</p></div>' +
      '<div class="q-stem">' + md(q.stem) + '</div>';
    var opts = '<ol class="opts">' + q.options.map(function (o, i) {
      var cls = 'opt';
      if (ans) cls += i === q.correct ? ' correct' : i === ans.choice ? ' wrong' : ' dim';
      else if (String(ui.form.choice) === String(i)) cls += ' selected';
      var note = ans && q.distractor_notes && q.distractor_notes[i] ? '<span class="opt-note">' + U.inl(q.distractor_notes[i]) + '</span>' : '';
      var mark = ans ? (i === q.correct ? '<span class="opt-mark">Correct answer</span>' : i === ans.choice ? '<span class="opt-mark">Your choice</span>' : '') : '';
      return '<li><button class="' + cls + '" data-set="choice" data-val="' + i + '"' + (ans ? ' disabled' : ' role="radio" aria-checked="' + (String(ui.form.choice) === String(i)) + '"') + '><span class="letter">' + LETTERS[i] + '</span><span class="opt-body">' + U.inl(o) + mark + note + '</span></button></li>';
    }).join('') + '</ol>';
    if (!ans) {
      ui.errorOpen = false;
      // Produce first, recognise second (Rule 8): the options open only after the student has written an answer
      if (!ui.form.attempted) {
        return head + '<label class="field">Your answer, and how you got it<textarea class="input" data-f="reason" rows="4" placeholder="Work it out before you see the options (at least 5 characters)">' + esc(ui.form.reason || '') + '</textarea></label>' +
          '<div class="row etut-actions"><button class="btn primary" data-act="q-attempt" data-req="reason@5">Show the options</button><span class="small muted req-hint"></span></div>';
      }
      return head + '<div class="panel"><h3>Your answer</h3><p class="user-answer">' + esc(ui.form.reason) + '</p></div>' + opts +
        '<div class="row conf-row"><span class="small muted">Which option matches your answer? How sure are you?</span>' +
        U.scale('conf', ['guess', 'unsure', 'sure'].map(function (c) { return { v: c, label: KEtut.CONFIDENCE_TR[c] }; }), ui.form.conf) + '</div>' +
        '<div class="row etut-actions"><button class="btn primary" data-act="answer" data-req="choice,reason@5,conf">Answer</button><span class="small muted req-hint"></span></div>';
    }
    ui.errorOpen = !ans.correct && !ans.error;
    var verdict = ans.correct
      ? '<span class="lvl ok"><i>✓</i>Correct</span>' + (ans.confidence !== 'sure' ? 'Correct, but you said “' + KEtut.CONFIDENCE_TR[ans.confidence].toLowerCase() + '”; DSR counted it as “Hard”.' : '')
      : '<span class="lvl bad"><i>!!</i>Wrong</span>' + (ans.confidence === 'sure' ? 'Wrong although you were sure: this is a sign of a <b>misconception</b>.' : 'The correct answer and the solution are below.');
    var last = pr.qi === cq.n - 1;
    var nextLabel = last ? (isFinal ? 'Go to the study reflection' : 'Continue') : 'Next question';
    return head + '<p class="verdict">' + verdict + '</p>' + opts +
      '<div class="grid2 feedback">' +
      '<div class="panel"><h3>Your answer</h3><p class="user-answer">' + esc(ans.reason) + '</p><p class="small muted">Confidence: ' + KEtut.CONFIDENCE_TR[ans.confidence] + '</p></div>' +
      '<div class="panel"><h3>Solution</h3>' + md(q.solution) + '</div></div>' +
      (!ans.correct ? U.errorLogHtml(et, q, ans, lv, k) : '') +
      U.traceLine(ui.last && ui.last.q_id === q.q_id ? ui.last : null) +
      '<div class="row etut-actions"><button class="btn primary" data-act="next-q"' + (!ans.correct && !ans.error ? ' disabled title="Complete the error entry first"' : '') + '>' + nextLabel + '</button></div>';
  }

  // ------------------------------------------------------------------ summary and results
  function statusTable(et, kazanimlar, now) {
    return '<div class="table-wrap"><table class="data"><thead><tr><th>Objective</th><th>Recall</th><th class="num">Questions</th><th class="num">R now</th><th class="num">S</th><th>Next review</th><th>Status</th></tr></thead><tbody>' +
      kazanimlar.map(function (k) {
        var s = KEtut.kazanimStatus(App.S, et, k.kazanim_id, now);
        var lvl = s.level ? '<span class="lvl ' + s.level + '"><i>' + (s.level === 'ok' ? '✓' : s.level === 'warn' ? '!' : '!!') + '</i>' + KEtut.LEVEL_TR[s.level] + '</span>' : '<span class="muted">-</span>';
        if (s.misconception) lvl += '<br><span class="pill flag" style="margin-top:4px">misconception</span>';
        return '<tr><td class="front" title="' + esc(k.title) + '">' + esc(k.title) + '</td>' +
          '<td>' + (s.recall_rating ? App.RATING_TR[s.recall_rating] : '-') + '</td>' +
          '<td class="num">' + (s.answered ? s.correct + '/' + s.answered : '-') + '</td>' +
          '<td class="num">' + (s.R == null ? '-' : dec(s.R, 2)) + '</td>' +
          '<td class="num">' + (s.S == null ? '-' : fmtDays(s.S)) + '</td>' +
          '<td>' + (s.due_at ? fmtDate(s.due_at) + ' <span class="muted">(' + fmtDays((s.due_at - now) / DAY) + ')</span>' : '-') + '</td>' +
          '<td>' + lvl + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // Prior knowledge · JOL · actual comparison (metacognitive monitoring)
  function monitorTable(et, part) {
    var pr = et.progress;
    var rows = part.kazanimlar.map(function (k) {
      var prior = pr.prior[k.kazanim_id], j = pr.jol[k.kazanim_id] || {}, actual = j.actual;
      var flag = '';
      if (prior != null && prior >= 2 && actual != null && actual < 0.5) flag = '<span class="lvl warn"><i>!</i>thought you knew it, could not retrieve it</span>';
      else if (prior != null && prior <= 1 && actual != null && actual >= 0.75) flag = '<span class="lvl ok"><i>✓</i>better than you thought</span>';
      else if (j.jol != null && actual != null && Math.abs(j.jol - actual) > 0.3) flag = '<span class="lvl warn"><i>!</i>prediction ' + (j.jol > actual ? 'too optimistic' : 'too pessimistic') + '</span>';
      return '<tr><td class="front">' + esc(k.title) + '</td><td>' + (prior == null ? '-' : prior + ' · ' + U.PRIOR_TR[prior]) + '</td>' +
        '<td class="num">' + (j.jol == null ? '-' : pct(j.jol)) + '</td><td class="num">' + (actual == null ? '-' : pct(actual)) + '</td><td>' + (flag || '<span class="muted">-</span>') + '</td></tr>';
    }).join('');
    return '<div class="table-wrap"><table class="data"><thead><tr><th>Objective</th><th>Prior knowledge</th><th class="num">JOL</th><th class="num">Actual</th><th>Monitoring</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // The part's results, shown at the top of the learning journal: goal and criterion, the quiz prediction gap,
  // the Rule 13 diagnosis, the prior knowledge · JOL · actual comparison and the review plan
  function partResultsHtml(et) {
    var pr = et.progress, part = KEtut.currentPart(et), now = Date.now();
    var res = KEtut.partResult(et, pr.part), plan = pr.plans[pr.part];
    var pred = KMeta.predictionOutcome(et, 'quiz:' + pr.part);
    var goalBox = '<div class="panel stack"><h3>Goal</h3><p>' + esc(plan ? plan.goal : KEtut.autoGoal(part).text) + '</p>' +
      '<p><span class="lvl ' + (res.met ? 'ok"><i>✓</i>Criterion met' : 'warn"><i>!</i>Below the criterion') + '</span>Quiz ' + res.correct + '/' + res.n + ' · criterion ' + res.criterion + '</p>' +
      (pr.teach[pr.part] ? '<p class="small muted">In explaining as if teaching, ' + pct(pr.teach[pr.part].coverage) + ' of the rubric was covered.</p>' : '') + '</div>';
    var diag = '';
    if (!res.met) {
      diag = '<div class="panel stack"><h3>If the strategy did not work: Rule 13 diagnosis</h3><ol class="diag">' + KMeta.diagnose13(App.S, et, pr.part).map(function (d) {
        return '<li data-flag="' + (d.flag ? '1' : '0') + '"><span class="lvl ' + (d.flag ? 'warn"><i>!</i>' : 'ok"><i>✓</i>') + esc(d.q) + '</span> <span class="small">' + esc(d.note) + '</span>' +
          (d.flag && d.fix ? '<br><span class="small"><b>Suggestion:</b> ' + esc(d.fix) + '</span>' : '') + '</li>';
      }).join('') + '</ol></div>';
    }
    return '<section class="stack part-results"><div class="grid2">' + goalBox + U.gapHtml(pred, 'Quiz: prediction and actual (Rule 10)') + '</div>' + diag +
      '<h3>Prior knowledge, recall prediction and actual result</h3>' + monitorTable(et, part) +
      '<h3>Objectives and review plan</h3>' + statusTable(et, part.kazanimlar, now) + '</section>';
  }

  function resultsHtml(et) {
    var pkg = et.package, pr = et.progress, now = Date.now();
    var fin = pkg.final_test.map(function (q) { return pr.answers[q.q_id]; }).filter(Boolean);
    var ok = fin.filter(function (a) { return a.correct; }).length;
    var partRows = pkg.parts.map(function (p) {
      var ids = {};
      p.kazanimlar.forEach(function (k) { ids[k.kazanim_id] = true; });
      var qs = pkg.final_test.filter(function (q) { return ids[q.kazanim_id] && pr.answers[q.q_id]; });
      var c = qs.filter(function (q) { return pr.answers[q.q_id].correct; }).length;
      var f = qs.length ? c / qs.length : 0;
      return '<div class="part-bar"><span>' + esc(p.title) + '</span><span class="bar"><i style="width:' + (f * 100).toFixed(0) + '%"></i></span><span class="num">' + c + '/' + qs.length + '</span></div>';
    }).join('');
    var all = KEtut.flatKazanimlar(pkg).map(function (k) { return Object.assign({ st: KEtut.kazanimStatus(App.S, et, k.kazanim_id, now) }, k); });
    all.sort(function (a, b) { return (a.st.due_at || Infinity) - (b.st.due_at || Infinity); });
    var counts = { ok: 0, warn: 0, bad: 0 };
    all.forEach(function (k) { if (k.st.level) counts[k.st.level]++; });
    var errs = fin.filter(function (a) { return a.error; }).length + pkg.parts.reduce(function (s, p) { return s + p.quiz.filter(function (q) { return pr.answers[q.q_id] && pr.answers[q.q_id].error; }).length; }, 0);
    return '<div class="kz-head"><span class="pill">Study completed</span><h2>' + esc(pkg.title) + '</h2></div>' +
      '<div class="kpis">' +
      '<div class="kpi"><div class="label">Final test</div><div class="value">' + ok + '/' + fin.length + '</div><div class="sub">' + (fin.length ? pct(ok / fin.length) : '-') + ' correct</div></div>' +
      '<div class="kpi"><div class="label">Strong objectives</div><div class="value">' + counts.ok + '</div><div class="sub">interval about 3 days or more</div></div>' +
      '<div class="kpi"><div class="label">To reinforce</div><div class="value">' + counts.warn + '</div><div class="sub">review soon</div></div>' +
      '<div class="kpi"><div class="label">To study again</div><div class="value">' + counts.bad + '</div><div class="sub">error or misconception</div></div></div>' +
      '<div class="grid2">' + U.gapHtml(KMeta.predictionOutcome(et, 'final'), 'Final test: prediction and actual') +
      '<div class="panel"><h3>Final test · by part</h3>' + partRows + '</div></div>' +
      '<h3 style="margin-top:8px">Review plan per objective</h3>' + statusTable(et, all, now) +
      '<div class="row etut-actions"><button class="btn primary" data-act="study-cards">Open objective reviews in Review</button>' +
      '<button class="btn" data-act="open-journal">My learning journal</button>' +
      (errs ? '<button class="btn" data-act="open-errors">My error log (' + errs + ')</button>' : '') +
      '<button class="btn" data-act="restart">Restart the study</button></div>' +
      '<p class="small muted">Restarting only resets study progress; the DSR history and review plan are kept.</p>';
  }

  // ------------------------------------------------------------------ main view and routing
  function stageHtml(et, lv) {
    var st = et.progress.stage;
    if (st === 'plan') return U.planHtml(et, lv);
    if (st === 'warmup' || st === 'retry') return roundHtml(et);
    if (st === 'priming') return U.primingHtml(et, lv);
    if (st === 'learn') return learnHtml(et, lv);
    if (st === 'quiz' || st === 'final') return questionHtml(et, lv);
    if (st === 'teach') return U.teachHtml(et);
    if (st === 'journal') return U.journalHtml(et, lv, partResultsHtml(et));
    if (st === 'final_review') return U.finalReviewHtml(et, lv);
    return resultsHtml(et);
  }

  App.views.etut = function (root) {
    var S = App.S;
    var et = App.etutOpen && S.etuts && S.etuts[App.etutOpen];
    if (!et || et.removed || !et.package) {
      App.etutOpen = null;
      if (U.focusOn()) U.setFocus(false);
      root.innerHTML = libraryHtml();
      bindLibrary(root);
      return;
    }
    KEtut.migrateProgress(et.progress);
    U.refUnit = (et.package.source && et.package.source.unit) || 'slide';
    U.refOffset = (et.package.source && et.package.source.page_offset) || 0;
    if (!et.progress.started_at) { et.progress.started_at = Date.now(); U.commit(et); }
    var key = viewKey(et);
    var fresh = U.getUi().key !== key;   // a new screen (not a re-render of the same one) slides in
    if (fresh) U.resetUi(key);
    var lv = U.level();
    var body = stageHtml(et, lv);
    root.innerHTML = '<div class="etut-head"><button class="btn small" data-act="library">‹ Studies</button>' +
      '<div class="etut-title"><h2>' + esc(et.package.title) + '</h2><p class="small muted">' + esc(progressLabel(et)) + '</p></div>' +
      (et.progress.stage !== 'done' ? U.timerHtml(et) : '') +
      '<button class="btn small" data-act="focus-toggle">' + (U.focusOn() ? 'Exit focus' : 'Focus mode') + '</button></div>' +
      stepper(et) + '<div class="etut-body' + (fresh ? ' screen-enter' : '') + '">' + body + '</div>' + U.qlistDockHtml(et);
    bindRunner(root, et);
  };

  function advance() {
    App.render();
    window.scrollTo(0, 0);
  }

  // Required fields: data-req="name,name@minLength"
  var REQ_TR = { goal: 'goal', explain: 'explanation', produce: 'text', ptext: 'solution', pself: 'self-check', self: 'self-check', jol: 'prediction', predict: 'prediction',
    choice: 'option', reason: 'your answer (at least 5 characters)', fdelay: 'when', conf: 'confidence', errtype: 'error type', errcause: 'cause', errstep: 'concrete step',
    teach: 'explanation (at least 40 characters)', change: 'the one thing you will change', goal_met: 'answer to E1' };
  function updateReq(root) {
    var ui = U.getUi();
    root.querySelectorAll('[data-req]').forEach(function (btn) {
      var reqs = btn.dataset.req ? btn.dataset.req.split(',').filter(Boolean) : [];
      var missing = [];
      reqs.forEach(function (r) {
        var m = r.match(/^(.*)@(\d+)$/), name = m ? m[1] : r, min = m ? Number(m[2]) : 1;
        var v = ui.form[name];
        var bad = v == null || (typeof v === 'boolean' ? !v : String(v).trim().length < min);
        if (bad) { var label = /^prior:/.test(name) ? 'prior-knowledge ratings' : (REQ_TR[name] || name); if (missing.indexOf(label) < 0) missing.push(label); }
      });
      btn.disabled = missing.length > 0;
      var hint = btn.parentNode.querySelector('.req-hint');
      if (hint) hint.textContent = missing.length ? 'Missing: ' + missing.join(', ') : '';
    });
  }

  function bindRunner(root, et) {
    var ui = U.getUi();
    root.querySelectorAll('[data-act]').forEach(function (b) { b.addEventListener('click', function () { act(b.dataset.act, et); }); });
    root.querySelectorAll('[data-f]').forEach(function (el) {
      var name = el.dataset.f;
      if (el.type === 'checkbox') { if (ui.form[name] == null) ui.form[name] = el.checked; }
      else if (ui.form[name] == null && el.value) ui.form[name] = el.value;
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', function () {
        ui.form[name] = el.type === 'checkbox' ? el.checked : el.value;
        if (/^kp:/.test(name)) { var s = root.querySelector('#suggest'); if (s) s.innerHTML = U.suggestText(recallLoc(et).k.recall.key_points || []); }
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
        if (name === 'duration') { App.render(); return; }
        updateReq(root);
      });
    });
    root.querySelectorAll('[data-rc-rate]').forEach(function (b) { b.addEventListener('click', function () { rateRecall(et, b.dataset.rcRate); }); });
    U.bindQlist(root, et, function () { App.render(); });
    var ta = root.querySelector('#recall-text');
    if (ta) ta.focus();
    updateReq(root);
  }

  function rateRecall(et, rating) {
    var pr = et.progress, ui = U.getUi(), loc = recallLoc(et), k = loc.k;
    var kp = k.recall.key_points || [];
    var checked = U.checkedKp(kp);
    var r = U.record(et, k.kazanim_id, { signal: 'recall', rating: rating, response_time_ms: ui.form.ms || null, round: loc.round });
    if (!r) return;
    loc.save({ text: ui.form.draft || '', checked: checked, rating: rating, ms: ui.form.ms || null, at: Date.now() });
    if (pr.stage === 'learn') {
      var coverage = kp.length ? checked.length / kp.length : (rating === 'again' ? 0 : 1);
      pr.jol[k.kazanim_id] = Object.assign(pr.jol[k.kazanim_id] || {}, { actual: coverage });
    }
    loc.setPhase('rated');
    ui.last = r;
    U.commit(et);
    App.render();
  }

  function answerQuestion(et) {
    var pr = et.progress, ui = U.getUi(), q = currentQuestion(et).q;
    var choice = Number(ui.form.choice);
    if (ui.form.choice == null || String(ui.form.reason || '').trim().length < 5 || !ui.form.conf) return;
    var correct = choice === q.correct;
    var r = U.record(et, q.kazanim_id, { signal: pr.stage === 'final' ? 'final' : 'quiz', correct: correct, confidence: ui.form.conf, question_id: q.q_id });
    pr.answers[q.q_id] = { choice: choice, correct: correct, confidence: ui.form.conf, reason: String(ui.form.reason).trim(), ms: Date.now() - ui.shownAt, at: Date.now(), stage: pr.stage };
    U.commit(et);
    ui.last = r ? Object.assign({ q_id: q.q_id }, r) : null;
    App.render();
  }

  function act(a, et) {
    var S = App.S, pr = et.progress, ui = U.getUi(), lv = U.level();
    var k = pr.stage === 'learn' ? KEtut.currentKazanim(et) : null;
    switch (a) {
      case 'library': App.etutOpen = null; U.setFocus(false); App.render(); return;
      case 'focus-toggle': U.setFocus(!U.focusOn()); App.render(); return;
      case 'plan-save': U.savePlan(et); KEtut.goNext(S, et); U.commit(et); return advance();
      case 'priming-next': KEtut.goNext(S, et); U.commit(et); return advance();
      case 'next-sub': KEtut.advanceLearn(S, et); U.commit(et); return advance();
      case 'practice-check': {
        var q = k.practice[pr.pi];
        pr.practice[q.q_id] = q.options
          ? { choice: Number(ui.form.choice), correct: Number(ui.form.choice) === q.correct, at: Date.now() }
          : { text: String(ui.form.ptext || ''), at: Date.now() };
        U.commit(et); App.render(); return;
      }
      case 'practice-next': {
        var pq = k.practice[pr.pi];
        if (!pq.options) pr.practice[pq.q_id].self = ui.form.pself;
        if (pr.pi + 1 < k.practice.length) pr.pi += 1; else KEtut.advanceLearn(S, et);
        U.commit(et); return advance();
      }
      case 'explain-reveal': case 'produce-check': case 'teach-check':
        ui.form.revealed = true; App.render(); return;
      case 'explain-skip': KEtut.advanceLearn(S, et); U.commit(et); return advance();
      case 'explain-next': {
        var list = pr.explains[k.kazanim_id] = pr.explains[k.kazanim_id] || [];
        list[pr.ei] = { text: String(ui.form.explain || ''), self: ui.form.self, at: Date.now() };
        if (pr.ei + 1 < KEtut.explainLimit(k, lv.level)) pr.ei += 1; else KEtut.advanceLearn(S, et);
        U.commit(et); return advance();
      }
      case 'produce-next': {
        var rub = k.produce.rubric, chk = rub.map(function (_, i) { return i; }).filter(function (i) { return !!ui.form['rb:' + i]; });
        pr.produce[k.kazanim_id] = { text: String(ui.form.produce || ''), checked: chk, coverage: chk.length / rub.length, at: Date.now() };
        KEtut.advanceLearn(S, et); U.commit(et); return advance();
      }
      case 'jol-save':
        pr.jol[k.kazanim_id] = Object.assign(pr.jol[k.kazanim_id] || {}, { jol: Number(ui.form.jol) / 100, at: Date.now() });
        KEtut.advanceLearn(S, et); U.commit(et); return advance();
      case 'rc-check': {
        var loc = recallLoc(et);
        var tx = document.getElementById('recall-text');
        if (tx) ui.form.draft = tx.value;
        ui.form.ms = Date.now() - ui.shownAt;
        loc.setPhase('check'); U.commit(et); App.render(); return;
      }
      case 'rc-next': {
        if (pr.stage === 'learn') KEtut.advanceLearn(S, et);
        else {
          var box = (pr.stage === 'warmup' ? pr.warmup : pr.retry)[pr.part];
          if (box.i + 1 < box.kids.length) { box.i += 1; box.sub = 'recall'; } else KEtut.goNext(S, et);
        }
        U.commit(et); return advance();
      }
      case 'predict-save': {
        var isFinal = pr.stage === 'final';
        var n = isFinal ? et.package.final_test.length : et.package.parts[pr.part].quiz.length;
        pr.predictions[isFinal ? 'final' : 'quiz:' + pr.part] = { predicted: Number(ui.form.predict), n: n, at: Date.now() };
        pr.sub = 'q'; pr.qi = 0; U.commit(et); return advance();
      }
      case 'q-attempt': if (String(ui.form.reason || '').trim().length >= 5) { ui.form.attempted = true; App.render(); } return;
      case 'answer': answerQuestion(et); return;
      case 'final-plan':
        pr.final_open_at = KEtut.finalOpenAt(Date.now(), Number(ui.form.fdelay), S.settings.day_start_hour);
        U.commit(et); return advance();
      case 'final-now': pr.final_open_at = Date.now(); U.commit(et); return advance();
      case 'error-save': {
        var cq = currentQuestion(et), ans = pr.answers[cq.q.q_id];
        ans.error = { type: ui.form.errtype, cause: String(ui.form.errcause || '').trim(), step: String(ui.form.errstep || '').trim(), at: Date.now() };
        ui.errorOpen = false; U.commit(et); App.render(); return;
      }
      case 'next-q': {
        var cur = currentQuestion(et), an = pr.answers[cur.q.q_id];
        if (!an || (!an.correct && !an.error)) return;
        if (pr.qi + 1 < cur.n) pr.qi += 1; else KEtut.goNext(S, et);
        U.commit(et); return advance();
      }
      case 'teach-save': {
        var part = KEtut.currentPart(et), rubric = U.teachRubric(part);
        var tchk = rubric.map(function (_, i) { return i; }).filter(function (i) { return !!ui.form['rb:' + i]; });
        pr.teach[pr.part] = { text: String(ui.form.teach || ''), checked: tchk, coverage: tchk.length / rubric.length, rubric: rubric, at: Date.now() };
        KEtut.goNext(S, et); U.commit(et); return advance();
      }
      case 'journal-save': U.saveJournal(et); KEtut.goNext(S, et); U.commit(et); return advance();
      case 'final-review-save': {
        var F = U.finalFacts(et);
        pr.final_review = { goal_met: ui.form.goal_met, strategy: ui.form.strategy || '', mispredicted: String(ui.form.mispredicted || ''), change: String(ui.form.change || '').trim(), correct: F.correct, n: F.n, at: Date.now() };
        KEtut.goNext(S, et); U.setFocus(false); U.commit(et); return advance();
      }
      case 'study-cards': App.studyDeck = et.deck_id; App.session.current = null; U.setFocus(false); App.switchTab('study'); return;
      case 'open-journal': App.etutOpen = null; App.etutLibTab = 'gunluk'; U.setFocus(false); return advance();
      case 'open-errors': App.etutOpen = null; App.etutLibTab = 'hatalar'; U.setFocus(false); return advance();
      case 'restart': {
        var fresh = KEtut.newProgress();
        fresh.started_at = Date.now();
        et.progress = fresh; U.commit(et); U.resetUi(null); App.render();
        toast('The study restarts; the DSR history was kept.');
        return;
      }
      default: return;
    }
  }

  // Keyboard: rate with 1–4 on the check screen
  document.addEventListener('keydown', function (e) {
    if (App.tab !== 'etut' || e.target.closest('input, textarea, select, .modal-back')) return;
    var btn = /^[1-4]$/.test(e.key) && document.querySelector('[data-rc-rate="' + DSR.RATING_ORDER[Number(e.key) - 1] + '"]');
    if (btn) { e.preventDefault(); btn.click(); }
  });
})(window);
