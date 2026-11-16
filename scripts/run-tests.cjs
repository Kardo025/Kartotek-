'use strict';
// `npm test`: runs the engine self-tests (src/tests.js, the same scenarios as the Algorithm tab) in Node, then the desktop helper
// tests. The engine scripts are plain browser globals, so they are loaded in the order src/index.html lists them (everything except
// the built ui.js, with the boot deferred as in the page) into a jsdom window, and KTests.runAll() is called.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');

function engineScripts() {
  const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  const names = [];
  for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    if (m[1] === 'ui.js') continue; // the React bundle needs a real DOM
    names.push(m[1]);
  }
  if (names.indexOf('tests.js') < 0) throw new Error('tests.js is not listed in src/index.html');
  return names;
}

function runEngineTests() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  w.KARTOTEK_DEFER_BOOT = true; // as in src/index.html: the app does not boot itself
  for (const name of engineScripts()) {
    try { w.eval(fs.readFileSync(path.join(src, name), 'utf8') + '\n//# sourceURL=src/' + name); }
    catch (e) { console.log('FAIL  loading src/' + name + ': ' + e.message); return { total: 0, failed: 1 }; }
  }
  const results = w.KTests.runAll();
  let failed = 0;
  for (const r of results) {
    if (!r.pass) { failed++; console.log('FAIL  ' + r.name + '\n      ' + r.detail); }
  }
  console.log('Engine self-tests: ' + (results.length - failed) + '/' + results.length + ' passed');
  w.close();
  return { total: results.length, failed };
}

function runDesktopTests() {
  const assert = require('assert');
  const { resolveAppPath, inlineScriptHashes, cspFor, headersFor, externalUrlAllowed } = require('../desktop/serve');
  let n = 0;
  const t = (name, fn) => { fn(); n++; };

  t('resolveAppPath maps / to index.html and stays inside src', () => {
    assert.strictEqual(resolveAppPath(src, '/'), path.join(src, 'index.html'));
    assert.strictEqual(resolveAppPath(src, '/ui.js'), path.join(src, 'ui.js'));
  });
  t('resolveAppPath refuses paths that leave src', () => {
    for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json', '/a/../../x', '/%00', '/..\\package.json']) {
      const r = resolveAppPath(src, p);
      assert.ok(r === null || r.startsWith(src + path.sep), 'escaped: ' + p + ' -> ' + r);
    }
    // ".." cannot climb above the served root: it is clamped, so the repository's own package.json is never reachable
    assert.notStrictEqual(resolveAppPath(src, '/../package.json'), path.join(root, 'package.json'));
    assert.strictEqual(resolveAppPath(src, '/%00'), null);
  });
  t('inline script hashes cover the theme snippet of index.html and no external script', () => {
    const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
    const hashes = inlineScriptHashes(html);
    assert.strictEqual(hashes.length, 1);
    assert.ok(/^'sha256-[A-Za-z0-9+/]+=*'$/.test(hashes[0]));
    assert.deepStrictEqual(inlineScriptHashes('<script src="a.js"></script><script>  </script>'), []);
    // CRLF line endings (a Windows checkout) hash like LF, as the browser's HTML parser normalises them
    assert.deepStrictEqual(inlineScriptHashes(html.replace(/\r?\n/g, '\r\n')), inlineScriptHashes(html.replace(/\r\n/g, '\n')));
  });
  t('CSP: no unsafe-inline for scripts, no network, hash present, same-origin only', () => {
    const csp = cspFor(fs.readFileSync(path.join(src, 'index.html'), 'utf8'));
    const script = csp.split('; ').find((d) => d.startsWith('script-src'));
    assert.ok(!script.includes('unsafe-inline') && !script.includes('unsafe-eval') && script.includes("'sha256-"));
    // the only inline event handler allowed is React's feature probe, by hash
    assert.strictEqual(script.split("'sha256-").length - 1, 2);
    assert.ok(script.includes("'unsafe-hashes'"));
    assert.ok(csp.includes("connect-src 'self'") && csp.includes("default-src 'self'") && csp.includes("object-src 'none'"));
  });
  t('headersFor: CSP only on html pages', () => {
    assert.ok(headersFor('x.html', '<p></p>')['Content-Security-Policy']);
    assert.strictEqual(headersFor('x.js', '')['Content-Security-Policy'], undefined);
    assert.strictEqual(headersFor('x.js', '')['Content-Type'], 'text/javascript; charset=utf-8');
  });
  t('external links: https and claude only', () => {
    assert.ok(externalUrlAllowed('https://example.org/x'));
    assert.ok(externalUrlAllowed('claude://code/new?q=hi'));
    for (const u of ['http://example.org', 'file:///C:/x', 'javascript:alert(1)', 'app://kartotek/x', 'not a url', 'ms-settings:']) assert.ok(!externalUrlAllowed(u), u);
  });
  console.log('Desktop helper tests: ' + n + '/' + n + ' passed');
}

(async () => {
  let code = 0;
  const e = runEngineTests();
  if (e.failed) code = 1;
  try { runDesktopTests(); } catch (err) { console.log('FAIL  desktop helper test: ' + err.message); code = 1; }
  try { (await require('./content-tests.cjs').run()).forEach((l) => console.log(l)); } catch (err) { console.log('FAIL  content tests: ' + (err && err.stack || err)); code = 1; }
  try { (await require('./data-tests.cjs').run()).forEach((l) => console.log(l)); } catch (err) { console.log('FAIL  data tests: ' + (err && err.stack || err)); code = 1; }
  try { const k = await require('./nav-tests.cjs').run(); console.log('Navigation tests: ' + k + '/' + k + ' passed'); } catch (err) { console.log('FAIL  navigation tests: ' + (err && err.stack || err)); code = 1; }
  try { (await require('./model-tests.cjs').run()).forEach((l) => console.log(l)); } catch (err) { console.log('FAIL  model layer tests: ' + (err && err.stack || err)); code = 1; }
  try { (await require('./study-model-tests.cjs').run()).forEach((l) => console.log(l)); } catch (err) { console.log('FAIL  study model tests: ' + (err && err.stack || err)); code = 1; }
  try { (await require('./probe-tests.cjs').run()).forEach((l) => console.log(l)); } catch (err) { console.log('FAIL  probe and plan map tests: ' + (err && err.stack || err)); code = 1; }
  try { (await require('./live-tests.cjs').run()).forEach((l) => console.log(l)); } catch (err) { console.log('FAIL  live teaching tests: ' + (err && err.stack || err)); code = 1; }
  try { const k = await require('./euro-tests.cjs').run(); console.log('Euro apply connection and Planning timeline tests: ' + k + '/' + k + ' passed'); } catch (err) { console.log('FAIL  euro apply tests: ' + (err && err.stack || err)); code = 1; }
  try { if (!(await require('./job-tests.cjs').main())) code = 1; } catch (err) { console.log('FAIL  writing job tests: ' + (err && err.stack || err)); code = 1; }
  process.exit(code);
})();
