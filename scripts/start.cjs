'use strict';
// `npm start`: build the UI once, keep `vite build --watch` running (it copies every rebuild to src\), and open the desktop window,
// which reloads itself when anything under src\ changes. Closing the window stops everything.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ui = path.join(root, 'ui');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function fail(msg) { console.error('\n' + msg + '\n'); process.exit(1); }

if (!fs.existsSync(path.join(ui, 'node_modules'))) {
  console.log('Installing the UI dependencies (first run)...');
  const r = spawnSync(npm, ['--prefix', 'ui', 'ci'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail('npm ci in ui\\ failed.');
}

console.log('Building the UI...');
const first = spawnSync(npm, ['--prefix', 'ui', 'run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (first.status !== 0) fail('The UI build failed.');

const vite = path.join(ui, 'node_modules', 'vite', 'bin', 'vite.js');
const watcher = spawn(process.execPath, [vite, 'build', '--watch'], {
  cwd: ui,
  stdio: 'inherit',
  env: Object.assign({}, process.env, { KARTOTEK_WATCH_COPY: '1' }),
});

let electronPath;
try { electronPath = require('electron'); } catch (e) { watcher.kill(); fail('Electron is not installed. Run: npm ci'); }

function stop(code) {
  try { watcher.kill(); } catch (e) { /* already gone */ }
  process.exit(code);
}
function cannotStart(e) {
  let hint = '';
  if (e && (e.code === 'UNKNOWN' || e.code === 'EACCES' || e.code === 'EPERM')) {
    hint = '\nWindows refused to start electron.exe. If "Smart App Control" is on (Windows Security > App & browser control), it blocks unsigned apps such as the Electron binary. See docs/PROGRESS.md (task C1).';
  }
  console.error('Could not start Electron: ' + (e && e.message) + hint);
  stop(1);
}

const env = Object.assign({}, process.env, { KARTOTEK_DEV: '1' });
delete env.ELECTRON_RUN_AS_NODE; // when set, electron.exe behaves like plain Node and opens no window
let app;
try {
  app = spawn(electronPath, ['.'], { cwd: root, stdio: 'inherit', env });
} catch (e) {
  cannotStart(e); // on Windows spawn can throw instead of emitting "error"
}
app.on('error', cannotStart);
app.on('exit', (code) => stop(code || 0));
process.on('SIGINT', () => { try { app.kill(); } catch (e) { /* ignore */ } stop(0); });
