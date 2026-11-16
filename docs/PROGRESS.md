# Progress log

One dated entry per session, newest last. Each entry: what changed, how to test it, open questions.

## 2026-11-15 · Task A1: rules file and local git (branch `task/a1-rules-and-git`)

### What changed
- Local git repository created (no remote) with a `.gitignore` and a first commit.
- `CLAUDE.md` at the root: the standing rules word for word, build and test commands, and a code map checked against the files.
- Backup import hardened (`src\store.js`, `src\tests.js`, `ui\src\tabs\Settings.jsx`, `ui\src\tabs\settings.css`). The export file itself is unchanged, so old backups still import. See "Export" below.

### Baseline verification (before any change)
| Check | Result |
| --- | --- |
| `npm ci` in `ui\` | installed; `npm audit` reported 1 high-severity advisory (fixed in A3) |
| `npm run build` | built, no errors |
| `build.ps1 -SkipPdf` | built `Kartotek-DSR.html` |
| Page load (local server, built-in browser) | no console errors |
| Algorithm tab test suite | 52/52 passed |
| `python tools\audit-study.py --all` | exit 0; every Study v2 package certified with 0 blockers |

### After the import change
Algorithm tab suite: 53/53 (one new test: backup round trip and rejection of foreign or newer files). Import tested in the page: snapshot, change the data, import the snapshot: card count back, change gone, safety copy file written, Study v2 packages re-attached, data saved to localStorage.

### Export: how to save your complete learner data
1. Open Kartotek the same way you always do (same browser and same address; browser storage is per address, so `file:///...` and `http://localhost:8765` hold different data).
2. Settings, panel **Data**, button **Export backup (JSON)**. It saves `kartotek-backup-YYYY-MM-DD.json`. "Last backup" in that panel updates.
3. Also keep a copy of your content folder (see README.md). The backup does not contain it, and git does not either.

What the file contains: it is `JSON.stringify` of the entire saved state, so everything the app stores: decks, cards, memory state of every card, the full review log, every study's progress and attempts, lesson tests, mock exams (packages and attempts), mind maps (learner map versions, corrections, attempts, requests), exam plans (selections, done marks, the application-plan ticks), settings, model parameters and parameter history.

