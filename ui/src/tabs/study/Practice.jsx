// Adaptive practice (task F5, LEARNING-PROTOCOL 3.8, 3.9): Evaluating of a topic, free practice from the Study library, and problems you
// bring. One problem at a time; the coach (prompts\practice-coach.md) writes it, solves it and checks its own solution before you see it;
// you work in the thinking field; the coach decides whether you solved it; hints come from the ladder of task F2 (prompts\hint-giver.md).
// src/practice-core.js holds the run (difficulty, targets, retests, records). Generated problems never reach your reviews.
import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowClockwise, Robot, Question, Flag, CheckCircle, XCircle, Lightbulb, Files, PencilSimple, Warning, CaretLeft, Pause, Play, Barbell, Plus } from "@phosphor-icons/react";
import { Btn, Seg } from "../kit.jsx";
import { Md } from "./common.jsx";
import Thinking from "./Thinking.jsx";
import ConfidenceSlider from "./ConfidenceSlider.jsx";
import { useModelReady, useModelCall, CallStatus, NoModelNote, byLine } from "../../model-call.jsx";
import { EASE, DUR } from "../../motion.jsx";
import "./probe.css";
import SidePanel from "../../SidePanel.jsx";
import { CheckThis } from "../../research.jsx";

const KPr = () => window.KPractice;
const KC = () => window.KCycle;
const App = () => window.App;
const SETTING = { familiar: "familiar setting", new: "new setting", far: "unfamiliar setting" };
const OUTCOME = { solved: "Solved", solved_with_hints: "Solved with hints", given_up: "Given up", moved_on: "Moved on", unsolvable: "Not solvable as given" };
const WAIT = { write: "Writing the next problem", check: "Checking its own solution before showing it", verdict: "Reading your work", own: "Solving your problem first" };

// The run: problem → your work → verdict / hints → next. onComplete() when the run is over (Evaluating finishes the topic's cycle).
export function PracticeRun({ s, pkg, commit, onComplete, completeLabel }) {
  const call = useModelCall();
  const reduce = useReducedMotion();
  const inflight = useRef(false), tries = useRef(0);
  const [, bump] = useState(0);
  const save = () => { commit(); bump((x) => x + 1); };
  const ph = KPr().phase(s), need = KPr().needsCall(s);
  const ask = async (task) => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      let problems = [], last = "The coach's reply could not be used.";
      for (let n = 0; n < 2; n++) {
        const r = await call.run("practice-coach", KPr().coachInputs(s, task, { pkg, problems }), { feature: "practice-coach", maxOutputTokens: 6000 });
        if (!r.ok) return;
        const c = KPr().checkReply(s, task, r.json, { pkg });
        if (c.ok) { KPr().applyReply(s, task, r.json, { now: Date.now(), meta: r.meta, prompt: r.prompt }); save(); return; }
        problems = c.problems; last = "The coach's reply failed Kartotek's checks: " + c.problems.join(" ");
      }
      call.fail(last);
    } finally { inflight.current = false; }
  };
  useEffect(() => { if (need && s.status === "practice" && !call.busy && !call.error && tries.current < 80) { tries.current++; ask(need); } }, [need, s.updated_at, call.error, s.status]);

  const p = KPr().lastProblem(s);
  const sum = KPr().summary(s);
  const shown = p && (p.status === "open" || p.status === "ended") ? p : null;
  return (
    <section className="k-panel k-sec pb pr" aria-live="polite">
      <div className="pb-head">
        <p className="cy-kicker"><Barbell size={14} aria-hidden="true" />{shown ? (shown.origin === "learner" ? "Your own problem" : shown.retest_of ? "A missed problem, back once in a new setting" : "Problem " + ((s.problems || []).filter((x) => x.origin !== "learner" && x.status !== "rejected" && !x.retest_of).indexOf(shown) + 1) + " of " + s.length) : "Practice"}</p>
        {shown && shown.difficulty && <span className="k-small k-muted">Level {shown.difficulty.level} of 6 · {shown.difficulty.ideas} idea{shown.difficulty.ideas > 1 ? "s" : ""} · {SETTING[shown.difficulty.setting]}</span>}
      </div>
      <Levels s={s} />
      {need && (
        <div className="pb-wait">
          <CallStatus call={call} />
          {!call.busy && call.error && <Btn size="sm" onClick={() => { tries.current = 0; ask(need); }}><ArrowClockwise size={15} aria-hidden="true" />Try again</Btn>}
          {!call.busy && !call.error && <p className="k-small k-muted">{WAIT[need]}…</p>}
        </div>
      )}
      {ph === "stuck" && (
        <div className="pb-wait"><p className="k-lvl" data-l="warn">The coach rejected three of its own problems in a row in its check, so nothing was shown.</p><Btn size="sm" onClick={() => { KPr().retry(s); save(); }}>Write another one</Btn></div>
      )}
      {shown && (
        <motion.div key={shown.id} initial={reduce ? false : { opacity: 0.001, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : DUR.ui, ease: EASE.arrive }}>
          <ProblemView s={s} p={shown} ph={ph} save={save} />
        </motion.div>
      )}
      {ph === "complete" && <Complete s={s} onComplete={onComplete} label={completeLabel} />}
      {ph === "done" && <p className="k-small">This practice run is finished: {summaryLine(sum)}</p>}
      {(ph === "between" || ph === "write" || ph === "complete") && s.status === "practice" && <OwnProblem s={s} save={save} />}
      <SidePanel ctx={window.KSide.practiceContext(s, p)} list={s.side || (s.side = [])} save={save} />
    </section>
  );
}

