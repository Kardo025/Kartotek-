// GraphView: a pan-and-zoom dependency graph drawn in SVG (task F3; reused by the knowledge graph of task F6).
// Foundations at the bottom, the goal at the top. Two layouts:
//  - "layers": any acyclic graph; a node's row is the length of its longest chain of "requires" edges (Sugiyama-style, with a few
//    barycentre sweeps to reduce crossings). Used by the live plan map and, in F6, the knowledge graph.
//  - "columns": nodes grouped by `group` (a study's parts in prerequisite order), each group one column read from the bottom up.
// Props
//   nodes: [{ id, label, sub?, status, group?, current?, skipped?, done?, badge? }]
//   edges: [{ from, to, kind: "order" | "prereq" | "requires" | "related", label? }]   ("from" is needed before "to")
//   statuses: { <status>: { label, tone } } (tone: held | edge | missing | open | goal | gap | learn), selected, onSelect(id), layout,
//   groups: [{ id, label }] for "columns", height, ariaLabel
// Everything is input-first: a click selects at once, layout changes glide (Motion), statuses fade between colours, and nothing waits.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MagnifyingGlassPlus, MagnifyingGlassMinus, CornersOut, MapPin, Flag } from "@phosphor-icons/react";
import { EASE, DUR, SPRING } from "../motion.jsx";
import "./graph.css";

const W = 184, H = 58, GX = 36, GY = 46;

// ------------------------------------------------------------------ layout
function layersLayout(nodes, edges) {
  const ids = nodes.map((n) => n.id), has = new Set(ids), preds = {}, succs = {};
  ids.forEach((id) => { preds[id] = []; succs[id] = []; });
  edges.forEach((e) => { if (e.kind !== "related" && has.has(e.from) && has.has(e.to)) { preds[e.to].push(e.from); succs[e.from].push(e.to); } });
  const depth = {}, busy = {};
  const d = (id) => {
    if (depth[id] != null) return depth[id];
    if (busy[id]) return 0;
    busy[id] = true;
    depth[id] = preds[id].length ? 1 + Math.max(...preds[id].map(d)) : 0;
    busy[id] = false;
    return depth[id];
  };
  ids.forEach(d);
  const rows = [];
  ids.forEach((id) => { (rows[depth[id]] = rows[depth[id]] || []).push(id); });
  const pos = {};
  const index = () => rows.forEach((r) => r.forEach((id, i) => { pos[id] = i - (r.length - 1) / 2; }));
  index();
  const bary = (id, list) => (list.length ? list.reduce((a, x) => a + pos[x], 0) / list.length : pos[id]);
  for (let sweep = 0; sweep < 4; sweep++) {
    const up = sweep % 2 === 0;
    const order = up ? rows.map((_, i) => i) : rows.map((_, i) => rows.length - 1 - i);
    order.forEach((ri) => {
      const r = rows[ri];
      if (!r) return;
      r.sort((a, b) => bary(a, up ? preds[a] : succs[a]) - bary(b, up ? preds[b] : succs[b]));
      r.forEach((id, i) => { pos[id] = i - (r.length - 1) / 2; });
    });
  }
  const out = {};
  rows.forEach((r, ri) => r.forEach((id) => { out[id] = { x: pos[id] * (W + GX), y: -ri * (H + GY) }; }));
  return out;
}
function columnsLayout(nodes, groups) {
  const order = (groups && groups.length ? groups.map((g) => g.id) : []).slice();
  nodes.forEach((n) => { if (order.indexOf(n.group) < 0) order.push(n.group); });
  const count = {}, out = {};
  nodes.forEach((n) => {
    const gi = order.indexOf(n.group), i = count[n.group] = (count[n.group] == null ? 0 : count[n.group] + 1);
    out[n.id] = { x: gi * (W + GX * 1.6), y: -i * (H + GY * 0.6) };
  });
  return { pos: out, order };
}

function edgePath(a, b) {
  const dx = b.x - a.x;
  if (Math.abs(dx) > W * 0.9) {
    // side to side between columns
    const sx = a.x + (dx > 0 ? W / 2 : -W / 2), tx = b.x + (dx > 0 ? -W / 2 : W / 2), m = (sx + tx) / 2;
    return `M${sx},${a.y} C${m},${a.y} ${m},${b.y} ${tx},${b.y}`;
  }
  const sy = a.y - H / 2, ty = b.y + H / 2;
  if (ty > sy) {
    // the target sits lower than the source (same column, backward): loop around the side
    const x = Math.max(a.x, b.x) + W / 2 + 18;
    return `M${a.x + W / 2},${a.y} C${x},${a.y} ${x},${b.y} ${b.x + W / 2},${b.y}`;
  }
  const m = (sy + ty) / 2;
  return `M${a.x},${sy} C${a.x},${m} ${b.x},${m} ${b.x},${ty}`;
}

