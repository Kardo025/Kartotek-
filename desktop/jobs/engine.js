'use strict';
// The engine's validators in the main process (task E3). Background jobs check every step with the same code the window uses:
// KCycle.validate / KCycle.audit (Study v2), KLesson.validateLesson, KMock.validateMock and KMind.validate*. The engine scripts
// are plain browser globals; they run here in a Node vm context with a stand-in localStorage and no DOM (the validators need none).
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const FILES = ['engine.js', 'store.js', 'etut-core.js', 'study-v2.js', 'etut-anim.js', 'lesson-core.js', 'mock-core.js', 'mindmap-core.js'];
let cached = null;

function loadEngine(srcDir) {
  if (cached && cached.dir === srcDir) return cached.g;
  const g = { console: { log() {}, warn() {}, error() {}, info() {} } };
  g.window = g; g.globalThis = g; g.self = g;
  const mem = {};
  g.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  vm.createContext(g);
  FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), g, { filename: f }));
  cached = { dir: srcDir, g };
  return g;
}

// Engine objects come from another realm: a JSON round trip gives plain local objects and arrays
const plain = (x) => JSON.parse(JSON.stringify(x));

function createChecks(srcDir) {
  const g = loadEngine(srcDir);
  return {
    studyValidate: (pkg) => plain(g.KCycle.validate(plain(pkg))),
    studyAudit: (pkg) => plain(g.KCycle.audit(plain(pkg))),
    lessonValidate: (pkg) => plain(g.KLesson.validateLesson(plain(pkg))),
    mockValidate: (pkg) => plain(g.KMock.validateMock(plain(pkg))),
    mindMap: (m, id) => plain(g.KMind.validateMap(plain(m), id)).errors,
    mindMapFull: (m, id) => plain(g.KMind.validateMap(plain(m), id)),
    mindTurn: (t, id) => plain(g.KMind.validateTurn(plain(t), id)),
    blockTypes: () => plain(g.KEtut.BLOCK_TYPES),
    kinds: () => plain(g.KEtut.KINDS),
  };
}

module.exports = { createChecks, loadEngine };
