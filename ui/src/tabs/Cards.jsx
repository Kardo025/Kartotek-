// Cards tab: new card, decks, bulk import and the searchable card table (port of App.views.cards)
import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, PencilSimple, Pause, Play, Trash, MagnifyingGlass, UploadSimple, Warning, Check, X } from "@phosphor-icons/react";
import { PageHead, Panel, Btn, State, Field, TableWrap, EASE } from "./kit.jsx";
import { ArmBtn } from "./manage-kit.jsx";
import "./cards.css";

const PAGE = 50;
const STATES = ["new", "learning", "review", "relearning", "suspended"];

function DeckOptions({ S, withAll }) {
  return (
    <>
      {withAll && <option value="">All decks</option>}
      {Object.keys(S.decks).map((d) => <option key={d} value={d}>{S.decks[d].name}</option>)}
    </>
  );
}

// Deck select for the add and import forms: follows the legacy default unless the person picked one
function DeckSelect({ S, value, onChange, id }) {
  const has = Object.keys(S.decks).length > 0;
  return (
    <Field label="Deck">
      <select id={id} value={has ? value : ""} onChange={(e) => onChange(e.target.value)}>
        {has ? <DeckOptions S={S} /> : <option value="">My deck (new)</option>}
      </select>
    </Field>
  );
}

function Msg({ msg }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {msg && (
        <motion.span key={msg.k} className={"k-small cards-msg" + (msg.warn ? " warn" : "")} role="status"
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.25, ease: EASE }}>
          {msg.warn ? <Warning size={15} weight="fill" aria-hidden="true" /> : <Check size={15} weight="bold" aria-hidden="true" />}
          {msg.text}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function NewCard({ App, S, deck, setDeck }) {
  const [f, setF] = useState({ front: "", back: "", hint: "", imp: "3", expl: "", tags: "", rev: false, type: "basic", o0: "", o1: "", o2: "", o3: "", ok: 0 });
  const [msg, setMsg] = useState(null);
  const frontRef = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = (e) => {
    e.preventDefault();
    const deckId = deck || App.ensureDeck();
    const opts = f.type === "mcq" ? [f.o0, f.o1, f.o2, f.o3].map((x) => x.trim()) : null;
    if (opts && opts.some((x) => !x)) return;
    // Cloze: the back defaults to the hidden parts; multiple choice: the back is the correct option
    const clozeBack = f.type === "cloze" ? (f.front.match(/\{\{(?:c\d+::)?(.+?)\}\}/g) || []).map((x) => x.replace(/^\{\{(?:c\d+::)?|\}\}$/g, "")).join(" · ") : "";
    const fields = {
      deck_id: deckId,
      front: f.front.trim(),
      back: f.type === "mcq" ? opts[f.ok] : f.back.trim() || clozeBack,
      card_type: f.type === "basic" ? undefined : f.type,
      options: opts || undefined, correct: opts ? f.ok : undefined,
      hint: f.hint.trim(),
      explanation: f.expl.trim(),
      tags: f.tags.split(",").map((x) => x.trim()).filter(Boolean),
      importance: window.DSR.clip(1, 5, parseInt(f.imp, 10) || 3),
    };
    if (!fields.front || !fields.back) return;
    if (!fields.card_type) delete fields.card_type;
    if (!fields.options) { delete fields.options; delete fields.correct; }
    const c = App.addCard(fields), ids = [c.card_id];
    if (f.rev && f.type === "basic") {
      const r = App.addCard(Object.assign({}, fields, { front: fields.back, back: fields.front, hint: "", note_id: c.note_id, card_type: "reverse" }));
      ids.push(r.card_id);
    }
    App.lastAddDeck = deckId;
    App.commitCards(ids);
    const flags = App.S.mem[c.card_id].content_flags;
    setF({ ...f, front: "", back: "", hint: "", expl: "", o0: "", o1: "", o2: "", o3: "", ok: 0 });
    setDeck(deckId);
    setMsg({
      k: Date.now(),
      warn: flags.length > 0,
      text: flags.length ? "Added. Warning: " + flags.join(" · ") : ids.length + (ids.length === 1 ? " card added." : " cards added."),
    });
    frontRef.current && frontRef.current.focus();
    App.render();
  };
  return (
    <Panel title="New card" className="cards-new">
      <form className="cards-form" id="add-form" onSubmit={submit}>
        <p className="k-small">A card should hold a single retrieval target. Context, examples and hints go in separate fields.</p>
        <DeckSelect S={S} id="add-deck" value={deck} onChange={setDeck} />
        <div className="cards-type" role="group" aria-label="Card type">
          {[["basic", "Question and answer"], ["cloze", "Cloze (fill the gap)"], ["mcq", "Multiple choice"]].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={f.type === v} onClick={() => setF({ ...f, type: v })}>{l}</button>
          ))}
        </div>
        <Field label={f.type === "cloze" ? "Text with gaps" : "Front (question)"} hint={f.type === "cloze" ? "Put each hidden part in double braces: The derivative of sin x is {{cos x}}." : undefined}>
          <textarea id="add-front" ref={frontRef} rows={2} required value={f.front} onChange={set("front")}
            placeholder={f.type === "cloze" ? "Stevin's law: p = p0 + {{ρ g h}}" : "What does the French word ‘chien’ mean in English?"} />
        </Field>
        {f.type === "mcq" ? (
          <div className="cards-mcq">
            {[0, 1, 2, 3].map((i) => (
              <label key={i} className="cards-mcq-row">
                <input type="radio" name="add-ok" checked={f.ok === i} onChange={() => setF({ ...f, ok: i })} aria-label={"Option " + "ABCD"[i] + " is correct"} />
                <span className="cards-mcq-l">{"ABCD"[i]}</span>
                <input className="k-input" required value={f["o" + i]} onChange={set("o" + i)} placeholder={i === 0 ? "Correct or wrong option" : ""} />
              </label>
            ))}
            <span className="k-field-hint">Mark the correct option. In Review you choose with A–D, then rate as usual.</span>
          </div>
        ) : (
          <Field label={f.type === "cloze" ? "Back (optional extra)" : "Back (expected answer)"}>
            <textarea id="add-back" rows={2} required={f.type === "basic"} value={f.back} onChange={set("back")} placeholder={f.type === "cloze" ? "Empty: the hidden parts" : "dog"} />
          </Field>
        )}
        <div className="cards-pair">
          <Field label="Hint"><input id="add-hint" value={f.hint} onChange={set("hint")} placeholder="d…" /></Field>
          <Field label="Importance (1 to 5)"><input id="add-imp" type="number" min="1" max="5" value={f.imp} onChange={set("imp")} className="k-num" /></Field>
        </div>
        <Field label="Explanation or example (shown after a miss)">
          <textarea id="add-expl" rows={2} value={f.expl} onChange={set("expl")} />
        </Field>
        <Field label="Tags" hint="Comma-separated. Cards of the same concept are not shown back to back.">
          <input id="add-tags" value={f.tags} onChange={set("tags")} />
        </Field>
        {f.type === "basic" && <label className="k-check"><input type="checkbox" id="add-rev" checked={f.rev} onChange={set("rev")} /> Also create the reverse card</label>}
        <div className="cards-actions">
          <Btn kind="primary" type="submit"><Plus size={17} weight="bold" aria-hidden="true" />Add card</Btn>
          <Msg msg={msg} />
        </div>
      </form>
    </Panel>
  );
}

