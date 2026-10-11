// Cross-language gap: for each welfare intervention found in the Chinese corpus of one species,
// is there English-language evidence for the same intervention in the same species?
//   node pipeline/gap.mjs --map pipeline/gap/mandarin-fish.json --claims claims.jsonl --out DIR --cap 0.20
// Chinese side: released-equivalent claims (quote found, welfare-relevant, supported or partial),
// mapped to the canonical interventions. English side: Crossref and Europe PMC (OpenAlex when its
// anonymous search is available), filtered to records naming the species, then judged one by one
// by a model: same intervention in this species, and is an outcome measured?
// Automated throughout: no expert has checked these judgments. Every raw record and verdict is kept.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createClient, SpendCapError } from './llm.mjs';

const minYear = ys => { const v = ys.filter(Boolean); return v.length ? Math.min(...v) : null; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stripTags = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function mapClaim(claim, interventions) {
  const text = `${claim.intervention || ''} ${claim.statement_en || ''}`.toLowerCase();
  return interventions.filter(iv => iv.claim_patterns.some(p => text.includes(p.toLowerCase()))).map(iv => iv.id);
}

// Names the species, and is not a look-alike name (e.g. the aquarium "green mandarin fish", Synchiropus).
export const namesSpecies = (rec, terms, exclude = []) => {
  const t = `${rec.title} ${rec.abstract}`.toLowerCase();
  return terms.some(x => t.includes(x.toLowerCase())) && !exclude.some(x => t.includes(x.toLowerCase()));
};
const isEnglish = s => { const t = String(s || ''); return t.length > 0 && (t.match(/[A-Za-z]/g) || []).length / t.length > 0.5; };

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'myrias-gap/0.1 (research; https://github.com/invi-bhagyesh/myrias)' } });
    if (res.ok) return res.json();
    if (![429, 500, 502, 503].includes(res.status)) throw new Error(`${url} -> ${res.status}`);
    await sleep(3000 * 2 ** i);
  }
  return null;
}

async function searchCrossref(speciesTerms, ivTerms, rows = 40) {
  const q = encodeURIComponent(`${speciesTerms.slice(0, 3).join(' ')} ${ivTerms.join(' ')}`);
  const j = await getJson(`https://api.crossref.org/works?query.bibliographic=${q}&rows=${rows}&select=DOI,title,abstract,issued,type`);
  return (j?.message?.items || []).map(it => ({ source: 'crossref', id: it.DOI ? 'doi:' + it.DOI.toLowerCase() : null, doi: it.DOI || null,
    title: stripTags((it.title || [])[0]), abstract: stripTags(it.abstract), year: it.issued?.['date-parts']?.[0]?.[0] ?? null }));
}

async function searchEuropePmc(speciesTerms, ivTerms, rows = 50) {
  const sp = speciesTerms.map(t => `"${t}"`).join(' OR ');
  const iv = ivTerms.map(t => `"${t}"`).join(' OR ');
  const q = encodeURIComponent(`(TITLE_ABS:(${sp})) AND (TITLE_ABS:(${iv}))`);
  const j = await getJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${q}&format=json&resultType=core&pageSize=${rows}`);
  return (j?.resultList?.result || []).map(it => ({ source: 'europepmc', id: it.doi ? 'doi:' + it.doi.toLowerCase() : 'epmc:' + it.id, doi: it.doi || null,
    title: stripTags(it.title), abstract: stripTags(it.abstractText), year: it.pubYear ? Number(it.pubYear) : null }));
}

async function searchOpenAlex(speciesTerms, ivTerms, rows = 50) {
  const sp = speciesTerms.map(t => `"${t}"`).join(' OR ');
  const iv = ivTerms.map(t => `"${t}"`).join(' OR ');
  const j = await getJson(`https://api.openalex.org/works?filter=title_and_abstract.search:${encodeURIComponent(`(${sp}) AND (${iv})`)}&per-page=${rows}`, 2).catch(() => null);
  if (!j) return null; // unavailable (anonymous search paused); recorded as such
  const abs = inv => { if (!inv) return ''; const w = []; for (const [k, pos] of Object.entries(inv)) for (const p of pos) w[p] = k; return w.join(' '); };
  return (j.results || []).map(it => ({ source: 'openalex', id: it.doi ? 'doi:' + it.doi.replace('https://doi.org/', '').toLowerCase() : it.id, doi: it.doi || null,
    title: stripTags(it.title), abstract: abs(it.abstract_inverted_index), year: it.publication_year ?? null }));
}

