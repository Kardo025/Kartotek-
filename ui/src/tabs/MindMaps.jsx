// AI Mind Mapping Assistant (MINDMAP-RULES.md). Kartotek stores and checks; Claude Code on the PC reads the
// handwritten photos and coaches through files in mindmaps/<id>/ (bundled by build.ps1).
import React, { useEffect, useState } from "react";
import { Graph, Plus, ArrowLeft, Camera, Trash, ImageSquare } from "@phosphor-icons/react";
import { PageHead, Panel, Btn, Seg, Tag, Lvl, Field } from "./kit.jsx";
import { App, KM, save, docOf, parseOf, viewSrc, when, setLocalPhoto, viewName, STATUS_LABEL } from "./mind/util.js";
import { Waiting, makeRequest, Empty } from "./mind/parts.jsx";
import Reading from "./mind/Reading.jsx";
import MapList from "./mind/MapList.jsx";
import Coach from "./mind/Coach.jsx";
import Checks, { Runner, startCheck } from "./mind/Checks.jsx";
import { Reference, Details } from "./mind/More.jsx";
import "./mindmap.css";

export default function MindMaps() {
  const A = App();
  const [open, setOpen] = useState(A.mindOpen || null);
  // App.goMind / a #mindmaps/<id> link can ask for a map while this page is already open
  useEffect(() => { if (A.mindOpen) { const id = A.mindOpen; A.mindOpen = null; if (id !== open) setOpen(id); } });
  const doc = open ? docOf(open) : null;
  if (doc) return <MapPage key={doc.map_id} doc={doc} back={() => setOpen(null)} />;
  return <Library open={(id) => { setOpen(id); window.scrollTo({ top: 0 }); }} />;
}

// ------------------------------------------------------------------ list of maps + new map
function Library({ open }) {
  const A = App(), list = KM().list(A.S);
  const [adding, setAdding] = useState(list.length === 0);
  return (
    <div className="k-page mm-page">
      <PageHead title="AI Mind Mapping Assistant" sub={<p className="k-muted mm-sub-head">Photograph a mind map you drew by hand. Claude Code reads it on your PC, you check the reading, then work on it one step at a time and test yourself with the map hidden.</p>}>
        <Btn kind="primary" onClick={() => setAdding(!adding)} aria-expanded={adding}><Plus size={16} aria-hidden="true" /> New map</Btn>
      </PageHead>
      {(A.mindProblems || []).length > 0 && (
        <p className="mm-warn">Some files from Claude Code could not be loaded: {A.mindProblems.join(" · ")}. Run <code>python tools\check-mindmap.py mindmaps\&lt;id&gt;</code> to see why.</p>
      )}
      {adding && <NewMap onDone={(id) => { setAdding(false); open(id); }} />}
      {list.length > 0 && (
        <div className="mm-cards">
          {list.map((d) => <MapCard key={d.map_id} doc={d} onOpen={() => open(d.map_id)} />)}
        </div>
      )}
      <HowItWorks />
    </div>
  );
}

function MapCard({ doc, onOpen }) {
  const parse = parseOf(doc.map_id);
  const map = KM().currentMap(doc);
  const rep = parse ? KM().scopeReport(parse, doc) : null;
  const first = parse ? (parse.views || []).slice().sort((a, b) => a.order - b.order)[0] : doc.views[0];
  const waiting = doc.requests.filter((r) => r.status === "waiting").length;
  const proposals = doc.patches.filter((p) => p.status === "proposed").length;
  const [noImg, setNoImg] = useState(false);
  return (
    <button type="button" className="mm-card" onClick={onOpen}>
      <span className="mm-card-img">
        {first && !noImg ? <img src={viewSrc(doc, first)} alt="" onError={() => setNoImg(true)} /> : <ImageSquare size={30} aria-hidden="true" />}
      </span>
      <span className="mm-card-body">
        <b>{doc.title}</b>
        <span className="mm-muted">{doc.subject || "No subject"} · {parse ? (parse.views || []).length + " photos" : "not read yet"}</span>
        <span className="mm-mark-tags">
          {parse ? <Tag>{map.concepts.length} ideas · {map.relations.length} connections</Tag> : <Lvl level="warn">waiting for the reading</Lvl>}
          {rep && rep.questions.length > 0 && <Lvl level="warn">{rep.questions.length} question{rep.questions.length > 1 ? "s" : ""}</Lvl>}
          {proposals > 0 && <Lvl level="mid">{proposals} proposal{proposals > 1 ? "s" : ""}</Lvl>}
          {waiting > 0 && <Tag>{waiting} waiting for Claude</Tag>}
        </span>
        <span className="mm-muted">Updated {when(doc.updated_at)}</span>
      </span>
    </button>
  );
}

