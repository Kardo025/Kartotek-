# Releasing Kartotek

How to cut a release of the Windows installer. A release is a git tag `vX.Y.Z`; pushing the tag makes GitHub Actions test everything, build the installer and attach it to a **draft** release. You read the draft and press Publish. Nothing is published by itself.

The release process is described in `docs/ARCHITECTURE.md` (sections 1.4 and 9) and the decisions behind it (electron-builder, per-user NSIS installer, unsigned 0.x, draft releases) in section 12.

## Before you start

- The work is merged into `main` and the **CI** run on `main` is green (tests, browser export, sample audit, desktop smoke test, installer check).
- `npm run hygiene` passes locally (no private content tracked). CI runs it too.
- Your own checks: the Algorithm tab shows all tests passed, and the app starts with your data (below).

## Cut the release

1. Choose the version. Kartotek uses `0.x.y` until 1.0: `0.1.0` is the first public release, patches (`0.1.1`) fix bugs, minors (`0.2.0`) add features.
2. Set the version in one place, without creating a tag yet:
   ```
   npm version 0.1.0 --no-git-tag-version
   ```
   This edits `package.json` and `package-lock.json`. The installer file name, the app's version and the release title all come from it.
3. Commit it: `git commit -am "Release 0.1.0"`.
4. Tag that commit and push both (each push needs your decision; nothing is pushed for you):
   ```
   git tag -a v0.1.0 -m "Kartotek 0.1.0"
   git push origin main v0.1.0
   ```
5. Watch **Actions**. The run for the tag does everything the normal CI does, and then, in the `installer` job:
   - checks that the tag equals `v` plus the version in `package.json` (a mismatch stops the release),
   - builds `dist-installer/Kartotek-Setup-<version>.exe` with `npm run dist`,
   - checks the Electron fuses of the packaged app,
   - installs the installer silently into a temporary folder, installs it again over the first install (an update), runs the smoke test against the installed app, uninstalls it, and checks after every step that `%APPDATA%\Kartotek` was not touched,
   - creates a **draft** release with the installer and `SHA256SUMS.txt`, using the text in `.github/release-notes.md` (version filled in).
6. Open **Releases**, open the draft, read the notes, edit them if something changed (for example a known problem), and download the installer once to check it:
   - on a PC: run it (SmartScreen will warn, see below), start the app, check that your data and content are there;
   - compare the checksum: `certutil -hashfile Kartotek-Setup-0.1.0.exe SHA256` against `SHA256SUMS.txt`.
7. Press **Publish release**. Only now can anyone download it.

## If the run fails

- A failure before the release step leaves no release: fix the problem on a branch, merge, and push a new tag (for an unpublished mistake you can first delete the tag: `git push --delete origin v0.1.0` and `git tag -d v0.1.0`).
- A draft you do not want: delete the draft on the Releases page, then delete the tag as above.
- A published release with a problem: do not move the tag. Publish a fix as the next patch version (`0.1.1`) and say so in its notes. You can mark the bad release as a pre-release or delete it.

## Build the installer on your own PC

```
npm ci
npm run dist
```

The installer appears in `dist-installer\`. Building works anywhere. **Running** the unsigned `Kartotek.exe` or the installer may be blocked by Windows 11 Smart App Control (see the README); the CI runner has no such policy, which is why the release is built and checked there. If the output folder is locked by a virus scanner, build into another folder with `npx electron-builder --win --x64 --publish never --config.directories.output=dist-installer-2` (these folders are git-ignored).

## What the installer does with your data

- It installs per user into `%LOCALAPPDATA%\Programs\Kartotek` and needs no administrator rights.
- Your learner data is in `%APPDATA%\Kartotek` (the `data` folder and `settings.json`). The installer and the uninstaller never touch it; the CI installer check proves that on every release.
- An update is the same installer run over the old install. There is no automatic updater in 0.1.x.
- Your content folder (default `Documents\Kartotek Content`) is outside both folders.

## The unsigned installer

0.x releases are **not code-signed** (decision 3). Windows shows a SmartScreen warning for an unknown publisher: "More info", then "Run anyway". On Windows 11 with **Smart App Control** on, Windows may refuse to run the installer at all, and there is no per-file bypass; the only ways around it are to turn Smart App Control off (it can only be turned back on by resetting Windows) or to use a signed build. The README and the release notes say so.

Signing comes before 1.0: apply to the SignPath Foundation (free for open-source projects) and fall back to Azure Artifact Signing if that is not accepted. When a certificate exists, add it to the `installer` job only (secrets are never used in the test job) and electron-builder signs the executables, the uninstaller and the installer.

## Things that change a release

- **App name, icon, ids:** `electron-builder.yml` (`productName`, `appId`, `win.icon`). The icon is drawn by `scripts/make-icon.cjs` (`npm run icon`) into `build/`; the output is committed.
- **What goes into the app:** `files` and `asarUnpack` in `electron-builder.yml`. Studies, mind maps, research notes and course material are never in it; `npm run hygiene` and the installer check guard that.
- **Dependencies:** `npm audit` is part of the review of every release. Today the only advisory is a moderate one in a dependency of electron-builder (build tool, not shipped); see `docs/PROGRESS.md` (task C4).
- **Notices:** regenerate `THIRD-PARTY-NOTICES.md` when a shipped dependency changes.