Not in the file, by design:
- The bodies of bundled Study v2 packages (the page carries them; the file holds version, progress and attempts). To restore, use a page built from the same content folder.
- Mind-map readings, turns, grades and reference maps written by Claude Code, and the handwriting photos: they live in `mindmaps\<id>\` in the content folder.
- Study "Explain" and follow-up files in `studies\<id>\extras\`.
- Small interface preferences in localStorage (theme, last tab, welcome seen, panel open/closed). Not learner data.

Nothing in the learner state was missing from the export, so the export format was not extended.

### Import: what was wrong and what changed
Import existed (Settings, Data, **Import backup**) but replaced all current data at once, with no confirmation and no copy of what it replaced, and the Study v2 packages stayed detached until a reload. Now: choose file, the page shows what the file holds next to what you have now, then **Save safety copy and import** downloads `kartotek-before-import-<time>.json` of the current data first; if that copy is not saved nothing is replaced. After the replace the bundled packages are attached again. Files that are not backups or come from a newer Kartotek are refused.

## 2026-11-15 · Task A2: publishing audit

### What changed
- A written audit of everything that might go public: third-party code, fonts and assets with their licences, a verdict per content folder and root file (publish, sample after edits, private), secrets and personal traces, a proposed layout that keeps the owner's content in a folder outside the repository, licence options, and 14 decisions with recommendations.
- The audit is private working material and is not part of the public repository.

### Main findings
- One tab held personal data inside public code (fixed in A3).
- A Windows user name was hard-coded in several files (fixed in A3).
- About 140 files of the vendored animation kit and all brand logos were unused (removed in A3).
- The built bundle carried no licence notices (fixed in A3).
- No keys, tokens or passwords anywhere. Nothing from LearnHarness is in the tree.
- The history had to be restarted before any push (done in A3).

## 2026-11-15 · Task A3: apply the audit (branch `task/a3-apply-audit`)

### What changed
- **Content folder.** Private content moved out of the repository to a content folder; the app finds it through `kartotek.config.json` (git-ignored, example in `kartotek.config.example.json`), `-Content` or `KARTOTEK_CONTENT`. `build.ps1`, `tools\audit-study.py` and `tools\make-cents-pdfs.py` read it (`tools\kconfig.py`); the page gets it through `src\config.js` (`KConfig`). Without a content folder the build uses `samples\`.
- **Samples.** `samples\studies\sample-cycle-v2` and `sample-dsr` (neutral source file name, answer positions balanced 4/4/3/3), with a CC BY 4.0 notice.
- **Personal plan out of the code.** `ui\src\tabs\Apply.jsx` is a generic plan tab; its data is the content file `exam\tud-apply.json` (embedded as `#bundled-exam`). Without the file it shows an empty state.
- **Assets.** `ui\src\stageshow\` trimmed from 156 to 18 files plus `LICENSE`; `brands\` (44 logos) deleted; unused `lucide-react` removed; Vite upgraded (`npm audit`: 0 vulnerabilities).
- **Paths and names.** No user-name paths left in code, launch config or rule files; rule files say "the owner" or "the learner"; the Remotion wording now says the timing model is inspired by Remotion's API and no Remotion code is included.
- **Licences.** `LICENSE` (MIT), `LICENSE-CONTENT.md` (CC BY 4.0 for docs and samples), `THIRD-PARTY-NOTICES.md`, a licence banner at the top of `src\ui.js`, `src\ui.css` and the built page (`ui\scripts\copy-build.cjs`, `build.ps1`), `README.md`.
- **Git.** `.gitignore` rewritten for the new layout (`research\` and the audit are ignored). The public history starts from one fresh commit; the earlier local history was archived outside the repository and removed from it.

### How to test
- `cd ui; npm ci; npm run build`, then `powershell -File build.ps1 -SkipPdf`: with `kartotek.config.json` present you get your studies, without it the two samples. Open the page, Algorithm tab: 53/53.
- `python tools\audit-study.py --samples` and `--all`.
- `git ls-files` shows no studies, mind maps, research, PDFs or personal plan.

### Open questions
- The commit author email is a placeholder (`noreply@kartotek.invalid`); the real GitHub no-reply address is needed before publishing.
- Samples for the end-of-lesson test, mock exam and mind map are still to come; the Mind maps, Lesson and Mock tabs are empty on a fresh clone.
- A release page must be built from the samples only (no `kartotek.config.json`).
- `docs\ARCHITECTURE.md` and `docs\LEARNING-PROTOCOL.md` do not exist yet, although the rules refer to them.

## 2026-11-15 · Task B1: architecture (branch `task/b1-architecture`)

### What changed
- Before starting: `task/a3-apply-audit` was already identical to `main` (nothing to merge) and no `CLAUDE.md` change was pending; branched from `main`.
- New `docs\ARCHITECTURE.md`: desktop shell comparison and recommendation (Electron), process boundaries with the bridge as a table of calls, run-time content loading, learner data in files (layout, safe writes, dated backups, import with a whole-state acceptance check, rollback), model layer (one interface, API / CLI / local adapters, slots, usage and cost, behaviour without a model), prompt files with overrides, navigation, Euro apply, testing and CI, migration order checked against C1–C4, D1–D2, E1–E3, risks, and 16 open decisions. Tool versions and behaviour were checked against current documentation (sources at the end of the file).
- No code changed.

### How to test
Read `docs\ARCHITECTURE.md`, section 12, and answer the 16 decisions in the C1 prompt. Section 10.1 lists the changes it proposes to `research\harness-integration\04-prompt-plan.md` (not applied: the plan is private working material and outside this task).

### Open questions
- The 16 decisions in section 12 (shell, packager, code signing, update behaviour, browser export, content and data folders, backup retention, claude.ai import route, adapters, prices, Euro apply launch, prompt files moving to E1, development profile, slot mapping).
- Still open from A3: the real GitHub no-reply address for commits; `docs\LEARNING-PROTOCOL.md` (task F0) does not exist yet.

## 2026-11-15 · Task C1: desktop shell (branch `task/c1-desktop-shell`)

### What changed
- Before starting: committed nothing pending; merged `task/b1-architecture` into `main`, then branched. The owner's 16 decisions (all recommendations accepted) are recorded in `docs\ARCHITECTURE.md` (status line and section 12).
- **Electron shell** (`desktop\main.js`, `preload.js`, `serve.js`): the existing engine and UI from `src\` load through `app://kartotek/`, with context isolation, sandbox, no Node, a strict CSP, locked navigation, denied permissions, one instance, and the bridge call `window.kartotek.app.info()`. Dev profile `%APPDATA%\Kartotek-dev`. Storage and content loading are unchanged (the window starts with no embedded content and its own `localStorage`).
- **`npm start`** at the root: builds `ui\`, keeps `vite build --watch` running (a Vite plugin copies each rebuild to `src\`; verified: three edits gave three rebuilds and copies), opens the window and reloads it when `src\` changes. `npm ci` at the root also installs `ui\`.
- **`npm test`**: `src\tests.js` runs headless in jsdom, all 53 scenarios, plus 6 helper tests for paths, CSP and links. `npm run smoke`: Playwright drives the real window (every sidebar entry, Algorithm tab, console errors, no Node in the window).
- `build.ps1` and the browser page are unchanged. `CLAUDE.md`, `README.md` and `ARCHITECTURE.md` (section 10.0) describe the shell as built.

### Verification
| Check | Result |
| --- | --- |
| `npm test` | 53/53 engine scenarios, 6/6 desktop helper tests |
| Browser build `build.ps1 -SkipPdf`, Algorithm tab | 53/53, 19 studies with the owner's content folder |
| `src` served with the desktop CSP in a signed browser pane (same `serve.js` headers) | page loads, all 19 sidebar entries render content, Algorithm tab shows 53/53 tests passed |
| Console in that run | no errors on load and tab switching; 2 CSP messages when the sanitiser test runs (see below) |
| `npm start`, `npm run smoke` on this PC | **could not start Electron** (below) |
| Electron window opens, tabs render, tests pass in the window | **not verified on this PC** |

### The blocker: Smart App Control
On this PC Windows 11 **Smart App Control is enforcing** (`VerifiedAndReputablePolicyState` = 1). It blocks `node_modules\electron\dist\electron.exe`, which is unsigned (`Get-AuthenticodeSignature`: NotSigned; CodeIntegrity events 3033 and 3077 name `electron.exe`). Nothing in the repository can fix that: a signed Electron is not available, and turning Smart App Control off is the owner's decision (it is a security setting and, once off, can only be switched back on by resetting Windows). The same effect will block an unsigned installer later (ARCHITECTURE.md section 1.4).

### Known console messages
The sanitiser test in the Algorithm tab feeds deliberately malicious SVG (`onload="alert(1)"`, `onclick="x()"`) to the page. The CSP blocks both and the browser logs two errors when the suite runs. They are the CSP doing its job, not defects, but they are errors in the console. `npm run smoke` filters exactly that message. Also found by the CSP: React DOM probes `setAttribute('oninput','return;')`; that one text is allowed by hash.

### How to test (once Electron may run)
`npm ci`, `npm start`: a window opens; click through the sidebar; Algorithm tab shows 53/53; edit a file in `ui\src` and watch the window reload. `npm run smoke` checks the same automatically. `npm test` works everywhere.

### Open questions
- How to get the window running on this PC (the owner's call): turn Smart App Control off, or accept that the window is verified on a machine or CI runner without it (GitHub's `windows-latest` has no such policy), or use a signed browser window as the interim dev view.
- Should the two expected CSP messages from the sanitiser test stay (smoke test filters them), or should that test change so the console stays empty?
- Still open: the real GitHub no-reply address for commits; `docs\LEARNING-PROTOCOL.md` (task F0).

### C1 follow-up: verification moved to CI
- The owner chose to verify the window on CI instead of turning Smart App Control off. `.github/workflows/ci.yml` (Windows runner) runs: `npm ci`, UI build, a check that `src\ui.js` and `src\ui.css` match a fresh build, `npm test`, `build.ps1 -SkipPdf` with the samples, `audit-study.py --samples`, and `npm run smoke` (every sidebar entry, Algorithm tab, console errors, no Node in the window).
- **Not run yet.** There is no remote and nothing was pushed, so no CI run exists. C1's "window opens, tabs render, Algorithm tests pass in the window, console clean" stays unverified until the repository is on GitHub and this workflow has run green. `smoke.cjs` has never executed, so the first run may need small fixes.
- To run it: create a GitHub repository, add it as the remote and push this branch (each needs the owner's OK; see `CLAUDE.md`).

## 2026-11-15 · Task C2: content at run time (branch `task/c2-runtime-content`)

### What changed
- Before starting: merged `task/c1-desktop-shell` into `main` (your prompt is the OK), then branched.
- **`KHost`** (`src\host.js`): the seam between the engine and where the packages come from. Desktop: the main process reads the content folder (`desktop\content.js`) when the app starts and on **Reload content**. Browser page: the same embedded tags as before, `build.ps1` unchanged. The `App.importBundled*` functions and the exam plan read `KHost.list(kind)` / `KHost.exam()`; their logic is unchanged and `App.boot()` runs after the first load.
- **Validation before import**, with today's validators (`KEtut.validatePackage` incl. `KCycle.validate`, `KCycle.validateExtra`, `KLesson.validateLesson`, `KMock.validateMock`, `KMind.validateMap`; `KCycle.audit` blockers show as "Not certified" and still load, as before). An invalid package is listed on the **Content problems** list (Settings, **Content** panel) with its file and every error, and never reaches the saved state or breaks the app. The panel also shows the folder, counts, **Reload content**, **Choose folder**, **Open folder**, and "Content changed" when the folder changes on disk (nothing reloads by itself). **Reload content** is also in the Study library.
- **Reference attach unchanged:** Study v2 packages attach by `pkg_ref`; a new study adds only its own deck and cards (+2 cards, +2,970 characters in the test) and the package is not copied into the saved state. A Study v2 package that disappears from the content is detached from its record; the record, cards and attempts stay and it comes back with the package.
- **Photos:** `kcontent://mindmaps/<id>/<file>`, images only, inside that map's folder.
- **Folder choice:** `settings.json` (picker) > `KARTOTEK_CONTENT` > development `kartotek.config.json` > samples; samples and content show together, a sample with the same id as your content is hidden.
- `npm test` adds 8 content-service tests (fixture folders, size limit, broken JSON, path escapes) and a reload scenario in jsdom with the real engine. `npm run smoke` repeats the content checks in the real window.

