// One question of Study v2: answer → (optional help in practice) → commit → feedback → self-check → DSR line → Explain / follow-up / report.
// In the final test the feedback waits for the end of the block (held = true).
import React, { useState } from "react";
import { Lightbulb, ListNumbers, Eye, BookOpenText, ChatCircleText, ArrowsClockwise, Flag, ArrowRight, CheckCircle, XCircle, MinusCircle, Circle, Robot, Question } from "@phosphor-icons/react";
import { Btn } from "../../kit.jsx";
import { Md, Html, Chip, Scale, Blocks } from "../common.jsx";
import { AskPair } from "../../Cents.jsx";
import ModelHint from "../../ModelHint.jsx";
import { useModelReady, useModelCall, CallStatus, CopyPromptBtn, RequestPreview, byLine } from "../../../model-call.jsx";
import SidePanel from "../../../SidePanel.jsx";
import { CheckThis } from "../../../research.jsx";
import ConfidenceSlider from "../ConfidenceSlider.jsx";
import Thinking from "../Thinking.jsx";
import { A, KC, KE, EU, extrasOf, save, sendAttempt, refsText, criterionText, LETTERS, RATINGS } from "./lib.js";

export function ItemHead({ item, attempt, index, total, pkg }) {
  const K = KC();
  const conn = K.isConnecting && K.isConnecting(item) ? (pkg ? K.topicTitles(pkg, item.integrates) : item.integrates) : null;
  return (
    <div className="cy-item-head">
      {total ? <Chip>{index + 1} / {total}</Chip> : null}
      <Chip tone="accent">{K.FORMAT_LABEL[item.format] || item.format}</Chip>
      {item.origin && <Chip title={item.source_ref || ""}>{K.ORIGIN_LABEL[item.origin]}{item.source_ref ? " · " + item.source_ref : ""}</Chip>}
      {item.performance && item.performance !== "recall" && <Chip>{item.performance}</Chip>}
      {item.followup_of && <Chip tone="accent" title={item.made_by ? "Written by " + byLine(item.made_by) : ""}>Follow-up practice</Chip>}
      {conn && <Chip tone="accent" title={"Brings together: " + conn.join(" · ")}>Connects {conn.length} topics</Chip>}
      {item.validation && item.validation !== "verified" && <span className="k-lvl" data-l="warn" title={item.validation_note || ""}>{item.validation === "disputed" ? "Disputed question" : "Key not verified"} · never counts</span>}
      {attempt && attempt.warmup && <Chip>Warm-up</Chip>}
    </div>
  );
}

function Figure({ fig }) {
  if (!fig || !fig.svg) return null;
  const svg = KE().sanitizeSvg(fig.svg);
  if (!svg) return null;
  return (
    <figure className="cy-figure">
      <Html html={svg} />
      {(fig.caption || fig.ref) && <figcaption className="k-small k-muted">{fig.caption}{fig.ref ? " (" + fig.ref + ")" : ""}</figcaption>}
    </figure>
  );
}

function optMd(item, id) { const o = (item.options || []).filter((x) => x.id === id)[0]; return o ? o.md : id; }

