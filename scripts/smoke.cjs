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
// Expected: the CSP blocking the sanitiser test's malicious SVG, and the 404s of the test's own kcontent:// path-escape probes (secret.png)
const EXPECTED = /Executing inline event handler violates the following Content Security Policy directive|secret\.png/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// On GitHub Actions every problem also becomes a workflow annotation, which is readable on the run page without signing in
function annotate(messages) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const esc = (t) => String(t).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  messages.slice(0, 9).forEach((m) => console.log('::error title=Smoke test::' + esc(String(m).slice(0, 1800))));
}

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
    windows: () => browser.contexts().flatMap((c) => c.pages()),
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
  // A stand-in Euro apply folder (task D2): the one file Kartotek reads, a launcher file and the packages folder it checks for
  const euroDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kartotek-smoke-euro-'));
  fs.mkdirSync(path.join(euroDir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(euroDir, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(euroDir, 'app', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(euroDir, 'tools', 'serve.ps1'), '# fixture\n');
  const inDays = (n) => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  fs.writeFileSync(path.join(euroDir, 'data', 'universities.json'), JSON.stringify({
    schema: 'euroapply.universities/1', updated: '2026-11-01', statusValues: ['Planned'],
    universities: [{ id: 'smoke-uni', name: 'Smoke University', city: 'X', country: 'NL', priority: 'normal', programs: [{ id: 'p1', name: 'Smoke programme', status: 'Planned', timeline: [] }],
      timeline: [{ id: 't1', date: inDays(20), label: 'Smoke registration deadline', kind: 'deadline', est: false, checked: '2026-11-01', url: 'https://example.org/x', note: '' }] }],
  }));
  const env = Object.assign({}, process.env, { KARTOTEK_USER_DATA: profile, KARTOTEK_CONTENT: contentDir, ELECTRON_RUN_AS_NODE: '' });
  delete env.KARTOTEK_EUROAPPLY; // not set on purpose: the first run checks the setup row
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await launchApp(env);
  const problems = [];
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text() + (m.location() && m.location().url ? ' [' + m.location().url + ']' : '')); });
    page.on('requestfailed', (r) => errors.push('request failed: ' + r.url()));
    page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ': ' + r.url()); });
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

    // Navigation (D1): two modes and a scope selector. Every entry of both modes is clicked in every scope and must render; then every
    // old tab id (saved state, #hash links) is opened and must land on a highlighted entry.
    const sidebar = '.k-nav-item';
    const clickMode = async (mode) => { await page.click('.k-mode button[data-mode="' + mode + '"]'); await page.waitForTimeout(350); };
    const visit = async (where, wanted) => {
      const labels = await page.$$eval(sidebar, (els) => els.map((b) => (b.innerText || '').trim().split('\n')[0]));
      for (const want of wanted) if (!labels.includes(want)) problems.push(where + ': entry "' + want + '" is missing (found ' + labels.join(', ') + ')');
      let shown = 0;
      for (let i = 0; i < labels.length; i++) {
        const target = (await page.$$(sidebar))[i];
        if (!target) { problems.push(where + ': entry ' + i + ' disappeared'); continue; }
        await target.click();
        await page.waitForTimeout(400);
        const len = await page.$eval('main', (m) => m.innerText.length).catch(() => 0);
        if (len < 20) problems.push(where + ': "' + labels[i] + '" rendered no content'); else shown++;
      }
      return shown;
    };
    const SHARED = ['Mind maps', 'Career', 'Settings', 'Algorithm'];
    let entries = 0;
    await clickMode('study');
    for (const scope of ['all', 'cents', 'tud']) {
      await page.selectOption('.k-scope-select', scope);
      await page.waitForTimeout(300);
      entries += await visit('Study mode, scope ' + scope, ['Review', 'Study', 'Cards', 'Mock exam', 'End-of-lesson test'].concat(SHARED));
      await clickMode('study');
    }
    await clickMode('planning');
    entries += await visit('Planning mode', ['Home', 'CEnT-S', 'TU Delft AE Prep', 'Application', 'Euro apply', 'Stats'].concat(SHARED));
    const oldTabs = ['study', 'etut', 'lesson', 'cards', 'mindmaps', 'stats', 'algo', 'settings', 'cents', 'tud', 'tud-apply']
      .concat(['cents', 'tud'].flatMap((x) => ['study', 'etut', 'cards', 'mock'].map((t) => x + '-' + t)));
    for (const id of oldTabs) {
      await page.evaluate((t) => window.App.switchTab(t), id);
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => ({ active: !!document.querySelector('.k-nav-item[aria-current="page"]'), len: document.querySelector('main').innerText.length }));
      if (!state.active || state.len < 20) problems.push('old tab id "' + id + '" does not open a highlighted, rendered entry');
    }
    // the mode and the scope are remembered
    await page.evaluate(() => window.App.switchTab('tud-etut'));
    await page.waitForTimeout(300);
    const remembered = await page.evaluate(() => ({ mode: window.App.pref('kartotek-mode'), scope: window.App.pref('kartotek-scope') }));
    if (remembered.mode !== 'study' || remembered.scope !== 'tud') problems.push('mode and scope are not remembered: ' + JSON.stringify(remembered));
    const labels = new Array(entries);

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

    // Models (E1): nothing set up -> the panel says so; add a command-line client through the form and test it; add a local
    // endpoint (a stand-in server) and an API key through the bridge; the key is encrypted on disk and never comes back.
    // No real service is called: the client is a node script and the endpoint answers from this process.
    {
      const st0 = await page.evaluate(() => window.kartotek.models.status());
      if (!st0.ok || st0.value.configured) problems.push('models: a fresh profile should have no model set up: ' + JSON.stringify(st0));
      const cliDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kartotek-smoke-cli-'));
      const echoJs = path.join(cliDir, 'answer.js');
      fs.writeFileSync(echoJs, "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({reply:'Kartotek connection works.'})));");
      const sse = require('http').createServer((q, r) => {
        if (q.url.endsWith('/models')) { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ data: [{ id: 'stand-in' }] })); return; }
        r.setHeader('Content-Type', 'text/event-stream');
        r.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '{"reply":"Kartotek connection works."}' }, finish_reason: 'stop' }] }) + '\n\n');
        r.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 9 } }) + '\n\n');
        r.end('data: [DONE]\n\n');
      });
      await new Promise((res) => sse.listen(0, '127.0.0.1', res));
      try {
        for (const b of await page.$$(sidebar)) {
          if ((((await b.innerText()) || '').trim().split('\n')[0]) === 'Settings') { await b.click(); break; }
        }
        await page.waitForSelector('#models-panel', { timeout: 8000 }).catch(() => problems.push('models: the Models panel is missing in Settings'));
        await page.click('#models-panel button:has-text("Add a provider")');
        await page.selectOption('.md-add select', 'cli-custom');
        await page.fill('.md-add label:has-text("Command or full path") input', process.execPath);
        await page.fill('.md-add label:has-text("Arguments") input', '"' + echoJs + '"');
        await page.click('.md-add button:has-text("Add")');
        await page.waitForSelector('.md-prov:has-text("Command-line client") button:has-text("Test connection")', { timeout: 8000 });
        await page.click('.md-prov:has-text("Command-line client") button:has-text("Test connection")');
        await page.waitForSelector('.md-prov:has-text("Command-line client") .md-test.is-ok', { timeout: 20000 })
          .catch(async () => problems.push('models: the command-line test failed: ' + await page.$eval('.md-prov .md-test', (e) => e.innerText).catch(() => '?')));
        const cliText = await page.$eval('.md-prov:has-text("Command-line client") .md-test', (e) => e.innerText).catch(() => '');
        if (!/Connection works/.test(cliText)) problems.push('models: the command-line test did not report "Connection works": ' + cliText);

        const base = 'http://127.0.0.1:' + sse.address().port + '/v1';
        const local = await page.evaluate(async (b) => {
          const M = window.kartotek.models;
          const s = await M.saveProvider({ id: 'local', kind: 'openai-compatible', preset: 'custom', baseUrl: b, label: 'Local stand-in' });
          const t = await M.test('smoke-local', 'local', 'stand-in', () => {});
          const k = await M.saveProvider({ id: 'anthropic', kind: 'anthropic' }, 'sk-ant-smoke-NOT-A-REAL-KEY-123');
          await M.setSlot('strong', 'cli', '');
          const st = await M.status();
          const u = await M.usage();
          return { saved: s.ok, test: t.ok ? { matches: t.value.replyMatches, kind: t.value.costKind } : t, keyOk: k.ok, cfg: JSON.stringify(k.value || {}), configured: st.ok && st.value.configured, calls: u.ok ? u.value.total.calls : -1 };
        }, base);
        if (!local.saved || !local.test.matches) problems.push('models: the local endpoint test failed: ' + JSON.stringify(local.test));
        if (!local.keyOk || local.cfg.includes('NOT-A-REAL-KEY') || !/"hasKey":true/.test(local.cfg)) problems.push('models: the key was not stored, or came back to the window');
        const keysBin = path.join(profile, 'models', 'keys.bin');
        if (!fs.existsSync(keysBin) || fs.readFileSync(keysBin).toString('latin1').includes('NOT-A-REAL-KEY')) problems.push('models: keys.bin missing or not encrypted');
        for (const f of ['providers.json']) if (fs.readFileSync(path.join(profile, 'models', f), 'utf8').includes('NOT-A-REAL-KEY')) problems.push('models: the key is in ' + f);
        if (!local.configured) problems.push('models: a slot was set but the status says nothing is set up');
        if (local.calls < 2) problems.push('models: usage shows ' + local.calls + ' calls');
        const usageText = fs.readdirSync(path.join(profile, 'models', 'usage')).map((f) => fs.readFileSync(path.join(profile, 'models', 'usage', f), 'utf8')).join('');
        if (/connection works|NOT-A-REAL-KEY/i.test(usageText)) problems.push('models: the usage log holds reply text or a key');
        console.log('Models: command-line client and local endpoint tested in the window; key encrypted (' + fs.statSync(keysBin).size + ' bytes); ' + local.calls + ' calls logged');
      } finally { sse.close(); fs.rmSync(cliDir, { recursive: true, force: true }); }
    }

    // Planning home and Euro apply without a folder (D2): Kartotek's own rows, what is missing, and a setup row instead of the app
    await clickMode('planning');
    await page.click('.k-nav-item[data-tab="home"]');
    await page.waitForSelector('#home-timeline', { timeout: 8000 }).catch(() => problems.push('the Planning home page did not open'));
    await page.waitForTimeout(600);
    const homeNone = await page.evaluate(() => ({ missing: (document.getElementById('home-missing') || {}).innerText || '', undated: (document.getElementById('home-undated') || {}).innerText || '' }));
    if (!/Euro apply deadlines/.test(homeNone.missing)) problems.push('Home: missing Euro apply data is not reported: ' + JSON.stringify(homeNone.missing));
    if (!/no exam date/.test(homeNone.undated)) problems.push('Home: Kartotek\'s own rows are missing without Euro apply: ' + JSON.stringify(homeNone.undated));
    await page.click('.k-nav-item[data-tab="euroapply"]');
    await page.waitForSelector('#euro-setup', { timeout: 5000 }).catch(() => problems.push('Euro apply: no setup row without a folder'));
    // the folder is saved in the profile's settings file (the folder picker writes the same key)
    const settingsFile = path.join(profile, 'settings.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (e) { /* none yet */ }
    fs.writeFileSync(settingsFile, JSON.stringify(Object.assign(saved, { euroApplyFolder: euroDir })));

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

    // Euro apply configured (D2): its deadline is on Home, read only; the page offers Start, then Open, and Open makes a window of its own
    await page2.click('.k-mode button[data-mode="planning"]');
    await page2.click('.k-nav-item[data-tab="home"]');
    await page2.waitForFunction(() => /Smoke registration deadline/.test((document.getElementById('home-timeline') || {}).innerText || ''), null, { timeout: 10000 })
      .catch(() => problems.push('Home: the Euro apply deadline is not on the timeline'));
    const home = await page2.evaluate(() => ({ text: (document.getElementById('home-timeline') || {}).innerText || '', missing: (document.getElementById('home-missing') || {}).innerText || '' }));
    if (!/Euro apply/.test(home.text) || !/Open in Euro apply/.test(home.text) || !/Euro apply data from/.test(home.text)) problems.push('Home: the Euro apply row does not say which app owns it or link to it');
    if (/Euro apply deadlines/.test(home.missing)) problems.push('Home: Euro apply is reported missing although its folder is set');
    await page2.click('.k-nav-item[data-tab="euroapply"]');
    await page2.waitForSelector('#euro-ready', { timeout: 8000 }).catch(() => problems.push('Euro apply: the page does not recognise the folder'));
    const fake = require('http').createServer((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end('<title>Euro apply fixture</title><h1>fixture</h1>'); });
    let ownPort = true;
    await new Promise((res) => { fake.once('error', () => { ownPort = false; res(); }); fake.listen(5178, '127.0.0.1', res); });
    try {
      await page2.click('.k-nav-item[data-tab="cents"]');
      await page2.click('.k-nav-item[data-tab="euroapply"]'); // reads the status again
      await page2.waitForSelector('#euro-open', { timeout: 8000 }).catch(() => problems.push('Euro apply: "Open Euro apply" is not offered although the server answers'));
      await page2.click('#euro-open').catch(() => {});
      let euroPage = null;
      for (let i = 0; i < 30 && !euroPage; i++) {
        euroPage = app.windows().find((w) => /^http:\/\/127\.0\.0\.1:5178\//.test(w.url()));
        if (!euroPage) await sleep(300);
      }
      if (!euroPage) problems.push('Euro apply did not open in a window of its own');
      else {
        const sealed = await euroPage.evaluate(() => ({ bridge: typeof window.kartotek, node: typeof require, process: typeof process })).catch(() => ({}));
        if (sealed.bridge !== 'undefined' || sealed.node !== 'undefined' || sealed.process !== 'undefined') problems.push('the Euro apply window is not sealed: ' + JSON.stringify(sealed));
        await euroPage.evaluate(() => { window.location.href = 'app://kartotek/index.html'; }).catch(() => {}); // must stay on Euro apply's own address
        await sleep(600);
        if (!/^http:\/\/127\.0\.0\.1:5178\//.test(euroPage.url())) problems.push('the Euro apply window navigated away: ' + euroPage.url());
        await euroPage.close().catch(() => {});
      }
    } finally { fake.close(); }
    if (!ownPort) console.log('Note: port 5178 was in use (a real Euro apply is running), so that server was opened instead of the stand-in.');
    console.log('Window: ' + (info && info.ok ? 'Electron ' + info.value.electron + ' (' + info.value.platform + ')' : '?') + '; sidebar entries: ' + labels.length + '; Algorithm tab: ' + shown + '; KTests: ' + direct.pass + '/' + direct.total);
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(contentDir, { recursive: true, force: true });
    fs.rmSync(euroDir, { recursive: true, force: true });
  }
  const unexpected = errors.filter((e) => !EXPECTED.test(e));
  const expected = errors.length - unexpected.length;
  if (unexpected.length) problems.push('console errors: ' + unexpected.join(' | '));
  console.log('Console errors: ' + unexpected.length + ' unexpected, ' + expected + ' expected (CSP blocking the sanitiser test payloads, refused path-escape probes)');
  if (problems.length) { console.log('FAILED:\n - ' + problems.join('\n - ')); annotate(problems); process.exit(1); }
  console.log('Smoke test passed');
}

const fail = (e) => {
  annotate(['could not run: ' + (e && (e.stack || e.message))]);
  console.error('Smoke test could not run: ' + (e && e.message));
  console.error('If Electron failed to launch on Windows, check whether Smart App Control blocks the unsigned electron.exe (see docs/PROGRESS.md, task C1).');
  process.exit(1);
};
process.on('unhandledRejection', fail);
main().catch(fail);
