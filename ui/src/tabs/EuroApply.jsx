// Planning > Euro apply (task D2, ARCHITECTURE.md section 8). Euro apply is the owner's separate app: it opens in its own window from
// here, and its folder is a setting. Kartotek never writes into that folder and never runs its code; "Start Euro apply" runs Euro apply's
// own launcher (tools\serve.ps1). Without a folder this page is a short setup row.
import React, { useEffect, useState } from "react";
import { GlobeHemisphereWest, FolderSimple, Play, ArrowSquareOut, Warning, Check, X } from "@phosphor-icons/react";
import { PageHead, Panel, Btn, Lvl } from "./kit.jsx";
import "./home.css";

const bridge = () => (window.kartotek && window.kartotek.euroapply) || null;

// Status of the connection; refresh() reads it again
export function useEuroStatus() {
  const [st, setSt] = useState(null);
  const refresh = async () => {
    const b = bridge();
    if (!b) { setSt({ desktop: false }); return; }
    const r = await b.status();
    setSt(r && r.ok ? Object.assign({ desktop: true }, r.value) : { desktop: true, error: (r && r.error) || "Euro apply status is not available." });
  };
  useEffect(() => { refresh(); }, []);
  return [st, refresh];
}

// Folder setting row (also used in Settings)
export function EuroFolderRow({ st, refresh, compact }) {
  const [msg, setMsg] = useState(null);
  const A = () => window.App;
  const choose = async () => {
    const r = await bridge().chooseFolder();
    const v = r && r.ok ? r.value : null;
    if (v && v.saved) { setMsg(null); A().toast("Euro apply folder saved"); }
    else if (v && v.problems) setMsg(v.problems.join(" "));
    await refresh();
    A().render();
  };
  const clear = async () => { await bridge().clearFolder(); setMsg(null); await refresh(); A().render(); };
  if (!st || !st.desktop) return null;
  return (
    <div className="ea-folder">
      <p className="ea-where">
        {st.configured
          ? <>Euro apply folder: <b className="ea-dir">{st.folder}</b>{st.from && st.from !== "settings" ? <span className="k-muted"> (from {st.from})</span> : null}</>
          : <>No Euro apply folder is set.</>}
      </p>
      {msg && <p className="ea-note"><Lvl level="bad"><Warning size={14} weight="fill" aria-hidden="true" />Not saved</Lvl> {msg}</p>}
      <div className="k-row-btns">
        <Btn size={compact ? "sm" : undefined} id="euro-choose" onClick={choose}><FolderSimple size={16} aria-hidden="true" />{st.configured ? "Change folder" : "Choose folder"}</Btn>
        {st.configured && st.from === "settings" && <Btn size={compact ? "sm" : undefined} id="euro-clear" onClick={clear}><X size={15} weight="bold" aria-hidden="true" />Remove</Btn>}
      </div>
    </div>
  );
}

export default function EuroApplyPage() {
  const [st, refresh] = useEuroStatus();
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const A = () => window.App;
  const act = async (kind) => {
    setBusy(kind); setProblem(null);
    try {
      const r = await bridge()[kind]();
      const v = r && r.ok ? r.value : null;
      if (v && v.opened) A().toast("Euro apply opened in its own window");
      else if (v && v.reason === "not-running") setProblem("Euro apply is not running. Press Start Euro apply.");
      else if (v && v.reason === "start-failed") setProblem(v.error || "Euro apply could not be started.");
      else setProblem((r && r.error) || "Euro apply could not be opened.");
    } finally { setBusy(null); await refresh(); }
  };
  const sub = <p className="k-sub">Your separate application tracker, opened in its own window.</p>;

  if (!st) return <div className="k-page"><PageHead title="Euro apply" sub={sub} /></div>;
  if (!st.desktop) {
    return (
      <div className="k-page">
        <PageHead title="Euro apply" sub={sub} />
        <Panel title="Desktop app only" id="euro-browser">
          <p className="k-small pl-text"><GlobeHemisphereWest size={18} aria-hidden="true" className="pl-icon" />Euro apply opens from the Kartotek desktop app. This page is the browser version, which cannot open another app.</p>
        </Panel>
      </div>
    );
  }
  const ok = st.configured && st.check && st.check.ok;
  return (
    <div className="k-page">
      <PageHead title="Euro apply" sub={sub} />
      {!st.configured && (
        <Panel title="Set up" id="euro-setup">
          <p className="k-small pl-text"><GlobeHemisphereWest size={18} aria-hidden="true" className="pl-icon" />Choose the folder of your Euro apply app (the one with <code>Start-EuroApply.bat</code>) to open it from here. Node.js must be installed, and Euro apply needs its own <code>app\node_modules</code> (start it once with its .bat file).</p>
          <EuroFolderRow st={st} refresh={refresh} />
        </Panel>
      )}
      {st.configured && !ok && (
        <Panel title="This folder cannot be used" id="euro-bad">
          <ul className="ea-list">{st.check.blocking.map((p, i) => <li key={i}>{p}</li>)}</ul>
          <EuroFolderRow st={st} refresh={refresh} />
        </Panel>
      )}
      {ok && (
        <Panel title="Euro apply" id="euro-ready" actions={
          st.serverUp
            ? <Btn kind="primary" size="sm" id="euro-open" disabled={!!busy} onClick={() => act("open")}><ArrowSquareOut size={16} weight="bold" aria-hidden="true" />Open Euro apply</Btn>
            : <Btn kind="primary" size="sm" id="euro-start" disabled={!!busy} onClick={() => act("start")}><Play size={16} weight="fill" aria-hidden="true" />{busy === "start" ? "Starting…" : "Start Euro apply"}</Btn>
        }>
          <p className="ea-status">
            {st.serverUp
              ? <Lvl level="ok"><Check size={14} weight="bold" aria-hidden="true" />Running</Lvl>
              : <Lvl level="warn"><Warning size={14} weight="fill" aria-hidden="true" />Not running</Lvl>}
            <span className="k-muted"> {st.serverUp ? "It answers at " + st.url + " and opens in its own window." : "Start Euro apply runs its own launcher in the background and opens the window when it answers (up to 30 seconds)."}</span>
          </p>
          {problem && <p className="ea-note"><Lvl level="bad"><Warning size={14} weight="fill" aria-hidden="true" />Problem</Lvl> {problem}</p>}
          {st.check.notes.length > 0 && <ul className="ea-list ea-notes">{st.check.notes.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          <EuroFolderRow st={st} refresh={refresh} />
          <p className="k-small k-muted">Kartotek only reads one of Euro apply's data files, <code>data\universities.json</code>, to show its deadlines on the Planning home page. It never writes into that folder.</p>
        </Panel>
      )}
    </div>
  );
}

// Settings panel: where Euro apply lives (desktop app only)
export function EuroSettingsPanel() {
  const [st, refresh] = useEuroStatus();
  if (!st || !st.desktop) return null;
  return (
    <Panel title="Euro apply" id="euro-settings" className="ct">
      <p className="k-small k-muted">The folder of your separate Euro apply app. Planning, Euro apply opens it in its own window; Planning, Home reads its deadlines (one file, read only).</p>
      <EuroFolderRow st={st} refresh={refresh} compact />
      {st.check && st.check.notes && st.check.notes.length > 0 && <ul className="ea-list ea-notes">{st.check.notes.map((p, i) => <li key={i}>{p}</li>)}</ul>}
    </Panel>
  );
}
