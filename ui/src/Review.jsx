import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowCounterClockwise, Lightbulb, Eye, CheckCircle, Warning, FilePdf, ChatCircleText, Minus, Check, Checks } from "@phosphor-icons/react";
import { Count, EASE as E, DUR, STAGGER } from "./motion.jsx";
import ModelHint from "./tabs/ModelHint.jsx";
import { Md } from "./tabs/study/common.jsx";
import { useModelReady, useModelCall, CallStatus, CopyPromptBtn, RequestPreview, byLine } from "./model-call.jsx";

const EASE = E.out;
// Each rating is told apart by icon, label and key as well as colour (design-philosophy.md 3)
const RATING_ICON = { again: ArrowCounterClockwise, hard: Minus, good: Check, easy: Checks };
const RATINGS = ["again", "hard", "good", "easy"];
const LETTERS = "ABCDE";
// Cloze cards: {{c1::answer}} or {{answer}} in the front; hidden as […] until the answer is shown
const CLOZE = /\{\{(?:c\d+::)?(.+?)\}\}/g;
function clozeView(text, revealed) {
  const out = []; let last = 0, m, k = 0;
  CLOZE.lastIndex = 0;
  while ((m = CLOZE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(revealed ? <mark key={k++} className="k-cloze on">{m[1]}</mark> : <span key={k++} className="k-cloze">[…]</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export const isCloze = (c) => c.card_type === "cloze" || /\{\{(?:c\d+::)?.+?\}\}/.test(c.front || "");

function claudeLink(prompt) { return window.KConfig.claudeLink(prompt); }
// Where the card comes from (book page, local extract) and a way to ask about the card: a set-up model answers in the app
// (task E2); otherwise the prefilled Claude Code link with its hint, as before
function SourceRow({ card, S }) {
  const src = window.KPrep ? window.KPrep.cardSource(S, card) : null;
  const mr = useModelReady("fast");
  const [open, setOpen] = useState(false);
  const prompt = window.KCents.askPrompt({ front: card.front, back: card.back, explanation: card.explanation, itemId: src && src.itemId, extractPage: src && src.extractPage });
  return (
    <div className="k-card-src">
      {src && src.bookHref && <span className="k-small">Source: {src.label} · p. {src.printedPage}</span>}
      {src && src.bookHref && <a className="k-btn sm" href={src.bookHref} target="_blank" rel="noopener"><FilePdf size={14} aria-hidden="true" />Book page</a>}
      {src && src.localHref && <a className="k-btn sm" href={src.localHref} title="The page extract on this computer">Extract p. {src.extractPage}</a>}
      {mr.ready ? (
        <button type="button" className="k-btn sm" aria-expanded={open} onClick={() => setOpen(!open)} title="Ask your model about this card, with its source information."><ChatCircleText size={14} aria-hidden="true" />Ask about this card</button>
      ) : (
        <>
          <a className="k-btn sm" href={claudeLink(prompt)} title="Opens Claude Code with this card and its source pages; press Enter there to ask."><ChatCircleText size={14} aria-hidden="true" />Ask Claude</a>
          <CopyPromptBtn promptId="ask-card" vars={window.KPrep ? window.KPrep.cardAskInputs(S, card, "") : {}} />
          <ModelHint what="answering questions about this card" />
        </>
      )}
      {mr.ready && open && <AskCard card={card} S={S} />}
    </div>
  );
}

// "Ask about this card": the card, its source information and the text of its study go to the model; the answer is shown here
// and not stored (a card is not changed by asking about it)
function AskCard({ card, S }) {
  const call = useModelCall();
  const [question, setQuestion] = useState("");
  const [out, setOut] = useState(null);
  const [showAns, setShowAns] = useState(false);
  const vars = () => window.KPrep.cardAskInputs(S, card, question);
  const ask = async () => {
    setOut(null); setShowAns(false);
    const r = await call.run("ask-card", vars(), { feature: "ask-card", maxOutputTokens: 3000 });
    if (r.ok) setOut({ ...r.json, by: r.meta });
  };
  return (
    <div className="mc-ask">
      <label className="k-field"><span className="k-field-label">Your question (optional)</span>
        <input className="k-input" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !call.busy) ask(); }} placeholder="e.g. why is the answer not the other way round?" />
      </label>
      <div className="k-row-btns">
        <button type="button" className="k-btn sm primary" disabled={call.busy} onClick={ask}>Ask</button>
        <CopyPromptBtn promptId="ask-card" vars={vars()} />
      </div>
      <CallStatus call={call} />
      {out && (
        <div className="mc-answer">
          <Md src={out.answer_md} />
          {out.common_mistake && <p className="k-small"><b>Usual mistake:</b> {out.common_mistake}</p>}
          {(out.refs || []).length > 0 && <p className="k-small k-muted">Sources: {out.refs.join(" · ")}</p>}
          {out.limits && <p className="k-small k-muted">Limits: {out.limits}</p>}
          {out.practice_question && (
            <div className="k-small">
              <p><b>Try this:</b> {out.practice_question}</p>
              {showAns ? <p className="k-muted">{out.practice_answer}</p> : <button type="button" className="k-btn sm" onClick={() => setShowAns(true)}>Show the answer</button>}
            </div>
          )}
          <p className="k-small k-muted mc-by">Answered by {byLine(out.by)}. Asking does not change the card or its schedule.</p>
        </div>
      )}
      <RequestPreview promptId="ask-card" vars={vars()} />
    </div>
  );
}

function Pill({ n, label }) {
  return <span className="k-pill-count"><b>{n}</b>{label}</span>;
}

function Tile({ label, value, sub, target, delay }) {
  return (
    <div className="k-tile" data-file-target={target || undefined}>
      <div className="k-tile-label">{label}</div>
      <div className="k-tile-value k-num">{typeof value === "number" ? <Count value={value} delay={delay || 0} /> : value}</div>
      {sub && <div className="k-tile-sub">{sub}</div>}
    </div>
  );
}

const SCOPE_NAME = { cents: "CEnT-S", tud: "TU Delft AE Prep" };

function Header({ q, App, S }) {
  const decks = App.scope ? App.examDecks(App.scope) : Object.keys(S.decks);
  return (
    <div className="k-head">
      <div className="k-head-title">
        <h1>Review</h1>
        {App.scope && <span className="k-tag" data-tone="accent">{SCOPE_NAME[App.scope]}</span>}
        <div className="k-head-pills" aria-label="Queue">
          <Pill n={q.counts.learning} label="learning" />
          <Pill n={q.counts.review} label="review" />
          <Pill n={q.counts.fresh} label="new" />
        </div>
      </div>
      <select
        className="k-select"
        aria-label="Deck"
        value={App.getDeck()}
        onChange={(e) => { App.setDeck(e.target.value); App.render(); }}
      >
        <option value="">{App.scope ? "All " + SCOPE_NAME[App.scope] + " decks" : "All decks"}</option>
        {decks.map((d) => <option key={d} value={d}>{S.decks[d].name}</option>)}
      </select>
    </div>
  );
}

// Today's reviews in the current queue filter: count, rating split and the cards' memory curve
function todayRatings(App) {
  const S = App.S, now = Date.now(), h = S.settings.day_start_hour;
  const start = window.DSR.dayStart(window.DSR.dayIndex(now, h), h);
  const ev = S.reviews.filter((e) => e.reviewed_at >= start && (!App.inQueueFilter || App.inQueueFilter(e.deck_id)));
  const split = { again: 0, hard: 0, good: 0, easy: 0 };
  ev.forEach((e) => { if (split[e.rating] != null) split[e.rating] += 1; });
  const ids = Array.from(new Set(ev.map((e) => e.card_id))).filter((id) => S.mem[id]);
  const curve = ids.length ? Array.from({ length: 15 }, (_, d) => ids.reduce((a, id) => a + window.DSR.retrievability(d, S.mem[id].stability_days), 0) / ids.length) : [];
  return { n: ev.length, split, curve };
}

// A card was filed in the last moment: its counter waits for the chip to land
const justFiled = (App, kind) => { const f = App.session.lastFiled; return !!(f && f.at && f.rating !== "again" && Date.now() - f.at < 700 && App.motionOK() && (f.was === "new") === (kind === "new")); };

function SplitBar({ split, big }) {
  const total = RATINGS.reduce((a, r) => a + split[r], 0);
  if (!total) return null;
  return (
    <div className={"k-split" + (big ? " big" : "")} aria-label={RATINGS.map((r) => window.App.RATING_TR[r] + " " + split[r]).join(", ")}>
      {RATINGS.map((r, i) => (
        <motion.i key={r} data-r={r} initial={big ? { scaleX: 0 } : false} animate={{ scaleX: 1, flexGrow: split[r] }}
          transition={{ duration: big ? DUR.scene : 0.6, ease: E.travel, delay: big ? 0.5 + i * 0.06 : 0 }} style={{ flexGrow: split[r] }} />
      ))}
    </div>
  );
}

function MemoryCurve({ curve }) {
  if (!curve.length) return null;
  const W = 320, H = 96, x = (d) => 8 + (d / 14) * (W - 16), y = (r) => 8 + (1 - r) * (H - 24);
  const path = curve.map((r, d) => (d ? "L" : "M") + x(d).toFixed(1) + " " + y(r).toFixed(1)).join(" ");
  return (
    <svg className="k-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={"Average recall chance falls to " + Math.round(curve[14] * 100) + "% in 14 days without review"}>
      <line x1="8" x2={W - 8} y1={y(1)} y2={y(1)} className="k-curve-grid" />
      <line x1="8" x2={W - 8} y1={y(0.9)} y2={y(0.9)} className="k-curve-grid" strokeDasharray="3 4" />
      <motion.path d={path} className="k-curve-line" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: E.travel, delay: 0.75 }} />
      <text x="8" y={H - 2} className="k-curve-label">today</text>
      <text x={W - 8} y={H - 2} className="k-curve-label" textAnchor="end">14 days</text>
    </svg>
  );
}

