// Live sessions, first half (task F3, LEARNING-PROTOCOL 1.2, 3.5, 3.6): the goal, the required probe, then the plan map that the planner
// proposes and the learner accepts or asks to change before teaching starts. Teaching itself (predict, teach, check) is task F4.
// A session is attached to a study (grounded in the chosen topics' source units; decision D12 for exam topics) or free (a topic in the
// learner's own words). Everything a model writes here is generated, unverified material in state.sessions; nothing reaches the scheduler.
import React, { useEffect, useState } from "react";
import { CaretLeft, Plus, Broadcast, Check, ArrowRight, PencilSimple, MapPin } from "@phosphor-icons/react";
import { Btn } from "../kit.jsx";
import GraphView from "../../graph/GraphView.jsx";
import Probe, { ProbeResult } from "./Probe.jsx";
import { useModelReady, useModelCall, CallStatus, NoModelNote, byLine } from "../../model-call.jsx";
import "./probe.css";

const KP = () => window.KProbe;
const PL = () => window.KPlan;
const App = () => window.App;
const commit = () => { App().store.commit({ meta: true }); App().render(); };

export const LIVE_STATUS = {
  held: { label: "you hold this", tone: "held" }, learn: { label: "to learn", tone: "learn" }, goal: { label: "the goal", tone: "goal" },
  gap_found: { label: "added: a gap found while teaching", tone: "edge" },
};
const STEP = { probe: "Probe", plan: "Plan", teach: "Teach" };

function studyOptions() {
  const S = App().S;
  return Object.keys(S.etuts || {}).map((id) => S.etuts[id]).filter((et) => et && !et.removed && et.package && window.KCycle.isV2(et.package));
}

