// End-of-lesson test: library and import, self-assessment, test runner, self-check, results, objective levels and review calendar.
// Engine logic lives in KLesson (src/lesson-core.js); this file only draws it and wires the same actions as the legacy view.
import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  CaretLeft, UploadSimple, Play, ArrowsClockwise, Cards as CardsIcon, Check, X, Warning, ArrowRight, Exam, Trash, Question,
} from "@phosphor-icons/react";
import { EASE, PageHead, Panel, Btn, ConfirmBtn, Lvl, Tag, Kpi, Bar } from "./kit.jsx";
import "./lesson.css";
import { NewJob, JobsPanel, jobsAvailable } from "./Jobs.jsx";

const LETTERS = ["A", "B", "C", "D"];
const TONE = { mastered: "ok", learned: "mid", partly: "warn", not: "bad" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const REQ_TR = { text: "your answer (at least 3 characters)", choice: "option", conf: "confidence" };
const SCREEN = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.28, ease: EASE } };

const E = () => ({ App: window.App, S: window.App.S, KLesson: window.KLesson, DSR: window.DSR, KEtut: window.KEtut });
const md = (s) => window.KEtut.renderMd(s);
const inl = (s) => window.App.EtutUI.inl(s);
const top = () => window.scrollTo(0, 0);
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

function Md({ text, className, inline, as: T = "div" }) {
  return <T className={className} dangerouslySetInnerHTML={{ __html: inline ? inl(text) : md(text) }} />;
}

// ------------------------------------------------------------------ shared helpers (ported from views-lesson.js)
function commit(ls, extra) { E().App.store.commit(Object.assign({ lessons: [ls.lesson_id] }, extra || {})); }

function activeLessons() {
  const S = E().S;
  return Object.keys(S.lessons || {}).map((id) => S.lessons[id])
    .filter((l) => l && !l.removed && l.package)
    .sort((a, b) => (b.imported_at || 0) - (a.imported_at || 0));
}
function nextReviewAt(ls) {
  const S = E().S;
  let best = null;
  Object.keys(ls.card_map).forEach((oid) => {
    const m = S.mem[ls.card_map[oid]];
    if (m && !m.suspended && m.state !== "new" && m.due_at && (best == null || m.due_at < best)) best = m.due_at;
  });
  return best;
}
function levelCounts(ls) {
  const c = { mastered: 0, learned: 0, partly: 0, not: 0, mis: 0 }, latest = E().KLesson.latestResults(ls);
  Object.keys(latest).forEach((oid) => { c[latest[oid].level]++; if (latest[oid].misconception) c.mis++; });
  return c;
}
function statusLine(ls, now) {
  const { App, DSR } = E();
  const pr = ls.progress, run = pr.run;
  if (pr.stage === "run" && run) return (run.kind === "retest" ? "Re-test" : "Test") + " in progress · " + (run.phase === "check" ? "self-check" : "question " + (run.i + 1) + "/" + run.order.length);
  if (!pr.tested_at) return "Not taken yet";
  const next = nextReviewAt(ls);
  return "Tested " + App.fmtDate(pr.tested_at) + (next ? " · next review " + App.fmtDate(next) + (next > now ? " (in " + App.fmtDays((next - now) / DSR.DAY) + ")" : " (due now)") : "");
}
function shortWhen(ts, now) {
  const { S, DSR } = E(), h = S.settings.day_start_hour;
  const d = DSR.dayIndex(ts, h) - DSR.dayIndex(now, h);
  const time = new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d <= 0) return "today " + time;
  if (d === 1) return "tomorrow";
  return new Date(ts).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function refsText(refs) { return (refs || []).join(" · "); }

function LevelIcon({ level }) {
  if (level === "mastered" || level === "learned") return <Check size={12} weight="bold" aria-hidden="true" />;
  if (level === "partly") return <Warning size={12} weight="bold" aria-hidden="true" />;
  return <X size={12} weight="bold" aria-hidden="true" />;
}
function LevelBadge({ level }) {
  const LV = E().KLesson.LEVELS;
  if (!level) return <span className="k-muted">-</span>;
  return <Lvl level={TONE[level]}><LevelIcon level={level} />{LV[level].label}</Lvl>;
}
function Sources({ pkg }) {
  const s = pkg.sources || [];
  if (!s.length) return <>sources not given</>;
  return s.map((x, i) => (
    <React.Fragment key={i}>{i > 0 && " · "}{x.file || ""}{x.type && <span className="k-muted"> ({x.type})</span>}</React.Fragment>
  ));
}
function MetaLine({ pkg }) {
  return <p className="k-small k-muted k-ls-meta">{pkg.lesson_date ? "Lesson " + pkg.lesson_date + " · " : ""}<Sources pkg={pkg} /></p>;
}
function ObjN({ n }) { return <span className="k-ls-n k-num">{n}</span>; }

