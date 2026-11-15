// Study v2 final test (complete criterion blueprint, saved blocks, held feedback) and the outcome report.
import React, { useState } from "react";
import { ArrowRight, Hourglass, Cards, CheckCircle } from "@phosphor-icons/react";
import { Btn } from "../../kit.jsx";
import { Chip, Scale } from "../common.jsx";
import Item from "./Item.jsx";
import { A, KC, EU, itemsOf, extrasOf, save, criterionText, when } from "./lib.js";

const DELAYS = [{ v: 0, label: "Now" }, { v: 1, label: "Tomorrow" }, { v: 2, label: "In 2 days" }, { v: 3, label: "In 3 days" }, { v: 7, label: "In a week" }];

export function FinalPlan({ et }) {
  const App = A(), K = KC(), bp = K.blueprint(et.package);
  const [d, setD] = useState("1");
  const blocks = Math.ceil(bp.items / K.BLOCK);
  return (
    <section className="k-panel k-sec cy-final-plan">
      <h2 className="cy-h2">Final test</h2>
      <p>{bp.items} questions in {blocks} block{blocks > 1 ? "s" : ""} of up to {K.BLOCK}. They assess <b>{bp.covered} of {bp.criteria}</b> success criteria{bp.missing.length ? " (not assessed: " + bp.missing.join(", ") + ")" : ""}. None of them was used in practice.</p>
      <ul className="k-small">
        <li>There is no help during the test. You can still open a topic from the list above; every answer after that is recorded as with help (lesson open) and is not sent to your reviews. Kartotek cannot see other tabs or devices: the result is "no recorded assistance", not a proctored exam.</li>
        <li>Feedback comes at the end of each block. A block can be left and continued later.</li>
        <li>Taking it later shows what lasts. Taken now, the result is labelled immediate performance.</li>
      </ul>
      <div className="cy-row">
        <span className="k-small k-muted">When?</span>
        <Scale label="When to take the final test" opts={DELAYS} value={d} onPick={setD} />
      </div>
      <Btn kind="primary" onClick={() => { K.planFinal(et, Number(d), App.S.settings.day_start_hour, Date.now()); save(et); window.scrollTo(0, 0); }}>{d === "0" ? "Start now" : "Plan it"}<ArrowRight size={17} weight="bold" aria-hidden="true" /></Btn>
    </section>
  );
}

export function FinalRun({ et }) {
  const App = A(), K = KC(), pr = et.progress, f = pr.final, idx = itemsOf(et);
  if (!f) return <FinalPlan et={et} />;
  const now = Date.now();
  if (f.open_at > now && !f.started_at) {
    return (
      <section className="k-panel k-sec cy-evaluate">
        <Hourglass size={26} aria-hidden="true" />
        <h2 className="cy-h2">The final test opens {when(f.open_at)}</h2>
        <p>Until then your objective cards continue in Review.</p>
        <div className="cy-actions">
          <Btn onClick={() => App.goReview(et.deck_id)}><Cards size={16} aria-hidden="true" />Review this study's cards</Btn>
          <Btn onClick={() => { f.open_at = now; f.immediate = f.delay_days === 0; f.started_early = now; save(et); }}>Take it now anyway</Btn>
        </div>
      </section>
    );
  }
  if (!f.started_at) { f.started_at = now; EU().commit(et); }
  const pos = K.finalPosition(et);
  if (!pos || pos.done) return <Report et={et} />;
  if (pos.review) {
    const pending = pos.answered.filter((a) => a.grading === "pending");
    return (
      <div className="cy-col">
        <section className="k-panel k-sec">
          <h2 className="cy-h2">Block {pos.block + 1} of {pos.blocks} · feedback</h2>
          <p className="k-small k-muted">For written answers, check each criterion now; an answer you leave unchecked stays uncertain.</p>
        </section>
        {pos.answered.map((a, i) => <Item key={a.id} et={et} item={idx[a.q_id]} attempt={a} />)}
        <div className="cy-actions">
          <Btn kind="primary" onClick={() => {
            pending.forEach((a) => { a.grading = "uncertain"; a.dsr = { status: "not_sent", reason: "Left ungraded" }; });
            K.nextBlock(et, Date.now()); save(et); window.scrollTo(0, 0);
          }}>{pos.block + 1 < pos.blocks ? "Next block" : "See the report"}<ArrowRight size={17} weight="bold" aria-hidden="true" /></Btn>
          {pending.length > 0 && <span className="k-small k-muted">{pending.length} written answer{pending.length > 1 ? "s are" : " is"} not checked yet.</span>}
        </div>
      </div>
    );
  }
  let a = pr.current && K.attemptById(et, pr.current);
  if (!a || a.q_id !== pos.q_id || a.mode !== "final") {
    a = K.startAttempt(et, idx[pos.q_id], "final", now);
    EU().commit(et);
  }
  return (
    <div className="cy-col">
      <p className="k-small k-muted">Final test · block {pos.block + 1} of {pos.blocks} · question {pos.index + 1} of {pos.n} · no help</p>
      <Item key={a.id} et={et} item={idx[a.q_id]} attempt={a} held />
    </div>
  );
}

