// Affiliations and kind of paper: where the authors of each paper we read are from, and what kind of paper it is.
//   node pipeline/affiliations.mjs --store STORE_DIR --pages A.jsonl,B.jsonl --out public/data/papers.json [--records intake/records.jsonl] [--concurrency 16] [--log FILE]
// Reads the first two pages of each paper in the store (the title block lists the authors' institutions) and
// asks the affiliations model for the institutions, their country and sector, which one is the first
// author's, and the kind of paper. Code then places each paper by its first author's institution: a region
// from the country, and for China the sector (university, research institute or government, company).
// Papers taken from Europe PMC XML start at the title and abstract, with no author block; for those, given
// --records, the authors' affiliations listed by Europe PMC (by PMCID, PMID or DOI) are added to what the model
// reads, and a paper cached with no institution is read again once such a list exists.
// Results are cached in STORE/paper-meta.json, so a later run only reads new papers. The site file holds
// bibliographic metadata only (institution names, countries, kinds), never paper text.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from './llm.mjs';

export const AFFIL_VERSION = 'affiliations-0.1';
export const KINDS = ['experiment', 'field_study', 'review', 'methods', 'thesis', 'other'];
export const SECTORS = ['university', 'research_institute', 'government', 'company', 'hospital', 'other'];
export const AFFIL_SYSTEM = `You read the first pages of a research paper and report where its authors work and what kind of paper it is.
List every institution named for the authors, once each: name in English (translate Chinese names), country as a two-letter ISO code, and sector:
university (including agricultural universities and their colleges), research_institute (academies of sciences or fishery sciences and their institutes, research centres), government (bureaus, extension stations, ministries), company, hospital, other.
first_author: the index in your list of the first author's institution (the first one given for that author), or -1 if no institution is named.
kind: experiment (the authors ran a trial or lab experiment), field_study (a survey, sampling or observation on farms or in the wild), review (a review or overview of other work), methods (developing a technique, assay, cell line or genome resource), thesis (a degree thesis), other (news, extension notes, anything else).
Use only what the pages say. If no institution is given, return an empty list.`;
export const AFFIL_SCHEMA = { type: 'object', additionalProperties: false, required: ['institutions', 'first_author', 'kind'], properties: {
  institutions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'country', 'sector'],
    properties: { name: { type: 'string' }, country: { type: 'string' }, sector: { type: 'string', enum: SECTORS } } } },
  first_author: { type: 'integer' }, kind: { type: 'string', enum: KINDS } } };

const EUROPE = new Set('AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB VA'.split(' '));
const AMERICAS = new Set('US CA MX BR AR CL CO PE VE EC BO PY UY CR PA CU DO GT HN NI SV JM TT'.split(' '));
const ASIA = new Set('JP KR KP TW HK MO MN VN TH MY SG ID PH KH LA MM BD IN PK LK NP IR IQ IL SA AE TR KZ UZ'.split(' '));

