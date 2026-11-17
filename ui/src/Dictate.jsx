// Dictation (task F8, LEARNING-PROTOCOL 3.13): a microphone button for a text box.
// - Local model (the owner's choice, 2026-11-17): when it is downloaded (Settings, Models, Dictation), the button records the
//   microphone; pressing it again (or a 3-minute limit) stops, whisper turns the recording into text on this PC
//   (desktop\whisper.js), and the text is put at the cursor as ordinary, editable text. No audio leaves the PC.
// - Otherwise, in the desktop app: Windows voice typing opened at the cursor (desktop\dictation.js presses Win + H).
// - In the browser page, or if both fail: the box is focused and the Win + H shortcut is shown.
import React, { useEffect, useRef, useState } from "react";
import { Microphone, Stop, CircleNotch } from "@phosphor-icons/react";
import { encodeWav, insertAt } from "./dictation-lib.js";

const D = () => window.kartotek && window.kartotek.dictation;
const MAX_MS = 3 * 60 * 1000;
let modeCache = null, waiters = [];
export function readDictationMode(fresh) {
  if (!D()) return Promise.resolve({ mode: null });
  if (modeCache && !fresh) return Promise.resolve(modeCache);
  return Promise.all([D().status().catch(() => null), D().local ? D().local().catch(() => null) : null]).then(([a, b]) => {
    const local = b && b.ok ? b.value : null, vt = a && a.ok ? a.value : null;
    modeCache = { mode: local && local.installed ? "local" : vt && vt.mode ? "voice-typing" : null, local };
    waiters.forEach((f) => f(modeCache));
    return modeCache;
  });
}
function useDictationMode() {
  const [m, setM] = useState(modeCache || { mode: null });
  useEffect(() => { waiters.push(setM); readDictationMode().then(setM); return () => { waiters = waiters.filter((f) => f !== setM); }; }, []);
  return m;
}

// The dictation language (English, Turkish, Italian), one choice for every button, remembered on this PC
const LANG_PREF = "kartotek-dictation-lang";
let langNow = (() => { try { return window.App.pref(LANG_PREF) || "en"; } catch (e) { return "en"; } })(), langWaiters = [];
function useDictationLang() {
  const [l, setL] = useState(langNow);
  useEffect(() => { langWaiters.push(setL); return () => { langWaiters = langWaiters.filter((f) => f !== setL); }; }, []);
  const set = (v) => { langNow = v; try { window.App.setPref(LANG_PREF, v); } catch (e) { /* ignore */ } langWaiters.forEach((f) => f(v)); };
  return [l, set];
}

// Writes the new value through the native setter so React's onChange sees it, then puts the cursor after the dictated text
function putText(el, text) {
  const r = insertAt(el.value, el.selectionStart, el.selectionEnd, text, el.maxLength > 0 ? el.maxLength : 0);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(el, r.value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  try { el.setSelectionRange(r.caret, r.caret); } catch (e) { /* not a text box */ }
  return r;
}

// A recording → 16 kHz mono samples
async function toWav(blob) {
  const raw = await blob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(raw);
    const len = Math.max(1, Math.ceil(audio.duration * 16000));
    const off = new OfflineAudioContext(1, len, 16000);
    const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
    const out = await off.startRendering();
    return encodeWav(out.getChannelData(0), 16000);
  } finally { ctx.close().catch(() => {}); }
}

