'use strict';
// Euro apply connection (task D2, ARCHITECTURE.md section 8). Euro apply is the owner's separate app; Kartotek only
//   - checks its folder,
//   - reads ONE file from it, data\universities.json, read only, and hands the window a projection of a few fields,
//   - asks whether its server answers on 127.0.0.1:5178, and starts Euro apply's own launcher (tools\serve.ps1) when asked.
// Nothing is ever written into that folder and none of its code is run by Kartotek. Plain Node, no Electron API (tests run it).
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const EURO_HOST = '127.0.0.1';
const EURO_PORT = 5178;
const EURO_URL = 'http://' + EURO_HOST + ':' + EURO_PORT + '/';
const MAX_BYTES = 20 * 1024 * 1024;
const SCHEMA_PREFIX = 'euroapply.universities/';
const SCHEMA_MAJOR = '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || 400) : '');
// text for display: cut at a limit with an ellipsis, never mid-word silently
const clip = (v, max) => { const s = typeof v === 'string' ? v : ''; return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s; };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };

// Is this folder a usable Euro apply folder? `blocking` problems stop the connection; `notes` only limit what Kartotek can do.
function checkFolder(dir) {
  const out = { ok: false, blocking: [], notes: [] };
  if (!dir || typeof dir !== 'string') { out.blocking.push('No folder is set.'); return out; }
  if (!isDir(dir)) { out.blocking.push('The folder does not exist: ' + dir); return out; }
  if (!isFile(path.join(dir, 'data', 'universities.json'))) out.blocking.push('The folder has no data\\universities.json, so it does not look like Euro apply.');
  if (!isFile(path.join(dir, 'tools', 'serve.ps1'))) out.notes.push('tools\\serve.ps1 is missing, so Kartotek cannot start Euro apply for you.');
  if (!isDir(path.join(dir, 'app', 'node_modules'))) out.notes.push('app\\node_modules is missing: start Euro apply once with Start-EuroApply.bat so that it installs its packages (Node.js is required).');
  out.ok = out.blocking.length === 0;
  return out;
}

// ---- reading: only the fields Kartotek relies on leave this module (see docs/ARCHITECTURE.md 8.2 and docs/PROGRESS.md, task D2)
function timelineItem(t) {
  if (!t || typeof t !== 'object') return null;
  const url = str(t.url, 600);
  return {
    id: str(t.id, 80),
    date: str(t.date, 40),
    label: clip(t.label, 300),
    kind: str(t.kind, 20),
    est: t.est === true,
    checked: str(t.checked, 20),
    url: /^https:\/\//i.test(url) ? url : '',
    note: clip(t.note, 300),
  };
}

// Never returns more than the listed fields, whatever else the file contains (profile-like or costly data stays in Euro apply)
function project(json) {
  const universities = [];
  for (const u of (json.universities || []).slice(0, 500)) {
    if (!u || typeof u !== 'object') continue;
    universities.push({
      id: str(u.id, 80), name: str(u.name, 200),
      programs: (Array.isArray(u.programs) ? u.programs : []).slice(0, 100).map((p) => ({
        id: str(p && p.id, 80), name: str(p && p.name, 200), status: str(p && p.status, 20),
        timeline: (Array.isArray(p && p.timeline) ? p.timeline : []).slice(0, 200).map(timelineItem).filter(Boolean),
      })),
      timeline: (Array.isArray(u.timeline) ? u.timeline : []).slice(0, 500).map(timelineItem).filter(Boolean),
    });
  }
  return {
    schema: str(json.schema, 60),
    updated: str(json.updated, 20),
    universities,
  };
}

// Reads data\universities.json. Euro apply saves through its own server, so a half-written file is possible: one retry after retryMs.
// Returns { ok: true, value } or { ok: false, code, message }.
async function readUniversities(dir, opts) {
  const retryMs = opts && opts.retryMs != null ? opts.retryMs : 500;
  const check = checkFolder(dir);
  if (!check.ok) return { ok: false, code: 'folder', message: check.blocking[0] };
  const file = path.join(dir, 'data', 'universities.json');
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const st = fs.statSync(file);
      if (st.size > MAX_BYTES) return { ok: false, code: 'size', message: 'data\\universities.json is larger than 20 MB, so it was not read.' };
      const json = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
      if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, code: 'shape', message: 'data\\universities.json is not a JSON object.' };
      if (typeof json.schema !== 'string' || !json.schema.startsWith(SCHEMA_PREFIX)) return { ok: false, code: 'schema', message: 'data\\universities.json has no known schema ("schema" should start with ' + SCHEMA_PREFIX + ').' };
      if (json.schema.slice(SCHEMA_PREFIX.length).split('.')[0] !== SCHEMA_MAJOR) return { ok: false, code: 'schema', message: 'Euro apply data has a newer format (' + json.schema + '); Kartotek reads version ' + SCHEMA_MAJOR + '.' };
      if (!Array.isArray(json.universities)) return { ok: false, code: 'shape', message: 'data\\universities.json has no "universities" list.' };
      return { ok: true, value: project(json) };
    } catch (e) {
      lastError = e;
      if (attempt === 0) await sleep(retryMs);
    }
  }
  return { ok: false, code: 'read', message: 'data\\universities.json could not be read (' + (lastError && lastError.message) + '). Euro apply may be saving it; try again in a moment.' };
}

// ---- the server
function ping(timeoutMs, port) {
  return new Promise((resolve) => {
    const req = http.get({ host: EURO_HOST, port: port || EURO_PORT, path: '/', timeout: timeoutMs || 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// Runs Euro apply's own launcher hidden (it keeps one server running and restarts it) and waits until the server answers.
// opts.waitMs (default 30000) and opts.port are for the tests. Returns { ok, error? }.
async function startServer(dir, opts) {
  const waitMs = opts && opts.waitMs != null ? opts.waitMs : 30000;
  const port = opts && opts.port;
  const script = path.join(String(dir || ''), 'tools', 'serve.ps1');
  if (!isFile(script)) return { ok: false, error: 'tools\\serve.ps1 was not found in the Euro apply folder.' };
  if (await ping(1000, port)) return { ok: true };
  try {
    // Not "detached": on Windows that starts PowerShell without a console and the launcher's Start-Process silently does nothing.
    // A normal hidden child keeps running when Kartotek closes (the launcher is built to outlive any window).
    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch (e) {
    return { ok: false, error: 'Euro apply could not be started: ' + e.message };
  }
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    if (await ping(1000, port)) return { ok: true };
    await sleep(500);
  }
  return { ok: false, error: 'Euro apply did not answer within ' + Math.round(waitMs / 1000) + ' seconds. Its log is in %LOCALAPPDATA%\\EuroApply.' };
}

module.exports = { EURO_URL, EURO_HOST, EURO_PORT, checkFolder, project, readUniversities, ping, startServer };
