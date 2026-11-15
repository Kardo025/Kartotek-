'use strict';
// Tests for the model layer (task E1). No test calls a real service: the model service runs with a fake provider and a fake key
// encryption; the real adapters run against stand-ins (an Anthropic SSE stream through the SDK's fetch hook, an OpenAI-compatible
// server on 127.0.0.1, fake Claude Code and Codex scripts).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { validate, parseJsonLoose } = require('../desktop/models/schema');
const { createPrompts, fence } = require('../desktop/models/prompts');
const { createModelService } = require('../desktop/models/service');
const { createAnthropic } = require('../desktop/models/anthropic');
const { createOpenAICompat } = require('../desktop/models/openai-compat');
const { createCli, resolveExecutable, splitArgs } = require('../desktop/models/cli');
const { ModelError } = require('../desktop/models/errors');

const root = path.join(__dirname, '..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const SECRET = 'sk-test-THIS-MUST-NEVER-APPEAR-1234567890';

// Fake encryption: reversible, but the plain text is not in the bytes
const fakeEncrypt = async (s) => Buffer.from('ENC1' + Buffer.from(s, 'utf8').toString('base64').split('').reverse().join(''));
const fakeDecrypt = async (b) => { const t = b.toString(); assert.ok(t.startsWith('ENC1')); return Buffer.from(t.slice(4).split('').reverse().join(''), 'base64').toString('utf8'); };

// A fake provider: replies come from a script; it records the requests it got
function fakeAdapterFactory(script) {
  const calls = [];
  const factory = (cfg) => ({
    kind: 'api', cfg,
    capabilities: () => ({ stream: true, structured: script.structured || 'native', images: true, webSearch: !!script.webSearch }),
    listModels: async () => [{ id: 'fake-model', label: 'Fake' }],
    run: async (req, { signal, onEvent }) => {
      calls.push({ req, cfg });
      const step = script.replies[Math.min(calls.length - 1, script.replies.length - 1)];
      if (step.wait) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, step.wait);
          signal.addEventListener('abort', () => { clearTimeout(t); reject(new ModelError('cancelled', 'cancelled')); }, { once: true });
        });
      }
      if (step.error) throw new ModelError(step.error, 'fake ' + step.error);
      (step.deltas || [step.text || '']).forEach((d) => onEvent({ type: 'text', delta: d }));
      return { text: step.text, json: step.json, usage: step.usage || { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 }, model: step.model || req.model, stopReason: 'end_turn', costKind: step.costKind || 'api', costUsd: step.costUsd };
    },
  });
  factory.calls = calls;
  return factory;
}

async function t(list, name, fn) { try { await fn(); list.push(name); } catch (e) { e.message = name + ': ' + e.message; throw e; } }

