# Changelog

All notable changes to Kartotek. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/). Your learner data is never rewritten in place: every release that changes the saved format carries a lossless migration, and `docs/PROGRESS.md` records how each one was tested.

## [1.0.0] - 2026-11-17

The first release with models, live teaching and the knowledge graph. Everything from 0.1.0 keeps working, and the app still needs no model.

### Added

- **Desktop app and installer.** An Electron window that reads your content folder at start and on **Reload content** (no build step), lists packages that fail their checks, and an unsigned per-user Windows installer (`Kartotek-Setup-<version>.exe`) built and checked by CI with a draft release (the installer check proves your data is untouched by install, update and uninstall).
- **Learner data in files.** The state lives in `%APPDATA%\Kartotek\data` (generation-named files, a manifest with a SHA-256 per file, crash recovery) with a dated backup every day. Importing a backup or restoring one is kept only if every count matches and the state reads back identical.
- **Study and Planning modes** with a combined Planning timeline, and a read-only connection to the separate Euro apply app.
- **Model layer** (Settings, Models): an API key (Anthropic, OpenAI, Google Gemini, OpenRouter), a subscription command-line client (Claude Code, Codex, custom), or a local model (Ollama or any OpenAI-compatible endpoint). Three task slots (strong, fast, vision), a connection test, usage and budget, editable prompt files. Keys are encrypted with Windows' protection for your account.
- **Models while studying:** Explain, Practice this again, typed-answer grading proposals you confirm, Feynman feedback, Ask about this card, side questions ("Ask about this") and "Check this" (a brief with sources whose links are checked).
- **Thinking and confidence:** an optional thinking field on every answer, a 0 to 100 confidence slider (the old three bands are derived from it), "I don't know" as a gap, calibration views in Stats.
- **Hint ladder:** one rung at a time (R0 to R5) with a free statement repair; the engine refuses a rung above the one asked and any leak of the answer.
- **Find my level and the plan map**, **live sessions** (predict, teach, check, repair; pause and resume), **adaptive practice** (difficulty 1 to 6, each problem solved and checked before it is shown, re-tests of misses, disputes) and the **knowledge graph** (seeded from the studies, your own records, evidence and memory per idea).
- **Writing jobs:** studies, end-of-lesson tests, mock exams and mind-map readings written in the app from your PDF, .pptx, .docx or text files, with an estimate first, checks and repairs, an independent solve of every question, pause and resume, and a draft that records its writer.
- **Dictation:** a local speech model (whisper.cpp; English, optionally Turkish and Italian), downloaded only on request with fixed checksums; Windows voice typing without it.
- **Stats:** a "Generated questions" calibration view for answers to model-written questions (probe, live checks, practice), kept apart from the main calibration.
- `CHANGELOG.md`, README screenshots (`scripts/screenshots.cjs`) and `docs/REVIEW.md`, an independent review of everything since the baseline.

### Changed

- The hygiene check (`npm run hygiene`, also in CI) now scans every file and commit message reachable from any branch or tag, not only the current tree.
- Mind-map photos are copied next to `Kartotek-DSR.html` by `build.ps1`, so the browser page shows them again.
- Text on solid coral surfaces (the dictation language buttons, the selected option letter in mock exams, the exam tick) uses the dark `--k-accent-text` colour so it passes contrast.
- A writing job that needs the model to read images (mind-map photos, scanned pages) now says before it starts when the vision slot cannot read them, and Start is disabled with the reason. Ollama is asked whether the model has the vision capability.
- The git history was rewritten once to remove a local Windows path from one commit of the progress log; no code or content changed.

### Safety

- The scheduler is untouched: generated questions, hints, Explain, side questions and model gradings you did not confirm never move a card. A reviewer's integrity test on a copy of a real backup found the review queue identical card for card to the baseline engine.

### Known limits

- The installer is not code-signed. Windows SmartScreen warns, and Windows 11 Smart App Control may block it.
- There is no automatic updater: run the newer installer.
- Local models can be slow on a laptop; scanned pages and mind-map photos need a model that reads images.

## [0.1.0] - 2026-11-15

The first tagged version (`v0.1.0`; its draft GitHub release was never published): the D-S-R scheduler, Review, legacy and Study v2 topic cycles, end-of-lesson tests, mock exams, mind maps, exam sections, statistics and the Algorithm page, as one web page built by `build.ps1`, with the content folder outside the repository and synthetic samples inside it.