export default function Item({ et, item, attempt, held, onNext, nextLabel, part }) {
  const K = KC(), App = A(), pkg = et.package;
  const [f, setF] = useState({ choice: [], text: "", thinking: "", number: "", conf: null, dk: false, produced: "" });
  const [marks, setMarks] = useState({});
  const [kp, setKp] = useState([]);
  const [proposal, setProposal] = useState(null);   // a model's proposed grading of a typed answer, until the learner confirms it
  const [panel, setPanel] = useState(null);
  const committed = !!attempt.committed_at;
  const practice = attempt.mode === "practice";
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const fmt = item.format;
  const order = attempt.order && attempt.order.length ? attempt.order : (item.options || []).map((o) => o.id);
  const help = (kind) => { if (K.useHelp(attempt, kind)) save(et); };
  // Confidence is a 0-100 number (null until the slider is touched); "I don't know" needs no answer and no confidence
  const answered = fmt === "mcq_single" || fmt === "mcq_multi" ? f.choice.length > 0 : fmt === "numeric" ? String(f.number).trim() !== "" : f.text.trim().length > 0;
  const ready = fmt === "recall" ? f.text.trim().length > 0
    : f.dk || (answered && f.conf != null && (!item.produce_first || f.produced.trim().length >= 5));
  const commit = () => {
    if (!ready) return;
    K.commit(et, attempt, { choice: f.dk ? [] : f.choice, text: f.dk ? "" : f.text || f.produced, thinking: f.thinking, number: f.dk ? null : f.number, confidence_pct: f.dk ? null : f.conf, dont_know: f.dk }, item, Date.now());
    // Deterministic grades go to DSR at once (the final test sends them without showing anything)
    if (attempt.grading === "auto") sendAttempt(et, attempt, item); else EU().commit(et);
    App.render();
  };
  const ex = extrasOf(et), explanations = K.explanationsOf(attempt, ex);

  return (
    <article className="k-panel cy-item" data-held={held ? "1" : undefined}>
      {practice && !held && <SidePanel ctx={window.KSide.itemContext(pkg, item, attempt)} list={et.progress.side || (et.progress.side = [])} save={() => save(et)} onOpen={() => help("side")}
        helpNote={committed ? "" : "Opening this counts as help for this question, like opening the lesson."} />}
      <ItemHead item={item} attempt={attempt} pkg={pkg} />
      <Md src={item.stem} className="cy-stem" />
      <Figure fig={item.figure} />

      {!committed && (
        <div className="cy-answer">
          {item.produce_first && (
            <label className="k-field">
              <span className="k-field-label">First write your answer and how you got it; the options open after that</span>
              <textarea className="k-input" rows={3} value={f.produced} onChange={(e) => set("produced", e.target.value)} />
            </label>
          )}
          {(fmt === "mcq_single" || fmt === "mcq_multi") && (!item.produce_first || f.produced.trim().length >= 5) && (
            <fieldset className="cy-opts">
              <legend className="k-small k-muted">{fmt === "mcq_multi" ? "Select all that apply." : "Choose one answer."}</legend>
              {order.map((id, i) => {
                const on = f.choice.indexOf(id) >= 0;
                return (
                  <label key={id} className="cy-opt" data-on={on ? "1" : undefined}>
                    <input type={fmt === "mcq_multi" ? "checkbox" : "radio"} name={"opt-" + attempt.id} checked={on}
                      onChange={() => set("choice", fmt === "mcq_multi" ? (on ? f.choice.filter((x) => x !== id) : f.choice.concat(id)) : [id])} />
                    <span className="cy-letter">{LETTERS[i]}</span>
                    <Md src={optMd(item, id)} as="span" className="cy-opt-text" />
                  </label>
                );
              })}
            </fieldset>
          )}
          {fmt === "numeric" && (
            <label className="k-field cy-num">
              <span className="k-field-label">Your answer{item.numeric && item.numeric.unit ? " (" + item.numeric.unit + ")" : ""}</span>
              <input className="k-input" inputMode="decimal" value={f.number} onChange={(e) => set("number", e.target.value)} />
            </label>
          )}
          {(fmt === "typed" || fmt === "recall") && (
            <label className="k-field">
              <span className="k-field-label">{fmt === "recall" ? "Write it from memory" : "Your answer"}</span>
              <textarea className="k-input" rows={fmt === "recall" ? 4 : 5} value={f.text} onChange={(e) => set("text", e.target.value)} />
            </label>
          )}
          <Thinking value={f.thinking} onChange={(v) => set("thinking", v)} label="Your thinking (optional; it also helps an explanation later)" />
          {fmt !== "recall" && (
            <div className="cy-conf">
              <ConfidenceSlider value={f.dk ? null : f.conf} dontKnow={f.dk} onChange={(v) => setF((x) => ({ ...x, conf: v, dk: false }))}
                onDontKnow={() => setF((x) => ({ ...x, dk: !x.dk }))} />
            </div>
          )}
          {practice && (
            <HelpRow et={et} item={item} attempt={attempt} help={help} part={part} draft={{ choice: f.dk ? [] : f.choice, text: f.text || f.produced, number: f.number, thinking: f.thinking }} />
          )}
          <div className="cy-actions">
            <Btn kind="primary" disabled={!ready} onClick={commit}>{attempt.mode === "final" ? "Submit" : "Check"}</Btn>
            {!ready && <span className="k-small k-muted">{fmt === "recall" ? "Write something first (a guess is fine)." : "Answer and set how sure you are, or choose I don't know."}</span>}
          </div>
        </div>
      )}

      {committed && held && <p className="k-small k-muted cy-held">Answer saved. Feedback comes after the last question of this block.</p>}

      {committed && !held && (
        <Feedback et={et} item={item} attempt={attempt} marks={marks} setMarks={setMarks} kp={kp} setKp={setKp} proposal={proposal} setProposal={setProposal} />
      )}

      {committed && !held && explanations.map((explanation, i) => (
        <section key={explanation.n + "-" + i} className="cy-expl">
          <h3 className="st-h3">{explanation.from_file ? "Explanation from Claude Code" : "Explanation" + (explanations.length > 1 ? " " + (i + 1) : "")}</h3>
          {explanation.item_status === "disputed" && <p className="k-lvl" data-l="warn">The explanation found a problem with this question{explanation.item_note ? ": " + explanation.item_note : ""}</p>}
          <Md src={explanation.md} />
          {(explanation.refs || []).length > 0 && <p className="k-small k-muted">Sources: {explanation.refs.join(" · ")}</p>}
          {(explanation.next_steps || []).length > 0 && <ul className="k-small k-muted">{explanation.next_steps.map((s, j) => <li key={j}>{s}</li>)}</ul>}
          {!explanation.from_file && explanation.by && <p className="k-small k-muted mc-by">Written by {byLine(explanation.by)}. Reading it does not count as recall.</p>}
          <CheckThis claim={String(explanation.md || "").split(/(?<=[.!?])\s/)[0].slice(0, 400)} context={explanation.md} sources={(explanation.refs || []).join(", ")} target={{ kind: "explanation", etut_id: et.etut_id, attempt: attempt.id, n: explanation.n == null ? i : explanation.n }} editable />
        </section>
      ))}

      {committed && !held && (
        <div className="cy-actions cy-after">
          <Btn size="sm" onClick={() => setPanel(panel === "explain" ? null : "explain")}><ChatCircleText size={15} aria-hidden="true" />Explain</Btn>
          {attempt.mode !== "final" && <Btn size="sm" onClick={() => setPanel(panel === "follow" ? null : "follow")}><ArrowsClockwise size={15} aria-hidden="true" />Practice this again</Btn>}
          <Btn size="sm" onClick={() => setPanel(panel === "report" ? null : "report")}><Flag size={15} aria-hidden="true" />{attempt.disputed ? "Problem reported" : "Report a problem"}</Btn>
          {onNext && <Btn kind="primary" size="sm" className="cy-next" onClick={onNext}>{nextLabel || "Next"}<ArrowRight size={15} weight="bold" aria-hidden="true" /></Btn>}
        </div>
      )}
      {committed && !held && panel === "explain" && <ExplainPanel et={et} item={item} attempt={attempt} />}
      {committed && !held && panel === "follow" && <FollowPanel et={et} item={item} attempt={attempt} />}
      {committed && !held && panel === "report" && <ReportPanel et={et} item={item} attempt={attempt} close={() => setPanel(null)} />}
    </article>
  );
}

