// Intake (L1): find what the open indexes hold on one species, tag the welfare topics each record
// touches, and fetch the open-access full text for a fresh run.
//   node pipeline/intake.mjs --species pipeline/gap/mandarin-fish.json --out DIR [--fetch] [--fetch-all] [--max-fetch N]
// Sources: Europe PMC, Crossref, DOAJ, OpenAlex and Semantic Scholar, searched with the species'
// English and Chinese names. A source that refuses (rate limit, outage) is recorded as unavailable,
// never silently skipped. CNKI, Wanfang and CQVIP are not searched: they need a licence decision.
// No model is called, so intake costs nothing. DIR must be outside the repository: it holds
// abstracts and full text.
//
// DIR/records.jsonl  one merged record per paper (all sources that found it, topics, open-access links)
// DIR/status.json    what each source returned or why it did not
// DIR/summary.json   counts by source, language, year, topic and access
// --fetch            DIR/pdf/<id>.pdf for open PDFs, DIR/xml-pages.jsonl for Europe PMC full text
//                    (one "page" per article section; normalize.py turns the PDFs into pages.jsonl)
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const UA = 'myrias-intake/0.1 (research; https://github.com/invi-bhagyesh/myrias)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Entities first, so an escaped tag such as &lt;i&gt; is removed as a tag rather than left as "i".
export const stripTags = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
const cjk = s => (String(s || '').match(/[一-鿿]/g) || []).length;
export const langOf = (title, given) => (cjk(title) >= 2 ? 'zh' : given === 'chi' || given === 'zh' ? 'zh' : 'en');

async function get(url, { tries = 4, json = true } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(60000) }); }
    catch (e) { last = e.message; await sleep(2000 * 2 ** i); continue; }
    if (res.ok) return json ? res.json() : res;
    last = `HTTP ${res.status}`;
    if (![429, 500, 502, 503, 504].includes(res.status)) break;
    await sleep(4000 * 2 ** i);
  }
  const err = new Error(last || 'failed'); err.unavailable = true; throw err;
}

// ---------- welfare topics ----------
// Keyword groups, English and Chinese, named after the welfare problems in the taxonomy plus two
// broader groups. A record with no topic is kept but marked as basic biology.
export const TOPICS = {
  feeding: ['feed', 'feeding', 'diet', 'live prey', 'forage', 'pellet', 'starv', 'food habit', '驯食', '驯化', '饲料', '投喂', '摄食', '饵料', '饥饿', '食性'],
  stocking_density: ['stocking density', 'rearing density', 'density', '密度', '放养'],
  water_quality: ['water quality', 'dissolved oxygen', 'hypoxi', 'ammonia', 'nitrite', 'temperature', 'thermal', 'salinity', 'recirculat', '水质', '溶氧', '溶解氧', '缺氧', '氨氮', '亚硝酸', '水温', '温度', '低温', '高温', '盐度', '循环水'],
  handling_transport: ['live transport', 'transportation', 'transported', 'simulated transport', 'handling stress', 'handling', 'anesthe', 'anaesthe', 'ms-222', 'eugenol', 'crowding', '运输', '麻醉', '捕捞', '拥挤'],
  stunning_slaughter: ['slaughter', 'stunning', 'euthan', 'pre-slaughter', 'post-mortem', 'postmortem', '屠宰', '致晕', '宰杀', '宰前'],
  disease_parasites: ['virus', 'viral', 'isknv', 'iridovir', 'bacteri', 'aeromonas', 'parasit', 'infect', 'immun', 'vaccin', 'disease', 'pathogen', 'antibiotic', 'drug', '病毒', '疾病', '寄生虫', '细菌', '感染', '免疫', '疫苗', '病害', '药物'],
  procedures: ['induced spawning', 'hormone', 'injection', 'sex revers', 'triploid', 'tagging', 'artificial propagation', 'artificial breeding', '催产', '注射', '人工繁殖', '三倍体', '性逆转'],
  stress_behaviour: ['stress', 'cortisol', 'behavio', 'welfare', 'pain', 'nocicept', '应激', '皮质醇', '行为', '福利'],
  breeding: ['selective breeding', 'selection', 'strain', 'hybrid', 'domestication', '选育', '杂交', '良种', '品系']
};
export function topicsOf(rec) {
  const t = `${rec.title || ''} ${rec.abstract || ''}`.toLowerCase();
  return Object.entries(TOPICS).filter(([, words]) => words.some(w => t.includes(w))).map(([k]) => k);
}

