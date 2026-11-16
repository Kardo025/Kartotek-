'use strict';
// "New study from my files" (task E3): a Study v2 package written step by step, following STUDY-RULES.md section v2.3.
//   read      the files, locally (prepare); pages whose text layer is unreliable go to the vision slot as images (transcribe)
//   units     source units (v2.3 step 2), one call per chunk of pages
//   relations source-supported relations (step 3)
//   outline   parts, topics (objectives), the outcome ledger with criteria (steps 4-5)
//   topics    per topic: Priming, lesson blocks with refs, recall card, Feynman prompt (step 6)
//   parts     per part: orientation, summary, connect blocks, part Feynman prompt
//   items     per topic: practice items (at least one per criterion); per part: connecting items (step 7)
//   final     per part: final items covering every criterion; the blueprint (step 8)
//   audit     KCycle.audit on the whole package; the model repairs what it reports, within the attempt limit (step 10)
//   verify    every item solved again without its key; a match -> "verified", else one fix round, else "disputed"
//   save      studies\<id>\etut.json and source.md in the content folder, with the writer recorded (generated_by)
// After every task the assembled package goes through KCycle.validate / KCycle.audit and the messages that belong to the task
// go back to the model as problems to repair (with the task's own checks).
const fs = require('fs');
const path = require('path');
const { S, KINDS, BLOCK_TYPES } = require('./schemas');
const C = require('./common');

const CHUNK = 9000;

// ---------------------------------------------------------------- prepare and estimate
async function prepare(ctx) {
  const r = ctx.request;
  if (!Array.isArray(r.files) || !r.files.length) throw new Error('Choose at least one source file.');
  const sources = await ctx.extract.extractSources(r.files, { imageDir: path.join(ctx.dir, 'pages'), imagesForAll: !!r.visionAll });
  ctx.data.sources = sources;
  const first = sources[0];
  ctx.job.title = r.title || first.title;
  ctx.data.id = r.id || C.slug(r.title || first.title);
  ctx.plan(STEPS);
  const read = ctx.job.steps.find((s) => s.id === 'read');
  read.status = 'done';
  const unreliable = [];
  sources.forEach((s) => s.pages.forEach((p) => { if (!p.reliable) unreliable.push(s.id + ' ' + C.unitWord(s) + ' ' + p.n + (p.reason ? ' (' + p.reason + ')' : '')); }));
  read.detail = sources.map((s) => s.name + ': ' + s.pages.length + ' ' + (s.unit === 'page' ? 'pages' : s.unit + 's')).join('; ') + (unreliable.length ? '. For the vision model: ' + unreliable.join(', ') : '. Every page has a usable text layer.');
}

const STEPS = [
  ['read', 'Read the sources'], ['transcribe', 'Read page images (vision)'], ['units', 'Source units'], ['relations', 'Relations'],
  ['outline', 'Parts, topics, outcomes and criteria'], ['topics', 'Lesson per topic'], ['parts', 'Part overviews'],
  ['items', 'Practice items'], ['final', 'Final test and blueprint'], ['audit', 'Audit and repair'], ['verify', 'Verification (solve without the key)'], ['save', 'Save the draft'],
];

function estimate(ctx) {
  const src = ctx.data.sources;
  const chars = src.reduce((a, s) => a + s.pages.reduce((b, p) => b + (p.text || '').length, 0), 0);
  const unreliable = src.reduce((a, s) => a + s.pages.filter((p) => !p.reliable && p.image).length, 0);
  const T = Math.max(2, Math.min(30, Math.round(chars / 1800)));
  const P = Math.max(1, Math.ceil(T / 4));
  const units = Math.max(8, Math.round(chars / 260));
  const K = Math.max(1, Math.ceil(chars / CHUNK));
  const items = T * 3 + P * 2, finals = T * 2;
  const rows = [
    { step: 'Page images', slot: 'vision', calls: unreliable, input: unreliable * 2200, output: unreliable * 700 },
    { step: 'Units and relations', slot: 'strong', calls: K + 1, input: Math.round(chars / 3) + K * 1800 + units * 60, output: units * 75 + units * 25 },
    { step: 'Outline', slot: 'strong', calls: 1, input: units * 70 + 2500, output: T * 450 },
    { step: 'Lessons and overviews', slot: 'strong', calls: T + P, input: T * (2600 + Math.round(chars / T / 2)) + P * 3500, output: T * 2600 + P * 1500 },
    { step: 'Practice and final items', slot: 'strong', calls: T + 2 * P, input: (T + 2 * P) * 4200, output: (items + finals) * 650 },
    { step: 'Verification', slot: 'strong', calls: Math.ceil((items + finals) / 4) + Math.round(items * 0.3), input: Math.ceil((items + finals) / 4) * 3200 + items * 900, output: (items + finals) * 260 },
  ];
  // repairs: about a quarter more
  rows.forEach((r) => { r.input = Math.round(r.input * 1.25); r.output = Math.round(r.output * 1.25); r.calls = Math.round(r.calls * 1.2); });
  return { rows: rows.filter((r) => r.calls > 0), note: 'About ' + T + ' topics in ' + P + ' part' + (P > 1 ? 's' : '') + ' expected from ' + Math.round(chars / 1000) + 'k characters of text. Models that think before answering use more output tokens than shown.' };
}

// ---------------------------------------------------------------- the package from what the steps wrote so far
function assemble(d) {
  const pkg = {
    etut_id: d.id, title: d.title || d.id, version: 1, created_at: new Date().toISOString().slice(0, 10), schema_version: 2, workflow: 'cycle-v2',
    source: sourceField(d.sources), sources: d.sources.map((s) => ({ id: s.id, title: s.title, file: 'sources\\' + d.id + '\\' + s.name, type: s.type, unit: s.unit, pages: '1–' + s.pages.length })),
    units: d.units || [], relations: d.relations || [], outcomes: d.outcomes || [], parts: [], final_test: [], final_blueprint: [], gaps: (d.gaps || []).slice(), not_covered: (d.not_covered || []).slice(),
  };
  if (d.conventions && d.conventions.length) pkg.conventions = d.conventions;
  (d.parts || []).forEach((p) => {
    const part = { part_id: p.part_id, title: p.title, slides: p.slides || [], prerequisites: p.prerequisites || [] };
    if (p.orientation) part.orientation = p.orientation;
    if (p.summary) part.summary = p.summary;
    if (p.feynman) part.feynman = p.feynman;
    if (p.connect) part.connect = p.connect;
    part.kazanimlar = p.topics.map((t) => {
      const k = { kazanim_id: t.kazanim_id, kind: t.kind, title: t.title, objective: t.objective, slides: t.slides || [], outcomes: t.outcomes.slice() };
      const L = (d.lessons || {})[t.kazanim_id];
      if (L) Object.assign(k, { priming: L.priming, blocks: L.blocks, practice: [], recall: L.recall, feynman: L.feynman });
      else k.blocks = [];
      return k;
    });
    part.items = [];
    part.kazanimlar.forEach((k) => { ((d.items || {})[k.kazanim_id] || []).forEach((it) => part.items.push(it)); });
    ((d.connecting || {})[p.part_id] || []).forEach((it) => part.items.push(it));
    pkg.parts.push(part);
    ((d.finals || {})[p.part_id] || []).forEach((it) => pkg.final_test.push(it));
  });
  pkg.final_blueprint = blueprint(pkg);
  return pkg;
}
function sourceField(sources) {
  const s = sources[0];
  return { file: 'sources\\…\\' + s.name, type: s.type === 'pptx' ? 'pptx' : s.type === 'pdf' ? 'pdf' : s.type, slide_count: s.pages.length, unit: s.unit === 'slide' ? 'slide' : 'page' };
}
function blueprint(pkg) {
  const rows = [];
  (pkg.outcomes || []).forEach((lo) => (lo.criteria || []).forEach((c) => {
    const it = pkg.final_test.find((x) => (x.criteria || []).indexOf(c.id) >= 0);
    if (it) rows.push({ criterion: c.id, outcome: lo.id, item: it.q_id });
  }));
  return rows;
}
// KCycle's messages for a task: validate errors and audit blockers that match `pick`
function kcycleProblems(ctx, d, pick) {
  const pkg = assemble(d);
  const a = ctx.checks.studyAudit(pkg);
  return a.blockers.filter(pick);
}

