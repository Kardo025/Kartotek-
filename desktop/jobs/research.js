'use strict';
// The researcher (task F7, LEARNING-PROTOCOL 3.12): a background job that checks one factual claim against the web and returns a short
// brief with its sources. Two ways to search, chosen when the job runs:
//   provider: the strong slot's provider has a web search tool (today the Anthropic adapter): one call with the tool switched on;
//   key: a search key (Brave Search API) set in Settings: Kartotek searches (three queries), then the model writes the brief from those
//        results only, and every URL in the brief must be one of them.
// Every source link is then opened from this PC; the brief shows which ones answer. A brief without sources is not a verdict.
const STEPS = [['search', 'Search the web'], ['brief', 'Write the brief'], ['links', 'Check the links']];

function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

async function prepare(ctx) {
  const r = ctx.request || {};
  if (!String(r.claim || '').trim()) throw new Error('There is no claim to check.');
  if (!ctx.research) throw new Error('Research is not available here.');
  const st = await ctx.research.status();
  if (!st.mode) throw new Error('Research needs a provider with web search (an Anthropic API key in the strong slot) or a search key in Settings.');
  ctx.data.mode = st.mode;
  ctx.data.searchLabel = st.label;
  ctx.job.title = 'Check: ' + clip(r.claim, 80);
  ctx.plan(st.mode === 'key' ? STEPS : STEPS.filter((s) => s[0] !== 'search'));
}

function estimate(ctx) {
  const key = ctx.data.mode === 'key';
  return { rows: [{ step: 'Brief', slot: 'strong', calls: 1, input: key ? 6000 : 15000, output: 1200 }], note: key ? 'Three searches with your search key, then one call.' : 'One call with up to five web searches by your provider (searches are billed by the provider).' };
}

function queries(r) {
  const c = clip(r.claim, 200);
  return [c, c + ' textbook definition', c + ' lecture notes'];
}
const WORDS = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
function checkBrief(json, allowed) {
  const p = [];
  if (!json || ['supported', 'contradicted', 'unclear'].indexOf(json.verdict) < 0) { p.push('"verdict" must be supported, contradicted or unclear.'); return p; }
  if (!String(json.summary || '').trim()) p.push('"summary" is empty.');
  const src = Array.isArray(json.sources) ? json.sources : [];
  src.forEach((s, i) => {
    if (!/^https?:\/\/[^\s]+$/.test(String(s.url || ''))) p.push('Source ' + (i + 1) + ': the url is not a web address.');
    else if (allowed && !allowed.has(normUrl(s.url))) p.push('Source ' + (i + 1) + ': ' + s.url + ' is not one of the search results; cite only those.');
    if (WORDS(s.quote) > 25) p.push('Source ' + (i + 1) + ': the quote is longer than 25 words.');
  });
  if (json.verdict !== 'unclear' && !src.length) p.push('A verdict other than "unclear" needs at least one source.');
  (json.findings || []).forEach((f, i) => (f.sources || []).forEach((n) => { if (!(n >= 1 && n <= src.length)) p.push('Finding ' + (i + 1) + ' cites source ' + n + ', which is not in the list.'); }));
  return p;
}
const normUrl = (u) => String(u || '').trim().replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();

async function run(ctx) {
  const r = ctx.request, C = require('./common');
  let results = null;
  if (ctx.data.mode === 'key') {
    await ctx.step('search', 'Search the web', async (s) => {
      results = await ctx.task(s, 'q', 'Three searches', async () => {
        const seen = new Set(), out = [];
        for (const q of queries(r)) {
          ctx.check();
          const rows = await ctx.research.search(q);
          rows.forEach((x) => { const k = normUrl(x.url); if (!seen.has(k) && out.length < 12) { seen.add(k); out.push(x); } });
        }
        s.detail = out.length + ' results';
        return out;
      });
    });
    if (!results) results = (ctx.job.steps.find((x) => x.id === 'search').tasks[0] || {}).result || [];
  }
  let brief = null;
  await ctx.step('brief', 'Write the brief', async (s) => {
    brief = await ctx.task(s, 'b', 'The brief', async (t) => {
      const allowed = results ? new Set(results.map((x) => normUrl(x.url))) : null;
      const vars = { claim: r.claim, context: r.context || '(none)', sources: r.sources || '(none given)',
        results: results ? (results.length ? results.map((x, i) => '[' + (i + 1) + '] ' + x.title + ' — ' + x.url + '\n' + x.snippet).join('\n\n') : '(the searches found nothing)') : '(none: use your web search tool)', problems: 'none' };
      const out = await C.askChecked(ctx, t, { prompt: 'researcher', vars, schema: ctx.schema('researcher'), feature: 'researcher', webSearch: ctx.data.mode === 'provider', maxOutputTokens: 4000 }, (j) => checkBrief(j, allowed), 1);
      return out.json;
    });
  });
  if (!brief) brief = (ctx.job.steps.find((x) => x.id === 'brief').tasks[0] || {}).result;
  await ctx.step('links', 'Check the links', async (s) => {
    const srcs = brief.sources || [];
    for (const x of srcs) {
      ctx.check();
      const c = await ctx.research.checkLink(x.url);
      x.working = c.ok; x.status = c.status || null;
    }
    s.detail = srcs.filter((x) => x.working).length + ' of ' + srcs.length + ' links answered';
  });
  ctx.job.result = { brief, mode: ctx.data.mode, search: ctx.data.searchLabel, by: Object.keys(ctx.job.writers || {})[0] || null };
}

module.exports = { prepare, estimate, run, checkBrief, queries };
