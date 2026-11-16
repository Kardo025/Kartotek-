'use strict';
// Mind-map vision tasks in the app (task E3, MINDMAP-RULES.md): Task A/B (read the photos into map.json) and Task C (one coaching
// turn into turns/NNN.json), both through the vision slot. The window builds the same request text it gives Claude Code
// (KMind.readPrompt / coachPrompt); the rules file and the photos (resized for the model) go with it. The answer must pass
// KMind.validateMap / validateTurn before anything is written; Kartotek imports it on Reload as before.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S } = require('./schemas');
const C = require('./common');

const MAP_ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

// The sections of MINDMAP-RULES.md a task needs (the whole file is long; the schema sections are what the answer must follow)
function rulesFor(text, which) {
  const sec = (n) => { const m = new RegExp('\\n## ' + n + '\\. [\\s\\S]*?(?=\\n## \\d+\\. |$)').exec('\n' + text); return m ? m[0].trim() : ''; };
  return which === 'read' ? [sec(2), sec(4), sec(5)].join('\n\n') : [sec(2), sec(6)].join('\n\n');
}

function viewsFolder(ctx, mapId) { const c = ctx.content && ctx.content.dir(); return c ? path.join(c, 'mindmaps', mapId) : null; }

// ---------------------------------------------------------------- Task A / B: read the map
const read = {
  async prepare(ctx) {
    const r = ctx.request;
    if (!MAP_ID_RE.test(r.mapId || '')) throw new Error('Invalid map id.');
    if (!Array.isArray(r.views) || !r.views.length) throw new Error('Choose the photos of the map.');
    if (!(ctx.content && ctx.content.dir())) throw new Error('Set a content folder first (Settings, Content): the map files are written there.');
    r.views.forEach((v) => { if (!fs.existsSync(v.file)) throw new Error('Photo not found: ' + path.basename(v.file)); });
    ctx.job.title = 'Read mind map "' + (r.title || r.mapId) + '"';
    ctx.plan([['photos', 'Copy and prepare the photos'], ['read', 'Read the map (vision)'], ['save', 'Save map.json']]);
  },
  estimate(ctx) {
    const n = ctx.request.views.length;
    return { rows: [{ step: 'Reading', slot: 'vision', calls: 2, input: n * 2500 + 9000, output: 9000 }], note: n + ' photo' + (n > 1 ? 's' : '') + '; one reading call and at most ' + ctx.limits.repairs + ' repairs.' };
  },
  async run(ctx) {
    const r = ctx.request, d = ctx.data, folder = viewsFolder(ctx, r.mapId);
    await ctx.step('photos', 'Copy and prepare the photos', async (step) => {
      d.views = [];
      for (const v of r.views) {
        const ext = path.extname(v.file).toLowerCase() || '.jpg';
        const name = v.id + '-' + (v.role || 'other') + ext;
        const to = path.join(folder, 'views', name);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (path.resolve(v.file) !== path.resolve(to)) fs.copyFileSync(v.file, to);
        const buf = fs.readFileSync(v.file);
        const img = await ctx.extract.imageForModel(to, 1600);
        d.views.push({ id: v.id, role: v.role || 'other', file: 'views/' + name, abs: to, name: v.name || path.basename(v.file), width: img.width, height: img.height, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
      }
      step.detail = d.views.length + ' photos in mindmaps\\' + r.mapId + '\\views';
    });
    await ctx.step('read', 'Read the map (vision)', async (step) => {
      const images = [];
      for (const v of d.views) images.push(await ctx.extract.imageForModel(v.abs, 1600));
      const res = await ctx.task(step, 'read', 'Reading', async (task) => {
        const out = await C.askChecked(ctx, task, { prompt: 'mind-read', slot: 'vision', images, maxOutputTokens: 16000, feature: 'job:mind:read', effort: 'high',
          vars: { rules: rulesFor(ctx.files.rules('MINDMAP-RULES.md'), 'read'), request: r.prompt || '', views: d.views.map((v, i) => 'Image ' + (i + 1) + ' = view ' + v.id + ' (' + v.role + '), file ' + v.file + ', ' + v.width + '×' + v.height + ' px upright, sha256 ' + v.sha256).join('\n'),
            ids: 'map_id "' + r.mapId + '", parse_rev ' + (r.parseRev || 1) } },
        (j) => ctx.checks.mindMap(fix(j), r.mapId), ctx.limits.repairs);
        return out.json;
      });
      d.map = fix(res);
      function fix(j) {
        if (!j || typeof j !== 'object') return j;
        const m = Object.assign({}, j, { schema: 'kmind-map-1', map_id: r.mapId, parse_rev: r.parseRev || 1, parsed_at: new Date(ctx.now()).toISOString() });
        // the files, sizes and hashes are Kartotek's own measurements, not the model's
        if (Array.isArray(m.views)) m.views = m.views.map((v) => { const own = d.views.find((x) => x.id === v.id); return own ? Object.assign({}, v, { file: own.file, width: own.width, height: own.height, sha256: own.sha256 }) : v; });
        return m;
      }
    });
    let result = null;
    await ctx.step('save', 'Save map.json', async (step) => {
      const errors = ctx.checks.mindMap(d.map, r.mapId);
      const writer = Object.keys(ctx.job.writers || {})[0] || 'a model';
      d.map.parser = writer + ' (Kartotek)';
      const text = JSON.stringify(d.map, null, 1);
      fs.writeFileSync(path.join(ctx.dir, 'map.json'), text);
      if (errors.length) { result = { saved: false, errors: errors.slice(0, 30), where: 'Not saved: ' + errors.length + ' problems remain. The reading is in the job folder.' }; }
      else {
        const target = path.join(folder, 'map.json');
        if (fs.existsSync(target)) fs.copyFileSync(target, path.join(folder, 'map.before-' + ctx.job.id + '.json'));
        fs.writeFileSync(target + '.tmp', text); fs.renameSync(target + '.tmp', target);
        result = { saved: true, mapId: r.mapId, where: 'mindmaps\\' + r.mapId + '\\map.json in the content folder; press Reload content to see it.' };
      }
      step.detail = result.where;
    });
    return result;
  },
};

// ---------------------------------------------------------------- Task C: one coaching turn
const coach = {
  async prepare(ctx) {
    const r = ctx.request;
    if (!MAP_ID_RE.test(r.mapId || '') || !(r.turn >= 1)) throw new Error('Invalid map or turn.');
    if (!(ctx.content && ctx.content.dir())) throw new Error('Set a content folder first (Settings, Content).');
    ctx.job.title = 'Coaching turn ' + r.turn + ' for "' + r.mapId + '"';
    ctx.plan([['turn', 'Write the turn (vision)'], ['save', 'Save the turn']]);
  },
  estimate(ctx) { return { rows: [{ step: 'Turn', slot: 'vision', calls: 1, input: (ctx.request.views || []).length * 2500 + 7000, output: 2500 }], note: 'One coaching turn.' }; },
  async run(ctx) {
    const r = ctx.request, d = ctx.data, folder = viewsFolder(ctx, r.mapId);
    const name = String(r.turn).padStart(3, '0') + '.json';
    await ctx.step('turn', 'Write the turn (vision)', async (step) => {
      const images = [];
      for (const v of (r.views || [])) { if (fs.existsSync(v.file)) images.push(await ctx.extract.imageForModel(v.file, 1400)); }
      const res = await ctx.task(step, 'turn', 'Turn ' + r.turn, async (task) => (await C.askChecked(ctx, task, { prompt: 'mind-coach', slot: 'vision', images, maxOutputTokens: 6000, feature: 'job:mind:coach',
        vars: { rules: rulesFor(ctx.files.rules('MINDMAP-RULES.md'), 'coach'), request: r.prompt || '', ids: 'map_id "' + r.mapId + '", turn ' + r.turn + ', request_id "' + (r.rq || '') + '"' } },
      (j) => ctx.checks.mindTurn(fix(j), r.mapId), ctx.limits.repairs)).json);
      d.turn = fix(res);
      function fix(j) { return j && typeof j === 'object' ? Object.assign({}, j, { schema: 'kmind-turn-1', map_id: r.mapId, turn: r.turn, request_id: r.rq || j.request_id, created_at: new Date(ctx.now()).toISOString() }) : j; }
    });
    let result = null;
    await ctx.step('save', 'Save the turn', async (step) => {
      const errors = ctx.checks.mindTurn(d.turn, r.mapId);
      const text = JSON.stringify(d.turn, null, 1);
      fs.writeFileSync(path.join(ctx.dir, name), text);
      const target = path.join(folder, 'turns', name);
      if (errors.length) result = { saved: false, errors: errors.slice(0, 30), where: 'Not saved: ' + errors.length + ' problems remain.' };
      else if (fs.existsSync(target)) result = { saved: false, where: 'turns\\' + name + ' already exists; turns are never overwritten. The turn is in the job folder.' };
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); result = { saved: true, mapId: r.mapId, where: 'mindmaps\\' + r.mapId + '\\turns\\' + name + '; press Reload content to see it.' }; }
      step.detail = result.where;
    });
    return result;
  },
};

module.exports = { read, coach, rulesFor, S };
