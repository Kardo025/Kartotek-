/*
 * Kartotek plan map and live sessions (KPlan, task F3, LEARNING-PROTOCOL.md 2.4, 3.6). Pure, UI-independent.
 */
// The personal plan map: a dependency map from what the learner holds to the goal.
//  - Packaged study (no model): the study's topics with "requires" edges (topic order, part prerequisites) and "related" edges (relations
//    mapped to outcomes), coloured by the latest probe and redrawn from real evidence: a topic the probe marked as held whose Applying
//    answers then show a gap is drawn as "gap found". Topics marked held may be skipped by the learner's choice, never removed: a skipped
//    topic stays in the navigator, counts as complete for opening End and stays in the final test (decision D5).
//  - Live session: the planner proposes the map, the learner accepts it or asks for changes before teaching starts; every version is kept,
//    and a gap found while teaching inserts the missing node as a new version.
// Live sessions live in state.sessions (generated material: origin "generated", validation "unverified", with its generator). Nothing here
// creates or rates a card, and nothing changes an outcome's evidence state.
(function (global) {
  'use strict';

  function squash(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { s = squash(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function uid(p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function KG() { return global.KGraph; }
  function KP() { return global.KProbe; }
  function KC() { return global.KCycle; }

  // ------------------------------------------------------------------ packaged: probes in the progress
  function probesOf(et) { var pr = et.progress; if (!Array.isArray(pr.probes)) pr.probes = []; return pr.probes; }
  // The open (unfinished) probe of a study, if any
  function openProbe(et) { return probesOf(et).filter(function (p) { return p.status !== 'done' && p.status !== 'stopped'; }).slice(-1)[0] || null; }
  function lastProbe(et) { return probesOf(et).filter(function (p) { return p.status === 'done' || p.status === 'stopped'; }).slice(-1)[0] || null; }
  // Per topic, what the finished probes say; a later probe overrides an earlier one wherever it located something (not "open")
  function probeStatus(et) {
    var out = {};
    probesOf(et).filter(function (p) { return p.status === 'done' || p.status === 'stopped'; })
      .sort(function (a, b) { return (a.finished_at || 0) - (b.finished_at || 0); })
      .forEach(function (p) {
        var lv = (p.result && p.result.levels) || KP().levelStatus(p);
        Object.keys(lv).forEach(function (kid) { if (lv[kid] !== 'open' || !out[kid]) out[kid] = { status: lv[kid], probe: p.id, at: p.finished_at, source: p.source }; });
      });
    return out;
  }
  function addProbe(et, probe) { probesOf(et).push(probe); return probe; }

  // ------------------------------------------------------------------ packaged: skipping a held topic (D5)
  // Why a topic cannot be skipped, or null when it can. Owner decision (2026-11-16): a topic whose Applying answers show a gap (an outcome
  // that needs work) cannot be skipped, whatever the probe said; real evidence outranks the probe.
  function skipBlock(et, kid, extras) {
    if ((et.progress.skipped || {})[kid]) return 'Already skipped.';
    var s = probeStatus(et)[kid];
    if (!s || s.status !== 'held') return 'Only a topic Find my level found held can be skipped.';
    var t = KG().topicsOf(et.package).filter(function (x) { return x.kid === kid; })[0];
    if (t && KC().topicEvidence(et, t.pi, t.ti, KC().itemIndex(et.package, extras)).needs_work > 0) return 'Your Applying answers on this topic show a gap, so it cannot be skipped.';
    return null;
  }
  function canSkip(et, kid, extras) { return !skipBlock(et, kid, extras); }
  function skip(et, kid, now, extras) {
    var why = skipBlock(et, kid, extras);
    if (why) throw new Error(why);
    var s = probeStatus(et)[kid];
    et.progress.skipped = et.progress.skipped || {};
    et.progress.skipped[kid] = { at: now || Date.now(), after_probe: s.probe, source: s.source };
    return et.progress.skipped[kid];
  }
  function unskip(et, kid) {
    var sk = et.progress.skipped || {};
    if (!sk[kid]) return false;
    // the record of the skip is kept as history; the topic is simply no longer skipped
    et.progress.skip_log = et.progress.skip_log || [];
    et.progress.skip_log.push(Object.assign({ kid: kid, undone_at: Date.now() }, sk[kid]));
    delete sk[kid];
    return true;
  }
  function isSkipped(et, kid) { return !!(et.progress.skipped || {})[kid]; }

  // ------------------------------------------------------------------ packaged: the map
  // Real evidence on a topic since its probe: Applying answers on verified items (KCycle's own count)
  function evidenceOf(et, t, idx) {
    var c = KC().topicEvidence(et, t.pi, t.ti, idx);
    return { assessed: c.assessed, independent: c.independent, needs_work: c.needs_work, total: c.total };
  }
  // → { nodes: [{ id, label, sub, status, probe_status, skipped, done, current, part_id, outcomes, evidence }], edges, position, legend }
  // status: "held" | "edge" | "missing" | "fragile" | "gap" | "open" (not probed) | "gap_found" (probe said held, Applying shows a gap)
  function packagedMap(et, extras) {
    var pkg = et.package, m = KG().topicMap(pkg), ps = probeStatus(et), idx = KC().itemIndex(pkg, extras), pr = et.progress;
    var cur = KC().curTopic(et), curKid = cur ? cur.kazanim_id : null;
    var partNo = {};
    (pkg.parts || []).forEach(function (p, i) { partNo[p.part_id] = i + 1; });
    var nodes = m.nodes.map(function (t) {
      var p = ps[t.kid], ev = evidenceOf(et, t, idx), st = p ? p.status : 'open';
      if (p && (st === 'held' || st === 'fragile') && ev.needs_work > 0) st = 'gap_found';
      return {
        id: t.kid, label: t.title, sub: 'Part ' + partNo[t.part_id] + ' · topic ' + (t.ti + 1), part_id: t.part_id,
        status: st, probe_status: p ? p.status : null, skipped: isSkipped(et, t.kid), done: KC().cycleDone(et, t.kid),
        current: t.kid === curKid && !KC().isEnd(pr.stage), outcomes: t.outcomes.map(function (o) { return { id: o.id, performance: o.performance }; }), evidence: ev
      };
    });
    return { nodes: nodes, edges: m.edges, position: curKid, probed: Object.keys(ps).length > 0 };
  }

  // ------------------------------------------------------------------ live sessions (state.sessions, LEARNING-PROTOCOL 2.4)
  function sessionsOf(state) { if (!state.sessions || typeof state.sessions !== 'object') state.sessions = {}; return state.sessions; }
  // opts: { title, goal_words, attached: { etut_id, topics: [kid] } | null, now }
  function newSession(state, opts) {
    var now = opts.now || Date.now();
    var s = {
      id: uid('ls'), kind: 'live', title: clip(opts.title || opts.goal_words || 'Live session', 120), created_at: now, updated_at: now, status: 'probe',
      attached: opts.attached && opts.attached.etut_id ? { etut_id: opts.attached.etut_id, topics: (opts.attached.topics || []).slice(), units: (opts.attached.units || []).slice() } : null,
      files: [], goal: { learner_words: squash(opts.goal_words), concrete: '' },
      probe: null, plan: null, steps: [], problems: [], side: [], briefs: [], generator: [], usage: { calls: 0, cost_usd: 0 }
    };
    sessionsOf(state)[s.id] = s;
    return s;
  }
  function listSessions(state) {
    var all = sessionsOf(state);
    return Object.keys(all).map(function (k) { return all[k]; }).filter(function (s) { return s && s.kind === 'live'; }).sort(function (a, b) { return (b.updated_at || 0) - (a.updated_at || 0); });
  }
  function touch(s, now) { s.updated_at = now || Date.now(); }
  // Usage of one model call (cost only; no learner text)
  function countCall(s, meta, now) {
    s.usage = s.usage || { calls: 0, cost_usd: 0 };
    s.usage.calls++;
    if (meta && typeof meta.costUsd === 'number') s.usage.cost_usd = Math.round((s.usage.cost_usd + meta.costUsd) * 1e6) / 1e6;
    touch(s, now);
  }
  // The probe ended: the session moves on to planning, with the probe's concrete goal
  function probeDone(s, now) {
    if (!s.probe || (s.probe.status !== 'done' && s.probe.status !== 'stopped')) throw new Error('The probe is not finished.');
    s.goal.concrete = s.probe.goal.concrete || s.goal.learner_words;
    if (s.status === 'probe') {
      s.status = 'plan';
      s.usage = s.usage || { calls: 0, cost_usd: 0 };
      (s.probe.generator || []).forEach(function (g) { s.usage.calls++; if (typeof g.cost_usd === 'number') s.usage.cost_usd = Math.round((s.usage.cost_usd + g.cost_usd) * 1e6) / 1e6; });
    }
    touch(s, now);
  }

  // ------------------------------------------------------------------ the live plan: versions, checks, position
  var NODE_ID = /^[a-z0-9][a-z0-9-]{0,48}$/;
  // ctx: { units: { id: true } } for an attached session. → problems []
  function checkPlan(json, ctx) {
    var problems = [], j = json || {}, nodes = Array.isArray(j.nodes) ? j.nodes : [], ids = {};
    if (!squash(j.approach)) problems.push('"approach" is empty: say in a few sentences what will be covered, in what order and why.');
    if (nodes.length < 2) problems.push('The map needs at least two nodes (what is held or the first foundation, and the goal).');
    if (nodes.length > 30) problems.push('At most 30 nodes.');
    nodes.forEach(function (n, i) {
      var at = 'Node ' + (i + 1);
      if (!n || typeof n !== 'object') { problems.push(at + ' is not an object.'); return; }
      if (!NODE_ID.test(String(n.id || ''))) problems.push(at + ': id "' + n.id + '" must be lowercase words joined by hyphens.');
      else if (ids[n.id]) problems.push(at + ': id "' + n.id + '" is used twice.');
      ids[n.id] = n;
      if (!squash(n.label)) problems.push(at + ': label is empty.');
      if (['held', 'learn', 'goal'].indexOf(n.kind) < 0) problems.push(at + ': kind must be held, learn or goal.');
      if (n.mode != null && n.mode !== '' && ['socratic', 'expository'].indexOf(n.mode) < 0) problems.push(at + ': mode must be socratic or expository.');
      if (ctx && ctx.units) (n.units || []).forEach(function (u) { if (!ctx.units[u]) problems.push(at + ': unit "' + u + '" is not a unit of the attached study.'); });
      if (ctx && ctx.units && n.kind !== 'held' && !(n.units || []).length) problems.push(at + ': in a session attached to a study every node to learn cites the units it rests on.');
    });
    if (!nodes.some(function (n) { return n && n.kind === 'goal'; })) problems.push('One node must be the goal (kind "goal").');
    nodes.forEach(function (n) { (n && n.depends_on || []).forEach(function (d) { if (!ids[d]) problems.push('Node "' + n.id + '" depends on "' + d + '", which is not on the map.'); else if (d === n.id) problems.push('Node "' + n.id + '" depends on itself.'); }); });
    if (!problems.length) { var cyc = cycleIn(nodes); if (cyc) problems.push('The map has a cycle: ' + cyc.join(' → ') + '. "Requires" edges must point one way.'); }
    return problems;
  }
  function cycleIn(nodes) {
    var by = {}, state = {}, stack = [], found = null;
    nodes.forEach(function (n) { by[n.id] = n; });
    function visit(id) {
      if (found) return;
      state[id] = 1; stack.push(id);
      (by[id].depends_on || []).forEach(function (d) { if (found || !by[d]) return; if (state[d] === 1) found = stack.slice(stack.indexOf(d)).concat(d); else if (!state[d]) visit(d); });
      stack.pop(); state[id] = 2;
    }
    nodes.forEach(function (n) { if (!state[n.id] && !found) visit(n.id); });
    return found;
  }
  function cleanNodes(list) {
    return list.map(function (n) {
      return { id: n.id, label: clip(n.label, 120), kind: n.kind, depends_on: (n.depends_on || []).slice(), units: (n.units || []).slice(),
        why: clip(n.why, 400), mode: n.mode === 'socratic' || n.mode === 'expository' ? n.mode : null };
    });
  }
  // A new version from a checked planner reply. ctx: { reason: "first" | "change" | "gap", change_request, meta, prompt, now }
  function addPlanVersion(s, json, ctx) {
    ctx = ctx || {};
    var now = ctx.now || Date.now(), m = ctx.meta || {}, pr = ctx.prompt || {};
    s.plan = s.plan || { versions: [], current: -1, position: null };
    var v = {
      at: now, reason: ctx.reason || (s.plan.versions.length ? 'change' : 'first'), change_request: clip(ctx.change_request, 2000) || null,
      approach: clip(json.approach, 2000), nodes: cleanNodes(json.nodes), uncertain: (json.uncertain || []).map(function (x) { return clip(x, 300); }).filter(Boolean),
      accepted_at: null, origin: 'generated', validation: 'unverified',
      by: { provider: m.providerLabel || m.provider || null, model: m.model || null, prompt: { id: pr.promptId || 'planner', version: pr.promptVersion || null, hash: pr.promptHash || null },
        cost_usd: typeof m.costUsd === 'number' ? m.costUsd : null, cost_kind: m.costKind || null }
    };
    s.plan.versions.push(v);
    s.plan.current = s.plan.versions.length - 1;
    if (!s.plan.position || !v.nodes.some(function (n) { return n.id === s.plan.position; })) s.plan.position = firstToLearn(v);
    touch(s, now);
    return v;
  }
  // The first node to learn in dependency order (a node whose every dependency is held), else the goal
  function firstToLearn(v) {
    var by = {};
    v.nodes.forEach(function (n) { by[n.id] = n; });
    var order = topo(v.nodes);
    for (var i = 0; i < order.length; i++) { var n = by[order[i]]; if (n.kind !== 'held') return n.id; }
    return order[order.length - 1] || null;
  }
  function topo(nodes) {
    var by = {}, seen = {}, out = [];
    nodes.forEach(function (n) { by[n.id] = n; });
    function visit(id) { if (seen[id] || !by[id]) return; seen[id] = true; (by[id].depends_on || []).forEach(visit); out.push(id); }
    nodes.forEach(function (n) { visit(n.id); });
    return out;
  }
  function currentPlan(s) { return s && s.plan && s.plan.current >= 0 ? s.plan.versions[s.plan.current] : null; }
  function acceptPlan(s, now) {
    var v = currentPlan(s);
    if (!v) throw new Error('There is no plan to accept.');
    v.accepted_at = now || Date.now();
    if (s.status === 'plan') s.status = 'teach';
    touch(s, now);
    return v;
  }
  function setPosition(s, nodeId, now) {
    var v = currentPlan(s);
    if (!v || !v.nodes.some(function (n) { return n.id === nodeId; })) throw new Error('No such node on the current map.');
    s.plan.position = nodeId;
    touch(s, now);
  }
  // A gap found while teaching (task F4 calls this when a check reveals a missing foundation): a new version with the missing node inserted
  // before the node being taught; the old version is kept. gap: { before: node id, label, why, units }
  function insertGap(s, gap, now) {
    var v = currentPlan(s);
    if (!v) throw new Error('There is no plan.');
    var target = v.nodes.filter(function (n) { return n.id === gap.before; })[0];
    if (!target) throw new Error('No such node on the current map.');
    var base = squash(gap.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'missing-foundation', id = base, k = 2;
    while (v.nodes.some(function (n) { return n.id === id; })) id = base + '-' + (k++);
    var nodes = cleanNodes(v.nodes);
    var add = { id: id, label: clip(gap.label, 120), kind: 'learn', depends_on: (target.depends_on || []).filter(function (d) { return true; }), units: (gap.units || []).slice(), why: clip(gap.why, 400), mode: null };
    nodes.forEach(function (n) { if (n.id === target.id) n.depends_on = n.depends_on.concat(id); });
    nodes.push(add);
    s.plan.versions.push({ at: now || Date.now(), reason: 'gap', change_request: 'Teaching showed a missing foundation before "' + target.label + '": ' + squash(gap.label) + (gap.why ? ' (' + squash(gap.why) + ')' : ''),
      approach: v.approach, nodes: nodes, uncertain: v.uncertain.slice(), accepted_at: v.accepted_at ? (now || Date.now()) : null, origin: v.origin, validation: v.validation, by: v.by, inserted: id });
    s.plan.current = s.plan.versions.length - 1;
    s.plan.position = id;
    touch(s, now);
    return id;
  }
  // The current (or a given) version for the graph view: nodes with status from their kind and the position
  function liveMap(s, versionIndex) {
    var i = versionIndex == null ? (s.plan ? s.plan.current : -1) : versionIndex, v = s.plan && s.plan.versions[i];
    if (!v) return { nodes: [], edges: [], position: null };
    // task F4: a node with a finished teaching step (its check answered right) is drawn as taught
    var taught = {};
    (s.steps || []).forEach(function (st) { if (st.outcome === 'right' || st.outcome === 'right_after_repair') taught[st.node] = (taught[st.node] || 0) + 1; });
    var nodes = v.nodes.map(function (n) {
      var status = n.kind === 'held' ? 'held' : taught[n.id] ? 'taught' : n.kind === 'goal' ? 'goal' : (v.inserted === n.id ? 'gap_found' : 'learn');
      return { id: n.id, label: n.label, sub: n.kind === 'held' ? 'you hold this' : taught[n.id] ? taught[n.id] + ' step' + (taught[n.id] === 1 ? '' : 's') + ' checked' : n.kind === 'goal' ? 'the goal' : n.mode ? 'to learn · ' + n.mode : 'to learn',
        status: status, kind: n.kind, why: n.why, units: n.units, current: s.plan.position === n.id };
    });
    var edges = [];
    v.nodes.forEach(function (n) { (n.depends_on || []).forEach(function (d) { edges.push({ from: d, to: n.id, kind: 'requires' }); }); });
    return { nodes: nodes, edges: edges, position: s.plan.position };
  }

  // Values for prompts\planner.md
  function plannerInputs(s, ctx) {
    ctx = ctx || {};
    var res = s.probe && (s.probe.result || KP().result(s.probe));
    var probeText = res ? res.strands.map(function (r) {
      return '- ' + r.label + ' [' + r.strand + ']: ' + r.status + (r.inferred ? ' (inferred)' : '') + (r.held_up_to ? '; floor: ' + r.held_up_to.label : '') +
        (r.first_miss ? '; first miss: ' + r.first_miss.label : '') + (r.misconceptions.length ? '; misunderstandings: ' + r.misconceptions.join(' ') : '') +
        (r.fragile.length ? '; shaky: ' + r.fragile.join(', ') : '');
    }).join('\n') + '\nQuestions asked: ' + res.asked + '. ' + res.closing : '(no probe result)';
    var probs = ctx.problems && ctx.problems.length ? ctx.problems.map(function (x) { return '- ' + x; }).join('\n') : 'none';
    var cur = currentPlan(s);
    var change = squash(ctx.change_request);
    if (change && cur) change = change + '\n\nThe current map (version ' + (s.plan.current + 1) + '):\n' + cur.nodes.map(function (n) { return '- ' + n.id + ' (' + n.kind + ') ' + n.label + (n.depends_on.length ? ' ← ' + n.depends_on.join(', ') : ''); }).join('\n');
    return { goal: 'In the learner\'s words: ' + (s.goal.learner_words || '(none)') + '\nConcrete goal: ' + (s.goal.concrete || '(not agreed)'),
      probe_result: probeText, material: ctx.material != null ? String(ctx.material) : '(a free session: no source material)', change_request: change || '(none: this is the first draft)', problems: probs };
  }
  // Source units of an attached session as planner material, with the relations among the chosen topics
  function attachedMaterial(pkg, kids, max) {
    var units = {}, out = [], total = 0, cap = max || 16000, topics = KG().topicsOf(pkg), want = {};
    (pkg.units || []).forEach(function (u) { units[u.id] = u; });
    var all = (kids || []).slice();
    (kids || []).forEach(function (k) { KG().dependsOn(pkg, k).forEach(function (d) { if (all.indexOf(d) < 0) all.push(d); }); });
    all.forEach(function (k) { want[k] = true; });
    topics.filter(function (t) { return want[t.kid]; }).forEach(function (t) {
      out.push('Topic ' + t.kid + ': ' + t.title + ((kids || []).indexOf(t.kid) >= 0 ? ' (chosen)' : ' (builds toward a chosen topic)'));
      t.units.forEach(function (id) { var u = units[id]; if (!u || total > cap) return; var line = '  ' + id + ' [' + (u.loc || '') + ']: ' + clip(u.text, 420); total += line.length; out.push(line); });
    });
    var rels = (pkg.relations || []).filter(function (r) { return (r.units || []).some(function (u) { return out.join('\n').indexOf(u + ' [') >= 0; }); });
    if (rels.length) out.push('Relations: ' + rels.map(function (r) { return r.id + ' ' + squash(r.from) + ' → ' + squash(r.to) + ' (' + (r.type || 'related') + ')'; }).join(' | '));
    return out.join('\n');
  }
  function unitSet(pkg) { var o = {}; (pkg.units || []).forEach(function (u) { o[u.id] = true; }); return o; }

  global.KPlan = {
    probesOf: probesOf, openProbe: openProbe, lastProbe: lastProbe, probeStatus: probeStatus, addProbe: addProbe,
    canSkip: canSkip, skipBlock: skipBlock, skip: skip, unskip: unskip, isSkipped: isSkipped, packagedMap: packagedMap,
    sessionsOf: sessionsOf, newSession: newSession, listSessions: listSessions, countCall: countCall, probeDone: probeDone,
    checkPlan: checkPlan, addPlanVersion: addPlanVersion, currentPlan: currentPlan, acceptPlan: acceptPlan, setPosition: setPosition,
    insertGap: insertGap, liveMap: liveMap, plannerInputs: plannerInputs, attachedMaterial: attachedMaterial, unitSet: unitSet
  };
})(typeof window !== 'undefined' ? window : this);
