'use strict';
// Installer check for CI (Windows). It installs the built installer silently into a temporary folder, installs it again over the
// first install (an update), runs the smoke test against the INSTALLED app, uninstalls it, and at every step checks that a sentinel
// file in the real user-data folder (%APPDATA%\Kartotek) is untouched. It also checks that the install is per user.
//
// It writes to the real %APPDATA%\Kartotek, so it only runs on a CI runner (CI=true); on a personal PC it refuses to start.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const installer = path.join(root, 'dist-installer', 'Kartotek-Setup-' + version + '.exe');

if (process.platform !== 'win32') { console.log('The installer check runs on Windows only.'); process.exit(0); }
if (process.env.CI !== 'true') {
  console.error('Refusing to run: this check writes to %APPDATA%\\Kartotek, the folder that holds the real learner data. It runs on CI only.');
  process.exit(2);
}
if (!fs.existsSync(installer)) { console.error('Installer not found: ' + installer); process.exit(1); }

const problems = [];
const userData = path.join(process.env.APPDATA, 'Kartotek');
const sentinelDir = path.join(userData, 'data');
const sentinel = path.join(sentinelDir, 'installer-check-sentinel.txt');
const sentinelText = 'sentinel ' + crypto.randomBytes(8).toString('hex');
const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kartotek-install-')), 'Kartotek');

function sentinelOk(step) {
  let text = null;
  try { text = fs.readFileSync(sentinel, 'utf8'); } catch (e) { /* missing */ }
  if (text !== sentinelText) problems.push('the user-data sentinel was changed or removed ' + step);
  else console.log('  user data untouched ' + step);
}
function run(file, args, label) {
  const r = spawnSync(file, args, { encoding: 'utf8', timeout: 240000, windowsHide: true });
  if (r.error || r.status !== 0) problems.push(label + ' failed: ' + (r.error ? r.error.message : 'exit ' + r.status));
  return r;
}
function reg(hive) {
  // exit 0 when an uninstall entry that mentions Kartotek exists in that hive
  return spawnSync('reg', ['query', hive + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', 'Kartotek'], { encoding: 'utf8' }).status === 0;
}

fs.mkdirSync(sentinelDir, { recursive: true });
fs.writeFileSync(sentinel, sentinelText);
console.log('Installing ' + path.basename(installer) + ' into ' + target);

// NSIS: /S is silent, /D= sets the folder and must be the last argument without quotes
run(installer, ['/S', '/D=' + target], 'install');
const exe = path.join(target, 'Kartotek.exe');
if (!fs.existsSync(exe)) problems.push('Kartotek.exe is not in the install folder');
if (!fs.existsSync(path.join(target, 'resources', 'app.asar'))) problems.push('app.asar is not in the install folder');
if (!fs.existsSync(path.join(target, 'resources', 'app.asar.unpacked', 'samples'))) problems.push('the samples are not next to app.asar');
for (const f of ['LICENSE.txt', 'THIRD-PARTY-NOTICES.md']) if (!fs.existsSync(path.join(target, 'resources', f))) problems.push(f + ' is not shipped');
sentinelOk('after the first install');
if (!reg('HKCU')) problems.push('no uninstall entry for the current user (the install is not per user)');
if (reg('HKLM')) problems.push('an uninstall entry was written for the whole machine');

console.log('Installing again over the first install (an update)');
run(installer, ['/S', '/D=' + target], 'update');
if (!fs.existsSync(exe)) problems.push('Kartotek.exe is missing after the update');
sentinelOk('after the update');

console.log('Smoke test of the installed app');
const smoke = spawnSync(process.execPath, [path.join(__dirname, 'smoke.cjs')], { cwd: root, stdio: 'inherit', env: Object.assign({}, process.env, { KARTOTEK_APP_EXE: exe }), timeout: 600000 });
if (smoke.status !== 0) problems.push('the smoke test of the installed app failed');
sentinelOk('after running the installed app');

console.log('Uninstalling');
const uninstaller = path.join(target, 'Uninstall Kartotek.exe');
if (!fs.existsSync(uninstaller)) problems.push('no uninstaller in the install folder');
else run(uninstaller, ['/S', '_?=' + target], 'uninstall'); // _?= keeps the call synchronous
if (fs.existsSync(exe)) problems.push('Kartotek.exe is still there after the uninstall');
sentinelOk('after the uninstall');

try { fs.unlinkSync(sentinel); } catch (e) { /* the runner is thrown away anyway */ }
if (problems.length) { console.log('FAILED:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('Installer check passed: per-user install, update and uninstall leave the user-data folder untouched; the installed app passes the smoke test.');
