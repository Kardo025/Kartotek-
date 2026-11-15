// Map: your learner map as an editable text list (works without the photos), AI proposals to approve or reject,
// and the version history. Every change makes a new version; nothing here is a learning event.
import React, { useState } from "react";
import { Plus, Trash, PencilSimple, ClockCounterClockwise, CheckCircle, XCircle, Target } from "@phosphor-icons/react";
import { Panel, Btn, Tag, Lvl, TableWrap } from "../kit.jsx";
import { App, KM, save, when, SOURCE_LABEL, DIR_LABEL } from "./util.js";
import { Empty } from "./parts.jsx";

const TYPES = ["custom", "causes", "influences", "requires", "precedes", "part_of", "example_of", "contrasts_with", "associated_with", "supports", "inhibits", "explains"];
const DIRS = [["forward", "→ one way"], ["bidirectional", "↔ both ways"], ["undirected", "— no direction"], ["unknown", "? unknown"]];
const EMPH = [["", "not set"], ["backbone", "backbone"], ["secondary", "secondary"], ["detail", "detail"]];
const BY = { learner: "You", agent: "AI (approved)", source_import: "Source", instructor: "Instructor" };

function commit(doc, ops, note) {
  const r = KM().commitOps(doc, ops, { source: "learner_edit", actor: "learner", note: note }, Date.now());
  if (!r.ok) { App().toast(r.errors[0]); return false; }
  save(doc.map_id);
  App().toast("Saved as map v" + r.version);
  return true;
}
function nextId(map, p) {
  const all = {};
  ["concepts", "groups", "relations"].forEach((k) => (map[k] || []).forEach((x) => { all[x.id] = true; }));
  let n = 1;
  while (all[p + n]) n++;
  return p + n;
}

export default function MapList({ doc, parse, onCheck }) {
  const map = KM().currentMap(doc);
  const v = KM().currentVersion(doc);
  return (
    <div className="mm-col">
      <Proposals doc={doc} />
      <Concepts doc={doc} map={map} onCheck={onCheck} />
      <Relations doc={doc} map={map} onCheck={onCheck} />
      <Groups doc={doc} map={map} onCheck={onCheck} />
      <OpenQuestions doc={doc} map={map} />
      <History doc={doc} v={v} />
    </div>
  );
}

