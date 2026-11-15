'use strict';
// Command-line adapter (ARCHITECTURE.md section 5.2 b): uses a subscription through a locally installed client run headless.
// Profiles: Claude Code (first), Codex, and a custom command. Rules: the executable is resolved once (PATH or a full path); arguments
// are an array and never go through a shell; the prompt goes through stdin, never the command line; the working folder is the
// app's own empty folder (no project hooks, no .mcp.json); one process per call; a timeout; cancel kills the process tree.
// npm installs some clients as .cmd shims, which Windows can only start through cmd.exe: then only fixed, safe arguments are passed
// and a JSON schema is not put on the command line (the model layer asks for JSON in the prompt and validates it instead).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { ModelError } = require('./errors');

const PROFILES = {
  'claude-code': { label: 'Claude Code', command: 'claude', parser: 'claude-stream', structured: 'native', costKind: 'subscription-estimate' },
  codex: { label: 'Codex', command: 'codex', parser: 'codex-jsonl', structured: 'native', costKind: 'subscription-estimate' },
  custom: { label: 'Command-line client', command: '', parser: 'text', structured: 'json-mode', costKind: 'subscription-estimate' },
};

// Finds an executable on PATH (Windows: with PATHEXT). A path with a folder part is checked as it is.
function resolveExecutable(command, env) {
  if (!command) return null;
  const e = env || process.env;
  const exts = process.platform === 'win32' ? (e.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const tryFile = (f) => { try { return fs.statSync(f).isFile() ? f : null; } catch (x) { return null; } };
  const withExt = (base) => {
    if (path.extname(base)) { const hit = tryFile(base); if (hit) return hit; }
    for (const x of exts) { const hit = tryFile(base + x.toLowerCase()) || tryFile(base + x); if (hit) return hit; }
    return null;
  };
  if (/[\\/]/.test(command)) return withExt(path.resolve(command));
  for (const dir of String(e.PATH || e.Path || '').split(path.delimiter).filter(Boolean)) {
    const hit = withExt(path.join(dir, command));
    if (hit) return hit;
  }
  return null;
}

function isShim(file) { return /\.(cmd|bat)$/i.test(file || ''); }
// An argument cmd.exe passes through unchanged inside double quotes
function shimSafe(a) { return /^[A-Za-z0-9 _.,:=\/\\+@-]*$/.test(a); }

// Builds the arguments for a call. Returns { args, schemaFile, stdin }.
function buildCall(profileId, cfg, req, shim, tmpDir) {
  const prompt = renderPrompt(req, profileId === 'custom' || (shim && req.schema));
  if (profileId === 'claude-code') {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'dontAsk'];
    if (req.model) args.push('--model', req.model);
    if (req.schema && !shim) args.push('--json-schema', JSON.stringify(req.schema));
    return { args, stdin: prompt };
  }
  if (profileId === 'codex') {
    const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only'];
    if (req.model) args.push('-m', req.model);
    let schemaFile = null;
    if (req.schema) {
      schemaFile = path.join(tmpDir, 'schema-' + process.pid + '-' + Date.now() + '.json');
      fs.writeFileSync(schemaFile, JSON.stringify(req.schema));
      args.push('--output-schema', schemaFile);
    }
    args.push('-');
    return { args, schemaFile, stdin: prompt };
  }
  return { args: splitArgs(cfg.args || ''), stdin: prompt };
}

// The prompt as one text for stdin: the system text first, then the conversation, then (when the schema cannot be passed natively)
// the instruction to answer with JSON matching it
function renderPrompt(req, inlineSchema) {
  const parts = [];
  if (req.system) parts.push(req.system);
  req.messages.forEach((m) => {
    const text = typeof m.content === 'string' ? m.content : m.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n\n');
    parts.push(req.messages.length > 1 ? (m.role === 'user' ? 'User: ' : 'Assistant: ') + text : text);
  });
  if (req.schema && inlineSchema) parts.push('Answer with JSON only, no other text, matching this JSON Schema:\n' + JSON.stringify(req.schema));
  return parts.join('\n\n');
}

