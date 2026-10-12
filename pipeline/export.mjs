// Build the public release export from verified claims. Only claims that are welfare-relevant,
// quote-checked and judged supported or partial by the verifier are released. Suggested actions are
// not exported here: they stay drafts until a person has reviewed them.
//   node pipeline/export.mjs --claims claims-final.jsonl --base public/data/release.json --meta pipeline/sources-meta.json --out public/data/release.json
//   node pipeline/export.mjs --store STORE_DIR --base public/data/release.json --out public/data/release.json
// With --store the release is built from the species store (pipeline/merge.mjs): every claim that has
// passed in any run, with public ids that never change, paper details from the intake records, and one
// changelog line per merge.
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { validateExport } from '../public/site-lib.js';
import { readStore } from './merge.mjs';

const TECH = ['monitoring', 'automation', 'stunning_equipment', 'breeding', 'health_products', 'feeds', 'water_systems'];
const RANK = { none: 0, detection_only: 1, proxy_improved: 2, outcome_improved: 3 };
const pad = (n, w) => String(n).padStart(w, '0');
const lang = q => ((q.match(/[一-鿿]/g) || []).length > q.length / 4 ? 'zh' : 'en');

// The record is the statement in the source's language (extract v0.3+). English is the derived
// rendering, kept only when its number check passed. Older claims carry an English statement only.
export function statementFields(c) {
  if (!c.statement) return { text_en: c.statement_en, text_zh: null };
  const recLang = lang(c.statement);
  const rendered = recLang === 'en' ? c.statement : (c.rendering?.check === 'numbers_ok' ? c.statement_en : null);
  return { statement: c.statement, statement_lang: recLang, text_zh: recLang === 'zh' ? c.statement : null, text_en: rendered || null,
    ...(recLang !== 'en' && rendered ? { rendering: { model: c.rendering.model, version: c.rendering.version, check: c.rendering.check } } : {}) };
}

