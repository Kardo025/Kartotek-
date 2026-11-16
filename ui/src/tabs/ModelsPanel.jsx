// Settings › Models (task E1, ARCHITECTURE.md sections 5 and 6): providers (API key, command-line client, local endpoint) with a
// "Test connection" call, the three task slots, usage and cost with a monthly budget, prices, and the editable prompt files.
// Keys go to the desktop backend and never come back to the window. In the browser page the panel says that models need the desktop app.
import React, { useEffect, useRef, useState } from "react";
import { ResearchPanel } from "../research.jsx";
import { Plus, Trash, Plugs, CheckCircle, Warning, Key, Terminal, Cloud, Desktop, X, ArrowCounterClockwise, Robot } from "@phosphor-icons/react";
import { Panel, Btn, Lvl, TableWrap } from "./kit.jsx";
import { ArmBtn } from "./manage-kit.jsx";
import "./settings.css";

const M = () => window.kartotek && window.kartotek.models;
const PR = () => window.kartotek && window.kartotek.prompts;
const App = () => window.App;
export const modelsAvailable = () => !!M();

// One status for every AI button: set up or not. Refreshed when Settings › Models changes something.
let statusCache = null;
const listeners = new Set();
export function refreshModelStatus() {
  if (!M()) return Promise.resolve(null);
  return M().status().then((r) => { statusCache = r && r.ok ? r.value : null; listeners.forEach((f) => f(statusCache)); return statusCache; });
}
export function useModelStatus() {
  const [s, setS] = useState(statusCache);
  useEffect(() => { listeners.add(setS); if (!statusCache) refreshModelStatus(); return () => listeners.delete(setS); }, []);
  return s;
}
export function openModelSettings() {
  App().switchTab("settings");
  setTimeout(() => { const el = document.getElementById("models-panel"); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }, 250);
}

