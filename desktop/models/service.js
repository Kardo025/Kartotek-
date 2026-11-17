'use strict';
// The model layer (task E1, ARCHITECTURE.md section 5). Plain Node: desktop/main.js passes the key encryption (safeStorage) and
// registers the calls; the tests pass a fake encryption and fake adapters. Keys never leave this module except to the adapter that
// needs them: they are not in providers.json, not in what the window receives, not in the usage log, not in the backups.
//
// Files in <userData>\models\:
//   providers.json        providers (no keys), the three task slots, the budget, price edits
//   keys.bin              { <providerId>: <key> } encrypted as one blob (DPAPI through Electron safeStorage)
//   usage\YYYY-MM.jsonl   one line per call: time, feature, slot, provider, model, prompt id/version, tokens, cost, outcome. No text.
//   cli-work\             the empty working folder of command-line clients
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ModelError, toPlain } = require('./errors');
const { validate, parseJsonLoose } = require('./schema');
const { createAnthropic } = require('./anthropic');
const { createOpenAICompat, PRESETS } = require('./openai-compat');
const { createCli, PROFILES } = require('./cli');
const SHIPPED_PRICES = require('./prices.json');

const SLOTS = ['strong', 'fast', 'vision'];
const KINDS = ['anthropic', 'openai-compatible', 'cli'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

function writeSafe(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
const monthOf = (t) => new Date(t).toISOString().slice(0, 7);
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

function createModelService(opts) {
  const dir = path.join(opts.dir, 'models');
  const now = opts.now || (() => Date.now());
  const encrypt = opts.encrypt;   // async (string) -> Buffer
  const decrypt = opts.decrypt;   // async (Buffer) -> string
  const factories = Object.assign({ anthropic: createAnthropic, 'openai-compatible': createOpenAICompat, cli: createCli }, opts.adapters || {});
  const running = new Map();      // callId -> AbortController
  const configFile = path.join(dir, 'providers.json');
  const keysFile = path.join(dir, 'keys.bin');
  let keysCache = null;

  // ---- configuration
  function readConfig() {
    let c = {};
    try { c = JSON.parse(fs.readFileSync(configFile, 'utf8')) || {}; } catch (e) { /* first start */ }
    return {
      providers: Array.isArray(c.providers) ? c.providers : [],
      slots: Object.assign({ strong: null, fast: null, vision: null }, c.slots || {}),
      budget: Object.assign({ monthlyUsd: null, allowOverMonth: null }, c.budget || {}),
      prices: c.prices && typeof c.prices === 'object' ? c.prices : {},
    };
  }
  function writeConfig(c) { writeSafe(configFile, JSON.stringify(c, null, 1)); }

  async function readKeys() {
    if (keysCache) return keysCache;
    let buf = null;
    try { buf = fs.readFileSync(keysFile); } catch (e) { keysCache = {}; return keysCache; }
    try { keysCache = JSON.parse(await decrypt(buf)) || {}; } catch (e) { throw new ModelError('auth', 'The stored keys could not be decrypted on this Windows account. Add the keys again.'); }
    return keysCache;
  }
  async function writeKeys(keys) {
    keysCache = keys;
    if (!Object.keys(keys).length) { try { fs.unlinkSync(keysFile); } catch (e) { /* none */ } return; }
    const blob = await encrypt(JSON.stringify(keys));
    fs.mkdirSync(dir, { recursive: true });
    const tmp = keysFile + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, blob);
    fs.renameSync(tmp, keysFile);
  }

  // What the window may see: no keys, only whether one is stored
  async function publicConfig() {
    const c = readConfig();
    let keys = {};
    try { keys = await readKeys(); } catch (e) { /* shown as no key */ }
    return {
      providers: c.providers.map((p) => Object.assign({}, p, { hasKey: !!keys[p.id], executable: p.kind === 'cli' ? executableOf(p) : undefined })),
      slots: c.slots, budget: c.budget, prices: c.prices,
      shippedPrices: SHIPPED_PRICES,
      presets: Object.keys(PRESETS).map((k) => ({ id: k, label: PRESETS[k].label, baseUrl: PRESETS[k].baseUrl, needsKey: PRESETS[k].needsKey })),
      profiles: Object.keys(PROFILES).map((k) => ({ id: k, label: PROFILES[k].label, command: PROFILES[k].command })),
      configured: c.providers.length > 0 && SLOTS.some((s) => c.slots[s] && c.slots[s].providerId),
    };
  }

  function executableOf(p) {
    try { const a = factories.cli({ profile: p.profile, command: p.command, args: p.args, workDir: path.join(dir, 'cli-work') }); return a.executable ? a.executable() : null; } catch (e) { return null; }
  }

  function cleanProvider(p) {
    if (!p || typeof p !== 'object') throw new ModelError('invalid', 'Invalid provider.');
    if (KINDS.indexOf(p.kind) < 0) throw new ModelError('invalid', 'Unknown provider kind.');
    const out = { id: String(p.id || '').trim().toLowerCase(), kind: p.kind, label: String(p.label || '').slice(0, 60).trim() };
    if (!ID_RE.test(out.id)) throw new ModelError('invalid', 'The provider id may use a-z, 0-9 and "-" (up to 41 characters).');
    if (p.kind === 'openai-compatible') {
      out.preset = PRESETS[p.preset] ? p.preset : 'custom';
      out.baseUrl = String(p.baseUrl || PRESETS[out.preset].baseUrl || '').trim();
      if (!/^https?:\/\/[^\s]+$/i.test(out.baseUrl)) throw new ModelError('invalid', 'The address must start with http:// or https://.');
      if (/^http:\/\//i.test(out.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(out.baseUrl)) throw new ModelError('invalid', 'Use https:// for anything that is not on this PC.');
      if (p.structured === 'json_schema' || p.structured === 'json-mode') out.structured = p.structured;
      // Ollama: the largest context window Kartotek asks for (it grows with the prompt up to this; more needs more memory)
      if (out.preset === 'ollama' && p.maxContext != null && p.maxContext !== '') {
        const n = Math.round(Number(p.maxContext));
        if (!(n >= 8192 && n <= 262144)) throw new ModelError('invalid', 'The context window must be between 8192 and 262144 tokens.');
        out.maxContext = n;
      }
    }
    if (p.kind === 'anthropic' && p.baseUrl) {
      out.baseUrl = String(p.baseUrl).trim();
      if (!/^https:\/\/[^\s]+$/i.test(out.baseUrl)) throw new ModelError('invalid', 'The address must start with https://.');
    }
    if (p.kind === 'cli') {
      out.profile = PROFILES[p.profile] ? p.profile : 'custom';
      out.command = String(p.command || PROFILES[out.profile].command || '').trim();
      if (!out.command) throw new ModelError('invalid', 'Give the command or the full path of the client.');
      if (out.profile === 'custom') out.args = String(p.args || '').slice(0, 500);
    }
    if (Array.isArray(p.models)) out.models = p.models.map(String).filter(Boolean).slice(0, 50);
    if (!out.label) out.label = out.kind === 'cli' ? PROFILES[out.profile].label : out.kind === 'anthropic' ? 'Anthropic' : PRESETS[out.preset].label;
    return out;
  }

  async function saveProvider(p, key) {
    const c = readConfig();
    const clean = cleanProvider(p);
    const i = c.providers.findIndex((x) => x.id === clean.id);
    if (i >= 0) c.providers[i] = clean; else c.providers.push(clean);
    writeConfig(c);
    if (typeof key === 'string' && key.trim()) await setKey(clean.id, key.trim());
    return publicConfig();
  }
  async function setKey(providerId, key) {
    if (typeof key !== 'string' || !key.trim() || key.length > 2000) throw new ModelError('invalid', 'Invalid key.');
    const keys = Object.assign({}, await readKeys().catch(() => ({})));
    keys[providerId] = key.trim();
    await writeKeys(keys);
  }
  async function clearKey(providerId) {
    const keys = Object.assign({}, await readKeys().catch(() => ({})));
    delete keys[providerId];
    await writeKeys(keys);
    return publicConfig();
  }
  async function removeProvider(id) {
    const c = readConfig();
    c.providers = c.providers.filter((p) => p.id !== id);
    SLOTS.forEach((s) => { if (c.slots[s] && c.slots[s].providerId === id) c.slots[s] = null; });
    writeConfig(c);
    await clearKey(id);
    return publicConfig();
  }
  async function setSlot(slot, providerId, model) {
    if (SLOTS.indexOf(slot) < 0) throw new ModelError('invalid', 'Unknown slot.');
    const c = readConfig();
    if (!providerId) c.slots[slot] = null;
    else {
      if (!c.providers.some((p) => p.id === providerId)) throw new ModelError('invalid', 'Unknown provider.');
      c.slots[slot] = { providerId, model: String(model || '').trim().slice(0, 120) };
    }
    writeConfig(c);
    return publicConfig();
  }
  async function setBudget(monthlyUsd) {
    const c = readConfig();
    const v = monthlyUsd === null || monthlyUsd === '' ? null : Number(monthlyUsd);
    if (v !== null && !(v >= 0 && v < 1e6)) throw new ModelError('invalid', 'The budget must be a number of dollars.');
    c.budget.monthlyUsd = v;
    writeConfig(c);
    return publicConfig();
  }
  async function allowOverBudget() {
    const c = readConfig();
    c.budget.allowOverMonth = monthOf(now());
    writeConfig(c);
    return publicConfig();
  }
  async function setPrice(model, price) {
    const c = readConfig();
    const m = String(model || '').trim().slice(0, 120);
    if (!m) throw new ModelError('invalid', 'Give a model name.');
    if (price === null) delete c.prices[m];
    else {
      const p = { input: Number(price.input), output: Number(price.output) };
      if (price.cacheRead !== undefined && price.cacheRead !== '') p.cacheRead = Number(price.cacheRead);
      if (!(p.input >= 0 && p.output >= 0)) throw new ModelError('invalid', 'Prices are dollars per million tokens.');
      c.prices[m] = p;
    }
    writeConfig(c);
    return publicConfig();
  }

  // ---- prices and usage
  function priceOf(model, c) {
    return (c.prices && c.prices[model]) || SHIPPED_PRICES.models[model] || null;
  }
  function costOf(usage, model, c) {
    const p = priceOf(model, c);
    if (!p) return null;
    const cacheRead = usage.cacheRead || 0;
    const fresh = Math.max(0, (usage.input || 0));
    return (fresh * p.input + (usage.output || 0) * p.output + cacheRead * (p.cacheRead != null ? p.cacheRead : p.input) + (usage.cacheWrite || 0) * p.input * 1.25) / 1e6;
  }
  function usageFile(t) { return path.join(dir, 'usage', monthOf(t) + '.jsonl'); }
  function logUsage(row) {
    const f = usageFile(row.t);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify(row) + '\n');
  }
  function readUsage(month) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, 'usage', month + '.jsonl'), 'utf8'); } catch (e) { return []; }
    return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  }
  function monthSpend(month) {
    return readUsage(month).reduce((s, r) => s + (r.costKind === 'api' && typeof r.costUsd === 'number' ? r.costUsd : 0), 0);
  }
  function budgetState(c) {
    const month = monthOf(now());
    const spent = monthSpend(month);
    const limit = c.budget.monthlyUsd;
    const ratio = limit ? spent / limit : null;
    return { month, spent, limit, ratio, warn: ratio != null && ratio >= 0.8, over: ratio != null && ratio >= 1, allowedOver: c.budget.allowOverMonth === month };
  }
  function usageSummary(month) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : monthOf(now());
    const rows = readUsage(m);
    const add = (map, key, r) => {
      const x = map[key] || (map[key] = { calls: 0, input: 0, output: 0, costUsd: 0, unpriced: 0, subscriptionEstimateUsd: 0, failed: 0 });
      x.calls++;
      x.input += r.input || 0; x.output += r.output || 0;
      if (r.outcome !== 'ok') x.failed++;
      if (r.costKind === 'api') { if (typeof r.costUsd === 'number') x.costUsd += r.costUsd; else if (r.outcome === 'ok') x.unpriced++; }
      if (r.costKind === 'subscription-estimate' && typeof r.costUsd === 'number') x.subscriptionEstimateUsd += r.costUsd;
    };
    const byDay = {}, byFeature = {}, byModel = {}, total = {};
    rows.forEach((r) => { add(byDay, dayOf(r.t), r); add(byFeature, r.feature || 'other', r); add(byModel, r.provider + ' · ' + (r.model || 'default model'), r); add(total, 'all', r); });
    const months = [];
    try { fs.readdirSync(path.join(dir, 'usage')).forEach((f) => { const x = /^(\d{4}-\d{2})\.jsonl$/.exec(f); if (x) months.push(x[1]); }); } catch (e) { /* none */ }
    return { month: m, months: months.sort().reverse(), total: total.all || { calls: 0, input: 0, output: 0, costUsd: 0, unpriced: 0, subscriptionEstimateUsd: 0, failed: 0 }, byDay, byFeature, byModel, budget: budgetState(readConfig()) };
  }

  // ---- running a call
  async function adapterFor(provider) {
    const keys = await readKeys().catch((e) => { throw e; });
    const key = keys[provider.id] || '';
    if (provider.kind === 'anthropic') {
      if (!key) throw new ModelError('not-configured', 'No API key is stored for ' + provider.label + '.');
      return factories.anthropic({ apiKey: key, baseUrl: provider.baseUrl });
    }
    if (provider.kind === 'openai-compatible') {
      const preset = PRESETS[provider.preset] || PRESETS.custom;
      if (preset.needsKey && !key) throw new ModelError('not-configured', 'No API key is stored for ' + provider.label + '.');
      return factories['openai-compatible']({ preset: provider.preset, baseUrl: provider.baseUrl, apiKey: key || undefined, structured: provider.structured, label: provider.label, maxContext: provider.maxContext });
    }
    return factories.cli({ profile: provider.profile, command: provider.command, args: provider.args, workDir: path.join(dir, 'cli-work'), timeoutMs: opts.cliTimeoutMs });
  }

  // Which provider and model a request uses: an explicit target, else its slot, else the strong slot
  function resolveTarget(req, c) {
    let target = null;
    if (req.target && req.target.providerId) target = req.target;
    else if (req.slot && c.slots[req.slot] && c.slots[req.slot].providerId) target = c.slots[req.slot];
    else if (c.slots.strong && c.slots.strong.providerId) target = c.slots.strong;
    if (!target) throw new ModelError('not-configured', 'No model is set up for this task.');
    const provider = c.providers.find((p) => p.id === target.providerId);
    if (!provider) throw new ModelError('not-configured', 'The provider of this slot was removed.');
    return { provider, model: target.model || '' };
  }

  const hasImages = (req) => req.messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'image'));
  // true / false / null (not known). A command-line client never reads images; Ollama is asked which capabilities the model has.
  async function imageSupportOf(adapter, caps, model) {
    if (!caps.images) return false;
    if (typeof adapter.supportsImages === 'function') return adapter.supportsImages(model);
    return true;
  }
  const noImagesText = (t) => t.provider.label + (t.model ? ' (' + t.model + ')' : '') + ' cannot read images. Set up a vision model (Settings, Models, Vision slot) that can, for example a hosted model or a local one with vision such as a llava or qwen-vl model.';
  // G2 (S5): can the slot or target read images? { ok: true | false | null, reason? }. null = the provider does not say.
  async function imageSupport(targetOrSlot) {
    const c = readConfig();
    let t;
    try { t = resolveTarget(targetOrSlot && targetOrSlot.providerId ? { target: targetOrSlot } : { slot: targetOrSlot && targetOrSlot.slot || 'vision' }, c); } catch (e) { return { ok: false, reason: 'No model is set up for reading images (Settings, Models).' }; }
    try {
      const adapter = await adapterFor(t.provider);
      const sees = await imageSupportOf(adapter, adapter.capabilities(t.model), t.model);
      return sees === false ? { ok: false, reason: noImagesText(t) } : { ok: sees };
    } catch (e) { return { ok: null }; }
  }

  function checkRequest(req) {
    if (!req || typeof req !== 'object') throw new ModelError('invalid', 'Invalid request.');
    if (!Array.isArray(req.messages) || !req.messages.length) throw new ModelError('invalid', 'The request has no messages.');
    req.messages.forEach((m) => {
      if (m.role !== 'user' && m.role !== 'assistant') throw new ModelError('invalid', 'Messages are from "user" or "assistant".');
      if (typeof m.content !== 'string' && !Array.isArray(m.content)) throw new ModelError('invalid', 'Invalid message content.');
      if (Array.isArray(m.content)) m.content.forEach((c) => {
        if (c.type === 'text' && typeof c.text === 'string') return;
        if (c.type === 'image' && /^image\/(png|jpeg|gif|webp)$/.test(c.mime) && typeof c.data === 'string') return;
        throw new ModelError('invalid', 'Invalid content block.');
      });
    });
  }

  // run(request, { callId, onEvent }) -> result. request: { feature, slot | target, system, messages, schema?, webSearch?,
  // maxOutputTokens?, effort?, promptId?, promptVersion?, promptHash?, confirmBudget? }
  async function run(req, ctx) {
    ctx = ctx || {};
    const onEvent = ctx.onEvent || (() => {});
    const started = now();
    const c = readConfig();
    let target = null;
    const row = { t: started, feature: String((req && req.feature) || 'other').slice(0, 60), slot: req && req.slot || null, provider: null, model: null,
      promptId: req && req.promptId || null, promptVersion: req && req.promptVersion || null, promptHash: req && req.promptHash || null,
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: null, costKind: null, ms: 0, outcome: 'ok', repaired: false };
    const controller = new AbortController();
    if (ctx.callId) running.set(ctx.callId, controller);
    try {
      checkRequest(req);
      target = resolveTarget(req, c);
      row.provider = target.provider.id; row.model = target.model || null;
      const b = budgetState(c);
      if (b.over && !b.allowedOver && !req.confirmBudget && target.provider.kind !== 'cli' && target.provider.preset !== 'ollama') {
        throw new ModelError('budget', 'This month\'s budget of $' + b.limit.toFixed(2) + ' is used up ($' + b.spent.toFixed(2) + ').');
      }
      const adapter = await adapterFor(target.provider);
      const caps = adapter.capabilities(target.model);
      if (hasImages(req)) {
        const sees = await imageSupportOf(adapter, caps, target.model);
        if (sees === false) throw new ModelError('invalid', noImagesText(target));
      }
      if (req.webSearch && !caps.webSearch) throw new ModelError('invalid', 'Web search is not available with ' + target.provider.label + '.');
      const call = Object.assign({}, req, { model: target.model, webSearch: !!req.webSearch && caps.webSearch });
      // Without a native schema mode, ask for JSON in the system text (the result is validated below either way)
      if (call.schema && caps.structured !== 'native' && target.provider.kind !== 'cli') {
        call.system = (call.system ? call.system + '\n\n' : '') + 'Answer with JSON only, no other text, matching this JSON Schema:\n' + JSON.stringify(call.schema);
      }
      onEvent({ type: 'status', text: 'Asking ' + target.provider.label + (target.model ? ' (' + target.model + ')' : '') });
      let res = await adapter.run(call, { signal: controller.signal, onEvent });
      const total = { input: res.usage.input, output: res.usage.output, cacheRead: res.usage.cacheRead || 0, cacheWrite: res.usage.cacheWrite || 0 };
      let costSum = typeof res.costUsd === 'number' ? res.costUsd : null;
      let json;
      if (req.schema) {
        const got = jsonOf(res, req.schema);
        if (got.ok) json = got.value;
        else {
          // one repair call with the validation errors
          row.repaired = true;
          onEvent({ type: 'status', text: 'The answer did not match the required shape; asking once more' });
          const repair = Object.assign({}, call, { messages: call.messages.concat([
            { role: 'assistant', content: res.text || '(no answer)' },
            { role: 'user', content: 'Your answer does not match the required JSON Schema. Problems: ' + got.errors.slice(0, 10).join('; ') + '. Answer again with JSON only that matches the schema.' },
          ]) });
          const res2 = await adapter.run(repair, { signal: controller.signal, onEvent });
          total.input += res2.usage.input; total.output += res2.usage.output; total.cacheRead += res2.usage.cacheRead || 0; total.cacheWrite += res2.usage.cacheWrite || 0;
          if (typeof res2.costUsd === 'number') costSum = (costSum || 0) + res2.costUsd;
          const got2 = jsonOf(res2, req.schema);
          res = res2;
          if (!got2.ok) throw new ModelError('schema', 'The answer did not match the required shape: ' + got2.errors.slice(0, 5).join('; '));
          json = got2.value;
        }
      }
      const model = res.model || target.model;
      const costKind = res.costKind || 'api';
      const costUsd = costKind === 'free-local' ? 0 : costKind === 'subscription-estimate' ? costSum : costOf(total, model, c);
      Object.assign(row, total, { model, costUsd, costKind, ms: now() - started });
      const result = { text: res.text, json, usage: total, costUsd, costKind, provider: target.provider.id, providerLabel: target.provider.label, model,
        stopReason: res.stopReason || null, durationMs: row.ms, repaired: row.repaired, usageReported: res.usageReported !== false, budget: budgetState(c) };
      return result;
    } catch (e) {
      const plain = toPlain(e);
      row.outcome = plain.code; row.ms = now() - started;
      throw new ModelError(plain.code, plain.message);
    } finally {
      if (ctx.callId) running.delete(ctx.callId);
      if (row.provider) { try { logUsage(row); } catch (x) { /* the call itself succeeded or failed already */ } }
    }
  }

  function jsonOf(res, schema) {
    let value = res.json;
    if (value === undefined) {
      const p = parseJsonLoose(res.text);
      if (!p.ok) return { ok: false, errors: [p.error] };
      value = p.value;
    }
    const errors = validate(schema, value);
    return errors.length ? { ok: false, errors } : { ok: true, value };
  }

  function cancel(callId) {
    const c = running.get(callId);
    if (c) c.abort();
    return !!c;
  }

  // One small call through the shipped "connection-test" prompt (structured output included): the reply, the time and the cost
  const TEST_PHRASE = 'Kartotek connection works.';
  async function test(providerId, model, ctx) {
    const req = { feature: 'connection-test', target: { providerId, model }, effort: 'low', maxOutputTokens: 2000, confirmBudget: true };
    if (opts.prompts) {
      const p = opts.prompts.render('connection-test', { phrase: TEST_PHRASE });
      Object.assign(req, { messages: [{ role: 'user', content: p.text }], schema: p.schema || undefined, promptId: p.promptId, promptVersion: p.promptVersion, promptHash: p.promptHash });
    } else {
      req.messages = [{ role: 'user', content: 'Reply with exactly: ' + TEST_PHRASE }];
    }
    const res = await run(req, ctx);
    res.reply = res.json && typeof res.json.reply === 'string' ? res.json.reply : res.text;
    res.replyMatches = String(res.reply || '').trim().replace(/^`+(text)?\s*|\s*`+$/g, '').trim() === TEST_PHRASE;
    return res;
  }

  async function listModels(providerId) {
    const c = readConfig();
    const provider = c.providers.find((p) => p.id === providerId);
    if (!provider) throw new ModelError('invalid', 'Unknown provider.');
    const adapter = await adapterFor(provider);
    return adapter.listModels();
  }

  // A cost estimate before a job starts (task E3): which provider and model a slot or target uses and what the tokens would cost
  async function estimate(targetOrSlot, usage) {
    const c = readConfig();
    let t;
    try { t = resolveTarget(targetOrSlot && targetOrSlot.providerId ? { target: targetOrSlot } : { slot: targetOrSlot && targetOrSlot.slot || 'strong' }, c); } catch (e) {
      return { configured: false, providerLabel: null, model: null, costKind: null, costUsd: null };
    }
    const p = t.provider;
    const costKind = p.kind === 'cli' ? 'subscription-estimate' : (p.kind === 'openai-compatible' && (PRESETS[p.preset] || {}).costKind === 'free-local') ? 'free-local' : 'api';
    const u = { input: usage.input || 0, output: usage.output || 0, cacheRead: 0, cacheWrite: 0 };
    const cost = costKind === 'free-local' ? 0 : costOf(u, t.model, c);
    return { configured: true, provider: p.id, providerLabel: p.label, providerKind: p.kind, model: t.model || null, costKind, costUsd: cost, budget: budgetState(c) };
  }

  // The window's question "is any model set up for this slot?" without exposing anything else
  async function status() {
    const c = readConfig();
    const slots = {};
    SLOTS.forEach((s) => {
      const t = c.slots[s];
      const p = t && c.providers.find((x) => x.id === t.providerId);
      slots[s] = p ? { provider: p.label, model: t.model || '' } : null;
    });
    return { configured: SLOTS.some((s) => slots[s]), slots, budget: budgetState(c) };
  }

  // ---- web search for the researcher (task F7): the strong slot's provider when it has a web search tool, else a search key
  // (Brave Search API) stored with the other keys (encrypted, never sent to the window). Without either, research is unavailable.
  const SEARCH_KEY = 'search:brave';
  async function setSearchKey(key) { await setKey(SEARCH_KEY, key); return searchStatus(); }
  async function clearSearchKey() { await clearKey(SEARCH_KEY); return searchStatus(); }
  // → { mode: "provider" | "key" | null, label, hasKey }
  async function searchStatus() {
    const c = readConfig();
    let keys = {};
    try { keys = await readKeys(); } catch (e) { /* none */ }
    const hasKey = !!keys[SEARCH_KEY];
    let provider = null;
    try {
      const t = resolveTarget({ slot: 'strong' }, c);
      const a = await adapterFor(t.provider);
      if (a.capabilities(t.model).webSearch) provider = t.provider.label + (t.model ? ' (' + t.model + ')' : '');
    } catch (e) { /* no strong slot or no key */ }
    if (provider) return { mode: 'provider', label: 'web search of ' + provider, hasKey };
    if (hasKey) return { mode: 'key', label: 'Brave Search (your search key)', hasKey };
    return { mode: null, label: null, hasKey };
  }
  // One web search with the search key: [{ title, url, snippet }]
  async function search(query, o) {
    let keys = {};
    try { keys = await readKeys(); } catch (e) { /* none */ }
    const key = keys[SEARCH_KEY];
    if (!key) throw new ModelError('not-configured', 'No search key is stored.');
    const q = String(query || '').slice(0, 300);
    if (!q.trim()) throw new ModelError('invalid', 'Empty search.');
    const doFetch = (o && o.fetch) || opts.fetch || fetch;
    let res;
    try {
      res = await doFetch('https://api.search.brave.com/res/v1/web/search?count=6&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
    } catch (e) { throw new ModelError('network', 'Kartotek could not reach the search service.'); }
    if (!res.ok) {
      // Brave sends {error: {code, detail}}; an invalid or inactive key comes back as 422 SUBSCRIPTION_TOKEN_INVALID
      let code = '', detail = '';
      try { const e = ((await res.json()) || {}).error || {}; code = String(e.code || ''); detail = String(e.detail || '').slice(0, 200); } catch (e) { /* no body */ }
      if (res.status === 401 || res.status === 403 || /TOKEN|SUBSCRIPTION|PLAN/i.test(code)) throw new ModelError('auth', 'The search service refused the key (' + res.status + (code ? ' ' + code : '') + ')' + (detail ? ': ' + detail : '.'));
      if (res.status === 429) throw new ModelError('rate-limit', 'The search service limit was reached. Try again later.');
      throw new ModelError('provider', 'The search service answered ' + res.status + (code ? ' ' + code : '') + (detail ? ': ' + detail : '.'));
    }
    const j = await res.json();
    return (((j || {}).web || {}).results || []).slice(0, 6).map((r) => ({ title: String(r.title || '').slice(0, 200), url: String(r.url || ''), snippet: String(r.description || '').replace(/<[^>]+>/g, '').slice(0, 400) }))
      .filter((r) => /^https?:\/\//.test(r.url));
  }

  return { publicConfig, saveProvider, setKey, clearKey, removeProvider, setSlot, setBudget, allowOverBudget, setPrice, run, test, cancel, listModels, usageSummary, status, estimate, imageSupport,
    setSearchKey, clearSearchKey, searchStatus, search,
    _dir: dir, _readKeysRaw: () => { try { return fs.readFileSync(keysFile); } catch (e) { return null; } } };
}

// A short, stable hash of a prompt override (recorded with results)
function shortHash(text) { return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12); }

module.exports = { createModelService, shortHash, SLOTS };
