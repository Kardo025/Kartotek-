import React, { useEffect, useReducer, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Cards, BookOpenText, Exam, Stack, GraduationCap, AirplaneTilt, ChartBar, Function as FnIcon, GearSix, Sun, Moon, Monitor, Timer, Graph, ClipboardText,
  Briefcase, GlobeHemisphereWest, CalendarCheck,
} from "@phosphor-icons/react";
import { Count, TabEnter, SPRING } from "./motion.jsx";
import Welcome, { welcomeSeen, markWelcomeSeen } from "./Welcome.jsx";
import Review from "./Review.jsx";
import { REACT_TABS } from "./tabs/index.js";
import { openSteps } from "./tabs/Apply.jsx";
import { FirstRun } from "./tabs/DataFiles.jsx";
import { EXAMS as EXAM_GROUPS, STUDY_ITEMS, SCOPES, MODES, locate, studyTab, orderOf, visibleTabs } from "./nav.js";

// Two modes (ARCHITECTURE.md section 7, src/nav.js): Study holds what is used while studying, Planning holds the rest.
// Mind maps, Career and the System group are visible in both. The engine's tab ids do not change; nav.js maps them to these places.
const MODE_DEFS = [
  { id: "study", label: "Study", Icon: BookOpenText },
  { id: "planning", label: "Planning", Icon: CalendarCheck },
];
const STUDY_ICONS = { review: Cards, study: BookOpenText, cards: Stack, mock: Timer, lesson: Exam };
const PLANNING_ITEMS = [
  { id: "cents", label: "CEnT-S", Icon: GraduationCap },
  { id: "tud", label: "TU Delft AE Prep", Icon: AirplaneTilt },
  { id: "tud-apply", label: "Application", Icon: ClipboardText },
  { id: "euroapply", label: "Euro apply", Icon: GlobeHemisphereWest },
  { id: "stats", label: "Stats", Icon: ChartBar },
];
// The AI Mind Mapping Assistant has its own sidebar section (MINDMAP-RULES.md), visible in both modes
const MIND = [{ id: "mindmaps", label: "Mind maps", Icon: Graph }];
const CAREER = [{ id: "career", label: "Career", Icon: Briefcase }];
const SYSTEM = [
  { id: "settings", label: "Settings", Icon: GearSix },
  { id: "algo", label: "Algorithm", Icon: FnIcon },
];

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
    mock: Object.values(S.mocks || {}).filter((m) => m && !m.removed && m.package).length || null,
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

  // Mode and scope: derived from the tab (so old tab ids, #hash links and the saved last tab land in the right place) and remembered
  // between sessions for the tabs that have neither (Mind maps, Career, Settings, Algorithm, End-of-lesson test)
  // Before the app has booted, App.tab is only the engine's default: it must neither show nor overwrite the remembered mode and scope
  const at = booted ? locate(tab) : null;
  const [modeMem, setModeMem] = useState(() => (App.pref("kartotek-mode") === "planning" ? "planning" : "study"));
  const [scopeMem, setScopeMem] = useState(() => { const x = App.pref("kartotek-scope"); return x === "cents" || x === "tud" ? x : "all"; });
  const mode = (at && at.mode) || modeMem;
  const scope = at && at.scope !== undefined ? at.scope || "all" : scopeMem;
  useEffect(() => {
    if (!booted || !at) return;
    if (at.mode) {
      if (at.mode !== modeMem) setModeMem(at.mode);
      App.setPref("kartotek-mode", at.mode);
      App.setPref("kartotek-last-" + at.mode, tab);
    }
    if (at.scope !== undefined) {
      const x = at.scope || "all";
      if (x !== scopeMem) setScopeMem(x);
      App.setPref("kartotek-scope", x);
    }
  }, [tab, booted]);
  const pickMode = (m) => {
    if (m === mode) return;
    setModeMem(m); App.setPref("kartotek-mode", m);
    let target = App.pref("kartotek-last-" + m);
    const there = target && locate(target);
    if (!there || there.mode !== m) target = m === "planning" ? "cents" : studyTab("review", scope);
    else if (m === "study" && there.scope !== undefined) target = studyTab(there.item, scope); // a remembered Study tab follows the scope
    go(target);
  };
  const pickScope = (x) => {
    setScopeMem(x); App.setPref("kartotek-scope", x);
    if (at && at.mode === "study" && at.scope !== undefined) go(studyTab(at.item, x));
  };
  const onModeKey = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = MODES[(MODES.indexOf(mode) + (e.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length];
    pickMode(next);
    requestAnimationFrame(() => document.querySelector(`.k-mode button[data-mode="${next}"]`)?.focus());
  };

  // The entries of the current mode; the arrow keys move through them, then Mind maps, Career and System
  const studyItems = STUDY_ITEMS.map((i) => ({ id: studyTab(i.key, scope), key: i.key, label: i.label, Icon: STUDY_ICONS[i.key] }));
  const badgeOf = (id) => c[id === "mock-all" ? "mock" : id];
  const isActive = (item) => (mode === "study" && item.key ? at && at.mode === "study" && at.item === item.key : tab === item.id);
  const listed = visibleTabs(mode, scope);
  const focusId = [...studyItems, ...PLANNING_ITEMS, ...MIND, ...CAREER, ...SYSTEM].find((i) => listed.indexOf(i.id) >= 0 && isActive(i));
  const rovingId = focusId ? focusId.id : listed[0];
  const item = (it) => (
    <NavItem key={it.id} item={it} active={!!isActive(it)} badge={badgeOf(it.id)} onGo={go} onKeyDown={onNavKey} tabIndex={rovingId === it.id ? 0 : -1} />
  );
  const onNavKey = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = listed.indexOf(e.currentTarget.dataset.tab);
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : listed.length - 1;
    const next = listed[(i + d) % listed.length];
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
  const W = (id, el) => (el ? <TabEnter key={id} index={orderOf(id)}>{el}</TabEnter> : null);

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
        <div className="k-mode k-seg" role="group" aria-label="Mode">
          {MODE_DEFS.map((m) => (
            <button key={m.id} type="button" data-mode={m.id} aria-pressed={mode === m.id} tabIndex={mode === m.id ? 0 : -1} onClick={() => pickMode(m.id)} onKeyDown={onModeKey}>
              <m.Icon size={15} weight={mode === m.id ? "fill" : "bold"} aria-hidden="true" /><span>{m.label}</span>
            </button>
          ))}
        </div>
        <nav className="k-side-nav" aria-label="Sections">
          {mode === "study" ? (
            <>
              <label className="k-scope">
                <span className="k-scope-label">Scope</span>
                <select className="k-scope-select" aria-label="Exam scope" value={scope} onChange={(e) => pickScope(e.target.value)}>
                  {SCOPES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </label>
              {studyItems.map(item)}
            </>
          ) : (
            <>
              <div className="k-nav-group" id="k-nav-exams">Exams</div>
              {PLANNING_ITEMS.slice(0, 3).map(item)}
              <div className="k-divider" role="separator" />
              {PLANNING_ITEMS.slice(3).map(item)}
            </>
          )}
          <div className="k-divider" role="separator" />
          <div className="k-nav-group" id="k-nav-mind">AI Mind Mapping Assistant</div>
          {MIND.map(item)}
          <div className="k-divider" role="separator" />
          {CAREER.map(item)}
          <div className="k-divider" role="separator" />
          <div className="k-nav-group" id="k-nav-system">System</div>
          {SYSTEM.map(item)}
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
        <section id="tab-mock-all" role="region" aria-label="Mock exam" className="k-react" hidden={tab !== "mock-all"}>{W("mock-all", booted && tab === "mock-all" ? React.createElement(REACT_TABS["mock-all"]) : null)}</section>
        <section id="tab-career" role="region" aria-label="Career" className="k-react" hidden={tab !== "career"}>{W("career", booted && tab === "career" ? React.createElement(REACT_TABS.career) : null)}</section>
        <section id="tab-euroapply" role="region" aria-label="Euro apply" className="k-react" hidden={tab !== "euroapply"}>{W("euroapply", booted && tab === "euroapply" ? React.createElement(REACT_TABS.euroapply) : null)}</section>
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
