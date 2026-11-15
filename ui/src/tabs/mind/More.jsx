// Reference map (AI-generated, on request, from your sources) and Details (sources, photos, title, remove).
import React, { useState } from "react";
import ModelHint from "../ModelHint.jsx";
import { Robot, Plus, Trash, ArrowsClockwise } from "@phosphor-icons/react";
import { Panel, Btn, Tag, Lvl, ConfirmBtn, Field } from "../kit.jsx";
import { App, KM, save, when, refOf, viewName, setLocalPhoto, DIR_LABEL } from "./util.js";
import { Waiting, makeRequest, Empty } from "./parts.jsx";

export function Reference({ doc, goTab }) {
  const ref = refOf(doc.map_id);
  const [shown, setShown] = useState(false);
  const show = () => {
    doc.exposures.push({ at: Date.now(), kind: "reference", ids: [] });
    save(doc.map_id);
    setShown(true);
  };
  const ask = () => makeRequest(doc, "reference", {}, (rq) => KM().referencePrompt(doc, rq));
  return (
    <div className="mm-col">
      <Panel title="AI reference map">
        <p className="mm-hint">Made by Claude Code from your course sources, only when you ask. It is a study aid: it is not your map, it is never merged into it, and seeing it never counts as learning. Checks you do soon after seeing it are marked with that exposure.</p>
        {!doc.sources.length && <p className="mm-warn">There is no course source yet. Add one in Details; without a source Claude will not invent a reference map.</p>}
        <div className="mm-btnrow">
          <Btn onClick={ask} disabled={!doc.sources.length}><Robot size={15} aria-hidden="true" /> {ref ? "Ask for a new reference map" : "Ask Claude for a reference map"}</Btn>
          <ModelHint what="making a reference map" />
          {!doc.sources.length && <Btn onClick={() => goTab("details")}>Add a source</Btn>}
        </div>
        <Waiting doc={doc} kinds={["reference"]} />
      </Panel>
      {ref && (
        <Panel title={"Reference · " + when(ref.created_at)} actions={<Tag tone="accent">AI-generated</Tag>}>
          {!shown ? (
            <div className="mm-gate">
              <p>Open it only when you want to compare. Opening it is recorded, so a check right after it counts as seen.</p>
              <Btn kind="primary" onClick={show}>Show the reference map</Btn>
            </div>
          ) : <RefBody ref_={ref} />}
        </Panel>
      )}
    </div>
  );
}

function RefBody({ ref_: r }) {
  const lab = (id) => { const k = (r.concepts || []).find((x) => x.id === id); return k ? k.label : id; };
  const src = (id) => { const s = (r.sources || []).find((x) => x.id === id); return s ? s.title || s.path : id; };
  const ev = (list) => (list || []).length ? <span className="mm-muted"> — {list.map((e) => "“" + e.quote + "” (" + src(e.source) + (e.page ? ", p. " + e.page : "") + ")").join("; ")}</span> : null;
  return (
    <div className="mm-ref">
      <b className="mm-sub">Ideas</b>
      <ul className="mm-plain">{(r.concepts || []).map((k) => <li key={k.id}><b>{k.label}</b>{k.definition ? ": " + k.definition : ""}{ev(k.evidence)}</li>)}</ul>
      {(r.groups || []).length > 0 && (<><b className="mm-sub">Groups</b>
        <ul className="mm-plain">{r.groups.map((g) => <li key={g.id}><b>{g.label}</b>{g.criterion ? " (" + g.criterion + ")" : ""}: {(g.members || []).map(lab).join(", ")}</li>)}</ul></>)}
      {(r.relations || []).length > 0 && (<><b className="mm-sub">Connections</b>
        <ul className="mm-plain">{r.relations.map((x) => <li key={x.id}>{lab(x.from)} {DIR_LABEL[x.direction] || "—"} {lab(x.to)}{x.predicate ? " [" + x.predicate + "]" : ""}{(x.conditions || []).length ? " if " + x.conditions.join("; ") : ""}{ev(x.evidence)}</li>)}</ul></>)}
      {r.notes && <p className="mm-hint">{r.notes}</p>}
    </div>
  );
}

