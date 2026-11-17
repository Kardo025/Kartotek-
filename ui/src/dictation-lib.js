// Pure helpers of local dictation (task F8): a recording as 16 kHz mono 16-bit WAV, and dictated text placed at the cursor.
// Tested by scripts\dictation-tests.cjs.

// Float samples (-1..1) → WAV bytes (PCM 16-bit, mono)
export function encodeWav(samples, rate) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i] || 0)); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return buf;
}

// The text after inserting `text` in place of value[start, end): a space is added where words would run together, and the result
// keeps within maxLength (the dictated part is shortened, never what was already there). Returns { value, caret, cut }.
export function insertAt(value, start, end, text, maxLength) {
  const v = String(value || ""), t0 = String(text || "").trim();
  const s = Math.max(0, Math.min(start == null ? v.length : start, v.length)), e = Math.max(s, Math.min(end == null ? s : end, v.length));
  if (!t0) return { value: v, caret: e, cut: false };
  const before = v.slice(0, s), after = v.slice(e);
  const lead = before && !/\s$/.test(before) && !/^[.,;:!?)]/.test(t0) ? " " : "";
  const trail = after && !/^[\s.,;:!?)]/.test(after) ? " " : "";
  let t = lead + t0 + trail, cut = false;
  if (maxLength && before.length + t.length + after.length > maxLength) {
    t = t.slice(0, Math.max(0, maxLength - before.length - after.length)); cut = true;
  }
  return { value: before + t + after, caret: before.length + t.length, cut };
}
