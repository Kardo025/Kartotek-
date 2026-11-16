'use strict';
// Development aid for PCs where Electron cannot start (Windows Smart App Control blocks the unsigned electron.exe, see PROGRESS C1):
// serves src\ to an ordinary browser with a stand-in for the desktop bridge. Every window.kartotek call goes over HTTP to this Node
// process, which runs the real main-process modules: desktop/content.js (content folder) and desktop/data.js through
// desktop/data-api.js (learner-data files, backups, import). Only the dialogs differ: "Import a backup file" reads the file named by
// KARTOTEK_PREVIEW_IMPORT (read only), and "save" writes into <profile>\exports\.
//
//   node scripts/bridge-preview.cjs [--persist | --profile <folder>] [--port 8770] [--content <folder>] [--import <backup file>]
// The profile defaults to a new temp folder, never the real %APPDATA%\Kartotek.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveAppPath, headersFor } = require('../desktop/serve');
const content = require('../desktop/content');
const data = require('../desktop/data');
const { makeDataApi } = require('../desktop/data-api');

const root = path.join(__dirname, '..');
const SRC = path.join(root, 'src');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
// --persist keeps one preview profile (%APPDATA%\Kartotek-preview), so settings, keys and jobs survive a restart
const profile = path.resolve(arg('--profile', process.argv.indexOf('--persist') > 0 ? path.join(process.env.APPDATA || os.homedir(), 'Kartotek-preview') : fs.mkdtempSync(path.join(os.tmpdir(), 'kartotek-preview-'))));
fs.mkdirSync(profile, { recursive: true });
const port = Number(arg('--port', 8770));
if (arg('--content')) process.env.KARTOTEK_CONTENT = path.resolve(arg('--content'));
if (arg('--import')) process.env.KARTOTEK_PREVIEW_IMPORT = path.resolve(arg('--import'));

let store = null;
const getStore = () => store || (store = data.createDataStore({ dir: profile, appVersion: 'preview' }));
const dataApi = makeDataApi(getStore);

function contentLoad() {
  const found = content.resolveContentDir({ settings: {}, env: process.env, dev: true, repoRoot: root });
  return content.loadContent({ contentDir: found.dir, contentFrom: found.from, missingDir: found.missing, samplesDir: path.join(root, 'samples') });
}

const RPC = {
  'app.info': async () => ({ ok: true, value: { version: 'preview', platform: process.platform, dev: true, electron: null } }),
  'content.load': async () => { try { return { ok: true, value: contentLoad() }; } catch (e) { return { ok: false, error: e.message }; } },
  'content.chooseFolder': async () => ({ ok: true, value: { changed: false } }),
  'content.openFolder': async () => ({ ok: false, error: 'Not available in the preview.' }),
  'data.pickImportFile': async () => {
    const f = process.env.KARTOTEK_PREVIEW_IMPORT;
    if (!f) return { ok: false, error: 'Set KARTOTEK_PREVIEW_IMPORT to a backup file to try the import in the preview.' };
    return { ok: true, value: { name: path.basename(f), text: fs.readFileSync(f, 'utf8') } };
  },
  'data.saveFile': async (name, text) => {
    const dir = path.join(profile, 'exports');
    fs.mkdirSync(dir, { recursive: true });
    data.writeFileSafe(path.join(dir, path.basename(name)), text);
    return { ok: true, value: { saved: true, name: path.basename(name) } };
  },
  'data.openFolder': async () => ({ ok: false, error: 'Not available in the preview. Profile: ' + profile }),
};
for (const k of ['load', 'info', 'write', 'replaceAll', 'confirm', 'revert', 'backupNow', 'listBackups', 'readBackup']) RPC['data.' + k] = (...a) => dataApi[k](...a);

