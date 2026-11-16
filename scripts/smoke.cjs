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

    // Model calls while studying (E2): a stand-in model answers by the schema it is asked for. Grading proposal of a typed answer,
    // Explain, Practice this again, Feynman feedback and Ask about this card each make a call, show their answer and store it where
    // it belongs; the scheduler's inputs do not change; the usage log has the features and no learner text.
    {
      const answers = (body) => {
        if (body.includes('stuck_at')) { const m = /The rung requested now[\s\S]*?text\\n(R[0-5]|statement_repair)/.exec(body); const rung = m ? m[1] : 'R0'; return { rung, stuck_at: 'Which settings keep the gate closed', hint: 'Look again at what makes the gate open (' + rung + ').', reveals: '' }; }
        if (body.includes('explanation_md')) return { explanation_md: 'The gate opens only when **both** switches are on.', item_status: 'consistent', item_note: '', refs: ['S1 ¶1'], next_steps: ['Reread the rule'] };
        if (body.includes('numeric_value')) return { items: [{ format: 'mcq_single', stem: 'A is on and B is on. What is the gate state?', options: [{ id: 'a', md: 'Open', note: 'Correct.' }, { id: 'b', md: 'Closed', note: 'Both are on.' }, { id: 'c', md: 'Unknown', note: 'The rule decides.' }], key: ['a'], numeric_value: 0, numeric_tol: 0, numeric_unit: '', rubric_criteria: [], model_answer: '', accept: [], contradictions: [], solution: 'Both on: open.', hints: [], units: ['U1'], difference: 'Both switches on.' }] };
        if (body.includes('not_met')) return { criteria: [{ id: 'C-2', mark: 'met', quote: 'closed', reason: 'It says closed.' }, { id: 'C-3', mark: 'met', quote: 'B is off', reason: 'Gives the reason.' }], summary: 'Both there.' };
        if (body.includes('misstatements')) return { criteria: [{ id: 'C-1', status: 'covered', quote: 'both switches', comment: 'Names the condition.' }], misstatements: [], questions: ['What if A is off?'], overall: 'A start.' };
        return { answer_md: 'Because of the rule.', common_mistake: 'Mixing and/or.', refs: ['S1 ¶1'], practice_question: 'What if B is off?', practice_answer: 'Closed.', limits: '' };
      };
      let nCalls = 0;
      const srv = require('http').createServer((q, r) => {
        let body = '';
        q.on('data', (d) => { body += d; });
        q.on('end', () => {
          if (q.url.endsWith('/models')) { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ data: [{ id: 'stand-in' }] })); return; }
          nCalls++;
          r.setHeader('Content-Type', 'text/event-stream');
          r.write('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(answers(body)) }, finish_reason: 'stop' }] }) + '\n\n');
          r.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 500, completion_tokens: 120 } }) + '\n\n');
          r.end('data: [DONE]\n\n');
        });
      });
      await new Promise((res) => srv.listen(0, '127.0.0.1', res));
      const SID = 'c2-first';
      try {
        await page.evaluate(async (b) => {
          const M = window.kartotek.models;
          await M.saveProvider({ id: 'e2', kind: 'openai-compatible', preset: 'custom', baseUrl: b, label: 'E2 stand-in' });
          await M.setSlot('strong', 'e2', 'stand-in'); await M.setSlot('fast', 'e2', 'stand-in');
        }, 'http://127.0.0.1:' + srv.address().port + '/v1');
        await page.reload(); // the buttons read the model status when the window starts
        await page.waitForSelector('main', { timeout: 15000 });
        await page.waitForFunction(() => window.App && window.App.S && window.App.store.mode === 'file', null, { timeout: 15000 });
        await page.evaluate((id) => window.App.goStudy(id), SID);
        await page.waitForTimeout(800);
        await page.evaluate((id) => {
          const App = window.App, et = App.S.etuts[id], K = window.KCycle;
          if (!et.progress.started_at) et.progress.started_at = Date.now();
          K.goto(et, 0, 0, 'apply', Date.now());
          const idx = K.itemIndex(et.package, App.studyExtras && App.studyExtras[et.etut_id]);
          const a = K.startAttempt(et, idx.i1, 'practice', Date.now());
          K.commit(et, a, { text: 'The gate is closed, because B is off.', confidence: 'sure' }, idx.i1, Date.now());
          App.EtutUI.commit(et); App.render();
        }, SID);
        const snap = () => page.evaluate((id) => { const S = window.App.S, a = S.etuts[id].progress.attempts.slice(-1)[0]; return { reviews: S.reviews.length, result: JSON.stringify(a.result), conf: a.confidence, hints: a.hints }; }, SID);
        const before = await snap();
        // a typed answer: the model proposes, the learner confirms
        await page.click('button:has-text("Suggest a grading")', { timeout: 10000 });
        await page.waitForSelector('.mc-prop', { timeout: 20000 }).catch(() => problems.push('E2: no grading proposal was shown'));
        const prop = await page.$$eval('.mc-prop', (e) => e.map((x) => x.innerText)).catch(() => []);
        if (prop.length !== 2 || !prop.every((t) => /The model proposed Met/.test(t))) problems.push('E2: the proposal rows are wrong: ' + JSON.stringify(prop));
        await page.click('button:has-text("Confirm this grading")');
        await page.waitForTimeout(600);
        const g = await page.evaluate((id) => { const a = window.App.S.etuts[id].progress.attempts.slice(-1)[0]; return { grading: a.grading, model: a.model_grading && a.model_grading.by && a.model_grading.by.model, provider: a.model_grading && a.model_grading.by && a.model_grading.by.provider, correct: a.result && a.result.correct }; }, SID);
        if (g.grading !== 'model' || g.model !== 'stand-in' || g.provider !== 'E2 stand-in' || g.correct !== true) problems.push('E2: the confirmed grading is not recorded as "model": ' + JSON.stringify(g));
        const afterGrade = await snap();
        // Explain: saved on the attempt; nothing the scheduler reads changes
        await page.click('main button:has-text("Explain")');
        await page.click('.cy-panel button:has-text("Explain")');
        await page.waitForSelector('.cy-expl', { timeout: 20000 }).catch(() => problems.push('E2: Explain showed no explanation'));
        const expl = await page.$eval('.cy-expl', (e) => e.innerText).catch(() => '');
        if (!/both switches are on/.test(expl) || !/E2 stand-in/.test(expl) || !/does not count as recall/.test(expl)) problems.push('E2: the explanation is incomplete: ' + expl);
        const afterExplain = await snap();
        if (JSON.stringify(afterExplain) !== JSON.stringify(afterGrade)) problems.push('E2: Explain changed what the scheduler reads: ' + JSON.stringify([afterGrade, afterExplain]));
        // Practice this again: checked items kept with the data, not sent
        await page.click('main button:has-text("Practice this again")');
        await page.click('button:has-text("Write follow-up questions")');
        await page.waitForSelector('.mc-fu-list', { timeout: 20000 }).catch(() => problems.push('E2: no follow-up question was listed'));
        const fu = await page.evaluate((id) => { const p = window.App.S.etuts[id].progress; return Object.keys(p.followups || {}).map((q) => ({ of: p.followups[q].followup_of, v: p.followups[q].validation })); }, SID);
        if (fu.length !== 1 || fu[0].v !== 'unverified' || !fu[0].of) problems.push('E2: the follow-up item is not stored as expected: ' + JSON.stringify(fu));
        const afterFollow = await snap();
        if (afterFollow.reviews !== afterExplain.reviews) problems.push('E2: a follow-up question reached the review log');
        // Ask for a hint (F2): one rung per press, recorded as assistance, never sent to the reviews
        await page.evaluate((id) => {
          const App = window.App, et = App.S.etuts[id], K = window.KCycle;
          K.goto(et, 0, 0, 'apply', Date.now());
          const idx = K.itemIndex(et.package, App.studyExtras && App.studyExtras[et.etut_id]);
          et.progress.current = null;
          K.startAttempt(et, idx.i2, 'practice', Date.now());
          App.EtutUI.commit(et); App.switchTab('etut'); App.goStudy(id); App.render();
        }, SID);
        await page.waitForSelector('.cy-answer', { timeout: 8000 });
        await page.click('.cy-mhints button:has-text("Ask for a hint")');
        await page.waitForSelector('.cy-mhints li', { timeout: 20000 }).catch(() => problems.push('F2: no hint was shown'));
        await page.click('.cy-mhints button:has-text("Ask for the next step")');
        await page.waitForFunction(() => document.querySelectorAll('.cy-mhints li').length === 2, null, { timeout: 20000 }).catch(() => problems.push('F2: the second request gave no second step'));
        const hintTxt = await page.$$eval('.cy-mhints li b', (e) => e.map((x) => x.innerText)).catch(() => []);
        if (hintTxt.join('|') !== 'Level R0 · Look again|Level R1 · The pattern') problems.push('F2: the levels shown are wrong: ' + JSON.stringify(hintTxt));
        const hs = await page.evaluate((id) => { const S = window.App.S, a = S.etuts[id].progress.attempts.slice(-1)[0]; return { levels: (a.help || []).map((h) => h.level).join(), assisted: window.KCycle.assisted(a), reviews: S.reviews.length }; }, SID);
        if (hs.levels !== 'R0,R1' || !hs.assisted) problems.push('F2: the rungs were not recorded as assistance: ' + JSON.stringify(hs));
        // Feynman feedback
        await page.evaluate((id) => { const App = window.App, et = App.S.etuts[id]; window.KCycle.goto(et, 0, 0, 'work', Date.now()); App.EtutUI.commit(et); App.render(); }, SID);
        await page.waitForSelector('.cy-feynman textarea', { timeout: 8000 });
        await page.fill('.cy-feynman textarea', 'The gate opens only when both switches are on. I am not sure what the display does.');
        await page.click('.cy-feynman button:has-text("Save as version")');
        await page.waitForTimeout(300);
        const fyBefore = await page.evaluate((id) => JSON.stringify([window.App.S.etuts[id].progress.feynman, window.App.S.etuts[id].progress.satisfied]), SID);
        await page.click('.mc-feynman button:has-text("Get feedback")');
        await page.waitForSelector('.mc-fb', { timeout: 20000 }).catch(() => problems.push('E2: no Feynman feedback was shown'));
        const fb = await page.$eval('.mc-fb', (e) => e.innerText).catch(() => '');
        if (!/both switches/.test(fb) || !/Covered/.test(fb)) problems.push('E2: Feynman feedback has no quote or status: ' + fb);
        const fyAfter = await page.evaluate((id) => JSON.stringify([window.App.S.etuts[id].progress.feynman, window.App.S.etuts[id].progress.satisfied]), SID);
        if (fyBefore !== fyAfter) problems.push('E2: Feynman feedback changed my versions or "I\'m satisfied"');
        // Ask about this card on Review
        await page.evaluate(() => window.App.switchTab('study'));
        await page.waitForTimeout(800);
        await page.keyboard.press('Space');
        await page.click('button:has-text("Ask about this card")', { timeout: 10000 });
        await page.fill('.mc-ask input', 'Why is it closed?');
        await page.click('.mc-ask button:has-text("Ask")');
        await page.waitForSelector('.mc-answer', { timeout: 20000 }).catch(() => problems.push('E2: no answer about the card was shown'));
        // the calls were logged by feature, without any text
        const usageText = fs.readdirSync(path.join(profile, 'models', 'usage')).map((f) => fs.readFileSync(path.join(profile, 'models', 'usage', f), 'utf8')).join('');
        for (const f of ['typed-grading', 'explain', 'followup-items', 'feynman-feedback', 'ask-card', 'hint-giver']) if (!usageText.includes('"feature":"' + f + '"')) problems.push('E2: the usage log has no ' + f + ' call');
        if (/gate is closed|both switches|Why is it closed/i.test(usageText)) problems.push('E2: the usage log holds learner text');
        if (nCalls !== 7) problems.push('E2/F2: expected 7 model calls, the stand-in saw ' + nCalls);
        void before;
        console.log('Model calls while studying: grading proposal (recorded as "model"), Explain, follow-up item, Feynman feedback and a card question each answered by the stand-in; ' + nCalls + ' calls, none changed what the scheduler reads');
      } finally {
        srv.close();
        await page.evaluate(async () => { const M = window.kartotek.models; await M.setSlot('fast', '', ''); await M.removeProvider('e2'); }).catch(() => {});
      }
    }

    // Thinking and confidence (F1): answer through the screen with the slider and the thinking box; "I don't know" is a separate choice
    {
      const SID = 'c2-first';
      const startOn = async (q) => {
        await page.evaluate(({ id, q }) => {
          const App = window.App, et = App.S.etuts[id], K = window.KCycle;
          K.goto(et, 0, 0, 'apply', Date.now());
          const idx = K.itemIndex(et.package, App.studyExtras && App.studyExtras[et.etut_id]);
          et.progress.current = null;
          K.startAttempt(et, idx[q], 'practice', Date.now());
          App.EtutUI.commit(et); App.switchTab('etut'); App.goStudy(id); App.render();
        }, { id: SID, q });
        await page.waitForSelector('.cy-answer', { timeout: 8000 });
      };
      const last = () => page.evaluate((id) => { const S = window.App.S, a = S.etuts[id].progress.attempts.slice(-1)[0]; return { thinking: a.thinking, pct: a.confidence_pct, band: a.confidence, dk: a.dont_know, correct: a.result && a.result.correct, dsr: a.dsr && a.dsr.rating, reviews: S.reviews.length, miscon: !!(S.etuts[id].progress.misconceptions || {}).k1 }; }, SID);
      try {
        await startOn('i2');
        const nothing = await page.$eval('.cy-answer .k-btn.primary', (b) => b.disabled).catch(() => null);
        // the right option, wherever the shuffle put it (a wrong answer given as Sure would rightly flag a misconception)
        const rightAt = await page.evaluate((id) => { const et = window.App.S.etuts[id], a = et.progress.attempts.slice(-1)[0], it = window.KCycle.itemIndex(et.package)[a.q_id]; return a.order.indexOf(it.key[0]); }, SID);
        await page.click('.cy-opt >> nth=' + rightAt);
        await page.fill('.th textarea', 'I looked for the rule about both switches.');
        const still = await page.$eval('.cy-answer .k-btn.primary', (b) => b.disabled);
        await page.focus('.cf-range');
        await page.keyboard.press('3');
        const shown = await page.$eval('.cf-val', (e) => e.innerText);
        await page.click('.cy-answer .k-btn.primary');
        await page.waitForTimeout(600);
        const a = await last();
        if (nothing !== true || still !== true) problems.push('F1: the Check button was enabled before a confidence was set');
        if (!/90/.test(shown)) problems.push('F1: key 3 did not set 90: ' + shown);
        if (a.thinking !== 'I looked for the rule about both switches.' || a.pct !== 90 || a.band !== 'sure') problems.push('F1: the attempt did not store thinking and a numeric confidence: ' + JSON.stringify(a));
        await startOn('i4');
        await page.click('.cf button[data-act="dontknow"]');
        await page.click('.cy-answer .k-btn.primary');
        await page.waitForTimeout(600);
        const d = await last();
        if (!d.dk || d.correct !== false || d.pct !== null || d.band !== null || d.dsr !== 'again' || d.miscon) problems.push('F1: "I don\'t know" was not recorded as a gap sent as Again: ' + JSON.stringify(d));
        console.log('Thinking and confidence: an answer stored its thinking text and 90 (Sure); "I don\'t know" was kept as a gap and sent as Again without a misconception flag');
      } catch (e) { problems.push('F1: the answer screen failed: ' + e.message); }
    }

    // Find my level and the plan map (F3): Priming shows both; the self-rating route (no model) stores a probe record, the map colours the
    // topic, it can be skipped (counts as complete) and nothing reaches the reviews
    {
      const SID = 'c2-first';
      try {
        const before = await page.evaluate((id) => {
          const App = window.App, et = App.S.etuts[id];
          window.KCycle.goto(et, 0, 0, 'priming', Date.now()); App.EtutUI.commit(et); App.switchTab('etut'); App.goStudy(id); App.render();
          return { reviews: App.S.reviews.length, topics: window.KGraph.topicsOf(et.package).length, first: et.package.parts[0].kazanimlar[0].kazanim_id };
        }, SID);
        await page.waitForSelector('.pm .gv-node', { timeout: 8000, state: 'attached' });
        await page.$eval('.pm', (d) => { d.open = true; });
        const nodes = await page.$$eval('.pm .gv-node', (l) => l.length);
        await page.click('.pb button:has-text("Rate myself instead")');
        const rows = await page.$$eval('.pm-self-row', (l) => l.length);
        for (let i = 0; i < rows; i++) await page.click('.pm-self-row >> nth=' + i + ' >> button:has-text("Yes")');
        await page.click('.pb button:has-text("Save my rating")');
        await page.waitForTimeout(500);
        await page.$eval('.pm', (d) => { d.open = true; });
        const labels = await page.$$eval('.pm .gv-node', (l) => l.map((n) => n.getAttribute('aria-label')));
        // every topic was rated held; a topic earlier blocks answered wrongly is redrawn from that evidence as "gap found" and cannot be skipped
        const gapAt = labels.findIndex((l) => /gap found in Applying/.test(l)), heldAt = labels.findIndex((l) => /, held/.test(l));
        let gapOk = true;
        if (gapAt >= 0) {
          await page.click('.pm .gv-node >> nth=' + gapAt);
          gapOk = (await page.$$('.pm-detail button:has-text("Skip this topic")')).length === 0 && /show a gap/.test(await page.$eval('.pm-detail', (d) => d.innerText));
        }
        if (heldAt < 0) throw new Error('no topic is coloured held after the rating: ' + labels.join(' | '));
        const k = await page.evaluate(({ id, i }) => window.KGraph.topicsOf(window.App.S.etuts[id].package)[i].kid, { id: SID, i: heldAt });
        await page.click('.pm .gv-node >> nth=' + heldAt);
        await page.click('.pm-detail button:has-text("Skip this topic")');
        await page.waitForTimeout(400);
        const after = await page.evaluate(({ id, k }) => { const S = window.App.S, et = S.etuts[id]; return { probes: et.progress.probes.length, source: et.progress.probes.slice(-1)[0].source, skipped: !!et.progress.skipped[k], done: window.KCycle.cycleDone(et, k), reviews: S.reviews.length, chip: !!document.querySelector('.cy-nav-skip') }; }, { id: SID, k });
        if (nodes !== before.topics) problems.push('F3: the plan map shows ' + nodes + ' topics, the study has ' + before.topics);
        if (!gapOk) problems.push('F3: a topic with a gap in Applying could still be skipped, or no reason was shown');
        if (after.probes < 1 || after.source !== 'self' || !after.skipped || !after.done || !after.chip || after.reviews !== before.reviews) problems.push('F3: self-rating or skipping went wrong: ' + JSON.stringify(after));
        await page.evaluate(({ id, k }) => { const et = window.App.S.etuts[id]; window.KPlan.unskip(et, k); window.App.EtutUI.commit(et); window.App.render(); }, { id: SID, k });
        console.log('Find my level and plan map: Priming showed both; a self-rating was stored as a probe and coloured the map; a held topic was skipped (complete for End), ' + (gapAt >= 0 ? 'a topic with a gap in Applying could not be' : 'no topic had a gap') + '; the reviews did not change');
      } catch (e) { problems.push('F3: Priming, Find my level or the plan map failed: ' + e.message); }
    }

    // Live teaching (F4): a prediction answered through the screen is kept with its thinking and confidence; Pause, a window reload (the
    // data files are read again, as after a restart) and Resume continue the session at the same point. No model call is needed for this.
    {
      try {
        const sid = await page.evaluate(() => {
          const App = window.App, PL = window.KPlan, KL = window.KLive, S = App.S;
          const s = PL.newSession(S, { goal_words: 'Smoke live session', now: Date.now() });
          s.probe = { status: 'done', source: 'model', strands: [], questions: [], goal: { concrete: 'Smoke goal', questions: [] }, result: { strands: [], asked: 0, closing: '', levels: {} }, generator: [] };
          s.status = 'plan';
          const node = (id, kind, deps) => ({ id, label: 'Node ' + id, kind, depends_on: deps, units: [], why: '', mode: 'socratic' });
          PL.addPlanVersion(s, { approach: 'Smoke plan.', nodes: [node('held', 'held', []), node('step-one', 'learn', ['held']), node('goal-smoke', 'goal', ['step-one'])], uncertain: [] }, { now: Date.now() });
          PL.acceptPlan(s, Date.now());
          const E = { resolves: '', md: '', refs: [], uncertain: [], gap: { label: '', why: '', before: '' } };
          KL.applyReply(s, 'predict', { phase: 'predict', node: 'step-one', question: { kind: 'open', stem: 'What has to change for the smoke step?', options: [], key: '', why: '' }, teach: E, check: { stem: '', options: [], key: '' }, done_summary: '' }, { now: Date.now() });
          App.store.commit({ meta: true });
          App.liveOpen = s.id; App.switchTab('etut'); App.render();
          return s.id;
        });
        await page.waitForSelector('.lt-step .pb-q textarea.k-input:not([data-f])', { timeout: 8000 });
        await page.fill('.lt-step .pb-q textarea.k-input:not([data-f])', 'The second rule replaces the first.');
        await page.fill('.lt-step .th textarea', 'I compared it with the last case.');
        await page.focus('.lt-step .cf-range');
        await page.keyboard.press('2');
        await page.click('.lt-step button:has-text("Send my prediction")');
        await page.click('.st-run-head button:has-text("Pause")');
        await page.waitForTimeout(800);
        const before = await page.evaluate((id) => { const s = window.App.S.sessions[id], a = s.steps[0].predict.answer; return { status: s.status, text: a && a.text, pct: a && a.confidence_pct, thinking: a && a.thinking, phase: window.KLive.phase(s) }; }, sid);
        await page.reload();
        await page.waitForSelector('main', { timeout: 15000 });
        await page.waitForFunction(() => window.App && window.App.S && window.App.store.mode === 'file', null, { timeout: 15000 });
        await page.evaluate((id) => { window.App.liveOpen = id; window.App.switchTab('etut'); window.App.render(); }, sid);
        await page.waitForSelector('.st-run-head button:has-text("Resume")', { timeout: 8000 });
        await page.click('.st-run-head button:has-text("Resume")');
        await page.waitForTimeout(500);
        const after = await page.evaluate((id) => { const s = window.App.S.sessions[id], a = s.steps[0].predict.answer; return { status: s.status, text: a && a.text, pct: a && a.confidence_pct, phase: window.KLive.phase(s), pauses: (s.pauses || []).length, reviews: window.App.S.reviews.length }; }, sid);
        if (before.status !== 'paused' || before.text !== 'The second rule replaces the first.' || before.pct !== 60 || before.thinking !== 'I compared it with the last case.') problems.push('F4: the prediction or the pause was not saved: ' + JSON.stringify(before));
        if (after.status !== 'teach' || after.text !== before.text || after.phase !== 'teach' || after.pauses !== 1) problems.push('F4: the session did not resume where it was after a reload: ' + JSON.stringify(after));
        console.log('Live teaching: a prediction answered on screen kept its thinking and 60 %; paused, reloaded and resumed at the same point (the teacher is asked next)');
      } catch (e) { problems.push('F4: the live teaching screen failed: ' + e.message); }
    }

    // Adaptive practice (F5): Evaluating shows the open problem; work typed on screen is stored as a claim; "Report a problem" marks it
    // disputed and ends it; nothing reaches the reviews. The problem is put in place directly, so no model call is needed.
    {
      const SID = 'c2-first';
      try {
        const sid = await page.evaluate((id) => {
          const App = window.App, et = App.S.etuts[id], KP = window.KPractice, kid = et.package.parts[0].kazanimlar[0].kazanim_id;
          const s = KP.newSession(App.S, { purpose: 'evaluating', title: 'Smoke practice', etut_id: id, kids: [kid], targets: KP.targetsFor(et.package, kid), now: Date.now() });
          KP.linkEvaluating(et, kid, s);
          const E = { problem: { statement: '', setting: '', template: '', targets: [], solution: '', answer: '' }, check: { sound: true, issue: '', solution: '', answer: '' }, verdict: { result: 'not_yet', moves: '', first_break: '', feedback: '' }, own: { solvable: true, issue: '', solution: '', answer: '', targets: [] } };
          const sp = KP.nextSpec(s);
          KP.applyReply(s, 'write', Object.assign(JSON.parse(JSON.stringify(E)), { task: 'problem', problem: { statement: 'Smoke problem: which setting opens the gate?', setting: 'gate', template: '', targets: sp.targets, solution: 'Both switches on.', answer: 'both on' } }), { now: Date.now() });
          KP.applyReply(s, 'check', Object.assign(JSON.parse(JSON.stringify(E)), { task: 'check', check: { sound: true, issue: '', solution: 'Both switches on.', answer: 'both on' } }), { now: Date.now() });
          window.KCycle.goto(et, 0, 0, 'evaluate', Date.now());
          App.liveOpen = null; App.practiceOpen = null;   // the F4 block left the live session open
          App.store.commit({ meta: true, etuts: [id] }); App.switchTab('etut'); App.goStudy(id); App.render();
          return s.id;
        }, SID);
        await page.waitForSelector('.pr .pb-q textarea[data-f="thinking"]', { timeout: 8000 });
        const before = await page.evaluate(() => window.App.S.reviews.length);
        await page.fill('.pr .pb-q textarea[data-f="thinking"]', 'Both switches must be on, by the rule.');
        await page.fill('.pr .pb-q input.k-input', 'both on');
        await page.click('.pr button:has-text("Check my work")');
        await page.waitForTimeout(800);
        await page.click('.pr button:has-text("Report a problem")');
        await page.fill('.pr .cy-actions input.k-input', 'smoke report');
        await page.click('.pr button:has-text("Report")');
        await page.waitForTimeout(500);
        const r = await page.evaluate((id) => { const s = window.App.S.sessions[id], p = s.problems[0]; return { subs: p.submissions.length, thinking: p.submissions[0] && p.submissions[0].thinking, answer: p.submissions[0] && p.submissions[0].answer, disputed: !!p.disputed && p.disputed.note, status: p.status, reviews: window.App.S.reviews.length, counted: window.KPractice.summary(s).problems }; }, sid);
        if (r.subs !== 1 || r.thinking !== 'Both switches must be on, by the rule.' || r.answer !== 'both on') problems.push('F5: the work typed on screen was not stored: ' + JSON.stringify(r));
        if (r.disputed !== 'smoke report' || r.status !== 'ended' || r.counted !== 0 || r.reviews !== before) problems.push('F5: "Report a problem" did not mark it disputed or something reached the reviews: ' + JSON.stringify(r));
        console.log('Adaptive practice: Evaluating showed the problem; the work was stored as a claim; "Report a problem" marked it disputed and ended it; no review event');
      } catch (e) { problems.push('F5: the practice screen failed: ' + e.message); }
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
