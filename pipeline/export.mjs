// Build the public release export from verified claims. Only claims that are welfare-relevant,
// quote-checked and judged supported or partial by the verifier are released. Suggested actions are
// not exported here: they stay drafts until a person has reviewed them.
//   node pipeline/export.mjs --claims claims-final.jsonl --base public/data/release.json --meta pipeline/sources-meta.json --out public/data/release.json
import { readFileSync, writeFileSync } from 'node:fs';
import { validateExport } from '../public/site-lib.js';

const TECH = ['monitoring', 'automation', 'stunning_equipment', 'breeding', 'health_products', 'feeds', 'water_systems'];
const RANK = { none: 0, detection_only: 1, proxy_improved: 2, outcome_improved: 3 };
const pad = (n, w) => String(n).padStart(w, '0');
const lang = q => ((q.match(/[一-鿿]/g) || []).length > q.length / 4 ? 'zh' : 'en');

export function buildRelease({ claims, base, meta = {}, speciesId = 'mandarin-fish', models = [] }) {
  const keep = claims.filter(c => c.quote_check === 'found' && c.map?.welfare_relevant === true && ['supported', 'partial'].includes(c.verify?.verdict) && c.quote.length <= 600);
  const sourceNames = [...new Set(keep.map(c => c.source))].sort();
  const sources = sourceNames.map((name, i) => {
    const stem = name.replace(/\.pdf$/i, ''), [title, author] = stem.split(/_(?=[^_]*$)/);
    const m = Object.entries(meta).find(([k]) => !k.startsWith('_') && title.startsWith(k))?.[1] || {};
    return { id: 'S' + pad(i + 1, 2), title: title.trim(), title_en: null, authors: author ? [author.trim()] : [], year: m.year ?? null, lang: 'zh', venue: m.venue ?? null, doi: null, url: null, access: 'full_text', licence_note: 'Licensed journal content; not redistributed. Only short quotations are shown.' };
  });
  const sid = new Map(sourceNames.map((n, i) => [n, sources[i].id]));
  const out = keep.map((c, i) => ({
    id: 'C' + pad(i + 1, 3), source_id: sid.get(c.source), species_id: speciesId, locator: { page: c.page },
    quote: c.quote.trim(), quote_lang: lang(c.quote), text_en: c.statement_en, text_zh: null, kind: c.map.kind,
    population: { species: 'Siniperca chuatsi', life_stage: null, system: null }, intervention: c.intervention || null,
    comparator: null, outcome: null, direction: null, magnitude: null, welfare_link: c.map.welfare_link, welfare_link_note: c.map.reason || null,
    verification: c.verify.verdict, audit: 'not_audited', _cell: c.map.technology_class + '|' + c.map.welfare_problem, _ev: c.map.outcome_evidence
  }));
  // One application per technology x problem cell that has claims; named after its most common intervention.
  const cells = new Map();
  for (const c of out) { const [t, p] = c._cell.split('|'); if (TECH.includes(t) && p !== 'none') (cells.get(c._cell) || cells.set(c._cell, []).get(c._cell)).push(c); }
  const interventions = [], applications = [];
  [...cells.entries()].sort().forEach(([cell, list], i) => {
    const [t, p] = cell.split('|');
    const counts = {}; for (const c of list) if (c.intervention) counts[c.intervention.toLowerCase()] = (counts[c.intervention.toLowerCase()] || 0) + 1;
    const name = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unspecified';
    const iid = 'I' + pad(i + 1, 2);
    interventions.push({ id: iid, name_en: name, name_zh: null, technology_class: t });
    const ev = list.reduce((m, c) => (RANK[c._ev] > RANK[m] ? c._ev : m), 'none');
    applications.push({ id: 'A' + pad(i + 1, 2), intervention_id: iid, species_id: speciesId, technology_class: t, welfare_problem: p, maturity: 'research', outcome_evidence: ev, claim_ids: list.map(c => c.id) });
  });
  const have = new Set(applications.map(a => a.technology_class + '|' + a.welfare_problem));
  const cells_status = [];
  for (const t of base.taxonomy.technology_classes) for (const p of base.taxonomy.welfare_problems) if (!have.has(t.id + '|' + p.id)) cells_status.push({ species_id: speciesId, technology_class: t.id, welfare_problem: p.id, status: 'not_collected' });
  for (const c of out) { delete c._cell; delete c._ev; }
  const extracted = claims.length;
  const run = { ...base.runs[0], status: 'in_progress', focus_en: 'All welfare-technology claims in the first 14 Chinese-language papers (machine-extracted and machine-verified; no expert audit yet).', focus_zh: null,
    counts: { documents_collected: base.runs[0].counts.documents_collected, documents_processed: new Set(claims.map(c => c.source)).size, sources_released: sources.length, claims_extracted: extracted, claims_quote_found: claims.filter(c => c.quote_check === 'found').length, claims_relevant: claims.filter(c => c.quote_check === 'found' && c.map?.welfare_relevant === true).length, claims_released: out.length, claims_supported: out.filter(c => c.verification === 'supported').length }, models, audit: null,
    changelog: [{ date: '2026-10', text_en: 'First machine-verified demo release. Quotes are checked against the page text; support is judged by a second model. No expert has audited these claims.', text_zh: null }] };
  const species = base.species.map(s => ({ ...s, run_status: 'in_progress', summary_en: 'First species run: Chinese-language papers only. Machine-verified, not yet audited by an expert.', summary_zh: null }));
  return { ...base, release: { ...base.release, version: '0.1.0', as_of: '2026-10', status: 'pre-release', sample: false,
      note_en: 'Demo release: claims are extracted and checked by models and have not been audited by an expert. Treat them as leads to check, not findings.', note_zh: null },
    species, sources, claims: out, interventions, applications, cells_status, runs: [run] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = n => { const i = process.argv.indexOf('--' + n); return i < 0 ? null : process.argv[i + 1]; };
  const claims = readFileSync(arg('claims'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const models = [...new Set(claims.flatMap(c => [c.model && `${c.model} (extract)`, c.map?.model && `${c.map.model} (map)`, c.verify?.model && `${c.verify.model} (verify)`]).filter(Boolean))];
  const rel = buildRelease({ claims, base: JSON.parse(readFileSync(arg('base'), 'utf8')), meta: JSON.parse(readFileSync(arg('meta'), 'utf8')), models });
  const errors = validateExport(rel);
  if (errors.length) { console.error(errors.slice(0, 20).join('\n')); process.exit(1); }
  writeFileSync(arg('out'), JSON.stringify(rel, null, 1) + '\n');
  console.log({ sources: rel.sources.length, claims: rel.claims.length, applications: rel.applications.length, models });
}