// ---------- species filter and merging ----------
export function namesSpecies(rec, sp) {
  const t = `${rec.title || ''} ${rec.abstract || ''}`;
  const low = t.toLowerCase();
  const hit = sp.english_terms.some(x => low.includes(x.toLowerCase())) || (sp.chinese_terms || []).some(x => t.includes(x));
  return hit && !(sp.exclude_terms || []).some(x => low.includes(x.toLowerCase()));
}
// The species is the subject of the paper, not a passing mention in the abstract.
export function inTitle(rec, sp) {
  const t = String(rec.title || '');
  return sp.english_terms.some(x => t.toLowerCase().includes(x.toLowerCase())) || (sp.chinese_terms || []).some(x => t.includes(x));
}
export const titleKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');
export function keyOf(r) { return r.doi ? 'doi:' + r.doi.toLowerCase() : r.pmid ? 'pmid:' + r.pmid : 't:' + titleKey(r.title).slice(0, 120); }

// Merge records from several sources. Records sharing a DOI, PMID or normalised title are one paper;
// for each field the first non-empty value wins, and every source that found the paper is listed.
export function mergeRecords(list) {
  const byKey = new Map(), alias = new Map();
  for (const r of list) {
    const keys = [r.doi && 'doi:' + r.doi.toLowerCase(), r.pmid && 'pmid:' + r.pmid, r.title && 't:' + titleKey(r.title).slice(0, 120)].filter(Boolean);
    const hit = keys.map(k => alias.get(k)).find(Boolean);
    const m = hit ? byKey.get(hit) : { sources: [], oa: {} };
    for (const [k, v] of Object.entries(r)) {
      if (k === 'source' || k === 'oa') continue;
      if ((m[k] === undefined || m[k] === null || m[k] === '') && v !== undefined && v !== null && v !== '') m[k] = v;
    }
    if (!m.sources.includes(r.source)) m.sources.push(r.source);
    for (const [k, v] of Object.entries(r.oa || {})) if (v && !m.oa[k]) m.oa[k] = v;
    const key = hit || keys[0];
    byKey.set(key, m);
    for (const k of keys) alias.set(k, key);
  }
  return [...byKey.values()];
}

// ---------- sources ----------
// Each returns { records, note }; a refusal throws with .unavailable.
async function europePmc(sp) {
  const q = [...sp.english_terms.map(t => `TITLE_ABS:"${t}"`), ...(sp.chinese_terms || []).map(t => `TITLE_ABS:"${t}"`)].join(' OR ');
  const out = [];
  let cursor = '*';
  for (let page = 0; page < 20; page++) {
    const j = await get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&resultType=core&pageSize=1000&cursorMark=${encodeURIComponent(cursor)}`);
    for (const it of j.resultList?.result || []) {
      const urls = it.fullTextUrlList?.fullTextUrl || [];
      out.push({
        source: 'europepmc', doi: it.doi || null, pmid: it.pmid || null, pmcid: it.pmcid || null,
        title: stripTags(it.title), abstract: stripTags(it.abstractText), year: it.pubYear ? Number(it.pubYear) : null,
        venue: it.journalInfo?.journal?.title || it.bookOrReportDetails?.publisher || null, language: it.language || null,
        authors: (it.authorList?.author || []).map(a => a.fullName).filter(Boolean).slice(0, 12),
        oa: { epmc_xml: it.isOpenAccess === 'Y' && it.pmcid ? it.pmcid : null, landing: (urls.find(u => u.documentStyle === 'html' && u.availabilityCode === 'OA') || {}).url || null }
      });
    }
    if (!j.nextCursorMark || j.nextCursorMark === cursor || !(j.resultList?.result || []).length) break;
    cursor = j.nextCursorMark;
  }
  return { records: out, note: `${out.length} records from a title/abstract search` };
}

async function crossref(sp) {
  const terms = [...sp.english_terms, ...(sp.chinese_query_terms || sp.chinese_terms || [])];
  const out = [];
  for (const term of terms) {
    let cursor = '*', kept = 0;
    for (let page = 0; page < 8; page++) {
      const j = await get(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(term)}&rows=500&cursor=${encodeURIComponent(cursor)}&select=DOI,title,abstract,issued,container-title,link,type,author,URL`);
      const items = j.message?.items || [];
      let pageHits = 0;
      for (const it of items) {
        const rec = {
          source: 'crossref', doi: it.DOI || null, title: stripTags((it.title || [])[0]), abstract: stripTags(it.abstract),
          year: it.issued?.['date-parts']?.[0]?.[0] ?? null, venue: (it['container-title'] || [])[0] || null, type: it.type || null,
          authors: (it.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).slice(0, 12),
          oa: { pdf: ((it.link || []).find(l => /pdf/i.test(l['content-type'] || '')) || {}).URL || null, landing: it.URL || null }
        };
        if (namesSpecies(rec, sp)) { out.push(rec); pageHits++; kept++; }
      }
      // Crossref ranks by relevance: once a whole page names the species nowhere, stop.
      if (!items.length || pageHits === 0 || !j.message['next-cursor']) break;
      cursor = j.message['next-cursor'];
    }
    await sleep(500);
  }
  return { records: out, note: `${out.length} records that name the species, from ${terms.length} searches` };
}

