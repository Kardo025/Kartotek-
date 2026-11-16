# Kartotek

Kartotek is a spaced-repetition and study app that runs as one self-contained web page, with no server and no account.

- **Review**: flash cards scheduled by a D-S-R memory model (difficulty, stability, retrievability) that aims for a chosen retention.
- **Study**: structured studies written from your own sources, run as topic cycles (Priming, Learn & digest, Applying, Evaluating), with a delayed final test and an outcome report. Only first, unassisted attempts on verified items reach the scheduler.
- **End-of-lesson tests, mock exams, mind maps** (checked retrieval from a map you drew), exam-preparation sections, statistics and a page that shows the algorithm and runs its self-tests.

Your learner data (cards, review log, study progress) stays on your computer: in the desktop app as files in `%APPDATA%\Kartotek`, with a dated backup every day; in the browser page in the browser's storage. Use **Settings, Data, Export backup** to save it to a file; either version can import that file.

## Download and first run (Windows)

1. Open the **Releases** page of this repository and download `Kartotek-Setup-<version>.exe` (Windows 10 or 11, 64-bit). `SHA256SUMS.txt` is next to it: `certutil -hashfile Kartotek-Setup-<version>.exe SHA256` prints the checksum to compare.
2. Run it. It installs for your user only (`%LOCALAPPDATA%\Programs\Kartotek`) and needs no administrator rights.
3. Start **Kartotek**. On the very first start it asks what to do with your data: **import a backup file** (the `kartotek-backup-….json` from Settings, Data, Export backup in the browser version, which is also the way to move data from claude.ai), move the data the window already holds, or **start empty**. Imports are checked against the file and a dated backup is kept.
4. Your content (studies, lesson tests, mock exams, mind maps) is read from a folder called `Kartotek Content` in your Documents, or from the folder you choose in **Settings, Content**; press **Reload content** after you add or change a package. Without a folder you see two built-in sample studies.

Your learner data is in `%APPDATA%\Kartotek`. Installing a new version, or uninstalling, never touches it.

**The installer is not signed.** Windows will show a **SmartScreen** warning ("Windows protected your PC"): choose **More info**, then **Run anyway**. On Windows 11 with **Smart App Control** turned on, Windows may refuse to run the installer or the app at all, and there is no way to allow a single file; until the app is signed it cannot be installed on such a PC unless you turn Smart App Control off (Windows Security, App & browser control; this can only be undone by resetting Windows). The browser build below does not have this limit. Code signing is planned before version 1.0. There is no automatic updater yet: to update, run the newer installer.

How a release is made: `docs/RELEASING.md`.

## Run it from source