export const JUDGE_SYSTEM = `You judge whether one English-language publication reports evidence about a specific aquaculture intervention in a specific species.
match: yes (the publication studies or reports this intervention applied to this species), partial (closely related intervention in this species, or this intervention mentioned only in passing), no (different intervention, or a different species).
measured: true only if the publication reports an outcome it measured for this intervention in this species.
Judge only from the title and abstract given. If the abstract is missing, judge from the title and say so.`;
export const JUDGE_SCHEMA = { type: 'object', additionalProperties: false, required: ['match', 'measured', 'reason'],
  properties: { match: { type: 'string', enum: ['yes', 'partial', 'no'] }, measured: { type: 'boolean' }, reason: { type: 'string' } } };
const judgeUser = (iv, species, rec) => `Intervention: ${iv.en}\nSpecies: ${species.scientific} (mandarin fish)\nTitle: ${rec.title}\nAbstract: ${rec.abstract || '(none available)'}\nReturn JSON.`;

// Per intervention: what the Chinese corpus has, what English literature has, and the gap category.
// The match used for the result: a recorded review override when there is one, else the model's verdict.
export const effectiveMatch = r => r.review?.match ?? r.verdict?.match;
export function applyReview(cache, review) {
  for (const o of review?.overrides || []) for (const r of cache[o.intervention] || []) if (r.title.includes(o.title_contains)) r.review = { match: o.match, note: o.note };
  return cache;
}

