'use strict';
// The learner's own files for a live session (task F4, LEARNING-PROTOCOL 2.4). The files are read here, in the main process, with the
// writing jobs' local reader (pdf.js, .pptx, .docx, text); the window never gets a file path. The text is cached in
// <userData>\live\<session id>\material.json so a paused session can resume after a restart; the learner data (and so the backups)
// keep only each file's name, SHA-256 and page count. Nothing is uploaded anywhere except the pages a model request contains.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID = /^ls-[a-z0-9]{4,40}$/;
const MAX_CHARS = 600000;

function createLiveFiles(opts) {
  const base = path.join(opts.dir, 'live');
  const extract = opts.extract;
  const fileOf = (id) => {
    if (!ID.test(String(id))) throw new Error('Unknown session.');
    return path.join(base, id, 'material.json');
  };
  const refLabel = (src, unit, n) => src + ' ' + (unit === 'slide' ? 'slide ' : unit === 'section' ? 'section ' : unit === 'part' ? 'part ' : 'p. ') + n;

  // files: absolute paths chosen in the picker → { files: [{ id, name, sha256, unit, pages, unreadable }], pages, chars }
  async function read(sessionId, files) {
    const target = fileOf(sessionId);
    if (!Array.isArray(files) || !files.length) throw new Error('Choose at least one file.');
    if (files.length > 12) throw new Error('At most 12 files per session.');
    const sources = await extract.extractSources(files, {});
    const pages = [], info = [];
    let chars = 0;
    sources.forEach((s, i) => {
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(files[i])).digest('hex');
      let unreadable = 0;
      s.pages.forEach((p) => {
        const text = String(p.text || '').trim();
        if (!p.reliable || !text) { unreadable++; if (!text) return; }
        if (chars + text.length > MAX_CHARS) return;
        chars += text.length;
        pages.push({ ref: refLabel(s.id, s.unit, p.n), src: s.id, n: p.n, text });
      });
      info.push({ id: s.id, name: s.name, sha256, unit: s.unit, pages: s.pages.length, unreadable });
    });
    if (!pages.length) throw new Error('No readable text was found in these files (scanned pages are not read in a live session).');
    const material = { v: 1, session: sessionId, at: Date.now(), files: info, pages };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target + '.tmp', JSON.stringify(material));
    fs.renameSync(target + '.tmp', target);
    return { files: info, pages: pages.length, chars };
  }
  // The cached material of a session, or null when it is not on this PC (the files must be chosen again)
  function get(sessionId) {
    try { return JSON.parse(fs.readFileSync(fileOf(sessionId), 'utf8')); } catch (e) { if (e && /Unknown session/.test(e.message)) throw e; return null; }
  }
  return { read, get };
}

module.exports = { createLiveFiles };