export function buildRelease({ claims, base, meta = {}, speciesId = 'mandarin-fish', models = [], store = null }) {
  if (store) claims = store.claims;
  const keep = claims.filter(c => c.quote_check === 'found' && c.map?.welfare_relevant === true && ['supported', 'partial'].includes(c.verify?.verdict) && c.quote.length <= 600);
  const sourceNames = store ? Object.entries(store.sources).filter(([k]) => keep.some(c => c.source === k)).sort((a, b) => a[1].id.localeCompare(b[1].id)).map(([k]) => k)
    : [...new Set(keep.map(c => c.source))].sort();
  const sources = store ? sourceNames.map(k => { const s = store.sources[k]; return { id: s.id, title: s.title, title_en: null, authors: s.authors || [], year: s.year ?? null, lang: s.lang || 'en', venue: s.venue ?? null, doi: s.doi ?? null, url: s.url ?? null, access: s.access || 'full_text', licence_note: 'Not redistributed. Only short quotations are shown.' }; })
  : sourceNames.map((name, i) => {
    const stem = name.replace(/\.pdf$/i, ''), [title, author] = stem.split(/_(?=[^_]*$)/);
    const m = Object.entries(meta).find(([k]) => !k.startsWith('_') && title.startsWith(k))?.[1] || {};
    return { id: 'S' + pad(i + 1, 2), title: title.trim(), title_en: null, authors: author ? [author.trim()] : [], year: m.year ?? null, lang: 'zh', venue: m.venue ?? null, doi: null, url: null, access: 'full_text', licence_note: 'Licensed journal content; not redistributed. Only short quotations are shown.' };
  });
  const sid = new Map(sourceNames.map((n, i) => [n, sources[i].id]));
  const out = keep.map((c, i) => ({
    id: c.release_id || 'C' + pad(i + 1, 3), source_id: sid.get(c.source), species_id: speciesId, locator: { page: c.page },
    quote: c.quote.trim(), quote_lang: lang(c.quote), ...statementFields(c), kind: c.basis || c.map.kind,
    population: { species: c.species || 'Siniperca chuatsi', life_stage: null, system: c.production_system || null }, intervention: c.intervention_en || c.intervention || null, ...(c.intervention_en && c.intervention && c.intervention_en !== c.intervention ? { intervention_record: c.intervention } : {}),
    comparator: null, outcome: c.welfare_relevance || null, direction: null, magnitude: null,
    ...(c.polarity ? { polarity: c.polarity } : {}), ...(c.limitations ? { limitations: c.limitations } : {}), ...(c.counterevidence ? { counterevidence: c.counterevidence } : {}), welfare_link: c.map.welfare_link,
    verification: c.verify.verdict, audit: 'not_audited', _cell: c.map.technology_class + '|' + c.map.welfare_problem, _ev: c.map.outcome_evidence, _key: c.intervention_key || '', _status: c.candidate_status || ''
  }));
  // Applications: within each technology x problem cell, one per intervention key (WelfareLens-style
  // conservative grouping). Claims marked evidence_only support a cell but do not form an application.
  // Claims from runs without keys fall back to one application per cell.
  const groups = new Map();
  for (const c of out) {
    const [t, p] = c._cell.split('|');
    if (!TECH.includes(t) || p === 'none') continue;
    const key = c._key ? `${c._cell}|${c._key}` : `${c._cell}|`;
    (groups.get(key) || groups.set(key, []).get(key)).push(c);
  }
  const interventions = [], applications = [];
  [...groups.entries()].sort().forEach(([gk, list], i) => {
    const [t, p, key] = gk.split('|');
    const formers = list.filter(c => c._status !== 'evidence_only');
    if (!formers.length) return;
    const counts = {}; for (const c of formers) if (c.intervention) counts[c.intervention.toLowerCase()] = (counts[c.intervention.toLowerCase()] || 0) + 1;
    const name = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || key.replace(/-/g, ' ') || 'unspecified';
    const iid = 'I' + pad(interventions.length + 1, 2);
    const recs = {}; for (const c of formers) if (c.intervention_record) recs[c.intervention_record] = (recs[c.intervention_record] || 0) + 1;
    const nameRecord = Object.entries(recs).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    interventions.push({ id: iid, name_en: name, name_zh: nameRecord, technology_class: t, ...(key ? { key } : {}) });
    const ev = list.reduce((m, c) => (RANK[c._ev] > RANK[m] ? c._ev : m), 'none');
    applications.push({ id: 'A' + pad(applications.length + 1, 2), intervention_id: iid, species_id: speciesId, technology_class: t, welfare_problem: p, maturity: 'research', outcome_evidence: ev, claim_ids: list.map(c => c.id) });
  });
  const have = new Set(applications.map(a => a.technology_class + '|' + a.welfare_problem));
  const cells_status = [];
  for (const t of base.taxonomy.technology_classes) for (const p of base.taxonomy.welfare_problems) if (!have.has(t.id + '|' + p.id)) cells_status.push({ species_id: speciesId, technology_class: t.id, welfare_problem: p.id, status: 'not_collected' });
  for (const c of out) { delete c._cell; delete c._ev; delete c._key; delete c._status; }
  const extracted = store ? store.runs.reduce((n, r) => n + (r.claims_in || 0), 0) : claims.length;
  const run = { ...base.runs[0], status: 'in_progress', focus_en: store ? `Welfare-technology claims from ${sources.length} papers in Chinese and English, added run by run (machine-extracted and machine-verified; no expert audit yet).` : 'All welfare-technology claims in the first 14 Chinese-language papers (machine-extracted and machine-verified; no expert audit yet).', focus_zh: store ? `来自 ${sources.length} 篇中英文论文的福利技术论断，逐次运行累加（由模型提取和核验，尚无专家审核）。` : null,
    counts: store ? { documents_collected: Math.max(base.runs[0].counts.documents_collected, Object.keys(store.sources).length), documents_processed: Object.keys(store.sources).length, sources_released: sources.length, claims_extracted: extracted,
        claims_quote_found: store.runs.reduce((n, r) => n + (r.claims_quote_found ?? 0), 0) || null, claims_relevant: store.runs.reduce((n, r) => n + (r.claims_relevant ?? 0), 0) || null, claims_released: out.length, claims_supported: out.filter(c => c.verification === 'supported').length }
      : { documents_collected: base.runs[0].counts.documents_collected, documents_processed: new Set(claims.map(c => c.source)).size, sources_released: sources.length, claims_extracted: extracted, claims_quote_found: claims.filter(c => c.quote_check === 'found').length, claims_relevant: claims.filter(c => c.quote_check === 'found' && c.map?.welfare_relevant === true).length, claims_released: out.length, claims_supported: out.filter(c => c.verification === 'supported').length }, models, audit: null,
    changelog: store ? store.runs.map(r => ({ date: r.date, text_en: `${r.run} phase ${r.phase}: ${r.claims_added} claims added, ${r.claims_already_present} already present, ${r.sources_added} papers added.`, text_zh: `${r.run} 阶段 ${r.phase}：新增 ${r.claims_added} 条论断，${r.claims_already_present} 条已存在，新增 ${r.sources_added} 篇论文。` }))
      : [{ date: '2026-10', text_en: 'First machine-verified demo release. Quotes are checked against the page text; support is judged by a second model. No expert has audited these claims.', text_zh: null }] };
  // The species summary is hand-kept in the base release; only the run status is set here.
  const species = base.species.map(s => ({ ...s, run_status: 'in_progress' }));
  const lastDate = store && store.runs.length ? store.runs[store.runs.length - 1].date : null;
  return { ...base, release: { ...base.release, version: store ? `0.${1 + store.runs.length}.0` : '0.1.0', as_of: lastDate || '2026-10', status: 'pre-release', sample: false,
      note_en: 'Demo release: claims are extracted and checked by models and have not been audited by an expert. Treat them as leads to check, not findings.', note_zh: null },
    species, sources, claims: out, interventions, applications, cells_status, runs: [run] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = n => { const i = process.argv.indexOf('--' + n); return i < 0 ? null : process.argv[i + 1]; };
  const store = arg('store') ? readStore(arg('store')) : null;
  const claims = store ? store.claims : readFileSync(arg('claims'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const models = [...new Set(claims.flatMap(c => [c.model && `${c.model} (extract)`, c.map?.model && `${c.map.model} (map)`, c.verify?.model && `${c.verify.model} (verify)`, c.rendering?.model && `${c.rendering.model} (render)`]).filter(Boolean))];
  const rel = buildRelease({ claims, store, base: JSON.parse(readFileSync(arg('base'), 'utf8')), meta: arg('meta') ? JSON.parse(readFileSync(arg('meta'), 'utf8')) : {}, models });
  const errors = validateExport(rel);
  if (errors.length) { console.error(errors.slice(0, 20).join('\n')); process.exit(1); }
  // Claims go in numbered files beside the release, each under 350 KB, so no single file is large;
  // release.json lists them in claim_files and the site joins them before it validates.
  const dir = dirname(arg('out')), stem = basename(arg('out')).replace(/\.json$/, '');
  for (const f of readdirSync(dir)) if (new RegExp(`^${stem}-claims-\\d+\\.json$`).test(f)) unlinkSync(join(dir, f));
  const files = [];
  let part = [], size = 0;
  const flush = () => { if (!part.length) return; const f = `${stem}-claims-${files.length}.json`; writeFileSync(join(dir, f), JSON.stringify(part) + '\n'); files.push(f); part = []; size = 0; };
  for (const c of rel.claims) { const n = Buffer.byteLength(JSON.stringify(c)); if (size + n > 350_000) flush(); part.push(c); size += n + 1; }
  flush();
  writeFileSync(arg('out'), JSON.stringify({ ...rel, claims: [], claim_files: files }, null, 1) + '\n');
  console.log({ sources: rel.sources.length, claims: rel.claims.length, applications: rel.applications.length, models });
}
