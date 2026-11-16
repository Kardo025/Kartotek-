// The researcher in the window (task F7, LEARNING-PROTOCOL 3.12): "Check this" starts a background job (desktop\jobs\research.js) that
// checks a claim against the web and returns a brief with its sources; the request and the brief are kept in state.research
// (src/side-core.js). Hidden when neither the strong slot's provider has web search nor a search key is set (Settings, Models).
import React, { useEffect, useState } from "react";
import { MagnifyingGlass, CheckCircle, XCircle, Question, ArrowSquareOut, CircleNotch, Key, Warning } from "@phosphor-icons/react";
import { Btn } from "./tabs/kit.jsx";
import "./research.css";

const KS = () => window.KSide;
const App = () => window.App;
const RJ = () => window.kartotek && window.kartotek.research;
const J = () => window.kartotek && window.kartotek.jobs;

// ------------------------------------------------------------------ availability (cached; refreshed when Settings change it)
let statusCache = null, statusWaiters = [];
export function refreshResearchStatus() {
  if (!RJ()) { statusCache = { mode: null }; return Promise.resolve(statusCache); }
  return RJ().status().then((r) => { statusCache = r && r.ok ? r.value : { mode: null }; statusWaiters.forEach((f) => f(statusCache)); return statusCache; });
}
// Read again on every mount and when the window gets focus, so a key saved in another window (or a slot changed) shows without a restart
let focusHooked = false;
export function useResearchStatus() {
  const [st, setSt] = useState(statusCache);
  useEffect(() => {
    statusWaiters.push(setSt); refreshResearchStatus();
    if (!focusHooked && typeof window !== "undefined") { focusHooked = true; window.addEventListener("focus", () => { refreshResearchStatus(); }); }
    return () => { statusWaiters = statusWaiters.filter((f) => f !== setSt); };
  }, []);
  return st || { mode: null };
}

// ------------------------------------------------------------------ jobs → requests (one listener for the whole window)
let listening = false;
function listen() {
  if (listening || !J() || !J().onEvent) return;
  listening = true;
  J().onEvent((ev) => {
    const job = ev && ev.job;
    if (!job || job.kind !== "research") return;
    const all = KS().researchOf(App().S).requests;
    Object.keys(all).forEach((k) => { if (all[k].job_id === job.id && (job.status === "done" || job.status === "failed" || job.status === "paused")) { KS().applyJob(App().S, k, job); App().store.commit({ meta: true }); App().render(); } });
  });
}
// Requests still running when the window opened: read their jobs once
async function catchUp() {
  if (!J()) return;
  const all = KS().researchOf(App().S).requests;
  for (const k of Object.keys(all)) {
    const r = all[k];
    if (!r.job_id || r.status === "done" || r.status === "failed" || r.status === "no_sources") continue;
    const g = await J().get(r.job_id);
    if (g && g.ok) { KS().applyJob(App().S, k, g.value); }
  }
  App().store.commit({ meta: true }); App().render();
}
let caught = false;

async function startResearch(o) {
  const S = App().S;
  const r = KS().newRequest(S, Object.assign({ now: Date.now() }, o));
  App().store.commit({ meta: true }); App().render();
  const c = await J().create("research", { claim: r.claim, context: r.context, sources: r.sources });
  if (!c || !c.ok) { r.status = "failed"; r.error = (c && c.error) || "The research job could not start."; App().store.commit({ meta: true }); App().render(); return; }
  if (c.value.status === "failed") { r.status = "failed"; r.error = c.value.error || "The research job could not start."; r.job_id = c.value.id; App().store.commit({ meta: true }); App().render(); return; }
  r.job_id = c.value.id; r.status = "running";
  App().store.commit({ meta: true }); App().render();
  const s = await J().start(c.value.id);
  if (!s || !s.ok) { r.status = "failed"; r.error = (s && s.error) || "The research job could not start."; App().store.commit({ meta: true }); App().render(); }
}

// "Check this": a claim (editable when `editable`), its context and course sources, and where the brief belongs (target)
export function CheckThis({ claim, context, sources, target, label, editable, compact }) {
  const st = useResearchStatus();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(claim || "");
  useEffect(() => { listen(); if (!caught && RJ()) { caught = true; catchUp(); } }, []);
  if (!st.mode || !J()) return null;
  const reqs = target ? KS().requestsFor(App().S, target).filter((r) => !editable || true) : [];
  const mine = reqs.filter((r) => !claim || editable || r.claim === String(claim).trim().slice(0, 600));
  const go = (c) => startResearch({ claim: c, context, sources, target });
  return (
    <span className={"rs" + (compact ? " compact" : "")}>
      {!open && (
        <button type="button" className="k-btn sm" onClick={() => (editable ? setOpen(true) : go(claim))} disabled={!editable && mine.some((r) => r.status === "running" || r.status === "starting")}
          title={"Checks the claim against the web (" + st.label + ") and returns a short brief with its sources."}>
          <MagnifyingGlass size={13} aria-hidden="true" />{label || "Check this"}
        </button>
      )}
      {open && (
        <span className="rs-form">
          <textarea className="k-input" rows={2} value={text} maxLength={600} onChange={(e) => setText(e.target.value)} aria-label="The claim to check" />
          <span className="cy-actions"><Btn size="sm" kind="primary" disabled={text.trim().length < 8} onClick={() => { go(text.trim()); setOpen(false); }}>Check it</Btn><Btn size="sm" onClick={() => setOpen(false)}>Cancel</Btn></span>
        </span>
      )}
      {mine.map((r) => <BriefView key={r.id} r={r} />)}
    </span>
  );
}