function DeckRow({ App, S, d }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const ids = Object.keys(S.cards).filter((id) => S.cards[id].deck_id === d);
  const st = { new: 0, review: 0, other: 0 };
  ids.forEach((id) => { const s = S.mem[id].state; if (s === "new") st.new++; else if (s === "review") st.review++; else st.other++; });
  return (
    <motion.li className="cards-deck" layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.3, ease: EASE }}>
      <AnimatePresence mode="wait" initial={false}>
        {editing ? (
          <motion.form key="edit" className="cards-deck-edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) { S.decks[d].name = name.trim(); App.store.commit({ meta: true }); }
              setEditing(false);
              App.render();
            }}>
            <input className="k-input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus aria-label="Deck name"
              onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }} />
            <Btn kind="primary" size="sm" type="submit">Save</Btn>
            <Btn size="sm" onClick={() => setEditing(false)} aria-label="Cancel"><X size={15} weight="bold" aria-hidden="true" /></Btn>
          </motion.form>
        ) : (
          <motion.div key="view" className="cards-deck-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <div className="cards-deck-text">
              <b>{S.decks[d].name}</b>
              <span className="k-small k-muted k-num">{ids.length} cards · {st.new} new · {st.review} review · {st.other} learning</span>
            </div>
            <div className="k-row-btns">
              <Btn size="sm" data-rename={d} onClick={() => { setName(S.decks[d].name); setEditing(true); }}>
                <PencilSimple size={15} aria-hidden="true" />Rename
              </Btn>
              <ArmBtn kind="danger" data-deldeck={d} label="Delete" armedLabel={`Delete ${ids.length} cards and their history?`}
                onConfirm={() => { App.deleteDecks([d]); App.toast("Deck deleted"); }}>
                <Trash size={15} aria-hidden="true" />
              </ArmBtn>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function Decks({ App, S, onAdded }) {
  const [name, setName] = useState("");
  const ids = Object.keys(S.decks);
  return (
    <Panel title="Decks">
      {!ids.length && <p className="k-small">No decks yet. “My deck” is created when you add the first card.</p>}
      {ids.length > 0 && (
        <ul className="cards-decks" id="deck-list">
          <AnimatePresence initial={false}>
            {ids.map((d) => <DeckRow key={d} App={App} S={S} d={d} />)}
          </AnimatePresence>
        </ul>
      )}
      <form className="cards-inline" id="deck-form" onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        const d = { deck_id: window.DSR.uid(), name: n, created_at: Date.now() };
        if (App.scope) d.exams = [App.scope]; // a deck made inside an exam section belongs to that exam
        App.S.decks[d.deck_id] = d;
        App.lastAddDeck = d.deck_id;
        App.store.commit({ meta: true });
        setName("");
        onAdded();
        App.render();
      }}>
        <input className="k-input" id="deck-name" placeholder="New deck name" required value={name} onChange={(e) => setName(e.target.value)} aria-label="New deck name" />
        <Btn type="submit"><Plus size={16} weight="bold" aria-hidden="true" />Add deck</Btn>
      </form>
    </Panel>
  );
}