You need Windows, [Node.js](https://nodejs.org/) and PowerShell. Python 3 is optional (a local web server and the study audit tool).

```
cd ui
npm ci
npm run build                 # builds the interface and copies ui.js and ui.css into src\
cd ..
powershell -ExecutionPolicy Bypass -File build.ps1 -SkipPdf
```

This writes `Kartotek-DSR.html`. Open it in a browser (Edge or Chrome). With a local server instead: `python -m http.server 8765`, then open `http://localhost:8765/Kartotek-DSR.html`. Browser storage is per address, so always open the app the same way.

### Desktop window (in development)

```
npm ci                        # root: Electron and the test tools; also installs ui\
npm start                     # builds the UI, opens the app in a desktop window, reloads it when you edit ui\src
npm test                      # engine self-tests (headless) and the desktop helper tests
```

The window runs the same engine and UI as the browser page. It reads your content folder (see below) when it starts and when you press **Reload content** in Settings, so a new or changed study appears without a build; packages that fail their checks are listed under **Content problems**. Your cards and progress are saved as files in the app's data folder (development runs: `%APPDATA%\Kartotek-dev`), with no size limit and a dated backup every day and before every import or restore. The first start asks how to begin: import a backup file exported from the browser version (also from claude.ai: open the page there, **Settings, Data, Export backup**), or start empty. An import shows a report of every kind of record, before and after, and is kept only if everything matches. **Settings, Data, Backups** restores any dated backup. On Windows 11 with Smart App Control turned on, the unsigned Electron binary may be blocked from starting.

### Samples and checks

A fresh clone builds with the **synthetic samples** in `samples\`: one Study v2 study and one legacy study. To check that everything works, open the **Algorithm** tab: the engine self-tests run there and should all pass. `python tools\audit-study.py --samples` audits the sample studies.

## Where your own content lives

The repository holds the app and the samples, not your material. Your studies, lesson tests, mock exams, mind maps and notes live in a **content folder** outside the repository:

```
Kartotek Content\
  studies\      one folder per study, with etut.json
  lessons\      end-of-lesson tests (lesson.json)
  mocks\        mock exams (mock.json)
  mindmaps\     one folder per map, with the photos
  exam\         tud-apply.json, the plan shown in TU Delft AE Prep, Application (optional)
  sources\      page extracts that studies are written from
  notes\        printed note sheets
```

Tell Kartotek where it is, in one of three ways (first match wins):

1. `powershell -File build.ps1 -Content "C:\path\to\Kartotek Content"`
2. the environment variable `KARTOTEK_CONTENT`
3. a file `kartotek.config.json` in the repository root (copy `kartotek.config.example.json`; the file is git-ignored)

The Python tools read the same setting. The build embeds everything it finds there, so rebuild and reload after adding content. The paths in the rule files (`studies\<id>`, `pdf-extracts`) are relative to the content folder. Some rule files cite notes under `research\`; that folder is the maintainer's private working material and is not part of this repository.

## Writing content with Claude Code

Studies, tests, mock exams and mind-map readings are written by Claude Code from your files, following the rule files in this repository (`STUDY-RULES.md`, `PRIMING-RULES.md`, `LESSON-TEST-RULES.md`, `MOCK-RULES.md`, `MINDMAP-RULES.md`). The app builds a prompt for you and opens `claude://` links in your content folder.

## Models (desktop app)

**Settings, Models** connects Kartotek to a model: an API key (Anthropic, OpenAI, Google Gemini, OpenRouter), your existing Claude Code or Codex subscription through the command-line client installed on your PC, or a local model such as Ollama. Each provider has a **Test connection** button that makes one small call and shows the reply, the time and the cost. Three task slots (strong, fast, vision) choose which model does what; **Usage and budget** shows calls, tokens and estimated cost per day, feature and model, with a monthly budget warning. Keys are encrypted with Windows' protection for your account and never appear in your data, backups or exports. Without a model everything works as before. Calls go only to the provider you set up; with no provider, the app sends nothing anywhere.

## Writing studies in the app (desktop app)

**Study, New study from my files, Write in the app**: choose your slides, notes or book pages (PDF, .pptx, .docx or text) and the model that writes. Kartotek reads the files on your PC and shows how many calls and tokens the study will take, and what it costs, before anything is sent. It then writes the study step by step in the background (source units, outcomes and criteria, a lesson per topic, practice items, a final test, an audit) and repairs what its own checks find. A separate call then solves every question again without its answer key; only the questions that match are marked verified. The study is saved as a draft in your content folder and stays **Not certified** until the audit reports no blockers; it records which provider and model wrote it. You can pause a job, and it resumes after a restart. The same works for end-of-lesson tests, mock exams, the exam Overview's "write next studies", and mind-map reading and coaching (with a vision model). Claude Code remains available as one of the routes.

## Licences

- Code: GNU Affero General Public License v3.0 only (AGPL-3.0-only), see `LICENSE`. Kartotek adapts ideas and prompt texts from LearnHarness by Amos Blomqvist (AGPL-3.0-only); every adapted file names its source. If you run a changed copy as a network service, the AGPL asks you to offer its source to its users.
- Documentation and samples: CC BY 4.0, see `LICENSE-CONTENT.md`.
- Third-party software and the Inter font inside the built files: see `THIRD-PARTY-NOTICES.md`.

Course material, book extracts and personal records are not part of the repository and must not be committed (see `.gitignore` and `CLAUDE.md`).
