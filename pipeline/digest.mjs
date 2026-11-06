// Weekly digest of Chinese-language animal welfare news and papers: links only for now.
//
//   node pipeline/digest.mjs [--from 2026-10-31 --to 2026-11-06] [--sources pipeline/digest/sources.json]
//                            [--out public/data/digest] [--only id,id] [--dry-run]
//
// Reads each source in pipeline/digest/sources.json with the reader its 'access.type' names, keeps items dated
// inside the window, sorts them into tiers with pipeline/digest/terms.json, drops duplicates, and writes one issue
// (public/data/digest/<to>.json) plus the list of issues (index.json). Every source also gets a status line (ok,
// empty, failed, with the error), so a site that blocks us or changes its layout shows up at once.
// Method and design notes: pipeline/digest/METHOD.md.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------- pure helpers (tested in tests/digest.test.mjs) ----------

export const iso = d => d.toISOString().slice(0, 10);
export const inWindow = (date, from, to) => !!date && date >= from && date <= to;

// Strip tags and entities from a bit of HTML text.
export function cleanText(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^[\s·•\-–—]+/, '').replace(/\s+/g, ' ').trim();
}

// A date written as 2026-11-05, 2026/11/5, 2026.11.05 or 2026年11月5日, as YYYY-MM-DD.
export function findDate(s) {
  const m = String(s || '').match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

// The date a URL carries, from a pattern with year, month and (optionally) day groups. Month only gives null day.
export function dateFromUrl(url, pattern) {
  const m = String(url).match(new RegExp(pattern));
  if (!m) return { date: null, month: null };
  const [y, mo, d] = [m[1], m[2].padStart(2, '0'), m[3]];
  return d ? { date: `${y}-${mo}-${d.padStart(2, '0')}`, month: `${y}-${mo}` } : { date: null, month: `${y}-${mo}` };
}

// Links on a list page that match the source's link pattern, with their title and any date beside them.
// opts: { link, title: 'attr' | 'text', date_from_url, date_near }
export function parseList(html, baseUrl, opts) {
  const out = [], seen = new Set();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const linkRe = new RegExp(opts.link);
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1], href = (attrs.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href || !linkRe.test(href)) continue;
    const url = new URL(href, baseUrl).href;
    if (seen.has(url)) continue;
    const t = opts.title === 'attr' ? (attrs.match(/title\s*=\s*["']([^"']+)["']/i) || [])[1] : null;
    const title = cleanText(t || m[2]);
    if (!title || title.length < 4) continue;
    seen.add(url);
    let date = null, month = null;
    if (opts.date_from_url) ({ date, month } = dateFromUrl(url, opts.date_from_url));
    if (!date && opts.date_near) date = findDate(html.slice(m.index + m[0].length, m.index + m[0].length + 160));
    out.push({ url, title, date, month });
  }
  return out;
}

// Which terms an item contains, and its tier. The title decides; the body (search snippet) only adds 'mention'.
//   welfare: a strong welfare term in the title, with an animal in view (动物福利 counts as both)
//   related: an animal and a broader welfare term (stress, disease, transport, density...) in the title
//   mention: the title names no welfare term, but the snippet does (general sources only)
//   animal:  an animal in the title, nothing about welfare (topical sources only: agriculture, veterinary)
// General sources keep welfare, related and mention items; topical sources keep welfare, related and animal.
export function classify(title, terms, scope, body = '') {
  const strip = s => (terms.exclude || []).reduce((t, w) => t.split(w.toLowerCase()).join(' '), String(s || '').toLowerCase());
  const T = strip(title), B = strip(body);
  const hit = (list, t) => list.filter(w => t.includes(w.toLowerCase()));
  const animal = hit(terms.animal, T), broad = hit(terms.welfare, T), strong = hit(terms.strong, T);
  const animalish = animal.length > 0 || strong.some(w => /动物|animal/.test(w)) || scope === 'paper';
  let tier = strong.length && animalish ? 'welfare' : (animal.length || scope === 'paper') && broad.length ? 'related' : null;
  if (!tier && scope === 'general') { const bs = hit(terms.strong, B), ba = hit(terms.animal, B); if (bs.length && (ba.length || bs.some(w => /动物/.test(w)))) tier = 'mention'; }
  if (!tier && scope !== 'general' && scope !== 'paper' && animal.length) tier = 'animal';
  const matched = [...new Set([...strong, ...broad, ...animal, ...(tier === 'mention' ? hit(terms.strong, B) : [])])].slice(0, 8);
  return { keep: !!tier, tier, matched };
}

