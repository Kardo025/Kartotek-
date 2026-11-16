// GraphView: a pan-and-zoom dependency graph drawn in SVG (task F3; the knowledge graph of task F6 uses it for hundreds of nodes).
// Foundations at the bottom, conclusions above them. Two layouts:
//  - "layers": any acyclic graph; a node's row is the length of its longest chain of "requires" edges (Sugiyama-style, with a few
//    barycentre sweeps to reduce crossings); a row longer than `maxRow` wraps onto extra rows.
//  - "columns": nodes grouped by `group` (a study's parts, or the studies), each group one column read from the bottom up.
// Props
//   nodes: [{ id, label, sub?, status, group?, current?, skipped?, small?, dim?, match? }]   (small = a "∧" implication node)
//   edges: [{ from, to, kind: "order" | "prereq" | "requires" | "related", label? }]   ("from" is needed before "to")
//   statuses: { <status>: { label, tone } }, selected (an id or a list of ids), onSelect(id, event), layout, groups: [{ id, label }],
//   height, ariaLabel, legend, maxRow
// Performance: panning and zooming change one transform attribute directly (no React render); the node and edge elements are memoised;
// above 140 nodes the view switches to a light drawing (SVG text instead of HTML labels, no per-node animation).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MagnifyingGlassPlus, MagnifyingGlassMinus, CornersOut, MapPin, Flag } from "@phosphor-icons/react";
import { EASE, DUR, SPRING } from "../motion.jsx";
import "./graph.css";

const W = 184, H = 58, GX = 36, GY = 46, SMALL = 22, LITE = 140;

