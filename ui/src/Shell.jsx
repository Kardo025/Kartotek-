import React, { useEffect, useReducer, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Cards, BookOpenText, Exam, Stack, GraduationCap, AirplaneTilt, ChartBar, Function as FnIcon, GearSix, Sun, Moon, Monitor, Timer, Graph, ClipboardText,
} from "@phosphor-icons/react";
import { Count, TabEnter, SPRING } from "./motion.jsx";
import Welcome, { welcomeSeen, markWelcomeSeen } from "./Welcome.jsx";
import Review from "./Review.jsx";
import { REACT_TABS } from "./tabs/index.js";
import { openSteps } from "./tabs/Apply.jsx";
import { FirstRun } from "./tabs/DataFiles.jsx";

const PRIMARY = [
  { id: "study", label: "Review", Icon: Cards },
  { id: "etut", label: "Study", Icon: BookOpenText },
  { id: "lesson", label: "End-of-lesson test", Icon: Exam },
  { id: "cards", label: "Cards", Icon: Stack },
];
// The AI Mind Mapping Assistant has its own sidebar section (MINDMAP-RULES.md)
const MIND = [{ id: "mindmaps", label: "Mind maps", Icon: Graph }];
// Each exam has its own section: an overview of its syllabus plus Review, Study and Cards limited to its decks
const EXAM_GROUPS = [
  { id: "cents", label: "CEnT-S", Icon: GraduationCap },
  { id: "tud", label: "TU Delft AE Prep", Icon: AirplaneTilt },
].map((g) => ({
  ...g,
  items: [
    { id: g.id, label: "Overview", Icon: g.Icon },
    { id: g.id + "-study", label: "Review", Icon: Cards },
    { id: g.id + "-etut", label: "Study", Icon: BookOpenText },
    { id: g.id + "-cards", label: "Cards", Icon: Stack },
    { id: g.id + "-mock", label: "Mock exam", Icon: Timer },
  ].concat(g.id === "tud" ? [{ id: "tud-apply", label: "Application", Icon: ClipboardText }] : []),
}));
const EXAM = EXAM_GROUPS.flatMap((g) => g.items);
const SECONDARY = [
  { id: "stats", label: "Stats", Icon: ChartBar },
  { id: "algo", label: "Algorithm", Icon: FnIcon },
  { id: "settings", label: "Settings", Icon: GearSix },
];
const TABS = [...PRIMARY, ...MIND, ...EXAM, ...SECONDARY].map((t) => t.id);

// Redraw whenever the legacy engine renders (every state change and tab switch)
export function useAppVersion() {
  const [v, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => window.App.subscribe(bump), []);
  return v;
}

// "system" (default, follows the OS live), "light" or "dark": see the theme bootstrap in src/index.html
function readTheme() {
  return (window.KartotekTheme && window.KartotekTheme.mode) || "system";
}

function counts() {
  const App = window.App, S = App.S;
  if (!S || !S.cards) return {};
  const due = (opts) => {
    try { const q = window.DSR.buildQueue(S, App.env(Date.now()), opts); return q.counts.learning + q.counts.review + q.counts.fresh; } catch (e) { return null; }
  };
  const etuts = Object.values(S.etuts || {}).filter((e) => e && !e.removed);
  const lessons = Object.values(S.lessons || {}).filter((e) => e && !e.removed).length;
  const out = {
    study: due({ deckId: null }),
    etut: etuts.length || null,
    lesson: lessons || null,
    cards: Object.keys(S.cards).length || null,
    mindmaps: mindCount(App, S),
    "tud-apply": openSteps() || null,
  };
  (App.EXAMS || []).forEach((x) => {
    const decks = App.examDecks(x), set = {};
    decks.forEach((d) => { set[d] = true; });
    out[x + "-study"] = decks.length ? due({ deckIds: decks }) || null : null;
    out[x + "-etut"] = etuts.filter((e) => App.etutInExam(e, x)).length || null;
    out[x + "-cards"] = Object.keys(S.cards).filter((id) => set[S.cards[id].deck_id]).length || null;
    out[x + "-mock"] = Object.values(S.mocks || {}).filter((m) => m && !m.removed && m.package && m.package.exam === x).length || null;
  });
  return out;
}

