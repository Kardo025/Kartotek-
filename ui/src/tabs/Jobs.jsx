// Writing jobs (task E3): "New study from my files" and the other in-app writers (end-of-lesson tests, mock exams, the exam
// Overview's "write next studies", mind-map reading and coaching). A job runs in the desktop backend with visible, resumable steps;
// before it starts the window shows the token and cost estimate, while it runs the running total. The result is a draft in the
// content folder, labelled "Not certified" until the audit reports 0 blockers, with the provider and model that wrote it.
import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FileArrowUp, Play, Pause, Trash, CheckCircle, Circle, CircleNotch, Warning, XCircle, FolderOpen, Robot, ArrowClockwise, CaretRight, Sparkle } from "@phosphor-icons/react";
import { Btn, Lvl, EASE } from "./kit.jsx";
import { modelsAvailable, useModelStatus, openModelSettings } from "./ModelsPanel.jsx";
import { CheckThis, BriefView } from "../research.jsx";
import "./jobs.css";

const J = () => window.kartotek && window.kartotek.jobs;
const M = () => window.kartotek && window.kartotek.models;
const App = () => window.App;
export const jobsAvailable = () => !!J();

// ---- one shared list of jobs, kept current by the backend's events
let cache = null;
const subs = new Set();
let unsub = null;
function publish() { subs.forEach((f) => f(cache)); }
function ensureFeed() {
  if (!J() || unsub) return;
  J().list().then((r) => { if (r && r.ok) { cache = r.value; publish(); } });
  unsub = J().onEvent((ev) => {
    if (!cache) cache = [];
    if (ev.type === "job") { const i = cache.findIndex((j) => j.id === ev.job.id); if (i >= 0) cache[i] = ev.job; else cache.unshift(ev.job); }
    if (ev.type === "removed") cache = cache.filter((j) => j.id !== ev.id);
    cache = cache.slice();
    publish();
  });
}
export function useJobs(kinds) {
  const [list, setList] = useState(cache);
  useEffect(() => { ensureFeed(); subs.add(setList); return () => subs.delete(setList); }, []);
  return useMemo(() => (list || []).filter((j) => !kinds || kinds.indexOf(j.kind) >= 0), [list, kinds && kinds.join()]);
}