function Levels({ s }) {
  const list = (s.problems || []).filter((p) => p.difficulty && p.status !== "rejected");
  if (!list.length) return null;
  return (
    <ol className="pr-levels" aria-label="Difficulty of each problem">
      {list.map((p) => <li key={p.id} data-o={p.outcome || "open"} data-retest={p.retest_of ? "1" : undefined} data-disputed={p.disputed ? "1" : undefined} style={{ "--lv": p.difficulty.level }} title={"Level " + p.difficulty.level + (p.retest_of ? " (retest)" : "") + ": " + (p.disputed ? "reported" : OUTCOME[p.outcome] || "open")}><span /></li>)}
    </ol>
  );
}
export function summaryLine(m) {
  return m.problems + " problem" + (m.problems === 1 ? "" : "s") + ", " + m.solved + " solved without help, " + m.with_hints + " with hints, " + m.missed + " missed" + (m.retests ? ", " + m.retests + " retest" + (m.retests === 1 ? "" : "s") : "") + (m.disputed ? ", " + m.disputed + " reported" : "") + (m.own ? ", " + m.own + " of your own" : "") + " (generated, not verified)";
}

function ProblemView({ s, p, ph, save }) {
  const [thinking, setThinking] = useState("");
  const [answer, setAnswer] = useState("");
  const [conf, setConf] = useState(null);
  const open = p.status === "open";
  const hints = (p.help || []);
  return (
    <div className="lt-step">
      <div className="lt-block">
        <Md src={p.statement} className="st-md lt-stem" />
        {p.origin === "learner" && !p.solvable && <p className="k-lvl" data-l="warn">The coach says this problem cannot be solved as given: {p.issue}</p>}
        {(p.uncertain || []).length > 0 && (
          <div className="lt-unsure k-small"><p><Warning size={14} aria-hidden="true" /><b>The coach is not sure about:</b></p>
            <ul>{p.uncertain.map((c, i) => <li key={i}>{c} <CheckThis claim={c} context={p.statement} target={{ kind: "practice", session: s.id, problem: p.id, claim: c }} compact /></li>)}</ul></div>
        )}
      </div>
      {hints.length > 0 && (
        <ol className="cy-hints">
          {hints.map((h, i) => (
            <li key={i}><b>{h.kind === "statement_repair" ? "What is asked" : "Level " + h.level + " · " + KC().RUNG_LABEL[h.level]}</b>
              <span className="k-small k-muted"> ({KC().RUNG_GIVES[h.level]}{h.kind === "statement_repair" ? "; free, not counted as help" : ""})</span><p>{h.text}</p></li>
          ))}
        </ol>
      )}
      {(p.submissions || []).map((sub, i) => <SubmissionView key={i} sub={sub} />)}
      {open && ph === "work" && (
        <div className="pb-q">
          <Thinking forceOpen value={thinking} onChange={setThinking} rows={6} label="Your work (the coach reads it)" placeholder="Work the problem here, step by step. Write what you try, where you are unsure, and your answer when you have one." />
          <label className="k-field">
            <span className="k-field-label">Your final answer (optional)</span>
            <input className="k-input" value={answer} maxLength={600} placeholder="For example 12 V, or A·B̄ + C" onChange={(e) => setAnswer(e.target.value)} />
          </label>
          <ConfidenceSlider value={conf} onChange={setConf} label="How likely is it that your answer is right? (optional)" />
          <div className="cy-actions">
            <Btn kind="primary" disabled={!thinking.trim() && !answer.trim()} onClick={() => { try { KPr().submit(s, { thinking, answer, confidence_pct: conf }, Date.now()); save(); } catch (e) { App().toast(e.message); } }}>Check my work<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn>
            <HintButtons s={s} p={p} draft={{ thinking, answer }} save={save} />
            <Btn size="sm" onClick={() => { KPr().giveUp(s, Date.now()); save(); }} title="Ends the problem and shows the model solution. A missed problem comes back once, in a new setting.">Give up: show the solution</Btn>
          </div>
        </div>
      )}
      {open && ph === "verdict" && <p className="k-small k-muted">The coach is reading your work…</p>}
      {p.status === "ended" && <Ended s={s} p={p} ph={ph} save={save} />}
      {open && <Report s={s} p={p} save={save} />}
    </div>
  );
}

