// Reading: the photos with the regions Claude Code read, the questions it asked, and perception corrections.
// Corrections change what Kartotek thinks you wrote. They are never learning events and never touch reviews.
import React, { useMemo, useState } from "react";
import { MagnifyingGlassPlus, MagnifyingGlassMinus, ArrowsOut, Question, Eye, ArrowCounterClockwise, Check, ImageSquare } from "@phosphor-icons/react";
import { Panel, Btn, Seg, Tag, Lvl } from "../kit.jsx";
import { Md } from "../study/common.jsx";
import {
  App, KM, save, viewSrc, setLocalPhoto, obsText, OBS_KIND, VER_LABEL, OBJ_KIND, STATUS_LABEL, DIR_LABEL,
  regionsOf, viewOf, viewName, conceptOfObs, norm, when,
} from "./util.js";
import { Crop, Empty } from "./parts.jsx";

export default function Reading({ doc, parse, sel, setSel }) {
  const views = (parse.views || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const [viewId, setViewId] = useState(views[0] && views[0].id);
  const [zoom, setZoom] = useState(1);
  const [filter, setFilter] = useState("look");
  const eff = KM().effective(parse, doc);
  const rep = KM().scopeReport(parse, doc);
  const qs = rep.questions;
  const view = viewOf(parse, viewId) || views[0];

  // Selecting something elsewhere (a question, a mark in the list) switches to a view that shows it
  const pick = (s) => {
    setSel(s);
    if (s && s.region) {
      const r = (parse.regions || []).find((x) => x.id === s.region);
      if (r && r.view !== viewId) setViewId(r.view);
    } else if (s && s.area != null) {
      const u = ((parse.scope || {}).unreviewed || [])[s.area];
      if (u && u.view && u.view !== viewId) setViewId(u.view);
    } else if (s && s.view) setViewId(s.view);
  };

  return (
    <div className="mm-reading">
      <div className="mm-reading-main">
        <Panel className="mm-viewer-panel">
          <div className="mm-viewer-bar">
            <Seg label="Photo" value={view && view.id} onChange={(v) => { setViewId(v); }}
              options={views.map((v) => ({ value: v.id, label: viewName(v) }))} />
            <div className="mm-viewer-tools">
              <label className="mm-filter">
                <span className="k-sr">Boxes</span>
                <select className="k-input sm" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Which boxes to show">
                  <option value="look">Boxes: needs a look</option>
                  <option value="all">Boxes: every mark</option>
                  <option value="none">Boxes: hidden</option>
                </select>
              </label>
              <button type="button" className="k-btn sm" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Zoom out" disabled={zoom <= 1}><MagnifyingGlassMinus size={16} /></button>
              <span className="mm-zoom k-num">{Math.round(zoom * 100)}%</span>
              <button type="button" className="k-btn sm" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Zoom in" disabled={zoom >= 4}><MagnifyingGlassPlus size={16} /></button>
              <button type="button" className="k-btn sm" onClick={() => setZoom(1)} aria-label="Fit to width"><ArrowsOut size={16} /></button>
            </div>
          </div>
          {view ? <Viewer doc={doc} parse={parse} view={view} eff={eff} rep={rep} zoom={zoom} filter={filter} sel={sel} pick={pick} /> : <Empty title="No photos in this reading" />}
          {view && view.quality && (view.quality.issues || []).length > 0 && (
            <ul className="mm-issues">
              {view.quality.issues.map((q, i) => <li key={i}><Tag>{q.kind.replace("_", " ")}</Tag> {q.note}</li>)}
            </ul>
          )}
        </Panel>
        <Objects parse={parse} eff={eff} doc={doc} pick={pick} sel={sel} />
        <MarkList parse={parse} eff={eff} view={view} rep={rep} pick={pick} sel={sel} />
      </div>
      <aside className="mm-reading-side">
        {sel && sel.obs ? <MarkPanel key={sel.obs} doc={doc} parse={parse} eff={eff} o={eff[sel.obs]} pick={pick} close={() => setSel(null)} />
          : sel && sel.object ? <ObjectPanel doc={doc} parse={parse} eff={eff} ob={(parse.objects || []).find((x) => x.id === sel.object)} pick={pick} close={() => setSel(null)} /> : null}
        <Questions doc={doc} parse={parse} eff={eff} qs={qs} pick={pick} sel={sel} />
        <ReportPanel parse={parse} rep={rep} doc={doc} pick={pick} />
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------ the photo with region boxes
function Viewer({ doc, parse, view, eff, rep, zoom, filter, sel, pick }) {
  const [broken, setBroken] = useState(false);
  const regions = (parse.regions || []).filter((r) => r.view === view.id);
  const index = useMemo(() => {
    const o = {}, ob = {};
    (parse.observations || []).forEach((x) => (x.regions || []).forEach((r) => { (o[r] = o[r] || []).push(x.id); }));
    (parse.objects || []).forEach((x) => (x.regions || []).forEach((r) => { (ob[r] = ob[r] || []).push(x.id); }));
    return { o, ob };
  }, [parse]);
  const qObs = {};
  rep.questions.forEach((q) => (q.about || []).forEach((id) => { qObs[id] = true; }));
  const unsure = {};
  rep.unsure.forEach((id) => { unsure[id] = true; });
  const stOf = (rid) => {
    const ids = index.o[rid] || [];
    if (sel && ((sel.obs && ids.indexOf(sel.obs) >= 0) || sel.region === rid || (sel.object && (index.ob[rid] || []).indexOf(sel.object) >= 0))) return "sel";
    if (ids.some((id) => qObs[id])) return "q";
    if (ids.some((id) => eff[id] && eff[id].left_unresolved)) return "left";
    if (ids.some((id) => eff[id] && eff[id].verification === "learner_corrected")) return "fixed";
    if (ids.some((id) => eff[id] && eff[id].verification === "learner_confirmed")) return "ok2";
    if (ids.some((id) => unsure[id])) return "unsure";
    return (index.ob[rid] || []).length && !ids.length ? "obj" : "ok";
  };
  const shown = regions.filter((r) => {
    if (filter === "none") return stOf(r.id) === "sel";
    if (filter === "all") return true;
    const s = stOf(r.id);
    return s === "sel" || s === "q" || s === "unsure" || s === "left";
  });
  const unrev = (rep.unreviewed || []).map((u, i) => ({ ...u, i })).filter((u) => u.view === view.id && u.box);
  // Where the close-ups sit on this photo (views[].covers), so the overview shows what was read in detail
  const covers = (parse.views || []).filter((v) => v.covers && v.covers.view === view.id && v.covers.box);
  const onRegion = (r) => {
    const ids = index.o[r.id] || [];
    if (ids.length) pick({ obs: ids.find((id) => qObs[id]) || ids[0], region: r.id });
    else if ((index.ob[r.id] || []).length) pick({ object: index.ob[r.id][0], region: r.id });
  };
  return (
    <div className="mm-stage-wrap">
      <div className="mm-stage" style={{ width: zoom * 100 + "%", aspectRatio: view.width && view.height ? view.width + " / " + view.height : undefined }}>
        {!broken ? (
          <img src={viewSrc(doc, view)} alt={"Photo " + viewName(view) + " of the handwritten map"} onError={() => setBroken(true)} draggable={false} />
        ) : (
          <div className="mm-missing">
            <ImageSquare size={28} aria-hidden="true" />
            <p>Kartotek looks for <code>mindmaps\{doc.map_id}\{String(view.file).replace(/\//g, "\\")}</code> next to Kartotek-DSR.html and cannot find it.</p>
            <label className="k-btn sm">
              Choose the photo for this session
              <input type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files[0]) { setLocalPhoto(doc.map_id, view.id, e.target.files[0]); setBroken(false); } }} />
            </label>
          </div>
        )}
        <svg className="mm-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          {unrev.map((u) => (
            <rect key={"u" + u.i} className="mm-unrev" data-sel={sel && (sel.area === u.i || (sel.areas || []).indexOf(u.i) >= 0) ? "1" : undefined} x={u.box[0]} y={u.box[1]} width={u.box[2]} height={u.box[3]} vectorEffect="non-scaling-stroke"><title>{"Not reviewed: " + u.reason}</title></rect>
          ))}
          {covers.map((v) => (
            <rect key={"c" + v.id} className="mm-cover" x={v.covers.box[0]} y={v.covers.box[1]} width={v.covers.box[2]} height={v.covers.box[3]} vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "all" }} onClick={() => pick({ view: v.id })}><title>{"Close-up " + viewName(v)}</title></rect>
          ))}
          {shown.map((r) => (
            <rect key={r.id} className="mm-reg" data-st={stOf(r.id)} x={r.box[0]} y={r.box[1]} width={r.box[2]} height={r.box[3]}
              vectorEffect="non-scaling-stroke" onClick={() => onRegion(r)} style={{ pointerEvents: "all" }}>
              <title>{(index.o[r.id] || []).map((id) => obsText(eff[id]) || OBS_KIND[eff[id] && eff[id].kind]).join(" · ") || r.id}</title>
            </rect>
          ))}
        </svg>
        {covers.map((v) => (
          <button type="button" key={"cl" + v.id} className="mm-cover-label" style={{ left: v.covers.box[0] * 100 + "%", top: v.covers.box[1] * 100 + "%" }} onClick={() => pick({ view: v.id })}>
            {viewName(v)}
          </button>
        ))}
      </div>
      <div className="mm-legend" aria-hidden="true">
        <span data-st="q">Question</span><span data-st="unsure">Unsure</span><span data-st="fixed">You corrected</span>
        <span data-st="ok2">You confirmed</span><span data-st="left">Left unresolved</span><span data-st="unrev">Not reviewed</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ keyboard / text access to every mark of a view