// ---------------------------------------------------------------- shared text for prompts
function unitLine(u) { return u.id + ' [' + u.source + ' ' + u.loc + '] ' + u.type + ': ' + u.text; }
function topicOf(d, kid) { for (const p of d.parts) for (const t of p.topics) if (t.kazanim_id === kid) return { part: p, topic: t }; return null; }
function outcomesOfTopic(d, t) { return d.outcomes.filter((o) => t.outcomes.indexOf(o.id) >= 0); }
function criteriaLines(outs) { return outs.map((o) => o.id + ' (' + o.performance + '):\n' + o.criteria.map((c) => '  ' + c.id + ': ' + c.text).join('\n')).join('\n'); }
function unitsOf(d, ids) { const set = new Set(ids); return d.units.filter((u) => set.has(u.id)); }
function goalLine(r) { return [r.scope ? 'Scope: ' + r.scope : '', r.goal ? 'Learner\'s goal: ' + r.goal : ''].filter(Boolean).join('\n') || 'No scope or goal given: cover the whole source.'; }
function pageNumbers(units) { return C.uniq(units.reduce((a, u) => a.concat(C.pagesOfLoc(u.loc)), [])).sort((a, b) => a - b); }

// ---------------------------------------------------------------- run
async function run(ctx) {
  const d = ctx.data, r = ctx.request, L = ctx.limits;
  ctx.plan(STEPS);
  d.lessons = d.lessons || {}; d.items = d.items || {}; d.connecting = d.connecting || {}; d.finals = d.finals || {};

  await transcribeStep(ctx, d);

  // -- units
  await unitsAndRest(ctx, d, r, L);
  let result = null;
  await ctx.step('save', 'Save the draft', async (step) => {
    result = saveStudy(ctx, d);
    step.detail = result.where;
  });
  return result || ctx.job.result;
}

// -- page images for unreliable text layers (vision slot); shared with the lesson and mock jobs
async function transcribeStep(ctx, d) {
  await ctx.step('transcribe', 'Read page images (vision)', async (step) => {
    for (const src of d.sources) for (const p of src.pages) {
      if (p.reliable || !p.image) continue;
      const res = await ctx.task(step, src.id + '-' + p.n, src.name + ' ' + C.unitWord(src) + ' ' + p.n, async () => {
        const img = { mime: 'image/png', data: fs.readFileSync(p.image).toString('base64') };
        try {
          const a = await ctx.ask({ prompt: 'source-transcribe', slot: 'vision', schema: S.transcribe, images: [img], maxOutputTokens: 4000, feature: 'job:study:transcribe',
            vars: { source: src.name, page: C.unitWord(src) + ' ' + p.n, text_layer: p.text || '(none)' } });
          return a.json;
        } catch (e) {
          ctx.log('warn', src.name + ' ' + C.unitWord(src) + ' ' + p.n + ': the page image could not be read (' + e.message + '). The page stays as its text layer and is listed as a gap.');
          return { failed: String(e.message || e) };
        }
      });
      if (res && !res.failed) {
        p.transcribed = res.text + (res.figures && res.figures.length ? '\n' + res.figures.map((f) => '[Figure: ' + f.what + '] ' + f.description).join('\n') : '');
        if (res.unreadable && res.unreadable.length) p.unreadable = res.unreadable.join('; ');
      } else p.unreadable = 'the page image could not be read';
    }
    if (!step.tasks.length) step.detail = 'Not needed: every page has a usable text layer.';
  });
}