function SubmissionView({ sub }) {
  const v = sub.verdict;
  return (
    <div className="lt-fb" data-ok={v && v.result === "solved" ? "1" : undefined}>
      <div className="lt-your k-small"><b>Your work:</b>{sub.answer ? <> answer <b>{sub.answer}</b></> : null}{sub.confidence_pct != null ? <span className="k-muted"> · {sub.confidence_pct} %</span> : null}
        {sub.thinking && <div className="k-muted lt-thinking">{sub.thinking}</div>}</div>
      {v && (v.result === "solved"
        ? <p className="lt-verdict ok"><CheckCircle size={16} weight="fill" aria-hidden="true" />Solved. {v.feedback}</p>
        : <div className="lt-verdict bad"><p><XCircle size={16} weight="fill" aria-hidden="true" />Not yet. {v.first_break}</p>{v.feedback && <p className="k-small k-muted">{v.feedback}</p>}</div>)}
    </div>
  );
}

function HintButtons({ s, p, draft, save }) {
  const call = useModelCall();
  const next = KPr().nextRung(p);
  const ask = async (requested) => {
    let probs = [], last = "The hint could not be used.";
    for (let n = 0; n < 2; n++) {
      const r = await call.run("hint-giver", KPr().hintInputs(s, draft, requested, probs), { feature: "hint-giver", maxOutputTokens: 1000 });
      if (!r.ok) return;
      const x = KPr().recordHint(s, r.json, { requested, now: Date.now(), meta: r.meta, prompt: r.prompt });
      if (x.ok) { save(); return; }
      probs = x.problems; last = x.error;
    }
    call.fail(last);
  };
  return (
    <>
      <Btn size="sm" disabled={call.busy || !next} onClick={() => ask(next)} title="One step of help, the least revealing first. It reads the problem, your work so far and your answer."><Robot size={15} aria-hidden="true" />{(p.help || []).some((h) => h.kind === "model_hint") ? "Ask for the next step" : "Ask for a hint"}</Btn>
      <Btn size="sm" disabled={call.busy} onClick={() => ask("statement_repair")} title="Explains what the problem asks, nothing about the solution. It does not count as help."><Question size={15} aria-hidden="true" />I don't understand what is asked</Btn>
      <CallStatus call={call} />
    </>
  );
}

