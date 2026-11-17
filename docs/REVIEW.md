# Kartotek: independent review (task G1, 2026-11-17)

Reviewer: a session that did not write this code. Nothing was fixed in this session; this file and the `docs\PROGRESS.md` entry are the only changes.

**What was reviewed.** The whole change since the baseline: commit `7409a51` "baseline" (2026-11-14) of the archived private history (`Kartotek Content\backups\kartotek-private-history-2026-11-15.bundle`; the public history was restarted at `7921dbe` "Kartotek 0.1.0"), up to `27ddf05` (`main` after the F8 merge), tasks A1 to F8.

**How.** I read `CLAUDE.md`, `docs\ARCHITECTURE.md`, `docs\LEARNING-PROTOCOL.md`, `docs\PROGRESS.md` and the local `research\harness-integration\03-decisions.md`, then:

- ran `npm test` with a copy of the owner's backup;
- ran `npm run smoke` in the real Electron window;
- ran `npm run hygiene`, `python tools\audit-study.py --all` and `--samples`, and `npm audit`;
- compared the old engine with the current one on the backup copy;
- walked every screen in three setups: the bridge preview with no model, the bridge preview with only a local model (Ollama `gpt-oss:20b`), and the single-file browser page;
- wrote my own scheduler-integrity test and my own history and LearnHarness scans.

The four reviewer scripts are in Appendix A. They are not part of the app. The owner's dev profile (`%APPDATA%\Kartotek-dev`) was never opened. The original backup file was only copied: its SHA-256 (`c31483fe…db2ec20`), size and time were the same before and after.

## Summary

| Rank | Count | Findings |
| --- | --- | --- |
| Blocker | 1 | B1 |
| Should fix | 5 | S1–S5 |
| Minor | 13 | M1–M13 |

**What holds up well:**

- **Data safety.** The import of the real backup keeps every count. The whole state reads back identical, and survives a restart. Today's review queue is the same card for card in three engines: the baseline engine, today's browser engine, and the desktop file store.
- **The scheduler itself is unchanged.** `src\engine.js` is byte-identical to the baseline, apart from line endings.
- **Scheduler integrity.** No helped, generated, probe, live-session, practice, graph or side-question answer changed a card, in the reviewer's own tests or in the instrumented repository suites. Two positive controls show that the test does see a change.
- **Independence.** With no model, every screen opens and nothing crashes. With a local model only, the model features run (slowly).
- **Tests and checks.** `npm test` and `npm run smoke` pass, and the 14 Study v2 packages are certified.

**What must change before a public 1.0:** a commit already on GitHub contains the Windows user name (B1). The hygiene check cannot see history, which is how B1 got through (S1).

## Findings

Each finding has a rank, what is wrong, where, and how to reproduce it. Paths are relative to the repository. `<user>` stands for the Windows user name; it is deliberately not written here.

### Blocker

**B1. A pushed commit contains the Windows user name.**
- **What:** Commit `2fa5786` ("E1 follow-up: find Claude Code in its native install folder…", 2026-11-15) adds this line to `docs/PROGRESS.md`, at line 361 of that version:

  ```
  1. Open a new terminal, run `C:\Users\<user>\.local\bin\claude.exe` …
  ```

  The next commit replaced it with `%USERPROFILE%`, but the commit is in `origin/main`, `origin/task/e2-model-in-study`, `origin/task/f1-thinking-confidence-prompts` and `origin/task/f2-hint-ladder`. So it is on the public GitHub repository.
- **Why it is a blocker:** it breaks the owner's rule against personal traces (`CLAUDE.md:10`, decision 5.5, "Nothing private … enters the public repository"). A3 and C4 restarted the whole history for exactly this kind of trace.
- **Reproduce:**
  ```bash
  git show 2fa5786:docs/PROGRESS.md | sed -n 361p
  ```
  ```bash
  git branch -r --contains 2fa5786
  ```
  The reviewer's history scan (Appendix A.3) reports it as the only personal-term hit in 652 blobs.
- **Fix needs the owner:** rewrite the history and force-push (as in C4), or accept that the trace is public. Either way, decide before tagging 1.0.

### Should fix

**S1. The hygiene check only looks at the current tree.**
- **What:** `scripts/check-hygiene.cjs:13` reads `git ls-files`, so a trace that was committed and later removed passes, both locally and in CI. That is how B1 reached GitHub.
- **Reproduce:** `npm run hygiene` passes today ("No private paths … are tracked"), although `2fa5786` holds the user-name path. Scanning every reachable blob (`git rev-list --objects --all`, as in Appendix A.3) finds it.

**S2. The "Generated questions" calibration view was never built.**
- **What:** `docs/LEARNING-PROTOCOL.md` 2.3 (line 89) and section 7 put probe, live-check and generated-practice answers into a separate "Generated questions" calibration view in Stats. The owner accepted this with D1–D17. The records exist (`KLive.confidenceRecords`, probe and practice claims), but no screen shows them. Every PROGRESS entry from F1 to F8 carries this as open.
- **Reproduce:** Planning, Stats: there is only the banded and fine confidence calibration. `grep -rn "Generated questions" ui/src` finds nothing.
- **Owner:** build it in G2, or drop it from the protocol.

**S3. Coral fills with white text (fails contrast and DESIGN.md).**
- **What:** The F8 language buttons use `background: var(--k-accent); color: var(--k-on-accent, #fff)` (`ui/src/research.css:40`). `--k-on-accent` is not defined, so the text is white. In the dark theme the fill is `#ff6b5b`, which gives a contrast of about 2.8:1 for 12.5 px text (AA needs 4.5:1). DESIGN.md says solid coral surfaces with text use `--k-accent-fill` with `--k-accent-text` (`#1a0b09`).
- **Same pattern, older:** the selected option letter in mock exams (`ui/src/tabs/mock.css:26`, `color: #fff` on `--k-accent-fill`, present since `7921dbe`).
- **Reproduce:** desktop app, dark theme, Settings → Models → Dictation with "Turkish and Italian" installed: the active language button is white on coral. Or open a mock exam and select an option.

**S4. Mind-map photos are broken in the single-file browser page.**
- **What:** `src/host.js:184` returns the relative path `mindmaps/<id>/<file>` when not in the desktop app. Since A3 the content lives in the content folder, not next to `Kartotek-DSR.html`, so every photo is a 404. The browser page is the rollback path (`docs/ARCHITECTURE.md` 4.6), and CLAUDE.md asks that mind maps keep working.
- **Reproduce:**
  1. `powershell -ExecutionPolicy Bypass -File build.ps1 -SkipPdf`
  2. `python -m http.server 8765`
  3. Open `http://127.0.0.1:8765/Kartotek-DSR.html` and go to Mind maps. The console shows `404 … /mindmaps/cs-basics/views/A-overview.jpeg`, and the photo overlay of the reading has no image.

**S5. With a local-only setup, the vision steps fail after the job has started.**
- **What:** The vision slot falls back to the strong slot (`desktop/jobs/service.js:95`, `:229`). The OpenAI-compatible adapter reports `images: true` for any model (`desktop/models/openai-compat.js:91`, `:153`). With only `gpt-oss:20b` set up, these steps send images to a text-only model, and Ollama refuses with `{"error":"Multimodal data provided, but model does not support multimodal requests."}`:
  - mind-map reading and coaching ("Use the vision model");
  - the "Page images" step of a new study or lesson test (scanned PDF pages);
  - source transcription.

  The UI only says "The vision slot (falls back to strong)". Nothing warns that the strong model cannot read images, and the estimate still counts those calls. This is the "only a local model" setup the independence goal is about. It does not crash, and no invented reading is stored, but the feature fails late.