const KINDS = [
  { key: "anthropic", label: "Anthropic API key", group: "API key", make: () => ({ kind: "anthropic", id: "anthropic" }), needsKey: true, models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  { key: "openai", label: "OpenAI API key", group: "API key", make: () => ({ kind: "openai-compatible", preset: "openai", id: "openai" }), needsKey: true },
  { key: "gemini", label: "Google Gemini API key", group: "API key", make: () => ({ kind: "openai-compatible", preset: "gemini", id: "gemini" }), needsKey: true },
  { key: "openrouter", label: "OpenRouter API key", group: "API key", make: () => ({ kind: "openai-compatible", preset: "openrouter", id: "openrouter" }), needsKey: true },
  { key: "claude-code", label: "Claude Code (your subscription)", group: "Command-line client", make: () => ({ kind: "cli", profile: "claude-code", id: "claude-code" }), models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  { key: "codex", label: "Codex (your ChatGPT plan)", group: "Command-line client", make: () => ({ kind: "cli", profile: "codex", id: "codex" }) },
  { key: "cli-custom", label: "Other command-line client", group: "Command-line client", make: () => ({ kind: "cli", profile: "custom", id: "cli" }) },
  { key: "ollama", label: "Ollama on this PC", group: "Local model", make: () => ({ kind: "openai-compatible", preset: "ollama", id: "ollama" }) },
  { key: "compat", label: "Other OpenAI-compatible endpoint", group: "Local model", make: () => ({ kind: "openai-compatible", preset: "custom", id: "endpoint" }) },
];
const kindOf = (p) => KINDS.find((k) => { const m = k.make(); return m.kind === p.kind && (m.preset || null) === (p.preset || null) && (m.profile || null) === (p.profile || null); }) || KINDS[0];
const iconOf = (p) => (p.kind === "cli" ? <Terminal size={16} aria-hidden="true" /> : p.preset === "ollama" || (p.baseUrl || "").startsWith("http://") ? <Desktop size={16} aria-hidden="true" /> : <Cloud size={16} aria-hidden="true" />);
const SLOT_TEXT = {
  strong: ["Strong", "Writing studies, grading typed answers, Feynman feedback"],
  fast: ["Fast", "Explain after an attempt, follow-up items, Ask about a card, side questions"],
  vision: ["Vision", "Reading mind-map photos and page images"],
};
const money = (x, digits) => (x == null ? "–" : x === 0 ? "$0.00" : "$" + Number(x).toFixed(digits == null ? (x < 1 ? 4 : 2) : digits));
const num = (x) => (x == null ? "–" : Number(x).toLocaleString("en-GB"));
let callSeq = 0;
const newCallId = () => "c" + Date.now().toString(36) + "-" + (++callSeq);

function useConfig() {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState(null);
  const load = async () => { const r = await M().config(); if (r.ok) { setCfg(r.value); setErr(null); } else setErr(r.error); };
  const apply = (r) => { if (r && r.ok) { if (r.value && r.value.providers) setCfg(r.value); refreshModelStatus(); return true; } App().toast((r && (r.error + (r.advice ? " " + r.advice : ""))) || "Failed"); return false; };
  useEffect(() => { load(); }, []);
  return { cfg, err, load, apply };
}

// ---------------------------------------------------------------- providers
function AddProvider({ cfg, apply, onDone }) {
  const [kindKey, setKindKey] = useState("anthropic");
  const kind = KINDS.find((k) => k.key === kindKey);
  const base = kind.make();
  const preset = cfg.presets.find((p) => p.id === base.preset);
  const profile = cfg.profiles.find((p) => p.id === base.profile);
  const taken = (id) => cfg.providers.some((p) => p.id === id);
  const freeId = (id) => { if (!taken(id)) return id; for (let i = 2; ; i++) if (!taken(id + "-" + i)) return id + "-" + i; };
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF({ id: freeId(base.id), label: "", baseUrl: preset ? preset.baseUrl : "", command: profile ? profile.command : "", args: "", key: "" }); }, [kindKey]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const p = { ...base, id: f.id, label: f.label };
      if (base.kind === "openai-compatible") p.baseUrl = f.baseUrl;
      if (base.kind === "cli") { p.command = f.command; if (base.profile === "custom") p.args = f.args; }
      const r = await M().saveProvider(p, f.key || null);
      if (apply(r)) { App().toast("Provider added"); onDone(f.id); }
    } finally { setBusy(false); }
  };
  const needsKey = kind.needsKey;
  return (
    <div className="md-add" role="group" aria-label="Add a provider">
      <div className="md-grid">
        <label className="k-field"><span className="k-field-label">Kind</span>
          <select className="k-select" value={kindKey} onChange={(e) => setKindKey(e.target.value)}>
            {["API key", "Command-line client", "Local model"].map((g) => <optgroup key={g} label={g}>{KINDS.filter((k) => k.group === g).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</optgroup>)}
          </select>
        </label>
        <label className="k-field"><span className="k-field-label">Name (shown in Kartotek)</span><input value={f.label || ""} onChange={set("label")} placeholder={kind.label} /></label>
        <label className="k-field"><span className="k-field-label">Id</span><input value={f.id || ""} onChange={set("id")} spellCheck={false} /></label>
        {base.kind === "openai-compatible" && <label className="k-field md-wide"><span className="k-field-label">Address</span><input value={f.baseUrl || ""} onChange={set("baseUrl")} spellCheck={false} placeholder="https://… or http://localhost:…/v1" /></label>}
        {base.kind === "cli" && <label className="k-field md-wide"><span className="k-field-label">Command or full path of the client</span><input value={f.command || ""} onChange={set("command")} spellCheck={false} placeholder="claude" /></label>}
        {base.profile === "custom" && <label className="k-field md-wide"><span className="k-field-label">Arguments (the prompt goes to standard input; the reply is read from standard output)</span><input value={f.args || ""} onChange={set("args")} spellCheck={false} /></label>}
        {(needsKey || base.preset === "custom") && <label className="k-field md-wide"><span className="k-field-label">API key{needsKey ? "" : " (optional)"}</span><input type="password" autoComplete="off" value={f.key || ""} onChange={set("key")} spellCheck={false} placeholder={needsKey ? "Paste the key" : "Only if the endpoint needs one"} /></label>}
      </div>
      {base.kind === "cli" && <p className="k-small k-muted">Kartotek runs the client headless in its own empty folder with the prompt on standard input, so it uses the login you already have (for Claude Code: your Claude subscription, signed in once with <code>claude</code>). The client gets no tools and no access to your files.</p>}
      {base.preset === "ollama" && <p className="k-small k-muted">Start Ollama first and pull a model (for example <code>ollama pull llama3.2</code>). Nothing leaves this PC; calls cost nothing.</p>}
      <div className="k-row-btns">
        <Btn kind="primary" disabled={busy || !f.id || (needsKey && !f.key)} onClick={save}><Plus size={15} aria-hidden="true" />Add</Btn>
        <Btn onClick={() => onDone(null)}>Cancel</Btn>
      </div>
    </div>
  );
}

