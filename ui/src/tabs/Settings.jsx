// Settings tab: retention, exam date, load, steps, prompts, model parameters, personalisation and data (port of App.views.settings)
import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowCounterClockwise, Check, Warning, DownloadSimple, FileCsv, FileArrowUp, Sparkle, Trash, Cloud, X, CalendarBlank,
} from "@phosphor-icons/react";
import { PageHead, Panel, Btn, Field, Lvl, TableWrap, EASE } from "./kit.jsx";
import { ArmBtn, CommitInput, useNativeChange } from "./manage-kit.jsx";
import ContentPanel from "./ContentPanel.jsx";
import ModelsPanel from "./ModelsPanel.jsx";
import { JobsPanel } from "./Jobs.jsx";
import { EuroSettingsPanel } from "./EuroApply.jsx";
import { DesktopData, isFileMode } from "./DataFiles.jsx";
import "./cards.css";
import "./settings.css";

const PRESETS = [
  ["Short quiz tomorrow", 0.93], ["Exam in 2 to 8 weeks", 0.87], ["Ongoing professional knowledge or language", 0.85], ["Critical safety knowledge", 0.94],
];
const PARAM_GROUPS = [
  ["Initial state", ["new_card_difficulty", "new_card_stability_days", "easy_graduating_stability_days", "min_stability_days", "max_stability_days"]],
  ["Success: G = exp(w0 − w1·D − w2·ln(1+S) + w3(1−R) + w4(q−1))", ["w0", "w1", "w2", "w3", "w4"]],
  ["Lapse: S · [f0 − f1(1−R)]", ["f0", "f1"]],
  ["Difficulty update and mean reversion", ["a_r", "a_h", "a_e", "a_t", "mu"]],
  ["Response time", ["easy_slow_ratio_good", "easy_slow_ratio_hard", "idle_response_ms"]],
  ["Interval", ["lambda", "max_fuzz_percent", "critical_target_retention"]],
  ["Priority: P = wr·risk + wo·O + wm·M + we·E + wc·C", ["wr", "wo", "wm", "we", "wc", "exam_horizon_days"]],
  ["Load balancing", ["minimum_safety_retrievability", "max_load_shift_days"]],
];
const PARAM_DOC = {
  new_card_difficulty: "Initial difficulty D₀ of a new card (1 to 10); the target of mean reversion",
  new_card_stability_days: "Initial stability S₀ of a new card (days)",
  easy_graduating_stability_days: "Minimum S when a new card graduates with “Easy” (days)",
  min_stability_days: "Lower bound of S (days)",
  max_stability_days: "Upper bound of S (days)",
  w0: "Base term of growth; the larger it is, the more every success raises S",
  w1: "Difficulty penalty: growth falls as D rises",
  w2: "Saturation: growth falls when S is already large",
  w3: "Reward for success at low R: a hard but successful recall is more informative",
  w4: "Quality effect: Easy (q = 1.3) increases growth, Hard (q = 0.6) decreases it",
  f0: "Share of S kept after a lapse",
  f1: "Extra penalty for forgetting at low R",
  a_r: "D increase on an Again answer",
  a_h: "D increase on a Hard answer",
  a_e: "D decrease on an Easy answer",
  a_t: "D increase per unit of slowness score",
  mu: "Rate at which D returns to D₀ on each review",
  easy_slow_ratio_good: "Easy counts as Good if slower than this multiple of the median",
  easy_slow_ratio_hard: "Easy counts as Hard if slower than this multiple of the median",
  idle_response_ms: "Answers longer than this count as distraction (ms)",
  lambda: "Extra difficulty adjustment of the interval ÷(1 + λD); 0 = off",
  max_fuzz_percent: "Largest random fuzz added to the interval (ratio)",
  critical_target_retention: "Lowest R* for importance-5 cards",
  wr: "Forgetting-risk weight: max(0, R* − R)",
  wo: "Overdue weight: ln(1 + days overdue)",
  wm: "Importance weight: importance / 5",
  we: "Exam-proximity weight",
  wc: "Relearning and consecutive-miss weight",
  exam_horizon_days: "Number of days before the exam when exam priority kicks in",
  minimum_safety_retrievability: "Load balancing never pushes a card below this R",
  max_load_shift_days: "Largest shift in load balancing (days)",
};
const PROMPT_OPTS = [["auto", "Automatic (fades with experience and calibration)"], ["full", "Full"], ["short", "Short"], ["minimal", "Minimal"]];
const CSV_COLS = ["review_id", "card_id", "deck_id", "reviewed_at", "elapsed_days", "predicted_retrievability", "rating", "effective_quality", "recall_result", "response_time_ms", "slow_score", "hint_used", "from_state", "to_state", "old_difficulty", "new_difficulty", "old_stability_days", "new_stability_days", "scheduled_interval_days", "scheduled_due_at", "target_retention", "session_id", "scheduler_version"];