async function unitsAndRest(ctx, d, r, L) {
  await ctx.step('units', 'Source units', async (step) => {
    const chunks = C.chunkPages(d.sources, CHUNK);
    const all = [];
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      const want = new Set(ch.map((x) => x.src + ':' + x.n));
      const res = await ctx.task(step, 'chunk-' + (i + 1), 'Pages ' + ch[0].src + ' ' + ch[0].n + '–' + ch[ch.length - 1].n, async (task) => {
        const out = await C.askChecked(ctx, task, { prompt: 'study-units', schema: S.units, maxOutputTokens: 12000, feature: 'job:study:units',
          vars: { manifest: C.manifest(d.sources), goal: goalLine(r), text: C.sourceText(d.sources, (s, p) => want.has(s.id + ':' + p.n)) } },
        (j) => unitProblems(j, d.sources, want), L.repairs);
        return out.json;
      });
      all.push(res);
    }
    d.title = r.title || (all[0] && all[0].title) || ctx.job.title;
    ctx.job.title = d.title;
    d.units = []; d.gaps = []; d.not_covered = []; d.conventions = [];
    all.forEach((j) => {
      (j.units || []).forEach((u) => d.units.push({ id: 'U' + (d.units.length + 1), source: u.source, loc: normLoc(u.loc, d.sources, u.source), type: u.type, text: u.text,
        disposition: u.disposition, duplicate_of: null, reason: u.disposition === 'included' ? null : (u.reason || 'not given') }));
      (j.gaps || []).forEach((g) => d.gaps.push(g));
      (j.not_covered || []).forEach((n) => d.not_covered.push(n));
      (j.conventions || []).forEach((c) => d.conventions.push(c));
    });
    d.units.filter((u) => u.disposition === 'unresolved').forEach((u) => d.gaps.push({ what: u.id + ' (' + u.loc + '): ' + u.text, why: u.reason }));
    d.sources.forEach((s) => s.pages.forEach((p) => { if (p.unreadable) d.gaps.push({ what: s.name + ' ' + C.unitWord(s) + ' ' + p.n, why: 'unreadable: ' + p.unreadable }); }));
    d.conventions = C.uniq(d.conventions);
    step.detail = d.units.length + ' units (' + d.units.filter((u) => u.disposition === 'included').length + ' included)';
  });

  // -- relations
  await ctx.step('relations', 'Relations', async (step) => {
    const inc = d.units.filter((u) => u.disposition === 'included');
    const res = await ctx.task(step, 'relations', 'Relations between units', async (task) => {
      const known = new Set(inc.map((u) => u.id));
      const out = await C.askChecked(ctx, task, { prompt: 'study-relations', schema: S.relations, maxOutputTokens: 8000, feature: 'job:study:relations',
        vars: { units: inc.map(unitLine).join('\n') } },
      (j) => { const p = []; (j.relations || []).forEach((x, i) => { if (!x.units.length) p.push('Relation ' + (i + 1) + ': list the units that support it.'); x.units.forEach((u) => { if (!known.has(u)) p.push('Relation ' + (i + 1) + ': unknown or not included unit ' + u + '.'); }); }); return p; }, L.repairs);
      return out.json;
    });
    d.relations = (res.relations || []).map((x, i) => ({ id: 'R' + (i + 1), from: x.from, to: x.to, type: x.type, direction: x.direction, conditions: x.conditions || [], units: x.units, unresolved: false }));
    step.detail = d.relations.length + ' relations';
  });

  // -- outline: parts, topics, outcomes, criteria
  await ctx.step('outline', 'Parts, topics, outcomes and criteria', async (step) => {
    const res = await ctx.task(step, 'outline', 'Outline and outcome ledger', async (task) => {
      const out = await C.askChecked(ctx, task, { prompt: 'study-outline', schema: S.outline, maxOutputTokens: 16000, feature: 'job:study:outline',
        vars: { title: d.title, goal: goalLine(r), units: d.units.filter((u) => u.disposition === 'included').map(unitLine).join('\n'),
          relations: d.relations.map((x) => x.id + ': ' + x.from + ' → ' + x.to + ' (' + x.type + (x.conditions.length ? '; when ' + x.conditions.join(', ') : '') + ') units ' + x.units.join(', ')).join('\n') || '(none)' } },
      (j) => outlineProblems(j, d).concat(kcycleProblems(ctx, applyOutline(clone(d), j), (m) => /no outcome covers it|unknown unit|unknown relation|criterion ids|no success criteria/.test(m))), L.repairs);
      return out.json;
    });
    applyOutline(d, res);
    step.detail = d.parts.length + ' parts, ' + d.parts.reduce((a, p) => a + p.topics.length, 0) + ' topics, ' + d.outcomes.length + ' outcomes, ' + d.outcomes.reduce((a, o) => a + o.criteria.length, 0) + ' criteria';
  });

  // -- lesson per topic
  await ctx.step('topics', 'Lesson per topic', async (step) => {
    for (const p of d.parts) for (const t of p.topics) {
      const kid = t.kazanim_id;
      const res = await ctx.task(step, kid, p.part_id + ' · ' + t.title, async (task) => {
        const outs = outcomesOfTopic(d, t);
        const units = unitsOf(d, C.uniq(outs.reduce((a, o) => a.concat(o.units), [])));
        const crit = {}; outs.forEach((o) => o.criteria.forEach((c) => { crit[c.id] = true; }));
        const others = d.parts.map((pp) => pp.topics.filter((x) => x.kazanim_id !== kid).map((x) => '- ' + x.title).join('\n')).join('\n');
        const out = await C.askChecked(ctx, task, { prompt: 'study-topic', schema: S.topic, maxOutputTokens: 10000, feature: 'job:study:topic',
          vars: { study: d.title, part: p.title, topic: t.title + ' (' + t.kind + ')\nObjective: ' + t.objective, outcomes: criteriaLines(outs), units: units.map(unitLine).join('\n'),
            conventions: (d.conventions || []).join('\n') || '(none)', others: others || '(none)', text: C.sourceText(d.sources, C.pagesForUnits(d.sources, units)) } },
        (j) => topicProblems(j, units, crit, d).concat(kcycleProblems(ctx, withLesson(d, kid, j), pickTopic(d, kid))), L.repairs);
        return out.json;
      });
      d.lessons[kid] = cleanLesson(res, d, t);
    }
  });

  // -- part overviews
  await ctx.step('parts', 'Part overviews', async (step) => {
    for (const p of d.parts) {
      const res = await ctx.task(step, p.part_id, p.title, async (task) => {
        const outs = d.outcomes.filter((o) => o.part_id === p.part_id);
        const units = unitsOf(d, C.uniq(outs.reduce((a, o) => a.concat(o.units), [])));
        const crit = {}; outs.forEach((o) => o.criteria.forEach((c) => { crit[c.id] = true; }));
        const known = {}; d.units.forEach((u) => { known[u.id] = true; });
        const out = await C.askChecked(ctx, task, { prompt: 'study-part', schema: S.part, maxOutputTokens: 6000, feature: 'job:study:part',
          vars: { study: d.title, part: p.title, position: 'Part ' + (d.parts.indexOf(p) + 1) + ' of ' + d.parts.length, topics: p.topics.map((t) => '- ' + t.kazanim_id + ' ' + t.title + ': ' + ((d.lessons[t.kazanim_id] || {}).priming || {}).summary_md).join('\n'),
            outcomes: criteriaLines(outs), units: units.map(unitLine).join('\n'), several: p.topics.length > 1 ? 'yes' : 'no' } },
        (j) => partProblems(j, crit, known, p.topics.length), L.repairs);
        return out.json;
      });
      const resC = C.stripDeep(res);
      p.orientation = resC.orientation;
      p.summary = { md: resC.summary.md, keywords: resC.summary.keywords };
      p.feynman = { prompt: resC.feynman.prompt, criteria: res.feynman.criteria.filter((c) => d.outcomes.some((o) => o.part_id === p.part_id && o.criteria.some((x) => x.id === c))) };
      if (p.topics.length > 1 && resC.connect_blocks.length) p.connect = { blocks: resC.connect_blocks.map((b) => cleanBlock(b, d)).filter(Boolean) };
      else delete p.connect;
    }
  });

  // -- practice items (per topic), connecting items (per part)
  await ctx.step('items', 'Practice items', async (step) => {
    for (const p of d.parts) for (const t of p.topics) {
      const kid = t.kazanim_id;
      const res = await ctx.task(step, kid, p.part_id + ' · ' + t.title, async (task) => {
        const outs = outcomesOfTopic(d, t);
        const units = unitsOf(d, C.uniq(outs.reduce((a, o) => a.concat(o.units), [])));
        const crit = {}; outs.forEach((o) => o.criteria.forEach((c) => { crit[c.id] = o.id; }));
        const L2 = d.lessons[kid];
        const out = await C.askChecked(ctx, task, { prompt: 'study-items', schema: S.items, maxOutputTokens: 14000, feature: 'job:study:items',
          vars: { study: d.title, topic: t.title + '\nObjective: ' + t.objective, outcomes: criteriaLines(outs), lesson: lessonDigest(L2), units: units.map(unitLine).join('\n'),
            text: C.sourceText(d.sources, C.pagesForUnits(d.sources, units)) } },
        (j) => itemsProblems(j, crit, d, false).concat(kcycleProblems(ctx, withItems(d, kid, toItems(j, d, p, t, 'practice')), pickItems(d, t))), L.repairs);
        return out.json;
      });
      d.items[kid] = toItems(res, d, p, t, 'practice');
    }
    for (let pi = 0; pi < d.parts.length; pi++) {
      const p = d.parts[pi];
      const earlier = d.parts.slice(0, pi + 1).reduce((a, x) => a.concat(x.topics), []);
      if (earlier.length < 2 || p.topics.length < 1 || (pi === 0 && p.topics.length < 2)) continue;
      const res = await ctx.task(step, 'connect-' + p.part_id, p.title + ' · connecting items', async (task) => {
        const outs = d.outcomes.filter((o) => earlier.some((t) => t.kazanim_id === o.kazanim_id));
        const crit = {}; outs.forEach((o) => o.criteria.forEach((c) => { crit[c.id] = o.id; }));
        const units = unitsOf(d, C.uniq(outs.filter((o) => o.part_id === p.part_id).reduce((a, o) => a.concat(o.units), [])));
        const out = await C.askChecked(ctx, task, { prompt: 'study-connect', schema: S.items, maxOutputTokens: 8000, feature: 'job:study:connect',
          vars: { study: d.title, part: p.title, topics: earlier.map((t) => '- ' + t.kazanim_id + ' (' + (d.parts.find((x) => x.topics.indexOf(t) >= 0).part_id) + '): ' + t.title).join('\n'), latest: p.topics.map((t) => t.kazanim_id).join(', '),
            outcomes: criteriaLines(outs), units: units.map(unitLine).join('\n'), text: C.sourceText(d.sources, C.pagesForUnits(d.sources, units)) } },
        (j) => itemsProblems(j, crit, d, true, p, earlier), L.repairs);
        return out.json;
      });
      d.connecting[p.part_id] = toItems(res, d, p, null, 'practice', 'c');
    }
    step.detail = Object.values(d.items).reduce((a, x) => a + x.length, 0) + ' practice items, ' + Object.values(d.connecting).reduce((a, x) => a + x.length, 0) + ' connecting';
  });

  // -- final test per part
  await ctx.step('final', 'Final test and blueprint', async (step) => {
    for (const p of d.parts) {
      const res = await ctx.task(step, p.part_id, p.title, async (task) => {
        const outs = d.outcomes.filter((o) => o.part_id === p.part_id);
        const crit = {}; outs.forEach((o) => o.criteria.forEach((c) => { crit[c.id] = o.id; }));
        const units = unitsOf(d, C.uniq(outs.reduce((a, o) => a.concat(o.units), [])));
        const practice = p.topics.reduce((a, t) => a.concat(d.items[t.kazanim_id] || []), []).concat(d.connecting[p.part_id] || []);
        const out = await C.askChecked(ctx, task, { prompt: 'study-final', schema: S.items, maxOutputTokens: 14000, feature: 'job:study:final',
          vars: { study: d.title, part: p.title, topics: p.topics.map((t) => '- ' + t.kazanim_id + ': ' + t.title).join('\n'), outcomes: criteriaLines(outs), units: units.map(unitLine).join('\n'),
            practice: practice.map((it) => '- ' + it.stem.replace(/\s+/g, ' ').slice(0, 220)).join('\n') || '(none)', text: C.sourceText(d.sources, C.pagesForUnits(d.sources, units)) } },
        (j) => itemsProblems(j, crit, d, false, null, null, true).concat(finalCoverage(j, crit)), L.repairs);
        return out.json;
      });
      d.finals[p.part_id] = toFinal(res, d, p);
    }
    step.detail = Object.values(d.finals).reduce((a, x) => a + x.length, 0) + ' final items';
  });

  // -- whole-package audit and repair rounds
  await ctx.step('audit', 'Audit and repair', async (step) => {
    for (let round = 1; round <= L.repairs + 1; round++) {
      const a = ctx.checks.studyAudit(assemble(d));
      step.detail = a.blockers.length + ' blockers, ' + a.warnings.length + ' warnings';
      if (!a.blockers.length || round > L.repairs) break;
      await ctx.task(step, 'round-' + round, 'Repair round ' + round + ' (' + a.blockers.length + ' blockers)', async (task) => {
        task.problems = a.blockers.slice(0, 20);
        await repairFromAudit(ctx, d, a.blockers, task);
        return { before: a.blockers.length };
      });
    }
    const a = ctx.checks.studyAudit(assemble(d));
    d.audit = { blockers: a.blockers, warnings: a.warnings.length, counts: a.counts };
    step.detail = a.blockers.length + ' blockers, ' + a.warnings.length + ' warnings';
  });

  // -- verification
  await ctx.step('verify', 'Verification (solve without the key)', async (step) => {
    await verifyStudy(ctx, d, step);
    const all = allItems(d);
    step.detail = all.filter((x) => x.validation === 'verified').length + ' verified, ' + all.filter((x) => x.validation === 'disputed').length + ' disputed, ' + all.filter((x) => x.validation === 'unverified').length + ' unverified (of ' + all.length + ')';
  });
}