### Verification
| Check | Result |
| --- | --- |
| `npm test` | 53/53 engine, 6/6 desktop helpers, 8/8 content service, reload scenario passes |
| Reload scenario, synthetic backup (60 cards, 287 reviews, 5 attempts, 2 studies) | start with run-time content: state deep-equal; after Reload with a new study: counts before `{cards 60, reviews 287, attempts 5, studies 2}`, after `{cards 62, reviews 287, attempts 5, studies 3}`, every existing card, memory, review, study record unchanged |
| Browser build (`build.ps1 -SkipPdf`), real content folder | 53/53, 19 studies, 1 extra, 1 mind map, exam plan, 0 content problems; Content panel shows |
| Desktop code path in a signed browser pane (stand-in for the main process using the real `desktop\content.js`, same CSP) on your real content folder | 19 studies, 1 extra, 1 mind map, exam plan, 0 problems (same as the build route; the two samples hidden); Algorithm tab 53/53 |
| Same path on a fixture folder: Reload, one broken study, copy a new study folder in, Reload | broken study listed with its error, "Content changed" hint appears and clears, the new study appears, 225 cards and 0 reviews unchanged |
| `audit-study.py --all` / `--samples`, `npm audit` | 13 certified / sample certified, 0 vulnerabilities |

### Not verified
- **Your real backup file.** The path in the prompt was the placeholder, no `kartotek-backup*.json` exists under Downloads, Documents or Desktop, and the answer given to my question was not a path. So the "counts identical on my real data" check ran on a synthetic backup only. To run it on the real one: `$env:KARTOTEK_BACKUP = "C:\path\to\export.json"; npm test` (the file is only read; the scenario works on an in-memory copy). Export it from the page you normally use: Settings, Data, Export backup.
- **The Electron window itself** (Smart App Control, see C1): the main-process pieces (`settings.json`, folder picker, watcher, `kcontent://`) have not run. `npm run smoke` now checks them on CI (start content, a new study after Reload, photos, path escapes) once the repository is pushed.

### Notes and open questions
- Where the Content problems panel lives is a guess (Settings, System group, above Data); D1 can move it.
- Legacy v1 studies keep their package inside the saved state (as before), so they stay in the library even if their folder is removed; only Study v2 packages detach.
- Still open: the real GitHub no-reply address; whether to push for CI; the two expected CSP console messages from the sanitiser test; `docs\LEARNING-PROTOCOL.md` (F0).

## 2026-11-15 · Task C3: learner data in files (branch `task/c3-learner-data-files`)