// ---------------------------------------------------------------- schema and prompts
async function schemaPromptTests() {
  const ok = [];
  await t(ok, 'schema: types, required, additionalProperties, enum, nested arrays, $ref', () => {
    const s = { type: 'object', properties: { a: { type: 'string' }, n: { type: 'integer' }, k: { enum: ['x', 'y'] }, list: { type: 'array', minItems: 1, items: { $ref: '#/$defs/item' } } },
      required: ['a', 'list'], additionalProperties: false, $defs: { item: { type: 'object', properties: { q: { type: ['string', 'null'] } }, required: ['q'], additionalProperties: false } } };
    assert.deepStrictEqual(validate(s, { a: 'x', n: 2, k: 'x', list: [{ q: null }] }), []);
    const errs = validate(s, { n: 2.5, k: 'z', list: [], extra: 1 });
    assert.ok(errs.some((e) => /missing "a"/.test(e)) && errs.some((e) => /integer/.test(e)) && errs.some((e) => /one of/.test(e)) && errs.some((e) => /at least 1/.test(e)) && errs.some((e) => /unexpected "extra"/.test(e)));
    assert.ok(validate({ anyOf: [{ type: 'string' }, { type: 'number' }] }, true).length === 1);
  });
  await t(ok, 'loose JSON: plain, fenced, embedded', () => {
    assert.deepStrictEqual(parseJsonLoose('{"a":1}').value, { a: 1 });
    assert.deepStrictEqual(parseJsonLoose('Here:\n```json\n{"a":2}\n```').value, { a: 2 });
    assert.deepStrictEqual(parseJsonLoose('Sure! {"a":3} done').value, { a: 3 });
    assert.ok(!parseJsonLoose('no json').ok);
  });
  const user = tmp('kartotek-prompts-');
  try {
    const P = createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: user });
    await t(ok, 'prompts: shipped files list with version, slot, variables and schema', () => {
      const l = P.list();
      const ct = l.find((x) => x.id === 'connection-test');
      assert.ok(ct && ct.version >= 1 && ct.slot === 'fast' && ct.variables.includes('phrase') && !ct.edited);
      assert.ok(P.get('connection-test').schema && P.get('connection-test').schema.required.includes('reply'));
    });
    await t(ok, 'prompts: values are fenced (learner text cannot close the fence), override hash recorded', () => {
      const r = P.render('connection-test', { phrase: 'a ``` b' });
      assert.ok(r.text.includes('````text\na ``` b\n````'));
      assert.strictEqual(r.promptHash, null);
      assert.ok(fence('x').startsWith('```text'));
    });
    await t(ok, 'prompts: an override must keep every placeholder; reset removes it; a newer default is flagged', () => {
      assert.throws(() => P.saveOverride('connection-test', 'No placeholder here'), /\{\{phrase\}\}/);
      assert.throws(() => P.saveOverride('connection-test', '{{phrase}} {{other}}'), /Unknown placeholders/);
      P.saveOverride('connection-test', 'Edited. {{phrase}}');
      const r = P.render('connection-test', { phrase: 'p' });
      assert.ok(r.text.startsWith('Edited.') && /^[0-9a-f]{12}$/.test(r.promptHash));
      assert.ok(P.list().find((x) => x.id === 'connection-test').edited);
      const f = path.join(user, 'prompts', 'connection-test.md');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/based_on: \d+/, 'based_on: 0'));
      assert.ok(P.list().find((x) => x.id === 'connection-test').defaultChanged);
      P.resetOverride('connection-test');
      assert.ok(!P.list().find((x) => x.id === 'connection-test').edited);
      assert.throws(() => P.get('../package'), /Unknown prompt/);
    });
  } finally { rm(user); }
  return ok;
}

