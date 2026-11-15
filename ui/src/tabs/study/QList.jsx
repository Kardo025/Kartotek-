// Priming: the part summary with its keywords, and the student's Questions list.
// The list is written in priming and stays open for the rest of the part (and, per part, in the final stages):
// tick a question when it is answered and write the answer next to it.
import React, { useEffect, useReducer, useState } from "react";
import { ArrowRight, Plus, X, SpeakerHigh, Stop } from "@phosphor-icons/react";
import { Btn } from "../kit.jsx";
import { Md, Chip, LevelChip, KzHead, Actions } from "./common.jsx";
import { A, KE, EU } from "./util.js";

function QRow({ et, pi, q, redraw }) {
  const K = KE(), U = EU(), pr = et.progress;
  return (
    <li className="st-ql-row" data-done={q.done ? "1" : undefined}>
      <label className="k-check st-ql-check">
        <input type="checkbox" checked={!!q.done} aria-label={"Answered: " + q.text}
          onChange={(e) => { K.qlistSet(pr, pi, q.id, { done: e.target.checked }); U.commit(et); redraw(); }} />
        <span className="st-ql-text">{q.text}</span>
      </label>
      <textarea className="k-input st-ql-answer" rows={2} defaultValue={q.answer || ""} placeholder="The answer, in your own words" aria-label={"Answer: " + q.text}
        onChange={(e) => { K.qlistSet(pr, pi, q.id, { answer: e.target.value }); }}
        onBlur={() => U.commit(et)} />
      <Btn size="sm" className="st-ql-del" aria-label={"Delete: " + q.text} title="Delete" onClick={() => { K.qlistRemove(pr, pi, q.id); U.commit(et); redraw(); }}>
        <X size={14} weight="bold" aria-hidden="true" />
      </Btn>
    </li>
  );
}

// One part's list with the add field
export function QuestionsList({ et, pi, heading }) {
  const K = KE(), U = EU(), pr = et.progress;
  const [, redraw] = useReducer((x) => x + 1, 0);
  const [draft, setDraft] = useState("");
  const list = K.qlistOf(pr, pi);
  const c = K.qlistCounts(pr, pi);
  const add = () => { if (K.qlistAdd(pr, pi, draft)) { setDraft(""); U.commit(et); redraw(); } };
  return (
    <section className="st-ql" aria-label={heading || "Questions list"}>
      <div className="st-ql-head">
        <h3 className="st-h3">{heading || "Questions list"}</h3>
        <span className="k-small k-muted k-num">{c.done}/{c.total} ticked</span>
      </div>
      {list.length > 0
        ? <ul className="st-ql-items">{list.map((q) => <QRow key={q.id} et={et} pi={pi} q={q} redraw={redraw} />)}</ul>
        : <p className="k-small k-muted">No questions yet. Write what you want this part to answer.</p>}
      <div className="st-ql-add">
        <input className="k-input" value={draft} placeholder="Write a question…" aria-label="New question"
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Btn size="sm" disabled={!draft.trim()} onClick={add}><Plus size={14} weight="bold" aria-hidden="true" />Add</Btn>
      </div>
    </section>
  );
}

// The list under every later screen of the part; in the final stages, every part's list
export function QuestionsDock({ et }) {
  const App = A(), pr = et.progress;
  const inFinal = ["final", "final_review", "done"].indexOf(pr.stage) >= 0;
  if (!inFinal && (pr.stage === "plan" || pr.stage === "priming")) return null;
  const pis = inFinal ? et.package.parts.map((_, i) => i) : [pr.part];
  const K = KE();
  const total = pis.reduce((s, i) => s + K.qlistCounts(pr, i).total, 0), done = pis.reduce((s, i) => s + K.qlistCounts(pr, i).done, 0);
  if (inFinal && total === 0) return null;
  const open = App.pref("kartotek-qlist-open") !== "0";
  return (
    <details className="k-panel st-ql-dock" open={open} onToggle={(e) => App.setPref("kartotek-qlist-open", e.currentTarget.open ? "1" : "0")}>
      <summary>Questions list <span className="k-small k-muted k-num">· {done}/{total} ticked</span></summary>
      {pis.map((i) => <QuestionsList key={i} et={et} pi={i} heading={inFinal ? "Part " + (i + 1) + ": " + et.package.parts[i].title : "Part " + (i + 1)} />)}
    </details>
  );
}

// Reads the part summary aloud with the browser's own speech (no download, no service); hidden when unsupported
function plain(md) { return String(md || "").replace(/\*\*|\*|`/g, "").replace(/^\s*[-\d.]+\s+/gm, ""); }
function Listen({ text }) {
  const ok = typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
  const [on, setOn] = useState(false);
  useEffect(() => () => { if (ok) window.speechSynthesis.cancel(); }, []);
  if (!ok || !text) return null;
  const start = () => {
    window.speechSynthesis.cancel();
    const u = new window.SpeechSynthesisUtterance(plain(text));
    u.lang = "en-GB"; u.rate = 0.95;
    u.onend = () => setOn(false); u.onerror = () => setOn(false);
    window.speechSynthesis.speak(u); setOn(true);
  };
  const stop = () => { window.speechSynthesis.cancel(); setOn(false); };
  return on
    ? <Btn size="sm" onClick={stop}><Stop size={14} weight="fill" aria-hidden="true" />Stop</Btn>
    : <Btn size="sm" onClick={start} title="Read the summary aloud (browser speech)"><SpeakerHigh size={14} aria-hidden="true" />Listen</Btn>;
}

// The priming stage: what the part covers, its keywords, and the first questions
export function PrimingScreen({ et, act, lv }) {
  const K = KE(), pr = et.progress, part = K.currentPart(et), sm = part.summary || {};
  const kw = sm.keywords || [];
  return (
    <>
      <KzHead chips={<><Chip>Part {pr.part + 1}/{et.package.parts.length} · Priming</Chip><LevelChip lv={lv} /></>} title={part.title}>
        <p className="k-small k-muted st-lead">Read what this part covers, then write the questions you want it to answer. The Questions list stays open for the whole part: tick a question when you can answer it and write the answer next to it.</p>
      </KzHead>
      {sm.md && <div className="k-panel st-box"><div className="st-box-head"><h3 className="st-h3">Summary</h3><Listen text={sm.md} /></div><Md src={sm.md} /></div>}
      {kw.length > 0 && (
        <div className="k-panel st-box">
          <h3 className="st-h3">Keywords</h3>
          <dl className="st-kw-list">{kw.map((w, i) => <div key={i}><dt><b>{w.term}</b></dt><dd>{w.definition}</dd></div>)}</dl>
        </div>
      )}
      <div className="k-panel st-box"><QuestionsList et={et} pi={pr.part} /></div>
      <Actions><Btn kind="primary" onClick={() => act("priming-next")}>Start the lesson<ArrowRight size={17} weight="bold" aria-hidden="true" /></Btn></Actions>
    </>
  );
}