function MarkList({ parse, eff, view, rep, pick, sel }) {
  const [open, setOpen] = useState(false);
  if (!view) return null;
  const regs = {};
  (parse.regions || []).forEach((r) => { if (r.view === view.id) regs[r.id] = true; });
  const marks = (parse.observations || []).filter((o) => (o.regions || []).some((r) => regs[r]));
  const unsure = {};
  rep.unsure.forEach((id) => { unsure[id] = true; });
  return (
    <Panel title={"Marks in " + viewName(view) + " (" + marks.length + ")"} actions={<Btn size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide list" : "Show list"}</Btn>}>
      <p className="mm-hint">The same marks as the boxes, as a list you can use with the keyboard.</p>
      {open && (
        <ul className="mm-marks">
          {marks.map((o) => {
            const e = eff[o.id];
            const rid = (o.regions || []).find((r) => regs[r]);
            return (
              <li key={o.id}>
                <button type="button" aria-current={sel && sel.obs === o.id ? "true" : undefined} onClick={() => pick({ obs: o.id, region: rid })}>
                  <Tag>{OBS_KIND[o.kind] || o.kind}</Tag>
                  <span className="mm-marks-t">{obsText(e) || (o.kind === "line" ? lineText(eff, e) : o.id)}</span>
                  {unsure[o.id] && <Lvl level="warn">unsure</Lvl>}
                  {e.verification && e.verification.indexOf("learner") === 0 && <Lvl level="ok">{VER_LABEL[e.verification]}</Lvl>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
function lineText(eff, o) {
  const a = (o.from || []).map((id) => obsText(eff[id]) || id).join(" / ") || "?";
  const b = (o.to || []).map((id) => obsText(eff[id]) || id).join(" / ") || (o.exits_view ? "(leaves the photo)" : "?");
  return a + " " + (o.direction === "forward" ? "→" : o.direction === "bidirectional" ? "↔" : o.direction === "none" ? "—" : "?") + " " + b;
}

// ------------------------------------------------------------------ one mark: what was read, close-ups, corrections
function MarkPanel({ doc, parse, eff, o, pick, close }) {
  const [text, setText] = useState(o ? o.normalized || o.raw || "" : "");
  const [note, setNote] = useState("");
  if (!o) return null;
  const map = KM().currentMap(doc);
  const items = KM().itemsOfObs(map, o.id);
  const regs = regionsOf(parse, o);
  const corr = (doc.corrections || []).filter((c) => (c.obs || []).indexOf(o.id) >= 0);
  const textObs = (parse.observations || []).filter((x) => x.kind === "text" || x.kind === "node");
  const rel = items.relations[0];

  const correct = (c, msg) => {
    const r = KM().addCorrection(doc, parse, Object.assign({ obs: [o.id], note: note.trim() || undefined }, c), Date.now());
    save(doc.map_id);
    setNote("");
    App().toast((msg || "Saved") + (r.version ? " · map v" + r.version : "") + ". Not a learning event.");
  };
  const setDirection = (d) => {
    const after = {}, relSet = {};
    if (d === "reverse") { after.direction = "forward"; after.from = o.to; after.to = o.from; relSet.direction = "forward"; if (rel) { relSet.from = rel.to; relSet.to = rel.from; } }
    else { after.direction = d; relSet.direction = d === "none" ? "undirected" : d; }
    correct({ kind: "direction", after, relation: rel ? rel.id : undefined, relSet: rel ? relSet : undefined }, "Direction saved");
  };
  const setEnd = (side, id) => {
    const after = {}, relSet = {};
    after[side] = id ? [id] : [];
    const k = id && conceptOfObs(map, id);
    if (rel && k) relSet[side] = k;
    correct({ kind: "endpoints", after, relation: rel && k ? rel.id : undefined, relSet: rel && k ? relSet : undefined }, "End point saved");
  };

  return (
    <Panel className="mm-mark" title={(OBS_KIND[o.kind] || o.kind) + " · " + o.id} actions={<button type="button" className="k-btn sm ghost" onClick={close}>Close</button>}>
      <div className="mm-mark-tags">
        <Lvl level={o.verification === "unresolved" ? "warn" : o.verification && o.verification.indexOf("learner") === 0 ? "ok" : "mid"}>{VER_LABEL[o.verification] || o.verification}</Lvl>
        {o.text_role && <Tag>{o.text_role}</Tag>}
        {o.style && o.style.ink && <span className="k-tag" title="Recorded as a visual attribute only. Your colors have no fixed meaning.">ink: {o.style.ink}</span>}
        {o.style && o.style.marks && <Tag>{o.style.marks}</Tag>}
        {o.exits_view && <Tag>leaves the photo</Tag>}
      </div>
      <div className="mm-crops">
        {regs.map((r) => {
          const v = viewOf(parse, r.view);
          return v ? (
            <button type="button" key={r.id} className="mm-crop-btn" onClick={() => pick({ obs: o.id, region: r.id })} title="Show on the photo">
              <Crop src={viewSrc(doc, v)} box={r.box} vw={v.width} vh={v.height} label={"Seen in " + viewName(v)} maxH={160} />
            </button>
          ) : null;
        })}
      </div>
      {(o.kind === "text" || o.kind === "node" || o.kind === "symbol") && (
        <dl className="mm-dl">
          <dt>Read as</dt><dd className="mm-read">{o.raw == null ? <i>nothing readable</i> : "“" + o.raw + "”"}</dd>
          {o.normalized && o.normalized !== o.raw && (<><dt>Term</dt><dd>{o.normalized}</dd></>)}
          {(o.candidates || []).length > 0 && (<><dt>Could also be</dt><dd className="mm-cands">{o.candidates.map((c) => (
            <button key={c} type="button" className="k-btn sm" onClick={() => correct({ kind: "text", after: { raw: c } }, "Reading corrected")}>{c}</button>
          ))}</dd></>)}
        </dl>
      )}
      {o.kind === "line" && (
        <dl className="mm-dl">
          <dt>Runs</dt><dd>{lineText(eff, o)}</dd>
          {o.junction != null && (<><dt>Crossing</dt><dd>{o.junction ? "joins here" : "only crosses"}</dd></>)}
        </dl>
      )}
      {(o.uncertainty || []).length > 0 && (
        <ul className="mm-unc">
          {o.uncertainty.map((u, i) => <li key={i}><Lvl level={u.impact === "blocking" ? "bad" : "warn"}>{u.dim}{u.impact === "blocking" ? " · blocks feedback" : ""}</Lvl> {u.reason}</li>)}
        </ul>
      )}
      {(items.concepts.length > 0 || items.relations.length > 0 || items.groups.length > 0) && (
        <p className="mm-used">Used in your map: {[].concat(
          items.concepts.map((k) => "idea “" + k.label + "”"),
          items.relations.map((r) => "connection " + KM().relationText(map, r)),
          items.groups.map((g) => "group “" + g.label + "”")).join(" · ")}</p>
      )}

      <div className="mm-fix">
        <b className="mm-fix-h">Correct the reading</b>
        {(o.kind === "text" || o.kind === "node" || o.kind === "symbol") && (
          <form className="mm-inline" onSubmit={(e) => { e.preventDefault(); if (text.trim()) correct({ kind: "text", after: { raw: text.trim() } }, "Reading corrected"); }}>
            <label className="k-sr" htmlFor={"mm-t-" + o.id}>It says</label>
            <input id={"mm-t-" + o.id} className="k-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="What it actually says" />
            <Btn size="sm" kind="primary" type="submit">Save</Btn>
          </form>
        )}
        {o.kind === "text" && (
          <label className="mm-inline">
            <span>It is</span>
            <select className="k-input" value={o.text_role || "unknown"} onChange={(e) => correct({ kind: "role", after: { text_role: e.target.value } }, "Role saved")}>
              {["concept", "heading", "question", "answer", "annotation", "example", "label", "unknown"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        )}
        {o.kind === "line" && (
          <>
            <div className="mm-btnrow" role="group" aria-label="Direction of this line">
              <Btn size="sm" onClick={() => setDirection("forward")}>As read →</Btn>
              <Btn size="sm" onClick={() => setDirection("reverse")}>Other way ←</Btn>
              <Btn size="sm" onClick={() => setDirection("bidirectional")}>Both ways ↔</Btn>
              <Btn size="sm" onClick={() => setDirection("none")}>No arrowhead</Btn>
              <Btn size="sm" onClick={() => setDirection("unknown")}>Can't tell</Btn>
            </div>
            <div className="mm-ends">
              {["from", "to"].map((side) => (
                <label key={side} className="mm-inline">
                  <span>{side === "from" ? "Starts at" : "Ends at"}</span>
                  <select className="k-input" value={(o[side] || [])[0] || ""} onChange={(e) => setEnd(side, e.target.value)}>
                    <option value="">(nothing / outside the photo)</option>
                    {textObs.map((x) => <option key={x.id} value={x.id}>{obsText(eff[x.id]) || x.id}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </>
        )}
        {(o.kind === "junction" || (o.kind === "line" && (o.uncertainty || []).some((u) => u.dim === "junction"))) && (
          <div className="mm-btnrow" role="group" aria-label="Crossing">
            <Btn size="sm" onClick={() => correct({ kind: "junction", after: { junction: true } }, "Saved")}>The lines join here</Btn>
            <Btn size="sm" onClick={() => correct({ kind: "junction", after: { junction: false } }, "Saved")}>They only cross</Btn>
          </div>
        )}
        {o.kind === "possible_deletion" && (
          <div className="mm-btnrow" role="group" aria-label="Crossed out">
            <Btn size="sm" onClick={() => correct({ kind: "deletion", after: { deleted: true } }, "Saved")}>Crossed out, ignore it</Btn>
            <Btn size="sm" onClick={() => correct({ kind: "deletion", after: { deleted: false } }, "Saved")}>Not crossed out</Btn>
          </div>
        )}
        <label className="mm-note">
          <span>Note for Claude (optional)</span>
          <input className="k-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. the black text is my answer to the red question" />
        </label>
        <div className="mm-btnrow">
          <Btn size="sm" onClick={() => correct({ kind: "confirm" }, "Confirmed")}><Check size={14} aria-hidden="true" /> The reading is right</Btn>
          <Btn size="sm" onClick={() => correct({ kind: "unresolved" }, "Left unresolved")}>Leave unresolved</Btn>
        </div>
      </div>
      {corr.length > 0 && (
        <div className="mm-corr">
          <b>Your corrections here</b>
          <ul>
            {corr.map((c) => (
              <li key={c.id} data-stale={c.stale ? "1" : undefined}>
                <span>{c.kind}{c.after && c.after.raw ? ": “" + c.after.raw + "”" : ""}{c.after && c.after.direction ? ": " + c.after.direction : ""}{c.note ? " — " + c.note : ""}</span>
                <span className="mm-muted">{when(c.at)}{c.stale ? " · " + (c.stale_reason || "withdrawn") : ""}</span>
                {!c.stale && <button type="button" className="k-btn sm ghost" onClick={() => { KM().undoCorrection(doc, c.id, Date.now()); save(doc.map_id); }} title="Withdraw this correction"><ArrowCounterClockwise size={14} aria-hidden="true" /> Withdraw</button>}
              </li>
            ))}
          </ul>
          <p className="mm-hint">Withdrawing keeps the map as it is; use the Map tab's history to restore an earlier version.</p>
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ questions from the reading
function Questions({ doc, parse, eff, qs, pick, sel }) {
  const [other, setOther] = useState({});
  if (!qs.length) {
    return (
      <Panel title="Questions">
        <p className="mm-hint">No open questions about the reading.</p>
      </Panel>
    );
  }
  const answer = (q, opt) => {
    const o = eff[(q.about || [])[0]];
    const map = KM().currentMap(doc);
    let c = { kind: "answer", obs: q.about || [], question_id: q.id, note: opt };
    if (q.kind === "text" && o) c = { kind: "text", obs: [o.id], question_id: q.id, after: { raw: opt } };
    else if (q.kind === "direction" && o && o.kind === "line") {
      const rel = KM().itemsOfObs(map, o.id).relations[0];
      const fromL = norm(obsText(eff[(o.from || [])[0]])), toL = norm(obsText(eff[(o.to || [])[0]]));
      const parts = String(opt).split(/→|->/).map(norm);
      if (/no arrow/i.test(opt)) c = { kind: "direction", obs: [o.id], question_id: q.id, note: opt, after: { direction: "none" }, relation: rel && rel.id, relSet: rel && { direction: "undirected" } };
      else if (parts.length === 2 && fromL && toL && parts[0] && fromL.indexOf(parts[0]) === 0 && toL.indexOf(parts[1]) === 0) c = { kind: "direction", obs: [o.id], question_id: q.id, note: opt, after: { direction: "forward" }, relation: rel && rel.id, relSet: rel && { direction: "forward" } };
      else if (parts.length === 2 && fromL && toL && parts[0] && toL.indexOf(parts[0]) === 0 && fromL.indexOf(parts[1]) === 0) c = { kind: "direction", obs: [o.id], question_id: q.id, note: opt, after: { direction: "forward", from: o.to, to: o.from }, relation: rel && rel.id, relSet: rel && { direction: "forward", from: rel.to, to: rel.from } };
    } else if (q.kind === "junction") {
      if (/join|connect|bağlan/i.test(opt)) c = { kind: "junction", obs: q.about || [], question_id: q.id, note: opt, after: { junction: true } };
      else if (/cross|kesiş/i.test(opt)) c = { kind: "junction", obs: q.about || [], question_id: q.id, note: opt, after: { junction: false } };
    }
    if (c.relation == null) { delete c.relation; delete c.relSet; }
    const r = KM().addCorrection(doc, parse, c, Date.now());
    save(doc.map_id);
    App().toast("Answer saved" + (r.version ? " · map v" + r.version : "") + ". Not a learning event.");
  };
  const unresolved = (q) => { KM().addCorrection(doc, parse, { kind: "unresolved", obs: q.about || [], question_id: q.id }, Date.now()); save(doc.map_id); };
  return (
    <Panel title={"Questions (" + qs.length + ")"}>
      <p className="mm-hint">Claude Code asks only where an answer changes the feedback. Answering is about what you wrote, not whether it is right.</p>
      <ol className="mm-qs">
        {qs.map((q) => (
          <li key={q.id} data-active={sel && sel.q === q.id ? "1" : undefined}>
            <div className="mm-q-head">
              <Question size={16} aria-hidden="true" />
              <span>{q.text}</span>
            </div>
            <div className="mm-q-meta">
              {q.impact === "blocking" ? <Lvl level="bad">blocks feedback</Lvl> : <Lvl level="mid">local</Lvl>}
              <Tag>{q.kind}</Tag>
              {(q.region || q.area != null || (q.areas || []).length > 0) && <button type="button" className="k-btn sm ghost" onClick={() => pick(q.region ? { obs: (q.about || [])[0], region: q.region, q: q.id } : { area: q.area != null ? q.area : q.areas[0], areas: q.areas || [q.area], q: q.id })}><Eye size={14} aria-hidden="true" /> Show</button>}
            </div>
            {q.why && <p className="mm-q-why">{q.why}</p>}
            <div className="mm-btnrow">
              {(q.options || []).map((opt) => <Btn key={opt} size="sm" onClick={() => answer(q, opt)}>{opt}</Btn>)}
            </div>
            <form className="mm-inline" onSubmit={(e) => { e.preventDefault(); const t = (other[q.id] || "").trim(); if (t) { answer(q, t); setOther({ ...other, [q.id]: "" }); } }}>
              <label className="k-sr" htmlFor={"mm-q-" + q.id}>Another answer</label>
              <input id={"mm-q-" + q.id} className="k-input" placeholder="Another answer" value={other[q.id] || ""} onChange={(e) => setOther({ ...other, [q.id]: e.target.value })} />
              <Btn size="sm" type="submit">Answer</Btn>
              <Btn size="sm" kind="ghost" onClick={() => unresolved(q)}>Leave unresolved</Btn>
            </form>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// ------------------------------------------------------------------ reading status (Claude Code's report + scope)
function ReportPanel({ parse, rep, doc, pick }) {
  return (
    <Panel title="Reading status">
      <div className="mm-mark-tags">
        <Lvl level={rep.status === "ready_for_requested_scope" ? "ok" : rep.status === "needs_better_input" ? "bad" : "warn"}>{STATUS_LABEL[rep.status] || rep.status}</Lvl>
        {rep.possible_unseen && <Tag>part of the page may be missing</Tag>}
        <Tag>reading {parse.parse_rev} · {when(parse.parsed_at)}</Tag>
      </div>
      <div className="mm-kv">
        <span><b className="k-num">{rep.marks}</b> marks</span>
        <span><b className="k-num">{rep.unsure.length}</b> unsure</span>
        <span><b className="k-num">{rep.blocking.length}</b> block feedback</span>
        <span><b className="k-num">{rep.corrected.length + rep.confirmed.length}</b> checked by you</span>
      </div>
      {parse.report && <Md src={parse.report} className="mm-report" />}
      {rep.unreviewed.length > 0 && (
        <>
          <b className="mm-sub">Not reviewed</b>
          <ul className="mm-plain">{rep.unreviewed.map((u, i) => <li key={i}>{u.view}: {u.reason}</li>)}</ul>
        </>
      )}
      {(parse.handwriting || []).length > 0 && (
        <>
          <b className="mm-sub">About your handwriting</b>
          <ul className="mm-hw">
            {parse.handwriting.map((h) => {
              const c = (doc.conventions || []).find((x) => x.id === h.id);
              const set = (a) => { KM().setConvention(doc, h, a, Date.now()); save(doc.map_id); };
              return (
                <li key={h.id}>
                  <span>{h.text}</span>
                  {c ? <Lvl level={c.answer === "yes" ? "ok" : "mid"}>{c.answer === "yes" ? "You said: right" : "You said: not right"}</Lvl> : null}
                  <span className="mm-row-btns">
                    <button type="button" className="k-btn sm" aria-pressed={c && c.answer === "yes"} onClick={() => set("yes")}>Right</button>
                    <button type="button" className="k-btn sm" aria-pressed={c && c.answer === "no"} onClick={() => set("no")}>Not right</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {rep.withheld.length > 0 && (
        <>
          <b className="mm-sub">Not judged</b>
          <ul className="mm-plain">{rep.withheld.map((w, i) => <li key={i}>{(KM().DIM_LABEL[w.dimension] || w.dimension)}: {w.reason}</li>)}</ul>
        </>
      )}
      <p className="mm-hint">No grade is given for a reading. Unreadable handwriting is never counted as weak knowledge.</p>
    </Panel>
  );
}

// ------------------------------------------------------------------ typed visual objects (tables, charts, schematics…)
function Objects({ parse, eff, doc, pick, sel }) {
  const list = parse.objects || [];
  if (!list.length) return null;
  return (
    <Panel title={"Tables, charts and other drawings (" + list.length + ")"}>
      <p className="mm-hint">Kept as what they are. Table rules, chart curves and wires are not connections between ideas.</p>
      <div className="mm-objs">
        {list.map((ob) => (
          <button type="button" key={ob.id} className="mm-obj" aria-current={sel && sel.object === ob.id ? "true" : undefined}
            onClick={() => pick({ object: ob.id, region: (ob.regions || [])[0] })}>
            <Tag tone="accent">{OBJ_KIND[ob.kind] || ob.kind}</Tag>
            <span className="mm-obj-t">{ob.title || ob.id}</span>
            <span className="mm-muted">{ob.status.replace("_", " ")}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function axis(a) {
  if (!a) return "?";
  if (typeof a === "string") return a;
  return [a.label, a.low != null || a.high != null ? (a.low || "?") + " ↔ " + (a.high || "?") : null].filter(Boolean).join(": ") || "?";
}

function ObjectPanel({ doc, parse, eff, ob, pick, close }) {
  if (!ob) return null;
  const p = ob.payload || {};
  const regs = (ob.regions || []).map((id) => (parse.regions || []).find((r) => r.id === id)).filter(Boolean);
  const mark = (note) => {
    KM().addCorrection(doc, parse, { kind: "answer", obs: ob.observations && ob.observations.length ? [ob.observations[0]] : [], note: note, object: ob.id }, Date.now());
    save(doc.map_id);
    App().toast("Saved. Not a learning event.");
  };
  return (
    <Panel className="mm-mark" title={(OBJ_KIND[ob.kind] || ob.kind) + " · " + (ob.title || ob.id)} actions={<button type="button" className="k-btn sm ghost" onClick={close}>Close</button>}>
      <div className="mm-crops">
        {regs.map((r) => {
          const v = viewOf(parse, r.view);
          return v ? <Crop key={r.id} src={viewSrc(doc, v)} box={r.box} vw={v.width} vh={v.height} ctx={0.08} label={"In " + viewName(v)} maxH={220} /> : null;
        })}
      </div>
      {ob.kind === "table" && (
        <div className="k-table-wrap">
          <table className="k-table mm-tbl">
            {p.columns && <thead><tr>{p.columns.map((c, i) => <th key={i}>{c == null ? "?" : c}</th>)}</tr></thead>}
            <tbody>
              {(p.rows || []).map((row, i) => (
                <tr key={i}>{row.map((cell, j) => {
                  const u = (p.uncertain_cells || []).some((x) => x[0] === i && x[1] === j);
                  return <td key={j} data-u={u ? "1" : undefined}>{cell == null ? "?" : String(cell)}</td>;
                })}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ob.kind === "chart" && (
        <dl className="mm-dl">
          <dt>x axis</dt><dd>{(p.x_axis && p.x_axis.label) || "?"}{p.x_axis && p.x_axis.ticks ? " · " + p.x_axis.ticks.join(", ") : ""}</dd>
          <dt>y axis</dt><dd>{(p.y_axis && p.y_axis.label) || "?"}{p.y_axis && p.y_axis.scale ? " · " + p.y_axis.scale : ""}{p.y_axis && p.y_axis.ticks ? " · " + p.y_axis.ticks.join(", ") : ""}</dd>
          <dt>Curves</dt><dd>{(p.series || []).map((s) => (s.label || "unlabeled") + (s.shape ? " (" + s.shape + ")" : "")).join(" · ") || "?"}</dd>
          {(p.annotations || []).length > 0 && (<><dt>Notes</dt><dd>{p.annotations.join(" · ")}</dd></>)}
        </dl>
      )}
      {ob.kind === "schematic" && (
        <dl className="mm-dl">
          <dt>Parts</dt><dd>{(p.components || []).map((c) => c.label || c.id).join(" · ")}</dd>
          <dt>Wires</dt><dd><ul className="mm-plain">{(p.links || []).map((l, i) => {
            const a = (p.components || []).find((c) => c.id === l.from), b = (p.components || []).find((c) => c.id === l.to);
            return <li key={i}>{(a && a.label) || l.from} {DIR_LABEL[l.direction] || "—"} {(b && b.label) || l.to}{l.label ? " [" + l.label + "]" : ""}</li>;
          })}</ul></dd>
        </dl>
      )}
      {ob.kind === "timeline" && (
        <ol className="mm-plain">{(p.events || []).map((e, i) => <li key={i}>{e.date ? <b>{e.date} </b> : null}{e.label}</li>)}</ol>
      )}
      {ob.kind === "code_or_notation" && (
        <>
          <pre className="mm-code">{p.text || ""}</pre>
          {p.uncertain && <p className="mm-hint">Unsure: {p.uncertain}</p>}
        </>
      )}
      {ob.kind === "question" && (
        <>
          <p className="mm-qtext">{p.question || ob.title}</p>
          {p.answer_observation && <p className="mm-hint">Text next to it: “{obsText(eff[p.answer_observation])}”</p>}
          <p className="mm-hint">A question you wrote is not counted as a gap in knowledge. Is it still open?</p>
          <div className="mm-btnrow">
            <Btn size="sm" onClick={() => mark("question still open")}>Still open</Btn>
            <Btn size="sm" onClick={() => mark("question answered (the text next to it is my answer)")}>I answered it</Btn>
          </div>
        </>
      )}
      {ob.kind === "annotation" && <p>{p.text}</p>}
      {ob.kind === "matrix" && (
        <>
          <dl className="mm-dl">
            <dt>Across</dt><dd>{axis(p.x_axis)}</dd>
            <dt>Up</dt><dd>{axis(p.y_axis)}</dd>
          </dl>
          <ul className="mm-plain">{(p.cells || []).map((c, i) => <li key={i}>{c.label}{c.x != null || c.y != null ? <span className="mm-muted"> · {[c.x, c.y].filter((x) => x != null).join(", ")}</span> : null}</li>)}</ul>
          {(p.bands || []).length > 0 && <p className="mm-hint">Bands: {p.bands.join(" · ")}</p>}
        </>
      )}
      {ob.kind === "hierarchy" && (
        <ol className="mm-plain">{(p.levels || []).map((l, i) => <li key={i}>{l.label}</li>)}</ol>
      )}
      {p.notes && <p className="mm-hint">Note from the reading: {p.notes}</p>}
      {ob.purpose && <p className="mm-hint">Purpose (yours): {ob.purpose}</p>}
    </Panel>
  );
}
