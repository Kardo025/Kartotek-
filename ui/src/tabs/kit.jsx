// Shared building blocks for the React tabs. Styles live in ../index.css (k-* classes) and ./kit.css.
import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import "./kit.css";

export const EASE = [0.23, 1, 0.32, 1];
export const A = () => window.App;

export function PageHead({ title, sub, children }) {
  return (
    <div className="k-head">
      <div className="k-head-title">
        <h1>{title}</h1>
        {sub}
      </div>
      {children && <div className="k-head-actions">{children}</div>}
    </div>
  );
}

export function Panel({ title, actions, className = "", children, ...rest }) {
  return (
    <section className={"k-panel k-sec " + className} {...rest}>
      {(title || actions) && (
        <div className="k-sec-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="k-row-btns">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Btn({ kind, size, className = "", ...rest }) {
  const cls = ["k-btn", kind, size, className].filter(Boolean).join(" ");
  return <motion.button type="button" whileTap={{ scale: 0.97 }} className={cls} {...rest} />;
}

// Two-step destructive button: first click arms it, second click within 3 s confirms
export function ConfirmBtn({ label, confirmLabel = "Click again to confirm", onConfirm, size = "sm", ...rest }) {
  const [armed, setArmed] = useState(false);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <Btn kind="danger" size={size} data-armed={armed ? "1" : undefined} {...rest}
      onClick={() => {
        if (armed) { clearTimeout(t.current); setArmed(false); onConfirm(); return; }
        setArmed(true); t.current = setTimeout(() => setArmed(false), 3000);
      }}>
      {armed ? confirmLabel : label}
    </Btn>
  );
}

// Card state pill: new | learning | review | relearning
export function State({ s, children }) {
  return <span className="k-state" data-s={s}>{children || (A().STATE_TR[s] || s)}</span>;
}
// Level chip: ok | warn | bad | mid
export function Lvl({ level = "mid", children }) {
  return <span className="k-lvl" data-l={level}>{children}</span>;
}
export function Tag({ children, tone }) {
  return <span className="k-tag" data-tone={tone}>{children}</span>;
}

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={"k-field " + className}>
      <span className="k-field-label">{label}</span>
      {children}
      {hint && <span className="k-field-hint">{hint}</span>}
    </label>
  );
}

export function Kpi({ label, value, sub, children }) {
  return (
    <div className="k-kpi">
      <div className="k-kpi-label">{label}</div>
      <div className="k-kpi-value k-num">{value}</div>
      {sub && <div className="k-kpi-sub">{sub}</div>}
      {children}
    </div>
  );
}

export function TableWrap({ children }) {
  return <div className="k-table-wrap">{children}</div>;
}

// Segmented tabs inside a page
export function Seg({ value, options, onChange, label }) {
  return (
    <div className="k-subtabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={"seg-" + label} className="k-subtabs-bg" transition={{ type: "spring", duration: 0.3, bounce: 0.1 }} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// Progress bar that grows into place
export function Bar({ value, tone }) {
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className="k-bar" data-tone={tone}>
      <motion.span initial={{ scaleX: 0 }} animate={{ scaleX: v }} transition={{ duration: 0.8, ease: EASE }} />
    </div>
  );
}

// Engine-made SVG/HTML (charts, diagrams). afterMount lets the caller bind tooltips etc.
export function Html({ html, className, afterMount, as: Tag = "div" }) {
  const ref = useRef(null);
  useEffect(() => { if (afterMount && ref.current) afterMount(ref.current); }, [html]);
  return <Tag ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Fade/rise for content that appears after an action (not for page load)
export function Appear({ children, k, className }) {
  return (
    <motion.div key={k} className={className} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      {children}
    </motion.div>
  );
}

// Redraw helper: most engine calls end with App.render(), which already redraws React.
export const rerender = () => A().render();
