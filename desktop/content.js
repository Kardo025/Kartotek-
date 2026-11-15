'use strict';
// Content service (task C2, ARCHITECTURE.md section 3): finds the content folder, reads every package from it at run time and
// serves mind-map photos. Plain Node, no Electron API, so it is tested with `npm test`.
//
// The folder layout is the one build.ps1 reads (studies\<id>\etut.json and extras\*.json, lessons\<id>\lesson.json,
// mocks\<id>\mock.json, mindmaps\<id>\ map.json turns\ grades\ reference.json views\, exam\tud-apply.json).
// This module only discovers and parses. Validation stays in the window, with the engine's own validators.
const fs = require('fs');
const path = require('path');

const MAX_JSON_BYTES = 20 * 1024 * 1024;
const MAP_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const PHOTO_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

// Which folder holds the content. Order: the owner's explicit choice in settings.json, then KARTOTEK_CONTENT, then (development
// only) kartotek.config.json at the repository root, then Documents\Kartotek Content if it exists, else null (only the samples).
function resolveContentDir(opts) {
  const settings = opts.settings || {};
  const env = opts.env || {};
  const candidates = [];
  if (typeof settings.contentDir === 'string' && settings.contentDir) candidates.push({ dir: settings.contentDir, from: 'settings' });
  if (env.KARTOTEK_CONTENT) candidates.push({ dir: env.KARTOTEK_CONTENT, from: 'KARTOTEK_CONTENT' });
  if (opts.dev && opts.repoRoot) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(opts.repoRoot, 'kartotek.config.json'), 'utf8').replace(/^﻿/, ''));
      if (cfg && typeof cfg.contentDir === 'string' && cfg.contentDir) candidates.push({ dir: cfg.contentDir, from: 'kartotek.config.json' });
    } catch (e) { /* no config file */ }
  }
  let missing = null;
  // last: the default folder (Documents\Kartotek Content), used only when it exists and nothing else is configured
  if (opts.defaultDir) candidates.push({ dir: opts.defaultDir, from: 'default', optional: true });
  for (const c of candidates) {
    const dir = path.resolve(expandEnv(c.dir, env));
    if (isDir(dir)) return { dir, from: c.from, missing };
    // a configured folder that does not exist is reported, and the next candidate is tried
    if (!missing && !c.optional) missing = dir;
  }
  return { dir: null, from: null, missing };
}

function expandEnv(s, env) {
  return String(s).replace(/%([^%]+)%/g, (m, name) => (env[name] != null ? env[name] : m));
}
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function subDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch (e) { return []; }
}
function jsonFiles(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && /\.json$/i.test(d.name)).map((d) => d.name).sort(); } catch (e) { return []; }
}

// Reads and parses one JSON file. Returns { ok, data, path, mtime } or { ok: false, problem }.
function readJson(file, kind) {
  let st;
  try { st = fs.statSync(file); } catch (e) { return { ok: false, problem: { kind, path: file, message: 'The file cannot be read: ' + e.message } }; }
  if (st.size > MAX_JSON_BYTES) return { ok: false, problem: { kind, path: file, message: 'The file is larger than ' + (MAX_JSON_BYTES / 1048576) + ' MB and was not read.' } };
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    return { ok: true, data: JSON.parse(text), path: file, mtime: st.mtimeMs };
  } catch (e) {
    return { ok: false, problem: { kind, path: file, message: 'The file is not valid JSON: ' + e.message } };
  }
}