function EmptyCard({ m, App, S }) {
  const q = m.q;
  const sel = App.getDeck();
  const deck = sel ? (S.decks[sel] || {}).name : App.scope ? "All " + SCOPE_NAME[App.scope] + " decks" : "All decks";
  const tr = todayRatings(App);
  return (
    <motion.div className="k-panel k-empty" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.scene, ease: E.arrive }}>
      <p className="k-card-deck">{deck}</p>
      <h2 className="k-empty-title">
        <svg className="k-empty-check" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: DUR.scene, ease: E.out, delay: 1.5 }} />
        </svg>
        {tr.n ? "Today’s session is done" : "Today’s queue is empty"}
      </h2>
      {tr.n > 0 && (
        <div className="k-summary">
          <div className="k-summary-hero"><span className="k-hero-num"><Count value={tr.n} duration={0.9} /></span><span className="k-muted">reviewed today</span></div>
          <SplitBar split={tr.split} big />
          <div className="k-split-legend">{RATINGS.map((r) => <span key={r} data-r={r}>{App.RATING_TR[r]} <b className="k-num">{tr.split[r]}</b></span>)}</div>
          <MemoryCurve curve={tr.curve} />
        </div>
      )}
      <motion.p className="k-muted" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.ui, ease: E.arrive, delay: tr.n ? 1.3 : 0.1 }}>
        {q.nextLearnAt ? `The next learning step opens at ${App.fmtDate(q.nextLearnAt)}. ` : ""}
        Tomorrow: <b className="k-num"><Count value={m.tomorrowCount} /></b> review{m.tomorrowCount === 1 ? "" : "s"}.
        {q.totals.freshAvailable && !q.counts.fresh ? ` Daily new-card limit reached (${q.totals.newLimit}).` : ""}
      </motion.p>
      <p className="k-muted k-small">Reviewing early is not recommended: the interval was computed for the target retention.</p>
      <div className="k-row-btns">
        <button type="button" className="k-btn primary" onClick={() => App.action("goto-cards")}>Add cards</button>
        <button type="button" className="k-btn" onClick={() => App.action("goto-stats")}>See stats</button>
      </div>
    </motion.div>
  );
}

