'use strict';
// Pure helpers for serving the engine and UI files (src\) from the app:// protocol.
// No Electron API here, so they run (and are tested) in plain Node.
const path = require('path');
const crypto = require('crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

function mimeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// Maps a URL path to a file below root. Returns null for anything that would leave root.
function resolveAppPath(root, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath || '/'); } catch (e) { return null; }
  if (p.indexOf('\0') >= 0) return null;
  if (p === '/' || p === '') p = '/index.html';
  const file = path.resolve(root, '.' + path.posix.normalize(p));
  const rootResolved = path.resolve(root);
  if (file !== rootResolved && !file.startsWith(rootResolved + path.sep)) return null;
  return file;
}

// SHA-256 hashes (CSP syntax) of the inline <script> blocks of a page: the theme-before-first-paint snippet in src\index.html
// must keep working without 'unsafe-inline'.
function inlineScriptHashes(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1].trim()) continue;
    // The HTML parser turns CRLF and CR into LF before the browser hashes a script, so hash the same text. (git on Windows may check
    // index.html out with CRLF; without this the theme script was blocked and the app booted twice.)
    const text = m[1].replace(/\r\n?/g, '\n');
    out.push("'sha256-" + crypto.createHash('sha256').update(text, 'utf8').digest('base64') + "'");
  }
  return out;
}

// Content-Security-Policy of ARCHITECTURE.md section 2.4. Inline styles stay allowed (the legacy views build HTML with style=
// attributes); fonts are inlined as data: URLs; the window itself makes no network requests.
// React DOM tests whether the browser supports the input event with setAttribute('oninput', 'return;'). A strict CSP blocks that
// probe and logs two console errors. 'unsafe-hashes' plus the hash of exactly that text allows it and nothing else inline.
const REACT_PROBE_HANDLER = 'return;';

function cspFor(html) {
  const hashes = inlineScriptHashes(html || '');
  const probe = "'sha256-" + crypto.createHash('sha256').update(REACT_PROBE_HANDLER, 'utf8').digest('base64') + "'";
  return [
    "default-src 'self'",
    'script-src ' + ["'self'"].concat(hashes).join(' ') + " 'unsafe-hashes' " + probe,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' kcontent: data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// Response headers for a served file. html is the page text when the file is an HTML page.
function headersFor(file, html) {
  const h = {
    'Content-Type': mimeOf(file),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (path.extname(file).toLowerCase() === '.html') {
    h['Content-Security-Policy'] = cspFor(html);
    h['Referrer-Policy'] = 'no-referrer';
  }
  return h;
}

// Links the window may hand to the operating system: web pages and the claude:// deep links of the "Ask Claude" buttons.
function externalUrlAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'claude:';
  } catch (e) { return false; }
}

module.exports = { mimeOf, resolveAppPath, inlineScriptHashes, cspFor, headersFor, externalUrlAllowed };