function Ended({ s, p, ph, save }) {
  return (
    <div className="lt-block lt-teach">
      <p className="lt-label"><Flag size={14} aria-hidden="true" />{OUTCOME[p.outcome] || p.outcome}{p.highest_rung ? " · highest hint " + p.highest_rung : ""}{p.disputed ? " · reported" : ""}</p>
      {p.model_solution && (
        <details open={p.outcome !== "solved"}>
          <summary className="k-small">The coach's solution (generated, not verified)</summary>
          <Md src={p.model_solution} className="st-md" />
          {p.answer && <p className="k-small"><b>Answer:</b> {p.answer}</p>}
          <CheckThis claim={window.KSide.firstClaim(p.model_solution)} context={p.statement + "\n" + p.model_solution} target={{ kind: "practice", session: s.id, problem: p.id }} editable />
        </details>
      )}
      {p.by && p.by.model && <p className="k-small k-muted">Written by {byLine({ provider: p.by.provider, model: p.by.model, cost_kind: p.by.cost_kind })}{p.check && p.check.changed ? "; its own check corrected the first solution" : ""}.</p>}
      <div className="cy-actions">
        {ph === "between" && <Btn kind="primary" onClick={() => { KPr().nextProblem(s, Date.now()); save(); }}>Next problem<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn>}
        <Report s={s} p={p} save={save} />
      </div>
    </div>
  );
}

// "Report a problem": a wrong statement, solution or verdict; the problem leaves every count (it can be withdrawn)
function Report({ s, p, save }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (p.disputed) return <span className="k-small k-muted">Reported{p.disputed.note ? ": " + p.disputed.note : ""}. <button type="button" className="k-btn sm" onClick={() => { KPr().undispute(s, p.id, Date.now()); save(); }}>Withdraw</button></span>;
  if (!open) return <Btn size="sm" onClick={() => setOpen(true)} title="Marks this generated problem as disputed: it leaves every count."><Warning size={14} aria-hidden="true" />Report a problem</Btn>;
  return (
    <span className="cy-actions">
      <input className="k-input" value={note} maxLength={600} placeholder="What is wrong? (optional)" onChange={(e) => setNote(e.target.value)} />
      <Btn size="sm" kind="primary" onClick={() => { KPr().dispute(s, p.id, note, Date.now()); setOpen(false); save(); }}>Report</Btn>
      <Btn size="sm" onClick={() => setOpen(false)}>Cancel</Btn>
    </span>
  );
}

function Complete({ s, onComplete, label }) {
  const m = KPr().summary(s);
  return (
    <div className="lt-block">
      <p className="lt-label"><Flag size={14} aria-hidden="true" />Run complete</p>
      <p className="k-small">{summaryLine(m)}. Practice evidence only: nothing here goes to your reviews or changes the outcome states.</p>
      {onComplete && <div className="cy-actions"><Btn kind="primary" onClick={onComplete}>{label || "Finish"}<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn></div>}
    </div>
  );
}

