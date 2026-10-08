// Suggested actions from verified claims. Reads claims.jsonl (only quote-checked claims count),
// groups by intervention, asks the suggest stage for proposals, and writes DRAFT suggestions.
//   node pipeline/suggest.mjs --claims DIR/claims.jsonl --out DIR --cap 0.20
// A draft needs expert review before it can enter a real release (the site validator enforces this).
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from './llm.mjs';
import { SUGGEST_SYSTEM, SUGGEST_SCHEMA, suggestUser } from './prompts.mjs';

export function groupClaims(claims) {
  const groups = new Map();
  claims.filter(c => c.quote_check === 'found' && c.intervention).forEach((c, i) => {
    const key = c.intervention.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: `c${i}`, statement_en: c.statement_en, source: c.source, page: c.page });
  });
  return groups;
}

// Keep only suggestions whose cited claim ids exist in the group, and never carry a rank.
export function cleanSuggestions(list, claims) {
  const ids = new Set(claims.map(c => c.id));
  return list.filter(x => x.claim_ids?.length && x.claim_ids.every(id => ids.has(id)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const claims = readFileSync(arg('claims'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const client = createClient({ capUsd: Number(arg('cap', 0)), logPath: `${arg('out')}/suggest-calls.jsonl` });
  const out = [];
  for (const [intervention, group] of groupClaims(claims)) {
    const r = await client.call('suggest', { system: SUGGEST_SYSTEM, user: suggestUser(group), schema: SUGGEST_SCHEMA, maxTokens: 3000 });
    for (const x of cleanSuggestions(r.data?.suggestions || [], group)) out.push({ ...x, intervention, status: 'draft', model: r.entry.model, claims: group.filter(c => x.claim_ids.includes(c.id)) });
  }
  writeFileSync(`${arg('out')}/suggestions.json`, JSON.stringify(out, null, 1));
  console.log(`${out.length} draft suggestions, spent $${client.spent.toFixed(4)}`);
}
