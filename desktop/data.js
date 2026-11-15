'use strict';
// Learner data in files (task C3, ARCHITECTURE.md section 4). Plain Node, no Electron API, so it is tested in Node.
//
// Layout of <userData>\data\ (the split of the claude.ai cloud store, so the window's dirty tracking maps onto files):
//   manifest.json            { format, generation, written_at, app_version, state_version, files: { <logical>: { file, sha256, bytes } } }
//   manifest.prev.json       the manifest before the last write
//   meta.g<N>.json           every top-level key of the state except the parts below (lossless: unknown keys are kept)
//   cards\<chunk>.g<N>.json  { chunk, items: { <card_id>: { card, mem } } } (card.chunk, 80 cards per chunk as in the cloud store)
//   cards\_orphans.g<N>.json memory records whose card no longer exists (kept, never dropped)
//   reviews\r<k>.g<N>.json   { index, events: [...] }, 2,000 review events per chunk, in log order
//   etuts|lessons|mocks|mindmaps\<id>.g<N>.json   { id, record }
//   order.g<N>.json          the key order of cards, mem and the four maps (the app's lists and the review queue's tie-breaks follow
//                            Object.keys order, so the state read back must have the same order, not only the same data)
//
// Safe writes: every file is new (its name carries the generation), written to a temp file, flushed and renamed. The manifest is
// written last the same way, after the old one is copied to manifest.prev.json. A crash at any moment therefore leaves the previous
// manifest and every file it names untouched. Files that neither manifest names are removed only after a successful write.
// Nothing is ever deleted when a check fails.
//
// Backups (<userData>\backups\): exactly the old backup format (JSON.stringify(state), what App.exportBackup writes), so the old
// browser page can import any of them. A daily one before the first write of each day, one before every import, restore and
// migration, and on demand. Retention: 14 daily, 8 weekly, 12 monthly, 'before-…' for 90 days, the newest five always.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FORMAT = 'kartotek-files-1';
const REVIEWS_PER_FILE = 2000;
const DOC_MAPS = ['etuts', 'lessons', 'mocks', 'mindmaps'];
const PART_KEYS = ['cards', 'mem', 'reviews'].concat(DOC_MAPS);
const DAY = 86400000;

// ---------------------------------------------------------------- file helpers
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function writeFileSafe(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  const buf = Buffer.from(text, 'utf8');
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, buf, 0, buf.length, 0); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file); // atomic replace on NTFS
  return { sha256: sha256(buf), bytes: buf.length };
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// File-name part for an id. Lower-case safe ids are used as they are (NTFS ignores case, so ids that differ only in case must not
// share a name); anything else becomes "~" + hex of its UTF-8 bytes. The id is also stored inside the file.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
function fileId(id) {
  const s = String(id);
  if (/^[a-z0-9][a-z0-9._-]{0,80}$/.test(s) && !RESERVED.test(s) && !s.endsWith('.')) return s;
  return '~' + Buffer.from(s, 'utf8').toString('hex').slice(0, 160) + (Buffer.byteLength(s) > 80 ? '-' + sha256(Buffer.from(s)).slice(0, 12) : '');
}

// ---------------------------------------------------------------- state <-> parts (pure)
function chunkOf(card) { return card && typeof card.chunk === 'string' && /^c\d+$/.test(card.chunk) ? card.chunk : 'c0'; }

