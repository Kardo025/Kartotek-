// Study library: studies, learning journal, error log
import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { UploadSimple, Play, ArrowRight, Trophy, Cards, ArrowCounterClockwise, Trash, Plus, Warning, BookOpenText, NotePencil, Bug } from "@phosphor-icons/react";
import { EASE, PageHead, Btn, Seg, Bar, TableWrap, ConfirmBtn } from "../kit.jsx";
import { LiveSessionsPanel } from "./Live.jsx";
import { PracticePanel } from "./Practice.jsx";
import { Confirm, Callout, Inl, Chip } from "./common.jsx";
import { AskPair } from "../Cents.jsx";
import { ReloadButton } from "../ContentPanel.jsx";
import { NewJob, JobsPanel, jobsAvailable } from "../Jobs.jsx";
import { A, KE, KM, EU, activeEtuts, progressFraction, progressLabel, dueCount, YN_TR, signed } from "./util.js";

// Same as the legacy importFromObject: validate, import, commit, toast
function importFromObject(pkg, fromBundle) {
  const App = A(), S = App.S;
  const ex = S.etuts && S.etuts[pkg.etut_id];
  const r = KE().importPackage(S, pkg);
  if (r.errors.length) return r;
  // A study loaded inside an exam section belongs to that exam
  const dk = App.scope && S.decks[r.deckId];
  if (dk && !App.etutInExam(r.etut, App.scope)) dk.exams = (dk.exams || []).concat(App.scope);
  App.store.commit({ meta: true, etuts: [pkg.etut_id], cards: r.created.concat(r.updated) });
  if (!fromBundle) App.toast((ex && !ex.removed ? "Study updated: " : "Study loaded: ") + pkg.title + " · " + KE().flatKazanimlar(pkg).length + " objectives");
  return r;
}

const TABS = [
  { value: "etutler", label: "Studies" },
  { value: "gunluk", label: "My learning journal" },
  { value: "hatalar", label: "My error log" },
];

export default function Library() {
  const App = A();
  const [errs, setErrs] = useState(null);
  const fileRef = useRef(null);
  const tab = App.etutLibTab;

  const onFile = (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let pkg;
      try { pkg = JSON.parse(reader.result); } catch (err) {
        setErrs({ title: "Error", items: ["The file could not be read as JSON: " + err.message] });
        return;
      }
      const r = importFromObject(pkg, false);
      if (r.errors.length) { setErrs({ title: "Invalid package", items: r.errors.slice(0, 12) }); return; }
      setErrs(null);
      App.etutLibTab = "etutler";
      App.render();
    };
    reader.readAsText(f);
  };

  return (
    <div className="k-page st-page">
      <PageHead title={App.scope ? (App.scope === "tud" ? "TU Delft AE Prep" : "CEnT-S") + " · Study" : "Study"} sub={<p className="k-small k-muted st-sub">Each part is a self-regulation cycle: plan, learn and retrieve, test yourself, analyse your errors, reflect. Every answer is written to the objective’s DSR card.</p>}>
        <ReloadButton />
        <Btn onClick={() => fileRef.current && fileRef.current.click()}>
          <UploadSimple size={17} weight="bold" aria-hidden="true" />Load study package (.json)
        </Btn>
        <input ref={fileRef} type="file" id="etut-file" accept=".json,application/json" hidden onChange={onFile} />
      </PageHead>
      <AnimatePresence initial={false}>
        {errs && (
          <motion.div key="errs" className="k-panel k-sec st-import-err" role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE }}>
            <p className="st-gap-line"><span className="k-lvl" data-l="bad"><Warning size={14} weight="fill" aria-hidden="true" />{errs.title}</span></p>
            <ul className="k-small">{errs.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </motion.div>
        )}
      </AnimatePresence>
      <div><Seg label="study-lib" value={tab} options={TABS} onChange={(v) => { App.etutLibTab = v; App.render(); }} /></div>
      {tab !== "gunluk" && tab !== "hatalar" && <JobsPanel kinds={["study"]} title="Studies being written" />}
      {tab !== "gunluk" && tab !== "hatalar" && <NewWithClaude />}
      {tab !== "gunluk" && tab !== "hatalar" && !App.scope && <LiveSessionsPanel />}
      {tab !== "gunluk" && tab !== "hatalar" && !App.scope && <PracticePanel />}
      <motion.div key={tab} className="st-lib-body" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }}>
        {tab === "gunluk" ? <JournalList /> : tab === "hatalar" ? <ErrorList /> : <StudyList />}
      </motion.div>
    </div>
  );
}