export function classify(zh, en, useReview = true) {
  const m = r => (useReview ? effectiveMatch(r) : r.verdict?.match);
  const enYes = en.filter(r => m(r) === 'yes');
  const enMeasured = enYes.filter(r => r.verdict.measured);
  const status = !enYes.length ? (en.some(r => m(r) === 'partial') ? 'english_partial_only' : 'chinese_only')
    : (zh.measured > 0 && !enMeasured.length ? 'english_unmeasured' : 'both');
  return { english_matches: enYes.length, english_measured: enMeasured.length, english_partial: en.filter(r => m(r) === 'partial').length, status,
    first_english_year: minYear(enYes.map(r => r.year)) };
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const map = JSON.parse(readFileSync(arg('map'), 'utf8'));
  const out = arg('out'); mkdirSync(out, { recursive: true });
  const claims = readFileSync(arg('claims'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(c => c.quote_check === 'found' && c.map?.welfare_relevant === true && ['supported', 'partial'].includes(c.verify?.verdict));

  // Chinese side
  const zh = {};
  for (const iv of map.interventions) zh[iv.id] = { claims: 0, papers: new Set(), measured: 0, examples: [] };
  for (const c of claims) for (const id of mapClaim(c, map.interventions)) {
    const z = zh[id]; z.claims++; z.papers.add(c.source); if ((c.basis || c.map?.kind) === 'measured') z.measured++;
    if (z.examples.length < 2) z.examples.push({ quote: c.quote, statement_en: c.statement_en, source: c.source, page: c.page });
  }

  // English side: search, dedup, keep records that name the species, judge each once
  const cachePath = `${out}/english-records.json`;
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const sourcesStatus = {};
  for (const iv of map.interventions) {
    if (cache[iv.id]) continue;
    const got = [];
    for (const [name, fn] of [['openalex', searchOpenAlex], ['crossref', searchCrossref], ['europepmc', searchEuropePmc]]) {
      const r = await fn(map.species.english_terms, iv.english_terms).catch(e => { sourcesStatus[name] = 'error: ' + e.message.slice(0, 80); return null; });
      if (r === null) { sourcesStatus[name] = sourcesStatus[name] || 'unavailable'; continue; }
      sourcesStatus[name] = 'ok'; got.push(...r); await sleep(1200);
    }
    const seen = new Map();
    for (const rec of got) { const key = rec.id || rec.title.toLowerCase(); if (!seen.has(key) || (!seen.get(key).abstract && rec.abstract)) seen.set(key, rec); }
    cache[iv.id] = [...seen.values()].filter(r => isEnglish(r.title) && namesSpecies(r, map.species.english_terms, map.species.exclude_terms || []));
    writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  }

  const client = createClient({ capUsd: Number(arg('cap', 0)), logPath: `${out}/judge-calls.jsonl`, profile: arg('profile', 'demo') });
  let stopped = null, judged = 0;
  for (const iv of map.interventions) for (const rec of cache[iv.id]) {
    if (rec.verdict || stopped) continue;
    try {
      const r = await client.call('screen', { system: JUDGE_SYSTEM, user: judgeUser(iv, map.species, rec), schema: JUDGE_SCHEMA, maxTokens: 400 });
      rec.verdict = r.data ? { ...r.data, model: r.entry.model } : { match: 'no', measured: false, reason: 'unparsed', model: r.entry.model };
      if (++judged % 20 === 0) writeFileSync(cachePath, JSON.stringify(cache, null, 1)); // checkpoint
    } catch (e) { stopped = e instanceof SpendCapError ? 'spend cap' : e.message; }
  }
  writeFileSync(cachePath, JSON.stringify(cache, null, 1));

  // Re-apply the species filter at summary time, so a changed exclusion list applies to cached records too.
  for (const iv of map.interventions) cache[iv.id] = cache[iv.id].filter(r => namesSpecies(r, map.species.english_terms, map.species.exclude_terms || []));
  const reviewPath = arg('review') || arg('map').replace(/\.json$/, '.review.json');
  const review = existsSync(reviewPath) ? JSON.parse(readFileSync(reviewPath, 'utf8')) : null;
  applyReview(cache, review);
  const meta = existsSync(arg('meta') || 'pipeline/sources-meta.json') ? JSON.parse(readFileSync(arg('meta') || 'pipeline/sources-meta.json', 'utf8')) : {};
  const yearOf = src => Object.entries(meta).find(([k]) => !k.startsWith('_') && String(src).startsWith(k))?.[1]?.year ?? null;
  const rows = map.interventions.map(iv => ({ id: iv.id, en: iv.en, zh: iv.zh, chinese_claims: zh[iv.id].claims, chinese_papers: zh[iv.id].papers.size,
    chinese_measured: zh[iv.id].measured, first_chinese_year: minYear([...zh[iv.id].papers].map(yearOf)),
    english_candidates: cache[iv.id].length, automated_status: classify({ measured: zh[iv.id].measured }, cache[iv.id], false).status,
    ...classify({ measured: zh[iv.id].measured }, cache[iv.id]),
    english_titles: cache[iv.id].filter(r => effectiveMatch(r) === 'yes').map(r => `${r.title} (${r.year ?? 'n.d.'}${r.doi ? ', ' + r.doi : ''})`).slice(0, 5),
    chinese_examples: zh[iv.id].examples }));
  const withZh = rows.filter(r => r.chinese_claims > 0);
  const summary = { species: map.species.scientific, interventions_in_chinese_corpus: withZh.length,
    chinese_only: withZh.filter(r => r.status === 'chinese_only').length, english_partial_only: withZh.filter(r => r.status === 'english_partial_only').length,
    english_unmeasured: withZh.filter(r => r.status === 'english_unmeasured').length, both: withZh.filter(r => r.status === 'both').length,
    automated_chinese_only: withZh.filter(r => r.automated_status === 'chinese_only').length, automated_english_partial_only: withZh.filter(r => r.automated_status === 'english_partial_only').length,
    reviewed_by: review?.reviewer || null, review_overrides: review?.overrides?.length || 0,
    english_sources: sourcesStatus, judge_spent_usd: client.spent, stopped, automated: true };
  writeFileSync(`${out}/gap.json`, JSON.stringify({ summary, rows }, null, 1));
  console.log(summary);
  console.table(withZh.map(r => ({ intervention: r.id, zh_claims: r.chinese_claims, zh_papers: r.chinese_papers, zh_first: r.first_chinese_year, en_cand: r.english_candidates, en_match: r.english_matches, en_first: r.first_english_year, en_partial: r.english_partial, automated: r.automated_status, reviewed: r.status })));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