// Radio-style segmented scale: the selected option's background slides between choices
function Scale({ name, options, value, onChange, label }) {
  return (
    <div className="k-ls-scale" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = value != null && String(value) === String(o.v);
        return (
          <motion.button key={o.v} type="button" role="radio" aria-checked={on} data-set={name} data-val={o.v} whileTap={{ scale: 0.97 }} onClick={() => onChange(o.v)}>
            {on && <motion.span layoutId={"ls-scale-" + name} className="k-ls-scale-bg" initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ type: "spring", duration: 0.3, bounce: 0.1 }} />}
            <span>{o.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ library
function openLesson(id) { const { App } = E(); App.lessonOpen = id; App.render(); top(); }

function LessonItem({ ls, now }) {
  const { App, S, KLesson } = E();
  const pkg = ls.package, c = KLesson.countItems(pkg), pr = ls.progress;
  const due = KLesson.dueObjectives(S, ls, now).length, lc = levelCounts(ls);
  const primary = pr.stage === "run" ? "Continue" : pr.tested_at ? "See results and calendar" : "Start the test";
  const retest = () => {
    if (!KLesson.startRetest(S, ls, Date.now())) { App.toast("No objective is due for a re-test."); return; }
    commit(ls); openLesson(ls.lesson_id);
  };
  const cards = () => { App.goReview(ls.deck_id); };
  const del = () => {
    const id = ls.lesson_id;
    S.lessons[id] = { lesson_id: id, removed: true, removed_at: Date.now() };
    App.store.commit({ lessons: [id] });
    App.toast("Lesson test deleted; its objective cards remain in the Cards tab.");
    App.render();
  };
  return (
    <motion.section layout="position" className="k-panel k-ls-item" data-lesson={ls.lesson_id}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <div className="k-ls-item-top">
        <div className="k-ls-item-text">
          <h2>{pkg.title}</h2>
          <MetaLine pkg={pkg} />
          <p className="k-small k-muted k-num">{plural(pkg.parts.length, "part")} · {plural(c.objectives, "objective")} · {plural(c.questions, "question")} · about {c.minutes} min</p>
        </div>
        <div className="k-row-btns k-ls-item-btns">
          <Btn kind="primary" size="sm" data-open={ls.lesson_id} onClick={() => openLesson(ls.lesson_id)}>
            {pr.stage === "run" ? <Play size={15} weight="fill" aria-hidden="true" /> : pr.tested_at ? <ArrowRight size={15} weight="bold" aria-hidden="true" /> : <Play size={15} weight="fill" aria-hidden="true" />}{primary}
          </Btn>
          {due > 0 && pr.stage !== "run" && (
            <>
              <Btn size="sm" data-retest={ls.lesson_id} onClick={retest}><ArrowsClockwise size={15} aria-hidden="true" />Re-test due ({due})</Btn>
              <Btn size="sm" data-cards={ls.lesson_id} onClick={cards}><CardsIcon size={15} aria-hidden="true" />Review cards ({due})</Btn>
            </>
          )}
          <ConfirmBtn data-del={ls.lesson_id} label={<><Trash size={15} aria-hidden="true" />Delete</>} confirmLabel="Delete? Cards are kept" onConfirm={del} />
        </div>
      </div>
      {pr.tested_at && (
        <div className="k-ls-lvlrow">
          {KLesson.LEVEL_ORDER.map((l) => lc[l] ? <Lvl key={l} level={TONE[l]}><b className="k-num">{lc[l]}</b>{KLesson.LEVELS[l].label}</Lvl> : null)}
          {lc.mis > 0 && <Lvl level="bad">{plural(lc.mis, "misconception")}</Lvl>}
        </div>
      )}
      <p className="k-small k-muted k-ls-status">{statusLine(ls, now)}</p>
    </motion.section>
  );
}

function Library() {
  const { App, S, KLesson } = E();
  const [errors, setErrors] = useState(null);
  const fileRef = useRef(null);
  const now = Date.now(), list = activeLessons();
  const removed = (App.bundledLessons || []).filter((pkg) => { const e = S.lessons && S.lessons[pkg.lesson_id]; return e && e.removed; });

  const onFile = (e) => {
    const input = e.target, f = input.files && input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      input.value = "";
      let pkg;
      try { pkg = JSON.parse(reader.result); } catch (err) {
        setErrors({ title: "Error", text: "The file could not be read as JSON: " + err.message });
        return;
      }
      const r = App.importLessonObject(pkg, false);
      if (r.errors.length) { setErrors({ title: "Invalid package", list: r.errors.slice(0, 12) }); return; }
      setErrors(null);
      App.render();
    };
    reader.readAsText(f);
  };

  const restore = (id) => {
    const pkg = (App.bundledLessons || []).filter((p) => p.lesson_id === id)[0];
    if (!pkg) return;
    // Reuse the old objective cards (tagged with the lesson id, created in objective order) so no duplicates appear
    const deckId = "lesson-" + id, objs = KLesson.flatObjectives(pkg);
    const old = Object.keys(S.cards).map((cid) => S.cards[cid])
      .filter((c) => c.deck_id === deckId && (c.tags || [])[0] === id)
      .sort((a, c) => a.created_at - c.created_at);
    const map = {};
    if (old.length === objs.length) objs.forEach((o, i) => { map[o.objective_id] = old[i].card_id; });
    S.lessons[id] = { lesson_id: id, card_map: map, deck_id: S.decks[deckId] ? deckId : null };
    const r = App.importLessonObject(pkg, false);
    if (r.errors && r.errors.length) { App.toast("The lesson test could not be added: " + r.errors[0]); return; }
    App.render();
  };

  return (
    <div className="k-page k-ls">
      <PageHead title="End-of-lesson test">
        <label className="k-btn primary k-ls-upload">
          <UploadSimple size={17} weight="bold" aria-hidden="true" />Load lesson test (.json)
          <input ref={fileRef} type="file" id="lesson-file" accept=".json,application/json" onChange={onFile} />
        </label>
      </PageHead>
      <p className="k-ls-lede">Right after a lesson, measure every objective once: what you have fully learned and what you have not. Each objective then gets its own review calendar from the DSR algorithm, and you review it on the Review tab or re-test it here with new questions.</p>
      {jobsAvailable() && (
        <details className="k-panel k-sec" id="new-lesson-test">
          <summary className="k-sec-head"><h2>New test from my files</h2></summary>
          <NewJob kind="lesson" intro="Send the lesson's transcript, notes or slides. The model you choose writes the objectives, the write-from-memory items, the test items and the re-test pool (LESSON-TEST-RULES.md); every question is then solved again without its key. The test is saved as a draft in your content folder."
            fields={[{ key: "title", label: "Title", optional: true, placeholder: "e.g. Digital systems · lecture 4" }]} onCreated={() => App.toast("Files read. Check the estimate below, then press Start.")} />
        </details>
      )}
      <JobsPanel kinds={["lesson"]} title="Tests being written" />
      {errors && (
        <motion.div className="k-panel k-ls-errors" id="lesson-errors" role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }}>
          <p><Lvl level="bad"><X size={12} weight="bold" aria-hidden="true" />{errors.title}</Lvl> {errors.text}</p>
          {errors.list && <ul>{errors.list.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        </motion.div>
      )}
      {list.length ? list.map((ls) => <LessonItem key={ls.lesson_id} ls={ls} now={now} />) : (
        <section className="k-panel k-ls-empty">
          <span className="k-ls-empty-icon" aria-hidden="true"><Exam size={26} weight="duotone" /></span>
          <h2>No lesson tests yet</h2>
          <ol>
            <li>Right after a lesson, send the transcript, the lecture notes or the slides. One source is enough; several are better.</li>
            <li>The test is prepared from them: each objective of the lesson gets 2 to 4 questions.</li>
            <li>Take it here. Every objective then gets its own review calendar.</li>
          </ol>
          <p className="k-small k-muted">A prepared lesson-test package (.json) can also be loaded with the button above.</p>
        </section>
      )}
      {removed.length > 0 && (
        <Panel title="Deleted lesson tests">
          <ul className="k-ls-removed">
            {removed.map((pkg) => (
              <li key={pkg.lesson_id}><span>{pkg.title}</span><Btn kind="primary" size="sm" data-restore={pkg.lesson_id} onClick={() => restore(pkg.lesson_id)}>Add again</Btn></li>
            ))}
          </ul>
          <p className="k-small k-muted">Adding a lesson test again starts it over; its objective cards and their review history are reused.</p>
        </Panel>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ intro and self-assessment
function Intro({ ls }) {
  const { App, KLesson } = E();
  const pkg = ls.package, c = KLesson.countItems(pkg), pr = ls.progress;
  const [self, setSelf] = useState({});
  const start = () => {
    Object.keys(self).forEach((oid) => { pr.self[oid] = Number(self[oid]); });
    KLesson.startTest(ls, Date.now());
    commit(ls); App.render(); top();
  };
  const opts = KLesson.SELF_TR.map((t, i) => ({ v: i, label: t }));
  return (
    <>
      <MetaLine pkg={pkg} />
      <Panel title="How the test works">
        <ul className="k-ls-rules">
          <li>Each of the {c.objectives} objectives is measured with 2 to 4 questions: first you <b>write from memory</b>, then you answer <b>multiple-choice</b> questions and say how sure you are.</li>
          <li>No notes. <b>Solutions appear only at the end</b>, so one answer cannot give away the next.</li>
          <li>Choose <b>Don’t know</b> rather than guessing: a lucky guess would hide a gap.</li>
          <li>At the end you compare what you wrote with the model answers. Every objective then gets a level and its own DSR review calendar.</li>
        </ul>
        <p className="k-small k-muted k-num">{c.questions} questions · about {c.minutes} minutes</p>
      </Panel>
      <Panel title="Before you start: how well do you think you learned each objective?">
        <p className="k-small">Optional. Your answers are compared with the result, so you can see where a feeling of knowing was misleading.</p>
        <ul className="k-ls-self">
          {KLesson.flatObjectives(pkg).map((o) => {
            const cur = self[o.objective_id] != null ? self[o.objective_id] : pr.self[o.objective_id];
            return (
              <li key={o.objective_id}>
                <span className="k-ls-objt"><ObjN n={o.n} />{o.title}</span>
                <Scale name={"self:" + o.objective_id} label={"Self-assessment: " + o.title} options={opts} value={cur}
                  onChange={(v) => setSelf((s) => ({ ...s, [o.objective_id]: v }))} />
              </li>
            );
          })}
        </ul>
      </Panel>
      <div className="k-ls-actions">
        <Btn kind="primary" data-act="start" onClick={start}><Play size={16} weight="fill" aria-hidden="true" />Start the test</Btn>
        <span className="k-small k-muted">You can skip the self-assessment.</span>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ test runner
function saveAnswer(ls, ans, shownAt) {
  const { App } = E();
  const run = ls.progress.run, it = run.order[run.i];
  run.answers[it.key] = Object.assign({ type: it.type, ms: Date.now() - shownAt, at: Date.now() }, ans);
  run.i += 1;
  if (run.i >= run.order.length) { run.i = run.order.length - 1; run.phase = "check"; }
  commit(ls);
  App.render(); top();
}

function ReqHint({ missing }) {
  return <span className="k-small k-muted k-ls-req" aria-live="polite">{missing.length ? "Missing: " + missing.map((m) => REQ_TR[m]).join(", ") : ""}</span>;
}

function RecallItem({ ls, o, nextLabel }) {
  const [text, setText] = useState("");
  const shownAt = useRef(Date.now());
  const ok = text.trim().length >= 3;
  const next = () => { if (ok) saveAnswer(ls, { text: text.trim() }, shownAt.current); };
  return (
    <>
      <Md className="k-ls-stem" text={o.recall.prompt} />
      <label className="k-field">
        <span className="k-field-label">Write from memory, in your own words</span>
        <textarea id="lesson-text" data-f="text" rows={7} autoFocus placeholder="Everything you remember about it" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="k-ls-actions">
        <Btn kind="primary" data-act="next" disabled={!ok} onClick={next}>{nextLabel}<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn>
        <Btn data-act="cant" onClick={() => saveAnswer(ls, { text: "" }, shownAt.current)}>I can’t recall it</Btn>
        <ReqHint missing={ok ? [] : ["text"]} />
      </div>
    </>
  );
}

function McqItem({ ls, it, nextLabel }) {
  const { KLesson, KEtut } = E();
  const q = KLesson.findItem(ls.package, it.q_id).q;
  const [choice, setChoice] = useState(null);
  const [conf, setConf] = useState(null);
  const shownAt = useRef(Date.now());
  const first = useRef(null);
  useEffect(() => {
    const a = document.activeElement;
    if (first.current && (!a || a === document.body)) first.current.focus({ preventScroll: true });
  }, []);
  const missing = [choice == null && "choice", !conf && "conf"].filter(Boolean);
  const next = () => {
    if (choice == null || !conf) return;
    saveAnswer(ls, { choice, correct: choice === q.correct, confidence: conf, dont_know: false }, shownAt.current);
  };
  const CONF = KEtut.CONFIDENCE_TR;
  return (
    <>
      <Md className="k-ls-stem" text={q.stem} />
      <ol className="k-ls-opts" role="radiogroup" aria-label="Options">
        {q.options.map((op, i) => {
          const on = choice === i;
          return (
            <li key={i}>
              <motion.button ref={i === 0 ? first : null} type="button" role="radio" aria-checked={on} className="k-ls-opt" data-on={on ? "1" : undefined}
                data-set="choice" data-val={i} whileTap={{ scale: 0.985 }} onClick={() => setChoice(i)}>
                <motion.span className="k-ls-letter" animate={on ? { scale: [0.9, 1] } : { scale: 1 }} transition={{ duration: 0.25, ease: EASE }}>{LETTERS[i]}</motion.span>
                <Md as="span" className="k-ls-opt-body" text={op} inline />
              </motion.button>
            </li>
          );
        })}
      </ol>
      <div className="k-ls-conf">
        <span className="k-small k-muted">How sure are you?</span>
        <Scale name="conf" label="How sure are you?" value={conf} onChange={setConf}
          options={["guess", "unsure", "sure"].map((c) => ({ v: c, label: CONF[c] }))} />
      </div>
      <div className="k-ls-actions">
        <Btn kind="primary" data-act="next" disabled={missing.length > 0} onClick={next}>{nextLabel}<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn>
        <Btn data-act="dontknow" onClick={() => saveAnswer(ls, { choice: null, correct: false, confidence: null, dont_know: true }, shownAt.current)}><Question size={16} aria-hidden="true" />Don’t know</Btn>
        <ReqHint missing={missing} />
      </div>
    </>
  );
}

function Runner({ ls }) {
  const { KLesson } = E();
  const pkg = ls.package, run = ls.progress.run, it = run.order[run.i];
  const o = KLesson.findObjective(pkg, it.oid);
  const part = pkg.parts.filter((p) => p.part_id === it.part_id)[0];
  const n = run.order.length, last = run.i === n - 1;
  const nextLabel = last ? "Finish and check my answers" : "Next question";
  return (
    <>
      <div className="k-ls-runhead">
        <Tag tone="accent"><span className="k-num">{run.kind === "retest" ? "Re-test" : "Test"} · question {run.i + 1}/{n}</span></Tag>
        <Tag>{it.type === "recall" ? "write from memory" : "multiple choice"}</Tag>
        <span className="k-small k-muted">Part {pkg.parts.indexOf(part) + 1}: {part.title}</span>
      </div>
      <motion.section key={it.key} className="k-panel k-ls-q" {...SCREEN}>
        {it.type === "recall" ? <RecallItem ls={ls} o={o} nextLabel={nextLabel} /> : <McqItem ls={ls} it={it} nextLabel={nextLabel} />}
      </motion.section>
    </>
  );
}

// ------------------------------------------------------------------ self-check
function Check_({ ls }) {
  const { App, S, KLesson } = E();
  const pkg = ls.package, run = ls.progress.run;
  const [kp, setKp] = useState({});
  const score = () => {
    run.objectives.forEach((oid) => {
      const o = KLesson.findObjective(pkg, oid);
      run.checks[oid] = o.recall.key_points.map((_, i) => i).filter((i) => !!kp[oid + ":" + i]);
    });
    const from = S.reviews.length;
    const res = KLesson.finishRun(S, ls, App.EtutUI.env(Date.now()));
    commit(ls, { cards: res.cards, reviewsFrom: from });
    const errs = res.run.objectives.filter((oid) => res.run.results[oid].error);
    if (errs.length) App.toast(res.run.results[errs[0]].error);
    else App.toast(plural(res.cards.length, "objective") + " measured; the review calendar is ready.");
    App.render(); top();
  };
  return (
    <>
      <div className="k-ls-intro">
        <h2>Compare what you wrote with the model answers</h2>
        <p className="k-muted">Tick only what your answer actually says. A feeling of familiarity is not evidence. The multiple-choice answers are scored automatically.</p>
      </div>
      {run.order.filter((it) => it.type === "recall").map((it, idx) => {
        const o = KLesson.findObjective(pkg, it.oid), a = run.answers[it.key] || {}, text = String(a.text || "").trim();
        const wrote = text.length >= 3;
        return (
          <motion.section key={it.key} className="k-panel k-sec k-ls-check" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE, delay: Math.min(idx, 6) * 0.04 }}>
            <div className="k-ls-objt k-ls-objt-lg"><ObjN n={o.n} />{o.title}</div>
            <Md className="k-small k-muted k-ls-prompt" text={o.recall.prompt} />
            <div className="k-grid2 k-ls-compare">
              <div><span className="k-ls-label">Your answer</span>{wrote ? <p className="k-ls-user">{text}</p> : <p className="k-muted">No answer, so this counts as not recalled.</p>}</div>
              <div><span className="k-ls-label">Model answer</span><Md className="k-ls-model" text={o.recall.model_answer} /></div>
            </div>
            <p className="k-small k-muted">Tick the key points your answer really contains:</p>
            <ul className="k-ls-kps">
              {o.recall.key_points.map((p, i) => {
                const name = o.objective_id + ":" + i;
                return (
                  <li key={i}>
                    <label className="k-ls-kp" data-disabled={wrote ? undefined : "1"}>
                      <input type="checkbox" data-f={"kp:" + name} disabled={!wrote} checked={!!kp[name]} onChange={(e) => setKp((s) => ({ ...s, [name]: e.target.checked }))} />
                      <Md as="span" text={p} inline />
                    </label>
                  </li>
                );
              })}
            </ul>
          </motion.section>
        );
      })}
      <div className="k-ls-actions">
        <Btn kind="primary" data-act="score" onClick={score}><Check size={16} weight="bold" aria-hidden="true" />Score the test and plan my reviews</Btn>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ results and calendar
function ItemsSummary({ r }) {
  const { App } = E();
  return (r.items || []).map((p, i) => {
    if (p.type === "recall") return <span key={i} className="k-ls-tl">Recall {App.pct(p.coverage || 0)}</span>;
    return (
      <span key={i} className="k-ls-tl" data-res={p.wrong ? "wrong" : "right"}>
        {p.wrong ? <X size={12} weight="bold" aria-hidden="true" /> : <Check size={12} weight="bold" aria-hidden="true" />}
        {p.wrong ? (p.misconception ? "wrong, sure" : "wrong") : "right"}
      </span>
    );
  });
}

function whyText(r, mem) {
  const { App, KLesson } = E();
  if (!r || r.error) return "";
  const parts = [KLesson.LEVELS[r.level].label + " (" + App.pct(r.score) + ") → DSR rating " + App.RATING_TR[r.rating]];
  if (r.state === "review") parts.push("interval I = 9·S·(1/R* − 1) = " + App.fmtDays(r.interval_days));
  else parts.push("learning step " + App.fmtDays(r.interval_days));
  parts.push("S " + App.fmtDays(r.S) + " · D " + App.dec(r.D, 2));
  if (mem && mem.last_reviewed_at && mem.last_reviewed_at > (r.at || 0)) parts.push("updated since by a later review");
  return parts.join(" · ");
}

function ObjectiveRow({ ls, o, r, now, env, i }) {
  const { App, S, KLesson, DSR } = E();
  const LV = KLesson.LEVELS;
  const cid = ls.card_map[o.objective_id], mem = S.mem[cid], card = S.cards[cid];
  const plan = KLesson.projectSchedule(card, mem, env, { days: 60, max: 6 });
  const hist = KLesson.objectiveHistory(S, ls, o.objective_id);
  const flag = KLesson.selfFlag(ls.progress.self[o.objective_id], r && r.level);
  const R = mem && mem.last_reviewed_at && mem.state !== "new" ? DSR.retrievability((now - mem.last_reviewed_at) / DSR.DAY, mem.stability_days) : null;
  const weak = r && (r.level === "partly" || r.level === "not");
  const steps = hist.map((h, j) => {
    const label = h.kind === "test" ? "test" : h.kind === "retest" ? "re-test" : h.kind;
    return <span key={"h" + j} className="k-ls-tl" title={App.fmtDate(h.at)}>{new Date(h.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {label} · {h.level ? LV[h.level].label : App.RATING_TR[h.rating]}</span>;
  }).concat(plan.map((p, j) => (
    <span key={"p" + j} className="k-ls-tl" data-next={j === 0 ? "1" : undefined} data-overdue={p.overdue ? "1" : undefined} title={App.fmtDate(p.at)}>
      {j === 0 ? "next: " : ""}{shortWhen(Math.max(p.at, now), now)}{p.gap_days != null ? " · " + (j === 0 ? "" : "+") + App.fmtDays(p.gap_days) : ""}
    </span>
  )));
  return (
    <motion.section className="k-panel k-sec k-ls-obj" id={"obj-" + o.objective_id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE, delay: Math.min(i, 8) * 0.03 }}>
      <div className="k-ls-obj-top">
        <div className="k-ls-obj-text">
          <div className="k-ls-objt k-ls-objt-lg"><ObjN n={o.n} />{o.title}</div>
          {o.refs && o.refs.length > 0 && <p className="k-small k-muted">{refsText(o.refs)}</p>}
        </div>
        <div className="k-ls-badges">
          <LevelBadge level={r && r.level} />
          {r && <Tag><span className="k-num">{App.pct(r.score)}</span></Tag>}
          {r && r.misconception && <Lvl level="bad">misconception</Lvl>}
          {flag && <Lvl level={flag.tone}>{flag.tone === "ok" ? <Check size={12} weight="bold" aria-hidden="true" /> : <Warning size={12} weight="bold" aria-hidden="true" />}{flag.text}</Lvl>}
        </div>
      </div>
      {r && <div className="k-ls-timeline"><span className="k-small k-muted">Answers:</span><ItemsSummary r={r} /></div>}
      <p className="k-small k-ls-next">
        <b>Next review:</b>{" "}
        {mem && mem.due_at && !mem.suspended ? <>{App.fmtDate(mem.due_at)} <span className="k-muted">{mem.due_at > now ? "(in " + App.fmtDays((mem.due_at - now) / DSR.DAY) + ")" : "(due now)"}</span></> : "-"}
        {R != null && <span className="k-muted"> · R now <span className="k-num">{App.dec(R, 2)}</span></span>}
      </p>
      {r && <p className="k-small k-muted">Why: {whyText(r, mem)}</p>}
      {steps.length > 0 && (
        <div className="k-ls-timeline">
          {steps.map((s, j) => <React.Fragment key={j}>{j > 0 && <ArrowRight className="k-ls-arrow" size={12} aria-hidden="true" />}{s}</React.Fragment>)}
        </div>
      )}
      {plan.length > 0 && <p className="k-small k-muted">Planned dates assume each review succeeds (“Good”); a failed review brings the objective back sooner and the plan is recalculated.</p>}
      {weak && <p className="k-small"><b>Restudy first:</b> {o.refs && o.refs.length ? refsText(o.refs) : "the part of the lesson on this objective"}</p>}
    </motion.section>
  );
}

function Calendar({ ls, env }) {
  const { App, KLesson } = E();
  const LV = KLesson.LEVELS;
  const cal = KLesson.lessonCalendar(App.S, ls, env, 5);
  if (!cal.days.some((d) => d.items.length)) return null;
  const chip = (it, k) => (
    <motion.span key={k} className="k-ls-chip k-num" data-level={it.level || ""} data-next={it.next ? "1" : undefined}
      title={it.n + " · " + it.title + (it.level ? " · " + LV[it.level].label : "")}
      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease: EASE }}>{it.n}</motion.span>
  );
  return (
    <Panel title="Review calendar · next 5 weeks" className="k-ls-calp">
      <div className="k-ls-cal" role="img" aria-label="Planned objective reviews per day">
        {WEEKDAYS.map((w) => <div key={w} className="k-ls-wd">{w}</div>)}
        {cal.days.map((d, i) => {
          const dt = new Date(d.at);
          const label = dt.getDate() === 1 || i === 0 ? dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : String(dt.getDate());
          return (
            <div key={d.idx} className="k-ls-day" data-today={d.today ? "1" : undefined} data-past={d.past ? "1" : undefined}>
              <span className="k-ls-date k-num">{label}{d.today ? " · today" : ""}</span>
              <div className="k-ls-chips">{d.items.map((it, j) => chip(it, j))}</div>
            </div>
          );
        })}
      </div>
      <ol className="k-ls-callist">
        {cal.days.filter((d) => d.items.length && !d.past).map((d) => (
          <li key={d.idx}>
            <span className="k-ls-when">{d.today ? "Today" : new Date(d.at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
            <span className="k-ls-calobjs">{d.items.map((it, j) => <span key={j} className="k-ls-calobj">{chip(it, "c")}<span>{it.title}</span></span>)}</span>
          </li>
        ))}
      </ol>
      <div className="k-ls-legend">
        {KLesson.LEVEL_ORDER.map((l) => <span key={l}><i className="k-ls-dot" data-level={l} />{LV[l].label}</span>)}
        <span><i className="k-ls-dot" data-next="1" />next review</span>
      </div>
      <p className="k-small k-muted">Numbers are objectives. Every planned review is computed by the DSR engine from the objective’s current memory state; reviewing on the Review tab or re-testing here updates the calendar.</p>
    </Panel>
  );
}

function ReviewDetails({ ls }) {
  const { App, KLesson, KEtut } = E();
  const pkg = ls.package, runs = ls.progress.runs;
  if (!runs.length) return null;
  const run = runs[runs.length - 1];
  const CONF = KEtut.CONFIDENCE_TR;
  return (
    <Panel title={"Answers and solutions · " + (run.kind === "retest" ? "re-test" : "test") + " of " + App.fmtDate(run.finished_at)}>
      <div className="k-ls-reviews">
        {run.objectives.map((oid) => {
          const o = KLesson.findObjective(pkg, oid), r = run.results[oid] || {};
          const items = run.order.filter((it) => it.oid === oid);
          return (
            <details key={oid} className="k-ls-review">
              <summary><ObjN n={o.n} /><span className="k-ls-review-t">{o.title}</span><LevelBadge level={r.level} /></summary>
              <div className="k-ls-review-body">
                {items.map((it) => {
                  const a = run.answers[it.key] || {};
                  if (it.type === "recall") {
                    const chk = run.checks[oid] || [];
                    return (
                      <div key={it.key} className="k-ls-review-item">
                        <span className="k-small k-muted">Write from memory · {o.recall.prompt}</span>
                        <p className="k-ls-user">{String(a.text || "").trim() ? a.text : <span className="k-muted">No answer</span>}</p>
                        <div className="k-small"><b>Model answer:</b> <Md as="span" text={o.recall.model_answer} inline /></div>
                        <ul className="k-ls-kpres">
                          {o.recall.key_points.map((p, i) => {
                            const yes = chk.indexOf(i) >= 0;
                            return <li key={i} data-yes={yes ? "1" : "0"}>{yes ? <Check size={13} weight="bold" aria-label="included" /> : <X size={13} weight="bold" aria-label="missing" />}<Md as="span" text={p} inline /></li>;
                          })}
                        </ul>
                      </div>
                    );
                  }
                  const q = KLesson.findItem(pkg, it.q_id).q;
                  return (
                    <div key={it.key} className="k-ls-review-item">
                      <Md className="k-ls-stem k-ls-stem-sm" text={q.stem} />
                      <ol className="k-ls-opts">
                        {q.options.map((op, i) => {
                          const res = i === q.correct ? "correct" : i === a.choice ? "wrong" : "dim";
                          const note = q.distractor_notes && q.distractor_notes[i];
                          return (
                            <li key={i}>
                              <div className="k-ls-opt" data-res={res}>
                                <span className="k-ls-letter">{LETTERS[i]}</span>
                                <span className="k-ls-opt-body">
                                  <Md as="span" text={op} inline />
                                  {i === q.correct ? <span className="k-ls-mark">Correct answer</span> : i === a.choice ? <span className="k-ls-mark">Your choice</span> : null}
                                  {note && <Md as="span" className="k-ls-note" text={note} inline />}
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                      <p className="k-small">
                        {a.dont_know ? "You chose “Don’t know”." : "Your confidence: " + (CONF[a.confidence] || "-") + (a.correct ? "" : a.confidence === "sure" ? " · wrong although sure: a sign of a misconception" : "")}
                      </p>
                      <div className="k-small k-ls-solution"><b>Solution:</b> <Md as="div" text={q.solution} /></div>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </Panel>
  );
}

// Practice the multiple-choice items missed in the latest measurement until each is answered right once.
// Practice only: nothing is written to DSR or to the lesson's progress (re-tests stay the measurement).
function RetryMissed({ ls }) {
  const { KLesson } = E();
  const runs = ls.progress.runs, run = runs[runs.length - 1];
  const missed = run ? run.order.filter((it) => it.type === "mcq" && (!run.answers[it.key] || !run.answers[it.key].correct)).map((it) => it.q_id) : [];
  const [st, setSt] = React.useState(null);
  if (!missed.length) return null;
  if (!st) {
    return (
      <Panel title="Practise the missed questions">
        <p className="k-small">{plural(missed.length, "question")} answered wrong or with “Don’t know”. Practise them until each one is right once; wrong ones come back at the end. This is practice only: it does not change the measurement or the review calendar.</p>
        <Btn kind="primary" onClick={() => setSt({ queue: missed.slice(), choice: null, done: 0, tries: 0 })}><ArrowsClockwise size={16} weight="bold" aria-hidden="true" />Retry the missed questions</Btn>
      </Panel>
    );
  }
  if (!st.queue.length) {
    return (
      <Panel title="Practise the missed questions">
        <p className="k-small"><b>All {plural(missed.length, "question")} right.</b> {st.tries > missed.length ? "It took " + st.tries + " answers. " : ""}Restudy the objectives with a misconception before the next re-test.</p>
        <Btn onClick={() => setSt(null)}>Close</Btn>
      </Panel>
    );
  }
  const q = KLesson.findItem(ls.package, st.queue[0]).q, answered = st.choice != null, right = answered && st.choice === q.correct;
  const next = () => {
    const rest = st.queue.slice(1);
    setSt({ queue: right ? rest : rest.concat([st.queue[0]]), choice: null, done: st.done + (right ? 1 : 0), tries: st.tries });
  };
  return (
    <Panel title={"Practise the missed questions · " + st.done + " / " + missed.length + " right"}>
      <Md className="k-ls-stem" text={q.stem} />
      <ol className="k-ls-opts">
        {q.options.map((op, i) => {
          const res = !answered ? undefined : i === q.correct ? "correct" : i === st.choice ? "wrong" : "dim";
          return (
            <li key={i}>
              <button type="button" className="k-ls-opt" data-res={res} disabled={answered} onClick={() => setSt({ ...st, choice: i, tries: st.tries + 1 })}>
                <span className="k-ls-letter">{LETTERS[i]}</span><span className="k-ls-opt-body"><Md as="span" text={op} inline /></span>
              </button>
            </li>
          );
        })}
      </ol>
      {answered && <div className="k-small k-ls-solution"><b>{right ? "Right." : "Not yet: it comes back at the end."}</b> <Md as="div" text={q.solution} /></div>}
      <div className="k-row-btns">
        {answered && <Btn kind="primary" onClick={next}>{st.queue.length === 1 && right ? "Finish" : "Next question"}</Btn>}
        <Btn onClick={() => setSt(null)}>Stop</Btn>
      </div>
    </Panel>
  );
}

function Results({ ls }) {
  const { App, S, KLesson } = E();
  const LV = KLesson.LEVELS;
  const pkg = ls.package, pr = ls.progress, now = Date.now(), env = App.EtutUI.env(now);
  const latest = KLesson.latestResults(ls), lc = levelCounts(ls);
  const objs = KLesson.flatObjectives(pkg);
  const last = pr.runs[pr.runs.length - 1];
  const due = KLesson.dueObjectives(S, ls, now);
  const hasSelf = Object.keys(pr.self || {}).length > 0;
  const selfMiss = objs.filter((o) => { const f = KLesson.selfFlag(pr.self[o.objective_id], latest[o.objective_id] && latest[o.objective_id].level); return f && f.tone === "warn"; });
  const sorted = objs.slice().sort((a, b) => {
    const ma = S.mem[ls.card_map[a.objective_id]], mb = S.mem[ls.card_map[b.objective_id]];
    return ((ma && ma.due_at) || Infinity) - ((mb && mb.due_at) || Infinity) || a.n - b.n;
  });
  const retest = () => {
    if (!KLesson.startRetest(S, ls, Date.now())) { App.toast("No objective is due for a re-test."); return; }
    commit(ls); App.render(); top();
  };
  const reviewCards = () => { App.goReview(ls.deck_id); };
  const back = () => { App.lessonOpen = null; App.render(); top(); };
  return (
    <>
      <div className="k-ls-intro">
        <h2>{last && last.kind === "retest" ? "Re-test results" : "Test results"}</h2>
        {last && <p className="k-small k-muted">{last.kind === "retest" ? "Re-test of " + plural(last.objectives.length, "objective") + " · " : "Test · "}{App.fmtDate(last.finished_at)}</p>}
      </div>
      <div className="k-kpis k-ls-kpis">
        {KLesson.LEVEL_ORDER.map((l) => (
          <Kpi key={l} label={<span className="k-ls-kpi-label"><i className="k-ls-dot" data-level={l} />{LV[l].label}</span>} value={lc[l]} sub={LV[l].note} />
        ))}
      </div>
      <div className="k-grid2">
        <Panel title="Score by part">
          <ul className="k-ls-parts">
            {pkg.parts.map((p) => {
              const rs = p.objectives.map((o) => latest[o.objective_id]).filter(Boolean);
              const f = rs.length ? rs.reduce((a, r) => a + r.score, 0) / rs.length : 0;
              return <li key={p.part_id}><span>{p.title}</span><Bar value={f} tone={f >= 0.7 ? "good" : f >= 0.45 ? undefined : "warn"} /><span className="k-num">{App.pct(f)}</span></li>;
            })}
          </ul>
          {lc.mis > 0 && <p className="k-small k-ls-mis"><Lvl level="bad">{plural(lc.mis, "misconception")}</Lvl> A wrong answer given with “Sure” shows a wrong belief; restudy those objectives first.</p>}
        </Panel>
        <Panel title="Your self-assessment">
          {!hasSelf ? <p className="k-small k-muted">You skipped the self-assessment before the test.</p> : selfMiss.length ? (
            <>
              <p className="k-small">You thought you knew these, but the test shows gaps:</p>
              <ul className="k-ls-selfmiss k-small">
                {selfMiss.map((o) => <li key={o.objective_id}><ObjN n={o.n} />{o.title} · you said “{KLesson.SELF_TR[pr.self[o.objective_id]]}”, measured {LV[latest[o.objective_id].level].label}</li>)}
              </ul>
            </>
          ) : <p className="k-small">Your self-assessment matched the result, or you underestimated yourself.</p>}
        </Panel>
      </div>
      <Calendar ls={ls} env={env} />
      <h2 className="k-ls-h">Objectives · measurement and review plan</h2>
      {sorted.map((o, i) => <ObjectiveRow key={o.objective_id} ls={ls} o={o} r={latest[o.objective_id]} now={now} env={env} i={i} />)}
      <ReviewDetails ls={ls} />
      <RetryMissed key={last ? last.run_id : "none"} ls={ls} />
      <div className="k-ls-actions">
        {due.length ? (
          <>
            <Btn kind="primary" data-act="retest" onClick={retest}><ArrowsClockwise size={16} weight="bold" aria-hidden="true" />Re-test due objectives ({due.length})</Btn>
            <Btn data-act="review-cards" onClick={reviewCards}><CardsIcon size={16} aria-hidden="true" />Review due objectives on the Review tab</Btn>
          </>
        ) : <Btn data-act="review-cards" onClick={reviewCards}><CardsIcon size={16} aria-hidden="true" />Open this lesson on the Review tab</Btn>}
        <Btn data-act="library" onClick={back}>Back to lesson tests</Btn>
      </div>
      <p className="k-small k-muted k-ls-foot">
        Levels: {KLesson.LEVEL_ORDER.map((l) => LV[l].label + " = " + LV[l].note + " → " + App.RATING_TR[LV[l].rating]).join(" · ")}. Multiple choice counts 1 when correct and sure, 0.7 unsure, 0.4 guessed, 0 when wrong or “Don’t know”; writing from memory counts the share of key points.
      </p>
    </>
  );
}

// ------------------------------------------------------------------ open lesson
function Detail({ ls }) {
  const { App } = E();
  const pr = ls.progress, run = pr.run;
  const inRun = pr.stage === "run" && run;
  // A new screen (not a re-render of the same one) slides in and gets fresh form state
  const key = ls.lesson_id + ":" + pr.stage + ":" + (run ? run.run_id + ":" + run.phase + (run.phase === "check" ? "" : ":" + run.i) : "");
  let body;
  if (inRun) body = run.phase === "check" ? <Check_ ls={ls} /> : <Runner ls={ls} />;
  else if (pr.stage === "results" || pr.runs.length) body = <Results ls={ls} />;
  else body = <Intro ls={ls} />;
  const back = () => { App.lessonOpen = null; App.render(); top(); };
  const frac = inRun ? (run.phase === "check" ? 1 : run.i / run.order.length) : 0;
  return (
    <div className="k-page k-ls">
      <div>
        <Btn size="sm" className="k-ls-back" data-act="library" onClick={back}><CaretLeft size={15} weight="bold" aria-hidden="true" />Lesson tests</Btn>
      </div>
      <PageHead title={ls.package.title} sub={<span className="k-small k-muted k-ls-headstatus">{statusLine(ls, Date.now())}</span>} />
      {inRun && (
        <div className="k-progress k-ls-progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
          <motion.span initial={false} animate={{ scaleX: frac }} transition={{ duration: 0.5, ease: EASE }} />
        </div>
      )}
      <motion.div key={inRun && run.phase !== "check" ? ls.lesson_id + ":run:" + run.run_id : key} className="k-ls-body" {...SCREEN}>
        {React.cloneElement(body, { key })}
      </motion.div>
    </div>
  );
}

export default function Lesson() {
  const App = window.App, S = App.S;
  const ls = App.lessonOpen && S.lessons && S.lessons[App.lessonOpen];
  if (!ls || ls.removed || !ls.package) {
    App.lessonOpen = null;
    return <Library />;
  }
  return <Detail ls={ls} />;
}
