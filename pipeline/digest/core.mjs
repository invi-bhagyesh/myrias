// Shared parsing and matching for the China-focused digest.
export const iso = d => d.toISOString().slice(0, 10);
export const inWindow = (date, from, to) => !!date && date >= from && date <= to;
export const shiftDate = (date, days) => iso(new Date(Date.parse(date + 'T00:00:00Z') + days * 864e5));
export const chinaDay = (now = new Date()) => iso(new Date(+now + 8 * 3600e3));
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && iso(new Date(value)) === value;
}
export function completedWeek(now = new Date()) {
  const yesterday = shiftDate(chinaDay(now), -1);
  const weekday = new Date(yesterday + 'T00:00:00Z').getUTCDay();
  const to = shiftDate(yesterday, -((weekday + 2) % 7));
  return { from: shiftDate(to, -6), to };
}

// Strip tags and entities from a bit of HTML text.
export function cleanText(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^[\s·•\-–—]+/, '').replace(/\s+/g, ' ').trim();
}

// A date written as 2026-11-05, 2026/11/5, 2026.11.05 or 2026年11月5日, as YYYY-MM-DD.
export function findDate(s) {
  const m = String(s || '').match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  const date = m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
  return validDate(date) ? date : null;
}

// The date a URL carries, from a pattern with year, month and (optionally) day groups. Month only gives null day.
export function dateFromUrl(url, pattern) {
  const m = String(url).match(new RegExp(pattern));
  if (!m) return { date: null, month: null };
  const [y, mo, d] = [m[1], m[2].padStart(2, '0'), m[3]];
  const date = d ? `${y}-${mo}-${d.padStart(2, '0')}` : null;
  return { date: validDate(date) ? date : null, month: `${y}-${mo}` };
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
  const hit = (list, t) => list.filter(w => /[a-z]/i.test(w)
    ? new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(t)
    : t.includes(w.toLowerCase()));
  const animal = hit(terms.animal, T), broad = hit(terms.welfare, T), strong = hit(terms.strong, T);
  const animalish = animal.length > 0 || strong.some(w => /动物|animal/.test(w));
  let tier = strong.length && animalish ? 'welfare' : animal.length && broad.length ? 'related' : null;
  if (!tier && scope === 'general') { const bs = hit(terms.strong, B), ba = hit(terms.animal, B); if (bs.length && (ba.length || bs.some(w => /动物/.test(w)))) tier = 'mention'; }
  if (!tier && scope !== 'general' && scope !== 'paper' && animal.length) tier = 'animal';
  const matched = [...new Set([...strong, ...broad, ...animal, ...(tier === 'mention' ? hit(terms.strong, B) : [])])].slice(0, 8);
  return { keep: !!tier, tier, matched };
}

// Same story from two sources (or twice in one): same URL, or same title once spaces and punctuation are gone.
export function dedupe(items) {
  const seen = new Set(), out = [];
  for (const it of items) {
    const keys = identityKeys(it), duplicate = keys.some(k => seen.has(k));
    keys.forEach(k => seen.add(k));
    if (!duplicate) out.push(it);
  }
  return out;
}

export function normalizeDoi(value) {
  const doi = String(value || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

export function identityKeys(it) {
  const keys = [], doi = normalizeDoi(it.doi || it.url);
  if (doi) keys.push('doi:' + doi);
  if (it.source && it.provider_id) keys.push(`id:${it.source}:${it.provider_id}`);
  if (it.url) keys.push('url:' + it.url.replace(/^https?:\/\//, '').replace(/\/$/, ''));
  const title = cleanText(it.title).replace(/[\s\p{P}]/gu, '').toLowerCase();
  if (title) keys.push('title:' + title);
  return keys;
}

export function chinaEvidence({ affiliations = [], countries = [], title = '', abstract = '' }, terms) {
  if (countries.some(c => ['cn', 'hk', 'mo'].includes(String(c).toLowerCase()))) return 'affiliation';
  const match = text => (terms.china_affiliations || []).some(w => /[a-z]/i.test(w)
    ? new RegExp(`\\b${w}\\b`, 'i').test(text) : text.includes(w));
  if (affiliations.some(a => match(String(a)))) return 'affiliation';
  if (/\b(?:China|Chinese)\b|中国|中國/i.test(title + ' ' + abstract)) return 'text_mention';
  return null;
}

export const languageCode = lang => ({ eng: 'en', chi: 'zh', zho: 'zh', Chinese: 'zh', English: 'en', '中文': 'zh', '英文': 'en' }[lang] || (/^[a-z]{2,3}$/i.test(lang || '') ? lang.toLowerCase() : 'und'));
export const titleLanguage = (title, lang = 'en') => /[\u3400-\u9fff]/u.test(title) ? 'zh-Hans'
  : ['zh', 'und'].includes(languageCode(lang)) ? (/[a-z]/i.test(title) ? 'en' : 'und') : languageCode(lang);