- **Reproduce:** bridge preview with a profile whose only provider is Ollama `gpt-oss:20b` (strong and fast, no vision). Mind maps → a waiting request → Use the vision model, or New study from my files with a scanned PDF. Direct check, local and free:
  ```bash
  curl http://127.0.0.1:11434/api/chat -d '{"model":"gpt-oss:20b","stream":false,"messages":[{"role":"user","content":"What is drawn?","images":["<base64 png>"]}]}'
  ```

### Minor

**M1. The welcome stage opens on top of the first-run panel and the boot error.**
- **What:** On a fresh profile the welcome stage comes first, and "Import a backup file / Start empty" only appears after **Start**. When the data folder is locked by another Kartotek, the message "Kartotek could not open its data … Close any other Kartotek window" is under the welcome stage.
- **Reproduce:** `node scripts/bridge-preview.cjs --port 8771` (a new temp profile). Open the page, and the welcome stage hides the first-run panel. For the lock case, start a second preview on the same `--profile` folder.

**M2. Engine modules that adapt LearnHarness designs do not name their source.**
- **What:** `CLAUDE.md:9` asks every adapted file to say which LearnHarness file it comes from. The prompt files do (`adapted_from`). These files carry no LearnHarness reference:
  - `src/probe-core.js`: the bracketing rules, from `src/agent/prompts/prober/10-probe-doctrine.md` and `src/core/contracts/probe.ts`;
  - the R0–R5 ladder in `src/study-v2.js`;
  - `src/practice-core.js`: the demand and retests, from `src/agent/tools/practice.ts`;
  - `src/graph-core.js`: name, statement, aliases and implication nodes, from `src/core/contracts/graph.ts`.

  The text overlap is under 1 %, so these are ideas, not copied code, but the rule asks for the source line.
- **Reproduce:**
  ```bash
  grep -c -i learnharness src/probe-core.js src/practice-core.js src/graph-core.js src/study-v2.js
  ```
  Every count is 0.

**M3. The decision records disagree about LearnHarness and the researcher.**
- **What:**
  - `research/harness-integration/03-decisions.md` §1 still says "No LearnHarness code, prompt text or asset is copied". The owner's 2026-11-16 decision (`CLAUDE.md:9`, `docs/LEARNING-PROTOCOL.md:5`) allows adapted prompt text, and the prompts now share verbatim runs of up to 25 words with LearnHarness, all attributed (section 5 below).
  - D8 in `docs/LEARNING-PROTOCOL.md` §11 still says "only the configured provider's web search". The Brave key option is recorded only in the as-built note (line 442).
- **Reproduce:** read those lines.

**M4. Stale documentation.**
- **What:**
  - `CLAUDE.md:111` explains `status: draft` prompt files, but none remain (`grep -rn "status: draft" prompts` finds nothing).
  - `DESIGN.md:84` describes the sidebar as it was before D1 (Review, Study, End-of-lesson test, Cards; AI Mind Mapping Assistant; CEnT-S and TU Delft groups; Stats, Algorithm, Settings).
  - `DESIGN.md:72-73` says packages and mind-map readings are written by Claude Code.
- **Reproduce:** read those lines next to the running app.

**M5. Old Claude Code wording on the Mind maps page.**
- **What:**
  - `ui/src/tabs/MindMaps.jsx:31` and the "How it works" steps say "Claude Code reads it on your PC", although E3 added "Use the vision model".
  - The page title is "AI Mind Mapping Assistant", while D10 renamed the sidebar group "Maps".
- **Reproduce:** open Maps → Mind maps.

**M6. Wrong dates in the logs.**
- **What:** The PROGRESS entries for F5, F6, F7 and F8 are dated 2026-11-18, 19, 20 and 21 (`docs/PROGRESS.md:683`, `732`, `790`, `836`). Their commits are dated 2026-11-16 and 2026-11-17, and today is 2026-11-17. The as-built headings in `docs/ARCHITECTURE.md` (10.0l–10.0o) and `docs/LEARNING-PROTOCOL.md` §13, and D9's "changed 2026-11-21", carry the same future dates.
- **Reproduce:**
  ```bash
  git log --date=short --format='%ad %s' | grep -E " F[5-8]:"
  ```

**M7. Em-dashes in interface copy.**
- **What:** DESIGN.md:115 says not to use em-dashes in interface copy. They are used as separators in:
  - `ui/src/tabs/mind/Coach.jsx:11-14` ("Coach — one question or a small hint", and three more);
  - `Coach.jsx:106` and `Coach.jsx:115`;
  - `ui/src/tabs/mind/More.jsx:47`.

  Dashes used as "empty" placeholders in tables are left out of this count.
- **Reproduce:** open the mind-map coach mode list.

**M8. Expected console errors from the Algorithm tab.**
- **What:** The sanitiser test feeds blocked SVG handlers to the page, so every run of the suite logs CSP errors. The smoke test counts 18 "expected" errors. This has been open since C1 (PROGRESS C1 open questions).
- **Reproduce:** `npm run smoke` reports "Console errors: 0 unexpected, 18 expected". Or open the Algorithm tab and look at the console.

**M9. No F8 block in the smoke test.**
- **What:** Dictation is covered by `scripts/dictation-tests.cjs` with stand-ins and by the owner's manual check. `npm run smoke` has no step for the Dictate button, the Dictation panel or the microphone permission.
- **Reproduce:** the smoke output lists blocks for E1 to F7 only.

**M10. The knowledge graph opens as an unreadable grid.**
- **What:** In the default view ("All studies", Foundations at the bottom), 217 ideas are drawn at fit zoom with labels of about 3 px. Most relations are self-links (F6 notes: 161 relations give only 54 edges), so most nodes land in the same layer. The owner chose to keep "All studies" as the default; a fit that keeps labels legible, or "By study" for the first view, would help.
- **Reproduce:** Maps → Knowledge graph with the owner's content (14 Study v2 studies).

