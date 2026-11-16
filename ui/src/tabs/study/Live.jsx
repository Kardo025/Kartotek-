// Live sessions (tasks F3 and F4, LEARNING-PROTOCOL 1.2, 3.5-3.7): the goal, the required probe, the plan map the planner proposes and
// the learner accepts or changes, then step-by-step teaching (LiveTeach.jsx). A session is free (a topic in the learner's own words),
// on the learner's own files (read locally; only names and hashes are stored), or attached to a study (grounded in the chosen topics'
// source units, cited by page; decision D12 for exam topics). Everything a model writes is generated, unverified material in
// state.sessions; nothing reaches the scheduler. A session can be paused and resumed, also after a restart.
import React, { useEffect, useState } from "react";
import { CaretLeft, Plus, Broadcast, Check, ArrowRight, PencilSimple, MapPin, Pause, Play, FileText, Files } from "@phosphor-icons/react";
import { Btn, Seg } from "../kit.jsx";
import GraphView from "../../graph/GraphView.jsx";
import Probe, { ProbeResult } from "./Probe.jsx";
import LiveTeach from "./LiveTeach.jsx";
import { useModelReady, useModelCall, CallStatus, NoModelNote, byLine } from "../../model-call.jsx";
import "./probe.css";

const KP = () => window.KProbe;
const PL = () => window.KPlan;
const KL = () => window.KLive;
const App = () => window.App;
export const commit = () => { App().store.commit({ meta: true }); App().render(); };

export const LIVE_STATUS = {
  held: { label: "you hold this", tone: "held" }, learn: { label: "to learn", tone: "learn" }, goal: { label: "the goal", tone: "goal" },
  taught: { label: "taught and checked", tone: "held" }, gap_found: { label: "added: a gap found while teaching", tone: "edge" },
};
const STEP = { probe: "Probe", plan: "Plan", teach: "Teach", review: "Teach", done: "Done", paused: "Paused" };

function studyOptions() {
  const S = App().S;
  return Object.keys(S.etuts || {}).map((id) => S.etuts[id]).filter((et) => et && !et.removed && et.package && window.KCycle.isV2(et.package));
}
export function openSession(id, back) { App().liveOpen = id; App().liveBack = back || null; App().switchTab("etut"); App().render(); window.scrollTo(0, 0); }

