// Small helpers shared by the Cards and Settings tabs
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Btn } from "./kit.jsx";

// Two-click confirmation like the legacy App.armConfirm (4 s window), with any button style
export function ArmBtn({ label, armedLabel, onConfirm, kind, size = "sm", children, ...rest }) {
  const [armed, setArmed] = useState(false);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <Btn kind={kind} size={size} data-armed={armed ? "1" : undefined} {...rest}
      onClick={() => {
        if (armed) { clearTimeout(t.current); setArmed(false); onConfirm(); return; }
        setArmed(true); t.current = setTimeout(() => setArmed(false), 4000);
      }}>
      {!armed && children}
      {armed ? armedLabel : label}
    </Btn>
  );
}

// Native "change" event (fires on commit: blur, Enter, spinner, slider release) instead of React's per-keystroke onChange
export function useNativeChange(fn) {
  const ref = useRef(null);
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const h = (e) => cb.current(e);
    el.addEventListener("change", h);
    return () => el.removeEventListener("change", h);
  }, []);
  return ref;
}

// Uncontrolled input that saves on the native change event. After every redraw it shows the stored
// value again (`sync`, or `syncChecked` for a checkbox) unless it has focus, like the legacy full redraw.
export function CommitInput({ onCommit, sync, syncChecked, ...rest }) {
  const ref = useNativeChange((e) => onCommit(e.target));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el === document.activeElement) return;
    if (syncChecked !== undefined) el.checked = !!syncChecked;
    else if (sync !== undefined && el.value !== String(sync)) el.value = String(sync);
  });
  return <input ref={ref} {...rest} />;
}
