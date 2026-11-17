// An open study: header, stepper, per-part stage router, question/test screens and results
import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { CaretLeft, ArrowsOut, ArrowsIn, Check, ArrowRight, Cards, NotePencil, Bug, ArrowCounterClockwise, Timer } from "@phosphor-icons/react";
import { EASE, Btn, Kpi, Bar, TableWrap } from "../kit.jsx";
import { Md, Verdict, Chip, SlidesRef, ReqAction, Actions, KzHead, Compare, UserText, TraceLine, GapBox, Blocks, Scale } from "./common.jsx";
import {
  PlanScreen, RecallBlock, JolBlock, ExplainBlock, ProduceBlock, PracticeBlock, PredictBlock, ErrorLogBlock, Options, TeachScreen, JournalScreen, FinalReviewScreen,
} from "./Srl.jsx";
import { PrimingScreen, QuestionsDock } from "./QList.jsx";
import ConfidenceSlider from "./ConfidenceSlider.jsx";
import { A, KE, KM, EU, DSR, recallLoc, viewKey, currentQuestion, progressLabel, phaseKey } from "./util.js";
import Dictate from "../../Dictate.jsx";

// ------------------------------------------------------------------ header: phase timer (Rule 19)
function PhaseTimer({ et }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const K = KE(), ui = EU().getUi();
  const pr = et.progress, key = phaseKey(pr), plan = pr.plans[pr.part];
  const ms = (pr.phase_ms && pr.phase_ms[key]) || {};
  const total = Object.keys(ms).reduce((s, k) => s + ms[k], 0);
  if (key === "final" || !plan) {
    return <div className="st-phase-timer k-num" aria-live="off"><Timer size={15} aria-hidden="true" /><span className="k-muted">Time: {Math.round(total / 60000)} min</span></div>;
  }
  const budget = K.phaseBudget(plan.duration);
  const ph = K.phaseOf(pr, { errorOpen: ui.errorOpen });
  const label = K.PHASES.filter((p) => p.id === ph)[0].label;
  const used = (ms[ph] || 0) / 60000, over = used > budget[ph];
  const note = "This phase’s time is up; consider moving to the next phase.";
  return (
    <div className="st-phase-timer k-num" data-over={over ? "1" : undefined} aria-live="off" title={over ? note : undefined}>
      <Timer size={15} aria-hidden="true" />
      <span>Phase: <b>{label}</b> {Math.floor(used)}/{budget[ph]} min</span>
      <span className="k-muted">· total {Math.floor(total / 60000)}/{plan.duration} min</span>
      {over && <span className="st-over-note">· {note}</span>}
    </div>
  );
}

function Stepper({ et }) {
  const pkg = et.package, pr = et.progress;
  const inFinal = ["final", "final_review", "done"].indexOf(pr.stage) >= 0;
  const parts = pkg.parts.map((p, i) => ({ title: p.title, n: i + 1, st: inFinal || i < pr.part ? "done" : i === pr.part ? "current" : "next" }));
  const fst = pr.stage === "done" ? "done" : inFinal ? "current" : "next";
  parts.push({ title: "Final test", n: "T", st: fst });
  let stages = null;
  if (!inFinal) {
    const order = [["plan", "Plan"]];
    if (pr.stage === "warmup" || pr.warmup[pr.part]) order.push(["warmup", "Warm-up"]);
    order.push(["priming", "Priming"], ["learn", "Learn"], ["quiz", "Test"], ["teach", "Teach"], ["journal", "Reflect"]);
    const cur = order.map((s) => s[0]).indexOf(pr.stage === "retry" ? "quiz" : pr.stage);
    stages = (
      <ol className="st-stages" aria-label="Part stages">
        {order.map((s, i) => {
          const st = i < cur ? "done" : i === cur ? "current" : "next";
          return (
            <li key={s[0]} data-st={st} aria-current={st === "current" ? "step" : undefined}>
              {st === "current" && <motion.span layoutId="st-stage-bar" className="st-stage-bar" transition={{ duration: 0.35, ease: EASE }} />}
              {s[1]}
            </li>
          );
        })}
      </ol>
    );
  }
  return (
    <div className="st-stepper">
      <ol className="st-parts" aria-label="Parts">
        {parts.map((p, i) => (
          <li key={i} data-st={p.st} aria-current={p.st === "current" ? "step" : undefined}>
            <span className="st-n">{p.st === "done" ? <Check size={12} weight="bold" aria-hidden="true" /> : p.n}</span>
            <span className="st-part-title">{p.title}</span>
          </li>
        ))}
      </ol>
      {stages}
    </div>
  );
}