// ---- the model layer, prompt files and writing jobs (tasks E1, E3), the same modules desktop/main.js uses.
// Keys: Electron's safeStorage is not available in plain Node, so the preview encrypts with Windows DPAPI for the current user
// (PowerShell ProtectedData; the key goes through stdin, never the command line). The blob format differs from safeStorage's, so
// use a profile of its own for the preview (--profile); the desktop app cannot read the preview's keys.bin and the other way round.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
function dpapi(mode, input) {
  const script = mode === 'protect'
    ? "Add-Type -AssemblyName System.Security; $i=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($i); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))"
    : "Add-Type -AssemblyName System.Security; $i=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($i); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('Windows DPAPI failed: ' + String(r.stderr || '').slice(0, 200));
  return r.stdout.replace(/\r?\n$/, '');
}
const { createModelService } = require('../desktop/models/service');
const { createPrompts } = require('../desktop/models/prompts');
const { toPlain } = require('../desktop/models/errors');
const { createJobService } = require('../desktop/jobs/service');
const { createChecks } = require('../desktop/jobs/engine');
const prompts = createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: profile });
const models = createModelService({
  dir: profile, prompts,
  encrypt: async (s) => Buffer.from(dpapi('protect', s), 'utf8'),
  decrypt: async (b) => dpapi('unprotect', b.toString('utf8')),
});
const jobEvents = []; let eventSeq = 0;
const jobs = createJobService({
  dir: profile, models, prompts, checks: createChecks(SRC), extract: require('../desktop/jobs/extract'),
  pipelines: { study: require('../desktop/jobs/study'), lesson: require('../desktop/jobs/lesson'), mock: require('../desktop/jobs/mock'), 'mind-read': require('../desktop/jobs/mind').read, 'mind-coach': require('../desktop/jobs/mind').coach, research: require('../desktop/jobs/research') },
  research: { status: () => models.searchStatus(), search: (q) => models.search(q), checkLink: (u) => require('../desktop/links').checkLink(u) },
  content: { dir: () => content.resolveContentDir({ settings: {}, env: process.env, dev: true, repoRoot: root }).dir },
  files: { rules: (n) => fs.readFileSync(path.join(root, path.basename(n)), 'utf8') },
  emit: (ev) => { jobEvents.push({ seq: ++eventSeq, ev }); if (jobEvents.length > 500) jobEvents.splice(0, jobEvents.length - 500); },
});
const wrap = (fn) => async (...a) => { try { return { ok: true, value: await fn(...a) } } catch (e) { const p = toPlain(e); return { ok: false, error: p.message, code: p.code, advice: p.advice }; } };
['config:publicConfig', 'status', 'saveProvider', 'clearKey', 'removeProvider', 'setSlot', 'setBudget', 'allowOverBudget', 'setPrice', 'listModels', 'cancel'].forEach((k) => {
  const [name, method] = k.indexOf(':') > 0 ? k.split(':') : [k, k];
  RPC['models.' + name] = wrap((...a) => models[method](...a));
});
RPC['models.setKey'] = wrap(async (id, key) => { await models.setKey(id, key); return models.publicConfig(); });
RPC['models.usage'] = wrap((m) => models.usageSummary(m));
RPC['models.run'] = wrap((callId, req) => models.run(req, { callId }));
RPC['models.test'] = wrap((callId, id, model) => models.test(id, model || '', { callId }));
['list', 'get', 'saveOverride', 'resetOverride', 'render'].forEach((k) => { RPC['prompts.' + k] = wrap((...a) => prompts[k](...a)); });
// The file picker: the Windows open dialog, shown by PowerShell on this desktop; the page gets tokens, as in the desktop app
const picked = new Map();
RPC['jobs.pickFiles'] = wrap(async (which) => {
  const filter = which === 'photos' ? 'Photos|*.jpg;*.jpeg;*.png;*.webp' : 'Sources|*.pdf;*.pptx;*.docx;*.txt;*.md;*.srt;*.vtt';
  const ps = "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect=$true; $d.Filter='" + filter + "'; $f=New-Object System.Windows.Forms.Form; $f.TopMost=$true; if($d.ShowDialog($f) -eq 'OK'){ $d.FileNames -join \"`n\" }";
  const r = spawnSync('powershell', ['-NoProfile', '-STA', '-Command', ps], { encoding: 'utf8', windowsHide: false });
  return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 40).map((p) => {
    const token = crypto.randomBytes(12).toString('hex');
    picked.set(token, p);
    return { token, name: path.basename(p), size: fs.statSync(p).size };
  });
});
function resolveReq(kind, req) {
  const out = JSON.parse(JSON.stringify(req || {}));
  const cdir = content.resolveContentDir({ settings: {}, env: process.env, dev: true, repoRoot: root }).dir;
  out.files = (req.files || []).map((t) => { const p = picked.get(String(t)); if (!p) throw new Error('Choose the file again.'); return p; });
  (req.sourceNames || []).forEach((n) => { const p = cdir && path.join(cdir, 'sources', path.basename(String(n))); if (!p || !fs.existsSync(p)) throw new Error(path.basename(String(n)) + ' is not in the sources folder.'); out.files.push(p); });
  delete out.sourceNames;
  if (kind === 'mind-read') out.views = (req.views || []).map((v) => Object.assign({}, v, { file: picked.get(String(v.token)), token: undefined }));
  return out;
}
RPC['jobs.list'] = wrap(() => jobs.list());
RPC['jobs.get'] = wrap((id) => jobs.get(String(id)));
RPC['jobs.create'] = wrap((kind, req, choice) => jobs.create(String(kind), resolveReq(String(kind), req), choice || null));
RPC['jobs.start'] = wrap((id, choice) => jobs.start(String(id), choice || undefined));
RPC['jobs.pause'] = wrap((id) => jobs.pause(String(id)));
RPC['jobs.skipFixes'] = wrap((id) => jobs.skipFixes(String(id)));
RPC['jobs.remove'] = wrap((id) => jobs.remove(String(id)));
// Live sessions on own files (task F4), as desktop/main.js does it
const liveFiles = require('../desktop/live').createLiveFiles({ dir: profile, extract: require('../desktop/jobs/extract') });
RPC['live.readFiles'] = wrap((sid, tokens) => liveFiles.read(String(sid), (tokens || []).map((t) => { const p = picked.get(String(t)); if (!p) throw new Error('Choose the file again.'); return p; })));
RPC['live.material'] = wrap((sid) => liveFiles.get(String(sid)));
RPC['research.status'] = wrap(() => models.searchStatus());
RPC['research.setKey'] = wrap(async (k) => { try { const st = await models.setSearchKey(String(k || '')); console.log('research: search key saved (' + new Date().toLocaleTimeString() + ')'); return st; } catch (e) { console.log('research: saving the search key failed: ' + (e && e.message)); throw e; } });
RPC['research.clearKey'] = wrap(() => models.clearSearchKey());
RPC['jobs.openFolder'] = wrap(async () => { throw new Error('Not available in the preview. Profile: ' + profile); });
RPC['jobs.events'] = async (since) => ({ ok: true, value: { next: eventSeq, events: jobEvents.filter((x) => x.seq > (Number(since) || 0)).map((x) => x.ev) } });
// Only this page may call the bridge: every call carries a token that the page gets with the shim
// Kept in the preview profile, so a page that stays open across a restart of the preview keeps working
const RPC_TOKEN = (() => {
  const f = path.join(profile, 'preview-token');
  try { const t = fs.readFileSync(f, 'utf8').trim(); if (/^[0-9a-f]{32}$/.test(t)) return t; } catch (e) { /* first start */ }
  const t = crypto.randomBytes(16).toString('hex');
  try { fs.writeFileSync(f, t); } catch (e) { /* the token then lasts for this run only */ }
  return t;
})();

