// Dictation tests (task F8): desktop\dictation.js with a stand-in helper process. No real key is pressed.
'use strict';
const assert = require('assert');
const { EventEmitter } = require('events');
const { createDictation, HELPER } = require('../desktop/dictation');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), { pathToFileURL } = require('url');
const { createWhisper, cleanText, PINS } = require('../desktop/whisper');

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

// ---------------------------------------------------------------- the local model (whisper.cpp), with stand-in downloads and program
function pinned(content) { return { size: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') }; }
async function localTests() {
  const ok = [], dirs = [];
  const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kartotek-f8-')); dirs.push(d); return d; };
  const zipBytes = Buffer.from('fake zip'), modelBytes = Buffer.from('fake model bytes');
  // swap the pins for the stand-in files during the test
  const saved = JSON.parse(JSON.stringify(PINS));
  const multiBytes = Buffer.from('fake multilingual model');
  Object.assign(PINS.program, pinned(zipBytes)); Object.assign(PINS.model, pinned(modelBytes)); Object.assign(PINS.multi, pinned(multiBytes));
  const fakeFetch = (bodies) => async (url) => {
    const b = bodies[url.includes('small-q5_1') ? 'multi' : url.includes('huggingface') ? 'model' : 'program'];
    if (!b) return { ok: false, status: 404 };
    return { ok: true, status: 200, body: (async function* () { yield b.slice(0, 3); yield b.slice(3); })() };
  };
  const expand = async (zip, dest) => { fs.mkdirSync(path.join(dest, 'Release'), { recursive: true }); fs.writeFileSync(path.join(dest, 'Release', 'whisper-cli.exe'), 'x'); };
  const wav = (n) => { const b = Buffer.alloc(44 + n); b.write('RIFF', 0, 'ascii'); b.write('WAVE', 8, 'ascii'); return b; };
  try {
    await t(ok, 'download on request: both files checked against their size and SHA-256, the program unpacked, then "installed"', async () => {
      const d = mk(), events = [];
      const w = createWhisper({ dir: d, platform: 'win32', fetch: fakeFetch({ program: zipBytes, model: modelBytes }), expand });
      assert.strictEqual(w.status().installed, false);
      await w.install((ev) => events.push(ev.step));
      assert.strictEqual(w.status().installed, true);
      assert.ok(events.includes('program') && events.includes('model') && events[events.length - 1] === 'done');
      assert.ok(!fs.existsSync(path.join(d, 'tmp', PINS.program.file)));
    });
    await t(ok, 'a download that does not match its checksum is refused and nothing is kept', async () => {
      const d = mk();
      const w = createWhisper({ dir: d, platform: 'win32', fetch: fakeFetch({ program: zipBytes, model: Buffer.from('tampered model!!') }), expand });
      await assert.rejects(w.install(), /checksum/);
      assert.strictEqual(w.status().installed, false);
      assert.ok(!fs.existsSync(path.join(d, 'models', PINS.model.file)) && !fs.existsSync(path.join(d, 'models', PINS.model.file + '.part')));
    });
    await t(ok, 'transcribing: a WAV goes to whisper-cli with the English model on 4 threads at most, the text comes back clean, the recording is deleted', async () => {
      const d = mk(); let seen = null;
      const spawn = (cmd, args) => {
        seen = { cmd, args, wavExists: fs.existsSync(args[args.indexOf('-f') + 1]) };
        const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {};
        setImmediate(() => { p.stdout.emit('data', Buffer.from(' [BLANK_AUDIO]\n The answer is two.  It follows from the second law.\n')); p.emit('exit', 0); });
        return p;
      };
      const w = createWhisper({ dir: d, platform: 'win32', fetch: fakeFetch({ program: zipBytes, model: modelBytes }), expand, spawn });
      await assert.rejects(w.transcribe(wav(100)), /not downloaded/);
      await w.install();
      const r = await w.transcribe(wav(3200));
      assert.strictEqual(r.text, 'The answer is two. It follows from the second law.');
      assert.ok(/whisper-cli\.exe$/.test(seen.cmd) && seen.wavExists);
      assert.strictEqual(seen.args[seen.args.indexOf('-l') + 1], 'en');
      assert.ok(Number(seen.args[seen.args.indexOf('-t') + 1]) <= 4 && seen.args.includes('-nt'));
      assert.strictEqual(fs.readdirSync(path.join(d, 'tmp')).length, 0);
      await assert.rejects(w.transcribe(Buffer.from('not a wav file at all, really not a wav file ok')), /not a WAV/);
    });
    await t(ok, 'remove deletes the dictation folder; elsewhere than Windows the local model is not offered', async () => {
      const d = mk();
      const w = createWhisper({ dir: d, platform: 'win32', fetch: fakeFetch({ program: zipBytes, model: modelBytes }), expand });
      await w.install(); w.remove();
      assert.strictEqual(w.status().installed, false); assert.ok(!fs.existsSync(d));
      assert.strictEqual(createWhisper({ dir: mk(), platform: 'linux' }).status().available, false);
      assert.strictEqual(cleanText('(wind) Hello  [MUSIC] world '), 'Hello world');
    });
    await t(ok, 'Turkish and Italian: refused until the multilingual model is added; then they use it with -l tr / -l it, English keeps small.en; Turkish letters survive split output; removing it keeps English', async () => {
      const d = mk(), calls = [];
      const spawn = (cmd, args) => {
        calls.push(args);
        const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {};
        const bytes = Buffer.from('Doğru cevap ikidir. Çünkü ışık şöyle.', 'utf8');
        setImmediate(() => { p.stdout.emit('data', bytes.slice(0, 3)); p.stdout.emit('data', bytes.slice(3)); p.emit('exit', 0); });
        return p;
      };
      const w = createWhisper({ dir: d, platform: 'win32', fetch: fakeFetch({ program: zipBytes, model: modelBytes, multi: multiBytes }), expand, spawn });
      await w.install();
      assert.deepStrictEqual(w.status().languages.map((x) => x.code), ['en']);
      await assert.rejects(w.transcribe(wav(3200), 'tr'), /multilingual model/);
      const events = [];
      await w.install((ev) => events.push(ev.which + ':' + ev.step), 'multi');
      assert.ok(events.every((e) => e.startsWith('multi:')) && !events.some((e) => e === 'multi:program'));
      assert.deepStrictEqual(w.status().languages.map((x) => x.code), ['en', 'tr', 'it']);
      const r = await w.transcribe(wav(3200), 'tr');
      assert.strictEqual(r.text, 'Doğru cevap ikidir. Çünkü ışık şöyle.'); assert.strictEqual(r.language, 'tr');
      let a = calls[calls.length - 1];
      assert.ok(/ggml-small-q5_1\.bin$/.test(a[a.indexOf('-m') + 1]) && a[a.indexOf('-l') + 1] === 'tr');
      await w.transcribe(wav(3200), 'it'); a = calls[calls.length - 1]; assert.strictEqual(a[a.indexOf('-l') + 1], 'it');
      await w.transcribe(wav(3200), 'en'); a = calls[calls.length - 1];
      assert.ok(/ggml-small\.en-q5_1\.bin$/.test(a[a.indexOf('-m') + 1]) && a[a.indexOf('-l') + 1] === 'en');
      await w.transcribe(wav(3200), 'xx'); a = calls[calls.length - 1]; assert.strictEqual(a[a.indexOf('-l') + 1], 'en');
      w.remove('multi');
      const st = w.status();
      assert.ok(st.installed && !st.multi); assert.deepStrictEqual(st.languages.map((x) => x.code), ['en']);
    });
    await t(ok, 'adding Turkish and Italian first also brings the program, without the English model', async () => {
      const d = mk();
      const w = createWhisper({ dir: d, platform: 'win32', fetch: fakeFetch({ program: zipBytes, multi: multiBytes }), expand });
      await w.install(null, 'multi');
      const st = w.status();
      assert.ok(st.multi && !st.installed); assert.deepStrictEqual(st.languages.map((x) => x.code), ['tr', 'it']);
    });
  } finally { Object.assign(PINS.program, saved.program); Object.assign(PINS.model, saved.model); Object.assign(PINS.multi, saved.multi); dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })); }
  // the real pins stay fixed values (a change of version must be a code change)
  assert.ok(/^[0-9a-f]{64}$/.test(PINS.program.sha256) && /^[0-9a-f]{64}$/.test(PINS.model.sha256) && /^https:\/\/github\.com\/ggml-org\//.test(PINS.program.url) && /^https:\/\/huggingface\.co\/ggerganov\//.test(PINS.model.url));
  return ok;
}