// ------------------------------------------------------------------ learn
function KazanimHead({ et, k }) {
  const K = KE(), pr = et.progress, part = K.currentPart(et), kind = k.kind || "kavram";
  return (
    <KzHead title={k.title} chips={<>
      <Chip>Objective {pr.k + 1}/{part.kazanimlar.length}</Chip>
      <Chip tone="accent" title={K.KIND_STRATEGY[kind]}>{K.KIND_TR[kind]}</Chip>
      <SlidesRef slides={k.slides} />
    </>}>
      {k.objective && <p className="k-muted st-lead">{k.objective}</p>}
    </KzHead>
  );
}

function LearnScreen(p) {
  const { et, act } = p;
  const K = KE(), pr = et.progress, k = K.currentKazanim(et);
  const head = <KazanimHead et={et} k={k} />;
  if (pr.sub === "read") {
    const steps = K.learnSteps(k), next = steps[1];
    const label = { practice: "Go to practice", explain: "Go to self-explanation", produce: "Go to: " + K.PRODUCE_TR[k.kind || "kavram"].toLowerCase(), jol: "Get ready for recall" }[next] || "Continue";
    return (
      <>
        {head}
        <div className="k-panel st-reading"><Blocks blocks={k.blocks} /></div>
        <Actions>
          <Btn kind="primary" onClick={() => act("next-sub")}>{label}<ArrowRight size={17} weight="bold" aria-hidden="true" /></Btn>
          <span className="k-small k-muted">The lesson text is hidden on the recall screen; you will write the answer from memory.</span>
        </Actions>
      </>
    );
  }
  if (pr.sub === "practice") return <>{head}<PracticeBlock {...p} k={k} /></>;
  if (pr.sub === "explain") return <>{head}<ExplainBlock {...p} k={k} /></>;
  if (pr.sub === "produce") return <>{head}<ProduceBlock {...p} k={k} /></>;
  if (pr.sub === "jol") return <>{head}<JolBlock {...p} k={k} /></>;
  return <>{head}<RecallBlock {...p} loc={recallLoc(et)} /></>;
}

function RoundScreen(p) {
  const { et } = p;
  const pr = et.progress, loc = recallLoc(et);
  return (
    <>
      <KzHead chips={<Chip>{KE().STAGE_TR[pr.stage]}</Chip>} title={loc.k.title}>
        <p className="k-small k-muted st-lead">{pr.stage === "warmup"
          ? "Before starting the new part, retrieve without notes the objectives from earlier parts that are most at risk of being forgotten."
          : "Before you explain the part as if teaching it, retrieve again without notes the objectives you struggled with or got wrong in the quiz."}</p>
      </KzHead>
      <RecallBlock {...p} loc={loc} />
    </>
  );
}

// ------------------------------------------------------------------ quiz and final test
const FINAL_DELAYS = [{ v: 1, label: "Tomorrow" }, { v: 2, label: "In 2 days" }, { v: 3, label: "In 3 days" }, { v: 7, label: "In a week" }, { v: 0, label: "Now" }];