async function doaj(sp) {
  const out = [];
  for (const term of [...sp.english_terms, ...(sp.chinese_terms || [])]) {
    for (let page = 1; page <= 10; page++) {
      const j = await get(`https://doaj.org/api/search/articles/${encodeURIComponent(`"${term}"`)}?page=${page}&pageSize=100`);
      const items = j.results || [];
      for (const it of items) {
        const b = it.bibjson || {};
        const links = b.link || [];
        out.push({
          source: 'doaj', doi: ((b.identifier || []).find(i => i.type === 'doi') || {}).id || null, title: stripTags(b.title), abstract: stripTags(b.abstract),
          year: b.year ? Number(b.year) : null, venue: b.journal?.title || null, language: (b.journal?.language || [])[0] || null,
          authors: (b.author || []).map(a => a.name).filter(Boolean).slice(0, 12),
          oa: { pdf: ((links.find(l => /\.pdf($|\?)/i.test(l.url || '')) || {}).url) || null, landing: (links.find(l => l.type === 'fulltext') || {}).url || null }
        });
      }
      if (items.length < 100) break;
    }
    await sleep(500);
  }
  return { records: out.filter(r => namesSpecies(r, sp)), note: 'open-access journals only' };
}

async function openAlex(sp) {
  const terms = [...sp.english_terms, ...(sp.chinese_terms || [])].map(t => `"${t}"`).join(' OR ');
  const out = [];
  let cursor = '*';
  const abs = inv => { if (!inv) return ''; const w = []; for (const [k, pos] of Object.entries(inv)) for (const p of pos) w[p] = k; return w.join(' '); };
  for (let page = 0; page < 30; page++) {
    const j = await get(`https://api.openalex.org/works?filter=title_and_abstract.search:${encodeURIComponent(terms)}&per-page=200&cursor=${encodeURIComponent(cursor)}`, { tries: 5 });
    for (const it of j.results || []) {
      out.push({
        source: 'openalex', doi: it.doi ? it.doi.replace('https://doi.org/', '') : null, pmid: it.ids?.pmid ? it.ids.pmid.split('/').pop() : null,
        title: stripTags(it.title), abstract: abs(it.abstract_inverted_index), year: it.publication_year ?? null,
        venue: it.primary_location?.source?.display_name || null, language: it.language || null,
        authors: (it.authorships || []).map(a => a.author?.display_name).filter(Boolean).slice(0, 12),
        oa: { pdf: it.best_oa_location?.pdf_url || null, landing: it.best_oa_location?.landing_page_url || null }
      });
    }
    if (!j.meta?.next_cursor || !(j.results || []).length) break;
    cursor = j.meta.next_cursor;
  }
  return { records: out.filter(r => namesSpecies(r, sp)), note: `${out.length} records from a title/abstract search` };
}

