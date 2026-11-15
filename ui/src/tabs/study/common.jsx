// Small building blocks shared by the Study screens
import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle, XCircle, Warning, Lightbulb, WarningOctagon, Sparkle } from "@phosphor-icons/react";
import { EASE, Btn, Html } from "../kit.jsx";
import { A, KE, KM, EU, missingReqs, stripTags } from "./util.js";

export { Html };

export function Md({ src, className = "", as }) {
  return <Html as={as} className={"st-md " + className} html={KE().renderMd(src || "")} />;
}
export function Inl({ src, className }) {
  return <Html as="span" className={className} html={EU().inl(src || "")} />;
}

// Level/verdict chip with an icon (ok | warn | bad)
export function Verdict({ level, children }) {
  const Icon = level === "ok" ? CheckCircle : level === "bad" ? XCircle : Warning;
  return (
    <span className="k-lvl st-verdict" data-l={level}>
      <Icon size={14} weight="fill" aria-hidden="true" />{children}
    </span>
  );
}

export function Chip({ children, title, tone }) {
  return <span className="k-tag st-chip-tag" data-tone={tone} title={title}>{children}</span>;
}

export function LevelChip({ lv }) {
  return <Chip title={lv.reason} tone="accent">Prompts: {KM().LEVEL_TR[lv.level]}{lv.auto ? " · auto" : ""}</Chip>;
}

export function SlidesRef({ slides }) {
  const t = stripTags(EU().slidesRef(slides));
  return t ? <Chip>{t}</Chip> : null;
}

// Radio-style choice row; values are kept as strings like the legacy form
export function Scale({ opts, value, onPick, className = "", label, wide }) {
  return (
    <div className={"st-scale " + (wide ? "wide " : "") + className} role="radiogroup" aria-label={label}>
      {opts.map((o) => {
        const on = value != null && String(value) === String(o.v);
        return (
          <motion.button key={String(o.v)} type="button" className="st-choice" data-on={on ? "1" : undefined} role="radio" aria-checked={on}
            title={o.title} whileTap={{ scale: 0.97 }} onClick={() => onPick(String(o.v))} {...(o.attrs || {})}>
            <motion.span key={on ? "on" : "off"} className="st-choice-in" initial={on ? { scale: 0.9 } : false} animate={{ scale: 1 }} transition={{ duration: 0.22, ease: EASE }}>
              {o.icon}{o.label}
            </motion.span>
          </motion.button>
        );
      })}
    </div>
  );
}

// Primary action with required-field check: disabled + "Missing: …" hint, as in the legacy view
export function ReqAction({ req, form, onClick, children, kind = "primary", extra, note, id, disabled }) {
  const missing = req ? missingReqs(req, form) : [];
  return (
    <div className="st-actions">
      <Btn kind={kind} id={id} disabled={disabled || missing.length > 0} onClick={onClick}>{children}</Btn>
      {extra}
      {missing.length > 0 && <span className="k-small k-muted st-req">Missing: {missing.join(", ")}</span>}
      {note && <span className="k-small k-muted">{note}</span>}
    </div>
  );
}

export function Actions({ children }) { return <div className="st-actions">{children}</div>; }

// Two-step confirmation (the legacy armConfirm): first click arms, second within 3 s confirms
export function Confirm({ label, confirmLabel, onConfirm, kind = "", size = "sm", icon }) {
  const [armed, setArmed] = useState(false);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <Btn kind={armed ? "danger" : kind} size={size} data-armed={armed ? "1" : undefined}
      onClick={() => {
        if (armed) { clearTimeout(t.current); setArmed(false); onConfirm(); return; }
        setArmed(true); t.current = setTimeout(() => setArmed(false), 3000);
      }}>
      {icon}{armed ? confirmLabel : label}
    </Btn>
  );
}