// Reads one content root (the content folder or the samples folder).
function scanRoot(root, source) {
  const out = { etuts: [], extras: [], lessons: [], mocks: [], mindmaps: [], exam: null, problems: [] };
  const add = (kind, r, extra) => {
    if (r.ok) out[kind].push(Object.assign({ path: r.path, mtime: r.mtime, source, data: r.data }, extra || {}));
    else out.problems.push(r.problem);
  };
  for (const name of subDirs(path.join(root, 'studies'))) {
    const dir = path.join(root, 'studies', name);
    const f = path.join(dir, 'etut.json');
    if (fs.existsSync(f)) add('etuts', readJson(f, 'study'), { folder: name });
    for (const x of jsonFiles(path.join(dir, 'extras'))) add('extras', readJson(path.join(dir, 'extras', x), 'study extra'), { folder: name });
  }
  for (const name of subDirs(path.join(root, 'lessons'))) {
    const f = path.join(root, 'lessons', name, 'lesson.json');
    if (fs.existsSync(f)) add('lessons', readJson(f, 'lesson test'), { folder: name });
  }
  for (const name of subDirs(path.join(root, 'mocks'))) {
    const f = path.join(root, 'mocks', name, 'mock.json');
    if (fs.existsSync(f)) add('mocks', readJson(f, 'mock exam'), { folder: name });
  }
  for (const name of subDirs(path.join(root, 'mindmaps'))) {
    const dir = path.join(root, 'mindmaps', name);
    if (!MAP_ID_RE.test(name)) { out.problems.push({ kind: 'mind map', path: dir, message: 'The folder name is skipped: use lowercase letters, digits and hyphens only.' }); continue; }
    const bundle = { map_id: name, map: null, turns: [], grades: [], reference: null };
    let latest = 0;
    const take = (file, kind, assign) => {
      const r = readJson(file, kind);
      if (r.ok) { assign(r.data); latest = Math.max(latest, r.mtime); } else out.problems.push(r.problem);
    };
    const mapFile = path.join(dir, 'map.json');
    if (fs.existsSync(mapFile)) take(mapFile, 'mind map', (d) => { bundle.map = d; });
    for (const t of jsonFiles(path.join(dir, 'turns'))) take(path.join(dir, 'turns', t), 'mind map turn', (d) => bundle.turns.push(d));
    for (const g of jsonFiles(path.join(dir, 'grades'))) take(path.join(dir, 'grades', g), 'mind map grade', (d) => bundle.grades.push(d));
    const refFile = path.join(dir, 'reference.json');
    if (fs.existsSync(refFile)) take(refFile, 'mind map reference', (d) => { bundle.reference = d; });
    out.mindmaps.push({ path: dir, mtime: latest, source, folder: name, data: bundle });
  }
  const examFile = path.join(root, 'exam', 'tud-apply.json');
  if (fs.existsSync(examFile)) {
    const r = readJson(examFile, 'exam plan');
    if (r.ok) out.exam = { path: r.path, mtime: r.mtime, source, data: r.data }; else out.problems.push(r.problem);
  }
  return out;
}

// Loads the samples and the content folder together. A sample whose id also exists in the content folder is hidden
// (ARCHITECTURE.md section 3.1). Files are never modified.
function loadContent(opts) {
  const sampleRoot = opts.samplesDir && isDir(opts.samplesDir) ? opts.samplesDir : null;
  const samples = sampleRoot ? scanRoot(sampleRoot, 'samples') : null;
  const user = opts.contentDir ? scanRoot(opts.contentDir, 'content') : null;
  const merged = { etuts: [], extras: [], lessons: [], mocks: [], mindmaps: [], exam: null, problems: [] };
  const idOf = { etuts: (x) => x.data && x.data.etut_id, lessons: (x) => x.data && x.data.lesson_id, mocks: (x) => x.data && x.data.mock_id, mindmaps: (x) => x.data.map_id };
  for (const kind of ['etuts', 'lessons', 'mocks', 'mindmaps']) {
    const taken = new Set();
    for (const part of [user, samples]) {
      if (!part) continue;
      for (const item of part[kind]) {
        const id = idOf[kind](item);
        if (id != null && taken.has(id)) continue; // content wins over samples; the first of two same ids wins inside one source
        if (id != null) taken.add(id);
        merged[kind].push(item);
      }
    }
  }
  // extras belong to a study: keep those whose study folder is shown from the same source
  const shown = new Set(merged.etuts.map((e) => e.source + '|' + e.folder));
  for (const part of [user, samples]) if (part) for (const x of part.extras) if (shown.has(x.source + '|' + x.folder)) merged.extras.push(x);
  merged.exam = (user && user.exam) || (samples && samples.exam) || null;
  for (const part of [user, samples]) if (part) merged.problems.push(...part.problems);
  return {
    contentDir: opts.contentDir || null,
    contentFrom: opts.contentFrom || null,
    missingDir: opts.missingDir || null,
    samplesDir: sampleRoot,
    etuts: merged.etuts, extras: merged.extras, lessons: merged.lessons, mocks: merged.mocks, mindmaps: merged.mindmaps,
    exam: merged.exam, problems: merged.problems,
  };
}

// Maps kcontent://mindmaps/<id>/<file> to a photo below <contentDir>\mindmaps\<id>. Returns { file, type } or null. The path is
// normalised and must stay inside that map's folder; only image files are served.
function resolvePhoto(contentDir, urlHost, urlPath) {
  if (!contentDir || urlHost !== 'mindmaps') return null;
  let p;
  try { p = decodeURIComponent(urlPath || ''); } catch (e) { return null; }
  if (p.indexOf('\0') >= 0 || p.indexOf('\\') >= 0) return null;
  const parts = p.split('/').filter(Boolean);
  if (parts.length < 2 || !MAP_ID_RE.test(parts[0])) return null;
  const mapDir = path.resolve(contentDir, 'mindmaps', parts[0]);
  const file = path.resolve(mapDir, ...parts.slice(1));
  if (!file.startsWith(mapDir + path.sep)) return null;
  const type = PHOTO_TYPES[path.extname(file).toLowerCase()];
  return type ? { file, type } : null;
}

module.exports = { MAX_JSON_BYTES, resolveContentDir, loadContent, scanRoot, readJson, resolvePhoto, isDir };