// ------------------------------------------------------------------ AI proposals (patches from coaching turns)
function Proposals({ doc }) {
  const open = (doc.patches || []).filter((p) => p.status === "proposed");
  const done = (doc.patches || []).filter((p) => p.status !== "proposed").slice(-5).reverse();
  if (!open.length && !done.length) return null;
  const map = KM().currentMap(doc);
  const name = (what, id, m) => {
    const list = m[what + "s"] || [], x = list.find((y) => y.id === id);
    if (!x) return id;
    return what === "relation" ? KM().relationText(m, x) : "“" + x.label + "”";
  };
  return (
    <Panel title={"Proposed changes" + (open.length ? " (" + open.length + ")" : "")}>
      <p className="mm-hint">Claude Code never changes your map. It proposes; you approve or reject. Approving makes a new version you can undo.</p>
      {open.map((p) => {
        const pv = KM().previewPatch(doc, p);
        return (
          <div className="mm-patch" key={p.id}>
            <div className="mm-patch-head">
              <b>From turn {p.turn}</b>
              <span className="mm-muted">made on map v{p.base_version}{p.status_note ? " · " + p.status_note : ""}</span>
            </div>
            {p.rationale && <p>{p.rationale}</p>}
            {pv.errors.length ? <p className="mm-err">This proposal does not fit the current map: {pv.errors[0]}</p> : (
              <ul className="mm-diff">
                {pv.changes.map((c, i) => (
                  <li key={i} data-k={c.kind}><Tag>{c.kind}</Tag> {c.what} {c.kind === "removed" ? name(c.what, c.id, map) : name(c.what, c.id, pv.map)}</li>
                ))}
              </ul>
            )}
            <div className="mm-btnrow">
              <Btn size="sm" kind="primary" disabled={pv.errors.length > 0} onClick={() => {
                const r = KM().approvePatch(doc, p.id, Date.now());
                save(doc.map_id);
                App().toast(r.ok ? "Approved · map v" + r.version : r.errors[0]);
              }}><CheckCircle size={15} aria-hidden="true" /> Approve</Btn>
              <Btn size="sm" onClick={() => { KM().rejectPatch(doc, p.id, Date.now()); save(doc.map_id); App().toast("Rejected. Your map is unchanged."); }}><XCircle size={15} aria-hidden="true" /> Reject</Btn>
            </div>
          </div>
        );
      })}
      {done.length > 0 && (
        <ul className="mm-plain mm-muted">
          {done.map((p) => <li key={p.id}>Turn {p.turn}: {p.status}{p.version ? " → v" + p.version : ""}{p.errors ? " (" + p.errors[0] + ")" : ""} · {when(p.decided_at)}</li>)}
        </ul>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ ideas
function Concepts({ doc, map, onCheck }) {
  const [edit, setEdit] = useState(null);
  const [add, setAdd] = useState("");
  const used = {};
  map.relations.forEach((r) => { used[r.from] = (used[r.from] || 0) + 1; used[r.to] = (used[r.to] || 0) + 1; });
  return (
    <Panel title={"Ideas (" + map.concepts.length + ")"}>
      {map.concepts.length === 0 ? <Empty title="No ideas yet" /> : (
        <TableWrap>
          <table className="k-table mm-table">
            <thead><tr><th>Idea</th><th>Definition</th><th>Connections</th><th>By</th><th className="mm-act-h">Actions</th></tr></thead>
            <tbody>
              {map.concepts.map((k) => (
                <tr key={k.id}>
                  {edit && edit.id === k.id ? (
                    <>
                      <td><input className="k-input" aria-label="Idea" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></td>
                      <td><input className="k-input" aria-label="Definition" value={edit.definition} onChange={(e) => setEdit({ ...edit, definition: e.target.value })} placeholder="In your words (optional)" /></td>
                      <td className="k-num">{used[k.id] || 0}</td><td>{BY[k.authored_by] || k.authored_by}</td>
                      <td className="mm-act">
                        <Btn size="sm" kind="primary" onClick={() => { if (commit(doc, [{ op: "update_concept", id: k.id, set: { label: edit.label.trim() || k.label, definition: edit.definition.trim() || null } }], "Edited an idea")) setEdit(null); }}>Save</Btn>
                        <Btn size="sm" onClick={() => setEdit(null)}>Cancel</Btn>
                      </td>
                    </>
                  ) : (
                    <>
                      <td><b>{k.label}</b>{k.term && k.term !== k.label ? <span className="mm-muted"> · {k.term}</span> : null}{k.uncertain && <> <Lvl level="warn">reading unsure</Lvl></>}</td>
                      <td>{k.definition || <span className="mm-muted">—</span>}</td>
                      <td className="k-num">{used[k.id] || 0}</td>
                      <td>{BY[k.authored_by] || k.authored_by}</td>
                      <td className="mm-act">
                        <button type="button" className="k-btn sm ghost" onClick={() => setEdit({ id: k.id, label: k.label, definition: k.definition || "" })} aria-label={"Edit " + k.label}><PencilSimple size={15} /></button>
                        <button type="button" className="k-btn sm ghost" onClick={() => onCheck("definition", k.id)} title="Make a check: explain it without the map"><Target size={15} aria-hidden="true" /> Check</button>
                        <button type="button" className="k-btn sm ghost danger" onClick={() => commit(doc, [{ op: "remove_concept", id: k.id }], "Removed an idea")} aria-label={"Remove " + k.label} title="Remove (its connections go too)"><Trash size={15} /></button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <form className="mm-inline mm-add" onSubmit={(e) => { e.preventDefault(); const t = add.trim(); if (t && commit(doc, [{ op: "add_concept", concept: { id: nextId(map, "u-k"), label: t, term: t } }], "Added an idea")) setAdd(""); }}>
        <label className="k-sr" htmlFor="mm-add-k">New idea</label>
        <input id="mm-add-k" className="k-input" placeholder="Add an idea" value={add} onChange={(e) => setAdd(e.target.value)} />
        <Btn size="sm" type="submit"><Plus size={14} aria-hidden="true" /> Add</Btn>
      </form>
    </Panel>
  );
}

// ------------------------------------------------------------------ connections
function Relations({ doc, map, onCheck }) {
  const [edit, setEdit] = useState(null);
  const blank = { from: "", to: "", predicate: "", direction: "forward", type: "custom" };
  const [add, setAdd] = useState(blank);
  const lab = (id) => KM().label(map, id);
  const opts = map.concepts.map((k) => <option key={k.id} value={k.id}>{k.label}</option>);
  return (
    <Panel title={"Connections (" + map.relations.length + ")"}>
      <p className="mm-hint">An unlabeled line stays unlabeled until you say what it means. Direction is not always cause.</p>
      {map.relations.length === 0 ? <Empty title="No connections yet" /> : (
        <TableWrap>
          <table className="k-table mm-table">
            <thead><tr><th>From</th><th></th><th>To</th><th>Meaning</th><th>Type</th><th>Weight</th><th>By</th><th className="mm-act-h">Actions</th></tr></thead>
            <tbody>
              {map.relations.map((r) => edit && edit.id === r.id ? (
                <tr key={r.id}>
                  <td>{lab(r.from)}</td>
                  <td><select className="k-input" aria-label="Direction" value={edit.direction} onChange={(e) => setEdit({ ...edit, direction: e.target.value })}>{DIRS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                  <td>{lab(r.to)}</td>
                  <td><input className="k-input" aria-label="Meaning" value={edit.predicate} onChange={(e) => setEdit({ ...edit, predicate: e.target.value })} placeholder="what the line means" /></td>
                  <td><select className="k-input" aria-label="Type" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select></td>
                  <td><select className="k-input" aria-label="Weight" value={edit.emphasis} onChange={(e) => setEdit({ ...edit, emphasis: e.target.value })}>{EMPH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                  <td>{BY[r.authored_by] || r.authored_by}</td>
                  <td className="mm-act">
                    <Btn size="sm" kind="primary" onClick={() => {
                      const set = { direction: edit.direction, predicate: edit.predicate.trim() || null, type: edit.type, emphasis: edit.emphasis || null };
                      if (commit(doc, [{ op: "update_relation", id: r.id, set }], "Edited a connection")) setEdit(null);
                    }}>Save</Btn>
                    <Btn size="sm" onClick={() => setEdit(null)}>Cancel</Btn>
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td>{lab(r.from)}</td>
                  <td className="mm-dir" aria-label={r.direction}>{DIR_LABEL[r.direction] || "?"}</td>
                  <td>{lab(r.to)}</td>
                  <td>{r.predicate ? "“" + r.predicate + "”" : <span className="mm-muted">no label</span>}{(r.conditions || []).length ? <span className="mm-muted"> · if {r.conditions.join("; ")}</span> : null}</td>
                  <td>{r.type === "custom" ? <span className="mm-muted">—</span> : r.type.replace("_", " ")}</td>
                  <td>{r.emphasis || <span className="mm-muted">—</span>}</td>
                  <td>{BY[r.authored_by] || r.authored_by}</td>
                  <td className="mm-act">
                    <button type="button" className="k-btn sm ghost" onClick={() => setEdit({ id: r.id, direction: r.direction, predicate: r.predicate || "", type: r.type, emphasis: r.emphasis || "" })} aria-label="Edit connection"><PencilSimple size={15} /></button>
                    <button type="button" className="k-btn sm ghost" onClick={() => onCheck("relation", r.id)} title="Make a check: explain this connection without the map"><Target size={15} aria-hidden="true" /> Check</button>
                    <button type="button" className="k-btn sm ghost danger" onClick={() => commit(doc, [{ op: "remove_relation", id: r.id }], "Removed a connection")} aria-label="Remove connection"><Trash size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <form className="mm-addrel" onSubmit={(e) => {
        e.preventDefault();
        if (!add.from || !add.to) { App().toast("Pick both ideas"); return; }
        const rel = { id: nextId(map, "u-e"), from: add.from, to: add.to, type: add.type, predicate: add.predicate.trim() || null, direction: add.direction };
        if (commit(doc, [{ op: "add_relation", relation: rel }], "Added a connection")) setAdd(blank);
      }}>
        <select className="k-input" aria-label="From idea" value={add.from} onChange={(e) => setAdd({ ...add, from: e.target.value })}><option value="">From…</option>{opts}</select>
        <select className="k-input" aria-label="Direction" value={add.direction} onChange={(e) => setAdd({ ...add, direction: e.target.value })}>{DIRS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="k-input" aria-label="To idea" value={add.to} onChange={(e) => setAdd({ ...add, to: e.target.value })}><option value="">To…</option>{opts}</select>
        <input className="k-input" aria-label="Meaning" placeholder="what it means (optional)" value={add.predicate} onChange={(e) => setAdd({ ...add, predicate: e.target.value })} />
        <Btn size="sm" type="submit"><Plus size={14} aria-hidden="true" /> Add connection</Btn>
      </form>
    </Panel>
  );
}

// ------------------------------------------------------------------ groups
function Groups({ doc, map, onCheck }) {
  const [crit, setCrit] = useState({});
  const [add, setAdd] = useState({ label: "", criterion: "", members: [] });
  const lab = (id) => KM().label(map, id);
  return (
    <Panel title={"Groups (" + map.groups.length + ")"}>
      <p className="mm-hint">A group is read from a heading, a bracket, a boundary or branching, never from ink color. Say what holds it together.</p>
      {map.groups.map((g) => (
        <div className="mm-group" key={g.id}>
          <div className="mm-group-head">
            <b>{g.label}</b>
            <span className="mm-muted">{BY[g.authored_by] || g.authored_by}</span>
            <button type="button" className="k-btn sm ghost" onClick={() => onCheck("group", g.id)}><Target size={15} aria-hidden="true" /> Check</button>
            <button type="button" className="k-btn sm ghost danger" onClick={() => commit(doc, [{ op: "remove_group", id: g.id }], "Removed a group")} aria-label={"Remove group " + g.label}><Trash size={15} /></button>
          </div>
          <p className="mm-members">{g.members.map(lab).join(" · ") || <span className="mm-muted">no members</span>}</p>
          <form className="mm-inline" onSubmit={(e) => { e.preventDefault(); const t = (crit[g.id] != null ? crit[g.id] : g.criterion || "").trim(); commit(doc, [{ op: "update_group", id: g.id, set: { criterion: t || null } }], "Group criterion"); }}>
            <label className="mm-inline-l" htmlFor={"mm-c-" + g.id}>What they have in common</label>
            <input id={"mm-c-" + g.id} className="k-input" value={crit[g.id] != null ? crit[g.id] : g.criterion || ""} placeholder="No criterion yet" onChange={(e) => setCrit({ ...crit, [g.id]: e.target.value })} />
            <Btn size="sm" type="submit">Save</Btn>
          </form>
        </div>
      ))}
      <details className="mm-addgroup">
        <summary><Plus size={14} aria-hidden="true" /> New group</summary>
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!add.label.trim() || !add.members.length) { App().toast("Name the group and pick its ideas"); return; }
          const g = { id: nextId(map, "u-g"), label: add.label.trim(), criterion: add.criterion.trim() || null, members: add.members };
          if (commit(doc, [{ op: "add_group", group: g }], "Added a group")) setAdd({ label: "", criterion: "", members: [] });
        }}>
          <input className="k-input" aria-label="Group name" placeholder="Group name" value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} />
          <input className="k-input" aria-label="Criterion" placeholder="What they have in common" value={add.criterion} onChange={(e) => setAdd({ ...add, criterion: e.target.value })} />
          <fieldset className="mm-members-pick">
            <legend>Ideas</legend>
            {map.concepts.map((k) => (
              <label key={k.id} className="k-check"><input type="checkbox" checked={add.members.indexOf(k.id) >= 0}
                onChange={(e) => setAdd({ ...add, members: e.target.checked ? add.members.concat(k.id) : add.members.filter((x) => x !== k.id) })} /> {k.label}</label>
            ))}
          </fieldset>
          <Btn size="sm" type="submit">Add group</Btn>
        </form>
      </details>
    </Panel>
  );
}

function OpenQuestions({ doc, map }) {
  const [t, setT] = useState("");
  return (
    <Panel title="Your open questions">
      <p className="mm-hint">Questions you are still asking yourself about the topic. Writing one is not a mistake.</p>
      <ul className="mm-plain">
        {map.open_questions.map((q) => (
          <li key={q} className="mm-oq"><span>{q}</span><button type="button" className="k-btn sm ghost" onClick={() => commit(doc, [{ op: "resolve_open_question", text: q }], "Question resolved")}>Resolved</button></li>
        ))}
      </ul>
      <form className="mm-inline" onSubmit={(e) => { e.preventDefault(); if (t.trim() && commit(doc, [{ op: "add_open_question", text: t.trim() }], "Open question")) setT(""); }}>
        <label className="k-sr" htmlFor="mm-oq">New question</label>
        <input id="mm-oq" className="k-input" placeholder="Add a question" value={t} onChange={(e) => setT(e.target.value)} />
        <Btn size="sm" type="submit">Add</Btn>
      </form>
    </Panel>
  );
}

// ------------------------------------------------------------------ versions
function History({ doc, v }) {
  const vers = doc.versions.slice().reverse();
  return (
    <Panel title={"History · map v" + v}>
      <p className="mm-hint">Restoring makes a new version from an old one; nothing is deleted. Your checks keep the version they were made on.</p>
      <ol className="mm-hist" reversed>
        {vers.map((x) => {
          const prev = x.v > 1 ? KM().mapAt(doc, x.v - 1) : null;
          const ch = prev ? KM().diffMaps(prev, KM().mapAt(doc, x.v)).length : null;
          return (
            <li key={x.v}>
              <b>v{x.v}</b>
              <Tag>{SOURCE_LABEL[x.source] || x.source}</Tag>
              <span>{x.note || (x.source === "revert" ? "Back to v" + x.of : x.source === "reading" ? "Reading " + x.parse_rev + (x.replayed ? " + " + x.replayed + " of your changes replayed" : "") : "")}{ch != null ? " · " + ch + " change" + (ch === 1 ? "" : "s") : ""}</span>
              {(x.conflicts || []).length > 0 && <Lvl level="warn">{x.conflicts.length} change(s) did not fit the new reading</Lvl>}
              <span className="mm-muted">{when(x.at)}</span>
              {x.v < v && <button type="button" className="k-btn sm ghost" onClick={() => { const r = KM().revertTo(doc, x.v, Date.now()); if (r.ok) { save(doc.map_id); App().toast("Restored as v" + r.version); } }}><ClockCounterClockwise size={14} aria-hidden="true" /> Restore</button>}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
