// TU Delft AE Prep › Application: a dated plan with milestones, steps, a document checklist, money, visa, risks, exams and
// open questions. The plan is the learner's own content: <content folder>/exam/tud-apply.json, embedded by build.ps1 as
// #bundled-exam. Without that file the tab shows an empty state. Ticks live in S.tud.apply ({ steps, docs, q }), saved with the rest of the state.
import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, ArrowSquareOut, Warning, CalendarDots } from "@phosphor-icons/react";
import { PageHead, Panel, Kpi, Bar } from "./kit.jsx";
import "./apply.css";

const App = () => window.App;
const DAY = 864e5;

// The plan from the content folder, or null. Shape: title, sub, groups, milestones, steps, docs, costs, visa, risks, questions,
// exams, links, kpis, texts (see docs/ARCHITECTURE once written; the file is the reference).
let planFor = null, planCache = null;
function getPlan() {
  // KHost.exam() is the plan that passed its check (the content folder, or the embedded tag in the browser page)
  const p = window.KHost ? window.KHost.exam() : null;
  if (p !== planFor) {
    planFor = p;
    planCache = p && Array.isArray(p.milestones) ? { steps: [], docs: [], costs: [], visa: [], risks: [], questions: {}, exams: [], links: [], kpis: [], groups: {}, texts: {}, ...p } : null;
  }
  return planCache;
}

const EX_DAY = 86400000;
const atMidnight = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d || 1).getTime(); };
const fmtDay = (iso) => new Date(atMidnight(iso)).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtList = (list) => (list && list.length ? list.map(fmtDay).join(", ") : "-");
// The next exam of a course from now: { iso, days, approx, late } or null
function nextExam(e, now) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const all = [...(e.winter || []), ...(e.summer || [])].map((iso) => ({ iso, late: false }))
    .concat((e.late || []).map((iso) => ({ iso, late: true })));
  const up = all.filter((x) => atMidnight(x.iso) >= t0).sort((a, b) => atMidnight(a.iso) - atMidnight(b.iso))[0];
  if (up) return { ...up, days: Math.round((atMidnight(up.iso) - t0) / EX_DAY), approx: false };
  if (e.month && atMidnight(e.month + "-01") >= t0) return { iso: e.month + "-01", days: Math.round((atMidnight(e.month + "-01") - t0) / EX_DAY), approx: true, late: false };
  return null;
}
// A countdown that ticks at midnight: days (and hours inside the last two days)
function Countdown({ e, texts }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  if (e.none) return <span className="ap-cd" data-k="none">no exam</span>;
  const n = nextExam(e, now);
  if (!n) return <span className="ap-cd" data-k="none">{e.todo ? "date not published" : "no date left"}</span>;
  const when = n.approx ? new Date(atMidnight(n.iso)).toLocaleDateString("en-GB", { month: "long" }) : fmtDay(n.iso);
  const hours = Math.max(0, Math.floor((atMidnight(n.iso) - now) / 3600000));
  const big = n.days === 0 ? "today" : n.days <= 2 && !n.approx ? hours + " h" : (n.approx ? "≈ " : "") + n.days + (n.days === 1 ? " day" : " days");
  return (
    <span className="ap-cd" data-k={n.late ? "late" : n.days <= 14 ? "soon" : n.days <= 45 ? "near" : "far"} title={n.late ? texts.lateTitle : undefined}>
      <b className="k-num">{big}</b><span>{n.approx ? "to " + when : when}{n.late ? " · " + texts.lateLabel : ""}</span>
    </span>
  );
}

const ts = (d) => new Date(d + "T00:00:00").getTime();
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d) => { const x = new Date(d + "T00:00:00"); return x.getDate() + " " + MON[x.getMonth()] + " " + x.getFullYear(); };
const fmtShort = (d) => { const x = new Date(d + "T00:00:00"); return x.getDate() + " " + MON[x.getMonth()]; };
function daysTo(d, today) { return Math.round((ts(d) - today) / DAY); }
function inDays(n) { return n === 0 ? "today" : n > 0 ? "in " + n + (n === 1 ? " day" : " days") : Math.abs(n) + (n === -1 ? " day ago" : " days ago"); }

function applyState() {
  const S = App().S;
  if (!S.tud) S.tud = { sel: window.KCents.TUD_ORDER.slice() };
  if (!S.tud.apply) S.tud.apply = { steps: {}, docs: {}, q: {} };
  ["steps", "docs", "q"].forEach((k) => { if (!S.tud.apply[k]) S.tud.apply[k] = {}; });
  return S.tud.apply;
}
function toggle(kind, key) {
  const a = applyState();
  if (a[kind][key]) delete a[kind][key]; else a[kind][key] = Date.now();
  App().store.commit({ meta: true }); App().render();
}
export function openSteps() {
  try { const P = getPlan(); if (!P) return null; const a = applyState(); return P.steps.filter((s, i) => !a.steps[i]).length; } catch (e) { return null; }
}

