// The probe runner (task F3, LEARNING-PROTOCOL 3.5): "Find my level" in Priming and the first step of a live session.
// One multiple-choice question at a time, each chosen from the previous answer, its confidence and the thinking text (src/probe-core.js
// keeps the brackets and grades; prompts\prober.md writes the questions). No right/wrong feedback during the probe: it measures, it does
// not teach. Nothing here reaches the scheduler; the questions are stored as generated, unverified material with the probe record.
import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, StopCircle, ArrowClockwise, Target, CheckCircle, Info } from "@phosphor-icons/react";
import { Btn } from "../kit.jsx";
import { Md } from "./common.jsx";
import ConfidenceSlider from "./ConfidenceSlider.jsx";
import Thinking from "./Thinking.jsx";
import { useModelCall, CallStatus, byLine } from "../../model-call.jsx";
import { EASE, DUR } from "../../motion.jsx";
import "./probe.css";

const KP = () => window.KProbe;

export const STRAND_STATUS = {
  held: { label: "Held", tone: "held" }, edge: { label: "Edge found", tone: "edge" }, missing: { label: "Not held yet", tone: "missing" }, open: { label: "Not located", tone: "open" },
};

// probe: the record (mutated in place, then onSave()); ctx: { pkg, material }; onDone(result) when it ends
export default function Probe({ probe, ctx, onSave, onDone, title }) {
  const call = useModelCall();
  const reduce = useReducedMotion();
  const ph = KP().phase(probe);
  const [, bump] = useState(0);
  const tries = useRef(0);
  const inflight = useRef(false);
  const save = () => { probe.updated_at = Date.now(); onSave(); bump((x) => x + 1); };

  // one request at a time, whatever re-renders happen meanwhile
  const ask = async () => {
    if (inflight.current) return;
    inflight.current = true;
    try { await askOnce(); } finally { inflight.current = false; }
  };
  const askOnce = async () => {
    let problems = [], last = "The question could not be used.";
    for (let n = 0; n < 2; n++) {
      const r = await call.run("prober", KP().proberInputs(probe, { pkg: ctx.pkg, material: ctx.material, problems }), { feature: "prober", maxOutputTokens: 4000 });
      if (!r.ok) return;
      const c = KP().checkReply(probe, r.json);
      if (c.ok) {
        KP().applyReply(probe, r.json, { now: Date.now(), meta: r.meta, prompt: r.prompt });
        if (KP().phase(probe) === "done") finish(false);
        else save();
        return;
      }
      problems = c.problems; last = "The model's question failed Kartotek's checks: " + c.problems.join(" ");
    }
    call.fail(last);
  };
  const finish = (stopped) => {
    const res = KP().finish(probe, Date.now(), stopped);
    save();
    if (onDone) onDone(res);
  };
  // the next step starts by itself once the learner has answered (never after an error: then "Try again")
  useEffect(() => {
    if ((ph === "goal" || ph === "strands" || ph === "question") && !call.busy && !call.error && tries.current < 60) { tries.current++; ask(); }
    if (ph === "done" && probe.status !== "done" && probe.status !== "stopped") finish(false);
  }, [ph, probe.updated_at, call.error]);

  if (probe.status === "done" || probe.status === "stopped") return <ProbeResult probe={probe} title={title} onChange={save} />;
  const pend = KP().pending(probe);
  const n = KP().asked(probe);
  return (
    <section className="k-panel k-sec pb" aria-live="polite">
      <div className="pb-head">
        <p className="cy-kicker"><Target size={14} aria-hidden="true" />{title || "Find my level"}</p>
        <span className="k-small k-muted k-num">Question {Math.max(1, n)} of at most {probe.budget}</span>
        <Btn size="sm" onClick={() => finish(true)} disabled={call.busy && !pend} title="Ends the probe now; what was found so far is kept."><StopCircle size={15} aria-hidden="true" />Stop here</Btn>
      </div>
      <StrandStrip probe={probe} />
      {/* the next question replaces the last one at once and slides in over it; nothing waits for an exit animation */}
      <motion.div key={pend ? pend.q.id : "wait-" + n} initial={reduce ? false : { opacity: 0.001, x: 14 }} animate={{ opacity: 1, x: 0 }}
          transition={{ duration: reduce ? 0 : DUR.ui, ease: EASE.travel }}>
          {pend && pend.kind === "goal" && <GoalQuestion probe={probe} g={pend.q} onAnswered={save} />}
          {pend && pend.kind === "question" && <ProbeQuestion probe={probe} q={pend.q} onAnswered={save} />}
          {!pend && (
            <div className="pb-wait">
              <CallStatus call={call} />
              {!call.busy && call.error && <Btn size="sm" onClick={() => { tries.current = 0; ask(); }}><ArrowClockwise size={15} aria-hidden="true" />Try again</Btn>}
              {!call.busy && !call.error && <p className="k-small k-muted">Preparing the next question…</p>}
            </div>
          )}
      </motion.div>
      <p className="k-small k-muted pb-note"><Info size={13} aria-hidden="true" />These questions are written by your model for this probe (not verified). There is no score, nothing goes to your reviews, and you get no right or wrong until the end: the probe only looks for where your knowledge ends.</p>
    </section>
  );
}

