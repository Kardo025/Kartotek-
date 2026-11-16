# Kartotek architecture: the desktop app (task B1, 2026-11-15)

Status: **decided** (2026-11-15: the owner accepted all 16 recommendations in section 12 as written). B1 changed no code; implementation follows the migration order in section 10, starting with C1.

Target: a Windows desktop app with an installer, public on GitHub, that works without Claude Code. Content is loaded at run time from a content folder, learner data lives in files, and a model layer can use an API key, an existing subscription through a locally installed command-line client, or a local model.

Inputs: `CLAUDE.md`, `docs\PROGRESS.md` (A1–A3), `docs\PUBLISHING-AUDIT.md`, `research\harness-integration\01-kartotek-analysis.md` and `03-decisions.md`, the code in `src\`, `ui\src\` and `build.ps1`, and the Euro apply folder (read only). Tool versions and behaviour were checked against current documentation on 2026-11-15; the sources are listed at the end.

## 0. Where we start

What exists today, and what the design keeps:

| Part | Today | Kept as it is? |
| --- | --- | --- |
| Engine (`src\*.js`) | Plain global scripts (`DSR`, `KStore`, `KCycle` …), synchronous `App.boot()` | Yes. It runs unchanged in the desktop window. |
| UI (`ui\src`) | React 18 + Motion + Tailwind 4, built by Vite as one IIFE into `src\ui.js` | Yes. Same build. |
| Content | `build.ps1` reads the content folder (A3: `kartotek.config.json`, `-Content`, `KARTOTEK_CONTENT`, else `samples\`) and embeds JSON in `<script id="bundled-etuts">`, `bundled-study-extras`, `bundled-lessons`, `bundled-mocks`, `bundled-mindmaps`, `bundled-exam`, `kartotek-config` | The embedding is replaced by a run-time loader in the desktop app; the page format stays for the browser export. |
| Content import into state | `App.importBundledEtuts/Lessons/Mocks/Mindmaps()` read those tags; Study v2 packages attach by reference (`pkg_ref`, `KCycle.bundledMatches`) so the save does not grow | Yes. Only their input source changes. |
| Learner data | One JSON state in `localStorage['kartotek-dsr-v1']` (ceiling ≈ 5.2 M characters); on claude.ai a chunked cloud store (meta + card chunks of 80 + review chunks of 200 + one document per study, lesson, mock, mind map), driven by dirty tracking in `KStore.Store.commit()` | The in-memory state shape stays identical. A new file backend reuses the existing dirty tracking. |
| Backup | `App.exportBackup()` = `JSON.stringify(state)`; import with safety copy and counts (A1) | Yes. The old backup file stays the universal exchange format. |
| AI | No model call in the app. `claude://code/new` links and "Copy prompt" hand work to Claude Code | Kept as a fallback; a model layer is added beside it. |

## 1. Desktop shell: Electron or Tauri

### 1.1 What the shell must do for Kartotek

1. Run the existing plain-JS engine and the React bundle without rewriting them.
2. Spawn command-line clients (Claude Code, Codex), stream their JSON output line by line, cancel them.
3. Read and write a content folder anywhere on disk, and serve mind-map photos from it.
4. Store API keys with the operating system's protection.
5. Build a Windows installer and update itself from GitHub Releases.
6. Stay maintainable by one person who writes JavaScript.

### 1.2 Comparison