// In the Study library: the sessions and "New live session"
export function LiveSessionsPanel() {
  const S = App().S, mr = useModelReady("strong");
  const list = PL().listSessions(S);
  const [form, setForm] = useState(false);
  return (
    <details className="k-panel k-sec" open={form || undefined}>
      <summary className="k-sec-head"><h2><Broadcast size={18} aria-hidden="true" /> Live sessions</h2></summary>
      <p className="k-small k-muted">Learn one goal with your model as a guide: it first finds your level (required, at most {KP().BUDGET} questions), then proposes a plan map from what you hold to the goal, which you accept or change before teaching starts. Teaching step by step comes with the next update. Nothing here goes to your reviews.</p>
      {!mr.ready ? <NoModelNote what="live sessions (the strong slot)" /> : form ? <NewSession close={() => setForm(false)} /> : <Btn kind="primary" onClick={() => setForm(true)}><Plus size={16} weight="bold" aria-hidden="true" />New live session</Btn>}
      {list.length > 0 && (
        <ul className="lv-list">
          {list.map((s) => (
            <li key={s.id}>
              <b>{s.title}</b>
              <span className="k-small k-muted">{STEP[s.status] || s.status}{s.attached ? " · attached to " + ((S.etuts[s.attached.etut_id] || {}).package || {}).title : " · free"} · {new Date(s.updated_at).toLocaleDateString()}</span>
              <Btn size="sm" onClick={() => { App().liveOpen = s.id; App().render(); window.scrollTo(0, 0); }}>Open<ArrowRight size={14} weight="bold" aria-hidden="true" /></Btn>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function NewSession({ close }) {
  const S = App().S, studies = studyOptions();
  const [goal, setGoal] = useState("");
  const [attach, setAttach] = useState("free");
  const [kids, setKids] = useState([]);
  const et = attach !== "free" ? S.etuts[attach] : null;
  const ok = goal.trim().length >= 3 && (!et || kids.length > 0);
  const create = () => {
    const attached = et ? { etut_id: et.etut_id, topics: kids } : null;
    const s = PL().newSession(S, { title: goal, goal_words: goal, attached, now: Date.now() });
    s.probe = KP().newProbe({ mode: "live", session_id: s.id, goal_words: goal, scope: et ? { kind: "topics", kids } : null, strands: et ? KP().strandsFor(et.package, { kind: "topics", kids }) : [] });
    App().liveOpen = s.id;
    commit();
  };
  return (
    <div className="pb">
      <label className="k-field">
        <span className="k-field-label">What do you want to be able to do at the end?</span>
        <textarea className="k-input" rows={2} value={goal} maxLength={600} placeholder="In your own words. The probe will make it concrete." onChange={(e) => setGoal(e.target.value)} />
      </label>
      <label className="k-field">
        <span className="k-field-label">Grounded in</span>
        <select className="k-input" value={attach} onChange={(e) => { setAttach(e.target.value); setKids([]); }}>
          <option value="free">Nothing: a free session on my own topic</option>
          {studies.map((x) => <option key={x.etut_id} value={x.etut_id}>A study: {x.package.title}</option>)}
        </select>
        <span className="k-field-hint">{et ? "The session uses only the chosen topics' source units and cites their pages. Exam topics (CEnT-S, TU Delft) belong here, attached to their study." : "A free session has no source to check against: everything it writes is the model's own."}</span>
      </label>
      {et && (
        <div className="lv-topics" role="group" aria-label="Topics">
          {et.package.parts.map((p, pi) => (p.kazanimlar || []).map((k) => (
            <label key={k.kazanim_id}><input type="checkbox" checked={kids.indexOf(k.kazanim_id) >= 0} onChange={(e) => setKids(e.target.checked ? kids.concat(k.kazanim_id) : kids.filter((x) => x !== k.kazanim_id))} />
              <span><span className="k-muted">Part {pi + 1} ·</span> {k.title}</span></label>
          )))}
        </div>
      )}
      <div className="cy-actions"><Btn kind="primary" disabled={!ok} onClick={create}>Start with the probe<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn><Btn onClick={close}>Cancel</Btn></div>
    </div>
  );
}

// One session: probe, then plan
export default function Live({ session: s }) {
  const S = App().S;
  const et = s.attached ? S.etuts[s.attached.etut_id] : null, pkg = et && et.package;
  const steps = ["probe", "plan", "teach"], at = steps.indexOf(s.status);
  return (
    <div className="k-page st-page">
      <div className="st-run-head">
        <Btn size="sm" onClick={() => { App().liveOpen = null; App().render(); }}><CaretLeft size={15} weight="bold" aria-hidden="true" />Studies</Btn>
        <div className="st-run-title">
          <h1>{s.title}</h1>
          <p className="k-small k-muted">Live session · {pkg ? "attached to " + pkg.title : "free"}{s.usage && s.usage.calls ? " · " + s.usage.calls + " model call" + (s.usage.calls === 1 ? "" : "s") + (s.usage.cost_usd ? " · $" + s.usage.cost_usd.toFixed(4) : "") : ""}</p>
        </div>
        <ol className="lv-steps" aria-label="Session steps">{steps.map((x, i) => <li key={x} data-on={i === at ? "1" : undefined} data-done={i < at ? "1" : undefined}>{i < at ? <Check size={12} weight="bold" aria-hidden="true" /> : null} {STEP[x]}</li>)}</ol>
      </div>
      <div className="cy-col">
        {s.status === "probe" && <Probe probe={s.probe} ctx={{ pkg }} title="Live session · finding your level" onSave={commit} onDone={() => { PL().probeDone(s, Date.now()); commit(); }} />}
        {s.status !== "probe" && s.probe && <details className="k-panel k-sec"><summary className="k-small"><b>What the probe found:</b> {(s.probe.result || {}).closing || ""}</summary><ProbeResult probe={s.probe} title="The probe" onChange={commit} /></details>}
        {s.status !== "probe" && <PlanStep s={s} pkg={pkg} />}
      </div>
    </div>
  );
}

function PlanStep({ s, pkg }) {
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
      const vars = PL().plannerInputs(s, { material: pkg ? PL().attachedMaterial(pkg, s.attached.topics) : undefined, change_request: changeRequest, problems });
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
      {accepted && s.status === "teach" && <p className="k-lvl" data-l="ok">Plan accepted. Step-by-step teaching (predict, teach, check) comes with the next update; the map will then move "You are here" and be redrawn when a check shows a missing foundation.</p>}
    </section>
  );
}
