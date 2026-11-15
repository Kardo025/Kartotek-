## Kartotek __VERSION__

A spaced-repetition and study app for Windows. This is an early release.

### Install

1. Download **Kartotek-Setup-__VERSION__.exe** below.
2. Run it. It installs for your user only and needs no administrator rights.
3. Your learner data lives in `%APPDATA%\Kartotek`, outside the install folder. Installing, updating and uninstalling never touch it.

### This installer is not signed

Windows will show a **SmartScreen** warning ("Windows protected your PC"): choose **More info**, then **Run anyway**. On Windows 11 with **Smart App Control** turned on, Windows may block the installer outright; Smart App Control cannot be bypassed for a single file, so the app cannot be installed on such a PC until it is signed. You can check the file against `SHA256SUMS.txt`:

```
certutil -hashfile Kartotek-Setup-__VERSION__.exe SHA256
```

### Your content

Put your studies, lesson tests, mock exams and mind maps in a folder called `Kartotek Content` in your Documents, or choose another folder in **Settings, Content**. Without one, the app shows two built-in sample studies. See the README for the folder layout.

### Moving from the browser page

In the page you used before: Settings, Data, **Export backup (JSON)**. Start the desktop app and choose **Import a backup file** on the first screen. The app checks the import against the file and keeps a dated backup.