const VERDICT = { supported: { label: "Supported", Icon: CheckCircle }, contradicted: { label: "Contradicted", Icon: XCircle }, unclear: { label: "Unclear", Icon: Question } };
export function BriefView({ r }) {
  if (r.status === "starting" || r.status === "running") return <div className="rs-brief k-small"><CircleNotch size={13} className="mc-spin" aria-hidden="true" /> Checking “{r.claim}” on the web…</div>;
  if (r.status === "paused") return <div className="rs-brief k-small">The check of “{r.claim}” is paused (Settings, Jobs).</div>;
  if (r.status === "failed") return <div className="rs-brief k-small k-lvl" data-l="warn">The check of “{r.claim}” failed: {r.error}</div>;
  const b = r.brief || {}, v = VERDICT[b.verdict] || VERDICT.unclear, srcs = b.sources || [];
  return (
    <div className="rs-brief" data-v={b.verdict}>
      <p className="rs-head"><v.Icon size={15} weight="fill" aria-hidden="true" /><b>{v.label}</b><span className="k-small k-muted"> · “{r.claim}”</span></p>
      {b.summary && <p className="k-small">{b.summary}</p>}
      {(b.findings || []).length > 0 && <ol className="k-small rs-findings">{b.findings.map((f, i) => <li key={i}>{f.text} {(f.sources || []).map((n) => <sup key={n}>[{n}]</sup>)}</li>)}</ol>}
      {srcs.length ? (
        <ol className="k-small rs-sources">
          {srcs.map((s, i) => (
            <li key={i} data-ok={s.working ? "1" : undefined}>
              <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}<ArrowSquareOut size={11} aria-hidden="true" /></a>
              <span className="k-muted"> · {s.working ? "link answers" : "link did not answer" + (s.status ? " (" + s.status + ")" : "")}</span>
              {s.quote && <div className="k-muted rs-quote">“{s.quote}”</div>}
            </li>
          ))}
        </ol>
      ) : <p className="k-small k-lvl" data-l="warn"><Warning size={13} aria-hidden="true" /> No sources were found, so this is not a verdict.</p>}
      <p className="k-small k-muted">Researched {r.mode === "key" ? "with your search key" : "with your provider's web search"}{r.by ? " · " + r.by : ""} · generated, check the sources yourself.</p>
    </div>
  );
}

// Settings: how research searches, and the search key (it goes in, never comes back)
export function ResearchPanel() {
  const st = useResearchStatus();
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  if (!RJ()) return null;
  const save = async () => { const r = await RJ().setKey(key); setKey(""); setMsg(r && r.ok ? "Saved." : (r && r.error) || "Could not save."); refreshResearchStatus(); };
  const clear = async () => { await RJ().clearKey(); setMsg("Removed."); refreshResearchStatus(); };
  return (
    <section className="k-panel k-sec rs-panel">
      <h3 className="cy-h3"><MagnifyingGlass size={16} aria-hidden="true" /> Research (checking facts on the web)</h3>
      <p className="k-small">{st.mode === "provider" ? "Available: Kartotek uses the " + st.label + "." : st.mode === "key" ? "Available: Kartotek searches with your Brave Search key, then your strong-slot model writes the brief." : "Not available: set an Anthropic API key in the strong slot (its web search is used), or add a Brave Search API key here. Without either, \"Check this\" is hidden."}</p>
      <div className="cy-actions">
        <input className="k-input" type="password" value={key} autoComplete="off" placeholder={st.hasKey ? "A search key is stored (enter a new one to replace it)" : "Brave Search API key"} onChange={(e) => setKey(e.target.value)} aria-label="Brave Search API key" />
        <Btn size="sm" kind="primary" disabled={key.trim().length < 10} onClick={save}><Key size={14} aria-hidden="true" />Save key</Btn>
        {st.hasKey && <Btn size="sm" onClick={clear}>Remove key</Btn>}
        {msg && <span className="k-small k-muted">{msg}</span>}
      </div>
      <p className="k-small k-muted">The key is stored encrypted on this PC like your model keys and is never shown again, logged or backed up. Searches send only the claim's words to the search service.</p>
    </section>
  );
}
