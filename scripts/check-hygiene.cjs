'use strict';
// `npm run hygiene`: fails when the repository tracks something private (task A3's check, ARCHITECTURE.md section 9).
// Checks every tracked file (git ls-files) for course-material folders, documents and photos, build output and personal traces,
// and (G2, review finding S1) every blob and commit message reachable from any ref, so a trace that was committed and later
// removed still fails. It never prints the contents of a file.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const files = git(['ls-files']).split('\n').filter(Boolean);

// Tracked paths that must never exist: content folders, research notes, generated PDFs and photos, build output, local config
const PRIVATE_PATH = [
  /^(studies|lessons|mocks|mindmaps|research|Notes|notes|pdf-extracts|sources|exam|content|backup-before-redesign|kartotek)\//,
  /^tools\/cache\//,
  /^dist-installer[^/]*\//,
  /^node_modules\//,
  /\.(pdf|jpe?g|webp|heic|gif|docx?|pptx?|xlsx?)$/i,
  /^Kartotek-DSR\.html$/,
  /^kartotek\.config\.json$/,
  /^hygiene\.local\.txt$/,
  /brands\//,
];
// Images are allowed only where the app needs them
const IMAGE_ALLOWED = new Set(['build/icon.png']);
const IMAGE_ALLOWED_DIR = /^docs\/screenshots\/[a-z0-9-]+\.png$/; // README screenshots of the synthetic samples (scripts/screenshots.cjs)

// Personal traces in the text of tracked files (case-insensitive). Third-party notice texts and lock files are not searched.
// No personal term is written in this file, because the file is public. Two sources add them at run time: the Windows user name of
// whoever runs the check, and the lines of hygiene.local.txt next to package.json (git-ignored; one regular expression per line,
// a line starting with # is a comment).
const TRACES = [
  ['a private claude.ai document', 'claude\\.ai/artifact'],
  ['a personal e-mail address', '@gmail\\.|@outlook\\.|@hotmail\\.'],
  ['an absolute user path', 'C:\\\\\\\\?Users\\\\\\\\?(?!you\\b)[A-Za-z0-9_.-]+'],
];
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
try {
  const user = os.userInfo().username;
  if (user && user.length >= 4) TRACES.push(['the Windows user name of this PC', escapeRegex(user)]);
} catch (e) { /* no user info */ }
try {
  for (const line of fs.readFileSync(path.join(root, 'hygiene.local.txt'), 'utf8').split(/\r?\n/)) {
    const term = line.trim();
    if (term && !term.startsWith('#')) TRACES.push(['a term from hygiene.local.txt', term]);
  }
} catch (e) { /* the file is optional */ }
const SKIP_TEXT = [':!THIRD-PARTY-NOTICES.md', ':!package-lock.json', ':!ui/package-lock.json'];

const problems = [];
for (const f of files) {
  if (/\.png$/i.test(f) && !IMAGE_ALLOWED.has(f) && !IMAGE_ALLOWED_DIR.test(f)) problems.push('tracked image: ' + f);
  else if (PRIVATE_PATH.some((re) => re.test(f))) problems.push('tracked private or generated path: ' + f);
}
for (const [what, pattern] of TRACES) {
  let out = '';
  try { out = git(['grep', '-I', '-l', '-i', '-P', pattern, '--', '.'].concat(SKIP_TEXT)); } catch (e) { out = ''; } // exit 1 = no match
  for (const f of out.split('\n').filter(Boolean)) problems.push(what + ' in ' + f);
}

// History: every blob reachable from any ref (local and remote branches, tags), and every commit message
const SKIP_HISTORY_PATH = /(^|\/)(THIRD-PARTY-NOTICES\.md|package-lock\.json)$/;
const compiled = TRACES.map(([what, pattern]) => [what, new RegExp(pattern, 'i')]);
let historyBlobs = 0;
try {
  const listing = git(['rev-list', '--objects', '--all']).split('\n').filter(Boolean);
  const paths = new Map();
  for (const line of listing) { const i = line.indexOf(' '); if (i > 0) paths.set(line.slice(0, i), line.slice(i + 1)); else paths.set(line, ''); }
  const ids = [...paths.keys()];
  const batch = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: ids.join('\n') + '\n', maxBuffer: 1024 * 1024 * 1024 });
  let pos = 0;
  const seen = new Set();
  while (pos < batch.length) {
    const nl = batch.indexOf(10, pos);
    const [id, type, sizeText] = batch.slice(pos, nl).toString('latin1').split(' ');
    const size = Number(sizeText);
    const body = batch.slice(nl + 1, nl + 1 + size);
    pos = nl + 1 + size + 1;
    if (type !== 'blob') continue;
    historyBlobs++;
    const p = paths.get(id) || '';
    if (SKIP_HISTORY_PATH.test(p) || body.includes(0)) continue; // binary files are not searched
    const text = body.toString('utf8');
    for (const [what, re] of compiled) {
      const key = what + '|' + p;
      if (re.test(text) && !seen.has(key)) { seen.add(key); problems.push(what + ' in the history of ' + (p || id.slice(0, 8)) + ' (blob ' + id.slice(0, 8) + ')'); }
    }
  }
  const messages = git(['log', '--all', '--format=%H%x00%an%x00%B%x01']).split('\x01');
  for (const m of messages) for (const [what, re] of compiled) if (re.test(m)) problems.push(what + ' in the commit message or author of ' + m.slice(0, 8));
} catch (e) { problems.push('the history could not be scanned: ' + e.message.split('\n')[0]); }
console.log('History: ' + historyBlobs + ' blobs scanned.');

// Summary by top-level folder
const groups = {};
for (const f of files) { const top = f.includes('/') ? f.split('/')[0] + '/' : '(root)'; groups[top] = (groups[top] || 0) + 1; }
console.log('Tracked files: ' + files.length + ' (' + Object.keys(groups).sort().map((k) => k + ' ' + groups[k]).join(', ') + ')');
if (problems.length) {
  console.log('FAILED, private content may be tracked:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('No private paths, documents, photos or personal traces are tracked, in the tree or in the history.');
