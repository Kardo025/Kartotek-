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

  var api = { seed: seed, topicsOf: topicsOf, topicMap: topicMap, partOrder: partOrder, prereqClosure: prereqClosure, dependsOn: dependsOn, pagesOf: pagesOf };
  root.KGraph = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
