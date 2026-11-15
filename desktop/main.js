'use strict';
// Kartotek desktop shell (task C1). Loads the existing engine and UI from src\ through the app://kartotek/ protocol.
// Content is read from the content folder at run time (task C2, desktop/content.js); learner data lives in files in the profile's
// data folder with dated backups (task C3, desktop/data.js).
// Security settings follow ARCHITECTURE.md section 2.4.
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { resolveAppPath, headersFor, externalUrlAllowed } = require('./serve');
const content = require('./content');
const data = require('./data');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ORIGIN = 'app://kartotek';
const DEV = !app.isPackaged;
const WATCH = DEV && process.env.KARTOTEK_DEV === '1';

app.setName('Kartotek');
// Development runs use their own profile (decision 15); KARTOTEK_USER_DATA overrides it (tests use a temp folder).
if (process.env.KARTOTEK_USER_DATA) app.setPath('userData', path.resolve(process.env.KARTOTEK_USER_DATA));
else if (DEV) app.setPath('userData', path.join(app.getPath('appData'), 'Kartotek-dev'));

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'kcontent', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// One window at a time, so two windows never write the same data
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;

// ---- settings (%APPDATA%\Kartotek\settings.json): the content folder the owner chose. Written atomically (temp file, then rename).
function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; } catch (e) { return {}; }
}
function writeSettings(obj) {
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// ---- content folder: where it is, what it holds, and a watcher that tells the window when it changed on disk
// the installer keeps the samples as plain files next to app.asar (electron-builder.yml, asarUnpack)
const SAMPLES = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'samples') : path.join(ROOT, 'samples');
let contentWatcher = null;
let contentWatchTimer = null;

function currentContent() {
  return content.resolveContentDir({ settings: readSettings(), env: process.env, dev: DEV, repoRoot: ROOT, defaultDir: path.join(app.getPath('documents'), 'Kartotek Content') });
}

function watchContent(dir) {
  if (contentWatcher) { try { contentWatcher.close(); } catch (e) { /* ignore */ } contentWatcher = null; }
  if (!dir) return;
  try {
    contentWatcher = fs.watch(dir, { recursive: true }, (event, name) => {
      if (!name || !/\.(json|jpe?g|png|webp|gif)$/i.test(name)) return;
      clearTimeout(contentWatchTimer);
      // never reload by itself: the window shows "Content changed" and the owner decides when
      contentWatchTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('content:changed'); }, 800);
    });
  } catch (e) { console.warn('Content watching is off:', e.message); }
}

function openExternal(url) {
  if (externalUrlAllowed(url)) shell.openExternal(url).catch(() => {});
}

function isOwnFrame(event) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  return url === ORIGIN || url.startsWith(ORIGIN + '/');
}

async function serveApp(request) {
  const url = new URL(request.url);
  if (url.host !== 'kartotek') return new Response('Not found', { status: 404 });
  const file = resolveAppPath(SRC, url.pathname);
  if (!file) return new Response('Forbidden', { status: 403 });
  try {
    const body = await fs.promises.readFile(file);
    const isHtml = file.toLowerCase().endsWith('.html');
    return new Response(body, { status: 200, headers: headersFor(file, isHtml ? body.toString('utf8') : '') });
  } catch (e) {
    return new Response('Not found', { status: 404 });
  }
}

// kcontent://mindmaps/<id>/<file>: mind-map photos from the content folder, inside that map's folder only
async function servePhoto(request) {
  const url = new URL(request.url);
  const found = currentContent();
  const hit = content.resolvePhoto(found.dir, url.hostname, url.pathname);
  if (!hit) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.promises.readFile(hit.file);
    return new Response(body, { status: 200, headers: { 'Content-Type': hit.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (e) {
    return new Response('Not found', { status: 404 });
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: 'Kartotek',
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    if (closeConfirmed) return;
    e.preventDefault();
    win.webContents.send('data:flush-request');
    setTimeout(() => { if (win && !win.isDestroyed()) { closeConfirmed = true; win.close(); } }, 4000);
  });
  win.on('closed', () => { win = null; });

  const wc = win.webContents;
  // Navigation stays inside the app; links to the web and claude:// go to the operating system
  wc.on('will-navigate', (e, url) => {
    if (url === ORIGIN || url.startsWith(ORIGIN + '/')) return;
    e.preventDefault();
    openExternal(url);
  });
  wc.on('will-redirect', (e, url) => { if (!url.startsWith(ORIGIN + '/')) e.preventDefault(); });
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  wc.on('will-attach-webview', (e) => e.preventDefault());

  win.loadURL(ORIGIN + '/index.html');
}

// Live reload while editing: `vite build --watch` rewrites src\ui.js and src\ui.css, and any change under src\ reloads the window
function watchSources() {
  let timer = null;
  try {
    fs.watch(SRC, { recursive: true }, (event, name) => {
      if (!name || !/\.(js|css|html)$/i.test(name)) return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache(); }, 350);
    });
  } catch (e) { console.warn('Live reload is off:', e.message); }
}

