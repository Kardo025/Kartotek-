'use strict';
// Prompts as editable files (ARCHITECTURE.md section 6, moved to E1 by decision 14).
// Shipped prompts: <app>\prompts\<id>.md with front matter (id, version, slot, schema, variables) and the instruction text.
// Overrides: <userData>\prompts\<id>.md (the same format; "based_on" records the shipped version it was edited from).
// Schemas (<app>\prompts\schemas\) are never user-editable. Templating is plain {{name}} replacement with no code; every inserted
// value is fenced so learner text cannot read as instructions. Every rendered prompt carries its id, version and, for an override,
// a short hash of its text.
// Shared fragments (decision D16, task F3): prompts\shared\<name>.md, listed and edited as the prompt 'shared-<name>' (override
// <userData>\prompts\shared-<name>.md). A prompt names the fragments it uses in its front matter (includes: [shared/voice, ...]); render()
// inserts them before the prompt's closing "Answer with JSON only" paragraph, so each rule is written once for every agent.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

function parsePromptFile(raw) {
  // A file checked out with Windows line endings reads the same as one with Unix endings
  const text = String(raw || '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  m[1].split(/\r?\n/).forEach((line) => {
    const x = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (!x) return;
    let v = x[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else if (/^\d+$/.test(v)) v = Number(v);
    meta[x[1]] = v;
  });
  return { meta, body: m[2].trim() };
}

function variablesIn(body) {
  const out = new Set();
  const re = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;
  let m;
  while ((m = re.exec(body))) out.add(m[1]);
  return Array.from(out);
}

const hashOf = (t) => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 12);

