// Exam prep overview (CEnT-S and TU Delft AE Prep): studied sections, plan and pace, evidence-based topic mastery,
// Up next, placement tests per syllabus block and one-click study / test creation per syllabus item.
// Done marks live in S.cents.done for both exams, so a topic shared by the exams is marked in both at once.
// Mastery comes from KPrep (src/prep-core.js): DSR memory of the topic's cards, study and test progress, placement and mock results.
import React, { useState } from "react";
import ModelHint from "./ModelHint.jsx";
import { motion } from "motion/react";
import { Check, Plus, FilePdf, ArrowSquareOut, BookOpenText, Play, Copy, Exam, Compass, Timer, Stack, ClipboardText, VideoCamera } from "@phosphor-icons/react";
import { PageHead, Panel, Btn, Kpi, Bar } from "./kit.jsx";
import "./cents.css";
import { jobsAvailable, createStudyJobs, JobsPanel } from "./Jobs.jsx";

const App = () => window.App;
const K = () => window.KCents;
const P = () => window.KPrep;
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const UI = {
  cents: {
    title: "CEnT-S",
    sub: "The official CISIA syllabus (2026-27: 6 sections, 65 questions, 140 minutes) with OpenStax pages. Exam: November 2026, 16:30.",
    order: () => K().ORDER,
    other: "tud", otherName: "TU Delft",
    last: { label: "Scoring", value: "Correct +1, blank 0, wrong -0.25", sub: "5 options per question" },
  },
  tud: {
    title: "TU Delft AE Prep",
    sub: "BSc Aerospace Engineering selection exam: the official TU Delft syllabus (v2027) with OpenStax pages, the Alderliesten book and the TU Delft lectures. Exam: 11 March 2027, online and proctored, 90 minutes.",
    order: () => K().TUD_ORDER,
    other: "cents", otherName: "CEnT-S",
    last: { label: "Section weights", value: "Math 30%, Physics 30%, First-year 40%", sub: "The exam counts 60% of the ranking (manual 2025-26)" },
  },
};
const TONE = { done: "ok", known: "ok", mastered: "ok", fading: "bad", tested: "mid", studied: "mid", studying: "warn", placed: "warn", none: "" };

function doneMap() { const S = App().S; if (!S.cents) S.cents = { sel: K().ORDER.slice(), done: {} }; if (!S.cents.done) S.cents.done = {}; return S.cents.done; }
function selState(exam) {
  const S = App().S;
  if (!S[exam]) S[exam] = { sel: UI[exam].order().slice() };
  if (!S[exam].sel) S[exam].sel = UI[exam].order().slice();
  return S[exam];
}
function save() { App().store.commit({ meta: true }); App().render(); }

function toggleSection(exam, id) {
  const c = selState(exam), order = UI[exam].order();
  const i = c.sel.indexOf(id);
  if (i >= 0) { if (c.sel.length < 2) return; c.sel = c.sel.filter((x) => x !== id); }
  else c.sel = order.filter((x) => x === id || c.sel.indexOf(x) >= 0);
  save();
}
function toggleDone(id) { const d = doneMap(); if (d[id]) delete d[id]; else d[id] = true; save(); }

// A real study exists once Claude has written it; the generated skeleton does not count
function studyOf(itemId) {
  const S = App().S, e = S.etuts && S.etuts[K().etutId(itemId)];
  return e && !e.removed && !(e.package && e.package.generated) ? e : null;
}
function testOf(itemId) {
  const S = App().S, l = S.lessons && S.lessons[K().lessonId(itemId)];
  return l && !l.removed ? l : null;
}
// The link opens Claude Code in the configured content folder (src/config.js, kartotek.config.json)
export function claudeLink(prompt) { return window.KConfig.claudeLink(prompt); }
export function copyText(t) {
  const A = App();
  try { navigator.clipboard.writeText(t).then(() => A.toast("Prompt copied"), () => A.toast("Copy failed")); } catch (e) { A.toast("Copy failed"); }
}
function genOpts(exam) { const x = selState(exam); return x.gen || { depth: "standard", level: "standard" }; }
function openStudy(itemId) { App().goStudy(K().etutId(itemId)); window.scrollTo({ top: 0 }); }
function openTest(itemId) { App().goLesson(K().lessonId(itemId)); window.scrollTo({ top: 0 }); }

