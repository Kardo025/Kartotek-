// Checks: retrieval without the map. Only independent attempts (map and source hidden, no answer shown, hint H0–H1)
// go to your reviews; correct → Good, partly → Hard, not correct → Again. Everything else is kept without touching memory.
import React, { useState } from "react";
import ModelHint from "../ModelHint.jsx";
import { Target, Lightbulb, PaperPlaneRight, Play, Trash } from "@phosphor-icons/react";
import { Panel, Btn, Tag, Lvl, TableWrap } from "../kit.jsx";
import { Md } from "../study/common.jsx";
import { App, KM, save, when, OUTCOME_LABEL } from "./util.js";
import { Waiting, makeRequest, Empty } from "./parts.jsx";

const KIND = { definition: "Explain an idea", relation: "Explain a connection", group_rationale: "Explain a group", backbone_explanation: "Explain the backbone", application: "Apply it" };

export function startCheck(doc, targetId) {
  const a = KM().startAttempt(doc, targetId, Date.now(), null);
  if (!a) return null;
  const seen = (App().mindSeen || {})[doc.map_id];
  if (seen) a.map_seen_s_ago = Math.round((Date.now() - seen) / 1000);
  save(doc.map_id);
  return a.id;
}

export default function Checks({ doc, onRun }) {
  const targets = doc.targets.filter((t) => !t.retired);
  const unfinished = doc.attempts.filter((a) => !a.submitted_at && !a.discarded);
  const done = doc.attempts.filter((a) => a.submitted_at).slice().reverse();
  const lastOf = (t) => doc.attempts.filter((a) => a.target_id === t.id && a.submitted_at).slice(-1)[0];
  return (
    <div className="mm-col">
      <Panel title="How checks work">
        <p className="mm-hint">The map and photos are hidden while you answer. You see your map's version only after answering. Only an attempt without the map, without a source, without the answer shown and with at most an attention cue (H1) goes to your reviews. This is “unassisted within what Kartotek recorded”, not a proctored test.</p>
      </Panel>
      {unfinished.length > 0 && (
        <Panel title="Unfinished">
          <ul className="mm-plain">
            {unfinished.map((a) => (
              <li key={a.id} className="mm-oq">
                <span>{a.prompt}</span>
                <span className="mm-row-btns">
                  <Btn size="sm" onClick={() => onRun(a.id)}><Play size={14} aria-hidden="true" /> Resume</Btn>
                  <button type="button" className="k-btn sm ghost" onClick={() => { a.discarded = true; save(doc.map_id); }} aria-label="Discard"><Trash size={14} /></button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title={"Checks (" + targets.length + ")"}>
        {targets.length === 0 ? (
          <Empty title="No checks yet">Make one from the Map tab (Check next to an idea, a connection or a group), or let the coach suggest one.</Empty>
        ) : (
          <ul className="mm-targets">
            {targets.map((t) => {
              const last = lastOf(t);
              return (
                <li key={t.id}>
                  <div className="mm-target-main">
                    <div className="mm-mark-tags">
                      <Tag tone="accent">{KIND[t.kind] || t.kind}</Tag>
                      <Tag>v{t.version}</Tag>
                      <Tag>{t.by === "claude" ? "from the coach" : "from your map"}</Tag>
                      {t.validation === "source_checked" ? <Lvl level="ok">checked against a source</Lvl> : <Lvl level="mid">not checked against a source</Lvl>}
                    </div>
                    <p>{t.prompt}</p>
                    {last && <p className="mm-muted">Last: {OUTCOME_LABEL[last.outcome] || last.outcome} · {when(last.submitted_at)}{last.scheduler ? " · " + (last.scheduler.status === "sent" ? "sent to reviews" : "not sent: " + last.scheduler.reason) : ""}</p>}
                  </div>
                  <Btn size="sm" kind="primary" onClick={() => { const id = startCheck(doc, t.id); if (id) onRun(id); }}><Play size={14} aria-hidden="true" /> Start</Btn>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Waiting doc={doc} kinds={["grade"]} />
      {done.length > 0 && (
        <Panel title="Attempts">
          <TableWrap>
            <table className="k-table mm-table">
              <thead><tr><th>When</th><th>Check</th><th>Result</th><th>Help</th><th>Reviews</th></tr></thead>
              <tbody>
                {done.map((a) => (
                  <tr key={a.id}>
                    <td className="k-num">{when(a.submitted_at)}</td>
                    <td className="mm-clip">{a.prompt}</td>
                    <td>{OUTCOME_LABEL[a.outcome] || a.outcome}{a.outcome_by ? <span className="mm-muted"> · {a.outcome_by === "self" ? "you" : a.outcome_by === "claude" ? "Claude" : "waiting"}</span> : null}</td>
                    <td>{a.max_hint ? "H" + a.max_hint : "none"}{a.answer_exposed ? " · answer shown" : ""}</td>
                    <td>{a.scheduler ? (a.scheduler.status === "sent" ? <Lvl level="ok">{a.scheduler.rating}</Lvl> : <span className="mm-muted">{a.scheduler.reason}</span>) : <span className="mm-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      )}
    </div>
  );
}

// The check itself. The page shows nothing else while it runs (no map, no photos).
export function Runner({ doc, attempt, onClose }) {
  const [answer, setAnswer] = useState(attempt.answer || "");
  const t = doc.targets.find((x) => x.id === attempt.target_id) || {};
  const now = () => Date.now();
  const hints = (attempt.hints || []).map((h) => ({ level: h.level, text: KM().hintText(doc, attempt, h.level) }));
  const next = Math.min(4, (attempt.max_hint || 0) + 1);
  const submitted = !!attempt.submitted_at;
  const graded = submitted && ["correct", "partial", "incorrect", "uncertain"].indexOf(attempt.outcome) >= 0 && attempt.outcome_by !== "pending";

  const submit = () => {
    if (!answer.trim()) { App().toast("Write your answer first (a guess is fine)"); return; }
    KM().submitAttempt(doc, attempt, answer.trim(), now());
    KM().revealAfter(doc, attempt, now());
    save(doc.map_id);
  };
  const grade = (o) => {
    KM().selfGrade(doc, attempt, o, now());
    const r = App().mindSchedule(doc, attempt);
    save(doc.map_id);
    App().toast(r && r.eligible ? "Sent to your reviews as " + r.rating : "Saved. Not sent to reviews: " + ((attempt.scheduler && attempt.scheduler.reason) || "not eligible"));
  };
  const askClaude = () => {
    attempt.outcome_by = "pending";
    makeRequest(doc, "grade", { attempt_id: attempt.id }, (rq) => KM().gradePrompt(doc, attempt, rq));
  };

  return (
    <div className="mm-runner">
      <div className="mm-runner-bar">
        <Target size={18} aria-hidden="true" />
        <b>Check · {doc.title}</b>
        <span className="mm-muted">Map and photos hidden</span>
        <button type="button" className="k-btn sm" onClick={onClose}>{submitted ? "Done" : "Pause"}</button>
      </div>
      <Panel>
        <p className="mm-prompt-q">{attempt.prompt}</p>
        {attempt.elapsed_since_exposure_s != null && !submitted && (
          <p className="mm-hint">This content was last shown to you {fmtAgo(attempt.elapsed_since_exposure_s)} ago (a hint, an example or feedback).</p>
        )}
        {!submitted && attempt.predicted == null && (
          <div className="mm-sure" role="group" aria-label="How sure are you that you can answer?">
            <span>How sure are you?</span>
            {[0, 25, 50, 75, 100].map((p) => <button key={p} type="button" className="k-btn sm" onClick={() => { attempt.predicted = p / 100; save(doc.map_id); }}>{p}%</button>)}
          </div>
        )}
        {attempt.predicted != null && <p className="mm-muted">You said {Math.round(attempt.predicted * 100)}% sure.</p>}
        {hints.length > 0 && (
          <ol className="mm-hints">{hints.map((h) => <li key={h.level}><Tag>{KM().HINTS[h.level]}</Tag> {h.level >= 4 ? <Md src={h.text} as="span" /> : h.text}</li>)}</ol>
        )}
        {!submitted ? (
          <>
            <label className="k-field"><span className="k-field-label">Your answer, in your own words</span>
              <textarea className="mm-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus />
            </label>
            <div className="mm-btnrow">
              <Btn kind="primary" onClick={submit}><PaperPlaneRight size={15} aria-hidden="true" /> Submit</Btn>
              {next <= 4 && (
                <Btn onClick={() => { KM().takeHint(doc, attempt, now()); save(doc.map_id); }}>
                  <Lightbulb size={15} aria-hidden="true" /> {KM().HINTS[next]}{next >= 2 ? (next >= 4 ? " (shows the answer)" : " (makes it assisted)") : ""}
                </Btn>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="mm-compare">
              <div><b>Your answer</b><p>{attempt.answer}</p></div>
              <div><b>Your map says</b><p>{t.rubric}</p></div>
            </div>
            <p className="mm-hint">Grade the meaning, not the wording. If your answer is different but you think it is also right, choose “Not sure” or ask Claude.</p>
            {!graded ? (
              <div className="mm-btnrow">
                <Btn onClick={() => grade("correct")}>Correct</Btn>
                <Btn onClick={() => grade("partial")}>Partly</Btn>
                <Btn onClick={() => grade("incorrect")}>Not correct</Btn>
                <Btn onClick={() => grade("uncertain")}>Not sure</Btn>
                {attempt.outcome_by !== "pending" && <><Btn onClick={askClaude}>Ask Claude to grade</Btn><ModelHint what="grading this check" /></>}
              </div>
            ) : (
              <Result attempt={attempt} />
            )}
            <Waiting doc={doc} kinds={["grade"]} />
          </>
        )}
      </Panel>
    </div>
  );
}

function Result({ attempt }) {
  const s = attempt.scheduler;
  return (
    <div className="mm-result">
      <div className="mm-mark-tags">
        <Lvl level={attempt.outcome === "correct" ? "ok" : attempt.outcome === "incorrect" ? "bad" : "warn"}>{OUTCOME_LABEL[attempt.outcome]}</Lvl>
        {s && (s.status === "sent" ? <Lvl level="ok">sent to reviews as {s.rating}</Lvl> : <Tag>not sent to reviews: {s.reason}</Tag>)}
      </div>
      {attempt.grade && attempt.grade.feedback && <Md src={attempt.grade.feedback} />}
    </div>
  );
}

function fmtAgo(s) {
  if (s < 90) return s + " s";
  if (s < 5400) return Math.round(s / 60) + " min";
  if (s < 172800) return Math.round(s / 3600) + " h";
  return Math.round(s / 86400) + " days";
}