function StrandStrip({ probe }) {
  if (!probe.strands.length) return null;
  const res = KP().result(probe);
  return (
    <ol className="pb-strands" aria-label="Strands">
      {res.strands.map((r) => (
        <li key={r.strand} data-tone={r.located ? STRAND_STATUS[r.status].tone : "open"} title={r.label + ": " + (r.located ? STRAND_STATUS[r.status].label.toLowerCase() : "still open") + " (" + r.asked + " question" + (r.asked === 1 ? "" : "s") + ")"}>
          <span className="pb-dot" aria-hidden="true" />{r.label}
          {r.located && <CheckCircle size={13} weight="fill" aria-label="located" />}
        </li>
      ))}
    </ol>
  );
}

function GoalQuestion({ probe, g, onAnswered }) {
  const [pick, setPick] = useState(null);
  const [other, setOther] = useState("");
  const go = () => {
    try { KP().answerGoal(probe, g.id, pick === "other" ? { other } : { choice: pick }, Date.now()); onAnswered(); } catch (e) { window.App.toast(e.message); }
  };
  return (
    <div className="pb-q">
      <p className="pb-kind k-small">First, your goal</p>
      <Md src={g.stem} className="pb-stem st-md" />
      <div className="pb-opts" role="radiogroup" aria-label="Your goal">
        {g.options.map((o, i) => (
          <label key={i} className="pb-opt" data-on={pick === i ? "1" : undefined}>
            <input type="radio" name={"goal-" + g.id} checked={pick === i} onChange={() => setPick(i)} /><Md src={o} as="span" />
          </label>
        ))}
        <label className="pb-opt" data-on={pick === "other" ? "1" : undefined}>
          <input type="radio" name={"goal-" + g.id} checked={pick === "other"} onChange={() => setPick("other")} /><span>Something else</span>
        </label>
        {pick === "other" && <input className="k-input" autoFocus value={other} maxLength={400} placeholder="What do you want to be able to do at the end?" onChange={(e) => setOther(e.target.value)} />}
      </div>
      <div className="cy-actions"><Btn kind="primary" disabled={pick == null || (pick === "other" && !other.trim())} onClick={go}>Continue<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn></div>
    </div>
  );
}

function ProbeQuestion({ probe, q, onAnswered }) {
  const [choice, setChoice] = useState(null);
  const [conf, setConf] = useState(null);
  const [dk, setDk] = useState(false);
  const [thinking, setThinking] = useState("");
  const s = probe.strands.filter((x) => x.id === q.strand)[0];
  const lvl = s ? s.levels.filter((l) => l.id === q.level)[0] : null;
  const ready = dk || (choice != null && conf != null);
  const go = () => {
    try { KP().answer(probe, q.id, { choice, confidence_pct: conf, dont_know: dk, thinking }, Date.now()); onAnswered(); } catch (e) { window.App.toast(e.message); }
  };
  return (
    <div className="pb-q">
      <p className="pb-kind k-small">{s ? s.label : q.strand}{lvl ? " · " + lvl.label : ""}{q.intent === "dig" ? " · looking closer" : q.intent === "confirm" ? " · once more" : ""}</p>
      <Md src={q.stem} className="pb-stem st-md" />
      <div className="pb-opts" role="radiogroup" aria-label="Options">
        {q.options.map((o) => (
          <label key={o.id} className="pb-opt" data-on={choice === o.id && !dk ? "1" : undefined}>
            <input type="radio" name={"q-" + q.id} disabled={dk} checked={choice === o.id && !dk} onChange={() => setChoice(o.id)} />
            <span className="pb-letter k-num">{o.id.toUpperCase()}</span><Md src={o.text} as="span" />
          </label>
        ))}
      </div>
      <ConfidenceSlider value={conf} onChange={(v) => { setConf(v); setDk(false); }} dontKnow={dk} onDontKnow={() => setDk(!dk)} />
      <Thinking value={thinking} onChange={setThinking} placeholder="How did you decide? What did you rule out? The probe reads this to choose the next question." />
      <div className="cy-actions">
        <Btn kind="primary" disabled={!ready} onClick={go}>Answer<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn>
        {!ready && <span className="k-small k-muted">{choice == null && !dk ? "Choose an option, or I don't know." : "Set how sure you are."}</span>}
      </div>
    </div>
  );
}

