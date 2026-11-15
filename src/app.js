/* Kartotek: app core and review screen */
(function (global) {
  'use strict';
  var DSR = global.DSR, KStore = global.KStore;
  var DAY = DSR.DAY, MIN = DSR.MIN;

  // ------------------------------------------------------------------ formatting
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dec(x, d) { return x == null || isNaN(x) ? '-' : Number(x).toFixed(d == null ? 2 : d); }
  function pct(x, d) { return x == null || isNaN(x) ? '-' : (x * 100).toFixed(d == null ? 0 : d) + '%'; }
  function fmtDays(days) {
    if (days == null || isNaN(days)) return '-';
    var mins = days * 1440;
    if (mins < 60) return Math.max(1, Math.round(mins)) + ' min';
    if (days < 0.95) return dec(mins / 60, 1) + ' h';
    if (days < 10) return dec(days, 1) + ' d';
    if (days < 60) return Math.round(days) + ' d';
    if (days < 365) return dec(days / 30.44, 1) + ' mo';
    return dec(days / 365.25, 1) + ' y';
  }
  function fmtMs(ms) { return fmtDays(ms / DAY); }
  function fmtDate(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  var STATE_TR = { 'new': 'new', learning: 'learning', review: 'review', relearning: 'relearning' };
  var RATING_TR = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  // View preferences (small per-browser conveniences)
  function pref(key) { try { return global.localStorage.getItem(key); } catch (e) { return null; } }
  function setPref(key, val) { try { global.localStorage.setItem(key, val); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------------ app state
  var App = {
    store: new KStore.Store(),
    tab: 'study',
    views: {},
    studyDeck: '',
    // Exam sections (CEnT-S, TU Delft AE Prep): their own Review, Study and Cards tabs over the same cards and memory model
    scope: null, scopeDeck: {},
    session: { id: DSR.uid(), startedAt: Date.now(), current: null, last: null, undo: [], reviewed: 0, limitDismissed: false }
  };
  Object.defineProperty(App, 'S', { get: function () { return App.store.state; } });

  App.esc = esc; App.dec = dec; App.pct = pct; App.fmtDays = fmtDays; App.fmtMs = fmtMs; App.fmtDate = fmtDate;
  App.toast = toast; App.STATE_TR = STATE_TR; App.RATING_TR = RATING_TR; App.pref = pref; App.setPref = setPref;

  App.cardEvents = function (cardId) {
    return App.S.reviews.filter(function (e) { return e.card_id === cardId; });
  };

  App.medianFor = function (cardType) {
    var S = App.S, same = [], all = [];
    var idle = S.params.idle_response_ms;
    for (var i = S.reviews.length - 1; i >= 0 && all.length < 300; i--) {
      var e = S.reviews[i];
      if (e.response_time_ms == null || e.response_time_ms > idle) continue;
      all.push(e.response_time_ms);
      var c = S.cards[e.card_id];
      if (c && c.card_type === cardType && same.length < 200) same.push(e.response_time_ms);
    }
    if (same.length >= 5) return DSR.median(same);
    if (all.length >= 5) return DSR.median(all);
    return null;
  };

  App.loadByDay = function () {
    var S = App.S, h = S.settings.day_start_hour, map = {};
    Object.keys(S.mem).forEach(function (id) {
      var m = S.mem[id];
      if (m.state === 'review' && !m.suspended && m.due_at) {
        var d = DSR.dayIndex(m.due_at, h);
        map[d] = (map[d] || 0) + 1;
      }
    });
    return map;
  };

  App.env = function (now, extra) {
    return Object.assign({
      settings: App.S.settings, params: App.S.params, now: now || Date.now(),
      rng: Math.random, medianMs: null, loadByDay: null, sessionId: App.session.id,
      examDateOf: App.examDateOf
    }, extra || {});
  };

  // ------------------------------------------------------------------ exam dates and per-exam new-card budgets
  // Exams a deck belongs to (deck.exams, or the exams of its study / lesson test / placement test)
  App.examsOfDeck = function (deckId) {
    var S = App.S, K = global.KCents, dk = S.decks[deckId];
    if (!dk) return [];
    if (dk.exams && dk.exams.length) return dk.exams;
    var ref = dk.etut_id || (dk.lesson_id ? String(dk.lesson_id).replace(/-test$/, '') : null);
    var ls = dk.lesson_id && S.lessons && S.lessons[dk.lesson_id];
    if (ls && ls.package && ls.package.placement) return [ls.package.placement.exam];
    return ref && K ? K.examsOfEtut(ref) : [];
  };
  // The nearest upcoming exam date among the card's exams (each exam section keeps its own date)
  App.examDateOf = function (card) {
    var S = App.S, best = null, bestTs = null, now = Date.now();
    App.examsOfDeck(card.deck_id).forEach(function (x) {
      var d = S[x] && S[x].examDate, ts = DSR.parseExamDate(d);
      if (ts && ts > now && (bestTs == null || ts < bestTs)) { best = d; bestTs = ts; }
    });
    return best;
  };
  App.newLimits = function () {
    var lim = (App.S.settings && App.S.settings.exam_new_limits) || {}, out = {};
    App.EXAMS.forEach(function (x) { if (lim[x] != null && lim[x] !== '') out[x] = Number(lim[x]); });
    return out;
  };
  App.newGroupOf = function (deckId) {
    var lim = App.newLimits(), ex = App.examsOfDeck(deckId);
    for (var i = 0; i < ex.length; i++) if (lim[ex[i]] != null) return ex[i];
    return null;
  };

  // Backup reminder in local mode: ≥ 50 reviews outside the sample decks and a backup older than 7 days (or none)
  App.backupDue = function () {
    var S = App.S;
    if (App.store.mode === 'cloud') return false;
    var own = S.reviews.filter(function (e) { var d = S.decks[e.deck_id]; return !(d && d.sample); }).length;
    return own >= 50 && (!S.last_backup_at || Date.now() - S.last_backup_at > 7 * DAY);
  };
  App.backupText = function () {
    var b = App.S.last_backup_at;
    return b ? fmtDays((Date.now() - b) / DAY) + ' ago' : 'never';
  };
  App.updateChip = function () {
    var chip = document.getElementById('storage-status'), store = App.store;
    if (!chip || !App.S) return;
    chip.dataset.mode = store.mode;
    if (store.mode === 'file') {
      // Desktop app: data in files (task C3); the chip says whether the last save worked
      var bad = /failed|attention|not set up/.test(store.status);
      chip.innerHTML = '<span class="long">Files · </span>' + esc(store.status.replace(/^Files: /, ''));
      chip.dataset.warn = bad ? '1' : '';
      chip.title = 'Data is stored in files in the Kartotek data folder, with dated backups. Click for the Data panel.';
      return;
    }
    if (store.mode === 'cloud') {
      chip.textContent = store.status;
      chip.dataset.warn = '';
      chip.title = 'Data is stored in the private cloud space of your claude.ai account.';
      return;
    }
    chip.innerHTML = '<span class="long">This browser · </span>backup: ' + esc(App.backupText());
    chip.dataset.warn = App.backupDue() ? '1' : '';
    chip.title = 'Data is stored only in this browser. Click to make a backup.';
  };

  App.commitCards = function (ids, extra) {
    App.store.commit(Object.assign({ cards: ids }, extra || {}));
  };

  // Motion is decorative: it is skipped when the person asked the system for reduced motion
  App.motionOK = function () {
    try { return !global.matchMedia || !global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; }
  };
  // Replays an entrance animation class on an element that stays in the DOM
  App.replay = function (el, cls) {
    if (!el || !App.motionOK()) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  };
  // ------------------------------------------------------------------ exam sections
  // Tab ids: 'cents' / 'tud' (overview) and '<exam>-study' (Review), '<exam>-etut' (Study), '<exam>-cards' (Cards)
  App.EXAMS = ['cents', 'tud'];
  App.EXAM_TABS = [];
  App.EXAMS.forEach(function (x) { App.EXAM_TABS.push(x, x + '-study', x + '-etut', x + '-cards', x + '-mock'); });
  App.scopeOf = function (tab) {
    var m = /^(cents|tud)(?:-(study|etut|cards|mock))?$/.exec(tab || '');
    return m ? m[1] : null;
  };
  // The plain tab a scoped tab copies ('cents-etut' -> 'etut')
  App.baseTab = function (tab) {
    tab = tab == null ? App.tab : tab;
    var m = /^(cents|tud)-(study|etut|cards|mock)$/.exec(tab);
    return m ? m[2] : tab;
  };
  // Decks that belong to an exam: decks of its studies and lesson tests, and decks made inside its section
  App.examDecks = function (exam) {
    var S = App.S, K = global.KCents, out = [];
    Object.keys(S.decks).forEach(function (d) {
      if (App.examsOfDeck(d).indexOf(exam) >= 0) out.push(d);
    });
    return out;
  };
  App.etutInExam = function (et, exam) {
    var K = global.KCents, dk = et && App.S.decks[et.deck_id];
    if (dk && (dk.exams || []).indexOf(exam) >= 0) return true;
    return !!(et && K && K.examsOfEtut(et.etut_id).indexOf(exam) >= 0);
  };
  // The same state with only the exam's decks and cards (read-only view for the scoped tabs)
  App.scopedState = function (exam) {
    var S = App.S, ids = App.examDecks(exam), decks = {}, cards = {};
    ids.forEach(function (d) { decks[d] = S.decks[d]; });
    Object.keys(S.cards).forEach(function (id) { if (decks[S.cards[id].deck_id]) cards[id] = S.cards[id]; });
    return Object.assign({}, S, { decks: decks, cards: cards });
  };
  App.getDeck = function () {
    if (!App.scope) return App.studyDeck;
    var d = App.scopeDeck[App.scope] || '';
    return d && App.examDecks(App.scope).indexOf(d) >= 0 ? d : '';
  };
  App.setDeck = function (d) {
    if (App.scope) App.scopeDeck[App.scope] = d; else App.studyDeck = d;
    App.session.current = null;
  };
  App.queueOpts = function () {
    var d = App.getDeck(), base = { newGroupOf: App.newGroupOf, newLimits: App.newLimits() };
    if (d) return Object.assign(base, { deckId: d });
    if (App.scope) {
      var ts = DSR.parseExamDate(App.S[App.scope] && App.S[App.scope].examDate);
      return Object.assign(base, { deckIds: App.examDecks(App.scope), scopeKey: App.scope, examTs: ts || DSR.examTimestamp(App.S.settings) });
    }
    return Object.assign(base, { deckId: null });
  };
  App.inQueueFilter = function (deckId) {
    var o = App.queueOpts();
    return o.deckId ? deckId === o.deckId : o.deckIds ? o.deckIds.indexOf(deckId) >= 0 : true;
  };
  // Review the cards of one deck: inside the current exam section when the deck belongs to it
  App.goReview = function (deckId) {
    var x = App.scope && App.examDecks(App.scope).indexOf(deckId) >= 0 ? App.scope : null;
    if (x) App.scopeDeck[x] = deckId; else App.studyDeck = deckId;
    App.session.current = null;
    App.switchTab(x ? x + '-study' : 'study');
  };
  App.goStudy = function (etutId) {
    App.etutOpen = etutId;
    App.switchTab(App.scope ? App.scope + '-etut' : 'etut');
  };
  App.goLesson = function (lessonId) { App.lessonOpen = lessonId; App.switchTab('lesson'); };
  App.goMock = function (exam, mockId) { App.mockOpen = mockId || null; App.switchTab(exam + '-mock'); };

  // ------------------------------------------------------------------ mock exams (MOCK-RULES.md)
  App.importMockObject = function (pkg, fromBundle) {
    var S = App.S, ex = S.mocks && S.mocks[pkg.mock_id];
    var r = global.KMock.importMock(S, pkg, Date.now());
    if (r.errors.length) return r;
    App.store.commit({ meta: true, mocks: [pkg.mock_id] });
    if (!fromBundle) toast((ex ? 'Mock exam updated: ' : 'Mock exam loaded: ') + pkg.title);
    return r;
  };
  App.importBundledMocks = function () {
    var S = App.S;
    if (!global.KMock) return;
    global.KHost.list('mocks').forEach(function (pkg) {
      if (!pkg || !pkg.mock_id) return;
      var ex = S.mocks && S.mocks[pkg.mock_id];
      if (ex && (ex.removed || (ex.package && ex.package.version === pkg.version && ex.package.created_at === pkg.created_at))) return;
      App.importMockObject(pkg, true);
    });
  };

  // ------------------------------------------------------------------ mind maps (MINDMAP-RULES.md, src/mindmap-core.js)
  // The reading (map.json) and AI reference maps stay in memory from the bundle; S.mindmaps keeps the learner's records.
  App.mindParse = {}; App.mindRef = {}; App.mindLocal = {};
  App.goMind = function (id) {
    App.mindOpen = id || null;
    App.switchTab('mindmaps');
    try { if (id && global.history && global.history.replaceState) global.history.replaceState(null, '', '#mindmaps/' + id); } catch (e) { /* ignore */ }
  };
  App.mindSave = function (id) { App.store.commit({ meta: true, mindmaps: id ? [id] : [] }); App.render(); };
  App.importBundledMindmaps = function () {
    var S = App.S, KM = global.KMind;
    if (!KM) return;
    var changed = [], problems = [];
    global.KHost.list('mindmaps').forEach(function (b) {
      var r = KM.importBundle(S, b, Date.now(), App.mindParse, App.mindRef);
      if (r.errors.length) problems.push(b.map_id + ': ' + r.errors[0]);
      if (r.changed) changed.push(r.id);
      var doc = S.mindmaps && S.mindmaps[r.id];
      r.toSchedule.forEach(function (aid) {
        var at = doc && doc.attempts.find(function (x) { return x.id === aid; });
        if (at) App.mindSchedule(doc, at);
      });
    });
    App.mindProblems = problems;
    global.KHost.setImportProblems('mindmap-import', problems.map(function (m) { return { level: 'error', kind: 'mind map', id: '', path: '', label: '', messages: [m] }; }));
    if (changed.length) App.store.commit({ meta: true, mindmaps: changed });
  };
  // DSR adapter (MINDMAP-RULES §9): only independent attempts reach memory; one review per attempt id
  App.mindSchedule = function (doc, attempt) {
    var S = App.S, KM = global.KMind, el = KM.eligibility(attempt);
    if (!el.eligible) {
      if (!el.done) attempt.scheduler = { status: 'not_sent', reason: el.reason, at: Date.now() };
      return el;
    }
    if (S.reviews.some(function (e) { return e.attempt_id === attempt.id; })) { attempt.scheduler = { status: 'sent', reason: 'already recorded', at: Date.now(), review_id: 'existing' }; return el; }
    var t = doc.targets.find(function (x) { return x.id === attempt.target_id; });
    if (!t || t.version !== attempt.target_version) { attempt.scheduler = { status: 'not_sent', reason: 'The target changed after this attempt', at: Date.now() }; return { eligible: false }; }
    var deckId = KM.deckIdFor(doc.map_id);
    if (!S.decks[deckId]) S.decks[deckId] = { deck_id: deckId, name: 'Mind maps · ' + doc.title, mindmap: doc.map_id, created_at: Date.now() };
    var cid = KM.cardIdFor(doc.map_id, t);
    if (!S.cards[cid]) {
      App.addCard({ card_id: cid, deck_id: deckId, front: t.prompt, back: t.rubric, tags: ['mindmap'], card_type: 'basic', importance: 3 });
      S.cards[cid].source = { mindmap: doc.map_id, target: t.id, version: t.version };
    }
    var card = S.cards[cid], mem = S.mem[cid], now = Date.now();
    var res = DSR.processReview(card, mem, { rating: el.rating, response_time_ms: Math.max(1000, (attempt.submitted_at || now) - attempt.started_at), hint_used: attempt.max_hint > 0 },
      App.env(now, { medianMs: App.medianFor(card.card_type), loadByDay: App.loadByDay(), cardEvents: App.cardEvents(cid) }));
    res.event.attempt_id = attempt.id; res.event.source = 'mindmap'; res.event.signal = 'mindmap_check';
    S.mem[cid] = res.mem;
    S.reviews.push(res.event);
    attempt.scheduler = { status: 'sent', rating: el.rating, card_id: cid, review_id: res.event.review_id, at: now };
    App.commitCards([cid], { reviewsFrom: S.reviews.length - 1, meta: true, mindmaps: [doc.map_id] });
    return el;
  };

  App.switchTab = function (tab) {
    var changed = App.tab !== tab;
    App.tab = tab;
    // A #hash that names another section would send a reload back there: keep it in step (no hashchange event)
    try {
      var h = (global.location.hash || '').slice(1);
      if (h && h.split('/')[0] !== tab && global.history && global.history.replaceState) global.history.replaceState(null, '', '#' + tab);
    } catch (e) { /* file:// or sandboxed frames may refuse; the hash is only a convenience */ }
    var scope = App.scopeOf(tab);
    if (scope !== App.scope) { App.scope = scope; App.session.current = null; }
    if (changed) App.replay(document.getElementById('tab-' + tab), 'tab-enter');
    // Focus mode only applies during a study session
    if (App.baseTab(tab) !== 'etut' && App.EtutUI && App.EtutUI.focusOn()) App.EtutUI.setFocus(false);
    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    });
    ['study', 'etut', 'lesson', 'cards', 'mindmaps', 'stats', 'settings', 'algo'].concat(App.EXAM_TABS).forEach(function (t) {
      var el = document.getElementById('tab-' + t);
      if (el) el.hidden = t !== tab;
    });
    App.render();
    try { global.localStorage.setItem('kartotek-tab', tab); } catch (e) { /* ignore */ }
  };

  App.render = function () {
    var S = App.S;
    // The banner is about the two simulated sample decks only (the bundled sample study is a normal study)
    var hasSample = !!(S.decks['sample-fr'] || S.decks['sample-srs']);
    document.getElementById('sample-banner').hidden = !hasSample || pref('kartotek-hide-sample') === '1';
    App.updateChip();
    var v = App.views[App.tab];
    var root = document.getElementById('tab-' + App.tab);
    if (v && root) v(root);
    App.listeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
  };
  // The React shell subscribes here to redraw after every state change
  App.listeners = [];
  App.subscribe = function (fn) { App.listeners.push(fn); return function () { App.listeners = App.listeners.filter(function (f) { return f !== fn; }); }; };

  App.removeSamples = function () {
    var S = App.S;
    var sampleDecks = Object.keys(S.decks).filter(function (d) { return S.decks[d].sample; });
    App.deleteDecks(sampleDecks);
    toast('Sample decks deleted');
  };

  App.deleteDecks = function (deckIds) {
    var S = App.S, chunks = {};
    Object.keys(S.cards).forEach(function (id) {
      if (deckIds.indexOf(S.cards[id].deck_id) >= 0) {
        chunks[S.cards[id].chunk] = true;
        delete S.cards[id]; delete S.mem[id];
      }
    });
    S.reviews = S.reviews.filter(function (e) { return deckIds.indexOf(e.deck_id) < 0; });
    deckIds.forEach(function (d) { delete S.decks[d]; });
    // A study whose deck is deleted is removed too (it cannot work without its cards)
    var removedEtuts = Object.keys(S.etuts || {}).filter(function (id) { return S.etuts[id] && deckIds.indexOf(S.etuts[id].deck_id) >= 0; });
    removedEtuts.forEach(function (id) { S.etuts[id] = { etut_id: id, removed: true, removed_at: Date.now() }; });
    if (removedEtuts.indexOf(App.etutOpen) >= 0) App.etutOpen = null;
    // The same for a lesson test
    var removedLessons = Object.keys(S.lessons || {}).filter(function (id) { return S.lessons[id] && deckIds.indexOf(S.lessons[id].deck_id) >= 0; });
    removedLessons.forEach(function (id) { S.lessons[id] = { lesson_id: id, removed: true, removed_at: Date.now() }; });
    if (removedLessons.indexOf(App.lessonOpen) >= 0) App.lessonOpen = null;
    if (deckIds.indexOf(App.studyDeck) >= 0) App.studyDeck = '';
    App.session.current = null; App.session.last = null; App.session.lastFiled = null; App.session.undo = [];
    App.store.commit({ meta: true, chunks: Object.keys(chunks), reviewsFrom: 0, etuts: removedEtuts, lessons: removedLessons });
    App.render();
  };

  App.deleteCards = function (ids) {
    var S = App.S, chunks = {};
    ids.forEach(function (id) {
      if (!S.cards[id]) return;
      chunks[S.cards[id].chunk] = true;
      delete S.cards[id]; delete S.mem[id];
    });
    S.reviews = S.reviews.filter(function (e) { return ids.indexOf(e.card_id) < 0; });
    if (App.session.current && ids.indexOf(App.session.current.card_id) >= 0) App.session.current = null;
    App.session.undo = App.session.undo.filter(function (u) { return ids.indexOf(u.card_id) < 0; });
    App.store.commit({ chunks: Object.keys(chunks), reviewsFrom: 0 });
  };

  App.setSuspended = function (id, flag) {
    App.S.mem[id].suspended = flag;
    if (App.session.current && App.session.current.card_id === id) App.session.current = null;
    App.commitCards([id]);
  };

  // ------------------------------------------------------------------ card editor dialog
  App.openEditor = function (cardId, focusField, onSave) {
    var S = App.S, c = S.cards[cardId];
    if (!c) return;
    var back = document.createElement('div');
    back.className = 'modal-back';
    var deckOpts = Object.keys(S.decks).map(function (d) {
      return '<option value="' + esc(d) + '"' + (d === c.deck_id ? ' selected' : '') + '>' + esc(S.decks[d].name) + '</option>';
    }).join('');
    back.innerHTML =
      '<form class="modal stack" id="edit-form">' +
      '<h2>Edit card</h2>' +
      '<label class="field">Deck<select id="ed-deck">' + deckOpts + '</select></label>' +
      '<label class="field">Front (question)<textarea id="ed-front" rows="2" required>' + esc(c.front) + '</textarea></label>' +
      '<label class="field">Back (a single expected answer)<textarea id="ed-back" rows="2" required>' + esc(c.back) + '</textarea></label>' +
      (c.options && c.options.length ? '<fieldset class="field"><legend>Options (mark the correct one)</legend>' + c.options.map(function (o, i) {
        return '<label class="row"><input type="radio" name="ed-ok" value="' + i + '"' + (i === c.correct ? ' checked' : '') + '> <input class="input" id="ed-o' + i + '" value="' + esc(o) + '" style="flex:1"></label>';
      }).join('') + '</fieldset>' : '') +
      '<label class="field">Hint<input id="ed-hint" value="' + esc(c.hint) + '"></label>' +
      '<label class="field">Explanation / example (shown after a miss)<textarea id="ed-expl" rows="2">' + esc(c.explanation) + '</textarea></label>' +
      '<div class="settings-grid">' +
      '<label class="field">Tags (comma-separated)<input id="ed-tags" value="' + esc((c.tags || []).join(', ')) + '"></label>' +
      '<label class="field">Importance (1–5)<input id="ed-imp" type="number" min="1" max="5" value="' + c.importance + '"></label>' +
      '</div>' +
      '<div class="row" style="justify-content:flex-end"><button type="button" class="btn" id="ed-cancel">Cancel</button><button class="btn primary">Save</button></div>' +
      '</form>';
    document.body.appendChild(back);
    var close = function () { back.remove(); };
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    back.querySelector('#ed-cancel').addEventListener('click', close);
    var f = back.querySelector('#ed-' + (focusField || 'front'));
    if (f) f.focus();
    back.querySelector('#edit-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var oldChunk = c.chunk;
      c.deck_id = back.querySelector('#ed-deck').value;
      c.front = back.querySelector('#ed-front').value.trim();
      c.back = back.querySelector('#ed-back').value.trim();
      c.hint = back.querySelector('#ed-hint').value.trim();
      if (c.options && c.options.length) {
        c.options = c.options.map(function (o, i) { var el = back.querySelector('#ed-o' + i); return el ? el.value.trim() || o : o; });
        var okEl = back.querySelector('input[name="ed-ok"]:checked');
        if (okEl) c.correct = Number(okEl.value);
        c.back = c.options[c.correct] || c.back;
      }
      c.explanation = back.querySelector('#ed-expl').value.trim();
      c.tags = back.querySelector('#ed-tags').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      c.importance = DSR.clip(1, 5, parseInt(back.querySelector('#ed-imp').value, 10) || 3);
      c.updated_at = Date.now();
      var m = S.mem[cardId];
      var flags = DSR.contentFlags(c, m, App.cardEvents(cardId), App.medianFor(c.card_type), Date.now());
      m.content_flags = flags; m.needs_content_review = flags.length > 0;
      App.S.reviews.forEach(function (ev) { if (ev.card_id === cardId) ev.deck_id = c.deck_id; });
      App.commitCards([cardId], { chunks: [oldChunk], reviewsFrom: 0 });
      close();
      toast('Card saved');
      if (onSave) onSave(); else App.render();
    });
  };

  // ------------------------------------------------------------------ review screen
  function deckName(id) { var d = App.S.decks[id]; return d ? d.name : '-'; }

  function pickCurrent(q) {
    var s = App.session;
    if (s.current) {
      var still = q.order.some(function (it) { return it.card_id === s.current.card_id; });
      var m = App.S.mem[s.current.card_id];
      if (still || (s.current.forced && m && !m.suspended)) return s.current;
    }
    var next = q.order[0];
    // enter: the card rises from the drawer only after a pointer rating; keyboard ratings show it at once
    s.current = next ? { card_id: next.card_id, shownAt: Date.now(), revealedAt: null, hintUsed: false, enter: !!s.enterNext } : null;
    s.enterNext = false;
    return s.current;
  }

  function memoryStrip(card, mem, now) {
    if (mem.state === 'new') return '<div class="memory-strip"><span>New card · D₀ <b>' + dec(mem.difficulty, 1) + '</b> · S₀ <b>' + fmtDays(mem.stability_days) + '</b></span></div>';
    var t = (now - mem.last_reviewed_at) / DAY;
    var R = DSR.retrievability(t, mem.stability_days);
    return '<div class="memory-strip">' +
      '<span>R now <b>' + dec(R, 3) + '</b></span>' +
      '<span>S <b>' + fmtDays(mem.stability_days) + '</b></span>' +
      '<span>D <b>' + dec(mem.difficulty, 2) + '</b></span>' +
      '<span>last review <b>' + fmtDays(t) + '</b> ago</span>' +
      '<span>success <b>' + (mem.total_reviews ? pct(mem.successful_reviews / mem.total_reviews) : '-') + '</b></span>' +
      '</div>';
  }

  function traceHtml(last) {
    if (!last) return '<p class="muted small">When you rate a card, every step of the D-S-R update appears here.</p>';
    var tr = last.trace, c = App.S.cards[last.card_id];
    var rows = [];
    rows.push(['Card', esc((c && c.front) || '-')]);
    rows.push(['Rating → y, q', RATING_TR[tr.rating] + ' → ' + tr.y + ' · ' + dec(tr.q, 1)]);
    rows.push(['State', STATE_TR[tr.from] + ' → ' + STATE_TR[tr.to]]);
    if (tr.R != null) {
      rows.push(['Elapsed time t', fmtDays(tr.t)]);
      rows.push(['Predicted R (at review)', dec(tr.R, 3)]);
    }
    rows.push(['Slowness score', dec(tr.slow, 2)]);
    rows.push(['Difficulty D', (tr.D_old == null ? 'D₀' : dec(tr.D_old, 2)) + ' → ' + dec(tr.D_new, 2)]);
    if (tr.kind === 'lapse') rows.push(['S · [f0 − f1(1−R)]', dec(tr.S_old, 2) + ' → ' + dec(tr.S_new, 2) + ' d']);
    else if (tr.kind === 'success') rows.push(['S · (1 + G·k)', dec(tr.S_old, 2) + ' → ' + dec(tr.S_new, 2) + ' d']);
    else rows.push(['S₀ (first view)', dec(tr.S_new, 2) + ' d']);
    if (tr.G != null) rows.push(['G · k (damping)', dec(tr.G, 3) + ' · ' + dec(tr.k, 3)]);
    if (tr.plan) {
      rows.push(['R* (effective target)', dec(tr.targetR, 2)]);
      tr.plan.steps.forEach(function (s) { rows.push([esc(s[0]), fmtDays(s[1])]); });
    } else if (tr.delayMin != null) {
      rows.push([tr.to === 'relearning' ? 'Relearning step' : 'Learning step', fmtDays(tr.delayMin / 1440)]);
    }
    rows.push(['Next review', fmtDate(tr.due_at)]);
    var html = '<table>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>';
    if (tr.notes.length) html += '<div class="note">' + tr.notes.map(esc).join('<br>') + '</div>';
    var pol = tr.y === 0 && (tr.from === 'review' || tr.from === 'relearning') ? DSR.lapsePolicy(tr.consecutive_lapses) : null;
    if (pol) {
      html += '<div class="policy"><span class="lvl ' + (pol.level >= 3 ? 'bad' : 'warn') + '"><i>' + (pol.level >= 3 ? '!!' : '!') + '</i>Consecutive misses ' + tr.consecutive_lapses + '</span>' + esc(pol.text);
      var btns = [];
      if (pol.level === 2) btns.push('<button class="btn small" data-act="edit-hint">Add hint</button>');
      if (pol.level >= 3) btns.push('<button class="btn small" data-act="edit">Edit / split card</button>');
      if (pol.level >= 4) btns.push('<button class="btn small danger" data-act="suspend">Suspend</button>');
      if (btns.length) html += '<div class="row">' + btns.join('') + '</div>';
      html += '</div>';
    }
    if (App.session.undo.length) html += '<div class="row" style="margin-top:10px"><button class="btn small" data-act="undo">Undo <kbd>Z</kbd></button></div>';
    return html;
  }

  // Priority components use the categorical palette; rating colours are used only for ratings
  var PART_COLORS = { risk: 'var(--s1)', overdue: 'var(--s2)', importance: 'var(--s3)', exam: 'var(--s4)', lapse: 'var(--s5)' };
  var PART_TR = { risk: 'forgetting risk', overdue: 'overdue', importance: 'importance', exam: 'exam', lapse: 'consecutive misses' };

  // Kardex signal: where a card's current interval sits on the edge rail (log scale; 0 = now, 1 = 60 days or more)
  App.signalPos = function (days) {
    var d = Number(days);
    if (!(d > 0)) return 0;
    return Math.min(1, Math.log(1 + d) / Math.log(61));
  };
  // Pressboard guide colour (1–6) for a deck: its position among the decks, or a stable hash of its id
  App.guideIndex = function (deckId, deckIds) {
    var i = deckIds ? deckIds.indexOf(deckId) : -1;
    if (i >= 0) return i % 6 + 1;
    var str = String(deckId == null ? '' : deckId), h = 0;
    for (var k = 0; k < str.length; k++) h = (h * 31 + str.charCodeAt(k)) >>> 0;
    return h % 6 + 1;
  };
  function guideHtml(deckId) {
    return '<span class="guide" data-g="' + App.guideIndex(deckId, Object.keys(App.S.decks)) + '" aria-hidden="true"></span>';
  }
  var RAIL_TICKS = [1, 7, 30].map(function (d) { return '<i class="tick" style="left:' + (App.signalPos(d) * 100).toFixed(1) + '%"></i>'; }).join('');
  function edgeHtml(cls, i, id, deckId, label, kind, pos, when, extra) {
    return '<li class="edge' + cls + '" style="--i:' + i + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + '>' + guideHtml(deckId) +
      '<span class="edge-label">' + label + '</span>' +
      '<span class="edge-rail" aria-hidden="true">' + RAIL_TICKS + '<span class="sig-track" style="--pos:' + pos.toFixed(3) + '"><i class="signal" data-kind="' + kind + '"></i></span></span>' +
      '<span class="edge-when">' + when + '</span>' + (extra || '') + '</li>';
  }

  // The drawer under the open card: the visible edges of the next cards and of the card just filed.
  // Question fronts stay hidden by default (avoids pre-exposure before answering).
  function drawerHtml(q) {
    var S = App.S, s = App.session, showFronts = pref('kartotek-queue-fronts') === '1';
    var curId = s.current && s.current.card_id;
    var items = q.order.filter(function (it) { return it.card_id !== curId; }).slice(0, 6);
    var maxP = Math.max.apply(null, q.dueReview.map(function (x) { return x.priority; }).concat([1]));
    var edges = items.map(function (it, i) {
      var c = S.cards[it.card_id], m = S.mem[it.card_id];
      var label = showFronts ? esc(c.front) : esc(deckName(c.deck_id));
      var when = it.kind === 'review' ? 'P ' + dec(it.priority, 1) : STATE_TR[it.kind];
      var bar = '';
      if (it.kind === 'review') {
        bar = '<div class="pbar" title="Priority components">' + Object.keys(it.parts).map(function (k) {
          var w = it.parts[k] / maxP * 100;
          return w > 0.3 ? '<i style="width:' + w.toFixed(1) + '%;background:' + PART_COLORS[k] + '" title="' + PART_TR[k] + ' ' + dec(it.parts[k], 1) + '"></i>' : '';
        }).join('') + '</div>';
      }
      return edgeHtml('', i, it.card_id, c.deck_id, label, m.state, App.signalPos(m.last_interval_days), when, bar);
    });
    s.edgeOrder = items.map(function (it) { return it.card_id; });
    var f = s.lastFiled, fc = f && S.cards[f.card_id], fm = f && S.mem[f.card_id];
    if (fc && fm) {
      edges.push(edgeHtml(' filed' + (f.animate ? ' just-filed' : ''), items.length, null, fc.deck_id,
        '<span class="muted">Filed</span> ' + esc(fc.front), fm.state, f.to, 'next in ' + fmtMs(Math.max(0, fm.due_at - Date.now()))));
    }
    var list = edges.length ? '<ol class="edge-stack">' + edges.join('') + '</ol>' : '';
    var empty = curId && !items.length ? '<p class="muted small">No more cards after this one.</p>' : '';
    var sigs = ['new', 'learning', 'review', 'relearning'].map(function (k) { return '<span><i class="signal" data-kind="' + k + '"></i>' + STATE_TR[k] + '</span>'; }).join('');
    var parts = Object.keys(PART_TR).map(function (k) { return '<span><i style="background:' + PART_COLORS[k] + '"></i>' + PART_TR[k] + '</span>'; }).join('');
    return '<section class="drawer" aria-label="Next cards">' + list + empty +
      '<div class="legend stack-legend">' + sigs + '<span class="muted">signal position: current interval, ticks at 1 day, 1 week, 1 month</span></div>' +
      '<div class="drawer-foot"><div class="legend">' + parts + '</div>' +
      '<label class="row small muted"><input type="checkbox" id="q-fronts"' + (showFronts ? ' checked' : '') + '> Show fronts</label></div></section>';
  }

  // Data for the React Review screen: the queue, the open card and what follows it
  App.reviewModel = function () {
    var S = App.S, now = Date.now(), s = App.session;
    var q = DSR.buildQueue(S, App.env(now), App.queueOpts());
    App.lastQueue = q;
    var cur = pickCurrent(q);
    var m = { q: q, now: now, cur: cur, card: null, mem: null, preview: null, R: null, upNext: [], over: false, tomorrowCount: 0 };
    if (cur) {
      m.card = S.cards[cur.card_id]; m.mem = S.mem[cur.card_id];
      if (cur.revealedAt) m.preview = DSR.previewIntervals(m.card, m.mem, App.env(now, { hintUsed: cur.hintUsed, medianMs: App.medianFor(m.card.card_type) }));
      if (m.mem.state !== 'new' && m.mem.last_reviewed_at) m.R = DSR.retrievability((now - m.mem.last_reviewed_at) / DAY, m.mem.stability_days);
    } else {
      var tomorrow = DSR.dayStart(DSR.dayIndex(now, S.settings.day_start_hour) + 1, S.settings.day_start_hour);
      m.tomorrowCount = Object.keys(S.mem).filter(function (id) {
        var mm = S.mem[id]; return mm.state === 'review' && !mm.suspended && mm.due_at >= tomorrow && mm.due_at < tomorrow + DAY &&
          App.inQueueFilter(S.cards[id].deck_id);
      }).length;
    }
    var curId = cur && cur.card_id;
    m.upNext = q.order.filter(function (it) { return it.card_id !== curId; }).slice(0, 5).map(function (it) {
      var c = S.cards[it.card_id], mm = S.mem[it.card_id];
      return { card_id: it.card_id, kind: it.kind, priority: it.priority, deck: deckName(c.deck_id), front: c.front, state: mm.state };
    });
    m.over = (now - s.startedAt) / MIN > S.settings.max_session_minutes && !s.limitDismissed;
    return m;
  };
  // The D-S-R update of the last rating as plain rows (no HTML)
  App.traceData = function (last) {
    if (!last) return null;
    var tr = last.trace, c = App.S.cards[last.card_id], rows = [];
    rows.push(['Card', (c && c.front) || '-']);
    rows.push(['Rating', RATING_TR[tr.rating] + ' (y ' + tr.y + ', q ' + dec(tr.q, 1) + ')']);
    rows.push(['State', STATE_TR[tr.from] + ' → ' + STATE_TR[tr.to]]);
    if (tr.R != null) { rows.push(['Elapsed time', fmtDays(tr.t)]); rows.push(['Predicted R', dec(tr.R, 3)]); }
    rows.push(['Slowness score', dec(tr.slow, 2)]);
    rows.push(['Difficulty', (tr.D_old == null ? 'D₀' : dec(tr.D_old, 2)) + ' → ' + dec(tr.D_new, 2)]);
    if (tr.kind === 'lapse' || tr.kind === 'success') rows.push(['Stability', dec(tr.S_old, 2) + ' → ' + dec(tr.S_new, 2) + ' d']);
    else rows.push(['Stability (first view)', dec(tr.S_new, 2) + ' d']);
    if (tr.G != null) rows.push(['Growth G · damping k', dec(tr.G, 3) + ' · ' + dec(tr.k, 3)]);
    if (tr.plan) { rows.push(['Effective target R*', dec(tr.targetR, 2)]); tr.plan.steps.forEach(function (st) { rows.push([st[0], fmtDays(st[1])]); }); }
    else if (tr.delayMin != null) rows.push([tr.to === 'relearning' ? 'Relearning step' : 'Learning step', fmtDays(tr.delayMin / 1440)]);
    rows.push(['Next review', fmtDate(tr.due_at)]);
    var pol = tr.y === 0 && (tr.from === 'review' || tr.from === 'relearning') ? DSR.lapsePolicy(tr.consecutive_lapses) : null;
    return { rows: rows, notes: tr.notes.slice(), policy: pol, lapses: tr.consecutive_lapses, rating: tr.rating };
  };

  App.views.study = function (root) {
    var S = App.S, now = Date.now(), s = App.session;
    var q = DSR.buildQueue(S, App.env(now), App.queueOpts());
    App.lastQueue = q;
    var cur = pickCurrent(q);
    var deckOpts = '<option value="">All decks</option>' + Object.keys(S.decks).map(function (d) {
      return '<option value="' + esc(d) + '"' + (d === App.studyDeck ? ' selected' : '') + '>' + esc(S.decks[d].name) + '</option>';
    }).join('');

    var main;
    if (!cur) {
      var tomorrow = DSR.dayStart(DSR.dayIndex(now, S.settings.day_start_hour) + 1, S.settings.day_start_hour);
      var tomorrowCount = Object.keys(S.mem).filter(function (id) {
        var m = S.mem[id]; return m.state === 'review' && !m.suspended && m.due_at >= tomorrow && m.due_at < tomorrow + DAY &&
          (!App.studyDeck || S.cards[id].deck_id === App.studyDeck);
      }).length;
      main = '<div class="index-card done-card"><div class="card-meta"><span class="deck">' + esc(App.studyDeck ? deckName(App.studyDeck) : 'All decks') + '</span></div>' +
        '<div class="card-body"><h2>Today’s queue is empty</h2>' +
        '<p class="muted">' + (q.nextLearnAt ? 'The next learning step opens at ' + fmtDate(q.nextLearnAt) + '. ' : '') +
        tomorrowCount + ' review' + (tomorrowCount === 1 ? '' : 's') + ' planned for tomorrow.' +
        (q.totals.freshAvailable && !q.counts.fresh ? ' Daily new-card limit reached (' + q.totals.newLimit + ').' : '') + '</p>' +
        '<p class="muted small">Reviewing early is not recommended: the interval was computed for the target retention.</p>' +
        '<div class="row" style="justify-content:center;margin-top:16px"><button class="btn primary" data-act="goto-cards">Add cards</button><button class="btn" data-act="goto-stats">See stats</button></div></div></div>';
    } else {
      var card = S.cards[cur.card_id], mem = S.mem[cur.card_id];
      var revealed = !!cur.revealedAt;
      var flags = mem.needs_content_review ? '<span class="pill flag" title="' + esc(mem.content_flags.join(' · ')) + '">content review</span>' : '';
      var body = '<div class="card-front' + (card.front.length <= 24 ? ' short' : '') + '">' + esc(card.front) + '</div>';
      if (cur.hintUsed && card.hint && !revealed) body += '<div class="card-hint">Hint: ' + esc(card.hint) + '</div>';
      if (revealed) {
        body += '<div class="card-divider"></div><div class="card-back">' + esc(card.back) + '</div>';
        if (card.explanation) body += '<div class="card-expl">' + esc(card.explanation) + '</div>';
      }
      var bar;
      if (!revealed) {
        bar = '<div class="answer-bar reveal"><button class="btn primary reveal-btn" data-act="reveal">Show answer <kbd>Space</kbd></button>' +
          '<div class="row">' + (card.hint && !cur.hintUsed ? '<button class="btn" data-act="hint">Hint <kbd>H</kbd></button>' : '') +
          '<span class="timer" id="study-timer">0 s</span></div></div>';
      } else {
        var pv = DSR.previewIntervals(card, mem, App.env(now, { hintUsed: cur.hintUsed, medianMs: App.medianFor(card.card_type) }));
        bar = '<div class="answer-bar">' + DSR.RATING_ORDER.map(function (r, i) {
          return '<button class="rate ' + r + '" data-rate="' + r + '"><b>' + RATING_TR[r] + '</b><small>' + fmtMs(pv[r]) + '</small><kbd>' + (i + 1) + '</kbd></button>';
        }).join('') + '</div>';
      }
      // Motion (keyboard or pointer): a new card rises out of the drawer; a revealed card hinges down to its answer.
      // The class is added only within 900 ms of the action, so a later re-render does not replay it.
      var motion = revealed ? (now - cur.revealedAt < 900 ? ' just-revealed' : '') : (cur.enter && now - cur.shownAt < 900 ? ' entering' : '');
      main = '<article class="index-card' + motion + '" aria-live="polite">' +
        '<div class="card-meta"><span class="deck">' + guideHtml(card.deck_id) + esc(deckName(card.deck_id)) + '</span>' + flags +
        '<span class="pill ' + mem.state + '">' + STATE_TR[mem.state] + '</span>' +
        (card.importance >= 4 ? '<span class="pill">importance ' + card.importance + '</span>' : '') + '</div>' +
        '<div class="card-body">' + body + '</div></article>' + bar +
        // Model numbers only after the answer is revealed, so they do not influence self-rating
        (revealed ? memoryStrip(card, mem, now) : '');
    }
    if (cur || s.lastFiled) main += drawerHtml(q);

    var over = (now - s.startedAt) / MIN > S.settings.max_session_minutes && !s.limitDismissed;
    var notes = q.newNotes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('');
    root.innerHTML =
      '<div class="study">' +
      '<div class="stack">' +
      '<div class="row" style="justify-content:space-between">' +
      '<div class="counts" aria-label="Queue"><span class="c-learn"><b>' + q.counts.learning + '</b>learning</span><span class="c-review"><b>' + q.counts.review + '</b>review</span><span class="c-new"><b>' + q.counts.fresh + '</b>new</span></div>' +
      '<select class="input" id="study-deck" aria-label="Deck">' + deckOpts + '</select></div>' +
      (over ? '<div class="banner"><p class="small">The ' + S.settings.max_session_minutes + '-minute session time is up. A short break makes the next recalls easier.</p><button class="btn small" data-act="dismiss-limit">Continue</button></div>' : '') +
      (q.usingAhead ? '<p class="small muted">No other cards are left, so a learning step due within ' + S.settings.learn_ahead_minutes + ' min was brought forward.</p>' : '') +
      main + '</div>' +
      '<aside class="stack">' +
      (App.backupDue() ? '<div class="panel backup-nudge"><p class="small"><span class="lvl warn"><i>!</i>Backup</span>Your cards and review history are only in this browser. Last backup: ' + esc(App.backupText()) + '.</p>' +
        '<div class="row"><button class="btn small primary" data-act="backup">Back up</button></div></div>' : '') +
      '<div class="panel"><h3>Today</h3><p class="small">Reviews done: <b class="num">' + q.totals.reviewDone + '</b> / ' + q.totals.reviewLimit +
      ' · new: <b class="num">' + q.totals.newDone + '</b> / ' + q.totals.newLimit + '</p>' +
      '<p class="small muted">Pending reviews: ' + q.totals.dueReview + ' · new cards left: ' + q.totals.freshAvailable + '</p>' +
      (notes ? '<ul class="small muted" style="margin:6px 0 0;padding-left:18px">' + notes + '</ul>' : '') + '</div>' +
      '<div class="panel trace"><h3>How the last answer was computed</h3>' + traceHtml(s.last) + '</div>' +
      '</aside></div>';

    root.querySelector('#study-deck').addEventListener('change', function (e) {
      App.studyDeck = e.target.value; s.current = null; App.render();
    });
    root.querySelectorAll('[data-rate]').forEach(function (b) {
      b.addEventListener('click', function () { App.rate(b.dataset.rate); });
    });
    root.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () { App.action(b.dataset.act); });
    });
    var qf = root.querySelector('#q-fronts');
    if (qf) qf.addEventListener('change', function () { setPref('kartotek-queue-fronts', qf.checked ? '1' : '0'); App.render(); });
    App.tickTimer();
  };

  App.tickTimer = function () {
    var el = document.getElementById('study-timer'), cur = App.session.current;
    if (el && cur && !cur.revealedAt) el.textContent = Math.floor((Date.now() - cur.shownAt) / 1000) + ' s';
  };

  App.action = function (act) {
    var s = App.session, cur = s.current;
    if (act === 'reveal' && cur && !cur.revealedAt) { cur.revealedAt = Date.now(); App.render(); }
    else if (act === 'hint' && cur && !cur.revealedAt) { cur.hintUsed = true; App.render(); }
    else if (act === 'undo') App.undo();
    else if (act === 'dismiss-limit') { s.limitDismissed = true; App.render(); }
    else if (act === 'edit-hint' && s.last) App.openEditor(s.last.card_id, 'hint');
    else if (act === 'edit' && s.last) App.openEditor(s.last.card_id, 'front');
    else if (act === 'suspend' && s.last) { App.setSuspended(s.last.card_id, true); toast('Card suspended'); App.render(); }
    else if (act === 'backup') App.exportBackup();
    else if (act === 'goto-cards') App.switchTab(App.scope ? App.scope + '-cards' : 'cards');
    else if (act === 'goto-stats') App.switchTab('stats');
  };

  // Where the stamped copy of a rated card is filed, per rating: Again back down-left, Hard straight down,
  // Good to the right, Easy up and away
  var FILE_TO = {
    again: 'translate(-44px, 80px) rotate(-6deg) scale(.95)',
    hard: 'translate(0, 90px) scale(.94)',
    good: 'translate(80px, 56px) rotate(3deg) scale(.94)',
    easy: 'translate(130px, -36px) rotate(8deg) scale(.94)'
  };

  // The rating is written at once and the next card is shown at once, so nothing waits on motion, by keyboard or pointer.
  // A copy of the rated card is stamped with the rating, then condenses into a chip that reads the new interval and
  // files into the Today panel, whose "Reviews done" count rolls (research/redesign/design-philosophy.md §6.1).
  // An "Again" chip drops back behind the card stack: the card returns to the queue. A second rating clears the previous flight.
  App.rate = function (rating) {
    var s = App.session, cur = s.current;
    if (!cur || !cur.revealedAt) return;
    document.querySelectorAll('.card-ghost, .k-file-chip').forEach(function (x) { x.remove(); });
    var anim = App.motionOK();
    var card = anim && document.querySelector('.k-review .k-card, #tab-study .index-card');
    var ghost = null;
    if (card && card.animate) {
      // A rating during the hinge would measure the rotated card: settle its animations first
      card.getAnimations({ subtree: true }).forEach(function (x) { x.finish(); });
      var r = card.getBoundingClientRect();
      ghost = card.cloneNode(true);
      ghost.classList.remove('entering', 'just-revealed');
      ghost.style.transform = 'none'; ghost.style.opacity = '1';
      ghost.classList.add('card-ghost');
      ghost.removeAttribute('aria-live');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px';
      ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
      var stamp = document.createElement('span');
      stamp.className = 'ghost-stamp';
      stamp.setAttribute('data-r', rating);
      stamp.textContent = RATING_TR[rating];
      ghost.appendChild(stamp);
    }
    var cardId = cur.card_id;
    rateNow(rating, anim);
    if (!ghost) return;
    document.body.appendChild(ghost);
    var travel = 'cubic-bezier(0.45, 0, 0.1, 1)';
    // 1) Hold while the stamp lands, then the copy condenses toward its centre
    var a = ghost.animate([
      { offset: 0, opacity: 1, transform: 'none', easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      { offset: 0.3, opacity: 1, transform: 'scale(.96)', easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      { offset: 1, opacity: 0, transform: 'scale(.55)' }
    ], { duration: 460, fill: 'forwards' });
    a.onfinish = a.oncancel = function () { ghost.remove(); };
    // 2) The chip with the new interval appears where the copy condensed and flies to its target
    var mem = App.S.mem[cardId];
    var chip = document.createElement('span');
    chip.className = 'k-file-chip';
    chip.setAttribute('data-r', rating);
    chip.setAttribute('aria-hidden', 'true');
    var iv = mem && mem.last_interval_days;
    chip.textContent = rating === 'again' ? 'again soon' : iv != null && iv >= 0.95 && iv < 60 ? 'in ' + Math.round(iv) + (Math.round(iv) === 1 ? ' day' : ' days') : 'in ' + fmtDays(iv);
    document.body.appendChild(chip);
    var cw = chip.offsetWidth, ch = chip.offsetHeight;
    var r0 = ghost.getBoundingClientRect();
    var x0 = r0.left + r0.width / 2 - cw / 2, y0 = r0.top + r0.height / 2 - ch / 2;
    chip.style.left = x0 + 'px'; chip.style.top = y0 + 'px';
    var was = s.lastFiled && s.lastFiled.was;
    var tgt = rating === 'again' ? null : document.querySelector('[data-file-target="' + (was === 'new' ? 'new' : 'today') + '"]');
    var tr = tgt && tgt.getBoundingClientRect();
    var onScreen = tr && tr.bottom > 0 && tr.top < window.innerHeight;
    var x1, y1;
    if (onScreen) { x1 = tr.left + tr.width / 2 - cw / 2; y1 = tr.top + tr.height / 2 - ch / 2; }
    else if (rating === 'again') { x1 = x0; y1 = r0.bottom - ch; }        // drops back behind the stack
    else {
      var head = document.querySelector('.k-review .k-head-pills');
      var hr = head && head.getBoundingClientRect();
      if (hr) { x1 = hr.left + hr.width / 2 - cw / 2; y1 = hr.top + hr.height / 2 - ch / 2; } else { x1 = x0; y1 = y0 - 40; }
    }
    var dx = x1 - x0, dy = y1 - y0;
    var c = chip.animate([
      { offset: 0, opacity: 0, transform: 'scale(.86)' },
      { offset: 0.22, opacity: 1, transform: 'scale(1)', easing: travel },
      { offset: 0.9, opacity: 1, transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(.88)' },
      { offset: 1, opacity: 0, transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(.8)' }
    ], { duration: 1050, delay: 120, fill: 'both' });
    c.onfinish = c.oncancel = function () { chip.remove(); };
  };

  // After a rating: the drawer moves up (each edge from its old place), new edges slide in at the back,
  // and the filed card's signal slides along its rail to the new interval
  function animateDrawer(prevOrder, from, to) {
    var out = 'cubic-bezier(0.23, 1, 0.32, 1)';
    document.querySelectorAll('#tab-study .edge[data-id]').forEach(function (el, i) {
      if (!el.animate) return;
      var p = prevOrder.indexOf(el.getAttribute('data-id'));
      if (p > i) el.animate([{ transform: 'translateY(' + ((p - i) * 100) + '%)' }, { transform: 'none' }], { duration: 380, delay: i * 30, easing: out, fill: 'backwards' });
      else if (p < 0) el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: i * 30 + 80, easing: out, fill: 'backwards' });
    });
    var track = document.querySelector('#tab-study .edge.filed .sig-track');
    if (track && track.animate && Math.abs(to - from) > 0.005) {
      // Set on the element itself (not through a parent variable); a small overshoot, like a plastic tab slid by hand
      track.animate([{ transform: 'translateX(' + (from * 100).toFixed(2) + '%)' }, { transform: 'translateX(' + (to * 100).toFixed(2) + '%)' }],
        { duration: 520, delay: 200, easing: 'cubic-bezier(.34, 1.3, .64, 1)', fill: 'backwards' });
    }
  }

  function rateNow(rating, animate) {
    var S = App.S, s = App.session, cur = s.current;
    if (!cur || !cur.revealedAt) return;
    var card = S.cards[cur.card_id], mem = S.mem[cur.card_id];
    var now = Date.now();
    var res = DSR.processReview(card, mem, {
      rating: rating, response_time_ms: cur.revealedAt - cur.shownAt, hint_used: cur.hintUsed
    }, App.env(now, {
      medianMs: App.medianFor(card.card_type), loadByDay: App.loadByDay(), cardEvents: App.cardEvents(card.card_id)
    }));
    s.undo.push({ card_id: card.card_id, prevMem: mem, review_id: res.event.review_id, cur: Object.assign({}, cur) });
    if (s.undo.length > 20) s.undo.shift();
    S.mem[card.card_id] = res.mem;
    S.reviews.push(res.event);
    s.reviewed++;
    s.last = { card_id: card.card_id, trace: res.trace };
    var from = App.signalPos(mem.last_interval_days), to = App.signalPos(res.mem.last_interval_days);
    s.lastFiled = { card_id: card.card_id, from: from, to: to, animate: !!animate, at: now, rating: rating, was: mem.state };
    s.enterNext = !!animate;
    s.current = null;
    var prevOrder = (s.edgeOrder || []).slice();
    App.commitCards([card.card_id], { reviewsFrom: S.reviews.length - 1 });
    App.render();
    if (!animate) return;
    s.lastFiled.animate = false;
    animateDrawer(prevOrder, from, to);
  }

  App.undo = function () {
    var S = App.S, s = App.session;
    var u = s.undo.pop();
    if (!u) return;
    var lastEv = S.reviews[S.reviews.length - 1];
    if (!lastEv || lastEv.review_id !== u.review_id || !S.cards[u.card_id]) { s.undo = []; toast('Nothing to undo'); return; }
    S.reviews.pop();
    S.mem[u.card_id] = u.prevMem;
    s.reviewed = Math.max(0, s.reviewed - 1);
    s.current = { card_id: u.card_id, shownAt: u.cur.shownAt, revealedAt: u.cur.revealedAt, hintUsed: u.cur.hintUsed, forced: true };
    s.last = null;
    s.lastFiled = null;
    App.commitCards([u.card_id], { reviewsFrom: S.reviews.length });
    toast('Last rating undone');
    App.render();
  };

  // Multiple-choice card: the choice reveals the answer; the rating stays the user's (Good / Again is only suggested)
  App.pickOption = function (i) {
    var cur = App.session.current;
    if (!cur || cur.revealedAt) return;
    cur.choice = i;
    App.action('reveal');
  };

  document.addEventListener('keydown', function (e) {
    if (App.baseTab() !== 'study' || e.target.closest('input, textarea, select, .modal-back')) return;
    var cur = App.session.current;
    var curCard = cur && App.S.cards[cur.card_id];
    if (/^[a-eA-E]$/.test(e.key) && cur && !cur.revealedAt && curCard && curCard.options && curCard.options.length) {
      var oi = 'abcde'.indexOf(e.key.toLowerCase());
      if (oi < curCard.options.length) { e.preventDefault(); App.pickOption(oi); }
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && cur && !cur.revealedAt) { e.preventDefault(); App.action('reveal'); }
    else if (/^[1-4]$/.test(e.key) && cur && cur.revealedAt) { e.preventDefault(); App.rate(DSR.RATING_ORDER[Number(e.key) - 1]); }
    else if ((e.key === 'h' || e.key === 'H') && cur && !cur.revealedAt) App.action('hint');
    else if (e.key === 'z' || e.key === 'Z') App.undo();
  });

  // ------------------------------------------------------------------ content reload (task C2)
  // Reads the content again (desktop: from the content folder) and attaches it to the saved state with the same import functions
  // as at start-up: new packages appear, changed ones update, saved cards, progress and history are kept.
  App.importContent = function () {
    if (App.importBundledEtuts) App.importBundledEtuts();
    if (App.importBundledLessons) App.importBundledLessons();
    if (App.importBundledMocks) App.importBundledMocks();
    if (App.importBundledMindmaps) App.importBundledMindmaps();
  };
  App.reloadContent = function () {
    return global.KHost.reload().then(function () {
      App.importContent();
      var i = global.KHost.info();
      toast('Content reloaded: ' + i.counts.studies + ' studies, ' + i.counts.lessons + ' lesson tests, ' + i.counts.mocks + ' mock exams, ' + i.counts.mindMaps + ' mind maps' + (i.problemCount ? ' · ' + i.problemCount + ' with problems' : ''));
      App.render();
      return i;
    });
  };
  global.KHost.onChanged(function () { App.render(); });

  // ------------------------------------------------------------------ boot
  App.boot = function () {
    var store = App.store;
    store.init();
    App.importContent();
    store.on(function () { App.updateChip(); });
    if (store.mode === 'file') store.emit(); else store.setStatus('Local');
    // Ask the browser not to clear storage on its own (skip silently if unsupported)
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { /* ignore */ }
    var tabs = Array.prototype.slice.call(document.querySelectorAll('nav.tabs button'));
    tabs.forEach(function (b, i) {
      b.addEventListener('click', function () { App.switchTab(b.dataset.tab); });
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus(); App.switchTab(next.dataset.tab);
      });
    });
    document.getElementById('storage-status').addEventListener('click', function () {
      App.switchTab('settings');
      var panel = document.getElementById('data-panel');
      if (panel) panel.scrollIntoView({ block: 'start' });
    });
    document.getElementById('remove-samples').addEventListener('click', App.removeSamples);
    document.getElementById('hide-samples').addEventListener('click', function () {
      setPref('kartotek-hide-sample', '1'); App.render();
      toast('Banner hidden. You can delete the samples from the Cards tab.');
    });
    // A changed #hash also switches sections (#mindmaps/<id>, #etut/<study id>, #stats …)
    global.addEventListener('hashchange', function () { App.routeHash(true); });
    App.onSaveError = function (err) {
      App.saveError = err;
      toast('Kartotek could not save to this browser (storage full: ' + Math.round(err.chars / 1000) + ' k characters). Make a backup in Settings now; changes after this point may be lost on reload.');
      App.render();
    };
    App.routeHash = function (fromEvent) {
      var saved = (global.location.hash || '').slice(1);
      // #mindmaps/<id> opens one mind map, #etut/<id> one study (used for Edge screenshots and links)
      var mm = /^mindmaps\/([a-z0-9-]+)$/.exec(saved), st = /^etut\/([A-Za-z0-9_.~:@+-]+)$/.exec(saved);
      if (mm) { App.mindOpen = mm[1]; saved = 'mindmaps'; }
      if (st) { App.etutOpen = st[1]; saved = 'etut'; }
      if (!App.views[saved]) {
        if (fromEvent) return;
        try { saved = global.localStorage.getItem('kartotek-tab'); } catch (e) { /* ignore */ }
      }
      App.switchTab(saved && App.views[saved] ? saved : 'study');
    };
    App.routeHash(false);
    setInterval(function () { if (App.baseTab() === 'study') App.tickTimer(); }, 1000);
    // Refresh the queue when learning steps open
    setInterval(function () {
      if (App.baseTab() === 'study' && !App.session.current) App.render();
    }, 30000);
    store.connectCloud().then(function (loaded) {
      if (loaded) {
        App.importContent();
        App.session.current = null; App.render();
      }
    });
  };

  global.App = App;
})(window);