function RecordCard({ m, App, S }) {
  const { cur, card, mem } = m;
  const revealed = !!cur.revealedAt;
  const deck = (S.decks[card.deck_id] || {}).name || "-";
  return (
    <motion.article
      key={cur.card_id}
      className="k-panel k-card"
      aria-live="polite"
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.42, ease: EASE, delay: App.session.lastFiled && m.now - cur.shownAt < 500 ? 0.16 : 0 }}
    >
      <div className="k-card-meta">
        <span className="k-card-deck">{deck}</span>
        <span className="k-card-tags">
          {mem.needs_content_review && (
            <span className="k-state" data-s="relearning" title={(mem.content_flags || []).join(" · ")}>content review</span>
          )}
          {card.importance >= 4 && <span className="k-state" data-s="new">importance {card.importance}</span>}
          <span className="k-state" data-s={mem.state}>{App.STATE_TR[mem.state]}</span>
        </span>
      </div>
      <div className={"k-card-front" + (card.front.length <= 24 ? " short" : "")}>{isCloze(card) ? clozeView(card.front, revealed) : card.front}</div>
      {card.options && card.options.length > 0 && (
        <div className="k-card-opts" role="group" aria-label="Options: keys A to D">
          {card.options.map((o, i) => (
            <button key={i} type="button" disabled={revealed} onClick={() => App.pickOption(i)}
              data-c={revealed && i === card.correct ? "1" : undefined} data-y={revealed && i === cur.choice ? "1" : undefined}>
              <span className="k-card-letter">{LETTERS[i]}</span>{o}
            </button>
          ))}
        </div>
      )}
      {cur.hintUsed && card.hint && !revealed && (
        <motion.p className="k-card-hint" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }}>
          <Lightbulb size={16} weight="fill" aria-hidden="true" /> {card.hint}
        </motion.p>
      )}
      {revealed && (
        <div className="k-card-answer">
          <motion.div className="k-card-divider" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: DUR.ui, ease: EASE }} />
          <motion.div
            initial={{ opacity: 0, clipPath: "inset(0 100% 0 0)" }}
            animate={{ opacity: 1, clipPath: "inset(0 0% 0 0)" }}
            transition={{ duration: DUR.scene, ease: EASE, delay: 0.1 }}
          >
          {card.options && card.options.length > 0 && cur.choice != null && (
            <p className={"k-card-verdict " + (cur.choice === card.correct ? "ok" : "bad")}>{cur.choice === card.correct ? "Correct: Good is suggested." : "Wrong: Again is suggested."}</p>
          )}
          {!(isCloze(card) && !card.back) && <div className="k-card-back">{card.back}</div>}
          {card.explanation && <p className="k-card-expl">{card.explanation}</p>}
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DUR.fast, delay: 0.42 }}>
            <SourceRow card={card} S={S} />
          </motion.div>
        </div>
      )}
    </motion.article>
  );
}

