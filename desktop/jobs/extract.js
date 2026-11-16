'use strict';
// Reading the learner's source files locally, in the main process (task E3, ARCHITECTURE.md section 10.1 item 8).
// Nothing is uploaded here: the text goes to a model only through the job that the learner started.
//   PDF            pdf.js (pdfjs-dist, legacy build for Node): the text layer per page; pages whose text layer is missing or
//                  garbled are rendered to PNG (@napi-rs/canvas, the renderer pdf.js uses in Node) for the vision slot.
//   .pptx / .docx  read as zip archives: slide text in presentation order with speaker notes; Word paragraphs.
//   .txt .md .srt .vtt   read as text, split into sections of about 6000 characters.
// Old binary .ppt / .doc files are refused with a hint (save them as .pptx / .docx or PDF first).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_FILE = 200 * 1024 * 1024;
const TEXT_SECTION = 6000;

// ---- a small zip reader (central directory, stored or deflated entries); enough for Office files
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    entries[name] = { method, csize, local };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: Object.keys(entries),
    read(name) {
      const e = entries[name];
      if (!e) return null;
      const lnameLen = buf.readUInt16LE(e.local + 26), lextra = buf.readUInt16LE(e.local + 28);
      const start = e.local + 30 + lnameLen + lextra;
      const data = buf.slice(start, start + e.csize);
      if (e.method === 0) return data.toString('utf8');
      if (e.method === 8) return zlib.inflateRawSync(data).toString('utf8');
      throw new Error('unsupported zip compression');
    },
  };
}

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unxml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(c) ? String.fromCodePoint(c) : all; }
    return XML_ENT[e] != null ? XML_ENT[e] : all;
  });
}
// Paragraph texts of an Office XML part: paragraphs = <a:p> (DrawingML) or <w:p> (Word), runs = <a:t> / <w:t>
function paragraphs(xml, ns) {
  const out = [];
  const pre = new RegExp('<' + ns + ':p[ >][\\s\\S]*?</' + ns + ':p>', 'g');
  const tre = new RegExp('<' + ns + ':t(?: [^>]*)?>([\\s\\S]*?)</' + ns + ':t>', 'g');
  let m;
  while ((m = pre.exec(xml))) {
    let t = '', r;
    while ((r = tre.exec(m[0]))) t += unxml(r[1]);
    if (/<\w+:tab\/>/.test(m[0]) && !t) t = '\t';
    if (t.trim()) out.push(t.trim());
  }
  return out;
}
function relsOf(zip, part) {
  const dir = path.posix.dirname(part), base = path.posix.basename(part);
  const xml = zip.read(dir + '/_rels/' + base + '.rels');
  const out = {};
  if (!xml) return out;
  const re = /<Relationship\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const id = /Id="([^"]+)"/.exec(m[1]), target = /Target="([^"]+)"/.exec(m[1]), type = /Type="([^"]+)"/.exec(m[1]);
    if (id && target) out[id[1]] = { target: path.posix.normalize(path.posix.join(dir, target[1])), type: type ? type[1] : '' };
  }
  return out;
}

function readPptx(buf) {
  const zip = readZip(buf);
  const pres = zip.read('ppt/presentation.xml');
  if (!pres) throw new Error('this .pptx has no presentation part');
  const rels = relsOf(zip, 'ppt/presentation.xml');
  const order = [];
  const re = /<p:sldId\b[^>]*r:id="([^"]+)"/g;
  let m;
  while ((m = re.exec(pres))) if (rels[m[1]]) order.push(rels[m[1]].target);
  return order.map((part, i) => {
    const xml = zip.read(part) || '';
    const lines = paragraphs(xml, 'a');
    const srels = relsOf(zip, part);
    const notesPart = Object.values(srels).find((r) => /notesSlide$/.test(r.type));
    const notes = notesPart ? paragraphs(zip.read(notesPart.target) || '', 'a').filter((l) => !/^\d+$/.test(l)) : [];
    const pics = (xml.match(/<p:pic\b/g) || []).length;
    let text = lines.join('\n');
    if (notes.length) text += '\n[Speaker notes] ' + notes.join('\n');
    return { n: i + 1, text, pictures: pics };
  });
}

function readDocx(buf) {
  const zip = readZip(buf);
  const xml = zip.read('word/document.xml');
  if (!xml) throw new Error('this .docx has no document part');
  return splitText(paragraphs(xml, 'w').join('\n'));
}

