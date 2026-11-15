'use strict';
// Navigation model tests (task D1): every tab id the engine, the saved state and #hash links know maps to a new place, and back.
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function run() {
  const nav = await import(pathToFileURL(path.join(__dirname, '..', 'ui', 'src', 'nav.js')).href);
  let n = 0;
  const t = (fn) => { fn(); n++; };

  // every old tab id (engine tab ids, saved 'kartotek-tab', #hash) has a place
  const OLD = ['study', 'etut', 'lesson', 'cards', 'mindmaps', 'stats', 'algo', 'settings', 'cents', 'tud', 'tud-apply']
    .concat(['cents', 'tud'].flatMap((x) => ['study', 'etut', 'cards', 'mock'].map((s) => x + '-' + s)));
  t(() => OLD.forEach((id) => assert.ok(nav.locate(id), 'no place for ' + id)));
  t(() => assert.strictEqual(nav.locate('nonsense'), null));

  // Study mode: the six old entries and their exam copies
  t(() => assert.deepStrictEqual(nav.locate('study'), { mode: 'study', scope: null, item: 'review' }));
  t(() => assert.deepStrictEqual(nav.locate('tud-etut'), { mode: 'study', scope: 'tud', item: 'study' }));
  t(() => assert.deepStrictEqual(nav.locate('cents-mock'), { mode: 'study', scope: 'cents', item: 'mock' }));
  t(() => assert.deepStrictEqual(nav.locate('lesson'), { mode: 'study', scope: undefined, item: 'lesson' }));
  // Planning mode: overviews, application, Euro apply, Stats
  t(() => ['cents', 'tud', 'tud-apply', 'euroapply', 'stats'].forEach((id) => assert.strictEqual(nav.locate(id).mode, 'planning')));
  // Visible in both modes: Mind maps, Career, Settings, Algorithm
  t(() => ['mindmaps', 'career', 'settings', 'algo'].forEach((id) => assert.strictEqual(nav.locate(id).mode, null)));

  // round trip: an entry and a scope give back exactly the old tab id
  t(() => {
    for (const item of nav.STUDY_ITEMS) {
      for (const scope of [null, 'all', 'cents', 'tud']) {
        const id = nav.studyTab(item.key, scope);
        const at = nav.locate(id);
        assert.strictEqual(at.item, item.key, id);
        if (item.scoped) assert.strictEqual(at.scope, scope === 'all' ? null : scope, id);
      }
    }
  });
  t(() => {
    assert.strictEqual(nav.studyTab('review', 'all'), 'study');
    assert.strictEqual(nav.studyTab('review', 'cents'), 'cents-study');
    assert.strictEqual(nav.studyTab('study', 'tud'), 'tud-etut');
    assert.strictEqual(nav.studyTab('cards', 'tud'), 'tud-cards');
    assert.strictEqual(nav.studyTab('mock', 'all'), 'mock-all');
    assert.strictEqual(nav.studyTab('mock', 'cents'), 'cents-mock');
    assert.strictEqual(nav.studyTab('lesson', 'tud'), 'lesson'); // not exam-scoped
  });

  // what each mode shows: Study mode has exactly the six entries once Mind maps is counted; nothing from Planning leaks in
  t(() => {
    const study = nav.visibleTabs('study', 'tud');
    assert.deepStrictEqual(study.slice(0, 5), ['tud-study', 'tud-etut', 'tud-cards', 'tud-mock', 'lesson']);
    assert.ok(study.includes('mindmaps') && study.includes('career') && study.includes('settings') && study.includes('algo'));
    assert.ok(!study.includes('stats') && !study.includes('cents') && !study.includes('tud-apply'));
    const plan = nav.visibleTabs('planning', 'tud');
    assert.deepStrictEqual(plan.slice(0, 5), ['cents', 'tud', 'tud-apply', 'euroapply', 'stats']);
    assert.ok(plan.includes('mindmaps') && plan.includes('settings') && plan.includes('algo') && plan.includes('career'));
  });
  // every old tab is reachable from some visible list (in some mode and scope), so every existing screen stays reachable
  t(() => {
    const reach = new Set();
    for (const mode of nav.MODES) for (const sc of ['all', 'cents', 'tud']) nav.visibleTabs(mode, sc).forEach((id) => reach.add(id));
    OLD.forEach((id) => assert.ok(reach.has(id), 'unreachable: ' + id));
  });
  // reading order is stable for the transition direction
  t(() => assert.ok(nav.orderOf('study') < nav.orderOf('lesson') && nav.orderOf('lesson') < nav.orderOf('cents') && nav.orderOf('cents') < nav.orderOf('settings')));
  t(() => assert.strictEqual(nav.orderOf('cents-study'), nav.orderOf('study')));
  return n;
}

module.exports = { run };