// "Ask Claude" link + copy button as one control; without a model set up, a hint next to it says what to set up (task E1)
export function AskPair({ prompt, label, icon, primary, title, copyLabel, what }) {
  return (
    <>
      <a className={"k-btn sm cents-ask" + (primary ? " primary" : "")} href={claudeLink(prompt)} title={title || "Opens Claude Code in the Kartotek folder with the prompt filled in. Press Enter there to send it."}>
        {icon} {label}
      </a>
      <button type="button" className="k-btn sm cents-copy" onClick={() => copyText(prompt)} aria-label={copyLabel || "Copy the prompt"} title="Copy the prompt"><Copy size={14} aria-hidden="true" /></button>
      <ModelHint what={what} />
    </>
  );
}

function stats(S, sec, now) {
  const C = K(), KP = P(); let p = 0, dp = 0, i = 0, di = 0;
  KP.sectionRows(S, sec, now).forEach((o) => {
    if (o.r.x[3] === "opt") return;
    const n = C.nPages(o.r.x[4]); p += n; i++;
    if (KP.covered(o.st)) { dp += n; di++; }
  });
  return { p, dp, i, di };
}

export function makePrep(exam) {
  return function Prep() { return <PrepPage exam={exam} />; };
}
// "Write next N studies" in the app (task E3): one study job per syllabus topic, written from its page extract in the content
// folder's sources by the strong slot; the jobs run one after another and show their estimates first
function WriteNextInApp({ rows, exam }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const C = window.KCents;
      const list = rows.map((r) => {
        const f = C.find(r.id), label = f.item[1] + " " + f.item[2];
        return { id: C.etutId(r.id), extract: C.etutId(r.id) + ".pdf", title: (C.examsOf(r.id).indexOf("cents") >= 0 ? "CEnT-S" : "TU Delft AE") + ": " + label + " (" + f.book.name + ")",
          scope: "This extract is " + f.book.name + ", printed pages " + C.printedText(f.book, f.item[4]) + " (PDF pages " + C.pdfText(f.item[4]) + "); cite printed page numbers." };
      });
      const out = await createStudyJobs(list, null);
      const bad = out.filter((x) => !x || !x.ok);
      window.App.toast(bad.length ? bad.length + " of " + out.length + " could not be prepared: " + (bad[0] && bad[0].error) : out.length + " study jobs prepared. Check their estimates in the Study library, then start them.");
    } finally { setBusy(false); }
  };
  return <Btn size="sm" disabled={busy} onClick={run} title={"Kartotek writes the studies for " + rows.map((b) => b.num).join(", ") + " with your writing model, one after another, from the page extracts in your content folder."}><Stack size={14} aria-hidden="true" />{busy ? "Preparing…" : "Write next " + rows.length + " in the app"}</Btn>;
}

export default makePrep("cents");

// Exam date and study pace of an exam for the Planning home: the same numbers as the Plan panel of its overview
export function examSummary(exam) {
  const S = App().S, c = selState(exam);
  const sel = K().EXAMS[exam].sections.filter((s) => c.sel.indexOf(s.id) >= 0);
  const pc = P().pace(S, exam, sel, Date.now());
  return { id: exam, label: UI[exam].title, examTs: pc.examTs, days: pc.days, left: pc.left, perDay: pc.perDay, topicsPerDay: pc.topicsPerDay, status: pc.status };
}