function QuestionScreen(p) {
  const { et, f, set, act, lv } = p;
  const K = KE(), pr = et.progress, ui = EU().getUi(), App = A();
  const isFinal = pr.stage === "final";
  if (pr.sub === "predict") {
    ui.errorOpen = false;
    const n = isFinal ? et.package.final_test.length : et.package.parts[pr.part].quiz.length;
    const top = <KzHead chips={<Chip>{isFinal ? "Final test" : "Part " + (pr.part + 1) + " quiz"}</Chip>} title={isFinal ? et.package.title : K.currentPart(et).title} />;
    // The final test is taken after a delay the student chooses, so it measures what lasts (spacing)
    if (isFinal && !pr.predictions.final && pr.final_open_at == null) {
      return (
        <>
          {top}
          <div className="k-panel st-box">
            <h3 className="st-h3">When will you take the final test?</h3>
            <p>Right after studying, the material is still fresh, so the test would measure what you remember today. After a gap it measures what has stayed.</p>
            <Scale label="When" opts={FINAL_DELAYS} value={f.fdelay == null ? "1" : f.fdelay} onPick={(v) => set("fdelay", v)} />
            <p className="k-small k-muted">Until then, the objective reviews in Review keep the material active.</p>
          </div>
          <Actions><Btn kind="primary" onClick={() => act("final-plan")}>Save</Btn></Actions>
        </>
      );
    }
    if (isFinal && !pr.predictions.final && Date.now() < pr.final_open_at) {
      return (
        <>
          {top}
          <div className="k-panel st-box">
            <h3 className="st-h3">The final test opens on {App.fmtDate(pr.final_open_at)}</h3>
            <p>Come back then and take it without looking at your notes first.</p>
          </div>
          <Actions>
            <Btn kind="primary" onClick={() => act("study-cards")}>Open objective reviews in Review</Btn>
            <Btn onClick={() => act("final-now")}>Start now anyway</Btn>
          </Actions>
        </>
      );
    }
    return (
      <>
        {top}
        <PredictBlock n={n} isFinal={isFinal} f={f} set={set} act={act} />
      </>
    );
  }
  const cq = currentQuestion(et), q = cq.q;
  const k = K.findKazanim(et.package, q.kazanim_id);
  const ans = pr.answers[q.q_id];
  const head = (
    <>
      <KzHead title={null} chips={<>
        <Chip tone="accent">{isFinal ? "Final test" : "Quiz"} · Question <span className="k-num">{pr.qi + 1}/{cq.n}</span></Chip>
        {q.level && <Chip>{q.level}</Chip>}
      </>}>
        <p className="k-small k-muted">Objective: {k ? k.title : q.kazanim_id}</p>
      </KzHead>
      <Md className="st-stem st-q-stem" src={q.stem} />
    </>
  );
  if (!ans) {
    ui.errorOpen = false;
    // Produce first, recognise second (Rule 8): the options open only after the student has written an answer
    if (!f.attempted) {
      return (
        <>
          {head}
          <label className="k-field">
            <span className="k-field-label">Your answer, and how you got it</span>
            <textarea rows={4} value={f.reason || ""} onChange={(e) => set("reason", e.target.value)} placeholder="Work it out before you see the options (at least 5 characters)" />
            <div className="th-foot"><Dictate /></div>
          </label>
          <ReqAction req="reason@5" form={f} onClick={() => act("q-attempt")}>Show the options</ReqAction>
        </>
      );
    }
    return (
      <>
        {head}
        <div className="k-panel st-box"><h3 className="st-h3">Your answer</h3><UserText text={f.reason} /></div>
        <Options q={q} saved={null} notes={null} f={f} set={set} />
        <div className="st-row st-conf-row">
          <span className="k-small k-muted">Which option matches your answer? How sure are you?</span>
          <ConfScale f={f} set={set} />
        </div>
        <ReqAction req="choice,reason@5,conf" form={f} onClick={() => act("answer")}>Answer</ReqAction>
      </>
    );
  }
  ui.errorOpen = !ans.correct && !ans.error;
  const CT = K.CONFIDENCE_TR;
  const last = pr.qi === cq.n - 1;
  const nextLabel = last ? (isFinal ? "Go to the study reflection" : "Continue") : "Next question";
  const blocked = !ans.correct && !ans.error;
  return (
    <>
      {head}
      <motion.p className="st-verdict-line" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease: EASE }}>
        {ans.correct
          ? <><Verdict level="ok">Correct</Verdict>{ans.confidence !== "sure" && <span>Correct, but you said “{CT[ans.confidence].toLowerCase()}”; DSR counted it as “Hard”.</span>}</>
          : <><Verdict level="bad">Wrong</Verdict>{ans.confidence === "sure" ? <span>Wrong although you were sure: this is a sign of a <b>misconception</b>.</span> : <span>The correct answer and the solution are below.</span>}</>}
      </motion.p>
      <Options q={q} saved={ans} notes={q.distractor_notes || null} f={f} set={set} />
      <Compare leftTitle="Your answer" left={<><UserText text={ans.reason} /><p className="k-small k-muted">Confidence: {CT[ans.confidence]}</p></>}
        rightTitle="Solution" right={<Md src={q.solution} />} />
      {!ans.correct && <ErrorLogBlock ans={ans} lv={lv} k={k} f={f} set={set} act={act} />}
      <TraceLine r={ui.last && ui.last.q_id === q.q_id ? ui.last : null} />
      <Actions>
        <Btn kind="primary" disabled={blocked} title={blocked ? "Complete the error entry first" : undefined} onClick={() => act("next-q")}>{nextLabel}<ArrowRight size={17} weight="bold" aria-hidden="true" /></Btn>
      </Actions>
    </>
  );
}