// Pure: the group a paper falls in, from its first author's institution.
export function affiliationGroup(meta) {
  const inst = meta?.institutions?.[meta.first_author] || null;
  if (!inst) return 'unknown';
  const c = String(inst.country || '').toUpperCase();
  if (c === 'CN') return inst.sector === 'university' ? 'cn_university' : inst.sector === 'company' ? 'cn_company' : ['research_institute', 'government'].includes(inst.sector) ? 'cn_institute' : 'cn_other';
  if (EUROPE.has(c)) return 'europe';
  if (ASIA.has(c)) return 'asia';
  if (AMERICAS.has(c)) return 'americas';
  return c ? 'other' : 'unknown';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const store = arg('store'), cachePath = join(store, 'paper-meta.json');
  const sources = JSON.parse(readFileSync(join(store, 'sources.json'), 'utf8'));
  const first = new Map();
  for (const f of arg('pages').split(',')) for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const p = JSON.parse(l), key = String(p.source).replace(/\.pdf$/, '');
    if (p.page <= 2) first.set(key, ((first.get(key) || '') + '\n' + p.text).slice(0, 6000));
  }
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const keyOf = k => String(k).replace(/\.pdf$/, '');
  // Affiliations listed by Europe PMC, for papers whose first pages may not name them.
  const records = new Map(arg('records') ? readFileSync(arg('records'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.id, r]) : []);
  const epmc = new Map();
  const need = Object.entries(sources).filter(([k, s]) => (!cache[k] || cache[k].first_author < 0) && records.get(s.record_id || k));
  for (let i = 0; i < need.length; i += 8) await Promise.all(need.slice(i, i + 8).map(async ([k, s]) => {
    const r = records.get(s.record_id || k), q = r.pmcid ? `PMCID:${r.pmcid}` : r.pmid ? `EXT_ID:${r.pmid} AND SRC:MED` : r.doi ? `DOI:"${r.doi}"` : null;
    if (!q) return;
    try {
      const j = await (await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&resultType=core&format=json`)).json();
      const authors = j.resultList?.result?.[0]?.authorList?.author || [];
      const lines = authors.map(a => `${a.fullName || a.lastName}: ${(a.authorAffiliationDetailsList?.authorAffiliation || []).map(x => x.affiliation).join(' ; ')}`).filter(l => !/:\s*$/.test(l));
      if (lines.length) epmc.set(k, lines.slice(0, 30).join('\n'));
    } catch { /* no list: the pages alone are read */ }
  }));
  const todo = Object.entries(sources).filter(([k]) => (!cache[k] || (cache[k].first_author < 0 && epmc.has(k))) && (first.has(keyOf(k)) || epmc.has(k)));
  const missing = Object.keys(sources).filter(k => !first.has(keyOf(k)));
  const client = createClient({ logPath: arg('log', join(store, '..', `affiliations-${new Date().toISOString().slice(0, 10)}.calls.jsonl`)) });
  const queue = [...todo];
  await Promise.all(Array.from({ length: Number(arg('concurrency', 16)) }, async () => {
    while (queue.length) {
      const [k, s] = queue.shift();
      const r = await client.call('affiliations', { system: AFFIL_SYSTEM, user: `Title: ${s.title}\n${epmc.has(k) ? `Authors and affiliations as listed by Europe PMC (in author order):\n${epmc.get(k)}\n` : ''}First pages:\n${first.get(keyOf(k)) || '(not available)'}\nReturn JSON.`, schema: AFFIL_SCHEMA });
      if (!r.data) { console.error(`affiliations: unparsed output for ${s.id}`); continue; }
      const fa = r.data.first_author >= 0 && r.data.first_author < r.data.institutions.length ? r.data.first_author : -1;
      cache[k] = { ...r.data, first_author: fa, model: r.entry.model, version: AFFIL_VERSION, ...(epmc.has(k) ? { with: 'europepmc_affiliations' } : {}) };
    }
  }));
  writeFileSync(cachePath, JSON.stringify(cache, null, 1) + '\n');
  // The site file: one row per paper we read, by its release id.
  const papers = Object.entries(sources).map(([k, s]) => {
    const m = cache[k], inst = m?.institutions?.[m.first_author];
    return { id: s.id, lang: s.lang, year: s.year, group: affiliationGroup(m), kind: m?.kind || 'unknown', country: inst?.country?.toUpperCase() || null,
      institution: inst?.name || null, countries: m ? [...new Set(m.institutions.map(i => String(i.country).toUpperCase()).filter(Boolean))] : [] };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const models = [...new Set(Object.values(cache).map(m => m.model))];
  writeFileSync(arg('out'), JSON.stringify({ version: AFFIL_VERSION, as_of: new Date().toISOString().slice(0, 10), models, papers }) + '\n');
  const count = f => papers.reduce((m, p) => ({ ...m, [f(p)]: (m[f(p)] || 0) + 1 }), {});
  console.log({ papers: papers.length, read_now: todo.length, europepmc_lists: epmc.size, no_pages: missing.length, by_group: count(p => p.group), by_kind: count(p => p.kind),
    international: papers.filter(p => p.countries.length > 1).length, spent_usd: client.spent });
}