function StudyList() {
  const App = A(), S = App.S, U = EU();
  const list = activeEtuts(), now = Date.now();
  const open = (id) => {
    App.etutOpen = id;
    const et = S.etuts[id];
    App.render(); window.scrollTo(0, 0);
  };
  const reviews = (et) => { App.goReview(et.deck_id); };
  const restart = (et) => {
    // A Study v2 package needs a cycle progress record; the legacy one would open the cycle screen on the report
    et.progress = window.KCycle && window.KCycle.isV2(et.package) ? window.KCycle.newProgress() : KE().newProgress();
    App.store.commit({ etuts: [et.etut_id] });
    U.resetUi(null);
    App.toast("The study restarts from part 1; the DSR history was kept.");
    App.render();
  };
  const del = (id) => {
    S.etuts[id] = { etut_id: id, removed: true, removed_at: Date.now() };
    App.store.commit({ etuts: [id] });
    App.toast("Study deleted; its objective cards remain in the Cards tab.");
    App.render();
  };
  const restore = (id) => {
    const pkg = (App.bundledEtuts || []).filter((p) => p.etut_id === id)[0];
    if (!pkg) return;
    // Reuse the old objective cards (tagged with the study id, created in objective order) so no duplicates appear
    const deckId = "etut-" + id, kz = KE().flatKazanimlar(pkg);
    const old = Object.keys(S.cards).map((cid) => S.cards[cid])
      .filter((c) => c.deck_id === deckId && c.card_type === "kazanim" && (c.tags || [])[0] === id)
      .sort((a, c) => a.created_at - c.created_at);
    const map = {};
    if (old.length === kz.length) kz.forEach((k, i) => { map[k.kazanim_id] = old[i].card_id; });
    S.etuts[id] = { etut_id: id, card_map: map, deck_id: S.decks[deckId] ? deckId : null };
    const r = importFromObject(pkg, false);
    if (r.errors && r.errors.length) { App.toast("The study could not be added: " + r.errors[0]); return; }
    App.render();
  };
  const removed = (App.bundledEtuts || []).filter((pkg) => { const e = S.etuts && S.etuts[pkg.etut_id]; return e && e.removed; });

  return (
    <div className="st-list">
      {list.length === 0 && (
        <div className="k-panel k-sec st-empty">
          <BookOpenText size={28} aria-hidden="true" />
          <p className="k-muted">No studies yet. When you provide a slide deck, the prepared study appears here; or load a study package.</p>
        </div>
      )}
      <AnimatePresence initial={false}>
        {list.map((et) => {
          const pkg = et.package, frac = progressFraction(et), src = pkg.source || {}, due = dueCount(et, now);
          const v2 = window.KCycle && window.KCycle.isV2(pkg);
          const nq = v2 ? pkg.parts.reduce((a, p) => a + (p.items || []).length, 0) + pkg.final_test.length : pkg.parts.reduce((a, p) => a + p.quiz.length, 0) + pkg.final_test.length;
          const draft = v2 && !window.KCycle.audit(pkg).certified;
          const started = !!et.progress.started_at, done = et.progress.stage === "done";
          return (
            <motion.article key={et.etut_id} layout className="k-panel st-item" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }} transition={{ duration: 0.3, ease: EASE }}>
              <div className="st-item-top">
                <div className="st-item-text">
                  <h2>{pkg.title}{pkg.sample && <Chip>sample</Chip>}{v2 && <Chip tone="accent" title="Priming → Learn & digest → Applying, then the final test and report">study cycle v2</Chip>}{draft && <Chip title="The coverage audit found gaps (open the study, then Coverage)">draft · not certified</Chip>}{pkg.generated_by && <Chip title={"Written in Kartotek by " + (pkg.generated_by.writers || []).map((w) => w.writer).join(", ") + ". " + (pkg.generated_by.verification ? pkg.generated_by.verification.verified + " of " + pkg.generated_by.verification.items + " items verified by an independent solution." : "")}>written by {((pkg.generated_by.writers || [])[0] || {}).writer || "a model"}</Chip>}</h2>
                  <p className="k-small k-muted">
                    {src.file || "source not given"}{src.type ? " · " + src.type.toUpperCase() : ""}
                    {src.slide_count ? " · " + src.slide_count + (src.unit === "page" ? (src.slide_count === 1 ? " page" : " pages") : (src.slide_count === 1 ? " slide" : " slides")) : ""}
                    {" · "}<span className="k-num">{pkg.parts.length}</span> {pkg.parts.length === 1 ? "part" : "parts"} · <span className="k-num">{KE().flatKazanimlar(pkg).length}</span> {KE().flatKazanimlar(pkg).length === 1 ? "objective" : "objectives"} · <span className="k-num">{nq}</span> {nq === 1 ? "question" : "questions"}
                  </p>
                </div>
                <div className="k-row-btns st-item-btns">
                  <Btn kind="primary" size="sm" data-open={et.etut_id} onClick={() => open(et.etut_id)}>
                    {done ? <Trophy size={17} weight="bold" aria-hidden="true" /> : started ? <ArrowRight size={17} weight="bold" aria-hidden="true" /> : <Play size={17} weight="fill" aria-hidden="true" />}
                    {started ? (done ? "See results" : "Continue") : "Start"}
                  </Btn>
                  {due > 0 && <Btn size="sm" onClick={() => reviews(et)}><Cards size={17} aria-hidden="true" />{due} objective review{due === 1 ? "" : "s"}</Btn>}
                  {started && <Confirm label="Restart" confirmLabel="Restart from part 1?" icon={<ArrowCounterClockwise size={15} weight="bold" aria-hidden="true" />} onConfirm={() => restart(et)} />}
                  <ConfirmBtn label={<><Trash size={15} weight="bold" aria-hidden="true" />Delete</>} confirmLabel="Delete this study? (cards are kept)" onConfirm={() => del(et.etut_id)} />
                </div>
              </div>
              <div className="st-item-progress" aria-label={"Progress " + Math.round(frac * 100) + "%"}>
                <Bar value={frac} tone={done ? "good" : undefined} />
                <p className="k-small k-muted"><span>{progressLabel(et)}</span><span className="k-num">{Math.round(frac * 100)}%</span></p>
              </div>
            </motion.article>
          );
        })}
      </AnimatePresence>
      {removed.length > 0 && (
        <details className="k-panel k-sec st-removed-box" open={window.App.pref("kartotek-removed-open") === "1"} onToggle={(e) => window.App.setPref("kartotek-removed-open", e.currentTarget.open ? "1" : "0")}>
          <summary className="k-sec-head"><h2>Deleted studies ({removed.length})</h2></summary>
          <ul className="st-removed">
            {removed.map((pkg) => (
              <li key={pkg.etut_id}>
                <span>{pkg.title}</span>
                <Btn kind="primary" size="sm" data-restore={pkg.etut_id} onClick={() => restore(pkg.etut_id)}><Plus size={15} weight="bold" aria-hidden="true" />Add again</Btn>
              </li>
            ))}
          </ul>
          <p className="k-small k-muted">Adding a study again starts it from part 1; its objective cards and their review history are reused.</p>
        </details>
      )}
    </div>
  );
}

