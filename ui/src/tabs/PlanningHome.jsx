// Planning > Home (task D2): one combined timeline. Kartotek's exam dates and pace per exam, the dated rows and open steps of the TU Delft
// Application page, and the programme deadlines read from Euro apply's data file (read only). Each row links to the screen it comes from;
// a TU Delft item that both apps know is shown once and says which app owns it. If Euro apply cannot be read the page still shows
// Kartotek's own rows and says what is missing. The timeline itself is built by ../plan.js.
import React, { useEffect, useState } from "react";
import { ArrowSquareOut, Warning } from "@phosphor-icons/react";
import { PageHead, Panel, Btn, Lvl } from "./kit.jsx";
import { examSummary } from "./Cents.jsx";
import { buildTimeline, formatDay } from "../plan.js";
import "./home.css";

const App = () => window.App;
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthOf = (day) => { const [y, m] = day.split("-"); return MON[Number(m) - 1] + " " + y; };
const WINDOWS = [{ id: "30", label: "30 days", days: 30 }, { id: "90", label: "90 days", days: 90 }, { id: "all", label: "All upcoming", days: null }];
const euroBridge = () => (window.kartotek && window.kartotek.euroapply) || null;
const KIND = { deadline: "deadline", exam: "exam", result: "result", payment: "payment", open: "opens", step: "step", plan: "plan", other: "" };

