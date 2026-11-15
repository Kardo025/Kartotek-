// Desktop app: learner data in files (task C3, ARCHITECTURE.md section 4).
// - FirstRun: the first start with an empty data folder (or a damaged one): import an old backup file, move the data this window's
//   browser storage holds, or start empty. Nothing is written before the owner chooses.
// - DesktopData: the Data panel in Settings: where the files are, the last save, export and import, and the dated backups with Restore.
// - ImportReport: count before and after for every kind of record. An import is kept only when every count matches and the state read
//   back from the files is identical to the backup (KStore.Store.replaceFromSource); otherwise the previous data stays.
import React, { useEffect, useState } from "react";
import { Check, Warning, X, DownloadSimple, FileArrowUp, FolderOpen, ArrowCounterClockwise, ClockCounterClockwise, Database, FileCsv } from "@phosphor-icons/react";
import { Panel, Btn, Lvl, TableWrap } from "./kit.jsx";
import "./settings.css";

const bridge = () => window.kartotek && window.kartotek.data;
export const isFileMode = () => !!(window.App && window.App.store && window.App.store.mode === "file");

const REASON = {
  daily: "Daily", manual: "Made by you", "before-import": "Before an import", "before-restore": "Before a restore",
  "before-replace": "Before replacing all data", "before-migration": "Before a data migration", "before-update": "Before an update",
};
const reasonText = (r) => REASON[r] || (r.startsWith("imported-") ? "The imported file (copy)" : r);
const fmtBytes = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " kB");
const fmtWhen = (t) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function resetSession(App) { App.session.current = null; App.session.last = null; App.session.undo = []; }

// Replaces the whole state through the checked pipeline, then attaches the content packages as at start-up
export async function runImport(data, opts) {
  const App = window.App;
  const report = await App.store.replaceFromSource(data, opts);
  if (report.ok) {
    const cardsBefore = Object.keys(App.S.cards).length;
    App.importContent();
    report.contentCards = Object.keys(App.S.cards).length - cardsBefore;
    resetSession(App);
  }
  App.render();
  return report;
}

function parseJson(text) { try { return JSON.parse(text); } catch (e) { return null; } }

