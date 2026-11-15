// Calls from the study screens to the model layer (task E2, ARCHITECTURE.md sections 5 and 6).
// A feature gives a prompt id and the values for its {{placeholders}}; the main process fills the editable prompt file in (learner text is
// fenced there), picks the provider by the prompt's slot and checks the answer against the prompt's schema. This file only moves values
// and shows the state: busy with a Cancel button, a typed error with what to do, who answered and what it cost.
// Without the desktop app, or without a model, nothing here runs and the screens keep their Copy prompt / Claude Code route.
import React, { useEffect, useRef, useState } from "react";
import { Copy, CircleNotch, X, Info } from "@phosphor-icons/react";
import { useModelStatus, openModelSettings } from "./tabs/ModelsPanel.jsx";
import "./model-call.css";

const M = () => window.kartotek && window.kartotek.models;
const PR = () => window.kartotek && window.kartotek.prompts;

let seq = 0;
const newId = () => "e2" + Date.now().toString(36) + "-" + (++seq);
// Keys that start with "_" are for the window's own use
const clean = (vars) => { const o = {}; Object.keys(vars || {}).forEach((k) => { if (k.charAt(0) !== "_") o[k] = vars[k] == null ? "" : String(vars[k]); }); return o; };

// Is a model set up for this slot (or, as the model layer does, the strong slot)?
export function useModelReady(slot) {
  const desktop = !!M();
  const status = useModelStatus();
  const ready = !!(desktop && status && status.configured && ((status.slots || {})[slot] || (status.slots || {}).strong));
  return { desktop, ready, status };
}

// Renders a prompt file with values without calling anything (for "Copy prompt" and "what is sent")
export async function renderPrompt(promptId, vars) {
  if (!PR()) return null;
  const r = await PR().render(promptId, clean(vars));
  return r && r.ok ? r.value : null;
}

// One call. → { ok: true, json, text, prompt: {promptId, promptVersion, promptHash}, meta: {provider, providerLabel, model, costUsd, costKind} }
//          or { ok: false, error, advice, code }
export async function runPrompt(promptId, vars, opts) {
  const o = opts || {};
  if (!M() || !PR()) return { ok: false, error: "Models work in the desktop app.", code: "not-configured", advice: "" };
  const pr = await PR().render(promptId, clean(vars));
  if (!pr || !pr.ok) return { ok: false, error: (pr && pr.error) || "The prompt could not be read.", code: "invalid", advice: "" };
  const p = pr.value;
  const request = {
    feature: o.feature || promptId, slot: p.slot || "fast", messages: [{ role: "user", content: p.text }],
    schema: p.schema || undefined, promptId: p.promptId, promptVersion: p.promptVersion, promptHash: p.promptHash || undefined,
    maxOutputTokens: o.maxOutputTokens || 6000,
  };
  const r = await M().run(o.callId || newId(), request, o.onEvent || (() => {}));
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || "The call failed.", code: r && r.code, advice: (r && r.advice) || "" };
  const v = r.value;
  return {
    ok: true, json: v.json, text: v.text,
    prompt: { promptId: p.promptId, promptVersion: p.promptVersion, promptHash: p.promptHash || null },
    meta: { provider: v.provider, providerLabel: v.providerLabel, model: v.model, costUsd: v.costUsd, costKind: v.costKind, repaired: v.repaired },
  };
}

// State of one running call for a component: busy, the model layer's status line, a typed error
export function useModelCall() {
  const [st, setSt] = useState({ busy: false, status: "", error: null, advice: "", code: null });
  const ref = useRef({ id: null, alive: true });
  useEffect(() => { ref.current.alive = true; return () => { ref.current.alive = false; }; }, []);
  const set = (x) => { if (ref.current.alive) setSt((s) => ({ ...s, ...x })); };
  const run = async (promptId, vars, opts) => {
    const id = newId();
    ref.current.id = id;
    set({ busy: true, status: "Preparing", error: null, advice: "", code: null });
    const r = await runPrompt(promptId, vars, { ...(opts || {}), callId: id, onEvent: (ev) => { if (ev && ev.type === "status") set({ status: ev.text }); } });
    ref.current.id = null;
    set({ busy: false, status: "", error: r.ok || r.code === "cancelled" ? null : r.error, advice: r.ok ? "" : r.advice || "", code: r.ok ? null : r.code });
    return r;
  };
  const fail = (message) => set({ busy: false, status: "", error: message, advice: "", code: "invalid" });
  const cancel = () => { if (ref.current.id && M()) M().cancel(ref.current.id); };
  return { ...st, run, cancel, fail };
}