function PlanPanel({ exam, sel }) {
  const A = App(), S = A.S, x = selState(exam), pc = P().pace(S, exam, sel, Date.now());
  const lim = (S.settings.exam_new_limits || {})[exam];
  const g = genOpts(exam);
  const setDate = (v) => { x.examDate = v || null; if (v && !x.planStart) x.planStart = Date.now(); if (!v) x.planStart = null; save(); };
  const setLim = (v) => { S.settings.exam_new_limits = Object.assign({}, S.settings.exam_new_limits || {}, { [exam]: v === "" ? null : Math.max(0, parseInt(v, 10) || 0) }); save(); };
  const setGen = (k, v) => { x.gen = Object.assign({}, g, { [k]: v }); save(); };
  return (
    <Panel className="cents-plan" title="Plan">
      <div className="cents-plan-grid">
        <label className="k-field">
          <span className="k-field-label">Exam date</span>
          <input type="date" className="k-input" value={x.examDate || ""} onChange={(e) => setDate(e.target.value)} />
          <span className="k-field-hint">Exam mode for this section's cards: in the last 7 days R* rises, new cards slow down, intervals stop before the exam day.</span>
        </label>
        <div className="cents-pace">
          {pc.examTs ? (
            <>
              <b className="k-num">{pc.days} {pc.days === 1 ? "day" : "days"} left</b>
              <span className="k-num">{fmt(pc.left)} required pages left · <b>{fmt(pc.perDay)}</b> pages a day ({pc.topicsPerDay} topics), the last 3 days kept for review and mocks</span>
              <span className={"cents-pill " + (pc.status === "behind" ? "b" : pc.status === "ahead" ? "s" : "o")}>{pc.status}{pc.expected != null ? " · " + fmt(pc.done) + " / " + fmt(pc.expected) + " pages expected by today" : ""}</span>
            </>
          ) : <span className="k-small">Set the exam date to see the pace you need.</span>}
        </div>
        <label className="k-field">
          <span className="k-field-label">New cards a day for this exam</span>
          <input type="number" min="0" className="k-input k-num" placeholder={"shared " + S.settings.daily_new_card_limit} value={lim == null ? "" : lim} onChange={(e) => setLim(e.target.value)} />
          <span className="k-field-hint">Empty: shares the global limit ({S.settings.daily_new_card_limit}). A number gives this exam its own budget inside it.</span>
        </label>
        <div className="cents-gen">
          <span className="k-field-label">What Claude writes</span>
          <div className="cents-seg" role="group" aria-label="Depth">
            {[["cram", "Cram"], ["standard", "Standard"], ["comprehensive", "Comprehensive"]].map(([v, l]) => (
              <button key={v} type="button" aria-pressed={g.depth === v} onClick={() => setGen("depth", v)}>{l}</button>
            ))}
          </div>
          <div className="cents-seg" role="group" aria-label="Difficulty">
            {[["standard", "Standard questions"], ["exam", "Exam level"]].map(([v, l]) => (
              <button key={v} type="button" aria-pressed={g.level === v} onClick={() => setGen("level", v)}>{l}</button>
            ))}
          </div>
          <span className="k-field-hint">Applies to every Write with Claude and Test with Claude prompt on this page.</span>
        </div>
      </div>
    </Panel>
  );
}

