// Step-by-step teaching in a live session (task F4, LEARNING-PROTOCOL 3.7). One reasoning step per turn:
//   Predict (you answer with thinking and confidence) → Teach (resolves your prediction; short) → "I've read it" → Check (closed, applies
//   the step; graded by Kartotek against the committed key) → a miss is repaired (taught another way, new check) before anything is
//   built on it. The plan map follows the position. src/live-core.js holds the loop; prompts\teacher.md writes each turn.
// Nothing here reaches the scheduler or the evidence states; the transcript keeps every question, answer, thinking text and confidence.
import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowClockwise, BookOpenText, CheckCircle, XCircle, Question, MapPin, Flag, Warning, MagnifyingGlass, PencilSimple, ChatCircleText } from "@phosphor-icons/react";
import { Btn, Html } from "../kit.jsx";
import { Md } from "./common.jsx";
import GraphView from "../../graph/GraphView.jsx";
import ConfidenceSlider from "./ConfidenceSlider.jsx";
import Thinking from "./Thinking.jsx";
import { useModelCall, CallStatus, byLine } from "../../model-call.jsx";
import { EASE, DUR } from "../../motion.jsx";
import SidePanel from "../../SidePanel.jsx";
import { CheckThis, useResearchStatus } from "../../research.jsx";

const KL = () => window.KLive;
const PL = () => window.KPlan;
const renderMd = (md) => window.KEtut.renderMd(md || "", {});

const STATUS = {
  held: { label: "you hold this", tone: "held" }, learn: { label: "to learn", tone: "learn" }, goal: { label: "the goal", tone: "goal" },
  taught: { label: "taught and checked", tone: "held" }, gap_found: { label: "added: a gap found while teaching", tone: "edge" },
};
const WAIT = { predict: "Preparing the next step", teach: "Writing the explanation and its check", repair: "Teaching the step another way" };

export default function LiveTeach({ s, pkg, material, blocked, commit }) {
  const call = useModelCall();
  const reduce = useReducedMotion();
  const inflight = useRef(false);
  const tries = useRef(0);
  const [, bump] = useState(0);
  const ph = KL().phase(s), need = KL().needsCall(s);
  const save = () => { commit(); bump((x) => x + 1); };
  const ctx = { pkg, material };

  const ask = async (task) => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      let problems = [], last = "The teacher's reply could not be used.";
      for (let n = 0; n < 2; n++) {
        const r = await call.run("teacher", KL().teacherInputs(s, task, Object.assign({ problems }, ctx)), { feature: "teacher", maxOutputTokens: 5000 });
        if (!r.ok) return;
        const c = KL().checkReply(s, task, r.json, ctx);
        if (c.ok) { KL().applyReply(s, task, r.json, Object.assign({ now: Date.now(), meta: r.meta, prompt: r.prompt }, ctx)); save(); return; }
        problems = c.problems; last = "The teacher's reply failed Kartotek's checks: " + c.problems.join(" ");
      }
      call.fail(last);
    } finally { inflight.current = false; }
  };
  useEffect(() => { if (need && !blocked && !call.busy && !call.error && tries.current < 80) { tries.current++; ask(need); } }, [need, s.updated_at, call.error, blocked]);

  const st = KL().lastStep(s);
  const v = PL().currentPlan(s);
  const nodeLabel = (id) => ((v && v.nodes.filter((n) => n.id === id)[0]) || {}).label || id;
  const map = PL().liveMap(s);
  return (
    <>
      <details className="k-panel k-sec pm" open>
        <summary className="cy-kicker"><MapPin size={14} aria-hidden="true" /> Your plan map{s.plan.versions.length > 1 ? " · version " + (s.plan.current + 1) : ""}</summary>
        <GraphView nodes={map.nodes} edges={map.edges} statuses={STATUS} layout="layers" height={300} ariaLabel={"Plan map: " + s.title} />
        {s.status === "teach" && <div className="cy-actions"><Btn size="sm" onClick={() => { s.status = "plan"; commit(); }} title="Opens the plan: ask for changes, then accept the new version to continue teaching."><PencilSimple size={14} aria-hidden="true" />Change the plan</Btn></div>}
      </details>

      {ph === "review" || ph === "done" ? <EndPanel s={s} commit={save} /> : (
        <section className="k-panel k-sec pb lt" aria-live="polite">
          <div className="pb-head">
            <p className="cy-kicker"><BookOpenText size={14} aria-hidden="true" />{st && !(ph === "predict") ? "Step " + st.n + " · " + nodeLabel(st.node) : "Step " + ((s.steps || []).length + 1)}</p>
            {st && st.repairs > 0 && ph !== "predict" && <span className="k-small k-muted">taught again {st.repairs} time{st.repairs === 1 ? "" : "s"}</span>}
          </div>
          {blocked && <p className="k-lvl" data-l="warn">The files are missing, so the teacher cannot continue this session.</p>}
          {need && (
            <div className="pb-wait">
              <CallStatus call={call} />
              {!call.busy && call.error && <Btn size="sm" onClick={() => { tries.current = 0; ask(need); }}><ArrowClockwise size={15} aria-hidden="true" />Try again</Btn>}
              {!call.busy && !call.error && <p className="k-small k-muted">{WAIT[need]}…</p>}
            </div>
          )}
          <motion.div key={(st ? st.n : 0) + ":" + ph} initial={reduce ? false : { opacity: 0.001, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : DUR.ui, ease: EASE.arrive }}>
            {st && ph !== "predict" && <CurrentStep s={s} st={st} ph={ph} pkg={pkg} save={save} />}
          </motion.div>
        </section>
      )}
      <Transcript s={s} pkg={pkg} nodeLabel={nodeLabel} />
      <SidePanel ctx={window.KSide.liveContext(s, st, pkg)} list={s.side || (s.side = [])} save={save} />
    </>
  );
}

