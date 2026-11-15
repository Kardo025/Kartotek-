'use strict';
// Draws the Kartotek icon (the favicon design of src/index.html: a coral tile with a card outline) at every size and writes
// build/icon.png (512 px, used by electron-builder) and build/icon.ico (16 to 256 px, PNG entries). Plain Node, no dependencies:
// `node scripts/make-icon.cjs`. The output is committed so a release build needs nothing else.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CORAL = [255, 107, 91];
const INK = [26, 11, 9];

// Signed distance to a rounded rectangle (negative inside)
function sdRoundRect(px, py, x, y, w, h, r) {
  const cx = x + w / 2, cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r), qy = Math.abs(py - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Colour at a point of the 32 x 32 design: [r, g, b, a]
function sample(x, y) {
  if (sdRoundRect(x, y, 0, 0, 32, 32, 8) > 0) return [0, 0, 0, 0];
  const outline = Math.abs(sdRoundRect(x, y, 7, 9, 18, 14, 2.5)) <= 1.1;
  const rule = x >= 7 && x <= 25 && Math.abs(y - 14) <= 1.1;
  return (outline || rule) ? INK.concat(255) : CORAL.concat(255);
}

function render(size) {
  const ss = 4; // 4 x 4 samples per pixel
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let j = 0; j < size; j++) {
    raw[j * (size * 4 + 1)] = 0; // PNG filter: none
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < ss; sj++) for (let si = 0; si < ss; si++) {
        const c = sample(((i + (si + 0.5) / ss) / size) * 32, ((j + (sj + 0.5) / ss) / size) * 32);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
      const o = j * (size * 4 + 1) + 1 + i * 4;
      if (a > 0) { raw[o] = Math.round(r / a); raw[o + 1] = Math.round(g / a); raw[o + 2] = Math.round(b / a); }
      raw[o + 3] = Math.round(a / (ss * ss));
    }
  }
  return png(size, raw);
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ICO with PNG-compressed entries
function ico(sizes) {
  const images = sizes.map((s) => ({ s, data: render(s) }));
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach((im, i) => {
    const o = 6 + 16 * i;
    head[o] = im.s >= 256 ? 0 : im.s; head[o + 1] = im.s >= 256 ? 0 : im.s; head[o + 2] = 0; head[o + 3] = 0;
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(im.data.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += im.data.length;
  });
  return Buffer.concat([head].concat(images.map((im) => im.data)));
}

const out = path.join(__dirname, '..', 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), render(512));
fs.writeFileSync(path.join(out, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
console.log('wrote build/icon.png and build/icon.ico');
