// Shared pieces for the Stats and Algorithm tabs: engine-drawn charts, legends, table view, level chips.
import React, { useLayoutEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, Warning, WarningOctagon, CaretRight } from "@phosphor-icons/react";
import { EASE, Lvl } from "./kit.jsx";
import "./insight.css";

// KCharts draws into a live DOM node and binds its own hover listeners (the #chart-tip tooltip),
// so the chart is drawn in an effect rather than injected as an HTML string.
export function Chart({ draw, sig, kind = "wide", label }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (ref.current) draw(ref.current);
    return () => { if (window.KCharts) window.KCharts.tip(null); };
  }, [sig]);
  return <div ref={ref} className={"k-chart k-chart-" + kind} aria-label={label} />;
}

export function Legend({ items }) {
  return (
    <div className="k-legend">
      {items.map(([color, text, cls]) => (
        <span key={text}><i className={cls} style={{ background: color }} />{text}</span>
      ))}
    </div>
  );
}

// Collapsible table alternative for a chart
export function TableView({ head, rows }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="k-tableview">
      <button type="button" className="k-tableview-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2, ease: EASE }} style={{ display: "inline-flex" }}>
          <CaretRight size={13} weight="bold" aria-hidden="true" />
        </motion.span>
        Table view
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="t"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            style={{ overflow: "hidden" }}
          >
            <div className="k-table-wrap k-tableview-body">
              <table className="k-table">
                <thead><tr>{head.map((h, i) => <th key={i} className={i ? "num" : undefined}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={ri}>{r.map((c, i) => <td key={i} className={i ? "num" : undefined}>{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const LEVEL = {
  ok: [Check, "On track"],
  warn: [Warning, "Warning"],
  bad: [WarningOctagon, "Problem"],
};
export function LevelChip({ level, children }) {
  const [Icon, text] = LEVEL[level];
  return (
    <Lvl level={level}>
      <Icon size={13} weight="bold" aria-hidden="true" />
      {children || text}
    </Lvl>
  );
}

// Labelled horizontal bar that grows into place
export function PartBar({ label, frac, color, value }) {
  const v = Math.max(0, Math.min(1, frac || 0));
  return (
    <div className="k-partbar">
      <span className="k-partbar-label">{label}</span>
      <span className="k-partbar-track">
        <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: v }} transition={{ duration: 0.8, ease: EASE }} style={{ background: color }} />
      </span>
      <span className="k-num k-partbar-value">{value}</span>
    </div>
  );
}

export function Note({ children }) {
  return <p className="k-note-muted">{children}</p>;
}
