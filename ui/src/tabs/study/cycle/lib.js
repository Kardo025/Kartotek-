// Helpers for the Study v2 screens (src/study-v2.js = window.KCycle)
export const A = () => window.App;
export const KC = () => window.KCycle;
export const KE = () => window.KEtut;
export const EU = () => window.App.EtutUI;

export function extrasOf(et) { return ((A().studyExtras || {})[et.etut_id]) || null; }
export function itemsOf(et) { return KC().itemIndex(et.package, extrasOf(et)); }
export function partOf(et, pi) { return et.package.parts[pi == null ? et.progress.part : pi]; }

export function save(et, extra) { EU().commit(et, extra); A().render(); }

// One attempt → DSR through the existing scheduler, then commit (cards + review log when sent)
export function sendAttempt(et, attempt, item) {
  const App = A(), S = App.S, U = EU();
  let el = KC().send(S, et, attempt, item, U.env(Date.now()));
  if (!el.eligible && /card for this objective was not found/i.test(el.reason || "")) {
    // The objective's card was deleted: re-import the package to repair it, then try again (as the legacy flow does)
    const fix = KE().importPackage(S, et.package);
    App.store.commit({ meta: true, etuts: [et.etut_id], cards: fix.created || [] });
    attempt.dsr = null;
    el = KC().send(S, et, attempt, item, U.env(Date.now()));
  }
  if (attempt.dsr && attempt.dsr.status === "sent" && attempt.dsr.card_id) {
    App.store.commit({ etuts: [et.etut_id], cards: [attempt.dsr.card_id], reviewsFrom: S.reviews.length - 1 });
  } else U.commit(et);
  return el;
}

export function refsText(pkg, refs) {
  const units = {};
  (pkg.units || []).forEach((u) => { units[u.id] = u; });
  return (refs || []).map((r) => (units[r] ? units[r].loc || r : r)).filter((x, i, a) => a.indexOf(x) === i).join(" · ");
}
export function criterionText(pkg, id) {
  const c = KC().criteriaIndex(pkg)[id];
  return c ? c.criterion.text : id;
}
export function when(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
export const LETTERS = "ABCDEF";
export const CONF = [{ v: "guess", label: "Guess" }, { v: "unsure", label: "Unsure" }, { v: "sure", label: "Sure" }];
export const RATINGS = [{ v: "again", label: "Again" }, { v: "hard", label: "Hard" }, { v: "good", label: "Good" }, { v: "easy", label: "Easy" }];
