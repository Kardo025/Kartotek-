// Side questions (task F7, LEARNING-PROTOCOL 3.11): "Ask about this" opens a panel beside the screen. The question goes to
// prompts\side-answerer.md with what is on screen (src/side-core.js builds it; an open item or problem without its key and solution).
// The answer is brief and never changes the main flow. Opening the panel during an open attempt calls onOpen (the screen records it as
// help, like the lesson pane). The exchanges are kept in `list` (progress.side or session.side).
import React, { useEffect, useRef, useState } from "react";
import { ChatCircleText, X, ArrowRight, Warning, Info } from "@phosphor-icons/react";
import { Btn } from "./tabs/kit.jsx";
import { Md } from "./tabs/study/common.jsx";
import { useModelReady, useModelCall, CallStatus, byLine } from "./model-call.jsx";
import { CheckThis } from "./research.jsx";
import "./research.css";

const KS = () => window.KSide;

export default function SidePanel({ ctx, list, save, onOpen, helpNote }) {
  const mr = useModelReady("fast");
  const call = useModelCall();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const opened = useRef(false);
  const inputRef = useRef(null);
  useEffect(() => { opened.current = false; }, [JSON.stringify(ctx && ctx.ref)]);
  if (!mr.ready || !ctx || !list) return null;
  const here = list.filter((e) => JSON.stringify(e.ref) === JSON.stringify(ctx.ref));
  const show = () => {
    setOpen(true);
    if (!opened.current) { opened.current = true; if (onOpen) onOpen(); }
    setTimeout(() => inputRef.current && inputRef.current.focus(), 40);
  };
  const ask = async () => {
    const question = q.trim();
    if (!question) return;
    let problems = [];
    for (let n = 0; n < 2; n++) {
      const r = await call.run("side-answerer", KS().askInputs(ctx, question + (problems.length ? "\n(Previous answer problems: " + problems.join(" ") + ")" : ""), here), { feature: "side-answerer", maxOutputTokens: 1500 });
      if (!r.ok) return;
      problems = KS().checkAnswer(ctx, r.json);
      if (!problems.length) { KS().record(list, ctx, question, r.json, { meta: r.meta, prompt: r.prompt, now: Date.now() }); setQ(""); save(); return; }
    }
    call.fail("The answer could not be used: " + problems.join(" "));
  };
  if (!open) return <button type="button" className="sp-fab" onClick={show} title="Ask something about what is on screen. The answer is brief and does not change what you are doing."><ChatCircleText size={16} aria-hidden="true" />Ask about this</button>;
  return (
    <aside className="sp-drawer" aria-label="Side questions">
      <div className="sp-head"><ChatCircleText size={18} aria-hidden="true" /><h2>Ask about this</h2><Btn size="sm" onClick={() => setOpen(false)} aria-label="Close"><X size={14} aria-hidden="true" /></Btn></div>
      <p className="k-small k-muted"><Info size={13} aria-hidden="true" /> {ctx.kind === "lesson" ? "About this lesson. Answers come from the lesson and its sources first." : ctx.kind === "item" ? "About this question." : ctx.kind === "live" ? "About this step of the session." : "About this problem."}{ctx.open ? " It is still open, so its answer stays hidden here." : ""}{helpNote ? " " + helpNote : ""}</p>
      <ul className="sp-list">
        {here.map((e) => (
          <li key={e.id}>
            <span className="sp-q">{e.q}</span>
            <div className="sp-a">
              <Md src={e.answer} className="st-md" />
              {e.uses.length > 0 && <div className="sp-uses">{e.uses.map((u) => <span key={u}>{u}</span>)}</div>}
              {e.beyond_source && <p className="k-small k-lvl" data-l="warn"><Warning size={12} aria-hidden="true" /> Goes beyond what is on screen.</p>}
              {e.uncertain && <p className="k-small k-lvl" data-l="warn"><Warning size={12} aria-hidden="true" /> The helper is not sure about this.</p>}
              {(e.beyond_source || e.uncertain) && <CheckThis claim={e.answer.slice(0, 400)} context={"Side answer to: " + e.q} target={{ kind: "side", id: e.id }} editable compact />}
              {e.by && e.by.model && <p className="k-small k-muted">{byLine({ provider: e.by.provider, model: e.by.model })}</p>}
            </div>
          </li>
        ))}
      </ul>
      <textarea ref={inputRef} className="k-input" rows={3} value={q} maxLength={1200} placeholder="Your question" onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask(); } }} />
      <div className="cy-actions"><Btn kind="primary" size="sm" disabled={call.busy || !q.trim()} onClick={ask}>Ask<ArrowRight size={14} weight="bold" aria-hidden="true" /></Btn><span className="k-small k-muted">Ctrl + Enter</span></div>
      <CallStatus call={call} />
    </aside>
  );
}
