// Knowledge graph (task F6, LEARNING-PROTOCOL 3.10; sidebar "Maps", decision D10).
// Propositions and reasoning chains: seeded from every Study v2 package (computed, stable ids) and grown from live sessions and notes
// after your review. Each package node is coloured by its outcome's evidence state and shows the memory strength of its topic's card.
// "Practise these" starts a practice session (task F5) from the selected nodes. src/graph-core.js (KGraph) builds everything here.
import React, { useMemo, useState } from "react";
import { Graph, MagnifyingGlass, Barbell, Sparkle, NotePencil, Eye, EyeSlash, ArrowSquareOut, X, Check, ArrowRight, Files } from "@phosphor-icons/react";
import { PageHead, Btn, Seg } from "./kit.jsx";
import GraphView from "../graph/GraphView.jsx";
import { useModelReady, useModelCall, CallStatus, NoModelNote, byLine } from "../model-call.jsx";
import "./graph-tab.css";

const KG = () => window.KGraph;
const App = () => window.App;
const STATUS = {
  independent: { label: "shown without help", tone: "held" }, retained: { label: "retained after a delay", tone: "held" }, transfer: { label: "transferred", tone: "held" },
  assisted: { label: "only with help so far", tone: "edge" }, needs_work: { label: "needs work", tone: "missing" }, uncertain: { label: "uncertain evidence", tone: "open" },
  not_assessed: { label: "not assessed yet", tone: "open" }, session: { label: "from a live session or notes", tone: "session" }, and: { label: "", tone: "open" },
};
const commit = () => { App().store.commit({ meta: true }); App().render(); };

export default function KnowledgeGraph() {
  const S = App().S;
  const [filter, setFilter] = useState("all");
  const [layout, setLayout] = useState("layers");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState([]);
  const [showHidden, setShowHidden] = useState(false);
  const [, bump] = useState(0);
  const studies = KG().studiesOf(S);
  const extras = App().studyExtras || {};
  const graph = useMemo(() => KG().build(S, { filter, extras }), [filter, S, S.graph && JSON.stringify([S.graph.nodes && Object.keys(S.graph.nodes).length, S.graph.chains && Object.keys(S.graph.chains).length, S.graph.hidden])]);
  const vm = useMemo(() => KG().viewModel(graph, { search }), [graph, search]);
  const groups = useMemo(() => {
    const seen = {}, out = [];
    vm.nodes.forEach((n) => { if (!seen[n.group]) { seen[n.group] = 1; const st = studies.filter((x) => x.etut_id === n.group)[0]; out.push({ id: n.group, label: st ? st.package.title : "My ideas" }); } });
    return out;
  }, [vm]);
  const pkgN = graph.nodes.filter((n) => n.kind === "package").length, mine = graph.nodes.length - pkgN;
  const onSelect = (id, ev) => {
    if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) setSel((cur) => (cur.indexOf(id) >= 0 ? cur.filter((x) => x !== id) : cur.concat(id)));
    else setSel((cur) => (cur.length === 1 && cur[0] === id ? [] : [id]));
  };
  const node = sel.length ? graph.nodes.filter((n) => n.id === sel[sel.length - 1])[0] : null;
  const exams = Array.from(new Set(studies.map((et) => KG().examOf(et.package)).filter(Boolean)));
  return (
    <div className="k-page kg-page">
      <PageHead title="Knowledge graph" sub={<p className="k-small k-muted">{graph.nodes.length} ideas and {graph.chains.length} chains: {pkgN} from your studies' outcomes and relations{mine ? ", " + mine + " of your own from live sessions and notes" : ""}. Foundations sit at the bottom, what follows from them above. Colours show the evidence of each outcome; "memory" is the strength of its topic's review card.</p>} />
      <section className="k-panel k-sec kg-tools">
        <label className="kg-filter"><span className="k-small k-muted">Show</span>
          <select className="k-input" value={filter} onChange={(e) => { setFilter(e.target.value); setSel([]); }}>
            <option value="all">All studies</option>
            {exams.map((x) => <option key={x} value={"exam:" + x}>{x === "cents" ? "CEnT-S" : x === "tud" ? "TU Delft AE" : x}</option>)}
            {studies.map((et) => <option key={et.etut_id} value={"study:" + et.etut_id}>{et.package.title}</option>)}
            <option value="mine">Only my own ideas</option>
          </select>
        </label>
        <Seg label="graph-layout" value={layout} onChange={setLayout} options={[{ value: "layers", label: "Foundations at the bottom" }, { value: "columns", label: "By study" }]} />
        <label className="kg-search"><MagnifyingGlass size={15} aria-hidden="true" /><input className="k-input" value={search} placeholder="Search ideas" onChange={(e) => setSearch(e.target.value)} aria-label="Search ideas" /></label>
        {sel.length > 0 && <PractiseThese nodes={graph.nodes.filter((n) => sel.indexOf(n.id) >= 0)} clear={() => setSel([])} />}
      </section>
      <GraphView nodes={vm.nodes} edges={vm.edges} statuses={STATUS} layout={layout} groups={groups} selected={sel} onSelect={onSelect} height={560} maxRow={layout === "layers" ? 10 : undefined} ariaLabel="Knowledge graph" />
      <p className="k-small k-muted">Click an idea for details; Ctrl- or Shift-click to select several, then "Practise these". Drag to move, scroll to zoom.</p>
      {node && <Detail node={node} close={() => setSel([])} redraw={() => bump((x) => x + 1)} />}
      <Growth />
      <HiddenList open={showHidden} toggle={() => setShowHidden(!showHidden)} />
    </div>
  );
}