// A fenced value: the fence is longer than any run of backticks inside it
function fence(value) {
  const s = String(value == null ? '' : value);
  let n = 3;
  const runs = s.match(/`+/g) || [];
  runs.forEach((r) => { if (r.length >= n) n = r.length + 1; });
  const f = '`'.repeat(n);
  return f + 'text\n' + s + '\n' + f;
}

function createPrompts(opts) {
  const shippedDir = opts.shippedDir;             // <app>\prompts
  const overrideDir = path.join(opts.userDir, 'prompts');

  // A shared fragment 'shared-<name>' is the file prompts\shared\<name>.md (decision D16, task F3)
  function shippedFile(id) {
    const top = path.join(shippedDir, id + '.md');
    if (/^shared-/.test(id) && !fs.existsSync(top)) return path.join(shippedDir, 'shared', id.slice(7) + '.md');
    return top;
  }
  function readShipped(id) {
    if (!ID_RE.test(id)) return null;
    try { return parsePromptFile(fs.readFileSync(shippedFile(id), 'utf8')); } catch (e) { return null; }
  }
  // 'shared/voice' (as written in includes:) -> 'shared-voice'
  const fragmentId = (name) => 'shared-' + String(name || '').replace(/^shared[\\/-]/, '');
  function readOverride(id) {
    if (!ID_RE.test(id)) return null;
    try { return parsePromptFile(fs.readFileSync(path.join(overrideDir, id + '.md'), 'utf8')); } catch (e) { return null; }
  }
  function ids() {
    let top = [], shared = [];
    try { top = fs.readdirSync(shippedDir).filter((f) => /\.md$/.test(f) && f !== 'README.md').map((f) => f.slice(0, -3)); } catch (e) { /* none */ }
    try { shared = fs.readdirSync(path.join(shippedDir, 'shared')).filter((f) => /\.md$/.test(f)).map((f) => 'shared-' + f.slice(0, -3)); } catch (e) { /* none */ }
    return top.concat(shared).filter((id) => ID_RE.test(id)).sort();
  }

  function list() {
    return ids().map((id) => {
      const s = readShipped(id), o = readOverride(id);
      const version = s.meta.version || 1;
      return { id, title: s.meta.title || id, version, slot: s.meta.slot || null, variables: s.meta.variables || variablesIn(s.body), schema: s.meta.schema || null,
        fragment: /^shared-/.test(id), includes: Array.isArray(s.meta.includes) ? s.meta.includes.map(fragmentId) : [], draft: s.meta.status === 'draft',
        edited: !!o, basedOn: o ? (o.meta.based_on || null) : null, defaultChanged: !!o && (o.meta.based_on || 0) < version };
    });
  }

  function get(id) {
    const s = readShipped(id);
    if (!s) throw new Error('Unknown prompt: ' + id);
    const o = readOverride(id);
    return { id, meta: s.meta, defaultText: s.body, overrideText: o ? o.body : null, basedOn: o ? (o.meta.based_on || null) : null, schema: schemaOf(s.meta) };
  }

  function schemaOf(meta) {
    if (!meta.schema) return null;
    const f = path.resolve(shippedDir, String(meta.schema));
    if (!f.startsWith(path.resolve(shippedDir) + path.sep)) return null;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
  }

  // Saves an override after checking that every variable of the shipped prompt is still used
  function saveOverride(id, text) {
    const s = readShipped(id);
    if (!s) throw new Error('Unknown prompt: ' + id);
    const body = String(text || '').trim();
    if (!body) throw new Error('The prompt is empty. Use "Reset to default" to go back to the shipped text.');
    if (body.length > 100000) throw new Error('The prompt is too long.');
    const required = s.meta.variables || variablesIn(s.body);
    const missing = required.filter((v) => variablesIn(body).indexOf(v) < 0);
    if (missing.length) throw new Error('These placeholders must stay in the prompt: ' + missing.map((v) => '{{' + v + '}}').join(', '));
    const unknown = variablesIn(body).filter((v) => required.indexOf(v) < 0);
    if (unknown.length) throw new Error('Unknown placeholders: ' + unknown.map((v) => '{{' + v + '}}').join(', '));
    fs.mkdirSync(overrideDir, { recursive: true });
    const file = path.join(overrideDir, id + '.md');
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, '---\nid: ' + id + '\nbased_on: ' + (s.meta.version || 1) + '\n---\n' + body + '\n');
    fs.renameSync(tmp, file);
    return get(id);
  }

  function resetOverride(id) {
    if (!ID_RE.test(id)) throw new Error('Unknown prompt: ' + id);
    try { fs.unlinkSync(path.join(overrideDir, id + '.md')); } catch (e) { /* none */ }
    return get(id);
  }

  // Renders a prompt: { text, promptId, promptVersion, promptHash (override only), slot, schema }
  function render(id, vars) {
    const p = get(id);
    let text = p.overrideText != null ? p.overrideText : p.defaultText;
    let edited = p.overrideText != null;
    const v = vars || {};
    // values first, so neither a learner's text nor a fragment is ever searched for placeholders
    text = text.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (all, name) => (Object.prototype.hasOwnProperty.call(v, name) ? fence(v[name]) : all));
    // shared fragments (includes:), each the shipped text or its override, before the closing "Answer with JSON only" paragraph
    const inc = Array.isArray(p.meta.includes) ? p.meta.includes : [];
    if (inc.length) {
      const block = inc.map((name) => {
        const fid = fragmentId(name), s = readShipped(fid);
        if (!s) throw new Error('Prompt ' + id + ' includes an unknown fragment: ' + name);
        const o = readOverride(fid);
        if (o) edited = true;
        return (o ? o.body : s.body).trim();
      }).join('\n\n');
      const at = text.search(/^Answer with JSON only/m);
      text = at >= 0 ? text.slice(0, at) + block + '\n\n' + text.slice(at) : text + '\n\n' + block;
    }
    return { text, promptId: id, promptVersion: p.meta.version || 1, promptHash: edited ? hashOf(text) : null, slot: p.meta.slot || null, schema: p.schema };
  }

  return { list, get, saveOverride, resetOverride, render };
}

module.exports = { createPrompts, parsePromptFile, variablesIn, fence };