const SHIM = `/* bridge-preview: stand-in for desktop/preload.js */
(function () {
  function call(fn) { return function () { var args = Array.prototype.slice.call(arguments);
    return fetch('/__rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kartotek-Token': '${RPC_TOKEN}' }, body: JSON.stringify({ fn: fn, args: args }) }).then(function (r) { if (r.status === 403) return { ok: false, error: 'The preview refused this page (it was opened before the preview restarted). Reload the page.' }; return r.json(); }, function () { return { ok: false, error: 'The preview is not running.' }; }); }; }
  var api = { app: { info: call('app.info') },
    content: { load: call('content.load'), chooseFolder: call('content.chooseFolder'), openFolder: call('content.openFolder'), onChanged: function () { return function () {}; } },
    data: { onFlushRequest: function () { return function () {}; } } };
  ${JSON.stringify(Object.keys(RPC).filter((k) => k.startsWith('data.')).map((k) => k.slice(5)))}.forEach(function (n) { api.data[n] = call('data.' + n); });
  var M = ${JSON.stringify(Object.keys(RPC).filter((k) => k.startsWith('models.')).map((k) => k.slice(7)))};
  api.models = {}; M.forEach(function (n) { api.models[n] = call('models.' + n); });
  var run = call('models.run'), test = call('models.test');
  api.models.run = function (id, req) { return run(id, req); };
  api.models.test = function (id, p, m) { return test(id, p, m); };
  api.prompts = {}; ['list', 'get', 'saveOverride', 'resetOverride', 'render'].forEach(function (n) { api.prompts[n] = call('prompts.' + n); });
  api.jobs = {}; ['pickFiles', 'list', 'get', 'create', 'start', 'pause', 'skipFixes', 'remove', 'openFolder'].forEach(function (n) { api.jobs[n] = call('jobs.' + n); });
  api.live = { readFiles: call('live.readFiles'), material: call('live.material') };
  api.research = { status: call('research.status'), setKey: call('research.setKey'), clearKey: call('research.clearKey') };
  var ev = call('jobs.events'), cursor = 0, listeners = [];
  setInterval(function () {
    if (!listeners.length) return;
    ev(cursor).then(function (r) { if (!r || !r.ok) return; cursor = r.value.next; r.value.events.forEach(function (e) { listeners.forEach(function (l) { try { l(e); } catch (x) {} }); }); });
  }, 1500);
  api.jobs.onEvent = function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (l) { return l !== cb; }); }; };
  window.kartotek = api;
})();`;

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/__rpc') {
      let body = '';
      for await (const chunk of req) body += chunk;
      if (req.headers['x-kartotek-token'] !== RPC_TOKEN) { console.log('refused a call from a page opened before this preview started (reload that page)'); res.writeHead(403); res.end('forbidden'); return; }
      const { fn, args } = JSON.parse(body);
      const out = RPC[fn] ? await RPC[fn](...(args || [])) : { ok: false, error: 'unknown call ' + fn };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    }
    if (url.pathname === '/__bridge.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(SHIM); return; }
    const file = resolveAppPath(SRC, url.pathname);
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
    let body = fs.readFileSync(file);
    if (file.endsWith('index.html')) body = Buffer.from(body.toString('utf8').replace('<script src="host.js"></script>', '<script src="/__bridge.js"></script><script src="host.js"></script>'));
    res.writeHead(200, headersFor(file, file.endsWith('.html') ? body.toString('utf8') : ''));
    res.end(body);
  } catch (e) { res.writeHead(500); res.end(String(e && e.message)); }
}).listen(port, '127.0.0.1', () => console.log('Kartotek bridge preview on http://127.0.0.1:' + port + '/  (profile: ' + profile + ')'));