const ROLES = ["overview", "center", "right", "left", "detail", "other"];
function NewMap({ onDone }) {
  const A = App();
  const [f, setF] = useState({ title: "", subject: "", language: "en", goal: "" });
  const [views, setViews] = useState([{ role: "overview", name: "" }]);
  const [src, setSrc] = useState({ title: "", path: "", pages: "" });
  const setView = (i, k, v) => setViews(views.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const create = (e) => {
    e.preventDefault();
    if (!f.title.trim()) { A.toast("Give the map a title"); return; }
    const named = views.filter((v) => v.name.trim());
    if (!named.length) { A.toast("Name at least one photo (the file name on your PC)"); return; }
    const S = A.S, id = KM().newMapId(S, f.title), now = Date.now();
    const vs = named.map((v, i) => {
      const x = { id: String.fromCharCode(65 + i), role: v.role, name: v.name.trim() };
      x.file = KM().viewFileName(x, x.name);
      return x;
    });
    const sources = src.title.trim() || src.path.trim() ? [{ id: "s1", title: src.title.trim(), path: src.path.trim(), pages: src.pages.trim() }] : [];
    const doc = KM().ensure(S, id, { title: f.title.trim(), subject: f.subject.trim(), language: f.language, goal: f.goal.trim(), views: vs, sources }, now);
    named.forEach((v, i) => { if (v.file) setLocalPhoto(id, vs[i].id, v.file); });
    makeRequest(doc, "read", {}, (rq) => KM().readPrompt(doc, rq));
    save(id);
    onDone(id);
  };
  return (
    <Panel title="New map" className="mm-new">
      <form onSubmit={create} className="mm-form">
        <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Computer science basics" /></Field>
        <Field label="Subject"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. Computer science" /></Field>
        <Field label="Your goal (optional)" className="mm-span2"><input value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder="What you want to be able to explain or do" /></Field>
        <Field label="Coach language"><select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="en">English</option><option value="tr">Turkish</option><option value="it">Italian</option></select></Field>
        <div className="mm-span2">
          <b className="mm-sub">Photos of one map, in your order</b>
          <p className="mm-hint">An overview of the whole page plus close-ups of the parts with small writing works best. Type the file name as it is on your PC (or choose it), Claude Code finds and copies it into the map's folder. Photos never leave your PC.</p>
          {views.map((v, i) => (
            <div className="mm-viewrow" key={i}>
              <span className="mm-viewid">{String.fromCharCode(65 + i)}</span>
              <select className="k-input mm-w-s" aria-label={"Role of photo " + (i + 1)} value={v.role} onChange={(e) => setView(i, "role", e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{KM().ROLE_LABEL[r]}</option>)}</select>
              <input className="k-input" aria-label={"File name of photo " + (i + 1)} placeholder="File name, e.g. WhatsApp Image 2026-10-06 at 17.35.30.jpeg" value={v.name} onChange={(e) => setView(i, "name", e.target.value)} />
              <label className="k-btn sm"><Camera size={14} aria-hidden="true" /> Choose<input type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files[0]; if (file) setViews(views.map((x, j) => (j === i ? { ...x, name: file.name, file } : x))); }} /></label>
              {views.length > 1 && <button type="button" className="k-btn sm ghost" aria-label="Remove this photo" onClick={() => setViews(views.filter((_, j) => j !== i))}><Trash size={14} /></button>}
            </div>
          ))}
          <Btn size="sm" onClick={() => setViews(views.concat([{ role: views.length === 0 ? "overview" : ["center", "right", "left"][views.length - 1] || "detail", name: "" }]))}><Plus size={14} aria-hidden="true" /> Add a photo</Btn>
        </div>
        <div className="mm-span2">
          <b className="mm-sub">Course source (optional)</b>
          <p className="mm-hint">Needed only if you want facts checked. More can be added later.</p>
          <div className="mm-addrel">
            <input className="k-input" aria-label="Source title" placeholder="Title" value={src.title} onChange={(e) => setSrc({ ...src, title: e.target.value })} />
            <input className="k-input" aria-label="Path on your PC" placeholder="Path on your PC" value={src.path} onChange={(e) => setSrc({ ...src, path: e.target.value })} />
            <input className="k-input mm-w-s" aria-label="Pages" placeholder="Pages" value={src.pages} onChange={(e) => setSrc({ ...src, pages: e.target.value })} />
          </div>
        </div>
        <div className="mm-btnrow mm-span2"><Btn kind="primary" type="submit">Create and prepare the reading</Btn></div>
      </form>
    </Panel>
  );
}

function HowItWorks() {
  return (
    <Panel title="How it works" className="mm-how">
      <ol className="mm-steps">
        <li><b>Photograph</b><span>One overview and close-ups of the same paper. Your colors carry no fixed meaning here: they are kept as they are and never read as groups, mistakes or mood.</span></li>
        <li><b>Claude Code reads</b><span>It writes what it sees with a box for every word and line, keeps unreadable parts unresolved and asks only what changes the feedback.</span></li>
        <li><b>You check the reading</b><span>Fix a word, an arrow or a crossing. These fixes are about what you wrote, never counted as learning.</span></li>
        <li><b>Coach and checks</b><span>One step at a time on a part you choose. Changes to your map are proposals you approve. Checks hide the map; only unassisted answers reach your reviews.</span></li>
      </ol>
    </Panel>
  );
}