function UpNext({ exam, sec }) {
  const S = App().S, C = K();
  const picks = P().upNext(S, exam, sec, Date.now(), 3);
  if (!picks.length) return null;
  return (
    <div className="cents-next">
      <b>Up next</b>
      <ol>
        {picks.map((p) => {
          const bk = C.BOOKS[p.row.b];
          return (
            <li key={p.row.x[0]}>
              <span className="cents-code">{p.row.num}</span>
              <span>{p.row.x[2]}<span className="k-small">, {bk.short || bk.name} {p.row.x[1]} · p. {C.printedText(bk, p.row.x[4])}</span></span>
              <span className="cents-why">{p.why}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PrepPage({ exam }) {
  const C = K(), KP = P(), A = App(), S = A.S, u = UI[exam], c = selState(exam), now = Date.now();
  const SECTIONS = C.EXAMS[exam].sections;
  const [active, setActive] = useState("math");
  const [hideDone, setHideDone] = useState(false);
  const [hideOpt, setHideOpt] = useState(false);
  const sel = SECTIONS.filter((s) => c.sel.indexOf(s.id) >= 0);
  const cur = sel.find((s) => s.id === active) || sel[0];
  const info = {}; SECTIONS.forEach((s) => { info[s.id] = stats(S, s, now); });
  const T = sel.reduce((a, s) => { const f = info[s.id]; return { p: a.p + f.p, dp: a.dp + f.dp, i: a.i + f.i, di: a.di + f.di, q: a.q + s.q, m: a.m + s.min }; }, { p: 0, dp: 0, i: 0, di: 0, q: 0, m: 0 });
  const pct = T.p ? Math.round((T.dp / T.p) * 100) : 0;
  const f = info[cur.id];
  const g = genOpts(exam);
  const rowsAll = KP.sectionRows(S, cur, now);
  // Batch: the next 5 topics of the section in syllabus order that have pages and no study (or no test) yet
  const nextFor = (kind) => rowsAll.filter((o) => o.r.x[3] !== "opt" && o.r.x[4].length && !KP.covered(o.st) && o.st.state !== "known" && !(kind === "test" ? testOf(o.r.x[0]) : studyOf(o.r.x[0])))
    .slice(0, 5).map((o) => ({ id: o.r.x[0], num: o.r.num }));
  const batchS = nextFor("study"), batchT = nextFor("test");
  const mocks = Object.values(S.mocks || {}).filter((m) => m && !m.removed && m.package.exam === exam);

  return (
    <div className={"k-page cents prep-" + exam}>
      <PageHead title={u.title} sub={<p className="k-sub">{u.sub}</p>}>
        <Btn onClick={() => A.goMock(exam)}><Timer size={16} aria-hidden="true" /> Mock exam{mocks.length ? " (" + mocks.length + ")" : ""}</Btn>
      </PageHead>
      <div className="k-kpis">
        <Kpi label="Pages covered" value={<>{fmt(T.dp)} <span className="cents-of">/ {fmt(T.p)}</span></>} sub="Studied, tested, known or ticked"><Bar value={pct / 100} /></Kpi>
        <Kpi label="Required topics covered" value={<>{T.di} <span className="cents-of">/ {T.i}</span></>} />
        <Kpi label="Exam" value={<>{T.q} <span className="cents-of">questions, {T.m} min</span></>} />
        <Kpi label={u.last.label} value={<span className="cents-score">{u.last.value}</span>} sub={u.last.sub} />
      </div>

      <PlanPanel exam={exam} sel={sel} />
      {exam === "tud" && <TudRules />}

      <section className="k-panel cents-chips" role="group" aria-label="Studied sections">
        <span className="cents-chips-l">Studied sections</span>
        {SECTIONS.map((s) => {
          const on = c.sel.indexOf(s.id) >= 0, last = on && c.sel.length === 1;
          return (
            <motion.button key={s.id} type="button" whileTap={{ scale: 0.97 }} className={"cents-chip" + (on ? "" : " off")} aria-pressed={on}
              aria-disabled={last || undefined} title={last ? "At least one section must stay on" : undefined} onClick={() => toggleSection(exam, s.id)}>
              {on ? <Check size={14} weight="bold" aria-hidden="true" /> : <Plus size={14} weight="bold" aria-hidden="true" />}{s.name}
            </motion.button>
          );
        })}
        {sel.length < SECTIONS.length && <span className="k-small cents-note">Turned-off sections are left out of the page, question, time and section totals.</span>}
      </section>

      <div className="k-panel cents-tabs" role="group" aria-label="Exam sections" style={{ gridTemplateColumns: sel.map((s) => "minmax(130px," + s.q + "fr)").join(" ") }}>
        {sel.map((s) => {
          const x = info[s.id], on = s.id === cur.id;
          return (
            <button key={s.id} type="button" className="cents-tab" aria-pressed={on} onClick={() => setActive(s.id)}>
              {on && <motion.span layoutId={"cents-tab-bg-" + exam} className="cents-tab-bg" transition={{ type: "spring", duration: 0.35, bounce: 0.1 }} />}
              <span className="cents-tab-in">
                <span className="cents-tab-n">{s.name}<span>{s.q} q</span></span>
                <span className="cents-tab-c">{x.di} / {x.i} {x.i === 1 ? "topic" : "topics"}, {x.p ? Math.round((x.dp / x.p) * 100) : 0}% pages</span>
                <Bar value={x.p ? x.dp / x.p : 0} />
              </span>
            </button>
          );
        })}
      </div>

      <div className="cents-sechead">
        <div>
          <h2>{cur.name}</h2>
          <p className="k-small">{cur.q} questions, {cur.min} minutes. {fmt(f.dp)} / {fmt(f.p)} pages covered.</p>
        </div>
        <div className="k-row-btns">
          {batchS.length > 1 && <AskPair prompt={C.batchPrompt(batchS, "study", g)} icon={<Stack size={14} aria-hidden="true" />} label={"Write next " + batchS.length + " studies"} copyLabel="Copy the batch study prompt"
            title={"One Claude Code session writes the studies for " + batchS.map((b) => b.num).join(", ") + ", then builds once."} />}
          {batchS.length > 1 && jobsAvailable() && <WriteNextInApp rows={batchS} exam={exam} />}
          {batchT.length > 1 && <AskPair prompt={C.batchPrompt(batchT, "test", g)} icon={<Stack size={14} aria-hidden="true" />} label={"Write next " + batchT.length + " tests"} copyLabel="Copy the batch test prompt"
            title={"One Claude Code session writes the end-of-lesson tests for " + batchT.map((b) => b.num).join(", ") + "."} />}
          <button type="button" className="k-btn sm" aria-pressed={hideDone} onClick={() => setHideDone(!hideDone)}>Hide covered</button>
          <button type="button" className="k-btn sm" aria-pressed={hideOpt} onClick={() => setHideOpt(!hideOpt)}>Hide optional</button>
        </div>
      </div>

      <UpNext exam={exam} sec={cur} />

      {cur.syl.map((bl) => {
        const req = bl.rows.filter((r) => r.x[3] !== "opt");
        const sts = {}; bl.rows.forEach((r) => { sts[r.x[0]] = KP.itemStatus(S, r.x[0], now); });
        const dn = req.filter((r) => KP.covered(sts[r.x[0]])).length;
        const rows = bl.rows.filter((r) => !(hideDone && KP.covered(sts[r.x[0]])) && !(hideOpt && r.x[3] === "opt"));
        const withPages = bl.rows.filter((r) => r.x[4].length);
        const pid = C.placementId(exam, cur.id, bl.n), place = S.lessons && S.lessons[pid] && !S.lessons[pid].removed ? S.lessons[pid] : null;
        const known = place ? bl.rows.filter((r) => sts[r.x[0]].state === "known").length : 0;
        return (
          <Panel key={exam + cur.id + bl.n} className="cents-book">
            <div className="cents-book-h">
              <h3><span className="cents-syl-n">{bl.n}</span>{bl.name}</h3>
              {req.length > 0 && <span className="k-small">{dn} / {req.length} covered</span>}
              {withPages.length > 0 && (
                <span className="cents-links">
                  {place
                    ? <Btn size="sm" onClick={() => A.goLesson(pid)}><Compass size={14} aria-hidden="true" /> {place.progress && place.progress.tested_at ? "Placement: " + known + " known" : "Take placement test"}</Btn>
                    : <AskPair prompt={C.placementPrompt(exam, cur, bl)} icon={<Compass size={14} aria-hidden="true" />} label="Placement test" copyLabel={"Copy the placement prompt for block " + bl.n}
                        title="Claude writes a short diagnostic test for this block. Topics you already know are marked Known and move to the end of Up next." />}
                </span>
              )}
            </div>
            {bl.see && <p className="cents-skip nb">{bl.see}</p>}
            {bl.rows.length > 0 && rows.length === 0 && <p className="cents-skip nb">Nothing left to show with these filters.</p>}
            {rows.map((r) => <Row key={r.x[0]} r={r} u={u} st={sts[r.x[0]]} g={g} />)}
          </Panel>
        );
      })}

      {exam === "tud" && RES[cur.id] && <Ladder sec={cur} />}

      <Panel className="cents-book cents-src">
        <div className="cents-book-h"><h3>Sources</h3><span className="k-small">Books used in {cur.name}</span></div>
        {cur.books.map((gp) => {
          const bk = C.BOOKS[gp.b];
          let tot = 0; gp.items.forEach((x) => { if (x[3] !== "opt") tot += C.nPages(x[4]); });
          return (
            <div key={gp.b} className="cents-src-row">
              <div className="cents-src-h">
                <b>{bk.name}</b>
                <span className="k-small">{gp.items.length} {gp.items.length === 1 ? "topic" : "topics"}{tot ? ", " + fmt(tot) + " required pages" : ""}</span>
                <span className="cents-links">
                  {bk.pdf && <a href={bk.pdf} target="_blank" rel="noopener"><FilePdf size={16} aria-hidden="true" /> PDF</a>}
                  {bk.url && <a href={bk.url} target="_blank" rel="noopener"><ArrowSquareOut size={16} aria-hidden="true" /> {bk.pdf ? "Web" : "Open"}</a>}
                </span>
              </div>
              {gp.note && <p className="k-small cents-src-note">{gp.note}</p>}
              {gp.skip && <p className="k-small cents-src-note">{gp.skip}</p>}
            </div>
          );
        })}
      </Panel>
    </div>
  );
}

function Row({ r, u, st, g }) {
  const C = K(), x = r.x, bk = C.BOOKS[r.b];
  const id = x[0], on = !!st.manual, cov = P().covered(st), shared = C.examsOf(id).indexOf(u.other) >= 0, opt = x[3] === "opt", has = x[4].length > 0, sd = studyOf(id);
  const href = bk.pdf ? bk.pdf + "#page=" + (has ? x[4][0][0] : 1) : bk.url;
  const src = !has && C.srcOf ? C.srcOf(id) : null;
  const local = has ? "file:///" + C.extractOf(id).replace(/\\/g, "/") : null;
  return (
    <div className={"cents-row" + (cov ? " done" : "")}>
      <button type="button" className="cents-tick" aria-pressed={on} title="Done by hand (overrides the evidence)" aria-label={(on ? "Unmark done: " : "Mark done: ") + r.num + " " + x[2]} onClick={() => toggleDone(id)}>
        {on && <Check size={14} weight="bold" aria-hidden="true" />}
      </button>
      <span className="cents-code">{r.num}</span>
      <span className="cents-t">
        <span className="cents-t-text">{x[2]}</span>
        <span className="cents-pills">
          {st.state !== "none" && <span className={"cents-pill st " + TONE[st.state]} title={st.meanR != null ? "Mean R of " + st.reviewed + " reviewed cards: " + Math.round(st.meanR * 100) + "%" : undefined}>{st.label}{st.meanR != null ? " · R " + Math.round(st.meanR * 100) + "%" : ""}</span>}
          {opt && <span className="cents-pill o">optional</span>}
          {x[3] === "gap" && <span className="cents-pill">not in class</span>}
          {shared && <span className="cents-pill s" title={"The same topic is in " + u.otherName + ": its study, cards and done mark are shared"}>also in {u.otherName}</span>}
        </span>
      </span>
      <span className="cents-pg">
        <span className="cents-bk" title={bk.name}>{bk.short || bk.name} {x[1]}</span>
        {has ? <a href={href} target="_blank" rel="noopener">p. {C.printedText(bk, x[4])}</a> : null}
        {has && <span className="k-small">PDF {C.pdfText(x[4])}, {C.nPages(x[4])} pp · <a href={local} title={"Local page extract: " + C.extractOf(id)}>extract</a></span>}
        {!has && src && src.url && <a href={src.url} target="_blank" rel="noopener">{src.kind === "video" ? <><VideoCamera size={13} aria-hidden="true" /> Lecture page</> : "Open the book"}</a>}
        {!has && src && src.kind === "dle" && <span className="k-small">Only on the Digital Learning Environment</span>}
        {!has && !src && bk.pdf == null && <span className="k-small">{id === "rc-1" ? "Practised in the mocks" : "Source later"}</span>}
      </span>
      <span className="cents-act">
        {has && (sd
          ? <Btn size="sm" onClick={() => openStudy(id)}><Play size={14} weight="fill" aria-hidden="true" /> Open study</Btn>
          : <AskPair prompt={C.studyPrompt(id, g)} primary icon={<BookOpenText size={14} aria-hidden="true" />} label="Write with Claude" copyLabel={"Copy the prompt for " + r.num} />)}
        {!has && src && (sd
          ? <Btn size="sm" onClick={() => openStudy(id)}><Play size={14} weight="fill" aria-hidden="true" /> Open study</Btn>
          : <AskPair prompt={C.srcPrompt(id, g)} primary icon={<BookOpenText size={14} aria-hidden="true" />} label="Write with Claude" copyLabel={"Copy the prompt for " + r.num}
              title={src.kind === "dle" ? "Claude asks for your notes or transcripts first: this lecture is only on the Digital Learning Environment." : undefined} />)}
        {has && (testOf(id)
          ? <Btn size="sm" onClick={() => openTest(id)}><Exam size={14} aria-hidden="true" /> Open test</Btn>
          : <AskPair prompt={C.lessonPrompt(id, g)} icon={<Exam size={14} aria-hidden="true" />} label="Test with Claude" copyLabel={"Copy the test prompt for " + r.num}
              title="Opens Claude Code in the Kartotek folder with the end-of-lesson test prompt filled in. Press Enter there to send it." />)}
      </span>
    </div>
  );
}

export const Tud = makePrep("tud");

// ------------------------------------------------------------------ TU Delft: exam rules and practice ladders
function TudRules() {
  return (
    <Panel className="cents-rules" title="How the selection exam works" actions={<Btn size="sm" onClick={() => App().switchTab("tud-apply")}><ClipboardText size={14} aria-hidden="true" /> Application plan</Btn>}>
      <div className="cents-rules-grid">
        <ul className="cents-rules-l">
          <li><b>90 minutes, three timed sections:</b> Mathematics 30 min (~20 q, 30%), Physics 30 min (~20 q, 30%), First-year AE topics 30 min (~25 q, 40%).</li>
          <li><b>About 1.5 minutes a question.</b> All multiple choice; a wrong answer costs nothing, so never leave one blank.</li>
          <li><b>No way back.</b> You move freely inside a section, but once you finish it you cannot return.</li>
        </ul>
        <ul className="cents-rules-l">
          <li><b>Calculator:</b> only the computer's own calculator app, standard or scientific mode. Practise with it.</li>
          <li><b>Formula sheets</b> from the faculty are allowed in every section; your own notes are not.</li>
          <li><b>First-year AE topics:</b> the v2027 syllabus asks you to know every formula of the book and lectures by heart, with its assumptions. Do not count on the formula sheet for them.</li>
          <li><b>No practice exams</b> are published; the Math &amp; Physics level test on the DLE is the only official practice.</li>
        </ul>
      </div>
      <p className="k-small cents-rules-src">Format from the <a href="https://filelist.tudelft.nl/TUDelft/Onderwijs/Opleidingen/Bachelor/Aerospace_Engineering/Selection_2025_2026/Selection%20Procedure%20Manual%202025-2026.pdf" target="_blank" rel="noopener">Selection Procedure Manual 2025-26</a>; check it again when the 2027 manual comes out. Mathematics and Physics work as a threshold; the First-year section decides most of the ranking.</p>
    </Panel>
  );
}

const L = (url, name, note) => ({ url, name, note });
const RES = {
  math: {
    books: [
      L("https://openstax.org/details/books/algebra-and-trigonometry-2e", "OpenStax Algebra and Trigonometry 2e", "functions, logarithms, trigonometry, systems"),
      L("https://openstax.org/details/books/precalculus-2e", "OpenStax Precalculus 2e", "laws of sines and cosines, parametric equations, vectors"),
      L("https://openstax.org/details/books/calculus-volume-1", "OpenStax Calculus Volume 1", "derivatives, integrals, volumes of revolution, centres of mass"),
      L("https://openstax.org/details/books/calculus-volume-2", "OpenStax Calculus Volume 2, ch. 7.1-7.2", "tangents to parametric curves"),
    ],
    videos: [
      L("https://www.youtube.com/@khanacademy", "Khan Academy", "short videos per topic"),
      L("https://www.youtube.com/@TheOrganicChemistryTutor", "The Organic Chemistry Tutor", "one question type per video, fast"),
      L("https://www.youtube.com/@3blue1brown", "3Blue1Brown: Essence of Calculus", "what derivatives and integrals mean"),
      L("https://online-learning.tudelft.nl/courses/pre-university-calculus", "TU Delft Pre-University Calculus", "the MOOC the manual recommends"),
      L("https://www.youtube.com/@ProfessorLeonard", "Professor Leonard", "full-length lectures, the deepest"),
    ],
    banks: [
      L("https://www.khanacademy.org/", "Khan Academy exercises", "find your gaps"),
      L("", "OpenStax end-of-chapter exercises", "odd answers in the book"),
      L("https://tutorial.math.lamar.edu/", "Paul's Online Math Notes", "worked solutions step by step"),
      L("https://online-learning.tudelft.nl/courses/pre-university-calculus", "TU Delft MOOC exercises + DLE level test", "closest to the format"),
      L("https://www.cisiaonline.it/", "CISIA practice tests", "timed multiple choice, shared with CEnT-S"),
      L("https://www.physicsandmathstutor.com/", "Physics & Maths Tutor", "A-level questions by topic"),
      L("https://apcentral.collegeboard.org/", "AP Calculus AB past questions", "free-response with scoring guides"),
      L("https://www.examenblad.nl/", "VWO central exams, Wiskunde B", "closest syllabus, in Dutch, hardest"),
    ],
  },
  phys: {
    books: [
      L("https://openstax.org/details/books/college-physics-2e", "OpenStax College Physics 2e", "the level of the syllabus, no calculus"),
      L("https://openstax.org/details/books/university-physics-volume-1", "OpenStax University Physics Volume 1", "mechanics, oscillations, waves with calculus"),
      L("https://openstax.org/details/books/university-physics-volume-2", "OpenStax University Physics Volume 2", "electricity and magnetism with calculus"),
    ],
    videos: [
      L("https://www.youtube.com/@khanacademy", "Khan Academy Physics", "short videos per topic"),
      L("https://www.youtube.com/@TheOrganicChemistryTutor", "The Organic Chemistry Tutor", "circuits, Coulomb, Lorentz force"),
      L("https://www.youtube.com/@FlippingPhysics", "Flipping Physics", "AP Physics 1 and C, worked examples"),
      L("https://online-learning.tudelft.nl/courses/pre-university-physics", "TU Delft Pre-University Physics", "the MOOC the manual recommends"),
      L("https://www.youtube.com/@mitocw", "MIT OCW 8.01 and 8.02", "beyond the syllabus, the deepest"),
    ],
    banks: [
      L("https://www.khanacademy.org/", "Khan Academy exercises", "find your gaps"),
      L("", "OpenStax end-of-chapter problems", "odd answers in the book"),
      L("https://online-learning.tudelft.nl/courses/pre-university-physics", "TU Delft MOOC exercises + DLE level test", "closest to the format"),
      L("https://isaacphysics.org/", "Isaac Physics", "levels 2-4 match the syllabus, 5-6 for mastery"),
      L("https://www.cisiaonline.it/", "CISIA practice tests", "timed multiple choice"),
      L("https://www.physicsandmathstutor.com/", "Physics & Maths Tutor", "A-level questions by topic"),
      L("https://apcentral.collegeboard.org/", "AP Physics 1 / C past questions", "Physics C is above the syllabus"),
      L("https://www.examenblad.nl/", "VWO central exams, Natuurkunde", "closest syllabus, in Dutch, hardest"),
    ],
  },
  fy: {
    books: [
      L("https://textbooks.open.tudelft.nl/textbooks/catalog/book/15", "Alderliesten, Introduction to Aerospace Structures and Materials", "chapter 5, sections 5.1-5.9 only"),
    ],
    videos: [
      L("https://ocw.tudelft.nl/course-lectures/3-aircraft-fly/", "Module A, Lecture 3: How aircraft fly", "open on TU Delft OCW"),
      L("https://ocw.tudelft.nl/course-lectures/1-fundamentals-aerodynamics/", "Module B, Lecture 1: Fundamentals of aerodynamics", "open on TU Delft OCW"),
      L("https://ocw.tudelft.nl/course-lectures/1-introduction-flight-mechanics/", "Module C, Lecture 1: Introduction to flight mechanics", "open on TU Delft OCW"),
      L("", "Lectures 4, 5 and 11: launch vehicles, orbits, flight mechanics", "only on the Digital Learning Environment"),
    ],
    banks: [
      L("", "Your own formula list", "every formula with its symbols, units and assumptions"),
      L("", "A recall card and a calculation for each formula", "Write with Claude adds them to each study"),
      L("", "Questions inside the lecture videos", "and the book's exercises where there are any"),
      L("", "Timed run of all cards", "25 questions in 30 minutes, the last two weeks"),
    ],
  },
};

function Ladder({ sec }) {
  const r = RES[sec.id];
  const col = (title, list) => (
    <div className="cents-lad-col">
      <h4>{title} <span className="cents-pill">easy → hard</span></h4>
      <ol>
        {list.map((x, i) => (
          <li key={i}>{x.url ? <a href={x.url} target="_blank" rel="noopener">{x.name}</a> : <b>{x.name}</b>}<span className="k-small">{x.note}</span></li>
        ))}
      </ol>
    </div>
  );
  return (
    <Panel className="cents-book cents-lad">
      <div className="cents-book-h"><h3>Practice ladder</h3><span className="k-small">{sec.name}: books, videos and question banks from easy to hard</span></div>
      <div className="cents-lad-grid">
        {col("Books", r.books)}
        {col("Videos", r.videos)}
        {col(sec.id === "fy" ? "Build your own bank" : "Question banks", r.banks)}
      </div>
    </Panel>
  );
}