// ---- formatting
const KIND_LABEL = { study: "Study", lesson: "End-of-lesson test", mock: "Mock exam", "mind-read": "Mind-map reading", "mind-coach": "Coaching turn" };
const STATUS = { preparing: ["mid", "Reading files"], ready: ["mid", "Ready to start"], queued: ["mid", "Waiting"], running: ["mid", "Running"], paused: ["warn", "Paused"], failed: ["bad", "Stopped by an error"], done: ["good", "Finished"], stopped: ["warn", "Stopped"] };
const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n || 0));
export function costText(usd, kind, unpriced) {
  if (kind === "free-local") return "free (runs on this PC)";
  if (kind === "subscription-estimate") return usd != null ? "in your subscription (API equivalent ≈ $" + usd.toFixed(2) + ")" : "in your subscription";
  if (usd == null) return "price unknown (add it under Settings, Models, Prices)";
  return "$" + (usd < 0.01 && usd > 0 ? usd.toFixed(3) : usd.toFixed(2)) + (unpriced ? " + " + unpriced + " unpriced calls" : "");
}
const dur = (ms) => { const s = Math.round((ms || 0) / 1000); return s < 60 ? s + " s" : s < 3600 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h"; };

function StepIcon({ status }) {
  if (status === "done") return <CheckCircle size={16} weight="fill" className="jb-ic-done" aria-label="done" />;
  if (status === "running") return <CircleNotch size={16} weight="bold" className="jb-ic-run" aria-label="running" />;
  return <Circle size={16} className="jb-ic-wait" aria-label="waiting" />;
}

// ---- the list of jobs
export function JobsPanel({ kinds, title = "Writing jobs", empty }) {
  const list = useJobs(kinds);
  if (!jobsAvailable()) return null;
  if (!list.length) return empty || null;
  return (
    <section className="k-panel k-sec jb-panel" aria-label={title}>
      <div className="k-sec-head"><h2>{title}</h2><span className="k-small k-muted">{list.filter((j) => j.status === "running").length ? "One job runs at a time; you can keep studying." : "Jobs resume where they stopped."}</span></div>
      <ul className="jb-list">
        <AnimatePresence initial={false}>
          {list.map((j) => <JobCard key={j.id} job={j} />)}
        </AnimatePresence>
      </ul>
    </section>
  );
}

function JobCard({ job }) {
  const [open, setOpen] = useState(job.status === "running" || job.status === "ready");
  const [busy, setBusy] = useState(false);
  // a job that becomes ready shows its estimate; a job that starts shows its steps
  useEffect(() => { if (job.status === "ready" || job.status === "running") setOpen(true); }, [job.status]);
  const [tone, label] = STATUS[job.status] || ["mid", job.status];
  const t = job.totals || {};
  const act = async (fn) => { setBusy(true); try { const r = await fn(); if (r && r.ok === false) App().toast(r.error); } finally { setBusy(false); } };
  const done = job.steps.filter((s) => s.status === "done").length;
  return (
    <motion.li layout className="jb-card" data-status={job.status} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.24, ease: EASE }}>
      <div className="jb-head">
        <button type="button" className="jb-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <CaretRight size={14} weight="bold" className="jb-caret" data-open={open} aria-hidden="true" />
          <span className="jb-title">{job.title}</span>
        </button>
        <span className="jb-kind k-small k-muted">{KIND_LABEL[job.kind] || job.kind}</span>
        <Lvl level={tone}>{label}</Lvl>
      </div>
      <div className="jb-meter" aria-hidden="true"><motion.span animate={{ width: (job.steps.length ? (done / job.steps.length) * 100 : 0) + "%" }} transition={{ duration: 0.42, ease: EASE }} /></div>
      <p className="jb-totals k-small k-num">
        {t.calls ? t.calls + " model calls · " + k(t.input) + " tokens in / " + k(t.output) + " out · " + costText(t.costKind === "api" || !t.costKind ? t.costUsd : t.costUsd, t.costKind || (job.estimate && job.estimate.costKind), t.unpriced) + " · " + dur(t.ms) : job.estimate ? "Estimate: " + estimateLine(job.estimate) : "Nothing sent to a model yet."}
        {t.failed ? " · " + t.failed + " failed call" + (t.failed > 1 ? "s" : "") : ""}
      </p>
      {job.error && <p className="jb-error k-small" role="alert"><Warning size={14} aria-hidden="true" /> {job.error}</p>}
      {job.note && <p className="k-small k-muted">{job.note}</p>}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="jb-body" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.24, ease: EASE }}>
            {job.status === "ready" && job.estimate && <Estimate est={job.estimate} />}
            <ol className="jb-steps">
              {job.steps.map((s) => (
                <li key={s.id} data-status={s.status}>
                  <div className="jb-step"><StepIcon status={s.status} /><span>{s.label}</span>{s.tasks.length > 0 && <span className="k-small k-muted k-num">{s.tasks.filter((x) => x.status === "done").length}/{s.tasks.length}</span>}</div>
                  {s.detail && <p className="jb-detail k-small k-muted">{s.detail}</p>}
                  {s.tasks.some((x) => x.attempts > 0 || (x.problems || []).length || x.status === "running") && (
                    <ul className="jb-tasks">
                      {s.tasks.filter((x) => x.attempts > 0 || (x.problems || []).length || x.status === "running").slice(-8).map((x) => (
                        <li key={x.id}>
                          <span className="k-small">{x.label}</span>
                          {x.status === "running" && <span className="k-small k-muted"> · working</span>}
                          {x.attempts > 0 && <span className="k-small k-muted"> · {x.attempts} repair{x.attempts > 1 ? "s" : ""}</span>}
                          {(x.problems || []).length > 0 && x.status === "done" && <details className="jb-probs"><summary className="k-small">{x.problems.length} problem{x.problems.length > 1 ? "s" : ""} left</summary><ul>{x.problems.map((p, i) => <li key={i} className="k-small">{p}</li>)}</ul></details>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            {job.result && <Result job={job} />}
            {job.log.length > 0 && <details className="jb-log"><summary className="k-small">Log ({job.log.length})</summary><ul>{job.log.slice().reverse().map((l, i) => <li key={i} className="k-small" data-level={l.level}>{new Date(l.t).toLocaleTimeString()} · {l.text}</li>)}</ul></details>}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="k-row-btns jb-actions">
        {(job.status === "ready" || job.status === "paused" || job.status === "failed") && <Btn kind="primary" size="sm" disabled={busy || !!(job.estimate && job.estimate.visionProblem)} onClick={() => act(() => J().start(job.id))}><Play size={14} weight="fill" aria-hidden="true" />{job.status === "ready" ? "Start" : "Resume"}</Btn>}
        {(job.status === "running" || job.status === "queued") && <Btn size="sm" disabled={busy} onClick={() => act(() => J().pause(job.id))}><Pause size={14} weight="fill" aria-hidden="true" />Pause</Btn>}
        {job.fixRounds > 0 && job.status !== "done" && (job.steps.find((s) => s.id === "verify") || {}).status !== "done" && job.steps.some((s) => s.id === "verify") && <Btn size="sm" disabled={busy} onClick={() => act(() => J().skipFixes(job.id))} title="Disputed items keep their mark (shown, never sent to your reviews) and the job goes on to save">Skip the remaining fixes</Btn>}
        <Btn size="sm" onClick={() => J().openFolder(job.id)} title="The job's working files: extracted pages, the draft, job.json"><FolderOpen size={14} aria-hidden="true" />Job folder</Btn>
        {job.status !== "running" && job.status !== "queued" && <Btn size="sm" disabled={busy} onClick={() => act(() => J().remove(job.id))} title="Removes the job and its working files. A saved draft in the content folder stays."><Trash size={14} aria-hidden="true" />Remove job</Btn>}
      </div>
    </motion.li>
  );
}

function estimateLine(e) {
  const lo = (x) => Math.round(x * e.range[0]), hi = (x) => Math.round(x * e.range[1]);
  return "about " + e.calls + " calls, " + k(lo(e.input)) + "–" + k(hi(e.input)) + " tokens in, " + k(lo(e.output)) + "–" + k(hi(e.output)) + " out, " +
    (e.costUsd != null && e.costKind !== "free-local" ? (e.costKind === "subscription-estimate" ? "in your subscription (API equivalent ≈ $" + (e.costUsd * e.range[0]).toFixed(2) + "–" + (e.costUsd * e.range[1]).toFixed(2) + ")" : "$" + (e.costUsd * e.range[0]).toFixed(2) + "–" + (e.costUsd * e.range[1]).toFixed(2)) : costText(null, e.costKind));
}
function Estimate({ est }) {
  return (
    <div className="jb-est">
      <p className="k-small"><Sparkle size={14} aria-hidden="true" /> <b>Before you start:</b> {estimateLine(est)}{est.provider ? " with " + est.provider + (est.model ? " · " + est.model : "") : ""}.</p>
      <table className="jb-est-table k-small k-num"><thead><tr><th>Step</th><th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>Model</th></tr></thead>
        <tbody>{est.rows.map((r) => <tr key={r.step}><td>{r.step}</td><td>{r.calls}</td><td>{k(r.input)}</td><td>{k(r.output)}</td><td>{r.providerLabel ? r.providerLabel + (r.model ? " · " + r.model : "") : "not set up"}</td></tr>)}</tbody></table>
      {est.visionProblem && <p className="k-small" role="alert" data-testid="vision-problem"><b>This job cannot start:</b> {est.visionProblem}</p>}
      {est.note && <p className="k-small k-muted">{est.note} The range is a rough estimate (0.6× to 1.8×).</p>}
    </div>
  );
}

function Result({ job }) {
  const r = job.result || {};
  // a research job (task F7) shows its brief
  if (job.kind === "research") return r.brief ? <div className="jb-result" data-ok="true"><BriefView r={{ status: "done", claim: String(job.title || "").replace(/^Check: /, ""), brief: r.brief, mode: r.mode, by: r.by }} /></div> : null;
  const v = r.verification;
  const reload = async () => { await App().reloadContent(); App().toast("Content reloaded."); };
  return (
    <div className="jb-result" data-ok={!!r.saved}>
      {job.kind === "study" && (
        <p className="k-small">
          {r.certified ? <Lvl level="good">0 blockers: certified</Lvl> : <Lvl level="warn">Not certified: {(r.blockers || []).length} blocker{(r.blockers || []).length === 1 ? "" : "s"}</Lvl>}
          {" "}{r.warnings != null && <span className="k-muted">{r.warnings} warnings · </span>}
          {r.counts && <span className="k-muted k-num">{r.counts.topics} topics, {r.counts.outcomes} outcomes, {r.counts.criteria} criteria, {r.counts.practice} practice and {r.counts.final} final items</span>}
        </p>
      )}
      {v && <p className="k-small k-num">Verification: {v.verified} of {v.items} items solved again without the key and matched{v.disputed ? ", " + v.disputed + " disputed (shown, never sent to your reviews)" : ""}{v.unverified ? ", " + v.unverified + " unverified" : ""}.</p>}
      <p className="k-small">{r.where}</p>
      {(r.blockers || []).length > 0 && <details className="jb-probs"><summary className="k-small">Audit blockers</summary><ul>{r.blockers.map((b, i) => <li key={i} className="k-small">{b}</li>)}</ul></details>}
      {(r.errors || r.structural || []).length > 0 && <details className="jb-probs" open><summary className="k-small">Problems that kept it from being saved</summary><ul>{(r.errors || r.structural).map((b, i) => <li key={i} className="k-small">{b}</li>)}</ul></details>}
      {r.saved && <div className="k-row-btns"><Btn size="sm" kind="primary" onClick={reload}><ArrowClockwise size={14} weight="bold" aria-hidden="true" />Reload content to open it</Btn></div>}
      {/* task F7: a fact in the draft that you or the model are unsure of can be checked against the web */}
      {r.saved && <CheckThis claim="" context={"A draft written in Kartotek: " + job.title} target={{ kind: "job", job: job.id }} editable label="Check a fact in this draft" />}
    </div>
  );
}

// ---- the model a job uses: the slot (default) or any provider and model, chosen for this job only
export function ModelChoice({ value, onChange, slot = "strong", label = "Model" }) {
  const [cfg, setCfg] = useState(null);
  const [models, setModels] = useState({});
  useEffect(() => { if (M()) M().config().then((r) => r && r.ok && setCfg(r.value)); }, []);
  const providers = cfg ? cfg.providers : [];
  const slotVal = cfg && cfg.slots[slot];
  const slotLabel = slotVal ? (providers.find((p) => p.id === slotVal.providerId) || {}).label + (slotVal.model ? " · " + slotVal.model : "") : null;
  const pid = value ? value.providerId : "";
  useEffect(() => { if (pid && !models[pid] && M()) M().listModels(pid).then((r) => setModels((m) => Object.assign({}, m, { [pid]: r && r.ok ? r.value : [] }))); }, [pid]);
  return (
    <div className="jb-choice">
      <label className="k-field"><span className="k-field-label">{label}</span>
        <select aria-label={label + " provider"} value={pid} onChange={(e) => onChange(e.target.value ? { providerId: e.target.value, model: (cfg.slots[slot] && cfg.slots[slot].providerId === e.target.value && cfg.slots[slot].model) || "" } : null)}>
          <option value="">{slotLabel ? "The " + slot + " slot: " + slotLabel : "The " + slot + " slot (" + (slot === "vision" ? "falls back to strong" : "not set up") + ")"}</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      {pid && (
        <label className="k-field"><span className="k-field-label">Model name</span>
          <input list={"jb-models-" + pid} value={value.model} onChange={(e) => onChange({ providerId: pid, model: e.target.value })} placeholder="default model" />
          <datalist id={"jb-models-" + pid}>{(models[pid] || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
        </label>
      )}
    </div>
  );
}

// ---- "New … from my files": choose files and the model, prepare (read locally, estimate), then start
export function NewJob({ kind, title, intro, fields = [], request = {}, files = "sources", startLabel = "Prepare", onCreated, needsFiles = true, vision = true }) {
  const status = useModelStatus();
  const [picked, setPicked] = useState([]);
  const [vals, setVals] = useState({});
  const [target, setTarget] = useState(null);
  const [visionTarget, setVisionTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (!modelsAvailable()) return <p className="k-small k-muted">Writing in the app needs the desktop app. Use the Claude Code prompt instead.</p>;
  const pick = async () => { const r = await J().pickFiles(files); if (r && r.ok) setPicked(picked.concat(r.value.filter((f) => !picked.some((p) => p.name === f.name)))); };
  const ready = (!needsFiles || picked.length) && fields.every((f) => f.optional || String(vals[f.key] || "").trim());
  const prepare = async () => {
    setBusy(true); setErr(null);
    try {
      const req = Object.assign({}, request, vals, { files: picked.map((p) => p.token) });
      const r = await J().create(kind, req, { target, visionTarget });
      if (!r || !r.ok) setErr(r ? r.error : "The job could not be created.");
      else { setPicked([]); if (onCreated) onCreated(r.value); }
    } finally { setBusy(false); }
  };
  return (
    <div className="jb-new">
      {intro && <p className="k-small k-muted">{intro}</p>}
      {status && !status.configured && <p className="k-small jb-warn"><Warning size={14} aria-hidden="true" /> No model is set up yet. <button type="button" className="k-link" onClick={openModelSettings}>Set up a model</button> (an API key, Claude Code or Codex, or a local model such as Ollama).</p>}
      {needsFiles && (
        <div className="jb-files">
          <Btn size="sm" onClick={pick}><FileArrowUp size={14} aria-hidden="true" />{files === "photos" ? "Choose photos" : "Choose files"}</Btn>
          {picked.length ? <ul className="jb-picked">{picked.map((p) => <li key={p.token} className="k-small"><span>{p.name}</span><span className="k-muted k-num"> · {Math.max(1, Math.round(p.size / 1024))} KB</span> <button type="button" className="k-link" onClick={() => setPicked(picked.filter((x) => x !== p))}>remove</button></li>)}</ul>
            : <span className="k-small k-muted">{files === "photos" ? "JPEG or PNG photos of the map." : "PDF, .pptx, .docx, .txt, .md, .srt or .vtt. Read on this PC; only the job sends text to the model you choose."}</span>}
        </div>
      )}
      {fields.length > 0 && <div className="st-new-grid">{fields.map((f) => <label key={f.key} className="k-field"><span className="k-field-label">{f.label}{f.optional ? " (optional)" : ""}</span><input value={vals[f.key] || ""} onChange={(e) => setVals(Object.assign({}, vals, { [f.key]: e.target.value }))} placeholder={f.placeholder || ""} /></label>)}</div>}
      <div className="jb-choices">
        <ModelChoice value={target} onChange={setTarget} slot={kind.indexOf("mind") === 0 ? "vision" : "strong"} label={kind.indexOf("mind") === 0 ? "Vision model" : "Writing model"} />
        {vision && kind.indexOf("mind") !== 0 && <ModelChoice value={visionTarget} onChange={setVisionTarget} slot="vision" label="For page images" />}
      </div>
      {err && <p className="jb-error k-small" role="alert"><XCircle size={14} aria-hidden="true" /> {err}</p>}
      <div className="k-row-btns"><Btn kind="primary" disabled={!ready || busy} onClick={prepare}><Robot size={15} aria-hidden="true" />{busy ? "Reading the files…" : startLabel}</Btn>
        <span className="k-small k-muted">Nothing is sent before you press Start; the estimate comes first.</span></div>
    </div>
  );
}

// The exam Overview's "write next studies": one study job per syllabus item, from its page extract in the content folder
export async function createStudyJobs(rows, choice) {
  const out = [];
  for (const r of rows) {
    const res = await J().create("study", { id: r.id, title: r.title, sourceNames: [r.extract], scope: r.scope || "", goal: r.goal || "" }, choice || null);
    out.push(res);
  }
  return out;
}
