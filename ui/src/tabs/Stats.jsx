// Stats tab: review load, history, calibration, recommendations, flagged cards and the metacognition panel.
import React from "react";
import { PencilSimple, Lightbulb } from "@phosphor-icons/react";
import { PageHead, Panel, Btn, Kpi, TableWrap } from "./kit.jsx";
import { Chart, Legend, TableView, LevelChip, PartBar, Note } from "./insight-kit.jsx";

const STATUS_SHORT = { well_calibrated: "well calibrated", overconfident: "overconfident", underconfident: "underconfident" };

function dayLabel(idx, DAY) {
  return new Date(idx * DAY).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
const signed = (x) => (x > 0 ? "+" : "") + x;

function model(App) {
  const DSR = window.DSR, S = App.S, st = S.settings, now = Date.now(), h = st.day_start_hour, DAY = DSR.DAY;
  const { pct, dec } = App;
  const today = DSR.dayIndex(now, h);
  const ids = Object.keys(S.cards);
  const active = ids.filter((id) => !S.mem[id].suspended);
  const reviewCards = active.filter((id) => S.mem[id].state === "review");

  const byDay = {};
  S.reviews.forEach((e) => {
    const d = DSR.dayIndex(e.reviewed_at, h);
    if (d > today - 30) { const b = (byDay[d] = byDay[d] || { ok: 0, fail: 0 }); if (e.recall_result) b.ok++; else b.fail++; }
  });
  const todayB = byDay[today] || { ok: 0, fail: 0 };

  const since30 = now - 30 * DAY;
  const rev30 = S.reviews.filter((e) => e.from_state === "review" && e.reviewed_at >= since30 && DSR.isRecallSignal(e));
  const obs30 = rev30.length ? rev30.reduce((a, e) => a + e.recall_result, 0) / rev30.length : null;
  const cal = DSR.calibration(S.reviews, now - 90 * DAY);
  const overdue = reviewCards.filter((id) => DSR.dayIndex(S.mem[id].due_at, h) < today).length;
  const ex = DSR.examTimestamp(st);
  const seen = active.filter((id) => S.mem[id].state !== "new");
  let examR = null;
  if (ex && ex > now && seen.length) {
    examR = seen.reduce((a, id) => { const m = S.mem[id]; return a + DSR.retrievability((ex - m.last_reviewed_at) / DAY, m.stability_days); }, 0) / seen.length;
  }
  const meanR = seen.length ? seen.reduce((a, id) => { const m = S.mem[id]; return a + DSR.retrievability((now - m.last_reviewed_at) / DAY, m.stability_days); }, 0) / seen.length : null;

  const kpis = [
    { label: "Reviews today", value: String(todayB.ok + todayB.fail), sub: todayB.ok + " correct · " + todayB.fail + " forgotten" },
    { label: "Observed success · 30 days", value: pct(obs30, 1), sub: "target R* " + dec(st.target_retention_default, 2) + " · " + rev30.length + " reviews" },
    {
      label: "Predicted / actual · 90 days",
      value: cal.review_count ? pct(cal.predicted_retention, 1) + " / " + pct(cal.observed_retention, 1) : "-",
      sub: cal.review_count ? cal.review_count + " reviews" + (cal.model_status === "overconfident" ? " · predicted > actual" : cal.model_status === "underconfident" ? " · predicted < actual" : "") : "no reviews yet",
      chip: cal.model_status && cal.model_status !== "insufficient" ? [cal.model_status === "well_calibrated" ? "ok" : "warn", STATUS_SHORT[cal.model_status]] : null,
    },
    { label: "Overdue card share", value: reviewCards.length ? pct(overdue / reviewCards.length, 0) : "-", sub: overdue + " / " + reviewCards.length + " review cards" },
    examR != null
      ? { label: "Expected recall on exam day", value: pct(examR, 1), sub: st.exam_date + " · " + seen.length + " cards" }
      : { label: "Mean R · now", value: pct(meanR, 1), sub: seen.length + " cards seen" },
  ];

  // Forecast
  const loads = {};
  reviewCards.forEach((id) => {
    const di = DSR.dayIndex(S.mem[id].due_at, h);
    const d = Math.max(today, di);
    const b = (loads[d] = loads[d] || { plan: 0, late: 0 });
    if (di < today) b.late++; else b.plan++;
  });
  const fRows = [];
  for (let i = 0; i < 30; i++) {
    const d = today + i, b = loads[d] || { plan: 0, late: 0 };
    const lim = DSR.dailyReviewLimit(st, d);
    fRows.push({
      label: i === 0 ? "today" : dayLabel(d, DAY), values: { plan: b.plan, late: b.late },
      tip: (i === 0 ? "Today" : dayLabel(d, DAY)) + "<br>planned " + b.plan + (b.late ? "<br>overdue " + b.late : "") + "<br>limit " + lim,
    });
  }
  const fTotal = fRows.reduce((a, r) => a + r.values.plan + r.values.late, 0);
  const fLabel = "Review load for the next 30 days: " + (fRows[0].values.plan + fRows[0].values.late) + " cards today (" + fRows[0].values.late + " overdue), " + fTotal + " cards in total over 30 days.";

  const hRows = [];
  for (let j = 29; j >= 0; j--) {
    const dd = today - j, hb = byDay[dd] || { ok: 0, fail: 0 };
    hRows.push({
      label: j === 0 ? "today" : dayLabel(dd, DAY), values: { ok: hb.ok, fail: hb.fail },
      tip: (j === 0 ? "Today" : dayLabel(dd, DAY)) + "<br>recalled " + hb.ok + "<br>forgotten " + hb.fail + (hb.ok + hb.fail ? "<br>success " + pct(hb.ok / (hb.ok + hb.fail)) : ""),
    });
  }
  let hOk = 0, hFail = 0;
  hRows.forEach((r) => { hOk += r.values.ok; hFail += r.values.fail; });
  const hLabel = hOk + hFail + " reviews in the last 30 days; " + hOk + " recalled, " + hFail + " forgotten.";

  // Recommendations
  const adv = [];
  const perCard = active.map((id) => S.mem[id]).filter((m) => m.total_reviews >= 5);
  const veryHigh = perCard.filter((m) => m.successful_reviews / m.total_reviews > 0.95).length;
  if (obs30 != null && rev30.length >= 20 && obs30 < 0.7) adv.push(["bad", "Success in the last 30 days is " + pct(obs30) + ": intervals may be too long, cards badly designed, or the new-card load too high. Try lowering the new-card limit and reviewing the flagged cards."]);
  if (perCard.length >= 10 && veryHigh / perCard.length > 0.5) adv.push(["warn", pct(veryHigh / perCard.length) + " of cards have success above 95%: intervals are probably short. Lowering R* by 0.02–0.03 reduces the load."]);
  if (cal.model_status === "overconfident") adv.push(["warn", "The model overestimates recall (" + pct(cal.predicted_retention, 1) + " / " + pct(cal.observed_retention, 1) + "). Fit the parameters to your own data in Settings › Personalisation."]);
  if (cal.model_status === "underconfident") adv.push(["warn", "The model underestimates recall (" + pct(cal.predicted_retention, 1) + " / " + pct(cal.observed_retention, 1) + "). Personalisation may lengthen the intervals."]);
  if (reviewCards.length && overdue / reviewCards.length > 0.2) adv.push(["warn", pct(overdue / reviewCards.length) + " of review cards are overdue. The queue clears the backlog first; new cards are throttled automatically meanwhile. Being late is not penalised; the real elapsed time goes into the model."]);
  const eligible = S.reviews.filter((e) => e.from_state === "review" && DSR.isRecallSignal(e)).length;
  if (eligible >= 100 && !(S.param_history || []).length) adv.push(["warn", eligible + " answers have accumulated in the review stage: there is enough data to personalise the parameters (Settings › Personalisation)."]);
  const flagged = active.filter((id) => S.mem[id].needs_content_review);
  if (flagged.length) adv.push(["warn", flagged.length + " card" + (flagged.length === 1 ? " is" : "s are") + " awaiting content review. Splitting these cards or adding a hint works better than showing them more often."]);
  if (!adv.length) adv.push(["ok", "Indicators are in the target range. Keep watching daily review counts, per-card success and calibration."]);

  // Expected recall on each exam's own date (exam sections keep one date each)
  (App.EXAMS || []).forEach((x) => {
    const ts = DSR.parseExamDate(S[x] && S[x].examDate);
    if (!ts || ts <= now) return;
    const set = {}; App.examDecks(x).forEach((d) => { set[d] = true; });
    const ids = seen.filter((id) => set[S.cards[id].deck_id]);
    if (!ids.length) return;
    const r = ids.reduce((a, id) => { const mm = S.mem[id]; return a + DSR.retrievability((ts - mm.last_reviewed_at) / DAY, mm.stability_days); }, 0) / ids.length;
    kpis.push({ label: "Expected recall on " + (x === "cents" ? "CEnT-S" : "TU Delft") + " day", value: pct(r, 1), sub: S[x].examDate + " · " + ids.length + " cards" });
  });
  const act = activity(App);
  return { kpis, fRows, fLabel, hRows, hLabel, cal, adv, flagged, act };
}

// Review activity over the last year (one square per day) and by hour of day, from the review log
function activity(App) {
  const DSR = window.DSR, S = App.S, h = S.settings.day_start_hour, DAY = DSR.DAY, now = Date.now();
  const today = DSR.dayIndex(now, h), from = today - 52 * 7 - new Date(today * DAY).getUTCDay();
  const perDay = {}, hours = [];
  for (let i = 0; i < 24; i++) hours.push({ n: 0, ok: 0 });
  S.reviews.forEach((e) => {
    const d = DSR.dayIndex(e.reviewed_at, h);
    if (d >= from) perDay[d] = (perDay[d] || 0) + 1;
    if (now - e.reviewed_at <= 90 * DAY) { const hr = new Date(e.reviewed_at).getHours(); hours[hr].n++; hours[hr].ok += e.recall_result ? 1 : 0; }
  });
  const days = Object.keys(perDay).length, max = Math.max(1, ...Object.values(perDay));
  return { today, from, perDay, max, days, hours, DAY };
}
function Heatmap({ a }) {
  const cells = [], cols = Math.ceil((a.today - a.from + 1) / 7), size = 11, gap = 3;
  for (let d = a.from; d <= a.today; d++) {
    const i = d - a.from, c = Math.floor(i / 7), r = i % 7, n = a.perDay[d] || 0;
    const lvl = n === 0 ? 0 : n <= a.max * 0.25 ? 1 : n <= a.max * 0.5 ? 2 : n <= a.max * 0.75 ? 3 : 4;
    const date = new Date(d * a.DAY).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    cells.push(<rect key={d} x={c * (size + gap)} y={r * (size + gap)} width={size} height={size} rx="2" className="k-heat" data-l={lvl}><title>{date}: {n} reviews</title></rect>);
  }
  const W = cols * (size + gap), H = 7 * (size + gap);
  return (
    <div className="k-heat-wrap">
      <svg viewBox={"0 0 " + W + " " + H} width={W} height={H} role="img" aria-label={"Review activity over the last year: reviews on " + a.days + " days, at most " + a.max + " in a day."}>{cells}</svg>
    </div>
  );
}
function Hours({ a, App }) {
  const max = Math.max(1, ...a.hours.map((x) => x.n)), W = 24 * 22, H = 120;
  const total = a.hours.reduce((s, x) => s + x.n, 0);
  const best = a.hours.map((x, i) => ({ i, n: x.n, r: x.n >= 10 ? x.ok / x.n : null })).filter((x) => x.r != null).sort((x, y) => y.r - x.r)[0];
  return (
    <>
      <svg viewBox={"0 0 " + W + " " + (H + 18)} className="k-hours" role="img" aria-label={"Reviews by hour of day over the last 90 days, " + total + " in total."}>
        {a.hours.map((x, i) => {
          const bh = Math.round((x.n / max) * H);
          return (
            <g key={i}>
              <rect x={i * 22 + 3} y={H - bh} width="16" height={Math.max(bh, x.n ? 1 : 0)} rx="2" className="k-hours-bar"><title>{String(i).padStart(2, "0")}:00 · {x.n} reviews{x.n ? " · " + Math.round((x.ok / x.n) * 100) + "% recalled" : ""}</title></rect>
              {i % 3 === 0 && <text x={i * 22 + 11} y={H + 14} textAnchor="middle" className="k-hours-t">{String(i).padStart(2, "0")}</text>}
            </g>
          );
        })}
      </svg>
      <p className="k-small k-muted">{total ? total + " reviews in the last 90 days." + (best ? " Best recall at " + String(best.i).padStart(2, "0") + ":00 (" + Math.round(best.r * 100) + "% of " + best.n + ")." : "") : "No reviews in the last 90 days."}</p>
    </>
  );
}

function StatsCharts({ m, App }) {
  const { pct, dec } = App;
  const KC = window.KCharts;
  const { cal } = m;
  return (
    <>
      <div className="k-grid2">
        <Panel title="Review load for the next 30 days">
          <Chart sig={JSON.stringify(m.fRows)} label={m.fLabel} draw={(el) => KC.stackedColumns(el, m.fRows, [
            { key: "late", label: "overdue", color: "var(--k-hard)" }, { key: "plan", label: "planned", color: "var(--k-accent)" },
          ], { height: 200, label: m.fLabel })} />
          <Legend items={[["var(--k-accent)", "planned"], ["var(--k-hard)", "overdue (added to today)"]]} />
          <TableView head={["Day", "Planned", "Overdue"]} rows={m.fRows.map((r) => [r.label, r.values.plan, r.values.late])} />
        </Panel>
        <Panel title="Reviews in the last 30 days">
          <Chart sig={JSON.stringify(m.hRows)} label={m.hLabel} draw={(el) => KC.stackedColumns(el, m.hRows, [
            { key: "ok", label: "recalled", color: "var(--k-good)" }, { key: "fail", label: "forgotten", color: "var(--k-again)" },
          ], { height: 200, labelFromEnd: true, label: m.hLabel })} />
          <Legend items={[["var(--k-good)", "recalled"], ["var(--k-again)", "forgotten"]]} />
          <TableView head={["Day", "Recalled", "Forgotten"]} rows={m.hRows.map((r) => [r.label, r.values.ok, r.values.fail])} />
        </Panel>
      </div>
      <div className="k-grid2">
        <Panel title="Review activity · last 12 months">
          <Heatmap a={m.act} />
          <p className="k-small k-muted">Reviews on {m.act.days} days; darker means more reviews (most in a day: {m.act.max}). Study and test answers count too.</p>
        </Panel>
        <Panel title="Reviews by hour of day · last 90 days">
          <Hours a={m.act} App={App} />
        </Panel>
      </div>
      <div className="k-grid2">
        <Panel title="Calibration · last 90 days">
          <p>“Are about 90% of the cards predicted at 90% actually answered correctly?” The closer the points are to the diagonal, the better calibrated the model.</p>
          {cal.review_count ? (
            <>
              <div className="k-chart-square-wrap">
                <Chart kind="square" sig={JSON.stringify(cal.bins)}
                  draw={(el) => KC.calibrationChart(el, cal.bins, "Calibration: over " + cal.review_count + " reviews, predicted recall " + pct(cal.predicted_retention, 1) + ", observed " + pct(cal.observed_retention, 1) + ".")} />
              </div>
              <p className="k-mono k-cal-metrics">n = {cal.review_count} · Brier {dec(cal.brier_score, 3)} · log loss {dec(cal.log_loss, 3)} · ECE {dec(cal.ece, 3)}</p>
              <TableView head={["R range", "n", "Predicted", "Actual"]}
                rows={cal.bins.filter((b) => b.n).map((b) => [dec(b.lo, 2) + "–" + dec(b.hi, 2), b.n, pct(b.pred, 1), pct(b.obs, 1)])} />
            </>
          ) : <Note>Calibration needs reviews of cards in the “review” state.</Note>}
        </Panel>
        <Panel title="Recommendations">
          <ul className="k-advice">
            {m.adv.map(([lvl, text], i) => (
              <li key={i}><LevelChip level={lvl} /><p>{text}</p></li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Cards awaiting content review">
        {!m.flagged.length ? <Note>No flagged cards.</Note> : (
          <TableWrap>
            <table className="k-table">
              <thead><tr><th>Front</th><th>Reasons</th><th className="num">Lapses</th><th><span className="k-sr">Actions</span></th></tr></thead>
              <tbody>
                {m.flagged.map((id) => {
                  const c = App.S.cards[id], mm = App.S.mem[id];
                  return (
                    <tr key={id}>
                      <td className="k-flag-front">{c.front}</td>
                      <td className="k-flag-reasons">{(mm.content_flags || []).join(" · ")}</td>
                      <td className="num">{mm.lapse_count || 0}</td>
                      <td className="num"><Btn size="sm" onClick={() => App.openEditor(id)}><PencilSimple size={15} aria-hidden="true" />Edit</Btn></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}

function Metacog({ App }) {
  const S = App.S, KMeta = window.KMeta, KC = window.KCharts;
  const { pct, dec, esc } = App;
  const preds = KMeta.predictionsList(S);
  const jol = KMeta.jolBins(KMeta.jolEntries(S));
  const conf = KMeta.confidenceAccuracy(S);
  const dist = KMeta.errorDistribution(S).filter((d) => d.count);
  const strat = KMeta.strategyEffect(S);
  const lv = KMeta.promptLevel(S);
  const answered = conf.guess.n + conf.unsure.n + conf.sure.n;

  if (!preds.length && !jol.n && !answered) {
    return (
      <div className="k-metacog">
        <h2 className="k-section-title">Metacognition</h2>
        <Panel>
          <p>As you complete studies, this shows your prediction accuracy, the calibration of your recall predictions, the confidence–accuracy relation, your error types and how strategies affect retention.</p>
        </Panel>
      </div>
    );
  }

  const last5 = preds.slice(-5);
  const meanGap = last5.length ? last5.reduce((s, o) => s + o.gap, 0) / last5.length : null;
  const hits = preds.filter((o) => o.id === "isabetli").length;
  const gapInfo = KMeta.interpretGap(meanGap);
  const kpis = [
    ["Mean prediction gap · last 5", meanGap == null ? "-" : (meanGap > 0 ? "+" : "") + dec(meanGap * 100, 0) + " points", gapInfo ? gapInfo.label : "no predictions yet"],
    ["Accurate predictions", preds.length ? hits + "/" + preds.length : "-", "|gap| ≤ 10 points"],
    ["Recall prediction (JOL) gap", jol.mean_gap == null ? "-" : (jol.mean_gap > 0 ? "+" : "") + dec(jol.mean_gap * 100, 0) + " points", jol.n + " objectives"],
    ["Most frequent error type", dist.length ? dist[0].label : "-", dist.length ? dist[0].count + " entries" : "no error entries"],
    ["Prompt level", KMeta.LEVEL_TR[lv.level], lv.reason],
  ];
  const confNote = conf.sure.n >= 3 && conf.guess.n >= 3 && conf.sure.correct / conf.sure.n <= conf.guess.correct / conf.guess.n;
  const maxErr = dist.length ? dist[0].count : 1;
  const gapRows = preds.map((o) => ({
    label: o.label.replace(" quiz", "").replace("Final test", "Test"), gap: o.gap,
    tip: esc(o.etut) + "<br>" + esc(o.label) + "<br>predicted " + o.predicted + "/" + o.n + " · actual " + o.correct + "/" + o.n + "<br>gap " + signed(Math.round(o.gap * 100)) + " points",
  }));

  return (
    <div className="k-metacog">
      <h2 className="k-section-title">Metacognition</h2>
      <div className="k-kpis">
        {kpis.map(([l, v, s]) => <Kpi key={l} label={l} value={v} sub={s} />)}
      </div>
      <div className="k-grid2">
        <Panel title="Prediction − actual gap">
          {preds.length ? (
            <>
              <Chart sig={JSON.stringify(gapRows)} draw={(el) => KC.gapColumns(el, gapRows, {
                height: 200, label: "Gap between prediction and actual across " + preds.length + " tests; mean of the last five tests " + (meanGap == null ? "-" : Math.round(meanGap * 100) + " points") + ".",
              })} />
              <Legend items={[["var(--s2)", "overconfident (predicted > actual)"], ["var(--s1)", "underconfident"], ["var(--k-pill-review)", "accurate band ±10", "k-legend-outline"]]} />
              <TableView head={["Test", "Predicted", "Actual", "Gap"]}
                rows={preds.map((o) => [o.etut + " · " + o.label, o.predicted + "/" + o.n, o.correct + "/" + o.n, signed(Math.round(o.gap * 100)) + " points"])} />
            </>
          ) : <Note>No completed predictions.</Note>}
        </Panel>
        <Panel title="Recall prediction (JOL) calibration">
          <p>x: your prediction before recall · y: share of key points you ticked. The diagonal marks accurate monitoring.</p>
          {jol.n ? (
            <>
              <div className="k-chart-square-wrap">
                <Chart kind="square" sig={JSON.stringify(jol.bins)}
                  draw={(el) => KC.calibrationChart(el, jol.bins, "Recall prediction calibration: " + jol.n + " objectives, mean gap " + Math.round(jol.mean_gap * 100) + " points.")} />
              </div>
              <TableView head={["JOL range", "n", "Predicted", "Actual"]}
                rows={jol.bins.filter((b) => b.n).map((b) => [pct(b.lo) + "–" + pct(b.hi), b.n, pct(b.pred), pct(b.obs)])} />
            </>
          ) : <Note>No recall predictions yet.</Note>}
        </Panel>
      </div>
      <div className="k-grid2">
        <Panel title="Accuracy by confidence">
          {answered ? (
            <>
              {[["sure", "Sure"], ["unsure", "Unsure"], ["guess", "Guess"]].map(([k, l]) => {
                const x = conf[k], r = x.n ? x.correct / x.n : 0;
                return <PartBar key={k} label={l} frac={r} color="var(--k-good)" value={x.n ? pct(r) + " · " + x.correct + "/" + x.n : "-"} />;
              })}
              {confNote && (
                <p className="k-conf-note"><LevelChip level="warn">Watch out</LevelChip> Answers you marked “Sure” are no more accurate than your guesses; your feeling of confidence is not separating good performance from bad.</p>
              )}
            </>
          ) : <Note>No quiz answers yet.</Note>}
        </Panel>
        <Panel title="Error types">
          {dist.length ? (
            <>
              {dist.map((d) => <PartBar key={d.id} label={d.label} frac={d.count / maxErr} color="var(--s2)" value={d.count} />)}
              <div className="k-callout">
                <span className="k-callout-label"><Lightbulb size={14} weight="fill" aria-hidden="true" />Adaptation: {dist[0].label}</span>
                <p>{dist[0].action}</p>
              </div>
            </>
          ) : <Note>No error entries.</Note>}
        </Panel>
      </div>
      <Panel title="Strategy effect">
        <p>Using a strategy does not mean you used it effectively. This compares how objective cards do in the real reviews after the study.</p>
        <TableWrap>
          <table className="k-table">
            <thead><tr><th>Strategy</th><th className="num">Objectives with it</th><th className="num">Without it</th><th>Interpretation</th></tr></thead>
            <tbody>
              {strat.map((s) => (
                <tr key={s.strategy}>
                  <td>{s.label}</td>
                  <td className="num">{s.with.n ? pct(s.with.rate) + " · n=" + s.with.n : "-"}</td>
                  <td className="num">{s.without.n ? pct(s.without.rate) + " · n=" + s.without.n : "-"}</td>
                  <td>
                    {s.early ? <span className="k-muted-text">Too early to interpret (each group needs at least 10 reviews)</span>
                      : s.with.rate - s.without.rate > 0.05 ? <LevelChip level="ok">Appears linked to retention</LevelChip>
                        : <LevelChip level="warn">No clear difference</LevelChip>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Panel>
    </div>
  );
}

export default function Stats() {
  const App = window.App;
  const m = model(App);
  return (
    <div className="k-page k-stats">
      <PageHead title="Stats" />
      <div className="k-kpis">
        {m.kpis.map((k) => (
          <Kpi key={k.label} label={k.label} value={k.value} sub={k.sub}>
            {k.chip && <div className="k-kpi-chip"><LevelChip level={k.chip[0]}>{k.chip[1]}</LevelChip></div>}
          </Kpi>
        ))}
      </div>
      <StatsCharts m={m} App={App} />
      <Metacog App={App} />
    </div>
  );
}
