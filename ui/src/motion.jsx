// Kartotek motion system (research/redesign/design-philosophy.md §5).
// Three curves, five durations, one spring. Input never waits: every component here animates over state
// that is already final, and every animation can be interrupted by the next change.
import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

export const EASE = {
  out: [0.23, 1, 0.32, 1],        // feedback: press, hover, toggle
  travel: [0.45, 0, 0.1, 1],      // things that move from A to B
  arrive: [0.25, 0.8, 0.25, 1],   // things that appear from nowhere
};
export const DUR = { press: 0.1, fast: 0.16, ui: 0.24, scene: 0.42, story: 0.8 };
export const SPRING = { type: "spring", stiffness: 420, damping: 38 };
export const STAGGER = 0.05;

// A number that rolls: each changed digit slides to its new value, last digit first;
// unchanged digits stay still. Non-digit characters (".", "%", "d") keep their place.
export function Count({ value, className, duration = 0.5, delay = 0 }) {
  const reduce = useReducedMotion();
  const text = String(value == null ? "–" : value);
  const chars = text.split("");
  const digitsAfter = (i) => chars.slice(i + 1).filter((c) => /\d/.test(c)).length;
  return (
    <span className={"k-count" + (className ? " " + className : "")} aria-label={text}>
      {chars.map((c, i) => /\d/.test(c) ? (
        <span key={chars.length - i} className="k-count-col" aria-hidden="true">
          <motion.span
            className="k-count-reel"
            initial={false}
            animate={{ y: -Number(c) + "em" }}
            transition={reduce ? { duration: 0 } : { duration, ease: EASE.travel, delay: delay + digitsAfter(i) * 0.06 }}
          >
            {"0123456789".split("").map((d) => <span key={d}>{d}</span>)}
          </motion.span>
        </span>
      ) : <span key={"c" + (chars.length - i)} aria-hidden="true">{c}</span>)}
    </span>
  );
}

// Tab content enters from the direction of travel down or up the sidebar (design-philosophy.md 6.4).
// A CSS animation, not a frame loop: it always completes, even when the page was hidden while it started.
let lastTabIndex = -1;
export function TabEnter({ index, children }) {
  const dir = useRef(index >= lastTabIndex ? "down" : "up").current;
  useEffect(() => { lastTabIndex = index; }, [index]);
  return <div className="k-tab-enter" data-dir={dir}>{children}</div>;
}

// A word that changes rolls instead of blinking (page titles, status words)
export function Roll({ text, className }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(text);
  const [prev, setPrev] = useState(null);
  useEffect(() => {
    if (text === shown) return;
    setPrev(shown); setShown(text);
    const t = setTimeout(() => setPrev(null), 320);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <span className={"k-roll" + (className ? " " + className : "")}>
      {prev != null && !reduce && (
        <motion.span key={"p" + prev} className="k-roll-out" initial={{ y: 0, opacity: 1 }} animate={{ y: "-0.6em", opacity: 0 }} transition={{ duration: DUR.fast, ease: EASE.out }} aria-hidden="true">{prev}</motion.span>
      )}
      <motion.span key={shown} initial={prev != null && !reduce ? { y: "0.6em", opacity: 0 } : false} animate={{ y: 0, opacity: 1 }} transition={{ duration: DUR.ui, ease: EASE.arrive }}>{shown}</motion.span>
    </span>
  );
}