// "My own problem": paste it, or read it from a file on this PC (the same local reader as the writing jobs)
function OwnProblem({ s, save }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const pick = async () => {
    const r = await window.kartotek.jobs.pickFiles("sources");
    if (!r || !r.ok || !r.value.length) return;
    setBusy("Reading the file on this PC…");
    const rd = await window.kartotek.live.readFiles(s.id, [r.value[0].token]);
    const m = rd && rd.ok ? await window.kartotek.live.material(s.id) : null;
    setBusy("");
    if (!m || !m.ok || !m.value) { App().toast((rd && rd.error) || "The file could not be read."); return; }
    setText(m.value.pages.map((x) => x.text).join("\n\n").slice(0, 8000));
  };
  if (!open) return <div className="cy-actions"><Btn size="sm" onClick={() => setOpen(true)}><Plus size={14} aria-hidden="true" />My own problem</Btn></div>;
  return (
    <div className="lt-block">
      <p className="lt-label"><PencilSimple size={14} aria-hidden="true" />My own problem</p>
      <textarea className="k-input" rows={5} value={text} maxLength={8000} placeholder="Paste the problem as it is written, with every value it gives." onChange={(e) => setText(e.target.value)} />
      <div className="cy-actions">
        {window.kartotek && window.kartotek.live && <Btn size="sm" onClick={pick}><Files size={14} aria-hidden="true" />Read it from a file…</Btn>}
        {busy && <span className="k-small k-muted">{busy}</span>}
        <Btn size="sm" kind="primary" disabled={!text.trim()} onClick={() => { try { KPr().bringOwn(s, text, null, Date.now()); setOpen(false); setText(""); save(); } catch (e) { App().toast(e.message); } }}>Solve it with me<ArrowRight size={14} weight="bold" aria-hidden="true" /></Btn>
        <Btn size="sm" onClick={() => setOpen(false)}>Cancel</Btn>
      </div>
      <p className="k-small k-muted">The coach solves it first (and says if it is ambiguous), then you work on it with hints and a verdict as usual. It is kept with the session as your problem.</p>
    </div>
  );
}

// ------------------------------------------------------------------ free practice from the Study library
export function PracticePanel() {
  const S = App().S, mr = useModelReady("strong");
  const list = Object.keys(S.sessions || {}).map((k) => S.sessions[k]).filter((s) => s && s.kind === "practice" && s.purpose === "free").sort((a, b) => b.updated_at - a.updated_at);
  const [form, setForm] = useState(false);
  return (
    <details className="k-panel k-sec" open={form || undefined}>
      <summary className="k-sec-head"><h2><Barbell size={18} aria-hidden="true" /> Practice</h2></summary>
      <p className="k-small k-muted">Adaptive problems on topics of a study or on a topic in your words, one at a time and of rising difficulty, with hints when you are stuck and a verdict on your work. You can also bring your own problem. Nothing here goes to your reviews.</p>
      {!mr.ready ? <NoModelNote what="practice (the strong slot)" /> : form ? <NewPractice close={() => setForm(false)} /> : <Btn kind="primary" onClick={() => setForm(true)}><Plus size={16} weight="bold" aria-hidden="true" />Start practice</Btn>}
      {list.length > 0 && (
        <ul className="lv-list">
          {list.map((s) => (
            <li key={s.id}><b>{s.title}</b><span className="k-small k-muted">{s.status === "done" ? "finished" : s.status === "paused" ? "paused" : "in progress"} · {KPr().summary(s).problems} problems · {new Date(s.updated_at).toLocaleDateString()}</span>
              <Btn size="sm" onClick={() => { App().practiceOpen = s.id; App().render(); window.scrollTo(0, 0); }}>{s.status === "done" ? "Open" : "Continue"}<ArrowRight size={14} weight="bold" aria-hidden="true" /></Btn></li>
          ))}
        </ul>
      )}
    </details>
  );
}