export function Details({ doc, parse, onRemoved }) {
  const [meta, setMeta] = useState({ title: doc.title, subject: doc.subject || "", goal: doc.goal || "", language: doc.language || "en" });
  const [src, setSrc] = useState({ title: "", path: "", pages: "" });
  const [nv, setNv] = useState({ role: "detail", name: "" });
  const [why, setWhy] = useState("");
  const pending = (doc.pending_views || []).filter((v) => !(parse && (parse.views || []).some((x) => x.id === v.id)));
  const allViews = (parse ? parse.views : doc.views) || [];
  const nextViewId = () => {
    const used = {};
    allViews.concat(pending).forEach((v) => { used[v.id] = true; });
    for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!used[c]) return c; }
    return "Z" + Date.now().toString(36).slice(-3);
  };
  const corrections = (doc.corrections || []).filter((c) => !c.stale).length;
  const reread = () => makeRequest(doc, "reread", {}, (rq) => KM().rereadPrompt(doc, parse, rq, { views: pending, note: why.trim() }));

  return (
    <div className="mm-col">
      <Panel title="Map details">
        <form className="mm-form" onSubmit={(e) => {
          e.preventDefault();
          Object.assign(doc, { title: meta.title.trim() || doc.title, subject: meta.subject.trim(), goal: meta.goal.trim(), language: meta.language, updated_at: Date.now() });
          save(doc.map_id); App().toast("Saved");
        }}>
          <Field label="Title"><input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></Field>
          <Field label="Subject"><input value={meta.subject} onChange={(e) => setMeta({ ...meta, subject: e.target.value })} /></Field>
          <Field label="Your goal for this map" hint="What you want to be able to explain or do with it." className="mm-span2"><input value={meta.goal} onChange={(e) => setMeta({ ...meta, goal: e.target.value })} /></Field>
          <Field label="Coach language"><select value={meta.language} onChange={(e) => setMeta({ ...meta, language: e.target.value })}><option value="en">English</option><option value="tr">Turkish</option><option value="it">Italian</option></select></Field>
          <div className="mm-btnrow mm-span2"><Btn type="submit" size="sm" kind="primary">Save</Btn><span className="mm-muted">Map id: {doc.map_id} · folder mindmaps\{doc.map_id}\</span></div>
        </form>
      </Panel>

      <Panel title={"Course sources (" + doc.sources.length + ")"}>
        <p className="mm-hint">Without a source the coach gives feedback on structure and wording only and says that facts were not checked. With one, every factual correction quotes it.</p>
        <ul className="mm-plain">
          {doc.sources.map((s) => (
            <li key={s.id} className="mm-oq"><span><Tag>{s.id}</Tag> {s.title || s.path}{s.path ? <span className="mm-muted"> · {s.path}</span> : null}{s.pages ? <span className="mm-muted"> · pages {s.pages}</span> : null}</span>
              <button type="button" className="k-btn sm ghost danger" aria-label={"Remove source " + s.id} onClick={() => { doc.sources = doc.sources.filter((x) => x !== s); save(doc.map_id); }}><Trash size={14} /></button></li>
          ))}
        </ul>
        <form className="mm-addrel" onSubmit={(e) => {
          e.preventDefault();
          if (!src.title.trim() && !src.path.trim()) return;
          let n = 1; while (doc.sources.some((s) => s.id === "s" + n)) n++;
          doc.sources.push({ id: "s" + n, title: src.title.trim(), path: src.path.trim(), pages: src.pages.trim() });
          save(doc.map_id); setSrc({ title: "", path: "", pages: "" });
        }}>
          <input className="k-input" aria-label="Source title" placeholder="Title (e.g. lecture 3 slides)" value={src.title} onChange={(e) => setSrc({ ...src, title: e.target.value })} />
          <input className="k-input" aria-label="Path on your PC" placeholder="Path on your PC (e.g. pdf-extracts\cents-m3.pdf)" value={src.path} onChange={(e) => setSrc({ ...src, path: e.target.value })} />
          <input className="k-input mm-w-s" aria-label="Pages" placeholder="Pages" value={src.pages} onChange={(e) => setSrc({ ...src, pages: e.target.value })} />
          <Btn size="sm" type="submit"><Plus size={14} aria-hidden="true" /> Add source</Btn>
        </form>
      </Panel>

      <Panel title="Photos">
        <ul className="mm-plain">
          {allViews.map((v) => (
            <li key={v.id} className="mm-oq">
              <span><b>{viewName(v)}</b> <span className="mm-muted">{v.file}{v.width ? " · " + v.width + "×" + v.height : ""}</span></span>
              <label className="k-btn sm ghost">Use a photo from this PC for this session<input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && setLocalPhoto(doc.map_id, v.id, e.target.files[0])} /></label>
            </li>
          ))}
          {pending.map((v) => <li key={v.id} className="mm-oq"><span><b>{v.id} · {v.role}</b> <span className="mm-muted">new: “{v.name}” → {v.file} (sent with the next reading)</span></span>
            <button type="button" className="k-btn sm ghost danger" aria-label="Remove new photo" onClick={() => { doc.pending_views = (doc.pending_views || []).filter((x) => x.id !== v.id); save(doc.map_id); }}><Trash size={14} /></button></li>)}
        </ul>
        <form className="mm-addrel" onSubmit={(e) => {
          e.preventDefault();
          if (!nv.name.trim()) { App().toast("Type the photo's file name"); return; }
          const v = { id: nextViewId(), role: nv.role, name: nv.name.trim() };
          v.file = KM().viewFileName(v, v.name);
          // Before the first reading the photo belongs to the reading request itself; afterwards it waits for "Read again"
          if (!parse) doc.views = (doc.views || []).concat([v]);
          else doc.pending_views = (doc.pending_views || []).concat([v]);
          save(doc.map_id); setNv({ role: "detail", name: "" });
        }}>
          <select className="k-input mm-w-s" aria-label="Role" value={nv.role} onChange={(e) => setNv({ ...nv, role: e.target.value })}>{KM().ENUM.role.map((r) => <option key={r} value={r}>{KM().ROLE_LABEL[r]}</option>)}</select>
          <input className="k-input" aria-label="File name" placeholder="File name of the new photo (e.g. IMG_2041.jpg)" value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} />
          <label className="k-btn sm ghost">Choose…<input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && setNv({ ...nv, name: e.target.files[0].name })} /></label>
          <Btn size="sm" type="submit"><Plus size={14} aria-hidden="true" /> Add photo</Btn>
        </form>
      </Panel>

      {parse && (
        <Panel title="Read again">
          <p className="mm-hint">Claude Code reads the photos again with your {corrections} correction(s) and answers (yours win) and any new photos. Your approved map changes are kept and replayed on the new reading.</p>
          <Field label="Why (optional)"><input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. I added a close-up of the cut-off branch" /></Field>
          <div className="mm-btnrow"><Btn onClick={reread}><ArrowsClockwise size={15} aria-hidden="true" /> Prepare “read again”</Btn></div>
          <Waiting doc={doc} kinds={["reread"]} />
        </Panel>
      )}

      <Panel title="Remove">
        <p className="mm-hint">Hides the map in Kartotek. The files in mindmaps\{doc.map_id}\ stay on your PC; review cards made from its checks stay in “Mind maps · {doc.title}”.</p>
        <ConfirmBtn label="Remove this map" onConfirm={() => { doc.removed = true; doc.updated_at = Date.now(); save(doc.map_id); onRemoved(); }} />
      </Panel>
    </div>
  );
}