// ---------------------------------------------------------------- step checks and clean-up
function normLoc(loc, sources, srcId) {
  const s = sources.find((x) => x.id === srcId) || sources[0];
  const n = C.pagesOfLoc(loc);
  if (!n.length) return String(loc || '');
  const w = C.unitWord(s);
  return n.length > 1 && n[n.length - 1] !== n[0] ? (w === 'p.' ? 'pp. ' : w + 's ') + n[0] + '–' + n[n.length - 1] : w + ' ' + n[0];
}
function unitProblems(j, sources, want) {
  const p = [];
  const ids = sources.map((s) => s.id);
  if (!Array.isArray(j.units)) return ['"units" must be a list.'];
  j.units.forEach((u, i) => {
    const at = 'Unit ' + (i + 1) + ' ("' + String(u.text).slice(0, 40) + '")';
    if (ids.indexOf(u.source) < 0) p.push(at + ': source must be one of ' + ids.join(', ') + '.');
    const pages = C.pagesOfLoc(u.loc);
    if (!pages.length) p.push(at + ': loc must name the page or slide, e.g. "p. 4" or "slide 4".');
    else if (!pages.some((n) => want.has(u.source + ':' + n))) p.push(at + ': loc "' + u.loc + '" is not one of the pages given to you.');
    if (C.words(u.text) > 25) p.push(at + ': text has ' + C.words(u.text) + ' words; paraphrase it in 25 words or fewer.');
    if (!String(u.text || '').trim()) p.push(at + ': text is empty.');
    if (u.disposition !== 'included' && !String(u.reason || '').trim()) p.push(at + ': a unit that is ' + u.disposition + ' needs a reason.');
  });
  return p;
}
function outlineProblems(j, d) {
  const p = [];
  const inc = d.units.filter((u) => u.disposition === 'included').map((u) => u.id);
  const relIds = d.relations.map((x) => x.id);
  const usedU = new Set(), usedR = new Set();
  if (!j.parts || !j.parts.length) return ['Write at least one part.'];
  j.parts.forEach((pt, pi) => {
    if (!pt.topics.length) p.push('Part ' + (pi + 1) + ' has no topics.');
    if (pt.topics.length > 8) p.push('Part ' + (pi + 1) + ' has ' + pt.topics.length + ' topics; split it (3–6 per part is the starting point).');
    pt.topics.forEach((t, ti) => {
      const at = 'Part ' + (pi + 1) + ' topic ' + (ti + 1) + ' ("' + t.title + '")';
      if (!t.outcomes.length) p.push(at + ' has no outcomes.');
      t.outcomes.forEach((o, oi) => {
        const oat = at + ' outcome ' + (oi + 1);
        if (!o.criteria.length || o.criteria.length > 4) p.push(oat + ': give 1–4 criteria.');
        if (!o.units.length) p.push(oat + ': list the units it covers.');
        if (/^\s*(understand|know|learn|be aware)/i.test(o.performance)) p.push(oat + ': the performance must be observable ("Explain why …", "Compute …"), not "' + o.performance.split(' ').slice(0, 2).join(' ') + '".');
        o.units.forEach((u) => { if (inc.indexOf(u) < 0) p.push(oat + ': unknown or not included unit ' + u + '.'); usedU.add(u); });
        o.relations.forEach((r) => { if (relIds.indexOf(r) < 0) p.push(oat + ': unknown relation ' + r + '.'); usedR.add(r); });
      });
    });
  });
  const unresolved = new Set((j.unresolved_units || []).map((x) => x.unit));
  const missU = inc.filter((u) => !usedU.has(u) && !unresolved.has(u));
  if (missU.length) p.push('These included units are in no outcome: ' + missU.join(', ') + '. Every included unit must be covered by an outcome (or listed in unresolved_units with a reason).');
  const missR = relIds.filter((r) => !usedR.has(r));
  if (missR.length) p.push('These relations are in no outcome: ' + missR.join(', ') + '. Every relation must be covered by an outcome.');
  return p;
}
function applyOutline(d, j) {
  d.parts = []; d.outcomes = [];
  let k = 0, lo = 0, c = 0;
  (j.parts || []).forEach((pt, pi) => {
    const part = { part_id: 'p' + (pi + 1), title: pt.title, prerequisites: pi ? ['p' + pi] : [], topics: [] };
    pt.topics.forEach((t) => {
      const kid = 'k' + (++k);
      const topic = { kazanim_id: kid, title: t.title, kind: KINDS.indexOf(t.kind) >= 0 ? t.kind : 'kavram', objective: t.objective, outcomes: [] };
      t.outcomes.forEach((o) => {
        const id = 'LO-' + (++lo);
        topic.outcomes.push(id);
        d.outcomes.push({ id, part_id: part.part_id, kazanim_id: kid, object: o.object || 'concept', performance: o.performance, conditions: o.conditions || 'without notes',
          units: C.uniq(o.units), relations: C.uniq(o.relations), criteria: o.criteria.map((text) => ({ id: 'C-' + (++c), text })), status: 'covered', reason: null });
      });
      const us = unitsOf(d, C.uniq(d.outcomes.filter((o) => o.kazanim_id === kid).reduce((a, o) => a.concat(o.units), [])));
      topic.slides = pageNumbers(us);
      part.topics.push(topic);
    });
    part.slides = C.uniq(part.topics.reduce((a, t) => a.concat(t.slides), [])).sort((a, b) => a - b);
    d.parts.push(part);
  });
  (j.unresolved_units || []).forEach((x) => {
    const u = d.units.find((y) => y.id === x.unit);
    if (u && u.disposition === 'included' && !d.outcomes.some((o) => o.units.indexOf(u.id) >= 0)) { u.disposition = 'unresolved'; u.reason = x.reason || 'not placed in an outcome'; d.gaps.push({ what: u.id + ' (' + u.loc + '): ' + u.text, why: u.reason }); }
  });
  return d;
}
const clone = (x) => JSON.parse(JSON.stringify(x));