function TestResult({ t }) {
  if (!t) return null;
  if (t.running) return <div className="md-test" aria-live="polite"><span className="md-spin" aria-hidden="true" />{t.status || "Testing…"}{t.text ? <span className="md-stream">{t.text}</span> : null}</div>;
  if (t.error) return <div className="md-test is-bad" role="alert"><Lvl level="bad"><Warning size={14} weight="fill" aria-hidden="true" />{t.error}</Lvl>{t.advice && <span className="k-small">{t.advice}</span>}</div>;
  const r = t.result;
  return (
    <div className="md-test is-ok" aria-live="polite">
      <Lvl level={r.replyMatches ? "ok" : "warn"}>{r.replyMatches ? <CheckCircle size={14} weight="fill" aria-hidden="true" /> : <Warning size={14} weight="fill" aria-hidden="true" />}{r.replyMatches ? "Connection works" : "The model answered, but not with the exact phrase"}</Lvl>
      <span className="md-reply">Reply: “{r.reply}”</span>
      <span className="k-small k-muted">{r.model || "default model"} · {(r.durationMs / 1000).toFixed(1)} s · {r.usageReported ? num(r.usage.input) + " in / " + num(r.usage.output) + " out tokens · " + costText(r) : "the client reports no token counts or cost"}{r.repaired ? " · needed one repair call" : ""}</span>
    </div>
  );
}
function costText(r) {
  if (r.costKind === "free-local") return "free (local)";
  if (r.costKind === "subscription-estimate") return "included in your subscription" + (r.costUsd != null ? " (API-equivalent ≈ " + money(r.costUsd) + ")" : "");
  return r.costUsd == null ? "price unknown (add it under Prices)" : money(r.costUsd);
}