// In the Study library: "Start live session" and the sessions (resume, transcripts)
export function LiveSessionsPanel() {
  const S = App().S, mr = useModelReady("strong");
  const list = PL().listSessions(S);
  const [form, setForm] = useState(false);
  return (
    <details className="k-panel k-sec" open={form || list.some((s) => s.status !== "done") || undefined}>
      <summary className="k-sec-head"><h2><Broadcast size={18} aria-hidden="true" /> Live sessions</h2></summary>
      <p className="k-small k-muted">Learn one goal step by step with your model as the teacher: it first finds your level (at most {KP().BUDGET} questions), proposes a plan map that you accept or change, then teaches one reasoning step per turn: you predict, it explains, you apply it in a check, and a miss is repaired before anything is built on it. You can pause and resume at any time. Nothing here goes to your reviews.</p>
      {!mr.ready ? <NoModelNote what="live sessions (the strong slot)" /> : form ? <NewSession close={() => setForm(false)} /> : <Btn kind="primary" onClick={() => setForm(true)}><Plus size={16} weight="bold" aria-hidden="true" />Start live session</Btn>}
      {list.length > 0 && (
        <ul className="lv-list">
          {list.map((s) => {
            const sum = KL().summary(s);
            return (
              <li key={s.id}>
                <b>{s.title}</b>
                <span className="k-small k-muted">{STEP[s.status] || s.status}{sum.steps ? " · " + sum.steps + " step" + (sum.steps === 1 ? "" : "s") : ""} · {s.attached ? "study: " + (((S.etuts[s.attached.etut_id] || {}).package || {}).title || s.attached.etut_id) : (s.files || []).length ? "my files" : "free"} · {new Date(s.updated_at).toLocaleDateString()}</span>
                <Btn size="sm" onClick={() => openSession(s.id)}>{s.status === "done" ? "Open" : s.status === "paused" ? "Resume" : "Continue"}<ArrowRight size={14} weight="bold" aria-hidden="true" /></Btn>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

// Creates a session; used by the library form and by "Study this topic live" (Learn & digest)
export function createSession({ goal, et, kids, files }) {
  const S = App().S;
  const s = PL().newSession(S, { title: goal, goal_words: goal, attached: et ? { etut_id: et.etut_id, topics: kids } : null, now: Date.now() });
  if (files) s.files = files;
  s.probe = KP().newProbe({ mode: "live", session_id: s.id, goal_words: goal, scope: et ? { kind: "topics", kids } : null, strands: et ? KP().strandsFor(et.package, { kind: "topics", kids }) : [] });
  return s;
}

function NewSession({ close }) {
  const S = App().S, studies = studyOptions();
  const [goal, setGoal] = useState("");
  const [src, setSrc] = useState("words");
  const [attach, setAttach] = useState("");
  const [kids, setKids] = useState([]);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const et = src === "study" && attach ? S.etuts[attach] : null;
  const ok = goal.trim().length >= 3 && (src === "words" || (src === "study" && et && kids.length > 0) || (src === "files" && picked.length > 0)) && !busy;
  const pick = async () => {
    const r = await window.kartotek.jobs.pickFiles("sources");
    if (r && r.ok && r.value.length) setPicked(r.value);
  };
  const create = async () => {
    setErr("");
    if (src === "files") {
      setBusy("Reading your files on this PC…");
      const s = createSession({ goal });
      const r = await window.kartotek.live.readFiles(s.id, picked.map((p) => p.token));
      setBusy("");
      if (!r || !r.ok) { delete S.sessions[s.id]; setErr((r && r.error) || "The files could not be read."); return; }
      s.files = r.value.files.map((x) => ({ id: x.id, name: x.name, sha256: x.sha256, unit: x.unit, pages: x.pages, unreadable: x.unreadable }));
      openSession(s.id);
      commit();
      return;
    }
    const s = createSession({ goal, et, kids });
    openSession(s.id);
    commit();
  };
  return (
    <div className="pb">
      <label className="k-field">
        <span className="k-field-label">What do you want to be able to do at the end?</span>
        <textarea className="k-input" rows={2} value={goal} maxLength={600} placeholder="In your own words. The probe will make it concrete." onChange={(e) => setGoal(e.target.value)} />
      </label>
      <div className="k-field">
        <span className="k-field-label">Grounded in</span>
        <Seg label="live-source" value={src} onChange={(v) => { setSrc(v); setErr(""); }} options={[{ value: "words", label: "Nothing: my own topic" }, { value: "files", label: "My own files" }, { value: "study", label: "A study" }]} />
        <span className="k-field-hint">{src === "study" ? "The teacher uses only the chosen topics' source units and cites their pages. Exam topics (CEnT-S, TU Delft) belong here, attached to their study."
          : src === "files" ? "PDF, PowerPoint (.pptx), Word (.docx) or text, read on this PC. The teacher uses their pages and cites them; only the file names and fingerprints are saved with your data."
          : "A free session has no source to check against: everything it writes is the model's own, and it must say when it is unsure."}</span>
      </div>
      {src === "study" && (
        <>
          <select className="k-input" value={attach} onChange={(e) => { setAttach(e.target.value); setKids([]); }} aria-label="Study">
            <option value="">Choose a study…</option>
            {studies.map((x) => <option key={x.etut_id} value={x.etut_id}>{x.package.title}</option>)}
          </select>
          {et && (
            <div className="lv-topics" role="group" aria-label="Topics">
              {et.package.parts.map((p, pi) => (p.kazanimlar || []).map((k) => (
                <label key={k.kazanim_id}><input type="checkbox" checked={kids.indexOf(k.kazanim_id) >= 0} onChange={(e) => setKids(e.target.checked ? kids.concat(k.kazanim_id) : kids.filter((x) => x !== k.kazanim_id))} />
                  <span><span className="k-muted">Part {pi + 1} ·</span> {k.title}</span></label>
              )))}
            </div>
          )}
        </>
      )}
      {src === "files" && (
        <div className="cy-actions">
          <Btn size="sm" onClick={pick}><Files size={15} aria-hidden="true" />Choose files…</Btn>
          {picked.length > 0 && <span className="k-small">{picked.map((p) => p.name).join(", ")}</span>}
        </div>
      )}
      {busy && <p className="k-small k-muted">{busy}</p>}
      {err && <p className="k-lvl" data-l="warn" role="alert">{err}</p>}
      <div className="cy-actions"><Btn kind="primary" disabled={!ok} onClick={create}>Start with the probe<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn><Btn onClick={close}>Cancel</Btn></div>
    </div>
  );
}

// The cached text of the learner's files (own-files sessions): loaded once per session screen
function useMaterial(s) {
  const [st, setSt] = useState({ loading: !!(s.files && s.files.length), material: null, missing: false });
  useEffect(() => {
    if (!(s.files && s.files.length) || !window.kartotek || !window.kartotek.live) { setSt({ loading: false, material: null, missing: !!(s.files && s.files.length) }); return; }
    let alive = true;
    window.kartotek.live.material(s.id).then((r) => { if (alive) setSt({ loading: false, material: r && r.ok ? r.value : null, missing: !(r && r.ok && r.value) }); });
    return () => { alive = false; };
  }, [s.id]);
  return st;
}

// One session: probe, plan, teaching
export default function Live({ session: s }) {
  const S = App().S;
  const et = s.attached ? S.etuts[s.attached.etut_id] : null, pkg = et && et.package;
  const mat = useMaterial(s);
  const shown = s.status === "paused" ? s.paused_from || "teach" : s.status;
  const steps = ["probe", "plan", "teach", "done"], at = steps.indexOf(shown === "review" ? "teach" : shown);
  const back = App().liveBack;
  const sum = KL().summary(s);
  const material = mat.material, filesText = material ? KL().fileOutline(material) : undefined;
  return (
    <div className="k-page st-page">
      <div className="st-run-head">
        <Btn size="sm" onClick={() => { App().liveOpen = null; if (back) { App().etutOpen = back; App().liveBack = null; } App().render(); }}><CaretLeft size={15} weight="bold" aria-hidden="true" />{back ? "Back to the study" : "Studies"}</Btn>
        <div className="st-run-title">
          <h1>{s.title}</h1>
          <p className="k-small k-muted">Live session · {pkg ? "attached to " + pkg.title : (s.files || []).length ? "my files: " + s.files.map((f) => f.name).join(", ") : "free"}{sum.steps ? " · " + sum.steps + " step" + (sum.steps === 1 ? "" : "s") : ""}{s.usage && s.usage.calls ? " · " + s.usage.calls + " model call" + (s.usage.calls === 1 ? "" : "s") + (s.usage.cost_usd ? " · $" + s.usage.cost_usd.toFixed(4) : "") : ""}</p>
        </div>
        <ol className="lv-steps" aria-label="Session steps">{steps.map((x, i) => <li key={x} data-on={i === at ? "1" : undefined} data-done={i < at ? "1" : undefined}>{i < at ? <Check size={12} weight="bold" aria-hidden="true" /> : null} {STEP[x]}</li>)}</ol>
        {s.status !== "done" && (s.status === "paused"
          ? <Btn size="sm" kind="primary" onClick={() => { KL().resume(s, Date.now()); commit(); }}><Play size={15} aria-hidden="true" />Resume</Btn>
          : <Btn size="sm" onClick={() => { KL().pause(s, Date.now()); commit(); }} title="Everything so far is saved; resume from the Study library or here, also after a restart."><Pause size={15} aria-hidden="true" />Pause</Btn>)}
      </div>
      <div className="cy-col">
        {mat.missing && <p className="k-lvl" data-l="warn" role="alert"><FileText size={14} aria-hidden="true" /> The text of this session's files is not on this PC any more ({(s.files || []).map((f) => f.name).join(", ")}). The transcript is safe; the teacher needs the files again to continue. Start a new session on the same files, or ask for this to be added if you need it often.</p>}
        {mat.loading && <p className="k-small k-muted">Loading your files…</p>}
        {s.status === "paused" && (
          <section className="k-panel k-sec pb">
            <p className="cy-kicker"><Pause size={14} aria-hidden="true" />Paused</p>
            <p className="k-small">Paused {s.paused_at ? new Date(s.paused_at).toLocaleString() : ""}. Everything up to here is saved. Resume to continue where you left off.</p>
            <div className="cy-actions"><Btn kind="primary" onClick={() => { KL().resume(s, Date.now()); commit(); }}><Play size={15} aria-hidden="true" />Resume</Btn></div>
          </section>
        )}
        {s.status === "probe" && !mat.loading && !mat.missing && <Probe probe={s.probe} ctx={{ pkg, material: filesText }} title="Live session · finding your level" onSave={commit} onDone={() => { PL().probeDone(s, Date.now()); commit(); }} />}
        {s.status !== "probe" && s.probe && <details className="k-panel k-sec"><summary className="k-small"><b>What the probe found:</b> {(s.probe.result || {}).closing || ""}</summary><ProbeResult probe={s.probe} title="The probe" onChange={commit} /></details>}
        {s.status === "plan" && !mat.loading && <PlanStep s={s} pkg={pkg} filesText={filesText} />}
        {(s.status === "teach" || s.status === "review" || s.status === "done") && !mat.loading && <LiveTeach s={s} pkg={pkg} material={material} blocked={mat.missing} commit={commit} />}
      </div>
    </div>
  );
}

function PlanStep({ s, pkg, filesText }) {
  const call = useModelCall();
  const [view, setView] = useState(null);
  const [sel, setSel] = useState(null);
  const [change, setChange] = useState("");
  const [asking, setAsking] = useState(false);
  const cur = PL().currentPlan(s);
  const draft = async (changeRequest, reason) => {
    let problems = [], last = "The plan could not be used.";
    const units = pkg ? PL().unitSet(pkg) : null;
    for (let n = 0; n < 2; n++) {
      const vars = PL().plannerInputs(s, { material: pkg ? PL().attachedMaterial(pkg, s.attached.topics) : filesText, change_request: changeRequest, problems });
      const r = await call.run("planner", vars, { feature: "planner", maxOutputTokens: 6000 });
      if (!r.ok) return;
      const pr = PL().checkPlan(r.json, { units });
      if (!pr.length) {
        PL().addPlanVersion(s, r.json, { reason, change_request: changeRequest, meta: r.meta, prompt: r.prompt, now: Date.now() });
        PL().countCall(s, r.meta, Date.now());
        s.status = "plan";
        setView(null); setChange(""); setAsking(false);
        commit();
        return;
      }
      problems = pr; last = "The model's plan failed Kartotek's checks: " + pr.join(" ");
    }
    call.fail(last);
  };
  useEffect(() => { if (s.status === "plan" && !s.plan && !call.busy && !call.error) draft("", "first"); }, [s.id, s.status]);
  if (!cur) return <section className="k-panel k-sec pb"><p className="cy-kicker">Your plan map</p><CallStatus call={call} />{!call.busy && call.error && <Btn size="sm" onClick={() => draft("", "first")}>Try again</Btn>}{call.busy ? null : !call.error && <p className="k-small k-muted">Drawing the plan…</p>}</section>;
  const vi = view == null ? s.plan.current : view, v = s.plan.versions[vi], map = PL().liveMap(s, vi);
  const node = sel && v.nodes.filter((n) => n.id === sel)[0];
  const units = {};
  if (pkg) (pkg.units || []).forEach((u) => { units[u.id] = u; });
  const accepted = !!(cur && cur.accepted_at);
  return (
    <section className="k-panel k-sec pm">
      <div className="pb-head">
        <p className="cy-kicker"><MapPin size={14} aria-hidden="true" />Your plan map{s.plan.versions.length > 1 ? " · version " + (vi + 1) + " of " + s.plan.versions.length : ""}</p>
        {s.plan.versions.length > 1 && (
          <div className="lv-versions">
            {s.plan.versions.map((x, i) => <Btn key={i} size="sm" aria-pressed={i === vi} onClick={() => setView(i)} title={x.reason === "gap" ? x.change_request : x.change_request || "first draft"}>{i + 1}{x.reason === "gap" ? " · gap" : x.reason === "change" ? " · changed" : ""}</Btn>)}
          </div>
        )}
      </div>
      <p className="lv-approach">{v.approach}</p>
      {v.change_request && <p className="k-small k-muted">{v.reason === "gap" ? "Redrawn: " : "Your request: "}{v.change_request.split("\n\nThe current map")[0]}</p>}
      <GraphView nodes={map.nodes} edges={map.edges} statuses={LIVE_STATUS} layout="layers" selected={sel} onSelect={setSel} height={400} ariaLabel={"Plan map: " + s.title} />
      {node && (
        <div className="pm-detail">
          <h4>{node.label}</h4>
          <p className="k-small k-muted">{LIVE_STATUS[node.kind === "held" ? "held" : node.kind === "goal" ? "goal" : "learn"].label}{node.mode ? " · " + node.mode : ""}{node.depends_on.length ? " · needs " + node.depends_on.map((d) => (v.nodes.filter((x) => x.id === d)[0] || {}).label || d).join(", ") : ""}</p>
          {node.why && <p className="k-small">{node.why}</p>}
          {node.units.length > 0 && <p className="k-small k-muted">Source: {node.units.map((u) => (units[u] ? u + " (" + (units[u].loc || "") + ")" : u)).join(", ")}</p>}
          {vi === s.plan.current && s.plan.position !== node.id && <Btn size="sm" onClick={() => { PL().setPosition(s, node.id, Date.now()); commit(); }}><MapPin size={14} aria-hidden="true" />I am here</Btn>}
        </div>
      )}
      {v.uncertain.length > 0 && <div className="k-small"><b>To check before teaching:</b><ul>{v.uncertain.map((u, i) => <li key={i}>{u}</li>)}</ul></div>}
      {v.by && v.by.provider && <p className="k-small k-muted">Drawn by {byLine({ provider: v.by.provider, model: v.by.model, cost_kind: v.by.cost_kind, cost_usd: v.by.cost_usd })}. Generated, not verified.</p>}
      <CallStatus call={call} />
      {vi === s.plan.current && (
        <div className="cy-actions">
          {!accepted && <Btn kind="primary" disabled={call.busy} onClick={() => { PL().acceptPlan(s, Date.now()); commit(); }}><Check size={16} weight="bold" aria-hidden="true" />Accept this plan</Btn>}
          {accepted && (s.steps || []).length > 0 && <Btn kind="primary" disabled={call.busy} onClick={() => { s.status = "teach"; commit(); }}>Back to teaching</Btn>}
          {!asking && <Btn disabled={call.busy} onClick={() => setAsking(true)}><PencilSimple size={15} aria-hidden="true" />Ask for changes</Btn>}
        </div>
      )}
      {asking && (
        <div className="pb">
          <label className="k-field">
            <span className="k-field-label">What should change?</span>
            <textarea className="k-input" rows={2} value={change} maxLength={1500} placeholder="For example: I already know X; spend more on Y; start from Z." onChange={(e) => setChange(e.target.value)} />
          </label>
          <div className="cy-actions"><Btn kind="primary" disabled={call.busy || change.trim().length < 3} onClick={() => draft(change.trim(), "change")}>Redraw the plan</Btn><Btn onClick={() => setAsking(false)}>Cancel</Btn></div>
        </div>
      )}
    </section>
  );
}