async function semanticScholar(sp) {
  const out = [];
  for (const term of sp.english_terms) {
    let token = null;
    for (let page = 0; page < 10; page++) {
      const j = await get(`https://api.semanticscholar.org/graph/v1/paper/search/bulk?query=${encodeURIComponent(`"${term}"`)}&fields=title,abstract,year,venue,externalIds,openAccessPdf${token ? '&token=' + token : ''}`, { tries: 5 });
      for (const it of j.data || []) out.push({
        source: 'semanticscholar', doi: it.externalIds?.DOI || null, pmid: it.externalIds?.PubMed || null, title: stripTags(it.title), abstract: stripTags(it.abstract),
        year: it.year ?? null, venue: it.venue || null, oa: { pdf: it.openAccessPdf?.url || null }
      });
      if (!j.token) break;
      token = j.token;
    }
    await sleep(1500);
  }
  return { records: out.filter(r => namesSpecies(r, sp)), note: 'English-language index' };
}

const SOURCES = { europepmc: europePmc, crossref, doaj, openalex: openAlex, semanticscholar: semanticScholar };
export const NOT_SEARCHED = {
  cnki: 'Not searched: licensed database, and not reachable from this server.',
  wanfang: 'Not searched: licensed database; scraping its search pages needs a licence decision.',
  cqvip: 'Not searched: licensed database; scraping its search pages needs a licence decision.'
};

// ---------- full text ----------
// Europe PMC full text (JATS XML) as one "page" per top-level section, so quotes can still be located.
export function jatsSections(xml) {
  const body = (xml.match(/<body[\s\S]*<\/body>/) || [''])[0];
  const title = stripTags((xml.match(/<article-title[^>]*>([\s\S]*?)<\/article-title>/) || [])[1]);
  const abstract = stripTags((xml.match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/) || [])[1]);
  const parts = [];
  if (title || abstract) parts.push(`${title}\n\n${abstract}`.trim());
  if (!/<sec[ >]/.test(body)) { if (body) parts.push(stripTags(body)); return parts.map(p => p.trim()).filter(p => p.length > 40); }
  let depth = 0, cur = '';
  for (const chunk of body.split(/(<sec[ >]|<\/sec>)/)) {
    if (/^<sec[ >]$/.test(chunk)) { if (depth === 0 && cur.trim()) { parts.push(stripTags(cur)); cur = ''; } depth++; continue; }
    if (chunk === '</sec>') { depth--; if (depth === 0 && cur.trim()) { parts.push(stripTags(cur)); cur = ''; } continue; }
    if (depth > 0) cur += ' ' + chunk.replace(/<title>/g, '\n').replace(/<\/title>/g, '\n').replace(/<\/p>/g, '\n');
  }
  return parts.map(p => p.trim()).filter(p => p.length > 40);
}
export const pdfMeta = html => (String(html).match(/<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i) || String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/i) || [])[1] || null;

async function fetchPdf(url, path) {
  const res = await get(url, { json: false, tries: 2 });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.slice(0, 5).toString() !== '%PDF-') return null;
  writeFileSync(path, buf);
  return buf.length;
}

async function fetchOne(rec, dir) {
  const tried = [];
  if (rec.oa.epmc_xml) {
    try {
      const res = await get(`https://www.ebi.ac.uk/europepmc/webservices/rest/${rec.oa.epmc_xml}/fullTextXML`, { json: false, tries: 2 });
      const secs = jatsSections(await res.text());
      if (secs.length) {
        for (const [i, text] of secs.entries()) appendFileSync(`${dir}/xml-pages.jsonl`, JSON.stringify({ source: rec.id, page: i + 1, locator: 'section', text }) + '\n');
        return { via: 'europepmc_xml', sections: secs.length };
      }
    } catch (e) { tried.push('europepmc_xml: ' + e.message); }
  }
  const candidates = [rec.oa.pdf].filter(Boolean);
  for (const url of candidates) {
    try { const n = await fetchPdf(url, `${dir}/pdf/${rec.id}.pdf`); if (n) return { via: 'pdf', url, bytes: n }; tried.push(`${url}: not a PDF`); }
    catch (e) { tried.push(`${url}: ${e.message}`); }
  }
  // Publisher landing page: most journal platforms, Chinese ones included, name the PDF in a meta tag.
  const landing = rec.oa.landing || (rec.doi ? `https://doi.org/${rec.doi}` : null);
  if (landing) {
    try {
      const res = await get(landing, { json: false, tries: 2 });
      const pdf = pdfMeta(await res.text());
      if (pdf) {
        const abs = new URL(pdf, res.url).href;
        const n = await fetchPdf(abs, `${dir}/pdf/${rec.id}.pdf`);
        if (n) return { via: 'landing_meta', url: abs, bytes: n };
        tried.push(`${abs}: not a PDF (likely behind a login or paywall)`);
      } else tried.push(`${landing}: no PDF link on the page`);
    } catch (e) { tried.push(`${landing}: ${e.message}`); }
  }
  return { via: null, tried };
}

