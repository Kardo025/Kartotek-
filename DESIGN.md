---
name: Kartotek
description: Spaced-repetition cards, studies and end-of-lesson tests scheduled by the D-S-R memory model. A focused premium tool, dark-first, one coral accent, cinematic motion that never holds back input.
colors:
  dark:
    bg: "#09090b"
    side: "#0f0f11"
    panel: "#111113"
    raised: "#18181b"
    overlay: "#1f1f23"
    tile: "#19191c"
    line: "rgba(255,255,255,.07)"
    line-strong: "rgba(255,255,255,.12)"
    text: "#ededef"
    text-2: "#c4c4cc"
    muted: "#8f8f98"
    text-3: "#6b6b73"
    accent: "#ff6b5b (coral; text, lines, rings)"
    accent-fill: "#ff6b5b (solid surfaces with text), accent-text #1a0b09"
    accent-soft: "rgba(255,107,91,.14)"
    again: "#e5484d"
    hard: "#ffb224"
    good: "#3dd68c"
    easy: "#52a9ff"
  light:
    bg: "#f7f7f8"
    side: "#ffffff"
    panel: "#ffffff"
    raised: "#ffffff (with shadow-raised)"
    tile: "#f4f4f5"
    line: "rgba(17,17,19,.08)"
    text: "#111113"
    text-2: "#3f3f46"
    muted: "#62626b"
    accent: "#c93a26 (coral dark enough for text on white)"
    accent-fill: "#ff6b5b, accent-text #1a0b09"
    again: "#ce2c31"
    hard: "#b45309"
    good: "#18794e"
    easy: "#0d74ce"
typography:
  family: "Inter Variable (self-hosted), Segoe UI, system-ui; cv11, ss01; tabular figures on numbers"
  page-title: "21px / 600 / -0.02em"
  nav-and-controls: "13.5px / 500, 32–34px tall"
  body: "14px; reading text 14.5px / 1.55"
  card-front: "28px / 600 (34px when 24 characters or fewer)"
  card-back: "19px / 500, text colour (coral is for action)"
  hero-number: "44px / 650 / -0.03em"
  label: "11.5–12.5px"
rounded: { sm: 6, md: 8, rating: 10, lg: 12, xl: 16, pill: 999 }
spacing: "4 / 8 / 12 / 16 / 24 / 32 / 48"
motion:
  ease-out: "cubic-bezier(0.23, 1, 0.32, 1) feedback"
  ease-travel: "cubic-bezier(0.45, 0, 0.1, 1) A to B"
  ease-arrive: "cubic-bezier(0.25, 0.8, 0.25, 1) appears from nowhere"
  spring: "stiffness 420, damping 38 (nav and stage highlights)"
  durations: "press 100 · fast 160 · ui 240 · scene 420 · story 800 ms"
---

# Design System: Kartotek