function NewPractice({ close }) {
  const S = App().S;
  const studies = Object.keys(S.etuts || {}).map((id) => S.etuts[id]).filter((et) => et && !et.removed && et.package && KC().isV2(et.package));
  const [src, setSrc] = useState("study");
  const [attach, setAttach] = useState("");
  const [kids, setKids] = useState([]);
  const [words, setWords] = useState("");
  const et = src === "study" && attach ? S.etuts[attach] : null;
  const ok = src === "study" ? !!et && kids.length > 0 : words.trim().length >= 3;
  const start = () => {
    let targets = [];
    if (et) {
      const seen = {};
      kids.forEach((k) => KPr().targetsFor(et.package, k).filter((t) => !t.earlier).forEach((t) => { if (!seen[t.id]) { seen[t.id] = 1; targets.push(t); } }));
    } else targets = KPr().targetsFromWords(words);
    const title = et ? "Practice: " + kids.map((k) => (window.KGraph.topicsOf(et.package).filter((t) => t.kid === k)[0] || {}).title).join(", ") : "Practice: " + words.split("\n")[0];
    const s = KPr().newSession(S, { purpose: "free", title, etut_id: et ? et.etut_id : null, kids, targets, now: Date.now() });
    App().store.commit({ meta: true });
    App().practiceOpen = s.id; App().render(); window.scrollTo(0, 0);
  };
  return (
    <div className="pb">
      <Seg label="practice-source" value={src} onChange={setSrc} options={[{ value: "study", label: "Topics of a study" }, { value: "words", label: "A topic in my words" }]} />
      {src === "study" ? (
        <>
          <select className="k-input" value={attach} onChange={(e) => { setAttach(e.target.value); setKids([]); }} aria-label="Study">
            <option value="">Choose a study…</option>
            {studies.map((x) => <option key={x.etut_id} value={x.etut_id}>{x.package.title}</option>)}
          </select>
          {et && (
            <div className="lv-topics" role="group" aria-label="Topics">
              {et.package.parts.map((p, pi) => (p.kazanimlar || []).map((k) => (
                <label key={k.kazanim_id}><input type="checkbox" checked={kids.indexOf(k.kazanim_id) >= 0} onChange={(e) => setKids(e.target.checked ? kids.concat(k.kazanim_id) : kids.filter((x) => x !== k.kazanim_id))} /><span><span className="k-muted">Part {pi + 1} ·</span> {k.title}</span></label>
              )))}
            </div>
          )}
        </>
      ) : (
        <label className="k-field"><span className="k-field-label">What to practise (one idea per line)</span>
          <textarea className="k-input" rows={3} value={words} maxLength={1500} placeholder={"Thevenin equivalents\nNodal analysis"} onChange={(e) => setWords(e.target.value)} /></label>
      )}
      <div className="cy-actions"><Btn kind="primary" disabled={!ok} onClick={start}>Start<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn><Btn onClick={close}>Cancel</Btn></div>
    </div>
  );
}

// A free practice session on its own screen
export function PracticeScreen({ s }) {
  const S = App().S;
  const et = s.attached ? S.etuts[s.attached.etut_id] : null, pkg = et && et.package;
  const commit = () => { App().store.commit({ meta: true }); App().render(); };
  return (
    <div className="k-page st-page">
      <div className="st-run-head">
        <Btn size="sm" onClick={() => { App().practiceOpen = null; App().render(); }}><CaretLeft size={15} weight="bold" aria-hidden="true" />Studies</Btn>
        <div className="st-run-title"><h1>{s.title}</h1><p className="k-small k-muted">Practice · {pkg ? pkg.title : "my own topic"} · {summaryLine(KPr().summary(s))}</p></div>
        {s.status !== "done" && (s.status === "paused"
          ? <Btn size="sm" kind="primary" onClick={() => { KPr().resume(s, Date.now()); commit(); }}><Play size={15} aria-hidden="true" />Resume</Btn>
          : <Btn size="sm" onClick={() => { KPr().pause(s, Date.now()); commit(); }}><Pause size={15} aria-hidden="true" />Pause</Btn>)}
      </div>
      <div className="cy-col">
        {s.status === "paused" ? <section className="k-panel k-sec pb"><p className="k-small">Paused. Everything so far is saved.</p></section>
          : <PracticeRun s={s} pkg={pkg} commit={commit} onComplete={() => { KPr().finish(s, Date.now()); commit(); }} completeLabel="Finish practice" />}
        {s.status === "practice" && KPr().phase(s) !== "complete" && <div className="cy-actions"><Btn size="sm" onClick={() => { KPr().finish(s, Date.now()); commit(); }}>End practice now</Btn></div>}
      </div>
    </div>
  );
}