function ConfScale({ f, set }) {
  // 0-100; the band (what the scheduler reads) is written next to the number
  return <ConfidenceSlider value={f.conf_pct == null ? null : f.conf_pct} onChange={(n) => { set("conf_pct", n); set("conf", KE().confBand(n)); }} />;
}

// ------------------------------------------------------------------ summary tables
function LevelCell({ s }) {
  if (!s.level) return <span className="k-muted">-</span>;
  return (
    <span className="st-level-cell">
      <Verdict level={s.level}>{KE().LEVEL_TR[s.level]}</Verdict>
      {s.misconception && <span className="k-state" data-s="relearning">misconception</span>}
    </span>
  );
}

function StatusTable({ et, kazanimlar, now }) {
  const App = A(), K = KE();
  return (
    <TableWrap>
      <table className="k-table st-table">
        <thead><tr><th>Objective</th><th>Recall</th><th className="num">Questions</th><th className="num">R now</th><th className="num">S</th><th>Next review</th><th>Status</th></tr></thead>
        <tbody>
          {kazanimlar.map((k) => {
            const s = K.kazanimStatus(App.S, et, k.kazanim_id, now);
            return (
              <tr key={k.kazanim_id}>
                <td className="st-front" title={k.title}>{k.title}</td>
                <td>{s.recall_rating ? App.RATING_TR[s.recall_rating] : "-"}</td>
                <td className="num">{s.answered ? s.correct + "/" + s.answered : "-"}</td>
                <td className="num">{s.R == null ? "-" : App.dec(s.R, 2)}</td>
                <td className="num">{s.S == null ? "-" : App.fmtDays(s.S)}</td>
                <td className="st-nowrap">{s.due_at ? <>{App.fmtDate(s.due_at)} <span className="k-muted">({App.fmtDays((s.due_at - now) / DSR().DAY)})</span></> : "-"}</td>
                <td><LevelCell s={s} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

// Prior knowledge · JOL · actual comparison
function MonitorTable({ et, part }) {
  const App = A(), U = EU(), pr = et.progress;
  return (
    <TableWrap>
      <table className="k-table st-table">
        <thead><tr><th>Objective</th><th>Prior knowledge</th><th className="num">JOL</th><th className="num">Actual</th><th>Monitoring</th></tr></thead>
        <tbody>
          {part.kazanimlar.map((k) => {
            const prior = pr.prior[k.kazanim_id], j = pr.jol[k.kazanim_id] || {}, actual = j.actual;
            let flag = null;
            if (prior != null && prior >= 2 && actual != null && actual < 0.5) flag = <Verdict level="warn">thought you knew it, could not retrieve it</Verdict>;
            else if (prior != null && prior <= 1 && actual != null && actual >= 0.75) flag = <Verdict level="ok">better than you thought</Verdict>;
            else if (j.jol != null && actual != null && Math.abs(j.jol - actual) > 0.3) flag = <Verdict level="warn">prediction {j.jol > actual ? "too optimistic" : "too pessimistic"}</Verdict>;
            return (
              <tr key={k.kazanim_id}>
                <td className="st-front">{k.title}</td>
                <td>{prior == null ? "-" : prior + " · " + U.PRIOR_TR[prior]}</td>
                <td className="num">{j.jol == null ? "-" : App.pct(j.jol)}</td>
                <td className="num">{actual == null ? "-" : App.pct(actual)}</td>
                <td>{flag || <span className="k-muted">-</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

function PartResults({ et }) {
  const App = A(), K = KE(), M = KM();
  const pr = et.progress, part = K.currentPart(et), now = Date.now();
  const res = K.partResult(et, pr.part), plan = pr.plans[pr.part];
  const pred = M.predictionOutcome(et, "quiz:" + pr.part);
  return (
    <section className="st-stack st-part-results">
      <div className="k-grid2">
        <div className="k-panel st-box">
          <h3>Goal</h3>
          <p>{plan ? plan.goal : K.autoGoal(part).text}</p>
          <p className="st-gap-line">{res.met ? <Verdict level="ok">Criterion met</Verdict> : <Verdict level="warn">Below the criterion</Verdict>}<span className="k-num">Quiz {res.correct}/{res.n} · criterion {res.criterion}</span></p>
          
          {pr.teach[pr.part] && <p className="k-small k-muted">In explaining as if teaching, {App.pct(pr.teach[pr.part].coverage)} of the rubric was covered.</p>}
          <Bar value={res.n ? res.correct / res.n : 0} tone={res.met ? "good" : "warn"} />
        </div>
        <GapBox o={pred} title="Quiz: prediction and actual" />
      </div>
      {!res.met && (
        <div className="k-panel st-box">
          <h3>If the strategy did not work: diagnosis</h3>
          <ol className="st-diag">
            {M.diagnose13(App.S, et, pr.part).map((d, i) => (
              <li key={i} data-flag={d.flag ? "1" : "0"}>
                <Verdict level={d.flag ? "warn" : "ok"}>{d.q}</Verdict> <span className="k-small">{d.note}</span>
                {d.flag && d.fix && <div className="k-small"><b>Suggestion:</b> {d.fix}</div>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <h3 className="st-h3">Prior knowledge, recall prediction and actual result</h3>
      <MonitorTable et={et} part={part} />
      <h3 className="st-h3">Objectives and review plan</h3>
      <StatusTable et={et} kazanimlar={part.kazanimlar} now={now} />
    </section>
  );
}

function ResultsScreen({ et, act }) {
  const App = A(), K = KE(), M = KM();
  const pkg = et.package, pr = et.progress, now = Date.now();
  const fin = pkg.final_test.map((q) => pr.answers[q.q_id]).filter(Boolean);
  const ok = fin.filter((a) => a.correct).length;
  const all = K.flatKazanimlar(pkg).map((k) => Object.assign({ st: K.kazanimStatus(App.S, et, k.kazanim_id, now) }, k));
  all.sort((a, b) => (a.st.due_at || Infinity) - (b.st.due_at || Infinity));
  const counts = { ok: 0, warn: 0, bad: 0 };
  all.forEach((k) => { if (k.st.level) counts[k.st.level]++; });
  const errs = fin.filter((a) => a.error).length + pkg.parts.reduce((s, p) => s + p.quiz.filter((q) => pr.answers[q.q_id] && pr.answers[q.q_id].error).length, 0);
  return (
    <>
      <KzHead chips={<Chip tone="accent">Study completed</Chip>} title={pkg.title} />
      <div className="k-kpis">
        <Kpi label="Final test" value={ok + "/" + fin.length} sub={(fin.length ? App.pct(ok / fin.length) : "-") + " correct"} />
        <Kpi label="Strong objectives" value={counts.ok} sub="interval about 3 days or more" />
        <Kpi label="To reinforce" value={counts.warn} sub="review soon" />
        <Kpi label="To study again" value={counts.bad} sub="error or misconception" />
      </div>
      <div className="k-grid2">
        <GapBox o={M.predictionOutcome(et, "final")} title="Final test: prediction and actual" />
        <div className="k-panel st-box">
          <h3>Final test · by part</h3>
          {pkg.parts.map((p, i) => {
            const ids = {};
            p.kazanimlar.forEach((k) => { ids[k.kazanim_id] = true; });
            const qs = pkg.final_test.filter((q) => ids[q.kazanim_id] && pr.answers[q.q_id]);
            const c = qs.filter((q) => pr.answers[q.q_id].correct).length;
            return (
              <div className="st-part-bar" key={i}>
                <span>{p.title}</span>
                <Bar value={qs.length ? c / qs.length : 0} />
                <span className="k-num">{c}/{qs.length}</span>
              </div>
            );
          })}
        </div>
      </div>
      <h3 className="st-h3">Review plan per objective</h3>
      <StatusTable et={et} kazanimlar={all} now={now} />
      <Actions>
        <Btn kind="primary" onClick={() => act("study-cards")}><Cards size={17} aria-hidden="true" />Open objective reviews in Review</Btn>
        <Btn onClick={() => act("open-journal")}><NotePencil size={17} aria-hidden="true" />My learning journal</Btn>
        {errs > 0 && <Btn onClick={() => act("open-errors")}><Bug size={17} aria-hidden="true" />My error log ({errs})</Btn>}
        <Btn onClick={() => act("restart")}><ArrowCounterClockwise size={17} aria-hidden="true" />Restart the study</Btn>
      </Actions>
      <p className="k-small k-muted">Restarting only resets study progress; the DSR history and review plan are kept.</p>
    </>
  );
}

// ------------------------------------------------------------------ routing
function StageBody(p) {
  const st = p.et.progress.stage;
  if (st === "plan") return <PlanScreen {...p} />;
  if (st === "warmup" || st === "retry") return <RoundScreen {...p} />;
  if (st === "priming") return <PrimingScreen {...p} />;
  if (st === "learn") return <LearnScreen {...p} />;
  if (st === "quiz" || st === "final") return <QuestionScreen {...p} />;
  if (st === "teach") return <TeachScreen {...p} />;
  if (st === "journal") return <JournalScreen {...p} pre={<PartResults et={p.et} />} />;
  if (st === "final_review") return <FinalReviewScreen {...p} />;
  return <ResultsScreen {...p} />;
}

export default function Runner({ et, redraw }) {
  const App = A(), K = KE(), U = EU();
  K.migrateProgress(et.progress);
  U.refUnit = (et.package.source && et.package.source.unit) || "slide";
  U.refOffset = (et.package.source && et.package.source.page_offset) || 0;
  if (!et.progress.started_at) { et.progress.started_at = Date.now(); U.commit(et); }
  const key = viewKey(et);
  if (U.getUi().key !== key) U.resetUi(key);
  const ui = U.getUi(), f = ui.form, lv = U.level();
  const set = (name, v) => { U.getUi().form[name] = v; redraw(); };
  // A click from a screen that has already been replaced (double click before the redraw) is ignored
  const act = (a) => { if (viewKey(et) !== key && a !== "library" && a !== "focus-toggle") return; runAct(a, et); };
  const focus = U.focusOn();
  const p = { et, f, set, act, lv, redraw, rate: (r) => rateRecall(et, r) };
  return (
    <div className="k-page st-page st-runner">
      <div className="st-run-head">
        <Btn size="sm" onClick={() => act("library")}><CaretLeft size={15} weight="bold" aria-hidden="true" />Studies</Btn>
        <div className="st-run-title">
          <h1>{et.package.title}</h1>
          <p className="k-small k-muted">{progressLabel(et)}</p>
        </div>
        {et.progress.stage !== "done" && <PhaseTimer et={et} />}
        <Btn size="sm" onClick={() => act("focus-toggle")} aria-pressed={focus}>
          {focus ? <ArrowsIn size={15} weight="bold" aria-hidden="true" /> : <ArrowsOut size={15} weight="bold" aria-hidden="true" />}
          {focus ? "Exit focus" : "Focus mode"}
        </Btn>
      </div>
      <Stepper et={et} />
      <motion.div key={key} className="st-body" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, ease: EASE }}>
        <StageBody {...p} />
      </motion.div>
      <QuestionsDock et={et} />
    </div>
  );
}

// ------------------------------------------------------------------ actions (the legacy act/rateRecall/answerQuestion)
function advance() { A().render(); window.scrollTo(0, 0); }

function rateRecall(et, rating) {
  const U = EU(), pr = et.progress, ui = U.getUi(), loc = recallLoc(et), k = loc.k;
  if (loc.phase !== "check") return; // a second click before the redraw
  const kp = k.recall.key_points || [];
  const checked = U.checkedKp(kp);
  const r = U.record(et, k.kazanim_id, { signal: "recall", rating, response_time_ms: ui.form.ms || null, round: loc.round });
  if (!r) return;
  loc.save({ text: ui.form.draft || "", checked, rating, ms: ui.form.ms || null, at: Date.now() });
  if (pr.stage === "learn") {
    const coverage = kp.length ? checked.length / kp.length : (rating === "again" ? 0 : 1);
    pr.jol[k.kazanim_id] = Object.assign(pr.jol[k.kazanim_id] || {}, { actual: coverage });
  }
  loc.setPhase("rated");
  ui.last = r;
  U.commit(et);
  A().render();
}

function answerQuestion(et) {
  const U = EU(), pr = et.progress, ui = U.getUi(), q = currentQuestion(et).q;
  const choice = Number(ui.form.choice);
  if (pr.answers[q.q_id]) return; // a second click before the redraw
  if (ui.form.choice == null || String(ui.form.reason || "").trim().length < 5 || !ui.form.conf) return;
  const correct = choice === q.correct;
  const r = U.record(et, q.kazanim_id, { signal: pr.stage === "final" ? "final" : "quiz", correct, confidence: ui.form.conf, question_id: q.q_id });
  pr.answers[q.q_id] = { choice, correct, confidence: ui.form.conf, confidence_pct: ui.form.conf_pct == null ? null : ui.form.conf_pct, reason: String(ui.form.reason).trim(), ms: Date.now() - ui.shownAt, at: Date.now(), stage: pr.stage };
  U.commit(et);
  ui.last = r ? Object.assign({ q_id: q.q_id }, r) : null;
  A().render();
}

function runAct(a, et) {
  const App = A(), K = KE(), U = EU(), S = App.S, pr = et.progress, ui = U.getUi(), lv = U.level();
  const k = pr.stage === "learn" ? K.currentKazanim(et) : null;
  switch (a) {
    case "library": App.etutOpen = null; U.setFocus(false); App.render(); return;
    case "focus-toggle": U.setFocus(!U.focusOn()); App.render(); return;
    case "plan-save": U.savePlan(et); K.goNext(S, et); U.commit(et); return advance();
    case "priming-next": K.goNext(S, et); U.commit(et); return advance();
    case "next-sub": K.advanceLearn(S, et); U.commit(et); return advance();
    case "practice-check": {
      const q = k.practice[pr.pi];
      pr.practice[q.q_id] = q.options
        ? { choice: Number(ui.form.choice), correct: Number(ui.form.choice) === q.correct, at: Date.now() }
        : { text: String(ui.form.ptext || ""), at: Date.now() };
      U.commit(et); App.render(); return;
    }
    case "practice-next": {
      const pq = k.practice[pr.pi];
      if (!pq.options) pr.practice[pq.q_id].self = ui.form.pself;
      if (pr.pi + 1 < k.practice.length) pr.pi += 1; else K.advanceLearn(S, et);
      U.commit(et); return advance();
    }
    case "explain-reveal": case "produce-check": case "teach-check":
      ui.form.revealed = true; App.render(); return;
    case "explain-skip": K.advanceLearn(S, et); U.commit(et); return advance();
    case "explain-next": {
      const list = pr.explains[k.kazanim_id] = pr.explains[k.kazanim_id] || [];
      list[pr.ei] = { text: String(ui.form.explain || ""), self: ui.form.self, at: Date.now() };
      if (pr.ei + 1 < K.explainLimit(k, lv.level)) pr.ei += 1; else K.advanceLearn(S, et);
      U.commit(et); return advance();
    }
    case "produce-next": {
      const rub = k.produce.rubric, chk = rub.map((_, i) => i).filter((i) => !!ui.form["rb:" + i]);
      pr.produce[k.kazanim_id] = { text: String(ui.form.produce || ""), checked: chk, coverage: chk.length / rub.length, at: Date.now() };
      K.advanceLearn(S, et); U.commit(et); return advance();
    }
    case "jol-save":
      pr.jol[k.kazanim_id] = Object.assign(pr.jol[k.kazanim_id] || {}, { jol: Number(ui.form.jol) / 100, at: Date.now() });
      K.advanceLearn(S, et); U.commit(et); return advance();
    case "rc-check": {
      const loc = recallLoc(et);
      ui.form.ms = Date.now() - ui.shownAt;
      loc.setPhase("check"); U.commit(et); App.render(); return;
    }
    case "rc-next": {
      if (pr.stage === "learn") K.advanceLearn(S, et);
      else {
        const box = (pr.stage === "warmup" ? pr.warmup : pr.retry)[pr.part];
        if (box.i + 1 < box.kids.length) { box.i += 1; box.sub = "recall"; } else K.goNext(S, et);
      }
      U.commit(et); return advance();
    }
    case "predict-save": {
      const isFinal = pr.stage === "final";
      const n = isFinal ? et.package.final_test.length : et.package.parts[pr.part].quiz.length;
      pr.predictions[isFinal ? "final" : "quiz:" + pr.part] = { predicted: Number(ui.form.predict), n, at: Date.now() };
      pr.sub = "q"; pr.qi = 0; U.commit(et); return advance();
    }
    case "q-attempt": if (String(ui.form.reason || "").trim().length >= 5) { ui.form.attempted = true; App.render(); } return;
    case "answer": answerQuestion(et); return;
    case "final-plan":
      pr.final_open_at = K.finalOpenAt(Date.now(), ui.form.fdelay == null ? 1 : Number(ui.form.fdelay), S.settings.day_start_hour);
      U.commit(et); return advance();
    case "final-now": pr.final_open_at = Date.now(); U.commit(et); return advance();
    case "error-save": {
      const cq = currentQuestion(et), ans = pr.answers[cq.q.q_id];
      ans.error = { type: ui.form.errtype, cause: String(ui.form.errcause || "").trim(), step: String(ui.form.errstep || "").trim(), at: Date.now() };
      ui.errorOpen = false; U.commit(et); App.render(); return;
    }
    case "next-q": {
      const cur = currentQuestion(et), an = pr.answers[cur.q.q_id];
      if (!an || (!an.correct && !an.error)) return;
      if (pr.qi + 1 < cur.n) pr.qi += 1; else K.goNext(S, et);
      U.commit(et); return advance();
    }
    case "teach-save": {
      const part = K.currentPart(et), rubric = U.teachRubric(part);
      const tchk = rubric.map((_, i) => i).filter((i) => !!ui.form["rb:" + i]);
      pr.teach[pr.part] = { text: String(ui.form.teach || ""), checked: tchk, coverage: tchk.length / rubric.length, rubric, at: Date.now() };
      K.goNext(S, et); U.commit(et); return advance();
    }
    case "journal-save": U.saveJournal(et); K.goNext(S, et); U.commit(et); return advance();
    case "final-review-save": {
      const F = U.finalFacts(et);
      pr.final_review = {
        goal_met: ui.form.goal_met, strategy: ui.form.strategy || "", mispredicted: String(ui.form.mispredicted || ""), change: String(ui.form.change || "").trim(), correct: F.correct, n: F.n, at: Date.now(),
      };
      K.goNext(S, et); U.setFocus(false); U.commit(et); return advance();
    }
    case "study-cards": U.setFocus(false); App.goReview(et.deck_id); return;
    case "open-journal": App.etutOpen = null; App.etutLibTab = "gunluk"; U.setFocus(false); return advance();
    case "open-errors": App.etutOpen = null; App.etutLibTab = "hatalar"; U.setFocus(false); return advance();
    case "restart": {
      const fresh = K.newProgress();
      fresh.started_at = Date.now();
      et.progress = fresh; U.commit(et); U.resetUi(null); App.render();
      App.toast("The study restarts; the DSR history was kept.");
      return;
    }
    default: return;
  }
}
