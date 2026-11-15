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
