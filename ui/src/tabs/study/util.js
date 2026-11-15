// Pure helpers ported from the legacy Study view (views-etut.js / etut-srl.js). They read engine state only.
export const A = () => window.App;
export const KE = () => window.KEtut;
export const KM = () => window.KMeta;
export const EU = () => window.App.EtutUI;
export const DSR = () => window.DSR;
export const LETTERS = ["A", "B", "C", "D"];
export const YN = [{ v: "evet", label: "Yes" }, { v: "kismen", label: "Partly" }, { v: "hayir", label: "No" }];
export const YN_TR = { evet: "Yes", kismen: "Partly", hayir: "No" };

// Inside an exam section (CEnT-S, TU Delft AE Prep) only that exam's studies are listed
export function activeEtuts() {
  const App = A(), all = KM().activeEtuts(App.S);
  return App.scope ? all.filter((et) => App.etutInExam(et, App.scope)) : all;
}

export function progressFraction(et) {
  if (window.KCycle && window.KCycle.isV2(et.package)) return window.KCycle.progressFraction(et);
  const pkg = et.package, pr = et.progress, order = KE().PART_STAGES;
  let total = 0, done = 0;
  pkg.parts.forEach((p, i) => {
    const units = order.length + p.kazanimlar.length + p.quiz.length;
    total += units;
    if (i < pr.part || ["final", "final_review", "done"].indexOf(pr.stage) >= 0) done += units;
    else if (i === pr.part) {
      const si = order.indexOf(pr.stage);
      done += Math.max(0, si);
      if (pr.stage === "learn") done += pr.k;
      else if (si > order.indexOf("learn")) done += p.kazanimlar.length;
      if (pr.stage === "quiz") done += pr.qi;
      else if (si > order.indexOf("quiz")) done += p.quiz.length;
    }
  });
  total += pkg.final_test.length + 1;
  if (pr.stage === "final") done += pr.qi;
  if (pr.stage === "final_review") done += pkg.final_test.length;
  if (pr.stage === "done") done = total;
  return total ? Math.min(1, done / total) : 0;
}

export function progressLabel(et) {
  if (window.KCycle && window.KCycle.isV2(et.package)) return window.KCycle.progressLabel(et);
  const pr = et.progress, pkg = et.package;
  if (!pr.started_at) return "Not started";
  if (pr.stage === "done") return "Completed";
  if (pr.stage === "final" && pr.sub === "predict" && pr.final_open_at && Date.now() < pr.final_open_at) return "Final test · opens " + A().fmtDate(pr.final_open_at);
  if (pr.stage === "final") return "Final test" + (pr.sub === "q" ? " · question " + (pr.qi + 1) + "/" + pkg.final_test.length : "");
  if (pr.stage === "final_review") return "Study reflection";
  return "Part " + (pr.part + 1) + "/" + pkg.parts.length + " · " + KE().STAGE_TR[pr.stage];
}

export function dueCount(et, now) {
  const S = A().S, D = DSR();
  const tomorrow = D.dayStart(D.dayIndex(now, S.settings.day_start_hour) + 1, S.settings.day_start_hour);
  return Object.keys(et.card_map).filter((k) => {
    const m = S.mem[et.card_map[k]];
    return m && !m.suspended && m.state !== "new" && m.due_at && m.due_at < tomorrow;
  }).length;
}

// Where the shared recall screen reads and writes (learn, warm-up, second round)
export function recallLoc(et) {
  const pr = et.progress;
  if (pr.stage === "learn") {
    const k = KE().currentKazanim(et);
    return {
      k, phase: pr.sub, saved: pr.recalls[k.kazanim_id], round: null, label: "Recall",
      setPhase: (p) => { pr.sub = p; }, save: (r) => { pr.recalls[k.kazanim_id] = r; },
      nextLabel: KE().currentPart(et).kazanimlar.length - 1 === pr.k ? "Go to the quiz" : "Next objective",
      key: "rc:learn:" + pr.part + ":" + pr.k,
    };
  }
  const box = (pr.stage === "warmup" ? pr.warmup : pr.retry)[pr.part];
  const kid = box.kids[box.i], kz = KE().findKazanim(et.package, kid);
  return {
    k: kz, phase: box.sub, saved: box.results[kid], round: pr.stage,
    label: pr.stage === "warmup" ? "Warm-up " + (box.i + 1) + "/" + box.kids.length + " · from an earlier part" : "Second round " + (box.i + 1) + "/" + box.kids.length,
    setPhase: (p) => { box.sub = p; }, save: (r) => { box.results[kid] = r; },
    nextLabel: box.i + 1 < box.kids.length ? "Next question" : "Continue",
    key: "rc:" + pr.stage + ":" + pr.part + ":" + box.i,
  };
}

export function viewKey(et) {
  const pr = et.progress;
  if (pr.stage === "warmup" || pr.stage === "retry" || (pr.stage === "learn" && ["recall", "check", "rated"].indexOf(pr.sub) >= 0)) return recallLoc(et).key;
  return [pr.stage, pr.part, pr.k, pr.sub, pr.qi, pr.ei, pr.pi].join(":");
}

export function currentQuestion(et) {
  const pr = et.progress, pkg = et.package;
  if (pr.stage === "quiz") { const qs = pkg.parts[pr.part].quiz; return { q: qs[pr.qi], n: qs.length }; }
  const byId = {};
  pkg.final_test.forEach((q) => { byId[q.q_id] = q; });
  return { q: byId[pr.final_order[pr.qi]], n: pr.final_order.length };
}

export function phaseKey(pr) { return pr.stage === "final" || pr.stage === "final_review" || pr.stage === "done" ? "final" : String(pr.part); }

// Required fields: "name,name@minLength"
const REQ_TR = {
  goal: "goal", explain: "explanation", produce: "text", ptext: "solution", pself: "self-check", self: "self-check", jol: "prediction", predict: "prediction",
  choice: "option", reason: "reasoning (at least 5 characters)", conf: "confidence", errtype: "error type", errcause: "cause", errstep: "concrete step",
  teach: "explanation (at least 40 characters)", change: "the one thing you will change", goal_met: "answer to E1",
};
export function missingReqs(req, form) {
  const reqs = req ? req.split(",").filter(Boolean) : [];
  const missing = [];
  reqs.forEach((r) => {
    const m = r.match(/^(.*)@(\d+)$/), name = m ? m[1] : r, min = m ? Number(m[2]) : 1;
    const v = form[name];
    const bad = v == null || (typeof v === "boolean" ? !v : String(v).trim().length < min);
    if (bad) {
      const label = /^prior:/.test(name) ? "prior-knowledge ratings" : (REQ_TR[name] || name);
      if (missing.indexOf(label) < 0) missing.push(label);
    }
  });
  return missing;
}

export function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }
export function signed(x) { return (x > 0 ? "+" : "") + A().dec(x * 100, 0); }
