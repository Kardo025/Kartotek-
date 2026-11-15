// Content: where the studies, tests, mock exams and mind maps come from, a "Reload content" button, and the "Content problems" list.
// The packages are read by src/host.js (KHost): from the content folder in the desktop app, from the page in the browser build.
// A package that fails its checks is listed here with its errors; it never reaches the saved state and never breaks the app.
import React, { useState } from "react";
import { ArrowClockwise, FolderOpen, FolderSimple, Warning, Check } from "@phosphor-icons/react";
import { Panel, Btn, Lvl } from "./kit.jsx";
import "./settings.css";

const SOURCE_TEXT = { settings: "chosen in this app", KARTOTEK_CONTENT: "from the KARTOTEK_CONTENT variable", "kartotek.config.json": "from kartotek.config.json", default: "the default folder in Documents", page: "built into this page" };

// The reload action, shared with the Study library
export function useReload() {
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    if (busy) return;
    setBusy(true);
    try { await window.App.reloadContent(); } finally { setBusy(false); }
  };
  return { busy, reload };
}

export function ReloadButton({ size }) {
  const { busy, reload } = useReload();
  const info = window.KHost.info();
  return (
    <Btn size={size} id="reload-content" disabled={busy} onClick={reload} title={info.desktop ? "Read the content folder again" : "Read the packages built into this page again"}>
      <ArrowClockwise size={16} weight="bold" aria-hidden="true" />Reload content
    </Btn>
  );
}

const LEVEL = { error: ["bad", "Error"], warning: ["warn", "Warning"] };

function Problem({ p }) {
  const [tone, label] = LEVEL[p.level] || LEVEL.error;
  const shown = p.messages.slice(0, 40);
  return (
    <li className="ct-problem" data-level={p.level}>
      <details>
        <summary>
          <Lvl level={tone}>{p.label || label}</Lvl>
          <span className="ct-kind">{p.kind}{p.id ? " · " + p.id : ""}</span>
          <span className="ct-first">{p.messages[0]}{p.messages.length > 1 ? " (+" + (p.messages.length - 1) + " more)" : ""}</span>
        </summary>
        {p.path && <p className="ct-path k-small">{p.path}</p>}
        <ul className="ct-msgs">{shown.map((m, i) => <li key={i}>{m}</li>)}{p.messages.length > shown.length && <li>… and {p.messages.length - shown.length} more</li>}</ul>
      </details>
    </li>
  );
}

export default function ContentPanel() {
  const K = window.KHost, App = window.App;
  const info = K.info(), problems = K.problems();
  const c = info.counts;
  const act = async (fn, after) => {
    const r = await fn();
    if (r && r.ok === false && r.error) App.toast(r.error);
    if (after) await after(r);
  };
  const choose = () => act(() => K.chooseFolder(), async (r) => { if (r && r.ok && r.value && r.value.changed) await App.reloadContent(); });
  const where = info.contentDir
    ? <>Content folder: <b className="ct-dir">{info.contentDir}</b> <span className="k-muted">({SOURCE_TEXT[info.contentFrom] || info.contentFrom})</span></>
    : <>No content folder is set: only the built-in samples are shown.</>;
  const errors = problems.filter((p) => p.level === "error"), warnings = problems.filter((p) => p.level === "warning");
  return (
    <Panel title="Content" id="content-panel" className="ct" actions={
      <>
        <ReloadButton size="sm" />
        {info.desktop && <Btn size="sm" id="choose-content" onClick={choose}><FolderSimple size={16} aria-hidden="true" />Choose folder</Btn>}
        {info.desktop && info.contentDir && <Btn size="sm" id="open-content" onClick={() => act(() => K.openFolder())}><FolderOpen size={16} aria-hidden="true" />Open folder</Btn>}
      </>
    }>
      <p className="ct-where">{where}</p>
      {info.missingDir && <p className="ct-note"><Lvl level="warn"><Warning size={14} weight="fill" aria-hidden="true" />Not found</Lvl> The configured folder {info.missingDir} does not exist.</p>}
      {info.changedOnDisk && <p className="ct-note"><Lvl level="warn"><Warning size={14} weight="fill" aria-hidden="true" />Changed</Lvl> The content folder changed on disk. Press <b>Reload content</b> when you are ready.</p>}
      <p className="k-small k-muted ct-counts">
        {c.studies} studies · {c.extras} study extras · {c.lessons} lesson tests · {c.mocks} mock exams · {c.mindMaps} mind maps{c.exam ? " · exam plan" : ""}
        {!info.desktop && " · built into this page: rebuild with build.ps1 to change them"}
      </p>
      <h3 className="ct-h">Content problems</h3>
      {problems.length === 0 ? (
        <p className="ct-ok"><Lvl level="ok"><Check size={14} weight="bold" aria-hidden="true" />None</Lvl> Every package passed its checks.</p>
      ) : (
        <>
          <p className="k-small k-muted">{errors.length} not loaded{warnings.length ? ", " + warnings.length + " with warnings" : ""}. A package with an error is left out; your saved cards, progress and history are not touched.</p>
          <ul className="ct-list" id="content-problems">{problems.map((p, i) => <Problem key={i} p={p} />)}</ul>
        </>
      )}
    </Panel>
  );
}