| Need | Electron 45 (current stable 45.3.3, Chromium 156, Node 24.22) | Tauri 2 (current 2.12.3) |
| --- | --- | --- |
| Rendering engine | Bundled Chromium: the same engine as Edge, where Kartotek is used and tested today | System WebView2 on Windows (also Chromium-based, updated by Windows) |
| Backend language | JavaScript (Node). The model SDKs, PDF text extraction (pdf.js) and JSON-schema validation are all npm packages | Rust. Every backend feature (file service, CLI runner, provider adapters, streaming HTTP, PDF text) is Rust code, or a Node "sidecar" process, which brings Node back anyway |
| Spawning CLIs | `child_process.spawn`, stdin/stdout streams, `AbortController` | `shell` plugin (2.5.0) with scoped permissions per command; output events to the window |
| Files | Node `fs` in the main process; custom protocol for photos | `fs` plugin (2.7.0) with path scopes; asset protocol |
| Secure key storage | `safeStorage` (DPAPI on Windows; use the async API, the sync one is deprecated and slated for removal in Electron 46) | OS keychain through a community crate or the Stronghold plugin |
| Installer | electron-builder (NSIS) or Electron Forge (Squirrel.Windows, WiX MSI, AppX) | NSIS or MSI built in |
| Auto-update | electron-updater from GitHub Releases, or `update-electron-app` with update.electronjs.org (public repo required, which we have) | `updater` plugin (2.13.3) with a mandatory update signature that "cannot be disabled", `latest.json` on GitHub Releases |
| Installer size and memory | Large: ships Chromium and Node (roughly ten times a Tauri installer); more memory | Small; less memory |
| Security defaults | Must be configured: context isolation, sandbox, CSP, IPC sender checks, fuses (Electron's 20-point checklist) | Capability-based permissions by default |
| Release cadence | A new major about every 8 weeks; three majors are supported at a time (45, 44, 43 today), so the app must move forward regularly | Slower, fewer breaking changes |
| One-person maintenance | One language end to end, no new toolchain | A second language (Rust) and toolchain for every backend change |

### 1.3 Recommendation: Electron

Kartotek is about 18,000 lines of JavaScript (engine and React UI), and everything the backend must do (provider SDKs, streaming, CLI processes, PDF text, schema validation) already exists as JavaScript libraries. With Electron the whole app stays in one language, the engine runs in the same Chromium it is tested in today, and none of the backend has to be written twice. Tauri's real advantages (installer size, memory, a stricter permission model, a signed updater) do not outweigh adding Rust to a one-person project. The costs of Electron are accepted and handled: the security checklist is part of C1 (section 2.4), the installer is large, and Electron must be upgraded every few months (Dependabot or Renovate opens the pull requests; the test suite in section 9 decides).

### 1.4 Packaging and updates: electron-builder

| Option | What it gives | Verdict |
| --- | --- | --- |
| **electron-builder 26.18.0 (NSIS) + electron-updater 6.8.11** | One config builds the per-user NSIS installer, publishes to GitHub Releases and serves updates with block-level downloads. Supports Azure signing in its Windows options (still marked beta). On Windows it checks the Authenticode signature of a downloaded update against the configured publisher (`verifyUpdateCodeSignature`, default on). | **Recommended.** Pin 26.x; 27 is an alpha (ES modules, new updater API). |
| Electron Forge 8.0.1 + Squirrel.Windows + update.electronjs.org | Electron's own tool. Squirrel installs per user with no prompt; update.electronjs.org needs only a public GitHub repo and Releases. | Good alternative. Squirrel gives no installer UI (no folder choice, no shortcut options) and leaves a `Update.exe` layout that is harder to explain; the free update service is a third-party dependency. |

Install mode: **per user, no admin** (`%LOCALAPPDATA%\Programs\Kartotek`). Updates: check at start and every few hours, download in the background, install when the app quits, never restart during a session; a setting turns checks off. User data is outside the install folder, so installing, updating and uninstalling never touch it (the uninstaller must not delete `%APPDATA%\Kartotek`).

Code signing (details in decision 3): an unsigned installer works but Windows SmartScreen warns on download, and **Windows 11 Smart App Control can block unsigned apps outright** (Tauri's signing guide notes this; it applies to any unsigned app). Options: Azure Artifact Signing (formerly Trusted Signing; about $9.99 a month for 5,000 signatures per a January 2026 report; eligibility for individuals must be checked at sign-up), or SignPath Foundation (free for open-source projects under an OSI licence such as MIT; requires MFA on GitHub and SignPath, and the publisher shown is "SignPath Foundation"). Since 2024, OV and EV certificates build SmartScreen reputation the same way, so even a signed first release may show a warning for a while.

### 1.5 Repository layout after C1

```
Kartotek\
  desktop\                 Electron main process (CommonJS or ESM, plain JS)
    main.js                app lifecycle, windows, single-instance lock, custom protocols
    preload.js             the bridge (contextBridge): the only API the window sees
    services\
      content.js           scan, read and watch the content folder
      data.js              learner-data files: safe writes, manifest, backups, import
      models\              provider interface, adapters, usage log, prices
      cli.js               spawn and stream command-line clients
      secrets.js           safeStorage-encrypted keys
      prompts.js           shipped prompts + user overrides
      euroapply.js         read-only reader and window opener
      updater.js
  prompts\                 shipped prompt files (section 6)
  src\                     engine + built ui.js/ui.css (unchanged role)
  ui\                      React sources (unchanged role)
  samples\  tools\  docs\
  package.json             root: electron, electron-builder, test scripts
  electron-builder.yml
```

`npm start` at the root runs `vite build --watch` for `ui\` and Electron; the main process reloads the window when `src\` changes (simple and reliable with the IIFE bundle; no Vite dev server is needed). `build.ps1` keeps working on its own.

## 2. Process boundaries

### 2.1 Who does what

| Window (renderer: sandboxed, context-isolated, no Node) | Main process (Node) |
| --- | --- |
| The whole engine: DSR scheduler, KCycle, KLesson, KMock, KMind, KMeta, validators (`KCycle.validate`, `KCycle.audit`, `validateExtra`, the lesson/mock validators) | Content folder: scan, read, watch, serve photos |
| The whole UI (React shell, tabs) | Learner-data files: write, read, back up, import, restore |
| The in-memory state `App.S` and its dirty tracking (`Store.commit`) | Model calls: HTTP to providers, streaming, retries, cost |
| Rendering model output through the existing Markdown/SVG sanitiser | Command-line clients: spawn, stream, cancel |
| Small view preferences in the window's own `localStorage` (theme, last tab, welcome seen); not learner data | Key storage (safeStorage), prompt files, usage log, updater, Euro apply window |

Rule: the window never holds a key, never builds a file path from user text, and never runs a process. The main process never decides learning logic; it moves bytes, calls services and enforces limits.

### 2.2 The bridge (`window.kartotek`, exposed by `preload.js`)

All calls are asynchronous (`ipcRenderer.invoke`), validated in the main process (argument schema, sender must be the app's own frame), and return `{ ok, value }` or `{ ok: false, error }`. Streams use an id plus events.

| Call | Direction | Purpose | Notes |
| --- | --- | --- | --- |
| `app.info()` | W→M | version, platform, data folder, content folder, dev/prod | |
| `content.load()` | W→M | read every package from the content folder | returns `{ etuts, extras, lessons, mocks, mindmaps, exam, problems }`, raw JSON plus file path and modified time |
| `content.onChanged(cb)` | M→W | the folder changed on disk | the window shows "Content changed: Reload" |
| `content.chooseFolder()` | W→M | folder picker; saves the setting | |
| `content.photoUrl(mapId, file)` | W→M | URL `kcontent://mindmaps/<id>/<file>` | the protocol refuses paths outside the content folder |
| `content.openFolder(sub)` | W→M | show a content subfolder in Explorer | |
| `data.load()` | W→M | the saved state (normalised by the window with `KStore.normalize`) | |
| `data.write(changeset)` | W→M | persist dirty parts (section 4.3) | returns the new generation number |
| `data.flush()` | W→M | write everything now (used before quit, before import) | |
| `data.status()` / `data.onStatus(cb)` | both | "Saved", "Saving…", errors | feeds the storage chip |
| `data.backupNow(reason)` | W→M | dated backup | |
| `data.listBackups()` / `data.restore(id)` | W→M | rollback | restore takes a safety backup first |
| `data.exportBackup()` | W→M | save-as dialog with the old backup format | |
| `data.inspectImport(path)` / `data.import(path)` | W→M | first-run and later imports | counts and a report (section 4.5) |
| `models.list()` / `models.save(config)` / `models.remove(id)` | W→M | provider and slot settings (no keys in the result) | |
| `models.setKey(providerId, key)` / `models.clearKey(id)` | W→M | write-only; keys never come back to the window | |
| `models.test(providerId)` | W→M | one small call; reply, usage, cost | |
| `models.run(request)` | W→M | start a call; returns `callId` | request format in section 5.1 |
| `models.onEvent(callId, cb)` | M→W | text deltas, status, usage, done, error | |
| `models.cancel(callId)` | W→M | abort the HTTP request or kill the process tree | |
| `models.usage(range)` | W→M | usage and cost rows for the usage panel | |
| `prompts.list()` / `prompts.get(id)` / `prompts.saveOverride(id, text)` / `prompts.resetOverride(id)` | W→M | prompt editor (section 6) | |
| `jobs.start(kind, input)` / `jobs.onEvent` / `jobs.cancel` / `jobs.resume(id)` | both | long background jobs (E3: writing a study) | job state in user data |
| `euroapply.status()` / `euroapply.open()` / `euroapply.read()` | W→M | section 8 | |
| `system.openExternal(url)` | W→M | allowed for `https:` URLs only, after a check | |
| `system.copyText(text)` | W→M | clipboard (also works in the sandbox) | |
| `update.status()` / `update.onStatus(cb)` / `update.installOnQuit()` | both | updater state in Settings | |

### 2.3 How the engine learns about the host

One small engine file, `src\host.js`, defines `KHost`: in the desktop app it wraps `window.kartotek`; in the browser export it is a stub that reads the embedded `<script>` tags and `localStorage` as today. `App.boot()` becomes `await KHost.ready()` then the same steps. The import functions (`importBundledEtuts` …) read `KHost.content` instead of the DOM; the Store gets a `file` mode next to `local` and `cloud`. This is the only change to engine files the desktop needs before the model layer.

### 2.4 Security settings (checked against Electron's security checklist)

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a CSP of `default-src 'self'; script-src 'self' 'sha256-<theme script>'; style-src 'self' 'unsafe-inline'; img-src 'self' kcontent: data: blob:; connect-src 'self'` (the desktop loads the `src\` scripts as separate files; the one inline script in `src\index.html`, the theme-before-first-paint snippet, is allowed by its hash or moved to a file in C1; inline styles are needed because the legacy views build HTML with `style=` attributes; the window makes no network requests itself, since model calls go through the main process), the app served from a custom `app://kartotek/` protocol instead of `file://`, navigation and new windows blocked (external links go through `system.openExternal`), every IPC handler checks the sender, Electron fuses set (`RunAsNode` off, `EnableNodeCliInspectArguments` off, `OnlyLoadAppFromAsar` on, ASAR integrity validation on), single-instance lock so two windows never write the same data.

## 3. Content at run time

### 3.1 Content folder

- Setting `contentDir` in `%APPDATA%\Kartotek\settings.json`, chosen with a folder picker on first run (default `%USERPROFILE%\Documents\Kartotek Content`). In development, `kartotek.config.json` and `KARTOTEK_CONTENT` keep working (same order as `build.ps1`). With no folder, the app uses the bundled `samples\` (shipped read-only inside the installer).
- Layout (unchanged from A3): `studies\<id>\etut.json` and `extras\*.json`, `lessons\<id>\lesson.json`, `mocks\<id>\mock.json`, `mindmaps\<id>\` (`map.json`, `turns\*.json`, `grades\*.json`, `reference.json`, `views\` photos), `exam\tud-apply.json`, `sources\`, `notes\`.
- Samples and user content can be shown together; a sample whose id also exists in the content folder is hidden.

### 3.2 Discovery, validation, reload

1. **Discover** (main): the same globs `build.ps1` uses. Folder names for mind maps must match `^[a-z0-9][a-z0-9-]*$` as today. Files over a size limit (20 MB JSON) are listed as problems, not read.
2. **Parse** (main): JSON parse per file. A parse error becomes a problem row `{ kind, path, message }`; the other files still load.
3. **Validate** (window): the existing validators run on each parsed package: `KCycle.validate` and `KCycle.audit` for Study v2, `KEtut` validation for legacy v1, `KCycle.validateExtra` for extras, the lesson and mock validators, `KMind` checks for mind maps. Invalid packages go to the **Content problems** panel (System group) with their errors and the file path; they never reach the state and never break the app. Audit warnings show as warnings; a study with audit blockers is shown as "not certified" (the label E3 needs anyway).
4. **Attach** (window): the existing import functions, unchanged in logic: Study v2 packages attach by reference (`pkg_ref`), so the saved state does not grow; a changed version is updated as today; packages the learner removed are not brought back.
5. **Reload**: a **Reload content** button (Study library and Content problems panel) runs steps 1–4 again without restarting. The main process also watches the folder (`fs.watch`, debounced) and offers the reload; it never reloads by itself in the middle of an attempt.
6. **Photos**: `kcontent://mindmaps/<id>/views/<file>` served by the main process from the content folder, with the path normalised and checked to stay inside it. The existing "choose a local photo" path (`URL.createObjectURL`) keeps working.
7. **Writing into the content folder** (extras from Explain, follow-up items, mind-map turns written by the app later in E2/E3): through `content.writeExtra(...)` in the main process, with the same safe-write rule as learner data, into the file names Claude Code uses today, so both routes produce identical files.

### 3.3 `build.ps1` and the single-file page

Keep `build.ps1` as an **optional browser export** until 1.0, then decide (decision 5). Reasons: it is the only route to the claude.ai cloud store (`Store.connectCloud` works only when the page runs inside claude.ai), it is a zero-install way to show Kartotek to someone, and it already works with the content folder. The engine keeps both paths through `KHost`. CI builds the export from `samples\` as a smoke test. The note-sheet PDF printing (Edge headless) stays in `build.ps1`; the desktop app can later print note sheets itself with `webContents.printToPDF`.

## 4. Learner data

### 4.1 Where

`app.getPath('userData')` = `%APPDATA%\Kartotek` in the installed app. Development runs use `%APPDATA%\Kartotek-dev` (decision 15), so experiments never touch real data.

```
%APPDATA%\Kartotek\
  settings.json              content folder, Euro apply folder, update and UI options (no keys)
  data\
    manifest.json            format, generation, state version, app version, file list with SHA-256
    manifest.prev.json       the previous manifest (crash recovery)
    meta.json                version, lang, settings, params, decks, cents, tud, param_history, created_at, last_backup_at
    cards\c0.json …          { items: { <card_id>: { card, mem } } }, the existing chunks of 80 (card.chunk)
    reviews\r0.json …        { events: [...] }, chunks of 2,000 review events in log order
    etuts\<etut_id>.json     one study record each (progress, attempts, pkg_ref)
    lessons\<id>.json  mocks\<id>.json  mindmaps\<id>.json
    .lock                    pid of the running instance
  backups\
    2026-11-15T08-30-12_daily.json        full backup in the old backup format
    2026-11-15T09-02-40_before-import.json
  prompts\                   user prompt overrides (section 6)
  models\
    providers.json           providers and slots, no keys
    keys.bin                 safeStorage-encrypted key blob
    prices.json              user edits to the shipped price table
    usage\2026-11.jsonl      one line per model call
  jobs\<job-id>\             state of long background jobs (E3)
  logs\main.log              rotated, never contains keys or prompt text
```

The split is the cloud store's split, so `KStore.Store`'s dirty tracking (`meta`, `chunks`, `reviewsFrom`, `etuts`/`lessons`/`mocks`/`mindmaps` by id) maps one to one onto files. Review chunks are rewritten from `floor(reviewsFrom / 2000)` on, which also covers Undo (it removes the last event). No size ceiling remains: the largest single file is one review chunk (about 1.4 MB).

### 4.2 Safe writes

- Every file is written as `name.tmp` in the same folder, flushed to disk (`fsync`), then renamed over the old file (atomic replace on NTFS).
- One save = one **generation**: the changed files are written first, then `manifest.json` (with the new generation and each file's SHA-256) is written the same way, after the old manifest is copied to `manifest.prev.json`.
- On start, the main process checks every file listed in the manifest. If a hash does not match (a crash between file writes), it loads with `manifest.prev.json` plus the files that still match it; if that also fails, it offers the latest backup. Nothing is ever deleted or moved when a check fails (as built in C3: file names carry the generation, see section 10.0c).
- Saves are debounced (≈ 700 ms, as the cloud flush), forced on quit, before imports, restores and updates. A failed write keeps the dirty marks and retries; the storage chip says so.
- The single-instance lock plus `.lock` prevents two writers.

### 4.3 Dated backups

- Format: **exactly the old backup format** (`JSON.stringify(state)`, the file `App.exportBackup` writes). So every automatic backup can also be imported by the old browser page, and the existing `KStore.inspectBackup` reads it.
- When: the first save of each day (`daily`), before every import, restore, data-format migration and app update (`before-…`), and on demand.
- Retention (decision 8): 14 daily, 8 weekly (Sunday's daily kept), 12 monthly; `before-…` backups kept for 90 days, the latest five always. Pruning only deletes backups it created and never the newest of any kind.
- Settings > Data lists backups with date, reason and counts, and offers **Restore**, **Export** and **Show in folder**.

### 4.4 Format versions and migrations

`manifest.format = "kartotek-files-1"`, `state.version` stays 1. Every later change to the state shape raises `state.version`, ships a migration function in the engine (`KStore.migrate(state, from, to)`), runs only after a `before-migration` backup, and comes with a test on synthetic states of every older version plus a run on a copy of a real export (standing rule).

### 4.5 First run and import

First start with an empty data folder shows three choices: **Import a backup file**, **Start with the samples**, **Start empty**.

**From the old backup file** (the browser app's Settings > Data > Export backup):
1. `data.inspectImport` parses the file and runs `KStore.inspectBackup` (refuses non-backups and files from a newer Kartotek).
2. The window normalises it with `KStore.normalize` (the same code the old app ran on load) and computes a **report**: cards, memory records, review events, decks, studies and their attempts (summed over `etuts[*]`), lesson tests and attempts, mocks and attempts, mind maps (versions, corrections, attempts), exam plans (`cents`, `tud` including `tud.apply` ticks), settings and params present, `param_history` length.
3. The main process writes the files, then reads them back into a fresh state and the window normalises that again.
4. **Acceptance**: the report of the read-back state must equal the report of the file, and the canonical JSON of both normalised states must be identical (keys sorted). If not, nothing is kept: the new files are moved aside and the report shows the difference. Counts alone are not enough; equality of the whole state is the real test.
5. The original file is never written to; it is copied to `backups\…_imported-source.json`.

**From the claude.ai cloud store**: the desktop app cannot read it directly (the store exists only inside the claude.ai page runtime through `window.claude.use('db')`). The defined route: open the single-file page on claude.ai as before; it loads the cloud state (`connectCloud`); press **Export backup**; import that file as above. The exported file is the full cloud state, because `exportBackup` writes `App.S`, which is the state loaded from the cloud. Decision 9 confirms this route.

**From the browser's localStorage**: same route (Export backup in the browser, import the file). The desktop window has its own storage and cannot read Edge's.

### 4.6 Rollback

| Situation | What to do |
| --- | --- |
| A bad change inside the app | Settings > Data > Backups > Restore (a safety backup is taken first) |
| A failed import | Nothing to do: the import does not keep anything unless the acceptance check passes |
| The desktop app itself is not wanted | Settings > Data > Export backup (old format), open the browser page, Import backup. The browser app keeps working throughout (section 3.3) |
| A damaged data folder | Start falls back to the previous manifest, else the first-run panel offers the dated backups; every file stays where it was |
| A bad update | Install the previous release from GitHub Releases over it; the data folder is untouched, and the `before-update` backup exists if the new version migrated the data |

## 5. Model layer

All model work runs in the main process (keys never enter the window). Features call it through `models.run`. With no provider configured the layer reports "not configured" and the feature falls back (section 5.6).

### 5.1 One provider interface

```js
// desktop/services/models/provider.js (shape, not final code)
provider = {
  id, kind: 'api' | 'cli' | 'local', label,
  capabilities(model) -> { stream, structured: 'native' | 'json-mode' | 'none', images, webSearch, maxInputTokens },
  listModels() -> [{ id, label }],
  run(request, { signal, onEvent }) -> Promise<result>
}

request = {
  feature,                         // 'explain', 'follow-up', 'feynman-feedback', 'typed-grading', 'ask-card', 'study-writer:outcomes', ...
  slot,                            // 'strong' | 'fast' | 'vision'  (or an explicit { providerId, model })
  promptId, promptVersion,         // section 6, recorded with the result
  system, messages: [{ role, content: [ { type: 'text', text } | { type: 'image', mime, data } ] }],
  schema,                          // optional JSON Schema; result.json must validate against it
  webSearch: false,                // only honoured where capabilities().webSearch is true
  maxOutputTokens, temperature
}

events: { type: 'text', delta } | { type: 'status', text } | { type: 'usage', usage } | { type: 'done', result } | { type: 'error', error }

result = { text, json, usage: { input, output, cacheRead, cacheWrite }, costUsd, costKind: 'api' | 'subscription-estimate' | 'free-local',
           provider, model, stopReason, durationMs }
```

Structured output works the same for every adapter: the request carries a schema; the adapter uses the provider's native mode where it exists; the layer **always** validates the result against the schema (Ajv) and, if it fails, makes one repair call with the validation errors; after that it returns an error. Engine validators (`KCycle.validateExtra` and the others) still run in the window on top.

Errors are typed (`not-configured`, `auth`, `rate-limit`, `budget`, `network`, `schema`, `cancelled`, `cli-missing`, `provider`) so the UI can say what to do.

### 5.2 The three kinds of adapter

**(a) API key adapters.** Two adapters cover the three named providers:

| Adapter | Covers | Streaming | Structured output | Images | Web search |
| --- | --- | --- | --- | --- | --- |
| `anthropic` (native Messages API, official SDK) | Claude models | yes | native: `output_config.format` with `type: "json_schema"`, stable, no beta header (supported models include Opus 5.5, Sonnet 5.5, Haiku 5.5). Limits to respect: no recursive schemas, no min/max/length constraints, `additionalProperties: false` required on objects | yes | yes (server-side web search tool) |
| `openai-compatible` (Chat Completions format) | OpenAI; Google Gemini through its OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/`, still labelled beta by Google); OpenRouter and similar | yes | `response_format` JSON schema where the provider supports it, else JSON mode + validation | yes (base64 data URLs) | provider-specific; off by default |

A native Google adapter is not needed for the first version (decision 10). Kartotek's schemas are written to the strictest common subset (the Anthropic limits above), so one schema works everywhere.

**(b) Subscription through a local command-line client.** A generic `cli` adapter with a per-client profile:

| Profile | Command | Output | Structured output | Notes |
| --- | --- | --- | --- | --- |
| Claude Code | `claude -p --output-format stream-json --verbose --include-partial-messages --model <m> [--json-schema <schema>] --permission-mode dontAsk` with the prompt on stdin | newline-delimited JSON; the last line is a `result` message with the text, `structured_output`, usage and `total_cost_usd` (a client-side estimate) | `--json-schema`; the field is absent if the run ended without valid output, so the adapter checks for it | **Do not use `--bare`**: bare mode skips the subscription login and needs an API key. Instead the process runs in an empty working folder `%APPDATA%\Kartotek\cli-work\` (no project hooks, no `.mcp.json`), with no tools allowed, and `dontAsk` denies anything that would prompt. Piped stdin is capped at 10 MB. Cancel with SIGINT first (ends the turn), then kill the process tree |
| Codex | `codex exec --json [--output-schema <file>]`, prompt on stdin | JSON Lines | `--output-schema` (limits to be checked in E1) | uses the saved `codex login` (ChatGPT plan) credentials |
| Custom | command, arguments, stdin or file prompt, parser `text` / `jsonl` | | JSON mode + validation | for any other client |

Rules for all CLI runs: the executable is found on `PATH` once and shown in Settings; arguments are passed as an array (never through a shell); prompt text goes through stdin or a temp file, never the command line (Windows command-line length and quoting); one run per call; timeouts; the run's working folder is the app's empty folder, not the content folder, unless a job explicitly needs file access (E3 may grant read access to `sources\` with `--add-dir`). Costs from a subscription CLI are shown as "included in your subscription (API-equivalent ≈ $x)".

**(c) Local model.** The `openai-compatible` adapter pointed at a local base URL, preset for Ollama (`http://localhost:11434/v1`). Ollama's OpenAI-compatible API supports chat completions with streaming (usage via `stream_options.include_usage`), base64 images, and JSON mode; its documentation does not promise JSON-schema mode, so local models use JSON mode + validation + repair. `costKind: 'free-local'`.

### 5.3 Task slots

Three slots, each `{ providerId, model }`, set in Settings > Models:

| Slot | Used by (default mapping, decision 16) |
| --- | --- |
| strong | study writing (E3), typed-answer grading proposals, Feynman feedback, final reports later in F |
| fast | Explain after an attempt, follow-up items, Ask about this card, side questions |
| vision | mind-map photo reading and coaching (MINDMAP-RULES.md), page images when a PDF's text layer is unreliable |

A slot may be empty; a feature whose slot is empty uses `strong` if set, else it is "not configured". Each feature can be overridden to another slot in Settings (advanced).

### 5.4 Usage and cost

- Every call appends one line to `models\usage\YYYY-MM.jsonl`: time, feature, slot, provider, model, prompt id and version, input/output/cache tokens, `costUsd`, `costKind`, duration, outcome. No prompt or answer text.
- Cost = tokens × the price table. A price table ships with the app (`desktop\services\models\prices.json`, with the date it was checked); the user can edit prices in Settings; no live price fetching (decision 12). Unknown models show tokens and "price unknown".
- **Usage panel** (System > Settings > Models > Usage): calls, tokens and cost per day and per feature, this month's total, and a **monthly budget**: a warning at 80 %, and at 100 % model calls stop until the user raises the budget or confirms once. A cost estimate is shown before any job that makes more than one call (E3).

### 5.5 Keys

`models.setKey` encrypts with `safeStorage.encryptStringAsync` (DPAPI) and stores the blob in `models\keys.bin`. Keys are decrypted only in the main process at call time, never sent to the window, never written to logs, backups, exports or `providers.json`, and never in the repository. DPAPI protects against other Windows users, not against other programs running as the same user (as Electron's documentation states); Settings says this in one line. Removing a provider deletes its key.

### 5.6 With no model configured

Everything that works today keeps working: packaged studies, reviews, lesson tests, mocks, mind maps (with the files Claude Code writes), stats and the algorithm. Every AI button stays visible and, when pressed, shows what it would do, a **Set up a model** link and the existing **Copy prompt** (the prompt is rendered from the same prompt file the model would get). Where Claude Code is installed, the `claude://code/new` link stays as a third option. No feature hides because a model is missing.

## 6. Prompts as editable files

- **Shipped prompts** live in the repository under `prompts\`, one Markdown file per task, with front matter:

  ```
  ---
  id: explain
  version: 3
  slot: fast
  schema: schemas/explain.json        (optional; JSON Schema the answer must match)
  variables: [item, learner_answer, criteria, source_excerpt]
  ---
  (instructions, original Kartotek text; with {{item}}-style placeholders)
  ```

  Schemas live in `prompts\schemas\` and are **not** user-editable (the app depends on their shape). The prompt texts are written originally for Kartotek (standing rule on LearnHarness).
- **Overrides** live in `%APPDATA%\Kartotek\prompts\<id>.md`. Settings > Prompts lists every prompt with "default" or "edited", opens an editor with the default beside it, offers **Reset to default**, and validates on save that every required variable is still present.
- When a shipped prompt's `version` rises and the user has an override, the list marks it "default changed since your edit" and shows the difference; the override stays in use until the user decides.
- Templating is a minimal `{{name}}` replacement with no code execution; inserted learner text is fenced so it cannot be read as instructions.
- Every model result records `promptId`, `promptVersion` and, for an override, a short hash of its text, so generated items stay traceable.
- The "Copy prompt" fallback renders the same file.

Plan change: this infrastructure is needed by E2 and E3, so it moves from F1 to E1 (section 10).

## 7. Navigation

Per `03-decisions.md` (decisions and planner assumptions 3–6). The sidebar gets four groups; a mode switch at the top toggles Study and Planning and is remembered; Career and System are always visible below.

| Group | Entries | Notes |
| --- | --- | --- |
| **Study** | Review, Study, Cards, Mock exam, End-of-lesson test, Mind maps | One **scope** selector (All, CEnT-S, TU Delft AE Prep) applies the existing exam scoping (`App.scope`, `App.examDecks`) instead of repeating these tabs per exam. Mind maps stay here because Learn & digest uses them (assumption 4). |
| **Planning** | Home (combined timeline, D2), CEnT-S overview, TU Delft AE overview, Application, Euro apply, Stats | Exam overviews keep syllabus, exam date, pace, placement tests and "write the next studies". Stats moves here (assumption 4). |
| **Career** | one "planned" page | placeholder (assumption 6) |
| **System** | Settings (with Data, Content, Models, Prompts, Updates panels), Algorithm, Content problems | reachable from both modes |

Old tab ids stay valid in saved preferences and in `#hash` links (`study`, `etut`, `lesson`, `cards`, `mindmaps`, `cents`, `tud`, `tud-apply`, `stats`, `algo`, `settings`, and the per-exam sub-tabs), mapped to their new places by a table in `Shell.jsx`; D1 builds it.

## 8. Euro apply

Euro apply (a separate project folder on the owner's PC) stays a separate app: a React + Vite app run by its own Vite dev server on `http://127.0.0.1:5178` (strict port). Its `tools\serve.ps1` keeps that server running (one copy, named mutex, restarts Vite; started at logon and by `Start-EuroApply.bat`). It saves through its own server middleware into `data\`, keeping copies in `data\.backup\`.

### 8.1 Opening it from Kartotek

- Setting **Euro apply folder** with a folder picker (no default in the public app; the owner sets it once). Without it, Planning > Euro apply shows a one-line setup row.
- **Open**: the main process checks `http://127.0.0.1:5178/`. If it answers, Kartotek opens it in its **own window** (a separate `BrowserWindow` with no preload, no Node, its own session partition, navigation limited to `127.0.0.1:5178`, other links sent to the default browser). If it does not answer, Kartotek offers **Start Euro apply**, which runs Euro apply's own launcher hidden (`powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File <folder>\tools\serve.ps1`), waits up to 30 seconds and then opens the window. Kartotek never runs Euro apply's code itself and never writes into its folder.
- Requirement shown in the setup row: Node.js must be installed and `app\node_modules` present (Euro apply's own requirement).

### 8.2 Data Kartotek reads (read only, D2)

Only `data\universities.json`, read directly from disk by the main process (not through the dev server, so the timeline works when Euro apply is not running):

| Field | Used for |
| --- | --- |
| `schema`, `updated` | version check; "data from <date>" |
| `statusValues` | labels for programme status |
| `universities[].id`, `name`, `city`, `country`, `priority` | row titles and sorting |
| `universities[].programs[].id`, `name`, `status` | which programmes are active (e.g. `tudelft-ae`, status "Planned") |
| `universities[].timeline[].id`, `date`, `label`, `kind`, `est`, `checked`, `url`, `note` | the deadlines shown in the Planning timeline; `est: true` shown as "estimated" |

Not read: `profile.json` (personal), `countries.json`, `rankings.json`, `weights.json`, `inbox\`. A parse error (for example while Euro apply is saving) is retried once after 500 ms; if the file still cannot be read, the timeline shows Kartotek's own rows and says what is missing. D2 reports the exact fields it relied on so that Euro apply knows what must not change.

## 9. Testing and continuous integration

| Layer | How | Where it runs |
| --- | --- | --- |
| Engine (`src\tests.js`, 53 tests today) | Kept in the Algorithm tab, and also run headless in Node: a small runner loads the engine scripts in index.html order into a `vm` context with minimal `window`/`document`/`localStorage` stubs and runs the same scenarios | `npm test`, CI |
| Data layer | Node tests with a temp folder: state → files → state is deep-equal; every record type; review chunk rewrite after Undo; crash between file writes (manifest recovery); hash mismatch → quarantine and fallback; backup retention; restore; import acceptance refuses a deliberately altered read-back; old-format import of synthetic states of every version still migrated | `npm test`, CI |
| Real-data check | The same import and comparison on a copy of the owner's real backup, path from an environment variable; also compares today's review queue with the old app's | locally only, never in CI or the repository |
| Content loader | Fixture content folders: valid samples, a broken JSON, an invalid package, a mind map with a missing photo, a path-escape attempt on `kcontent://` | `npm test`, CI |
| Study packages | `python tools\audit-study.py --samples` (and `--all` locally with the content folder) | CI (samples), locally (all) |
| Model layer | A fake provider (scripted streams, usage, errors, cancellation); adapter parsers tested on recorded **synthetic** stream fixtures (Anthropic SSE, Chat Completions SSE, Claude Code `stream-json`, Codex JSONL); schema validation and repair; budget stop; keys never appear in logs (a test greps the log) | `npm test`, CI. No test calls a real service |
| Desktop smoke | Playwright's Electron launcher starts the app with `samples\` and a temp data folder, opens every sidebar entry, runs the Algorithm-tab suite in the window, checks there are no console errors | CI on `windows-latest` |
| Browser export | `build.ps1 -SkipPdf` with samples, then the same smoke test on the page | CI |
| Repository hygiene | A script fails if tracked files match the private list from the audit (content folders, `*.pdf`, `research\`, user-name paths) and if `src\ui.js` differs from a fresh `npm run build` | CI |

**CI (GitHub Actions, `windows-latest`)**: on every push and pull request: `npm ci` (root and `ui\`), UI build and bundle check, `npm test`, Python audit of the samples, browser export build, Electron smoke test, hygiene script. On a `v*` tag: the same, then `electron-builder --win --publish always` to a **draft** GitHub Release with the installer, `latest.yml` and SHA-256 sums; the owner publishes the draft. Signing secrets (if decision 3 adds signing) are used only in the tag job. Action and tool versions are pinned and checked against their current documentation in C4.

## 10. Migration order

Each step leaves a working app; the browser app keeps working until the owner switches.

| # | Step | Task | The app after the step |
| --- | --- | --- | --- |
| 1 | Electron shell loads `src\` through `app://`, security settings, `npm start` with live reload, headless `npm test` runner for `src\tests.js` | C1 | Desktop window runs today's app; data still in the window's own `localStorage` (empty at first: import a backup to try it). Browser app unchanged and still the main one. |
| 2 | `KHost` seam; content service, Reload, Content problems, `kcontent://` photos, content-folder setting; `build.ps1` unchanged | C2 | Desktop reads content live; browser export still built by `build.ps1`. |
| 3 | File data store, safe writes, manifest, backups, first-run import with acceptance check, restore | C3 | Desktop keeps data in files; the old backup still imports; dev profile only. |
| 4 | Installer, updater, CI, first release; first run of the installed app imports the real backup into the real profile | C4 | The owner switches to the desktop app; the browser app remains the rollback. |
| 5 | Sidebar groups, scope selector, old-id mapping | D1 | Same features, new navigation. |
| 6 | Euro apply window and Planning home timeline | D2 | Planning complete. |
| 7 | Model layer, Settings > Models, keys, usage and budget, **prompt files and overrides** | E1 | AI buttons can call a model; nothing changes without one. |
| 8 | In-app Explain, follow-up items, Ask about this card, Feynman feedback, typed-answer proposals | E2 | Studying no longer needs Claude Code. |
| 9 | In-app study writing as a background job, verification pass | E3 | Writing no longer needs Claude Code. (E3 was built before E2; the study-time hand-offs of E2 still go to Claude Code.) |

### 10.0 C1 as built (2026-11-15)

Files: `package.json` (root), `desktop\main.js`, `desktop\preload.js`, `desktop\serve.js`, `scripts\start.cjs`, `scripts\run-tests.cjs`, `scripts\smoke.cjs`, `ui\scripts\copy-build.cjs` (also exports the copy for watch mode).

- **`npm start`** builds `ui\` once, keeps `vite build --watch` running (a Vite plugin copies every rebuild to `src\` when `KARTOTEK_WATCH_COPY=1`), opens the window and reloads it when anything under `src\` changes. `npm ci` at the root also installs `ui\` (postinstall).
- **The window loads `src\` directly** through `app://kartotek/` (served by `serve.js`, path-traversal guard, no-store caching). It has **no embedded content**: the `bundled-*` script tags only exist in the page `build.ps1` writes, and run-time content loading is C2. The window therefore starts with an empty library and its own `localStorage` (origin `app://kartotek`, profile `%APPDATA%\Kartotek-dev`); import a backup to try it with data.
- **Security (section 2.4) as built:** `contextIsolation`, `sandbox`, no Node, permission requests denied, navigation locked to the app origin, `will-attach-webview` blocked, one instance. CSP as in 2.4 with these additions: `font-src 'self' data:` (Inter is inlined as data URLs), `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, and the inline theme script allowed by a hash computed at serve time from `src\index.html` (so that file stays unchanged and the browser build still inlines it). React DOM's `setAttribute('oninput','return;')` feature probe is allowed by `'unsafe-hashes'` plus the hash of exactly that text; no other inline handler runs.
- **External links:** the window may hand `https:` and `claude://` links to the operating system (the existing "Ask Claude" buttons are `claude://` links). Section 2.2's `system.openExternal` is https-only; the `claude:` scheme is the one addition, until E2 replaces those buttons.
- **Bridge:** only `window.kartotek.app.info()` exists; the main process checks that the sender frame is the app's own.
- **Tests:** `npm test` runs `src\tests.js` headless in a jsdom window (all 53 scenarios, same as the Algorithm tab; the SVG sanitiser test needs a real `DOMParser`, so a hand-made stub was not enough) and the desktop helper tests (paths, CSP, links). `npm run smoke` is the Playwright Electron check of section 9 (every sidebar entry, Algorithm tab, console errors, no Node in the window).
- **Known console messages:** the sanitiser test feeds deliberately malicious SVG to the page (`onload="alert(1)"`, `onclick="x()"`); the CSP blocks those handlers and the browser logs two errors when the Algorithm tab runs the suite. The smoke test filters exactly that message.
- **Not verifiable on every PC:** Windows 11 **Smart App Control** blocks the unsigned `electron.exe` that npm downloads (CodeIntegrity events 3033 and 3077), so on a PC with Smart App Control on, `npm start` and `npm run smoke` cannot start Electron. This is the same effect section 1.4 describes for the installer. CI runners have no such policy.

### 10.0b C2 as built (2026-11-15)

Files: `src\host.js` (`KHost`), `desktop\content.js`, `ui\src\tabs\ContentPanel.jsx`, `scripts\content-tests.cjs`; the bridge gained `content.load`, `content.chooseFolder`, `content.openFolder`, `content.onChanged`; `desktop\main.js` gained the settings file, the folder watcher and the `kcontent://` protocol.

- **`KHost` is the seam (section 2.3).** In the desktop app it calls `window.kartotek.content.load()`; in the browser page it reads the same `<script>` tags as before (`build.ps1` is unchanged). The five `App.importBundled*` functions and the exam plan now take their input from `KHost.list(kind)` and `KHost.exam()` instead of the DOM; their logic is unchanged. `App.boot()` runs after `KHost.ready()`.
- **Validation in the window, before import.** `KEtut.validatePackage` (which runs `KCycle.validate` for Study v2), `KCycle.validateExtra`, `KLesson.validateLesson`, `KMock.validateMock` and `KMind.validateMap` run on every package. A failing package is listed as a problem (kind, id, file path, every error) and never reaches the saved state; a duplicate id is listed and the first one wins. A Study v2 package with audit blockers still loads, as before, and is listed as a warning "Not certified". Parse errors, oversized files (20 MB) and bad mind-map folder names are listed by the main process. Mind-map turn and grade errors found at import are added by `KHost.setImportProblems`.
- **Reload.** **Reload content** (Settings, Content panel; Study library) re-reads the folder and runs the same import functions. New packages appear, changed versions update with progress kept, saved cards, memory, review log and progress are never touched. A Study v2 package that is no longer in the content (folder deleted, renamed or broken) is detached from its saved record; the record, its cards and its attempts stay and come back with the package. Legacy v1 packages are stored in the saved state, as before, and stay.
- **Folder choice.** Order: `settings.json` in the profile (the folder picker, written atomically), then `KARTOTEK_CONTENT`, then in development `kartotek.config.json`, else only the samples. A configured folder that does not exist is reported and skipped. Samples and content show together; a sample whose id exists in the content folder is hidden.
- **Watching.** The main process watches the folder (`fs.watch`, 800 ms debounce) and tells the window; the Content panel then shows "Content changed", and nothing reloads by itself.
- **Photos.** `kcontent://mindmaps/<id>/<file>`: only image files inside that map's folder; `..`, backslashes, encoded escapes and non-image files are refused (tested, and checked again in the window by `npm run smoke`). The "choose a local photo" path still works.
- **Where the Content problems panel is.** Settings (System group), above Data. D1 may move it.
- **Tests.** `npm test` adds the content service on fixture folders and a reload scenario with the real engine in jsdom: a saved state restarted with run-time content (state deep-equal, counts of cards, reviews and attempts identical), Reload with a new and an invalid study (nothing existing changes, only the new study's cards are added, the Study v2 package is not copied into the saved state), a changed version (progress kept), a removed and a returning study. `KARTOTEK_BACKUP=<path to an export>` runs that scenario on a copy of a real backup (read only). `npm run smoke` repeats the content checks in the real window (new study after Reload, photos, path escapes).

### 10.0c C3 as built (2026-11-15)

Files: `desktop\data.js` (the data store), `desktop\data-api.js` (the checked data calls, registered by `main.js` and used by the tests), `src\store.js` (`file` mode, `replaceFromSource`, `countRecords`), `ui\src\tabs\DataFiles.jsx` (first-run panel, desktop Data panel, import report), `ui\src\Shell.jsx` (boot waits for the data), `scripts\data-tests.cjs`, `scripts\bridge-preview.cjs`; the bridge gained `data.*` (load, write, replaceAll, confirm, revert, backupNow, listBackups, readBackup, pickImportFile, saveFile, openFolder, onFlushRequest).

Where the build differs from sections 4.1–4.6, and why:
- **File names carry the generation** (`meta.g17.json`, `cards\c0.g17.json`, …) instead of replacing files in place. A save writes only new files, then the manifest; a crash at any moment leaves the previous manifest and all its files intact. Files that neither `manifest.json` nor `manifest.prev.json` names are removed after the next good save. There is no `quarantine\` folder: nothing is moved or deleted when a check fails; a damaged manifest is copied to `manifest.damaged-<time>.json`, and the files of a refused import go to `data\rejected-<time>\`.
- **One more file, `order.g<N>.json`:** the key order of cards, memory records and the four maps. The app's lists and the review queue's tie-breaks follow `Object.keys` order, so the read-back state must have the same order, not only the same data (found by the queue comparison test).
- **Saves compare parts instead of trusting the dirty marks.** Each save serialises every part (the same split as the files), sends only the parts that differ from the disk, and the dirty marks only start the save; a check every 15 seconds catches changes made without `commit()`. Reason: some code changes the state without `commit()`; the old whole-state localStorage save hid that, a dirty-only file save would have lost those changes. Cost: one serialisation per save, the same as the old localStorage save.
- **Import, restore and the first start are one pipeline** (`KStore.Store.replaceFromSource`): normalise the source, write it as a new generation, read it back from disk, compare. Kept only if the read-back state is identical (canonical JSON) and every count in the report matches; otherwise `revert` brings the previous generation back. Three rows may change on purpose when an older save is migrated (settings and parameters get defaults, the CEnT-S selection gets the Reading section once); the report marks them and checks them against the migrated source.
- **First run** offers a third source next to the backup file: the data the desktop window's own browser storage holds (from testing C1 and C2), with the same check.
- **Export** writes the old backup format, as section 4.3 decided, so the browser page can still import it (the rollback path). The new format is the data folder itself; there is no second export format.
- **claude.ai:** the route of section 4.5 (Export backup in the page on claude.ai, then import the file); no direct connector.

### 10.0d C4 as built (2026-11-15)

Files: `electron-builder.yml`, `build\icon.png` and `build\icon.ico` (drawn by `scripts\make-icon.cjs`), `.github\workflows\ci.yml`, `.github\release-notes.md`, `scripts\check-hygiene.cjs`, `scripts\check-installer.cjs`, `docs\RELEASING.md`; `scripts\smoke.cjs` can also drive a packaged app.

- **Installer:** electron-builder 26.18, NSIS, x64, **per user** (`oneClick: false`, `perMachine: false`, `allowElevation: false`, folder choice allowed), `Kartotek-Setup-<version>.exe`, product name Kartotek, version from `package.json` (0.1.0), the icon above. Only `desktop\`, `src\`, `samples\` and `package.json` go into the app; `samples\` stays outside the archive (`asarUnpack`) because the content service lists folders. Kartotek's licence, the content licence and `THIRD-PARTY-NOTICES.md` are installed in `resources\`; Electron's and Chromium's licence files are installed next to the executable.
- **Electron fuses** (section 2.4) are set by electron-builder: `RunAsNode` off, `NODE_OPTIONS` ignored, Node inspector flags off, `OnlyLoadAppFromAsar` on, ASAR integrity validation on, `file://` extra privileges off, cookie encryption on. Because the inspector flags are off, Playwright's Electron launcher cannot start the packaged app; the smoke test starts it with `--remote-debugging-port` and drives it over the DevTools protocol.
- **User data is outside the install:** `%APPDATA%\Kartotek` (profile) and the content folder. `deleteAppDataOnUninstall` is false (and only applies to one-click installers anyway). `scripts\check-installer.cjs` proves it on CI with a sentinel file: silent install, a second install over it (an update), the smoke test of the installed app, uninstall; the sentinel must survive each step. It refuses to run outside CI because it writes to the real profile folder.
- **Default content folder:** `Documents\Kartotek Content` is now the last candidate in the folder order (section 3.1), used when it exists, so an installed app finds the owner's content without a setting.
- **CI:** one workflow. Job `test` on every push and pull request: hygiene check, UI build and "committed build output equals a fresh build", `npm test`, browser export from the samples, sample audit, desktop smoke test. Job `installer` after it: build, fuse check, installer check; on a tag `vX.Y.Z` (which must equal the version in `package.json`) it also creates a **draft** GitHub Release with the installer and `SHA256SUMS.txt`, in the same job, so no artifacts travel between jobs. Actions used (versions checked on 2026-11-15): `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`; the release uses the GitHub CLI that is on the runner with the job's own token.
- **Not in C4:** the automatic updater (`electron-updater`) was planned for C4 in section 10 but was not part of the C4 task; 0.1.x has none, updating means running the newer installer. Code signing waits for decision 3 (SignPath, then Azure): the installer is unsigned, and Windows 11 Smart App Control can block it.
- **Dependency note:** `npm audit` reports 6 moderate findings that all trace to `minimatch` inside electron-builder (build tool, not shipped); the suggested fix would downgrade electron-builder to 25.1.0, which is not acceptable. Revisit when electron-builder updates.

### 10.0e D1 as built (2026-11-15)

Files: `ui\src\nav.js` (the model), `ui\src\Shell.jsx` (sidebar), `ui\src\tabs\Planned.jsx` (Career, Euro apply, Mock exam picker), `scripts\nav-tests.cjs`.

- **Layout:** a **Study | Planning** switch at the top of the sidebar, remembered between sessions. **Study** shows Review, Study, Cards, Mock exam and End-of-lesson test under one **Scope** selector (All, CEnT-S, TU Delft AE Prep). **Planning** shows the CEnT-S and TU Delft AE Prep overviews, Application, Euro apply (placeholder for D2) and Stats. Always visible, in both modes: the **AI Mind Mapping Assistant** group with Mind maps (the owner asked for it to stay a group of its own, not a Study entry), Career (a short "planned" page) and the **System** group (Settings, Algorithm). This replaces the two per-exam groups; section 7's table listed Mind maps under Study, the owner changed that.
- **Engine unchanged.** The tab ids (`study`, `etut`, `cards`, `cents-study`, `tud-mock`, `tud-apply` ...) are exactly the old ones, so `App.scope`, `App.examDecks`, saved `kartotek-tab` and `#hash` links work as before. `nav.js` maps a tab id to its mode, scope and entry (`locate`) and an entry plus scope back to a tab id (`studyTab`); picking a scope while on Review, Study, Cards or Mock exam opens the same entry for that scope (`study` becomes `cents-study`), picking it on an unscoped page (End-of-lesson test, Mind maps, Settings) only remembers it. Mode and scope come from the tab; for Mind maps, Career, Settings, Algorithm and End-of-lesson test the remembered ones stay (`kartotek-mode`, `kartotek-scope`, `kartotek-last-study`, `kartotek-last-planning`, written only after the app has booted).
- **Mock exam under All:** a mock belongs to one exam, so the entry opens a picker page (`mock-all`) with the two exams and their mock counts; the choice opens `cents-mock` or `tud-mock` and the scope follows. End-of-lesson test and Mind maps are not exam-scoped and look the same in every scope.
- **Badges** follow the scope (Review due, studies, cards, mock exams, Mind maps open items, open Application steps); keyboard: the arrow keys move through the visible entries of the mode and wrap, one entry is in the tab order, and the mode switch takes Left and Right; the tab transition direction follows the sidebar's reading order (`orderOf`).
- **Tests:** `npm test` has 14 navigation tests (every old tab id has a place, round trips, nothing from Planning in Study mode and the reverse, every old screen reachable). `npm run smoke` visits every entry in Study mode (3 scopes) and Planning mode, opens all 19 old tab ids, and checks that the mode and scope are remembered.

### 10.0f D2 as built (2026-11-15)

Files: `desktop\euroapply.js` (connection, plain Node), `ui\src\plan.js` (timeline), `ui\src\tabs\PlanningHome.jsx`, `ui\src\tabs\EuroApply.jsx` (the page and the Settings panel), `ui\src\tabs\home.css`, `scripts\euro-tests.cjs`; the bridge has `window.kartotek.euroapply` (`status`, `chooseFolder`, `clearFolder`, `read`, `open`, `start`).

- **Opening Euro apply (section 8.1 as designed).** Setting `euroApplyFolder` in `settings.json`, chosen with a folder picker in Planning, Euro apply (and in Settings); the choice is validated before it is saved (the folder must have `data\universities.json`). `KARTOTEK_EUROAPPLY` overrides it for tests and development. Without a folder the page is a short setup row. **Open** pings `http://127.0.0.1:5178/`; if it answers, Euro apply opens in a separate `BrowserWindow` (no preload, no Node, sandbox, its own session partition `persist:euroapply`, permission requests denied, navigation limited to `127.0.0.1:5178`, other `https:`/`claude:` links to the default browser, one window). If it does not answer the page offers **Start Euro apply**: Euro apply's own `tools\serve.ps1` is run hidden and the window opens when the server answers (up to 30 seconds). Closing Kartotek's main window closes the Euro apply window.
- **The launcher is started as a plain hidden child, not "detached".** A detached child gets no console on Windows and the launcher's own `Start-Process` silently does nothing (found by testing against a launcher that behaves like the real one: it logs the server to files and keeps running). The child keeps running when Kartotek closes, which is how the launcher is designed.
- **What is read (section 8.2).** Only `data\universities.json`, in the main process, never through the dev server, and the window receives a projection of only the fields the page uses (listed in `docs\PROGRESS.md`, task D2; the 8.2 table's city, country, priority and status list are not read because nothing displays them). Beyond the 8.2 table the page also reads the **programme-level** `timeline` items, because they hold deadlines the university-level list lacks (they have no `id`); items with no date are skipped. A parse error is retried once after 500 ms; an unknown or newer schema, a wrong shape, a missing file or a too large file are reported with their reason. Nothing is ever written into the Euro apply folder (the tests compare the folder before and after).
- **Planning home** (`home`, first entry of Planning): one timeline, `plan.js`. Rows: Kartotek's exam dates with pace per exam (always shown), the dated rows and the open steps of the Application page (loose step dates such as "Before 15 Jan" are placed at their first day or month, marked estimated when only a month is known, shown "now" when already past, and listed under "Without a date" when not recognised), and Euro apply's deadlines for universities that still have a programme that is not Rejected. Window: 30 days, 90 days (default) or all upcoming; Euro apply rows can be switched off. Every row says which app owns it and opens the screen it comes from (Kartotek rows the overview or the Application page, Euro apply rows the Euro apply window, or the Euro apply page when it is not running).
- **One row for what both apps know (decision of 2026-11-15: Euro apply owns it).** A Euro apply deadline of TU Delft that falls on the same day as an Application page row and shares a meaningful word with it (title or note) is one row owned by Euro apply, marked "also on the Application page", with a link to each; the Application page's copy is folded into it. The same deadline carried by several universities (a shared exam sitting) is one row naming them. Items that exist in one app only keep that app as owner.
- **Without Euro apply data** the page still shows Kartotek's own rows and a "What is missing" panel with the reason (folder not set, unreadable file, unknown format, or "only in the desktop app" in the browser build) and a button to set it up or try again.
- **Tests:** `npm test` has 16 tests for the connection (folder check, projection that never leaks other fields, unknown schemas, a half-written file, the launcher against a stand-in, nothing written) and the timeline (loose dates, owners, folding, merging, windows, missing data). `npm run smoke` covers Home, the setup row, a configured folder, and opening Euro apply in its own sealed window (a stand-in server on port 5178; if the owner's real Euro apply is running there, that one is opened).

### 10.0g E1 as built (2026-11-15)

Files: `desktop\models\` (`service.js` the layer, `anthropic.js`, `openai-compat.js`, `cli.js` the adapters, `schema.js`, `prompts.js`, `errors.js`, `prices.json`), `prompts\` (shipped prompt files and `schemas\`), `ui\src\tabs\ModelsPanel.jsx` (Settings, Models), `ui\src\tabs\ModelHint.jsx`, `scripts\model-tests.cjs`; `desktop\main.js` registers `models:*` and `prompts:*`; the bridge gained `window.kartotek.models` and `window.kartotek.prompts`. One runtime dependency: `@anthropic-ai/sdk` 1.8.0 (Apache-2.0), packed into `app.asar` with its own dependencies.

As designed in sections 5 and 6, with these differences:
- **Folder:** `desktop\models\` instead of `desktop\services\models\` (the other main-process modules sit directly in `desktop\`).
- **Schema check:** a small checker of Kartotek's own for the strict subset (types, properties, required, `additionalProperties`, items, enum, const, anyOf, allOf, local `$ref`, minItems) instead of Ajv: no second dependency, and the subset is exactly what the prompt schemas may use.
- **Anthropic:** the official SDK as decided; it sends API version `2026-10-21`, which refuses `temperature`, so the request carries none. `effort` is sent only to models that take it; the web search tool is `web_search_20260209` on current models, `web_search_20250305` on older ones. A `refusal` stop is the typed error `refused`.
- **OpenAI-compatible:** one fetch-based adapter with presets (OpenAI: `json_schema` and `max_completion_tokens`; Gemini through its OpenAI-compatible endpoint; OpenRouter; Ollama on `localhost:11434` with JSON mode; any other endpoint). Plain `http://` is accepted only for this PC. `prompt_tokens` includes cached tokens, so they are split before pricing.
- **Command-line clients:** Claude Code (`claude -p --output-format stream-json --verbose --include-partial-messages --permission-mode dontAsk [--model] [--json-schema]`, prompt on stdin, never `--bare`), Codex (`codex exec --json --skip-git-repo-check --ephemeral --sandbox read-only [-m] [--output-schema <file>] -`), and a custom command (stdout is the reply). Clients installed as `.cmd` shims can only be started through `cmd.exe`: then only fixed, character-checked arguments are passed and the schema is asked for in the prompt instead of `--json-schema`. Command-line clients take no images.
- **Prices:** `prices.json` ships Anthropic's list prices only (checked 2026-11-15); other providers' prices change too often to ship and are entered under Settings, Models, Prices. Unpriced API calls are counted as "unpriced".
- **Budget:** counts API-key calls only (subscription clients and local models are not money spent through Kartotek); the connection test always runs; "Allow calls for the rest of this month" lifts the stop until the month ends.
- **Prompt files** (decision 14): `prompts\connection-test.md` is the first one (the Test connection button uses it, with structured output). Overrides, the editor, the variable check, the "shipped text changed" flag and the override hash are built; E2 adds the feature prompts.
- **Not in E1:** the AI buttons still hand work to Claude Code (E2 moves them onto the layer); without a model each of them shows a "No model set up" hint that opens Settings, Models. The per-feature slot override (section 5.3, "advanced") is not built.
- **Tests:** `npm test` has 29 model-layer tests (fake provider for the layer; the real adapters against stand-ins: an Anthropic SSE stream through the SDK's `fetch` hook, an OpenAI-compatible server on 127.0.0.1, fake Claude Code and Codex scripts including a `.cmd` shim). `npm run smoke` adds a command-line client through the form and a local endpoint, runs Test connection for both in the real window and checks that a stored key is encrypted on disk and never returned. No test calls a real service.

### 10.0h E3 as built (2026-11-16)

Files: `desktop\jobs\` (`service.js` the job runner, `study.js`, `lesson.js`, `mock.js`, `mind.js` the pipelines, `extract.js` local reading of the sources, `engine.js` the engine's validators in a Node vm, `schemas.js`, `common.js`), the prompt files `prompts\study-*.md`, `item-*.md`, `lesson-*.md`, `mock-section.md`, `mind-*.md`, `source-transcribe.md`, `job-repair.md`, `ui\src\tabs\Jobs.jsx` (job cards, the estimate, the "from my files" form, the model choice), `scripts\job-tests.cjs`; the bridge gained `window.kartotek.jobs` (`pickFiles`, `list`, `get`, `create`, `start`, `pause`, `remove`, `openFolder`, `onEvent`). New runtime dependencies: `pdfjs-dist` 6.5.438 (Apache-2.0) and, through it, `@napi-rs/canvas` 1.1.1 (MIT, native; unpacked from the archive).

- **Jobs.** A job is a list of visible steps with tasks (per chunk of pages, topic, part or batch). After every task the job is written to `%APPDATA%\Kartotek\jobs\<id>\job.json`; a job that stops (pause, error, closed app) resumes from its last finished task. One job runs at a time; the rest wait in a queue. Every call goes through the model layer (`models.run`) with the strong slot, or with a provider and model chosen for this job; page images and mind maps use the vision slot (or a chosen vision model). The job keeps the running totals (calls, tokens, cost, time) and which provider and model wrote each task.
- **Before anything is sent** the files are read locally and the window shows an estimate per step (calls, tokens, the cost from the price table, "free" for a local model, "in your subscription" for a command-line client) with a range of 0.6× to 1.8×. Nothing goes to a model before **Start**.
- **Reading the sources (10.1 item 8):** pdf.js runs in the main process, not in a utility process: the reading is short and happens before the job starts; a utility process can come later if large books block the window. `.pptx` and `.docx` are read through a small zip reader of Kartotek's own, text files directly. A page whose text layer is empty or garbled is rendered to PNG and read by the vision slot (`source-transcribe`); a page that cannot be read becomes a gap. Old binary `.ppt`/`.doc` files are refused with a hint (the app does not use Office COM).
- **Study steps** (STUDY-RULES.md v2.3): units (per chunk of about 9000 characters) → relations → outline with the outcome ledger → a lesson per topic → part overviews → practice items per topic and connecting items per part → final items per part → whole-package audit → verification → save. Each step is its own structured call. Ids (`U`, `R`, `k`, `LO-`, `C-`, `q_id`) are assigned by the code, not by the model, so they are always unique. After each task, its own checks and those `KCycle.validate`/`KCycle.audit` messages on the assembled package that belong to the task go back to the model (`job-repair`), at most two repairs per task by default. The audit step sends each remaining blocker back to the task that owns it (the lesson, practice items or final items of one topic or part), for at most two rounds.
- **Verification.** Every practice and final item starts as `validation: "unverified"`. A separate call (`item-solve`) solves up to four items at a time from the source pages without the key; the code compares multiple-choice and numeric answers, and a rubric check (`item-judge`) compares written answers. A match makes the item `verified` (with a note). A mismatch makes it `disputed`, followed by one fix round (`item-fix`: the key is right, the item is corrected, or the source cannot settle it) and, unless the source cannot settle it, one more independent solve. Recall cards are left as the engine treats them.
- **The draft** is written to `studies\<etut_id>\etut.json` and `source.md` in the content folder, with copies of the source files in `sources\<etut_id>\`; an existing `etut.json` is kept as `etut.before-<job>.json`. The package records `generated_by`: the job, every writer with its call count, the writers per step, the verification counts, and whether it is certified. The app labels it as before ("draft · not certified" while the audit has blockers), plus a "written by …" chip. A package with structural errors (one the app could not open) is not written to the content folder; it stays in the job folder with its list of problems. Without a content folder the draft also stays in the job folder.
- **The same job type** writes end-of-lesson tests (`lessons\<id>\lesson.json`; 4 options, correct positions spread evenly by the code, every item solved again), mock exams (sections, counts, minutes, options and scoring from `KCents`; topics with their page extracts when they are in the content folder; batches of 10; `mocks\<id>\mock.json`), the exam Overview's "write next studies" (one study job per syllabus item, from its extract in `sources\`), and the mind-map tasks A/B (map.json) and C (one turn) through the vision slot, checked by `KMind.validateMap`/`validateTurn` before they are written. Turns are never overwritten.
- **Claude Code stays a route.** The Study library's "New study from my files" offers **Write in the app** (any provider, including the Claude Code command-line client) and **With Claude Code** (the earlier prompt); every other Claude Code prompt and link is unchanged.
- **Security.** The window never sends a file path: source files and photos come from the main process's file picker, and the window holds only tokens. Named files (extracts, map photos) are looked up only inside the content folder. The source text goes only to the provider the learner chose for the job.
- **Ollama.** The local preset now uses Ollama's own `/api/chat` instead of its OpenAI-compatible endpoint, for three things: `options.num_ctx` sized to the prompt (from 8192 up to the provider's maximum, 65536 by default, settable per provider), `format: <schema>` (the output is constrained to the JSON Schema while it is generated), and thinking switched on or off by effort (`gpt-oss` takes a level).
- **Tests.** `npm test` adds 13 writing-job tests with a scripted fake model and one test of the Ollama native path against a stand-in server. The writing-job tests cover strict schemas, the prompt files, reading `.pptx`, `.docx`, text and PDF with page images, a whole study with deliberate mistakes in four steps that still ends with 0 blockers, verification with a fix round and with an item that stays disputed, pause and resume after a restart, a failed call that is resumed, chosen targets and the vision slot, a lesson test, a mock exam, and a mind-map reading and turn.

### 10.1 Where `04-prompt-plan.md` should change

1. **C1**: add "provide a headless `npm test` that runs `src\tests.js` in Node" (the standing rule requires the suite before every commit; a desktop window is not a test runner). Add the security settings of section 2.4 to "done when". Note that the window starts with empty storage (different origin); testing with data means importing a backup.
2. **C2**: add the content-folder setting with a folder picker (the installed app has no `kartotek.config.json`) and the `kcontent://` protocol. Keep "the single-file browser build must still work" (decision 5 keeps it).
3. **C3**: work in the **dev profile** (`Kartotek-dev`); compare with a copy of the real backup but do not import into the real profile. Make the acceptance check "whole normalised state identical", not only counts. The claude.ai route is "export from the page, then import the file" (section 4.5), so C3 needs no cloud connector.
4. **C4**: the first run of the installed app performs the real import; confirm the installer's uninstall keeps `%APPDATA%\Kartotek`; mention Smart App Control next to SmartScreen in the README; publish to a **draft** release. Signing follows decision 3.
5. **E1**: add the prompt-file infrastructure (section 6: shipped files, overrides, editor, versioning) here, because E2's prompt says "each request's instructions live in editable prompt files" and E3 needs it too. Name the two API adapters (Anthropic native + OpenAI-compatible) and the CLI rule "no `--bare` for subscription use".
6. **F1**: drop "prompt files" from F1 (moved to E1); F1 keeps thinking fields and the confidence slider.
7. **D2**: name `data\universities.json` and the fields of section 8.2 as the only data read, and the launcher rule (Euro apply's own `serve.ps1`).
8. **E3**: PDF text extraction with pdf.js in a utility process; page images for the vision slot rendered the same way; jobs stored under `%APPDATA%\Kartotek\jobs\` so they resume after a restart.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Data loss during the switch | Old-format backups at every step, acceptance check on import, browser app kept as rollback, dev profile for development |
| Unsigned installer blocked or warned by Windows | Decision 3; README explains; SignPath or Azure signing before 1.0 |
| Electron upgrade churn | Automated dependency PRs; the smoke and engine tests decide; stay on a supported major |
| CLI clients change flags or output | Profiles isolated in one adapter with fixture tests; the CLI route is optional |
| Weaker models write weaker studies (E3) | Audit gate, "not certified" label, verification pass, honest comparison in E3 |
| Euro apply changes its data shape | Read only the listed fields, tolerate missing ones, show what is missing |
| Prices go stale | Dated shipped table, user-editable, costs labelled as estimates |

## 12. Decisions

**Decided 2026-11-15: the owner accepted every recommendation below as written (decisions 1–16).** The list is kept as the record. Changing one later needs the owner's word and an edit here first.

1. **Desktop shell.** Recommendation: **Electron** (section 1.3). Alternative: Tauri, if a small installer matters more than staying in one language.
2. **Packager and updater.** Recommendation: **electron-builder 26.x, NSIS per-user installer, electron-updater from GitHub Releases**. Alternative: Electron Forge 8 + Squirrel.Windows + update.electronjs.org.
3. **Code signing.** Recommendation: release 0.x **unsigned** with an honest README note (SmartScreen warning; Smart App Control may block it), and **apply to SignPath Foundation** for free open-source signing once the repository is public; fall back to **Azure Artifact Signing** (≈ $9.99 a month, eligibility to be confirmed at sign-up) if SignPath does not accept the project.
4. **Update behaviour.** Recommendation: check at start and every few hours, download in the background, install on quit, never restart during a session, with a setting to turn checks off.
5. **Single-file browser build.** Recommendation: **keep `build.ps1` as an optional export until 1.0** (it is the only route to the claude.ai cloud store and the rollback path), then decide whether to retire it.
6. **Content folder.** Recommendation: an app setting with a folder picker on first run, default `Documents\Kartotek Content`; development keeps `kartotek.config.json` and `KARTOTEK_CONTENT`; bundled samples when nothing is set.
7. **Data folder.** Recommendation: Electron's default `%APPDATA%\Kartotek` (Roaming); no "move data folder" option before 1.0.
8. **Backup retention.** Recommendation: 14 daily, 8 weekly, 12 monthly, `before-…` backups for 90 days and the latest five always.
9. **claude.ai cloud import.** Recommendation: no direct connector; the route is Export backup from the page on claude.ai, then import the file (section 4.5).
10. **API adapters.** Recommendation: **Anthropic native + one OpenAI-compatible adapter** (OpenAI, Gemini through its OpenAI-compatible endpoint, OpenRouter, Ollama); no native Google adapter until a needed feature is missing.
11. **CLI adapters.** Recommendation: Claude Code first, Codex second, plus a custom profile; runs in an empty working folder with no tools and `dontAsk`, prompt on stdin, never `--bare` for subscription use.
12. **Prices.** Recommendation: a dated price table shipped with the app and editable in Settings; no live price fetching.
13. **Euro apply launch.** Recommendation: open the running server at `127.0.0.1:5178` in a separate Kartotek window; if it is not running, start Euro apply's own `tools\serve.ps1`; read only `data\universities.json`.
14. **Prompt files.** Recommendation: move the prompt-file infrastructure from F1 to E1.
15. **Development profile.** Recommendation: development runs use `%APPDATA%\Kartotek-dev`; the real profile is created by the installed app in C4.
16. **Default slot mapping.** Recommendation: strong = study writing, typed-answer grading proposals, Feynman feedback; fast = Explain, follow-up items, Ask about this card, side questions; vision = mind maps and page images.

## Sources checked (2026-11-15)

- Electron releases (45.3.3 current, Chromium 156, Node 24.22; 45/44/43 stable lines): https://releases.electronjs.org/
- Electron auto-update options (update.electronjs.org needs a public GitHub repo; Squirrel.Windows): https://www.electronjs.org/docs/latest/tutorial/updates
- Electron `safeStorage` (DPAPI; sync API deprecated, removal planned in 46): https://www.electronjs.org/docs/latest/api/safe-storage
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron code signing (Azure Trusted Signing mentioned as the cheapest Windows option): https://www.electronjs.org/docs/latest/tutorial/code-signing
- electron-builder Windows and code signing, `verifyUpdateCodeSignature`, Azure signing (beta): https://www.electron.build/code-signing-win and https://www.electron.build/win ; v27 changes: https://www.electron.build/docs/migration/v27-breaking-changes/
- npm dist-tags: electron-builder latest 26.18.0 (next 27.0.0-alpha.14), electron-updater latest 6.8.11, @electron-forge/cli latest 8.0.1: https://registry.npmjs.org/
- Electron Forge Squirrel.Windows maker: https://www.electronforge.io/config/makers/squirrel.windows
- Tauri releases (tauri 2.12.3, cli 2.12.2, updater 2.13.3, shell 2.5.0, fs 2.7.0, dialog 2.8.2): https://v2.tauri.app/release/
- Tauri updater (mandatory signature, `latest.json`, Windows install modes): https://v2.tauri.app/plugin/updater/
- Tauri Windows signing (Artifact Signing, SmartScreen, Smart App Control): https://v2.tauri.app/distribute/sign/windows/
- Azure Artifact Signing pricing: https://azure.microsoft.com/pricing/details/artifact-signing/ ; price figures: https://www.devclass.com/security/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/4079554
- SignPath Foundation (free OSS signing): https://signpath.org/ and https://signpath.org/terms
- Claude Code headless (`-p`, `stream-json`, `--json-schema`, `--bare` skips subscription login, stdin cap): https://code.claude.com/docs/en/headless
- Anthropic structured outputs (`output_config.format`, schema limits): https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility
- Gemini OpenAI compatibility (beta): https://aistudio.google.com/docs/openai
- Codex non-interactive mode (`codex exec --json`, `--output-schema`): https://developers.openai.com/codex/noninteractive
