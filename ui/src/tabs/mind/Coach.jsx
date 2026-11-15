// Coach: ask Claude Code for one coaching turn about a part of your map; read its turns (newest first).
// Claude picks one step at a time; help you ask for is given and recorded as exposure.
import React, { useState } from "react";
import { ChatCircleText, Warning, ArrowRight, Target } from "@phosphor-icons/react";
import { Panel, Btn, Tag, Lvl } from "../kit.jsx";
import { Md } from "../study/common.jsx";
import { App, KM, save, when, viewName } from "./util.js";
import { Waiting, makeRequest, Empty } from "./parts.jsx";

const MODES = [
  ["coach", "Coach — one question or a small hint"],
  ["diagnose", "Diagnose — point out possible problems to check with me"],
  ["worked_example", "Worked example — show one small part, then give me a similar task"],
  ["capture", "Capture — keep my raw notes, infer nothing"],
];
const STATE_LABEL = {
  INTERPRETATION_REVIEW: "Checking the reading", TARGETED_CONFIRMATION: "Confirming a mark", GOAL_AND_BASELINE: "Goal",
  DRAFT: "Draft", GROUP: "Grouping", RELATE: "Connections", INTEGRATE: "Linking groups", COMPARE_ALTERNATIVES: "Other structures",
  EMPHASIZE_AND_COMPRESS: "What matters most", EXPLAIN: "Explaining", RETRIEVE_OR_APPLY: "Recall / apply", REVIEW_PLAN: "Plan",
  HELP: "Help", PAUSED: "Paused", COMPLETE: "Done",
};
const STATUS_LVL = { demonstrated: "ok", developing: "mid", needs_support: "warn", not_observed: "mid" };

