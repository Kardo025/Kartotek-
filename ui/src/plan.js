// Planning home (task D2): one combined timeline from three sources, none of them modified here.
//   Kartotek  exam dates and study pace per exam, the dated rows and the open steps of the TU Delft Application page
//   Euro apply  programme deadlines, from the read-only projection of its data\universities.json (desktop/euroapply.js)
// A TU Delft item that exists in both apps is shown once, owned by Euro apply (the owner's decision): the Application page's copy is
// folded into the Euro apply row, which says "also on the Application page". Plain functions, no React: scripts/plan-tests.cjs.

const DAY = 864e5;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON_LONG = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const isoDay = (ts) => { const d = new Date(ts); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const localDay = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };

// The calendar day of a Euro apply or plan date as written (the first 10 characters), and its time of day when it has one.
// Sorting uses the full timestamp when there is a time, so "2027-01-15T23:59+01:00" sorts after a date-only item of that day.
export function parseDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(text || ""));
  if (!m) return null;
  const day = m[1] + "-" + m[2] + "-" + m[3];
  const dayTs = localDay(day);
  return { day, dayTs, time: m[4] ? m[4] + ":" + m[5] : null, ts: dayTs + (m[4] ? (Number(m[4]) * 60 + Number(m[5])) * 60000 : 0) };
}

export function formatDay(day) {
  const d = parseDay(day);
  if (!d) return "";
  const x = new Date(d.dayTs);
  return x.getDate() + " " + MON_LONG[x.getMonth()] + " " + x.getFullYear();
}

// ---- matching one TU Delft item that both apps know
const STOP = new Set("the and for from with only after before deadline deadlines application applications close closes closed open opens date dates student students university upload online phase round final first second third that this your into than then have been will when where which about part".split(" "));
export function tokens(text) {
  return new Set(String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)));
}
// Same calendar day and at least one meaningful word in common (title and note of both)
export function sameItem(euro, milestone) {
  if (!euro.parsed || euro.parsed.day !== milestone.day) return false;
  const a = tokens(euro.label + " " + euro.note), b = tokens(milestone.title + " " + milestone.note);
  for (const w of a) if (b.has(w)) return true;
  return false;
}

// ---- open steps carry loose dates ("Before 15 Jan", "Mid-June (1 Jul latest)", "Nov-Dec 2026"): read the first day or month in them
// Returns { ts, approx } or null (not recognised: the step stays undated). The year is the next occurrence unless the text names one.
export function looseDate(when, now) {
  const text = String(when || "");
  // a month by name or abbreviation (not the start of another word), with an optional day before it and a year after it
  const names = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  const re = new RegExp("(?:\\b(\\d{1,2})(?:\\s*[-\\u2013]\\s*\\d{1,2})?\\s+)?\\b(" + names + ")\\b(?:\\s+(20\\d\\d))?", "ig");
  const m = re.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  let day = m[1] ? Number(m[1]) : null;
  const approx = !day;
  if (!day) day = /\bmid\b/i.test(text.slice(0, m.index + m[0].length)) ? 15 : /\bend\b/i.test(text.slice(0, m.index + m[0].length)) ? 25 : 1;
  const year = m[3] ? Number(m[3]) : null;
  const base = startOfDay(now);
  let ts;
  if (year) ts = new Date(year, month, day).getTime();
  else {
    const y = new Date(base).getFullYear();
    ts = new Date(y, month, day).getTime();
    // a date more than 45 days behind us means next year's
    if (ts < base - 45 * DAY) ts = new Date(y + 1, month, day).getTime();
  }
  return { ts, approx };
}

// Programmes still in play: not rejected
const activeProgram = (p) => p.status !== "Rejected";

