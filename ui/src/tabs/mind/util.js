// Shared helpers for the Mind map assistant (MINDMAP-RULES.md). Data work lives in src/mindmap-core.js (window.KMind).
export const App = () => window.App;
export const KM = () => window.KMind;

export function save(id) {
  App().store.commit({ meta: true, mindmaps: id ? [id] : [] });
  App().render();
}
export function docOf(id) {
  const S = App().S;
  const d = S.mindmaps && S.mindmaps[id];
  return d && !d.removed ? KM().ensure(S, id) : null;
}
export function parseOf(id) { return (App().mindParse || {})[id] || null; }
export function refOf(id) { return (App().mindRef || {})[id] || null; }

// Photos: kcontent://mindmaps/<id>/<file> in the desktop app (served from the content folder), a relative path next to
// Kartotek-DSR.html in the browser page; a photo chosen in the page is used for this session only
export function viewSrc(doc, view) {
  const loc = (App().mindLocal || {})[doc.map_id];
  if (loc && loc[view.id]) return loc[view.id];
  return window.KHost.photoUrl(doc.map_id, view.file);
}
export function setLocalPhoto(mapId, viewId, file) {
  const A = App();
  A.mindLocal = A.mindLocal || {};
  A.mindLocal[mapId] = A.mindLocal[mapId] || {};
  A.mindLocal[mapId][viewId] = URL.createObjectURL(file);
  A.render();
}

export function when(ts) {
  if (!ts) return "";
  const d = new Date(typeof ts === "number" ? ts : Date.parse(ts));
  if (isNaN(d)) return "";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function obsText(o) {
  if (!o) return "";
  if (o.raw != null && o.raw !== "") return o.normalized && o.normalized !== o.raw ? o.raw + " (" + o.normalized + ")" : o.raw;
  return "";
}
export const OBS_KIND = {
  text: "Text", node: "Node", line: "Line", arrowhead: "Arrowhead", junction: "Junction", group_boundary: "Group boundary",
  symbol: "Symbol", emphasis: "Emphasis", possible_deletion: "Possibly crossed out",
};
export const VER_LABEL = {
  provisional: "Provisional", visually_supported: "Read", unresolved: "Unresolved",
  learner_confirmed: "You confirmed", learner_corrected: "You corrected",
};
export const OBJ_KIND = {
  table: "Table", chart: "Chart", schematic: "Schematic", timeline: "Timeline", code_or_notation: "Code / notation",
  question: "Question", annotation: "Annotation",
};
export const SOURCE_LABEL = {
  reading: "Reading", perception: "Reading corrected", learner_edit: "Your edit", patch: "Approved proposal", revert: "Restored",
};
export const REQ_LABEL = {
  read: "Read the photos", reread: "Read again", coach: "Coaching turn", grade: "Grade a check", reference: "Reference map",
};
export const DIR_LABEL = { forward: "→", bidirectional: "↔", undirected: "—", unknown: "?", none: "—" };
export const STATUS_LABEL = {
  partial: "Partial reading", ready_for_requested_scope: "Ready for the chosen scope", needs_better_input: "Needs a better photo",
};
export const OUTCOME_LABEL = { correct: "Correct", partial: "Partly", incorrect: "Not correct", uncertain: "Not sure", not_evaluated: "Not graded" };

// The observation's regions grouped by view, for crops ("seen in B and D")
export function regionsOf(parse, o) {
  const byId = {};
  (parse.regions || []).forEach((r) => { byId[r.id] = r; });
  return (o.regions || []).map((id) => byId[id]).filter(Boolean);
}
export function viewOf(parse, id) { return (parse.views || []).find((v) => v.id === id) || null; }
export function viewName(v) { return v ? v.id + " · " + (KM().ROLE_LABEL[v.role] || v.role) : ""; }

// Which concept an observation stands for in the current map (to move relation endpoints)
export function conceptOfObs(map, obsId) {
  const k = (map.concepts || []).find((c) => (c.observations || []).indexOf(obsId) >= 0);
  return k ? k.id : null;
}
export function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9ğüşöçıİ]+/gi, ""); }