function ProviderRow({ p, cfg, apply }) {
  const [t, setT] = useState(null);
  const [model, setModel] = useState(() => { const s = Object.values(cfg.slots).find((x) => x && x.providerId === p.id); return s ? s.model : (kindOf(p).models || [""])[0]; });
  const [keyEdit, setKeyEdit] = useState(false);
  const [key, setKey] = useState("");
  const call = useRef(null);
  const test = async () => {
    const id = newCallId(); call.current = id;
    setT({ running: true, text: "" });
    let text = "";
    const r = await M().test(id, p.id, model, (ev) => {
      if (ev.type === "text") { text += ev.delta; setT({ running: true, text: text.slice(-160) }); }
      if (ev.type === "status") setT((x) => ({ ...(x || {}), running: true, status: ev.text }));
    });
    call.current = null;
    setT(r.ok ? { result: r.value } : { error: r.error, advice: r.advice });
  };
  const k = kindOf(p);
  const needsKey = k.needsKey;
  return (
    <li className="md-prov">
      <div className="md-prov-head">
        <span className="md-prov-name">{iconOf(p)}<strong>{p.label}</strong><span className="k-small k-muted">{k.label}{p.baseUrl && p.kind !== "anthropic" ? " · " + p.baseUrl : ""}</span></span>
        <span className="md-prov-state">
          {p.kind === "cli" ? (p.executable ? <Lvl level="ok">Found: {p.executable}</Lvl> : <Lvl level="warn">Not found: “{p.command}”</Lvl>)
            : needsKey ? (p.hasKey ? <Lvl level="ok"><Key size={13} aria-hidden="true" />Key stored</Lvl> : <Lvl level="warn">No key</Lvl>) : p.hasKey ? <Lvl level="ok">Key stored</Lvl> : null}
        </span>
      </div>
      <div className="md-prov-actions">
        <label className="k-field md-model"><span className="k-field-label">Model for the test</span>
          <input list={"md-models-" + p.id} value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} placeholder={p.kind === "cli" ? "the client's default" : "model name"} />
          <datalist id={"md-models-" + p.id}>{(k.models || []).map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        {t && t.running ? <Btn onClick={() => call.current && M().cancel(call.current)}><X size={14} aria-hidden="true" />Stop</Btn>
          : <Btn kind="primary" onClick={test} disabled={(needsKey && !p.hasKey) || (p.kind !== "cli" && !model)}><Plugs size={15} aria-hidden="true" />Test connection</Btn>}
        {(needsKey || p.preset === "custom") && <Btn onClick={() => setKeyEdit(!keyEdit)}><Key size={14} aria-hidden="true" />{p.hasKey ? "Replace key" : "Add key"}</Btn>}
        <ArmBtn label="Remove" armedLabel="Remove this provider and its key?" kind="danger" onConfirm={async () => apply(await M().removeProvider(p.id))}><Trash size={14} aria-hidden="true" /></ArmBtn>
      </div>
      {keyEdit && (
        <div className="md-key">
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key" aria-label={"API key for " + p.label} />
          <Btn kind="primary" disabled={!key} onClick={async () => { if (apply(await M().setKey(p.id, key))) { setKey(""); setKeyEdit(false); App().toast("Key stored"); } }}>Store</Btn>
          {p.hasKey && <Btn onClick={async () => { if (apply(await M().clearKey(p.id))) setKeyEdit(false); }}>Delete key</Btn>}
        </div>
      )}
      <TestResult t={t} />
    </li>
  );
}

