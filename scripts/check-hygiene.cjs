'use strict';
// `npm run hygiene`: fails when the repository tracks something private (task A3's check, ARCHITECTURE.md section 9).
// Checks every tracked file (git ls-files) for course-material folders, documents and photos, build output and personal traces.
// It reads the index only; it never prints the contents of a file.
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
  if (/\.png$/i.test(f) && !IMAGE_ALLOWED.has(f)) problems.push('tracked image: ' + f);
  else if (PRIVATE_PATH.some((re) => re.test(f))) problems.push('tracked private or generated path: ' + f);
}
for (const [what, pattern] of TRACES) {
  let out = '';
  try { out = git(['grep', '-I', '-l', '-i', '-P', pattern, '--', '.'].concat(SKIP_TEXT)); } catch (e) { out = ''; } // exit 1 = no match
  for (const f of out.split('\n').filter(Boolean)) problems.push(what + ' in ' + f);
}

// Summary by top-level folder
const groups = {};
for (const f of files) { const top = f.includes('/') ? f.split('/')[0] + '/' : '(root)'; groups[top] = (groups[top] || 0) + 1; }
console.log('Tracked files: ' + files.length + ' (' + Object.keys(groups).sort().map((k) => k + ' ' + groups[k]).join(', ') + ')');
if (problems.length) {
  console.log('FAILED, private content may be tracked:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('No private paths, documents, photos or personal traces are tracked.');