// Mind maps: open reading questions + proposals waiting for approval
function mindCount(App, S) {
  const K = window.KMind;
  if (!K || !S.mindmaps) return null;
  let n = 0;
  K.list(S).forEach((d) => {
    const p = (App.mindParse || {})[d.map_id];
    if (p) n += K.pendingQuestions(p, d).length;
    n += (d.patches || []).filter((x) => x.status === "proposed").length;
  });
  return n || null;
}

function NavItem({ item, active, badge, onGo, tabIndex, onKeyDown }) {
  const { Icon } = item;
  return (
    <button
      type="button"
      className="k-nav-item"
      aria-current={active ? "page" : undefined}
      onClick={() => onGo(item.id)}
      onKeyDown={onKeyDown}
      data-tab={item.id}
      tabIndex={tabIndex}
    >
      {active && (
        <motion.span
          layoutId="k-nav-active"
          className="k-nav-bg"
          transition={SPRING}
        />
      )}
      <Icon size={19} weight={active ? "fill" : "regular"} aria-hidden="true" />
      <span className="k-nav-label">{item.label}</span>
      {badge != null && <span className="k-badge"><Count value={badge} /></span>}
    </button>
  );
}

export default function Shell() {
  const v = useAppVersion();
  const App = window.App;
  const [booted, setBooted] = useState(false);
  const [theme, setTheme] = useState(readTheme);
  // First-open welcome (design-philosophy.md 8); Settings › "Show welcome" opens it again
  const [welcome, setWelcome] = useState(() => !welcomeSeen());
  useEffect(() => {
    const on = () => setWelcome(true);
    window.addEventListener("kartotek-welcome", on);
    return () => window.removeEventListener("kartotek-welcome", on);
  }, []);
  const closeWelcome = () => { markWelcomeSeen(); setWelcome(false); };

  // Desktop app: first start (or an unreadable data folder) shows the first-run panel; a data folder that cannot be opened stops here
  const [firstRun, setFirstRun] = useState(false);
  const [bootError, setBootError] = useState(null);
  useEffect(() => {
    if (App._reactBooted) return;
    App._reactBooted = true;
    // The packages are read first (the content folder in the desktop app), then the learner data (files in the desktop app),
    // then the app boots on top of them
    window.KHost.ready()
      .then(() => App.store.prepare())
      .then(() => {
        App.boot(); setBooted(true);
        if (App.store.setupPending) setFirstRun(true);
        const d = window.kartotek && window.kartotek.data;
        if (d && d.onFlushRequest) d.onFlushRequest(() => App.store.flushNow());
      })
      .catch((e) => setBootError(String((e && e.message) || e)));
  }, []);

  const tab = App.tab;
  const c = booted ? counts() : {};
  const go = (id) => {
    App.switchTab(id);
    window.scrollTo({ top: 0 });
  };
  const onNavKey = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = TABS.indexOf(e.currentTarget.dataset.tab);
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : TABS.length - 1;
    const next = TABS[(i + d) % TABS.length];
    go(next);
    requestAnimationFrame(() => document.querySelector(`.k-nav-item[data-tab="${next}"]`)?.focus());
  };
  const pickTheme = (t) => {
    setTheme(t);
    if (window.KartotekTheme) window.KartotekTheme.apply(t);
    else document.documentElement.setAttribute("data-theme", t === "system" ? "light" : t);
    try { if (t === "system") localStorage.removeItem("kartotek-theme"); else localStorage.setItem("kartotek-theme", t); } catch (e) { /* ignore */ }
  };
  // The OS switched light/dark while the choice is "system": redraw (charts read the tokens)
  useEffect(() => {
    const on = () => App.render && App.render();
    window.addEventListener("kartotek-theme", on);
    return () => window.removeEventListener("kartotek-theme", on);
  }, []);
  // Each tab's content enters from the direction of travel (design-philosophy.md §6.4)
  const W = (id, el) => (el ? <TabEnter key={id} index={TABS.indexOf(id)}>{el}</TabEnter> : null);

  return (
    <div className="k-shell" data-v={v}>
      <a className="k-skip" href="#main">Skip to content</a>
      <aside className="k-side" aria-label="Kartotek">
        <div className="k-brand">
          <span className="k-logo" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="16" height="16"><rect x="2.5" y="4" width="15" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M2.5 8h15" stroke="currentColor" strokeWidth="1.8" /></svg>
          </span>
          <span>Kartotek</span>
        </div>
        <nav className="k-side-nav" aria-label="Sections">
          {PRIMARY.map((it) => (
            <NavItem key={it.id} item={it} active={tab === it.id} badge={c[it.id]} onGo={go} onKeyDown={onNavKey} tabIndex={tab === it.id ? 0 : -1} />
          ))}
          <div className="k-divider" role="separator" />
          <div className="k-nav-group" id="k-nav-mind">AI Mind Mapping Assistant</div>
          {MIND.map((it) => (
            <NavItem key={it.id} item={it} active={tab === it.id} badge={c[it.id]} onGo={go} onKeyDown={onNavKey} tabIndex={tab === it.id ? 0 : -1} />
          ))}
          <div className="k-divider" role="separator" />
          {EXAM_GROUPS.map((g) => (
            <React.Fragment key={g.id}>
              <div className="k-nav-group" id={"k-nav-" + g.id}>{g.label}</div>
              {g.items.map((it) => (
                <NavItem key={it.id} item={it} active={tab === it.id} badge={c[it.id]} onGo={go} onKeyDown={onNavKey} tabIndex={tab === it.id ? 0 : -1} />
              ))}
              <div className="k-divider" role="separator" />
            </React.Fragment>
          ))}
          {SECONDARY.map((it) => (
            <NavItem key={it.id} item={it} active={tab === it.id} onGo={go} onKeyDown={onNavKey} tabIndex={tab === it.id ? 0 : -1} />
          ))}
        </nav>
        <div className="k-side-foot">
          <button type="button" className="k-status" id="storage-status" data-mode="local" />
          <div className="k-seg" role="group" aria-label="Theme">
            <button type="button" aria-pressed={theme === "system"} aria-label="System theme" title="Follow the system setting" onClick={() => pickTheme("system")}>
              <Monitor size={15} weight="bold" aria-hidden="true" /><span className="k-seg-label">Auto</span>
            </button>
            <button type="button" aria-pressed={theme === "light"} aria-label="Light theme" onClick={() => pickTheme("light")}>
              <Sun size={15} weight="bold" aria-hidden="true" /><span className="k-seg-label">Light</span>
            </button>
            <button type="button" aria-pressed={theme === "dark"} aria-label="Dark theme" onClick={() => pickTheme("dark")}>
              <Moon size={15} weight="bold" aria-hidden="true" /><span className="k-seg-label">Dark</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="k-main" id="main" tabIndex={-1}>
        <div id="sample-banner" className="k-banner">
          <p className="k-banner-text">Sample data loaded: 45 days of review history for the French deck were simulated with a synthetic student. Add your own decks; you can delete the samples at any time.</p>
          <div className="k-banner-actions">
            <button type="button" className="k-btn sm" id="hide-samples">Hide</button>
            <button type="button" className="k-btn sm danger" id="remove-samples">Delete sample decks</button>
          </div>
        </div>
        <section id="tab-study" role="region" aria-label="Review">{W("study", booted && tab === "study" && <Review />)}</section>
        <section id="tab-etut" role="region" aria-label="Study" className={REACT_TABS.etut ? "k-react" : "k-legacy"}>{W("etut", booted && tab === "etut" && REACT_TABS.etut ? React.createElement(REACT_TABS.etut) : null)}</section>
        <section id="tab-lesson" role="region" aria-label="End-of-lesson test" className={REACT_TABS.lesson ? "k-react" : "k-legacy"}>{W("lesson", booted && tab === "lesson" && REACT_TABS.lesson ? React.createElement(REACT_TABS.lesson) : null)}</section>
        <section id="tab-cards" role="region" aria-label="Cards" className={REACT_TABS.cards ? "k-react" : "k-legacy"}>{W("cards", booted && tab === "cards" && REACT_TABS.cards ? React.createElement(REACT_TABS.cards) : null)}</section>
        <section id="tab-mindmaps" role="region" aria-label="AI Mind Mapping Assistant" className="k-react">{W("mindmaps", booted && tab === "mindmaps" ? React.createElement(REACT_TABS.mindmaps) : null)}</section>
        {EXAM_GROUPS.map((g) => (
          <React.Fragment key={g.id}>
            <section id={"tab-" + g.id} role="region" aria-label={g.label} className="k-react">{W(g.id, booted && tab === g.id ? React.createElement(REACT_TABS[g.id]) : null)}</section>
            <section id={"tab-" + g.id + "-study"} role="region" aria-label={g.label + " review"}>{W(g.id + "-study", booted && tab === g.id + "-study" && <Review key={g.id} />)}</section>
            <section id={"tab-" + g.id + "-etut"} role="region" aria-label={g.label + " study"} className="k-react">{W(g.id + "-etut", booted && tab === g.id + "-etut" ? React.createElement(REACT_TABS.etut, { key: g.id }) : null)}</section>
            <section id={"tab-" + g.id + "-cards"} role="region" aria-label={g.label + " cards"} className="k-react">{W(g.id + "-cards", booted && tab === g.id + "-cards" ? React.createElement(REACT_TABS.cards, { key: g.id }) : null)}</section>
            <section id={"tab-" + g.id + "-mock"} role="region" aria-label={g.label + " mock exam"} className="k-react">{W(g.id + "-mock", booted && tab === g.id + "-mock" ? React.createElement(REACT_TABS.mock, { key: g.id, exam: g.id }) : null)}</section>
            {g.id === "tud" && <section id="tab-tud-apply" role="region" aria-label="TU Delft application" className="k-react">{W("tud-apply", booted && tab === "tud-apply" ? React.createElement(REACT_TABS["tud-apply"]) : null)}</section>}
          </React.Fragment>
        ))}
        <section id="tab-stats" role="region" aria-label="Stats" className={REACT_TABS.stats ? "k-react" : "k-legacy"}>{W("stats", booted && tab === "stats" && REACT_TABS.stats ? React.createElement(REACT_TABS.stats) : null)}</section>
        <section id="tab-settings" role="region" aria-label="Settings" className={REACT_TABS.settings ? "k-react" : "k-legacy"}>{W("settings", booted && tab === "settings" && REACT_TABS.settings ? React.createElement(REACT_TABS.settings) : null)}</section>
        <section id="tab-algo" role="region" aria-label="Algorithm" className={REACT_TABS.algo ? "k-react" : "k-legacy"}>{W("algo", booted && tab === "algo" && REACT_TABS.algo ? React.createElement(REACT_TABS.algo) : null)}</section>
      </main>
      <AnimatePresence>{welcome && <Welcome key="welcome" onClose={closeWelcome} />}</AnimatePresence>
      {booted && firstRun && !welcome && <FirstRun onDone={() => { setFirstRun(false); App.render(); }} />}
      {bootError && (
        <div className="df-first" role="alertdialog" aria-modal="true" aria-labelledby="df-boot-title">
          <div className="df-first-card k-panel">
            <h2 id="df-boot-title">Kartotek could not open its data</h2>
            <p>{bootError}</p>
            <p className="k-small k-muted">Nothing was changed. Close any other Kartotek window and start Kartotek again.</p>
          </div>
        </div>
      )}
      <div id="toast" className="toast" role="status" aria-live="polite" hidden />
      <div id="chart-tip" className="chart-tip" hidden />
    </div>
  );
}
