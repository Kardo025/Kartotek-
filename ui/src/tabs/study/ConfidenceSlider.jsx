// Confidence 0-100 (task F1, LEARNING-PROTOCOL 2.2): the learner's stated chance that the answer they gave is right. It replaces Guess /
// Unsure / Sure everywhere confidence is asked. There is no default position: until the slider is touched there is no confidence. The
// scheduler still reads three bands (Sure 80-100, Unsure 40-79, Guess 0-39); the number is kept next to the band. Keys 1, 2, 3 set
// 20 / 60 / 90 and the arrow keys move by 5. "I don't know" is a separate button: a gap, not a wrong guess, with no confidence.
import React from "react";
import { Question } from "@phosphor-icons/react";
import "./confidence.css";

const BAND = (p) => (p >= 80 ? "sure" : p >= 40 ? "unsure" : "guess");
const BAND_LABEL = { guess: "Guess", unsure: "Unsure", sure: "Sure" };
const BAND_PCT = { 1: 20, 2: 60, 3: 90 };

export default function ConfidenceSlider({ value, onChange, onDontKnow, dontKnow, disabled, label }) {
  const set = value != null;
  const touch = (e) => { if (!set && !disabled) onChange(Number(e.currentTarget.value)); };
  const onKey = (e) => {
    if (disabled) return;
    if (BAND_PCT[e.key]) { e.preventDefault(); onChange(BAND_PCT[e.key]); return; }
    if (e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 5 : -5;
      onChange(Math.max(0, Math.min(100, (set ? value : 50) + d)));
    }
  };
  const band = set ? BAND(value) : null;
  return (
    <div className="cf" data-set={set ? "1" : undefined} data-band={band || undefined} data-dk={dontKnow ? "1" : undefined}>
      <div className="cf-head">
        <span className="k-small k-muted">{label || "How likely is it that your answer is right?"}</span>
        <span className="cf-val" aria-live="polite">
          {dontKnow ? "I don't know" : set ? <><b className="k-num">{value}%</b><span className="cf-band">{BAND_LABEL[band]}</span></> : <span className="k-muted">Not set</span>}
        </span>
      </div>
      <input type="range" className="cf-range" min={0} max={100} step={1} value={set ? value : 50} disabled={disabled || dontKnow}
        aria-label="Confidence from 0 to 100 percent" aria-valuetext={set ? value + " percent, " + BAND_LABEL[band] : "not set"}
        onChange={(e) => onChange(Number(e.target.value))} onClick={touch} onKeyDown={onKey} />
      <div className="cf-ticks" aria-hidden="true"><span>0</span><span>Guess</span><span>40</span><span>Unsure</span><span>80</span><span>Sure</span><span>100</span></div>
      <div className="cf-foot">
        <span className="k-small k-muted">{set ? "Keys 1, 2, 3 set 20, 60, 90; arrows move by 5." : "Move the slider or press 1, 2 or 3 (20, 60, 90). Without it the answer cannot go to your reviews."}</span>
        {onDontKnow && (
          <button type="button" className="k-btn sm" data-act="dontknow" aria-pressed={!!dontKnow} disabled={disabled} onClick={onDontKnow}
            title="A gap, not a guess: counted as not correct, with no confidence.">
            <Question size={14} aria-hidden="true" />I don't know
          </button>
        )}
      </div>
    </div>
  );
}
