// "Find my level" and the personal plan map of a packaged study (task F3, LEARNING-PROTOCOL 3.5, 3.6), shown in Priming.
// The map is computed from the package (topic order, part prerequisites, relations; src/plan-core.js) and coloured by the latest probe;
// a topic the probe found held may be skipped by the learner's choice: it stays in the navigator, counts as complete for opening End and
// stays in the final test (decision D5). Without a model, "Find my level" is a self-rating list stored the same way (source "self").
import React, { useState } from "react";
import { Target, MapTrifold, ArrowRight, ArrowCounterClockwise, SkipForward } from "@phosphor-icons/react";
import { Btn, Seg } from "../kit.jsx";
import GraphView from "../../graph/GraphView.jsx";
import Probe, { ProbeResult } from "./Probe.jsx";
import { useModelReady, NoModelNote } from "../../model-call.jsx";
import { A, KC, save, extrasOf } from "./cycle/lib.js";
import "./probe.css";

const KP = () => window.KProbe;
const PL = () => window.KPlan;

export const TOPIC_STATUS = {
  held: { label: "held", tone: "held" },
  edge: { label: "first miss: start here", tone: "edge" },
  missing: { label: "not held yet", tone: "missing" },
  fragile: { label: "shaky", tone: "gap" },
  gap: { label: "missed below the floor", tone: "gap" },
  gap_found: { label: "gap found in Applying", tone: "edge" },
  open: { label: "not probed", tone: "open" },
};

export function FindMyLevel({ et }) {
  const pkg = et.package, pr = et.progress, part = pkg.parts[pr.part];
  const mr = useModelReady("strong");
  const [scope, setScope] = useState("part");
  const [self, setSelf] = useState(false);
  const open = PL().openProbe(et), last = PL().lastProbe(et);
  const scopeOf = () => (scope === "study" ? { kind: "study" } : { kind: "part", part_id: part.part_id });
  const start = () => {
    const sc = scopeOf();
    const p = KP().newProbe({ mode: "packaged", scope: sc, strands: KP().strandsFor(pkg, sc), etut_id: et.etut_id,
      goal_words: "Study \"" + pkg.title + "\"" + (sc.kind === "part" ? ", part \"" + part.title + "\" and what it builds on" : ", the whole study") });
    PL().addProbe(et, p);
    save(et);
  };
  if (open) return <Probe probe={open} ctx={{ pkg }} onSave={() => save(et)} onDone={() => save(et)} />;
  if (self) return <SelfRating et={et} scope={scopeOf()} close={() => setSelf(false)} />;
  return (
    <section className="k-panel k-sec pb">
      <div className="pb-head"><p className="cy-kicker"><Target size={14} aria-hidden="true" />Find my level (optional)</p></div>
      <p className="k-small">A short adaptive check before you study: at most {KP().BUDGET} multiple-choice questions, each chosen from your last answer, how sure you were and your thinking. For each part it finds what you already hold and where it ends, so the plan map can show which topics you may skip. No score, no gate, nothing goes to your reviews.</p>
      <div className="pm-scope">
        <Seg value={scope} onChange={setScope} label="What to check" options={[{ value: "part", label: "This part and what it builds on" }, { value: "study", label: "The whole study" }]} />
        {mr.ready ? <Btn kind="primary" onClick={start}><Target size={16} aria-hidden="true" />{last ? "Find my level again" : "Find my level"}</Btn> : null}
        <Btn size="sm" onClick={() => setSelf(true)} title="No model needed: say for each topic whether you can already do it.">Rate myself instead</Btn>
      </div>
      {!mr.ready && <NoModelNote what="Find my level (the strong slot); you can rate yourself instead" />}
      {last && <ProbeResult probe={last} title="Last check" onChange={() => save(et)} />}
    </section>
  );
}