// A new Study v2 module from the learner's own material (task E3): written in the app by any configured model as a background job,
// or, as before, by Claude Code from a prompt (Claude Code stays one of the routes, not a requirement)
function NewWithClaude() {
  const [f, setF] = useState({ title: "", files: "", scope: "", goal: "" });
  const [open, setOpen] = useState(false);
  const [route, setRoute] = useState(jobsAvailable() ? "app" : "claude");
  const id = f.title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const prompt = window.KCycle ? window.KCycle.newStudyPrompt({ title: f.title, id, files: f.files, scope: f.scope, goal: f.goal }) : "";
  return (
    <details className="k-panel k-sec st-new-claude" id="new-study" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="k-sec-head"><h2>New study from my files</h2></summary>
      <p className="k-small k-muted">A study in the cycle: Priming → Learn &amp; digest (lesson, your mind map, your explanation) → Applying → final test and report. Every outcome is taught, practised and tested; content comes only from your material.</p>
      {jobsAvailable() && <div><Seg label="new-study-route" value={route} options={[{ value: "app", label: "Write in the app" }, { value: "claude", label: "With Claude Code" }]} onChange={setRoute} /></div>}
      {route === "app" ? (
        <NewJob kind="study" intro="Your files are read on this PC. The model you choose writes the study step by step (units, outcomes and criteria, lessons, practice, final test, audit); every question is then solved again without its key. The result is saved as a draft in your content folder and stays “Not certified” until the audit reports 0 blockers."
          fields={[{ key: "title", label: "Title", optional: true, placeholder: "e.g. Linear algebra · lecture 3" }, { key: "scope", label: "Scope", optional: true, placeholder: "e.g. slides 1–24 only" }, { key: "goal", label: "Your goal", optional: true, placeholder: "e.g. the midterm on 12 Nov" }]}
          onCreated={() => A().toast("Files read. Check the estimate under “Studies being written”, then press Start.")} />
      ) : (
        <>
          <p className="k-small k-muted">Claude Code reads your slides, notes or book pages on this PC and writes the study.</p>
          <div className="st-new-grid">
            <label className="k-field"><span className="k-field-label">Title</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Linear algebra · lecture 3" /></label>
            <label className="k-field"><span className="k-field-label">Files on this PC</span><input value={f.files} onChange={(e) => setF({ ...f, files: e.target.value })} placeholder="e.g. C:\Users\you\Downloads\lecture3.pdf" /></label>
            <label className="k-field"><span className="k-field-label">Scope (optional)</span><input value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} placeholder="e.g. slides 1–24 only" /></label>
            <label className="k-field"><span className="k-field-label">Your goal (optional)</span><input value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder="e.g. the midterm on 12 Nov" /></label>
          </div>
          <div className="k-row-btns">{f.title.trim() && f.files.trim() ? <AskPair what="writing a study" prompt={prompt} label="Write with Claude" primary /> : <span className="k-small k-muted">Give a title and the file path(s).</span>}</div>
        </>
      )}
    </details>
  );
}

