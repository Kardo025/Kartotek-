// Local dictation (task F8, LEARNING-PROTOCOL 3.13, decision D9 changed by the owner on 2026-11-17: a local model). whisper.cpp's
// command-line program and an English model, downloaded on request from their official places with fixed SHA-256 checks, kept in
// <userData>\dictation\. The window records the microphone and sends 16 kHz WAV here; whisper turns it into text on this PC. No audio
// leaves the PC, no key is needed. The program runs only while it transcribes (4 threads, below-normal priority) so the PC stays cool.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn: nodeSpawn } = require('child_process');
const { Readable } = require('stream');

// Fixed downloads (checked on 2026-11-17). A change of version is a code change, so a download can never be swapped silently.
// English uses the English-only model (faster and more accurate for English); Turkish and Italian use the multilingual one, which
// is a second, optional download.
const PINS = {
  program: {
    label: 'whisper.cpp b5454 (Windows, CPU)', file: 'whisper-bin-x64.zip', size: 8928640,
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
  },
  model: {
    label: 'Whisper small.en (English, q5_1)', file: 'ggml-small.en-q5_1.bin', size: 190098681, languages: ['en'],
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin',
    sha256: 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30',
  },
  multi: {
    label: 'Whisper small (multilingual, q5_1)', file: 'ggml-small-q5_1.bin', size: 190085487, languages: ['tr', 'it'],
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
  },
};
const LANGS = { en: 'English', tr: 'Turkish', it: 'Italian' };
const MAX_WAV = 12 * 1024 * 1024;   // about 6 minutes of 16 kHz mono 16-bit audio