// When the focused button unmounts (reveal or rating), keep keyboard and screen-reader users on the next action
function useKeepFocus(ref, deps) {
  useEffect(() => {
    const a = document.activeElement;
    if (ref.current && (!a || a === document.body)) ref.current.focus({ preventScroll: true });
  }, deps);
}

function AnswerBar({ m, App }) {
  const { cur, card, preview } = m;
  const target = useRef(null);
  useKeepFocus(target, [cur.card_id, !!cur.revealedAt]);
  if (!cur.revealedAt) {
    return (
      <div className="k-answer-bar">
        <motion.button ref={target} type="button" className="k-btn primary k-reveal" whileTap={{ scale: 0.97 }} onClick={() => App.action("reveal")}>
          <Eye size={18} weight="bold" aria-hidden="true" />{card.options && card.options.length ? "Show answer without choosing" : "Show answer"}<span className="k-kbd">Space</span>
        </motion.button>
        {card.hint && !cur.hintUsed && (
          <motion.button type="button" className="k-btn" whileTap={{ scale: 0.97 }} onClick={() => App.action("hint")}>
            <Lightbulb size={18} aria-hidden="true" />Hint<span className="k-kbd">H</span>
          </motion.button>
        )}
        <span className="k-timer k-num" id="study-timer" aria-label="Time on this card">0 s</span>
      </div>
    );
  }
  return (
    <div ref={target} tabIndex={-1} onKeyDown={(e) => { if (e.key === " " && e.target === e.currentTarget) e.preventDefault(); }} className="k-rate-grid" role="group" aria-label="Rate your recall: keys 1 to 4">
      {RATINGS.map((r, i) => (
        <motion.button
          key={r}
          type="button"
          className="k-rate"
          data-r={r}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: E.arrive, delay: i * 0.03 }}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => App.rate(r)}
          data-suggest={card.options && cur.choice != null && (r === (cur.choice === card.correct ? "good" : "again")) ? "1" : undefined}
        >
          {React.createElement(RATING_ICON[r], { size: 18, weight: "bold", className: "k-rate-icon", "aria-hidden": "true" })}
          <b>{App.RATING_TR[r]}</b>
          <small>{preview ? App.fmtMs(preview[r]) : ""}</small>
          <span className="k-kbd">{i + 1}</span>
        </motion.button>
      ))}
    </div>
  );
}