// Splits a custom argument line on spaces; "double quotes" group words
function splitArgs(line) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(line)))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

function killTree(child) {
  if (!child || child.exitCode != null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGTERM');
  } catch (e) { /* already gone */ }
}

// ---- output parsers: each gets lines and returns { text, structured, usage, costUsd, model, error }
function parseClaudeLine(j, st, onEvent) {
  if (j.type === 'stream_event' && j.event && j.event.type === 'content_block_delta' && j.event.delta && j.event.delta.type === 'text_delta') {
    st.streamed += j.event.delta.text; onEvent({ type: 'text', delta: j.event.delta.text });
  } else if (j.type === 'system' && j.subtype === 'init' && j.model) {
    st.model = j.model;
  } else if (j.type === 'system' && j.subtype === 'api_retry') {
    onEvent({ type: 'status', text: 'Retrying (' + (j.error || 'error') + ', attempt ' + j.attempt + ')' });
  } else if (j.type === 'result') {
    st.done = true;
    if (j.is_error || (j.subtype && j.subtype !== 'success')) st.error = String(j.result || j.subtype || 'The run failed.');
    st.text = typeof j.result === 'string' ? j.result : st.streamed;
    if (j.structured_output !== undefined) st.structured = j.structured_output;
    const u = j.usage || {};
    st.usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 };
    if (typeof j.total_cost_usd === 'number') st.costUsd = j.total_cost_usd;
  }
}

function parseCodexLine(j, st, onEvent) {
  if (j.type === 'item.completed' && j.item && j.item.type === 'agent_message' && typeof j.item.text === 'string') {
    st.text = j.item.text; onEvent({ type: 'text', delta: j.item.text });
  } else if (j.type === 'turn.completed') {
    st.done = true;
    const u = j.usage || {};
    st.usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cached_input_tokens || 0, cacheWrite: 0 };
  } else if (j.type === 'turn.failed' || j.type === 'error') {
    st.error = String((j.error && (j.error.message || j.error)) || j.message || 'The run failed.');
  }
}

function classifyFailure(message) {
  const m = String(message || '');
  if (/log ?in|logged out|not authenticated|authenticat|credential|api key|unauthori[sz]ed|401/i.test(m)) return 'auth';
  if (/rate limit|usage limit|429|overloaded|quota/i.test(m)) return 'rate-limit';
  return 'provider';
}