function cleanBlock(b, d) {
  const known = new Set(d.units.map((u) => u.id));
  const refs = C.uniq((b.refs || []).filter((u) => known.has(u)));
  const slides = (b.slides || []).filter((n) => Number.isInteger(n) && n > 0);
  const extra = { refs };
  if (slides.length) extra.slides = slides;
  switch (b.type) {
    case 'text': case 'example': case 'analogy': return String(b.md || '').trim() ? Object.assign({ type: b.type, md: b.md }, extra) : null;
    case 'keypoints': return (b.items || []).length ? Object.assign({ type: 'keypoints', title: b.title || undefined, items: b.items }, extra) : null;
    case 'steps': return (b.items || []).length ? Object.assign({ type: 'steps', title: b.title || undefined, items: b.items }, extra) : null;
    case 'callout': return String(b.md || '').trim() ? Object.assign({ type: 'callout', tone: b.tone === 'dikkat' ? 'dikkat' : 'ipucu', md: b.md }, extra) : null;
    case 'compare': return (b.columns || []).length && (b.rows || []).length ? Object.assign({ type: 'compare', title: b.title || undefined, columns: b.columns, rows: b.rows }, extra) : null;
    case 'worked': return String(b.problem || '').trim() && (b.steps || []).length ? Object.assign({ type: 'worked', problem: b.problem, steps: b.steps, answer: b.answer }, extra) : null;
    default: return null;
  }
}
function cleanLesson(j, d, t) {
  j = C.stripDeep(j);
  const blocks = (j.blocks || []).map((b) => cleanBlock(b, d)).filter(Boolean);
  const pr = j.priming || {};
  const priming = { summary_md: pr.summary_md, keywords: (pr.keywords || []).filter((w) => w.term && w.definition).slice(0, 4), purpose: pr.purpose };
  if (String(pr.prereq || '').trim()) priming.prereq = pr.prereq;
  const crit = new Set(outcomesOfTopic(d, t).reduce((a, o) => a.concat(o.criteria.map((c) => c.id)), []));
  const recall = { prompt: j.recall.prompt, model_answer: j.recall.model_answer, key_points: j.recall.key_points, origin: j.recall.origin };
  if (String(j.recall.source_ref || '').trim()) recall.source_ref = j.recall.source_ref;
  return { priming, blocks, recall, feynman: { prompt: j.feynman.prompt, criteria: (j.feynman.criteria || []).filter((c) => crit.has(c)) } };
}
function withLesson(d, kid, j) {
  const t = topicOf(d, kid).topic;
  const dd = Object.assign({}, d, { lessons: Object.assign({}, d.lessons) });
  try { dd.lessons[kid] = cleanLesson(j, d, t); } catch (e) { /* the shape check reports it */ }
  return dd;
}
function pickTopic(d, kid) {
  const loc = topicOf(d, kid);
  const pi = d.parts.indexOf(loc.part) + 1, ti = loc.part.topics.indexOf(loc.topic) + 1;
  const prefix = 'Part ' + pi + ' / objective ' + ti;
  const outs = loc.topic.outcomes;
  return (m) => m.indexOf(prefix + ':') === 0 || m.indexOf(prefix + ' /') === 0 || outs.some((o) => m.indexOf('Outcome ' + o + ' has no lesson') === 0);
}
function topicProblems(j, units, crit, d) {
  const p = [];
  const unitIds = new Set(units.map((u) => u.id));
  const known = new Set(d.units.map((u) => u.id));
  const blocks = (j.blocks || []).filter((b) => BLOCK_TYPES.indexOf(b.type) >= 0);
  if (!blocks.length) p.push('Write the lesson: at least one block.');
  const cited = new Set();
  blocks.forEach((b, i) => {
    (b.refs || []).forEach((u) => { if (!known.has(u)) p.push('Block ' + (i + 1) + ': unknown unit ' + u + ' in refs.'); cited.add(u); });
    if ((b.type === 'text' || b.type === 'example') && !(b.refs || []).length) p.push('Block ' + (i + 1) + ' (' + b.type + '): give the units it teaches in refs.');
    if (b.type === 'compare' && (b.rows || []).some((r) => r.length !== (b.columns || []).length)) p.push('Block ' + (i + 1) + ': every compare row needs one cell per column.');
    if (b.type === 'worked' && (!(b.steps || []).length || !String(b.problem || '').trim())) p.push('Block ' + (i + 1) + ': a worked block needs a problem and steps.');
    if ((b.type === 'keypoints' || b.type === 'steps') && !(b.items || []).length) p.push('Block ' + (i + 1) + ': a ' + b.type + ' block needs items.');
  });
  const notTaught = Array.from(unitIds).filter((u) => !cited.has(u) && (units.find((x) => x.id === u) || {}).type !== 'exercise');
  if (notTaught.length) p.push('These units of this topic are not cited by any block: ' + notTaught.join(', ') + '. Teach each one and cite it in refs.');
  const pr = j.priming || {};
  if (!String(pr.summary_md || '').trim()) p.push('priming.summary_md is empty.');
  else if (C.sentences(pr.summary_md) > 6) p.push('priming.summary_md has about ' + C.sentences(pr.summary_md) + ' sentences; use 2–4 (6 at most).');
  if (!(pr.keywords || []).some((w) => w.term && w.definition)) p.push('priming.keywords: give 1–4 keywords with term and definition.');
  const rc = j.recall || {};
  if (!String(rc.prompt || '').trim() || !String(rc.model_answer || '').trim()) p.push('recall needs a prompt and a model_answer.');
  if (!(rc.key_points || []).length || rc.key_points.length > 4) p.push('recall.key_points: give 2–4 points.');
  if (!String((j.feynman || {}).prompt || '').trim()) p.push('feynman.prompt is empty.');
  ((j.feynman || {}).criteria || []).forEach((c) => { if (!crit[c]) p.push('feynman.criteria: ' + c + ' is not a criterion of this topic (use: ' + Object.keys(crit).join(', ') + ').'); });
  return p;
}
function partProblems(j, crit, known, nTopics) {
  const p = [];
  const s = C.sentences(j.summary && j.summary.md);
  if (s < 3 || s > 12) p.push('summary.md has about ' + s + ' sentences; write 5–10.');
  if (!j.summary || (j.summary.keywords || []).length < 3) p.push('summary.keywords: give 5–9 keywords with definitions and refs.');
  if (!String(j.orientation && j.orientation.purpose || '').trim()) p.push('orientation.purpose is empty.');
  if (!String(j.feynman && j.feynman.prompt || '').trim()) p.push('feynman.prompt is empty.');
  (j.feynman && j.feynman.criteria || []).forEach((c) => { if (!crit[c]) p.push('feynman.criteria: ' + c + ' is not a criterion of this part.'); });
  if (nTopics > 1 && !(j.connect_blocks || []).length) p.push('Write one or two connect_blocks ("Putting the part together") with refs.');
  (j.connect_blocks || []).forEach((b, i) => (b.refs || []).forEach((u) => { if (!known[u]) p.push('connect block ' + (i + 1) + ': unknown unit ' + u + '.'); }));
  return p;
}
function lessonDigest(L) {
  if (!L) return '(no lesson)';
  const out = [L.priming.summary_md];
  L.blocks.forEach((b) => {
    if (b.md) out.push(b.md); if (b.items) out.push(b.items.map((x) => '- ' + x).join('\n'));
    if (b.type === 'worked') out.push('Worked: ' + b.problem + ' → ' + b.answer);
    if (b.type === 'compare') out.push(b.columns.join(' | ') + '\n' + b.rows.map((r) => r.join(' | ')).join('\n'));
  });
  return out.join('\n\n').slice(0, 6000);
}
function itemsProblems(j, crit, d, connecting, part, earlier, isFinal) {
  const p = [];
  const knownU = {}; d.units.forEach((u) => { knownU[u.id] = true; });
  if (!Array.isArray(j.items)) return ['"items" must be a list.'];
  if (!connecting && !j.items.length) p.push('Write the items.');
  if (connecting && j.items.length > 3) p.push('Write at most 3 connecting items (you wrote ' + j.items.length + '); keep only the ones where the source really links the topics.');
  j.items.forEach((it, i) => {
    p.push(...C.itemProblems(it, (isFinal ? 'Final item ' : 'Item ') + (i + 1), { criteria: crit, units: knownU }));
    if (connecting) {
      const ig = C.uniq(it.integrates || []);
      const kids = earlier.map((t) => t.kazanim_id);
      if (ig.length < 2 || ig.some((k) => kids.indexOf(k) < 0)) p.push('Item ' + (i + 1) + ': integrates must list 2 or more of these topics: ' + kids.join(', ') + '.');
      else if (!ig.some((k) => part.topics.some((t) => t.kazanim_id === k))) p.push('Item ' + (i + 1) + ': a connecting item here must include a topic of this part (' + part.topics.map((t) => t.kazanim_id).join(', ') + ').');
    }
  });
  if (!connecting && !isFinal) {
    const covered = new Set(j.items.reduce((a, it) => a.concat(it.criteria || []), []));
    const miss = Object.keys(crit).filter((c) => !covered.has(c));
    if (miss.length) p.push('No item assesses ' + miss.join(', ') + '. Write at least one item for every criterion.');
  }
  return p;
}
function finalCoverage(j, crit) {
  const covered = new Set((j.items || []).reduce((a, it) => a.concat(it.criteria || []), []));
  const miss = Object.keys(crit).filter((c) => !covered.has(c));
  return miss.length ? ['No final item assesses ' + miss.join(', ') + '. Every criterion needs at least one final item.'] : [];
}
function toItems(j, d, p, t, use, tag) {
  const outOf = {}; d.outcomes.forEach((o) => o.criteria.forEach((c) => { outOf[c.id] = o.id; }));
  return (j.items || []).map((raw, i) => {
    let kid = t ? t.kazanim_id : null;
    if (!kid) { // a connecting item belongs to the latest of its topics
      const order = d.parts.reduce((a, x) => a.concat(x.topics.map((y) => y.kazanim_id)), []);
      kid = C.uniq(raw.integrates || []).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0];
    }
    const qid = p.part_id + '-' + (tag || kid) + '-' + (i + 1);
    const crit = C.uniq(raw.criteria || []).filter((c) => outOf[c]);
    return C.cleanItem(raw, { q_id: qid, kazanim_id: kid, outcomes: C.uniq(crit.map((c) => outOf[c])), use });
  });
}
function toFinal(j, d, p) {
  const outOf = {}; d.outcomes.forEach((o) => o.criteria.forEach((c) => { outOf[c.id] = o.id; }));
  return (j.items || []).map((raw, i) => {
    const crit = C.uniq(raw.criteria || []).filter((c) => outOf[c]);
    const lo = d.outcomes.find((o) => o.id === outOf[crit[0]]);
    const kid = lo ? lo.kazanim_id : p.topics[0].kazanim_id;
    const it = C.cleanItem(raw, { q_id: 'F-' + p.part_id + '-' + (i + 1), kazanim_id: kid, outcomes: C.uniq(crit.map((c) => outOf[c])), use: 'final' });
    if (it.integrates) it.integrates = it.integrates.filter((k) => topicOf(d, k));
    if (it.integrates && (it.integrates.length < 2 || it.integrates.indexOf(kid) < 0)) delete it.integrates;
    return it;
  });
}
function withItems(d, kid, items) { const dd = Object.assign({}, d, { items: Object.assign({}, d.items) }); dd.items[kid] = items; return dd; }
function pickItems(d, t) {
  const crits = outcomesOfTopic(d, t).reduce((a, o) => a.concat(o.criteria.map((c) => c.id)), []);
  return (m) => crits.some((c) => m.indexOf('Criterion ' + c + ' ') === 0 && /no practice item/.test(m)) || new RegExp('\\((' + 'p\\d+-' + t.kazanim_id + '-\\d+)\\)').test(m);
}
function allItems(d) {
  return Object.values(d.items).reduce((a, x) => a.concat(x), []).concat(Object.values(d.connecting).reduce((a, x) => a.concat(x), [])).concat(Object.values(d.finals).reduce((a, x) => a.concat(x), []));
}