export default function Coach({ doc, parse, goTab, onStartTarget }) {
  const map = KM().currentMap(doc);
  const rep = KM().scopeReport(parse, doc);
  const [mode, setMode] = useState("coach");
  const [scope, setScope] = useState("all");
  const [msg, setMsg] = useState("");
  const [hint, setHint] = useState(0);
  const [help, setHelp] = useState(false);
  const scopeOpts = [["all", "The whole readable map"]]
    .concat((parse.views || []).map((v) => ["view:" + v.id, "Photo " + viewName(v)]))
    .concat(map.groups.map((g) => ["group:" + g.id, "Group “" + g.label + "”"]))
    .concat((parse.objects || []).map((o) => ["object:" + o.id, (o.title || o.id) + " (" + o.kind.replace(/_/g, " ") + ")"]));
  const toScope = (s) => (s === "all" ? { kind: "all" } : { kind: s.split(":")[0], id: s.slice(s.indexOf(":") + 1) });
  const ask = () => {
    const req = { mode, scope: toScope(scope), message: msg.trim(), hintLevel: help ? 4 : hint, help };
    makeRequest(doc, "coach", { mode, scope: req.scope, message: req.message }, (rq) => KM().coachPrompt(doc, parse, rq, req));
    setMsg("");
  };
  const turns = doc.turns.slice().reverse();
  return (
    <div className="mm-col">
      <Panel title="Ask the coach">
        <p className="mm-hint">Kartotek writes the request; Claude Code on your PC answers it and writes the turn into the map's folder. It works on what you wrote, one step at a time. Without a course source it checks structure and wording, not facts.</p>
        {rep.blocking.length > 0 && (
          <p className="mm-warn"><Warning size={16} aria-hidden="true" /><span className="mm-warn-t">{rep.blocking.length} mark(s) are still unclear in a way that changes feedback. The coach will ask about those first, or leave that part out.</span>
            <button type="button" className="k-btn sm" onClick={() => goTab("reading")}>Answer in Reading</button></p>
        )}
        <div className="mm-form">
          <label className="k-field"><span className="k-field-label">Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="k-field"><span className="k-field-label">Part of the map</span>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>{scopeOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="k-field mm-span2"><span className="k-field-label">Your message (optional)</span>
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. I am not sure how the controller and the system bus fit together." />
          </label>
          <label className="k-field"><span className="k-field-label">Help allowed</span>
            <select value={hint} disabled={help} onChange={(e) => setHint(+e.target.value)}>
              {KM().HINTS.slice(0, 4).map((h, i) => <option key={i} value={i}>{h}</option>)}
            </select>
          </label>
          <label className="k-check mm-help"><input type="checkbox" checked={help} onChange={(e) => setHelp(e.target.checked)} /> Explain it to me (up to H4; recorded, so a later check on it counts as assisted until time has passed)</label>
        </div>
        <div className="mm-btnrow">
          <Btn kind="primary" onClick={ask}><ChatCircleText size={16} aria-hidden="true" /> Prepare the request</Btn>
          <span className="mm-muted">Mode “Retrieval check” is in the Checks tab; “Reference map” is in its own tab.</span>
        </div>
        <Waiting doc={doc} kinds={["coach"]} />
      </Panel>
      {turns.length === 0 ? (
        <Panel><Empty title="No coaching turns yet">Prepare a request above, open it in Claude Code and press Enter. After it builds, reload Kartotek.</Empty></Panel>
      ) : turns.map((t) => <Turn key={t.turn} t={t} doc={doc} map={map} goTab={goTab} onStartTarget={onStartTarget} />)}
    </div>
  );
}

function Turn({ t, doc, map, goTab, onStartTarget }) {
  const rq = doc.requests.find((r) => r.id === t.request_id);
  const patch = t.patch_id && doc.patches.find((p) => p.id === t.patch_id);
  const ob = t.observation;
  const na = t.next_action || {};
  return (
    <Panel className="mm-turn">
      <div className="mm-turn-head">
        <b>Turn {t.turn}</b>
        <Tag tone="accent">{KM().MODE_LABEL[t.mode] || t.mode}</Tag>
        {t.state && <Tag>{STATE_LABEL[t.state] || t.state}</Tag>}
        <span className="mm-muted">on map v{t.based_on_version} · {when(t.created_at || t.at)}</span>
      </div>
      {rq && rq.message && <p className="mm-you"><span>You:</span> {rq.message}</p>}
      <Md src={t.message} className="mm-turn-msg" />
      {ob && (
        <div className="mm-obsv">
          <div className="mm-mark-tags">
            <Tag>{KM().DIM_LABEL[ob.dimension] || ob.dimension}</Tag>
            <Lvl level={STATUS_LVL[ob.status] || "mid"}>{(ob.status || "").replace(/_/g, " ")}</Lvl>
          </div>
          {ob.basis && <p><b>Seen:</b> {ob.basis}</p>}
          {(ob.evidence || []).length > 0 && (
            <ul className="mm-ev">{ob.evidence.map((e, i) => {
              const s = doc.sources.find((x) => x.id === e.source);
              return <li key={i}>“{e.quote}” <span className="mm-muted">— {(s && (s.title || s.path)) || e.source}{e.page ? ", p. " + e.page : ""}</span></li>;
            })}</ul>
          )}
          {ob.uncertainty && <p className="mm-muted">{ob.uncertainty}</p>}
        </div>
      )}
      {(t.withheld || []).length > 0 && (
        <div className="mm-withheld">
          <b>Not judged</b>
          <ul className="mm-plain">{t.withheld.map((w, i) => <li key={i}>{w.judgment}{w.needs ? " — needs " + w.needs : ""}</li>)}</ul>
        </div>
      )}
      {na.type && na.type !== "none" && (
        <div className="mm-next">
          <ArrowRight size={16} aria-hidden="true" />
          <div>
            <b>Next</b> {na.prompt}
            <div className="mm-mark-tags">
              <Tag>{KM().HINTS[na.hint_level || 0]}</Tag>
              {na.answer_exposed && <Lvl level="warn">answer shown · later checks on it count as assisted</Lvl>}
            </div>
          </div>
        </div>
      )}
      {patch && (
        <p className="mm-patchref">Proposed a change to your map ({patch.status}).
          {patch.status === "proposed" && <button type="button" className="k-btn sm" onClick={() => goTab("map")}>Review in Map</button>}</p>
      )}
      {(t.target_ids || []).length > 0 && (
        <div className="mm-btnrow">
          {t.target_ids.map((id) => {
            const tg = doc.targets.find((x) => x.id === id);
            return tg ? <Btn key={id} size="sm" onClick={() => onStartTarget(id)}><Target size={14} aria-hidden="true" /> Check: {tg.prompt.slice(0, 60)}{tg.prompt.length > 60 ? "…" : ""}</Btn> : null;
          })}
        </div>
      )}
      {(t.warnings || []).length > 0 && <ul className="mm-plain mm-muted">{t.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </Panel>
  );
}
