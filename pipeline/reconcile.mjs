// Reconcile (L7, first part): give one name to each intervention the claims describe in different words.
//   node pipeline/reconcile.mjs --in final.jsonl --out reconciled.jsonl [--cap USD]
// Extraction names an intervention per text window, so the same practice arrives as several names
// (条件反射驯化, 驯食方式, 鳜驯食方法 …). One model call sees the distinct names of the claims that
// passed (quote found, welfare-relevant) and groups only names for the same practice. Each claim keeps
// its original wording in intervention_original; the group's key and names replace the working ones.
// Code checks that every name lands in exactly one group; anything the model leaves out stays as it was.
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from './llm.mjs';

export const RECONCILE_VERSION = 'reconcile-0.1';
export const RECONCILE_SYSTEM = `You group names of aquaculture practices that refer to the same practice, for one species.
You get a numbered list of intervention names (Chinese, with an English rendering). Put every number in exactly one group.
Merge only names for the same practice done the same way. Keep distinct practices apart even when related: starving fish before feed training is not the same as conditioned-reflex training; a live-prey diet is not a formulated feed; a disease is not a treatment.
For each group give: key (short lowercase English, words joined by hyphens), name_zh (a short Chinese name a fish farmer would use), name_en (a short plain English name).`;
export const RECONCILE_SCHEMA = { type: 'object', additionalProperties: false, required: ['groups'], properties: { groups: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['key', 'name_zh', 'name_en', 'members'],
  properties: { key: { type: 'string' }, name_zh: { type: 'string' }, name_en: { type: 'string' }, members: { type: 'array', items: { type: 'integer' } } } } } } };

const eligible = c => c.quote_check === 'found' && c.map?.welfare_relevant === true && c.intervention;
export function distinctNames(claims) {
  const seen = new Map();
  for (const c of claims.filter(eligible)) if (!seen.has(c.intervention)) seen.set(c.intervention, c.intervention_en || '');
  return [...seen.entries()].map(([zh, en]) => ({ zh, en }));
}

// Pure: apply groups to claims. Each name goes to the first group that lists it; unlisted names keep their own.
export function applyGroups(claims, names, groups) {
  const byName = new Map();
  for (const g of groups) for (const m of g.members) {
    const n = names[m];
    if (n && !byName.has(n.zh)) byName.set(n.zh, g);
  }
  return claims.map(c => {
    if (!eligible(c)) return c;
    const g = byName.get(c.intervention);
    if (!g) return c;
    return { ...c, intervention_original: c.intervention, intervention_en_original: c.intervention_en, intervention_key_original: c.intervention_key,
      intervention: g.name_zh, intervention_en: g.name_en, intervention_key: g.key.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''), reconcile: RECONCILE_VERSION };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const claims = readFileSync(arg('in'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const names = distinctNames(claims);
  const client = createClient({ capUsd: Number(arg('cap', 0)), logPath: `${arg('out')}.calls.jsonl` });
  const user = names.map((n, i) => `${i}. ${n.zh}${n.en ? ` (${n.en})` : ''}`).join('\n') + '\nReturn JSON.';
  const r = await client.call('reconcile', { system: RECONCILE_SYSTEM, user, schema: RECONCILE_SCHEMA, maxTokens: 20000 });
  if (!r.data) { console.error('reconcile: unparsed output'); process.exit(1); }
  const out = applyGroups(claims, names, r.data.groups);
  writeFileSync(arg('out'), out.map(c => JSON.stringify(c)).join('\n') + '\n');
  const assigned = new Set(r.data.groups.flatMap(g => g.members));
  console.log({ names: names.length, groups: r.data.groups.length, unassigned: names.filter((_, i) => !assigned.has(i)).length, spent_usd: client.spent });
}