The thesis, principles and signature moments are in `research/redesign/design-philosophy.md` (the owner's choices, 2026-11-10, built with ideas from the stageshow skill). This file records what is built.

## Overview
Kartotek is an instrument for memory: every screen answers "what should I do now, and why?". It is dark-first and quiet, so the one thing that matters (the card, the current item, the number that changed) is the brightest thing on screen. Depth comes from surface steps (canvas → panel → raised → overlay), not shadows; the light theme adds soft shadows. Coral is the only accent: primary action, focus, current position. The four rating colours appear only on ratings and state pills, and every rating also carries an icon, its name and its key. The theme follows the system by default (Auto · Light · Dark at the foot of the sidebar).

## Architecture
- The engine (`src/*.js`: `DSR`, `KStore`, `App`, the views) keeps all state and logic, and saved browser data keeps working.
- `ui/` is a React 18 + Motion app, built with Vite into `ui.js` / `ui.css` (IIFE bundle) and copied to `src/`. It draws the shell (sidebar, banner, sections, toast) and the **Review** screen. It reads state through `App.reviewModel()`, `App.traceData()` and `App.subscribe()`, and acts through `App.action()`, `App.rate()` and `App.undo()`.
- Every tab is React: `ui/src/Review.jsx` and `ui/src/tabs/` (Study with `tabs/study/*`, Lesson, Cards, Settings, Stats, Algorithm), sharing `tabs/kit.jsx` (panels, buttons, pills, fields, KPIs, tables, sub-tabs, bars). The old engine renderers of Stats, Algorithm and Settings were removed (2026-10-05); the remaining switched-off views in `views-etut.js`, `views-lesson.js`, `views-manage.js` and `app.js` stay because they also set up helpers the React tabs use (import, focus mode, editor modal, charts). `ui/src/legacy.css` still remaps the old stylesheet's tokens for the pieces the engine draws itself (card editor modal, study blocks and maps).
- Exam sections (CEnT-S, TU Delft AE Prep): `src/cents-data.js` (`KCents`: syllabus, books, page ranges, all Claude prompts), `src/prep-core.js` (`KPrep`: topic mastery from evidence, Up next, pace, card sources), `src/mock-core.js` (`KMock`: mock exam packages, timed sections, scoring). Each section has Overview, Review, Study, Cards and **Mock exam** tabs (`<exam>`, `<exam>-study`, `-etut`, `-cards`, `-mock`). Each exam keeps its own exam date (`S.<exam>.examDate`, used per card through `env.examDateOf`) and an optional own new-card budget (`settings.exam_new_limits`).
- Packages written by Claude Code: `studies/*/etut.json` (STUDY-RULES.md), `lessons/*/lesson.json` (LESSON-TEST-RULES.md; placement tests are lesson packages with `placement`), `mocks/*/mock.json` (MOCK-RULES.md); `build.ps1` embeds all three, plus `mindmaps/*/` (below).
- AI Mind Mapping Assistant (sidebar section, tab id `mindmaps`, MINDMAP-RULES.md): `src/mindmap-core.js` (`KMind`: validation, perception corrections, learner-map versions and patches, retrieval checks, DSR adapter eligibility, Claude Code prompts) and `ui/src/tabs/MindMaps.jsx` + `ui/src/tabs/mind/*` (Reading with photo overlays, Map list, Coach, Checks, Reference, Details). Claude Code reads the handwritten photos and coaches by writing `mindmaps/<id>/map.json`, `turns/NNN.json`, `grades/<attempt>.json`, `reference.json`; photos stay in `mindmaps/<id>/views/` and load by relative path. `S.mindmaps` (one cloud document per map) holds only the learner's records; the reading itself stays in memory (`App.mindParse`). Only independent checks reach DSR, on cards `mm-<map>-<target>-v<n>` in the deck “Mind maps · <title>”.
- Study v2 (the cycle workflow, STUDY-RULES.md "Study v2", `research/study-v2/03-design.md`) applies to packages with `"schema_version": 2, "workflow": "cycle-v2"`; legacy packages keep the old runner (`tabs/study/Runner.jsx`).
  - Engine: `src/study-v2.js` (`KCycle`) handles validation and the coverage audit (the same rules as `tools/audit-study.py`), progress `c2`, attempts with help and exposure, grading, DSR eligibility through `KEtut.recordSignal`, the next-item policy, final blocks, the outcome report and the Claude Code prompts (Explain, follow-up, new study).
  - Screens: `ui/src/tabs/study/Cycle.jsx` and `tabs/study/cycle/*` (`Item`, `Final`, `lib.js`, `cycle.css`). The Learn & digest pane links each part to a mind map (`doc.study`).
  - Claude Code's Explain texts and follow-up items live in `studies/<id>/extras/*.json` (`kstudy-extra-1`). `build.ps1` bundles them as `bundled-study-extras`, and the app reads them as `App.studyExtras`.
  - A bundled v2 package is not copied into saved data: only `pkg_ref` is stored and the package is re-attached at start. A failed browser save shows a toast, and Settings › Data shows the saved size against about 5.2 M characters.
- Motion and look (2026-11-10 redesign, `research/redesign/design-philosophy.md`): tokens in `ui/src/index.css` (`--k-*`, both themes, motion curves and durations), the motion layer `ui/src/motion.jsx` (`EASE`, `DUR`, `SPRING`, `Count`, `TabEnter`, `Roll`), the filing chip in `App.rate` (`src/app.js`), the session summary and rating icons in `ui/src/Review.jsx`, the study stage hand-off in `tabs/study/Cycle.jsx`. The theme is chosen in `src/index.html` (`window.KartotekTheme`: `system` by default, `light`, `dark`; stored in `kartotek-theme`, absent = system).
- Welcome (`ui/src/Welcome.jsx`, `welcome.css`): a first-open stage built with the stageshow kit (copied to `ui/src/stageshow/`, MIT, from `~/.agents/skills/stageshow`; only `stage.tsx`, `motion/Count.tsx` and `motion/Fly.tsx` are imported). Shown once (`kartotek-welcome`), again from Settings › Show welcome (`kartotek-welcome` event).
- Build: `cd ui; npm install; npm run build` (copies `ui/dist/ui.*` to `src/`; Node 24 is on the PC), then `build.ps1`, which inlines everything into `Kartotek-DSR.html`.

## Layout
- The sidebar is 224px and sticky: Review, Study, End-of-lesson test, Cards; AI Mind Mapping Assistant; the CEnT-S and TU Delft AE groups; Stats, Algorithm, Settings. Nav items are 32px; the current one has a coral-tinted fill with a 2px coral edge and a coral icon; count badges are quiet numbers that roll when they change. The storage chip and the Auto · Light · Dark switch sit at the foot.
- Review: the header (title, learning/review/new pills, deck select capped at 320px), then the card column plus a 340px aside (Today, Up next, Last answer). The aside moves under the card below 1100px.
- Under 900px the sidebar becomes a sticky top bar with a sideways-scrolling nav; under 600px the ratings go to a 2×2 grid and form controls are 16px.

## Components
- **Panel**: panel surface, 1px line, 12px radius.
- **Review card**: the raised surface at 16px radius on an edge stack (two card edges behind it). Deck name and state pill, the front, then after Show answer: a divider that draws, the back in text colour, the explanation, the source row. The R / S / D strip comes last, after the answer, so the model never influences the self-rating.
- **Rating buttons**: 58px, solid rating colour, icon (↺ Again, − Hard, ✓ Good, ✓✓ Easy), name, interval and the key on a tinted chip. Coral never appears on a rating; a suggested rating gets a coral ring outside its own colour.
- **Today**: tiles whose numbers roll (`Count`), today's rating split as one segmented bar, the session progress bar.
- **Session summary** (empty queue after reviews): the reviewed count as the hero number, the rating split bar and legend, the average recall curve of today's cards over 14 days (drawn), tomorrow's count.
- **State pills**: new (neutral), learning (amber), review (green), relearning (red); tints in both themes.
- **Welcome**: the first-open stage (see Architecture), Start and Replay.
- **Warnings**: their own amber tokens, never the Hard colour. **Selection**: a solid coral-tinted tone (`--k-select`).

## Motion
Rich, cinematic motion is the owner's choice (2026-09-29, again 2026-11-10), inside one rule: **motion never holds back input**. Every action takes effect at once; animation plays over the new state and can be interrupted. Every motion has a cause; nothing pops.
- **Tabs**: the sidebar highlight slides (spring); the new tab's content enters from the direction of travel (12px, 240ms, a CSS animation so it always completes); changed badges roll.
- **Rating a card**: the press responds (100ms); the rating is written and the next card is live at once. A copy of the card is stamped with the rating, condenses, and becomes a chip in the rating's colour that reads the new interval ("in 6 days"); the chip flies on the travel curve to the Today tile it counts toward (Reviews done, or New cards for a new card), and that number rolls as it lands. An "Again" chip drops back behind the stack. The next card rises 160ms after the rating.
- **Show answer**: the divider draws (240ms), the back inks in from the left (420ms), the source row and then the model strip fade in.
- **Session summary**: the count rolls up, the split bar segments grow in rating order, the curve draws, tomorrow's line arrives last; a coral check draws beside the title. No confetti.
- **Study cycle**: the current-stage fill is one shared element that slides between stages (spring); the stage content arrives from the right going forward and from the left going back (CSS); a completed topic's ring fills and its check draws.
- **Durations and curves**: the tokens above; exits are shorter than entrances; staggers 30–60ms in reading order.
- **Reduced motion** (system setting): movement, flights and count-ups are removed; values set at once; short fades stay. The welcome stage shows its poster frame.

## Accessibility
- Visible 2px coral focus ring (outside rating colours); skip link; arrow keys move between nav items.
- Keys: Space/Enter reveal, 1–4 rate, H hint, Z undo; focus moves to the next action when a focused button disappears. Esc closes the welcome.
- Toasts use `role="status"`; rolling numbers keep the final value in `aria-label`.

## Do's and Don'ts
- Do keep colour for meaning: coral for action, focus and position; rating colours for ratings and states; amber tokens for warnings.
- Do use sentence case. Don't use em-dashes in interface copy or eyebrow labels.
- Don't add motion that makes input wait, motion without a cause, or a loop that rewinds data.
- Don't remove an animation without asking the owner.