export function ImportReport({ report, onClose }) {
  if (!report) return null;
  const rows = report.rows || [];
  return (
    <div className={"df-report" + (report.ok ? " is-ok" : " is-bad")} role="region" aria-label="Import report" id="import-report">
      <div className="df-report-head">
        <Lvl level={report.ok ? "ok" : "bad"}>
          {report.ok ? <Check size={14} weight="bold" aria-hidden="true" /> : <Warning size={14} weight="fill" aria-hidden="true" />}
          {report.ok ? "Imported: every count matches and the saved files hold exactly the backup" : "Not imported: " + (report.error || "a check failed") + " Your previous data is unchanged."}
        </Lvl>
        {onClose && <button type="button" className="k-btn sm" onClick={onClose} aria-label="Close the report"><X size={14} aria-hidden="true" /></button>}
      </div>
      {rows.length > 0 && (
        <TableWrap>
          <table className="k-table df-table">
            <thead><tr><th>Record</th><th className="num">In the file</th><th className="num">After import</th><th>Check</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-ok={r.ok ? "1" : "0"}>
                  <td>{r.label}{r.migrated ? <span className="k-small k-muted"> (updated by the migration of an older save)</span> : null}</td>
                  <td className="num">{r.before == null ? "-" : r.before}</td>
                  <td className="num">{r.after == null ? "-" : r.after}</td>
                  <td>{r.ok ? <Check size={14} weight="bold" aria-label="matches" /> : <Warning size={14} weight="fill" aria-label="differs" />}</td>
                </tr>
              ))}
              <tr data-ok={report.identical ? "1" : "0"}>
                <td>Whole saved state compared with the backup</td><td className="num">-</td><td className="num">{report.identical ? "identical" : "differs"}</td>
                <td>{report.identical ? <Check size={14} weight="bold" aria-label="identical" /> : <Warning size={14} weight="fill" aria-label="differs" />}</td>
              </tr>
            </tbody>
          </table>
        </TableWrap>
      )}
      {report.ok && report.contentCards > 0 && <p className="k-small k-muted">After the import, studies in your content folder that the backup did not know yet added {report.contentCards} cards, as at every start.</p>}
      {report.backup && <p className="k-small k-muted">The data that was there before is in the backup “{report.backup}”.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- first start
export function FirstRun({ onDone }) {
  const App = window.App, store = App.store;
  const damaged = store.files && store.files.status === "damaged";
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [backups, setBackups] = useState([]);
  const local = (() => {
    try {
      const raw = window.localStorage.getItem(window.KStore.LOCAL_KEY);
      const data = raw ? JSON.parse(raw) : null;
      const info = window.KStore.inspectBackup(data);
      return info.ok && (info.counts.cards || info.counts.reviews || info.counts.studies) ? { raw, data, info } : null;
    } catch (e) { return null; }
  })();
  useEffect(() => { bridge().listBackups().then((r) => setBackups(r && r.ok ? r.value : [])); }, []);

  const go = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { App.toast(String(e && e.message || e)); } finally { setBusy(false); }
  };
  const importFile = () => go(async () => {
    const r = await bridge().pickImportFile();
    if (!r.ok) { App.toast(r.error); return; }
    if (!r.value) return;
    const data = parseJson(r.value.text);
    const rep = await runImport(data, { reason: "first-import", sourceText: r.value.text, label: r.value.name.replace(/\.json$/i, "") });
    setReport(rep);
  });
  const moveLocal = () => go(async () => {
    const rep = await runImport(local.data, { reason: "first-import", sourceText: local.raw, label: "window-storage" });
    setReport(rep);
  });
  const restore = (id) => go(async () => {
    const r = await bridge().readBackup(id);
    if (!r.ok) { App.toast(r.error); return; }
    setReport(await runImport(parseJson(r.value), { reason: "restore" }));
  });
  const startEmpty = () => go(async () => {
    const rep = await runImport(window.KStore.emptyState(), { reason: "first-start" });
    if (rep.ok) onDone(); else setReport(rep);
  });

  return (
    <div className="df-first" role="dialog" aria-modal="true" aria-labelledby="df-first-title" id="first-run">
      <div className="df-first-card k-panel">
        <h2 id="df-first-title"><Database size={20} aria-hidden="true" /> {damaged ? "Your data folder needs attention" : "Welcome to Kartotek on this PC"}</h2>
        {damaged ? (
          <>
            <p>Kartotek could not read its data files. Nothing was deleted. Restore a dated backup or import a backup file.</p>
            <ul className="df-problems k-small">{(store.files.problems || []).slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}</ul>
          </>
        ) : (
          <p>Kartotek keeps your cards, reviews and progress in files on this PC, with a dated backup every day. Bring your data over from the browser version, or start empty.</p>
        )}
        {report ? (
          <>
            <ImportReport report={report} />
            <div className="k-row-btns">
              {report.ok ? <Btn kind="primary" id="first-run-done" onClick={onDone}>Open Kartotek</Btn> : <Btn id="first-run-back" onClick={() => setReport(null)}>Back</Btn>}
            </div>
          </>
        ) : (
          <div className="df-choices">
            <button type="button" className="df-choice" id="first-import-file" disabled={busy} onClick={importFile}>
              <FileArrowUp size={20} aria-hidden="true" />
              <span><strong>Import a backup file</strong><span className="k-small k-muted">The file “kartotek-backup-….json” from Settings › Data › Export backup in the browser version, also on claude.ai. It is only read.</span></span>
            </button>
            {local && (
              <button type="button" className="df-choice" id="first-move-local" disabled={busy} onClick={moveLocal}>
                <ArrowCounterClockwise size={20} aria-hidden="true" />
                <span><strong>Move the data this window already holds</strong><span className="k-small k-muted">{local.info.counts.cards} cards and {local.info.counts.reviews} reviews from this window’s browser storage. They stay there as well.</span></span>
              </button>
            )}
            {damaged && backups.slice(0, 5).map((b) => (
              <button type="button" className="df-choice" key={b.id} disabled={busy} onClick={() => restore(b.id)}>
                <ClockCounterClockwise size={20} aria-hidden="true" />
                <span><strong>Restore the backup of {fmtWhen(b.at)}</strong><span className="k-small k-muted">{reasonText(b.reason)} · {fmtBytes(b.bytes)}</span></span>
              </button>
            ))}
            {!damaged && (
              <button type="button" className="df-choice" id="first-start-empty" disabled={busy} onClick={startEmpty}>
                <Database size={20} aria-hidden="true" />
                <span><strong>Start empty</strong><span className="k-small k-muted">The studies in your content folder and the samples are there; you can import a backup later in Settings › Data.</span></span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Settings › Data (desktop)
export function DesktopData({ App, S, exportCsv }) {
  const store = App.store;
  const [backups, setBackups] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [staged, setStaged] = useState(null); // { label, data, text, counts, reason, backupId }
  const refresh = async () => {
    const [b, i] = await Promise.all([bridge().listBackups(), bridge().info()]);
    setBackups(b && b.ok ? b.value : []);
    setInfo(i && i.ok ? i.value : null);
  };
  useEffect(() => { refresh(); }, []);

  const stage = (data, extra) => {
    const r = window.KStore.inspectBackup(data);
    if (!r.ok) { App.toast(r.error); return; }
    setReport(null);
    setStaged(Object.assign({ data, counts: r.counts }, extra));
  };
  const pickFile = async () => {
    const r = await bridge().pickImportFile();
    if (!r.ok) { App.toast(r.error); return; }
    if (!r.value) return;
    stage(parseJson(r.value.text), { label: r.value.name, text: r.value.text, reason: "import" });
  };
  const pickBackup = async (b) => {
    const r = await bridge().readBackup(b.id);
    if (!r.ok) { App.toast(r.error); return; }
    stage(parseJson(r.value), { label: "the backup of " + fmtWhen(b.at), reason: "restore", backupId: b.id });
  };
  const confirm = async () => {
    if (!staged || busy) return;
    setBusy(true);
    try {
      const rep = await runImport(staged.data, { reason: staged.reason, sourceText: staged.text || null, label: staged.text ? staged.label.replace(/\.json$/i, "") : null });
      setReport(rep);
      setStaged(null);
      App.toast(rep.ok ? (staged.reason === "restore" ? "Backup restored" : "Backup imported") : "Nothing was changed");
      refresh();
    } finally { setBusy(false); }
  };
  const backupNow = async () => {
    const r = await bridge().backupNow("manual");
    App.toast(r.ok ? "Backup made" : r.error);
    refresh();
  };
  const exportOne = async (b) => {
    const r = await bridge().readBackup(b.id);
    if (r.ok) App.saveFile("kartotek-backup-" + b.id.slice(0, 10) + ".json", r.value);
  };

  const err = store.fileError;
  const lastWrite = store.lastFileWrite || (info && info.writtenAt ? Date.parse(info.writtenAt) : null);
  return (
    <>
      <div className="set-store">
        <Lvl level={err ? "bad" : "ok"}>
          {err ? <Warning size={14} weight="fill" aria-hidden="true" /> : <Check size={14} weight="bold" aria-hidden="true" />}
          {err ? "The last save failed (" + fmtWhen(err.at) + "): " + err.message + ". Kartotek keeps trying." : "Saved" + (lastWrite ? " · " + fmtWhen(lastWrite) : "")}
        </Lvl>
        <span>Your cards, reviews and progress are stored as files on this PC{info ? ": " : "."}{info && <code className="df-path">{info.dataDir}</code>}. There is no size limit. A dated backup is made every day and before every import or restore.</span>
      </div>
      <div className="k-row-btns">
        <Btn kind="primary" id="exp-json" onClick={() => App.exportBackup()}><DownloadSimple size={16} weight="bold" aria-hidden="true" />Export backup (JSON)</Btn>
        <Btn id="exp-csv" onClick={exportCsv}><FileCsv size={16} aria-hidden="true" />Review log (CSV)</Btn>
        <Btn id="imp-json-btn" onClick={pickFile}><FileArrowUp size={16} aria-hidden="true" />Import backup</Btn>
        <Btn id="data-folder" onClick={() => bridge().openFolder("data")}><FolderOpen size={16} aria-hidden="true" />Data folder</Btn>
      </div>
      <p className="k-small k-muted">The exported file is the same backup format as the browser version’s, so either app can import it.</p>
      {staged && (
        <div className="set-import" id="import-staged" role="group" aria-label="Confirm import">
          <p><strong>{staged.label}</strong> holds {staged.counts.cards} cards, {staged.counts.reviews} reviews, {staged.counts.studies} studies, {staged.counts.lessonTests} lesson tests, {staged.counts.mocks} mock exams and {staged.counts.mindMaps} mind maps.</p>
          <p>Your data now: {Object.keys(S.cards).length} cards, {S.reviews.length} reviews. {staged.reason === "restore" ? "Restoring" : "Importing"} replaces all of it; a dated backup of it is made first, and nothing is kept unless every check passes.</p>
          <div className="k-row-btns">
            <Btn kind="primary" id="import-confirm" disabled={busy} onClick={confirm}>{staged.reason === "restore" ? "Back up and restore" : "Back up and import"}</Btn>
            <Btn id="import-cancel" disabled={busy} onClick={() => setStaged(null)}>Cancel</Btn>
          </div>
        </div>
      )}
      <ImportReport report={report} onClose={() => setReport(null)} />
      <div className="df-backups" id="backups">
        <div className="df-backups-head">
          <h3>Backups</h3>
          <div className="k-row-btns">
            <Btn size="sm" id="backup-now" onClick={backupNow}><ClockCounterClockwise size={14} aria-hidden="true" />Back up now</Btn>
            <Btn size="sm" onClick={() => bridge().openFolder("backups")}><FolderOpen size={14} aria-hidden="true" />Show folder</Btn>
          </div>
        </div>
        {backups == null ? <p className="k-small k-muted">Reading…</p> : backups.length === 0 ? <p className="k-small k-muted">No backup yet. The first one is made before the first save of the day.</p> : (
          <TableWrap>
            <table className="k-table df-table">
              <thead><tr><th>When</th><th>Why</th><th className="num">Size</th><th></th></tr></thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtWhen(b.at)}</td>
                    <td>{reasonText(b.reason)}</td>
                    <td className="num">{fmtBytes(b.bytes)}</td>
                    <td className="df-actions">
                      <button type="button" className="k-btn sm" onClick={() => pickBackup(b)} disabled={busy}>Restore…</button>
                      <button type="button" className="k-btn sm" onClick={() => exportOne(b)}>Export</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className="k-small k-muted">Kept: 14 daily, 8 weekly and 12 monthly backups, backups made before an import or restore for 90 days, and always the newest five.</p>
      </div>
    </>
  );
}