function JournalList() {
  const App = A();
  const rows = [];
  activeEtuts().forEach((et) => {
    // A study that moved to v2 keeps its earlier journal in progress_legacy
    const lp = et.progress.v === "c2" ? et.progress.progress_legacy || {} : et.progress;
    Object.keys(lp.journal || {}).forEach((k) => rows.push({ et, part: Number(k), j: lp.journal[k] }));
    if (lp.final_review) rows.push({ et, part: null, j: lp.final_review });
  });
  rows.sort((a, b) => (b.j.at || 0) - (a.j.at || 0));
  if (!rows.length) {
    return (
      <div className="k-panel k-sec st-empty">
        <NotePencil size={28} aria-hidden="true" />
        <p className="k-muted">No journal entries yet. A learning journal is filled in at the end of each part.</p>
      </div>
    );
  }
  return (
    <div className="st-list">
      {rows.map((r, idx) => {
        const j = r.j, title = r.part == null ? "Study reflection" : "Part " + (r.part + 1) + ": " + (r.et.package.parts[r.part] || {}).title;
        const dl = r.part == null
          ? [["Did I reach my goal?", YN_TR[j.goal_met] || "-"], ["Strategy that worked", j.strategy], ["What did I mispredict?", j.mispredicted]]
          : [["Goal", j.goal], ["Performance", j.n ? j.correct + "/" + j.n + " (criterion " + j.criterion + ")" : "-"],
            ["Prediction gap", j.gap == null ? "-" : signed(j.gap) + " points"],
            ["What I can explain without notes", j.explainable], ["What I struggled with", j.struggled], ["Evidence of the difficulty", j.evidence],
            ["Strategy that worked", j.strategy], ["Review date", j.review_at ? App.fmtDate(j.review_at) : "-"]];
        return (
          <motion.article key={r.et.etut_id + ":" + r.part} className="k-panel k-sec st-journal-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE, delay: Math.min(idx, 6) * 0.03 }}>
            <div className="k-sec-head">
              <h2>{r.et.package.title} · {title}</h2>
              <span className="k-small k-muted k-num">{App.fmtDate(j.at)}</span>
            </div>
            <dl className="st-facts">
              {dl.filter((x) => x[1]).map((x, i) => (
                <div key={i}><dt>{x[0]}</dt><dd>{String(x[1])}</dd></div>
              ))}
            </dl>
            <p className="st-change-line"><b>The one thing I will change:</b> {j.change || "-"}</p>
          </motion.article>
        );
      })}
    </div>
  );
}

function ErrorList() {
  const App = A(), M = KM();
  const log = M.errorLog(App.S), dist = M.errorDistribution(App.S).filter((d) => d.count);
  if (!log.length) {
    return (
      <div className="k-panel k-sec st-empty">
        <Bug size={28} aria-hidden="true" />
        <p className="k-muted">No error entries yet. For wrong answers, the error type, its cause and your next step are collected here.</p>
      </div>
    );
  }
  const top = dist[0];
  return (
    <div className="st-list">
      <section className="k-panel k-sec">
        <div className="k-sec-head"><h2>Error types</h2></div>
        <div className="st-chips">{dist.map((d) => <span key={d.id} className="k-tag">{d.label} · <b className="k-num">{d.count}</b></span>)}</div>
        <Callout label={"Most frequent: " + top.label}><p>{top.action}</p></Callout>
      </section>
      <TableWrap>
        <table className="k-table st-table-wrap">
          <thead><tr><th>Date</th><th>Study</th><th>Question</th><th>Type</th><th>Cause</th><th>Concrete step</th></tr></thead>
          <tbody>
            {log.map((x, i) => {
              const e = x.answer.error;
              return (
                <tr key={i}>
                  <td className="k-num st-nowrap">{App.fmtDate(x.answer.at)}</td>
                  <td>{x.etut}<br /><span className="k-small k-muted">{x.where}</span></td>
                  <td><Inl src={x.stem} /></td>
                  <td>{(M.ERROR_BY_ID[e.type] || {}).label || e.type}</td>
                  <td>{e.cause || "-"}</td>
                  <td>{e.step || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}