function HelpRow({ et, item, attempt, help, part, draft }) {
  const hints = item.hints || [], steps = item.steps || [];
  const [lesson, setLesson] = useState(false);
  return (
    <div className="cy-help">
      <p className="k-small k-muted">Help is fine in practice. An answer after help is kept as practice with help, not as independent recall.</p>
      <ModelHints et={et} item={item} attempt={attempt} draft={draft} />
      <div className="cy-help-btns">
        {attempt.hints < hints.length && <Btn size="sm" onClick={() => help("hint")}><Lightbulb size={15} aria-hidden="true" />Hint {attempt.hints + 1}/{hints.length}</Btn>}
        {attempt.steps < steps.length && <Btn size="sm" onClick={() => help("step")}><ListNumbers size={15} aria-hidden="true" />Show a step</Btn>}
        {(item.solution || (item.rubric && item.rubric.model) || item.model) && !attempt.solution_shown && <Btn size="sm" onClick={() => help("solution")}><Eye size={15} aria-hidden="true" />Show the solution</Btn>}
        {part && <Btn size="sm" aria-pressed={lesson} onClick={() => { if (!lesson) help("pane"); setLesson(!lesson); }}><BookOpenText size={15} aria-hidden="true" />{lesson ? "Hide the lesson" : "Open the lesson"}</Btn>}
      </div>
      {attempt.hints > 0 && <ol className="cy-hints">{hints.slice(0, attempt.hints).map((h, i) => <li key={i}><Md src={h} as="span" /></li>)}</ol>}
      {attempt.steps > 0 && <ol className="cy-hints">{steps.slice(0, attempt.steps).map((s, i) => <li key={i}><b>{s.do}</b>{s.why ? <span className="k-muted"> — {s.why}</span> : null}</li>)}</ol>}
      {attempt.solution_shown && <div className="cy-solution"><Md src={item.solution || (item.rubric && item.rubric.model) || item.model} /></div>}
      {lesson && part && <div className="cy-lesson-peek">{part.kazanimlar.map((k) => <div key={k.kazanim_id}><h3 className="st-h3">{k.title}</h3><Blocks blocks={k.blocks} /></div>)}</div>}
    </div>
  );
}