function createWhisper(opts) {
  const o = opts || {};
  const dir = o.dir;
  const doFetch = o.fetch || fetch;
  const spawn = o.spawn || nodeSpawn;
  const platform = o.platform || process.platform;
  const threads = o.threads || Math.max(1, Math.min(4, (os.cpus() || []).length - 1));
  const expand = o.expand || expandZip;
  let installing = null;   // { which, step, done, total } while a download runs
  let current = null;      // the running transcription process

  const paths = () => ({ bin: path.join(dir, 'bin'), model: path.join(dir, 'models', PINS.model.file), multi: path.join(dir, 'models', PINS.multi.file), tmp: path.join(dir, 'tmp'), mark: path.join(dir, 'installed.json') });
  const readMark = () => { try { return JSON.parse(fs.readFileSync(paths().mark, 'utf8')) || {}; } catch (e) { return {}; } };
  const writeMark = (m) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(paths().mark, JSON.stringify(Object.assign(m, { at: new Date().toISOString() }), null, 2)); };

  function findProgram(root) {
    const stack = [root];
    while (stack.length) {
      const d = stack.pop();
      let list = [];
      try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
      for (const e of list) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (/^whisper-cli\.exe$/i.test(e.name)) return p;
      }
    }
    return null;
  }

  function status() {
    if (platform !== 'win32') return { available: false, installed: false, multi: false, languages: [], reason: 'The local model is set up for Windows only.' };
    const p = paths(), mark = readMark();
    const program = mark.program === PINS.program.sha256 && !!findProgram(p.bin);
    const installed = program && mark.model === PINS.model.sha256 && fs.existsSync(p.model);
    const multi = program && mark.multi === PINS.multi.sha256 && fs.existsSync(p.multi);
    const languages = [].concat(installed ? PINS.model.languages : [], multi ? PINS.multi.languages : []);
    return {
      available: true, installed, multi, languages: languages.map((c) => ({ code: c, label: LANGS[c] })),
      installing: installing ? Object.assign({}, installing) : null,
      model: PINS.model.label, multiModel: PINS.multi.label, program: PINS.program.label,
      downloadMB: Math.round((PINS.program.size + PINS.model.size) / 1e6), multiMB: Math.round(PINS.multi.size / 1e6),
    };
  }

  // Streams one pinned file to disk while hashing it; refuses a wrong size or hash and leaves nothing behind
  async function download(pin, dest, onProgress) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = dest + '.part';
    let res;
    try { res = await doFetch(pin.url, { redirect: 'follow' }); } catch (e) { throw new Error('Could not reach ' + new URL(pin.url).host + '.'); }
    if (!res.ok || !res.body) throw new Error(new URL(pin.url).host + ' answered ' + res.status + '.');
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let got = 0;
    try {
      const body = typeof res.body.getReader === 'function' ? Readable.fromWeb(res.body) : res.body;
      for await (const chunk of body) {
        got += chunk.length;
        if (got > pin.size) throw new Error(pin.file + ' is larger than expected.');
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        if (onProgress) onProgress(got);
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    } catch (e) { out.destroy(); try { fs.unlinkSync(part); } catch (x) { /* none */ } throw e; }
    const sum = hash.digest('hex');
    if (got !== pin.size || sum !== pin.sha256) { try { fs.unlinkSync(part); } catch (x) { /* none */ } throw new Error(pin.file + ' did not match its expected checksum, so it was not kept.'); }
    fs.renameSync(part, dest);
  }

  // which: 'en' (the program and the English model) or 'multi' (the multilingual model, plus the program if it is missing)
  async function install(onEvent, which) {
    const w = which === 'multi' ? 'multi' : 'en';
    if (platform !== 'win32') throw new Error(status().reason);
    if (installing) throw new Error('A download is already running.');
    const p = paths(), mark = readMark();
    const needProgram = !(mark.program === PINS.program.sha256 && findProgram(p.bin));
    const pin = w === 'multi' ? PINS.multi : PINS.model, dest = w === 'multi' ? p.multi : p.model, key = w === 'multi' ? 'multi' : 'model';
    const total = (needProgram ? PINS.program.size : 0) + pin.size;
    installing = { which: w, step: needProgram ? 'program' : 'model', done: 0, total };
    const emit = () => { if (onEvent) onEvent(Object.assign({}, installing)); };
    try {
      if (needProgram) {
        fs.mkdirSync(p.tmp, { recursive: true });
        const zip = path.join(p.tmp, PINS.program.file);
        await download(PINS.program, zip, (n) => { installing.done = n; emit(); });
        fs.rmSync(p.bin, { recursive: true, force: true });
        await expand(zip, p.bin);
        fs.rmSync(zip, { force: true });
        if (!findProgram(p.bin)) throw new Error('whisper-cli.exe was not found in the download.');
        writeMark(Object.assign(readMark(), { program: PINS.program.sha256 }));
      }
      installing.step = 'model'; emit();
      const base = needProgram ? PINS.program.size : 0;
      if (!(fs.existsSync(dest) && sha256File(dest) === pin.sha256)) await download(pin, dest, (n) => { installing.done = base + n; emit(); });
      writeMark(Object.assign(readMark(), { program: PINS.program.sha256, [key]: pin.sha256 }));
      installing = null;
      if (onEvent) onEvent({ which: w, step: 'done', done: total, total });
      return status();
    } catch (e) { installing = null; if (onEvent) onEvent({ which: w, step: 'failed', error: e.message }); throw e; }
  }

  // which: 'multi' removes only the multilingual model; otherwise everything
  function remove(which) {
    if (installing) throw new Error('Wait for the download to finish.');
    if (which === 'multi') {
      fs.rmSync(paths().multi, { force: true });
      const m = readMark(); delete m.multi; if (fs.existsSync(dir)) writeMark(m);
    } else fs.rmSync(dir, { recursive: true, force: true });
    return status();
  }

  // One recording (16 kHz WAV bytes) → text, in English (small.en) or Turkish / Italian (the multilingual model)
  async function transcribe(wav, language) {
    const lang = LANGS[language] ? language : 'en';
    const st = status();
    const multi = PINS.multi.languages.includes(lang);
    if (!(multi ? st.multi : st.installed)) throw new Error(multi ? LANGS[lang] + ' needs the multilingual model (Settings, Models, Dictation).' : 'The local dictation model is not downloaded yet (Settings, Models, Dictation).');
    const buf = Buffer.isBuffer(wav) ? wav : Buffer.from(wav || []);
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('The recording is not a WAV file.');
    if (buf.length > MAX_WAV) throw new Error('The recording is too long (about 6 minutes at most).');
    if (current) throw new Error('A recording is still being transcribed.');
    const p = paths();
    fs.mkdirSync(p.tmp, { recursive: true });
    const file = path.join(p.tmp, 'rec-' + crypto.randomBytes(6).toString('hex') + '.wav');
    fs.writeFileSync(file, buf);
    const args = ['-m', multi ? p.multi : p.model, '-f', file, '-l', lang, '-t', String(threads), '-nt', '-np', '--no-gpu'];
    try {
      const text = await new Promise((resolve, reject) => {
        const proc = spawn(findProgram(p.bin), args, { windowsHide: true, cwd: p.tmp });
        current = proc;
        try { if (proc.pid) os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* keep normal */ }
        const out = [];
        let err = '';
        const timer = setTimeout(() => { try { proc.kill(); } catch (e) { /* gone */ } reject(new Error('Transcribing took too long.')); }, 120000);
        proc.stdout.on('data', (d) => { out.push(Buffer.from(d)); });
        proc.stderr.on('data', (d) => { err = (err + d.toString('utf8')).slice(-600); });
        proc.on('error', (e) => { clearTimeout(timer); reject(new Error('whisper could not start: ' + e.message)); });
        proc.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error('whisper stopped (' + code + '): ' + (err.trim().split('\n').pop() || ''))); });
      });
      return { text: cleanText(text), language: lang };
    } finally { current = null; try { fs.unlinkSync(file); } catch (e) { /* gone */ } }
  }

  function stop() { if (current) { try { current.kill(); } catch (e) { /* gone */ } current = null; } }

  return { status, install, remove, transcribe, stop };
}

// whisper's output without bracketed sound labels ("[BLANK_AUDIO]", "(wind blowing)") and with single spaces
function cleanText(s) {
  return String(s || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

// Windows' own unzip (tar.exe, part of Windows 10 and 11); the paths are plain arguments, no shell
function expandZip(zip, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dest, { recursive: true });
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const p = nodeSpawn(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', dest], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error('Could not unpack the download: ' + e.message)));
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('Could not unpack the download: ' + err.slice(0, 200)))));
  });
}

module.exports = { createWhisper, cleanText, PINS, LANGS };
