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
  // The model layer (task E1). Keys go in and never come back. Errors: { ok: false, error, code, advice }.
  models: Object.freeze({
    config: () => ipcRenderer.invoke('models:config'),
    status: () => ipcRenderer.invoke('models:status'),
    saveProvider: (provider, key) => ipcRenderer.invoke('models:saveProvider', provider, key),
    setKey: (id, key) => ipcRenderer.invoke('models:setKey', id, key),
    clearKey: (id) => ipcRenderer.invoke('models:clearKey', id),
    removeProvider: (id) => ipcRenderer.invoke('models:removeProvider', id),
    setSlot: (slot, id, model) => ipcRenderer.invoke('models:setSlot', slot, id, model),
    setBudget: (usd) => ipcRenderer.invoke('models:setBudget', usd),
    allowOverBudget: () => ipcRenderer.invoke('models:allowOverBudget'),
    setPrice: (model, price) => ipcRenderer.invoke('models:setPrice', model, price),
    listModels: (id) => ipcRenderer.invoke('models:listModels', id),
    usage: (month) => ipcRenderer.invoke('models:usage', month),
    // Starts a call; onEvent gets { type: 'text' | 'status', ... } while it runs. Resolves to { ok, value: result }.
    run: (callId, request, onEvent) => withEvents(callId, onEvent, () => ipcRenderer.invoke('models:run', callId, request)),
    test: (callId, id, model, onEvent) => withEvents(callId, onEvent, () => ipcRenderer.invoke('models:test', callId, id, model)),
    cancel: (callId) => ipcRenderer.invoke('models:cancel', callId),
  }),
  // Writing jobs (task E3). Files are chosen in the main process's picker; the window only holds tokens.
  jobs: Object.freeze({
    pickFiles: (which) => ipcRenderer.invoke('jobs:pickFiles', which),
    list: () => ipcRenderer.invoke('jobs:list'),
    get: (id) => ipcRenderer.invoke('jobs:get', id),
    create: (kind, request, choice) => ipcRenderer.invoke('jobs:create', kind, request, choice),
    start: (id, choice) => ipcRenderer.invoke('jobs:start', id, choice),
    pause: (id) => ipcRenderer.invoke('jobs:pause', id),
    remove: (id) => ipcRenderer.invoke('jobs:remove', id),
    openFolder: (id) => ipcRenderer.invoke('jobs:openFolder', id),
    // { type: 'job', job } | { type: 'removed', id }. Returns a function that stops listening.
    onEvent: (callback) => {
      const handler = (e, ev) => { try { callback(ev); } catch (x) { /* listener error */ } };
      ipcRenderer.on('jobs:event', handler);
      return () => ipcRenderer.removeListener('jobs:event', handler);
    },
  }),
  prompts: Object.freeze({
    list: () => ipcRenderer.invoke('prompts:list'),
    get: (id) => ipcRenderer.invoke('prompts:get', id),
    saveOverride: (id, text) => ipcRenderer.invoke('prompts:saveOverride', id, text),
    resetOverride: (id) => ipcRenderer.invoke('prompts:resetOverride', id),
    render: (id, vars) => ipcRenderer.invoke('prompts:render', id, vars),
  }),
}));

// Routes 'models:event' messages of one call to its listener while the call runs
function withEvents(callId, onEvent, start) {
  const handler = (e, msg) => { if (msg && msg.callId === callId && typeof onEvent === 'function') { try { onEvent(msg.event); } catch (x) { /* listener error */ } } };
  ipcRenderer.on('models:event', handler);
  return start().finally(() => ipcRenderer.removeListener('models:event', handler));
}