// ---------------------------------------------------------------- the model service with a fake provider
async function serviceTests() {
  const ok = [];
  const dir = tmp('kartotek-models-');
  let clock = Date.UTC(2026, 10, 15, 10);
  try {
    const script = { replies: [{ text: 'hello', deltas: ['hel', 'lo'] }] };
    const fake = fakeAdapterFactory(script);
    const S = createModelService({ dir, now: () => clock, encrypt: fakeEncrypt, decrypt: fakeDecrypt, prompts: createPrompts({ shippedDir: path.join(root, 'prompts'), userDir: dir }),
      adapters: { anthropic: fake, 'openai-compatible': fake, cli: fake } });

    await t(ok, 'nothing configured: status says so and a call fails with "not-configured"', async () => {
      assert.strictEqual((await S.status()).configured, false);
      await assert.rejects(() => S.run({ feature: 'explain', slot: 'fast', messages: [{ role: 'user', content: 'x' }] }), (e) => e.code === 'not-configured');
    });

    await t(ok, 'a key is stored encrypted and never reaches providers.json, the public config or the usage log', async () => {
      await S.saveProvider({ id: 'claude', kind: 'anthropic', label: 'My Anthropic' }, SECRET);
      const raw = S._readKeysRaw();
      assert.ok(raw && !raw.toString().includes(SECRET) && !raw.toString('latin1').includes('sk-test'));
      const cfgText = fs.readFileSync(path.join(dir, 'models', 'providers.json'), 'utf8');
      assert.ok(!cfgText.includes(SECRET));
      const pub = await S.publicConfig();
      assert.ok(pub.providers[0].hasKey && !JSON.stringify(pub).includes(SECRET));
      await S.setSlot('strong', 'claude', 'claude-opus-5-5');
      await S.setSlot('fast', 'claude', 'claude-haiku-5-5');
      assert.strictEqual((await S.status()).configured, true);
    });

    await t(ok, 'a call streams text, uses its slot, is priced from the shipped table and logged without text', async () => {
      const events = [];
      const r = await S.run({ feature: 'explain', slot: 'strong', system: 'sys', messages: [{ role: 'user', content: 'hi' }] }, { callId: 'c1', onEvent: (e) => events.push(e) });
      assert.strictEqual(r.text, 'hello');
      assert.deepStrictEqual(events.filter((e) => e.type === 'text').map((e) => e.delta), ['hel', 'lo']);
      assert.strictEqual(fake.calls[0].cfg.apiKey, SECRET, 'the adapter gets the decrypted key');
      assert.strictEqual(fake.calls[0].req.model, 'claude-opus-5-5');
      assert.ok(Math.abs(r.costUsd - (1000 * 4 + 500 * 20) / 1e6) < 1e-12, 'priced: ' + r.costUsd);
      const log = fs.readFileSync(path.join(dir, 'models', 'usage', '2026-11.jsonl'), 'utf8');
      assert.ok(log.includes('"feature":"explain"') && !log.includes('hello') && !log.includes('"hi"') && !log.includes(SECRET));
    });

    await t(ok, 'an empty slot falls back to strong; an explicit target wins', async () => {
      await S.run({ feature: 'x', slot: 'vision', messages: [{ role: 'user', content: 'hi' }] });
      assert.strictEqual(fake.calls[fake.calls.length - 1].req.model, 'claude-opus-5-5');
      await S.run({ feature: 'x', target: { providerId: 'claude', model: 'claude-sonnet-5-5' }, messages: [{ role: 'user', content: 'hi' }] });
      assert.strictEqual(fake.calls[fake.calls.length - 1].req.model, 'claude-sonnet-5-5');
    });

    await t(ok, 'structured output: a wrong answer gets one repair call; two wrong answers are a "schema" error', async () => {
      const schema = { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false };
      script.replies = [{ text: 'not json' }, { text: '{"reply":"ok"}' }];
      fake.calls.length = 0;
      const r = await S.run({ feature: 'y', slot: 'fast', schema, messages: [{ role: 'user', content: 'q' }] });
      assert.deepStrictEqual(r.json, { reply: 'ok' });
      assert.ok(r.repaired && fake.calls.length === 2 && r.usage.input === 2000);
      assert.ok(/does not match/.test(JSON.stringify(fake.calls[1].req.messages[2])));
      script.replies = [{ text: '{"wrong":1}' }];
      fake.calls.length = 0;
      await assert.rejects(() => S.run({ feature: 'y', slot: 'fast', schema, messages: [{ role: 'user', content: 'q' }] }), (e) => e.code === 'schema');
      script.replies = [{ text: 'ignored', json: { reply: 'native' } }];
      const r2 = await S.run({ feature: 'y', slot: 'fast', schema, messages: [{ role: 'user', content: 'q' }] });
      assert.deepStrictEqual(r2.json, { reply: 'native' });
    });

    await t(ok, 'without a native schema mode the schema is put into the system text', async () => {
      script.structured = 'json-mode';
      script.replies = [{ text: '{"reply":"x"}' }];
      fake.calls.length = 0;
      await S.run({ feature: 'y', slot: 'fast', system: 'base', schema: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false }, messages: [{ role: 'user', content: 'q' }] });
      assert.ok(/^base\n\nAnswer with JSON only/.test(fake.calls[0].req.system));
      delete script.structured;
    });

    await t(ok, 'cancel stops a running call ("cancelled"), and the usage log records it', async () => {
      script.replies = [{ wait: 5000, text: 'late' }];
      const p = S.run({ feature: 'slow', slot: 'fast', messages: [{ role: 'user', content: 'q' }] }, { callId: 'slow1' });
      await new Promise((r) => setTimeout(r, 30));
      assert.strictEqual(S.cancel('slow1'), true);
      await assert.rejects(() => p, (e) => e.code === 'cancelled');
      assert.ok(fs.readFileSync(path.join(dir, 'models', 'usage', '2026-11.jsonl'), 'utf8').includes('"outcome":"cancelled"'));
      assert.strictEqual(S.cancel('slow1'), false);
    });

    await t(ok, 'budget: a warning at 80%, calls stop at 100% until allowed for the month; the test button and CLI are not blocked', async () => {
      script.replies = [{ text: 'x' }];
      const spent = S.usageSummary().budget.spent;
      await S.setBudget(spent / 0.85);
      assert.ok(S.usageSummary().budget.warn && !S.usageSummary().budget.over);
      await S.setBudget(spent);
      await assert.rejects(() => S.run({ feature: 'z', slot: 'fast', messages: [{ role: 'user', content: 'q' }] }), (e) => e.code === 'budget');
      script.replies = [{ text: '{"reply":"Kartotek connection works."}' }];
      await S.test('claude', 'claude-haiku-5-5'); // the connection test is allowed
      script.replies = [{ text: 'x' }];
      await S.saveProvider({ id: 'cc', kind: 'cli', profile: 'claude-code' });
      await S.run({ feature: 'z', target: { providerId: 'cc', model: '' }, messages: [{ role: 'user', content: 'q' }] }); // subscription
      await S.allowOverBudget();
      await S.run({ feature: 'z', slot: 'fast', messages: [{ role: 'user', content: 'q' }] });
      clock += 31 * 86400000; // next month: the allowance is gone, but the spend starts at 0 again
      assert.ok(!S.usageSummary().budget.over);
      await S.setBudget(null);
    });

    await t(ok, 'usage summary: calls, tokens and cost per day, feature and model; months listed', async () => {
      const u = S.usageSummary('2026-11');
      assert.ok(u.total.calls >= 8 && u.byFeature.explain.calls === 1 && u.byDay['2026-11-15'].calls === u.total.calls);
      assert.ok(Object.keys(u.byModel).some((k) => k.startsWith('claude · ')));
      assert.ok(u.months.includes('2026-11'));
      assert.ok(u.total.failed >= 2);
    });

    await t(ok, 'the connection test goes through the shipped prompt with its schema and reports whether the reply matches', async () => {
      script.replies = [{ text: '{"reply":"Kartotek connection works."}' }];
      fake.calls.length = 0;
      const r = await S.test('claude', 'claude-haiku-5-5');
      assert.ok(r.replyMatches && r.reply === 'Kartotek connection works.');
      assert.ok(fake.calls[0].req.schema && fake.calls[0].req.promptId === 'connection-test' && fake.calls[0].req.effort === 'low');
      assert.ok(/```text\nKartotek connection works\.\n```/.test(fake.calls[0].req.messages[0].content));
    });

    await t(ok, 'input checks: bad provider fields, plain http to another host, a bad image, an unknown slot', async () => {
      await assert.rejects(() => S.saveProvider({ id: 'Bad Id', kind: 'anthropic' }), (e) => e.code === 'invalid');
      await assert.rejects(() => S.saveProvider({ id: 'x', kind: 'openai-compatible', preset: 'custom', baseUrl: 'http://example.com/v1' }), /https/);
      await S.saveProvider({ id: 'local', kind: 'openai-compatible', preset: 'ollama' });
      await assert.rejects(() => S.run({ slot: 'fast', messages: [{ role: 'user', content: [{ type: 'image', mime: 'image/svg+xml', data: 'x' }] }] }), (e) => e.code === 'invalid');
      await assert.rejects(() => S.setSlot('huge', 'claude', 'm'), (e) => e.code === 'invalid');
    });

    await t(ok, 'removing a provider clears its slots and its key', async () => {
      await S.removeProvider('claude');
      const pub = await S.publicConfig();
      assert.ok(!pub.providers.some((p) => p.id === 'claude') && !pub.slots.strong && !pub.slots.fast);
      const raw = S._readKeysRaw();
      assert.ok(!raw || !(await fakeDecrypt(raw)).includes(SECRET));
    });
  } finally { rm(dir); }
  return ok;
}