// ------------------------------------------------------------------ the open step
function CurrentStep({ s, st, ph, pkg, save }) {
  const a = KL().attemptOf(st);
  const t = st.teach[st.teach.length - 1];
  return (
    <div className="lt-step">
      <div className="lt-block">
        <p className="lt-label"><Question size={14} aria-hidden="true" />Predict</p>
        <Md src={st.predict.stem} className="st-md lt-stem" />
        {ph === "answer_predict" ? <AnswerForm q={st.predict} label="Send my prediction" onSend={(ans) => { KL().answerPredict(s, ans, Date.now()); save(); }}
          thinkingHint="What do you expect, and why? The teacher starts from your reasoning." /> : <YourAnswer q={st.predict} a={st.predict.answer} graded={false} />}
      </div>
      {t && ph !== "answer_predict" && ph !== "teach" && (
        <div className="lt-block lt-teach">
          {t.resolves && <div className="lt-resolves"><b>{t.repair ? "What went wrong" : "About your prediction"}</b><Md src={t.resolves} className="st-md" /></div>}
          <Html className="st-md lt-md" html={renderMd(t.md)} />
          <Refs refs={t.refs} pkg={pkg} />
          <Unsure s={s} st={st} t={t} idx={st.teach.length - 1} save={save} />
          <CheckThis claim={String(t.md || "").split(/(?<=[.!?])\s/)[0].slice(0, 400)} context={t.md} sources={(t.refs || []).join(", ")} target={{ kind: "live", session: s.id, step: st.n, teach: st.teach.length - 1 }} editable />
          {ph === "read" && <div className="cy-actions"><Btn kind="primary" onClick={() => { KL().markRead(s, Date.now()); save(); }}>I've read it: check my understanding<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn></div>}
        </div>
      )}
      {a && a.read_at && (
        <div className="lt-block lt-check">
          <p className="lt-label"><CheckCircle size={14} aria-hidden="true" />Check your understanding{st.check.length > 1 ? " (new case)" : ""}</p>
          <Md src={a.stem} className="st-md lt-stem" />
          {ph === "answer_check" ? <AnswerForm q={a} label="Answer" onSend={(ans) => { KL().answerCheck(s, ans, Date.now()); save(); }} thinkingHint="How did you apply the step?" />
            : <Feedback a={a} ph={ph} onContinue={() => { KL().continueStep(s, Date.now()); save(); }} />}
        </div>
      )}
    </div>
  );
}

function AnswerForm({ q, label, onSend, thinkingHint }) {
  const [choice, setChoice] = useState(null);
  const [text, setText] = useState("");
  const [conf, setConf] = useState(null);
  const [dk, setDk] = useState(false);
  const [thinking, setThinking] = useState("");
  const open = q.kind === "open";
  const ready = dk || ((open ? text.trim().length > 0 : choice != null) && conf != null);
  const send = () => { try { onSend({ choice, text, confidence_pct: conf, dont_know: dk, thinking }); } catch (e) { window.App.toast(e.message); } };
  return (
    <div className="pb-q">
      {open ? <textarea className="k-input" rows={3} value={text} disabled={dk} maxLength={4000} placeholder="Your prediction" onChange={(e) => setText(e.target.value)} />
        : (
          <div className="pb-opts" role="radiogroup" aria-label="Options">
            {q.options.map((o) => (
              <label key={o.id} className="pb-opt" data-on={choice === o.id && !dk ? "1" : undefined}>
                <input type="radio" disabled={dk} checked={choice === o.id && !dk} onChange={() => setChoice(o.id)} />
                <span className="pb-letter k-num">{o.id.toUpperCase()}</span><Md src={o.text} as="span" />
              </label>
            ))}
          </div>
        )}
      <ConfidenceSlider value={conf} onChange={(x) => { setConf(x); setDk(false); }} dontKnow={dk} onDontKnow={() => setDk(!dk)} />
      <Thinking value={thinking} onChange={setThinking} placeholder={thinkingHint} />
      <div className="cy-actions"><Btn kind="primary" disabled={!ready} onClick={send}>{label}<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn></div>
    </div>
  );
}

function YourAnswer({ q, a, graded }) {
  if (!a) return null;
  const opt = (id) => (q.options.filter((x) => x.id === id)[0] || {}).text || id;
  return (
    <div className="lt-your k-small">
      <b>You:</b> {a.dont_know ? "I don't know" : q.kind === "open" ? <span className="lt-quote">{a.text}</span> : <><span className="k-num">{a.choice.toUpperCase()}</span> · <Md src={opt(a.choice)} as="span" /></>}
      {!a.dont_know && <span className="k-muted"> · {a.confidence_pct} %</span>}
      {a.thinking && <div className="k-muted lt-thinking">Thinking: {a.thinking}</div>}
      {graded && q.key && <span className={"lt-mark" + (a.choice === q.key ? " ok" : "")}>{a.choice === q.key ? " right" : " not right"}</span>}
    </div>
  );
}

function Feedback({ a, ph, onContinue }) {
  const chosen = a.options.filter((o) => o.id === a.answer.choice)[0], key = a.options.filter((o) => o.id === a.key)[0];
  return (
    <div className="lt-fb" data-ok={a.correct ? "1" : undefined}>
      <YourAnswer q={a} a={a.answer} graded={false} />
      {a.correct
        ? <p className="lt-verdict ok"><CheckCircle size={16} weight="fill" aria-hidden="true" />Right. {ph === "feedback" ? "The step holds; the next one builds on it." : ""}</p>
        : (
          <div className="lt-verdict bad">
            <p><XCircle size={16} weight="fill" aria-hidden="true" />{a.answer.dont_know ? "You did not know yet." : "Not right."} The answer is <b>{a.key.toUpperCase()}</b>: <Md src={key ? key.text : ""} as="span" /></p>
            {chosen && chosen.wrong_model && <p className="k-small k-muted">Your choice fits this idea: {chosen.wrong_model}</p>}
          </div>
        )}
      {ph === "feedback" && <div className="cy-actions"><Btn kind="primary" onClick={onContinue}>{a.correct ? "Next step" : "Teach it another way"}<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn></div>}
    </div>
  );
}

function Refs({ refs, pkg }) {
  if (!refs || !refs.length) return null;
  const units = {};
  if (pkg) (pkg.units || []).forEach((u) => { units[u.id] = u; });
  const txt = refs.map((r) => (units[r] ? (units[r].loc || r) : r)).filter((x, i, l) => l.indexOf(x) === i).join(" · ");
  return <p className="k-small k-muted lt-refs">Source: {txt}</p>;
}

// Claims the teacher was not sure of, with the researcher hook (task F7: queued in session.research)
function Unsure({ s, st, t, idx, save }) {
  if (!t.uncertain || !t.uncertain.length) return null;
  const queued = (claim) => (s.research || []).some((r) => r.step === st.n && r.claim === claim);
  return (
    <div className="lt-unsure k-small">
      <p><Warning size={14} aria-hidden="true" /><b>The teacher is not sure about:</b></p>
      <ul>
        {t.uncertain.map((c, i) => (
          <li key={i}>{c} <CheckThis claim={c} context={t.md} sources={(t.refs || []).join(", ")} target={{ kind: "live", session: s.id, step: st.n, claim: c }} compact />
            {queued(c) ? <span className="k-muted"> · saved for checking</span> : <ResearchOrQueue s={s} st={st} idx={idx} c={c} save={save} />}</li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ the end (D14) and the transcript
function EndPanel({ s, commit }) {
  const sum = KL().summary(s);
  return (
    <section className="k-panel k-sec pb">
      <p className="cy-kicker"><Flag size={14} aria-hidden="true" />{s.status === "done" ? "Session complete" : "The goal is reached"}</p>
      {s.end && s.end.summary && <Md src={s.end.summary} className="st-md" />}
      <p className="k-small">{sum.steps} steps · {sum.right_first} checks right the first time · {sum.after_repair} after a repair{sum.gaps ? " · " + sum.gaps + " missing foundation" + (sum.gaps === 1 ? "" : "s") + " added" : ""}. Session evidence only: none of it goes to your reviews.</p>
      {s.status === "review" ? (
        <>
          <p><b>Does the goal now feel obviously true to you?</b> <span className="k-small k-muted">Your own judgement, kept with the session, never scored.</span></p>
          <div className="cy-actions">
            <Btn kind="primary" onClick={() => { KL().endReport(s, "yes", Date.now()); commit(); }}>Yes</Btn>
            <Btn onClick={() => { KL().endReport(s, "not_yet", Date.now()); commit(); }}>Not yet: keep teaching</Btn>
          </div>
        </>
      ) : <p className="k-small">You said it feels obviously true{s.end && s.end.answered_at ? " (" + new Date(s.end.answered_at).toLocaleDateString() + ")" : ""}.</p>}
    </section>
  );
}

function Transcript({ s, pkg, nodeLabel }) {
  const steps = (s.steps || []).filter((x) => x.closed_at || s.status === "done" || s.status === "review");
  // task F6: "Open the session message" from the knowledge graph opens the transcript at that step
  const focus = window.App.liveFocus;
  const [keepOpen] = useState(!!focus);   // stays open after the focus is used
  React.useEffect(() => { if (focus) { const el = document.getElementById("lt-step-" + focus); if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("lt-focus"); } window.App.liveFocus = null; } }, [focus]);
  if (!steps.length) return null;
  return (
    <details className="k-panel k-sec lt-tr" open={keepOpen || undefined}>
      <summary className="k-small"><ChatCircleText size={14} aria-hidden="true" /> <b>Transcript</b> · {steps.length} finished step{steps.length === 1 ? "" : "s"}</summary>
      <ol>
        {steps.map((st) => (
          <li key={st.n} id={"lt-step-" + st.n}>
            <p className="lt-label">Step {st.n} · {nodeLabel(st.node)} · {st.outcome === "right" ? "checked right" : st.outcome === "right_after_repair" ? "right after " + st.repairs + " repair" + (st.repairs === 1 ? "" : "s") : st.outcome === "gap" ? "a missing foundation was added" : "open"}</p>
            <Md src={st.predict.stem} className="st-md" />
            <YourAnswer q={st.predict} a={st.predict.answer} graded={false} />
            {st.teach.map((t, i) => (
              <div key={i} className="lt-tr-teach">
                {t.resolves && <Md src={t.resolves} className="st-md k-muted" />}
                <Html className="st-md" html={renderMd(t.md)} />
                <Refs refs={t.refs} pkg={pkg} />
                {t.gap && <p className="k-small">Missing foundation added to the map: {t.gap.label}</p>}
                {st.check[i] && (<><Md src={st.check[i].stem} className="st-md" /><YourAnswer q={st.check[i]} a={st.check[i].answer} graded /></>)}
              </div>
            ))}
            {st.teach[0] && st.teach[0].by && st.teach[0].by.model && <p className="k-small k-muted">Written by {byLine({ provider: st.teach[0].by.provider, model: st.teach[0].by.model, cost_kind: st.teach[0].by.cost_kind })} · generated, not verified</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

// Without research (no web search and no search key) the unsure claim can still be kept for later (session.research, "queued")
function ResearchOrQueue({ s, st, idx, c, save }) {
  const rs = useResearchStatus();
  if (rs.mode) return null;
  return <button type="button" className="k-btn sm" onClick={() => { KL().queueResearch(s, st.n, idx, c, Date.now()); save(); }} title="Keeps the claim with its context; with web search or a search key set up (Settings, Models) it can be checked."><MagnifyingGlass size={13} aria-hidden="true" />Keep to check later</button>;
}