// ---------------------------------------------------------------- audit repair: send each blocker back to the task that owns it
async function repairFromAudit(ctx, d, blockers, task) {
  const byTopic = {}, byItems = {}, byFinal = {};
  const critOwner = {}; d.outcomes.forEach((o) => o.criteria.forEach((c) => { critOwner[c.id] = o; }));
  blockers.forEach((m) => {
    let x;
    if ((x = /^Part (\d+) \/ objective (\d+)/.exec(m))) { const p = d.parts[x[1] - 1]; const t = p && p.topics[x[2] - 1]; if (t) (byTopic[t.kazanim_id] = byTopic[t.kazanim_id] || []).push(m); return; }
    if ((x = /^Outcome (\S+) has no lesson/.exec(m))) { const o = d.outcomes.find((y) => y.id === x[1]); if (o) (byTopic[o.kazanim_id] = byTopic[o.kazanim_id] || []).push(m); return; }
    if ((x = /^Criterion (\S+) .*no practice item/.exec(m))) { const o = critOwner[x[1]]; if (o) (byItems[o.kazanim_id] = byItems[o.kazanim_id] || []).push(m); return; }
    if ((x = /^Part \d+ \/ item \d+ \((p\d+)-(k\d+)-\d+\)/.exec(m))) { (byItems[x[2]] = byItems[x[2]] || []).push(m); return; }
    if ((x = /^Criterion (\S+) .*not assessed in the final test/.exec(m))) { const o = critOwner[x[1]]; if (o) (byFinal[o.part_id] = byFinal[o.part_id] || []).push(m); return; }
    if ((x = /^Final \d+ \(F-(p\d+)-\d+\)/.exec(m)) || (x = /^Final item F-(p\d+)-/.exec(m))) { (byFinal[x[1]] = byFinal[x[1]] || []).push(m); return; }
  });
  const R = ctx.limits.repairs;
  for (const kid of Object.keys(byTopic)) {
    const { part, topic } = topicOf(d, kid);
    const sub = { label: 'Repair lesson ' + kid, attempts: 0 };
    const outs = outcomesOfTopic(d, topic);
    const units = unitsOf(d, C.uniq(outs.reduce((a, o) => a.concat(o.units), [])));
    const crit = {}; outs.forEach((o) => o.criteria.forEach((c) => { crit[c.id] = true; }));
    const res = await repairConversation(ctx, sub, { prompt: 'study-topic', schema: S.topic, maxOutputTokens: 10000, feature: 'job:study:repair',
      vars: { study: d.title, part: part.title, topic: topic.title + ' (' + topic.kind + ')\nObjective: ' + topic.objective, outcomes: criteriaLines(outs), units: units.map(unitLine).join('\n'), conventions: (d.conventions || []).join('\n') || '(none)', others: '(see the earlier answer)', text: C.sourceText(d.sources, C.pagesForUnits(d.sources, units)) } },
    rawLesson(d.lessons[kid]), byTopic[kid], (j) => topicProblems(j, units, crit, d).concat(kcycleProblems(ctx, withLesson(d, kid, j), pickTopic(d, kid))), R);
    if (res) d.lessons[kid] = cleanLesson(res, d, topic);
  }
  for (const kid of Object.keys(byItems)) {
    const { part, topic } = topicOf(d, kid);
    const sub = { label: 'Repair items ' + kid, attempts: 0 };
    const outs = outcomesOfTopic(d, topic);
    const units = unitsOf(d, C.uniq(outs.reduce((a, o) => a.concat(o.units), [])));
    const crit = {}; outs.forEach((o) => o.criteria.forEach((c) => { crit[c.id] = o.id; }));
    const res = await repairConversation(ctx, sub, { prompt: 'study-items', schema: S.items, maxOutputTokens: 14000, feature: 'job:study:repair',
      vars: { study: d.title, topic: topic.title + '\nObjective: ' + topic.objective, outcomes: criteriaLines(outs), lesson: lessonDigest(d.lessons[kid]), units: units.map(unitLine).join('\n'), text: C.sourceText(d.sources, C.pagesForUnits(d.sources, units)) } },
    { items: (d.items[kid] || []).map(rawItem) }, byItems[kid], (j) => itemsProblems(j, crit, d, false), R);
    if (res) d.items[kid] = toItems(res, d, part, topic, 'practice');
  }
  for (const pid of Object.keys(byFinal)) {
    const part = d.parts.find((p) => p.part_id === pid);
    const sub = { label: 'Repair final ' + pid, attempts: 0 };
    const outs = d.outcomes.filter((o) => o.part_id === pid);
    const crit = {}; outs.forEach((o) => o.criteria.forEach((c) => { crit[c.id] = o.id; }));
    const units = unitsOf(d, C.uniq(outs.reduce((a, o) => a.concat(o.units), [])));
    const res = await repairConversation(ctx, sub, { prompt: 'study-final', schema: S.items, maxOutputTokens: 14000, feature: 'job:study:repair',
      vars: { study: d.title, part: part.title, topics: part.topics.map((t) => '- ' + t.kazanim_id + ': ' + t.title).join('\n'), outcomes: criteriaLines(outs), units: units.map(unitLine).join('\n'), practice: '(see the earlier answer)', text: C.sourceText(d.sources, C.pagesForUnits(d.sources, units)) } },
    { items: (d.finals[pid] || []).map(rawItem) }, byFinal[pid], (j) => itemsProblems(j, crit, d, false, null, null, true).concat(finalCoverage(j, crit)), R);
    if (res) d.finals[pid] = toFinal(res, d, part);
  }
  task.attempts = (task.attempts || 0) + 1;
}
// The task's prompt again, the current answer, and the audit's messages; then the task's own check-and-repair loop
async function repairConversation(ctx, sub, o, current, problems, checkFn, repairs) {
  const messages = [{ role: 'assistant', content: JSON.stringify(current) }, { role: 'user', content: ctx.render('job-repair', { problems: problems.map((p) => '- ' + p).join('\n') }) }];
  const r = await ctx.ask(Object.assign({}, o, { messages }));
  if (!r.json) return null;
  let json = r.json, left = checkFn(json), n = 0;
  while (left.length && n < repairs - 1) {
    n++;
    const r2 = await ctx.ask(Object.assign({}, o, { messages: [{ role: 'assistant', content: JSON.stringify(json) }, { role: 'user', content: ctx.render('job-repair', { problems: left.map((p) => '- ' + p).join('\n') }) }] }));
    if (!r2.json) break;
    json = r2.json; left = checkFn(json);
  }
  return json;
}
function rawLesson(L) {
  const blk = (b) => ({ type: b.type, title: b.title || '', md: b.md || '', tone: b.tone || 'none', items: b.items || [], columns: b.columns || [], rows: b.rows || [], problem: b.problem || '', steps: b.steps || [], answer: b.answer || '', refs: b.refs || [], slides: b.slides || [] });
  return { priming: Object.assign({ prereq: '' }, L.priming), blocks: L.blocks.map(blk), recall: Object.assign({ source_ref: '' }, L.recall), feynman: L.feynman };
}
function rawItem(it) {
  return { format: it.format, performance: it.performance, difficulty: it.difficulty, origin: it.origin, source_ref: it.source_ref || '', units: it.units || [], criteria: it.criteria || [], integrates: it.integrates || [], stem: it.stem,
    options: it.options || [], key: it.key || [], option_notes: Object.keys(it.option_notes || {}).map((id) => ({ id, note: it.option_notes[id] })),
    numeric: it.numeric || { value: 0, tol: 0, unit: '' }, rubric: it.rubric || { criteria: [], accept: [], contradictions: [], model: '' }, hints: it.hints || [], steps: it.steps || [], solution: it.solution || '' };
}

