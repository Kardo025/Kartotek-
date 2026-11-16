// Study v2 (cycle workflow, STUDY-RULES.md §v2): per topic Priming → Learn & digest → Applying → Evaluating (deferred), topic by topic and part
// by part, then the final test and report. Any part, topic and stage can be opened at any time; End opens when every topic cycle is complete.
// The legacy Runner stays for v1 packages; Study.jsx routes by KCycle.isV2(package).
import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { SPRING, DUR, EASE as E } from "../../motion.jsx";
import { CaretLeft, ArrowRight, ArrowsIn, ArrowsOut, ShieldCheck, Graph, NotePencil, ListChecks, Play, Clock, Hourglass, Lock, Check, Robot, Notebook } from "@phosphor-icons/react";
import { EASE, Btn } from "../kit.jsx";
import ModelHint from "../ModelHint.jsx";
import Thinking from "./Thinking.jsx";
import { useModelReady, useModelCall, CallStatus, CopyPromptBtn, RequestPreview, byLine } from "../../model-call.jsx";
import { Md, Html, Chip, Blocks, Scale } from "./common.jsx";
import { QuestionsList } from "./QList.jsx";
import Item from "./cycle/Item.jsx";
import { FinalPlan, FinalRun, Report } from "./cycle/Final.jsx";
import { FindMyLevel, PlanMapPanel } from "./PlanMap.jsx";
import { A, KC, KE, EU, extrasOf, itemsOf, partOf, save, refsText, criterionText, when } from "./cycle/lib.js";
import "./cycle/cycle.css";

const DURATIONS = [{ v: 30, label: "30 min" }, { v: 45, label: "45 min" }, { v: 60, label: "60 min" }, { v: 90, label: "90 min" }];

export default function Cycle({ et, redraw }) {
  const App = A(), K = KC(), U = EU(), pr = et.progress;
  K.migrate(pr, et.package);
  U.refUnit = (et.package.source && et.package.source.unit) || "slide";
  U.refOffset = (et.package.source && et.package.source.page_offset) || 0;
  if (!pr.started_at) { pr.started_at = Date.now(); pr.stage_at = Date.now(); K.touch(et); U.commit(et); }
  else K.touch(et);
  const [cov, setCov] = useState(false);
  const focus = U.focusOn();
  const key = pr.part + ":" + pr.topic + ":" + pr.stage;
  // Forward through the cycle the new stage arrives from the right, backward from the left
  const order = pr.part * 1000 + pr.topic * 10 + Math.max(0, K.STAGES.indexOf(pr.stage)) + (K.isEnd(pr.stage) ? 900000 : 0);
  const prevOrder = useRef(order), dirRef = useRef("fwd");
  if (prevOrder.current !== order) { dirRef.current = order >= prevOrder.current ? "fwd" : "back"; prevOrder.current = order; }
  return (
    <div className="k-page st-page cy-page">
      <div className="st-run-head">
        <Btn size="sm" onClick={() => { App.etutOpen = null; U.setFocus(false); App.render(); }}><CaretLeft size={15} weight="bold" aria-hidden="true" />Studies</Btn>
        <div className="st-run-title">
          <h1>{et.package.title}</h1>
          <p className="k-small k-muted">{K.progressLabel(et)}</p>
        </div>
        <Timer et={et} />
        <Btn size="sm" onClick={() => setCov(!cov)} aria-expanded={cov}><ShieldCheck size={15} aria-hidden="true" />Coverage</Btn>
        <Btn size="sm" onClick={() => { U.setFocus(!focus); App.render(); }} aria-pressed={focus}>
          {focus ? <ArrowsIn size={15} weight="bold" aria-hidden="true" /> : <ArrowsOut size={15} weight="bold" aria-hidden="true" />}{focus ? "Exit focus" : "Focus mode"}
        </Btn>
      </div>
      {cov && <Coverage et={et} close={() => setCov(false)} />}
      <Navigator et={et} />
      <div key={key} className="st-body cy-stage-in" data-dir={dirRef.current}>
        <Stage et={et} redraw={redraw} />
      </div>
    </div>
  );
}

function Stage({ et, redraw }) {
  const st = et.progress.stage;
  if (st === "priming") return <Priming et={et} />;
  if (st === "work") return <Workspace et={et} />;
  if (st === "apply") return <Apply et={et} />;
  if (st === "evaluate") return <Evaluate et={et} />;
  if (st === "final_plan") return <FinalPlan et={et} />;
  if (st === "final") return <FinalRun et={et} />;
  return <Report et={et} />;
}

function go(et) { KC().next(et, Date.now()); et.progress.stage_at = Date.now(); save(et); window.scrollTo(0, 0); }
function jump(et, pi, ti, st) {
  if (!KC().goto(et, pi, ti, st, Date.now())) return false;
  et.progress.stage_at = Date.now(); save(et); window.scrollTo(0, 0);
  return true;
}
// The topic being studied (an objective of the current part)
function topicOf(et) { return KC().curTopic(et) || partOf(et).kazanimlar[0]; }