function buildMenu() {
  if (!DEV) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'App', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'quit' }] },
  ]));
}

ipcMain.handle('content:load', (event) => {
  if (!isOwnFrame(event)) return { ok: false, error: 'forbidden' };
  try {
    const found = currentContent();
    watchContent(found.dir);
    const value = content.loadContent({ contentDir: found.dir, contentFrom: found.from, missingDir: found.missing, samplesDir: SAMPLES });
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('content:chooseFolder', async (event) => {
  if (!isOwnFrame(event)) return { ok: false, error: 'forbidden' };
  const found = currentContent();
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose the Kartotek content folder',
    defaultPath: found.dir || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: true, value: { changed: false } };
  writeSettings(Object.assign(readSettings(), { contentDir: r.filePaths[0] }));
  return { ok: true, value: { changed: true, contentDir: r.filePaths[0] } };
});

ipcMain.handle('content:openFolder', async (event) => {
  if (!isOwnFrame(event)) return { ok: false, error: 'forbidden' };
  const found = currentContent();
  if (!found.dir) return { ok: false, error: 'No content folder is set.' };
  const err = await shell.openPath(found.dir);
  return err ? { ok: false, error: err } : { ok: true, value: null };
});

// ---- learner data in files (task C3, ARCHITECTURE.md section 4). The window never writes files itself; every call is checked here.
let dataStore = null;
function store() {
  if (!dataStore) dataStore = data.createDataStore({ dir: app.getPath('userData'), appVersion: app.getVersion() });
  return dataStore;
}
const { makeDataApi, MAX_IMPORT_BYTES, isText } = require('./data-api');
const dataApi = makeDataApi(store);

// Registers a handler that checks the sender frame; fn returns a value (wrapped as { ok, value }) or throws
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isOwnFrame(event)) return { ok: false, error: 'forbidden' };
    try { return { ok: true, value: await fn(...args) }; } catch (e) { return { ok: false, error: e.message }; }
  });
}
// The data calls shared with the tests (desktop/data-api.js) already return { ok, value }
for (const name of ['load', 'info', 'write', 'replaceAll', 'confirm', 'revert', 'backupNow', 'listBackups', 'readBackup']) {
  ipcMain.handle('data:' + name, (event, ...args) => (isOwnFrame(event) ? dataApi[name](...args) : { ok: false, error: 'forbidden' }));
}
// Picks a backup file to import. The file is only read, never written.
handle('data:pickImportFile', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import a Kartotek backup', properties: ['openFile'], filters: [{ name: 'Kartotek backup', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const st = await fs.promises.stat(file);
  if (st.size > MAX_IMPORT_BYTES) throw new Error('The file is larger than 512 MB.');
  return { name: path.basename(file), text: await fs.promises.readFile(file, 'utf8') };
});
// Export and other downloads: a save dialog, then a safe write
handle('data:saveFile', async (name, text) => {
  if (typeof name !== 'string' || !isText(text)) throw new Error('Invalid file.');
  const safeName = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'kartotek-file.json';
  const r = await dialog.showSaveDialog(win, { title: 'Save', defaultPath: path.join(app.getPath('documents'), safeName) });
  if (r.canceled || !r.filePath) return { saved: false };
  data.writeFileSafe(r.filePath, text);
  return { saved: true, name: path.basename(r.filePath) };
});
handle('data:openFolder', async (which) => {
  const p = store()._paths();
  const dir = which === 'backups' ? p.backupDir : p.dataDir;
  fs.mkdirSync(dir, { recursive: true });
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
  return null;
});

// Before the window closes, it writes what is still pending (at most a few seconds)
let closeConfirmed = false;
ipcMain.on('data:flushed', (event) => {
  if (!isOwnFrame(event) || !win || win.isDestroyed()) return;
  closeConfirmed = true;
  win.close();
});

ipcMain.handle('app:info', (event) => {
  if (!isOwnFrame(event)) return { ok: false, error: 'forbidden' };
  return { ok: true, value: { version: app.getVersion(), platform: process.platform, dev: DEV, electron: process.versions.electron } };
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (dataStore) dataStore.unlock(); });

app.whenReady().then(() => {
  protocol.handle('app', serveApp);
  protocol.handle('kcontent', servePhoto);
  // The window asks for no device or notification permissions
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  buildMenu();
  createWindow();
  if (WATCH) watchSources();
});