function nearBox(el) {
  let n = el;
  for (let i = 0; n && i < 6; i++) {
    n = n.parentElement;
    if (!n) break;
    const tas = [...n.querySelectorAll("textarea")].filter((t) => t.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (tas.length) return tas[tas.length - 1];
  }
  return null;
}

// targetRef: the textarea; onBeforeStart: e.g. unfold the box that holds it
export default function Dictate({ targetRef, onBeforeStart, disabled, label }) {
  const st = useDictationMode();
  const [lang0, setLang] = useDictationLang();
  const langs = (st.local && st.local.languages) || [];
  const lang = langs.some((x) => x.code === lang0) ? lang0 : "en";
  const [msg, setMsg] = useState(null);         // { kind: "on" | "hint" | "error" | "done", text }
  const [rec, setRec] = useState(null);          // "recording" | "transcribing" | null
  const [secs, setSecs] = useState(0);
  const r = useRef({});
  useEffect(() => () => { const x = r.current; if (x.timer) clearInterval(x.timer); if (x.stream) x.stream.getTracks().forEach((t) => t.stop()); }, []);

  const root = useRef(null);
  // Without targetRef: the text box just before the button (the nearest one above it in the page)
  const box = () => (targetRef && targetRef.current) || nearBox(root.current);
  const focusBox = () => {
    const el = box();
    if (el && document.activeElement !== el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) { /* not a text box */ } }
  };
  const remember = () => { const el = box(); if (el) r.current.sel = [el.selectionStart, el.selectionEnd]; };

  const startLocal = async () => {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { setMsg({ kind: "error", text: "The microphone could not be opened (" + ((e && e.name) || "error") + "). Check Windows Settings, Privacy, Microphone." }); return; }
    const chunks = [], mr = new MediaRecorder(stream);
    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(r.current.timer); r.current.timer = null;
      setRec("transcribing"); setMsg(null);
      try {
        const wav = await toWav(new Blob(chunks, { type: mr.mimeType }));
        const res = await D().transcribe(wav, lang);
        if (!res || !res.ok) throw new Error((res && res.error) || "Transcribing failed.");
        const text = res.value.text;
        const el = box();
        if (!text) setMsg({ kind: "error", text: "No speech was heard." });
        else if (el) {
          el.focus();
          const sel = r.current.sel; if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } }
          const put = putText(el, text);
          setMsg({ kind: "done", text: put.cut ? "Added, shortened to fit the box." : "Added at the cursor; edit it as you like." });
        }
      } catch (e) { setMsg({ kind: "error", text: (e && e.message) || "Transcribing failed." }); }
      setRec(null);
    };
    r.current = Object.assign(r.current, { mr, stream, started: Date.now() });
    mr.start();
    setRec("recording"); setSecs(0); setMsg(null);
    r.current.timer = setInterval(() => {
      const ms = Date.now() - r.current.started; setSecs(Math.floor(ms / 1000));
      if (ms >= MAX_MS && r.current.mr && r.current.mr.state === "recording") r.current.mr.stop();
    }, 250);
  };

  const go = async () => {
    if (rec === "recording") { if (r.current.mr && r.current.mr.state === "recording") r.current.mr.stop(); return; }
    if (rec) return;
    if (onBeforeStart) onBeforeStart();
    await new Promise((res) => setTimeout(res, 40));   // let a folded box open before focusing it
    focusBox(); remember();
    if (st.mode === "local") return startLocal();
    if (st.mode !== "voice-typing" || !D()) { setMsg({ kind: "hint" }); return; }
    const res = await D().start().catch((e) => ({ ok: false, error: e && e.message }));
    focusBox();
    if (res && res.ok) setMsg({ kind: "on", text: "Voice typing is open: speak, and your words appear at the cursor. It stops after a pause; press Dictate to go on." });
    else setMsg({ kind: "error", text: ((res && res.error) || "Voice typing did not open.") + " Press Win + H instead." });
  };

  const recording = rec === "recording", busy = rec === "transcribing";
  return (
    <span className="dc" ref={root}>
      {/* mousedown is prevented so the box keeps its cursor position while the button is pressed */}
      <button type="button" className={"k-btn sm dc-btn" + (recording ? " is-rec" : "")} disabled={disabled || busy} onMouseDown={(e) => e.preventDefault()} onClick={go}
        aria-pressed={recording} aria-label={recording ? "Stop dictating" : label || "Dictate"}
        title={st.mode === "local" ? "Records your voice; press again to stop. The text is made on this PC and put at the cursor." : st.mode === "voice-typing" ? "Opens Windows voice typing at the cursor in this box." : "Focuses the box. Press the Windows key and H to speak instead of typing."}>
        {recording ? <Stop size={14} weight="fill" aria-hidden="true" /> : busy ? <CircleNotch size={14} className="mc-spin" aria-hidden="true" /> : <Microphone size={14} aria-hidden="true" />}
        {recording ? "Stop (" + Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0") + ")" : busy ? "Writing…" : label || "Dictate"}
      </button>
      {st.mode === "local" && langs.length > 1 && <LangButtons langs={langs} lang={lang} setLang={setLang} disabled={!!rec} />}
      {recording && <span className="k-small k-muted" role="status">Listening{lang !== "en" ? " (" + (langs.find((x) => x.code === lang) || {}).label + ")" : ""}. Speak, then press Stop.</span>}
      {msg && (msg.kind === "on" || msg.kind === "done" || msg.kind === "error") && <span className="k-small k-muted" role="status">{msg.text}</span>}
      {msg && msg.kind === "hint" && <span className="k-small k-muted" role="status">Press <kbd>Win</kbd> + <kbd>H</kbd> and speak.</span>}
    </span>
  );
}

