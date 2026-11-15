/*
 * Kartotek mock exams (UI-independent): MOCK-RULES.md
 * - validateMock(): checks a mocks/<id>/mock.json package (sections, counts, options, scoring)
 * - An attempt runs the sections in order with their own time limits: unused time is lost and a finished
 *   section cannot be reopened, as in the real CEnT-S.
 * - scoreAttempt(): raw score (+1 / 0 / −0.25 by default) per section and in total, and right / wrong / blank per syllabus topic.
 * Mock results do not write DSR events: they feed the Overview ("Up next" and the weak-topic list) only.
 */
(function (global) {
  'use strict';

  var OPTIONS = { cents: 5, tud: 4 };

  function validateMock(p) {
    var errs = [];
    function need(c, m) { if (!c) errs.push(m); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) return ['The package is not a JSON object.'];
    need(typeof p.mock_id === 'string' && /^[A-Za-z0-9_.-]{1,120}$/.test(p.mock_id), 'mock_id is missing or invalid.');
    need(p.exam === 'cents' || p.exam === 'tud', 'exam must be "cents" or "tud".');
    need(typeof p.title === 'string' && p.title.trim().length > 0, 'title is missing.');
    need(Array.isArray(p.sections) && p.sections.length > 0, 'sections must contain at least one section.');
    var sc = p.scoring || {};
    ['correct', 'wrong', 'blank'].forEach(function (k) { if (sc[k] != null) need(typeof sc[k] === 'number', 'scoring.' + k + ' must be a number.'); });
    var nOpt = OPTIONS[p.exam], qids = {}, sids = {};
    (p.sections || []).forEach(function (s, si) {
      var at = 'Section ' + (si + 1);
      if (!s || typeof s !== 'object') { errs.push(at + ': not a section object.'); return; }
      need(!!s.section_id && !sids[s.section_id], at + ': section_id is missing or repeated.');
      sids[s.section_id] = true;
      need(!!s.name, at + ': name is required.');
      need(typeof s.minutes === 'number' && s.minutes > 0, at + ': minutes must be a positive number.');
      need(Array.isArray(s.questions) && s.questions.length > 0, at + ': at least one question is required.');
      (s.questions || []).forEach(function (q, qi) {
        var qat = at + ' / question ' + (qi + 1);
        if (!q || typeof q !== 'object') { errs.push(qat + ': not a question object.'); return; }
        need(!!q.q_id && !qids[q.q_id], qat + ': q_id is missing or repeated.');
        if (q.q_id) qids[q.q_id] = true;
        need(!!q.stem, qat + ': stem is required.');
        need(Array.isArray(q.options) && (nOpt ? q.options.length === nOpt : q.options.length >= 2), qat + ': there must be ' + (nOpt || 'at least 2') + ' options.');
        need(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < (q.options || []).length, qat + ': correct must point to one of the options.');
        need(!!q.solution, qat + ': solution is required.');
      });
    });
    return errs;
  }

  function scoring(pkg) { return Object.assign({ correct: 1, wrong: 0, blank: 0 }, pkg.exam === 'cents' ? { wrong: -0.25 } : {}, pkg.scoring || {}); }
  function questionCount(pkg) { return pkg.sections.reduce(function (a, s) { return a + s.questions.length; }, 0); }
  function minutes(pkg) { return pkg.sections.reduce(function (a, s) { return a + s.minutes; }, 0); }

  function importMock(state, pkg, now) {
    var errs = validateMock(pkg);
    if (errs.length) return { errors: errs };
    state.mocks = state.mocks || {};
    var ex = state.mocks[pkg.mock_id];
    state.mocks[pkg.mock_id] = {
      mock_id: pkg.mock_id, package: pkg, imported_at: ex && ex.imported_at ? ex.imported_at : (now || Date.now()),
      attempts: ex && ex.attempts ? ex.attempts : [], current: ex && ex.current ? ex.current : null, removed: ex ? !!ex.removed : false
    };
    return { errors: [], mock: state.mocks[pkg.mock_id] };
  }

  // ------------------------------------------------------------------ an attempt
  function startAttempt(mock, now) {
    mock.current = { attempt_id: 'a' + (now || Date.now()).toString(36), started_at: now, sec: 0, sec_started_at: now, answers: {}, flags: {}, sec_used: [], finished_at: null };
    return mock.current;
  }
  function secondsLeft(mock, now) {
    var a = mock.current; if (!a) return 0;
    var s = mock.package.sections[a.sec];
    return Math.max(0, Math.round(s.minutes * 60 - (now - a.sec_started_at) / 1000));
  }
  // Closes the current section (time up or the user moves on) and opens the next one, or finishes the attempt
  function nextSection(mock, now) {
    var a = mock.current; if (!a) return null;
    var s = mock.package.sections[a.sec];
    a.sec_used[a.sec] = Math.min(s.minutes * 60, Math.round((now - a.sec_started_at) / 1000));
    if (a.sec + 1 < mock.package.sections.length) { a.sec += 1; a.sec_started_at = now; return a; }
    a.finished_at = now;
    a.result = scoreAttempt(mock.package, a);
    mock.attempts.push(a);
    mock.current = null;
    return a;
  }
  // Catches up with time that passed while the page was closed: every section whose time ran out is closed
  function catchUp(mock, now) {
    var guard = 0;
    while (mock.current && secondsLeft(mock, now) <= 0 && guard++ < 20) {
      var a = mock.current, s = mock.package.sections[a.sec];
      // The next section started when this one's time ran out
      nextSection(mock, Math.min(now, a.sec_started_at + s.minutes * 60000));
    }
  }
  function answer(mock, qid, choice) {
    var a = mock.current; if (!a) return;
    if (choice == null) delete a.answers[qid]; else a.answers[qid] = choice;
  }

  // ------------------------------------------------------------------ scoring
  function scoreAttempt(pkg, a) {
    var sc = scoring(pkg), out = { total: 0, max: 0, correct: 0, wrong: 0, blank: 0, sections: [], items: {} };
    pkg.sections.forEach(function (s, si) {
      var r = { section_id: s.section_id, name: s.name, score: 0, max: s.questions.length * sc.correct, correct: 0, wrong: 0, blank: 0, seconds: a.sec_used[si] || 0, minutes: s.minutes };
      s.questions.forEach(function (q) {
        var ans = a.answers[q.q_id], st = ans == null ? 'blank' : ans === q.correct ? 'correct' : 'wrong';
        r[st]++; r.score += sc[st];
        if (q.item_id) {
          var it = out.items[q.item_id] = out.items[q.item_id] || { correct: 0, wrong: 0, blank: 0, q: [] };
          it[st]++; it.q.push(q.q_id);
        }
      });
      r.score = Math.round(r.score * 100) / 100;
      out.sections.push(r);
      out.total += r.score; out.max += r.max; out.correct += r.correct; out.wrong += r.wrong; out.blank += r.blank;
    });
    out.total = Math.round(out.total * 100) / 100;
    return out;
  }

  // Topics answered wrong or left blank in the latest attempt of every mock of an exam: {item_id: {wrong, blank, at}}
  function weakItems(state, exam) {
    var out = {};
    Object.keys(state.mocks || {}).forEach(function (id) {
      var m = state.mocks[id];
      if (!m || m.removed || m.package.exam !== exam || !m.attempts.length) return;
      var last = m.attempts[m.attempts.length - 1], items = (last.result || {}).items || {};
      Object.keys(items).forEach(function (k) {
        var it = items[k];
        if (!it.wrong && !it.blank) return;
        var o = out[k] = out[k] || { wrong: 0, blank: 0, at: 0 };
        o.wrong += it.wrong; o.blank += it.blank; o.at = Math.max(o.at, last.finished_at || 0);
      });
    });
    return out;
  }

  global.KMock = {
    OPTIONS: OPTIONS, validateMock: validateMock, scoring: scoring, questionCount: questionCount, minutes: minutes, importMock: importMock,
    startAttempt: startAttempt, secondsLeft: secondsLeft, nextSection: nextSection, catchUp: catchUp, answer: answer,
    scoreAttempt: scoreAttempt, weakItems: weakItems
  };
})(typeof window !== 'undefined' ? window : globalThis);
