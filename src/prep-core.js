/*
 * Kartotek exam prep (UI-independent): topic mastery, "Up next", pace and card sources for the CEnT-S and TU Delft sections.
 * - Mastery comes from evidence, not from the tick: the DSR memory of the topic's cards (its study, end-of-lesson test
 *   and placement objective), the study progress, the test and placement levels and the latest mock exams.
 *   The tick stays as a manual override ("Done by hand").
 * - Up next picks the most useful topic: fading memory first, then topics missed in a mock, weak placement results,
 *   then the first uncovered topic in syllabus order; topics the placement test showed as known go last.
 */
(function (global) {
  'use strict';
  var DSR = global.DSR, K = global.KCents, KL = global.KLesson, KM = global.KMock;
  var DAY = DSR.DAY;
  var R_MASTERED = 0.9, R_FADING = 0.7;

  function liveEtut(S, id) { var e = S.etuts && S.etuts[id]; return e && !e.removed && !(e.package && e.package.generated) ? e : null; }
  function liveLesson(S, id) { var l = S.lessons && S.lessons[id]; return l && !l.removed ? l : null; }

  // Placement lessons that measured this topic, newest result first
  function placementResult(S, itemId) {
    var best = null;
    Object.keys(S.lessons || {}).forEach(function (lid) {
      var ls = liveLesson(S, lid);
      if (!ls || !ls.package || !ls.package.placement || !ls.card_map[itemId]) return;
      var r = KL.latestResults(ls)[itemId];
      if (r && (!best || r.at > best.at)) best = Object.assign({ lesson_id: lid }, r);
    });
    return best;
  }
  function placementLessons(S, exam) {
    return Object.keys(S.lessons || {}).map(function (lid) { return liveLesson(S, lid); })
      .filter(function (ls) { return ls && ls.package && ls.package.placement && ls.package.placement.exam === exam; });
  }

  // Card ids that belong to a topic
  function itemCards(S, itemId) {
    var ids = [], et = liveEtut(S, K.etutId(itemId)), ls = liveLesson(S, K.lessonId(itemId));
    if (et) Object.keys(et.card_map || {}).forEach(function (k) { ids.push(et.card_map[k]); });
    if (ls) Object.keys(ls.card_map || {}).forEach(function (k) { ids.push(ls.card_map[k]); });
    Object.keys(S.lessons || {}).forEach(function (lid) {
      var pl = liveLesson(S, lid);
      if (pl && pl.package && pl.package.placement && pl.card_map[itemId]) ids.push(pl.card_map[itemId]);
    });
    return ids.filter(function (id) { return S.cards[id] && S.mem[id]; });
  }

  function testSummary(ls) {
    if (!ls || !ls.progress || !ls.progress.tested_at) return null;
    var latest = KL.latestResults(ls), keys = Object.keys(latest);
    if (!keys.length) return null;
    var good = keys.filter(function (k) { return latest[k].level === 'mastered' || latest[k].level === 'learned'; }).length;
    return { share: good / keys.length, n: keys.length, at: ls.progress.tested_at };
  }

  // {state, label, meanR, reviewed, studied, tested, placement, manual}
  var LABEL = { done: 'Done by hand', known: 'Known (placement)', mastered: 'Mastered', fading: 'Fading', tested: 'Tested', studied: 'Studied', studying: 'Studying', placed: 'Placement: review', none: 'Not started' };
  function itemStatus(S, itemId, now) {
    now = now || Date.now();
    var done = !!(S.cents && S.cents.done && S.cents.done[itemId]);
    var ids = itemCards(S, itemId), sumR = 0, n = 0;
    ids.forEach(function (id) {
      var m = S.mem[id];
      if (!m || m.suspended || m.state === 'new' || !m.last_reviewed_at) return;
      sumR += DSR.retrievability((now - m.last_reviewed_at) / DAY, m.stability_days); n++;
    });
    var meanR = n ? sumR / n : null;
    var et = liveEtut(S, K.etutId(itemId)), pr = et && et.progress;
    var studied = !!(pr && pr.finished_at), studying = !!(pr && pr.started_at && !pr.finished_at);
    var test = testSummary(liveLesson(S, K.lessonId(itemId)));
    var place = placementResult(S, itemId);
    var placeGood = !!(place && (place.level === 'mastered' || place.level === 'learned'));
    var state;
    if (n && meanR < R_FADING) state = 'fading';
    else if (placeGood && !studied && !test) state = 'known';
    else if (n && meanR >= R_MASTERED && ((test && test.share >= 0.7) || studied)) state = 'mastered';
    else if (done) state = 'done';
    else if (test) state = 'tested';
    else if (studied) state = 'studied';
    else if (studying) state = 'studying';
    else if (place) state = 'placed';
    else state = 'none';
    return { state: state, label: LABEL[state], meanR: meanR, reviewed: n, cards: ids.length, studied: studied, studying: studying, test: test, placement: place, manual: done };
  }
  // A topic counts as covered (its pages count as read) once there is evidence or the tick
  function covered(st) { return ['done', 'known', 'mastered', 'tested', 'studied', 'fading'].indexOf(st.state) >= 0 || st.manual; }

  // Rows of a section in syllabus order with their status
  function sectionRows(S, sec, now) {
    var out = [];
    (sec.syl || []).forEach(function (bl) { bl.rows.forEach(function (r) { out.push({ r: r, block: bl, st: itemStatus(S, r.x[0], now) }); }); });
    return out;
  }

  // The most useful next topics of a section (at most n), each with the reason it was picked
  function upNext(S, exam, sec, now, n) {
    var rows = sectionRows(S, sec, now).filter(function (o) { return o.r.x[3] !== 'opt' && o.r.x[4].length; });
    var weak = KM ? KM.weakItems(S, exam) : {};
    var picks = [], seen = {};
    function add(o, why, rank) { if (seen[o.r.x[0]]) return; seen[o.r.x[0]] = true; picks.push({ row: o.r, st: o.st, why: why, rank: rank }); }
    rows.filter(function (o) { return o.st.state === 'fading'; }).sort(function (a, b) { return a.st.meanR - b.st.meanR; })
      .forEach(function (o) { add(o, 'Memory is fading: mean R ' + Math.round(o.st.meanR * 100) + '%', 0); });
    rows.filter(function (o) { return weak[o.r.x[0]] && o.st.state !== 'mastered'; })
      .forEach(function (o) { var w = weak[o.r.x[0]]; add(o, 'Missed in the last mock (' + w.wrong + ' wrong, ' + w.blank + ' blank)', 1); });
    rows.filter(function (o) { return o.st.state === 'placed'; })
      .forEach(function (o) { add(o, 'Placement test: ' + o.st.placement.level.replace('not', 'not learned').replace('partly', 'partly learned'), 2); });
    rows.filter(function (o) { return !covered(o.st) && o.st.state !== 'placed'; })
      .forEach(function (o) { add(o, o.st.state === 'studying' ? 'Study started, not finished' : 'Next in syllabus order', 3); });
    rows.filter(function (o) { return o.st.state === 'known'; })
      .forEach(function (o) { add(o, 'Known from the placement test: review later', 4); });
    return picks.slice(0, n || 3);
  }

  // Pace towards the exam date of a section: required pages left ÷ days left
  function examDate(S, exam) { var x = S[exam]; return x && x.examDate ? x.examDate : null; }
  function pace(S, exam, sections, now) {
    now = now || Date.now();
    var ts = DSR.parseExamDate(examDate(S, exam));
    var total = 0, done = 0, topics = 0, doneTopics = 0;
    sections.forEach(function (sec) {
      sectionRows(S, sec, now).forEach(function (o) {
        if (o.r.x[3] === 'opt') return;
        var p = K.nPages(o.r.x[4]); total += p; topics++;
        if (covered(o.st)) { done += p; doneTopics++; }
      });
    });
    var out = { examTs: ts, total: total, done: done, left: total - done, topics: topics, doneTopics: doneTopics, days: null, perDay: null, topicsPerDay: null, expected: null, status: null };
    if (!ts) return out;
    var days = Math.max(0, Math.ceil((ts - now) / DAY));
    out.days = days;
    // Leave the last 3 days for review and mock exams
    var studyDays = Math.max(1, days - 3);
    out.perDay = Math.ceil(out.left / studyDays);
    out.topicsPerDay = Math.round((topics - doneTopics) / studyDays * 10) / 10;
    var start = S[exam].planStart || now;
    var span = Math.max(1, (ts - 3 * DAY) - start);
    out.expected = Math.round(total * Math.min(1, Math.max(0, (now - start) / span)));
    out.status = done >= out.expected ? 'ahead' : (out.expected - done) <= out.perDay ? 'on track' : 'behind';
    return out;
  }

  // ------------------------------------------------------------------ card sources
  // Topic and page of a card: from its study (objective pages), its end-of-lesson test or its placement objective
  function cardSource(S, card) {
    var dk = S.decks[card.deck_id];
    if (!dk) return null;
    var itemId = null, pdfPage = null;
    if (dk.etut_id) {
      itemId = K.itemOfEtut(dk.etut_id);
      var et = S.etuts && S.etuts[dk.etut_id];
      if (itemId && et && et.package) {
        var kid = Object.keys(et.card_map || {}).filter(function (k) { return et.card_map[k] === card.card_id; })[0];
        (et.package.parts || []).forEach(function (p) { (p.kazanimlar || []).forEach(function (k) { if (k.kazanim_id === kid && k.slides && k.slides.length && !pdfPage) pdfPage = k.slides[0]; }); });
        // Book studies keep page numbers in slides: some hold PDF pages, some printed pages (PDF = printed + offset)
        if (pdfPage != null) {
          var f0 = K.find(itemId), off = f0 ? f0.book.off || 0 : 0;
          var inR = function (p) { return f0 && f0.item[4].some(function (a) { return p >= a[0] && p <= a[1]; }); };
          pdfPage = inR(pdfPage) ? pdfPage : inR(pdfPage + off) ? pdfPage + off : null;
        }
      }
    } else if (dk.lesson_id) {
      var ls = S.lessons && S.lessons[dk.lesson_id];
      if (ls && ls.package && ls.package.placement) {
        itemId = Object.keys(ls.card_map || {}).filter(function (k) { return ls.card_map[k] === card.card_id; })[0] || null;
      } else itemId = K.itemOfEtut(String(dk.lesson_id).replace(/-test$/, ''));
    }
    if (!itemId) return null;
    var f = K.find(itemId);
    if (!f || !f.item[4].length) return { itemId: itemId, label: f ? f.item[1] + ' ' + f.item[2] : itemId };
    var ranges = f.item[4], bk = f.book;
    if (pdfPage == null) pdfPage = ranges[0][0];
    // page inside the local extract: the extract holds the ranges back to back
    var extractPage = 1;
    for (var i = 0; i < ranges.length; i++) {
      var a = ranges[i];
      if (pdfPage >= a[0] && pdfPage <= a[1]) { extractPage += pdfPage - a[0]; break; }
      extractPage += a[1] - a[0] + 1;
    }
    var localPath = K.extractOf(itemId);
    return {
      itemId: itemId, label: (bk.short || bk.name) + ' ' + f.item[1] + ' · ' + f.item[2], book: bk.name,
      printedPage: pdfPage - (bk.off || 0), pdfPage: pdfPage, extractPage: extractPage,
      bookHref: bk.pdf ? bk.pdf + '#page=' + pdfPage : bk.url,
      localHref: 'file:///' + localPath.replace(/\\/g, '/') + '#page=' + extractPage
    };
  }

  // The values of the "ask-card" prompt (task E2): the card, where it comes from, and the source text that is stored with its study
  // (the objective's source units and lesson text). The page files themselves are PDFs on this computer and are not read in the app
  // yet, so the prompt says what the model cannot see.
  function cardAskInputs(S, card, question) {
    var src = cardSource(S, card), dk = S.decks[card.deck_id] || {};
    var cardLines = ['Front: ' + card.front, 'Back: ' + card.back];
    if (card.explanation) cardLines.push('Explanation on the card: ' + card.explanation);
    var srcLines = [];
    if (src) srcLines.push('Source of this card: ' + src.label + (src.printedPage != null ? ', printed page ' + src.printedPage : '') + (src.book ? ' (' + src.book + ')' : '') + '.');
    var et = dk.etut_id && S.etuts && S.etuts[dk.etut_id];
    if (et && et.package && global.KCycle) {
      var kid = Object.keys(et.card_map || {}).filter(function (k) { return et.card_map[k] === card.card_id; })[0];
      if (kid) {
        srcLines.push('Study: ' + et.package.title + '.');
        global.KCycle.topicSources(et.package, kid).forEach(function (l) { srcLines.push(l); });
      }
    }
    if (!srcLines.length) srcLines.push('No source information is stored for this card.');
    return { card: cardLines.join('\n'), sources: srcLines.join('\n'), question: (question || '').trim() || 'Explain why the answer is right and what mistake to avoid.', _src: src };
  }

  global.KPrep = { cardAskInputs: cardAskInputs, LABEL: LABEL, itemCards: itemCards, itemStatus: itemStatus, covered: covered, sectionRows: sectionRows, upNext: upNext, pace: pace, examDate: examDate, placementResult: placementResult, placementLessons: placementLessons, cardSource: cardSource };
})(typeof window !== 'undefined' ? window : globalThis);