// Settings, Models: the local dictation model (download on request, progress, remove)
// The language buttons (shared by every Dictate button and the Settings panel)
function LangButtons({ langs, lang, setLang, disabled }) {
  return (
    <span className="dc-langs" role="radiogroup" aria-label="Dictation language" title="The language you will speak">
      {langs.map((x) => (
        <button key={x.code} type="button" role="radio" aria-checked={lang === x.code} className={"dc-lang" + (lang === x.code ? " on" : "")} disabled={disabled}
          onMouseDown={(e) => e.preventDefault()} onClick={() => setLang(x.code)}>{x.label}</button>
      ))}
    </span>
  );
}

export function DictationPanel() {
  const st = useDictationMode();
  const [lang0, setLang] = useDictationLang();
  const [tryText, setTryText] = useState("");
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState("");
  if (!D() || !D().local) return null;
  const local = st.local;
  const install = async (which) => {
    setErr(""); setProg({ which, done: 0, total: 1 });
    const res = await D().install((ev) => { if (ev && ev.total) setProg(Object.assign({ which }, ev)); }, which);
    setProg(null);
    if (!res || !res.ok) setErr((res && res.error) || "The download failed.");
    readDictationMode(true);
  };
  const remove = async (which) => { await D().remove(which); readDictationMode(true); };
  const pct = prog && prog.total ? Math.floor((100 * prog.done) / prog.total) : 0;
  return (
    <section className="k-panel k-sec dc-panel">
      <h3 className="cy-h3"><Microphone size={16} aria-hidden="true" /> Dictation</h3>
      {!local || !local.available ? <p className="k-small">{(local && local.reason) || "Not available here."} The Dictate buttons use Windows voice typing (Win + H).</p> : (
        <>
          <p className="k-small">{local.installed
            ? "Ready: " + local.model + " turns your voice into text on this PC with " + local.program + ". Nothing you say leaves the PC."
            : "The Dictate buttons use Windows voice typing (Win + H) until you download the local model: " + local.model + " and " + local.program + ", about " + local.downloadMB + " MB, from GitHub and Hugging Face, each checked against a fixed checksum."}</p>
          <div className="cy-actions">
            {!local.installed && <button type="button" className="k-btn sm primary" disabled={!!prog} onClick={() => install("en")}>{prog && prog.which === "en" ? "Downloading… " + pct + "%" : "Download the local model (" + local.downloadMB + " MB)"}</button>}
            {local.installed && <button type="button" className="k-btn sm" disabled={!!prog} onClick={() => remove()}>Remove the local model</button>}
          </div>
          {(local.languages || []).length > 1 && (
            <div className="cy-actions"><span className="k-small"><b>I dictate in:</b></span>
              <LangButtons langs={local.languages} lang={local.languages.some((x) => x.code === lang0) ? lang0 : "en"} setLang={setLang} />
              <span className="k-small k-muted">The same choice shows beside every Dictate button.</span>
            </div>
          )}
          {local.installed && (
            <div className="dc-try">
              <label className="k-field">
                <span className="k-field-label">Try it here (nothing is saved)</span>
                <textarea className="k-input" rows={3} value={tryText} maxLength={4000} onChange={(e) => setTryText(e.target.value)}
                  placeholder="Press Dictate, speak a sentence or two, then press Stop. In your study screens the same button sits under every answer, thinking and Feynman box." />
              </label>
              <div className="th-foot"><Dictate /></div>
            </div>
          )}
          <p className="k-small"><b>Turkish and Italian:</b> {local.multi
            ? "ready (" + local.multiModel + ")."
            : "they need a second model, " + local.multiModel + ", about " + local.multiMB + " MB from Hugging Face, checked the same way. English keeps using the English model."}</p>
          <div className="cy-actions">
            {!local.multi && <button type="button" className="k-btn sm" disabled={!!prog} onClick={() => install("multi")}>{prog && prog.which === "multi" ? "Downloading… " + pct + "%" : "Add Turkish and Italian (" + local.multiMB + " MB)"}</button>}
            {local.multi && <button type="button" className="k-btn sm" disabled={!!prog} onClick={() => remove("multi")}>Remove Turkish and Italian</button>}
            {err && <span className="k-small k-muted">{err}</span>}
          </div>
          <p className="k-small k-muted">Transcribing runs only after you press Stop, on at most 4 processor threads at low priority, so the PC stays cool. The multilingual model is a little less accurate than the English one, so English stays on the English model.</p>
        </>
      )}
    </section>
  );
}
