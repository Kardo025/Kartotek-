'use strict';
// `npm run smoke`: starts the desktop app (Playwright's Electron launcher) with a temporary profile, opens every sidebar entry, runs
// the Algorithm-tab test suite inside the window and reports console errors. Exit code 1 on any failure.
//
// One known console message is expected and filtered: the sanitiser test feeds deliberately malicious SVG (onload="alert(1)",
// onclick="x()") to the page, and the Content-Security-Policy blocks and logs those two inline handlers. Anything else counts.
//
// Packaged app: with KARTOTEK_APP_EXE=<path to Kartotek.exe> (for example dist-installer\win-unpacked\Kartotek.exe) the same checks run
// against the built application. Its Electron fuses switch off the Node inspector that Playwright's Electron launcher needs, so the
// executable is started with --remote-debugging-port and driven over the Chrome DevTools protocol instead.
const { _electron: electron, chromium } = require('playwright-core');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const EXPECTED = /Executing inline event handler violates the following Content Security Policy directive/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Both modes return { firstWindow(), close() }
async function launchApp(env) {
  const exe = process.env.KARTOTEK_APP_EXE;
  if (!exe) return electron.launch({ args: [root], env, cwd: root });
  const port = 9300 + Math.floor(Math.random() * 500);
  const child = spawn(exe, ['--remote-debugging-port=' + port], { env, stdio: 'ignore' });
  let spawnError = null;
  child.on('error', (e) => { spawnError = e; });
  let browser = null;
  for (let i = 0; i < 80 && !browser; i++) {
    if (spawnError) throw spawnError;
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + port); } catch (e) { await sleep(500); }
  }
  if (!browser) { child.kill(); throw new Error('the packaged app did not open its debugging port: ' + exe); }
  return {
    firstWindow: async () => {
      for (let i = 0; i < 80; i++) {
        const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('app://'));
        if (page) return page;
        await sleep(250);
      }
      throw new Error('the packaged app opened no window');
    },
    close: async () => {
      try { await browser.close(); } catch (e) { /* already closed */ }
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill();
      await sleep(1500); // the single-instance lock must be free for the restart check
    },
  };
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kartotek-smoke-'));
  // A content folder for the run-time content check (task C2): one good study, one broken study, one mind map with a photo
  const contentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kartotek-smoke-content-'));
  const sample = JSON.parse(fs.readFileSync(path.join(root, 'samples', 'studies', 'sample-cycle-v2', 'etut.json'), 'utf8'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const putStudy = (id, title) => {
    fs.mkdirSync(path.join(contentDir, 'studies', id), { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'studies', id, 'etut.json'), JSON.stringify(Object.assign({}, sample, { etut_id: id, title })));
  };
  putStudy('c2-first', 'First smoke study');
  fs.mkdirSync(path.join(contentDir, 'studies', 'c2-broken'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'studies', 'c2-broken', 'etut.json'), '{ not json');
  fs.mkdirSync(path.join(contentDir, 'mindmaps', 'ph-map', 'views'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'mindmaps', 'ph-map', 'views', 'p.png'), png);
  fs.writeFileSync(path.join(contentDir, 'secret.png'), png);
  const env = Object.assign({}, process.env, { KARTOTEK_USER_DATA: profile, KARTOTEK_CONTENT: contentDir, ELECTRON_RUN_AS_NODE: '' });
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await launchApp(env);
  const problems = [];
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.waitForLoadState('domcontentloaded');
    // skip the first-open welcome stage, then reload so the shell starts normally
    await page.evaluate(() => localStorage.setItem('kartotek-welcome', '1'));
    await page.reload();
    await page.waitForSelector('main', { timeout: 15000 });

    // Learner data in files (C3): an empty profile shows the first-run panel and writes nothing until a choice is made
    await page.waitForSelector('#first-run', { timeout: 8000 }).catch(() => problems.push('the first-run panel did not appear for an empty profile'));
    if (fs.existsSync(path.join(profile, 'data', 'manifest.json'))) problems.push('data was written before the first-run choice');
    await page.click('#first-start-empty').catch(() => problems.push('no "Start empty" choice'));
    await page.waitForFunction(() => !document.getElementById('first-run') && window.App.store.status === 'Files: saved', null, { timeout: 8000 })
      .catch(() => problems.push('"Start empty" did not finish'));
    if (!fs.existsSync(path.join(profile, 'data', 'manifest.json'))) problems.push('no data files after "Start empty"');

    const info = await page.evaluate(() => window.kartotek && window.kartotek.app.info());
    if (!info || !info.ok) problems.push('bridge window.kartotek.app.info() failed: ' + JSON.stringify(info));
    if (process.env.KARTOTEK_APP_EXE && info && info.ok && info.value.dev) problems.push('the packaged app reports dev mode');
    const exposed = await page.evaluate(() => ({ node: typeof require, process: typeof process }));
    if (exposed.node !== 'undefined' || exposed.process !== 'undefined') problems.push('Node leaked into the window: ' + JSON.stringify(exposed));

    const sidebar = 'nav button, aside button';
    const skip = /^(Auto|Light|Dark|This browser|Files)/;
    const labels = await page.$$eval(sidebar, (els, skipSrc) => els.map((b) => (b.innerText || '').trim().split('\n')[0]).filter((t) => t && !new RegExp(skipSrc).test(t)), skip.source);
    if (labels.length < 15) problems.push('only ' + labels.length + ' sidebar entries found');
    for (let i = 0; i < labels.length; i++) {
      // entries with the same label (Review, Study, Cards in three sections): take the n-th match
      const nth = labels.slice(0, i + 1).filter((l) => l === labels[i]).length;
      const matches = [];
      for (const b of await page.$$(sidebar)) {
        const t = ((await b.innerText()) || '').trim().split('\n')[0];
        if (t === labels[i]) matches.push(b);
      }
      const target = matches[nth - 1];
      if (!target) { problems.push('sidebar entry not found: ' + labels[i]); continue; }
      await target.click();
      await page.waitForTimeout(450);
      const len = await page.$eval('main', (m) => m.innerText.length).catch(() => 0);
      if (len < 20) problems.push('tab "' + labels[i] + '" rendered no content');
    }

    // Run-time content (C2): read at start, problems listed, a new study appears after "Reload content", photos from the folder
    const startInfo = await page.evaluate(() => { const i = window.KHost.info(); return { desktop: i.desktop, dir: i.contentDir, studies: window.KHost.list('etuts').map((p) => p.etut_id), errors: i.problemCount }; });
    if (!startInfo.desktop || !startInfo.studies.includes('c2-first')) problems.push('content folder not read at start: ' + JSON.stringify(startInfo));
    if (startInfo.errors < 1) problems.push('the broken study is not listed as a content problem');
    putStudy('c2-second', 'Second smoke study');
    let sawChange = false;
    for (let i = 0; i < 25 && !sawChange; i++) {
      sawChange = await page.evaluate(() => window.KHost.info().changedOnDisk);
      if (!sawChange) await page.waitForTimeout(300);
    }
    if (!sawChange) problems.push('the window was not told that the content folder changed');
    for (const b of await page.$$(sidebar)) {
      if ((((await b.innerText()) || '').trim().split('\n')[0]) === 'Settings') { await b.click(); break; }
    }
    await page.click('#reload-content');
    await page.waitForFunction(() => Object.keys(window.App.S.etuts).includes('c2-second'), null, { timeout: 8000 })
      .catch(() => problems.push('the new study did not appear after Reload content'));
    const panel = await page.$eval('#content-panel', (el) => el.innerText).catch(() => '');
    if (!/c2-broken|not valid JSON/.test(panel)) problems.push('the Content problems panel does not show the broken study');
    const photo = await page.evaluate(() => {
      const test = (url) => new Promise((r) => { const im = new Image(); im.onload = () => r(im.naturalWidth); im.onerror = () => r(0); im.src = url; });
      return Promise.all([test(window.KHost.photoUrl('ph-map', 'views/p.png')), test('kcontent://mindmaps/ph-map/../../secret.png'), test('kcontent://mindmaps/ph-map/..%2f..%2fsecret.png')]);
    });
    if (photo[0] !== 1) problems.push('the mind-map photo did not load from the content folder');
    if (photo[1] !== 0 || photo[2] !== 0) problems.push('a kcontent:// path escape was served');

    // Algorithm tab: the engine self-tests, shown and called
    for (const b of await page.$$(sidebar)) {
      if ((((await b.innerText()) || '').trim().split('\n')[0]) === 'Algorithm') { await b.click(); break; }
    }
    await page.waitForTimeout(600);
    const shown = await page.$eval('main', (m) => (m.innerText.match(/\d+\/\d+ tests passed/) || [])[0]).catch(() => null);
    const direct = await page.evaluate(() => { const r = window.KTests.runAll(); return { pass: r.filter((x) => x.pass).length, total: r.length }; });
    if (!shown || !/^(\d+)\/\1 tests passed$/.test(shown)) problems.push('Algorithm tab shows: ' + shown);
    if (direct.pass !== direct.total) problems.push('KTests: ' + direct.pass + '/' + direct.total);
    // A change is saved to the files and is there after a restart; no first-run panel the second time
    await page.evaluate(async () => { window.App.S.settings.daily_review_limit = 137; window.App.store.commit({ meta: true }); await window.App.store.flushNow(); });
    await app.close();
    app = await launchApp(env);
    const page2 = await app.firstWindow();
    page2.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page2.waitForSelector('main', { timeout: 15000 });
    await page2.waitForFunction(() => window.App && window.App.store && window.App.store.mode === 'file' && window.App.S, null, { timeout: 15000 }).catch(() => {});
    const after = await page2.evaluate(() => ({ limit: window.App.S.settings.daily_review_limit, first: !!document.getElementById('first-run') }));
    if (after.limit !== 137) problems.push('a saved change was not there after a restart: ' + JSON.stringify(after));
    if (after.first) problems.push('the first-run panel appeared again after a restart');
    console.log('Window: ' + (info && info.ok ? 'Electron ' + info.value.electron + ' (' + info.value.platform + ')' : '?') + '; sidebar entries: ' + labels.length + '; Algorithm tab: ' + shown + '; KTests: ' + direct.pass + '/' + direct.total);
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(contentDir, { recursive: true, force: true });
  }
  const unexpected = errors.filter((e) => !EXPECTED.test(e));
  const expected = errors.length - unexpected.length;
  if (unexpected.length) problems.push('console errors: ' + unexpected.join(' | '));
  console.log('Console errors: ' + unexpected.length + ' unexpected, ' + expected + ' expected (CSP blocking the sanitiser test payloads)');
  if (problems.length) { console.log('FAILED:\n - ' + problems.join('\n - ')); process.exit(1); }
  console.log('Smoke test passed');
}

const fail = (e) => {
  console.error('Smoke test could not run: ' + (e && e.message));
  console.error('If Electron failed to launch on Windows, check whether Smart App Control blocks the unsigned electron.exe (see docs/PROGRESS.md, task C1).');
  process.exit(1);
};
process.on('unhandledRejection', fail);
main().catch(fail);