// The storage chip in the sidebar switches here and scrolls to #data-panel. React draws this tab
// a tick after the switch, so remember the click and scroll once the panel exists.
let scrollToData = false;
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const App = window.App;
    if (App && App.tab !== "settings" && e.target && e.target.closest && e.target.closest("#storage-status")) scrollToData = true;
  }, true);
}

function saveSetting(App, k, v) {
  const st = App.S.settings;
  if (k === "exam_date") st[k] = v || null;
  else if (/steps/.test(k)) st[k] = v.split(/[,\s]+/).map(Number).filter((x) => x > 0);
  else if (v !== "" && !isNaN(Number(v))) st[k] = Number(v);
  App.store.commit({ meta: true });
  App.toast("Saved");
  if (k === "exam_date" || k === "exam_target_retention") App.render();
}

// One settings input; remounts when the stored value changes elsewhere (reset, import)
function SetField({ App, k, label, type = "number", ...attrs }) {
  let v = App.S.settings[k];
  if (Array.isArray(v)) v = v.join(", ");
  v = v == null ? "" : String(v);
  return (
    <Field label={label}>
      <CommitInput sync={v} data-set={k} type={type} defaultValue={v} className={type === "number" ? "k-num" : undefined} {...attrs}
        onCommit={(el) => saveSetting(App, k, el.value)} />
    </Field>
  );
}

function Retention({ App, st }) {
  const [r, setR] = useState(st.target_retention_default);
  const ref = useNativeChange((e) => {
    st.target_retention_default = parseFloat(e.target.value);
    App.store.commit({ meta: true });
    App.toast("Saved: R* = " + App.dec(st.target_retention_default, 2));
  });
  const DSR = window.DSR;
  const pctPos = ((r - 0.8) / 0.17) * 100;
  return (
    <Panel title="Target retention R*">
      <div className="set-range">
        <input ref={ref} type="range" id="set-r" min="0.80" max="0.97" step="0.01" value={r} aria-label="Target retention"
          style={{ "--p": pctPos + "%" }} onChange={(e) => setR(parseFloat(e.target.value))} />
        <b className="k-num set-range-val" id="set-r-val">{App.dec(r, 2)}</b>
      </div>
      <div className="set-presets">
        {PRESETS.map(([name, v]) => (
          <Btn key={v} size="sm" data-preset={v} aria-pressed={st.target_retention_default === v}
            onClick={() => { st.target_retention_default = v; App.store.commit({ meta: true }); App.render(); App.toast("R* = " + App.dec(v, 2)); }}>
            {name} <span className="k-num set-preset-v">{App.dec(v, 2)}</span>
          </Btn>
        ))}
      </div>
      <p className="k-small" id="set-r-explain">
        A card with S = 10 days comes back after {App.dec(DSR.intervalForRetention(10, r), 1)} days, a card with S = 30 days after {App.dec(DSR.intervalForRetention(30, r), 1)} days. A lower R* means longer intervals and less load; a higher R* is safer but denser.
      </p>
    </Panel>
  );
}

