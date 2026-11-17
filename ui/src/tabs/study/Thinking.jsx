// "Your thinking" (task F1, LEARNING-PROTOCOL 3.1): an optional free-text box next to an answer, a reading note, a probe answer or a
// practice problem. Never required, never evidence; stored as typed (up to 4000 characters) with the record it belongs to. The box is
// collapsible and remembers whether it was open. "Dictate" opens Windows voice typing at the cursor (task F8, decision D9; ui\src\Dictate.jsx).
import React, { useRef, useState } from "react";
import Dictate from "../../Dictate.jsx";
import "./confidence.css";

const PREF = "kartotek-thinking-open";
const getOpen = () => { try { return window.App.pref(PREF) !== "0"; } catch (e) { return true; } };

// forceOpen: the box is the main work area (practice) and cannot be folded away
export default function Thinking({ value, onChange, label, placeholder, rows, disabled, id, forceOpen }) {
  const [open, setOpen] = useState(getOpen);
  const ref = useRef(null);
  const toggle = (e) => { setOpen(e.currentTarget.open); try { window.App.setPref(PREF, e.currentTarget.open ? "1" : "0"); } catch (x) { /* ignore */ } };
  return (
    <details className="th" open={forceOpen || open} onToggle={forceOpen ? undefined : toggle}>
      <summary>{label || "Your thinking (optional)"}</summary>
      <textarea ref={ref} id={id} data-f="thinking" className="k-input" rows={rows || 3} maxLength={4000} disabled={disabled} value={value}
        placeholder={placeholder || "How are you working this out? Write it as it comes; it does not need to be tidy."} onChange={(e) => onChange(e.target.value)} />
      <div className="th-foot">
        <Dictate targetRef={ref} disabled={disabled} onBeforeStart={() => setOpen(true)} />
        <span className="k-small k-muted">Kept with your answer; never required, never graded.</span>
      </div>
    </details>
  );
}