// ---------- main ----------
async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const has = n => process.argv.includes('--' + n);
  const sp = JSON.parse(readFileSync(arg('species'), 'utf8')).species;
  const out = arg('out');
  mkdirSync(`${out}/pdf`, { recursive: true });

  const status = {}, all = [];
  for (const [name, fn] of Object.entries(SOURCES)) {
    const t0 = Date.now();
    try { const r = await fn(sp); all.push(...r.records); status[name] = { status: 'ok', records: r.records.length, note: r.note, seconds: Math.round((Date.now() - t0) / 1000) }; }
    catch (e) { status[name] = { status: 'unavailable', reason: e.message }; }
    console.error(name, status[name]);
  }
  for (const [name, why] of Object.entries(NOT_SEARCHED)) status[name] = { status: 'not_searched', reason: why };

  const merged = mergeRecords(all.filter(r => r.title)).filter(r => namesSpecies(r, sp));
  merged.forEach(r => {
    // Stable across reruns, so an interrupted fetch resumes where it stopped.
    r.id = 'R' + createHash('sha1').update(keyOf(r)).digest('hex').slice(0, 10);
    r.lang = langOf(r.title, r.language);
    r.topics = topicsOf(r);
    r.welfare_relevant = r.topics.length > 0;
    r.species_in_title = inTitle(r, sp);
    r.open_access = Boolean(r.oa.epmc_xml || r.oa.pdf);
  });

  if (has('fetch')) {
    // By default only papers about the species (named in the title) that touch a welfare topic.
    const want = merged.filter(r => has('fetch-all') || (r.welfare_relevant && r.species_in_title)).slice(0, Number(arg('max-fetch', 100000)));
    const done = existsSync(`${out}/fetch.jsonl`) ? new Set(readFileSync(`${out}/fetch.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id)) : new Set();
    const queue = want.filter(r => !done.has(r.id));
    const worker = async () => { while (queue.length) { const r = queue.shift(); const f = await fetchOne(r, out); appendFileSync(`${out}/fetch.jsonl`, JSON.stringify({ id: r.id, ...f }) + '\n'); await sleep(400); } };
    await Promise.all(Array.from({ length: 4 }, worker));
    const log = new Map(readFileSync(`${out}/fetch.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(f => [f.id, f]));
    for (const r of merged) if (log.has(r.id)) r.fetched = log.get(r.id).via;
  }

  writeFileSync(`${out}/records.jsonl`, merged.map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(`${out}/status.json`, JSON.stringify(status, null, 2));
  const count = f => merged.reduce((m, r) => { for (const k of [].concat(f(r))) m[k] = (m[k] || 0) + 1; return m; }, {});
  const summary = {
    species: sp.scientific, papers: merged.length, by_language: count(r => r.lang), species_in_title: merged.filter(r => r.species_in_title).length,
    welfare_relevant: merged.filter(r => r.welfare_relevant).length, about_species_and_welfare: count(r => (r.species_in_title && r.welfare_relevant ? r.lang : [])),
    by_topic: count(r => r.topics), by_source: count(r => r.sources), found_by_one_source_only: merged.filter(r => r.sources.length === 1).length,
    by_decade: count(r => (r.year ? Math.floor(r.year / 10) * 10 + 's' : 'unknown')), open_access: merged.filter(r => r.open_access).length,
    fetched: count(r => r.fetched || (has('fetch') && (has('fetch-all') || (r.welfare_relevant && r.species_in_title)) ? 'not_fetched' : [])), sources: status
  };
  writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
