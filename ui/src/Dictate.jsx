// Dictation (task F8, LEARNING-PROTOCOL 3.13, decision D9): a microphone button for a text box. In the desktop app it keeps or puts
// the cursor in the box and opens Windows voice typing there (desktop\dictation.js presses Win + H); Windows writes the spoken text
// at the cursor, and it stays ordinary, editable text. In the browser page, or if that fails, it focuses the box and shows the
// shortcut. No audio and no key pass through Kartotek.
import React, { useEffect, useState } from "react";
import { Microphone } from "@phosphor-icons/react";

const D = () => window.kartotek && window.kartotek.dictation;
let statusCache = null;
function readStatus() {
  if (!D()) return Promise.resolve({ mode: null });
  if (statusCache) return Promise.resolve(statusCache);
  return D().status().then((r) => (statusCache = r && r.ok ? r.value : { mode: null }), () => ({ mode: null }));
}

// targetRef: the textarea; onBeforeStart: e.g. unfold the box that holds it
export default function Dictate({ targetRef, onBeforeStart, disabled, label }) {
  const [st, setSt] = useState(statusCache || { mode: null });
  const [msg, setMsg] = useState(null);   // { kind: "on" | "hint" | "error", text }
  useEffect(() => { let live = true; readStatus().then((s) => { if (live) setSt(s); }); return () => { live = false; }; }, []);

  const focusBox = () => {
    const el = targetRef && targetRef.current;
    if (!el) return;
    if (document.activeElement !== el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) { /* not a text box */ } }
  };
  const go = async () => {
    if (onBeforeStart) onBeforeStart();
    await new Promise((r) => setTimeout(r, 40));   // let a folded box open before focusing it
    focusBox();
    if (st.mode !== "voice-typing" || !D()) { setMsg({ kind: "hint", text: "hint" }); return; }
    const r = await D().start().catch((e) => ({ ok: false, error: e && e.message }));
    focusBox();
    if (r && r.ok) setMsg({ kind: "on", text: "Voice typing is open: speak, and your words appear at the cursor. It stops after a pause; press Dictate to go on." });
    else setMsg({ kind: "error", text: ((r && r.error) || "Voice typing did not open.") });
  };

  return (
    <>
      {/* mousedown is prevented so the box keeps its cursor position while the button is pressed */}
      <button type="button" className="k-btn sm dc-btn" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={go}
        title={st.mode === "voice-typing" ? "Opens Windows voice typing at the cursor in this box." : "Focuses the box. Press the Windows key and H to speak instead of typing."}
        aria-label={label || "Dictate"}>
        <Microphone size={14} weight={msg && msg.kind === "on" ? "fill" : "regular"} aria-hidden="true" />{label || "Dictate"}
      </button>
      {msg && msg.kind === "on" && <span className="k-small k-muted" role="status">{msg.text}</span>}
      {msg && msg.kind === "hint" && <span className="k-small k-muted" role="status">Press <kbd>Win</kbd> + <kbd>H</kbd> and speak.</span>}
      {msg && msg.kind === "error" && <span className="k-small k-muted" role="status">{msg.text} Press <kbd>Win</kbd> + <kbd>H</kbd> instead.</span>}
    </>
  );
}
