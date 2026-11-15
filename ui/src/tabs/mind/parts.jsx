// Small shared pieces of the Mind map assistant
import React, { useState } from "react";
import { HourglassMedium, X } from "@phosphor-icons/react";
import { AskPair } from "../Cents.jsx";
import { App, KM, save, when, REQ_LABEL } from "./util.js";

// Requests sent to Claude Code that have no result yet. The prompt is kept until the result is imported.
export function Waiting({ doc, kinds, compact }) {
  const list = (doc.requests || []).filter((r) => r.status === "waiting" && (!kinds || kinds.indexOf(r.kind) >= 0));
  if (!list.length) return null;
  const cancel = (r) => { r.status = "cancelled"; r.done_at = Date.now(); delete r.prompt; save(doc.map_id); };
  return (
    <div className={"mm-wait" + (compact ? " compact" : "")} role="status">
      {list.map((r) => (
        <div className="mm-wait-row" key={r.id}>
          <HourglassMedium size={18} aria-hidden="true" className="mm-wait-icon" />
          <div className="mm-wait-text">
            <b>{REQ_LABEL[r.kind] || r.kind}{r.turn ? " · turn " + r.turn : ""}</b>
            <span>Waiting for Claude Code since {when(r.at)}. Press Enter there; when it says it built the app, reload Kartotek (F5).</span>
            {r.prompt && !compact && (
              <details className="mm-prompt"><summary>Show the prompt</summary><pre>{r.prompt}</pre></details>
            )}
          </div>
          <div className="mm-wait-act">
            {r.prompt && <AskPair prompt={r.prompt} label="Open in Claude Code" />}
            <button type="button" className="k-btn sm ghost" onClick={() => cancel(r)} aria-label={"Cancel " + (REQ_LABEL[r.kind] || r.kind)} title="Cancel this request">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Make a request record + its prompt; the caller shows <Waiting> afterwards
export function makeRequest(doc, kind, extra, build) {
  const now = Date.now(), rq = KM().newRequest(doc, kind, extra, now);
  rq.prompt = build(rq);
  save(doc.map_id);
  App().toast("Prompt ready. Open it in Claude Code and press Enter.");
  return rq;
}

// A zoomed piece of a photo around a region (with context), the region outlined
export function Crop({ src, box, vw, vh, ctx = 0.5, maxH = 220, label }) {
  const [err, setErr] = useState(false);
  if (!box || !vw || !vh) return null;
  const [x, y, w, h] = box;
  const cx = Math.max(0, x - w * ctx), cy = Math.max(0, y - h * ctx);
  const cw = Math.min(1, x + w * (1 + ctx)) - cx, ch = Math.min(1, y + h * (1 + ctx)) - cy;
  const ratio = (cw * vw) / (ch * vh);
  const style = {
    aspectRatio: String(ratio),
    maxHeight: maxH,
    maxWidth: "100%",
    width: Math.min(560, maxH * ratio),
    backgroundImage: err ? "none" : "url(\"" + src + "\")",
    backgroundSize: (100 / cw) + "% " + (100 / ch) + "%",
    backgroundPosition: (cw >= 1 ? 0 : (cx / (1 - cw)) * 100) + "% " + (ch >= 1 ? 0 : (cy / (1 - ch)) * 100) + "%",
  };
  return (
    <figure className="mm-crop">
      <div className="mm-crop-img" style={style} role="img" aria-label={label || "Close-up of the marked area"}>
        <img src={src} alt="" hidden onError={() => setErr(true)} />
        <span className="mm-crop-box" style={{ left: ((x - cx) / cw) * 100 + "%", top: ((y - cy) / ch) * 100 + "%", width: (w / cw) * 100 + "%", height: (h / ch) * 100 + "%" }} />
        {err && <span className="mm-crop-miss">Photo not found</span>}
      </div>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="mm-empty">
      <b>{title}</b>
      {children}
    </div>
  );
}