function Detail({ node, close, redraw }) {
  const S = App().S;
  const open = () => {
    if (node.kind === "package") {
      const et = S.etuts[node.etut_id];
      if (!et) return;
      window.KCycle.goto(et, node.pi, node.ti, "work", Date.now());
      App().EtutUI.commit(et); App().liveOpen = null; App().practiceOpen = null; App().etutOpen = node.etut_id; App().switchTab("etut");
    } else if (node.origin && node.origin.session) {
      App().etutOpen = null; App().practiceOpen = null; App().liveOpen = node.origin.session; App().liveFocus = node.origin.turn ? Number(String(node.origin.turn).replace(/^step /, "")) : null; App().switchTab("etut");
    }
  };
  const from = node.kind === "package" ? node.study + " · " + node.topic + (node.pages && node.pages.length ? " · " + node.pages.slice(0, 4).join(", ") : "")
    : node.origin && node.origin.session ? "Live session \"" + (node.origin.title || node.origin.session) + "\"" + (node.origin.turn ? ", " + node.origin.turn : "") : "Your notes" + (node.origin && node.origin.notes ? ": " + node.origin.notes : "");
  return (
    <section className="k-panel k-sec kg-detail">
      <div className="pb-head"><p className="cy-kicker"><Graph size={14} aria-hidden="true" />{node.kind === "package" ? "From a study" : "Your own idea"}</p><Btn size="sm" onClick={close} aria-label="Close"><X size={14} aria-hidden="true" /></Btn></div>
      <h3 className="cy-h3">{node.name}</h3>
      <p>{node.statement}</p>
      {(node.aliases || []).length > 0 && <p className="k-small k-muted">Also phrased as: {node.aliases.join(" · ")}</p>}
      <dl className="pb-dl k-small">
        <div><dt>Comes from</dt><dd>{from}</dd></div>
        <div><dt>Evidence</dt><dd>{node.evidence.label}</dd></div>
        <div><dt>Memory</dt><dd>{node.memory ? Math.round(node.memory.R * 100) + " % now" + (node.memory.due_at ? ", next review " + new Date(node.memory.due_at).toLocaleDateString() : "") : node.kind === "package" ? "no review yet for this topic's card" : "no card (ideas from sessions are never cards)"}</dd></div>
      </dl>
      <div className="cy-actions">
        {(node.kind === "package" || (node.origin && node.origin.session)) && <Btn size="sm" kind="primary" onClick={open}><ArrowSquareOut size={14} aria-hidden="true" />{node.kind === "package" ? "Open the lesson" : "Open the session message"}</Btn>}
        <Btn size="sm" onClick={() => { KG().hide(S, node.id); commit(); close(); }} title="Hides it from the view; nothing is deleted."><EyeSlash size={14} aria-hidden="true" />Hide from the view</Btn>
      </div>
    </section>
  );
}

