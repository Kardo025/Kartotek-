'use strict';
// OpenAI-compatible adapter (ARCHITECTURE.md section 5.2 a and c): the Chat Completions format over fetch, streaming (SSE).
// One adapter for OpenAI, Google Gemini (its OpenAI-compatible endpoint), OpenRouter and similar, and local servers such as Ollama.
// Structured output: response_format json_schema where the preset supports it, else JSON mode; the model layer always validates.
// Images: base64 data URLs. Web search: not offered through this adapter.
const { ModelError } = require('./errors');

// Presets: where the endpoint is, how it takes structured output and the output-token limit, whether it needs a key
const PRESETS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', structured: 'json_schema', tokenParam: 'max_completion_tokens', needsKey: true, costKind: 'api' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', structured: 'json_schema', tokenParam: 'max_tokens', needsKey: true, costKind: 'api' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', structured: 'json_schema', tokenParam: 'max_tokens', needsKey: true, costKind: 'api' },
  ollama: { label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', structured: 'json-mode', tokenParam: 'max_tokens', needsKey: false, costKind: 'free-local' },
  custom: { label: 'OpenAI-compatible endpoint', baseUrl: '', structured: 'json-mode', tokenParam: 'max_tokens', needsKey: false, costKind: 'api' },
};

function toContent(content) {
  if (typeof content === 'string') return content;
  if (content.every((c) => c.type === 'text')) return content.map((c) => c.text).join('\n\n');
  return content.map((c) => (c.type === 'image'
    ? { type: 'image_url', image_url: { url: 'data:' + c.mime + ';base64,' + c.data } }
    : { type: 'text', text: c.text }));
}

function trimBase(u) { return String(u || '').replace(/\/+$/, ''); }

// Reads an SSE body: calls onData(json) for every "data:" line except [DONE]
async function readSse(body, onData) {
  const decoder = new TextDecoder();
  let buf = '';
  const handle = (line) => {
    const l = line.trim();
    if (!l.startsWith('data:')) return;
    const d = l.slice(5).trim();
    if (!d || d === '[DONE]') return;
    let j;
    try { j = JSON.parse(d); } catch (e) { return; }
    onData(j);
  };
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  if (buf) handle(buf);
}

async function httpError(res, label) {
  let detail = '';
  try { const j = await res.json(); detail = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (e) { /* not JSON */ }
  detail = String(detail).slice(0, 300);
  if (res.status === 401 || res.status === 403) return new ModelError('auth', label + ' refused the key (' + res.status + ').' + (detail ? ' ' + detail : ''));
  if (res.status === 429) return new ModelError('rate-limit', label + ' rate limit reached (429).' + (detail ? ' ' + detail : ''));
  if (res.status === 404) return new ModelError('provider', label + ': not found (404). Check the address and the model name.' + (detail ? ' ' + detail : ''));
  return new ModelError('provider', label + ' error ' + res.status + '.' + (detail ? ' ' + detail : ''));
}

function netError(e, label) {
  if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) return new ModelError('cancelled', 'The call was cancelled.');
  return new ModelError('network', 'Kartotek could not reach ' + label + '. ' + String((e && e.cause && e.cause.code) || (e && e.message) || ''));
}

function createOpenAICompat(cfg) {
  // cfg: { preset, baseUrl?, apiKey?, structured?, tokenParam?, label?, fetch? (tests) }
  const p = Object.assign({}, PRESETS[cfg.preset] || PRESETS.custom);
  const base = trimBase(cfg.baseUrl || p.baseUrl);
  const structured = cfg.structured || p.structured;
  const tokenParam = cfg.tokenParam || p.tokenParam;
  const label = cfg.label || p.label;
  const doFetch = cfg.fetch || globalThis.fetch;
  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) h.Authorization = 'Bearer ' + cfg.apiKey;
    return h;
  };
  return {
    kind: cfg.preset === 'ollama' ? 'local' : 'api',
    capabilities() { return { stream: true, structured: structured === 'json_schema' ? 'native' : 'json-mode', images: true, webSearch: false }; },
    async listModels() {
      if (!base) throw new ModelError('invalid', 'No address is set.');
      let res;
      try { res = await doFetch(base + '/models', { headers: headers() }); } catch (e) { throw netError(e, label); }
      if (!res.ok) throw await httpError(res, label);
      const j = await res.json();
      return (j.data || j.models || []).map((m) => ({ id: m.id || m.name, label: m.id || m.name })).filter((m) => m.id);
    },
    async run(req, { signal, onEvent }) {
      if (!base) throw new ModelError('invalid', 'No address is set.');
      const messages = [];
      if (req.system) messages.push({ role: 'system', content: req.system });
      req.messages.forEach((m) => messages.push({ role: m.role, content: toContent(m.content) }));
      const body = { model: req.model, messages, stream: true, stream_options: { include_usage: true } };
      body[tokenParam] = req.maxOutputTokens || 16000;
      if (req.schema) {
        body.response_format = structured === 'json_schema'
          ? { type: 'json_schema', json_schema: { name: 'kartotek_answer', schema: req.schema, strict: true } }
          : { type: 'json_object' };
      }
      let res;
      try { res = await doFetch(base + '/chat/completions', { method: 'POST', headers: headers(), body: JSON.stringify(body), signal }); } catch (e) { throw netError(e, label); }
      if (!res.ok) throw await httpError(res, label);
      let text = '', usage = null, model = req.model, finish = null, refusal = '';
      try {
        await readSse(res.body, (j) => {
          if (j.error) throw new ModelError('provider', label + ': ' + String(j.error.message || j.error).slice(0, 300));
          if (j.model) model = j.model;
          const ch = j.choices && j.choices[0];
          if (ch && ch.delta) {
            if (typeof ch.delta.content === 'string' && ch.delta.content) { text += ch.delta.content; onEvent({ type: 'text', delta: ch.delta.content }); }
            if (typeof ch.delta.refusal === 'string') refusal += ch.delta.refusal;
          }
          if (ch && ch.finish_reason) finish = ch.finish_reason;
          if (j.usage) usage = j.usage;
        });
      } catch (e) { throw e instanceof ModelError ? e : netError(e, label); }
      if (refusal && !text) throw new ModelError('refused', 'The model declined this request: ' + refusal.slice(0, 200));
      const u = usage || {};
      // prompt_tokens includes the cached ones: split them so each is priced once
      const cached = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
      return {
        text,
        usage: { input: Math.max(0, (u.prompt_tokens || 0) - cached), output: u.completion_tokens || 0, cacheRead: cached, cacheWrite: 0 },
        usageReported: !!usage,
        model,
        stopReason: finish,
        costKind: p.costKind,
      };
    },
  };
}

module.exports = { createOpenAICompat, PRESETS, readSse };
