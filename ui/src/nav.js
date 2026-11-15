// Navigation model (task D1, ARCHITECTURE.md section 7): which sidebar entry, mode and scope a tab id belongs to.
// The engine's tab ids do not change (saved state, #hash links and App.scope all use them); this module only maps them to the new
// places and back. Plain functions, no React: scripts/nav-tests.cjs tests them.
//
// Tab ids:
//   study, etut, cards            Review, Study, Cards for all decks         cents-study, cents-etut, cents-cards, tud-...  scoped to one exam
//   mock-all                      Mock exam when the scope is All (a picker)   cents-mock, tud-mock                          one exam's mock exams
//   lesson                        End-of-lesson test (not exam-scoped)
//   home                          Planning home (combined timeline)
//   cents, tud                    exam overviews                               tud-apply   TU Delft application plan
//   stats, euroapply              Planning                                     mindmaps, career, settings, algo   always visible

export const EXAMS = [
  { id: "cents", label: "CEnT-S" },
  { id: "tud", label: "TU Delft AE Prep" },
];

// Study mode entries. `base` is the unscoped tab id; scoped ids are "<exam>-<suffix>".
export const STUDY_ITEMS = [
  { key: "review", label: "Review", base: "study", suffix: "study", scoped: true },
  { key: "study", label: "Study", base: "etut", suffix: "etut", scoped: true },
  { key: "cards", label: "Cards", base: "cards", suffix: "cards", scoped: true },
  { key: "mock", label: "Mock exam", base: "mock-all", suffix: "mock", scoped: true },
  { key: "lesson", label: "End-of-lesson test", base: "lesson", suffix: null, scoped: false },
];

// Planning mode entries (tab ids). The home page (combined timeline), the overview of each exam, its application page, Euro apply and Stats.
export const PLANNING_IDS = ["home", "cents", "tud", "tud-apply", "euroapply", "stats"];
export const ALWAYS_IDS = ["mindmaps", "career"];
export const SYSTEM_IDS = ["settings", "algo"];

const SCOPED_RE = /^(cents|tud)-(study|etut|cards|mock)$/;

// The tab id of a Study mode entry for a scope (null or "all" = every deck)
export function studyTab(itemKey, scope) {
  const item = STUDY_ITEMS.find((i) => i.key === itemKey);
  if (!item) return null;
  if (!item.scoped || !scope || scope === "all") return item.base;
  return scope + "-" + item.suffix;
}

// Where a tab id lives: { mode: "study" | "planning" | null, scope: exam id | null | undefined, item }
// mode null = visible in both modes (Mind maps, Career, System). scope undefined = the tab has no scope (the remembered one stays).
// Returns null for an unknown tab id.
export function locate(tab) {
  const m = SCOPED_RE.exec(tab || "");
  if (m) {
    const item = STUDY_ITEMS.find((i) => i.suffix === m[2]);
    return { mode: "study", scope: m[1], item: item.key };
  }
  const base = STUDY_ITEMS.find((i) => i.base === tab);
  if (base) return { mode: "study", scope: base.scoped ? null : undefined, item: base.key };
  if (PLANNING_IDS.indexOf(tab) >= 0) return { mode: "planning", scope: undefined, item: tab };
  if (ALWAYS_IDS.indexOf(tab) >= 0 || SYSTEM_IDS.indexOf(tab) >= 0) return { mode: null, scope: undefined, item: tab };
  return null;
}

// Position of a tab in the sidebar's reading order: the direction of the tab transition follows it
const ORDER = STUDY_ITEMS.map((i) => i.key).concat(PLANNING_IDS, ALWAYS_IDS, SYSTEM_IDS);
export function orderOf(tab) {
  const at = locate(tab);
  if (!at) return ORDER.length;
  return Math.max(0, ORDER.indexOf(at.item));
}

// Tab ids a mode shows, in order, for a scope (the keyboard moves through these, then Mind maps, Career and System)
export function visibleTabs(mode, scope) {
  const own = mode === "planning" ? PLANNING_IDS.slice() : STUDY_ITEMS.map((i) => studyTab(i.key, scope));
  return own.concat(ALWAYS_IDS, SYSTEM_IDS);
}

export const MODES = ["study", "planning"];
export const SCOPES = [{ id: "all", label: "All" }].concat(EXAMS);