function BulkImport({ App, S, deck, setDeck }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState(null);
  return (
    <Panel title="Bulk import">
      <form className="cards-form" id="import-form" onSubmit={(e) => {
        e.preventDefault();
        const deckId = deck || App.ensureDeck();
        const ids = [];
        text.split(/\r?\n/).forEach((line) => {
          if (!line.trim()) return;
          const parts = line.indexOf("\t") >= 0 ? line.split("\t") : line.split(";");
          if (parts.length < 2 || !parts[0].trim() || !parts[1].trim()) return;
          ids.push(App.addCard({ deck_id: deckId, front: parts[0].trim(), back: parts[1].trim(), hint: (parts[2] || "").trim() }).card_id);
        });
        App.commitCards(ids);
        setMsg({ k: Date.now(), text: ids.length + (ids.length === 1 ? " card imported." : " cards imported.") });
        setText("");
        setDeck(deckId);
        App.render();
      }}>
        <p className="k-small">One card per line: <span className="k-mono">front⇥back⇥hint</span> or <span className="k-mono">front;back;hint</span></p>
        <DeckSelect S={S} id="imp-deck" value={deck} onChange={setDeck} />
        <Field label="Cards">
          <textarea id="imp-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"maison;house\nlivre;book;b…"} className="k-mono" />
        </Field>
        <div className="cards-actions">
          <Btn type="submit"><UploadSimple size={16} weight="bold" aria-hidden="true" />Import</Btn>
          <Msg msg={msg} />
        </div>
      </form>
    </Panel>
  );
}