export function Callout({ tone = "tip", label, children, className = "" }) {
  const Icon = tone === "warn" ? WarningOctagon : tone === "star" ? Sparkle : Lightbulb;
  return (
    <div className={"st-callout " + className} data-tone={tone}>
      <span className="st-callout-label"><Icon size={15} weight="fill" aria-hidden="true" />{label}</span>
      {children}
    </div>
  );
}

export function KzHead({ chips, title, children }) {
  return (
    <div className="st-kz-head">
      {chips && <div className="st-chips">{chips}</div>}
      {title && <h2>{title}</h2>}
      {children}
    </div>
  );
}

export function RecallCard({ label, children }) {
  return (
    <div className="st-recall-card">
      <span className="st-label">{label}</span>
      <div className="st-recall-q">{children}</div>
    </div>
  );
}

// Two-column "yours vs reference" feedback
export function Compare({ left, leftTitle, right, rightTitle }) {
  return (
    <motion.div className="k-grid2 st-feedback" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <div className="k-panel st-box"><h3>{leftTitle}</h3>{left}</div>
      <div className="k-panel st-box"><h3>{rightTitle}</h3>{right}</div>
    </motion.div>
  );
}

export function UserText({ text, empty = "-" }) {
  return <p className="st-user-answer">{text ? text : <span className="k-muted">{empty}</span>}</p>;
}

// Checkbox list (key points, rubric) bound to form["prefix:i"]
export function CheckList({ items, prefix, form, set, fixed }) {
  return (
    <ul className="st-checks">
      {items.map((p, i) => {
        const on = fixed ? fixed.indexOf(i) >= 0 : !!form[prefix + i];
        return (
          <li key={i}>
            <label>
              <input type="checkbox" checked={on} disabled={!!fixed} onChange={(e) => set(prefix + i, e.target.checked)} />
              <Inl src={p} />
            </label>
          </li>
        );
      })}
    </ul>
  );
}

// The DSR line after a recorded answer
export function TraceLine({ r }) {
  if (!r || !r.res) return null;
  const App = A(), t = r.res.trace;
  const level = r.rating === "again" ? "bad" : r.rating === "hard" ? "warn" : "ok";
  return (
    <motion.div className="st-trace k-small" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE, delay: 0.05 }}>
      <Verdict level={level}>DSR: {App.RATING_TR[r.rating]}</Verdict>
      <span className="k-num">stability S {t.S_old == null ? "initial" : App.dec(t.S_old, 2)} → {App.dec(t.S_new, 2)} d</span>
      <span className="k-num">difficulty D {t.D_old == null ? "initial" : App.dec(t.D_old, 2)} → {App.dec(t.D_new, 2)}</span>
      <span>next review <b className="k-num">{App.fmtDate(t.due_at)}</b> ({App.fmtDays(t.interval_days)})</span>
    </motion.div>
  );
}

// Prediction versus actual (Rule 10)
export function GapBox({ o, title }) {
  const App = A();
  if (!o) return null;
  if (!o.complete) {
    return <div className="k-panel st-box"><h3>{title}</h3><p className="k-small k-muted">Prediction: <span className="k-num">{o.predicted}/{o.n}</span> · will be compared when the test is complete.</p></div>;
  }
  return (
    <div className="k-panel st-box">
      <h3>{title}</h3>
      <p className="st-gap-line">
        <Verdict level={o.level}>{o.label}</Verdict>
        <span>Predicted <b className="k-num">{o.predicted}/{o.n}</b> ({App.pct(o.predicted_ratio)}) · actual <b className="k-num">{o.correct}/{o.n}</b> ({App.pct(o.actual_ratio)}) · gap <b className="k-num">{(o.gap > 0 ? "+" : "") + App.dec(o.gap * 100, 0)} points</b></span>
      </p>
      <p className="k-small">{o.text}</p>
    </div>
  );
}

export function Blocks({ blocks }) {
  return <Html className="kz-blocks st-blocks" html={(blocks || []).map(EU().blockHtml).join("")} />;
}