const TONE = { not_assessed: "mid", uncertain: "warn", needs_work: "bad", assisted: "warn", independent: "ok", retained: "ok", transfer: "ok" };

export function Report({ et }) {
  const App = A(), K = KC(), S = App.S, pkg = et.package, r = K.report(S, et, Date.now(), extrasOf(et)), p = r.process;
  const partTitle = {};
  pkg.parts.forEach((x, i) => { partTitle[x.part_id] = "Part " + (i + 1); });
  return (
    <div className="cy-col">
      <section className="k-panel k-sec">
        <h2 className="cy-h2">Report</h2>
        <p><b className="k-num">{r.assessed} of {r.total}</b> outcomes assessed · <b className="k-num">{r.independent}</b> shown without recorded help{r.final ? (r.delayed ? " on a later day" : " (immediate performance: taken right after studying)") : ""}.</p>
        <p className="k-small k-muted">One answer is one observation, not stable mastery. "Without recorded help" means Kartotek recorded none; it cannot see other tabs or devices. A check after a delay is still one observation, not proof of permanent retention.</p>
        {!r.certified && <p className="k-lvl" data-l="warn">The module has coverage gaps, so this report cannot cover every outcome.</p>}
      </section>
      <section className="k-panel k-sec">
        <h3 className="cy-h3">What you learned</h3>
        <div className="k-table-wrap">
          <table className="k-table cy-report">
            <thead><tr><th>Outcome</th><th>Criteria</th><th>Evidence</th><th>Next</th></tr></thead>
            <tbody>
              {r.rows.map((row) => (
                <tr key={row.id}>
                  <td><span className="k-small k-muted">{partTitle[row.part_id]} · {row.id}</span><br />{row.performance}</td>
                  <td className="k-small">{row.criteria.map((c) => (
                    <div key={c.id} className="cy-crit-res">
                      <span>{c.text}</span>
                      <span className="cy-chips">{c.results.length ? c.results.map((x, i) => <span key={i} className="cy-mini" data-m={x.disputed ? "unsure" : x.met} title={(x.mode === "final" ? "final" : "practice") + (x.assisted ? ", with help" : "") + (x.repeated ? ", repeated" : "") + ": " + (x.disputed ? "reported" : x.met === "met" ? "met" : x.met === "not" ? "not met" : "uncertain")}>{x.mode === "final" ? "F" : "P"}{x.assisted ? "+" : ""}<span aria-hidden="true">{x.disputed || (x.met !== "met" && x.met !== "not") ? "?" : x.met === "met" ? "✓" : "✗"}</span></span>) : <span className="k-muted">no attempt</span>}</span>
                    </div>
                  ))}</td>
                  <td><span className="k-lvl" data-l={TONE[row.state]}>{row.label}</span></td>
                  <td className="k-small">{row.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="k-small k-muted">P = practice, F = final test, + = with help. ✓ (green) = criterion met, ✗ (red) = not met, ? (grey) = uncertain or reported.</p>
      </section>
      {r.gaps.length > 0 && (
        <section className="k-panel k-sec">
          <h3 className="cy-h3">Gaps and limits</h3>
          <ul className="k-small">{r.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </section>
      )}
      <section className="k-panel k-sec">
        <h3 className="cy-h3">How you learned</h3>
        <ul className="k-small cy-process">
          <li>{p.topics != null ? p.topics + " topic" + (p.topics === 1 ? "" : "s") + " in " : ""}{p.parts} part{p.parts > 1 ? "s" : ""}; Evaluating deferred in {p.deferred} topic{p.deferred === 1 ? "" : "s"}.{p.left_final ? " You left the final test for a lesson " + p.left_final + " time" + (p.left_final > 1 ? "s" : "") + "; answers after that count as with help." : ""}</li>
          <li>{p.feynman_versions} saved explanation version{p.feynman_versions === 1 ? "" : "s"}; {p.maps} linked mind map{p.maps === 1 ? "" : "s"}.</li>
          <li>{p.attempts} answers, {p.assisted} with help ({p.hints} hint{p.hints === 1 ? "" : "s"}); {p.explains} explanation request{p.explains === 1 ? "" : "s"}; {p.disputed} reported question{p.disputed === 1 ? "" : "s"}.</li>
          <li>{p.sent} answer{p.sent === 1 ? "" : "s"} sent to your reviews.</li>
        </ul>
        <p className="k-small k-muted">This describes the path; it does not show which technique caused a result.</p>
      </section>
      <section className="k-panel k-sec">
        <h3 className="cy-h3">When to revisit</h3>
        <div className="k-table-wrap">
          <table className="k-table">
            <thead><tr><th>Objective card</th><th>Next review</th><th>Memory now</th></tr></thead>
            <tbody>{r.cards.map((c) => <tr key={c.kazanim_id}><td>{c.title}</td><td>{c.due_at ? when(c.due_at) : "not reviewed yet"}</td><td className="k-num">{c.R == null ? "—" : Math.round(c.R * 100) + "%"}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="k-small k-muted">The dates come from Kartotek's scheduler (DSR) and only from answers without recorded help.</p>
        <div className="cy-actions"><Btn onClick={() => App.goReview(et.deck_id)}><Cards size={16} aria-hidden="true" />Review this study's cards</Btn></div>
      </section>
    </div>
  );
}