function Exam({ App, st }) {
  const ex = window.DSR.examTimestamp(st), now = Date.now();
  const info = ex ? (ex > now ? App.dec((ex - now) / window.DSR.DAY, 1) + " days until the exam." : "The exam date has passed; normal scheduling continues.") : "No exam date.";
  return (
    <Panel title="Exam or use date" actions={st.exam_date ? (
      <Btn size="sm" id="clear-exam" onClick={() => { st.exam_date = null; App.store.commit({ meta: true }); App.render(); }}>
        <X size={15} weight="bold" aria-hidden="true" />Remove date
      </Btn>
    ) : null}>
      <div className="set-grid">
        <SetField App={App} k="exam_date" label="Date" type="date" />
        <SetField App={App} k="exam_target_retention" label="Exam-week R*" step="0.01" min="0.8" max="0.99" />
      </div>
      <p className="k-small set-note">
        <CalendarBlank size={15} aria-hidden="true" /> <span><b>{info}</b> In the last 7 days R* is at least {App.dec(st.exam_target_retention, 2)} and the new-card limit is halved; in the last 2 days new cards stop. Intervals never go past the exam day.</span>
      </p>
    </Panel>
  );
}

function Prompts({ App, S, st }) {
  const KMeta = window.KMeta;
  const pl = KMeta.promptLevel(S);
  return (
    <Panel title="Study prompts">
      <Field label="Level of the plan, explanation and journal prompts">
        <select id="set-prompt" value={st.prompt_level || "auto"}
          onChange={(e) => { st.prompt_level = e.target.value; App.store.commit({ meta: true }); App.toast("Saved"); App.render(); }}>
          {PROMPT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <p className="k-small set-now">Now: <b>{KMeta.LEVEL_TR[pl.level]}</b> · {pl.reason}</p>
    </Panel>
  );
}

function Params({ App, S }) {
  const P = S.params;
  return (
    <Panel title="Model parameters θ" actions={
      <ArmBtn id="reset-params" label="Reset to defaults" armedLabel="Reset all θ?"
        onConfirm={() => { S.params = JSON.parse(JSON.stringify(window.DSR.DEFAULT_PARAMS)); App.store.commit({ meta: true }); App.render(); App.toast("Parameters reset to defaults"); }}>
        <ArrowCounterClockwise size={15} weight="bold" aria-hidden="true" />
      </ArmBtn>
    }>
      <div className="set-params">
        {PARAM_GROUPS.map(([title, keys]) => (
          <div className="set-pgroup" key={title}>
            <p className="k-mono set-pgroup-title">{title}</p>
            <div className="set-pgrid">
              {keys.map((k) => (
                <label className="k-field set-param" key={k} title={PARAM_DOC[k] || ""}>
                  <span className="k-field-label k-mono">{k}</span>
                  <CommitInput sync={P[k]} data-param={k} type="number" step="any" defaultValue={P[k]} className="k-num" aria-description={PARAM_DOC[k] || ""}
                    onCommit={(el) => {
                      const v = Number(el.value);
                      if (el.value === "" || isNaN(v) || v < 0) { el.value = P[k]; App.toast("Invalid value"); return; }
                      P[k] = v;
                      App.store.commit({ meta: true });
                      App.toast("Saved: " + k + " = " + App.dec(v, 3));
                    }} />
                </label>
              ))}
              {title === "Interval" && (
                <label className="k-check set-damp">
                  <CommitInput type="checkbox" id="p-damp" defaultChecked={!!P.early_review_damping} syncChecked={!!P.early_review_damping}
                    onCommit={(el) => { P.early_review_damping = el.checked; App.store.commit({ meta: true }); App.toast("Saved"); }} />
                  Early-review damping k = min(1, t/S)
                </label>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FitResult({ App, S, res, onApplied }) {
  const dec = App.dec, DSR = window.DSR;
  if (res.status === "insufficient") {
    return <p className="k-small">The history has {res.n} answers in the review stage; fitting needs at least 100. The global parameters are used for now.</p>;
  }
  const rows = [
    ["Answers in the review stage", res.n, ""],
    ["Personal weight", dec(res.weight, 1), ""],
    ["Log loss · training", dec(res.before.train.ll, 4), dec(res.after.train.ll, 4)],
    ["Log loss · test", dec(res.before.test.ll, 4), dec(res.after.test.ll, 4)],
    ["Brier · test", dec(res.before.test.brier, 4), dec(res.after.test.brier, 4)],
  ];
  const diff = DSR.FIT_KEYS.map((k) => [k, dec(S.params[k], 3), dec(res.params[k], 3)]);
  return (
    <div className="set-fit">
      <div className="k-grid2">
        <TableWrap>
          <table className="k-table"><thead><tr><th>Metric</th><th className="num">Current</th><th className="num">Proposed</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td className="num">{r[1]}</td><td className="num">{r[2]}</td></tr>)}</tbody>
          </table>
        </TableWrap>
        <TableWrap>
          <table className="k-table"><thead><tr><th>θ</th><th className="num">Current</th><th className="num">Proposed</th></tr></thead>
            <tbody>{diff.map((r) => <tr key={r[0]}><td className="k-mono">{r[0]}</td><td className="num">{r[1]}</td><td className="num">{r[2]}</td></tr>)}</tbody>
          </table>
        </TableWrap>
      </div>
      {res.improved ? (
        <div className="set-fit-apply">
          <Btn kind="primary" id="fit-apply" onClick={() => {
            DSR.FIT_KEYS.forEach((k) => { S.params[k] = Math.round(res.params[k] * 10000) / 10000; });
            S.param_history = (S.param_history || []).concat([{ at: Date.now(), n: res.n, test_ll_before: res.before.test.ll, test_ll_after: res.after.test.ll }]);
            App.store.commit({ meta: true });
            App.toast("Personal parameters applied");
            onApplied();
            App.render();
          }}><Check size={16} weight="bold" aria-hidden="true" />Apply the proposed parameters</Btn>
          <span className="k-small k-muted k-num">Test log loss {dec(res.before.test.ll, 4)} → {dec(res.after.test.ll, 4)}</span>
        </div>
      ) : (
        <p className="k-small set-fit-none">No improvement on the test data; the current parameters are kept.</p>
      )}
    </div>
  );
}

function Personalisation({ App, S }) {
  const [fit, setFit] = useState(null); // null | "computing" | result
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <Panel title="Personalisation">
      <p>The review log is replayed with θ = (w0…w4, a_r, a_h, a_e, a_t, f0, f1) and binary cross-entropy is minimised. Temporal split: first 80% training, last 20% test. With fewer than 100 answers in the review stage the global parameters stay; between 100 and 500, personal parameters get a weight of 0.3; above 500, full weight with regularisation towards the defaults. New parameters can be applied only if the test loss drops.</p>
      <div className="k-row-btns">
        <Btn kind="primary" id="fit-run" disabled={fit === "computing"} onClick={() => {
          setFit("computing");
          t.current = setTimeout(() => setFit(window.DSR.fitParams(S.reviews, S.params, window.DSR.DEFAULT_PARAMS)), 30);
        }}><Sparkle size={16} weight="fill" aria-hidden="true" />Learn parameters from my history</Btn>
      </div>
      <div id="fit-out" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {fit === "computing" && (
            <motion.p key="c" className="k-small k-muted set-fit-wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>Computing…</motion.p>
          )}
          {fit && fit !== "computing" && (
            <motion.div key="r" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
              <FitResult App={App} S={S} res={fit} onApplied={() => setFit(null)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Panel>
  );
}

function resetSession(App) { App.session.current = null; App.session.last = null; App.session.undo = []; }

function DataPanel({ App, S }) {
  const ref = useRef(null);
  const fileRef = useRef(null);
  useEffect(() => {
    if (scrollToData && ref.current) { scrollToData = false; ref.current.scrollIntoView({ block: "start" }); }
  }, []);
  const cloud = App.store.mode === "cloud";
  const due = App.backupDue();
  const exportCsv = () => {
    const lines = [CSV_COLS.join(",")].concat(S.reviews.map((e) => CSV_COLS.map((c) => {
      let v = e[c];
      if (c === "reviewed_at" || c === "scheduled_due_at") v = v ? new Date(v).toISOString() : "";
      return v == null ? "" : String(v).replace(/,/g, " ");
    }).join(",")));
    App.saveFile("kartotek-review-log.csv", lines.join("\n"));
  };
  // Importing replaces everything in this browser, so it is two steps: read and show what the file holds, then save a
  // safety copy of the current data and only then replace it. If the safety copy is not saved, nothing is replaced.
  const [staged, setStaged] = useState(null);
  const [busy, setBusy] = useState(false);
  const importJson = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data = null;
      try { data = JSON.parse(reader.result); } catch (err) { /* not JSON */ }
      const info = window.KStore.inspectBackup(data);
      if (!info.ok) { setStaged(null); App.toast(info.error); return; }
      setStaged({ name: file.name, data, info });
    };
    reader.readAsText(file);
  };
  const confirmImport = async () => {
    if (!staged || busy) return;
    setBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const saved = await App.saveFile("kartotek-before-import-" + stamp + ".json", JSON.stringify(App.S));
      if (!saved) { App.toast("Nothing was replaced: the safety copy was not saved"); return; }
      App.store.replaceState(staged.data);
      // Study v2 packages are not in the backup: attach the ones this page carries, as at start-up
      ["importBundledEtuts", "importBundledLessons", "importBundledMocks", "importBundledMindmaps"].forEach((f) => { if (App[f]) App[f](); });
      resetSession(App);
      App.toast("Backup imported: " + Object.keys(App.S.cards).length + " cards");
      setStaged(null);
      App.render();
    } finally { setBusy(false); }
  };
  return (
    <section className="k-panel k-sec set-data" id="data-panel" ref={ref}>
      <div className="k-sec-head"><h2>Data</h2></div>
      {isFileMode() ? <DesktopData App={App} S={S} exportCsv={exportCsv} /> : (<>
      {cloud ? (
        <p className="set-store"><Cloud size={17} aria-hidden="true" /> Data is stored in the private cloud space of your claude.ai account.</p>
      ) : (
        <div className="set-store">
          <Lvl level={due ? "warn" : "ok"}>
            {due ? <Warning size={14} weight="fill" aria-hidden="true" /> : <Check size={14} weight="bold" aria-hidden="true" />}
            Last backup: {App.backupText()}
          </Lvl>
          <span>Your cards and review history are only in this browser. They are lost if browser data is cleared; back up regularly.</span>
          <StorageLine App={App} />
        </div>
      )}
      <div className="k-row-btns">
        <Btn kind="primary" id="exp-json" onClick={() => App.exportBackup()}><DownloadSimple size={16} weight="bold" aria-hidden="true" />Export backup (JSON)</Btn>
        <Btn id="exp-csv" onClick={exportCsv}><FileCsv size={16} aria-hidden="true" />Review log (CSV)</Btn>
        <Btn id="imp-json-btn" onClick={() => fileRef.current && fileRef.current.click()}><FileArrowUp size={16} aria-hidden="true" />Import backup</Btn>
        <input ref={fileRef} type="file" id="imp-json" accept=".json,application/json" hidden onChange={importJson} />
      </div>
      {staged && (
        <div className="set-import" id="import-staged" role="group" aria-label="Confirm import">
          <p><strong>{staged.name}</strong> holds {staged.info.counts.cards} cards, {staged.info.counts.reviews} reviews, {staged.info.counts.studies} studies, {staged.info.counts.lessonTests} lesson tests, {staged.info.counts.mocks} mock exams and {staged.info.counts.mindMaps} mind maps.</p>
          <p>Your data in this browser now: {Object.keys(S.cards).length} cards, {S.reviews.length} reviews. Importing replaces all of it. A safety copy of the current data is saved first.</p>
          <div className="k-row-btns">
            <Btn kind="primary" id="import-confirm" disabled={busy} onClick={confirmImport}>Save safety copy and import</Btn>
            <Btn id="import-cancel" disabled={busy} onClick={() => setStaged(null)}>Cancel</Btn>
          </div>
        </div>
      )}
      </>)}
      <div className="k-row-btns set-danger-row">
        <ArmBtn size="" id="load-sample" label="Reload sample data" armedLabel="Replace current data with the sample?"
          onConfirm={() => { App.store.replaceState(window.KStore.buildSampleState(Date.now())); resetSession(App); App.render(); App.toast("Sample data loaded"); }}>
          <ArrowCounterClockwise size={16} aria-hidden="true" />
        </ArmBtn>
        <ArmBtn size="" kind="danger" id="reset-all" label="Delete all data" armedLabel="Delete all cards and history?"
          onConfirm={() => { App.store.replaceState(window.KStore.emptyState()); resetSession(App); App.render(); App.toast("All data deleted"); }}>
          <Trash size={16} aria-hidden="true" />
        </ArmBtn>
      </div>
      {!isFileMode() && <p className="k-small k-muted">When opened on claude.ai, data is saved to your account’s private cloud space; when opened as a file, it is saved in this browser.</p>}
    </section>
  );
}

export default function SettingsTab() {
  const App = window.App, S = App.S, st = S.settings;
  return (
    <div className="k-page set-page">
      <PageHead title="Settings">
        <button type="button" className="k-btn sm" onClick={() => window.dispatchEvent(new Event("kartotek-welcome"))}>Show welcome</button>
      </PageHead>
      <div className="set-top">
        <Retention key={"r" + st.target_retention_default} App={App} st={st} />
        <Exam App={App} st={st} />
        <Panel title="Daily load">
          <div className="set-grid">
            <SetField App={App} k="daily_review_limit" label="Daily review limit" min="1" />
            <SetField App={App} k="daily_new_card_limit" label="Daily new cards" min="0" />
            <SetField App={App} k="weekend_load_multiplier" label="Weekend multiplier" step="0.1" min="0" />
            <SetField App={App} k="max_session_minutes" label="Session length (min)" min="5" />
            <SetField App={App} k="day_start_hour" label="Day starts at (hour)" min="0" max="23" />
          </div>
        </Panel>
        <Panel title="Steps and limits">
          <div className="set-grid">
            <SetField App={App} k="learning_steps_minutes" label="Learning steps (min)" type="text" />
            <SetField App={App} k="relearning_steps_minutes" label="Relearning steps (min)" type="text" />
            <SetField App={App} k="max_interval_days" label="Longest interval (days)" min="1" />
            <SetField App={App} k="minimum_review_interval_minutes" label="Shortest review (min)" min="1" />
            <SetField App={App} k="learn_ahead_minutes" label="Learn-ahead window (min)" min="0" />
          </div>
        </Panel>
        <Prompts App={App} S={S} st={st} />
      </div>
      <Params App={App} S={S} />
      <Personalisation App={App} S={S} />
      <ModelsPanel />
      <JobsPanel title="Writing jobs" />
      <ContentPanel />
      <EuroSettingsPanel />
      <DataPanel App={App} S={S} />
    </div>
  );
}

// How much of the browser's storage the saved state uses (Edge/Chromium allow about 5.2 million characters per site)
const LOCAL_QUOTA = 5200000;
function StorageLine({ App }) {
  let chars = App.store.localChars;
  if (chars == null) { try { const raw = window.localStorage.getItem(window.KStore.LOCAL_KEY); chars = raw ? raw.length : 0; } catch (e) { chars = null; } }
  const err = App.store.saveError || App.saveError;
  if (chars == null && !err) return null;
  const pct = chars != null ? Math.round((chars / LOCAL_QUOTA) * 100) : null;
  const level = err ? "bad" : pct >= 80 ? "warn" : "ok";
  return (
    <span className="set-storage">
      <Lvl level={level}>
        {err ? "The last save failed (" + new Date(err.at).toLocaleString() + "): the browser's storage is full or blocked. Export a backup now; changes made since then are lost on reload."
          : "Saved data: " + (chars / 1e6).toFixed(2) + " M of about 5.2 M characters this browser allows (" + pct + "%)." + (pct >= 80 ? " Delete studies or lessons you no longer need, or back up and clear old review history." : "")}
      </Lvl>
    </span>
  );
}