// The whole state as logical parts: { 'meta': {...}, 'cards/c0': {...}, 'reviews/r0': {...}, 'etuts/<id>': {...}, ... }
function stateToParts(state) {
  const parts = {};
  const meta = {};
  Object.keys(state).forEach((k) => { if (PART_KEYS.indexOf(k) < 0) meta[k] = state[k]; });
  parts.meta = meta;
  const cards = state.cards || {}, mem = state.mem || {};
  const byChunk = {};
  Object.keys(cards).forEach((id) => {
    const ch = chunkOf(cards[id]);
    const entry = { card: cards[id] };
    if (Object.prototype.hasOwnProperty.call(mem, id)) entry.mem = mem[id];
    (byChunk[ch] = byChunk[ch] || {})[id] = entry;
  });
  Object.keys(byChunk).forEach((ch) => { parts['cards/' + ch] = { chunk: ch, items: byChunk[ch] }; });
  const orphans = {};
  Object.keys(mem).forEach((id) => { if (!Object.prototype.hasOwnProperty.call(cards, id)) orphans[id] = { mem: mem[id] }; });
  if (Object.keys(orphans).length) parts['cards/_orphans'] = { chunk: '_orphans', items: orphans };
  const reviews = Array.isArray(state.reviews) ? state.reviews : [];
  for (let k = 0; k * REVIEWS_PER_FILE < reviews.length; k++) parts['reviews/r' + k] = { index: k, events: reviews.slice(k * REVIEWS_PER_FILE, (k + 1) * REVIEWS_PER_FILE) };
  DOC_MAPS.forEach((m) => {
    const map = state[m] || {};
    Object.keys(map).forEach((id) => { parts[m + '/' + id] = { id, record: map[id] }; });
  });
  parts.order = orderOf(state);
  return parts;
}

function orderOf(state) {
  const o = { cards: Object.keys(state.cards || {}), mem: Object.keys(state.mem || {}) };
  DOC_MAPS.forEach((m) => { o[m] = Object.keys(state[m] || {}); });
  return o;
}

// Rebuilds an object in the stored key order; keys the order does not name follow in their own order
function inOrder(obj, order) {
  if (!Array.isArray(order)) return obj;
  const out = {};
  order.forEach((k) => { if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]; });
  Object.keys(obj).forEach((k) => { if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = obj[k]; });
  return out;
}

// Inverse of stateToParts. Key order of the result follows the original meta, then the parts (order does not matter to the app).
function partsToState(parts) {
  const meta = parts.meta || {};
  const state = Object.assign({}, meta);
  state.cards = {}; state.mem = {}; state.reviews = [];
  DOC_MAPS.forEach((m) => { state[m] = {}; });
  const cardChunks = Object.keys(parts).filter((k) => k.startsWith('cards/'));
  // stable order: c0, c1, ..., then orphans
  cardChunks.sort((a, b) => chunkSortKey(a) - chunkSortKey(b));
  cardChunks.forEach((k) => {
    const items = (parts[k] && parts[k].items) || {};
    Object.keys(items).forEach((id) => {
      const e = items[id];
      if (e && Object.prototype.hasOwnProperty.call(e, 'card')) state.cards[id] = e.card;
      if (e && Object.prototype.hasOwnProperty.call(e, 'mem')) state.mem[id] = e.mem;
    });
  });
  Object.keys(parts).filter((k) => k.startsWith('reviews/r')).sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)))
    .forEach((k) => { state.reviews = state.reviews.concat((parts[k] && parts[k].events) || []); });
  Object.keys(parts).forEach((k) => {
    const slash = k.indexOf('/');
    const m = k.slice(0, slash);
    if (DOC_MAPS.indexOf(m) >= 0) state[m][parts[k].id] = parts[k].record;
  });
  const order = parts.order || {};
  state.cards = inOrder(state.cards, order.cards);
  state.mem = inOrder(state.mem, order.mem);
  DOC_MAPS.forEach((m) => { state[m] = inOrder(state[m], order[m]); });
  return state;
}
function chunkSortKey(k) { const m = /^cards\/c(\d+)$/.exec(k); return m ? Number(m[1]) : 1e9; }

function logicalToFile(logical, generation) {
  if (logical === 'meta' || logical === 'order') return logical + '.g' + generation + '.json';
  const slash = logical.indexOf('/');
  const dir = logical.slice(0, slash), name = logical.slice(slash + 1);
  const base = dir === 'cards' || dir === 'reviews' ? name : fileId(name);
  return dir + '/' + base + '.g' + generation + '.json';
}

// ---------------------------------------------------------------- canonical JSON (keys sorted): equality of whole states
function canonical(x) {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
  return JSON.stringify(x === undefined ? null : x);
}