function SelfRating({ et, scope, close }) {
  const strands = KP().strandsFor(et.package, scope);
  const [r, setR] = useState({});
  const ok = () => {
    const p = KP().selfProbe({ mode: "packaged", scope, strands, etut_id: et.etut_id, goal_words: "Study \"" + et.package.title + "\"" }, r, Date.now());
    PL().addProbe(et, p);
    save(et);
    close();
  };
  return (
    <section className="k-panel k-sec pb">
      <div className="pb-head"><p className="cy-kicker"><Target size={14} aria-hidden="true" />Find my level · rate yourself</p></div>
      <p className="k-small">For each topic: can you already do what it asks, without notes? This is your own judgement, stored as such; the plan map uses it like a probe.</p>
      {strands.map((s) => (
        <div key={s.id} className="pm-self">
          <h4 className="cy-h3">{s.label}</h4>
          {s.levels.map((l) => (
            <div key={l.id} className="pm-self-row">
              <span className="k-small"><b>{l.label}</b><br /><span className="k-muted">{l.detail.split(" Criteria:")[0]}</span></span>
              <Seg value={r[l.id] || null} onChange={(v) => setR({ ...r, [l.id]: v })} label={l.label} options={[{ value: "yes", label: "Yes" }, { value: "unsure", label: "Not sure" }, { value: "no", label: "No" }]} />
            </div>
          ))}
        </div>
      ))}
      <div className="cy-actions"><Btn kind="primary" disabled={!Object.keys(r).length} onClick={ok}>Save my rating</Btn><Btn onClick={close}>Cancel</Btn></div>
    </section>
  );
}

// The study's plan map: parts as columns read from the bottom up, coloured by the probe, "you are here" on the current topic
export function PlanMapPanel({ et, open: startOpen }) {
  const K = KC(), pkg = et.package;
  const map = PL().packagedMap(et, extrasOf(et));
  const [sel, setSel] = useState(null);
  const groups = pkg.parts.map((p, i) => ({ id: p.part_id, label: "Part " + (i + 1) }));
  const nodes = map.nodes.map((n) => ({ ...n, group: n.part_id, sub: n.done && !n.skipped ? "cycle complete" : "" }));
  const node = sel && map.nodes.filter((n) => n.id === sel)[0];
  const jump = (kid) => {
    pkg.parts.forEach((p, pi) => (p.kazanimlar || []).forEach((k, ti) => { if (k.kazanim_id === kid) K.goto(et, pi, ti, "priming"); }));
    save(et);
  };
  const doSkip = (kid) => { try { PL().skip(et, kid, Date.now()); save(et); } catch (e) { A().toast(e.message); } };
  const undo = (kid) => { PL().unskip(et, kid); save(et); };
  return (
    <details className="k-panel k-sec pm" open={startOpen}>
      <summary className="cy-kicker"><MapTrifold size={14} aria-hidden="true" /> Your plan map</summary>
      <p className="k-small k-muted">{map.probed
        ? "Every topic of the study, foundations at the bottom of each part. Colours come from Find my level and change when Applying shows a gap. Click a topic for details; a topic found held can be skipped (it stays in the final test)."
        : "Every topic of the study, foundations at the bottom of each part. Run Find my level to colour what you already hold."}</p>
      <GraphView nodes={nodes} edges={map.edges} statuses={TOPIC_STATUS} layout="columns" groups={groups} selected={sel} onSelect={setSel} height={430} ariaLabel={"Plan map of " + pkg.title} />
      {node && (
        <div className="pm-detail">
          <h4>{node.label}</h4>
          <p className="k-small k-muted">{node.sub} · {TOPIC_STATUS[node.status].label}{node.skipped ? " · skipped after the probe" : ""}{node.done && !node.skipped ? " · cycle complete" : ""}
            {node.evidence.assessed ? " · Applying: " + node.evidence.independent + " of " + node.evidence.total + " outcomes without help" + (node.evidence.needs_work ? ", " + node.evidence.needs_work + " need work" : "") : ""}</p>
          {node.outcomes.length > 0 && <ul className="k-small">{node.outcomes.map((o) => <li key={o.id}>{o.performance}</li>)}</ul>}
          <div className="cy-actions">
            <Btn size="sm" onClick={() => jump(node.id)}>Open this topic<ArrowRight size={14} weight="bold" aria-hidden="true" /></Btn>
            {PL().canSkip(et, node.id) && <Btn size="sm" onClick={() => doSkip(node.id)} title="Counts as complete for opening End; the final test still checks it."><SkipForward size={14} aria-hidden="true" />Skip this topic</Btn>}
            {node.skipped && <Btn size="sm" onClick={() => undo(node.id)}><ArrowCounterClockwise size={14} aria-hidden="true" />Stop skipping</Btn>}
          </div>
        </div>
      )}
    </details>
  );
}