### What changed
- Before starting: merged `task/c2-runtime-content` into `main` (your prompt is the OK); no `CLAUDE.md` change was pending; branched from `main`.
- **Data store** (`desktop/data.js`, main process): the state is written as files in `<profile>\data\`: meta, card chunks (80 cards, as in the cloud store), review chunks of 2,000 events, one file per study, lesson test, mock exam and mind map, and the key order. File names carry a generation number and a manifest lists every file with its SHA-256, so a crash at any moment leaves the previous complete set; on start a damaged set falls back to the previous manifest, and nothing is ever deleted when a check fails. One writer at a time (lock). No size ceiling (tested with a 12-million-character state).
- **Dated backups** in `<profile>\backups\`, in the old backup format (the browser page can import every one): daily before the first save of the day, before every import, restore, migration and "replace all data", and on demand. Kept: 14 daily, 8 weekly, 12 monthly, `before-…` for 90 days, the newest five always.
- **Window side** (`src/store.js`, new `file` mode): each save compares every part with the disk and sends only what changed; a check every 15 seconds also catches changes made without `commit()`. An older saved shape that `normalize()` changes is written back only after a `before-migration` backup. Before the window closes it writes what is pending.
- **One checked pipeline for import, restore and first start** (`replaceFromSource`): the files are written as a new generation and read back. The result is kept only if the read-back state is identical to the source and every count matches; otherwise the previous data comes back. The report lists 21 kinds of record (cards, review events, decks, studies, Study v2 attempts, answers in legacy studies, lesson tests and their review events, mocks and their attempts, mind maps and their versions, corrections, attempts and turns, exam-plan marks, dates and application ticks, settings, parameters, parameter history), before and after, plus the whole-state comparison.
- **First run** (empty profile): import a backup file (exported by the old Kartotek, also from claude.ai: open the page there, Settings, Data, Export backup), move the data this window's browser storage holds, or start empty. Nothing is written before the choice.
- **Settings, Data (desktop):** where the files are, the last save, Export backup (old format), Review log (CSV), Import backup (with confirmation, backup first, report), Data folder, and the **Backups** list with Restore (backup first, same checks and report) and Export. Reload sample data and Delete all data take a backup first.
- **Bug fixed from C1:** the CSP hash of the inline theme script was computed over the file with its Windows line endings (git checks `src\index.html` out with CRLF), while browsers hash it with LF. The script was blocked and the app booted twice with a console error. `desktop/serve.js` now normalises line endings before hashing (test added).
- **Tests:** `scripts/data-tests.cjs` (in `npm test`): 11 store tests (round trip, change sets with Undo, daily backup, crash before the manifest, damaged files, both manifests damaged, revert, lock, size, retention over 400 days) and 7 window tests with the real engine and the real data store (first-run import of an old backup and a review-queue comparison with the old app, six older saved shapes, edits, a change without `commit()`, the window's split equals the main process's, a refused read-back, restore). `npm run smoke` now also does the first run and a restart (CI only).
- **Dev aid:** `node scripts/bridge-preview.cjs [--content <folder>] [--import <backup file>]` serves the app to a normal browser with the real `content.js`, `data.js` and `data-api.js` behind a stand-in bridge, on a temp profile.

### Verification
| Check | Result |
| --- | --- |
| `npm test` | 53/53 engine, 6/6 desktop helpers, 8/8 content, reload scenario, 11/11 data store, 7/7 data import and window |
| Older saved shapes | no `lang` and Turkish sample deck names; CEnT-S selection without `selV`; before lesson tests, mocks, mind maps and the TU Delft section; cards without memory; review log out of order; legacy study progress v1 and v3 and Study v2 progress without `cv`: all import with matching counts (the migration rows marked), and a restart reads exactly the saved state |
| Review queue, synthetic backup | the desktop app (files) and the old app (localStorage) build the same queue (order, counts, limits) |
| Bridge preview in the browser pane (real main-process modules, temp profile, synthetic backup of 52 cards and 284 reviews) | first-run panel; import report all matching, whole state identical; Data panel with the daily backup and the kept copy of the import; Restore of the daily backup with report and a `before-restore` backup; reload reads the data back from the files; Start empty; no console errors after the CSP fix |
| Browser page (`build.ps1 -SkipPdf`) | unchanged: local storage, Algorithm suite 53/53, no console errors; rebuilt afterwards with your content folder (19 studies) |

### Not verified
- **Your real backup.** The prompt's path was still the placeholder and there is no `kartotek-backup*.json` on this PC. So "the import report for my real data shows identical counts" and "the same review queue for today as the old app" are proven on synthetic data only. To run both on your data: export the backup from the page you normally use (Settings, Data, Export backup), then `$env:KARTOTEK_BACKUP = "C:\path\to\kartotek-backup-....json"; npm test`. The file is only read; the test prints the full report and the queue comparison.
- **The Electron window itself** (Smart App Control, see C1): the IPC handlers in `main.js`, the save dialogs, the flush on close and the new smoke steps have not run. The same modules ran behind the bridge preview; `npm run smoke` checks the window on CI once the repository is pushed.

### Open questions
- The prompt asks for export "in the new format". `ARCHITECTURE.md` §4.3 decided that export and backups use the old backup format so the browser page can still import them (the rollback path); I kept that. If you want a second, file-folder export as well, say so.
- Still open: the real GitHub no-reply address; pushing for CI; `docs\LEARNING-PROTOCOL.md` (F0).

### C3 follow-up: the real backup (2026-11-15)
Run: `KARTOTEK_BACKUP=<your export> npm test` on `kartotek-backup-2026-11-15.json` (785,374 bytes), with your content folder. The file was only read: size, modification time and SHA-256 are identical before and after.

| Record | In the file | After import |
| --- | --- | --- |
| Cards | 225 | 225 |
| Review events | 1 | 1 |
| Decks | 19 | 19 |
| Studies | 19 | 19 |
| Study attempts (Study v2) / legacy answers | 0 / 0 | 0 / 0 |
| End-of-lesson tests, mock exams | 0, 0 | 0, 0 |
| Mind maps / versions | 1 / 1 | 1 / 1 |
| Exam plans: marks and selections / dates / application ticks | 9 / 1 / 0 | 9 / 1 / 0 |
| Settings / model parameters / parameter history | 14 / 34 / 0 | 14 / 34 / 0 |

- Whole saved state read back from the files: identical. A restart from the files reads exactly the same state.
- Review queue for today: the old app (browser storage) and the desktop app (files) both give 21 cards (1 review, 20 new), the same order, counts and limits.
- Your data holds little history so far (1 review event, no study attempts, no lesson tests or mocks). Those record types are covered by the synthetic tests, not by your data.

The C3 "done when" is met on your data. Still unverified: the Electron window itself (Smart App Control; CI after a push).

## 2026-11-15 · Task C4: installer, CI and the first release (branch `task/c4-installer-release`)

### What changed
- Before starting: merged `task/c3-learner-data-files` into `main` (your prompt is the OK), then branched.
- **Installer** (`electron-builder.yml`, electron-builder 26.18): Windows x64 NSIS, per user, no administrator rights, folder choice, `Kartotek-Setup-0.1.0.exe`, product name Kartotek, version 0.1.0 from `package.json`, a drawn icon (`build\icon.png`, `build\icon.ico` from `scripts\make-icon.cjs`; same design as the page's favicon). Only `desktop\`, `src\`, `samples\` and `package.json` are packed; the samples stay outside the archive. Electron fuses are set (no run-as-node, no `NODE_OPTIONS`, no inspector flags, only the checked `app.asar`, ASAR integrity on). `npm run dist` builds it.
- **User data is outside the install:** `%APPDATA%\Kartotek` and the content folder. `scripts\check-installer.cjs` (CI only, it refuses to run on a personal PC) installs silently, installs again over it (an update), runs the smoke test against the installed app, uninstalls, and checks after each step that a sentinel in the real profile folder is untouched.
- **Default content folder:** `Documents\Kartotek Content` is now used when it exists and nothing else is set (ARCHITECTURE.md 3.1), so an installed app finds your content without a setting.
- **CI** (`.github\workflows\ci.yml`): job `test` on every push and pull request (hygiene check, UI build and "committed build output equals a fresh build", `npm test`, browser export from the samples, sample audit, desktop smoke test); job `installer` after it (build, fuse check, installer check). A tag `vX.Y.Z` that equals the `package.json` version also creates a **draft** GitHub Release with the installer and `SHA256SUMS.txt`. Action versions checked on 2026-11-15: `actions/checkout@v7`, `setup-node@v7`, `upload-artifact@v7`; electron-builder 26.18 (27 is alpha); the release uses the GitHub CLI on the runner.
- **Docs:** `docs\RELEASING.md` (how to cut a release), README (download, first run, the honest unsigned/SmartScreen/Smart App Control note), `THIRD-PARTY-NOTICES.md` (Electron and Chromium), `ARCHITECTURE.md` section 10.0d, `CLAUDE.md`.
- **Repeatable private-content check:** `npm run hygiene` (`scripts\check-hygiene.cjs`, A3's check as a script, also run by CI). Verified that it fails on a tracked content folder and on a personal trace.
- Neutralised two private traces found by the check: the example map id in `MINDMAP-RULES.md` and a reference to a private study in a generated prompt in `src\cents-data.js`.

### Verification
| Check | Result |
| --- | --- |
| `npm test` | 53/53 engine, 6/6 desktop helpers, 9/9 content, reload scenario, 11/11 data store, 7/7 data import and window |
| `npm run hygiene` | passes: 147 tracked files, no private path, document, photo or personal trace |
| `npm run dist` on this PC | builds `Kartotek-Setup-0.1.0.exe` (121.9 MB); executable metadata: Kartotek, 0.1.0, copyright line, icon; asar holds only `desktop`, `src`, `samples`, `package.json`; samples unpacked; licences shipped; fuses read back from the executable as set |
| Workflow and builder YAML | parse (js-yaml) |
| Installing and running the installer or the app on this PC | **not possible**: Smart App Control (see C1) |
| CI, packaged-app smoke test, installer check | **not run yet**: nothing is pushed |

### Open points
- **Installing it on this PC will fail while Smart App Control is on** (it blocks every unsigned executable, installers included). The installed-app check therefore happens on the CI runner; installing it yourself needs Smart App Control off.
- **No automatic updater** in 0.1.x (planned for C4 in ARCHITECTURE.md section 10, not asked for in this task): to update, run the newer installer.
- **`npm audit`:** 6 moderate findings, all `minimatch` inside electron-builder (build tool, not shipped); the offered fix downgrades electron-builder to 25.1.0, so it is not applied.
- **History:** three old commits (B1 and C1) contain a user-name path in `docs\ARCHITECTURE.md`; it was fixed later but is still in those commits. Before the first push the history has to be restarted again, as in A3 (decision 9).
- The commit author email is still the placeholder `noreply@kartotek.invalid`.

### C4 follow-up: first-push preparation (2026-11-15)
- The history was restarted again (decision 9): one commit, `Kartotek 0.1.0`, on `main`; the earlier local history is archived outside the repository (`Kartotek Content\backups\kartotek-private-history-2026-11-15b.bundle`, verified) and removed from it. `task/c4-installer-release` points at the same commit.
- The hygiene check had to change: it contained the personal terms it searches for, so it flagged itself and would have published them. It now holds only generic patterns and reads personal terms at run time from the Windows user name of whoever runs it and from the git-ignored `hygiene.local.txt`. Verified: it fails on a probe file with those terms, and the script and `.gitignore` contain none of them.
- **Not pushed.** The GitHub repository did not exist yet and the author email stays the placeholder (`noreply@kartotek.invalid`), as chosen. Next: create an empty public repository, give its URL, then `git remote add origin <URL>`, `git push -u origin main`, wait for CI, then `git tag -a v0.1.0` and `git push origin v0.1.0`.

### C4 follow-up: first CI run and the desktop window (2026-11-15)
- Pushed to https://github.com/Kardo025/Kartotek- (the existing README-only commit was overwritten by a force push, with the owner's OK). CI run #1: every step of the `test` job passed except the desktop smoke test, so `installer` was skipped.
- Cause: the smoke test counted the 404 responses of its own `kcontent://` path-escape probes (the app refuses them on purpose) as console errors. They are now expected, and every failure is also written as a workflow annotation so the run page shows it without signing in.
- **Electron now starts on this PC** (Smart App Control no longer blocked it), so the window was finally verified locally: `npm run smoke` passes (19 sidebar entries, Algorithm tab 53/53, content, data, restart; 0 unexpected console errors), and the same smoke test passes against the packaged app (`dist-installer-c\win-unpacked\Kartotek.exe`, fuses set) over the DevTools protocol.

