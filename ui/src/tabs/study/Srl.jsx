// Self-regulated learning screens (port of etut-srl.js): plan, recall, JOL, self-explanation, produce, practice,
// score prediction, error log, explain as if teaching, learning journal, study reflection
import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Timer, ArrowRight, Eye, ClipboardText } from "@phosphor-icons/react";
import { EASE, Btn, Field } from "../kit.jsx";
import {
  Md, Inl, Html, Verdict, Chip, LevelChip, Scale, ReqAction, Actions, Callout, KzHead, RecallCard, Compare, UserText, CheckList, TraceLine, GapBox, Blocks,
} from "./common.jsx";
import { A, KE, KM, EU, DSR, LETTERS, YN, YN_TR, signed } from "./util.js";

const PRIOR = [{ v: 0, label: "0 · None" }, { v: 1, label: "1 · Heard of it" }, { v: 2, label: "2 · Can explain a bit" }, { v: 3, label: "3 · Confidently" }];
const DURATIONS = [{ v: 30, label: "30 min" }, { v: 45, label: "45 min" }, { v: 60, label: "60 min" }, { v: 90, label: "90 min" }];

function Section({ title, children }) {
  return <section className="st-q"><h3>{title}</h3>{children}</section>;
}

// ------------------------------------------------------------------ 1 · session plan
// Only what the study flow uses: prior knowledge (monitoring table, Rule 13 diagnosis), the success criterion
// (decides whether the diagnosis opens) and the session length (phase timer)
export function PlanScreen({ et, f, set, act, lv }) {
  const K = KE();
  const pr = et.progress, part = K.currentPart(et), goal = K.autoGoal(part);
  if (f.criterion == null) {
    const old = pr.plans[pr.part] || {};
    f.criterion = String(old.criterion != null ? old.criterion : goal.criterion);
    f.duration = String(old.duration || 90);
    part.kazanimlar.forEach((k) => { if (pr.prior[k.kazanim_id] != null) f["prior:" + k.kazanim_id] = String(pr.prior[k.kazanim_id]); });
  }
  const budget = K.phaseBudget(Number(f.duration));
  const priorReq = part.kazanimlar.map((k) => "prior:" + k.kazanim_id).join(",");

  const sPrior = (
    <Section title="What do I already know about each objective?">
      <p className="k-small k-muted">Rate each objective honestly; it will be compared with your actual recall at the end.</p>
      <div className="st-prior-list">
        {part.kazanimlar.map((k) => (
          <div className="st-prior-row" key={k.kazanim_id}>
            <span>{k.title}</span>
            <Scale label={"Prior knowledge: " + k.title} opts={PRIOR} value={f["prior:" + k.kazanim_id]} onPick={(v) => set("prior:" + k.kazanim_id, v)} />
          </div>
        ))}
      </div>
    </Section>
  );
  const sTest = (
    <Section title="Success criterion">
      <p className="st-inline-num">Closed-book recall after each objective, then a {goal.n}-question quiz. At least
        <input className="k-input st-num-input k-num" type="number" min={1} max={goal.n} aria-label="Success criterion" value={f.criterion} onChange={(e) => set("criterion", e.target.value)} />
        correct.</p>
    </Section>
  );
  const sTime = (
    <Section title="Session length">
      <Scale label="Session length" opts={DURATIONS} value={f.duration} onPick={(v) => set("duration", v)} />
      <p className="k-small k-muted st-phase-plan k-num">{K.PHASES.map((p) => p.label + " " + budget[p.id] + " min").join(" · ")}</p>
    </Section>
  );
  const minimal = lv.level === "minimal";
  return (
    <>
      <KzHead chips={<><Chip>Part {pr.part + 1}/{et.package.parts.length} · Session plan</Chip><LevelChip lv={lv} /></>} title={part.title} />
      <div className="k-panel st-form">
        {minimal ? <>{sTime}<details className="k-panel st-details"><summary>Rate prior knowledge and set the criterion</summary>{sPrior}{sTest}</details></> : <>{sPrior}{sTest}{sTime}</>}
      </div>
      <ReqAction req={minimal ? "" : priorReq} form={f} onClick={() => act("plan-save")}>Save plan and start</ReqAction>
    </>
  );
}