function splitText(text) {
  const out = [];
  const paras = String(text).replace(/\r\n?/g, '\n').split(/\n/);
  let cur = '';
  paras.forEach((p) => {
    if (cur.length + p.length + 1 > TEXT_SECTION && cur) { out.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + p;
  });
  if (cur.trim() || !out.length) out.push(cur);
  return out.map((t, i) => ({ n: i + 1, text: t }));
}

// A page's text layer is unreliable when it is (nearly) empty or mostly not letters, digits and punctuation: scanned pages,
// handwriting, or fonts without a Unicode map. Those pages go to the vision slot as images.
function textQuality(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 40) return { reliable: false, reason: t.length ? 'very little text on the page' : 'no text layer' };
  const bad = (t.match(/[�\u0000-\u0008-]/g) || []).length;
  const ok = (t.match(/[\p{L}\p{N}\s.,;:!?()[\]{}'"\-–—=+*/<>%°^_|≤≥≈±×÷√∑∫πθλμΩαβγδ→←]/gu) || []).length;
  if (bad / t.length > 0.02) return { reliable: false, reason: 'unreadable characters in the text layer' };
  if (ok / t.length < 0.85) return { reliable: false, reason: 'the text layer looks garbled' };
  return { reliable: true, reason: null };
}

let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function readPdf(file, opts) {
  const lib = await pdfjs();
  const data = new Uint8Array(fs.readFileSync(file));
  const loading = lib.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await loading.promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let text = '';
      tc.items.forEach((it) => { if (typeof it.str === 'string') text += it.str + (it.hasEOL ? '\n' : ''); });
      text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      const q = textQuality(text);
      const entry = { n: i, text, reliable: q.reliable, reason: q.reason, image: null };
      if ((!q.reliable || opts.imagesForAll) && opts.imageDir) entry.image = await renderPage(page, path.join(opts.imageDir, opts.sourceId + '-p' + i + '.png'));
      page.cleanup();
      pages.push(entry);
      if (opts.onProgress) opts.onProgress(i, doc.numPages);
    }
  } finally { await (doc.destroy ? doc.destroy() : loading.destroy()); }
  return pages;
}

async function renderPage(page, out) {
  const { createCanvas } = require('@napi-rs/canvas');
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1, 1400 / Math.max(vp1.width, vp1.height)));
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvas, viewport: vp }).promise;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  return out;
}

// Resizes a photo (mind maps) to at most `max` pixels on its long side, as JPEG; returns { data (base64), mime, width, height }
async function imageForModel(file, max) {
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const img = await loadImage(fs.readFileSync(file));
  const s = Math.min(1, (max || 1600) / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const c = createCanvas(w, h);
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return { data: c.toBuffer('image/jpeg', 88).toString('base64'), mime: 'image/jpeg', width: img.width, height: img.height };
}

const TYPES = { '.pdf': 'pdf', '.pptx': 'pptx', '.docx': 'docx', '.txt': 'text', '.md': 'text', '.srt': 'transcript', '.vtt': 'transcript' };

// Reads every file: [{ id: 'S1', title, file, name, type, unit, pages: [{ n, text, reliable, reason, image }] }]
async function extractSources(files, opts) {
  opts = opts || {};
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i], ext = path.extname(file).toLowerCase(), id = 'S' + (i + 1);
    const st = fs.statSync(file);
    if (st.size > MAX_FILE) throw new Error(path.basename(file) + ' is larger than 200 MB.');
    if (ext === '.ppt' || ext === '.doc') throw new Error(path.basename(file) + ' is an old binary Office file. Save it as ' + (ext === '.ppt' ? '.pptx' : '.docx') + ' or PDF first.');
    const type = TYPES[ext];
    if (!type) throw new Error(path.basename(file) + ': only PDF, .pptx, .docx, .txt, .md, .srt and .vtt files can be read.');
    let pages, unit = 'page';
    if (type === 'pdf') pages = await readPdf(file, Object.assign({}, opts, { sourceId: id, onProgress: opts.onProgress ? (n, total) => opts.onProgress(id, n, total) : null }));
    else if (type === 'pptx') { unit = 'slide'; pages = readPptx(fs.readFileSync(file)).map((s) => Object.assign(s, textQuality(s.text).reliable || !s.pictures ? { reliable: true, reason: null } : { reliable: false, reason: 'the slide is mostly a picture' }, { image: null })); }
    else if (type === 'docx') { unit = 'section'; pages = readDocx(fs.readFileSync(file)).map((s) => Object.assign(s, { reliable: true, reason: null, image: null })); }
    else { unit = type === 'transcript' ? 'part' : 'section'; pages = splitText(fs.readFileSync(file, 'utf8')).map((s) => Object.assign(s, { reliable: true, reason: null, image: null })); }
    out.push({ id, title: path.basename(file, ext), file, name: path.basename(file), type: type === 'transcript' ? 'transcript' : type, unit, pages });
  }
  return out;
}

module.exports = { extractSources, readZip, readPptx, readDocx, splitText, textQuality, imageForModel, unxml, paragraphs };
