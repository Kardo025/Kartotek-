'use strict';
// The bridge (ARCHITECTURE.md section 2.2): the only API the window sees. Later tasks add the rest.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kartotek', Object.freeze({
  app: Object.freeze({
    // { ok: true, value: { version, platform, dev, electron } }
    info: () => ipcRenderer.invoke('app:info'),
  }),
  content: Object.freeze({
    // Reads every package from the content folder (and the samples): { ok, value: { contentDir, etuts, extras, ..., problems } }
    load: () => ipcRenderer.invoke('content:load'),
    // Folder picker; saves the choice. { ok, value: { changed, contentDir? } }
    chooseFolder: () => ipcRenderer.invoke('content:chooseFolder'),
    // Shows the content folder in Explorer
    openFolder: () => ipcRenderer.invoke('content:openFolder'),
    // The folder changed on disk. Returns a function that stops listening.
    onChanged: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('content:changed', handler);
      return () => ipcRenderer.removeListener('content:changed', handler);
    },
  }),
  // Euro apply (task D2): its folder setting, a read-only projection of its universities file, and opening it in its own window
  euroapply: Object.freeze({
    status: () => ipcRenderer.invoke('euroapply:status'),
    chooseFolder: () => ipcRenderer.invoke('euroapply:chooseFolder'),
    clearFolder: () => ipcRenderer.invoke('euroapply:clearFolder'),
    read: () => ipcRenderer.invoke('euroapply:read'),
    open: () => ipcRenderer.invoke('euroapply:open'),
    start: () => ipcRenderer.invoke('euroapply:start'),
  }),
  // Learner data in files (task C3). Every call resolves to { ok, value } or { ok: false, error }.
  data: Object.freeze({
    load: () => ipcRenderer.invoke('data:load'),
    info: () => ipcRenderer.invoke('data:info'),
    write: (changeset) => ipcRenderer.invoke('data:write', changeset),
    replaceAll: (state, reason, sourceText, label) => ipcRenderer.invoke('data:replaceAll', state, reason, sourceText, label),
    confirm: (generation) => ipcRenderer.invoke('data:confirm', generation),
    revert: (generation) => ipcRenderer.invoke('data:revert', generation),
    backupNow: (reason) => ipcRenderer.invoke('data:backupNow', reason),
    listBackups: () => ipcRenderer.invoke('data:listBackups'),
    readBackup: (id) => ipcRenderer.invoke('data:readBackup', id),
    pickImportFile: () => ipcRenderer.invoke('data:pickImportFile'),
    saveFile: (name, text) => ipcRenderer.invoke('data:saveFile', name, text),
    openFolder: (which) => ipcRenderer.invoke('data:openFolder', which),
    // The window is about to close: the callback writes what is pending; then the main process closes the window.
    onFlushRequest: (callback) => {
      const handler = () => { Promise.resolve().then(callback).catch(() => {}).then(() => ipcRenderer.send('data:flushed')); };
      ipcRenderer.on('data:flush-request', handler);
      return () => ipcRenderer.removeListener('data:flush-request', handler);
    },
  }),
}));