// ------------------------------------------------------------------ header pieces
function Timer({ et }) {
  const K = KC(), pr = et.progress;
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  if (["priming", "work", "apply"].indexOf(pr.stage) < 0) return null;
  const nt = (partOf(et).kazanimlar || []).length;
  const tb = K.topicBudget(pr.duration, nt), b = tb[pr.stage], used = pr.stage_at ? Math.floor((Date.now() - pr.stage_at) / 60000) : 0;
  return (
    <label className="cy-timer" title={"Suggested minutes for one topic (a " + pr.duration + "-minute part shared by its " + nt + " topic" + (nt > 1 ? "s" : "") + "): Priming " + tb.priming + " · Learn & digest " + tb.work + " · Applying " + tb.apply + ". A guide, never a limit."}>
      <Clock size={15} aria-hidden="true" />
      <span className="k-num" data-over={used > b ? "1" : undefined}>{used}/{b} min</span>
      <select className="k-input sm" value={pr.duration} aria-label="Session length for a part" onChange={(e) => { pr.duration = Number(e.target.value); save(et); }}>
        {DURATIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
      </select>
    </label>
  );
}

const SHORT = { priming: "Priming", work: "Learn & digest", apply: "Applying", evaluate: "Evaluating" };

// Parts → topics → stages. Every topic and stage can be opened at any time; End opens when every topic's cycle is complete.
function Navigator({ et }) {
  const K = KC(), pr = et.progress, pkg = et.package, parts = pkg.parts;
  const inEnd = K.isEnd(pr.stage);
  const [view, setView] = useState(pr.part);
  useEffect(() => { setView(pr.part); }, [pr.part]);
  const open = K.endOpen(et), left = K.topicsLeft(et);
  const seenOf = (kid) => pr.seen[kid] || {};
  const resume = (pi, ti, kid) => {
    const s = seenOf(kid), st = K.STAGES.filter((x) => !s[x])[0] || "work";
    jump(et, pi, ti, st);
  };
  const vp = parts[view] || parts[0];
  return (
    <nav className="cy-nav" aria-label="Parts, topics and stages">
      <div className="cy-nav-parts" role="tablist" aria-label="Parts">
        {parts.map((p, pi) => {
          const ks = p.kazanimlar || [], done = ks.filter((k) => K.cycleDone(et, k.kazanim_id)).length;
          return (
            <button key={p.part_id} type="button" role="tab" className="cy-nav-part" aria-selected={view === pi}
              data-cur={pi === pr.part && !inEnd ? "1" : undefined} data-done={done === ks.length ? "1" : undefined}
              onClick={() => setView(pi)} title={p.title}>
              <span>Part {pi + 1}</span><span className="cy-nav-count k-num">{done}/{ks.length}</span>
            </button>
          );
        })}
        <button type="button" className="cy-nav-part cy-nav-end" data-cur={inEnd ? "1" : undefined} disabled={!open}
          onClick={() => jump(et, pr.part, pr.topic, "end")}
          title={open ? "Final test and report" : "Opens when every topic's cycle is complete (" + left.length + " topic" + (left.length === 1 ? "" : "s") + " left)"}>
          {open ? null : <Lock size={13} aria-hidden="true" />}<span>End</span><span className="cy-nav-count">{pr.stage === "report" ? "report" : pr.final ? "final test" : open ? "open" : left.length + " left"}</span>
        </button>
      </div>
      <p className="cy-nav-ptitle k-small"><b>Part {view + 1}:</b> {vp.title}</p>
      <ol className="cy-nav-topics">
        {(vp.kazanimlar || []).map((k, ti) => {
          const here = !inEnd && view === pr.part && ti === pr.topic, s = seenOf(k.kazanim_id), done = K.cycleDone(et, k.kazanim_id);
          return (
            <li key={k.kazanim_id} className="cy-nav-topic" data-cur={here ? "1" : undefined} data-done={done ? "1" : undefined}>
              <button type="button" className="cy-nav-ttl" onClick={() => resume(view, ti, k.kazanim_id)} title={"Open " + k.title}>
                <span className="cy-nav-n k-num">{done ? (
                  <svg viewBox="0 0 16 16" width="12" height="12" role="img" aria-label="cycle complete">
                    <motion.path d="M3.5 8.4l3 3L12.6 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                      initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: DUR.scene, ease: E.out, delay: 0.15 }} />
                  </svg>
                ) : ti + 1}</span><span className="cy-nav-name">{k.title}{(pr.skipped || {})[k.kazanim_id] ? <span className="cy-nav-skip" title="Skipped after Find my level found it held. It stays in the final test.">skipped</span> : null}</span>
              </button>
              <div className="cy-nav-stages">
                {K.STAGES.map((st) => (
                  <button key={st} type="button" className="cy-step" data-done={s[st] ? "1" : undefined} aria-current={here && pr.stage === st ? "step" : undefined}
                    onClick={() => jump(et, view, ti, st)} title={SHORT[st] + (st === "evaluate" ? " (deferred)" : "") + " · " + k.title}>
                    {here && pr.stage === st && <motion.span layoutId={"cy-step-cur-" + et.etut_id} className="cy-step-bg" transition={SPRING} aria-hidden="true" />}
                    <span className="cy-step-l">{SHORT[st]}</span>
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Coverage({ et, close }) {
  const K = KC(), a = K.audit(et.package), pkg = et.package;
  return (
    <section className="k-panel k-sec cy-cov">
      <div className="k-sec-head">
        <h2>Coverage of this module</h2>
        <span className={"k-lvl"} data-l={a.certified ? "ok" : "warn"}>{a.certified ? "Certified: every outcome is taught, practised and in the final test" : a.blockers.length + " coverage gap(s): draft"}</span>
      </div>
      <p className="k-small k-muted">{a.counts.included} of {a.counts.units} source units included · {a.counts.topics} topics, each with its own cycle · {a.counts.outcomes} outcomes · {a.counts.criteria} criteria · {a.counts.practice} practice items (+ one recall per topic{a.counts.connecting ? "; " + a.counts.connecting + " connect topics" : ""}) · {a.counts.final} final items. This checks structure and links, not whether the content is true.</p>
      <div className="k-table-wrap">
        <table className="k-table cy-ledger">
          <thead><tr><th>Outcome</th><th>Criterion</th><th>Lesson</th><th>Practice</th><th>Final</th></tr></thead>
          <tbody>
            {a.ledger.map((r) => r.criteria.map((c, i) => (
              <tr key={r.id + c.id}>
                {i === 0 && <td rowSpan={r.criteria.length}><b>{r.id}</b> {r.performance}{r.status !== "covered" ? <span className="k-muted"> ({r.status})</span> : null}</td>}
                <td>{c.id} · {c.text}</td>
                {i === 0 && <td rowSpan={r.criteria.length}>{r.taught ? "yes" : <span className="cy-bad">no</span>}</td>}
                <td>{c.practice.length ? c.practice.join(", ") : <span className="cy-bad">none</span>}</td>
                <td>{c.final.length ? c.final.join(", ") : <span className="cy-bad">none</span>}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      {a.blockers.length > 0 && <><h3 className="st-h3">Gaps</h3><ul className="k-small">{a.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></>}
      {a.warnings.length > 0 && <details><summary className="k-small">Notes ({a.warnings.length})</summary><ul className="k-small k-muted">{a.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
      {(pkg.gaps || []).length > 0 && <><h3 className="st-h3">Stated limits of the source</h3><ul className="k-small">{pkg.gaps.map((g, i) => <li key={i}>{g.what}{g.why ? " — " + g.why : ""}</li>)}</ul></>}
      <Btn size="sm" onClick={close}>Close</Btn>
    </section>
  );
}

function Keywords({ list }) {
  if (!list || !list.length) return null;
  return (
    <dl className="cy-keywords">
      {list.map((w) => <div key={w.term}><dt>{w.term}</dt><dd>{w.definition}{w.ref ? <span className="k-muted"> ({w.ref})</span> : null}</dd></div>)}
    </dl>
  );
}

// The part's orientation and summary: open on the part's first topic, a collapsible overview on the others
function PartOverview({ et, part, open }) {
  const o = part.orientation || {}, sm = part.summary || {}, conv = et.package.conventions || [];
  const body = (
    <>
      {o.place && <p className="k-muted">{o.place}</p>}
      {sm.md && <Html className="st-md cy-summary" html={KE().renderMd(sm.md, { keywords: true })} />}
      {o.purpose && <p className="cy-purpose"><b>By the end of this part:</b> {o.purpose}</p>}
      {o.prereq && <div className="cy-prereq"><b>You will need:</b> <Md src={o.prereq} as="span" /></div>}
      {conv.length > 0 && (
        <div className="cy-prereq"><b>Conventions in this study:</b>
          <ul className="cy-conv">{conv.map((c, i) => <li key={i}><Md src={c} as="span" /></li>)}</ul>
        </div>
      )}
      <Keywords list={sm.keywords} />
    </>
  );
  if (!o.place && !sm.md && !o.purpose && !conv.length) return null;
  return open ? <section className="k-panel k-sec cy-part-over"><p className="cy-kicker">Part overview</p><h3 className="cy-h3">{part.title}</h3>{body}</section>
    : <details className="k-panel k-sec cy-part-over"><summary className="k-small"><b>This part at a glance:</b> {part.title}</summary>{body}</details>;
}

// ------------------------------------------------------------------ Priming (per topic)
function Priming({ et }) {
  const K = KC(), pr = et.progress, part = partOf(et), k = topicOf(et), pi = pr.part, ti = pr.topic || 0, pm = k.priming;
  const outs = (et.package.outcomes || []).filter((o) => o.kazanim_id === k.kazanim_id);
  const [notes, setNotes] = useState(pr.notes[k.kazanim_id] || "");
  const keep = () => { pr.notes[k.kazanim_id] = notes; };
  return (
    <div className="cy-col">
      <PartOverview et={et} part={part} open={ti === 0} />
      <section className="k-panel k-sec cy-priming">
        <p className="cy-kicker">Part {pi + 1} · Topic {ti + 1} of {part.kazanimlar.length} · Priming</p>
        <h2 className="cy-h2">{k.title}</h2>
        {pm ? (
          <>
            <Html className="st-md cy-summary" html={KE().renderMd(pm.summary_md, { keywords: true })} />
            {pm.purpose && <p className="cy-purpose"><b>By the end of this topic:</b> {pm.purpose}</p>}
            {pm.prereq && <div className="cy-prereq"><b>You will need:</b> <Md src={pm.prereq} as="span" /></div>}
            <Keywords list={pm.keywords} />
          </>
        ) : (
          <>
            {k.objective && <p>{k.objective}</p>}
            {outs.length > 0 && <div className="cy-outcomes"><b>By the end of this topic you can:</b><ul>{outs.map((o) => <li key={o.id}>{o.performance}</li>)}</ul></div>}
          </>
        )}
        <p className="k-small k-muted">A preview, not the lesson: nothing here is scored.</p>
      </section>
      <FindMyLevel et={et} />
      <PlanMapPanel et={et} open={!!window.KPlan.lastProbe(et)} />
      <section className="k-panel k-sec">
        <label className="k-field">
          <span className="k-field-label">Your thinking: first guesses and connections (optional)</span>
          <textarea className="k-input" rows={3} value={notes} placeholder="What do you expect? What does it remind you of? What is unclear?" onChange={(e) => setNotes(e.target.value)} onBlur={() => { keep(); EU().commit(et); }} />
          <span className="k-field-hint">Kept as your assumptions, never graded.</span>
        </label>
        {ti === 0 && pr.notes[part.part_id] && <p className="k-small k-muted">Your earlier note for the whole part: {pr.notes[part.part_id]}</p>}
        <QuestionsList et={et} pi={pi} heading="Questions this part should answer (optional)" />
      </section>
      <div className="cy-actions"><Btn kind="primary" onClick={() => { keep(); go(et); }}>Start learning<ArrowRight size={17} weight="bold" aria-hidden="true" /></Btn></div>
    </div>
  );
}

// ------------------------------------------------------------------ Learn & digest (per topic): lesson + mind map + Feynman on one screen
function Workspace({ et }) {
  const pr = et.progress, part = partOf(et), pkg = et.package, k = topicOf(et), ti = pr.topic || 0;
  const outs = (pkg.outcomes || []).filter((o) => o.kazanim_id === k.kazanim_id);
  const last = ti === part.kazanimlar.length - 1, connect = last && part.connect && part.connect.blocks;
  const [tab, setTab] = useState("feynman");
  return (
    <div className="cy-work">
      <div className="cy-lesson">
        <section className="k-panel k-sec cy-objective">
          <p className="cy-kicker">Part {pr.part + 1} · Topic {ti + 1} of {part.kazanimlar.length} · Learn & digest</p>
          <div className="cy-obj-head">
            <h2 className="cy-h2">{k.title}</h2>
            {k.slides && k.slides.length > 0 && <Chip>{EU().slidesRef(k.slides).replace(/<[^>]+>/g, "")}</Chip>}
          </div>
          {k.objective && <p className="k-muted">{k.objective}</p>}
          {outs.length > 0 && (
            <div className="cy-outcomes">
              <b>After this topic you can:</b>
              <ul>{outs.map((o) => <li key={o.id}>{o.performance}{o.status !== "covered" ? <span className="k-muted"> ({o.status})</span> : null}</li>)}</ul>
            </div>
          )}
          <Blocks blocks={k.blocks} />
          {(() => { const refs = [].concat.apply([], (k.blocks || []).map((b) => b.refs || [])); return refs.length ? <p className="k-small k-muted cy-refs">Source: {refsText(pkg, refs)}</p> : null; })()}
          {(k.practice || []).map((q) => <EmbeddedCheck key={q.q_id} q={q} />)}
        </section>
        {connect && (
          <section className="k-panel k-sec cy-connect">
            <p className="cy-kicker">Connect the topics of part {pr.part + 1}</p>
            <Blocks blocks={part.connect.blocks} />
            {(() => { const refs = [].concat.apply([], part.connect.blocks.map((b) => b.refs || [])); return refs.length ? <p className="k-small k-muted cy-refs">Source: {refsText(pkg, refs)}</p> : null; })()}
          </section>
        )}
        <p className="k-small k-muted">The lesson stays open while you map and explain. Applying comes next; you can come back here at any time from the topic list above.</p>
      </div>
      <aside className="cy-pane">
        <div className="k-subtabs" role="tablist" aria-label="Your work">
          {[["reading", "Thinking while reading", Notebook], ["feynman", "Explain it", NotePencil], ["map", "Mind map", Graph], ["questions", "Questions", ListChecks]].map(([v, l, I]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)}><span><I size={14} aria-hidden="true" /> {l}</span></button>
          ))}
        </div>
        {tab === "reading" && <ReadingThinking key={k.kazanim_id} et={et} k={k} />}
        {tab === "feynman" && <Feynman key={k.kazanim_id} et={et} part={part} k={k} />}
        {tab === "map" && <MapLink et={et} part={part} k={k} />}
        {tab === "questions" && <section className="k-panel k-sec"><QuestionsList et={et} pi={pr.part} /></section>}
        <div className="cy-actions"><Btn kind="primary" onClick={() => go(et)}>Go to Applying<ArrowRight size={17} weight="bold" aria-hidden="true" /></Btn></div>
      </aside>
    </div>
  );
}

function EmbeddedCheck({ q }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cy-check">
      <p className="k-small"><b>Quick check (not counted):</b> {q.stem}</p>
      {q.options && <ol type="A" className="k-small">{q.options.map((o, i) => <li key={i}>{o}</li>)}</ol>}
      {!open ? <Btn size="sm" onClick={() => setOpen(true)}>Show the answer</Btn>
        : <div className="cy-solution k-small">{q.options && q.correct != null ? <p><b>{String.fromCharCode(65 + q.correct)}.</b></p> : null}<Md src={q.solution} /></div>}
    </div>
  );
}

// Feynman per topic; versions before topic cycles (kept per part) stay visible
function Feynman({ et, part, k }) {
  const pr = et.progress, kid = k.kazanim_id, list = pr.feynman[kid] || [], pkg = et.package, older = pr.feynman[part.part_id] || [];
  const [text, setText] = useState(list.length ? list[list.length - 1].text : "");
  const fy = k.feynman || {}, pf = part.feynman || {};
  const prompt = fy.prompt || "Explain \u201c" + k.title + "\u201d to a classmate who missed it: the ideas, how they connect and the conditions.";
  const crit = fy.criteria || [];
  const add = () => {
    if (!text.trim()) return;
    pr.feynman[kid] = list.concat([{ n: list.length + 1, text: text.slice(0, 8000), at: Date.now() }]);
    save(et);
    A().toast("Saved as version " + (list.length + 1) + ". Earlier versions are kept.");
  };
  const satisfied = pr.satisfied[kid];
  return (
    <section className="k-panel k-sec cy-feynman">
      <h3 className="cy-h3">Explain it in your own words</h3>
      <p className="k-small">{prompt}</p>
      {!fy.prompt && pf.prompt && <p className="k-small k-muted">For the whole part: {pf.prompt}</p>}
      <textarea className="k-input" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write freely; keep the technical terms." />
      <div className="cy-actions">
        <Btn size="sm" kind="primary" disabled={!text.trim() || (list.length && list[list.length - 1].text === text)} onClick={add}>Save as version {list.length + 1}</Btn>
        <Btn size="sm" aria-pressed={!!satisfied} onClick={() => { pr.satisfied[kid] = satisfied ? null : Date.now(); save(et); }}>{satisfied ? "Marked: I'm satisfied" : "I'm satisfied"}</Btn>
      </div>
      <FeynmanFeedback et={et} k={k} last={list.length ? list[list.length - 1] : null} unsaved={!list.length || list[list.length - 1].text !== text} />
      <p className="k-small k-muted">Feedback is a reading of your own words against what a complete explanation covers: it never rewrites your explanation and gives no score. "I'm satisfied" is your readiness and your decision.</p>
      {crit.length > 0 && (
        <details className="k-small">
          <summary>What a complete explanation covers</summary>
          <ul>{crit.map((c) => <li key={c}>{criterionText(pkg, c)}</li>)}</ul>
        </details>
      )}
      {list.length > 0 && (
        <details className="k-small">
          <summary>Versions ({list.length})</summary>
          <ol className="cy-versions">{list.slice().reverse().map((v) => <li key={v.n}><span className="k-muted">v{v.n} · {when(v.at)}</span><p>{v.text}</p></li>)}</ol>
        </details>
      )}
      {older.length > 0 && (
        <details className="k-small">
          <summary>Your explanations of the whole part, from before topic cycles ({older.length})</summary>
          <ol className="cy-versions">{older.slice().reverse().map((v) => <li key={v.n}><span className="k-muted">v{v.n} · {when(v.at)}</span><p>{v.text}</p></li>)}</ol>
        </details>
      )}
    </section>
  );
}

// Thinking while reading (task F1): free text beside the lesson, saved as versions per topic like the Feynman explanation.
// Optional, never required, never evidence; included in the exports with the rest of the progress.
function ReadingThinking({ et, k }) {
  const pr = et.progress, kid = k.kazanim_id, K = KC();
  const list = (pr.reading_thinking || {})[kid] || [];
  const [text, setText] = useState(list.length ? list[list.length - 1].text : "");
  const add = () => { const r = K.saveReadingThinking(et, kid, text, Date.now()); if (r) { save(et); A().toast("Saved as note " + r.n + ". Earlier notes are kept."); } };
  const same = list.length && list[list.length - 1].text === text;
  return (
    <section className="k-panel k-sec cy-feynman">
      <h3 className="cy-h3">Thinking while reading</h3>
      <p className="k-small k-muted">What do you notice, doubt or connect as you read this lesson? Write it as it comes. It is kept for you; it is never graded and never required.</p>
      <Thinking value={text} onChange={setText} label="Your notes while reading" rows={7} placeholder="e.g. This looks like the rule from part 1, but with a condition I have not seen." />
      <div className="cy-actions">
        <Btn size="sm" kind="primary" disabled={!text.trim() || !!same} onClick={add}>Save as note {list.length + 1}</Btn>
      </div>
      {list.length > 0 && (
        <details className="k-small">
          <summary>Earlier notes ({list.length})</summary>
          <ol className="cy-versions">{list.slice().reverse().map((v) => <li key={v.n}><span className="k-muted">#{v.n} · {when(v.at)}</span><p>{v.text}</p></li>)}</ol>
        </details>
      )}
    </section>
  );
}

// Feynman "Get feedback" (task E2): a set-up model reads the latest saved version against the topic's criteria and quotes the
// learner's own sentences. The answer is checked (a quote that is not in the text is dropped), kept per version, and never changes the
// version, "I'm satisfied", or anything the scheduler sees.
const FB_LABEL = { covered: "Covered", partly: "Partly", missing: "Missing", unclear: "Unclear" };
function FeedbackBlock({ rec, pkg }) {
  return (
    <div className="mc-fb">
      <p className="k-small k-muted">Feedback on version {rec.n} · {when(rec.at)} · {byLine(rec.by)}</p>
      <div className="mc-rows">
        {rec.criteria.map((c) => (
          <div key={c.id} className="mc-row">
            <div className="mc-row-head"><span className="mc-status" data-s={c.status}>{FB_LABEL[c.status]}</span><span>{criterionText(pkg, c.id)}</span></div>
            {c.quote && <blockquote className="mc-quote">“{c.quote}”</blockquote>}
            {c.comment && <p className="k-small">{c.comment}</p>}
          </div>
        ))}
      </div>
      {(rec.misstatements || []).length > 0 && (
        <div className="k-small"><b>Sentences to check against the source</b>
          {rec.misstatements.map((m, i) => <div key={i}><blockquote className="mc-quote">“{m.quote}”</blockquote><p>{m.comment}</p></div>)}
        </div>
      )}
      {(rec.questions || []).length > 0 && <div className="k-small"><b>Questions to think about</b><ul>{rec.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
      {rec.overall && <p className="k-small">{rec.overall}</p>}
    </div>
  );
}

function FeynmanFeedback({ et, k, last, unsaved }) {
  const K = KC(), pkg = et.package, kid = k.kazanim_id;
  const mr = useModelReady("strong"), call = useModelCall();
  const recs = ((et.progress.feynman_feedback || {})[kid]) || [];
  const mine = last ? recs.filter((r) => r.n === last.n) : [];
  const latest = mine[mine.length - 1] || null;
  const earlier = recs.filter((r) => r !== latest).reverse();
  const inputs = last ? K.feynmanInputs(et, k, last) : null;
  const ask = async () => {
    const r = await call.run("feynman-feedback", inputs, { feature: "feynman-feedback", maxOutputTokens: 5000 });
    if (!r.ok) return;
    const rec = K.checkFeynmanFeedback(last.text, inputs._ids, r.json);
    if (!rec) { call.fail("The feedback could not be read."); return; }
    K.saveFeynmanFeedback(et, kid, last.n, rec, { now: Date.now(), meta: r.meta, prompt: r.prompt });
    save(et);
  };
  return (
    <div className="mc-feynman">
      <div className="cy-actions">
        {mr.ready
          ? <Btn size="sm" disabled={call.busy || !last || unsaved} onClick={ask} title={!last ? "Save a version first." : unsaved ? "Save this version first, so the feedback belongs to a version you can see." : "Reads your latest saved version against the criteria."}><Robot size={15} aria-hidden="true" />{latest ? "Get feedback again" : "Get feedback"}</Btn>
          : <ModelHint what="feedback on your explanation" />}
        {inputs && <CopyPromptBtn promptId="feynman-feedback" vars={inputs} />}
        {mr.ready && (!last || unsaved) && <span className="k-small k-muted">{!last ? "Save a version first." : "Save this version first: feedback is about a saved version."}</span>}
      </div>
      <CallStatus call={call} />
      {latest && <FeedbackBlock rec={latest} pkg={pkg} />}
      {earlier.length > 0 && (
        <details className="k-small"><summary>Earlier feedback ({earlier.length})</summary>{earlier.map((r, i) => <FeedbackBlock key={i} rec={r} pkg={pkg} />)}</details>
      )}
      {inputs && mr.ready && <RequestPreview promptId="feynman-feedback" vars={inputs} />}
    </div>
  );
}

// The topic's link to the AI Mind Mapping Assistant (the learner draws the map by hand). One map can serve several topics.
function MapLink({ et, part, k }) {
  const App = A(), S = App.S, KMind = window.KMind, pr = et.progress, pkg = et.package, kid = k.kazanim_id;
  if (!KMind) return <section className="k-panel k-sec"><p className="k-muted">The Mind map assistant is not available in this build.</p></section>;
  const live = (id) => (id && S.mindmaps && S.mindmaps[id] && !S.mindmaps[id].removed ? S.mindmaps[id] : null);
  const own = live(pr.maps[kid]), partMap = !own && live(pr.maps[part.part_id]), doc = own || partMap;
  const parse = doc && (App.mindParse || {})[doc.map_id];
  const outs = (pkg.outcomes || []).filter((o) => o.kazanim_id === kid).map((o) => o.performance);
  const prev = (part.kazanimlar || []).slice(0, Math.max(0, part.kazanimlar.indexOf(k))).map((x) => live(pr.maps[x.kazanim_id])).filter(Boolean).pop();
  const start = () => {
    const mid = KMind.newMapId(S, pkg.etut_id + "-" + kid);
    const sources = (pkg.sources || []).map((s, i) => ({ id: "s" + (i + 1), title: s.title || s.file, path: s.file || "", pages: s.pages || "" }));
    const d = KMind.ensure(S, mid, { title: pkg.title + " · " + k.title, subject: pkg.title, language: "en", goal: outs.join(" "), sources, views: [] }, Date.now());
    d.study = { etut_id: pkg.etut_id, part_id: part.part_id, kazanim_id: kid };
    pr.maps[kid] = mid;
    App.store.commit({ meta: true, mindmaps: [mid], etuts: [et.etut_id] });
    App.goMind(mid);
  };
  const link = (id) => { pr.maps[kid] = id; save(et); };
  return (
    <section className="k-panel k-sec cy-maplink">
      <h3 className="cy-h3">Your mind map</h3>
      <p className="k-small">Draw the map of this topic by hand, or keep growing one map over the part. The AI Mind Mapping Assistant reads your photos, asks only what matters and coaches one step at a time; your map stays yours. Corrections to the reading are never counted as learning.</p>
      {doc ? (
        <>
          <p className="k-small"><b>{doc.title}</b>{partMap ? <span className="k-muted"> (linked to the whole part)</span> : null} · {parse ? "read (" + KMind.pendingQuestions(parse, doc).length + " open questions)" : "photos not read yet"}</p>
          <div className="cy-actions">
            <Btn size="sm" kind="primary" onClick={() => App.goMind(doc.map_id)}><Graph size={15} aria-hidden="true" />Open the mind map</Btn>
            {partMap && <Btn size="sm" onClick={() => link(doc.map_id)}>Link it to this topic</Btn>}
          </div>
        </>
      ) : (
        <>
          <div className="cy-actions">
            <Btn size="sm" kind="primary" onClick={start}><Graph size={15} aria-hidden="true" />Start a mind map for this topic</Btn>
            {prev && <Btn size="sm" onClick={() => link(prev.map_id)}>Continue the map of the previous topic</Btn>}
          </div>
          <p className="k-small k-muted">A new map's goal is this topic's outcomes, and its sources this study's sources, so the coach can check facts against them.</p>
          {KMind.list(S).length > 0 && (
            <label className="k-field k-small"><span className="k-field-label">Or link a map you already have</span>
              <select className="k-input" value="" onChange={(e) => { if (e.target.value) link(e.target.value); }}>
                <option value="">Choose…</option>
                {KMind.list(S).map((m) => <option key={m.map_id} value={m.map_id}>{m.title}</option>)}
              </select>
            </label>
          )}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Applying (per topic, then the connecting items placed here)
function Apply({ et }) {
  const App = A(), K = KC(), S = App.S, pr = et.progress, part = partOf(et), k = topicOf(et), idx = itemsOf(et), ex = extrasOf(et), pkg = et.package;
  const ti = pr.topic || 0, kid = k.kazanim_id, pos = K.topicPos(pkg);
  const ev = K.topicEvidence(et, pr.part, ti, idx);
  const cur = pr.current && K.attemptById(et, pr.current);
  const curItem = cur && idx[cur.q_id];
  const nx = !cur ? K.nextItem(et, pr.part, idx, ex, ti) : null;
  const startItem = (item, opts) => { K.startAttempt(et, item, item.format === "recall" ? "practice" : pr.mode, Date.now(), opts); save(et); };
  const close = () => { if (cur) cur.closed_at = Date.now(); pr.current = null; if (pr.warmup && pr.warmup.q.length) { const q = pr.warmup.q.shift(); const it = idx[q]; if (it) { K.startAttempt(et, it, "practice", Date.now(), { warmup: true }); } } save(et); window.scrollTo(0, 0); };
  const warm = K.warmupTopics(S, et, Date.now(), 2);
  const done = (pr.attempts || []).filter((a) => a.committed_at && a.mode !== "final" && K.topicOfAttempt(pkg, a, idx, pos) === kid);
  const conn = K.topicItems(pkg, pr.part, ti, ex).filter(K.isConnecting);
  // "Open the lesson" shows this topic, or every topic a connecting item brings together
  const lessonFor = (item) => {
    const ks = item && K.isConnecting(item) ? item.integrates : [kid];
    return { ...part, kazanimlar: ks.map((x) => K.kazanimlarOf(pkg).filter((y) => y.kazanim_id === x)[0]).filter(Boolean) };
  };
  return (
    <div className="cy-col">
      <section className="k-panel k-sec cy-apply-head">
        <div className="cy-row">
          <div>
            <p className="cy-kicker">Part {pr.part + 1} · Topic {ti + 1} of {part.kazanimlar.length} · Applying</p>
            <h2 className="cy-h3">{k.title}</h2>
            <p className="cy-evidence">
              <b className="k-num">{ev.assessed}/{ev.total}</b> outcomes practised · <b className="k-num">{ev.independent}</b> without help · <b className="k-num">{ev.assisted}</b> with help · <b className="k-num">{ev.needs_work}</b> need work{ev.uncertain ? <> · <b className="k-num">{ev.uncertain}</b> uncertain</> : null}
            </p>
            {conn.length > 0 && <p className="k-small cy-conn-note">{conn.length} question{conn.length > 1 ? "s connect" : " connects"} this topic with earlier ones; {conn.length > 1 ? "they come" : "it comes"} after this topic's own questions.</p>}
          </div>
          <div className="cy-mode">
            <Scale label="Mode" opts={[{ v: "practice", label: "Practice (help allowed)" }, { v: "check", label: "Check without help" }]} value={pr.mode} onPick={(v) => { pr.mode = v; save(et); }} />
          </div>
        </div>
        <p className="k-small k-muted">{pr.mode === "practice" ? "Hints, steps, the solution and the lesson are available before you answer; using them is recorded." : "No help before you answer; feedback comes right after."} Only answers without help count as independent evidence and go to your reviews.</p>
        {warm.length > 0 && !pr.warmup && !cur && (
          <Btn size="sm" onClick={() => { const q = warm.map((x) => "recall:" + x); pr.warmup = { q: q.slice(1) }; startItem(idx[q[0]], { warmup: true }); }}><Play size={14} aria-hidden="true" />Warm-up: recall {warm.length} earlier topic{warm.length > 1 ? "s" : ""} (lowest memory first)</Btn>
        )}
      </section>

      {cur && curItem ? (
        <Item key={cur.id} et={et} item={curItem} attempt={cur} part={lessonFor(curItem)} onNext={close} nextLabel="Next question" />
      ) : nx ? (
        <section className="k-panel k-sec cy-next-card" data-connect={nx.connects ? "1" : undefined}>
          <p className="k-small k-muted">Next: <b>{nx.why}</b>{nx.outcome && !nx.connects ? " · " + nx.outcome : ""} · {K.FORMAT_LABEL[nx.item.format]}</p>
          <Btn kind="primary" onClick={() => startItem(nx.item)}>Show the question<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn>
        </section>
      ) : (
        <section className="k-panel k-sec">
          <p>Every question of this topic has been attempted. For more, use "Practice this again" on an attempt below, or finish Applying.</p>
        </section>
      )}

      {done.length > 0 && <History et={et} attempts={done} idx={idx} />}
      <div className="cy-actions">
        <Btn onClick={() => { pr.current = null; pr.warmup = null; go(et); }}>Finish Applying<ArrowRight size={16} weight="bold" aria-hidden="true" /></Btn>
        {ev.assessed < ev.total && <span className="k-small k-muted">{ev.total - ev.assessed} outcome{ev.total - ev.assessed > 1 ? "s have" : " has"} no practice yet; you can still go on.</span>}
      </div>
    </div>
  );
}

function History({ et, attempts, idx }) {
  const K = KC();
  const [open, setOpen] = useState(null);
  const a = open && K.attemptById(et, open);
  return (
    <section className="k-panel k-sec">
      <h3 className="cy-h3">This topic's attempts</h3>
      <div className="k-table-wrap">
        <table className="k-table cy-hist">
          <thead><tr><th>Question</th><th>Result</th><th>Help</th><th>Reviews</th><th></th></tr></thead>
          <tbody>
            {attempts.slice().reverse().map((x) => {
              const it = idx[x.q_id] || {}, r = x.result || {};
              return (
                <tr key={x.id}>
                  <td className="cy-clip">{K.FORMAT_LABEL[it.format] || ""}{K.isConnecting(it) ? " · connects topics" : ""} · {String(it.stem || x.q_id).replace(/[*`]/g, "").slice(0, 80)}</td>
                  <td>{x.disputed ? "reported" : r.rating ? r.rating : r.correct == null ? "uncertain" : r.correct ? "right" : "not right"}</td>
                  <td>{K.assisted(x) ? [x.hints ? x.hints + " hint" : "", x.steps ? "steps" : "", x.solution_shown ? "solution" : "", x.pane_open ? "lesson" : "", K.modelHints(x).length ? "model hint " + K.modelHintLevel(x) : ""].filter(Boolean).join(", ") : x.followup_of ? "follow-up" : "none"}</td>
                  <td>{x.dsr ? (x.dsr.status === "sent" ? x.dsr.rating : x.dsr.status === "withdrawn" ? <span className="k-muted" title={x.dsr.reason}>withdrawn</span> : <span className="k-muted" title={x.dsr.reason}>kept</span>) : "—"}</td>
                  <td><button type="button" className="k-btn sm" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? "Close" : "Open"}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {a && idx[a.q_id] && <Item key={"h" + a.id} et={et} item={idx[a.q_id]} attempt={a} />}
    </section>
  );
}

// ------------------------------------------------------------------ Evaluating (per topic): deliberately deferred
function Evaluate({ et }) {
  const K = KC(), pr = et.progress, pkg = et.package, k = topicOf(et), all = K.topicsOf(pkg);
  const here = all.filter((t) => t.kid === k.kazanim_id)[0], after = here ? all[here.n + 1] : null;
  const leftOthers = K.topicsLeft(et).filter((t) => t.kid !== k.kazanim_id);
  const done = all.length - K.topicsLeft(et).length;
  let label;
  if (after && after.pi === pr.part) label = "Continue to topic " + (after.ti + 1) + ": " + after.title;
  else if (after) label = "Part " + (pr.part + 1) + " is done · continue to part " + (after.pi + 1);
  else if (!leftOthers.length) label = "Continue to the final test";
  else label = "Go to the first unfinished topic (part " + (leftOthers[0].pi + 1) + ", topic " + (leftOthers[0].ti + 1) + ")";
  return (
    <section className="k-panel k-sec cy-evaluate">
      <Hourglass size={26} aria-hidden="true" />
      <p className="cy-kicker">Part {pr.part + 1} · Topic {(pr.topic || 0) + 1} of {partOf(et).kazanimlar.length} · {k.title}</p>
      <h2 className="cy-h2">Evaluating · deferred</h2>
      <p>This stage is reserved and will be designed later. Nothing is asked or scored here. Continuing records that it was deferred and completes this topic's cycle.</p>
      <p className="k-small k-muted">Topic cycles complete: <b className="k-num">{done}/{all.length}</b>{K.cycleDone(et, k.kazanim_id) ? " (this one included)" : ""}. The final test opens when all are complete.</p>
      <Btn kind="primary" onClick={() => go(et)}>{label}<ArrowRight size={17} weight="bold" aria-hidden="true" /></Btn>
    </section>
  );
}