// "Ask for a hint" (task F2, LEARNING-PROTOCOL 3.4): with a model set up, one rung of help per press, from the least revealing up. It reads the
// item, its solution and criteria and what has been entered so far; each rung is recorded on the attempt as assistance and its level is
// shown. The package's own hints, steps and solution below are the only help without a model.
function ModelHints({ et, item, attempt, draft }) {
  const K = KC(), mr = useModelReady("fast"), call = useModelCall();
  const given = (attempt.help || []).filter((h) => h.kind === "model_hint" || h.kind === "statement_repair");
  const next = K.nextRung(attempt);
  const ask = async (requested) => {
    let probs = [], last = "The hint could not be used.";
    // one automatic second try that tells the model what was wrong with the first
    for (let n = 0; n < 2; n++) {
      const r = await call.run("hint-giver", K.hintInputs(et, attempt, item, draft, requested, probs), { feature: "hint-giver", maxOutputTokens: 1000 });
      if (!r.ok) return;
      const s = K.recordModelHint(attempt, item, r.json, { requested, now: Date.now(), meta: r.meta, prompt: r.prompt });
      if (s.ok) { save(et); return; }
      probs = s.problems; last = s.error;
    }
    call.fail(last);
  };
  if (!mr.ready && !given.length) return null;
  return (
    <div className="cy-mhints">
      {mr.ready && (
        <div className="cy-help-btns">
          <Btn size="sm" disabled={call.busy || !next} onClick={() => ask(next)} title="One step of help, the least revealing first. It reads your question, your answer and your thinking so far.">
            <Robot size={15} aria-hidden="true" />{given.some((h) => h.kind === "model_hint") ? "Ask for the next step" : "Ask for a hint"}
          </Btn>
          <Btn size="sm" disabled={call.busy} onClick={() => ask("statement_repair")} title="Explains what the question asks, nothing about the solution. It does not count as help."><Question size={15} aria-hidden="true" />I don't understand what is asked</Btn>
          {!next && <span className="k-small k-muted">No further hint level. The solution below is the last step.</span>}
        </div>
      )}
      <CallStatus call={call} />
      {given.length > 0 && (
        <ol className="cy-hints">
          {given.map((h, i) => (
            <li key={i}>
              <b>{h.kind === "statement_repair" ? "What is asked" : "Level " + h.level + " · " + K.RUNG_LABEL[h.level]}</b>
              <span className="k-small k-muted"> ({K.RUNG_GIVES[h.level]}{h.kind === "statement_repair" ? "; free, not counted as help" : ""})</span>
              <p>{h.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DsrLine({ attempt }) {
  const d = attempt.dsr;
  if (!d) return null;
  const cap = (x) => (x ? String(x).charAt(0).toUpperCase() + String(x).slice(1) : x);
  if (d.status === "sent") return attempt.disputed
    ? <p className="cy-dsr"><MinusCircle size={15} aria-hidden="true" />Sent to your reviews as <b>{cap(d.rating)}</b> before you reported it; later reviews build on it, so it stays. The study's evidence leaves it out.</p>
    : <p className="cy-dsr" data-s="sent"><CheckCircle size={15} weight="fill" aria-hidden="true" />Sent to your reviews as <b>{cap(d.rating)}</b> (the objective's card).</p>;
  if (d.status === "withdrawn") return <p className="cy-dsr"><MinusCircle size={15} aria-hidden="true" />Withdrawn from your reviews: you reported a problem with this question.</p>;
  return <p className="cy-dsr"><MinusCircle size={15} aria-hidden="true" />Kept as evidence, not sent to reviews: {d.reason}.</p>;
}

function Feedback({ et, item, attempt, marks, setMarks, kp, setKp, proposal, setProposal }) {
  const K = KC(), App = A(), r = attempt.result || {}, fmt = item.format, pkg = et.package;
  if (attempt.dont_know) {
    // A gap, not a wrong guess (LEARNING-PROTOCOL 2.2): counted as not correct, no confidence, never a misconception
    const modelAns = fmt === "mcq_single" || fmt === "mcq_multi" ? (item.key || []).map((id) => optMd(item, id)).join(" · ")
      : fmt === "numeric" ? item.numeric.value + (item.numeric.tol ? " ± " + item.numeric.tol : "") + (item.numeric.unit ? " " + item.numeric.unit : "")
        : (item.rubric && item.rubric.model) || item.solution || "";
    return (
      <div className="cy-fb">
        <p className="cy-verdict" data-ok="u"><Question size={18} aria-hidden="true" />You chose “I don't know”. It is kept as a gap, not as a wrong guess.</p>
        {modelAns && <div className="cy-compare"><div><b>The answer</b><Md src={modelAns} /></div></div>}
        {item.solution && <div className="cy-solution"><Md src={item.solution} /></div>}
        <DsrLine attempt={attempt} />
      </div>
    );
  }
  if (fmt === "mcq_single" || fmt === "mcq_multi") {
    const set = r.set || { ok: [], missed: [], wrong: [], left: [] };
    const tag = (id) => set.ok.indexOf(id) >= 0 ? ["ok", "You chose it · correct"] : set.missed.indexOf(id) >= 0 ? ["missed", "Correct, not chosen"] : set.wrong.indexOf(id) >= 0 ? ["wrong", "You chose it · not correct"] : ["left", "Not chosen · not correct"];
    const keyLabel = item.validation === "verified" ? "" : " (according to the supplied key)";
    return (
      <div className="cy-fb">
        <p className="cy-verdict" data-ok={r.correct ? "1" : "0"}>{r.correct ? <CheckCircle size={18} weight="fill" aria-hidden="true" /> : <XCircle size={18} weight="fill" aria-hidden="true" />}{r.correct ? "Right" + keyLabel : "Not right" + keyLabel}{fmt === "mcq_multi" ? " · you chose " + (set.ok.length + set.wrong.length) + ", the key has " + (set.ok.length + set.missed.length) : ""}</p>
        <ul className="cy-fb-opts">
          {(attempt.order || []).map((id, i) => {
            const t = tag(id), note = item.option_notes && item.option_notes[id];
            return (
              <li key={id} data-t={t[0]}>
                <span className="cy-letter">{LETTERS[i]}</span>
                <div><Md src={optMd(item, id)} as="span" /><span className="k-small cy-fb-tag">{t[1]}</span>{note && note !== "Correct." && <p className="k-small k-muted">{note}</p>}</div>
              </li>
            );
          })}
        </ul>
        {item.solution && <div className="cy-solution"><Md src={item.solution} /></div>}
        <DsrLine attempt={attempt} />
      </div>
    );
  }
  if (fmt === "numeric") {
    return (
      <div className="cy-fb">
        <p className="cy-verdict" data-ok={r.correct ? "1" : "0"}>{r.correct ? <CheckCircle size={18} weight="fill" aria-hidden="true" /> : <XCircle size={18} weight="fill" aria-hidden="true" />}{r.correct ? "Right" : "Not right"}: you wrote {attempt.response.number}{item.numeric.unit ? " " + item.numeric.unit : ""}; the answer is {item.numeric.value}{item.numeric.tol ? " ± " + item.numeric.tol : ""}{item.numeric.unit ? " " + item.numeric.unit : ""}.</p>
        {item.solution && <div className="cy-solution"><Md src={item.solution} /></div>}
        <DsrLine attempt={attempt} />
      </div>
    );
  }
  if (fmt === "recall") {
    const rated = r.rating;
    return (
      <div className="cy-fb">
        <div className="cy-compare">
          <div><b>You wrote</b><p>{attempt.response.text}</p></div>
          <div><b>Model answer</b><Md src={item.model} /></div>
        </div>
        {(item.key_points || []).length > 0 && (
          <fieldset className="cy-kp" disabled={!!rated}>
            <legend className="k-small k-muted">Tick the key points your answer contains</legend>
            {item.key_points.map((p, i) => (
              <label key={i} className="k-check"><input type="checkbox" checked={rated ? (r.key_points || []).indexOf(i) >= 0 : kp.indexOf(i) >= 0}
                onChange={(e) => { const on = e.target.checked; setKp((cur) => (on ? cur.filter((x) => x !== i).concat(i) : cur.filter((x) => x !== i))); }} /> <Md src={p} as="span" /></label>
            ))}
          </fieldset>
        )}
        {!rated ? (
          <div className="cy-conf">
            <span className="k-small k-muted">How well did you recall it?</span>
            <Scale label="Recall rating" opts={RATINGS} value={null} onPick={(v) => { K.setRecall(attempt, v, kp); sendAttempt(et, attempt, item); App.render(); }} />
          </div>
        ) : <p className="k-small">Your rating: <b>{String(rated).charAt(0).toUpperCase() + String(rated).slice(1)}</b></p>}
        <DsrLine attempt={attempt} />
      </div>
    );
  }
  return <TypedFeedback et={et} item={item} attempt={attempt} marks={marks} setMarks={setMarks} proposal={proposal} setProposal={setProposal} />;
}

// A written answer: the learner checks it against each criterion. A model may propose the marks (with the words it relied on);
// nothing is graded until the learner confirms or changes them. Eligibility for the scheduler is decided by KCycle.eligibility, as before.
function TypedFeedback({ et, item, attempt, marks, setMarks, proposal, setProposal }) {
  const K = KC(), App = A(), r = attempt.result || {};
  const mr = useModelReady("strong"), call = useModelCall();
  const crit = (item.rubric && item.rubric.criteria) || [];
  const graded = attempt.grading === "self" || attempt.grading === "model" || attempt.grading === "uncertain" || attempt.grading === "claude";
  const allMarked = crit.every((c) => marks[c.id]);
  const mg = attempt.model_grading;
  const proposedOf = (id) => (proposal && proposal.rows.filter((x) => x.id === id)[0]) || (graded && mg && (mg.rows || []).filter((x) => x.id === id)[0]) || null;
  const LABEL = { met: "Met", not: "Not met", unsure: "Not sure" };
  const suggest = async () => {
    const res = await call.run("typed-grading", K.gradingInputs(item, attempt), { feature: "typed-grading", maxOutputTokens: 3000 });
    if (!res.ok) return;
    const p = K.checkGradingProposal(item, attempt, res.json);
    setProposal({ ...p, meta: res.meta, prompt: res.prompt });
    setMarks(p.marks);
  };
  const confirm = () => {
    if (proposal) K.confirmModelGrading(attempt, item, proposal, marks, { now: Date.now(), meta: proposal.meta, prompt: proposal.prompt });
    else K.setCriteria(attempt, item, marks);
    sendAttempt(et, attempt, item); App.render();
  };
  return (
    <div className="cy-fb">
      <div className="cy-compare">
        <div><b>You wrote</b><p>{attempt.response.text}</p>{(attempt.thinking || attempt.response.working) && <p className="k-small k-muted">Thinking: {attempt.thinking || attempt.response.working}</p>}</div>
        <div><b>A model answer</b><Md src={(item.rubric && item.rubric.model) || item.solution || ""} /></div>
      </div>
      {item.rubric && (item.rubric.accept || []).length > 0 && <p className="k-small k-muted">Also accepted: {item.rubric.accept.join(" · ")}</p>}
      {item.rubric && (item.rubric.contradictions || []).length > 0 && <p className="k-small k-muted">An answer that says this is not accepted, whatever else it gets right: {item.rubric.contradictions.map((c) => "“" + c + "”").join(" · ")}</p>}
      <div className="cy-crit">
        <p className="k-small k-muted">Check your answer against each criterion. Grade the meaning, not the wording. If you cannot tell, choose Not sure: the answer then stays uncertain and does not count either way.</p>
        {!graded && (
          <div className="cy-actions">
            {mr.ready && <Btn size="sm" disabled={call.busy} onClick={suggest}><Robot size={15} aria-hidden="true" />{proposal ? "Suggest again" : "Suggest a grading"}</Btn>}
            {!mr.ready && <><CopyPromptBtn promptId="typed-grading" vars={K.gradingInputs(item, attempt)} label="Copy grading prompt" /><ModelHint what="proposing a grading" /></>}
            {mr.ready && <span className="k-small k-muted">A model reads your answer and proposes a mark with the words it relied on. You confirm or change every mark.</span>}
          </div>
        )}
        {!graded && <CallStatus call={call} />}
        {!graded && proposal && proposal.summary && <p className="k-small">{proposal.summary}</p>}
        {!graded && proposal && proposal.notes.length > 0 && <p className="k-small k-muted">{proposal.notes.join(" · ")}</p>}
        {crit.map((c) => {
          const v = graded ? (r.criteria || {})[c.id] : marks[c.id];
          const pr = proposedOf(c.id);
          return (
            <React.Fragment key={c.id}>
              <div className="cy-crit-row">
                <span className="cy-crit-text">{c.text}{c.required === false ? <span className="k-muted"> (optional)</span> : null}</span>
                <div className="cy-crit-btns" role="radiogroup" aria-label={c.text}>
                  {[["met", "Met"], ["not", "Not met"], ["unsure", "Not sure"]].map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={v === k} disabled={graded} className="cy-crit-btn" data-k={k} onClick={() => setMarks((m) => ({ ...m, [c.id]: k }))}>{l}</button>
                  ))}
                </div>
              </div>
              {pr && (
                <div className="mc-prop k-small">
                  <span className="k-muted">The model proposed <b>{LABEL[pr.mark]}</b>{graded && v !== pr.mark ? "; you chose " + LABEL[v] : ""}.{pr.reason ? " " + pr.reason : ""}</span>
                  {pr.quote && <blockquote className="mc-quote">{pr.quote}</blockquote>}
                </div>
              )}
            </React.Fragment>
          );
        })}
        {!graded && <Btn size="sm" kind="primary" disabled={!allMarked || call.busy} onClick={confirm}>{proposal ? "Confirm this grading" : "Save my check"}</Btn>}
        {graded && mg && <p className="k-small k-muted mc-by">A model proposed this grading: {byLine(mg.by)}. {mg.changed && mg.changed.length ? "You changed " + mg.changed.length + " mark" + (mg.changed.length > 1 ? "s" : "") + ", so it is recorded as your own check." : "You confirmed it as proposed."}</p>}
        {graded && <p className="cy-verdict" data-ok={r.correct ? "1" : r.correct === false ? "0" : "u"}>{r.correct ? <CheckCircle size={18} weight="fill" aria-hidden="true" /> : r.correct === false ? <XCircle size={18} weight="fill" aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}{r.correct ? "Every required criterion met" : r.correct === false ? "Not every required criterion met" : "Uncertain"}</p>}
      </div>
      <DsrLine attempt={attempt} />
    </div>
  );
}

// Explain: a set-up model answers in the app and the answer is saved on the attempt; otherwise the Claude Code request and Copy prompt
function ExplainPanel(props) {
  const mr = useModelReady("fast");
  return mr.ready ? <ExplainInApp {...props} /> : <ExplainLegacy {...props} />;
}

function ExplainInApp({ et, item, attempt }) {
  const K = KC(), App = A(), call = useModelCall();
  const [depth, setDepth] = useState("standard");
  const [note, setNote] = useState("");
  const vars = () => K.explainInputs(et, attempt, item, depth, { note: note.trim() });
  const ask = async () => {
    const r = await call.run("explain", vars(), { feature: "explain", maxOutputTokens: depth === "deep" ? 8000 : 4000 });
    if (!r.ok) return;
    const s = K.saveExplanation(attempt, r.json, { depth, note: note.trim(), now: Date.now(), meta: r.meta, prompt: r.prompt });
    if (!s.ok) { call.fail(s.error); return; }
    attempt.explain_requested = Date.now();
    EU().commit(et);
    setNote("");
    App.render();
  };
  return (
    <section className="cy-panel">
      <h3 className="st-h3">Explain this attempt</h3>
      <p className="k-small k-muted">Kartotek sends your attempt (the question, your answer and working, the key or criteria, the help you used) and the source text stored with this study to your model. The explanation is saved with this attempt. Reading it does not count as recall.</p>
      <div className="cy-row">
        <Scale label="Depth" opts={[{ v: "short", label: "Short" }, { v: "standard", label: "Standard" }, { v: "deep", label: "Deep" }]} value={depth} onPick={setDepth} />
      </div>
      <label className="k-field"><span className="k-field-label">Your question (optional)</span>
        <input className="k-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. why is option C wrong?" />
      </label>
      <div className="cy-actions">
        <Btn kind="primary" size="sm" disabled={call.busy} onClick={ask}><ChatCircleText size={15} aria-hidden="true" />{(attempt.explanations || []).length ? "Explain again" : "Explain"}</Btn>
        <CopyPromptBtn promptId="explain" vars={vars()} />
      </div>
      <CallStatus call={call} />
      <RequestPreview promptId="explain" vars={vars()} />
    </section>
  );
}

function ExplainLegacy({ et, item, attempt }) {
  const K = KC();
  const [depth, setDepth] = useState("standard");
  const [note, setNote] = useState("");
  const base = K.explainRequest(et, attempt, item, depth, { note: note.trim() });
  const [text, setText] = useState(null);
  const prompt = text == null ? base : text;
  return (
    <section className="cy-panel">
      <h3 className="st-h3">Explain this attempt</h3>
      <p className="k-small k-muted">Kartotek builds the request from your actual attempt. Read or edit it, then open it in Claude Code (it runs in your Kartotek folder) and press Enter. Reading an explanation does not count as recall.</p>
      <div className="cy-row">
        <Scale label="Depth" opts={[{ v: "short", label: "Short" }, { v: "standard", label: "Standard" }, { v: "deep", label: "Deep" }]} value={depth} onPick={(v) => { setDepth(v); setText(null); }} />
      </div>
      <label className="k-field"><span className="k-field-label">Your question (optional)</span>
        <input className="k-input" value={note} onChange={(e) => { setNote(e.target.value); setText(null); }} placeholder="e.g. why is option C wrong?" />
      </label>
      <details className="cy-req"><summary>View and edit the request</summary>
        <textarea className="k-input" rows={12} value={prompt} onChange={(e) => setText(e.target.value)} />
      </details>
      <div className="cy-actions" onClick={(e) => { if (e.target.closest("a")) { attempt.explain_requested = Date.now(); EU().commit(et); } }}>
        <AskPair prompt={prompt} label="Open in Claude Code" primary what="explaining this attempt" />
      </div>
    </section>
  );
}

// Practice this again: a set-up model writes 1–2 items, KCycle.validateExtra checks them, they are kept in the learner data
function FollowPanel(props) {
  const mr = useModelReady("fast");
  return mr.ready ? <FollowInApp {...props} /> : <FollowLegacy {...props} />;
}

function FollowInApp({ et, item, attempt }) {
  const K = KC(), App = A(), call = useModelCall();
  const [problems, setProblems] = useState(null);
  const made = (attempt.followup_items || []).map((q) => ((et.progress.followups || {})[q])).filter(Boolean);
  const vars = () => K.followupInputs(et, attempt, item, { count: 2 });
  const ask = async () => {
    setProblems(null);
    let probs = [];
    // One automatic second try that tells the model which checks failed
    for (let n = 0; n < 2; n++) {
      const r = await call.run("followup-items", K.followupInputs(et, attempt, item, { count: 2, problems: probs }), { feature: "followup-items", maxOutputTokens: 6000 });
      if (!r.ok) return;
      const b = K.buildFollowups(et, attempt, item, r.json, { now: Date.now(), meta: r.meta, prompt: r.prompt });
      if (!b.problems.length) {
        K.storeFollowups(et, attempt, b.items);
        EU().commit(et);
        App.toast(b.items.length + " follow-up question" + (b.items.length > 1 ? "s" : "") + " added to Applying.");
        App.render();
        return;
      }
      probs = b.problems;
    }
    setProblems(probs);
  };
  return (
    <section className="cy-panel">
      <h3 className="st-h3">Practice this again</h3>
      <p className="k-small k-muted">Your model writes 1–2 new questions for the same criteria from the source text stored with this study. They are checked, kept with your data and shown in Applying as follow-up practice. Because they come right after feedback, they never count as independent recall and are never sent to your reviews.</p>
      <div className="cy-actions">
        <Btn kind="primary" size="sm" disabled={call.busy} onClick={ask}><ArrowsClockwise size={15} aria-hidden="true" />{made.length ? "Write more" : "Write follow-up questions"}</Btn>
        <CopyPromptBtn promptId="followup-items" vars={vars()} />
      </div>
      <CallStatus call={call} />
      {problems && <div className="k-lvl" data-l="warn" role="alert">The model's questions did not pass the study's checks, even on a second try, so none were kept: {problems.slice(0, 4).join("; ")}.</div>}
      {made.length > 0 && (
        <>
          <p className="k-small k-muted">Written for this attempt ({made.length}). Find them in Applying for this topic:</p>
          <ul className="mc-fu-list k-small">{made.map((it) => <li key={it.q_id}><Md src={it.stem} as="span" /> <span className="k-muted">· {K.FORMAT_LABEL[it.format]} · written by {byLine(it.made_by)}</span></li>)}</ul>
        </>
      )}
      <RequestPreview promptId="followup-items" vars={vars()} />
    </section>
  );
}

function FollowLegacy({ et, item, attempt }) {
  const prompt = KC().followupPrompt(et, attempt, item);
  return (
    <section className="cy-panel">
      <h3 className="st-h3">Practice this again</h3>
      <p className="k-small k-muted">Claude Code writes 1–2 new questions for the same criteria from the same source pages. After it builds, reload Kartotek: they appear in Applying as follow-up practice. Because they come right after feedback, they never count as independent recall.</p>
      <div className="cy-actions" onClick={(e) => { if (e.target.closest("a")) { attempt.followup_requested = Date.now(); EU().commit(et); } }}>
        <AskPair prompt={prompt} label="Open in Claude Code" primary what="writing follow-up questions" />
      </div>
    </section>
  );
}

function ReportPanel({ et, item, attempt, close }) {
  const [note, setNote] = useState(attempt.dispute_note || "");
  return (
    <section className="cy-panel">
      <h3 className="st-h3">Report a problem with this question</h3>
      <p className="k-small k-muted">Use this if the stem, the options, the key or the solution look wrong or ambiguous. The attempt is then never counted against you and is not sent to your reviews; Explain will audit the question first.</p>
      <textarea className="k-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What looks wrong?" />
      <div className="cy-actions">
        <Btn size="sm" kind="primary" onClick={() => {
          const App = A(), wasSent = attempt.dsr && attempt.dsr.status === "sent";
          KC().dispute(attempt, note);
          if (wasSent) {
            // Withdrawn like Undo in Review while it is still the newest review; later reviews would build on it
            const w = KC().withdraw(App.S, et, attempt);
            if (w.ok) { App.store.commit({ etuts: [et.etut_id], cards: [w.card_id], reviewsFrom: w.reviewsFrom }); App.toast("Reported. The review it sent was withdrawn."); }
            else { attempt.dispute_after_send = true; EU().commit(et); App.toast("Reported. Kept out of your evidence; " + w.reason.charAt(0).toLowerCase() + w.reason.slice(1) + "."); }
          } else { EU().commit(et); App.toast("Reported. This attempt is kept out of your evidence."); }
          close(); App.render();
        }}>Report</Btn>
        {attempt.dsr && attempt.dsr.status === "sent" && <span className="k-small k-muted">It was already sent to your reviews. If no review came after it, reporting withdraws it (like Undo); otherwise it stays, and the report keeps it out of the study's evidence.</span>}
      </div>
    </section>
  );
}