**M11. Every UI rebuild leaves line-ending-only changes.**
- **What:** `ui/scripts/copy-build.cjs` writes `src/ui.js` and `src/ui.css` with LF, while git checks them out with CRLF. After any rebuild (for example the `npm start` watcher reacting to a merge) both files show as modified with no content change. There is no `.gitattributes` for them.
- **Reproduce:** run `npm run build` in `ui\`, then `git status` shows both files modified, while `git diff --ignore-all-space --stat` is empty. This happened during this review when `ui/src` changed with the F8 merge; I restored the files with `git checkout`.

**M12. `npm audit` warnings in a development dependency.**
- **What:** `npm audit` reports 6 moderate advisories, all in `minimatch` under electron-builder. It is development only and not shipped, and the fix would downgrade electron-builder. `npm audit --omit=dev` at the root and `npm audit` in `ui\` find 0. Known since C4.
- **Reproduce:** `npm audit`.

**M13. A confirmed model grading reaches the scheduler (owner to confirm).**
- **What:** In E2, a typed answer graded by the model's proposal and confirmed unchanged by the learner is recorded as grading `"model"` and is sent to DSR, because `KCycle.eligibility` (`src/study-v2.js:560`) does not read the grading kind. This is by design: before, the learner graded alone, and the proposal is never final without the learner's confirmation. The principle "model-generated material … never updates the scheduler" reads stricter.
- **Reproduce:** Appendix A.2, case "typed answer, model grading proposal confirmed unchanged": `sent: true`, `reviewsDelta: 1`, `grading=model`.
- **Owner:** confirm or change.

## 1. Requirements

Status: **met**, **partly** or **not met**.

### 1.1 Decisions in `03-decisions.md`

| Decision | Status | Evidence |
| --- | --- | --- |
| §1 Route: Kartotek stays its own app, the ideas are rebuilt in Kartotek's code, no LearnHarness code, prompt text or asset copied | **Met under the newer rule** | No LearnHarness program code. Code overlap is 1 % or less (section 5). Prompt texts are adapted and attributed, as `CLAUDE.md:9` and `LEARNING-PROTOCOL.md:5` (owner, 2026-11-16) now allow. The decisions file itself is not updated (M3). |
| §1 Model source: API key, subscription CLI, local model | Met | `desktop/models/anthropic.js`, `openai-compat.js:13` (Ollama preset, native `/api/chat` at `:86`), `cli.js:53` (Claude Code `-p --output-format stream-json`), `cli.js:152`. Real runs recorded in PROGRESS E1. A local model was run in this review (section 3). |
| §1 App: Windows installer | Met | `electron-builder.yml:48-58` (NSIS, per user). `.github/workflows/ci.yml` with `scripts/check-installer.cjs`. Draft release `v0.1.0` (PROGRESS C4). |
| §1 GitHub: public repository | Met, with B1 | `origin` is `github.com/Kardo025/Kartotek-`. B1 is in its history. |
| §1 Euro apply stays separate, opened from Planning | Met | `desktop/euroapply.js:4` (one file, read only). `ui/src/nav.js:28` (`euroapply` in Planning). The browser page shows "Desktop app only". |
| §1 Study menu: Review, Study, Cards, Mock exam, End-of-lesson test; the rest in Planning | Met | `ui/src/nav.js:19-25` (Study items), `:28` (Planning: home, cents, tud, tud-apply, euroapply, stats), `:30-31` (Maps, Career, System, always visible). |
| §1 Career later | Met (placeholder) | `ui/src/tabs/Planned.jsx:13-14`. |
| §2.1 Packaged studies and live teaching side by side, per topic | Met | `ui/src/tabs/study/Cycle.jsx:653-686` ("Study this topic live"). |
| §2.2 Probe required in a live session, optional in Priming | Met | `ui/src/tabs/study/Live.jsx:1` (required probe). Priming shows "Find my level" or "Rate myself instead" (seen in this review). |
| §2.3 The five tabs stay in Study | Met | `nav.js:19-25`. |
| §2.4 Mind maps stay in Study; Stats in Planning; Settings and Algorithm in System | Met (changed by D10) | Mind maps sit in the always-visible "Maps" group (`Shell.jsx:30`, `nav.js:30`), Stats in Planning, System `nav.js:31`. |
| §2.5 Planning home with one combined timeline | Met | `ui/src/plan.js`, `ui/src/tabs/PlanningHome.jsx`. The "What is missing" panel shows when Euro apply cannot be read (seen in this review). |
| §2.6 Career placeholder | Met | as above |
| §3.1 Thinking fields | Met | `ui/src/tabs/study/Thinking.jsx`, `attempt.thinking` in `KCycle.commit` (`src/study-v2.js:504`), `progress.reading_thinking`. |
| §3.2 Confidence 0–100 | Met | `ConfidenceSlider.jsx`, `KEtut.confBand` (`src/etut-core.js:31`). The scheduler reads the band. |
| §3.3 Editable prompts | Met | `desktop/models/prompts.js` (shipped plus user overrides), Settings → Models → Prompts. |
| §3.4 Hint ladder | Met | `KCycle.nextRung` (`src/study-v2.js:995`), `recordModelHint` (`:1054`). Verified in this review with the local model (R0, recorded as `model_hint`, attempt not sent). |
| §3.5 Probe | Met | `src/probe-core.js`, `ui/src/tabs/study/Probe.jsx`. |
| §3.6 Personal plan map | Met | `src/plan-core.js` (`skipBlock` at `:44`), `ui/src/tabs/study/PlanMap.jsx`. |
| §3.7 Step-by-step teaching | Met | `src/live-core.js`, `ui/src/tabs/study/LiveTeach.jsx`. |
| §3.8 Adaptive practice | Met | `src/practice-core.js`, `ui/src/tabs/study/Practice.jsx`. Evaluating stays deferred without a model. |
| §3.9 Bring your own problem | Partly | Paste or file (text, PDF, .pptx, .docx) works. Photos are not read (PROGRESS F5 open question). |
| §3.10 Knowledge graph | Met | `src/graph-core.js`, `ui/src/tabs/KnowledgeGraph.jsx`. See M10 for readability. |
| §3.11 Side questions | Met | `src/side-core.js`, `ui/src/SidePanel.jsx`. Opening the panel counts as help (`useHelp(…,'side')`, `src/study-v2.js:471`). |
| §3.12 Researcher | Met | `desktop/jobs/research.js`, `ui/src/research.jsx`. Hidden without web search or a key (seen in this review). |
| §3.13 Dictation | Met | `ui/src/Dictate.jsx`, `desktop/whisper.js` (`PINS` at `:16`), `desktop/dictation.js`. The microphone is the only permission (`desktop/main.js:515`). |
| §4 Not wanted: model error classification | Met | No miss classification in prompts or cores. `prompts/practice-coach.md:8` records it as left out. The prober treats a miss as "one coordinate, not a verdict" (`prompts/prober.md:58`). |
| §4 Not wanted: demos and generated visuals | Met | No demo builder. No prompt asks for visuals. |
| §5 The package is the source of truth; generated material is labelled and never updates the scheduler | Met (see M13) | Section 4 below. |
| §5 Help is always recorded; a helped attempt is never independent evidence | Met | `assisted()` (`src/study-v2.js:557`), `eligibility()` (`:560`). Section 4 below. |
| §5 Learner data is never lost; every format change has a lossless, tested migration | Met | `KCycle.migrate` (`src/study-v2.js:325`, `cv` 3 at `:346`), `KStore.Store.replaceFromSource` (`src/store.js:585`), generation files and manifest (`desktop/data.js:5`). Section 2 below. |
| §5 With no model, everything that worked still works | Met | Section 3 below. |
| §5 Nothing private enters the public repository | **Not met** | B1, S1. |

### 1.2 Standing rules in `CLAUDE.md`

| Rule | Status | Evidence |
| --- | --- | --- |
| `:7` Learner data never deleted or rewritten in place; lossless migration tested on a copy of a real export | Met | Generation-named files with a manifest (`desktop/data.js`), dated backups before import, restore, migration and delete. The `cv` 3 migration was tested on the real export in F1–F8. In this review: import and restart identical (section 2). |
| `:8` Existing features keep working; the Algorithm suite passes; `audit-study.py` certifies the existing studies | Met (S4 aside) | `npm test`: engine 79/79 and every suite passes. Smoke: Algorithm tab 79/79. `audit-study.py --all` exits 0 with 14 Study v2 studies certified, 0 blockers; `--samples` passes. The browser page has S4. |
| `:9` LearnHarness may be adapted, with the source named in every adapted file | Partly | Every adapted prompt has `adapted_from`. `THIRD-PARTY-NOTICES.md:54-56` and `README.md:91` name LearnHarness. The engine modules that adapt its designs do not (M2). |
| `:10` No secrets, course material, extracts, photos or personal records in commits | **Not met** | No key, token, PDF, photo or content folder in any of the 652 blobs of the history. One personal trace: B1. |
| `:11` One task per session and branch; merges; no push without OK | Met as far as git shows | One branch per task (`task/c4…` to `task/f8…`), merged into `main` in order. Pushes are recorded in PROGRESS with the owner's OK (C4); the OK for the F1/F2 pushes is not visible in the repository. |
| `:12` UI in English; DESIGN.md; new UI in React; engine logic in plain modules with tests | Partly | UI copy is English (two study titles in the owner's content folder are Turkish; that is content, not UI). New screens are React in `ui/src`. Engine logic is in `src/*-core.js` with suites. DESIGN deviations: S3, M7. DESIGN.md itself is stale (M4). |
| `:13` Ask instead of guessing | Met | Each PROGRESS entry lists the open questions and the owner's decisions (for example F3 key checking, F8 D9 change). |
| `:14` A dated PROGRESS entry per session | Met, with wrong dates | Every task has an entry. The F5–F8 dates are wrong (M6). |

## 2. Data safety

**Input.** The copy `kartotek-backup-2026-11-15.json` (785,374 bytes) of the owner's export from `%USERPROFILE%\Downloads`, and the owner's content folder (20 studies, 1 mind map, the exam plan). The original file was not modified.

| Check | Result |
| --- | --- |
| `KARTOTEK_BACKUP=<copy> npm test` (the repository's own comparison) | All 24 rows of the import report match. Cards 225, review events 1, decks 19, studies 19, mind maps and versions 1/1, exam-plan marks 9, exam dates 1, settings 14, model parameters 34; every other row 0. Whole state identical. Restart identical. Queue: old app 21 (`review 1, fresh 20`), desktop 21, identical. |
| Old single-file app against today's engines (reviewer's script, A.1): the **baseline engine** (`7409a51` `src\*.js`, localStorage) against **today's browser engine**, same embedded content tags, same clock (2026-11-17 12:00 CET) and same seeded random numbers | Counts equal after the content import: cards 233, memory records 233, reviews 1, decks 20, studies 20. The queue is identical, all 21 entries in the same order, with the same totals (`dueReview 1, freshAvailable 232, newLimit 20, reviewLimit 200`). |
| **Desktop file store** through the real first-run panel (bridge preview with the real `content.js`, `data.js`, `data-api.js`; new profile; "Import a backup file") | Import report: "every count matches and the saved files hold exactly the backup". Queue computed in the page with the same clock and seed: the same 21 entries in the same order as the baseline engine. After a reload (restart), the state's SHA-256 was the same as before. A dated `daily` backup and the kept import copy were written. |
| Scheduler code | `src\engine.js` is identical to the baseline apart from CRLF/LF (`tr -d '\r' \| sha256sum` gives `cbc64052…` for both). |
| Two writers on one data folder | Refused with "Another Kartotek (process …) is using this data folder. Nothing was changed." (`desktop/data.js:173-191`). Seen when another session's preview held the shared `%APPDATA%\Kartotek-preview` profile. See M1 for where the message shows. |

**Limits.** The owner's backup holds little history (1 review event, no Study v2 attempts, no lesson tests or mocks). Those record types are covered by the synthetic and older-shape tests in `scripts/data-tests.cjs`, not by real data.

## 3. Independence

**Setups.**
- (a) **No model:** the bridge preview on a new profile with the backup copy imported.
- (b) **Local model only:** the same, with one provider: Ollama `gpt-oss:20b` in the strong and fast slots, no vision slot, no API key, no research key. This is a copy of the preview profile's `providers.json`, without keys.
- (c) **Browser page:** `Kartotek-DSR.html`; a model is not possible there.

**How.** All 24 tab ids were opened in (a) and (c), with no React error and no thrown exception. The Study v2 flow was walked on the sample study in (a) and (b). Real local-model calls in (b): one hint (R0) took 175 s, one Explain took 125 s. Other local-model results are from the recorded F3–F7 runs on the same model and PC.

| Screen | (a) No model | (b) Local model only |
| --- | --- | --- |
| Review | Works. "Ask about this card": "No model set up" hint and Claude Code link. | Works. Ask about this card runs (E2, real local run). |
| Study library | Works. New study from my files: "No model is set up yet", plus the "With Claude Code" tab. Live sessions and Practice: "No model is set up …". | New study writes a full certified draft (E3: about 2 h on `gpt-oss:20b`). Scanned pages fail (S5). Live sessions and Practice run (F4, F5). |
| Priming | Works. "Rate myself instead" in place of Find my level. Plan map from the self-rating. | Find my level runs (about 40–70 s per question, F3). |
| Learn & digest | Works. Thinking, Feynman versions, Dictate (Windows voice typing; in the preview the shortcut). "Get feedback" shows "No model set up". Side panel and "Study this topic live" are hidden. | "Study this topic live", "Ask about this" and "Get feedback" appear and run. |
| Applying | Works. Package hints, steps, solution and lesson. Explain: Claude Code link plus "View and edit the request". No "Ask for a hint". | "Ask for a hint" works (R0 given and recorded; the answer was not sent to DSR). Explain works (saved with provider, model and prompt version, $0). "Practice this again" was not re-run here (E2: a 3B model failed the schema twice and stored nothing). |
| Evaluating | Degrades as designed: "deferred". Continuing records it. | Adaptive practice runs (F5). |
| End / final test | Works. | Works. Nothing model-related is offered. |
| Cards, Mock exam, End-of-lesson test | Work. Writing jobs show the Claude Code alternative. | Work. The writing jobs run locally (fake-model tests; the lesson-test and mock jobs were not run on a real model). |
| Maps: Mind maps | Works (Claude Code prompts as before, M5 wording). | Reading and coaching **fail** without a vision-capable model (S5). |
| Maps: Knowledge graph | View works (217 ideas, 161 chains; M10). "Grow the graph": "No model is set up". | Extraction runs (F6). |
| Planning: Home, CEnT-S, TU Delft, Application, Stats | Work (no model needed). Euro apply: "Desktop app only" in the browser page and the preview. | Same. |
| Settings | Works. Models: "add a provider". Research: hidden. | Same. Research is hidden without a web-searching provider or a Brave key, so "Check this" is absent everywhere (as designed). |
| Dictation | Independent of the model layer. Local whisper or Windows voice typing. Not available in the bridge preview (no dictation bridge). | Same. |
| Algorithm | 79/79. | 79/79. |
| Browser page (c) | Every tab renders. Settings says models need the desktop app. Mind-map photo 404 (S4). | n/a |

**Nothing breaks without a model.** With a local model only, everything runs except the vision steps (S5). Expect minutes per call on this PC.

## 4. Scheduler integrity

**Where cards can change.** Only four places write card memory or review events:
- Review (`App.rate`, `src/app.js:314`, `:877`);
- the Study v2 path `KCycle.send` (`src/study-v2.js:583` → `KEtut.recordSignal`, `src/etut-core.js:394`), called only from `ui/src/tabs/study/cycle/lib.js:20` (`sendAttempt`, used by `Item.jsx`);
- the legacy v1 runner (`src/etut-srl.js:51`);
- lesson tests (`src/lesson-core.js:272`).

`src/live-core.js`, `practice-core.js`, `probe-core.js`, `plan-core.js`, `side-core.js` and `graph-core.js` contain no call to any of them. `graph-core` only reads memory for display. `KCycle.send` sends only what `eligibility()` (`src/study-v2.js:560`) allows: committed, verified, not a follow-up, not disputed, not assisted (any help log entry except `statement_repair`), not a repeat, graded, with confidence.

**The reviewer's test (A.2, part 1).** It runs on the copy of the owner's backup with the owner's content. Each case starts a fresh window, makes one attempt through the real `KCycle.startAttempt` → `commit` → `send`, counts `DSR.processReview` calls, and compares card memory, cards and the review log before and after.

| Case | Sent to DSR | Review events added | Card changed | Result |
| --- | --- | --- | --- | --- |
| Control: unassisted, verified, confident, right answer | yes | 1 | yes | PASS (the test sees a change) |
| Control: only a statement repair ("I don't understand what is asked"; not help by rule) | yes | 1 | yes | PASS |
| Package hint | no ("Assisted (1 hint)") | 0 | no | PASS |
| Package step | no | 0 | no | PASS |
| Solution shown | no | 0 | no | PASS |
| Lesson pane opened | no | 0 | no | PASS |
| Side-question panel opened (F7) | no ("side questions open") | 0 | no | PASS |
| Model hint R0 (F2) | no ("model hint R0") | 0 | no | PASS |
| Model hint, then reported | no | 0 | no | PASS |
| Reported problem without help | no | 0 | no | PASS |
| Generated item in the model-written study `dsd-lecture1-local` (validation `disputed`) | no ("The question is not verified") | 0 | no | PASS |
| Generated follow-up item ("Practice this again", unverified) | no ("A follow-up after an explanation") | 0 | no | PASS |
| Typed answer, model grading confirmed unchanged (E2) | yes, grading `model` | 1 | yes | by design, see M13 |

**Whole sessions (A.2, part 2).** `DSR.processReview` was instrumented in every engine window that the repository's suites create, while they ran their full sessions through the model service with fake providers:

| Suite | What it runs | `processReview` calls |
| --- | --- | --- |
| `scripts/probe-tests.cjs` | probe, planner, plan map, skipping | 0 |
| `scripts/live-tests.cjs` | 10-step live session, refusals, restart in every phase, own files | 0 |
| `scripts/practice-tests.cjs` | Evaluating run, free practice, own problem, retests | 0 |
| `scripts/side-tests.cjs` | side questions, researcher | 0 |
| `scripts/graph-tests.cjs` | seeding, extraction and review, practice and probe entry points | 1: the suite's own deliberate unassisted answer (`scripts/graph-tests.cjs:95-96`) that shows evidence and memory on a node |

In the UI (setup b), a free recall answered after a model hint R0 and rated "Good" stayed `dsr: { status: "not_sent", reason: "Assisted (model hint R0)" }`. The review log and memory were unchanged. The repository's own checks agree: the E2–F7 blocks of `npm run smoke` report no review event and no change to what the scheduler reads.

## 5. Publishing

| Check | Result |
| --- | --- |
| `npm run hygiene` (current tree, 279 files) | Passes. It failed on purpose while my temporary edit to `.claude/launch.json` held a user path, which shows the check works on the tree. |
| History, every blob reachable from any ref (1021 objects, 652 blobs, 59 commits, including `origin/*`), scanned for the terms of `hygiene.local.txt`, the Windows user name and the owner's e-mail name (A.3) | **One hit: B1.** No hit in commit messages. |
| Key-like strings in the history (`sk-ant-…`, `sk-…`, `AIza…`, `ghp_…`, `xox?-`, `BSA…` (Brave), private keys, `AKIA…`, `hf_…`) | None. The only matches are the fake `sk-ant-smoke-NOT-A-REAL-KEY-123` in `scripts/smoke.cjs:240` and base64 font data in `src/ui.css` that happens to contain "BSA…". |
| Files in the history | No PDF, photo, `.docx`, `.pptx`, archive or content folder in any commit. The only image is `build/icon.png`. |
| Commit author | Always `Eren <noreply@kartotek.invalid>` (the placeholder e-mail chosen in A3/C4; the first name is the owner's choice). |
| LearnHarness resemblance (A.4: word 8-gram overlap of every tracked text file against the whole LearnHarness 0.6.0 tree from the owner's zip) | The adapted prompts resemble their sources, and all name them in `adapted_from`. Shared 8-grams: `prompts/shared/voice.md` 36 % (longest shared run 22 words), `shared/confidence.md` 24 % (25 words), `shared/thinking.md` 18 %, `side-answerer.md` 15 % (23 words), `graph-extractor.md` 9 %, `planner.md` 7 %, `hint-giver.md` 6 % (24 words), `prober.md` 5 %, `practice-coach.md` 4 %, `teacher.md` 3 % (23 words), `shared/accuracy.md` 4 %, `researcher.md` 1 %. Every other file is 2.6 % or less, which is generic phrases (CSS, test fixtures). No program code resembles LearnHarness. The 25 prompt files without `adapted_from` show no resemblance. Under AGPL-3.0-only with attribution this is allowed; see M2 and M3 for the records. |
| `npm audit` | `--omit=dev` 0, `ui` 0, dev-only 6 moderate (M12). |

## 6. Quality

| Check | Result |
| --- | --- |
| `npm test` with the backup copy | Exit 0, every suite passed: engine 79/79, desktop helpers 6/6, content 9/9, reload scenario, data store 11/11, data import and window 8/8, navigation 14/14, model layer 5+12+3+4+6, study model 5+9+3, probe 7+10+4+4+3, live 3+3+2+2, practice 5+2+5, graph 4+4+2, side 5+6, dictation 6+6+2, Euro apply 16/16, writing jobs 15/15. |
| `npm run smoke` (real Electron 45.3.2 window) | Passes. 41 sidebar entries, Algorithm tab 79/79. Blocks for models, E2, F1, F3, F4, F5, F6 and F7 pass. Console errors: 0 unexpected, 18 expected (M8). |
| `audit-study.py --all` / `--samples` | Exit 0. All 14 Study v2 studies are certified, with 0 blockers (`dsd-lecture1-local` has 25 warnings). |
| Console errors while walking every screen | Bridge preview: none from the app, apart from one `ERR_UNKNOWN_URL_SCHEME`. That one is a `kcontent://` photo URL, which only the Electron window serves, so it happens in the preview only. Browser page: the mind-map photo 404 (S4). |
| Dead code from the old Claude Code links | The `claude://` links are kept on purpose as the no-model fallback (E1, E2: shown only while no model is set up). They are used, not dead. `KCycle.followupPrompt`, `newStudyPrompt` and `explainRequest` each have one live caller. Stale wording remains (M5, M4). No `status: draft` prompts remain. |
| DESIGN.md | New screens use the `--k-*` tokens. Raw colours outside the token files appear only in S3 and a few older stylesheets (`cents.css` 5, `mindmap.css` 3). Deviations: S3 (contrast), M7 (em-dashes), M10 (graph legibility). |

## Appendix A: the reviewer's scripts

They are not part of the app and were run from a scratch folder outside the repository, with the repository's own `node_modules`. The backup path is always a copy. A.1 and A.2 need `Kartotek-DSR.html` built from the content folder (`build.ps1 -SkipPdf`). A.1 needs the baseline `src\` extracted from the private history bundle:

```bash
git clone --no-checkout "<content folder>\backups\kartotek-private-history-2026-11-15.bundle" oldhist
```
```bash
git -C oldhist archive 7409a51 src | tar -x -C baseline
```

Run lines used:

```bash
node compare-old.cjs <repo> <baseline>/src <backup copy> 1794913200000
```
```bash
node sched-integrity.cjs <repo> <backup copy>
```
```bash
node history-scan.cjs <repo> [extra,terms]
```
```bash
python -I lh-compare.py <repo> <learnharness-main folder>
```

Part 1 of `sched-integrity.cjs` takes about 10 minutes, because each case loads a fresh window with the owner's content.

### A.1 compare-old.cjs (old app against today's engine)

```js
'use strict';
// G1 review: compare the old single-file app (baseline commit 7409a51, engine scripts) with today's engine in browser mode,
// both on a COPY of the owner's backup in localStorage and the same embedded content tags (from today's Kartotek-DSR.html).
// Usage: node compare-old.cjs <repo> <baseline src dir> <backup copy> <now ms>
const fs = require('fs');
const path = require('path');
const repo = process.argv[2];
const { JSDOM } = require(path.join(repo, 'node_modules', 'jsdom'));
const baseSrc = process.argv[3];
const backupFile = process.argv[4];
const NOW = Number(process.argv[5]);
const backupText = fs.readFileSync(backupFile, 'utf8');

const page = fs.readFileSync(path.join(repo, 'Kartotek-DSR.html'), 'utf8');
const tags = [];
for (const m of page.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)) tags.push(m[0]);

function scriptsOf(dir) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]).filter((n) => n !== 'ui.js');
}
function seededRng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }

async function makeWindow(dir, label) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div>' + tags.join('\n') + '</body></html>', { url: 'http://localhost:8765/Kartotek-DSR.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.localStorage.setItem('kartotek-dsr-v1', backupText);
  w.KARTOTEK_DEFER_BOOT = true;
  w.Date.now = () => NOW; // same clock in both windows
  for (const n of scriptsOf(dir)) w.eval(fs.readFileSync(path.join(dir, n), 'utf8') + '\n//# sourceURL=' + label + '/' + n);
  if (w.KHost && w.KHost.ready) await w.KHost.ready();
  w.App.store.init();
  if (w.App.importContent) w.App.importContent();
  else ['importBundledEtuts', 'importBundledLessons', 'importBundledMocks', 'importBundledMindmaps'].forEach((f) => w.App[f] && w.App[f]());
  return w;
}
function summary(w) {
  const S = w.App.S;
  const env = w.App.env(NOW, { rng: seededRng(7) });
  const q = w.DSR.buildQueue(S, env, w.App.queueOpts());
  return {
    counts: { cards: Object.keys(S.cards || {}).length, mem: Object.keys(S.mem || {}).length, reviews: (S.reviews || []).length, decks: Object.keys(S.decks || {}).length, studies: Object.keys(S.etuts || {}).length },
    queue: { n: q.order.length, counts: q.counts, totals: q.totals, order: q.order.map((x) => x.card_id + ':' + x.kind) },
  };
}
(async () => {
  const oldW = await makeWindow(baseSrc, 'baseline');
  const newW = await makeWindow(path.join(repo, 'src'), 'current');
  const a = summary(oldW), b = summary(newW);
  const out = { now: new Date(NOW).toISOString(), old: a, current: b,
    countsEqual: JSON.stringify(a.counts) === JSON.stringify(b.counts),
    queueEqual: JSON.stringify(a.queue) === JSON.stringify(b.queue) };
  console.log(JSON.stringify({ now: out.now, old: { counts: a.counts, n: a.queue.n, qc: a.queue.counts }, current: { counts: b.counts, n: b.queue.n, qc: b.queue.counts }, countsEqual: out.countsEqual, queueEqual: out.queueEqual, orderOld: a.queue.order.slice(0, 5), orderNew: b.queue.order.slice(0, 5) }, null, 1));
  fs.writeFileSync(path.join(__dirname, 'compare-old.out.json'), JSON.stringify(out, null, 1));
  oldW.close(); newW.close();
})().catch((e) => { console.error('ERROR', e && e.stack || e); process.exit(1); });
```

### A.2 sched-integrity.cjs (scheduler integrity)

```js
'use strict';
// G1 review: scheduler integrity. Written by the reviewer, not part of the repository.
// Part 1: on a COPY of the owner's backup with the owner's content (today's Kartotek-DSR.html tags), one Study v2 attempt per case
//         goes through the real KCycle.commit + KCycle.send; card memory, cards and the review log are compared before and after.
//         A positive control (unassisted, verified, confident) must create exactly one review event, so the check can see a change.
// Part 2: every DSR.processReview call is counted (with its caller) while the repository's own probe, live-teaching, practice,
//         knowledge-graph and side-question suites run whole sessions through the model service with fake providers.
// Usage: node sched-integrity.cjs <repo> <backup copy>
const fs = require('fs');
const path = require('path');
const repo = process.argv[2];
const backupFile = process.argv[3];
const { JSDOM } = require(path.join(repo, 'node_modules', 'jsdom'));
const src = path.join(repo, 'src');
const backupText = fs.readFileSync(backupFile, 'utf8');
const page = fs.readFileSync(path.join(repo, 'Kartotek-DSR.html'), 'utf8');
const tags = [...page.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)].map((m) => m[0]);
const NOW = new Date('2026-11-17T12:00:00+01:00').getTime();
const canon = (x) => JSON.stringify(x, Object.keys(x || {}).sort());

async function win() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div>' + tags.join('\n') + '</body></html>', { url: 'http://localhost:8765/', runScripts: 'outside-only' });
  const w = dom.window;
  w.localStorage.setItem('kartotek-dsr-v1', backupText);
  w.KARTOTEK_DEFER_BOOT = true;
  const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) if (m[1] !== 'ui.js') w.eval(fs.readFileSync(path.join(src, m[1]), 'utf8') + '\n//# sourceURL=src/' + m[1]);
  await w.KHost.ready();
  w.App.store.init();
  w.App.importContent();
  let calls = 0; const orig = w.DSR.processReview;
  w.DSR.processReview = function () { calls++; return orig.apply(this, arguments); };
  w.__calls = () => calls;
  return w;
}
function snap(S) { return { mem: JSON.stringify(S.mem), cards: JSON.stringify(S.cards), reviews: S.reviews.length, rev: JSON.stringify(S.reviews) }; }

function pickItem(K, et, pred) {
  const idx = K.itemIndex(et.package, K.withFollowups(et, null));
  return Object.values(idx).find(pred);
}

async function case1(label, studyId, itemPred, prepare, expectSent) {
  const w = await win();
  const S = w.App.S, K = w.KCycle;
  const et = S.etuts[studyId];
  if (!et || !et.package) return { label, error: 'study ' + studyId + ' not attached' };
  let item = pickItem(K, et, itemPred);
  if (!item) return { label, error: 'no item' };
  const ctx = { w, S, K, et, item };
  if (prepare.before) { const r = prepare.before(ctx); if (r && r.item) item = ctx.item = r.item; }
  const mode = prepare.mode || 'practice';
  const a = K.startAttempt(et, item, mode, NOW - 20000, { rng: () => 0.42 });
  ctx.a = a;
  let note = '';
  if (prepare.help) note = String(prepare.help(ctx) || '');
  const correct = Array.isArray(item.key) ? item.key : (item.key && item.key.choice) || [];
  const resp = item.format === 'recall' ? { text: 'from memory' } : item.format === 'typed' ? { text: 'a written answer' } : item.format === 'numeric' ? { number: item.key && item.key.number } : { choice: Array.isArray(correct) ? correct : [correct] };
  const before = snap(S), callsBefore = w.__calls();
  K.commit(et, a, resp, item, NOW);
  a.confidence = 'sure'; a.confidence_pct = 90;
  if (item.format === 'recall') K.setRecall(a, 'good', []);
  if (prepare.after) note += String(prepare.after(ctx) || '');
  const el = K.send(S, et, a, item, w.App.env(NOW));
  const after = snap(S);
  const changed = before.mem !== after.mem || before.cards !== after.cards || before.rev !== after.rev;
  const res = { label, study: studyId, item: item.q_id, format: item.format, validation: item.validation || 'unverified', mode, result: a.result && a.result.correct, sent: !!el.eligible, reason: el.reason || (a.dsr && a.dsr.reason) || '', reviewsDelta: after.reviews - before.reviews, processReviewCalls: w.__calls() - callsBefore, cardChanged: changed, note };
  res.pass = expectSent ? (res.sent && res.reviewsDelta === 1 && changed) : (!res.sent && res.reviewsDelta === 0 && !changed && res.processReviewCalls === 0);
  w.close();
  return res;
}

const verifiedMcq = (it) => it.format === 'mcq_single' && it.validation === 'verified' && it.use !== 'final' && !it.followup_of;
const verifiedTyped = (it) => it.format === 'typed' && it.validation === 'verified' && it.use !== 'final' && it.rubric && (it.rubric.criteria || []).length;
const notVerified = (it) => (it.validation || 'unverified') !== 'verified' && it.format === 'mcq_single' && it.use !== 'final';

async function part1() {
  const out = [];
  if (process.env.G1_ONLY === 'typed') {
    for (const sid of ['dsd-1','linalg-1','math1-ch1','precalc-5','tlc-1','iips-3','syseng-intro','traffic-siri','sample-cycle-v2']) {
      const r = await case1('typed answer, model grading proposal confirmed unchanged (E2, reaches DSR by design) [' + sid + ']', sid, verifiedTyped, {
        after: ({ K, a, item }) => { const rows = item.rubric.criteria.map((c) => ({ id: c.id, mark: 'met', quote: 'a written answer', reason: 'x' })); const marks = {}; rows.forEach((r) => { marks[r.id] = 'met'; }); K.confirmModelGrading(a, item, { rows, summary: '' }, marks, { now: NOW }); return 'grading=' + a.grading; } }, true);
      out.push(r); if (!r.error) break;
    }
    out.push(await case1('CONTROL with the right answer: unassisted, verified, confident', 'dsd-1', verifiedMcq, {}, true));
    return out;
  }
  out.push(await case1('CONTROL: unassisted, verified, confident, right (must reach DSR)', 'dsd-1', verifiedMcq, {}, true));
  out.push(await case1('CONTROL: statement repair only (not help by rule, must reach DSR)', 'dsd-1', verifiedMcq, { help: ({ K, a, item }) => JSON.stringify(K.recordModelHint(a, item, { rung: 'statement_repair', hint: 'The question asks which option is true.', reveals: '' }, { requested: 'statement_repair', now: NOW }).ok) }, true));
  out.push(await case1('package hint used', 'dsd-1', verifiedMcq, { help: ({ K, a }) => K.useHelp(a, 'hint') }, false));
  out.push(await case1('package step used', 'dsd-1', verifiedMcq, { help: ({ K, a }) => K.useHelp(a, 'step') }, false));
  out.push(await case1('solution shown', 'dsd-1', verifiedMcq, { help: ({ K, a }) => K.useHelp(a, 'solution') }, false));
  out.push(await case1('lesson pane opened', 'dsd-1', verifiedMcq, { help: ({ K, a }) => K.useHelp(a, 'pane') }, false));
  out.push(await case1('side-question panel opened (F7)', 'dsd-1', verifiedMcq, { help: ({ K, a }) => K.useHelp(a, 'side') }, false));
  out.push(await case1('model hint R0 (F2)', 'dsd-1', verifiedMcq, { help: ({ K, a, item }) => JSON.stringify(K.recordModelHint(a, item, { rung: 'R0', hint: 'Read the question once more and look at what it asks for.', stuck_at: 'start', reveals: 'nothing' }, { requested: 'R0', now: NOW }).ok) }, false));
  out.push(await case1('model hint R0 recorded, then the attempt is reported (disputed)', 'dsd-1', verifiedMcq, { help: ({ K, a, item }) => K.recordModelHint(a, item, { rung: 'R0', hint: 'Look again at the question.', reveals: '' }, { requested: 'R0', now: NOW }).ok, after: ({ K, a }) => K.dispute(a, 'test') }, false));
  out.push(await case1('reported problem (disputed) without help', 'dsd-1', verifiedMcq, { after: ({ K, a }) => K.dispute(a, 'test') }, false));
  out.push(await case1('generated item: not verified in a model-written study (E3 draft)', 'dsd-lecture1-local', notVerified, {}, false));
  out.push(await case1('generated follow-up item ("Practice this again", E2)', 'dsd-1', verifiedMcq, {
    before: ({ K, et, item }) => {
      const fu = JSON.parse(JSON.stringify(item));
      fu.q_id = 'g1-fu-1'; fu.followup_of = item.q_id; fu.validation = 'unverified'; fu.origin = 'generated';
      K.storeFollowups(et, { id: 'x' }, [fu]);
      const idx = K.itemIndex(et.package, K.withFollowups(et, null));
      return { item: idx['g1-fu-1'] || fu };
    } }, false));
  out.push(await case1('typed answer, model grading proposal confirmed unchanged (E2, by design reaches DSR)', 'math1-ch1', verifiedTyped, {
    after: ({ K, a, item }) => { const rows = item.rubric.criteria.map((c) => ({ id: c.id, mark: 'met', quote: 'a written answer', reason: 'x' })); const marks = {}; rows.forEach((r) => { marks[r.id] = 'met'; }); K.confirmModelGrading(a, item, { rows, summary: '' }, marks, { now: NOW }); return 'grading=' + a.grading; } }, true));
  return out;
}

async function part2() {
  const smt = require(path.join(repo, 'scripts', 'study-model-tests.cjs'));
  const origLoad = smt.loadEngine;
  const log = [];
  let suite = '';
  smt.loadEngine = function (overrides) {
    const w = origLoad(overrides);
    const orig = w.DSR.processReview;
    w.DSR.processReview = function () {
      const st = new Error().stack.split('\n').filter((l) => /src\/[a-z-]+\.js/.test(l)).map((l) => (l.match(/src\/[a-z0-9-]+\.js:\d+/) || [''])[0]).filter(Boolean);
      log.push({ suite, callers: st.slice(0, 4).join(' < ') });
      return orig.apply(this, arguments);
    };
    return w;
  };
  const out = {};
  for (const name of ['probe-tests', 'live-tests', 'practice-tests', 'graph-tests', 'side-tests']) {
    suite = name;
    const before = log.length;
    let lines;
    try { lines = await require(path.join(repo, 'scripts', name + '.cjs')).run(); } catch (e) { lines = ['FAILED ' + (e && e.message)]; }
    const mine = log.slice(before);
    const byCaller = {};
    mine.forEach((c) => { byCaller[c.callers] = (byCaller[c.callers] || 0) + 1; });
    out[name] = { suiteResult: lines.filter((l) => /passed|FAIL/i.test(l)), processReviewCalls: mine.length, byCaller };
  }
  return out;
}

(async () => {
  const p1 = await part1();
  console.log('PART 1 (owner backup copy + owner content):');
  p1.forEach((r) => console.log((r.pass ? 'PASS ' : 'FAIL ') + JSON.stringify(r)));
  if (process.env.G1_ONLY) return;
  const p2 = await part2();
  console.log('PART 2 (DSR.processReview calls during the repository suites):');
  console.log(JSON.stringify(p2, null, 1));
  console.log('backup copy unchanged on disk: ' + (fs.readFileSync(backupFile, 'utf8') === backupText));
})().catch((e) => { console.error('ERROR', e && e.stack || e); process.exit(1); });
```

### A.3 history-scan.cjs (personal terms and keys in the whole history)

```js
'use strict';
// G1: scan every blob reachable from any ref for personal terms (hygiene.local.txt + the Windows user name + the git e-mail's
// local part) and key-like strings. Prints only the term's index, never the term itself.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const repo = process.argv[2];
const git = (args, opts) => execFileSync('git', args, Object.assign({ cwd: repo, maxBuffer: 1 << 30 }, opts || {}));
const terms = [];
try { fs.readFileSync(path.join(repo, 'hygiene.local.txt'), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')).forEach((s) => terms.push(s)); } catch (e) { /* none */ }
const user = process.env.USERNAME; if (user) terms.push(user);
const extra = (process.argv[3] || '').split(',').filter(Boolean); extra.forEach((s) => terms.push(s));
const lower = terms.map((t) => t.toLowerCase());
const keyRe = /sk-ant-(?!smoke-NOT-A-REAL-KEY)[A-Za-z0-9_-]{16,}|sk-(?:proj-)?[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|xox[bpas]-[A-Za-z0-9-]{10,}|BSA[A-Za-z0-9_-]{25,}|-----BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|hf_[A-Za-z0-9]{30,}/;
const objs = git(['rev-list', '--objects', '--all']).toString().split('\n').filter(Boolean).map((l) => { const i = l.indexOf(' '); return i < 0 ? { id: l, p: '' } : { id: l.slice(0, i), p: l.slice(i + 1) }; });
let blobs = 0; const hits = [];
for (const o of objs) {
  const type = git(['cat-file', '-t', o.id]).toString().trim();
  if (type !== 'blob') continue;
  blobs++;
  const buf = git(['cat-file', '-p', o.id]);
  const s = buf.toString('utf8'); const sl = s.toLowerCase();
  lower.forEach((t, i) => { if (t.length >= 3 && sl.includes(t)) { const at = sl.indexOf(t); hits.push({ path: o.p, blob: o.id.slice(0, 8), kind: 'term#' + i, line: s.slice(0, at).split('\n').length }); } });
  const m = keyRe.exec(s); if (m) hits.push({ path: o.p, blob: o.id.slice(0, 8), kind: 'key-like', line: s.slice(0, m.index).split('\n').length, sample: m[0].slice(0, 6) + '…' });
  // also the commit messages are checked below
}
const msgs = git(['log', '--all', '--format=%H%x00%an%x00%ae%x00%B%x01']).toString().split('\x01');
msgs.forEach((m) => { const ml = m.toLowerCase(); lower.forEach((t, i) => { if (t.length >= 3 && ml.includes(t)) hits.push({ commitMsg: m.slice(0, 7), kind: 'term#' + i }); }); });
console.log(JSON.stringify({ terms: terms.length, objects: objs.length, blobs, hits }, null, 1));
```

### A.4 lh-compare.py (resemblance to LearnHarness)

```python
# G1 review: how closely does each Kartotek file follow LearnHarness text? Word 8-gram overlap (shingles), both directions.
# Usage: python -I lh-compare.py <kartotek repo> <learnharness root>
import os, re, sys, json
repo, lh = sys.argv[1], sys.argv[2]
N = 8
def words(t):
    t = re.sub(r'^---[\s\S]*?\n---', '', t, count=1)  # front matter
    return re.findall(r"[a-z0-9']+", t.lower())
def shingles(ws):
    return set(' '.join(ws[i:i+N]) for i in range(max(0, len(ws)-N+1)))
def read(p):
    try:
        with open(p, encoding='utf-8', errors='replace') as f: return f.read()
    except Exception: return ''
# LearnHarness corpus: every prompt / doc / source text file
lh_files = []
for d, _, fs in os.walk(lh):
    if 'node_modules' in d or '.git' in d: continue
    for f in fs:
        if f.endswith(('.md', '.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.txt', '.css')):
            lh_files.append(os.path.join(d, f))
lh_sh = {}
for p in lh_files:
    s = shingles(words(read(p)))
    if s: lh_sh[p] = s
all_lh = set().union(*lh_sh.values()) if lh_sh else set()
# Kartotek tracked files
import subprocess
tracked = subprocess.check_output(['git', 'ls-files'], cwd=repo).decode().split('\n')
rows = []
for rel in tracked:
    if not rel or not rel.endswith(('.md', '.js', '.cjs', '.jsx', '.json', '.css', '.ps1', '.py', '.yml')): continue
    if rel in ('src/ui.js', 'src/ui.css', 'package-lock.json', 'ui/package-lock.json', 'THIRD-PARTY-NOTICES.md', 'LICENSE'): continue
    text = read(os.path.join(repo, rel))
    ws = words(text); s = shingles(ws)
    if len(s) < 20: continue
    common = s & all_lh
    if not common: continue
    best, bestp = 0, ''
    for p, ls in lh_sh.items():
        c = len(s & ls)
        if c > best: best, bestp = c, p
    adapted = re.search(r'adapted_from\s*:', text) is not None or 'LearnHarness' in text
    rows.append({'file': rel, 'shingles': len(s), 'shared': len(common), 'share': round(len(common)/len(s), 3), 'best_lh': os.path.relpath(bestp, lh).replace('\\','/'), 'best_shared': best, 'names_source': adapted})
rows.sort(key=lambda r: -r['share'])
print(json.dumps(rows[:40], indent=0))
# longest common run of words for the top files (to see whether whole sentences are copied)
def longest_run(a, b):
    bset = {}
    for i in range(len(b)-N+1): bset.setdefault(' '.join(b[i:i+N]), []).append(i)
    best = 0; where = ''
    i = 0
    while i < len(a)-N+1:
        k = ' '.join(a[i:i+N])
        if k in bset:
            for j in bset[k]:
                L = N
                while i+L < len(a) and j+L < len(b) and a[i+L] == b[j+L]: L += 1
                if L > best: best, where = L, ' '.join(a[i:i+min(L, 25)])
        i += 1
    return best, where
print('--- longest shared word runs')
for r in rows[:12]:
    a = words(read(os.path.join(repo, r['file']))); b = words(read(os.path.join(lh, r['best_lh'])))
    L, w = longest_run(a, b)
    print(json.dumps({'file': r['file'], 'vs': r['best_lh'], 'longest_run_words': L, 'starts': w[:160]}))
```