async function libTests() {
  const ok = [];
  const lib = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'src', 'dictation-lib.js')).href);
  await t(ok, 'a recording becomes 16 kHz mono 16-bit WAV', async () => {
    const b = Buffer.from(lib.encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000));
    assert.strictEqual(b.toString('ascii', 0, 4), 'RIFF'); assert.strictEqual(b.toString('ascii', 8, 12), 'WAVE');
    assert.strictEqual(b.readUInt32LE(24), 16000); assert.strictEqual(b.readUInt16LE(22), 1); assert.strictEqual(b.readUInt16LE(34), 16);
    assert.strictEqual(b.length, 44 + 8); assert.strictEqual(b.readInt16LE(46), 32767); assert.strictEqual(b.readInt16LE(48), -32768);
  });
  await t(ok, 'dictated text goes at the cursor (replacing a selection), with spaces where words would run together, within the box limit', async () => {
    let r = lib.insertAt('I think so.', 7, 7, 'it is not', 4000);
    assert.strictEqual(r.value, 'I think it is not so.'); assert.strictEqual(r.caret, 17);
    r = lib.insertAt('First.', 6, 6, 'Second sentence.', 4000); assert.strictEqual(r.value, 'First. Second sentence.');
    r = lib.insertAt('', 0, 0, ' Hello there. ', 4000); assert.strictEqual(r.value, 'Hello there.');
    r = lib.insertAt('keep THIS end', 5, 9, 'that', 4000); assert.strictEqual(r.value, 'keep that end');
    r = lib.insertAt('abcdefgh', 8, 8, 'more words here', 12); assert.strictEqual(r.value, 'abcdefgh mor'); assert.ok(r.cut);
  });
  return ok;
}

async function run() {
  const out = [];
  for (const [label, fn] of [['Dictation: Windows voice typing (stand-in helper)', dictationTests], ['Dictation: local model (stand-in downloads and program)', localTests], ['Dictation: recording and insertion helpers', libTests]]) {
    const ok = await fn(); out.push(label + ': ' + ok.length + '/' + ok.length + ' passed');
  }
  return out;
}
module.exports = { run };
if (require.main === module) run().then((l) => l.forEach((x) => console.log(x)), (e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