// Same story from two sources (or twice in one): same URL, or same title once spaces and punctuation are gone.
export function dedupe(items) {
  const key = s => String(s).replace(/[\s\p{P}]/gu, '').toLowerCase();
  const byUrl = new Set(), byTitle = new Set(), out = [];
  for (const it of items) {
    const u = it.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), k = key(it.title);
    if (byUrl.has(u) || byTitle.has(k)) continue;
    byUrl.add(u); byTitle.add(k); out.push(it);
  }
  return out;
}

// ---------- fetching ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lastHit = new Map();
// One request at a time per host, at least a second apart; a timeout and one retry.
async function get(url, { ua, method = 'GET', body = null, headers = {}, encoding = null, timeout = 20000 } = {}) {
  const host = new URL(url).host, wait = (lastHit.get(host) || 0) + 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  let err;
  for (let attempt = 0; attempt < 2; attempt++) {
    lastHit.set(host, Date.now());
    try {
      const res = await fetch(url, { method, body, headers: { 'User-Agent': ua, ...headers }, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // The page's own charset, unless the source names one; Chinese sites often use GBK.
      const declared = encoding || (String(res.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1]
        || (buf.subarray(0, 2048).toString('latin1').match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
      let text = new TextDecoder(/^gb/i.test(declared) ? 'gb18030' : declared, { fatal: false }).decode(buf);
      // Some pages declare GB2312 but are UTF-8: fall back when the GB reading is mostly replacement characters.
      if (/^gb/i.test(declared) && (text.match(/�/g) || []).length > 20) text = buf.toString('utf8');
      return text;
    } catch (e) { err = e; await sleep(2000); }
  }
  throw err;
}

// ---------- readers, one per access type ----------

const READERS = {
  // Generic list page: links matching a pattern, title from the link, date from the URL, the text beside it, or
  // (for matched items only) the article page itself.
  async 'html-list'(src, ctx) {
    const html = await get(src.access.url, { ua: ctx.ua, encoding: src.access.encoding });
    if (html.length < 500) throw new Error(`the page came back nearly empty (${html.length} bytes)`);
    const rows = parseList(html, src.access.url, src.access);
    if (!rows.length) throw new Error('no links matched the pattern: the page layout may have changed');
    const out = [];
    for (const r of rows) {
      const c = classify(r.title, ctx.terms, src.scope);
      if (!c.keep) continue;
      // Month known, day not: fetch the article for its date, but only if the month overlaps the window.
      if (!r.date && src.access.date_from_page && r.month && r.month >= ctx.from.slice(0, 7) && r.month <= ctx.to.slice(0, 7)) {
        try { r.date = findDate((await get(r.url, { ua: ctx.ua, encoding: src.access.encoding })).slice(0, 20000)); } catch { /* left undated */ }
      }
      out.push({ ...r, ...c, seen: rows.length });
    }
    return { items: out, scanned: rows.length };
  },

  // People's Daily site search: JSON, newest first, one query per keyword.
  async 'people-search'(src, ctx) {
    const out = []; let scanned = 0;
    for (const key of src.access.keywords) {
      for (let page = 1; page <= (src.access.pages || 1); page++) {
        const body = JSON.stringify({ key, page, limit: 20, hasTitle: true, hasContent: true, isFuzzy: false, type: 0, sortType: 0, startTime: 0, endTime: 0 });
        const d = JSON.parse(await get(src.access.url, { ua: ctx.ua, method: 'POST', body, headers: { 'Content-Type': 'application/json' } }));
        const recs = d?.data?.records || [];
        scanned += recs.length;
        for (const r of recs) {
          const date = r.inputTime ? iso(new Date(r.inputTime + 8 * 3600e3)) : findDate(r.displayTime);
          const title = cleanText(r.title);
          const c = classify(title, ctx.terms, src.scope, cleanText(r.content).slice(0, 400));
          if (c.keep) out.push({ url: r.url, title, date, ...c, query: key });
        }
        // Newest first: once a page ends before the window, later pages are older still.
        const last = recs.at(-1);
        if (!recs.length || (last?.inputTime && iso(new Date(last.inputTime)) < ctx.from)) break;
      }
    }
    return { items: out, scanned };
  },

  // Europe PMC: papers first published in the window, with an author affiliation in China.
  async europepmc(src, ctx) {
    const q = `(${src.access.query}) AND FIRST_PDATE:[${ctx.from} TO ${ctx.to}]`;
    const out = []; let cursor = '*', scanned = 0;
    for (let i = 0; i < 5; i++) {
      // POST: the query is long, and long GET queries get HTTP 503 from Europe PMC.
      const body = new URLSearchParams({ query: q, format: 'json', pageSize: '100', resultType: 'lite', cursorMark: cursor }).toString();
      const d = JSON.parse(await get('https://www.ebi.ac.uk/europepmc/webservices/rest/searchPOST', { ua: ctx.ua, method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
      const rs = d?.resultList?.result || [];
      scanned += rs.length;
      for (const r of rs) {
        const url = r.doi ? `https://doi.org/${r.doi}` : r.pmid ? `https://europepmc.org/article/MED/${r.pmid}` : `https://europepmc.org/article/${r.source}/${r.id}`;
        const c = classify(r.title, ctx.terms, 'paper');
        if (c.keep) out.push({ url, title: cleanText(r.title), date: r.firstPublicationDate, venue: r.journalTitle || null, lang: 'en', ...c });
      }
      // The last page has fewer rows than asked for, or no next-page marker.
      if (rs.length < 100 || !d.nextCursorMark || d.nextCursorMark === cursor) break;
      cursor = d.nextCursorMark;
    }
    return { items: out, scanned };
  }
};

// ---------- the run ----------

export async function collect({ sources, terms, from, to, only = null, ua }) {
  const ctx = { terms, from, to, ua };
  const status = [], all = [];
  for (const src of sources) {
    if (only && !only.includes(src.id)) continue;
    const t0 = Date.now();
    const reader = READERS[src.access.type];
    try {
      if (!reader) throw new Error(`no reader for access type '${src.access.type}'`);
      const { items, scanned } = await reader(src, ctx);
      const kept = items.filter(it => inWindow(it.date, from, to));
      const undated = items.filter(it => !it.date).length;
      for (const it of kept) all.push({ source: src.id, kind: src.kind, lang: it.lang || 'zh', url: it.url, title: it.title, date: it.date, tier: it.tier, matched: it.matched, ...(it.venue ? { venue: it.venue } : {}) });
      status.push({ id: src.id, status: kept.length ? 'ok' : 'empty', scanned, relevant: items.length, in_window: kept.length, undated, seconds: Math.round((Date.now() - t0) / 100) / 10 });
    } catch (e) {
      status.push({ id: src.id, status: 'failed', error: String(e.message || e).slice(0, 200), seconds: Math.round((Date.now() - t0) / 100) / 10 });
    }
  }
  const TIER = { welfare: 0, related: 1, mention: 2, animal: 3 };
  const items = dedupe(all.sort((a, b) => TIER[a.tier] - TIER[b.tier] || b.date.localeCompare(a.date)));
  return { items, status };
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const to = arg('to', iso(new Date())), from = arg('from', iso(new Date(Date.parse(to) - 6 * 864e5)));
  const reg = JSON.parse(readFileSync(arg('sources', join(HERE, 'digest/sources.json')), 'utf8'));
  const terms = JSON.parse(readFileSync(join(HERE, 'digest/terms.json'), 'utf8'));
  const only = arg('only', null)?.split(',');
  const { items, status } = await collect({ sources: reg.sources, terms, from, to, only, ua: reg.user_agent });
  const issue = { id: to, from, to, generated_at: new Date().toISOString(), counts: { items: items.length, welfare: items.filter(i => i.tier === 'welfare').length },
    sources: reg.sources.map(s => ({ id: s.id, name_zh: s.name_zh, name_en: s.name_en, kind: s.kind, ...status.find(x => x.id === s.id) })), not_used: reg.not_used, items };
  console.log(JSON.stringify({ from, to, items: items.length, by_tier: items.reduce((m, i) => ({ ...m, [i.tier]: (m[i.tier] || 0) + 1 }), {}), sources: status }, null, 1));
  if (process.argv.includes('--dry-run')) return;
  const out = arg('out', 'public/data/digest');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${to}.json`), JSON.stringify(issue, null, 1));
  const idxPath = join(out, 'index.json');
  const idx = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, 'utf8')) : { issues: [] };
  idx.issues = [{ id: to, from, to, items: items.length, welfare: issue.counts.welfare, file: `${to}.json` }, ...idx.issues.filter(x => x.id !== to)].sort((a, b) => b.id.localeCompare(a.id));
  writeFileSync(idxPath, JSON.stringify(idx, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
