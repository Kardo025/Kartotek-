'use strict';
// Takes the README screenshots (docs/screenshots/*.png) from the bridge preview, with the synthetic samples only (task G2).
//   node scripts/bridge-preview.cjs --profile <empty folder> --port 8781 --content samples
//   node scripts/screenshots.cjs [--url http://127.0.0.1:8781/] [--out docs/screenshots] [--list]
// It drives Microsoft Edge (already on the PC; no browser download). Nothing private can appear: the preview serves samples\ and an
// empty profile. --list prints the sidebar entries instead of taking pictures.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('--url', 'http://127.0.0.1:8781/');
const out = path.resolve(arg('--out', path.join(__dirname, '..', 'docs', 'screenshots')));
const SHOTS = [
  // [file, sidebar text, which match (the "Study" mode switch comes first, the Study entry second), a heading to scroll to]
  ['review', 'Review', 0, null],
  ['study-library', 'Study', 1, null],
  ['knowledge-graph', 'Knowledge graph', 0, null],
  ['settings-models', 'Settings', 0, 'Models'],
];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  await page.goto(url);
  await page.waitForTimeout(800);
  const click = async (re) => { const b = page.getByRole('button', { name: re }).first(); if (await b.count()) { await b.click(); await page.waitForTimeout(500); return true; } return false; };
  await click(/^Start$/);             // the welcome stage
  await click(/start empty/i);        // the first-run panel
  await page.waitForTimeout(800);
  if (process.argv.includes('--list')) {
    console.log((await page.locator('nav, aside').first().innerText()).replace(/\n+/g, ' | '));
    console.log(await page.title());
    await browser.close();
    return;
  }
  for (const [file, label, nth, inner] of SHOTS) {
    const link = page.locator('nav, aside').getByText(label, { exact: true }).nth(nth);
    if (await link.count()) { await link.click(); await page.waitForTimeout(900); }
    let panel = null; // a heading: only its panel is photographed (the Content panel below it shows a folder path)
    if (inner) { const h = page.locator('h2, h3').filter({ hasText: new RegExp('^' + inner + '$') }).first(); if (await h.count()) { panel = h.locator('xpath=ancestor::*[contains(@class,"k-panel")][1]'); await panel.scrollIntoViewIfNeeded(); await page.waitForTimeout(500); } }
    if (panel && await panel.count()) { await panel.screenshot({ path: path.join(out, file + '.png') }); console.log('wrote ' + file + '.png (panel)'); continue; }
    await page.screenshot({ path: path.join(out, file + '.png') });
    console.log('wrote ' + file + '.png');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
