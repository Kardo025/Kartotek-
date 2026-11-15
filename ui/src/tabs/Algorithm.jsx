// Algorithm tab: model explanation, formulas, forgetting curves, state machine and the engine self-tests.
import React, { useState } from "react";
import { motion } from "motion/react";
import { ArrowClockwise, CheckCircle, XCircle } from "@phosphor-icons/react";
import { PageHead, Panel, Btn, EASE } from "./kit.jsx";
import { Chart, Legend } from "./insight-kit.jsx";

const FORMULAS = [
  ["Forgetting curve", "R(t, S) = (1 + t / 9S)⁻¹          R(S, S) = 0.90"],
  ["Target interval", "I = 9 · S · (1 / R* − 1)          clip(1 d, I_max)"],
  ["Difficulty", "D′ = clip(1, 10, D + a_r·𝟙(y=0) + a_h·𝟙(q=0.6) − a_e·𝟙(q=1.3) + a_t·slow)\nD′ ← (1 − μ)·D′ + μ·D₀"],
  ["Successful recall", "G  = exp(w0 − w1·D − w2·ln(1+S) + w3·(1−R) + w4·(q−1))\nS′ = clip(S_min, S_max, S · (1 + G·k))      k = min(1, t / S)"],
  ["Failed recall", "S′ = max(S_min, S · [f0 − f1·(1 − R)])"],
  ["Daily priority", "P = wr·max(0, R* − R) + wo·ln(1 + overdue) + wm·importance/5 + we·E + wc·C\nE = proximity · (1 − R_exam)      C = 𝟙(relearning) + min(1, consecutive/2)"],
  ["Calibration", "log loss = −(1/N) Σ [y ln p + (1−y) ln(1−p)]      Brier = (1/N) Σ (p − y)²"],
];

function StateDiagram() {
  const box = (x, y, w, label, s) => (
    <g className="k-sd-node" data-s={s}>
      <rect x={x} y={y} width={w} height="40" rx="8" />
      <text x={x + w / 2} y={y + 25} textAnchor="middle">{label}</text>
    </g>
  );
  return (
    <svg className="k-state-diagram" viewBox="0 0 560 244" role="img" aria-label="State machine: new to learning on first view; learning to review on the last step; review to relearning on Again; relearning back to review on the last step.">
      <defs>
        <marker id="k-sd-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0L10,5L0,10z" />
        </marker>
      </defs>
      {box(10, 60, 100, "New", "new")}
      {box(170, 60, 130, "Learning", "learning")}
      {box(380, 60, 130, "Review", "review")}
      {box(360, 180, 170, "Relearning", "relearning")}
      <path className="edge" d="M110,80H168" markerEnd="url(#k-sd-arr)" /><text className="elabel" x="139" y="118" textAnchor="middle">first view</text>
      <path className="edge" d="M300,80H378" markerEnd="url(#k-sd-arr)" /><text className="elabel" x="339" y="118" textAnchor="middle">last step</text>
      <path className="edge" d="M205,60C205,20 265,20 265,58" markerEnd="url(#k-sd-arr)" /><text className="elabel" x="235" y="16" textAnchor="middle">Again · Hard · middle step</text>
      <path className="edge" d="M425,60C425,20 485,20 485,58" markerEnd="url(#k-sd-arr)" /><text className="elabel" x="455" y="16" textAnchor="middle">Hard · Good · Easy</text>
      <path className="edge" d="M420,100V178" markerEnd="url(#k-sd-arr)" /><text className="elabel" x="414" y="145" textAnchor="end">Again: S drops</text>
      <path className="edge" d="M470,180V102" markerEnd="url(#k-sd-arr)" /><text className="elabel" x="476" y="145">last step</text>
      <path className="edge" d="M360,210C310,210 310,190 358,192" markerEnd="url(#k-sd-arr)" /><text className="elabel" x="300" y="236">Again · Hard</text>
    </svg>
  );
}

function Tests() {
  const [run, setRun] = useState(() => ({ n: 0, res: window.KTests.runAll() }));
  const res = run.res;
  const passed = res.filter((r) => r.pass).length;
  const all = passed === res.length;
  return (
    <Panel
      title="Verification tests"
      actions={
        <Btn size="sm" onClick={() => setRun((r) => ({ n: r.n + 1, res: window.KTests.runAll() }))}>
          <ArrowClockwise size={15} weight="bold" aria-hidden="true" />Run again
        </Btn>
      }
    >
      <p>The required test scenarios and formula examples from the specification run on the engine itself.</p>
      <ul className="k-tests" key={run.n} aria-live="polite">
        <motion.li
          className="k-tests-sum"
          data-ok={all ? "1" : "0"}
          initial={run.n ? { opacity: 0, scale: 0.9 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.28, ease: EASE }}
        >
          {all ? <CheckCircle size={20} weight="fill" aria-hidden="true" /> : <XCircle size={20} weight="fill" aria-hidden="true" />}
          <span><b className="k-num">{passed}/{res.length}</b> tests passed</span>
        </motion.li>
        {res.map((r, i) => (
          <motion.li
            key={i}
            data-ok={r.pass ? "1" : "0"}
            initial={run.n ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: EASE, delay: Math.min(i * 0.015, 0.3) }}
          >
            <span className="k-tests-badge">{r.pass ? "Pass" : "Fail"}</span>
            <div>
              {r.name}
              {r.detail && <div className="k-tests-detail k-num">{r.detail}</div>}
            </div>
          </motion.li>
        ))}
      </ul>
    </Panel>
  );
}

