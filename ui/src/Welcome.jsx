// First-open welcome (research/redesign/design-philosophy.md §8), built with the stageshow kit
// (~/.agents/skills/stageshow, copied into ./stageshow). One gesture that is the app: show the answer, rate it Good,
// the card condenses into its new interval and files into the Today panel, whose count rolls; the next card rises.
// It plays once and holds its payoff (a loop would rewind the count with no cause); Replay remounts the stage.
// Built from the subscriptions gold example: a chip that flies between two places and a total that rolls on landing.
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Stage } from "./stageshow/stage.tsx";
import { Count } from "./stageshow/motion/Count.tsx";
import { Fly } from "./stageshow/motion/Fly.tsx";
import "./welcome.css";

const START = { revealed: false, pressed: null, filed: false, next: false, reviewed: 3, caption: false, fly: null };
const POSTER = { ...START, filed: true, next: true, reviewed: 4, caption: true };

async function script(a) {
  await a.wait(800);
  a.mark("show");
  await a.move("show");
  await a.click();
  await a.set({ revealed: true });
  await a.wait(1600);
  a.mark("rate");
  await a.move("good");
  await a.click();
  await a.set({ pressed: "good" });
  // The chip buds where the card condenses and lands beside the count it raises
  const card = a.rect("card", { layout: true });
  const val = a.rect("reviewed", { layout: true });
  const size = { width: 98, height: 26 };
  const from = { x: card.x + card.width / 2 - size.width / 2, y: card.y + card.height / 2 - size.height / 2, ...size };
  const to = { x: val.x + val.width + 10, y: val.y + val.height / 2 - size.height / 2, ...size };
  await a.set({ fly: { from, to, go: false } });
  await a.wait(220);
  await a.set((s) => ({ filed: true, fly: { ...s.fly, go: true } }));
  await a.wait(950);
  a.mark("filed");
  // Landed: the count rolls in the same frame the chip goes
  await a.set({ fly: null, reviewed: 4 });
  await a.wait(500);
  await a.set({ next: true, revealed: false, pressed: null });
  await a.wait(500);
  await a.set({ caption: true });
}

const LOOK = {
  "--ss-accent": "var(--k-accent-fill)",
  "--ss-font": '"Inter Variable", "Segoe UI", system-ui, sans-serif',
  "--ss-text-strong": "var(--k-text)",
  "--ss-text": "var(--k-text-2)",
  "--ss-text-faint": "var(--k-muted)",
};

function Scene({ s, layout }) {
  const compact = layout === "compact";
  return (
    <div className="kw-scene" data-layout={layout}>
      <div className="kw-stack" data-target="card">
        <span className="kw-edge e2" /><span className="kw-edge e1" />
        <div className="kw-card" data-filed={s.filed || undefined}>
          <div className="kw-meta"><span>CEnT-S · 1.3 Radicals</span><span className="kw-pill">Review</span></div>
          <div className="kw-front">What is the principal square root of 25?</div>
          <div className="kw-answer" data-on={s.revealed || undefined}>
            <div className="kw-div" />
            <div className="kw-back">5</div>
            <div className="kw-expl">√ names only the nonnegative root (p. 38).</div>
          </div>
        </div>
        <div className="kw-card kw-card--next" data-on={s.next || undefined} aria-hidden={!s.next}>
          <div className="kw-meta"><span>CEnT-S · 1.3 Radicals</span><span className="kw-pill">Review</span></div>
          <div className="kw-front">Simplify √300.</div>
        </div>
      </div>
      <div className="kw-actions">
        <div className="kw-show" data-target="show" data-cursor="pointer" data-off={s.revealed || undefined}>Show answer</div>
        <div className="kw-rates" data-on={(s.revealed && !s.next) || undefined}>
          {[["again", "Again", "10 min"], ["hard", "Hard", "2 d"], ["good", "Good", "6 d"], ["easy", "Easy", "15 d"]].map(([r, l, iv]) => (
            <div key={r} className="kw-rate" data-r={r} data-target={r} data-cursor="pointer" data-down={s.pressed === r || undefined}>
              <b>{l}</b><small>{iv}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="kw-today">
        <div className="kw-h">Today</div>
        <div className="kw-num"><span data-target="reviewed"><Count value={s.reviewed} duration={600} /></span></div>
        <div className="kw-sub">reviewed{compact ? "" : " · 17 left"}</div>
        <div className="kw-split"><i data-r="again" style={{ flexGrow: 1 }} /><i data-r="hard" style={{ flexGrow: 1 }} /><i data-r="good" style={{ flexGrow: s.reviewed - 2 }} /><i data-r="easy" style={{ flexGrow: 1 }} /></div>
      </div>
      <p className="kw-caption" data-on={s.caption || undefined}>The model schedules each card just before you would forget it.</p>
      {s.fly && (
        <Fly from={s.fly.from} to={s.fly.to} go={s.fly.go} held duration={950}>
          <span className="kw-chip">in 6 days</span>
        </Fly>
      )}
    </div>
  );
}

export default function Welcome({ onClose }) {
  const [run, setRun] = useState(0);
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <motion.div className="kw-root" role="dialog" aria-modal="true" aria-labelledby="kw-title"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.24 }}>
      <div className="kw-inner">
        <div className="kw-brand">
          <span className="k-logo" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="14" height="14"><rect x="2.5" y="4" width="15" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M2.5 8h15" stroke="currentColor" strokeWidth="1.8" /></svg>
          </span>
          <span>Kartotek</span>
        </div>
        <h2 id="kw-title" className="kw-title">Rate a card. The model decides when it comes back.</h2>
        <div className="kw-stage-wrap">
          <Stage key={run} width={760} height={400} compact={{ below: 600, width: 358, height: 540 }} initial={START} poster={POSTER}
            script={script} play="once" theme={document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"} tokens={LOOK} className="kw-stage"
            cursor={{ at: { wide: { x: 640, y: 330 }, compact: { x: 300, y: 470 } }, style: "arrow" }}>
            {(s, _rect, layout) => <Scene s={s} layout={layout} />}
          </Stage>
        </div>
        <div className="kw-btns">
          <button type="button" className="k-btn primary" onClick={onClose} autoFocus>Start</button>
          <button type="button" className="k-btn" onClick={() => setRun((x) => x + 1)}>Replay</button>
        </div>
      </div>
    </motion.div>
  );
}

// Shown once on first open; Settings can show it again
export function welcomeSeen() { try { return localStorage.getItem("kartotek-welcome") === "1"; } catch (e) { return true; } }
export function markWelcomeSeen() { try { localStorage.setItem("kartotek-welcome", "1"); } catch (e) { /* ignore */ } }