// Euro apply items, read-only: university-level and programme-level timelines of universities that have a live programme.
// The same day and label inside one university shows once (several programmes repeat a university's dates).
export function euroItems(universities, opts) {
  const out = [];
  const delft = (opts && opts.delft) || /delft/i;
  for (const u of universities || []) {
    const live = (u.programs || []).filter(activeProgram);
    if (!live.length) continue;
    const seen = new Set();
    const push = (t, programme) => {
      const parsed = parseDay(t.date);
      if (!parsed) return; // an item without a date cannot sit on a timeline
      const key = parsed.day + "|" + String(t.label).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 28);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ uid: u.id + ":" + (t.id || key), university: u, programme: programme || null, parsed, label: t.label, kind: t.kind, est: t.est, checked: t.checked, url: t.url, note: t.note, tuDelft: delft.test(u.id) || delft.test(u.name) });
    };
    (u.timeline || []).forEach((t) => push(t, null));
    live.forEach((p) => (p.timeline || []).forEach((t) => push(t, p)));
  }
  return out;
}

// ---- the timeline
// input: { now, windowDays (null = all upcoming), exams: [{ id, label, examTs, days, left, perDay, topicsPerDay, status }],
//          plan (the Application page's plan or null), ticks ({ steps: { index: ts } }), euro (result of euroapply.read, or null),
//          euroWhy (why there is no Euro apply result), showEuro (default true) }
// output: { rows, undated, missing, euro: { updated, universities, shown } }
export function buildTimeline(input) {
  const now = input.now, today = startOfDay(now);
  const limit = input.windowDays ? today + input.windowDays * DAY + DAY - 1 : null;
  const inWindow = (ts) => ts >= today && (limit == null || ts <= limit);
  const rows = [], undated = [], missing = [];

  // 1. Kartotek: exam dates and pace per exam (always shown, whatever the window)
  for (const x of input.exams || []) {
    const pace = x.examTs
      ? x.days + (x.days === 1 ? " day" : " days") + " left" + (x.left != null ? " · " + x.left + " required pages left, " + x.perDay + " a day (" + x.topicsPerDay + " topics)" : "") + (x.status ? " · " + x.status : "")
      : "";
    if (x.examTs) {
      rows.push({ uid: "exam:" + x.id, ts: x.examTs, day: isoDay(x.examTs), title: x.label + " exam", detail: pace, kind: "exam", source: "kartotek", owner: "Kartotek", ownerWhere: x.label + " overview", link: { tab: x.id }, est: false, group: "exams" });
    } else {
      undated.push({ uid: "exam:" + x.id, title: x.label + ": no exam date set", detail: "Set it on the overview to see the days left and the pace.", source: "kartotek", owner: "Kartotek", ownerWhere: x.label + " overview", link: { tab: x.id } });
    }
  }

  // 2. Euro apply: programme deadlines (read only)
  let items = [];
  const euro = { updated: null, universities: 0, shown: 0 };
  if (input.euro && input.euro.ok) {
    const v = input.euro.value;
    euro.updated = v.updated || null;
    items = euroItems(v.universities);
    euro.universities = new Set(items.map((i) => i.university.id)).size;
  } else {
    missing.push({ what: "Euro apply deadlines", why: input.euroWhy || (input.euro && input.euro.message) || "Euro apply is not connected." });
  }

  // 3. The Application page: dated rows and open steps
  const plan = input.plan;
  const milestones = [];
  if (plan && Array.isArray(plan.milestones)) {
    for (const m of plan.milestones) {
      const p = parseDay(m[0]);
      if (!p) continue;
      milestones.push({ day: p.day, ts: p.dayTs, title: m[2] || "", note: m[3] || "", flags: m[4] || "", group: m[1] });
    }
  } else {
    missing.push({ what: "TU Delft Application page", why: "No application plan is loaded (exam/tud-apply.json in the content folder)." });
  }
  // A TU Delft item both apps know: one row, owned by Euro apply; the Application page's row folds into it
  const euroRows = [];
  if (input.showEuro !== false) {
    for (const it of items) {
      const also = it.tuDelft ? milestones.find((x) => sameItem(it, x)) || null : null;
      euroRows.push({
        uid: "euro:" + it.uid, ts: it.parsed.ts, day: it.parsed.day, time: it.parsed.time, title: it.label,
        detail: it.university.name + (it.programme ? " · " + it.programme.name : "") + (it.note ? " · " + it.note : ""),
        kind: it.kind, source: "euroapply", owner: "Euro apply", ownerWhere: it.university.name,
        link: { euro: true, url: it.url }, also: also ? { app: "Kartotek", where: "Application page", tab: "tud-apply", title: also.title } : null,
        est: it.est, checked: it.checked, alsoMilestone: also ? also.day + "|" + also.title : null,
      });
    }
  }
  // The same deadline carried by several universities (a shared exam sitting, for example) is one row that names them
  const merged = new Map();
  for (const r of euroRows.splice(0)) {
    const key = r.day + "|" + String(r.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + "|" + r.kind;
    const first = merged.get(key);
    if (!first) { r.universities = [r.ownerWhere]; merged.set(key, r); continue; }
    if (first.universities.indexOf(r.ownerWhere) < 0) first.universities.push(r.ownerWhere);
    if (!first.also && r.also) { first.also = r.also; first.alsoMilestone = r.alsoMilestone; }
    if (!first.link.url && r.link.url) first.link = r.link;
    first.est = first.est && r.est;
  }
  for (const r of merged.values()) {
    if (r.universities.length > 1) {
      const names = r.universities.slice(0, 3).join(", ") + (r.universities.length > 3 ? " and " + (r.universities.length - 3) + " more" : "");
      r.detail = names;
      r.ownerWhere = r.universities.length + " universities";
    }
    euroRows.push(r);
  }
  const foldedMilestones = new Set(euroRows.filter((r) => r.alsoMilestone).map((r) => r.alsoMilestone));
  for (const r of euroRows) if (inWindow(r.ts)) rows.push(r);
  euro.shown = euroRows.filter((r) => inWindow(r.ts)).length;

  for (const m of milestones) {
    if (foldedMilestones.has(m.day + "|" + m.title)) continue;
    if (!inWindow(m.ts)) continue;
    rows.push({ uid: "plan:" + m.day + ":" + m.title, ts: m.ts, day: m.day, title: m.title, detail: m.note, kind: m.flags === "crit" ? "deadline" : "plan", source: "kartotek", owner: "Kartotek", ownerWhere: "Application page", link: { tab: "tud-apply" }, est: m.flags === "approx", group: "application" });
  }

  // open steps of the Application page: placed where their loose date says; already past or unrecognised ones go to "now" or "undated"
  if (plan && Array.isArray(plan.steps)) {
    const done = (input.ticks && input.ticks.steps) || {};
    plan.steps.forEach((s, i) => {
      if (done[i]) return;
      const when = s[0] || "", title = s[1] || "", note = s[2] || "";
      const d = looseDate(when, now);
      const base = { uid: "step:" + i, title: "Step: " + title, detail: (when ? when + (note ? " · " : "") : "") + note, kind: "step", source: "kartotek", owner: "Kartotek", ownerWhere: "Application page", link: { tab: "tud-apply" }, group: "application" };
      if (!d) { undated.push(base); return; }
      if (d.ts < today) { rows.push(Object.assign(base, { ts: today, day: isoDay(today), overdue: true, est: true, detail: "was due " + when + (note ? " · " + note : "") })); return; }
      if (inWindow(d.ts)) rows.push(Object.assign(base, { ts: d.ts, day: isoDay(d.ts), est: d.approx }));
    });
  }

  rows.sort((a, b) => a.ts - b.ts || (a.source === b.source ? 0 : a.source === "kartotek" ? -1 : 1) || a.title.localeCompare(b.title));
  return { rows, undated, missing, euro };
}