function createCli(cfg) {
  // cfg: { profile: 'claude-code' | 'codex' | 'custom', command?, args? (custom), workDir, timeoutMs?, env?, spawnImpl? (tests) }
  const profileId = PROFILES[cfg.profile] ? cfg.profile : 'custom';
  const profile = PROFILES[profileId];
  const command = cfg.command || profile.command;
  const env = Object.assign({}, cfg.env || process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const spawnImpl = cfg.spawnImpl || spawn;
  const resolved = () => (cfg.spawnImpl ? command : resolveExecutable(command, env));

  return {
    kind: 'cli',
    profile: profileId,
    executable: resolved,
    capabilities() { return { stream: profileId === 'claude-code', structured: profileId === 'custom' ? 'json-mode' : 'native', images: false, webSearch: false }; },
    async listModels() { return []; },
    run(req, { signal, onEvent }) {
      return new Promise((resolve, reject) => {
        const exe = resolved();
        if (!exe) { reject(new ModelError('cli-missing', (profile.label || 'The client') + ' was not found' + (command ? ' ("' + command + '")' : '') + '.')); return; }
        if (req.messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'image'))) { reject(new ModelError('invalid', 'This command-line client cannot take images. Use the vision slot with an API or local model.')); return; }
        fs.mkdirSync(cfg.workDir, { recursive: true });
        const shim = !cfg.spawnImpl && isShim(exe);
        const call = buildCall(profileId, cfg, req, shim, cfg.workDir);
        let child;
        try {
          if (shim) {
            const unsafe = call.args.filter((a) => !shimSafe(a));
            if (unsafe.length) { reject(new ModelError('invalid', 'These arguments cannot be passed to a .cmd client safely: ' + unsafe.join(' '))); return; }
            const line = ['"' + exe + '"'].concat(call.args.map((a) => '"' + a + '"')).join(' ');
            child = spawnImpl(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + line + '"'], { cwd: cfg.workDir, env, windowsHide: true, windowsVerbatimArguments: true });
          } else {
            child = spawnImpl(exe, call.args, { cwd: cfg.workDir, env, windowsHide: true, shell: false });
          }
        } catch (e) { reject(new ModelError('cli-missing', 'The client could not be started: ' + e.message)); return; }

        const st = { text: '', streamed: '', structured: undefined, usage: null, costUsd: null, model: req.model || null, error: null, done: false };
        let out = '', err = '', settled = false;
        const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); if (call.schemaFile) { try { fs.rmSync(call.schemaFile, { force: true }); } catch (e) { /* in use */ } } fn(); };
        const timer = setTimeout(() => { killTree(child); finish(() => reject(new ModelError('timeout', 'The client did not answer within ' + Math.round((cfg.timeoutMs || 300000) / 1000) + ' seconds.'))); }, cfg.timeoutMs || 300000);
        const onAbort = () => { killTree(child); finish(() => reject(new ModelError('cancelled', 'The call was cancelled.'))); };
        if (signal) { if (signal.aborted) { onAbort(); return; } signal.addEventListener('abort', onAbort, { once: true }); }

        const handleLine = (line) => {
          if (profileId === 'custom') return;
          const l = line.trim();
          if (!l || l[0] !== '{') return;
          let j; try { j = JSON.parse(l); } catch (e) { return; }
          if (profileId === 'claude-code') parseClaudeLine(j, st, onEvent);
          else parseCodexLine(j, st, onEvent);
        };
        child.stdout.on('data', (d) => {
          const s = d.toString('utf8');
          out += s;
          if (profileId === 'custom') { st.text += s; onEvent({ type: 'text', delta: s }); return; }
          let i; let buf = (child._kbuf || '') + s;
          while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
          child._kbuf = buf;
          if (out.length > 20e6) { killTree(child); finish(() => reject(new ModelError('provider', 'The client wrote more than 20 MB.'))); }
        });
        child.stderr.on('data', (d) => { if (err.length < 20000) err += d.toString('utf8'); });
        child.on('error', (e) => finish(() => reject(new ModelError(e.code === 'ENOENT' ? 'cli-missing' : 'provider', 'The client could not be started: ' + e.message))));
        child.on('close', (code) => {
          if (child._kbuf) handleLine(child._kbuf);
          finish(() => {
            if (st.error) { reject(new ModelError(classifyFailure(st.error), (profile.label || 'The client') + ': ' + st.error.slice(0, 400))); return; }
            if (code !== 0 && !st.done) {
              const why = (err || out).trim().slice(-400);
              reject(new ModelError(classifyFailure(why), (profile.label || 'The client') + ' stopped with exit code ' + code + (why ? ': ' + why : '.')));
              return;
            }
            resolve({
              text: profileId === 'custom' ? st.text.trim() : st.text,
              json: st.structured !== undefined ? st.structured : undefined,
              usage: st.usage || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              usageReported: !!st.usage,
              costUsd: st.costUsd,
              model: st.model,
              stopReason: 'end',
              costKind: profile.costKind,
            });
          });
        });
        child.stdin.on('error', () => { /* the client closed stdin early; its exit code says why */ });
        child.stdin.end(call.stdin, 'utf8');
      });
    },
  };
}

module.exports = { createCli, PROFILES, resolveExecutable, splitArgs, renderPrompt, buildCall, shimSafe };