// "Practise these": a practice session (task F5) on the selected ideas
function PractiseThese({ nodes, clear }) {
  const S = App().S, mr = useModelReady("strong");
  const real = nodes.filter((n) => !/^and:/.test(n.id));
  if (!mr.ready) return <span className="k-small k-muted">{real.length} selected · practice needs a model</span>;
  const start = () => {
    const targets = real.map((n) => KG().targetOf(S, n));
    const studies = Array.from(new Set(real.filter((n) => n.kind === "package").map((n) => n.etut_id)));
    const one = studies.length === 1 && real.every((n) => n.kind === "package") ? studies[0] : null;
    const s = window.KPractice.newSession(S, { purpose: "free", title: "Practice: " + real.slice(0, 3).map((n) => n.name).join(", ") + (real.length > 3 ? " and " + (real.length - 3) + " more" : ""),
      etut_id: one, kids: one ? Array.from(new Set(real.map((n) => n.kid))) : [], targets, now: Date.now() });
    commit();
    App().etutOpen = null; App().liveOpen = null; App().practiceOpen = s.id; App().switchTab("etut");
  };
  return (
    <span className="cy-actions">
      <Btn size="sm" kind="primary" onClick={start}><Barbell size={14} aria-hidden="true" />Practise these ({real.length})</Btn>
      <Btn size="sm" onClick={clear}>Clear selection</Btn>
    </span>
  );
}

