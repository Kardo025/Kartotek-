'use strict';
// Does a web address answer? (task F7: every researcher source is opened from this PC before the brief is shown)
// HEAD first, GET when a server refuses HEAD; redirects are followed; 8 seconds at most. Only http and https.
async function checkLink(url, o) {
  const doFetch = (o && o.fetch) || fetch;
  if (!/^https?:\/\/[^\s]+$/i.test(String(url || ''))) return { ok: false, status: null, error: 'not a web address' };
  const once = async (method) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), (o && o.timeoutMs) || 8000);
    try {
      const r = await doFetch(url, { method, redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': 'Kartotek link check', Accept: 'text/html,application/pdf,*/*' } });
      return { ok: r.status < 400, status: r.status };
    } catch (e) { return { ok: false, status: null, error: e && e.name === 'AbortError' ? 'timed out' : 'unreachable' }; } finally { clearTimeout(t); }
  };
  const h = await once('HEAD');
  if (h.ok) return h;
  const g = await once('GET');
  return g.ok ? g : (g.status ? g : h);
}
module.exports = { checkLink };