// ------------------------------------------------------------------ one map
const TABS = [
  { value: "reading", label: "Reading" }, { value: "map", label: "Map" }, { value: "coach", label: "Coach" },
  { value: "checks", label: "Checks" }, { value: "reference", label: "Reference" }, { value: "details", label: "Details" },
];
function MapPage({ doc, back }) {
  const A = App();
  const parse = parseOf(doc.map_id);
  const [tab, setTab] = useState(parse ? "reading" : "details");
  const [sel, setSel] = useState(null);
  const [run, setRun] = useState(null);
  const attempt = run && doc.attempts.find((a) => a.id === run);
  // When the map was last on screen (stored on a check as context; viewing never counts as learning)
  useEffect(() => {
    if (!attempt && (tab === "reading" || tab === "map")) { A.mindSeen = A.mindSeen || {}; A.mindSeen[doc.map_id] = Date.now(); }
  });
  if (attempt) return <div className="k-page mm-page"><Runner doc={doc} attempt={attempt} onClose={() => setRun(null)} /></div>;

  const map = KM().currentMap(doc), v = KM().currentVersion(doc);
  const rep = parse ? KM().scopeReport(parse, doc) : null;
  const proposals = doc.patches.filter((p) => p.status === "proposed").length;
  const onCheck = (kind, id) => {
    const t = KM().makeTarget(doc, kind, id, Date.now());
    if (!t) return;
    save(doc.map_id);
    setTab("checks");
    A.toast("Check added. It works best later, once the map is out of mind.");
  };
  const tabs = TABS.map((t) => ({
    value: t.value,
    label: t.label + (t.value === "reading" && rep && rep.questions.length ? " · " + rep.questions.length : t.value === "map" && proposals ? " · " + proposals : ""),
  }));
  return (
    <div className="k-page mm-page">
      <PageHead title={doc.title} sub={
        <div className="mm-mark-tags mm-head-tags">
          <button type="button" className="k-btn sm ghost mm-back" onClick={back}><ArrowLeft size={14} aria-hidden="true" /> All maps</button>
          {doc.subject && <Tag>{doc.subject}</Tag>}
          {doc.study && <button type="button" className="k-btn sm ghost" onClick={() => { A.etutOpen = doc.study.etut_id; A.switchTab("etut"); }}>From a study · back to it</button>}
          {parse ? <Tag>reading {parse.parse_rev} · {(parse.views || []).length} photos</Tag> : <Lvl level="warn">not read yet</Lvl>}
          {parse && <Tag>map v{v} · {map.concepts.length} ideas · {map.relations.length} connections</Tag>}
          {rep && <Lvl level={rep.status === "ready_for_requested_scope" ? "ok" : "warn"}>{STATUS_LABEL[rep.status] || rep.status}</Lvl>}
          {!doc.sources.length && <Tag>no course source: facts not checked</Tag>}
        </div>
      } />
      <Waiting doc={doc} kinds={["read", "reread"]} compact={!!parse} />
      {!parse ? (
        <NotRead doc={doc} onDetails={() => setTab("details")} tab={tab} />
      ) : (
        <>
          <div className="mm-tabs"><Seg label="Map sections" value={tab} onChange={(t) => { setTab(t); setSel(null); }} options={tabs} /></div>
          {tab === "reading" && <Reading doc={doc} parse={parse} sel={sel} setSel={setSel} />}
          {tab === "map" && <MapList doc={doc} parse={parse} onCheck={onCheck} />}
          {tab === "coach" && <Coach doc={doc} parse={parse} goTab={setTab} onStartTarget={(id) => { const a = startCheck(doc, id); if (a) setRun(a); }} />}
          {tab === "checks" && <Checks doc={doc} onRun={setRun} />}
          {tab === "reference" && <Reference doc={doc} goTab={setTab} />}
          {tab === "details" && <Details doc={doc} parse={parse} onRemoved={back} />}
        </>
      )}
    </div>
  );
}

function NotRead({ doc, onDetails, tab }) {
  const waiting = doc.requests.some((r) => r.status === "waiting" && r.kind === "read");
  return (
    <>
      <Panel title="Waiting for the reading">
        <p className="mm-hint">Kartotek cannot read handwriting itself. Open the prepared prompt in Claude Code (it runs in your Kartotek folder), press Enter, and when it says it has built the app, reload Kartotek.</p>
        {!waiting && (
          <div className="mm-btnrow">
            <Btn kind="primary" onClick={() => makeRequest(doc, "read", {}, (rq) => KM().readPrompt(doc, rq))}>Prepare the reading prompt</Btn>
          </div>
        )}
        <div className="mm-thumbs">
          {doc.views.map((v) => (
            <figure key={v.id} className="mm-thumb">
              <img src={viewSrc(doc, v)} alt={"Photo " + viewName(v)} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              <figcaption>{viewName(v)} · {v.name}</figcaption>
            </figure>
          ))}
        </div>
      </Panel>
      <Details doc={doc} parse={null} onRemoved={() => App().render()} />
    </>
  );
}