export default function PlanningHome() {
  const A = App();
  const [euro, setEuro] = useState({ state: "loading" });
  const [win, setWin] = useState(() => { const v = A.pref("kartotek-home-window"); return WINDOWS.find((w) => w.id === v) ? v : "90"; });
  const [showEuro, setShowEuro] = useState(() => A.pref("kartotek-home-euro") !== "0");

  const load = async () => {
    const b = euroBridge();
    if (!b) { setEuro({ state: "browser", why: "Euro apply deadlines are only available in the desktop app." }); return; }
    setEuro({ state: "loading" });
    const r = await b.read();
    const v = r && r.ok ? r.value : null;
    if (v && v.ok) setEuro({ state: "ok", result: v });
    else setEuro({ state: "missing", code: v && v.code, why: (v && v.message) || (r && r.error) || "Euro apply could not be read." });
  };
  useEffect(() => { load(); }, []);

  const pickWin = (id) => { setWin(id); A.setPref("kartotek-home-window", id); };
  const toggleEuro = (on) => { setShowEuro(on); A.setPref("kartotek-home-euro", on ? "1" : "0"); };

  const S = A.S;
  const t = buildTimeline({
    now: Date.now(),
    windowDays: (WINDOWS.find((w) => w.id === win) || WINDOWS[1]).days,
    exams: ["cents", "tud"].map(examSummary),
    plan: window.KHost.exam(),
    ticks: S.tud && S.tud.apply,
    euro: euro.state === "ok" ? euro.result : null,
    euroWhy: euro.why,
    showEuro,
  });
  const missing = euro.state === "loading" ? t.missing.filter((m) => m.what !== "Euro apply deadlines") : t.missing;

  const openEuro = async () => {
    const b = euroBridge();
    if (!b) { A.switchTab("euroapply"); return; }
    const r = await b.open();
    const v = r && r.ok ? r.value : null;
    if (v && v.opened) return;
    A.switchTab("euroapply");
    A.toast(v && v.reason === "not-running" ? "Euro apply is not running: start it here." : "Set up Euro apply first.");
  };
  const go = (row) => (row.link.euro ? openEuro() : A.switchTab(row.link.tab));

  const months = [];
  t.rows.forEach((r) => {
    const m = monthOf(r.day);
    if (!months.length || months[months.length - 1].name !== m) months.push({ name: m, rows: [] });
    months[months.length - 1].rows.push(r);
  });

  // a plain function (not a component), so the list is not remounted on every render
  const renderRow = (r) => {
    const [y, mo, d] = r.day.split("-");
    return (
      <li key={r.uid} className="hm-row" data-src={r.source} data-kind={r.kind} data-overdue={r.overdue ? "1" : undefined}>
        <span className="hm-date k-num"><b>{Number(d)}</b><small>{MON[Number(mo) - 1].slice(0, 3)}{r.time ? " · " + r.time : ""}</small></span>
        <span className="hm-main">
          <b className="hm-title">{r.title}</b>
          {r.detail && <span className="k-small k-muted hm-detail">{r.detail}</span>}
          <span className="hm-chips">
            <span className="hm-chip" data-src={r.source}>{r.owner === "Euro apply" ? "Euro apply" : "Kartotek · " + r.ownerWhere}</span>
            {r.also && <span className="hm-chip hm-also">also on the {r.also.where}</span>}
            {r.est && <span className="hm-chip hm-est">{r.overdue ? "past due" : "estimated"}</span>}
            {KIND[r.kind] ? <span className="hm-chip hm-kind">{KIND[r.kind]}</span> : null}
            {r.checked && <span className="hm-chip hm-kind">checked {formatDay(r.checked) || r.checked}</span>}
          </span>
        </span>
        <span className="hm-links">
          <button type="button" className="hm-link" onClick={() => go(r)}>
            {r.link.euro ? "Open in Euro apply" : "Open " + r.ownerWhere}
          </button>
          {r.also && <button type="button" className="hm-link" onClick={() => A.switchTab(r.also.tab)}>Application page</button>}
          {r.link.url && <a className="hm-link" href={r.link.url} target="_blank" rel="noopener"><ArrowSquareOut size={13} aria-hidden="true" /> Source</a>}
        </span>
      </li>
    );
  };

  return (
    <div className="k-page hm">
      <PageHead title="Home" sub={<p className="k-sub">Your exam dates, application steps and programme deadlines in one list. Each row opens the screen it comes from.</p>} />

      {missing.length > 0 && (
        <Panel title="What is missing" id="home-missing">
          <ul className="hm-missing">
            {missing.map((m) => (
              <li key={m.what}>
                <Lvl level="warn"><Warning size={14} weight="fill" aria-hidden="true" />{m.what}</Lvl>
                <span>{m.why}</span>
                {m.what === "Euro apply deadlines" && euro.state === "missing" && euro.code === "not-set" && <Btn size="sm" onClick={() => A.switchTab("euroapply")}>Set up Euro apply</Btn>}
                {m.what === "Euro apply deadlines" && euro.state === "missing" && euro.code !== "not-set" && <Btn size="sm" onClick={load}>Try again</Btn>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Timeline" id="home-timeline" actions={
        <>
          <div className="k-seg hm-seg" role="group" aria-label="How far ahead">
            {WINDOWS.map((w) => <button key={w.id} type="button" aria-pressed={win === w.id} onClick={() => pickWin(w.id)}>{w.label}</button>)}
          </div>
          <label className="hm-toggle"><input type="checkbox" checked={showEuro} onChange={(e) => toggleEuro(e.target.checked)} /> Euro apply deadlines</label>
        </>
      }>
        {months.length === 0 ? <p className="k-small k-muted">Nothing is due in this time. Try All upcoming.</p> : months.map((m) => (
          <section key={m.name} className="hm-month">
            <h3>{m.name}</h3>
            <ol className="hm-list">{m.rows.map(renderRow)}</ol>
          </section>
        ))}
        {euro.state === "ok" && (
          <p className="k-small k-muted hm-foot">
            Euro apply data from {formatDay(t.euro.updated) || "an unknown date"} · {t.euro.universities} universities with a programme still in play · {t.euro.shown} deadlines in this view. Read only: nothing here changes Euro apply.
          </p>
        )}
      </Panel>

      {t.undated.length > 0 && (
        <Panel title="Without a date" id="home-undated">
          <ol className="hm-list">
            {t.undated.map((r) => (
              <li key={r.uid} className="hm-row" data-src={r.source}>
                <span className="hm-date k-num"><b>–</b></span>
                <span className="hm-main"><b className="hm-title">{r.title}</b>{r.detail && <span className="k-small k-muted hm-detail">{r.detail}</span>}
                  <span className="hm-chips"><span className="hm-chip" data-src={r.source}>Kartotek · {r.ownerWhere}</span></span></span>
                <span className="hm-links"><button type="button" className="hm-link" onClick={() => A.switchTab(r.link.tab)}>Open {r.ownerWhere}</button></span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}
