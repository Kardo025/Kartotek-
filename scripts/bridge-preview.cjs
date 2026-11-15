'use strict';
// Development aid for PCs where Electron cannot start (Windows Smart App Control blocks the unsigned electron.exe, see PROGRESS C1):
// serves src\ to an ordinary browser with a stand-in for the desktop bridge. Every window.kartotek call goes over HTTP to this Node
// process, which runs the real main-process modules: desktop/content.js (content folder) and desktop/data.js through
// desktop/data-api.js (learner-data files, backups, import). Only the dialogs differ: "Import a backup file" reads the file named by
// KARTOTEK_PREVIEW_IMPORT (read only), and "save" writes into <profile>\exports\.
//
//   node scripts/bridge-preview.cjs [--profile <folder>] [--port 8770] [--content <folder>] [--import <backup file>]
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
const profile = path.resolve(arg('--profile', fs.mkdtempSync(path.join(os.tmpdir(), 'kartotek-preview-'))));
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

const SHIM = `/* bridge-preview: stand-in for desktop/preload.js */
(function () {
  function call(fn) { return function () { var args = Array.prototype.slice.call(arguments);
    return fetch('/__rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: fn, args: args }) }).then(function (r) { return r.json(); }); }; }
  var api = { app: { info: call('app.info') },
    content: { load: call('content.load'), chooseFolder: call('content.chooseFolder'), openFolder: call('content.openFolder'), onChanged: function () { return function () {}; } },
    data: { onFlushRequest: function () { return function () {}; } } };
  ${JSON.stringify(Object.keys(RPC).filter((k) => k.startsWith('data.')).map((k) => k.slice(5)))}.forEach(function (n) { api.data[n] = call('data.' + n); });
  window.kartotek = api;
})();`;

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/__rpc') {
      let body = '';
      for await (const chunk of req) body += chunk;
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
