/*
 * Kartotek content-folder setting (UI-independent).
 * build.ps1 writes the resolved content folder into the page ({"contentDir": "..."} in #kartotek-config); it is empty when
 * only the samples in the repository are used. Prompts and links that point Claude Code at files read it from here.
 */
(function (global) {
  'use strict';
  var dir = null;
  function contentDir() {
    if (dir !== null) return dir;
    dir = '';
    try {
      var el = global.document && global.document.getElementById('kartotek-config');
      var c = el ? JSON.parse(el.textContent) : null;
      if (c && typeof c.contentDir === 'string') dir = c.contentDir;
    } catch (e) { /* no config */ }
    return dir;
  }
  // A path inside the content folder; without a configured folder it stays relative (the samples folder)
  function join(sub) { var d = contentDir(); return d ? d.replace(/[\\/]+$/, '') + '\\' + sub : sub; }
  // A claude://code/new link; the "folder" part is added only when a content folder is configured
  function claudeLink(prompt) {
    var d = contentDir();
    return 'claude://code/new?q=' + encodeURIComponent(prompt) + (d ? '&folder=' + encodeURIComponent(d) : '');
  }
  // The desktop app learns the folder from its main process at run time (src/host.js)
  function set(value) { dir = typeof value === 'string' ? value : ''; }
  global.KConfig = { contentDir: contentDir, join: join, claudeLink: claudeLink, set: set };
})(typeof window !== 'undefined' ? window : this);
