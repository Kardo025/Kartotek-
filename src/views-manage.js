/* Kartotek: Cards and Settings screens */
(function (global) {
  'use strict';
  var App = global.App, DSR = global.DSR, KStore = global.KStore;
  var esc = App.esc, dec = App.dec, pct = App.pct, fmtDays = App.fmtDays, fmtDate = App.fmtDate, toast = App.toast;
  var DAY = DSR.DAY;

  // Two-click confirmation (the browser confirm() dialog does not work inside an artifact)
  function armConfirm(btn, label, fn) {
    btn.addEventListener('click', function () {
      if (btn.dataset.armed) { fn(); return; }
      var orig = btn.textContent;
      btn.dataset.armed = '1'; btn.textContent = label;
      setTimeout(function () { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = orig; } }, 4000);
    });
  }
  App.armConfirm = armConfirm;

  // Hands the file to the user; returns true if it was saved
  App.saveFile = async function (filename, text) {
    // Desktop app: a save dialog in the main process (the window cannot write files)
    if (global.kartotek && global.kartotek.data && global.kartotek.data.saveFile) {
      var r = await global.kartotek.data.saveFile(filename, text);
      if (r && r.ok && r.value && r.value.saved) { toast('Saved: ' + r.value.name); return true; }
      if (r && !r.ok) toast('The file could not be saved: ' + r.error);
      return false;
    }
    if (global.claude && typeof global.claude.use === 'function') {
      var dl = await global.claude.use('downloads');
      if (dl) {
        try { await dl.save({ filename: filename, data: text }); toast('File saved'); return true; }
        catch (e) { if (e && e.code !== 'declined') toast('The file could not be saved (' + (e.code || 'error') + ')'); return false; }
      }
      if (window.top !== window) { toast('File download is not available in this view'); return false; }
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    toast('Backup downloaded: ' + filename);
    return true;
  };

  App.exportBackup = async function () {
    var S = App.S;
    var ok = await App.saveFile('kartotek-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(S));
    if (!ok) return;
    S.last_backup_at = Date.now();
    App.store.commit({ meta: true });
    App.render();
  };

  // ------------------------------------------------------------------ Cards
  App.cardFilter = { q: '', deck: '', state: '', flagged: false };

  function deckOptions(selected, withAll) {
    var S = App.S;
    return (withAll ? '<option value="">All decks</option>' : '') + Object.keys(S.decks).map(function (d) {
      return '<option value="' + esc(d) + '"' + (d === selected ? ' selected' : '') + '>' + esc(S.decks[d].name) + '</option>';
    }).join('');
  }

  function ensureDeck() {
    var S = App.S, x = App.scope, ids = x ? App.examDecks(x) : Object.keys(S.decks);
    if (ids.length) return ids[0];
    var d = { deck_id: DSR.uid(), name: x ? (x === 'tud' ? 'TU Delft AE' : 'CEnT-S') + ' · My cards' : 'My deck', created_at: Date.now() };
    if (x) d.exams = [x];
    S.decks[d.deck_id] = d;
    App.store.commit({ meta: true });
    return d.deck_id;
  }

  function addCard(fields) {
    var S = App.S;
    var c = KStore.makeCard(S, fields);
    var m = S.mem[c.card_id];
    m.content_flags = DSR.contentFlags(c, m, [], null, Date.now());
    m.needs_content_review = m.content_flags.length > 0;
    return c;
  }
  App.ensureDeck = ensureDeck; App.addCard = addCard;

  App.views.cards = function (root) {
    var S = App.S;
    var defDeck = App.cardFilter.deck || App.lastAddDeck || Object.keys(S.decks)[0] || '';
    root.innerHTML =
      '<div class="grid2">' +
      '<form class="panel stack" id="add-form"><h3>New card</h3>' +
      '<p class="small muted">A card should hold a single retrieval target. Context, examples and hints go in separate fields.</p>' +
      '<label class="field">Deck<select id="add-deck">' + (Object.keys(S.decks).length ? deckOptions(defDeck) : '<option value="">My deck (new)</option>') + '</select></label>' +
      '<label class="field">Front (question)<textarea id="add-front" rows="2" required placeholder="What does the French word ‘chien’ mean in English?"></textarea></label>' +
      '<label class="field">Back (expected answer)<textarea id="add-back" rows="2" required placeholder="dog"></textarea></label>' +
      '<div class="settings-grid"><label class="field">Hint<input id="add-hint" placeholder="d…"></label>' +
      '<label class="field">Importance (1–5)<input id="add-imp" type="number" min="1" max="5" value="3"></label></div>' +
      '<label class="field">Explanation / example (shown after a miss)<textarea id="add-expl" rows="2"></textarea></label>' +
      '<label class="field">Tags (comma-separated; cards of the same concept are not shown back to back)<input id="add-tags"></label>' +
      '<label class="row small"><input type="checkbox" id="add-rev"> Also create the reverse card</label>' +
      '<div class="row"><button class="btn primary">Add card</button><span class="small muted" id="add-msg"></span></div>' +
      '</form>' +
      '<div class="stack">' +
      '<div class="panel stack"><h3>Decks</h3><div id="deck-list" class="stack"></div>' +
      '<form class="row" id="deck-form"><input class="input" id="deck-name" placeholder="New deck name" required style="flex:1"><button class="btn">Add deck</button></form></div>' +
      '<form class="panel stack" id="import-form"><h3>Bulk import</h3>' +
      '<p class="small muted">One card per line: <span class="mono">front⇥back⇥hint</span> or <span class="mono">front;back;hint</span></p>' +
      '<label class="field">Deck<select id="imp-deck">' + (Object.keys(S.decks).length ? deckOptions(defDeck) : '<option value="">My deck (new)</option>') + '</select></label>' +
      '<textarea class="input" id="imp-text" rows="5" placeholder="maison;house&#10;livre;book;b…"></textarea>' +
      '<div class="row"><button class="btn">Import</button><span class="small muted" id="imp-msg"></span></div></form>' +
      '</div></div>' +
      '<div class="panel stack" style="margin-top:16px">' +
      '<div class="row"><input class="input" id="f-q" placeholder="Search cards" value="' + esc(App.cardFilter.q) + '" style="flex:1;min-width:160px">' +
      '<select class="input" id="f-deck">' + deckOptions(App.cardFilter.deck, true) + '</select>' +
      '<select class="input" id="f-state"><option value="">All states</option>' + ['new', 'learning', 'review', 'relearning', 'suspended'].map(function (s) {
        return '<option value="' + s + '"' + (App.cardFilter.state === s ? ' selected' : '') + '>' + (App.STATE_TR[s] || 'suspended') + '</option>';
      }).join('') + '</select>' +
      '<label class="row small"><input type="checkbox" id="f-flag"' + (App.cardFilter.flagged ? ' checked' : '') + '> Only cards needing content review</label></div>' +
      '<div id="card-table"></div></div>';

    renderDecks(root);
    renderTable(root);

    root.querySelector('#add-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var deck = root.querySelector('#add-deck').value || ensureDeck();
      var fields = {
        deck_id: deck,
        front: root.querySelector('#add-front').value.trim(),
        back: root.querySelector('#add-back').value.trim(),
        hint: root.querySelector('#add-hint').value.trim(),
        explanation: root.querySelector('#add-expl').value.trim(),
        tags: root.querySelector('#add-tags').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        importance: DSR.clip(1, 5, parseInt(root.querySelector('#add-imp').value, 10) || 3)
      };
      if (!fields.front || !fields.back) return;
      var c = addCard(fields), ids = [c.card_id];
      if (root.querySelector('#add-rev').checked) {
        var r = addCard(Object.assign({}, fields, { front: fields.back, back: fields.front, hint: '', note_id: c.note_id, card_type: 'reverse' }));
        ids.push(r.card_id);
      }
      App.lastAddDeck = deck;
      App.commitCards(ids);
      var flags = App.S.mem[c.card_id].content_flags;
      ['#add-front', '#add-back', '#add-hint', '#add-expl'].forEach(function (s) { root.querySelector(s).value = ''; });
      root.querySelector('#add-msg').textContent = flags.length ? 'Added. Warning: ' + flags.join(' · ') : ids.length + (ids.length === 1 ? ' card added.' : ' cards added.');
      root.querySelector('#add-front').focus();
      renderDecks(root); renderTable(root);
    });

    root.querySelector('#deck-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = root.querySelector('#deck-name').value.trim();
      if (!name) return;
      var d = { deck_id: DSR.uid(), name: name, created_at: Date.now() };
      App.S.decks[d.deck_id] = d;
      App.lastAddDeck = d.deck_id;
      App.store.commit({ meta: true });
      App.render();
    });

    root.querySelector('#import-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var deck = root.querySelector('#imp-deck').value || ensureDeck();
      var lines = root.querySelector('#imp-text').value.split(/\r?\n/);
      var ids = [];
      lines.forEach(function (line) {
        if (!line.trim()) return;
        var parts = line.indexOf('\t') >= 0 ? line.split('\t') : line.split(';');
        if (parts.length < 2 || !parts[0].trim() || !parts[1].trim()) return;
        ids.push(addCard({ deck_id: deck, front: parts[0].trim(), back: parts[1].trim(), hint: (parts[2] || '').trim() }).card_id);
      });
      App.commitCards(ids);
      root.querySelector('#imp-msg').textContent = ids.length + (ids.length === 1 ? ' card imported.' : ' cards imported.');
      root.querySelector('#imp-text').value = '';
      renderDecks(root); renderTable(root);
    });

    root.querySelector('#f-q').addEventListener('input', function (e) { App.cardFilter.q = e.target.value; renderTable(root); });
    root.querySelector('#f-deck').addEventListener('change', function (e) { App.cardFilter.deck = e.target.value; renderTable(root); });
    root.querySelector('#f-state').addEventListener('change', function (e) { App.cardFilter.state = e.target.value; renderTable(root); });
    root.querySelector('#f-flag').addEventListener('change', function (e) { App.cardFilter.flagged = e.target.checked; renderTable(root); });
  };

  function renderDecks(root) {
    var S = App.S, box = root.querySelector('#deck-list');
    var ids = Object.keys(S.decks);
    if (!ids.length) { box.innerHTML = '<p class="small muted">No decks yet. “My deck” is created when you add the first card.</p>'; return; }
    box.innerHTML = ids.map(function (d) {
      var cards = Object.keys(S.cards).filter(function (id) { return S.cards[id].deck_id === d; });
      var st = { 'new': 0, review: 0, other: 0 };
      cards.forEach(function (id) { var s = S.mem[id].state; if (s === 'new') st['new']++; else if (s === 'review') st.review++; else st.other++; });
      return '<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:8px">' +
        '<div><b>' + esc(S.decks[d].name) + '</b><div class="small muted mono">' + cards.length + ' cards · ' + st['new'] + ' new · ' + st.review + ' review · ' + st.other + ' learning</div></div>' +
        '<div class="row"><button class="btn small" data-rename="' + esc(d) + '">Rename</button><button class="btn small danger" data-deldeck="' + esc(d) + '">Delete</button></div></div>';
    }).join('');
    box.querySelectorAll('[data-deldeck]').forEach(function (b) {
      var n = Object.keys(S.cards).filter(function (id) { return S.cards[id].deck_id === b.dataset.deldeck; }).length;
      armConfirm(b, 'Delete ' + n + ' cards and their history?', function () { App.deleteDecks([b.dataset.deldeck]); toast('Deck deleted'); });
    });
    box.querySelectorAll('[data-rename]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = S.decks[b.dataset.rename];
        var row = b.closest('.row').parentNode;
        row.innerHTML = '<form class="row" style="flex:1"><input class="input" value="' + esc(d.name) + '" style="flex:1" required><button class="btn small primary">Save</button></form>';
        var f = row.querySelector('form'), inp = row.querySelector('input');
        inp.focus();
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          if (inp.value.trim()) { d.name = inp.value.trim(); App.store.commit({ meta: true }); }
          renderDecks(root);
        });
      });
    });
  }

  function renderTable(root) {
    var S = App.S, f = App.cardFilter, now = Date.now(), q = f.q.toLowerCase();
    var ids = Object.keys(S.cards).filter(function (id) {
      var c = S.cards[id], m = S.mem[id];
      if (f.deck && c.deck_id !== f.deck) return false;
      if (f.state === 'suspended' ? !m.suspended : (f.state && m.state !== f.state)) return false;
      if (f.flagged && !m.needs_content_review) return false;
      if (q && (c.front + ' ' + c.back + ' ' + (c.tags || []).join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    ids.sort(function (a, b) { return (S.mem[a].due_at || Infinity) - (S.mem[b].due_at || Infinity) || S.cards[a].created_at - S.cards[b].created_at; });
    var shown = ids.slice(0, 300);
    var box = root.querySelector('#card-table');
    if (!ids.length) { box.innerHTML = '<p class="small muted">No cards match the filter.</p>'; return; }
    box.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>Front</th><th>Back</th><th>State</th><th class="num">D</th><th class="num">S</th><th class="num">R now</th><th>Due</th><th class="num">Lapses</th><th class="num">Success</th><th>Actions</th>' +
      '</tr></thead><tbody>' + shown.map(function (id) {
        var c = S.cards[id], m = S.mem[id];
        var R = m.state === 'new' ? null : DSR.retrievability((now - m.last_reviewed_at) / DAY, m.stability_days);
        var state = m.suspended ? '<span class="pill suspended">suspended</span>' : '<span class="pill ' + m.state + '">' + App.STATE_TR[m.state] + '</span>';
        if (m.needs_content_review) state += ' <span class="pill flag" title="' + esc(m.content_flags.join(' · ')) + '">review content</span>';
        return '<tr><td class="front" title="' + esc(c.front) + '">' + esc(c.front) + '</td><td class="front">' + esc(c.back) + '</td><td>' + state + '</td>' +
          '<td class="num">' + (m.state === 'new' ? '-' : dec(m.difficulty, 1)) + '</td>' +
          '<td class="num">' + (m.state === 'new' ? '-' : fmtDays(m.stability_days)) + '</td>' +
          '<td class="num">' + (R == null ? '-' : dec(R, 2)) + '</td>' +
          '<td>' + (m.due_at ? fmtDate(m.due_at) : '-') + '</td>' +
          '<td class="num">' + (m.lapse_count || 0) + '</td>' +
          '<td class="num">' + (m.total_reviews ? pct(m.successful_reviews / m.total_reviews) : '-') + '</td>' +
          '<td><div class="row" style="flex-wrap:nowrap"><button class="btn small" data-edit="' + esc(id) + '">Edit</button>' +
          '<button class="btn small" data-susp="' + esc(id) + '">' + (m.suspended ? 'Unsuspend' : 'Suspend') + '</button>' +
          '<button class="btn small danger" data-del="' + esc(id) + '">Delete</button></div></td></tr>';
      }).join('') + '</tbody></table></div>' +
      (ids.length > shown.length ? '<p class="small muted">Showing the first 300 of ' + ids.length + ' cards. Narrow the search.</p>' : '<p class="small muted">' + ids.length + (ids.length === 1 ? ' card' : ' cards') + '</p>');
    box.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { App.openEditor(b.dataset.edit, 'front', function () { renderTable(root); renderDecks(root); }); });
    });
    box.querySelectorAll('[data-susp]').forEach(function (b) {
      b.addEventListener('click', function () { var id = b.dataset.susp; App.setSuspended(id, !S.mem[id].suspended); renderTable(root); });
    });
    box.querySelectorAll('[data-del]').forEach(function (b) {
      armConfirm(b, 'Are you sure?', function () { App.deleteCards([b.dataset.del]); renderTable(root); renderDecks(root); });
    });
  }

  // ------------------------------------------------------------------ Settings
  var PRESETS = [
    ['Short quiz tomorrow', 0.93], ['Exam in 2–8 weeks', 0.87], ['Ongoing professional knowledge / language', 0.85], ['Critical safety knowledge', 0.94]
  ];
  var PARAM_GROUPS = [
    ['Initial state', ['new_card_difficulty', 'new_card_stability_days', 'easy_graduating_stability_days', 'min_stability_days', 'max_stability_days']],
    ['Success: G = exp(w0 − w1·D − w2·ln(1+S) + w3(1−R) + w4(q−1))', ['w0', 'w1', 'w2', 'w3', 'w4']],
    ['Lapse: S · [f0 − f1(1−R)]', ['f0', 'f1']],
    ['Difficulty update and mean reversion', ['a_r', 'a_h', 'a_e', 'a_t', 'mu']],
    ['Response time', ['easy_slow_ratio_good', 'easy_slow_ratio_hard', 'idle_response_ms']],
    ['Interval', ['lambda', 'max_fuzz_percent', 'critical_target_retention']],
    ['Priority: P = wr·risk + wo·O + wm·M + we·E + wc·C', ['wr', 'wo', 'wm', 'we', 'wc', 'exam_horizon_days']],
    ['Load balancing', ['minimum_safety_retrievability', 'max_load_shift_days']]
  ];
  var PARAM_DOC = {
    new_card_difficulty: 'Initial difficulty D₀ of a new card (1–10); the target of mean reversion',
    new_card_stability_days: 'Initial stability S₀ of a new card (days)',
    easy_graduating_stability_days: 'Minimum S when a new card graduates with “Easy” (days)',
    min_stability_days: 'Lower bound of S (days)',
    max_stability_days: 'Upper bound of S (days)',
    w0: 'Base term of growth; the larger it is, the more every success raises S',
    w1: 'Difficulty penalty: growth falls as D rises',
    w2: 'Saturation: growth falls when S is already large',
    w3: 'Reward for success at low R: a hard but successful recall is more informative',
    w4: 'Quality effect: Easy (q = 1.3) increases growth, Hard (q = 0.6) decreases it',
    f0: 'Share of S kept after a lapse',
    f1: 'Extra penalty for forgetting at low R',
    a_r: 'D increase on an Again answer',
    a_h: 'D increase on a Hard answer',
    a_e: 'D decrease on an Easy answer',
    a_t: 'D increase per unit of slowness score',
    mu: 'Rate at which D returns to D₀ on each review',
    easy_slow_ratio_good: 'Easy counts as Good if slower than this multiple of the median',
    easy_slow_ratio_hard: 'Easy counts as Hard if slower than this multiple of the median',
    idle_response_ms: 'Answers longer than this count as distraction (ms)',
    lambda: 'Extra difficulty adjustment of the interval ÷(1 + λD); 0 = off',
    max_fuzz_percent: 'Largest random fuzz added to the interval (ratio)',
    critical_target_retention: 'Lowest R* for importance-5 cards',
    wr: 'Forgetting-risk weight: max(0, R* − R)',
    wo: 'Overdue weight: ln(1 + days overdue)',
    wm: 'Importance weight: importance / 5',
    we: 'Exam-proximity weight',
    wc: 'Relearning and consecutive-miss weight',
    exam_horizon_days: 'Number of days before the exam when exam priority kicks in',
    minimum_safety_retrievability: 'Load balancing never pushes a card below this R',
    max_load_shift_days: 'Largest shift in load balancing (days)'
  };



})(window);