export default function Algorithm() {
  const App = window.App, DSR = window.DSR, S = App.S, R = S.settings.target_retention_default;
  const { dec } = App;
  const series = [
    { label: "S = 2 d", S: 2, color: "var(--s1)" }, { label: "S = 10 d", S: 10, color: "var(--s2)" }, { label: "S = 40 d", S: 40, color: "var(--s3)" },
  ];
  const label = "Forgetting curves for S = 2, 10 and 40 days; target R* " + dec(R, 2) + ". The planned intervals are " +
    [2, 10, 40].map((s) => dec(DSR.intervalForRetention(s, R), 1)).join(", ") + " days respectively.";
  return (
    <div className="k-page k-algo">
      <PageHead title="Algorithm" />
      <div className="k-grid2">
        <div className="k-algo-col">
          <div className="k-prose">
            <h2>Memory estimation and scheduling in one loop</h2>
            <p>For each card the state of memory is kept as three numbers: difficulty D, stability S and current retrievability R. Every answer updates this estimate, and the scheduler brings the card back the moment its recall probability drops to the target retention R*. This is an explainable, production-ready version of the “memory estimation + cost-optimal scheduling” idea from the IEEE TKDE 2023 and ACM KDD 2022 papers.</p>
            <p>There is no fixed 1–3–7–14 day sequence: the interval is computed from the card’s stability, difficulty, answer quality, the real elapsed time and the target date.</p>
            <p className="k-prose-small">Ratings and their values: Again (y = 0, q = 0) · Hard (q = 0.6) · Good (q = 1.0) · Easy (q = 1.3). States: new, learning, review, relearning.</p>
          </div>
          {FORMULAS.map(([t, f]) => (
            <div key={t} className="k-formula-block">
              <h3>{t}</h3>
              <div className="k-formula">{f}</div>
            </div>
          ))}
        </div>
        <div className="k-algo-col">
          <Panel title={"Forgetting curves · R* = " + dec(R, 2)}>
            <Chart sig={String(R)} label={label} draw={(el) => window.KCharts.forgettingChart(el, series, R, 60, label)} />
            <Legend items={[["var(--s1)", "S = 2 d"], ["var(--s2)", "S = 10 d"], ["var(--s3)", "S = 40 d"], ["var(--k-line-strong)", "target R*"]]} />
            <p className="k-prose-small k-mt">The dots mark the moment each curve drops to R*, i.e. the planned review.</p>
          </Panel>
          <Panel title="State machine">
            <StateDiagram />
          </Panel>
          <Panel title="How the due time is produced (in order)">
            <ol className="k-steps">
              <li>The new S, D and the R at review time are computed.</li>
              <li>The effective R* is set (exam week ≥ 0.94; importance 5 → ≥ 0.93).</li>
              <li>I = 9S(1/R* − 1); optionally ÷(1 + λD).</li>
              <li>Depending on the card state, at least 1 day and at most I_max.</li>
              <li>±5% random fuzz (none for intervals under 1 day).</li>
              <li>Exam horizon: the last review is 1 day before the exam.</li>
              <li>If the target day is full, a low-priority card is shifted by ±1–3 days (R ≥ 0.72 is kept; relearning cards are not shifted).</li>
              <li>The card enters the queue from the start of the local day ({S.settings.day_start_hour}:00).</li>
            </ol>
          </Panel>
        </div>
      </div>
      <Panel title="Decisions made where the specification is open">
        <ul className="k-decisions">
          <li><b>Early-review damping k = min(1, t/S).</b> The G in the formula raises S by ≥1.5× even when R≈1. Without damping, a 10-minute relearning step would lift the S of a forgotten card above its pre-lapse value. For an on-time review k = 1, so the model works unchanged.</li>
          <li><b>Learning steps [10, 1440] min.</b> For a new card, Again or Hard asks again after 10 min and Good the next day; after the second successful step the card graduates to review. Easy graduates it directly with S of at least {dec(S.params.easy_graduating_stability_days, 1)} days.</li>
          <li><b>Consecutive failures</b> reset only on a successful recall in the review stage; success in a relearning step does not reset the counter. This catches the “forgot today, forgot again tomorrow” pattern.</li>
          <li><b>Response time</b> is the time until the answer is revealed. Easy counts as Good if slower than 2.5× the personal median and as Hard if slower than 5×; with a hint the quality is at most Hard; more than 2 minutes counts as distraction.</li>
          <li><b>Before answering</b>, the card’s R, S, D and the fronts of upcoming questions are not shown, so the user’s self-rating is not influenced by the model’s estimate.</li>
          <li><b>The overdue term in the priority</b> is damped with ln(1 + days), so a single card overdue for months does not dominate the queue on its own.</li>
        </ul>
      </Panel>
      <Tests />
    </div>
  );
}