// ---------------------------------------------------------------- real adapters against stand-ins
function sseResponse(events, status) {
  const body = events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join('');
  return new Response(body, { status: status || 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' } });
}

async function anthropicTests() {
  const ok = [];
  const seen = [];
  const fetchOk = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return sseResponse([
      { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 21, output_tokens: 1, cache_read_input_tokens: 5 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"reply":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '"ok"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
      { type: 'message_stop' },
    ]);
  };
  await t(ok, 'Anthropic (SDK, stand-in stream): text deltas, usage, structured output, effort, web search tool, no temperature', async () => {
    const a = createAnthropic({ apiKey: 'k', fetch: fetchOk });
    const deltas = [];
    const r = await a.run({ model: 'claude-opus-5-5', system: 'S', schema: { type: 'object' }, effort: 'low', webSearch: true, maxOutputTokens: 500,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image', mime: 'image/png', data: 'AAAA' }] }] }, { signal: new AbortController().signal, onEvent: (e) => deltas.push(e.delta) });
    assert.strictEqual(r.text, '{"reply":"ok"}');
    assert.deepStrictEqual(deltas, ['{"reply":', '"ok"}']);
    assert.strictEqual(r.usage.input, 21); assert.strictEqual(r.usage.output, 9); assert.strictEqual(r.usage.cacheRead, 5);
    const b = seen[0].body;
    assert.ok(/\/v1\/messages$/.test(seen[0].url));
    assert.deepStrictEqual(b.output_config, { format: { type: 'json_schema', schema: { type: 'object' } }, effort: 'low' });
    assert.strictEqual(b.tools[0].type, 'web_search_20260209');
    assert.deepStrictEqual(b.messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
    assert.ok(!('temperature' in b) && b.stream === true && b.system === 'S' && b.max_tokens === 500);
  });
  await t(ok, 'Anthropic: older models get no effort and the basic search tool', async () => {
    seen.length = 0;
    await createAnthropic({ apiKey: 'k', fetch: fetchOk }).run({ model: 'claude-haiku-4-5', effort: 'low', webSearch: true, messages: [{ role: 'user', content: 'x' }] }, { signal: new AbortController().signal, onEvent: () => {} });
    assert.ok(!seen[0].body.output_config && seen[0].body.tools[0].type === 'web_search_20250305');
  });
  await t(ok, 'Anthropic: 401 -> "auth", 429 -> "rate-limit", refusal -> "refused"', async () => {
    const err = (status, type) => async () => new Response(JSON.stringify({ type: 'error', error: { type, message: 'nope' } }), { status, headers: { 'content-type': 'application/json' } });
    const run = (f) => createAnthropic({ apiKey: 'k', fetch: f }).run({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'x' }] }, { signal: new AbortController().signal, onEvent: () => {} });
    await assert.rejects(() => run(err(401, 'authentication_error')), (e) => e.code === 'auth');
    // the SDK retries 429 twice: keep answering 429
    await assert.rejects(() => run(err(429, 'rate_limit_error')), (e) => e.code === 'rate-limit');
    const refusing = async () => sseResponse([
      { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }, usage: { output_tokens: 0 } },
      { type: 'message_stop' },
    ]);
    await assert.rejects(() => run(refusing), (e) => e.code === 'refused');
  });
  return ok;
}

async function openaiTests() {
  const ok = [];
  const got = [];
  let mode = 'ok';
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    got.push({ url: req.url, auth: req.headers.authorization || null, body: body ? JSON.parse(body) : null });
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'llama3' }, { id: 'qwen' }] })); return; }
    if (mode === '429') { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'slow down' } })); return; }
    if (mode === '401') { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'bad key' } })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
    chunk({ model: 'llama3', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] });
    chunk({ choices: [{ index: 0, delta: { content: 'Hel' } }] });
    chunk({ choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: 'stop' }] });
    chunk({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 10 } } });
    res.end('data: [DONE]\n\n');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/v1';
  try {
    await t(ok, 'OpenAI-compatible (local server): streaming text, usage with cached tokens split, JSON mode for local, no key header', async () => {
      const a = createOpenAICompat({ preset: 'ollama', baseUrl: base });
      const deltas = [];
      const r = await a.run({ model: 'llama3', system: 'S', schema: { type: 'object' }, messages: [{ role: 'user', content: 'hi' }] }, { signal: new AbortController().signal, onEvent: (e) => deltas.push(e.delta) });
      assert.strictEqual(r.text, 'Hello'); assert.deepStrictEqual(deltas, ['Hel', 'lo']);
      assert.deepStrictEqual(r.usage, { input: 20, output: 4, cacheRead: 10, cacheWrite: 0 });
      assert.strictEqual(r.costKind, 'free-local');
      const b = got[got.length - 1].body;
      assert.deepStrictEqual(b.response_format, { type: 'json_object' });
      assert.ok(b.stream && b.stream_options.include_usage && b.max_tokens && b.messages[0].role === 'system' && got[got.length - 1].auth === null);
      assert.deepStrictEqual((await a.listModels()).map((m) => m.id), ['llama3', 'qwen']);
    });
    await t(ok, 'OpenAI preset: json_schema response format, max_completion_tokens, bearer key, image as data URL', async () => {
      const a = createOpenAICompat({ preset: 'openai', baseUrl: base, apiKey: 'k-1' });
      await a.run({ model: 'm', schema: { type: 'object' }, messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }, { type: 'image', mime: 'image/jpeg', data: 'QQ' }] }] }, { signal: new AbortController().signal, onEvent: () => {} });
      const g = got[got.length - 1];
      assert.strictEqual(g.auth, 'Bearer k-1');
      assert.strictEqual(g.body.response_format.type, 'json_schema'); assert.strictEqual(g.body.response_format.json_schema.strict, true);
      assert.ok(g.body.max_completion_tokens && !('max_tokens' in g.body));
      assert.deepStrictEqual(g.body.messages[0].content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QQ' } });
    });
    await t(ok, 'OpenAI-compatible: 401 -> "auth", 429 -> "rate-limit", no server -> "network", abort -> "cancelled"', async () => {
      const run = (b, signal) => createOpenAICompat({ preset: 'custom', baseUrl: b }).run({ model: 'm', messages: [{ role: 'user', content: 'x' }] }, { signal: signal || new AbortController().signal, onEvent: () => {} });
      mode = '401'; await assert.rejects(() => run(base), (e) => e.code === 'auth');
      mode = '429'; await assert.rejects(() => run(base), (e) => e.code === 'rate-limit');
      mode = 'ok'; await assert.rejects(() => run('http://127.0.0.1:1/v1'), (e) => e.code === 'network');
      const c = new AbortController(); c.abort();
      await assert.rejects(() => run(base, c.signal), (e) => e.code === 'cancelled');
    });
  } finally { server.close(); }
  return ok;
}