// The result per strand: what is held, where it ends, misunderstandings seen
export function ProbeResult({ probe, title, compact, onChange }) {
  const res = probe.result || KP().result(probe);
  const cost = (probe.generator || []).reduce((a, g) => a + (typeof g.cost_usd === "number" ? g.cost_usd : 0), 0);
  const by = (probe.generator || []).slice(-1)[0];
  const [openQ, setOpenQ] = useState(false);
  return (
    <section className={"k-panel k-sec pb pb-res" + (compact ? " compact" : "")}>
      <div className="pb-head">
        <p className="cy-kicker"><Target size={14} aria-hidden="true" />{title || "Find my level"} · {probe.source === "self" ? "your own rating" : "result"}</p>
        <span className="k-small k-muted">{probe.source === "self" ? "no model" : res.asked + " question" + (res.asked === 1 ? "" : "s") + (probe.status === "stopped" ? ", stopped early" : "")}</span>
      </div>
      {res.goal && <p className="k-small"><b>Goal:</b> {res.goal}</p>}
      <p className="pb-closing">{res.closing || "Nothing was located."}</p>
      <ol className="pb-rows">
        {res.strands.map((r, i) => (
          <motion.li key={r.strand} data-tone={STRAND_STATUS[r.status].tone} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.ui, ease: EASE.arrive, delay: i * 0.05 }}>
            <div className="pb-row-head"><span className="pb-dot" aria-hidden="true" /><b>{r.label}</b><span className="pb-chip">{STRAND_STATUS[r.status].label}{r.inferred ? " (inferred)" : ""}</span></div>
            <dl className="pb-dl k-small">
              <div><dt>Holds up to</dt><dd>{r.held_up_to ? r.held_up_to.label : r.inferred ? "not asked: every strand it builds on is not held yet" : "nothing found yet"}</dd></div>
              <div><dt>Ends at</dt><dd>{r.first_miss ? r.first_miss.label : r.status === "held" ? "no miss: every level held" : "not found"}</dd></div>
              {r.misconceptions.length > 0 && <div><dt>Misunderstandings seen</dt><dd><ul>{r.misconceptions.map((m, j) => <li key={j}>{m}</li>)}</ul></dd></div>}
              {r.fragile.length > 0 && <div><dt>Shaky</dt><dd>{r.fragile.join(", ")}</dd></div>}
              {r.gaps.length > 0 && <div><dt>Missed below the floor</dt><dd>{r.gaps.join(", ")}</dd></div>}
            </dl>
          </motion.li>
        ))}
      </ol>
      {probe.source !== "self" && (probe.questions || []).length > 0 && (
        <details className="k-small pb-qs" onToggle={(e) => setOpenQ(e.currentTarget.open)}>
          <summary>The questions and your answers</summary>
          {openQ && (
            <ol>
              {probe.questions.map((q) => {
                const a = q.answer, o = (id) => (q.options.filter((x) => x.id === id)[0] || {}).text || id;
                return (
                  <li key={q.id} data-disputed={q.disputed ? "1" : undefined}>
                    <Md src={q.stem} className="st-md" />
                    <ul className="pb-q-opts">{q.options.map((x) => <li key={x.id} data-key={x.id === q.key ? "1" : undefined}><b>{x.id.toUpperCase()}</b> <Md src={x.text} as="span" /></li>)}</ul>
                    <p className="k-muted">{a ? (a.dont_know ? "You chose I don't know." : "You chose " + a.choice.toUpperCase() + " (" + a.confidence_pct + " %): " + (q.correct ? "right" : "not right; the key was " + q.key.toUpperCase() + ": " + o(q.key))) : "Not answered."}</p>
                    {q.disputed && <p className="k-lvl" data-l="warn">You reported this key as wrong{q.disputed.note ? ": " + q.disputed.note : ""}. It is left out of the result.</p>}
                    {onChange && a && <DisputeBtn probe={probe} q={q} onChange={onChange} />}
                  </li>
                );
              })}
            </ol>
          )}
        </details>
      )}
      {by && by.provider && <p className="k-small k-muted">Questions by {byLine({ provider: by.provider, model: by.model, cost_kind: by.cost_kind, cost_usd: cost || null })}. Generated, not verified; never sent to your reviews.</p>}
    </section>
  );
}

// "The key is wrong": a generated key is not verified, so the learner may report it after the probe; the question leaves the result
function DisputeBtn({ probe, q, onChange }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (q.disputed) return <Btn size="sm" onClick={() => { KP().undispute(probe, q.id, Date.now()); onChange(); }}>Withdraw my report</Btn>;
  if (!open) return <Btn size="sm" onClick={() => setOpen(true)} title="A generated key is not verified. Reporting it leaves this question out of the result; the record is kept.">The key is wrong</Btn>;
  return (
    <div className="cy-actions">
      <input className="k-input" value={note} maxLength={600} placeholder="What is wrong with it? (optional)" onChange={(e) => setNote(e.target.value)} />
      <Btn size="sm" kind="primary" onClick={() => { KP().dispute(probe, q.id, note, Date.now()); setOpen(false); onChange(); }}>Report</Btn>
      <Btn size="sm" onClick={() => setOpen(false)}>Cancel</Btn>
    </div>
  );
}
