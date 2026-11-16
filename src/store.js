/*
 * Kartotek storage layer
 * - Always keeps a local copy (localStorage).
 * - When opened on claude.ai it uses the user's private cloud store (db, data/users/<id>/)
 *   as the source of truth. Documents are chunked: meta + card chunks + review-log chunks.
 */
(function (global) {
  'use strict';
  var DSR = global.DSR;
  var LOCAL_KEY = 'kartotek-dsr-v1';
  // Cloud documents are at most 256 KiB: one review record ≈ 0.7 KB, one card + state ≈ 1–2 KB
  var CARDS_PER_CHUNK = 80;
  var EVENTS_PER_CHUNK = 200;
  var UI_LANG = 'en';
  // Maps stored one entry per cloud document: studies, end-of-lesson tests, mock exams, mind maps (learner records only)
  var DOC_MAPS = ['etuts', 'lessons', 'mocks', 'mindmaps'];
  function freshDirty() {
    var d = { meta: false, chunks: {}, reviewsFrom: null, all: false };
    DOC_MAPS.forEach(function (m) { d[m] = {}; });
    return d;
  }

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function newMem(cardId, P) {
    return {
      card_id: cardId, state: 'new', step_index: 0,
      difficulty: P.new_card_difficulty, stability_days: P.new_card_stability_days,
      retrievability: null, target_retention: null,
      last_reviewed_at: null, due_at: null, last_interval_days: null, introduced_at: null,
      lapse_count: 0, consecutive_lapses: 0, total_reviews: 0, successful_reviews: 0,
      mean_response_time_ms: null, suspended: false, needs_content_review: false, content_flags: [],
      model_version: DSR.VERSION
    };
  }

  function emptyState() {
    return {
      version: 1,
      lang: UI_LANG,
      settings: clone(DSR.DEFAULT_SETTINGS),
      params: clone(DSR.DEFAULT_PARAMS),
      decks: {}, cards: {}, mem: {}, reviews: [],
      etuts: {}, lessons: {}, mocks: {}, mindmaps: {},
      cents: { sel: ['read', 'math', 'reason', 'bio', 'chem', 'phys'], done: {}, selV: 2 },
      tud: { sel: ['math', 'phys', 'fy'] },
      param_history: [],
      // task F3 (LEARNING-PROTOCOL 2.4, 2.5): live sessions and the learner's own knowledge-graph records (seeded package nodes are never stored)
      sessions: {}, graph: { nodes: {}, chains: {}, hidden: [] },
      created_at: Date.now()
    };
  }

  function normalize(s) {
    var base = emptyState();
    var hadLang = !!(s && s.lang);
    var out = Object.assign(base, s || {});
    out.settings = Object.assign(clone(DSR.DEFAULT_SETTINGS), out.settings || {});
    out.params = Object.assign(clone(DSR.DEFAULT_PARAMS), out.params || {});
    out.decks = out.decks || {}; out.cards = out.cards || {}; out.mem = out.mem || {};
    DOC_MAPS.forEach(function (m) { out[m] = out[m] || {}; });
    out.cents = Object.assign({ sel: ['read', 'math', 'reason', 'bio', 'chem', 'phys'], done: {} }, out.cents || {});
    // v2 added the Reading and comprehension section (CEnT-S 2026-27): switch it on once for older saves
    if (out.cents.selV !== 2) { if (out.cents.sel.indexOf('read') < 0) out.cents.sel = ['read'].concat(out.cents.sel); out.cents.selV = 2; }
    out.tud = Object.assign({ sel: ['math', 'phys', 'fy'] }, out.tud || {});
    // task F3: older saves get the empty containers; nothing in them is touched
    if (!out.sessions || typeof out.sessions !== 'object' || Array.isArray(out.sessions)) out.sessions = {};
    if (!out.graph || typeof out.graph !== 'object' || Array.isArray(out.graph)) out.graph = { nodes: {}, chains: {}, hidden: [] };
    else { out.graph.nodes = out.graph.nodes || {}; out.graph.chains = out.graph.chains || {}; out.graph.hidden = Array.isArray(out.graph.hidden) ? out.graph.hidden : []; }
    out.reviews = (out.reviews || []).slice().sort(function (a, b) { return a.reviewed_at - b.reviewed_at; });
    Object.keys(out.cards).forEach(function (id) { if (!out.mem[id]) out.mem[id] = newMem(id, out.params); });
    if (!hadLang || out.lang !== UI_LANG) migrateSampleLanguage(out);
    return out;
  }

  function makeCard(state, fields) {
    var now = fields.created_at || Date.now();
    var id = fields.card_id || DSR.uid();
    var card = {
      card_id: id, deck_id: fields.deck_id, note_id: fields.note_id || id,
      front: fields.front || '', back: fields.back || '', hint: fields.hint || '', explanation: fields.explanation || '',
      card_type: fields.card_type || 'basic', importance: fields.importance || 3,
      tags: fields.tags || [], status: 'active',
      created_at: now, updated_at: now, chunk: null
    };
    // Multiple-choice cards keep their options and the index of the correct one
    if (Array.isArray(fields.options) && fields.options.length) { card.options = fields.options.slice(); card.correct = fields.correct | 0; }
    card.chunk = pickChunk(state);
    state.cards[id] = card;
    state.mem[id] = newMem(id, state.params);
    return card;
  }

  function pickChunk(state) {
    var counts = {};
    Object.keys(state.cards).forEach(function (id) { var c = state.cards[id].chunk; if (c) counts[c] = (counts[c] || 0) + 1; });
    for (var i = 0; ; i++) { if ((counts['c' + i] || 0) < CARDS_PER_CHUNK) return 'c' + i; }
  }

  // ------------------------------------------------------------------ sample data
  var FR = [
    ['chien', 'dog', 'Le chien dort sous la table. The dog is sleeping under the table.'],
    ['chat', 'cat', ''], ['maison', 'house', 'Ma maison est petite. My house is small.'], ['livre', 'book', ''],
    ['eau', 'water', 'Un verre d’eau, s’il vous plaît. A glass of water, please.'], ['pain', 'bread', ''],
    ['pomme', 'apple', ''], ['voiture', 'car', ''], ['arbre', 'tree', ''], ['soleil', 'sun', ''],
    ['lune', 'moon', ''], ['étoile', 'star', ''], ['fleur', 'flower', ''], ['mer', 'sea', ''],
    ['montagne', 'mountain', ''], ['rivière', 'river', ''], ['ville', 'city', ''], ['rue', 'street', ''],
    ['porte', 'door', ''], ['fenêtre', 'window', ''], ['table', 'table', ''], ['chaise', 'chair', ''],
    ['lit', 'bed', ''], ['cuisine', 'kitchen', 'Il cuisine dans la cuisine. He is cooking in the kitchen.'],
    ['école', 'school', ''], ['ami', 'friend', ''], ['famille', 'family', ''], ['enfant', 'child', ''],
    ['travail', 'work', ''], ['pluie', 'rain', ''], ['jour', 'day', ''], ['nuit', 'night', ''],
    ['matin', 'morning', ''], ['soir', 'evening', ''], ['semaine', 'week', ''], ['année', 'year', ''],
    ['lait', 'milk', ''], ['fromage', 'cheese', ''], ['oiseau', 'bird', ''], ['cheval', 'horse', 'The plural is irregular: les chevaux.']
  ];

  var CONCEPTS = [
    ['What does stability (S) measure?', 'How slowly memory fades: the number of days for R to drop to 90%.', '', 'memory-model'],
    ['What is retrievability (R)?', 'The probability that the card is recalled correctly right now (0–1).', '', 'memory-model'],
    ['As difficulty (D) rises, how does a successful review affect S?', 'It grows S less; reviews become more frequent.', '', 'memory-model'],
    ['If the target retention R* is lowered, how does the review load change?', 'Intervals get longer and the review load drops.', '', 'scheduling'],
    ['Recommended R* range for a short quiz tomorrow?', '0.92–0.95', '', 'scheduling'],
    ['The forgetting-curve formula R(t, S) in this system?', 'R = (1 + t / 9S)⁻¹', '', 'memory-model'],
    ['How is S updated after a failed review?', 'S′ = max(S_min, S · [f0 − f1(1 − R)])', '', 'memory-model'],
    ['What do three consecutive failures trigger?', 'A content review instead of a scheduling penalty: split the card, add a hint, study the prerequisite.', '', 'failure'],
    ['What does the inverted U in the interval–retention relationship describe?', 'Too short an interval gives little extra benefit; too long an interval makes recall fail.', '', 'learning-science'],
    ['Why is retrieval practice different from rereading?', 'The answer is actively produced before it is shown; the system’s main signal is the recall outcome.', '', 'learning-science'],
    ['Which two metrics measure model calibration?', 'Brier score and log loss (binary cross-entropy).', '', 'measurement'],
    ['Are expanding intervals definitely better than equal intervals?', 'No. Meta-analyses show no reliable large advantage; the main benefit is spreading reviews over time.', '', 'learning-science']
  ];
  var SAMPLE_DECK_NAMES = { 'sample-fr': 'Sample · Basic French words', 'sample-srs': 'Sample · Spaced repetition concepts' };

  // Older saves were created with Turkish sample content: bring sample decks to the current UI language
  function migrateSampleLanguage(state) {
    Object.keys(SAMPLE_DECK_NAMES).forEach(function (did) { if (state.decks[did]) state.decks[did].name = SAMPLE_DECK_NAMES[did]; });
    var byFront = {};
    FR.forEach(function (w) { byFront[w[0]] = w; });
    var srs = [];
    Object.keys(state.cards).forEach(function (id) {
      var c = state.cards[id];
      if (c.deck_id === 'sample-fr' && byFront[c.front]) {
        var w = byFront[c.front];
        c.back = w[1]; c.hint = w[1].charAt(0) + '…'; c.explanation = w[2];
        c.tags = ['french', 'fr-en'];
      } else if (c.deck_id === 'sample-srs') srs.push(c);
    });
    srs.sort(function (a, b) { return a.created_at - b.created_at; });
    srs.forEach(function (c, i) {
      var k = CONCEPTS[i];
      if (!k) return;
      c.front = k[0]; c.back = k[1]; c.tags = ['srs', k[3]];
    });
    state.lang = UI_LANG;
  }

  // Synthetic student: the true memory evolves with "true" parameters different from the engine's.
  function buildSampleState(now) {
    var state = emptyState();
    var rng = DSR.mulberry32(20260927);
    var h = state.settings.day_start_hour;
    var frDeck = { deck_id: 'sample-fr', name: SAMPLE_DECK_NAMES['sample-fr'], created_at: now - 46 * DSR.DAY, sample: true };
    var cDeck = { deck_id: 'sample-srs', name: SAMPLE_DECK_NAMES['sample-srs'], created_at: now - DSR.DAY, sample: true };
    state.decks[frDeck.deck_id] = frDeck;
    state.decks[cDeck.deck_id] = cDeck;

    FR.forEach(function (w, i) {
      makeCard(state, {
        deck_id: frDeck.deck_id, front: w[0], back: w[1], hint: w[1].charAt(0) + '…', explanation: w[2],
        tags: ['french', 'fr-en'], importance: 3, created_at: frDeck.created_at + i * 1000
      });
    });
    CONCEPTS.forEach(function (c, i) {
      makeCard(state, {
        deck_id: cDeck.deck_id, front: c[0], back: c[1], tags: ['srs', c[3]],
        importance: i === 7 ? 5 : 3, created_at: cDeck.created_at + i * 1000
      });
    });

    var truthP = Object.assign(clone(state.params), { w0: 1.2, w3: 1.4, f0: 0.45, new_card_stability_days: 0.4 });
    var truth = {};
    Object.keys(state.cards).forEach(function (id) { truth[id] = { S: null, D: 3 + rng() * 5, last: null }; });

    var simSettings = Object.assign(clone(state.settings), { daily_new_card_limit: 4 });
    var today = DSR.dayIndex(now, h);
    // Skipped days: so overdue cards and the priority score show up in the sample
    var skip = { '-19': 1, '-18': 1, '-17': 1, '-9': 1, '-2': 1, '-1': 1 };
    var medianPool = [];

    for (var d = -45; d <= -1; d++) {
      if (skip[String(d)]) continue;
      var t = DSR.dayStart(today + d, h) + (15 + rng() * 5) * 3600000;
      var sessionId = 'sim-' + d;
      for (var round = 0; round < 4; round++) {
        var q = DSR.buildQueue(state, { settings: simSettings, params: state.params, now: t }, { deckId: frDeck.deck_id });
        if (!q.order.length) {
          if (q.nextLearnAt && q.nextLearnAt - t < 30 * DSR.MIN) { t = q.nextLearnAt + 60000; continue; }
          break;
        }
        q.order.forEach(function (item) {
          var id = item.card_id, card = state.cards[id], mem = state.mem[id], tr = truth[id];
          var pRecall = tr.S == null ? 0.35 : DSR.retrievability((t - tr.last) / DSR.DAY, tr.S);
          var recalled = rng() < pRecall;
          var rating;
          if (!recalled) rating = 'again';
          else if (pRecall < 0.8 && rng() < 0.45) rating = 'hard';
          else if (pRecall > 0.96 && rng() < 0.35) rating = 'easy';
          else rating = 'good';
          var rt = Math.round(2500 * (0.7 + tr.D / 6) * Math.exp((rng() - 0.5) * 0.8) * (recalled ? 1 : 1.6));
          var med = medianPool.length >= 5 ? DSR.median(medianPool.slice(-200)) : null;
          var res = DSR.processReview(card, mem, { rating: rating, response_time_ms: rt, hint_used: false }, {
            settings: simSettings, params: state.params, now: t, rng: rng, medianMs: med,
            cardEvents: state.reviews.filter(function (e) { return e.card_id === id; }), sessionId: sessionId
          });
          state.mem[id] = res.mem;
          state.reviews.push(res.event);
          medianPool.push(rt);
          var ev = res.event;
          var tm = DSR.memoryStep(tr.S == null ? null : { S: tr.S, D: tr.D }, {
            t: tr.last == null ? 0 : (t - tr.last) / DSR.DAY, y: recalled ? 1 : 0, q: ev.effective_quality,
            slow: 0, from_state: ev.from_state, to_state: ev.to_state, rating: rating
          }, truthP);
          tr.S = tm.S; tr.last = t;
          t += rt + 4000;
        });
        t += 11 * DSR.MIN;
      }
    }
    return state;
  }

  // ------------------------------------------------------------------ Store
  function Store() {
    this.state = null;
    this.mode = 'local';           // 'local' | 'cloud'
    this.status = 'Local';
    this.listeners = [];
    this.db = null; this.uid = null;
    this.dirty = freshDirty();
    this.flushTimer = null; this.flushing = false; this.localTimer = null;
    this.knownReviewChunks = 0; this.knownCardChunks = {}; this.knownDocs = { etuts: {}, lessons: {}, mocks: {}, mindmaps: {} };
    this.readOnly = false;
  }

  Store.prototype.on = function (fn) { this.listeners.push(fn); };
  Store.prototype.emit = function () { var self = this; this.listeners.forEach(function (f) { f(self.status, self.mode); }); };
  Store.prototype.setStatus = function (s) { this.status = s; this.emit(); };

  Store.prototype.loadLocal = function () {
    try {
      var raw = global.localStorage.getItem(LOCAL_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* storage unavailable: continue with the sample */ }
    return null;
  };

  Store.prototype.init = function () {
    if (this.files) return this.initFiles();
    var local = this.loadLocal();
    // A first start is empty: the sample decks are no longer seeded (2026-10-05); existing saves keep theirs until deleted
    this.state = local || emptyState();
    this.saveLocalSoon();
    return this.state;
  };

  Store.prototype.saveLocalSoon = function () {
    var self = this;
    // Desktop app: learner data lives in files (task C3); the window's localStorage is not used for it (and never cleared)
    if (this.mode === 'file') return;
    clearTimeout(this.localTimer);
    this.localTimer = setTimeout(function () {
      var json = JSON.stringify(self.state);
      self.localChars = json.length;
      try { global.localStorage.setItem(LOCAL_KEY, json); self.saveError = null; }
      catch (e) {
        // Over the browser quota (about 5.2 million characters in Edge/Chromium) nothing newer would survive a reload: say so
        self.saveError = { at: Date.now(), chars: json.length, message: String((e && e.message) || e) };
        if (global.App && typeof global.App.onSaveError === 'function') global.App.onSaveError(self.saveError);
      }
    }, 250);
  };

  Store.prototype.paths = function () {
    var base = 'data/users/' + this.uid + '/meta';
    return { meta: base, cards: base + '/cards', reviews: base + '/reviews', etuts: base + '/etuts', lessons: base + '/lessons', mocks: base + '/mocks', mindmaps: base + '/mindmaps' };
  };

  // Inside claude.ai: connect to the user's private cloud. Returns the newly loaded state or null.
  Store.prototype.connectCloud = async function () {
    if (this.mode === 'file') return null; // the desktop app keeps its data in files
    if (!global.claude || typeof global.claude.use !== 'function') return null;
    var db = await global.claude.use('db');
    var user = await global.claude.use('user');
    if (!db || !user) return null;
    var id = await user.id();
    if (!id) return null;
    this.db = db; this.uid = id;
    var p = this.paths();
    try {
      var metaSnap = await db.doc(p.meta).get();
      if (metaSnap.exists) {
        var meta = metaSnap.data();
        var cardSnap = await db.collection(p.cards).get();
        var revSnap = await db.collection(p.reviews).get();
        var st = { version: meta.version, lang: meta.lang || null, settings: meta.settings, params: meta.params, decks: meta.decks, cents: meta.cents, tud: meta.tud, param_history: meta.param_history || [], created_at: meta.created_at, last_backup_at: meta.last_backup_at || null, cards: {}, mem: {}, reviews: [] };
        var self = this;
        cardSnap.docs.forEach(function (d) {
          var items = (d.data() || {}).items || {};
          self.knownCardChunks[d.id] = true;
          Object.keys(items).forEach(function (cid) {
            st.cards[cid] = Object.assign({}, items[cid].card, { chunk: d.id });
            st.mem[cid] = Object.assign({}, items[cid].mem);
          });
        });
        var chunks = revSnap.docs.slice().sort(function (a, b) { return Number(a.id.slice(1)) - Number(b.id.slice(1)); });
        chunks.forEach(function (d) { st.reviews = st.reviews.concat((d.data() || {}).events || []); });
        this.knownReviewChunks = chunks.length;
        for (var mi = 0; mi < DOC_MAPS.length; mi++) {
          var mapName = DOC_MAPS[mi], docSnap = await db.collection(p[mapName]).get();
          st[mapName] = {};
          docSnap.docs.forEach(function (d) { st[mapName][d.id] = Object.assign({}, d.data()); self.knownDocs[mapName][d.id] = true; });
        }
        var migrated = !st.lang;
        this.state = normalize(st);
        this.mode = 'cloud';
        this.setStatus('Cloud: synced');
        this.saveLocalSoon();
        if (migrated) this.markAll();
        return this.state;
      }
      // Nothing in the cloud yet: move the current (local or sample) state to the cloud
      this.mode = 'cloud';
      this.markAll();
      return null;
    } catch (e) {
      this.mode = 'local';
      this.setStatus('Local (cloud unreadable)');
      return null;
    }
  };

  Store.prototype.markAll = function () { this.dirty.all = true; this.commit(); };

  // change: {meta: bool, cards: [ids], reviewsFrom: index}
  Store.prototype.commit = function (change) {
    change = change || {};
    var self = this;
    if (change.meta) this.dirty.meta = true;
    (change.cards || []).forEach(function (id) {
      var c = self.state.cards[id];
      if (c && c.chunk) self.dirty.chunks[c.chunk] = true;
      if (change.removedChunks) change.removedChunks.forEach(function (ch) { self.dirty.chunks[ch] = true; });
    });
    (change.chunks || []).forEach(function (ch) { self.dirty.chunks[ch] = true; });
    DOC_MAPS.forEach(function (m) { (change[m] || []).forEach(function (id) { self.dirty[m][id] = true; }); });
    if (change.reviewsFrom != null) {
      this.dirty.reviewsFrom = this.dirty.reviewsFrom == null ? change.reviewsFrom : Math.min(this.dirty.reviewsFrom, change.reviewsFrom);
    }
    this.saveLocalSoon();
    if (this.mode === 'file') { this.scheduleFileFlush(); return; }
    if (this.mode !== 'cloud' || this.readOnly) return;
    this.setStatus('Cloud: saving…');
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(function () { self.flush(); }, 700);
  };

  Store.prototype.flush = async function () {
    if (this.flushing) { var self0 = this; clearTimeout(this.flushTimer); this.flushTimer = setTimeout(function () { self0.flush(); }, 500); return; }
    this.flushing = true;
    var self = this, db = this.db, p = this.paths(), st = this.state;
    var d = this.dirty;
    this.dirty = freshDirty();
    try {
      if (d.all || d.meta) {
        await db.doc(p.meta).set({
          version: st.version, lang: st.lang || UI_LANG, settings: st.settings, params: st.params, decks: st.decks, cents: st.cents || null, tud: st.tud || null,
          param_history: (st.param_history || []).slice(-10), created_at: st.created_at,
          last_backup_at: st.last_backup_at || null, updated_at: Date.now()
        });
      }
      var byChunk = {};
      Object.keys(st.cards).forEach(function (id) {
        var c = st.cards[id];
        var ch = c.chunk || 'c0';
        (byChunk[ch] = byChunk[ch] || {})[id] = { card: c, mem: st.mem[id] };
      });
      var chunkIds = d.all ? Object.keys(byChunk).concat(Object.keys(this.knownCardChunks)) : Object.keys(d.chunks);
      var seen = {};
      for (var i = 0; i < chunkIds.length; i++) {
        var ch = chunkIds[i];
        if (seen[ch]) continue; seen[ch] = true;
        if (byChunk[ch]) { await db.doc(p.cards + '/' + ch).set({ items: byChunk[ch] }); this.knownCardChunks[ch] = true; }
        else if (this.knownCardChunks[ch]) { await db.doc(p.cards + '/' + ch).delete(); delete this.knownCardChunks[ch]; }
      }
      var from = d.all ? 0 : d.reviewsFrom;
      if (from != null) {
        var total = Math.ceil(st.reviews.length / EVENTS_PER_CHUNK);
        for (var k = Math.floor(from / EVENTS_PER_CHUNK); k < total; k++) {
          await db.doc(p.reviews + '/r' + k).set({ events: st.reviews.slice(k * EVENTS_PER_CHUNK, (k + 1) * EVENTS_PER_CHUNK) });
        }
        for (var z = total; z < this.knownReviewChunks; z++) await db.doc(p.reviews + '/r' + z).delete();
        this.knownReviewChunks = total;
      }
      // Studies and lesson tests with their progress: each in its own document (256 KiB limit)
      for (var mi = 0; mi < DOC_MAPS.length; mi++) {
        var mapName = DOC_MAPS[mi], known = this.knownDocs[mapName], items = st[mapName] || {};
        var ids = d.all ? Object.keys(items).concat(Object.keys(known)) : Object.keys(d[mapName] || {});
        var seenE = {};
        for (var ei = 0; ei < ids.length; ei++) {
          var eid = ids[ei];
          if (seenE[eid]) continue; seenE[eid] = true;
          if (items[eid]) { await db.doc(p[mapName] + '/' + eid).set(items[eid]); known[eid] = true; }
          else if (known[eid]) { await db.doc(p[mapName] + '/' + eid).delete(); delete known[eid]; }
        }
      }
      this.setStatus('Cloud: saved');
    } catch (e) {
      var code = e && e.code;
      if (code === 'invalid_argument' && !d.all) {
        this.setStatus('Cloud: write failed (document may be too large)');
      } else if (code === 'invalid_argument' || code === 'revoked' || code === 'not_granted') {
        this.readOnly = true; this.mode = 'local';
        this.setStatus('Local (no cloud write permission)');
      } else if (code === 'quota_exceeded') {
        this.setStatus('Cloud quota full: export and delete old reviews');
      } else {
        // Temporary error: put the changes back and retry
        this.dirty.meta = this.dirty.meta || d.meta || d.all;
        Object.assign(this.dirty.chunks, d.chunks);
        var dirtyNow = this.dirty;
        DOC_MAPS.forEach(function (m) { Object.assign(dirtyNow[m], d[m] || {}); });
        if (d.all) this.dirty.all = true;
        if (d.reviewsFrom != null) this.dirty.reviewsFrom = this.dirty.reviewsFrom == null ? d.reviewsFrom : Math.min(this.dirty.reviewsFrom, d.reviewsFrom);
        this.setStatus('Cloud: connection problem, will retry');
        var self2 = this;
        setTimeout(function () { self2.flush(); }, 4000 + Math.random() * 2000);
      }
    } finally {
      this.flushing = false;
    }
  };

  Store.prototype.replaceState = function (newState) {
    this.state = normalize(newState);
    // Desktop: a dated backup of what is replaced comes first (the main process runs calls in order, so it precedes the write)
    if (this.mode === 'file' && !this.setupPending && dataBridge()) dataBridge().backupNow('before-replace');
    this.markAll();
    return this.state;
  };

  // ------------------------------------------------------------------ desktop: learner data in files (task C3, ARCHITECTURE.md §4)
  // The main process stores the state as files (desktop/data.js): meta, card chunks, review chunks of 2,000 events, one file per
  // study, lesson test, mock and mind map, and the key order. Each save compares every part with what is on disk and sends only the
  // parts that changed. The dirty marks (commit) only start a save: code that changes the state without commit() is still saved, as it
  // was with the whole-state localStorage save, because the comparison finds it (and a check every 15 seconds catches it).
  var REVIEWS_PER_FILE = 2000;
  var FILE_FLUSH_MS = 700;
  var FILE_CHECK_MS = 15000;
  var PART_KEYS = ['cards', 'mem', 'reviews'].concat(DOC_MAPS);
  function dataBridge() { return global.kartotek && global.kartotek.data ? global.kartotek.data : null; }

  // The state as logical parts, exactly as desktop/data.js stateToParts() (a test checks that both agree)
  function stateToParts(st) {
    var parts = {}, meta = {};
    Object.keys(st).forEach(function (k) { if (PART_KEYS.indexOf(k) < 0) meta[k] = st[k]; });
    parts.meta = meta;
    var cards = st.cards || {}, mem = st.mem || {}, byChunk = {};
    var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    Object.keys(cards).forEach(function (id) {
      var c = cards[id], ch = c && typeof c.chunk === 'string' && /^c\d+$/.test(c.chunk) ? c.chunk : 'c0';
      var e = { card: c };
      if (has(mem, id)) e.mem = mem[id];
      (byChunk[ch] = byChunk[ch] || {})[id] = e;
    });
    Object.keys(byChunk).forEach(function (ch) { parts['cards/' + ch] = { chunk: ch, items: byChunk[ch] }; });
    var orphans = {};
    Object.keys(mem).forEach(function (id) { if (!has(cards, id)) orphans[id] = { mem: mem[id] }; });
    if (Object.keys(orphans).length) parts['cards/_orphans'] = { chunk: '_orphans', items: orphans };
    var reviews = Array.isArray(st.reviews) ? st.reviews : [];
    for (var k = 0; k * REVIEWS_PER_FILE < reviews.length; k++) parts['reviews/r' + k] = { index: k, events: reviews.slice(k * REVIEWS_PER_FILE, (k + 1) * REVIEWS_PER_FILE) };
    DOC_MAPS.forEach(function (m) { var map = st[m] || {}; Object.keys(map).forEach(function (id) { parts[m + '/' + id] = { id: id, record: map[id] }; }); });
    var order = { cards: Object.keys(cards), mem: Object.keys(mem) };
    DOC_MAPS.forEach(function (m) { order[m] = Object.keys(st[m] || {}); });
    parts.order = order;
    return parts;
  }
  function serializeParts(parts) { var out = {}; Object.keys(parts).forEach(function (k) { out[k] = JSON.stringify(parts[k]); }); return out; }

  // Desktop only, before init(): reads the saved files. Resolves to the load result ({ status: 'empty'|'ok'|'recovered'|'damaged' }).
  Store.prototype.prepare = async function () {
    var b = dataBridge();
    if (!b) return null;
    var res = await b.load();
    if (!res || !res.ok) throw new Error((res && res.error) || 'The data folder could not be read.');
    this.files = res.value;
    return res.value;
  };

  // What is on disk now, part by part (serialised), so a save can send only what differs
  Store.prototype.setFileBase = function (st) { this.fileBase = st ? serializeParts(stateToParts(st)) : {}; };

  Store.prototype.initFiles = function () {
    var f = this.files, self = this;
    this.mode = 'file';
    this.fileGeneration = f.generation || 0;
    this.fileProblems = f.problems || [];
    if (f.status === 'ok' || f.status === 'recovered') {
      this.setupPending = false;
      this.setFileBase(f.state);
      this.state = normalize(f.state);
      this.status = f.status === 'recovered' ? 'Files: recovered after an unfinished save' : 'Files: saved';
      // An older saved shape that normalize() changes is written back after a 'before-migration' backup; nothing is saved before it
      if (canonical(this.state) !== canonical(f.state)) {
        this.fileHold = true;
        dataBridge().backupNow('before-migration').then(function (r) {
          if (!r || !r.ok) { self.setStatus('Files: backup before migration failed'); return; }
          self.fileHold = false; self.scheduleFileFlush();
        });
      }
    } else {
      // empty (first start) or damaged: nothing is written until the owner chooses (first-run panel)
      this.setupPending = true;
      this.setFileBase(null);
      this.state = emptyState();
      this.status = f.status === 'damaged' ? 'Files: the data folder needs attention' : 'Files: not set up yet';
    }
    if (!this.fileCheckTimer && global.setInterval) this.fileCheckTimer = global.setInterval(function () { self.flushFiles(); }, FILE_CHECK_MS);
    return this.state;
  };

  Store.prototype.scheduleFileFlush = function () {
    if (this.setupPending || this.importing || this.fileHold) return;
    var self = this;
    if (this.status !== 'Files: saving…') this.setStatus('Files: saving…');
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(function () { self.flushFiles(); }, FILE_FLUSH_MS);
  };

  // The parts that differ from what is on disk: { parts: { logical: value | null } } or null when nothing changed
  Store.prototype.fileChangeset = function () {
    var parts = stateToParts(this.state), cur = serializeParts(parts), base = this.fileBase || {};
    var out = {}, n = 0;
    Object.keys(cur).forEach(function (k) { if (base[k] !== cur[k]) { out[k] = parts[k]; n++; } });
    Object.keys(base).forEach(function (k) { if (!(k in cur)) { out[k] = null; n++; } });
    return n ? { parts: out, serialized: cur } : null;
  };

  Store.prototype.flushFiles = async function () {
    if (this.mode !== 'file' || this.setupPending || this.importing || this.fileHold) return;
    if (this.flushing) { var again = this; clearTimeout(this.flushTimer); this.flushTimer = setTimeout(function () { again.flushFiles(); }, 300); return; }
    this.flushing = true;
    this.dirty = freshDirty();
    try {
      var cs = this.fileChangeset();
      if (!cs) { if (this.status !== 'Files: saved' && !this.fileError) this.setStatus('Files: saved'); return; }
      var res = await dataBridge().write({ parts: cs.parts });
      if (!res || !res.ok) throw new Error((res && res.error) || 'write failed');
      this.fileBase = cs.serialized;
      this.fileGeneration = res.value.generation;
      this.lastFileWrite = Date.now();
      this.fileError = null;
      this.setStatus('Files: saved');
    } catch (e) {
      // nothing is lost: the base still describes the disk, so the next save sends the same parts again
      this.fileError = { at: Date.now(), message: String((e && e.message) || e) };
      this.setStatus('Files: save failed, will retry');
      var self = this;
      clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(function () { self.flushFiles(); }, 3000);
    } finally {
      this.flushing = false;
    }
  };

  // Writes everything still pending now (before quit, before an import or restore)
  Store.prototype.flushNow = async function () {
    if (this.mode !== 'file') return;
    clearTimeout(this.flushTimer);
    for (var i = 0; i < 50 && this.flushing; i++) await new Promise(function (r) { setTimeout(r, 20); });
    await this.flushFiles();
  };

  // One pipeline for every replacement of the whole state in the desktop app: importing an old backup file, moving the data the
  // window's own browser storage holds, restoring a dated backup and the first start. The main process writes the new files and reads
  // them back; the import is kept only if the read-back state is identical to what was sent (canonical JSON) and every count matches.
  // Otherwise the previous data comes back (revert). Resolves to a report: { ok, rows, before, after, identical, error?, backup }.
  Store.prototype.replaceFromSource = async function (data, opts) {
    opts = opts || {};
    var b = dataBridge();
    var info = inspectBackup(data);
    if (!info.ok) return { ok: false, error: info.error, rows: [] };
    var before = countRecords(data);
    var normalized = normalize(clone(data));
    await this.flushNow();
    this.importing = true;
    try {
      var res = await b.replaceAll(normalized, opts.reason || 'import', opts.sourceText || null, opts.label || null);
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'The files could not be written.', rows: [] };
      var v = res.value;
      var readBack = v.state ? normalize(v.state) : null;
      var after = readBack ? countRecords(readBack) : null;
      var rows = compareCounts(before, after, countRecords(normalized));
      var identical = !!readBack && canonical(readBack) === canonical(normalized);
      var ok = !!readBack && identical && rows.every(function (r) { return r.ok; });
      if (!ok) {
        await b.revert(v.generation);
        return { ok: false, rows: rows, before: before, after: after, identical: identical, backup: v.backup,
          error: !readBack ? 'The written files could not be read back: ' + (v.problems || []).join(' ') : !identical ? 'What was read back from the files differs from the backup.' : 'A count differs.' };
      }
      await b.confirm(v.generation);
      this.setFileBase(v.state);
      this.state = readBack;
      this.dirty = freshDirty();
      this.fileGeneration = v.generation;
      this.setupPending = false;
      this.mode = 'file';
      this.setStatus('Files: saved');
      return { ok: true, rows: rows, before: before, after: after, identical: true, backup: v.backup, source: v.source };
    } finally {
      this.importing = false;
    }
  };

  // ------------------------------------------------------------------ counting and comparing whole states
  // Canonical JSON: keys sorted, so two states compare equal exactly when they hold the same data
  function canonical(x) {
    if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
    if (x && typeof x === 'object') {
      return '{' + Object.keys(x).sort().filter(function (k) { return x[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ':' + canonical(x[k]); }).join(',') + '}';
    }
    return JSON.stringify(x === undefined ? null : x);
  }

  function nkeys(o) { return o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).length : 0; }
  function alen(a) { return Array.isArray(a) ? a.length : 0; }
  function sumOver(map, fn) { var n = 0; Object.keys(map || {}).forEach(function (id) { var r = map[id]; if (r && typeof r === 'object') n += fn(r) || 0; }); return n; }

  // What the import report counts. Each row: [key, label]. Memory records are shown but derived (one per card, normalize() creates
  // missing ones), so the whole-state comparison checks them instead of a count.
  var COUNT_ROWS = [
    ['cards', 'Cards'], ['reviews', 'Review events'], ['decks', 'Decks'],
    ['studies', 'Studies'], ['studyAttempts', 'Study attempts (Study v2)'], ['studyAnswers', 'Answers in legacy studies'],
    ['lessonTests', 'End-of-lesson tests'], ['lessonReviews', 'Lesson-test review events'],
    ['mocks', 'Mock exams'], ['mockAttempts', 'Mock exam attempts'],
    ['mindMaps', 'Mind maps'], ['mindVersions', 'Mind-map versions'], ['mindCorrections', 'Mind-map corrections'], ['mindAttempts', 'Mind-map attempts'], ['mindTurns', 'Mind-map coaching turns'],
    ['examMarks', 'Exam plans: done marks and selections'], ['examDates', 'Exam plans: exam dates'], ['applyTicks', 'Exam plans: application ticks'],
    ['studyProbes', 'Find my level probes'], ['liveSessions', 'Live sessions'], ['graphRecords', 'Knowledge-graph records'],
    ['settings', 'Settings'], ['params', 'Model parameters'], ['paramHistory', 'Parameter history entries']
  ];

  function countRecords(s) {
    s = s || {};
    var et = s.etuts || {}, mm = s.mindmaps || {};
    var cents = s.cents || {}, tud = s.tud || {}, apply = tud.apply || {};
    var ticks = 0;
    ['steps', 'docs', 'q'].forEach(function (k) { var o = apply[k]; if (o && typeof o === 'object') Object.keys(o).forEach(function (x) { if (o[x]) ticks++; }); });
    return {
      cards: nkeys(s.cards), reviews: alen(s.reviews), decks: nkeys(s.decks), memory: nkeys(s.mem),
      studies: nkeys(et),
      studyAttempts: sumOver(et, function (r) { return r.progress && r.progress.v === 'c2' ? alen(r.progress.attempts) : 0; }),
      studyAnswers: sumOver(et, function (r) { return r.progress && r.progress.v !== 'c2' ? nkeys(r.progress.answers) : 0; }),
      lessonTests: nkeys(s.lessons),
      lessonReviews: (s.reviews || []).filter(function (e) { return e && e.source === 'lesson'; }).length,
      mocks: nkeys(s.mocks), mockAttempts: sumOver(s.mocks, function (r) { return alen(r.attempts); }),
      mindMaps: nkeys(mm),
      mindVersions: sumOver(mm, function (r) { return alen(r.versions); }),
      mindCorrections: sumOver(mm, function (r) { return alen(r.corrections); }),
      mindAttempts: sumOver(mm, function (r) { return alen(r.attempts); }),
      mindTurns: sumOver(mm, function (r) { return alen(r.turns); }),
      examMarks: nkeys(cents.done) + alen(cents.sel) + alen(tud.sel),
      examDates: (cents.examDate ? 1 : 0) + (tud.examDate ? 1 : 0),
      applyTicks: ticks,
      studyProbes: sumOver(et, function (r) { return r.progress && Array.isArray(r.progress.probes) ? r.progress.probes.length : 0; }),
      liveSessions: nkeys(s.sessions),
      graphRecords: s.graph && typeof s.graph === 'object' ? nkeys(s.graph.nodes) + nkeys(s.graph.chains) : 0,
      settings: nkeys(s.settings), params: nkeys(s.params), paramHistory: alen(s.param_history)
    };
  }

  // Rows for the report: before = in the file, after = read back from the written files. Learner records must be identical. Three
  // rows can be changed on purpose by the migration of an older save (normalize(): settings and parameters get the defaults newer
  // versions added, the CEnT-S selection gets the Reading section once); for them "after" must equal the migrated file ("expected")
  // and the row says that the migration changed it.
  var MIGRATED_ROWS = { examMarks: true, settings: true, params: true };
  function compareCounts(before, after, expected) {
    return COUNT_ROWS.map(function (r) {
      var k = r[0], b = before ? before[k] : null, a = after ? after[k] : null;
      var migrated = !!MIGRATED_ROWS[k] && expected && expected[k] !== b;
      var target = MIGRATED_ROWS[k] && expected ? expected[k] : b;
      return { key: k, label: r[1], before: b, after: a, ok: a != null && a === target, migrated: migrated };
    });
  }

  // Reads a parsed backup file without touching the saved state: checks its shape and counts what it holds.
  // The backup file is JSON.stringify(state): every learner record is in it (decks, cards, memory, review log, study progress and
  // attempts, lesson tests, mocks, mind maps, exam plans, settings). Bundled Study v2 packages are not: the page carries them.
  function inspectBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'This is not a Kartotek backup.' };
    if (!data.cards || typeof data.cards !== 'object' || Array.isArray(data.cards) || !Array.isArray(data.reviews)) return { ok: false, error: 'This file has no cards or review log.' };
    if (data.version != null && data.version > emptyState().version) return { ok: false, error: 'This backup was made by a newer Kartotek. Update Kartotek first.' };
    function n(o) { return o && typeof o === 'object' ? Object.keys(o).length : 0; }
    return {
      ok: true,
      counts: {
        cards: n(data.cards), reviews: data.reviews.length, decks: n(data.decks), studies: n(data.etuts),
        lessonTests: n(data.lessons), mocks: n(data.mocks), mindMaps: n(data.mindmaps)
      },
      last_backup_at: data.last_backup_at || null
    };
  }

  global.KStore = {
    Store: Store, newMem: newMem, emptyState: emptyState, normalize: normalize, inspectBackup: inspectBackup,
    makeCard: makeCard, pickChunk: pickChunk, buildSampleState: buildSampleState, LOCAL_KEY: LOCAL_KEY,
    canonical: canonical, countRecords: countRecords, stateToParts: stateToParts, compareCounts: compareCounts, COUNT_ROWS: COUNT_ROWS, REVIEWS_PER_FILE: REVIEWS_PER_FILE
  };
})(typeof window !== 'undefined' ? window : this);
