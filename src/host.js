/*
 * Kartotek host seam (task C2, ARCHITECTURE.md section 2.3): where the packages come from.
 * - Browser page built by build.ps1: the packages are JSON <script> tags in the page (bundled-etuts, bundled-study-extras,
 *   bundled-lessons, bundled-mocks, bundled-mindmaps, bundled-exam, kartotek-config), as before.
 * - Desktop app: the main process reads the content folder at run time (window.kartotek.content) at start and on "Reload content".
 * Either way the raw packages are checked here with the engine's own validators. A package that fails never reaches the saved
 * state; it is listed in problems() with its errors (the "Content problems" panel in Settings). The import functions
 * (App.importBundled*) take their input from list(), unchanged in logic.
 */
(function (global) {
  'use strict';

  var EMPTY = function () { return { etuts: [], extras: [], lessons: [], mocks: [], mindmaps: [], exam: null }; };
  var raw = EMPTY();            // everything that was read
  var paths = { etuts: [], extras: [], lessons: [], mocks: [], mindmaps: [] }; // file or folder of each raw item (desktop only)
  var valid = EMPTY();          // what passed the validators
  var problems = [];            // { level: 'error' | 'warning', kind, id, path, label, messages: [] }
  var meta = { desktop: false, contentDir: '', contentFrom: '', missingDir: '', samplesDir: '', loadedAt: 0 };
  var readyPromise = null;
  var changed = false;
  var changedListeners = [];

  function bridge() { return global.kartotek && global.kartotek.content ? global.kartotek.content : null; }
  function isDesktop() { return !!bridge(); }

  function readTag(id, fallback) {
    try {
      var el = global.document && global.document.getElementById(id);
      if (!el) return fallback;
      var v = JSON.parse(el.textContent);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }

  // ---- loading
  function loadFromPage() {
    raw = EMPTY();
    raw.etuts = readTag('bundled-etuts', []);
    raw.extras = readTag('bundled-study-extras', []);
    raw.lessons = readTag('bundled-lessons', []);
    raw.mocks = readTag('bundled-mocks', []);
    raw.mindmaps = readTag('bundled-mindmaps', []);
    raw.exam = readTag('bundled-exam', null);
    paths = { etuts: [], extras: [], lessons: [], mocks: [], mindmaps: [] };
    var cfg = readTag('kartotek-config', null);
    meta = { desktop: false, contentDir: cfg && typeof cfg.contentDir === 'string' ? cfg.contentDir : '', contentFrom: 'page', missingDir: '', samplesDir: '', loadedAt: Date.now() };
    return { loadProblems: [] };
  }

  function loadFromDesktop() {
    return bridge().load().then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'The content could not be read.');
      var v = res.value;
      raw = EMPTY(); paths = { etuts: [], extras: [], lessons: [], mocks: [], mindmaps: [] };
      ['etuts', 'extras', 'lessons', 'mocks', 'mindmaps'].forEach(function (k) {
        (v[k] || []).forEach(function (item) { raw[k].push(item.data); paths[k].push(item.path || ''); });
      });
      raw.exam = v.exam ? v.exam.data : null;
      paths.exam = v.exam ? v.exam.path : '';
      meta = { desktop: true, contentDir: v.contentDir || '', contentFrom: v.contentFrom || '', missingDir: v.missingDir || '', samplesDir: v.samplesDir || '', loadedAt: Date.now() };
      return { loadProblems: v.problems || [] };
    });
  }

  // ---- checking, with the validators the engine already has
  function addProblem(level, kind, id, path, label, messages) {
    problems.push({ level: level, kind: kind, id: id || '', path: path || '', label: label || '', messages: messages });
  }

  function check(loadProblems) {
    var KEtut = global.KEtut, KCycle = global.KCycle, KLesson = global.KLesson, KMock = global.KMock, KMind = global.KMind;
    problems = [];
    valid = EMPTY();
    (loadProblems || []).forEach(function (p) { addProblem('error', p.kind, '', p.path, '', [p.message]); });

    var ids;
    // studies: KEtut.validatePackage runs KCycle.validate for Study v2. A Study v2 package with audit blockers still loads, as before,
    // and is listed as "not certified".
    ids = {};
    raw.etuts.forEach(function (pkg, i) {
      var id = pkg && pkg.etut_id, errs = KEtut.validatePackage(pkg);
      if (errs.length) { addProblem('error', 'study', id, paths.etuts[i], '', errs); return; }
      if (ids[id]) { addProblem('error', 'study', id, paths.etuts[i], '', ['Another study with the same etut_id was loaded first; this one is ignored.']); return; }
      ids[id] = true;
      valid.etuts.push(pkg);
      if (KCycle.isV2(pkg)) {
        var a = KCycle.audit(pkg);
        if (a.blockers.length) addProblem('warning', 'study', id, paths.etuts[i], 'Not certified', a.blockers);
      }
    });
    // extras (Explain texts and follow-up items): each must fit its Study v2 package
    raw.extras.forEach(function (x, i) {
      var pkg = null;
      valid.etuts.forEach(function (p) { if (x && p.etut_id === x.etut_id) pkg = p; });
      var label = (x && (x.attempt_id || x.etut_id)) || '?';
      if (!pkg || !KCycle.isV2(pkg)) { addProblem('warning', 'study extra', label, paths.extras[i], '', ['The study "' + (x && x.etut_id) + '" is not loaded, so this file is not used.']); return; }
      var errs = KCycle.validateExtra(x, pkg);
      if (errs.length) { addProblem('error', 'study extra', label, paths.extras[i], '', errs); return; }
      valid.extras.push(x);
    });
    ids = {};
    raw.lessons.forEach(function (p, i) {
      var id = p && p.lesson_id, errs = KLesson.validateLesson(p);
      if (errs.length) { addProblem('error', 'lesson test', id, paths.lessons[i], '', errs); return; }
      if (ids[id]) { addProblem('error', 'lesson test', id, paths.lessons[i], '', ['Another lesson test with the same lesson_id was loaded first; this one is ignored.']); return; }
      ids[id] = true; valid.lessons.push(p);
    });
    ids = {};
    raw.mocks.forEach(function (p, i) {
      var id = p && p.mock_id, errs = KMock.validateMock(p);
      if (errs.length) { addProblem('error', 'mock exam', id, paths.mocks[i], '', errs); return; }
      if (ids[id]) { addProblem('error', 'mock exam', id, paths.mocks[i], '', ['Another mock exam with the same mock_id was loaded first; this one is ignored.']); return; }
      ids[id] = true; valid.mocks.push(p);
    });
    // mind maps: the map reading is checked here; turns and grades are checked when they are imported (App.importBundledMindmaps)
    ids = {};
    raw.mindmaps.forEach(function (b, i) {
      var id = b && b.map_id;
      if (!id || !KMind.MAP_ID_RE.test(id)) { addProblem('error', 'mind map', id, paths.mindmaps[i], '', ['The map id is missing or invalid.']); return; }
      if (ids[id]) { addProblem('error', 'mind map', id, paths.mindmaps[i], '', ['Another mind map with the same id was loaded first; this one is ignored.']); return; }
      ids[id] = true;
      if (b.map) {
        var v = KMind.validateMap(b.map, id);
        if (v.errors.length) addProblem('error', 'mind map', id, paths.mindmaps[i], 'map.json is not used', v.errors);
      }
      valid.mindmaps.push(b);
    });
    // the application plan of the exam section
    if (raw.exam != null) {
      if (raw.exam && typeof raw.exam === 'object' && Array.isArray(raw.exam.milestones)) valid.exam = raw.exam;
      else addProblem('error', 'exam plan', 'tud-apply.json', paths.exam, '', ['The plan needs a "milestones" list.']);
    }
  }

  function process(res) {
    check(res.loadProblems);
    return state();
  }

  // ---- public
  function state() { return { problems: problems.slice(), info: info() }; }

  function info() {
    return {
      desktop: meta.desktop, contentDir: meta.contentDir, contentFrom: meta.contentFrom, missingDir: meta.missingDir,
      samplesDir: meta.samplesDir, loadedAt: meta.loadedAt, changedOnDisk: changed,
      counts: { studies: valid.etuts.length, extras: valid.extras.length, lessons: valid.lessons.length, mocks: valid.mocks.length, mindMaps: valid.mindmaps.length, exam: valid.exam ? 1 : 0 },
      problemCount: problems.filter(function (p) { return p.level === 'error'; }).length,
      warningCount: problems.filter(function (p) { return p.level === 'warning'; }).length
    };
  }

  // The first load. Resolves when the packages are read and checked; the app boots after it.
  function ready() {
    if (!readyPromise) readyPromise = reload();
    return readyPromise;
  }

  // Reads everything again (desktop: from disk; page: from the embedded tags, so nothing new can appear there)
  function reload() {
    var loading = isDesktop() ? loadFromDesktop() : Promise.resolve(loadFromPage());
    return loading.then(function (res) {
      changed = false;
      if (global.KConfig && global.KConfig.set && meta.contentDir) global.KConfig.set(meta.contentDir);
      return process(res);
    }).catch(function (e) {
      // never break the app: start with nothing and say why
      raw = EMPTY(); valid = EMPTY();
      problems = [{ level: 'error', kind: 'content', id: '', path: '', label: '', messages: ['The content could not be loaded: ' + (e && e.message)] }];
      return state();
    });
  }

  function list(kind) { return valid[kind] || []; }
  function exam() { return valid.exam; }
  // Import functions add problems found while importing (mind-map turns and grades); replaces the earlier ones of that source
  function setImportProblems(source, rows) {
    problems = problems.filter(function (p) { return p.source !== source; });
    rows.forEach(function (r) { r.source = source; problems.push(r); });
  }
  function photoUrl(mapId, file) {
    var f = String(file || '').replace(/\\/g, '/');
    if (isDesktop()) return 'kcontent://mindmaps/' + encodeURIComponent(mapId) + '/' + f.split('/').map(encodeURIComponent).join('/');
    return 'mindmaps/' + mapId + '/' + f;
  }
  function onChanged(cb) { changedListeners.push(cb); }
  if (isDesktop() && bridge().onChanged) {
    bridge().onChanged(function () { changed = true; changedListeners.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); });
  }
  function chooseFolder() { return isDesktop() ? bridge().chooseFolder() : Promise.resolve({ ok: false, error: 'Only the desktop app can choose a folder.' }); }
  function openFolder() { return isDesktop() ? bridge().openFolder() : Promise.resolve({ ok: false, error: 'Only the desktop app can open the folder.' }); }

  global.KHost = {
    isDesktop: isDesktop, ready: ready, reload: reload, list: list, exam: exam, problems: function () { return problems.slice(); }, info: info,
    setImportProblems: setImportProblems, photoUrl: photoUrl, onChanged: onChanged, chooseFolder: chooseFolder, openFolder: openFolder
  };
})(typeof window !== 'undefined' ? window : this);