// Fake command-line clients: node scripts that read stdin and answer like Claude Code / Codex
const FAKE_CLAUDE = `
let input = ''; process.stdin.on('data', (d) => input += d); process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  if (process.env.FAKE_MODE === 'nologin') { out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in. Please run /login' }); process.exit(1); }
  if (process.env.FAKE_MODE === 'sleep') { setTimeout(() => {}, 60000); return; }
  out({ type: 'system', subtype: 'init', model: args[args.indexOf('--model') + 1] || 'claude-opus-5-5', cwd: process.cwd() });
  const schemaAt = args.indexOf('--json-schema');
  const reply = JSON.stringify({ args, cwd: process.cwd(), stdin: input });
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'part1' } } });
  out({ type: 'result', subtype: 'success', is_error: false, result: reply, structured_output: schemaAt >= 0 ? { reply: 'structured', schema: JSON.parse(args[schemaAt + 1]) } : undefined,
    usage: { input_tokens: 12, output_tokens: 5, cache_read_input_tokens: 3 }, total_cost_usd: 0.0123 });
});`;
const FAKE_CODEX = `
let input = ''; process.stdin.on('data', (d) => input += d); process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  const sf = args.indexOf('--output-schema');
  out({ type: 'thread.started', thread_id: 't1' });
  out({ type: 'turn.started' });
  out({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: JSON.stringify({ args, schema: sf >= 0 ? JSON.parse(require('fs').readFileSync(args[sf + 1], 'utf8')) : null, stdin: input }) } });
  out({ type: 'turn.completed', usage: { input_tokens: 40, cached_input_tokens: 8, output_tokens: 6, reasoning_output_tokens: 2 } });
});`;

