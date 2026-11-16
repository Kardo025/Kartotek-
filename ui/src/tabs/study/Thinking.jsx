// "Your thinking" (task F1, LEARNING-PROTOCOL 3.1): an optional free-text box next to an answer, a reading note, a probe answer or a
// practice problem. Never required, never evidence; stored as typed (up to 4000 characters) with the record it belongs to. The box is
// collapsible and remembers whether it was open. "Dictate" focuses the box and shows the Windows voice-typing shortcut (decision D9).
import React, { useRef, useState } from "react";
import { Microphone } from "@phosphor-icons/react";
import "./confidence.css";

const PREF = "kartotek-thinking-open";
const getOpen = () => { try { return window.App.pref(PREF) !== "0"; } catch (e) { return true; } };

export default function Thinking({ value, onChange, label, placeholder, rows, disabled, id }) {
  const [open, setOpen] = useState(getOpen);
  const [hint, setHint] = useState(false);
  const ref = useRef(null);
  const toggle = (e) => { setOpen(e.currentTarget.open); try { window.App.setPref(PREF, e.currentTarget.open ? "1" : "0"); } catch (x) { /* ignore */ } };
  const dictate = () => { setOpen(true); setHint(true); setTimeout(() => { if (ref.current) ref.current.focus(); }, 30); };
  return (
    <details className="th" open={open} onToggle={toggle}>
      <summary>{label || "Your thinking (optional)"}</summary>
      <textarea ref={ref} id={id} data-f="thinking" className="k-input" rows={rows || 3} maxLength={4000} disabled={disabled} value={value}
        placeholder={placeholder || "How are you working this out? Write it as it comes; it does not need to be tidy."} onChange={(e) => onChange(e.target.value)} />
      <div className="th-foot">
        <button type="button" className="k-btn sm" disabled={disabled} onClick={dictate} title="Focuses the box. Press the Windows key and H to speak instead of typing."><Microphone size={14} aria-hidden="true" />Dictate</button>
        {hint && <span className="k-small k-muted">Press <kbd>Win</kbd> + <kbd>H</kbd> and speak.</span>}
        <span className="k-small k-muted">Kept with your answer; never required, never graded.</span>
      </div>
    </details>
  );
}