const usd = (x) => "$" + (x < 0.01 ? Number(x).toFixed(4) : Number(x).toFixed(2));
// "$0.0021", "included in your subscription (about $0.007)", "free (local model)"
export function costText(kind, costUsd) {
  if (kind === "free-local") return "free (local model)";
  if (kind === "subscription-estimate") return "included in your subscription" + (typeof costUsd === "number" ? " (about " + usd(costUsd) + ")" : "");
  return typeof costUsd === "number" ? usd(costUsd) : "price unknown";
}
// "Claude Code · claude-haiku-5-5 · included in your subscription (about $0.007)" from a saved `by` record or a call's meta
export function byLine(by) {
  if (!by) return "";
  const who = by.providerLabel || by.provider || "a model";
  return who + (by.model ? " · " + by.model : "") + (by.cost_kind || by.costKind ? " · " + costText(by.cost_kind || by.costKind, by.cost_usd != null ? by.cost_usd : by.costUsd) : "");
}

// Busy line with Cancel, or the typed error and what to do
export function CallStatus({ call }) {
  if (call.busy) {
    return (
      <p className="k-small mc-busy" role="status">
        <CircleNotch size={14} className="mc-spin" aria-hidden="true" />{call.status || "Working"}…
        <button type="button" className="k-btn sm" onClick={call.cancel}><X size={13} aria-hidden="true" />Cancel</button>
      </p>
    );
  }
  if (call.error) {
    return (
      <p className="k-lvl mc-error" data-l="warn" role="alert">
        {call.error}{call.advice ? " " + call.advice : ""}
        {call.code === "not-configured" || call.code === "auth" || call.code === "budget" ? <> <button type="button" className="k-btn sm" onClick={openModelSettings}>Open Settings, Models</button></> : null}
      </p>
    );
  }
  return null;
}

// Copy prompt: the prompt file filled in with the values, as the model would get it (desktop app)
export function CopyPromptBtn({ promptId, vars, label }) {
  if (!PR()) return null;
  const A = window.App;
  const copy = async () => {
    const p = await renderPrompt(promptId, vars);
    if (!p) { A.toast("Copy failed"); return; }
    try { await navigator.clipboard.writeText(p.text); A.toast("Prompt copied"); } catch (e) { A.toast("Copy failed"); }
  };
  return <button type="button" className="k-btn sm" onClick={copy} title="Copies the prompt, with your values filled in, so you can paste it into any chat."><Copy size={14} aria-hidden="true" />{label || "Copy prompt"}</button>;
}

// "What is sent": the rendered prompt, shown on demand
export function RequestPreview({ promptId, vars, title }) {
  const [text, setText] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) renderPrompt(promptId, vars).then((p) => setText(p ? p.text : "(the prompt could not be read)")); }, [open]);
  if (!PR()) return null;
  return (
    <details className="k-small mc-req" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{title || "What is sent"}</summary>
      <p className="k-muted">Only this text goes to your model. The instructions are a file you can edit in Settings, Models, Prompts.</p>
      <pre className="mc-pre">{open ? (text == null ? "Preparing…" : text) : ""}</pre>
    </details>
  );
}

// Shown where a model could help but none is set up
export function NoModelNote({ what }) {
  const { desktop } = useModelReady("fast");
  if (!desktop) return <p className="k-small k-muted mc-note"><Info size={14} aria-hidden="true" />Models work in the desktop app.</p>;
  return (
    <p className="k-small k-muted mc-note">
      <Info size={14} aria-hidden="true" />No model is set up for {what}. <button type="button" className="k-btn sm" onClick={openModelSettings}>Set up a model</button>
    </p>
  );
}