// ------------------------------------------------------------------ growth: proposals from live sessions and notes, reviewed by you
function Growth() {
  const S = App().S, mr = useModelReady("strong"), call = useModelCall();
  const g = KG().graphOf(S);
  const sessions = Object.keys(S.sessions || {}).map((k) => S.sessions[k]).filter((s) => s && s.kind === "live" && (s.steps || []).some((st) => st.teach.length && !((s.graph_extracted || {}).steps || []).includes(st.n)));
  const [notes, setNotes] = useState(null);
  const run = async (source) => {
    let problems = [], last = "The proposal could not be used.";
    for (let n = 0; n < 2; n++) {
      const inp = KG().extractorInputs(S, source, { problems });
      const r = await call.run("graph-extractor", inp.values, { feature: "graph-extractor", maxOutputTokens: 6000 });
      if (!r.ok) return;
      const pr = KG().checkExtraction(S, r.json, inp);
      if (!pr.length) {
        KG().addProposal(S, source, r.json, inp, { now: Date.now(), meta: r.meta, prompt: r.prompt });
        if (source.session) KG().markExtracted(source.session, inp.turns, Date.now());
        setNotes(null);
        commit();
        return;
      }
      problems = pr; last = "The proposal failed Kartotek's checks: " + pr.join(" ");
    }
    call.fail(last);
  };
  return (
    <section className="k-panel k-sec kg-grow">
      <p className="cy-kicker"><Sparkle size={14} aria-hidden="true" />Grow the graph</p>
      {g.pending.map((p) => <Review key={p.id} rec={p} />)}
      {!mr.ready ? <NoModelNote what="proposals from sessions and notes (the strong slot)" /> : (
        <>
          {sessions.length > 0 ? (
            <ul className="lv-list">
              {sessions.map((s) => <li key={s.id}><b>{s.title}</b><span className="k-small k-muted">{s.steps.filter((st) => st.teach.length && !((s.graph_extracted || {}).steps || []).includes(st.n)).length} step(s) not in the graph yet</span>
                <Btn size="sm" disabled={call.busy} onClick={() => run({ session: s })}>Propose ideas</Btn></li>)}
            </ul>
          ) : <p className="k-small k-muted">Every live session's teaching is already in the graph or under review.</p>}
          {notes == null ? <div className="cy-actions"><Btn size="sm" onClick={() => setNotes({ name: "", text: "" })}><NotePencil size={14} aria-hidden="true" />Add from notes</Btn></div> : <NotesForm notes={notes} setNotes={setNotes} busy={call.busy} run={run} />}
          <CallStatus call={call} />
        </>
      )}
      <p className="k-small k-muted">A proposal is written by your model from the session's teaching (or your notes); you accept, edit, link or reject each idea before anything is saved. Ideas from sessions never become review cards.</p>
    </section>
  );
}

function NotesForm({ notes, setNotes, busy, run }) {
  const pick = async () => {
    const r = await window.kartotek.jobs.pickFiles("sources");
    if (!r || !r.ok || !r.value.length) return;
    // the same local reader as live sessions, under a throw-away id
    const id = "ls-notes" + Date.now().toString(36);
    const rd = await window.kartotek.live.readFiles(id, [r.value[0].token]);
    const m = rd && rd.ok ? await window.kartotek.live.material(id) : null;
    if (!m || !m.ok || !m.value) { App().toast((rd && rd.error) || "The file could not be read."); return; }
    setNotes({ name: r.value[0].name, text: m.value.pages.map((x) => x.text).join("\n\n").slice(0, 14000) });
  };
  return (
    <div className="lt-block">
      <input className="k-input" value={notes.name} placeholder="A name for these notes" onChange={(e) => setNotes({ ...notes, name: e.target.value })} />
      <textarea className="k-input" rows={5} value={notes.text} maxLength={14000} placeholder="Paste your notes (or a study's source.md)" onChange={(e) => setNotes({ ...notes, text: e.target.value })} />
      <div className="cy-actions">
        {window.kartotek && window.kartotek.live && <Btn size="sm" onClick={pick}><Files size={14} aria-hidden="true" />Read a file…</Btn>}
        <Btn size="sm" kind="primary" disabled={busy || notes.text.trim().length < 40} onClick={() => run({ notes: { name: notes.name || "notes", text: notes.text } })}>Propose ideas<ArrowRight size={14} weight="bold" aria-hidden="true" /></Btn>
        <Btn size="sm" onClick={() => setNotes(null)}>Cancel</Btn>
      </div>
    </div>
  );
}

// One proposal: accept, edit, link to an existing record, or reject each idea; accept or reject each chain
function Review({ rec }) {
  const S = App().S;
  const full = KG().build(S, { filter: "all" });
  const name = {};
  full.nodes.forEach((n) => { name[n.id] = n.name; });
  const [d, setD] = useState(() => {
    const props = {};
    rec.propositions.forEach((p) => { props[p.i] = { action: p.link_to ? "same" : "accept", same: p.link_to || (p.candidates[0] || {}).id || null, name: p.name, statement: p.statement, links: [p.link_to].concat(p.related).filter((v, i, a) => v && a.indexOf(v) === i) }; });
    const chains = {};
    rec.chains.forEach((c) => { chains[c.i] = "accept"; });
    return { props, chains };
  });
  const setP = (i, x) => setD({ ...d, props: { ...d.props, [i]: { ...d.props[i], ...x } } });
  const label = (ref) => (/^new:/.test(ref) ? "“" + ((rec.propositions[Number(ref.slice(4))] || {}).name || ref) + "”" : name[ref] || ref);
  const save = () => {
    const out = KG().applyReview(S, rec.id, d, Date.now());
    App().toast(out.nodes.length + " idea(s) added, " + out.aliases + " linked to existing ones, " + out.chains.length + " chain(s)" + (out.skipped.length ? "; " + out.skipped.length + " chain(s) skipped" : ""));
    commit();
  };
  return (
    <div className="lt-block kg-review">
      <p className="lt-label">Proposal from {rec.source.session ? "the live session “" + rec.source.title + "”" : "notes “" + rec.source.notes + "”"} · {byLine(rec.by)} · generated, not verified</p>
      <ol className="kg-props">
        {rec.propositions.map((p) => {
          const x = d.props[p.i];
          const cands = [p.link_to].concat(p.candidates.map((c) => c.id)).filter((v, i, a) => v && a.indexOf(v) === i);
          return (
            <li key={p.i} data-a={x.action}>
              <div className="kg-row">
                <Seg label={"kg-p-" + rec.id + "-" + p.i} value={x.action} onChange={(v) => setP(p.i, { action: v })} options={[{ value: "accept", label: "Accept" }].concat(cands.length ? [{ value: "same", label: "Same idea as…" }] : []).concat([{ value: "reject", label: "Reject" }])} />
                {p.confidence === "tentative" && <span className="k-small k-muted">tentative</span>}
                <span className="k-small k-muted">{p.turn}</span>
              </div>
              {x.action === "same" ? (
                <div className="k-small">
                  <select className="k-input" value={x.same || ""} onChange={(e) => setP(p.i, { same: e.target.value })}>{cands.map((c) => <option key={c} value={c}>{name[c] || c}</option>)}</select>
                  <p className="k-muted">“{p.statement}” will be kept as another phrasing of it.</p>
                </div>
              ) : (
                <>
                  <input className="k-input" value={x.name} disabled={x.action === "reject"} onChange={(e) => setP(p.i, { name: e.target.value })} aria-label="Name" />
                  <textarea className="k-input" rows={2} value={x.statement} disabled={x.action === "reject"} onChange={(e) => setP(p.i, { statement: e.target.value })} aria-label="Statement" />
                  {(p.link_to || p.related.length > 0) && (
                    <div className="k-small kg-links"><span className="k-muted">Links to:</span>
                      {[p.link_to].concat(p.related).filter((v, i, a) => v && a.indexOf(v) === i).map((r) => (
                        <label key={r}><input type="checkbox" disabled={x.action === "reject"} checked={x.links.indexOf(r) >= 0} onChange={(e) => setP(p.i, { links: e.target.checked ? x.links.concat(r) : x.links.filter((y) => y !== r) })} /> {name[r] || r}</label>
                      ))}
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
      {rec.chains.length > 0 && (
        <ol className="kg-chains">
          {rec.chains.map((c) => (
            <li key={c.i}>
              <Seg label={"kg-c-" + rec.id + "-" + c.i} value={d.chains[c.i]} onChange={(v) => setD({ ...d, chains: { ...d.chains, [c.i]: v } })} options={[{ value: "accept", label: "Accept" }, { value: "reject", label: "Reject" }]} />
              <span className="k-small">{c.premises.map(label).join(" + ")} ⇒ {label(c.conclusion)}</span>
              <span className="k-small k-muted">{c.text}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="cy-actions"><Btn kind="primary" onClick={save}><Check size={15} aria-hidden="true" />Save my decisions</Btn></div>
    </div>
  );
}

function HiddenList({ open, toggle }) {
  const S = App().S, g = KG().graphOf(S);
  if (!g.hidden.length) return null;
  return (
    <details className="k-panel k-sec" open={open} onToggle={toggle}>
      <summary className="k-small"><Eye size={14} aria-hidden="true" /> {g.hidden.length} hidden idea(s)</summary>
      <ul className="k-small">{g.hidden.map((id) => <li key={id}>{id} <button type="button" className="k-btn sm" onClick={() => { KG().unhide(S, id); commit(); }}>Show again</button></li>)}</ul>
    </details>
  );
}