// ------------------------------------------------------------------ recall (learn, warm-up, second round)
function Seconds() {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const ui = EU().getUi();
  return <span className="k-timer k-num st-timer-s" aria-label="Time on this recall"><Timer size={15} aria-hidden="true" />{Math.floor((Date.now() - ui.shownAt) / 1000)} s</span>;
}

export function RecallBlock({ et, loc, f, set, act, rate }) {
  const App = A(), U = EU(), S = App.S;
  const k = loc.k, rc = loc.saved;
  const taRef = useRef(null);
  useEffect(() => { if (loc.phase === "recall" && taRef.current) taRef.current.focus({ preventScroll: true }); }, [loc.key, loc.phase]);
  const prompt = <RecallCard label={loc.label || "Recall"}><Inl src={k.recall.prompt} /></RecallCard>;
  if (loc.phase === "recall") {
    return (
      <>
        {prompt}
        <Field label="Your answer">
          <textarea ref={taRef} id="recall-text" rows={4} value={f.draft || ""} onChange={(e) => set("draft", e.target.value)}
            placeholder="Write as much as you remember in your own words. If you remember nothing, leave it empty and check." />
        </Field>
        <Actions><Btn kind="primary" onClick={() => act("rc-check")}><Eye size={17} weight="bold" aria-hidden="true" />Check</Btn><Seconds /></Actions>
      </>
    );
  }
  const kp = k.recall.key_points || [];
  const answer = rc ? rc.text : (f.draft || "");
  const compare = (
    <Compare leftTitle="Your answer" left={<UserText text={answer} empty="Left empty" />}
      rightTitle="Model answer" right={<>
        <Md src={k.recall.model_answer} />
        {kp.length > 0 && <><p className="k-small k-muted st-mt">Tick the key points that are in your answer:</p>
          <CheckList items={kp} prefix="kp:" form={f} set={set} fixed={rc ? (rc.checked || []) : null} /></>}
      </>} />
  );
  if (loc.phase === "check") {
    const cid = et.card_map[k.kazanim_id], card = S.cards[cid], mem = S.mem[cid];
    const pv = card && mem ? DSR().previewIntervals(card, mem, U.env(Date.now())) : null;
    return (
      <>
        {prompt}{compare}
        <Html as="p" className="k-small st-suggest" html={U.suggestText(kp).replace(/ \(Rule \d+\)/, "")} />
        <div className="k-rate-grid st-rate-grid" role="group" aria-label="Rate your recall: keys 1 to 4">
          {DSR().RATING_ORDER.map((r, i) => (
            <motion.button key={r} type="button" className="k-rate" data-r={r} data-rc-rate={r}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE, delay: i * 0.03 }}
              whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} onClick={() => rate(r)}>
              <b>{App.RATING_TR[r]}</b><small>{pv ? App.fmtMs(pv[r]) : ""}</small><span className="k-kbd">{i + 1}</span>
            </motion.button>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      {prompt}{compare}
      <TraceLine r={EU().getUi().last} />
      <Actions><Btn kind="primary" onClick={() => act("rc-next")}>{loc.nextLabel || "Continue"}<ArrowRight size={17} weight="bold" aria-hidden="true" /></Btn></Actions>
    </>
  );
}

// ------------------------------------------------------------------ JOL: recall prediction
export function JolBlock({ k, f, set, act }) {
  const opts = [];
  for (let v = 0; v <= 100; v += 10) opts.push({ v, label: v + "%" });
  return (
    <>
      <div className="k-panel st-box">
        <h3>Recall prediction</h3>
        <p>The lesson text will be hidden in a moment. How likely are you to explain the objective <b>{k.title}</b> without notes?</p>
        <Scale label="Recall prediction" opts={opts} value={f.jol} onPick={(v) => set("jol", v)} wide />
        <p className="k-small k-muted">Your prediction is compared with the share of key points you tick during recall. It does not affect DSR; it only measures how accurately you monitor yourself.</p>
      </div>
      <ReqAction req="jol" form={f} onClick={() => act("jol-save")}>Save prediction, go to recall</ReqAction>
    </>
  );
}

// ------------------------------------------------------------------ self-explanation
export function ExplainBlock({ et, k, f, set, act, lv }) {
  const pr = et.progress, limit = KE().explainLimit(k, lv.level), item = k.self_explain[pr.ei];
  const title = "Self-explanation " + (limit > 1 ? (pr.ei + 1) + "/" + limit : "");
  if (!f.revealed) {
    return (
      <>
        <div className="k-panel st-box">
          <h3>{title}</h3>
          <p className="st-explain-q"><Inl src={item.prompt} /></p>
          <textarea className="k-input" rows={4} value={f.explain || ""} onChange={(e) => set("explain", e.target.value)} placeholder="Explain it in your own words, without looking at the notes." aria-label="Your explanation" />
          <p className="k-small k-muted">Questions: Why is this true? What does it connect to? When does it not hold? How would I apply it to a new example?</p>
        </div>
        <ReqAction req={lv.level === "minimal" ? "" : "explain@10"} form={f} onClick={() => act("explain-reveal")}
          extra={lv.level === "minimal" ? <Btn onClick={() => act("explain-skip")}>Skip</Btn> : null}>Compare my explanation</ReqAction>
      </>
    );
  }
  return (
    <>
      <div className="k-panel st-box">
        <h3>{title}</h3>
        <p className="st-explain-q"><Inl src={item.prompt} /></p>
        <Compare leftTitle="Your explanation" left={<UserText text={f.explain} />} rightTitle="Explanation based on the slides" right={<Md src={item.reference} />} />
        <p className="k-small">Does your explanation match it?</p>
        <Scale label="Does your explanation match it?" opts={YN} value={f.self} onPick={(v) => set("self", v)} />
      </div>
      <ReqAction req="self" form={f} onClick={() => act("explain-next")}>Continue</ReqAction>
    </>
  );
}

// ------------------------------------------------------------------ produce: example / draft / attempt
export function ProduceBlock({ k, f, set, act }) {
  const p = k.produce, label = KE().PRODUCE_TR[k.kind || "kavram"];
  if (!f.revealed) {
    return (
      <>
        <div className="k-panel st-box">
          <h3>{label}</h3>
          <p><Inl src={p.prompt} /></p>
          <textarea className="k-input" rows={5} value={f.produce || ""} onChange={(e) => set("produce", e.target.value)} placeholder="Write your own example or attempt." aria-label={label} />
        </div>
        <ReqAction req="produce@10" form={f} onClick={() => act("produce-check")}>Assess against the rubric</ReqAction>
      </>
    );
  }
  return (
    <>
      <div className="k-panel st-box">
        <h3>{label}</h3>
        <p><Inl src={p.prompt} /></p>
        <UserText text={f.produce} />
        <p className="k-small k-muted">Rubric: tick the items you met.</p>
        <CheckList items={p.rubric} prefix="rb:" form={f} set={set} />
      </div>
      <Actions><Btn kind="primary" onClick={() => act("produce-next")}>Continue</Btn></Actions>
    </>
  );
}

// Multiple-choice options (practice, quiz, final)
export function Options({ q, saved, notes, f, set }) {
  return (
    <ol className="st-opts" role={saved ? undefined : "radiogroup"}>
      {q.options.map((o, i) => {
        let st = "";
        if (saved) st = i === q.correct ? "correct" : i === saved.choice ? "wrong" : "dim";
        else if (String(f.choice) === String(i)) st = "selected";
        const note = saved && notes && notes[i];
        const mark = saved && notes !== undefined ? (i === q.correct ? "Correct answer" : i === saved.choice ? "Your choice" : "") : "";
        return (
          <li key={i}>
            <motion.button type="button" className="st-opt" data-st={st || undefined} disabled={!!saved}
              role={saved ? undefined : "radio"} aria-checked={saved ? undefined : st === "selected"}
              whileTap={saved ? undefined : { scale: 0.99 }} onClick={() => set("choice", String(i))}>
              <motion.span key={st} className="st-letter" initial={st ? { scale: 0.8 } : false} animate={{ scale: 1 }} transition={{ duration: 0.22, ease: EASE }}>{LETTERS[i]}</motion.span>
              <span className="st-opt-body">
                <Inl src={o} />
                {mark && <span className="st-opt-mark">{mark}</span>}
                {note && <span className="st-opt-note"><Inl src={note} /></span>}
              </span>
            </motion.button>
          </li>
        );
      })}
    </ol>
  );
}

// ------------------------------------------------------------------ practice (problem type)
export function PracticeBlock({ et, k, f, set, act }) {
  const pr = et.progress, q = k.practice[pr.pi], saved = pr.practice[q.q_id];
  const title = "Practice " + (k.practice.length > 1 ? (pr.pi + 1) + "/" + k.practice.length : "");
  if (q.options) {
    return (
      <>
        <div className="k-panel st-box">
          <h3>{title}</h3>
          <Md className="st-stem" src={q.stem} />
          <Options q={q} saved={saved} f={f} set={set} />
          {saved && <>
            <p className="st-verdict-line">{saved.correct ? <Verdict level="ok">Correct</Verdict> : <Verdict level="bad">Wrong</Verdict>}</p>
            <div className="st-solution"><h3>Solution</h3><Md src={q.solution} /></div>
          </>}
        </div>
        {!saved
          ? <ReqAction req="choice" form={f} onClick={() => act("practice-check")}>Check</ReqAction>
          : <Actions><Btn kind="primary" onClick={() => act("practice-next")}>Continue</Btn></Actions>}
      </>
    );
  }
  if (!saved) {
    return (
      <>
        <div className="k-panel st-box">
          <h3>{title}</h3>
          <Md className="st-stem" src={q.stem} />
          <textarea className="k-input" rows={4} value={f.ptext || ""} onChange={(e) => set("ptext", e.target.value)} placeholder="Write your solution step by step." aria-label="Your solution" />
        </div>
        <ReqAction req="ptext@5" form={f} onClick={() => act("practice-check")}>Show solution</ReqAction>
      </>
    );
  }
  return (
    <>
      <div className="k-panel st-box">
        <h3>{title}</h3>
        <Md className="st-stem" src={q.stem} />
        <Compare leftTitle="Your solution" left={<UserText text={saved.text} />} rightTitle="Solution" right={<Md src={q.solution} />} />
        <p className="k-small">Was your solution correct?</p>
        <Scale label="Was your solution correct?" opts={[{ v: "dogru", label: "Correct" }, { v: "kismen", label: "Partly" }, { v: "yanlis", label: "Wrong" }]} value={f.pself || saved.self} onPick={(v) => set("pself", v)} />
      </div>
      <ReqAction req="pself" form={f} onClick={() => act("practice-next")}>Continue</ReqAction>
    </>
  );
}

// ------------------------------------------------------------------ score prediction
export function PredictBlock({ n, isFinal, f, set, act }) {
  const opts = [];
  for (let i = 0; i <= n; i++) opts.push({ v: i, label: String(i) });
  return (
    <>
      <div className="k-panel st-box">
        <h3>Prediction before the {isFinal ? "final test" : "quiz"}</h3>
        <p>How many of the {n} questions do you think you will get right?</p>
        <Scale label="Predicted correct answers" opts={opts} value={f.predict} onPick={(v) => set("predict", v)} wide />
        <p className="k-small k-muted">When the test ends, your prediction is compared with the actual result: calibration gap = predicted success − actual success.</p>
      </div>
      <ReqAction req="predict" form={f} onClick={() => act("predict-save")}>Save prediction and start</ReqAction>
    </>
  );
}

// ------------------------------------------------------------------ error log + adaptation
export function ErrorLogBlock({ ans, lv, k, f, set, act }) {
  const M = KM();
  if (ans.error) {
    const t = M.ERROR_BY_ID[ans.error.type];
    return (
      <motion.div className="k-panel st-box st-errlog" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
        <h3>Error log</h3>
        <p className="st-gap-line"><Verdict level="warn">{t.label}</Verdict>{ans.error.cause ? <span>Cause: {ans.error.cause}</span> : null}</p>
        {ans.error.step && <p className="k-small">Next time: <b>{ans.error.step}</b></p>}
        <Callout label="Suggested adaptation"><p>{t.action}</p></Callout>
        {t.reread && k && (
          <details className="st-reread"><summary>Reread the objective: {k.title}</summary><Blocks blocks={k.blocks} /></details>
        )}
      </motion.div>
    );
  }
  if (f.errtype == null && ans.confidence === "sure") f.errtype = "kavram_yanilgisi";
  const need = lv.level === "minimal" ? "errtype" : "errtype,errcause@3,errstep@3";
  return (
    <motion.div className="k-panel st-box st-errlog" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <h3>Error log</h3>
      <p className="k-small k-muted">An error is not a failure; it is a source of data.
        {ans.confidence === "sure" ? " Wrong although you were sure: “misconception” is suggested; change it if you like." : ""}</p>
      <p className="k-small"><b>1 · Type of error</b></p>
      <Scale label="Type of error" opts={M.ERROR_TYPES.map((t) => ({ v: t.id, label: t.label }))} value={f.errtype} onPick={(v) => set("errtype", v)} />
      <Field label="2 · Cause of the error"><textarea rows={2} value={f.errcause || ""} onChange={(e) => set("errcause", e.target.value)} placeholder="Why did you pick this option; what was missing?" /></Field>
      <Field label="3 · The concrete step I will take next time"><textarea rows={2} value={f.errstep || ""} onChange={(e) => set("errstep", e.target.value)} placeholder="For example: I will restate the question stem in my own words." /></Field>
      <ReqAction req={need} form={f} onClick={() => act("error-save")}>Complete the error entry</ReqAction>
    </motion.div>
  );
}

// ------------------------------------------------------------------ explain as if teaching
export function TeachScreen({ et, f, set, act }) {
  const pr = et.progress, part = KE().currentPart(et), rubric = EU().teachRubric(part);
  const prompt = (part.teach && part.teach.prompt) || "Write this part out without notes, as if explaining it to a friend who knows nothing about the topic.";
  const head = (
    <>
      <KzHead chips={<Chip>Part {pr.part + 1} · Explain as if teaching</Chip>} title={part.title} />
      <RecallCard label="Teaching task"><Inl src={prompt} /></RecallCard>
    </>
  );
  if (!f.revealed) {
    return (
      <>
        {head}
        <textarea className="k-input" rows={8} value={f.teach || ""} onChange={(e) => set("teach", e.target.value)} aria-label="Your explanation"
          placeholder="Start from the main ideas, then add cause–effect relations and an example." />
        <ReqAction req="teach@40" form={f} onClick={() => act("teach-check")} note="Lesson texts are hidden at this step.">Assess against the rubric</ReqAction>
      </>
    );
  }
  return (
    <>
      {head}
      <Compare leftTitle="Your explanation" left={<UserText text={f.teach} />}
        rightTitle="Rubric" right={<><p className="k-small k-muted">Tick the items your explanation clearly covers.</p><CheckList items={rubric} prefix="rb:" form={f} set={set} /></>} />
      <Actions><Btn kind="primary" onClick={() => act("teach-save")}>Save and go to the reflection</Btn></Actions>
    </>
  );
}

// ------------------------------------------------------------------ learning journal
export function JournalScreen({ et, f, set, act, lv, pre }) {
  const App = A(), U = EU();
  const pr = et.progress, part = KE().currentPart(et), F = U.partFacts(et, pr.part);
  if (f.explainable == null) { f.explainable = F.good.join("\n"); f.struggled = F.hard.join("\n"); }
  const qExpl = <Field label="What can I explain without notes?"><textarea rows={3} value={f.explainable} onChange={(e) => set("explainable", e.target.value)} /></Field>;
  const qStr = (
    <>
      <Field label="Which question or concept did I struggle with?"><textarea rows={3} value={f.struggled} onChange={(e) => set("struggled", e.target.value)} /></Field>
      <Field label="What was the evidence of the difficulty?"><textarea rows={2} value={f.evidence || ""} onChange={(e) => set("evidence", e.target.value)} placeholder="For example: I got question 3 wrong even though I was sure." /></Field>
    </>
  );
  const qStrat = (
    <div className="k-field"><span className="k-field-label">Which strategy worked?</span>
      <Scale label="Which strategy worked?" opts={F.used.map((s) => ({ v: s, label: s }))} value={f.strategy} onPick={(v) => set("strategy", v)} />
    </div>
  );
  const qChange = <Field label={<b>The one thing I will change next session</b>}><textarea rows={2} value={f.change || ""} onChange={(e) => set("change", e.target.value)} placeholder="A single, concrete change." /></Field>;
  const fields = lv.level === "full" ? <>{qExpl}{qStr}{qStrat}{qChange}</> : lv.level === "short" ? <>{qStr}{qStrat}{qChange}</> : qChange;
  return (
    <>
      <KzHead chips={<><Chip>Part {pr.part + 1} · Learning journal</Chip><LevelChip lv={lv} /></>} title={part.title} />
      {pre}
      <h3 className="st-h3">Learning journal</h3>
      <div className="k-panel st-box">
        <h3>Filled in automatically</h3>
        <dl className="st-facts">
          <div><dt>Recall prediction (JOL) gap</dt><dd className="k-num">{F.jol_gap != null ? signed(F.jol_gap) + " points" : "-"}</dd></div>
          <div><dt>Review date</dt><dd className="k-num">{F.review_at ? App.fmtDate(F.review_at) : "-"}</dd></div>
          <div><dt>Strategies I used</dt><dd>{F.used.join(", ")}</dd></div>
        </dl>
      </div>
      <div className="k-panel st-box st-fields">{fields}</div>
      <ReqAction req="change@5" form={f} onClick={() => act("journal-save")}>
        {pr.part + 1 < et.package.parts.length ? "Save the journal and plan the next part" : "Save the journal and go to the final test"}
      </ReqAction>
    </>
  );
}

// ------------------------------------------------------------------ study reflection (E1–E5)
export function FinalReviewScreen({ et, f, set, act, lv }) {
  const F = EU().finalFacts(et);
  if (f.mispredicted == null) f.mispredicted = F.mispredicted.join("\n");
  const suggest = F.ratio >= 0.75 ? "evet" : F.ratio >= 0.5 ? "kismen" : "hayir";
  const strategies = ["Retrieval", "Self-explanation", "Generating examples", "Worked example + practice", "Second round", "Explaining as if teaching"];
  return (
    <>
      <KzHead chips={<><Chip>Study reflection</Chip><LevelChip lv={lv} /></>} title={et.package.title} />
      <GapBox o={F.prediction} title="Final test: prediction and actual" />
      <div className="k-panel st-box st-fields">
        <div className="k-field"><span className="k-field-label"><b>E1 · Did I reach my goal?</b> Final test <span className="k-num">{F.correct}/{F.n}</span> (suggestion: {YN_TR[suggest]})</span>
          <Scale label="Did I reach my goal?" opts={YN} value={f.goal_met} onPick={(v) => set("goal_met", v)} />
        </div>
        {lv.level !== "minimal" && <>
          <div className="k-field"><span className="k-field-label"><b>E2 · Which strategy worked?</b></span>
            <Scale label="Which strategy worked?" opts={strategies.map((s) => ({ v: s, label: s }))} value={f.strategy} onPick={(v) => set("strategy", v)} />
          </div>
          <Field label={<b>E3 · What did I mispredict?</b>}><textarea rows={3} value={f.mispredicted} onChange={(e) => set("mispredicted", e.target.value)} /></Field>
        </>}
        <Field label={<b>E4 · How will I change my next study session?</b>}><textarea rows={2} value={f.change || ""} onChange={(e) => set("change", e.target.value)} /></Field>
      </div>
      <ReqAction req="goal_met,change@5" form={f} onClick={() => act("final-review-save")}>Save the reflection and see results</ReqAction>
    </>
  );
}