// ------------------------------------------------------------------ the view
export default function GraphView({ nodes, edges, statuses, selected, onSelect, layout = "layers", groups, height = 420, ariaLabel, legend = true }) {
  const reduce = useReducedMotion();
  const wrap = useRef(null);
  const geo = useMemo(() => {
    if (layout === "columns") { const c = columnsLayout(nodes, groups); return { pos: c.pos, order: c.order }; }
    return { pos: layersLayout(nodes, edges), order: null };
  }, [nodes, edges, layout, groups]);
  const box = useMemo(() => {
    const ps = Object.values(geo.pos);
    if (!ps.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    return { x0: Math.min(...ps.map((p) => p.x)) - W / 2 - 30, x1: Math.max(...ps.map((p) => p.x)) + W / 2 + 30, y0: Math.min(...ps.map((p) => p.y)) - H / 2 - 44, y1: Math.max(...ps.map((p) => p.y)) + H / 2 + 30 };
  }, [geo]);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ w: 800, h: height });
  const fit = () => {
    const el = wrap.current;
    if (!el) return;
    const w = el.clientWidth || 800, h = el.clientHeight || height, bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const k = Math.max(0.3, Math.min(1.15, Math.min(w / bw, h / bh)));
    setSize({ w, h });
    setView({ k, x: (w - bw * k) / 2 - box.x0 * k, y: (h - bh * k) / 2 - box.y0 * k });
  };
  useEffect(() => { fit(); }, [box.x0, box.x1, box.y0, box.y1]);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);
  // pan with the pointer, zoom with the wheel around the cursor
  const drag = useRef(null);
  const onDown = (e) => { if (e.target.closest && e.target.closest(".gv-node")) return; drag.current = { x: e.clientX, y: e.clientY, v: view }; e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e) => { const g = drag.current; if (!g) return; setView({ ...g.v, x: g.v.x + e.clientX - g.x, y: g.v.y + e.clientY - g.y }); };
  const onUp = () => { drag.current = null; };
  const zoomAt = (f, cx, cy) => setView((v) => { const k = Math.max(0.25, Math.min(2.5, v.k * f)); const r = k / v.k; return { k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r }; });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const wheel = (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const center = () => [size.w / 2, size.h / 2];

  const st = (s) => (statuses && statuses[s]) || { label: s, tone: "open" };
  const present = Array.from(new Set(nodes.map((n) => n.status))).filter((s) => statuses && statuses[s]);
  const kinds = Array.from(new Set(edges.map((e) => (e.kind === "related" ? "related" : "requires"))));
  const glide = reduce ? { duration: 0 } : SPRING;
  const byId = {};
  nodes.forEach((n) => { byId[n.id] = n; });

  return (
    <div className="gv">
      <div className="gv-canvas" ref={wrap} style={{ height }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        role="group" aria-label={ariaLabel || "Dependency map"}>
        <svg width="100%" height="100%" aria-hidden="false">
          <defs>
            <marker id="gv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" className="gv-arrow" /></marker>
            <marker id="gv-arrow-rel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" className="gv-arrow rel" /></marker>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {geo.order && (groups || []).map((g, gi) => {
              const xs = nodes.filter((n) => n.group === g.id).map((n) => geo.pos[n.id]);
              if (!xs.length) return null;
              const x = xs[0].x, top = Math.min(...xs.map((p) => p.y)) - H / 2 - 30, bottom = Math.max(...xs.map((p) => p.y)) + H / 2 + 10;
              return (
                <g key={g.id} className="gv-col">
                  <rect x={x - W / 2 - 10} y={top} width={W + 20} height={bottom - top} rx={14} />
                  <text x={x} y={top + 19} textAnchor="middle">{g.label}</text>
                </g>
              );
            })}
            {edges.map((e, i) => {
              const a = geo.pos[e.from], b = geo.pos[e.to];
              if (!a || !b) return null;
              const rel = e.kind === "related";
              return (
                <motion.path key={e.from + ">" + e.to} d={edgePath(a, b)} className={"gv-edge" + (rel ? " rel" : "") + (e.kind === "order" ? " order" : "")}
                  markerEnd={rel ? "url(#gv-arrow-rel)" : "url(#gv-arrow)"}
                  initial={reduce ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: reduce ? 0 : DUR.scene, ease: EASE.travel, delay: reduce ? 0 : Math.min(0.6, 0.12 + i * 0.012) }}>
                  {e.label ? <title>{e.label}</title> : null}
                </motion.path>
              );
            })}
            {nodes.map((n, i) => {
              const p = geo.pos[n.id];
              if (!p) return null;
              const s = st(n.status), sel = selected === n.id;
              return (
                <motion.g key={n.id} className="gv-node" data-tone={s.tone} data-sel={sel ? "1" : undefined} data-cur={n.current ? "1" : undefined} data-skip={n.skipped ? "1" : undefined}
                  initial={reduce ? false : { opacity: 0, x: p.x, y: p.y + 10 }} animate={{ opacity: 1, x: p.x, y: p.y }}
                  transition={{ ...glide, opacity: { duration: reduce ? 0 : DUR.ui, delay: reduce ? 0 : Math.min(0.5, i * 0.025) } }}
                  tabIndex={0} role="button" aria-pressed={sel} aria-label={n.label + ", " + s.label + (n.current ? ", you are here" : "") + (n.skipped ? ", skipped" : "")}
                  onClick={() => onSelect && onSelect(n.id)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect && onSelect(n.id); } }}>
                  {n.current && <rect className="gv-here-ring" x={-W / 2 - 5} y={-H / 2 - 5} width={W + 10} height={H + 10} rx={14} />}
                  <rect className="gv-box" x={-W / 2} y={-H / 2} width={W} height={H} rx={10} />
                  <rect className="gv-band" x={-W / 2} y={-H / 2} width={5} height={H} rx={2} />
                  <foreignObject x={-W / 2 + 10} y={-H / 2 + 5} width={W - 16} height={H - 8}>
                    <div className="gv-text" xmlns="http://www.w3.org/1999/xhtml">
                      <span className="gv-label">{n.label}</span>
                      <span className="gv-sub">{n.status === "goal" ? <Flag size={11} weight="fill" aria-hidden="true" /> : null}{n.skipped ? "skipped · " : ""}{n.sub ? n.sub + " · " : ""}{s.label}</span>
                    </div>
                  </foreignObject>
                  {n.current && (
                    <g className="gv-here" transform={`translate(${-W / 2 + 12},${-H / 2 - 13})`}>
                      <rect x={-4} y={-9} width={86} height={18} rx={9} />
                      <text x={9} y={4}>You are here</text>
                    </g>
                  )}
                </motion.g>
              );
            })}
          </g>
        </svg>
        <div className="gv-tools">
          <button type="button" className="k-btn sm" onClick={() => zoomAt(1.2, ...center())} aria-label="Zoom in"><MagnifyingGlassPlus size={15} aria-hidden="true" /></button>
          <button type="button" className="k-btn sm" onClick={() => zoomAt(1 / 1.2, ...center())} aria-label="Zoom out"><MagnifyingGlassMinus size={15} aria-hidden="true" /></button>
          <button type="button" className="k-btn sm" onClick={fit} aria-label="Fit the whole map"><CornersOut size={15} aria-hidden="true" /></button>
        </div>
      </div>
      {legend && (present.length > 0 || kinds.length > 0) && (
        <ul className="gv-legend k-small" aria-label="Legend">
          {present.map((s) => <li key={s} data-tone={st(s).tone}><span className="gv-dot" aria-hidden="true" />{st(s).label}</li>)}
          {nodes.some((n) => n.current) && <li data-tone="here"><MapPin size={13} weight="fill" aria-hidden="true" />You are here</li>}
          {kinds.indexOf("requires") >= 0 && <li data-edge="requires"><span className="gv-line" aria-hidden="true" />needed first</li>}
          {kinds.indexOf("related") >= 0 && <li data-edge="related"><span className="gv-line rel" aria-hidden="true" />related (a relation in the study)</li>}
        </ul>
      )}
      <ul className="gv-sr">
        {nodes.map((n) => <li key={n.id}>{n.label}: {st(n.status).label}{n.current ? ", you are here" : ""}. Needs: {edges.filter((e) => e.to === n.id && e.kind !== "related").map((e) => (byId[e.from] || {}).label).filter(Boolean).join(", ") || "nothing on this map"}.</li>)}
      </ul>
    </div>
  );
}
