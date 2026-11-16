# Kartotek: instructions for Claude

Kartotek is a spaced-repetition and study app. Plain-JS engine in `src\`, React UI in `ui\` (Vite builds it into `src\ui.js` and `src\ui.css`), content packages (studies, lessons, mocks, mind maps) that live in a **content folder** outside the repository, with synthetic samples in `samples\`, all inlined into `Kartotek-DSR.html` by `build.ps1`.

## Standing rules

- My learner data is never deleted or rewritten in place. Every change to the saved-state format ships with a lossless migration that is tested on a copy of a real export.
- Existing features keep working: the DSR scheduler, Study v2 topic cycles, the legacy v1 runner, end-of-lesson tests, mock exams, mind maps and the exam sections. The Algorithm-tab test suite passes before every commit, and tools\audit-study.py still certifies the existing studies.
- LearnHarness (github.com/amosblomqvist/learnharness, AGPL-3.0-only, by Amos Blomqvist) may be read and adapted: Kartotek is licensed AGPL-3.0-only since 2026-11-16 (owner decision). Take what is good, adapt it to Kartotek's rules (the package is the source of truth, help is recorded, generated material never reaches the scheduler), and say in every adapted file which LearnHarness file it comes from. Do not take what conflicts with those rules (for example model error classification) or what the owner ruled out.
- No secrets in the repository (API keys, tokens). No course material, book extracts, handwriting photos or personal records in commits.
- One task per session, on its own git branch. Commit with clear messages. When I send the prompt for the next task, that is my OK for the previous one: first commit any pending change to CLAUDE.md, merge the previous task's branch into main, then start the new task on a new branch from main. Never push to a remote or publish a release without my explicit OK.
- UI text is English. The visual design follows DESIGN.md. New UI is React in ui\src; engine logic lives in plain modules with tests. Phone layout is out of scope.
- If a task needs a decision that docs\ARCHITECTURE.md, docs\LEARNING-PROTOCOL.md or research\harness-integration\03-decisions.md do not cover, stop and ask me instead of guessing.
- At the end of every session append a dated entry to docs\PROGRESS.md (what changed, how I can test it, open questions) and stop.

## Build and test

```
cd ui; npm ci; npm run build                       # vite build, then copies dist\ui.js and dist\ui.css to src\
cd ..; powershell -ExecutionPolicy Bypass -File build.ps1 -SkipPdf   # writes Kartotek-DSR.html
```

- `build.ps1` flags: `-SkipPdf` (skip the note-sheet PDFs, which need Microsoft Edge), `-Only <study-folder>` (PDF for one study). It reads the content folder (`-Content <path>`, else `KARTOTEK_CONTENT`, else `contentDir` in the git-ignored `kartotek.config.json`, else `samples\`) and embeds `studies\*\etut.json`, `studies\*\extras\*.json`, `lessons\*\lesson.json`, `mocks\*\mock.json`, `mindmaps\<id>\` (map, turns, grades, reference) and `exam\tud-apply.json` as JSON `<script>` tags, plus the resolved folder (`#kartotek-config`), then inlines `src\index.html`, the CSS and every script in the order `index.html` lists them. New content only shows after a rebuild and a reload.
- `src\ui.js` and `src\ui.css` are build output that is committed; rebuild them after any change in `ui\src`.
- **Desktop shell (task C1):** `npm ci` at the root (also installs `ui\`), then `npm start` opens the app in an Electron window (`desktop\main.js`) with live reload: `vite build --watch` copies every UI rebuild to `src\` and the window reloads on any change under `src\`. The window loads `src\` through `app://kartotek/` with a strict CSP (`desktop\serve.js`), has no embedded content yet (content loading is C2) and uses the dev profile `%APPDATA%\Kartotek-dev`. `build.ps1` and the browser page are unchanged.
- **Content at run time (task C2):** the desktop window reads the content folder at start and on **Reload content** (Settings, Content panel, which also lists **Content problems**); no build step is needed to see a new or changed package. A package that fails its validators is listed and never reaches the saved state. `KARTOTEK_BACKUP=<export file> npm test` runs the reload scenario on a copy of a real backup.
- **Learner data in files (task C3):** in the desktop app the state lives in `%APPDATA%\Kartotek\data\` (development: `Kartotek-dev`), written by `desktop\data.js` (generation-named files, a manifest with SHA-256 per file, crash recovery) with dated backups in `backups\` in the old backup format. A first start shows a first-run panel (import a backup file, move the window's browser storage, start empty); every whole-state replacement (import, restore) goes through `KStore.Store.replaceFromSource`, which keeps it only if every count matches and the read-back state is identical. The browser page still uses localStorage. `KARTOTEK_BACKUP=<export file> npm test` also runs the import and the review-queue comparison on a copy of a real backup (read only). `node scripts\bridge-preview.cjs` serves the app to a normal browser with the real main-process modules behind a stand-in bridge (for PCs where Electron cannot start).
- **Installer and releases (task C4):** `npm run dist` builds `dist-installer\Kartotek-Setup-<version>.exe` (electron-builder, config in `electron-builder.yml`; the output folder is git-ignored). Pushing a tag `vX.Y.Z` makes `.github\workflows\ci.yml` test, build the installer, run `scripts\check-installer.cjs` (silent install, update, smoke test of the installed app, uninstall, user data untouched) and create a **draft** GitHub Release. How to cut one: `docs\RELEASING.md`. `npm run hygiene` fails if anything private is tracked (it runs in CI). Never push, tag or publish without the owner's OK.
- **Model layer (task E1):** `desktop\models\` (the service, the Anthropic SDK adapter, the OpenAI-compatible adapter, the command-line adapter for Claude Code / Codex / custom, the schema checker, prompt files, prices); Settings, Models in `ui\src\tabs\ModelsPanel.jsx`; shipped prompt files in `prompts\` (overrides in the user-data folder). Keys are encrypted with `safeStorage` and never reach the window, logs, backups or the repository. Tests never call a real service (`scripts\model-tests.cjs` uses a fake provider and stand-ins).
- **Writing jobs (task E3):** `desktop\jobs\` (job runner, study / lesson / mock / mind-map pipelines, local reading of PDF, .pptx, .docx and text with pdf.js, the engine's validators in a Node vm, step schemas); prompt files `prompts\study-*.md`, `item-*.md`, `lesson-*.md`, `mock-section.md`, `mind-*.md`; the UI in `ui\src\tabs\Jobs.jsx` (Study library "New study from my files", End-of-lesson test, Mock exam, the exam Overview, Mind maps "Use the vision model", Settings). Jobs live in `%APPDATA%\Kartotek\jobs\<id>\job.json` and resume after a restart; drafts go to the content folder with `generated_by`. `scripts\job-tests.cjs` uses a scripted fake model; no test calls a real service.
- **Model calls while studying (task E2):** with a model set up, Explain, Practice this again, typed-answer grading proposals, Feynman "Get feedback" and Ask about this card (Review) run through the model layer. The prompts are `prompts\explain.md`, `followup-items.md`, `typed-grading.md`, `feynman-feedback.md` and `ask-card.md` (schemas in `prompts\schemas\`; editable in Settings, Prompts). The engine builds the values and checks the answers (`KCycle.explainInputs`, `saveExplanation`, `followupInputs`, `buildFollowups` → `validateExtra`, `gradingInputs`, `checkGradingProposal`, `confirmModelGrading`, `feynmanInputs`, `checkFeynmanFeedback`; `KPrep.cardAskInputs`); `ui\src\model-call.jsx` moves them to the main process and shows the state. Results live in the learner data: `attempt.explanations`, `progress.followups`, `progress.feynman_feedback`, `attempt.model_grading` (grading `"model"` when confirmed as proposed). None of them changes `KCycle.eligibility`. Without a model, or in the browser page, the Claude Code link and Copy prompt stay. Rules: `STUDY-RULES.md` v2.10b. Tests: `scripts\study-model-tests.cjs` (fake provider) and the E2 block of `scripts\smoke.cjs`.
- **Tests:** `npm test` runs `src\tests.js` headless in jsdom (58 scenarios, same as the Algorithm tab) plus the desktop helper, content, data, navigation, model-layer, study-model and Euro apply tests; run it before every commit, together with the Algorithm tab when UI changed. `npm run smoke` drives the real window with Playwright (needs a PC where `electron.exe` may run: Windows Smart App Control blocks it, see `docs\PROGRESS.md`).
- The engine self-tests live in `src\tests.js` and run from the Algorithm tab.
- Local preview: `python -m http.server 8765` in the root, then open `Kartotek-DSR.html` (or use the `kartotek` entry in `.claude\launch.json`). Reload with a changed URL query if the browser serves a cached build.
- Study packages are checked by `python tools\audit-study.py <study folder>`, `--all` (the content folder) or `--samples` (coverage ledger audit). Mind-map files by `python tools\check-mindmap.py <map folder>`.
- Content rules: `STUDY-RULES.md`, `PRIMING-RULES.md`, `LESSON-TEST-RULES.md`, `MOCK-RULES.md`, `MINDMAP-RULES.md`. Visual design: `DESIGN.md`.

## Content folder and what is not in git

The owner's studies, lesson tests, mock exams, mind maps (with photos), `exam\tud-apply.json`, `sources\` and `notes\` live in the content folder, found through `kartotek.config.json` (git-ignored; `kartotek.config.example.json` shows the format). Paths such as `studies\<id>` in the rule files are relative to it. `src\config.js` (`KConfig`) and `tools\kconfig.py` read the same setting; never hard-code a user path.

Git-ignored (see `.gitignore`): `node_modules\`, `ui\dist\`, `Kartotek-DSR.html`, `kartotek.config.json`, `research\` (private working notes, including the publishing audit `research\PUBLISHING-AUDIT.md` and `research\harness-integration\`; rules that cite `research\harness-integration\03-decisions.md` mean this local copy), `backup-before-redesign\`, `kartotek\`, `tools\cache\`, `*.pdf`, and safety nets for `studies\`, `lessons\`, `mocks\`, `mindmaps\`, `exam\`, `sources\`, `notes\`, `content\`.

## Map of the code

### Engine: `src\` (plain global scripts, no modules)

Script order is fixed by `src\index.html`: engine, store, cores, then the views, then `ui.js` last. Each file attaches one global (`DSR`, `KStore`, `KEtut`, `KCycle`, `KLesson`, `KMock`, `KMind`, `KMeta`, `KAnim`, `KCents`, `KPrep`, `KCharts`, `App`).

| File | Purpose |
| --- | --- |
| `engine.js` | `DSR`: the D-S-R scheduler (difficulty, stability, retrievability), forgetting curve, intervals, parameter fitting. Pure, no UI or storage. |
| `store.js` | `KStore`: state in localStorage (`kartotek-dsr-v1`); on claude.ai a private cloud store split into chunks of cards and review-log records; in the desktop app files through `window.kartotek.data` (`file` mode: part-by-part saves, the checked import pipeline `replaceFromSource`, `countRecords`). |
| `etut-core.js` | `KEtut`: legacy v1 study packages (`etut.json`): validation, objectives to cards, the SRL stage machine, Markdown and SVG sanitising. |
| `study-v2.js` | `KCycle`: Study v2 topic cycles (Priming, Learn & digest, Applying, Evaluating), source-ledger audit, append-only attempts, DSR eligibility, final test and outcome report; since E2 also the values and answer checks of the in-app model requests. |
| `etut-anim.js` | `anim` blocks in study packages: frame-based, scrubbable SVG animations. |
| `lesson-core.js` | `KLesson`: end-of-lesson test packages: validation, one DSR event per objective, re-test picking, review calendar. |
| `mock-core.js` | `KMock`: mock exam packages: validation, timed sequential sections, scoring per section and syllabus topic. Mock results write no DSR events. |
| `mindmap-core.js` | `KMind`: mind-map reading, learner-map versions, perception corrections, retrieval attempts, prompts for Claude Code. |
| `metacog.js` | `KMeta`: calibration gap, error types, adaptation order, fading prompts. Pure calculations. |
| `cents-data.js` | CEnT-S and TU Delft AE section data (syllabus items, books) and the generator that turns an item into a reading study package. |
| `prep-core.js` | Exam-prep logic: topic mastery from evidence, "Up next", pace, card sources. |
| `charts.js` | `KCharts`: library-free SVG charts. |
| `tests.js` | Required test scenarios and formula examples; run from the Algorithm tab. |
| `app.js` | `App`: shared helpers, formatting, state wiring and the Review screen. |
| `views-manage.js` | Legacy Cards and Settings screens; holds `App.exportBackup`. |
| `etut-srl.js`, `views-etut.js` | Legacy Study tab: SRL screens, library and stage router. |
| `views-lesson.js` | Legacy End-of-Lesson Test tab. |
| `views-insight.js` | Only boots the app (`App.boot()`); Stats and Algorithm are React now. |
| `host.js` | `KHost`: where the packages come from (the content folder in the desktop app, the embedded tags in the browser page), their validation, the list of content problems, reload. The `App.importBundled*` functions read `KHost.list(kind)`. |
| `config.js` | `KConfig`: the content folder written into the page by `build.ps1`; builds `claude://` links and paths for prompts. Loaded first. |
| `index.html`, `styles.css` | Page shell and legacy styles. `ui.js` and `ui.css` are the committed build output of `ui\`. |

### UI: `ui\src\` (React 18, Motion, Tailwind 4, built as one IIFE)

| Path | Purpose |
| --- | --- |
| `main.jsx` | Mounts React into `#root`, on top of the engine's `window.App`. The engine owns state; React owns the shell and the tabs. |
| `Shell.jsx` | Sidebar: the Study / Planning switch, the exam scope selector, the Mind maps, Career and System groups, theme switch, storage chip, tab routing. The engine's tab ids are unchanged. |
| `plan.js` | Planning home timeline (D2): exam dates and pace, Application page rows and open steps, Euro apply deadlines (read only), one row for what both apps know (Euro apply owns it). Pure; `scripts\euro-tests.cjs` tests it. |
| `nav.js` | Navigation model (D1): which mode, scope and sidebar entry a tab id belongs to, and back (`locate`, `studyTab`, `visibleTabs`). Pure; `scripts\nav-tests.cjs` tests it. |
| `Welcome.jsx`, `welcome.css` | First-open welcome stage. |
| `Review.jsx` | Review screen. |
| `motion.jsx` | Motion system: curves, durations, spring, shared components. |
| `index.css`, `fonts.css`, `legacy.css` | Tokens and `k-*` classes; fonts; styles carried over from the engine views. |
| `tabs\Jobs.jsx` | Writing jobs (E3): job cards with steps, estimate and result; the "from my files" form; the per-job model choice. |
| `tabs\` | One file per tab: `Study`, `Lesson`, `Cards`, `Cents` (exam overview, also exports `Tud`), `Mock`, `Apply` (TU Delft application plan), `MindMaps`, `Stats`, `Algorithm`, `Settings`, `Planned` (Career, the Mock exam picker), `PlanningHome` (combined timeline), `EuroApply` (the Euro apply page and its Settings panel). `index.js` registers them in `REACT_TABS`. `kit.jsx`, `manage-kit.jsx` and `insight-kit.jsx` are shared building blocks; each tab has its own `.css`. |
| `tabs\study\` | Study screens: `Library`, `Runner` (legacy v1), `Cycle` (Study v2), `Srl`, `QList`, `common`, `util`; `cycle\` holds `Item` (one question), `Final` (final test and report) and `lib`. |
| `tabs\mind\` | Mind-map assistant screens: `Reading`, `MapList`, `Coach`, `Checks`, `More`, `parts`, `util`. |
| `stageshow\` | Trimmed copy (18 files) of an animation kit (MIT, Benji Taylor, see its `LICENSE`) used by the welcome stage. Never add brand logos. |
| `tabs\Apply.jsx` | Generic dated-plan tab; its data is the content file `exam\tud-apply.json`. Without it the tab shows an empty state. |

### Other folders

- `desktop\`: the Electron main process (`main.js`), the bridge (`preload.js`) and plain helpers (`euroapply.js` = the read-only Euro apply connection: folder check, one projected data file, server ping and launcher; Euro apply is the owner's separate app and its folder is never written to), (`serve.js`, `content.js` = content folder discovery, parsing and photo paths, `data.js` = learner-data files and backups, `data-api.js` = the checked data calls shared by `main.js` and the tests, `models\` = the model layer, `jobs\` = the writing jobs); `scripts\`: `start.cjs` (dev start with live reload), `run-tests.cjs` (`npm test`), `content-tests.cjs`, `data-tests.cjs`, `smoke.cjs` (`npm run smoke`), `bridge-preview.cjs` (the app in a normal browser with the real main-process modules). See `docs\ARCHITECTURE.md`.
- `prompts\`: the shipped prompt files of the model layer (front matter: id, version, slot, schema, variables) and `schemas\`; files with `status: draft` (the F0 agent drafts) are not used by any feature yet.
- `samples\`: synthetic studies (CC BY 4.0) that a fresh clone builds with.
- `ui\scripts\copy-build.cjs`: copies the Vite output to `src\` and adds the licence banner.
- `tools\`: `audit-study.py`, `check-mindmap.py`, `kconfig.py` (content folder), book fetch scripts, CEnT-S PDF scripts, `cents-items.json`.
- `README.md`, `LICENSE` (GNU AGPL v3, AGPL-3.0-only), `LICENSE-CONTENT.md` (CC BY 4.0 for docs and samples), `THIRD-PARTY-NOTICES.md` (regenerate when dependencies change).
- `docs\`: `PROGRESS.md` (session log). `ARCHITECTURE.md` (the desktop app, with "as built" notes per task) and `LEARNING-PROTOCOL.md` (task F0: the packaged cycle and the live session, the thirteen ideas, schemas, evidence rules, decisions).