// ---------------------------------------------------------------- verification pass
async function verifyStudy(ctx, d, step) {
  const groups = [];
  d.parts.forEach((p) => {
    const items = p.topics.reduce((a, t) => a.concat(d.items[t.kazanim_id] || []), []).concat(d.connecting[p.part_id] || []).concat(d.finals[p.part_id] || []);
    for (let i = 0; i < items.length; i += 4) groups.push({ part: p, items: items.slice(i, i + 4) });
  });
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const out = await ctx.task(step, 'solve-' + (gi + 1), 'Solve ' + g.items.map((x) => x.q_id).join(', '), async () => solveBatch(ctx, d, g.items));
    for (const it of g.items) {
      const verdict = await ctx.task(step, 'check-' + it.q_id, 'Check ' + it.q_id, async () => judgeOne(ctx, d, it, (out || {})[it.q_id]));
      applyVerdict(it, verdict);
    }
  }
  // one fix round for disputed items
  const disputed = allItems(d).filter((x) => x.validation === 'disputed' && !x._fixTried);
  for (const it of disputed.slice(0, 60)) {
    if (ctx.limits.fixRounds < 1) break;
    const res = await ctx.task(step, 'fix-' + it.q_id, 'Re-examine ' + it.q_id, async () => fixOne(ctx, d, it));
    it._fixTried = true;
    if (res && res.replace) replaceItem(d, it.q_id, res.replace);
    const cur = findItem(d, it.q_id);
    if (res && res.recheck) {
      const out = await ctx.task(step, 'resolve-' + it.q_id, 'Solve ' + it.q_id + ' again', async () => solveBatch(ctx, d, [cur]));
      const verdict = await ctx.task(step, 'recheck-' + it.q_id, 'Check ' + it.q_id + ' again', async () => judgeOne(ctx, d, cur, (out || {})[cur.q_id]));
      applyVerdict(cur, verdict, res.note);
    }
  }
  allItems(d).forEach((x) => { delete x._fixTried; });
}
function pagesForItem(d, it) {
  const units = unitsOf(d, it.units && it.units.length ? it.units : d.outcomes.filter((o) => (it.outcomes || []).indexOf(o.id) >= 0).reduce((a, o) => a.concat(o.units), []));
  return C.pagesForUnits(d.sources, units);
}
async function solveBatch(ctx, d, items) {
  const picks = items.map((it) => pagesForItem(d, it));
  const r = await ctx.ask({ prompt: 'item-solve', schema: S.solve, maxOutputTokens: 8000, feature: 'job:verify:solve', effort: 'high',
    vars: { items: JSON.stringify(items.map(C.stripKey), null, 1), conventions: (d.conventions || []).join('\n') || '(none)', text: C.sourceText(d.sources, (s, p) => picks.some((f) => f(s, p))) } });
  const out = {};
  ((r.json && r.json.answers) || []).forEach((a) => { out[a.ref] = a; });
  out._writer = r.providerLabel + ' · ' + (r.model || 'default model');
  return out;
}
async function judgeOne(ctx, d, it, ans) {
  const cmp = C.compare(it, ans);
  if (cmp.match !== null) return { match: cmp.match, detail: cmp.detail, reasoning: ans && ans.reasoning || '' };
  if (!ans || ans.confidence === 'cannot_solve') return { match: false, detail: 'no independent answer' };
  const r = await ctx.ask({ prompt: 'item-judge', schema: S.judge, maxOutputTokens: 3000, feature: 'job:verify:judge',
    vars: { stem: it.stem, rubric: JSON.stringify(it.rubric, null, 1), answer: ans.answer } });
  const j = r.json || {};
  const req = (it.rubric.criteria || []).filter((c) => c.required !== false).map((c) => c.id);
  const met = new Set((j.criteria || []).filter((c) => c.met).map((c) => c.id));
  const ok = !j.contradiction && req.every((c) => met.has(c));
  return { match: ok, detail: ok ? 'the independent written answer meets every required rubric criterion' : 'the independent written answer misses ' + req.filter((c) => !met.has(c)).join(', ') + (j.contradiction ? ' and contradicts the rubric' : '') + (j.note ? ' (' + j.note.slice(0, 160) + ')' : ''), reasoning: ans.reasoning || '' };
}
function applyVerdict(it, v, note) {
  if (!v) return;
  if (v.match) { it.validation = 'verified'; it.validation_note = 'Solved again without the key by a separate call; ' + v.detail + '.' + (note ? ' ' + note : ''); }
  else { it.validation = 'disputed'; it.validation_note = 'The independent solution did not match: ' + v.detail + '.' + (v.reasoning ? ' Solver: ' + String(v.reasoning).slice(0, 300) : '') + (note ? ' ' + note : ''); }
}
async function fixOne(ctx, d, it) {
  const r = await ctx.ask({ prompt: 'item-fix', schema: S.fix, maxOutputTokens: 6000, feature: 'job:verify:fix', effort: 'high',
    vars: { item: JSON.stringify(rawItem(it), null, 1), dispute: it.validation_note, text: C.sourceText(d.sources, pagesForItem(d, it)) } });
  const j = r.json;
  if (!j) return null;
  if (j.verdict === 'item_fixed') {
    const knownU = {}; d.units.forEach((u) => { knownU[u.id] = true; });
    const crit = {}; (it.criteria || []).forEach((c) => { crit[c] = true; });
    const p = C.itemProblems(j.item, 'Fixed item', { criteria: crit, units: knownU });
    if (p.length) return { recheck: false, note: 'A proposed fix was rejected by the checks (' + p[0] + ').' };
    const fixed = C.cleanItem(j.item, { q_id: it.q_id, version: (it.version || 1) + 1, kazanim_id: it.kazanim_id, outcomes: it.outcomes, use: it.use, family: it.family });
    if (it.integrates && !fixed.integrates) fixed.integrates = it.integrates;
    return { replace: fixed, recheck: true, note: 'Rewritten after the dispute: ' + String(j.note || '').slice(0, 200) };
  }
  if (j.verdict === 'key_correct') return { recheck: true, note: 'Re-examined: the key was judged correct (' + String(j.note || '').slice(0, 200) + ').' };
  return { recheck: false, note: String(j.note || '').slice(0, 200) };
}
function findItem(d, qid) { return allItems(d).find((x) => x.q_id === qid); }
function replaceItem(d, qid, item) {
  [d.items, d.connecting, d.finals].forEach((map) => Object.keys(map).forEach((k) => { const i = map[k].findIndex((x) => x.q_id === qid); if (i >= 0) map[k][i] = item; }));
}

