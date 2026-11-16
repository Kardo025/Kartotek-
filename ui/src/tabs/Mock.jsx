// Mock exam tab of an exam section (CEnT-S / TU Delft AE Prep): library, timed sequential sections, results per topic.
// Packages: mocks/<id>/mock.json (MOCK-RULES.md), written by Claude Code from the prompt on this page and bundled by build.ps1.
// Mock results do not write DSR events; topics answered wrong move up in the Overview's Up next.
import React, { useEffect, useReducer, useState } from "react";
import { Timer, Play, ArrowRight, ArrowLeft, Flag, ArrowCounterClockwise, FileArrowUp, Trash, Exam } from "@phosphor-icons/react";
import { PageHead, Panel, Btn, Kpi, TableWrap, ConfirmBtn } from "./kit.jsx";
import { Md } from "./study/common.jsx";
import { AskPair } from "./Cents.jsx";
import { NewJob, JobsPanel, jobsAvailable } from "./Jobs.jsx";
import "./mock.css";

const App = () => window.App;
const KM = () => window.KMock;
const K = () => window.KCents;
const LETTERS = "ABCDE";
const NAME = { cents: "CEnT-S", tud: "TU Delft AE" };

function save(id) { App().store.commit({ meta: true, mocks: id ? [id] : [] }); App().render(); }
function mocksOf(exam) {
  const S = App().S;
  return Object.values(S.mocks || {}).filter((m) => m && !m.removed && m.package && m.package.exam === exam)
    .sort((a, b) => (a.imported_at || 0) - (b.imported_at || 0));
}
function clock(sec) { const m = Math.floor(sec / 60), s = sec % 60; return m + ":" + String(s).padStart(2, "0"); }
function nextNumber(exam) {
  const ids = Object.keys(App().S.mocks || {}).filter((id) => id.indexOf(exam + "-mock-") === 0).map((id) => parseInt(id.split("-").pop(), 10) || 0);
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

export default function Mock({ exam }) {
  const A = App(), S = A.S;
  const [view, setView] = useState({ id: A.mockOpen || null, mode: null });
  const [, tick] = useReducer((x) => x + 1, 0);
  const list = mocksOf(exam);
  const m = view.id && S.mocks[view.id] && !S.mocks[view.id].removed ? S.mocks[view.id] : null;
  // The clock: redraw every second while a section runs; closed sections are caught up on return
  useEffect(() => {
    if (!m || !m.current) return;
    const t = setInterval(() => {
      const before = m.current && m.current.sec;
      KM().catchUp(m, Date.now());
      if (!m.current || m.current.sec !== before) save(m.mock_id); else tick();
    }, 1000);
    return () => clearInterval(t);
  }, [m && m.mock_id, m && m.current && m.current.attempt_id]);
  useEffect(() => { A.mockOpen = null; }, []);

  if (m && m.current) return <Runner m={m} />;
  if (m && view.mode === "results") return <Results m={m} exam={exam} attempt={m.attempts[view.idx == null ? m.attempts.length - 1 : view.idx]} back={() => setView({ id: null })} />;
  return <Library exam={exam} list={list} open={(id, mode, idx) => setView({ id, mode, idx })} />;
}

// A mock exam written in the app (task E3, MOCK-RULES.md): the sections, counts, minutes, options and scoring of the real exam,
// the syllabus topics per section with their page extracts (when they are in the content folder), and the earlier mocks' stems to avoid
function mockRequest(exam, n, list, past) {
  const C = K(), secs = C.EXAMS[exam].sections;
  return {
    exam, examLabel: C.EXAMS[exam].long, id: C.mockId(exam, n), title: C.EXAMS[exam].name + " mock " + n + (past ? " (past paper)" : ""), past: !!past,
    options: exam === "cents" ? 5 : 4, scoring: { correct: 1, wrong: exam === "cents" ? -0.25 : 0, blank: 0 },
    sections: secs.map((s) => ({ section_id: s.id, name: s.name, minutes: s.min, questions: s.q,
      topics: (s.syl || []).reduce((a, bl) => a.concat(bl.rows.filter((r) => r.x[3] !== "opt").map((r) => ({ id: r.x[0], name: r.x[2], extract: r.x[4] && r.x[4].length ? C.etutId(r.x[0]) + ".pdf" : undefined }))), []) })),
    avoid: list.reduce((a, m) => a.concat(((m.package && m.package.sections) || []).reduce((b, sec) => b.concat(sec.questions.map((q) => q.stem)), [])), []).slice(0, 80),
  };
}
function MockJob({ exam, n, list }) {
  const [past, setPast] = useState(false);
  return (
    <>
      <details className="k-panel k-sec" id="mock-job">
        <summary className="k-sec-head"><h2>Write mock {n} in the app</h2></summary>
        <div className="k-row-btns"><button type="button" className="k-btn sm" aria-pressed={!past} onClick={() => setPast(false)}>New questions</button><button type="button" className="k-btn sm" aria-pressed={past} onClick={() => setPast(true)}>From a past paper</button></div>
        <NewJob key={past ? "past" : "new"} kind="mock" needsFiles={past} request={mockRequest(exam, n, list, past)}
          intro={past ? "Choose the official past or sample paper (PDF). It is transcribed into the real format; questions without a key are solved and marked." : "The model you choose writes " + K().EXAMS[exam].sections.reduce((a, s) => a + s.q, 0) + " questions in the real format, section by section, from your syllabus topics and the page extracts in your content folder; every question is then solved again without its key."}
          onCreated={() => App().toast("Prepared. Check the estimate below, then press Start.")} />
      </details>
      <JobsPanel kinds={["mock"]} title="Mock exams being written" />
    </>
  );
}

function Library({ exam, list, open }) {
  const A = App(), C = K(), n = nextNumber(exam);
  const prev = list.map((x) => x.mock_id);
  const secs = C.EXAMS[exam].sections;
  const q = secs.reduce((a, s) => a + s.q, 0), mins = secs.reduce((a, s) => a + s.min, 0);
  const onFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      let pkg; try { pkg = JSON.parse(r.result); } catch (err) { A.toast("Not a JSON file"); return; }
      const res = A.importMockObject(pkg, false);
      if (res.errors && res.errors.length) A.toast("Not loaded: " + res.errors[0]); else App().render();
    };
    r.readAsText(file);
    e.target.value = "";
  };
  return (
    <div className="k-page mock">
      <PageHead title={"Mock exam · " + NAME[exam]} sub={<p className="k-sub">The real format: {secs.length} timed sections, {q} questions, {mins} minutes. Sections run in order; when a section's time is up the next one starts and you cannot go back.{exam === "cents" ? " Scoring +1 / 0 / −0.25, 5 options." : ""}</p>} />
      {jobsAvailable() && <MockJob exam={exam} n={n} list={list} />}
      <Panel title="Mock exams" actions={
        <>
          <AskPair what="writing a mock exam" prompt={C.mockPrompt(exam, n, prev, false)} primary icon={<Exam size={14} aria-hidden="true" />} label={"Write mock " + n + " with Claude"} copyLabel="Copy the mock exam prompt"
            title="Claude Code writes a new mock in the real format from your syllabus topics (MOCK-RULES.md), avoiding earlier mocks' questions." />
          <AskPair what="writing a mock exam" prompt={C.mockPrompt(exam, n, prev, true)} icon={<FileArrowUp size={14} aria-hidden="true" />} label="Past paper with Claude" copyLabel="Copy the past-paper prompt"
            title="Attach an official sample or past paper in Claude Code; it is transcribed into a mock exactly as written." />
          <label className="k-btn sm"><FileArrowUp size={14} aria-hidden="true" /> Load mock.json<input type="file" accept=".json,application/json" hidden onChange={onFile} /></label>
        </>
      }>
        {!list.length && <p className="k-small">No mock exams yet. Write the first one with Claude: it reads your syllabus topics and page extracts and writes mocks/{exam}-mock-1/mock.json, then builds the app.</p>}
        {list.length > 0 && (
          <TableWrap>
            <table className="k-table mock-list">
              <thead><tr><th>Mock</th><th>Kind</th><th className="k-num">Questions</th><th>Attempts</th><th>Last score</th><th /></tr></thead>
              <tbody>
                {list.map((x) => {
                  const last = x.attempts[x.attempts.length - 1], r = last && last.result;
                  return (
                    <tr key={x.mock_id}>
                      <td><b>{x.package.title}</b><div className="k-small k-muted">{x.mock_id}</div></td>
                      <td>{x.package.kind === "past_paper" ? "Past paper" : "Generated"}</td>
                      <td className="k-num">{KM().questionCount(x.package)} · {KM().minutes(x.package)} min</td>
                      <td className="k-num">{x.attempts.length}</td>
                      <td className="k-num">{r ? r.total + " / " + r.max : "–"}</td>
                      <td className="mock-act">
                        <Btn size="sm" kind="primary" onClick={() => { KM().startAttempt(x, Date.now()); save(x.mock_id); open(x.mock_id); }}><Play size={14} weight="fill" aria-hidden="true" /> {x.attempts.length ? "Take again" : "Start"}</Btn>
                        {last && <Btn size="sm" onClick={() => open(x.mock_id, "results")}>Results</Btn>}
                        <ConfirmBtn label={<Trash size={14} aria-hidden="true" />} confirmLabel="Remove?" aria-label={"Remove " + x.package.title} onConfirm={() => { x.removed = true; save(x.mock_id); }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      <Panel title="How it works">
        <ul className="k-small mock-how">
          <li>Before you start, put away notes and phone and allow the full time ({mins} minutes) without breaks, as on exam day.</li>
          <li>Leave a question blank when you would only be guessing between many options{exam === "cents" ? ": a wrong answer costs 0.25 points" : ""}.</li>
          <li>The results show every syllabus topic you missed with its pages. Those topics move to the top of the Overview's Up next.</li>
          <li>Take a new mock with new questions rather than the same one again: repeating a mock measures memory of the questions, not of the topics.</li>
        </ul>
      </Panel>
    </div>
  );
}

function Runner({ m }) {
  const now = Date.now(), pkg = m.package, a = m.current, sec = pkg.sections[a.sec];
  const [qi, setQi] = useState(0);
  const [askEnd, setAskEnd] = useState(false);
  useEffect(() => { setQi(0); setAskEnd(false); }, [a.sec]);
  const left = KM().secondsLeft(m, now);
  const q = sec.questions[Math.min(qi, sec.questions.length - 1)];
  const answered = sec.questions.filter((x) => a.answers[x.q_id] != null).length;
  const pick = (i) => { KM().answer(m, q.q_id, a.answers[q.q_id] === i ? null : i); save(m.mock_id); };
  const flag = () => { a.flags[q.q_id] = !a.flags[q.q_id]; save(m.mock_id); };
  const end = () => { KM().nextSection(m, Date.now()); save(m.mock_id); };
  const last = a.sec === pkg.sections.length - 1;
  return (
    <div className="k-page mock mock-run">
      <div className="mock-bar" role="group" aria-label="Section">
        <span className="mock-sec"><b>{sec.name}</b><span className="k-small">Section {a.sec + 1} of {pkg.sections.length} · {answered} / {sec.questions.length} answered</span></span>
        <span className={"mock-clock k-num" + (left <= 60 ? " low" : "")} role="timer" aria-label="Time left in this section"><Timer size={18} aria-hidden="true" /> {clock(left)}</span>
        {!askEnd
          ? <Btn size="sm" onClick={() => setAskEnd(true)}>{last ? "Finish the exam" : "Finish section"}</Btn>
          : <span className="mock-confirm"><span className="k-small">{last ? "Hand in the exam?" : "You cannot come back to this section."}</span><Btn size="sm" kind="primary" onClick={end}>{last ? "Hand in" : "Go to the next section"}</Btn><Btn size="sm" onClick={() => setAskEnd(false)}>Stay</Btn></span>}
      </div>
      <div className="mock-grid">
        <nav className="mock-nav" aria-label="Questions of this section">
          {sec.questions.map((x, i) => (
            <button key={x.q_id} type="button" aria-current={i === qi ? "true" : undefined} data-a={a.answers[x.q_id] != null ? "1" : undefined} data-f={a.flags[x.q_id] ? "1" : undefined} onClick={() => setQi(i)}>{i + 1}</button>
          ))}
        </nav>
        <Panel className="mock-q">
          {q.passage && <div className="mock-passage"><Md src={q.passage} /></div>}
          <div className="mock-stem"><span className="mock-n">{qi + 1}.</span><Md src={q.stem} /></div>
          <div className="mock-opts" role="radiogroup" aria-label="Options">
            {q.options.map((o, i) => (
              <button key={i} type="button" role="radio" aria-checked={a.answers[q.q_id] === i} onClick={() => pick(i)}>
                <span className="mock-letter">{LETTERS[i]}</span><Md src={o} as="span" />
              </button>
            ))}
          </div>
          <div className="mock-q-foot">
            <Btn size="sm" disabled={qi === 0} onClick={() => setQi(qi - 1)}><ArrowLeft size={14} aria-hidden="true" /> Previous</Btn>
            <Btn size="sm" onClick={flag} aria-pressed={!!a.flags[q.q_id]}><Flag size={14} aria-hidden="true" /> {a.flags[q.q_id] ? "Flagged" : "Flag"}</Btn>
            {a.answers[q.q_id] != null && <Btn size="sm" onClick={() => { KM().answer(m, q.q_id, null); save(m.mock_id); }}>Leave blank</Btn>}
            <Btn size="sm" disabled={qi >= sec.questions.length - 1} onClick={() => setQi(qi + 1)}>Next <ArrowRight size={14} aria-hidden="true" /></Btn>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Results({ m, exam, attempt, back }) {
  const C = K(), pkg = m.package, r = attempt && attempt.result;
  const [showQ, setShowQ] = useState(false);
  if (!r) return <div className="k-page"><Btn onClick={back}>Back</Btn></div>;
  const n = nextNumber(exam), prev = mocksOf(exam).map((x) => x.mock_id);
  const items = Object.keys(r.items).map((id) => ({ id, ...r.items[id], f: C.find(id) })).sort((x, y) => (y.wrong + y.blank) - (x.wrong + x.blank));
  const numOf = {};
  C.EXAMS[exam].sections.forEach((s) => (s.syl || []).forEach((bl) => bl.rows.forEach((row) => { numOf[row.x[0]] = row.num; })));
  return (
    <div className="k-page mock">
      <PageHead title={pkg.title} sub={<p className="k-sub">Results of {new Date(attempt.finished_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>}>
        <Btn onClick={back}><ArrowLeft size={15} aria-hidden="true" /> All mocks</Btn>
      </PageHead>
      <div className="k-kpis">
        <Kpi label="Raw score" value={<>{r.total} <span className="cents-of">/ {r.max}</span></>} sub={exam === "cents" ? "Before CISIA's normalisation" : undefined} />
        <Kpi label="Correct" value={r.correct} />
        <Kpi label="Wrong" value={r.wrong} />
        <Kpi label="Blank" value={r.blank} />
      </div>
      <Panel title="Sections">
        <TableWrap>
          <table className="k-table">
            <thead><tr><th>Section</th><th className="k-num">Score</th><th className="k-num">Correct</th><th className="k-num">Wrong</th><th className="k-num">Blank</th><th className="k-num">Time used</th></tr></thead>
            <tbody>{r.sections.map((s) => (
              <tr key={s.section_id}><td>{s.name}</td><td className="k-num">{s.score} / {s.max}</td><td className="k-num">{s.correct}</td><td className="k-num">{s.wrong}</td><td className="k-num">{s.blank}</td><td className="k-num">{clock(s.seconds)} / {s.minutes}:00</td></tr>
            ))}</tbody>
          </table>
        </TableWrap>
      </Panel>
      <Panel title="Topics" actions={<span className="k-small">Missed topics move up in the Overview's Up next</span>}>
        {!items.length && <p className="k-small">The questions of this mock are not linked to syllabus topics.</p>}
        {items.length > 0 && (
          <TableWrap>
            <table className="k-table">
              <thead><tr><th>Topic</th><th className="k-num">Correct</th><th className="k-num">Wrong</th><th className="k-num">Blank</th><th>Pages</th></tr></thead>
              <tbody>{items.map((it) => {
                const bk = it.f && it.f.book, has = it.f && it.f.item[4].length;
                return (
                  <tr key={it.id} data-bad={it.wrong + it.blank ? "1" : undefined}>
                    <td><span className="cents-code">{numOf[it.id] || ""}</span> {it.f ? it.f.item[2] : it.id}</td>
                    <td className="k-num">{it.correct}</td><td className="k-num">{it.wrong}</td><td className="k-num">{it.blank}</td>
                    <td>{has ? <a href={bk.pdf + "#page=" + it.f.item[4][0][0]} target="_blank" rel="noopener">{(bk.short || bk.name) + " p. " + C.printedText(bk, it.f.item[4])}</a> : "–"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      <Panel title="Next">
        <div className="k-row-btns">
          <AskPair what="writing a mock exam" prompt={C.mockPrompt(exam, n, prev, false)} primary icon={<Exam size={14} aria-hidden="true" />} label={"New-question mock " + n + " with Claude"} copyLabel="Copy the mock exam prompt" />
          <Btn size="sm" onClick={() => setShowQ(!showQ)} aria-pressed={showQ}>{showQ ? "Hide answers" : "Review answers"}</Btn>
        </div>
      </Panel>
      {showQ && pkg.sections.map((s) => (
        <Panel key={s.section_id} title={s.name}>
          {s.questions.map((q, i) => {
            const ans = attempt.answers[q.q_id], st = ans == null ? "blank" : ans === q.correct ? "correct" : "wrong";
            return (
              <div key={q.q_id} className="mock-rev" data-s={st}>
                {q.passage && i > 0 && s.questions[i - 1].passage_id === q.passage_id ? null : q.passage ? <details className="mock-passage"><summary>Text</summary><Md src={q.passage} /></details> : null}
                <div className="mock-stem"><span className="mock-n">{i + 1}.</span><Md src={q.stem} /></div>
                <ol className="mock-rev-opts">
                  {q.options.map((o, oi) => <li key={oi} data-c={oi === q.correct ? "1" : undefined} data-y={oi === ans ? "1" : undefined}><span className="mock-letter">{LETTERS[oi]}</span><Md src={o} as="span" /></li>)}
                </ol>
                <p className="k-small"><b>{st === "correct" ? "Correct." : st === "wrong" ? "Wrong." : "Left blank."}</b> <Md src={q.solution} as="span" /></p>
              </div>
            );
          })}
        </Panel>
      ))}
    </div>
  );
}