function MemoryStrip({ m, App }) {
  const { mem, R } = m;
  if (!m.cur || !m.cur.revealedAt) return null;
  if (mem.state === "new") {
    return <motion.p className="k-strip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DUR.fast, delay: 0.5 }}>New card · D₀ <b>{App.dec(mem.difficulty, 1)}</b> · S₀ <b>{App.fmtDays(mem.stability_days)}</b></motion.p>;
  }
  const t = (m.now - mem.last_reviewed_at) / 86400000;
  return (
    <motion.p className="k-strip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DUR.fast, delay: 0.5 }}>
      <span>R now <b>{App.dec(R, 3)}</b></span>
      <span>S <b>{App.fmtDays(mem.stability_days)}</b></span>
      <span>D <b>{App.dec(mem.difficulty, 2)}</b></span>
      <span>last review <b>{App.fmtDays(t)}</b> ago</span>
      <span>success <b>{mem.total_reviews ? App.pct(mem.successful_reviews / mem.total_reviews) : "-"}</b></span>
    </motion.p>
  );
}

function Today({ m, App }) {
  const t = m.q.totals;
  const revealed = m.cur && m.cur.revealedAt;
  const done = t.reviewDone + t.newDone;
  const left = m.q.counts.learning + m.q.counts.review + m.q.counts.fresh;
  const frac = done + left ? done / (done + left) : 0;
  return (
    <section className="k-panel k-side-panel" aria-labelledby="k-today">
      <h2 id="k-today">Today</h2>
      <div className="k-tiles">
        <Tile label="Reviews done" value={t.reviewDone} sub={`of ${t.reviewLimit}`} target="today" delay={justFiled(App, "review") ? 0.95 : 0} />
        <Tile label="New cards" value={t.newDone} sub={`of ${t.newLimit}`} target="new" delay={justFiled(App, "new") ? 0.95 : 0} />
        <Tile label="R now" value={revealed && m.R != null ? App.dec(m.R, 2) : "–"} sub={revealed ? "recall chance" : "after answer"} />
        <Tile label="Stability" value={revealed && m.mem ? App.fmtDays(m.mem.stability_days) : "–"} sub={revealed ? "memory half-life" : "after answer"} />
      </div>
      <div className="k-progress" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
        <motion.span initial={false} animate={{ scaleX: frac }} transition={{ duration: 0.8, ease: EASE }} />
      </div>
      <SplitBar split={todayRatings(App).split} />
      <p className="k-small k-muted">Pending reviews {t.dueReview} · new cards left {t.freshAvailable}</p>
      {m.q.newNotes.length > 0 && (
        <ul className="k-notes">{m.q.newNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      )}
    </section>
  );
}

function UpNext({ m, App }) {
  const [fronts, setFronts] = React.useState(() => App.pref("kartotek-queue-fronts") === "1");
  if (!m.upNext.length) return null;
  return (
    <section className="k-panel k-side-panel" aria-labelledby="k-upnext">
      <div className="k-side-head">
        <h2 id="k-upnext">Up next</h2>
        <label className="k-check">
          <input type="checkbox" checked={fronts} onChange={(e) => { setFronts(e.target.checked); App.setPref("kartotek-queue-fronts", e.target.checked ? "1" : "0"); }} />
          Show fronts
        </label>
      </div>
      <ol className="k-upnext">
        <AnimatePresence initial={false}>
          {m.upNext.map((it) => (
            <motion.li
              key={it.card_id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.32, ease: EASE }}
            >
              <span className="k-upnext-text">
                <span className="k-upnext-deck">{it.deck}</span>
                <span className="k-upnext-front">{fronts ? it.front : "Front hidden"}</span>
              </span>
              <span className="k-state" data-s={it.state}>{App.STATE_TR[it.state]}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}

function LastAnswer({ App }) {
  const s = App.session;
  const d = App.traceData(s.last);
  return (
    <section className="k-panel k-side-panel" aria-labelledby="k-last">
      <div className="k-side-head">
        <h2 id="k-last">Last answer</h2>
        {d && <span className="k-state" data-s={d.rating === "again" ? "relearning" : d.rating === "hard" ? "learning" : "review"}>{App.RATING_TR[d.rating]}</span>}
      </div>
      {!d && <p className="k-small k-muted">When you rate a card, every step of the D-S-R update appears here.</p>}
      {d && (
        <motion.div key={s.reviewed} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
          <dl className="k-trace">
            {d.rows.map(([k, v], i) => (
              <div className="k-row" key={i}><dt>{k}</dt><dd className="k-num">{v}</dd></div>
            ))}
          </dl>
          {d.notes.length > 0 && <p className="k-note">{d.notes.join(" ")}</p>}
          {d.policy && (
            <div className="k-policy" data-level={d.policy.level}>
              <p><Warning size={16} weight="fill" aria-hidden="true" /> <b>Consecutive misses {d.lapses}.</b> {d.policy.text}</p>
              <div className="k-row-btns">
                {d.policy.level === 2 && <button type="button" className="k-btn sm" onClick={() => App.action("edit-hint")}>Add hint</button>}
                {d.policy.level >= 3 && <button type="button" className="k-btn sm" onClick={() => App.action("edit")}>Edit / split card</button>}
                {d.policy.level >= 4 && <button type="button" className="k-btn sm danger" onClick={() => App.action("suspend")}>Suspend</button>}
              </div>
            </div>
          )}
        </motion.div>
      )}
      {s.undo.length > 0 && (
        <motion.button type="button" className="k-btn sm k-undo" whileTap={{ scale: 0.97 }} onClick={() => App.undo()}>
          <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />Undo<span className="k-kbd">Z</span>
        </motion.button>
      )}
    </section>
  );
}

export default function Review() {
  const App = window.App, S = App.S;
  const m = App.reviewModel();
  const q = m.q;
  return (
    <div className="k-review">
      <Header q={q} App={App} S={S} />
      <div className="k-review-grid">
        <div className="k-review-main">
          {m.over && (
            <div className="k-banner">
              <p className="k-banner-text">The {S.settings.max_session_minutes}-minute session time is up. A short break makes the next recalls easier.</p>
              <button type="button" className="k-btn sm" onClick={() => App.action("dismiss-limit")}>Continue</button>
            </div>
          )}
          {q.usingAhead && <p className="k-small k-muted">No other cards are left, so a learning step due within {S.settings.learn_ahead_minutes} min was brought forward.</p>}
          {m.cur ? (
            <>
              <div className="k-card-stack">
                <span className="k-edge e2" aria-hidden="true" /><span className="k-edge e1" aria-hidden="true" />
                <RecordCard key={m.cur.card_id} m={m} App={App} S={S} />
              </div>
              <AnswerBar m={m} App={App} />
              <MemoryStrip m={m} App={App} />
            </>
          ) : <EmptyCard m={m} App={App} S={S} />}
        </div>
        <aside className="k-review-aside">
          {App.backupDue() && (
            <section className="k-panel k-side-panel k-nudge">
              <p className="k-small"><b>Backup.</b> Your cards and review history are only in this browser. Last backup: {App.backupText()}.</p>
              <button type="button" className="k-btn sm primary" onClick={() => App.action("backup")}>Back up</button>
            </section>
          )}
          <Today m={m} App={App} />
          <UpNext m={m} App={App} />
          <LastAnswer App={App} />
        </aside>
      </div>
    </div>
  );
}