// ---------------------------------------------------------------- save the draft into the content folder
function saveStudy(ctx, d) {
  const pkg = assemble(d);
  // no unit ids in anything the learner reads (lessons, overviews, items), whichever step wrote them
  pkg.parts = C.stripDeep(pkg.parts); pkg.final_test = C.stripDeep(pkg.final_test);
  const a = ctx.checks.studyAudit(pkg);
  const v = ctx.checks.studyValidate(pkg);
  const all = allItems(d);
  const writers = ctx.job.writers || {};
  const steps = ctx.job.steps.filter((s) => s.tasks && s.tasks.some((t) => t.writer)).map((s) => ({ step: s.id, writers: C.uniq(s.tasks.filter((t) => t.writer).map((t) => t.writer)) }));
  pkg.generated_by = {
    app: 'Kartotek', job: ctx.job.id, kind: 'study', created_at: new Date(ctx.now()).toISOString(),
    writers: Object.keys(writers).map((w) => ({ writer: w, calls: writers[w] })), steps,
    certified: a.blockers.length === 0, blockers: a.blockers.length,
    verification: { verified: all.filter((x) => x.validation === 'verified').length, disputed: all.filter((x) => x.validation === 'disputed').length, unverified: all.filter((x) => x.validation === 'unverified').length, items: all.length },
    note: 'Written in Kartotek by the model(s) listed. Items start unverified; "verified" means a separate call solved the item without its key and matched it.',
  };
  const text = JSON.stringify(pkg, null, 1);
  fs.writeFileSync(path.join(ctx.dir, 'etut.json'), text);
  const contentDir = ctx.content && ctx.content.dir();
  const base = { etut_id: pkg.etut_id, title: pkg.title, certified: a.blockers.length === 0, blockers: a.blockers.slice(0, 40), warnings: a.warnings.length, counts: a.counts, verification: pkg.generated_by.verification, structural: v.errors.slice(0, 40) };
  if (v.errors.length) return Object.assign(base, { saved: false, where: 'Not saved to the content folder: ' + v.errors.length + ' structural problems remain (the app could not open it). The draft is in the job folder.', file: path.join(ctx.dir, 'etut.json') });
  if (!contentDir) return Object.assign(base, { saved: false, where: 'No content folder is set (Settings, Content). The draft is in the job folder.', file: path.join(ctx.dir, 'etut.json') });
  const folder = path.join(contentDir, 'studies', pkg.etut_id);
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, 'etut.json');
  if (fs.existsSync(target)) fs.copyFileSync(target, path.join(folder, 'etut.before-' + ctx.job.id + '.json'));
  fs.writeFileSync(target + '.tmp', text); fs.renameSync(target + '.tmp', target);
  fs.writeFileSync(path.join(folder, 'source.md'), sourceMd(d, pkg));
  // copies of the source files next to the content (never moved)
  const sdir = path.join(contentDir, 'sources', pkg.etut_id);
  fs.mkdirSync(sdir, { recursive: true });
  d.sources.forEach((s) => { const to = path.join(sdir, s.name); if (!fs.existsSync(to)) { try { fs.copyFileSync(s.file, to); } catch (e) { ctx.log('warn', 'Could not copy ' + s.name + ': ' + e.message); } } });
  return Object.assign(base, { saved: true, where: 'studies\\' + pkg.etut_id + '\\etut.json in the content folder', file: target });
}
function sourceMd(d, pkg) {
  const lines = ['# ' + pkg.title, '', 'Written by Kartotek job ' + pkg.generated_by.job + ' (' + pkg.generated_by.writers.map((w) => w.writer).join(', ') + ').', '', '## Source manifest', '', '| id | title | file | type | unit | range |', '| --- | --- | --- | --- | --- | --- |'];
  pkg.sources.forEach((s) => lines.push('| ' + [s.id, s.title, s.file, s.type, s.unit, s.pages].join(' | ') + ' |'));
  lines.push('', '## Unit inventory', '');
  d.units.forEach((u) => lines.push('- ' + u.id + ' · ' + u.source + ' ' + u.loc + ' · ' + u.type + ' · ' + u.disposition + ': ' + u.text + (u.reason ? ' (' + u.reason + ')' : '')));
  lines.push('', '## Named but not explained', '');
  (d.not_covered || []).forEach((n) => lines.push('- ' + n));
  lines.push('', '## Unreadable or ambiguous regions', '');
  d.sources.forEach((s) => s.pages.forEach((p) => { if (p.unreadable) lines.push('- ' + s.id + ' ' + C.unitWord(s) + ' ' + p.n + ': ' + p.unreadable); else if (p.transcribed != null) lines.push('- ' + s.id + ' ' + C.unitWord(s) + ' ' + p.n + ': read from the page image by the vision model'); }));
  return lines.join('\n') + '\n';
}

module.exports = { prepare, estimate, run, assemble, STEPS, transcribeStep, solveBatch: (ctx, d, items) => solveBatch(ctx, d, items), _t: { unitProblems, outlineProblems, applyOutline, topicProblems, itemsProblems, toItems, toFinal, cleanLesson, repairFromAudit } };