function filterIds(App, S) {
  const f = App.cardFilter, q = f.q.toLowerCase();
  if (f.deck && !S.decks[f.deck]) f.deck = "";
  const ids = Object.keys(S.cards).filter((id) => {
    const c = S.cards[id], m = S.mem[id];
    if (f.deck && c.deck_id !== f.deck) return false;
    if (f.state === "suspended" ? !m.suspended : (f.state && m.state !== f.state)) return false;
    if (f.flagged && !m.needs_content_review) return false;
    if (q && (c.front + " " + c.back + " " + (c.tags || []).join(" ")).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  ids.sort((a, b) => (S.mem[a].due_at || Infinity) - (S.mem[b].due_at || Infinity) || S.cards[a].created_at - S.cards[b].created_at);
  return ids;
}

function CardRow({ App, S, id, now }) {
  const c = S.cards[id], m = S.mem[id];
  const DAY = window.DSR.DAY;
  const isNew = m.state === "new";
  const R = isNew ? null : window.DSR.retrievability((now - m.last_reviewed_at) / DAY, m.stability_days);
  return (
    <motion.tr initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.28, ease: EASE }}>
      <td className="cards-text" title={c.front}>{c.front}</td>
      <td className="cards-text" title={c.back}>{c.back}</td>
      <td>
        <span className="cards-states">
          {m.suspended ? <span className="k-state cards-susp">suspended</span> : <State s={m.state} />}
          {m.needs_content_review && <span className="k-state" data-s="relearning" title={(m.content_flags || []).join(" · ")}>review content</span>}
        </span>
      </td>
      <td className="num">{isNew ? "-" : App.dec(m.difficulty, 1)}</td>
      <td className="num">{isNew ? "-" : App.fmtDays(m.stability_days)}</td>
      <td className="num">{R == null ? "-" : App.dec(R, 2)}</td>
      <td className="cards-due">{m.due_at ? App.fmtDate(m.due_at) : "-"}</td>
      <td className="num">{m.lapse_count || 0}</td>
      <td className="num">{m.total_reviews ? App.pct(m.successful_reviews / m.total_reviews) : "-"}</td>
      <td>
        <div className="cards-row-actions">
          <Btn size="sm" className="cards-icon" data-edit={id} title="Edit" aria-label="Edit" onClick={() => App.openEditor(id, "front", () => App.render())}>
            <PencilSimple size={16} aria-hidden="true" />
          </Btn>
          <Btn size="sm" className="cards-icon" data-susp={id} title={m.suspended ? "Unsuspend" : "Suspend"} aria-label={m.suspended ? "Unsuspend" : "Suspend"}
            onClick={() => { App.setSuspended(id, !S.mem[id].suspended); App.render(); }}>
            {m.suspended ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          </Btn>
          <ArmBtn kind="danger" className="cards-icon" data-del={id} title="Delete" aria-label="Delete" label="" armedLabel="Are you sure?"
            onConfirm={() => { App.deleteCards([id]); App.render(); }}>
            <Trash size={16} aria-hidden="true" />
          </ArmBtn>
        </div>
      </td>
    </motion.tr>
  );
}

function CardTable({ App, S }) {
  const f = App.cardFilter;
  const [, bump] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const upd = (k, v) => { f[k] = v; setLimit(PAGE); bump((x) => x + 1); };
  const ids = filterIds(App, S);
  const shown = ids.slice(0, limit);
  const now = Date.now();
  return (
    <Panel className="cards-table-panel" aria-label="All cards">
      <div className="cards-filters">
        <label className="cards-search">
          <MagnifyingGlass size={16} aria-hidden="true" />
          <input className="k-input" id="f-q" type="search" placeholder="Search cards" aria-label="Search cards" value={f.q} onChange={(e) => upd("q", e.target.value)} />
        </label>
        <select className="k-select" id="f-deck" aria-label="Deck" value={f.deck} onChange={(e) => upd("deck", e.target.value)}>
          <DeckOptions S={S} withAll />
        </select>
        <select className="k-select" id="f-state" aria-label="State" value={f.state} onChange={(e) => upd("state", e.target.value)}>
          <option value="">All states</option>
          {STATES.map((s) => <option key={s} value={s}>{App.STATE_TR[s] || "suspended"}</option>)}
        </select>
        <label className="k-check"><input type="checkbox" id="f-flag" checked={f.flagged} onChange={(e) => upd("flagged", e.target.checked)} /> Only cards needing content review</label>
      </div>
      <div id="card-table">
        {!ids.length ? (
          <p className="k-small k-muted cards-none">No cards match the filter.</p>
        ) : (
          <>
            <TableWrap>
              <table className="k-table cards-table">
                <thead>
                  <tr>
                    <th>Front</th><th>Back</th><th>State</th><th className="num" title="Difficulty">D</th><th className="num" title="Stability">S</th>
                    <th className="num">R now</th><th>Due</th><th className="num">Lapses</th><th className="num">Success</th><th><span className="manage-sr">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {shown.map((id) => <CardRow key={id} App={App} S={S} id={id} now={now} />)}
                  </AnimatePresence>
                </tbody>
              </table>
            </TableWrap>
            <div className="cards-foot">
              <span className="k-small k-muted k-num">
                {ids.length > shown.length ? `Showing ${shown.length} of ${ids.length} cards` : ids.length + (ids.length === 1 ? " card" : " cards")}
              </span>
              {ids.length > shown.length && (
                <Btn size="sm" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, ids.length - shown.length)} more</Btn>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

export default function CardsTab() {
  // Inside an exam section the tab sees only that exam's decks and cards (same objects, same memory model)
  const App = window.App, S = App.scope ? App.scopedState(App.scope) : App.S;
  const scopeName = App.scope === "tud" ? "TU Delft AE Prep" : App.scope === "cents" ? "CEnT-S" : null;
  const exists = (d) => d && S.decks[d];
  const defDeck = () => App.cardFilter.deck || App.lastAddDeck || Object.keys(S.decks)[0] || "";
  const [addDeck, setAddDeck] = useState(null);
  const [impDeck, setImpDeck] = useState(null);
  const addVal = exists(addDeck) ? addDeck : defDeck();
  const impVal = exists(impDeck) ? impDeck : defDeck();
  const n = Object.keys(S.cards).length;
  return (
    <div className="k-page cards-page">
      <PageHead title={scopeName ? scopeName + " · Cards" : "Cards"} sub={<span className="k-tag k-num">{n} {n === 1 ? "card" : "cards"}</span>} />
      <div className="cards-top">
        <NewCard App={App} S={S} deck={addVal} setDeck={setAddDeck} />
        <div className="cards-side">
          <Decks App={App} S={S} onAdded={() => { setAddDeck(null); setImpDeck(null); }} />
          <BulkImport App={App} S={S} deck={impVal} setDeck={setImpDeck} />
        </div>
      </div>
      <CardTable App={App} S={S} />
    </div>
  );
}