// ---------------------------------------------------------------- slots
function Slots({ cfg, apply }) {
  return (
    <TableWrap>
      <table className="k-table md-slots">
        <thead><tr><th>Task slot</th><th>Provider</th><th>Model</th></tr></thead>
        <tbody>
          {Object.keys(SLOT_TEXT).map((s) => <SlotRow key={s} slot={s} cfg={cfg} apply={apply} />)}
        </tbody>
      </table>
    </TableWrap>
  );
}
function SlotRow({ slot, cfg, apply }) {
  const cur = cfg.slots[slot] || { providerId: "", model: "" };
  const [model, setModel] = useState(cur.model || "");
  const [models, setModels] = useState([]);
  useEffect(() => { setModel(cur.model || ""); }, [cur.providerId, cur.model]);
  const p = cfg.providers.find((x) => x.id === cur.providerId);
  const save = async (providerId, m) => apply(await M().setSlot(slot, providerId, m));
  const load = async () => { const r = await M().listModels(cur.providerId); if (r.ok) { setModels(r.value.map((x) => x.id)); App().toast(r.value.length + " models"); } else App().toast(r.error); };
  const suggest = models.length ? models : (p ? (kindOf(p).models || []) : []);
  return (
    <tr>
      <td><strong>{SLOT_TEXT[slot][0]}</strong><span className="k-small k-muted md-slot-use">{SLOT_TEXT[slot][1]}</span></td>
      <td>
        <select className="k-select" aria-label={SLOT_TEXT[slot][0] + " provider"} value={cur.providerId || ""} onChange={(e) => { const np = cfg.providers.find((x) => x.id === e.target.value); save(e.target.value, np ? (kindOf(np).models || [""])[0] : ""); }}>
          <option value="">{slot === "strong" ? "Not set" : "Same as Strong"}</option>
          {cfg.providers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </td>
      <td>
        {p ? (
          <div className="md-slot-model">
            <input list={"md-slot-" + slot} aria-label={SLOT_TEXT[slot][0] + " model"} value={model} spellCheck={false} placeholder={p.kind === "cli" ? "the client's default" : "model name"}
              onChange={(e) => setModel(e.target.value)} onBlur={() => { if (model !== (cur.model || "")) save(cur.providerId, model); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
            <datalist id={"md-slot-" + slot}>{suggest.map((m) => <option key={m} value={m} />)}</datalist>
            {p.kind !== "cli" && <button type="button" className="k-btn sm" onClick={load}>Load list</button>}
          </div>
        ) : <span className="k-muted k-small">–</span>}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- usage, budget, prices
function Usage({ cfg, apply }) {
  const [u, setU] = useState(null);
  const [month, setMonth] = useState("");
  const [budget, setBudget] = useState(cfg.budget.monthlyUsd == null ? "" : String(cfg.budget.monthlyUsd));
  const load = async (m) => { const r = await M().usage(m || undefined); if (r.ok) setU(r.value); };
  useEffect(() => { load(month); }, [month]);
  if (!u) return <p className="k-small k-muted">Reading…</p>;
  const b = u.budget;
  const rows = (map) => Object.keys(map).sort().reverse().map((k) => ({ k, ...map[k] }));
  const UsageTable = ({ title, map, first }) => (
    <div className="md-usage-table">
      <h4>{title}</h4>
      {Object.keys(map).length === 0 ? <p className="k-small k-muted">No calls.</p> : (
        <TableWrap>
          <table className="k-table df-table">
            <thead><tr><th>{first}</th><th className="num">Calls</th><th className="num">Tokens in</th><th className="num">Tokens out</th><th className="num">Cost</th></tr></thead>
            <tbody>{rows(map).map((r) => (
              <tr key={r.k}><td>{r.k}{r.failed ? <span className="k-small k-muted"> ({r.failed} failed)</span> : null}</td><td className="num">{r.calls}</td><td className="num">{num(r.input)}</td><td className="num">{num(r.output)}</td>
                <td className="num">{money(r.costUsd)}{r.unpriced ? <span className="k-small k-muted"> + {r.unpriced} unpriced</span> : null}{r.subscriptionEstimateUsd ? <span className="k-small k-muted"> (subscription ≈ {money(r.subscriptionEstimateUsd)})</span> : null}</td></tr>
            ))}</tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
  return (
    <div className="md-usage">
      <div className="md-usage-head">
        <label className="k-field"><span className="k-field-label">Month</span>
          <select className="k-select" value={month || u.month} onChange={(e) => setMonth(e.target.value)}>
            {(u.months.length ? u.months : [u.month]).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <div className="md-kpis">
          <span><b>{u.total.calls}</b> calls</span>
          <span><b>{num(u.total.input + u.total.output)}</b> tokens</span>
          <span><b>{money(u.total.costUsd, 2)}</b> API cost (estimate)</span>
        </div>
      </div>
      <div className="md-budget">
        <label className="k-field"><span className="k-field-label">Monthly budget for API calls (USD)</span>
          <input type="number" min="0" step="1" value={budget} placeholder="no limit" onChange={(e) => setBudget(e.target.value)}
            onBlur={async () => { if (apply(await M().setBudget(budget === "" ? null : Number(budget)))) load(month); }} />
        </label>
        {b.limit != null && (
          <Lvl level={b.over ? "bad" : b.warn ? "warn" : "ok"}>
            {b.over ? <Warning size={14} weight="fill" aria-hidden="true" /> : <CheckCircle size={14} aria-hidden="true" />}
            {money(b.spent, 2)} of {money(b.limit, 2)} used this month ({Math.round((b.ratio || 0) * 100)}%){b.over ? (b.allowedOver ? ". Calls are allowed anyway this month." : ". API calls are paused.") : b.warn ? ". Over 80%." : ""}
          </Lvl>
        )}
        {b.over && !b.allowedOver && <Btn onClick={async () => { if (apply(await M().allowOverBudget())) load(month); }}>Allow calls for the rest of this month</Btn>}
        <p className="k-small k-muted">The budget counts API-key calls priced from the table below. Subscription clients and local models are not counted; the connection test always runs.</p>
      </div>
      <div className="md-usage-tables">
        <UsageTable title="Per day" map={u.byDay} first="Day" />
        <UsageTable title="Per feature" map={u.byFeature} first="Feature" />
        <UsageTable title="Per model" map={u.byModel} first="Provider · model" />
      </div>
    </div>
  );
}

function Prices({ cfg, apply }) {
  const [f, setF] = useState({ model: "", input: "", output: "", cacheRead: "" });
  const shipped = cfg.shippedPrices.models, edits = cfg.prices;
  const all = Array.from(new Set(Object.keys(shipped).concat(Object.keys(edits)))).sort();
  return (
    <div className="md-prices">
      <p className="k-small k-muted">Dollars per million tokens. {cfg.shippedPrices.note}</p>
      <TableWrap>
        <table className="k-table df-table">
          <thead><tr><th>Model</th><th className="num">Input</th><th className="num">Output</th><th className="num">Cache read</th><th></th></tr></thead>
          <tbody>{all.map((m) => { const p = edits[m] || shipped[m]; return (
            <tr key={m}><td>{m}{edits[m] ? <span className="k-small k-muted"> (yours)</span> : null}</td><td className="num">{p.input}</td><td className="num">{p.output}</td><td className="num">{p.cacheRead != null ? p.cacheRead : "–"}</td>
              <td>{edits[m] && <button type="button" className="k-btn sm" onClick={async () => apply(await M().setPrice(m, null))}>{shipped[m] ? "Use shipped" : "Remove"}</button>}</td></tr>); })}</tbody>
        </table>
      </TableWrap>
      <div className="md-price-add">
        {["model", "input", "output", "cacheRead"].map((k) => (
          <label key={k} className="k-field"><span className="k-field-label">{{ model: "Model", input: "Input", output: "Output", cacheRead: "Cache read (optional)" }[k]}</span>
            <input value={f[k]} type={k === "model" ? "text" : "number"} min="0" step="0.01" spellCheck={false} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
        ))}
        <Btn disabled={!f.model || f.input === "" || f.output === ""} onClick={async () => { if (apply(await M().setPrice(f.model, { input: f.input, output: f.output, cacheRead: f.cacheRead }))) setF({ model: "", input: "", output: "", cacheRead: "" }); }}><Plus size={14} aria-hidden="true" />Set price</Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- prompt files
function Prompts() {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [text, setText] = useState("");
  const load = async () => { const r = await PR().list(); if (r.ok) setList(r.value); };
  useEffect(() => { load(); }, []);
  const edit = async (id) => { const r = await PR().get(id); if (r.ok) { setOpen(r.value); setText(r.value.overrideText != null ? r.value.overrideText : r.value.defaultText); } };
  const save = async () => { const r = await PR().saveOverride(open.id, text); if (r.ok) { App().toast("Prompt saved"); setOpen(r.value); load(); } else App().toast(r.error); };
  const reset = async () => { const r = await PR().resetOverride(open.id); if (r.ok) { setOpen(r.value); setText(r.value.defaultText); load(); App().toast("Back to the shipped text"); } };
  if (!list) return null;
  return (
    <div className="md-prompts">
      <p className="k-small k-muted">The instructions the app sends to the model, one file per task. Your edits are saved in the Kartotek data folder and replace the shipped text; placeholders such as <code>{"{{phrase}}"}</code> must stay.</p>
      <ul className="md-prompt-list">
        {list.map((p) => (
          <li key={p.id}>
            <button type="button" className="k-btn sm" onClick={() => edit(p.id)} aria-expanded={open && open.id === p.id}>{p.title}</button>
            <span className="k-small k-muted">version {p.version} · {p.slot || "any"} slot · {p.edited ? "edited" : "shipped"}</span>
            {p.defaultChanged && <Lvl level="warn">The shipped text changed since your edit</Lvl>}
          </li>
        ))}
      </ul>
      {open && (
        <div className="md-prompt-edit">
          <div className="md-prompt-cols">
            <label className="k-field"><span className="k-field-label">Your text</span><textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} /></label>
            <div className="k-field"><span className="k-field-label">Shipped text (version {open.meta.version})</span><pre className="md-prompt-default">{open.defaultText}</pre></div>
          </div>
          <div className="k-row-btns">
            <Btn kind="primary" onClick={save}>Save</Btn>
            {open.overrideText != null && <Btn onClick={reset}><ArrowCounterClockwise size={14} aria-hidden="true" />Reset to default</Btn>}
            <Btn onClick={() => setOpen(null)}>Close</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the panel
export default function ModelsPanel() {
  if (!M()) {
    return (
      <Panel title="Models" id="models-panel">
        <p className="k-small">Connecting Kartotek to a model (an API key, your Claude Code or Codex subscription, or a local model) works in the desktop app. In this page, the AI buttons open Claude Code or copy the prompt.</p>
      </Panel>
    );
  }
  return <ModelsPanelDesktop />;
}

function ModelsPanelDesktop() {
  const { cfg, err, apply } = useConfig();
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState("providers");
  if (err) return <Panel title="Models" id="models-panel"><Lvl level="bad">{err}</Lvl></Panel>;
  if (!cfg) return <Panel title="Models" id="models-panel"><p className="k-small k-muted">Reading…</p></Panel>;
  const tabs = [["providers", "Providers and slots"], ["usage", "Usage and budget"], ["prices", "Prices"], ["prompts", "Prompts"]];
  return (
    <Panel title="Models" id="models-panel" className="md-panel">
      <p className="k-small">Kartotek can use a model for Explain, follow-up items, feedback and writing studies. Without one, everything else works as before and the AI buttons open Claude Code or copy the prompt.</p>
      <div className="k-seg md-tabs" role="tablist" aria-label="Models sections">
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "providers" && (
        <>
          <h3 className="md-h">Providers</h3>
          {cfg.providers.length === 0 && !adding && <p className="k-small k-muted"><Robot size={14} aria-hidden="true" /> No provider yet.</p>}
          <ul className="md-provs">{cfg.providers.map((p) => <ProviderRow key={p.id} p={p} cfg={cfg} apply={apply} />)}</ul>
          {adding ? <AddProvider cfg={cfg} apply={apply} onDone={() => setAdding(false)} /> : <Btn onClick={() => setAdding(true)}><Plus size={15} aria-hidden="true" />Add a provider</Btn>}
          <p className="k-small k-muted md-keynote">Keys are encrypted with Windows' own protection for your account (DPAPI) and stored in the Kartotek data folder. They never appear in your data, backups or exports. Windows protects them from other users of this PC, not from other programs that run as you.</p>
          <h3 className="md-h">Task slots</h3>
          {cfg.providers.length ? <Slots cfg={cfg} apply={apply} /> : <p className="k-small k-muted">Add a provider first.</p>}
          <ResearchPanel />
        </>
      )}
      {tab === "usage" && <Usage cfg={cfg} apply={apply} />}
      {tab === "prices" && <Prices cfg={cfg} apply={apply} />}
      {tab === "prompts" && <Prompts />}
    </Panel>
  );
}
