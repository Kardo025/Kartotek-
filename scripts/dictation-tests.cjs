// Dictation tests (task F8): desktop\dictation.js with a stand-in helper process. No real key is pressed.
'use strict';
const assert = require('assert');
const { EventEmitter } = require('events');
const { createDictation, HELPER } = require('../desktop/dictation');

// A stand-in for the PowerShell helper: answers "ready", then "ok" to each "winh"
function fakeSpawn(opts) {
  const o = opts || {};
  const log = { spawns: 0, lines: [], args: null };
  const spawn = (cmd, args) => {
    log.spawns++; log.args = [cmd].concat(args);
    const p = new EventEmitter();
    p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
    p.stdin = { write: (s) => { s.split('\n').filter(Boolean).forEach((l) => { log.lines.push(l); if (!o.silent) setImmediate(() => p.stdout.emit('data', Buffer.from('ok\r\n'))); }); }, end: () => {} };
    p.kill = () => setImmediate(() => p.emit('exit', 0));
    setImmediate(() => { if (o.fail) { p.stderr.emit('data', Buffer.from('Add-Type : blocked\n')); p.emit('exit', 1); } else p.stdout.emit('data', Buffer.from('ready\r\n')); });
    log.proc = p;
    return p;
  };
  return { spawn, log };
}

async function t(ok, name, fn) { await fn(); ok.push(name); }

async function dictationTests() {
  const ok = [];
  await t(ok, 'only on Windows: elsewhere the status says why and start refuses (the button then shows the shortcut)', async () => {
    const d = createDictation({ platform: 'linux', spawn: () => { throw new Error('no spawn'); } });
    assert.strictEqual(d.status().mode, null);
    await assert.rejects(d.start(), /only on Windows/);
  });
  await t(ok, 'start presses Win + H once through one helper that is reused (one process for two presses)', async () => {
    const f = fakeSpawn(), d = createDictation({ platform: 'win32', spawn: f.spawn });
    assert.strictEqual(d.status().mode, 'voice-typing');
    await d.start(); await d.start();
    assert.strictEqual(f.log.spawns, 1);
    assert.deepStrictEqual(f.log.lines, ['winh', 'winh']);
    assert.ok(f.log.args.includes('-EncodedCommand') && f.log.args.includes('-NoProfile'));
    d.stop();
  });
  await t(ok, 'never presses keys while the Kartotek window is not in front', async () => {
    const f = fakeSpawn(), d = createDictation({ platform: 'win32', spawn: f.spawn, isFocused: () => false });
    await assert.rejects(d.start(), /front/);
    assert.strictEqual(f.log.lines.length, 0);
  });
  await t(ok, 'a helper that cannot start is reported (with its last error line) and the next press starts a new one', async () => {
    const bad = fakeSpawn({ fail: true }), d = createDictation({ platform: 'win32', spawn: bad.spawn });
    await assert.rejects(d.start(), /Could not start voice typing: Add-Type : blocked/);
    assert.strictEqual(bad.log.lines.length, 0);
  });
  await t(ok, 'a helper that stops answering times out instead of hanging', async () => {
    const f = fakeSpawn({ silent: true }), d = createDictation({ platform: 'win32', spawn: f.spawn, timeoutMs: 60 });
    await assert.rejects(d.start(), /did not answer in time/);
    d.stop();
  });
  await t(ok, 'the helper only knows one command (Win + H) and is compiled once', async () => {
    assert.ok(/keybd_event\(0x5B/.test(HELPER) && /keybd_event\(0x48/.test(HELPER));
    assert.strictEqual((HELPER.match(/if \(\$line -eq/g) || []).length, 1);
    assert.strictEqual((HELPER.match(/Add-Type/g) || []).length, 1);
  });
  return ok;
}

async function run() {
  const ok = await dictationTests();
  return ['Dictation (stand-in helper): ' + ok.length + '/' + ok.length + ' passed'];
}
module.exports = { run };
if (require.main === module) run().then((l) => l.forEach((x) => console.log(x)), (e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