async function cliTests() {
  const ok = [];
  const dir = tmp('kartotek-cli-');
  try {
    const claudeJs = path.join(dir, 'fake-claude.js'); fs.writeFileSync(claudeJs, FAKE_CLAUDE);
    const codexJs = path.join(dir, 'fake-codex.js'); fs.writeFileSync(codexJs, FAKE_CODEX);
    const work = path.join(dir, 'cli-work');
    // "a real .exe": spawn node with the fake script in front of the arguments the adapter builds
    const viaNode = (script) => (cmd, args, o) => spawn(process.execPath, [script].concat(args), o);
    const run = (a, req, signal) => a.run(Object.assign({ messages: [{ role: 'user', content: 'Q?' }] }, req), { signal: signal || new AbortController().signal, onEvent: () => {} });

    await t(ok, 'Claude Code profile: headless flags, prompt on stdin, empty working folder, structured output, usage and cost estimate', async () => {
      const a = createCli({ profile: 'claude-code', workDir: work, spawnImpl: viaNode(claudeJs) });
      const r = await run(a, { model: 'claude-sonnet-5-5', system: 'SYS', schema: { type: 'object', properties: { reply: { type: 'string' } } } });
      const echo = JSON.parse(r.text);
      assert.deepStrictEqual(echo.args.slice(0, 7), ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'dontAsk']);
      assert.ok(echo.args.includes('--model') && echo.args.includes('claude-sonnet-5-5') && echo.args.includes('--json-schema'));
      assert.ok(!echo.args.includes('--bare'), 'never --bare: it skips the subscription login');
      assert.ok(!echo.args.some((x) => /Q\?|SYS/.test(x)), 'the prompt is not on the command line');
      assert.strictEqual(echo.stdin, 'SYS\n\nQ?');
      assert.strictEqual(fs.realpathSync(echo.cwd), fs.realpathSync(work));
      assert.strictEqual(r.json.reply, 'structured');
      assert.deepStrictEqual(r.usage, { input: 12, output: 5, cacheRead: 3, cacheWrite: 0 });
      assert.strictEqual(r.costUsd, 0.0123); assert.strictEqual(r.costKind, 'subscription-estimate');
    });
    await t(ok, 'Claude Code profile: "not logged in" -> "auth"; a hanging client is cancelled and killed', async () => {
      const env = Object.assign({}, process.env, { FAKE_MODE: 'nologin' });
      await assert.rejects(() => run(createCli({ profile: 'claude-code', workDir: work, env, spawnImpl: viaNode(claudeJs) }), {}), (e) => e.code === 'auth');
      const c = new AbortController();
      const p = run(createCli({ profile: 'claude-code', workDir: work, env: Object.assign({}, process.env, { FAKE_MODE: 'sleep' }), spawnImpl: viaNode(claudeJs) }), {}, c.signal);
      setTimeout(() => c.abort(), 300);
      await assert.rejects(() => p, (e) => e.code === 'cancelled');
      const t0 = Date.now();
      await assert.rejects(() => run(createCli({ profile: 'claude-code', workDir: work, timeoutMs: 400, env: Object.assign({}, process.env, { FAKE_MODE: 'sleep' }), spawnImpl: viaNode(claudeJs) }), {}), (e) => e.code === 'timeout');
      assert.ok(Date.now() - t0 < 5000);
    });
    if (process.platform === 'win32') {
      await t(ok, 'Claude Code installed as a .cmd shim: started through cmd.exe with safe arguments only, schema asked for in the prompt', async () => {
        const shim = path.join(dir, 'claude.cmd');
        fs.writeFileSync(shim, '@echo off\r\n"' + process.execPath + '" "' + claudeJs + '" %*\r\n');
        const a = createCli({ profile: 'claude-code', command: shim, workDir: work });
        assert.strictEqual(a.executable(), shim);
        const r = await run(a, { model: 'claude-opus-5-5', schema: { type: 'object', properties: { reply: { type: 'string' } } } });
        const echo = JSON.parse(r.text);
        assert.ok(echo.args.includes('claude-opus-5-5') && !echo.args.includes('--json-schema'));
        assert.ok(/Answer with JSON only/.test(echo.stdin));
      });
    }
    await t(ok, 'Codex profile: exec --json, read-only sandbox, schema file, prompt on stdin, usage', async () => {
      const a = createCli({ profile: 'codex', workDir: work, spawnImpl: viaNode(codexJs) });
      const r = await run(a, { model: 'gpt-x', schema: { type: 'object', properties: { a: { type: 'string' } } } });
      const echo = JSON.parse(r.text);
      assert.deepStrictEqual(echo.args.slice(0, 6), ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only']);
      assert.strictEqual(echo.args[echo.args.length - 1], '-');
      assert.deepStrictEqual(echo.schema, { type: 'object', properties: { a: { type: 'string' } } });
      assert.strictEqual(echo.stdin, 'Q?');
      assert.deepStrictEqual(r.usage, { input: 40, output: 6, cacheRead: 8, cacheWrite: 0 });
      assert.ok(!fs.readdirSync(work).some((f) => f.startsWith('schema-')), 'the schema file is removed');
    });
    await t(ok, 'Custom profile: arguments split with quotes, stdout is the reply; a missing client is "cli-missing"', async () => {
      const echoJs = path.join(dir, 'echo.js');
      fs.writeFileSync(echoJs, "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write('ECHO:'+s+':'+process.argv.slice(2).join('|')));");
      const a = createCli({ profile: 'custom', command: process.execPath, args: '"' + echoJs + '" --flag "two words"', workDir: work });
      const r = await run(a, {});
      assert.strictEqual(r.text, 'ECHO:Q?:--flag|two words');
      assert.deepStrictEqual(splitArgs('a "b c" d'), ['a', 'b c', 'd']);
      await assert.rejects(() => run(createCli({ profile: 'claude-code', command: 'definitely-not-a-real-client-xyz', workDir: work }), {}), (e) => e.code === 'cli-missing');
      assert.strictEqual(resolveExecutable('definitely-not-a-real-client-xyz'), null);
      assert.ok(resolveExecutable(process.execPath));
    });
    await t(ok, 'command-line clients get no images', async () => {
      const a = createCli({ profile: 'claude-code', workDir: work, spawnImpl: viaNode(claudeJs) });
      await assert.rejects(() => run(a, { messages: [{ role: 'user', content: [{ type: 'image', mime: 'image/png', data: 'x' }] }] }), (e) => e.code === 'invalid');
    });
  } finally { rm(dir); }
  return ok;
}

async function run() {
  const out = [];
  for (const [label, fn] of [['Schema and prompt files', schemaPromptTests], ['Model service (fake provider)', serviceTests], ['Anthropic adapter (stand-in)', anthropicTests],
    ['OpenAI-compatible adapter (local stand-in server)', openaiTests], ['Command-line adapter (fake clients)', cliTests]]) {
    const ok = await fn();
    out.push(label + ': ' + ok.length + '/' + ok.length + ' passed');
  }
  return out;
}

module.exports = { run };
if (require.main === module) run().then((l) => l.forEach((x) => console.log(x)), (e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
