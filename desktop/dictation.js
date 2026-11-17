// Dictation (task F8, LEARNING-PROTOCOL 3.13, decision D9): Windows voice typing. The window focuses the field and asks for dictation;
// this module presses Win + H for the learner, so dictating needs no keyboard. Windows then writes the spoken text at the cursor
// itself (Microsoft's online speech service, the language of the Windows input method). Kartotek receives no audio and no key.
//
// The key presses come from one small PowerShell helper that stays open (user32 keybd_event; compiled once, so later presses are
// immediate). It only ever presses Win + H, and only while the Kartotek window is in front.
'use strict';
const { spawn: nodeSpawn } = require('child_process');

const HELPER = [
  "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'",
  "Add-Type -Namespace KartotekDictation -Name Keys -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'",
  "[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()",
  "while ($null -ne ($line = [Console]::In.ReadLine())) {",
  "  if ($line -eq 'winh') {",
  "    [KartotekDictation.Keys]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)",
  "    [KartotekDictation.Keys]::keybd_event(0x48, 0, 0, [UIntPtr]::Zero)",
  "    [KartotekDictation.Keys]::keybd_event(0x48, 0, 2, [UIntPtr]::Zero)",
  "    [KartotekDictation.Keys]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)",
  "    [Console]::Out.WriteLine('ok'); [Console]::Out.Flush()",
  "  }",
  "}",
].join('\n');

function createDictation(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const spawn = o.spawn || nodeSpawn;
  const isFocused = o.isFocused || (() => true);
  const timeoutMs = o.timeoutMs || 8000;
  let helper = null;      // { proc, waiters: [fn], buf, ready: Promise }

  function status() {
    if (platform !== 'win32') return { mode: null, label: 'Dictation uses Windows voice typing, which is only on Windows.' };
    return { mode: 'voice-typing', label: 'Windows voice typing' };
  }

  function startHelper() {
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(HELPER, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const h = { proc, waiters: [], buf: '', dead: false, err: '' };
    h.ready = new Promise((resolve, reject) => { h.waiters.push((line) => (line === 'ready' ? resolve() : reject(new Error(line)))); });
    h.ready.catch(() => { /* reported by start() */ });
    proc.stdout.on('data', (d) => {
      h.buf += d.toString('utf8');
      let i;
      while ((i = h.buf.indexOf('\n')) >= 0) { const line = h.buf.slice(0, i).trim(); h.buf = h.buf.slice(i + 1); if (!line) continue; const w = h.waiters.shift(); if (w) w(line); }
    });
    proc.stderr.on('data', (d) => { h.err = (h.err + d.toString('utf8')).slice(-400); });
    const die = () => { h.dead = true; const ws = h.waiters.splice(0); ws.forEach((w) => w('exit')); if (helper === h) helper = null; };
    proc.on('exit', die);
    proc.on('error', die);
    return h;
  }

  function line(h, cmd) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Windows did not answer in time.')), timeoutMs);
      h.waiters.push((l) => { clearTimeout(t); l === 'ok' ? resolve() : reject(new Error('The voice-typing helper stopped.')); });
      try { h.proc.stdin.write(cmd + '\n'); } catch (e) { clearTimeout(t); reject(e); }
    });
  }

  // Opens Windows voice typing in the field that has the focus (pressing it again while it is open closes it, as the shortcut does)
  async function start() {
    if (platform !== 'win32') throw new Error(status().label);
    if (!isFocused()) throw new Error('Bring the Kartotek window to the front first.');
    if (!helper || helper.dead) helper = startHelper();
    const h = helper;
    const t = new Promise((_, reject) => setTimeout(() => reject(new Error('Windows did not answer in time.')), timeoutMs));
    try { await Promise.race([h.ready, t]); } catch (e) { stop(); throw new Error('Could not start voice typing: ' + (h.err.trim().split('\n').pop() || e.message)); }
    if (!isFocused()) throw new Error('Bring the Kartotek window to the front first.');
    await line(h, 'winh');
    return { mode: 'voice-typing' };
  }

  // Starts the helper ahead of the first press, so the first click is quick (no error if it cannot start)
  function warm() { if (platform === 'win32' && (!helper || helper.dead)) helper = startHelper(); }

  function stop() { if (helper) { try { helper.proc.stdin.end(); helper.proc.kill(); } catch (e) { /* gone */ } helper = null; } }

  return { status, start, warm, stop };
}

module.exports = { createDictation, HELPER };