function Tick({ on, label, onClick }) {
  return (
    <button type="button" className="ap-tick" aria-pressed={on} aria-label={label} onClick={onClick}>
      {on && <Check size={13} weight="bold" aria-hidden="true" />}
    </button>
  );
}

export default function Apply() {
  const P = getPlan();
  if (!P) {
    return (
      <div className="k-page ap">
        <PageHead title="Application" sub={<p className="k-sub">No application plan is loaded.</p>} />
        <Panel title="Your plan">
          <p className="k-small ap-pad">This tab shows a dated plan (milestones, steps, documents, money, visa, risks, exams and questions) from your own content. Put it in <code>exam/tud-apply.json</code> in your content folder and rebuild. See README.md.</p>
        </Panel>
      </div>
    );
  }
  return <Plan P={P} />;
}

function Plan({ P }) {
  const { milestones: MILESTONES, steps: STEPS, docs: DOCS, costs: COSTS, visa: VISA, risks: RISKS, questions: QUESTIONS, exams: EXAMS, links: LINKS, groups: GROUPS, texts: T } = P;
  const a = applyState();
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const today = now.getTime();
  const [show, setShow] = useState(() => Object.fromEntries(Object.keys(GROUPS).map((g) => [g, true])));
  const [past, setPast] = useState(false);
  const next = MILESTONES.find((m) => ts(m[0]) >= today);
  const rows = MILESTONES.filter((m) => show[m[1]] && (past || ts(m[0]) >= today));
  const stepsDone = STEPS.filter((s, i) => a.steps[i]).length;
  const docsDone = DOCS.filter((d, i) => a.docs[i] || d[3] === "Ready").length;
  const kpi = (d) => { const n = daysTo(d, today); return n >= 0 ? n : 0; };

  return (
    <div className="k-page ap">
      <PageHead title={P.title || "Application"} sub={P.sub ? <p className="k-sub">{P.sub}</p> : null} />

      <div className="k-kpis">
        {(P.kpis || []).map((k) => (
          <Kpi key={k.label} label={k.label}
            value={k.value ? <>{k.value}</> : <>{kpi(k.date)} <span className="ap-of">{k.unit || "days"}</span></>}
            sub={(k.subPrefix || "") + (k.subRelative ? inDays(daysTo(k.date, today)) : k.sub || "")} />
        ))}
        <Kpi label="Steps done" value={<>{stepsDone} <span className="ap-of">/ {STEPS.length}</span></>} sub={docsDone + " / " + DOCS.length + " documents in hand"}><Bar value={stepsDone / STEPS.length} /></Kpi>
      </div>

      {next && (
        <div className="ap-next" data-crit={next[4] === "crit" ? "1" : undefined}>
          <CalendarDots size={18} aria-hidden="true" />
          <span><b>Next: {next[2]}</b> · {fmtDate(next[0])}, {inDays(daysTo(next[0], today))}</span>
          <span className="k-small">{next[3]}</span>
        </div>
      )}

      <Panel title="Timeline" actions={
        <>
          {Object.keys(GROUPS).map((g) => (
            <button key={g} type="button" className="ap-chip" data-tone={GROUPS[g].tone} aria-pressed={show[g]} onClick={() => setShow({ ...show, [g]: !show[g] })}>
              <i aria-hidden="true" />{GROUPS[g].label}
            </button>
          ))}
          <button type="button" className="k-btn sm" aria-pressed={past} onClick={() => setPast(!past)}>Show past</button>
        </>
      }>
        <ol className="ap-tl">
          {rows.map((m, i) => {
            const n = daysTo(m[0], today), isNext = next && m === next;
            return (
              <motion.li key={m[0] + m[2]} className="ap-tl-row" data-tone={GROUPS[m[1]].tone} data-crit={m[4] === "crit" ? "1" : undefined} data-past={n < 0 ? "1" : undefined} data-next={isNext ? "1" : undefined}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(i, 12) * 0.02 }}>
                <span className="ap-tl-date k-num">{m[4] === "approx" ? "≈ " : ""}{fmtShort(m[0])}<small>{m[0].slice(0, 4)}</small></span>
                <span className="ap-tl-dot" aria-hidden="true" />
                <span className="ap-tl-t"><b>{m[2]}</b><span className="k-small">{m[3]}</span></span>
                <span className="ap-tl-g">{GROUPS[m[1]].label}</span>
                <span className="ap-tl-in k-num">{inDays(n)}</span>
              </motion.li>
            );
          })}
          {rows.length === 0 && <li className="k-small ap-empty">Nothing to show with these filters.</li>}
        </ol>
        {T.timelineFoot && <p className="k-small ap-foot">{T.timelineFoot}</p>}
      </Panel>

      <div className="ap-two">
        <Panel title={"Application steps · " + stepsDone + " / " + STEPS.length}>
          <ol className="ap-list">
            {STEPS.map((s, i) => (
              <li key={i} className={"ap-item" + (a.steps[i] ? " done" : "")}>
                <Tick on={!!a.steps[i]} label={(a.steps[i] ? "Mark not done: " : "Mark done: ") + s[1]} onClick={() => toggle("steps", i)} />
                <span className="ap-n k-num">{i + 1}</span>
                <span className="ap-item-t"><b>{s[1]}</b><span className="k-small">{s[2]}</span></span>
                <span className="ap-when">{s[0]}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title={"Documents · " + docsDone + " / " + DOCS.length + " in hand"}>
          {T.docsIntro && <p className="k-small ap-pad">{T.docsIntro}</p>}
          <ol className="ap-list">
            {DOCS.map((d, i) => {
              const ready = d[3] === "Ready", on = ready || !!a.docs[i];
              return (
                <li key={i} className={"ap-item" + (on ? " done" : "")}>
                  <Tick on={on} label={(on ? "Not in hand: " : "In hand: ") + d[0]} onClick={() => !ready && toggle("docs", i)} />
                  <span className="ap-item-t"><b>{d[0]}</b><span className="k-small">{d[1] !== "-" ? d[1] + " · " : ""}{d[2]}</span></span>
                  <span className="ap-when">{d[3]}</span>
                </li>
              );
            })}
          </ol>
        </Panel>
      </div>

      <div className="ap-two">
        <Panel title={T.moneyTitle || "Money"}>
          <table className="ap-table">
            <tbody>
              {COSTS.map((c) => <tr key={c[0]}><td>{c[0]}</td><td className="k-num ap-r">{c[1]}</td><td className="k-small">{c[2]}</td></tr>)}
              {T.moneyTotal && <tr className="ap-total"><td>{T.moneyTotal[0]}</td><td className="k-num ap-r">{T.moneyTotal[1]}</td><td className="k-small">{T.moneyTotal[2]}</td></tr>}
            </tbody>
          </table>
          {T.moneyNote && <p className="k-small ap-pad">{T.moneyNote}</p>}
        </Panel>
        <Panel title={T.visaTitle || "Visa"}>
          <dl className="ap-dl">
            {VISA.map((v) => <React.Fragment key={v[0]}><dt>{v[0]}</dt><dd>{v[1]}</dd></React.Fragment>)}
          </dl>
        </Panel>
      </div>

      <Panel title={T.examsTitle || "Exams"}>
        <table className="ap-table ap-ex">
          <thead><tr><th>Course</th><th className="ap-r">CFU</th><th>{T.examsWinter || "Winter"}</th><th>{T.examsSummer || "Summer"}</th><th>Next exam</th></tr></thead>
          <tbody>{EXAMS.map((e) => (
            <tr key={e.name}>
              <td><b className="ap-course">{e.name}</b>{e.note ? <span className="k-small k-muted ap-note">{e.note}</span> : null}</td>
              <td className="k-num ap-r">{e.cfu}</td>
              <td>{e.none ? <span className="k-muted">{e.none}</span> : e.todo ? <span className="k-muted">-</span> : fmtList(e.winter)}</td>
              <td>{e.none ? null : e.todo ? <span className="k-muted">not published yet</span> : e.month && !(e.summer || []).length ? "June (day tbc)" : fmtList(e.summer)}
                {e.late ? <span className="k-small k-muted ap-note">also {fmtList(e.late)} ({P.texts.lateLabel})</span> : null}</td>
              <td><Countdown e={e} texts={P.texts} /></td>
            </tr>
          ))}</tbody>
        </table>
        {T.examsNote && <p className="k-small ap-pad">{T.examsNote}</p>}
      </Panel>

      <div className="ap-two">
        <Panel title="Risks">
          <ol className="ap-list">
            {RISKS.map((r, i) => (
              <li key={i} className="ap-item ap-risk">
                <span className="ap-lvl" data-l={r[0].toLowerCase()}>{r[0] === "High" ? <Warning size={12} weight="bold" aria-hidden="true" /> : null}{r[0]}</span>
                <span className="ap-item-t"><b>{r[1]}</b><span className="k-small">{r[3]}</span></span>
                <span className="ap-when">{r[2]}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="Open questions">
          {Object.keys(QUESTIONS).map((who) => (
            <div key={who} className="ap-qgroup">
              <h3>Ask {who}</h3>
              <ol className="ap-list">
                {QUESTIONS[who].map((q, i) => {
                  const k = who + ":" + i, on = !!a.q[k];
                  return (
                    <li key={k} className={"ap-item" + (on ? " done" : "")}>
                      <Tick on={on} label={(on ? "Not answered: " : "Answered: ") + q} onClick={() => toggle("q", k)} />
                      <span className="ap-item-t"><span>{q}</span></span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </Panel>
      </div>

      <Panel title="Links">
        <ul className="ap-links">
          {LINKS.map((l) => <li key={l[1]}><a href={l[1]} target="_blank" rel="noopener"><ArrowSquareOut size={14} aria-hidden="true" /> {l[0]}</a></li>)}
        </ul>
        <p className="k-small ap-pad">{T.linksNote || "Ticks on this page are saved with the rest of Kartotek."}</p>
      </Panel>
    </div>
  );
}
