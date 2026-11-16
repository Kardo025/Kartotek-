/*
 * Kartotek knowledge graph seeding and topic map (KGraph, task F3). Pure, UI-independent.
 */
// KGraph: the knowledge graph seeded from Study v2 packages (task F3, LEARNING-PROTOCOL.md 3.10) and the topic dependency map that the
// probe strands and the packaged plan map are built from. Pure, no model, no storage: everything here is computed from a package each
// time it is asked for; the learner's own graph records (state.graph, task F6) are never written here.
//  - one proposition per outcome: id pkg:<etut_id>:<outcome id>; statement = outcome.proposition, else its criteria
//  - one chain per relation: id pkg:<etut_id>:<relation id>; conclusion = the first outcome that lists the relation, premises = the other
//    outcomes that cover any of the relation's units; a relation with no other covering outcome is a labelled self-link on its conclusion
//  - the topic map: one node per topic, "requires" edges from topic order and part prerequisites, "related" edges from the relations
(function (root) {
  'use strict';

  function isV2(pkg) { return !!pkg && pkg.schema_version === 2 && pkg.workflow === 'cycle-v2' && Array.isArray(pkg.parts); }
  function squash(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { s = squash(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function overlap(a, b) { var set = {}; (a || []).forEach(function (x) { set[x] = 1; }); return (b || []).some(function (x) { return set[x]; }); }

  // Topics in package order: { kid, part_id, pi, ti, n, title, outcomes: [outcome], units: [unit ids] }
  function topicsOf(pkg) {
    var out = [], n = 0, outs = pkg.outcomes || [];
    (pkg.parts || []).forEach(function (part, pi) {
      (part.kazanimlar || []).forEach(function (k, ti) {
        var os = outs.filter(function (o) { return o.kazanim_id === k.kazanim_id; });
        var units = [];
        os.forEach(function (o) { (o.units || []).forEach(function (u) { if (units.indexOf(u) < 0) units.push(u); }); });
        out.push({ kid: k.kazanim_id, part_id: part.part_id, pi: pi, ti: ti, n: n++, title: k.title, outcomes: os, units: units });
      });
    });
    return out;
  }

  function pagesOf(pkg, unitIds) {
    var byId = {};
    (pkg.units || []).forEach(function (u) { byId[u.id] = u; });
    var locs = [];
    (unitIds || []).forEach(function (id) { var u = byId[id]; if (u && u.loc && locs.indexOf(u.loc) < 0) locs.push(u.loc); });
    return locs;
  }

  // ------------------------------------------------------------------ seeding (3.10)
  function seed(pkg) {
    if (!isV2(pkg)) return { nodes: [], chains: [], notes: [] };
    var id = pkg.etut_id, outs = pkg.outcomes || [], notes = [];
    var nodes = outs.map(function (o) {
      var statement = squash(o.proposition) || (o.criteria || []).map(function (c) { return squash(c.text); }).join(' ');
      return {
        id: 'pkg:' + id + ':' + o.id, origin: 'package', etut_id: id, outcome_id: o.id, kid: o.kazanim_id, part_id: o.part_id,
        name: clip(o.performance, 80), statement: statement || squash(o.performance), units: (o.units || []).slice(), pages: pagesOf(pkg, o.units)
      };
    });
    var chains = [];
    (pkg.relations || []).forEach(function (r) {
      var listing = outs.filter(function (o) { return (o.relations || []).indexOf(r.id) >= 0; });
      var covering = outs.filter(function (o) { return overlap(o.units, r.units); });
      var concl = listing[0] || covering[covering.length - 1] || null;
      if (!concl) { notes.push(r.id + ' is linked to no outcome and covers no outcome\'s units; it has no place in the graph.'); return; }
      var premises = covering.filter(function (o) { return o.id !== concl.id; }).map(function (o) { return 'pkg:' + id + ':' + o.id; });
      chains.push({
        id: 'pkg:' + id + ':' + r.id, origin: 'package', etut_id: id, relation_id: r.id, type: r.type || 'related',
        conclusion: 'pkg:' + id + ':' + concl.id, premises: premises, self: !premises.length,
        text: squash(r.from) + ' → ' + squash(r.to) + ((r.conditions || []).length ? ' (' + r.conditions.map(squash).join('; ') + ')' : ''),
        units: (r.units || []).slice(), pages: pagesOf(pkg, r.units)
      });
    });
    return { nodes: nodes, chains: chains, notes: notes };
  }

  // ------------------------------------------------------------------ the topic map
  // Parts in prerequisite order (a part after the parts it builds on; ties keep package order). A cycle in the prerequisites is broken
  // at the first part that closes it, with a note.
  function partOrder(pkg) {
    var parts = pkg.parts || [], byId = {}, done = {}, busy = {}, out = [], notes = [];
    parts.forEach(function (p) { byId[p.part_id] = p; });
    function visit(p) {
      if (done[p.part_id]) return;
      if (busy[p.part_id]) { notes.push('The prerequisites of ' + p.part_id + ' form a cycle; it was broken there.'); return; }
      busy[p.part_id] = true;
      (p.prerequisites || []).forEach(function (q) { if (byId[q]) visit(byId[q]); });
      busy[p.part_id] = false; done[p.part_id] = true; out.push(p);
    }
    parts.forEach(visit);
    return { parts: out, notes: notes };
  }
  // Every part a part builds on, directly or through others
  function prereqClosure(pkg, partId) {
    var byId = {}, seen = {}, out = [];
    (pkg.parts || []).forEach(function (p) { byId[p.part_id] = p; });
    (function walk(pid) {
      var p = byId[pid];
      if (!p) return;
      (p.prerequisites || []).forEach(function (q) { if (!seen[q] && byId[q]) { seen[q] = true; walk(q); out.push(q); } });
    })(partId);
    return out;
  }

  // { nodes: [topic], edges: [{ from, to, kind: "order" | "prereq" | "related", label, relations }] } — "from" is needed before "to"
  // for order and prereq edges; related edges point from a premise's topic to the conclusion's topic.
  function topicMap(pkg) {
    if (!isV2(pkg)) return { nodes: [], edges: [] };
    var topics = topicsOf(pkg), byPart = {}, byKid = {}, edges = [], have = {};
    topics.forEach(function (t) { (byPart[t.part_id] = byPart[t.part_id] || []).push(t); byKid[t.kid] = t; });
    function add(from, to, kind, label, rel) {
      if (!from || !to || from === to) return;
      var k = from + '>' + to;
      if (have[k]) { if (rel) { have[k].relations = (have[k].relations || []).concat(rel); } return; }
      have[k] = { from: from, to: to, kind: kind, label: label || '', relations: rel ? [].concat(rel) : [] };
      edges.push(have[k]);
    }
    (pkg.parts || []).forEach(function (p) {
      var ts = byPart[p.part_id] || [];
      ts.forEach(function (t, i) { if (i) add(ts[i - 1].kid, t.kid, 'order', 'next in the part'); });
      (p.prerequisites || []).forEach(function (q) {
        var qs = byPart[q] || [];
        if (qs.length && ts.length) add(qs[qs.length - 1].kid, ts[0].kid, 'prereq', 'part ' + p.part_id + ' builds on ' + q);
      });
    });
    var outKid = {};
    (pkg.outcomes || []).forEach(function (o) { outKid[o.id] = o.kazanim_id; });
    seed(pkg).chains.forEach(function (c) {
      var to = outKid[c.conclusion.split(':').pop()];
      c.premises.forEach(function (pid) {
        var from = outKid[pid.split(':').pop()];
        if (from && to && from !== to && byKid[from] && byKid[to] && byKid[from].n < byKid[to].n) add(from, to, 'related', c.text, c.relation_id);
      });
    });
    return { nodes: topics, edges: edges };
  }

  // The topics a topic depends on (directly or not), through every edge kind
  function dependsOn(pkg, kid) {
    var m = topicMap(pkg), into = {}, seen = {}, out = [];
    m.edges.forEach(function (e) { (into[e.to] = into[e.to] || []).push(e.from); });
    (function walk(k) { (into[k] || []).forEach(function (f) { if (!seen[f]) { seen[f] = true; out.push(f); walk(f); } }); })(kid);
    return out;
  }


  // ================================================================== the knowledge graph (task F6, LEARNING-PROTOCOL 3.10)
  // Package records are computed from the packages every time (stable ids pkg:<etut_id>:<outcome or relation id>); the learner's own
  // records (from live sessions and notes, after review) live in state.graph: { nodes, chains, hidden, aliases, pending, log }.
  // Records hold true ideas only; the view adds each package node's evidence state (KCycle) and memory strength (DSR) at run time.
  function graphOf(state) {
    var g = state.graph;
    if (!g || typeof g !== 'object') g = state.graph = {};
    g.nodes = g.nodes || {}; g.chains = g.chains || {}; g.hidden = Array.isArray(g.hidden) ? g.hidden : [];
    g.aliases = g.aliases || {}; g.pending = Array.isArray(g.pending) ? g.pending : []; g.log = Array.isArray(g.log) ? g.log : [];
    return g;
  }
  function examOf(pkg) {
    var id = String(pkg.etut_id || '');
    if (pkg.cents_item || /^cents-/.test(id)) return 'cents';
    if (pkg.tud_item || /^tud-/.test(id)) return 'tud';
    return null;
  }
  // The Study v2 studies of the saved state with their packages
  function studiesOf(state) {
    return Object.keys(state.etuts || {}).map(function (k) { return state.etuts[k]; })
      .filter(function (et) { return et && !et.removed && isV2(et.package); });
  }
  var GOOD = { independent: 1, retained: 1, transfer: 1 };
  // Evidence state of each outcome (the outcome report) and memory strength of each topic's card, for one study
  function evidenceOf(state, et, extras, now) {
    var KC = root.KCycle, out = { outcomes: {}, memory: {} };
    if (!KC || !et.progress || et.progress.v !== 'c2') return out;
    try {
      var rep = KC.report(state, et, now || Date.now(), extras);
      rep.rows.forEach(function (r) { out.outcomes[r.id] = { state: r.state, label: r.label }; });
      rep.cards.forEach(function (c) { if (c.R != null) out.memory[c.kazanim_id] = { R: c.R, due_at: c.due_at, card_id: c.card_id }; });
    } catch (e) { /* a study whose progress cannot be read shows no evidence */ }
    return out;
  }
  // Per topic, what the learner's evidence says ("held" when every outcome of the topic is independent, retained or transfer)
  function topicEvidence(state, et, extras) {
    var ev = evidenceOf(state, et, extras), out = {};
    topicsOf(et.package).forEach(function (t) {
      if (!t.outcomes.length) return;
      var st = t.outcomes.map(function (o) { return (ev.outcomes[o.id] || {}).state; });
      if (st.every(function (x) { return GOOD[x]; })) out[t.kid] = 'held';
      else if (st.some(function (x) { return x === 'needs_work'; })) out[t.kid] = 'needs_work';
    });
    return out;
  }

  // The whole graph: { nodes: [node], chains: [chain] } — opts: { filter: "all" | "exam:<id>" | "study:<id>" | "mine", extras: { etut_id: extras } }
  function build(state, opts) {
    opts = opts || {};
    var g = graphOf(state), f = opts.filter || 'all', nodes = [], chains = [], hidden = {};
    g.hidden.forEach(function (h) { hidden[h] = true; });
    var want = function (pkg) {
      if (f === 'all') return true;
      if (f === 'mine') return false;
      if (f.indexOf('exam:') === 0) return examOf(pkg) === f.slice(5);
      if (f.indexOf('study:') === 0) return pkg.etut_id === f.slice(6);
      return true;
    };
    studiesOf(state).forEach(function (et) {
      var pkg = et.package;
      if (!want(pkg)) return;
      var sd = seed(pkg), ev = evidenceOf(state, et, (opts.extras || {})[et.etut_id]), topics = {};
      topicsOf(pkg).forEach(function (t) { topics[t.kid] = t; });
      sd.nodes.forEach(function (n) {
        if (hidden[n.id]) return;
        var t = topics[n.kid] || {};
        nodes.push(Object.assign({}, n, { kind: 'package', study: squash(pkg.title), exam: examOf(pkg), topic: squash(t.title), pi: t.pi, ti: t.ti,
          aliases: (g.aliases[n.id] || []).slice(), evidence: ev.outcomes[n.outcome_id] || { state: 'not_assessed', label: 'Not assessed yet' }, memory: ev.memory[n.kid] || null }));
      });
      sd.chains.forEach(function (c) { if (!hidden[c.id]) chains.push(c); });
    });
    var ids = {};
    nodes.forEach(function (n) { ids[n.id] = true; });
    // a filtered view keeps the learner's ideas that link to a shown record, or share a chain with one (repeated until nothing changes)
    var keep = {};
    if (f !== 'all' && f !== 'mine') {
      Object.keys(g.nodes).forEach(function (k) { var n = g.nodes[k]; if (n && (n.links || []).some(function (l) { return ids[l]; })) keep[k] = true; });
      for (var grew = true, guard = 0; grew && guard < 20; guard++) {
        grew = false;
        Object.keys(g.chains).forEach(function (k) {
          var c = g.chains[k], all = [c.conclusion].concat(c.premises || []);
          if (!all.some(function (x) { return ids[x] || keep[x]; })) return;
          all.forEach(function (x) { if (g.nodes[x] && !keep[x]) { keep[x] = true; grew = true; } });
        });
      }
    }
    Object.keys(g.nodes).forEach(function (k) {
      var n = g.nodes[k];
      if (!n || hidden[n.id]) return;
      if (f !== 'all' && f !== 'mine' && !keep[k]) return;
      nodes.push({ id: n.id, kind: 'learner', name: n.name, statement: n.statement, aliases: (n.aliases || []).slice(), origin: n.origin, links: (n.links || []).slice(), accepted_at: n.accepted_at,
        edited: !!n.edited, evidence: { state: 'session', label: 'From ' + (n.origin && n.origin.notes ? 'your notes' : 'a live session') + ' (session evidence)' }, memory: null });
      ids[n.id] = true;
    });
    Object.keys(g.chains).forEach(function (k) {
      var c = g.chains[k];
      if (!c || hidden[c.id]) return;
      if (ids[c.conclusion] && c.premises.every(function (p) { return ids[p]; })) chains.push(Object.assign({ origin: 'learner' }, c, { kind: 'learner', self: !c.premises.length }));
    });
    return { nodes: nodes, chains: chains };
  }
  // The graph as GraphView nodes and edges: a single-premise chain is an arrow; a chain with several premises runs through a small
  // implication node ("they jointly give"); a learner node is linked to the package nodes it names with a dashed "same subject" edge
  function viewModel(graph, opts) {
    opts = opts || {};
    var q = squash(opts.search).toLowerCase(), nodes = [], edges = [], have = {};
    graph.nodes.forEach(function (n) {
      var hit = !q || (n.name + ' ' + n.statement + ' ' + (n.aliases || []).join(' ') + ' ' + (n.topic || '') + ' ' + (n.study || '')).toLowerCase().indexOf(q) >= 0;
      nodes.push({ id: n.id, label: n.name, sub: (n.kind === 'package' ? n.study + (n.topic ? ' · ' + n.topic : '') : 'live session') + (n.memory ? ' · memory ' + Math.round(n.memory.R * 100) + ' %' : ''),
        status: n.evidence.state, group: n.kind === 'package' ? n.etut_id : 'mine', dim: !hit, match: q && hit, node: n });
      have[n.id] = true;
    });
    graph.chains.forEach(function (c) {
      if (!have[c.conclusion]) return;
      var ps = c.premises.filter(function (p) { return have[p]; });
      if (!ps.length) return;
      if (ps.length === 1) { edges.push({ from: ps[0], to: c.conclusion, kind: 'requires', label: c.text, chain: c.id }); return; }
      var and = 'and:' + c.id;
      nodes.push({ id: and, label: '∧', small: true, status: 'and', group: (graph.nodes.filter(function (n) { return n.id === c.conclusion; })[0] || {}).etut_id || 'mine', chain: c });
      ps.forEach(function (p) { edges.push({ from: p, to: and, kind: 'requires', label: c.text, chain: c.id }); });
      edges.push({ from: and, to: c.conclusion, kind: 'requires', label: c.text, chain: c.id });
    });
    graph.nodes.forEach(function (n) { if (n.kind === 'learner') (n.links || []).forEach(function (l) { if (have[l]) edges.push({ from: l, to: n.id, kind: 'related', label: 'same subject' }); }); });
    return { nodes: nodes, edges: edges };
  }

  // ------------------------------------------------------------------ growth: extraction and review (prompts\graph-extractor.md)
  var STOP = { the: 1, and: 1, for: 1, with: 1, that: 1, this: 1, from: 1, are: 1, is: 1, of: 1, to: 1, in: 1, an: 1, on: 1, by: 1, as: 1, or: 1, it: 1, be: 1, can: 1, its: 1, into: 1, every: 1, each: 1, gives: 1 };
  // content words (short symbols such as k9, NMH or 2n count; common words do not)
  function words(s) { var o = {}; String(s || '').toLowerCase().split(/[^a-z0-9À-ɏ]+/).forEach(function (w) { if (w.length > 1 && !STOP[w]) o[w] = 1; }); return o; }
  function similarity(a, b) { var A = words(a), B = words(b), n = 0, m = 0; Object.keys(A).forEach(function (w) { m++; if (B[w]) n++; }); Object.keys(B).forEach(function (w) { if (!A[w]) m++; }); return m ? n / m : 0; }
  // Up to `max` existing records most like a text (local, no model)
  function nearby(graph, text, max) {
    return graph.nodes.map(function (n) { return { n: n, s: similarity(text, n.name + ' ' + n.statement + ' ' + (n.aliases || []).join(' ')) }; })
      .filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, max || 5).map(function (x) { return x.n; });
  }
  // The transcript of a live session's steps not yet extracted, labelled by turn id ("step 3")
  function sessionTranscript(s) {
    var done = (s.graph_extracted && s.graph_extracted.steps) || [], out = [], steps = [];
    (s.steps || []).forEach(function (st) {
      if (done.indexOf(st.n) >= 0 || !st.teach.length) return;
      steps.push(st.n);
      var lines = ['[step ' + st.n + '] Prediction asked: ' + clip(st.predict.stem, 300)];
      st.teach.forEach(function (t, i) {
        lines.push('[step ' + st.n + '] Teaching' + (i ? ' (repair)' : '') + ': ' + clip(t.resolves, 400) + '\n' + clip(t.md, 1400));
        var c = st.check[i];
        if (c) lines.push('[step ' + st.n + '] Check: ' + clip(c.stem, 300) + ' → key: ' + ((c.options.filter(function (o) { return o.id === c.key; })[0] || {}).text || '') + (c.answer ? ' (learner ' + (c.correct ? 'right' : 'wrong') + ')' : ''));
      });
      out.push(lines.join('\n'));
    });
    return { text: out.join('\n\n'), steps: steps };
  }
  // The model sees short handles (E1, E2, ...) instead of long ids, which small models copy wrongly; the code maps them back
  function nearbyText(list) {
    return list.length ? list.map(function (n, i) { return '- E' + (i + 1) + ' | ' + n.name + ' | ' + clip(n.statement, 300) + ((n.aliases || []).length ? ' | also: ' + n.aliases.join('; ') : ''); }).join('\n') : '(none)';
  }
  // Values for the extractor. source: { session } or { notes: { name, text } }
  function extractorInputs(state, source, ctx) {
    var full = build(state, { filter: 'all' }), text, turns;
    if (source.session) { var tr = sessionTranscript(source.session); text = tr.text; turns = tr.steps.map(function (n) { return 'step ' + n; }); }
    else { text = '[notes] ' + String(source.notes.text || '').slice(0, 14000); turns = ['notes']; }
    var near = [];
    // records of the attached study first, then the most similar anywhere (at most 40)
    if (source.session && source.session.attached) full.nodes.forEach(function (n) { if (n.etut_id === source.session.attached.etut_id && near.length < 25) near.push(n); });
    nearby(full, text, 40).forEach(function (n) { if (near.length < 40 && near.indexOf(n) < 0) near.push(n); });
    var probs = ctx && ctx.problems && ctx.problems.length ? ctx.problems.map(function (x) { return '- ' + x; }).join('\n') : 'none';
    var handles = {};
    near.forEach(function (n, i) { handles['E' + (i + 1)] = n.id; });
    return { values: { transcript: text || '(nothing new to extract)', nearby: nearbyText(near), turns: turns.join(', ') || 'none', problems: probs }, turns: turns, nearIds: near.map(function (n) { return n.id; }), handles: handles };
  }
  // Small models sometimes name their propositions "new:3" and then use those labels (not the list index) in the chains. When every
  // name is such a label, chains are read by label and each name is taken from the statement ("Absorption law: X + X·Y = X" → "Absorption
  // law"). Returns a repaired copy; anything else is left as it is.
  function normalizeExtraction(json) {
    var j = JSON.parse(JSON.stringify(json || {})), props = Array.isArray(j.propositions) ? j.propositions : [];
    var labelled = props.length && props.every(function (p) { return /^new:\d+$/.test(squash(p.name)); });
    if (!labelled) return j;
    var byLabel = {};
    props.forEach(function (p, i) { byLabel[squash(p.name)] = 'new:' + i; var st = squash(p.statement), c = st.indexOf(':'); p.name = c > 2 && c < 70 ? st.slice(0, c) : st.split(' ').slice(0, 6).join(' '); });
    (j.chains || []).forEach(function (c) {
      c.premises = (c.premises || []).map(function (x) { return byLabel[squash(x)] || x; });
      c.conclusion = byLabel[squash(c.conclusion)] || c.conclusion;
    });
    j.repaired = 'labels';
    return j;
  }
  var ABOUT_LEARNER = /\b(the learner|the student|the teacher|you|your|this session)\b/i;
  // → problems []
  function resolver(inputs) { var h = (inputs && inputs.handles) || {}; return function (x) { x = squash(x); return h[x] || h[x.toUpperCase()] || x; }; }
  function checkExtraction(state, json, inputs) {
    var j = normalizeExtraction(json), problems = [], full = build(state, { filter: 'all' }), ids0 = {}, R = resolver(inputs);
    full.nodes.forEach(function (n) { ids0[n.id] = true; });
    var props = Array.isArray(j.propositions) ? j.propositions : [], chs = Array.isArray(j.chains) ? j.chains : [];
    if (!props.length && !chs.length) problems.push('Nothing was proposed; if the source teaches nothing new, say so with empty lists only when that is true.');
    props.forEach(function (p, i) {
      var at = 'Proposition ' + i;
      if (!squash(p.name)) problems.push(at + ': name is empty.');
      if (!squash(p.statement)) problems.push(at + ': statement is empty.');
      else if (ABOUT_LEARNER.test(p.statement) || ABOUT_LEARNER.test(p.name)) problems.push(at + ': it is about the learner, the teacher or the session; state the idea itself.');
      if (squash(p.link_to) && !ids0[R(p.link_to)]) problems.push(at + ': link_to "' + p.link_to + '" is not one of the existing records (use a handle such as E1).');
      // "related" is only a hint: references that are not existing records are dropped, not refused
      if (inputs && inputs.turns && inputs.turns.length && inputs.turns.indexOf(squash(p.turn)) < 0) problems.push(at + ': turn "' + p.turn + '" is not one of ' + inputs.turns.join(', ') + '.');
    });
    var ref = function (r) { var x = squash(r); if (/^new:\d+$/.test(x)) return Number(x.slice(4)) < props.length; return !!ids0[R(x)]; };
    chs.forEach(function (c, i) {
      var at = 'Chain ' + i;
      if (!Array.isArray(c.premises) || !c.premises.length) problems.push(at + ': it needs at least one premise.');
      (c.premises || []).forEach(function (p) { if (!ref(p)) problems.push(at + ': premise "' + p + '" is neither an existing id nor new:<index>.'); });
      if (!ref(c.conclusion)) problems.push(at + ': conclusion "' + c.conclusion + '" is neither an existing id nor new:<index>.');
      if ((c.premises || []).map(squash).indexOf(squash(c.conclusion)) >= 0) problems.push(at + ': the conclusion is also a premise.');
      if (!squash(c.text)) problems.push(at + ': text is empty.');
    });
    return problems;
  }
  function uid(p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  // Keeps a checked proposal for review: state.graph.pending (it is the model's output, removed once reviewed; the decisions are logged)
  function addProposal(state, source, json, inputs, ctx) {
    var g = graphOf(state), full = build(state, { filter: 'all' }), m = (ctx && ctx.meta) || {}, pr = (ctx && ctx.prompt) || {}, R = resolver(inputs);
    var rr = function (x) { x = squash(x); return /^new:\d+$/.test(x) ? x : R(x); };
    json = normalizeExtraction(json);
    var props = (json.propositions || []).map(function (p, i) {
      var text = squash(p.name) + ' ' + squash(p.statement);
      return { i: i, name: clip(p.name, 80), statement: clip(p.statement, 600), turn: squash(p.turn), link_to: squash(p.link_to) ? R(p.link_to) : null, related: (p.related || []).map(function (x) { return R(x); }).filter(function (x) { return x && full.nodes.some(function (n) { return n.id === x; }); }),
        confidence: p.confidence === 'tentative' ? 'tentative' : 'clear', candidates: nearby(full, text, 5).map(function (n) { return { id: n.id, name: n.name }; }), decision: null };
    });
    var chains = (json.chains || []).map(function (c, i) { return { i: i, premises: c.premises.map(rr), conclusion: rr(c.conclusion), text: clip(c.text, 400), turn: squash(c.turn), decision: null }; });
    var rec = { id: uid('gp'), at: (ctx && ctx.now) || Date.now(), source: source.session ? { session: source.session.id, title: source.session.title, steps: (inputs && inputs.turns) || [] } : { notes: clip(source.notes.name || 'notes', 120) },
      propositions: props, chains: chains, origin: 'generated', validation: 'unverified',
      by: { provider: m.providerLabel || m.provider || null, model: m.model || null, prompt: { id: pr.promptId || 'graph-extractor', version: pr.promptVersion || null } } };
    g.pending.push(rec);
    return rec;
  }
  // Applies the learner's decisions. decisions: { props: { i: { action: "accept" | "reject" | "same", name?, statement?, same? } }, chains: { i: "accept" | "reject" } }
  // → { nodes: [ids created], aliases: n, chains: [ids], skipped: [reasons] }
  function applyReview(state, pendingId, decisions, now) {
    var g = graphOf(state), rec = g.pending.filter(function (r) { return r.id === pendingId; })[0];
    if (!rec) throw new Error('No such proposal.');
    now = now || Date.now();
    var full = build(state, { filter: 'all' }), exists = {}, resolved = {}, out = { nodes: [], aliases: 0, chains: [], skipped: [] };
    full.nodes.forEach(function (n) { exists[n.id] = n; });
    var origin = rec.source.session ? function (turn) { return { session: rec.source.session, title: rec.source.title, turn: turn || null }; } : function () { return { notes: rec.source.notes }; };
    rec.propositions.forEach(function (p) {
      var d = (decisions.props || {})[p.i] || { action: 'reject' };
      p.decision = d.action;
      if (d.action === 'reject') return;
      var name = clip(d.name != null ? d.name : p.name, 80), statement = clip(d.statement != null ? d.statement : p.statement, 600);
      var same = d.action === 'same' ? (d.same || p.link_to) : null;
      if (same && exists[same]) {
        // the same idea as an existing record: its wording becomes another phrasing of that record
        if (exists[same].kind === 'package') { (g.aliases[same] = g.aliases[same] || []).push(statement); }
        else { var ln = g.nodes[same]; ln.aliases = (ln.aliases || []).concat(statement); }
        resolved['new:' + p.i] = same; out.aliases++;
        return;
      }
      var id = uid('g');
      // the links the learner kept (all proposed ones when the decision does not say)
      var links = (Array.isArray(d.links) ? d.links : [p.link_to].concat(p.related)).filter(function (x, i, a) { return x && exists[x] && a.indexOf(x) === i; });
      g.nodes[id] = { id: id, name: name, statement: statement, aliases: [], origin: origin(p.turn), links: links, accepted_at: now, edited: name !== p.name || statement !== p.statement,
        confidence: p.confidence, proposal: rec.id, by: rec.by };
      resolved['new:' + p.i] = id; out.nodes.push(id);
    });
    rec.chains.forEach(function (c) {
      var d = (decisions.chains || {})[c.i] || 'reject';
      c.decision = d;
      if (d !== 'accept') return;
      var r = function (x) { return /^new:/.test(x) ? resolved[x] || null : (exists[x] || g.nodes[x] ? x : null); };
      var prem = c.premises.map(r), concl = r(c.conclusion);
      if (!concl || prem.some(function (x) { return !x; })) { out.skipped.push('A chain was skipped: one of its ideas was rejected.'); c.decision = 'skipped'; return; }
      var id = uid('c');
      g.chains[id] = { id: id, premises: prem, conclusion: concl, text: c.text, origin: origin(c.turn), accepted_at: now, proposal: rec.id, by: rec.by };
      out.chains.push(id);
    });
    g.log.push({ id: rec.id, source: rec.source, at: now, accepted: out.nodes.length, linked: out.aliases, chains: out.chains.length,
      rejected: rec.propositions.filter(function (p) { return p.decision === 'reject'; }).length });
    g.pending = g.pending.filter(function (r) { return r.id !== pendingId; });
    return out;
  }
  // Coverage: the steps of a session that went into a proposal are not extracted again
  function markExtracted(s, turns, now) {
    s.graph_extracted = s.graph_extracted || { steps: [] };
    (turns || []).forEach(function (t) { var n = Number(String(t).replace(/^step /, '')); if (n && s.graph_extracted.steps.indexOf(n) < 0) s.graph_extracted.steps.push(n); });
    s.graph_extracted.at = now || Date.now();
  }
  function hide(state, id) { var g = graphOf(state); if (g.hidden.indexOf(id) < 0) g.hidden.push(id); }
  function unhide(state, id) { var g = graphOf(state); g.hidden = g.hidden.filter(function (x) { return x !== id; }); }
  // A practice target from a graph node (task F5 entry point "Practise these")
  function targetOf(state, node) {
    if (node.kind === 'package') {
      var et = state.etuts[node.etut_id], o = et && (et.package.outcomes || []).filter(function (x) { return x.id === node.outcome_id; })[0];
      return { id: node.outcome_id, label: squash(o ? o.performance : node.name), criteria: o ? (o.criteria || []).map(function (c) { return squash(c.text); }) : [], units: o ? (o.units || []).slice() : [], kid: node.kid, topic: node.topic || '', earlier: false };
    }
    return { id: node.id, label: clip(node.name + ': ' + node.statement, 300), criteria: [], units: [], kid: null, topic: '', earlier: false };
  }

  var api = { seed: seed, topicsOf: topicsOf, topicMap: topicMap, partOrder: partOrder, prereqClosure: prereqClosure, dependsOn: dependsOn, pagesOf: pagesOf,
    graphOf: graphOf, examOf: examOf, studiesOf: studiesOf, evidenceOf: evidenceOf, topicEvidence: topicEvidence, build: build, viewModel: viewModel, similarity: similarity, nearby: nearby,
    sessionTranscript: sessionTranscript, extractorInputs: extractorInputs, checkExtraction: checkExtraction, addProposal: addProposal, applyReview: applyReview, markExtracted: markExtracted,
    hide: hide, unhide: unhide, targetOf: targetOf, normalizeExtraction: normalizeExtraction };
  root.KGraph = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
