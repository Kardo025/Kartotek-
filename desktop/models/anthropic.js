'use strict';
// Anthropic adapter (ARCHITECTURE.md section 5.2 a): the native Messages API through the official SDK (@anthropic-ai/sdk), streaming.
// Structured output: output_config.format with type "json_schema". Images: base64 image blocks. Web search: the server-side
// web_search tool (the 2026-02-09 variant on current models, the basic one on older models). The SDK sends API version 2026-10-21,
// which refuses temperature / top_p / top_k, so they are never sent.
const sdk = require('@anthropic-ai/sdk');
const { ModelError } = require('./errors');

const Anthropic = sdk.default || sdk.Anthropic;

// Models that take the dynamic-filtering web search tool; older ones take the basic variant
const NEW_SEARCH = /^claude-(fable|mythos|opus-(5|4-[678])|sonnet-(5|4-6))/;
const EFFORT = /^claude-(fable|mythos|opus-(5|4-[5-8])|sonnet-(5|4-6)|haiku-5)/;

function toContent(content) {
  if (typeof content === 'string') return content;
  return content.map((c) => (c.type === 'image'
    ? { type: 'image', source: { type: 'base64', media_type: c.mime, data: c.data } }
    : { type: 'text', text: c.text }));
}

function mapError(e) {
  if (e instanceof ModelError) return e;
  const A = Anthropic;
  if (e instanceof A.APIUserAbortError || (e && e.name === 'AbortError')) return new ModelError('cancelled', 'The call was cancelled.');
  if (e instanceof A.AuthenticationError || e instanceof A.PermissionDeniedError) return new ModelError('auth', 'Anthropic refused the API key (' + (e.status || '') + ').');
  if (e instanceof A.RateLimitError) return new ModelError('rate-limit', 'Anthropic rate limit reached. Try again in a moment.');
  if (A.OverloadedError && e instanceof A.OverloadedError) return new ModelError('rate-limit', 'Anthropic is overloaded right now. Try again in a moment.');
  if (e instanceof A.NotFoundError) return new ModelError('provider', 'Anthropic does not know this model.');
  if (e instanceof A.APIConnectionError) return new ModelError('network', 'Kartotek could not reach Anthropic.');
  if (e instanceof A.APIError) return new ModelError('provider', 'Anthropic error ' + (e.status || '') + ': ' + String(e.message || '').slice(0, 300));
  return new ModelError('provider', String((e && e.message) || e).slice(0, 300));
}

function createAnthropic(cfg) {
  // cfg: { apiKey, baseUrl?, fetch? (tests) }
  const client = () => new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined, maxRetries: 2, timeout: 10 * 60 * 1000, fetch: cfg.fetch });
  return {
    kind: 'api',
    capabilities() { return { stream: true, structured: 'native', images: true, webSearch: true }; },
    async listModels() {
      const out = [];
      try {
        for await (const m of client().models.list({ limit: 100 })) out.push({ id: m.id, label: m.display_name || m.id });
      } catch (e) { throw mapError(e); }
      return out;
    },
    async run(req, { signal, onEvent }) {
      const params = {
        model: req.model,
        max_tokens: req.maxOutputTokens || 16000,
        messages: req.messages.map((m) => ({ role: m.role, content: toContent(m.content) })),
      };
      if (req.system) params.system = req.system;
      const output = {};
      if (req.schema) output.format = { type: 'json_schema', schema: req.schema };
      // effort exists on current models only (Haiku 4.5 and older reject it)
      if (req.effort && EFFORT.test(req.model)) output.effort = req.effort;
      if (Object.keys(output).length) params.output_config = output;
      if (req.webSearch) params.tools = [{ type: NEW_SEARCH.test(req.model) ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 5 }];
      let msg;
      try {
        const stream = client().messages.stream(params, { signal });
        stream.on('text', (delta) => onEvent({ type: 'text', delta }));
        msg = await stream.finalMessage();
      } catch (e) { throw mapError(e); }
      if (msg.stop_reason === 'refusal') {
        const cat = msg.stop_details && msg.stop_details.category;
        throw new ModelError('refused', 'The model declined this request' + (cat ? ' (' + cat + ')' : '') + '.');
      }
      const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const u = msg.usage || {};
      return {
        text,
        usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0,
          webSearches: (u.server_tool_use && u.server_tool_use.web_search_requests) || 0 },
        model: msg.model || req.model,
        stopReason: msg.stop_reason,
        costKind: 'api',
      };
    },
  };
}

module.exports = { createAnthropic, mapError };