// ------------------------------------------------------------------ layout
function layersLayout(nodes, edges, maxRow) {
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
  rows.forEach((r) => r && r.forEach((id, i) => { pos[id] = i - (r.length - 1) / 2; }));
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
  // wrap long rows; each layer takes as many lines as it needs
  const out = {}, cap = maxRow || 12;
  let line = 0;
  rows.forEach((r) => {
    if (!r) return;
    const lines = Math.ceil(r.length / cap);
    for (let k = 0; k < lines; k++) {
      const part = r.slice(k * cap, (k + 1) * cap);
      part.forEach((id, i) => { out[id] = { x: (i - (part.length - 1) / 2) * (W + GX), y: -(line + k) * (H + GY) }; });
    }
    line += lines;
  });
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

const half = (n) => (n && n.small ? SMALL / 2 : W / 2);
const halfH = (n) => (n && n.small ? SMALL / 2 : H / 2);
function edgePath(a, b, na, nb) {
  const dx = b.x - a.x;
  if (Math.abs(dx) > W * 0.9 && !(na && na.small) && !(nb && nb.small) && Math.abs(b.y - a.y) < H) {
    const sx = a.x + (dx > 0 ? half(na) : -half(na)), tx = b.x + (dx > 0 ? -half(nb) : half(nb)), m = (sx + tx) / 2;
    return `M${sx},${a.y} C${m},${a.y} ${m},${b.y} ${tx},${b.y}`;
  }
  const sy = a.y - halfH(na), ty = b.y + halfH(nb);
  if (ty > sy) {
    const x = Math.max(a.x, b.x) + W / 2 + 18;
    return `M${a.x + half(na)},${a.y} C${x},${a.y} ${x},${b.y} ${b.x + half(nb)},${b.y}`;
  }
  const m = (sy + ty) / 2;
  return `M${a.x},${sy} C${a.x},${m} ${b.x},${m} ${b.x},${ty}`;
}
const clipText = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// ------------------------------------------------------------------ the view
export default function GraphView({ nodes, edges, statuses, selected, onSelect, layout = "layers", groups, height = 420, ariaLabel, legend = true, maxRow }) {
  const reduce = useReducedMotion();
  const wrap = useRef(null), gRef = useRef(null), view = useRef({ k: 1, x: 0, y: 0 });
  const lite = nodes.length > LITE;
  const sel = useMemo(() => new Set(Array.isArray(selected) ? selected : selected ? [selected] : []), [selected]);
  const byId = useMemo(() => { const o = {}; nodes.forEach((n) => { o[n.id] = n; }); return o; }, [nodes]);
  const geo = useMemo(() => {
    if (layout === "columns") { const c = columnsLayout(nodes, groups); return { pos: c.pos, order: c.order }; }
    return { pos: layersLayout(nodes, edges, maxRow), order: null };
  }, [nodes, edges, layout, groups, maxRow]);
  const box = useMemo(() => {
    const ps = Object.values(geo.pos);
    if (!ps.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    return { x0: Math.min(...ps.map((p) => p.x)) - W / 2 - 30, x1: Math.max(...ps.map((p) => p.x)) + W / 2 + 30, y0: Math.min(...ps.map((p) => p.y)) - H / 2 - 44, y1: Math.max(...ps.map((p) => p.y)) + H / 2 + 30 };
  }, [geo]);
  const apply = () => { const v = view.current; if (gRef.current) gRef.current.setAttribute("transform", `translate(${v.x},${v.y}) scale(${v.k})`); };
  const fit = () => {
    const el = wrap.current;
    if (!el) return;
    const w = el.clientWidth || 800, h = el.clientHeight || height, bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const k = Math.max(lite ? 0.08 : 0.3, Math.min(1.15, Math.min(w / bw, h / bh)));
    view.current = { k, x: (w - bw * k) / 2 - box.x0 * k, y: (h - bh * k) / 2 - box.y0 * k };
    apply();
  };
  useEffect(() => { fit(); }, [box.x0, box.x1, box.y0, box.y1]);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let last = el.clientWidth;
    const ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - last) > 4) { last = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);
  // pan with the pointer, zoom with the wheel around the cursor: one attribute changes, nothing re-renders
  const drag = useRef(null);
  const onDown = (e) => { if (e.target.closest && e.target.closest(".gv-node")) return; drag.current = { x: e.clientX, y: e.clientY, v: { ...view.current } }; e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e) => { const g = drag.current; if (!g) return; view.current = { ...g.v, x: g.v.x + e.clientX - g.x, y: g.v.y + e.clientY - g.y }; apply(); };
  const onUp = () => { drag.current = null; };
  const zoomAt = (f, cx, cy) => { const v = view.current, k = Math.max(0.05, Math.min(2.5, v.k * f)), r = k / v.k; view.current = { k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r }; apply(); };
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const wheel = (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const center = () => { const el = wrap.current; return [(el ? el.clientWidth : 800) / 2, (el ? el.clientHeight : height) / 2]; };

  const st = (s) => (statuses && statuses[s]) || { label: s, tone: "open" };
  const present = Array.from(new Set(nodes.filter((n) => !n.small).map((n) => n.status))).filter((s) => statuses && statuses[s]);
  const kinds = Array.from(new Set(edges.map((e) => (e.kind === "related" ? "related" : "requires"))));
  const animate = !reduce && !lite;
  const glide = animate ? SPRING : { duration: 0 };

  const cols = useMemo(() => (geo.order ? (groups || []).map((g) => {
    const xs = nodes.filter((n) => n.group === g.id).map((n) => geo.pos[n.id]);
    if (!xs.length) return null;
    const x = xs[0].x, top = Math.min(...xs.map((p) => p.y)) - H / 2 - 30, bottom = Math.max(...xs.map((p) => p.y)) + H / 2 + 10;
    return <g key={g.id} className="gv-col"><rect x={x - W / 2 - 10} y={top} width={W + 20} height={bottom - top} rx={14} /><text x={x} y={top + 19} textAnchor="middle">{clipText(g.label, 26)}</text></g>;
  }) : null), [geo, groups, nodes]);
  const edgeEls = useMemo(() => edges.map((e, i) => {
    const a = geo.pos[e.from], b = geo.pos[e.to];
    if (!a || !b) return null;
    const rel = e.kind === "related", dim = (byId[e.from] || {}).dim && (byId[e.to] || {}).dim;
    const props = { d: edgePath(a, b, byId[e.from], byId[e.to]), className: "gv-edge" + (rel ? " rel" : "") + (e.kind === "order" ? " order" : "") + (dim ? " dim" : ""), markerEnd: rel ? "url(#gv-arrow-rel)" : "url(#gv-arrow)" };
    if (!animate) return <path key={e.from + ">" + e.to + i} {...props}>{e.label ? <title>{e.label}</title> : null}</path>;
    return (
      <motion.path key={e.from + ">" + e.to} {...props} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: DUR.scene, ease: EASE.travel, delay: Math.min(0.6, 0.12 + i * 0.012) }}>{e.label ? <title>{e.label}</title> : null}</motion.path>
    );
  }), [edges, geo, byId, animate]);
  const nodeEls = useMemo(() => nodes.map((n, i) => {
    const p = geo.pos[n.id];
    if (!p) return null;
    const s = st(n.status), isSel = sel.has(n.id);
    const common = {
      className: "gv-node" + (n.small ? " small" : ""), "data-tone": s.tone, "data-sel": isSel ? "1" : undefined, "data-cur": n.current ? "1" : undefined, "data-skip": n.skipped ? "1" : undefined,
      "data-dim": n.dim ? "1" : undefined, "data-match": n.match ? "1" : undefined, tabIndex: n.small ? -1 : 0, role: n.small ? undefined : "button",
      "aria-pressed": n.small ? undefined : isSel, "aria-label": n.small ? undefined : n.label + ", " + s.label + (n.current ? ", you are here" : "") + (n.skipped ? ", skipped" : ""),
      onClick: n.small ? undefined : (ev) => onSelect && onSelect(n.id, ev),
      onKeyDown: n.small ? undefined : (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect && onSelect(n.id, ev); } },
    };
    const body = n.small ? (
      <><circle className="gv-and" r={SMALL / 2} /><text className="gv-and-t" y={4} textAnchor="middle">∧</text>{n.chain && n.chain.text ? <title>{n.chain.text}</title> : null}</>
    ) : (
      <>
        {n.current && <rect className="gv-here-ring" x={-W / 2 - 5} y={-H / 2 - 5} width={W + 10} height={H + 10} rx={14} />}
        <rect className="gv-box" x={-W / 2} y={-H / 2} width={W} height={H} rx={10} />
        <rect className="gv-band" x={-W / 2} y={-H / 2} width={5} height={H} rx={2} />
        {lite ? (
          <>
            <text className="gv-lt" x={-W / 2 + 12} y={-4}>{clipText(n.label, 26)}</text>
            <text className="gv-ls" x={-W / 2 + 12} y={14}>{clipText((n.skipped ? "skipped · " : "") + (n.sub ? n.sub + " · " : "") + s.label, 32)}</text>
            <title>{n.label}</title>
          </>
        ) : (
          <foreignObject x={-W / 2 + 10} y={-H / 2 + 5} width={W - 16} height={H - 8}>
            <div className="gv-text" xmlns="http://www.w3.org/1999/xhtml">
              <span className="gv-label">{n.label}</span>
              <span className="gv-sub">{n.status === "goal" ? <Flag size={11} weight="fill" aria-hidden="true" /> : null}{n.skipped ? "skipped · " : ""}{n.sub ? n.sub + " · " : ""}{s.label}</span>
            </div>
          </foreignObject>
        )}
        {n.current && (
          <g className="gv-here" transform={`translate(${-W / 2 + 12},${-H / 2 - 13})`}><rect x={-4} y={-9} width={86} height={18} rx={9} /><text x={9} y={4}>You are here</text></g>
        )}
      </>
    );
    if (!animate) return <g key={n.id} transform={`translate(${p.x},${p.y})`} {...common}>{body}</g>;
    return (
      <motion.g key={n.id} {...common} initial={{ opacity: 0, x: p.x, y: p.y + 10 }} animate={{ opacity: 1, x: p.x, y: p.y }}
        transition={{ ...glide, opacity: { duration: DUR.ui, delay: Math.min(0.5, i * 0.025) } }}>{body}</motion.g>
    );
  }), [nodes, geo, sel, statuses, animate, lite, onSelect]);

  return (
    <div className="gv">
      <div className="gv-canvas" ref={wrap} style={{ height }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        role="group" aria-label={ariaLabel || "Dependency map"} data-lite={lite ? "1" : undefined}>
        <svg width="100%" height="100%">
          <defs>
            <marker id="gv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" className="gv-arrow" /></marker>
            <marker id="gv-arrow-rel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" className="gv-arrow rel" /></marker>
          </defs>
          <g ref={gRef}>
            {cols}
            {edgeEls}
            {nodeEls}
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
          {nodes.some((n) => n.small) && <li><span className="gv-and-key" aria-hidden="true">∧</span>premises that together give the idea above</li>}
          {kinds.indexOf("related") >= 0 && <li data-edge="related"><span className="gv-line rel" aria-hidden="true" />related</li>}
        </ul>
      )}
      {!lite && (
        <ul className="gv-sr">
          {nodes.filter((n) => !n.small).map((n) => <li key={n.id}>{n.label}: {st(n.status).label}{n.current ? ", you are here" : ""}. Needs: {edges.filter((e) => e.to === n.id && e.kind !== "related").map((e) => (byId[e.from] || {}).label).filter(Boolean).join(", ") || "nothing on this map"}.</li>)}
        </ul>
      )}
    </div>
  );
}