### C4 follow-up: first release built (2026-11-15)
- CI run #2 on `main` (commit 6735210): `test` and `installer` jobs both green, including the silent install, update, smoke test of the installed app and uninstall with the user-data sentinel untouched.
- Tag `v0.1.0` pushed on that commit. Its run (#3) is green: tag equals `package.json` version, `Kartotek-Setup-0.1.0.exe` built (116 MB artifact `kartotek-installer`), fuses checked, installer check passed, **draft release created** with the installer and `SHA256SUMS.txt`. Drafts are not visible to anonymous visitors (the public releases list is empty), so the owner has to open the draft while signed in, read it and press Publish (`docs/RELEASING.md`, step 7).
- Still to do: publish the draft; install the published installer on this PC and start it with the real data (first-run panel: import the real backup file).

## 2026-11-15 · Task D1: navigation split into Study and Planning (branch `task/d1-navigation`)

### What changed
- Before starting: `main` already held all of C4 (nothing to merge); branched from `main`.
- **Study | Planning switch** at the top of the sidebar, remembered between sessions. **Study:** Review, Study, Cards, Mock exam, End-of-lesson test, with one **Scope** selector (All, CEnT-S, TU Delft AE Prep) that re-points Review, Study, Cards and Mock exam to the existing exam tabs. **Planning:** CEnT-S and TU Delft AE Prep overviews, Application, Euro apply (placeholder for D2), Stats. **Always visible:** the AI Mind Mapping Assistant group with Mind maps (you asked for it to stay its own group), Career (a short "planned" page) and the System group (Settings, Algorithm).
- **Nothing in the engine changed:** the tab ids are the old ones, so `App.scope`, `App.examDecks`, the saved last tab and `#hash` links work as before. `ui\src\nav.js` maps a tab id to its mode, scope and entry and back.
- **Mock exam under All** opens a small picker (the two exams with their mock counts), because a mock belongs to one exam. End-of-lesson test and Mind maps are not exam-scoped, so the scope does not filter them.
- Badges follow the scope; the arrow keys move through the visible entries and wrap; the mode switch takes Left and Right; the tab transition motion is kept (direction follows the sidebar order).
- Tests: `npm test` +14 navigation tests; `npm run smoke` now visits every entry in both modes and all three scopes and opens all 19 old tab ids.

### Verification
| Check | Result |
| --- | --- |
| `npm test` | engine 53/53, desktop helpers, content, data, 14/14 navigation |
| Desktop window (real Electron, `npm run smoke`) | passes: 36 entry visits across Study mode (3 scopes) and Planning mode, all 19 old tab ids open a highlighted, rendered entry, mode and scope remembered, Algorithm tab 53/53, 0 unexpected console errors |
| Browser build (`build.ps1`), by hand | scope changes the tab id (`study` to `cents-study`), the mode switch returns to the last tab of a mode, Mock exam picker opens `tud-mock`, a reload restores Planning with scope TU Delft |
| Screenshots, desktop window 1346 x 864, dark theme | Study mode (scope All), Study mode (scope TU Delft AE Prep), Planning mode |

### Open points
- The CI run for this branch's commit will repeat the smoke test on the Windows runner.
- Still open from C4: publish the draft release `Kartotek 0.1.0` (the empty `v0.1.0` release that was published by hand has no installer).
- D2 fills the Euro apply entry; the Planning home page and Content problems entry from the architecture are not part of D1.

## 2026-11-15 · Task D2: Euro apply from Planning, and the Planning home page (branch `task/d2-euro-apply-planning`)

### What changed
- Before starting: merged `task/d1-navigation` into `main` (your prompt is the OK), then branched.
- **Planning, Euro apply** opens your separate Euro apply app in its own window, as designed in `docs\ARCHITECTURE.md` section 8: no preload, no Node, its own session, navigation limited to `127.0.0.1:5178`, other links to the browser. Its folder is a **setting** (a folder picker on that page and in Settings; the choice is validated before it is saved). Without a folder the page is a short setup row. If the server is not running the page offers **Start Euro apply**, which runs Euro apply's own `tools\serve.ps1` hidden and opens the window when it answers.
- **Planning, Home** (new first entry of Planning): one combined timeline: your exam dates and study pace per exam, the dated rows and **open steps** of the Application page, and the programme deadlines from Euro apply (read only). Each row says which app owns it and opens the screen it comes from. A TU Delft item that both apps know is **one row owned by Euro apply** (your decision), marked "also on the Application page", with a link to each; a deadline several universities share (a common exam sitting) is one row naming them. Window: 30 days, 90 days (default), all upcoming; Euro apply rows can be switched off.
- **If Euro apply cannot be read** the page still shows Kartotek's own rows and a "What is missing" panel with the reason (folder not set, file unreadable, unknown format, or desktop-only in the browser build) and a button to set up or try again.
- Nothing is written into the Euro apply folder and none of its code is copied; Kartotek runs only its launcher.

### The Euro apply files and fields Kartotek relies on (what must not change there)
**One file: `data\universities.json`**, read directly from disk (not through its server), read only. Kartotek reads nothing else in that folder (not `profile.json`, `countries.json`, `rankings.json`, `weights.json`, `inbox\`, the app code).
- Top level: `schema` (a string starting `euroapply.universities/`, major version `1`; any other version is reported, not used), `updated` (date shown as "data from"), `universities` (a list).
- Each university: `id`, `name`, `programs` (list), `timeline` (list). Its row source is the name.
- Each programme: `id`, `name`, `status` (a programme counts as "still in play" unless `status` is `Rejected`; a university with no such programme is left out), `timeline` (list, optional).
- Each timeline item, at university level and at programme level: `date` (`YYYY-MM-DD`, optionally `THH:MM` with an offset; the day is the first 10 characters, the time as written; an item without a usable date is skipped), `label`, `kind` (`open`, `deadline`, `exam`, `result`, `payment`, `other`), `est` (true shows "estimated"), `checked` (`YYYY-MM-DD`), `url` (only `https:` links are kept), `note`, and `id` (university level; programme-level items have none).
- Not read although the architecture table listed them: city, country, priority and the status list.
- Behaviour that matters: a half-written file is retried once after 500 ms (Euro apply saves through its own server); Kartotek also needs `tools\serve.ps1` (to start it), `app\node_modules` (a note only) and the server on `http://127.0.0.1:5178/` (strict port).
- TU Delft items are matched to the Application page by the university's `id` or `name` containing "delft", the same calendar day and one meaningful word in common (title and note).

### Verification
| Check | Result |
| --- | --- |
| `npm test` | engine 53/53, content, data, navigation 14/14, **16 new tests** for the Euro apply connection and the timeline (folder check, a projection that never leaks other fields, unknown or newer schema, a half-written file, the launcher against a stand-in, nothing written, loose step dates, owners, folding, merging, windows, missing data) |
| Your real Euro apply folder through Kartotek's own code | read ok (schema `euroapply.universities/1`, updated 2026-11-07, 19 universities); 90 days: 18 rows (8 Kartotek, 10 Euro apply, 1 shown once for both apps); all upcoming: 68 rows, 10 TU Delft items shown once for both apps; the folder is **unchanged** after the whole run (sizes, times and the file's SHA-256 compared before and after, `node_modules` excluded) |
| `npm run smoke`, real Electron window | passes: Home without Euro apply (own rows, "what is missing"), the setup row, a configured stand-in folder (its deadline on Home with owner and link), Open makes a separate window that is sealed (no bridge, no Node) and cannot be navigated away |
| Real Start on your PC | Euro apply was not running; **Start Euro apply** ran its launcher, the server answered and the window opened (Euro apply's map with your targets). I stopped the server I started afterwards (port 5178 closed again) |

### Open points
- The launcher is started as a plain hidden child, not "detached": found by testing that a detached child gets no console on Windows and the launcher's own `Start-Process` silently does nothing.
- The test script that started your Euro apply hung while closing; I stopped it and the server it started. Your Euro apply server was not running before and is not running now.
- The overdue open steps of the Application page (those whose loose date is already past, such as "Nov-Dec 2026") are shown at today's date, marked "past due".
- Still open from earlier: publishing the C4 draft release; the real GitHub no-reply email; D1 and D2 are not pushed.

## 2026-11-15 · Task E1: the model layer (branch `task/e1-model-layer`)

### What changed
- Before starting: merged `task/d2-euro-apply-planning` into `main` (your prompt is the OK); no `CLAUDE.md` change was pending; branched from `main`.
- **One provider interface** (`desktop/models/service.js`, main process): every call is `{ feature, slot or target, system, messages (text and images), schema?, webSearch?, maxOutputTokens?, effort? }` with streaming events, cancellation by call id, token usage and cost per call, and typed errors (not-configured, auth, rate-limit, budget, network, schema, cancelled, cli-missing, refused, timeout). With a schema the answer is always checked (a small schema checker of Kartotek's own); a wrong answer gets one repair call, then a "schema" error.
- **Adapters:** (a) **Anthropic** through the official SDK (`@anthropic-ai/sdk` 1.8.0, Apache-2.0; structured output, images, web search, `effort`) and **one OpenAI-compatible adapter** for OpenAI, Google Gemini (its OpenAI-compatible endpoint) and OpenRouter, as decided; (b) **command-line clients**: Claude Code first (`claude -p --output-format stream-json ... --permission-mode dontAsk`, prompt on stdin, its own empty folder, never `--bare`, so your subscription login is used), Codex (`codex exec --json ... --sandbox read-only`), and any other client; (c) **local endpoints** such as Ollama (`http://localhost:11434/v1`). Checked against the current docs: Anthropic (via the Claude API skill: models, prices, SDK, structured outputs, web search), Claude Code headless, Codex non-interactive mode, Ollama and Gemini OpenAI compatibility. OpenAI's own reference page refused the fetch (403); its parameters follow the published format and are covered by the stand-in tests.
- **Settings, Models** (`ui/src/tabs/ModelsPanel.jsx`): add a provider (API key, command-line client or local model), **Test connection** (one small call through the shipped `connection-test` prompt with structured output; shows the reply, the time, the tokens and the cost, or the typed error and what to do), replace or delete a key, remove a provider; the three **task slots** (strong, fast, vision) with a model each (a list can be loaded from the provider); **Usage and budget**: calls, tokens and estimated cost per day, feature and model, month by month, a **monthly budget** with a warning at 80 % and a stop at 100 % that you can lift for the month; **Prices** (Anthropic's list prices shipped, others added by you); **Prompts**: the shipped prompt files with an editor, Reset to default and a flag when the shipped text changes (decision 14 moved this to E1).
- **Keys** are encrypted with Electron `safeStorage` (Windows DPAPI) into `%APPDATA%\Kartotek\models\keys.bin`, decrypted only in the main process at call time, never returned to the window, never in `providers.json`, the usage log, the learner data, backups, exports or the repository. The usage log (`models\usage\YYYY-MM.jsonl`) holds no prompt or answer text.
- **Without a model** everything works as before. Every AI button (Explain, Practice this again, Write a study, Write a mock, Ask Claude about a card, mind-map grading and reference map, Open in Claude Code) shows a small **"No model set up"** hint that says what it would need and opens Settings, Models; the button itself still opens Claude Code and the copy button copies the prompt. The browser page says models need the desktop app. (The buttons move onto the model layer in E2.)
- `THIRD-PARTY-NOTICES.md` lists the SDK and its seven dependencies with their licence texts; the installer packs `prompts\` and the SDK (checked in the built `app.asar`: no development tools inside).

### Verification
| Check | Result |
| --- | --- |
| `npm test` | engine 53/53, every earlier suite, and **29 new model-layer tests**: schema and prompt files 5, model service with a fake provider 12 (keys encrypted and never leaked, slots, pricing, repair, cancel, budget, usage summary, connection test, input checks, removal), Anthropic adapter against an SSE stand-in through the SDK 3, OpenAI-compatible adapter against a server on 127.0.0.1 3, command-line adapter with fake Claude Code / Codex / custom clients (including a `.cmd` shim, cancel, timeout, "not logged in") 6 |
| `npm run smoke`, real Electron window (dev) | passes: Models panel present; a command-line client added through the form and a local endpoint (stand-in server) both answer **Connection works**; an API key stored through the bridge is encrypted on disk (78-byte DPAPI blob) and never comes back; 2 calls logged without text; 0 unexpected console errors |
| Same smoke test against the packaged app (`electron-builder --dir`) | passes; `app.asar` holds the SDK, its licence, `prompts\`, `desktop\models\`, and none of jsdom, Playwright or electron-builder |
| Hint on AI buttons (real window) | fresh profile: 2 hints on the Mock exam page, a click opens Settings at Models; after a slot is set: 0 hints |
| `npm run hygiene` | passes (178 tracked files) |

### Not verified: the "done when"
**No real provider was called.** This PC has no `claude`, `codex` or `ollama` on its PATH and nothing listens on port 11434, and I have no API key of yours (and tests must not call real services). The three adapters were proven against stand-ins and in the real window with a fake client and a stand-in endpoint. To finish the check on your PC, in the desktop app (`npm start`):
1. **API key:** Settings, Models, Add a provider, "Anthropic API key", paste a key, Add; Test connection with `claude-haiku-5-5` (costs well under a cent).
2. **Command-line client:** install Claude Code and sign in once (`claude` in a terminal), then Add a provider, "Claude Code (your subscription)", Add, Test connection. If it says "Not found", give the full path of `claude.exe` (or `claude.cmd`).
3. **Local endpoint:** install Ollama, `ollama pull llama3.2`, then Add a provider, "Ollama on this PC", Add, model `llama3.2`, Test connection.

### Open points
- Prices for OpenAI, Gemini and OpenRouter models are not shipped (they change often); until you add them under Prices, those calls show "price unknown" and do not count towards the budget.
- Codex's `--output-schema` limits were not checked against a real Codex (its docs do not state them); a mismatch would show as one repair call or a "schema" error.
- The per-feature slot override ("advanced", ARCHITECTURE.md 5.3) is not built.


## 2026-11-15 · Task E1, follow-up: real connection tests on this PC (branch `task/e1-model-layer`)

### What changed
- With your OK I installed **Ollama 0.40.16** (`winget install Ollama.Ollama`, user scope, installer hash checked by winget) and pulled **`llama3.2`** (2.0 GB), and installed the standalone **Claude Code 2.1.325** with Anthropic's official installer (`claude.ai/install.ps1`, read before running; it checks the SHA-256 of the download) into `%USERPROFILE%\.local\bin\claude.exe`.
- That installer does **not** add `%USERPROFILE%\.local\bin` to PATH, so Kartotek's default command `claude` would have said "Not found". `desktop/models/cli.js` now also looks in that folder after PATH (one new test with a fake home folder).

### Real tests (through Kartotek's own model service, a temporary profile, no keys)
| Provider | Result |
| --- | --- |
| **Local endpoint: Ollama, `llama3.2`** | **passes**: model list loaded (`llama3.2:latest`), reply "Kartotek connection works." (matches, structured output valid, no repair), 106 input / 12 output tokens, cost $0 (free-local), 39.7 s for the first call (the model loads into memory), usage logged as `ollama · llama3.2` |
| **Command-line: Claude Code** | first run: the typed error **auth: "Not logged in"** (correct). After your sign-in: **passes**: reply "Kartotek connection works." (matches, native structured output, no repair) with claude-haiku-5-5, 3.4 s, 302 output tokens, billed to your subscription (API equivalent about $0.007, shown as an estimate) |
| **API key: Anthropic** | not run: a key must be pasted by you, and it is billed separately from the Claude subscription (console.anthropic.com). |

`npm test`: every suite passes (command-line adapter 6/6 with the new check).

### How you can finish the check
1. Open a new terminal, run `%USERPROFILE%\.local\bin\claude.exe` (or `claude` after adding that folder to your user PATH), sign in, then quit with `/exit`.
2. `npm start`, Settings, Models: Add a provider, "Claude Code (your subscription)", Add, Test connection.
3. Add "Ollama on this PC", model `llama3.2`, Test connection (Ollama runs in the tray after a restart too).
4. Optional: "Anthropic API key", paste the key, Test connection with `claude-haiku-5-5`.

### Open points
- None new. The E1 "done when" is met for the command-line client and the local endpoint; the API-key path is proven against the stand-in only, until you add a key.

## 2026-11-16 · Task E3: writing content inside the app (branch `task/e3-content-jobs`)

### What changed
- Before starting: merged `task/e1-model-layer` into `main` (your prompt is the OK); no `CLAUDE.md` change was pending; branched from `main`. **E2 is not built** (you sent E3 next); the study-time hand-offs (Explain, follow-ups, Ask, Feynman feedback, typed grading) still go to Claude Code.
- **Writing jobs** (`desktop\jobs\`, details in ARCHITECTURE.md 10.0h): background jobs with visible steps that resume after a pause, an error or a restart (`%APPDATA%\Kartotek\jobs\<id>\job.json`). Each step is a separate structured call; ids are assigned by the code. After every task the task's own checks and the matching `KCycle.validate`/`KCycle.audit` messages go back to the model for a repair (2 attempts by default); the audit step sends remaining blockers back to the task that owns them (2 rounds).
- **New study from my files** (Study library): **Write in the app** with any configured provider and model (chosen per job, page images through the vision slot or a chosen vision model), or **With Claude Code** as before. Files are read locally: PDF with pdf.js (pages without a usable text layer are rendered and read by the vision model), .pptx, .docx, text. **Before anything is sent** the job shows calls, tokens and cost per step; while it runs, the running total.
- **Steps** (STUDY-RULES.md v2.3): read → page images → units → relations → parts, topics, outcomes and criteria → lesson per topic → part overviews → practice and connecting items → final test and blueprint → audit and repair → verification → save.
- **Verification:** every model item starts `unverified`; a second call solves it without the key; multiple choice and numbers are compared by the code, written answers by a rubric check. Match → `verified`; no match → `disputed`, one fix round, one more independent solve. **Skip the remaining fixes** ends the fix round early (disputed items stay disputed).
- **The draft** is saved to `studies\<id>\etut.json` + `source.md` in the content folder (copies of the sources in `sources\<id>\`; an existing `etut.json` is kept as `etut.before-<job>.json`), with `generated_by` (every writer and its calls, writers per step, verification counts, certified). The library shows "draft · not certified" while the audit has blockers and a "written by …" chip.
- **Same job type:** end-of-lesson tests, mock exams (new or from a past paper), the exam Overview's **Write next N in the app**, and mind maps (**Use the vision model** on a waiting reading or coaching request; `KMind` validators before writing). Settings lists every job.
- **Ollama** now uses its native `/api/chat`: a context window sized to the prompt (8k–64k by default), schema-constrained output, thinking by effort. Without this, Ollama silently cut long prompts.
- New dependencies: `pdfjs-dist` 6.5.438 (Apache-2.0) with `@napi-rs/canvas` 1.1.1 (MIT, contains Skia, BSD-3-Clause); `THIRD-PARTY-NOTICES.md` updated; the installer unpacks the native canvas module and packs `MINDMAP-RULES.md`.

### The "done when" run (a real lecture file, a provider other than Claude Code)
- **Source:** `DSD_Lecture1.pdf` (33 pages; page 33 has no text layer). **Writer:** `gpt-oss:20b` on Ollama (local, free). **Page images:** `qwen3.6:35b-a3b`. Both models were compared first on the units step: qwen3.6 was a little faster (23.5 against 20.5 tokens/s) but merged ideas into 14 units; gpt-oss wrote 40 units, closer to Claude Code's 27 for this lecture.
- **Result:** `studies\dsd-lecture1-local\etut.json`, **0 blockers, certified** (app audit and `tools\audit-study.py` agree), 25 warnings. 41 units, 14 relations, 3 parts, 8 topics, 8 outcomes, 28 criteria, 58 lesson blocks, 46 practice items (17 of them connecting), 30 final items. **Verification: 53 verified, 23 disputed** (I skipped the last fix rounds at your request, so the remaining disputed items keep the mark).
- **Every stage:** with Kartotek's own engine (import, then for each of the 8 topics Priming → Learn & digest → Applying → Evaluating (deferred), End opened, final test of 30 items, report): every topic's cycle completed, 34 Applying answers and 27 final answers reached DSR, and the 23 disputed items never did ("The question is not verified"); the report assessed 8 of 8 outcomes. This walk ran headless because Smart App Control started blocking `electron.exe` this afternoon; the job itself ran in the real window up to the final test, then in the same main-process modules without the window.
- **Cost and time:** 123 model calls, 276k tokens in, 311k out (much of it thinking), $0; about 2 h 16 min of model time on this PC (RTX 5070, 12 GB). The estimate before Start said about 52 calls and 113k–340k tokens in; the repairs and the fix round doubled the calls.
- Ollama on this PC first used the AMD Radeon 880M instead of the RTX 5070 (8 tokens/s). For this session I restarted it with only the NVIDIA GPU visible (`HIP_VISIBLE_DEVICES=-1`, not a permanent setting); the tray app will use the AMD one again after a restart.

### Quality compared with the Claude Code study (honestly)
Compared with the Lecture 1 part of `dsd-1` (Claude Code, written from Lectures 1–3 and the exercise sheet).

| | local (gpt-oss:20b) | Claude Code (dsd-1, Lecture 1 part) |
| --- | --- | --- |
| units / included | 41 / 41 | 27 / 21 (6 left out as administration or out of scope) |
| topics, criteria | 8, 28 | 7, 15 |
| lesson words per topic | about 320 | about 310 |
| practice + final items | 46 + 30 | 40 + 15 (from this lecture) |
| item formats | 32 typed, 23 numeric, 21 multiple choice | 40 multiple choice, 15 numeric |
| items from the source's exercises | 9 imported | 26 imported (mostly from the exercise sheet) |
| verified | 53 of 76 (23 disputed) | 55 of 55 |

What the local study does well: the structure is complete and checks out (0 blockers without a human edit); the lessons are mostly correct and use the right blocks (worked noise-margin example with NMH = 0.69 V and NML = 1.02 V, a compare table of VOH/VOL/VIH/VIL, the division-by-2 procedure as steps, `n = ⌈log₂ N⌉` with the 7-days and 12-months examples); many items have hints and steps.

Where it is clearly weaker, with examples:
1. **It does not leave out administration.** Unit U1 and a whole topic "Exam Overview" ("Without notes, state the exam format for this lecture") come from the course-info slide. Claude Code left such slides out.
2. **Criteria test remembering the slides, not the skill.** The noise-margin outcome's criterion is "Provides the example margins for 5 V CMOS: VOH = 3.84 V …", and its items ask "In the 5 V CMOS example, what is the value of VIL?" (practice) and "What is the value of VIL in the 5 V CMOS example?" (final). Claude Code asks the skill with new numbers: "A logic family has VOH = 2.4 V, VOL = 0.4 V, VIH = 2.0 V and VIL = 0.8 V. What is the high noise margin NMH?" and, in the final test, a second family where the learner must find the smaller margin.
3. **Topic boundaries are loose.** The "Digital System Components" lesson also teaches Boolean variables, the majority function and combinational circuits, which belong to other topics; its priming mentions "the symbol xy for AND".
4. **Connecting items were mostly broken.** 17 instead of 1–3 per part, and most were written as "numeric" with key 0 for questions such as "Explain how the exam covers both digital system components and the way signals are represented". The verification caught all of them (disputed), so none would reach your reviews, but they are noise in Applying.
5. **Small errors in lesson text.** A worked example says "The remainders (bottom to top) are 1,0,1,1 → binary 1100" (the remainders of 12 are 0, 0, 1, 1; the result 1100 is right). Unit ids leaked into text ("… (U9)") and source ids into solutions ("See S1 p.12"); the first is now removed at save.
6. **Fewer source exercises** (9 imported against 26), partly because Claude Code also had the exercise sheet.

Verdict: the local model produces a usable, structurally sound **draft** that needs your review; it is not at Claude Code's level for what is asked (skills against recall of the slide) and for judgement about what to leave out. The verification pass does what it is for: it caught every broken connecting item and several weak written items. For studies you rely on, I would use a stronger writer (an API model, or Claude Code through the command-line provider) and keep local models for drafts and lesson tests.

Fixed after the run (tested): unit ids removed from learner text at save; "number" fields without a number now fall back to the number in the written answer (one correct answer, 185, had been marked disputed); numeric items whose solution never reaches the key and more than 3 connecting items per part go back to the model as problems; "Skip the remaining fixes".

### How you can test it
1. `npm start` (if Smart App Control allows Electron), Settings, Models: Ollama with `gpt-oss:20b` as the strong slot (or any provider).
2. Study, **New study from my files**, Write in the app: choose a lecture PDF, Prepare, read the estimate, Start. Pause, close the app, reopen: the job resumes. Studies being written shows the steps, repairs and running total.
3. Open `dsd-lecture1-local` in the library (Reload content): chips "written by Ollama (local) · gpt-oss:20b"; disputed items show their note and never reach your reviews.
4. End-of-lesson test: **New test from my files**; Mock exam: **Write mock N in the app**; CEnT-S Overview: **Write next N in the app**; Mind maps: **Use the vision model** on a waiting request.
5. `npm test`: all suites, including 15 writing-job tests (fake model) and the Ollama native-path test.

### Open questions
- **Keep or delete `studies\dsd-lecture1-local`?** It is in your content folder as the evidence of this run; delete the folder if you do not want it in the library.
- **Ollama on the NVIDIA GPU permanently:** setting the user environment variable `HIP_VISIBLE_DEVICES=-1` (and restarting Ollama) makes the tray app use the RTX 5070. That is your setting to make. The two models take about 37 GB (`ollama rm qwen3.6:35b-a3b` / `gpt-oss:20b` frees it).
- **Smart App Control** blocked `electron.exe` again this afternoon (it allowed it this morning); `npm start` and `npm run smoke` cannot run while it does.
- Not verified with a real provider: the lesson-test, mock-exam and mind-map jobs (tested with the fake model only), and an API-key provider.