// ---------------------------------------------------------------- the store
function createDataStore(opts) {
  const root = opts.dir;                        // <userData>
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  const now = opts.now || (() => Date.now());
  const appVersion = opts.appVersion || '0.0.0';
  let manifest = null;                          // the manifest currently in force
  let parts = null;                             // logical parts of the current state (cache)
  let pending = null;                           // { manifest, previous } of an import that waits for confirm or revert
  let queue = Promise.resolve();
  let lockFd = null;

  const manifestFile = () => path.join(dataDir, 'manifest.json');
  const prevFile = () => path.join(dataDir, 'manifest.prev.json');

  function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  // ---- lock: one writer
  function lock() {
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, '.lock');
    for (let i = 0; i < 2; i++) {
      try {
        lockFd = fs.openSync(file, 'wx');
        fs.writeSync(lockFd, String(process.pid));
        return true;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let pid = 0;
        try { pid = Number(fs.readFileSync(file, 'utf8')) || 0; } catch (x) { /* unreadable: stale */ }
        let alive = false;
        if (pid && pid !== process.pid) { try { process.kill(pid, 0); alive = true; } catch (x) { alive = x.code === 'EPERM'; } }
        if (alive) throw new Error('Another Kartotek (process ' + pid + ') is using this data folder.');
        try { fs.unlinkSync(file); } catch (x) { /* ignore */ }
      }
    }
    throw new Error('The data folder could not be locked.');
  }
  function unlock() {
    if (lockFd == null) return;
    try { fs.closeSync(lockFd); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(path.join(dataDir, '.lock')); } catch (e) { /* ignore */ }
    lockFd = null;
  }

  // ---- reading and checking
  function verifyManifest(m) {
    const problems = [];
    const out = {};
    if (!m || m.format !== FORMAT || !m.files || typeof m.files !== 'object') return { ok: false, problems: ['The manifest is not a Kartotek data manifest.'] };
    for (const logical of Object.keys(m.files)) {
      const entry = m.files[logical];
      const file = path.join(dataDir, entry.file);
      let buf;
      try { buf = fs.readFileSync(file); } catch (e) { problems.push(entry.file + ' is missing.'); continue; }
      if (sha256(buf) !== entry.sha256) { problems.push(entry.file + ' does not match its checksum.'); continue; }
      try { out[logical] = JSON.parse(buf.toString('utf8')); } catch (e) { problems.push(entry.file + ' is not valid JSON.'); }
    }
    return problems.length ? { ok: false, problems } : { ok: true, parts: out };
  }

  // { status: 'empty' | 'ok' | 'recovered' | 'damaged', state, generation, problems, info }
  function load() {
    lock();
    const hasCurrent = fs.existsSync(manifestFile());
    const hasPrev = fs.existsSync(prevFile());
    if (!hasCurrent && !hasPrev) return { status: 'empty', state: null, generation: 0, problems: [], info: info() };
    const problems = [];
    for (const [file, status] of [[manifestFile(), 'ok'], [prevFile(), 'recovered']]) {
      if (!fs.existsSync(file)) continue;
      let m;
      try { m = readJson(file); } catch (e) { problems.push(path.basename(file) + ' is not valid JSON.'); continue; }
      const v = verifyManifest(m);
      if (!v.ok) { problems.push(...v.problems.map((p) => path.basename(file) + ': ' + p)); continue; }
      manifest = m; parts = v.parts;
      if (status === 'recovered') {
        // the last write did not finish: make the previous manifest the current one again (the damaged one is kept aside)
        try { fs.copyFileSync(manifestFile(), path.join(dataDir, 'manifest.damaged-' + stamp(now()) + '.json')); } catch (e) { /* none */ }
        writeFileSafe(manifestFile(), JSON.stringify(m, null, 1));
      }
      return { status, state: partsToState(parts), generation: m.generation, problems, info: info() };
    }
    return { status: 'damaged', state: null, generation: 0, problems, info: info() };
  }

  function info() {
    return { dataDir, backupDir, generation: manifest ? manifest.generation : 0, writtenAt: manifest ? manifest.written_at : null, format: FORMAT };
  }

  // ---- writing one generation
  // changes: { 'meta': obj, 'cards/c3': obj | null, 'etuts/x': obj | null, ... }; all: true replaces everything not named.
  function commitParts(changes, all) {
    const generation = (manifest ? manifest.generation : 0) + 1;
    const files = all ? {} : Object.assign({}, manifest ? manifest.files : {});
    const nextParts = all ? {} : Object.assign({}, parts || {});
    for (const logical of Object.keys(changes)) {
      const value = changes[logical];
      if (value === null) { delete files[logical]; delete nextParts[logical]; continue; }
      const rel = logicalToFile(logical, generation);
      const r = writeFileSafe(path.join(dataDir, rel), JSON.stringify(value));
      files[logical] = { file: rel, sha256: r.sha256, bytes: r.bytes };
      nextParts[logical] = value;
    }
    const meta = nextParts.meta || {};
    const m = { format: FORMAT, generation, written_at: new Date(now()).toISOString(), app_version: appVersion,
      state_version: meta.version == null ? null : meta.version, files };
    if (fs.existsSync(manifestFile())) fs.copyFileSync(manifestFile(), prevFile());
    writeFileSafe(manifestFile(), JSON.stringify(m, null, 1));
    const before = manifest;
    manifest = m; parts = nextParts;
    return before;
  }

  // Removes data files that neither the current nor the previous manifest (nor a pending import's fallback) names
  function collectGarbage() {
    const keep = new Set(['manifest.json', 'manifest.prev.json', '.lock']);
    const add = (m) => { if (m && m.files) Object.values(m.files).forEach((e) => keep.add(e.file.replace(/\\/g, '/'))); };
    add(manifest);
    try { add(readJson(prevFile())); } catch (e) { /* none */ }
    if (pending) add(pending.previous);
    const walk = (dir, rel) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const d of entries) {
        const r = rel ? rel + '/' + d.name : d.name;
        if (d.isDirectory()) { if (['cards', 'reviews'].concat(DOC_MAPS).indexOf(r.split('/')[0]) >= 0) walk(path.join(dir, d.name), r); continue; }
        if (keep.has(r) || r.startsWith('manifest.damaged-')) continue;
        if (!/\.g\d+\.json$/.test(d.name) && !/\.tmp$/.test(d.name)) continue; // only our own files
        try { fs.unlinkSync(path.join(dir, d.name)); } catch (e) { /* ignore */ }
      }
    };
    walk(dataDir, '');
  }

  // A change set from the window (Store dirty tracking): { meta?, chunks?: {c0: items|null}, reviews?: {from, chunks: [[...]], total},
  //   etuts?: {id: record|null}, lessons?, mocks?, mindmaps?, all?: true }
  function changesFromChangeset(cs) {
    // the window's save: the logical parts that differ from the disk (null = remove)
    if (cs.parts && typeof cs.parts === 'object') {
      const out = {};
      Object.keys(cs.parts).forEach((k) => {
        if (!/^(meta|order|cards\/(c\d+|_orphans)|reviews\/r\d+|(etuts|lessons|mocks|mindmaps)\/.+)$/.test(k)) throw new Error('Unknown data part: ' + k);
        out[k] = cs.parts[k];
      });
      return out;
    }
    const changes = {};
    if (cs.meta) changes.meta = cs.meta;
    if (cs.order) changes.order = cs.order;
    Object.keys(cs.chunks || {}).forEach((ch) => {
      const logical = 'cards/' + ch;
      changes[logical] = cs.chunks[ch] && Object.keys(cs.chunks[ch]).length ? { chunk: ch, items: cs.chunks[ch] } : null;
    });
    if (cs.reviews) {
      const from = cs.reviews.from | 0;
      (cs.reviews.chunks || []).forEach((events, i) => { changes['reviews/r' + (from + i)] = { index: from + i, events }; });
      const total = cs.reviews.total | 0;
      Object.keys(parts || {}).forEach((k) => { if (k.startsWith('reviews/r') && Number(k.slice(9)) >= total) changes[k] = null; });
    }
    DOC_MAPS.forEach((m) => {
      Object.keys(cs[m] || {}).forEach((id) => { changes[m + '/' + id] = cs[m][id] == null ? null : { id, record: cs[m][id] }; });
    });
    return changes;
  }

  function write(cs) {
    return serial(() => {
      if (pending) throw new Error('An import is waiting for its check; nothing else is written until it is confirmed or reverted.');
      if (!manifest) throw new Error('There is no data yet. Start empty or import a backup first.');
      dailyBackupIfDue();
      if (cs.all) commitParts(stateToParts(cs.state), true);
      else commitParts(changesFromChangeset(cs), false);
      collectGarbage();
      return { generation: manifest.generation, writtenAt: manifest.written_at };
    });
  }

  // Replaces the whole state (import, restore, first start). The previous generation stays on disk until confirm(); revert() returns
  // to it. The written files are read back from disk, so the caller can check that what is stored equals what it sent.
  function replaceAll(state, reason) {
    return serial(() => {
      if (pending) throw new Error('Another import is waiting for its check.');
      let backup = null;
      if (manifest) backup = makeBackup('before-' + (reason || 'import'));
      const previous = commitParts(stateToParts(state), true);
      pending = { manifest, previous };
      const v = verifyManifest(manifest);
      if (!v.ok) return { ok: false, problems: v.problems, backup, generation: manifest.generation };
      return { ok: true, state: partsToState(v.parts), backup, generation: manifest.generation };
    });
  }

  function confirm(generation) {
    return serial(() => {
      if (!pending || pending.manifest.generation !== generation) throw new Error('Nothing to confirm for generation ' + generation + '.');
      pending = null;
      collectGarbage();
      return { generation: manifest.generation };
    });
  }

  // Back to the state before replaceAll. The rejected generation's files are kept in data\rejected-<time>\ for inspection.
  function revert(generation) {
    return serial(() => {
      if (!pending || pending.manifest.generation !== generation) throw new Error('Nothing to revert for generation ' + generation + '.');
      const rejected = pending.manifest, previous = pending.previous;
      const keepDir = path.join(dataDir, 'rejected-' + stamp(now()));
      fs.mkdirSync(keepDir, { recursive: true });
      for (const e of Object.values(rejected.files)) {
        const to = path.join(keepDir, e.file);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        try { fs.copyFileSync(path.join(dataDir, e.file), to); } catch (x) { /* missing */ }
      }
      fs.writeFileSync(path.join(keepDir, 'manifest.json'), JSON.stringify(rejected, null, 1));
      pending = null;
      if (previous) {
        writeFileSafe(prevFile(), JSON.stringify(rejected, null, 1));
        writeFileSafe(manifestFile(), JSON.stringify(previous, null, 1));
        manifest = previous;
        const v = verifyManifest(previous);
        parts = v.ok ? v.parts : {};
      } else {
        // there was no data before: back to an empty folder (the rejected files are in keepDir)
        for (const f of [manifestFile(), prevFile()]) { try { fs.unlinkSync(f); } catch (x) { /* none */ } }
        manifest = null; parts = null;
      }
      collectGarbage();
      return { generation: manifest ? manifest.generation : 0, keptIn: keepDir };
    });
  }

  // ---- backups
  function stamp(t) { return new Date(t).toISOString().replace(/[:]/g, '-').replace(/\.\d+Z$/, ''); }
  function currentStateJson() { return manifest ? JSON.stringify(partsToState(parts)) : null; }

  function makeBackup(reason) {
    const json = currentStateJson();
    if (json == null) return null;
    fs.mkdirSync(backupDir, { recursive: true });
    const safe = String(reason || 'manual').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'manual';
    let name = stamp(now()) + '_' + safe + '.json';
    for (let i = 2; fs.existsSync(path.join(backupDir, name)); i++) name = stamp(now()) + '_' + safe + '-' + i + '.json';
    writeFileSafe(path.join(backupDir, name), json);
    prune();
    return name;
  }

  function parseBackupName(name) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})_([a-z0-9-]+)\.json$/.exec(name);
    if (!m) return null;
    const at = Date.parse(m[1] + 'T' + m[2] + ':' + m[3] + ':' + m[4] + 'Z');
    const reason = m[5].replace(/-\d+$/, '');
    return { id: name, at, reason, day: m[1] };
  }

  function listBackups() {
    let names = [];
    try { names = fs.readdirSync(backupDir); } catch (e) { return []; }
    return names.map((n) => {
      const p = parseBackupName(n);
      if (!p) return null;
      let bytes = 0;
      try { bytes = fs.statSync(path.join(backupDir, n)).size; } catch (e) { /* gone */ }
      return Object.assign(p, { bytes });
    }).filter(Boolean).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  }

  function dailyBackupIfDue() {
    if (!manifest) return null;
    const today = new Date(now()).toISOString().slice(0, 10);
    if (listBackups().some((b) => b.reason === 'daily' && b.day === today)) return null;
    return makeBackup('daily');
  }

  // Keeps: the newest five of any kind; dailies of the last 14 days; one per ISO week (the newest daily) for 8 weeks; one per month
  // for 12 months; 'before-…' backups for 90 days. Deletes only backups this store names (parseBackupName) and never the newest daily.
  function prune() {
    const list = listBackups();
    const t = now();
    const keep = new Set(list.slice(0, 5).map((b) => b.id));
    const dailies = list.filter((b) => b.reason === 'daily' || b.reason === 'manual');
    if (dailies[0]) keep.add(dailies[0].id);
    dailies.forEach((b) => { if (t - b.at <= 14 * DAY) keep.add(b.id); });
    const weekSeen = new Set(), monthSeen = new Set();
    dailies.forEach((b) => {
      const d = new Date(b.at);
      const week = isoWeek(d);
      if (t - b.at <= 8 * 7 * DAY && !weekSeen.has(week)) { weekSeen.add(week); keep.add(b.id); }
      const month = b.day.slice(0, 7);
      if (t - b.at <= 366 * DAY && !monthSeen.has(month)) { monthSeen.add(month); keep.add(b.id); }
    });
    list.forEach((b) => { if (b.reason.startsWith('before-') || b.reason.startsWith('imported-')) { if (t - b.at <= 90 * DAY) keep.add(b.id); } });
    list.forEach((b) => { if (!keep.has(b.id)) { try { fs.unlinkSync(path.join(backupDir, b.id)); } catch (e) { /* ignore */ } } });
  }
  function isoWeek(d) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = x.getUTCDay() || 7;
    x.setUTCDate(x.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
    return x.getUTCFullYear() + '-W' + Math.ceil(((x - y0) / DAY + 1) / 7);
  }

  function readBackup(id) {
    if (!parseBackupName(id)) throw new Error('Unknown backup.');
    return fs.readFileSync(path.join(backupDir, id), 'utf8');
  }

  // A copy of an imported source file, so the file the owner picked is never needed again (and never written to)
  function keepImportSource(text, label) {
    fs.mkdirSync(backupDir, { recursive: true });
    const name = stamp(now()) + '_imported-' + (String(label || 'source').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 30) || 'source') + '.json';
    writeFileSafe(path.join(backupDir, name), text);
    return name;
  }

  function backupNow(reason) { return serial(() => makeBackup(reason || 'manual')); }

  return {
    load, write, replaceAll, confirm, revert, backupNow, listBackups, readBackup, keepImportSource, info, unlock,
    // for tests
    _paths: () => ({ dataDir, backupDir }), _manifest: () => manifest, _pending: () => pending, _prune: prune,
  };
}

module.exports = { createDataStore, stateToParts, partsToState, canonical, fileId, FORMAT, REVIEWS_PER_FILE, writeFileSafe };
