'use strict';
// The data calls of the bridge (task C3) without Electron: argument checks and { ok, value } / { ok: false, error } results.
// desktop/main.js registers them as IPC handlers; the tests call them directly with a real data store in a temp folder.
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const isGen = (g) => Number.isInteger(g) && g > 0;
const isText = (t) => typeof t === 'string' && t.length <= MAX_IMPORT_BYTES;
const isStateLike = (s) => !!s && typeof s === 'object' && !Array.isArray(s) && !!s.cards && typeof s.cards === 'object' && Array.isArray(s.reviews);

function makeDataApi(getStore) {
  const api = {
    load: () => getStore().load(),
    info: () => getStore().info(),
    write: (cs) => {
      if (!cs || typeof cs !== 'object') throw new Error('Invalid change set.');
      if (cs.all && !isStateLike(cs.state)) throw new Error('Invalid state.');
      return getStore().write(cs);
    },
    replaceAll: async (state, reason, sourceText, label) => {
      if (!isStateLike(state)) throw new Error('This is not a Kartotek state.');
      let source = null;
      if (sourceText != null) {
        if (!isText(sourceText)) throw new Error('The source file is too large.');
        source = getStore().keepImportSource(sourceText, typeof label === 'string' ? label : 'source');
      }
      const r = await getStore().replaceAll(state, typeof reason === 'string' ? reason : 'import');
      return Object.assign(r, { source });
    },
    confirm: (g) => { if (!isGen(g)) throw new Error('Invalid generation.'); return getStore().confirm(g); },
    revert: (g) => { if (!isGen(g)) throw new Error('Invalid generation.'); return getStore().revert(g); },
    backupNow: (reason) => getStore().backupNow(typeof reason === 'string' ? reason : 'manual'),
    listBackups: () => getStore().listBackups(),
    readBackup: (id) => { if (typeof id !== 'string') throw new Error('Invalid backup.'); return getStore().readBackup(id); },
  };
  // Wrapped: every call resolves to { ok, value } or { ok: false, error }, as over IPC. Arguments and results are copied
  // (structuredClone), as IPC copies them, so a caller in the same process can never share objects with the store.
  const wrapped = {};
  Object.keys(api).forEach((k) => {
    wrapped[k] = async (...args) => {
      try { return { ok: true, value: structuredClone(await api[k](...structuredClone(args))) }; } catch (e) { return { ok: false, error: e.message }; }
    };
  });
  return wrapped;
}

module.exports = { makeDataApi, MAX_IMPORT_BYTES, isText };
