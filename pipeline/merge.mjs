// Merge a run's claims into the species store, so each run adds to what exists instead of starting over.
//   node pipeline/merge.mjs --store DIR --claims final.jsonl --run run-2 --phase B [--records records.jsonl] [--meta sources-meta.json] [--date 2026-10-11]
//   node pipeline/merge.mjs --store DIR --refresh-english rendered.jsonl   (copy English onto claims already merged)
// The store holds every claim that has passed (quote on the page, about welfare, supported or partly
// supported), in the order it was added:
//   DIR/claims.jsonl  one claim per line; uid (source + page + quote), release_id (C0001…, never reused),
//                     added_in {run, phase, date}, seen_in (every run that found it again)
//   DIR/sources.json  one entry per paper; id (S001…, never reused), title, year, language, venue, DOI
//   DIR/runs.json     one entry per merge: date, claims in, added, already present, papers added
// A claim already in the store is not added twice; its seen_in grows. Public ids never change, so links
// to a claim stay valid across releases.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalise } from './quote.mjs';

export const passes = c => c.quote_check === 'found' && c.map?.welfare_relevant === true && ['supported', 'partial'].includes(c.verify?.verdict);
export const claimUid = c => 'q' + createHash('sha1').update(`${c.source}|${c.page}|${normalise(c.quote)}`).digest('hex').slice(0, 12);
const pad = (n, w) => String(n).padStart(w, '0');
const langOf = s => ((String(s).match(/[一-鿿]/g) || []).length > String(s).length / 4 ? 'zh' : 'en');

// Paper details: from the intake record when the source is a record id, else from the file name and
// the hand-kept first-run metadata (title prefix → year, venue).
export function sourceInfo(source, records, meta, sampleQuote = '') {
  const r = records.get(source);
  if (r) return { title: r.title, ...(r.title_en ? { title_en: r.title_en } : {}), authors: r.authors || [], year: r.year ?? null, lang: r.lang || langOf(r.title), venue: r.venue ?? null,
    doi: r.doi ?? null, url: r.doi ? `https://doi.org/${r.doi}` : (r.oa?.landing || null), access: 'full_text', record_id: source };
  const stem = String(source).replace(/\.pdf$/i, ''), [title, author] = stem.split(/_(?=[^_]*$)/);
  const m = Object.entries(meta).find(([k]) => !k.startsWith('_') && title.startsWith(k))?.[1] || {};
  return { title: title.trim(), authors: author ? [author.trim()] : [], year: m.year ?? null, lang: langOf(title + sampleQuote), venue: m.venue ?? null, doi: null, url: null, access: 'full_text' };
}

// Pure: the merged store and what changed.
export function mergeIntoStore(store, incoming, { run, phase, date, records = new Map(), meta = {} }) {
  const claims = store.claims.map(c => ({ ...c })), sources = { ...store.sources };
  const byUid = new Map(claims.map((c, i) => [c.uid, i]));
  let nextC = claims.reduce((m, c) => Math.max(m, Number(String(c.release_id).slice(1)) || 0), 0);
  let nextS = Object.values(sources).reduce((m, s) => Math.max(m, Number(String(s.id).slice(1)) || 0), 0);
  const tag = { run, phase, date };
  let added = 0, again = 0, sourcesAdded = 0;
  for (const c of incoming.filter(passes)) {
    const uid = claimUid(c);
    if (byUid.has(uid)) {
      const old = claims[byUid.get(uid)];
      if (!(old.seen_in || []).some(t => t.run === run && t.phase === phase)) old.seen_in = [...(old.seen_in || []), tag];
      again++; continue;
    }
    if (!sources[c.source]) { sources[c.source] = { id: 'S' + pad(++nextS, 3), ...sourceInfo(c.source, records, meta, c.quote), added_in: tag }; sourcesAdded++; }
    claims.push({ ...c, uid, release_id: 'C' + pad(++nextC, 4), added_in: tag, seen_in: [] });
    byUid.set(uid, claims.length - 1); added++;
  }
  const entry = { run, phase, date, claims_in: incoming.length, claims_quote_found: incoming.filter(c => c.quote_check === 'found').length,
    claims_relevant: incoming.filter(c => c.quote_check === 'found' && c.map?.welfare_relevant === true).length, claims_passing: incoming.filter(passes).length, claims_added: added, claims_already_present: again, sources_added: sourcesAdded };
  return { claims, sources, runs: [...store.runs, entry], entry };
}

// Pure: copy English renderings onto claims already in the store, matched by uid. Only the rendering and the
// English statement change; the record, ids and the reconciled practice names stay as they are. Used when the
// English step finishes after its claims were merged.
export function refreshEnglish(store, rendered) {
  const byUid = new Map(rendered.filter(c => c.rendering && c.statement_en).map(c => [claimUid(c), c]));
  let updated = 0;
  const claims = store.claims.map(c => {
    const r = byUid.get(c.uid);
    if (!r || (c.rendering && c.statement_en === r.statement_en)) return c;
    updated++;
    return { ...c, statement_en: r.statement_en, rendering: r.rendering };
  });
  return { claims, updated };
}

export function readStore(dir) {
  const read = (f, d) => (existsSync(`${dir}/${f}`) ? JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) : d);
  const claims = existsSync(`${dir}/claims.jsonl`) ? readFileSync(`${dir}/claims.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  return { claims, sources: read('sources.json', {}), runs: read('runs.json', []) };
}
export function writeStore(dir, s) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/claims.jsonl`, s.claims.map(c => JSON.stringify(c)).join('\n') + (s.claims.length ? '\n' : ''));
  writeFileSync(`${dir}/sources.json`, JSON.stringify(s.sources, null, 1));
  writeFileSync(`${dir}/runs.json`, JSON.stringify(s.runs, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const jl = p => readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const dir = arg('store');
  const records = arg('records') ? new Map(jl(arg('records')).map(r => [r.id, r])) : new Map();
  const meta = arg('meta') ? JSON.parse(readFileSync(arg('meta'), 'utf8')) : {};
  if (arg('refresh-english')) {
    // node pipeline/merge.mjs --store DIR --refresh-english rendered.jsonl
    const store = readStore(dir), r = refreshEnglish(store, jl(arg('refresh-english')));
    writeStore(dir, { ...store, claims: r.claims });
    console.log(JSON.stringify({ english_updated: r.updated, store_claims: r.claims.length, with_english: r.claims.filter(c => c.statement_en).length }));
    process.exit(0);
  }
  const merged = mergeIntoStore(readStore(dir), jl(arg('claims')), { run: arg('run'), phase: arg('phase'), date: arg('date', new Date().toISOString().slice(0, 10)), records, meta });
  writeStore(dir, merged);
  console.log(JSON.stringify({ ...merged.entry, store_claims: merged.claims.length, store_sources: Object.keys(merged.sources).length }));
}
