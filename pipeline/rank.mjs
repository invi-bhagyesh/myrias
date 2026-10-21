// Rank the draft actions: a model places every action against a written spec (pipeline/priority-spec.md
// by default), with a score and a reason for each place.
//   node pipeline/rank.mjs --release public/data/release.json [--spec pipeline/priority-spec.md] [--log FILE]
// The spec is plain text, so what "priority" means can be changed without touching code. The model sees all
// actions at once, so it compares them with each other, and for each one sees its type, who it is for, the
// evidence gap, the risks and every finding it cites (practice, welfare problem, strength, papers, claims,
// measured claims, the finding's sentence). Code then checks that every action is ranked exactly once, orders
// them by the model's score (its own order breaks ties), and records the model, the spec file and the
// spec's checksum on each action, so a ranking can always be traced to the spec that produced it.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from './llm.mjs';

export const RANK_VERSION = 'rank-0.1';
export const RANK_SYSTEM = `You rank draft actions for the welfare of one farmed fish species, following the spec you are given exactly.
You get the spec, then every action with the findings it rests on. Rank all of them against each other.
For each action give: id; score, an integer from 0 to 100 for its priority under the spec (higher is more urgent; scores must agree with your order); reason, one or two plain sentences on why it sits where it does, naming what in the spec and the evidence decided it; and criteria, one short assessment per criterion the spec names (criterion: the criterion's name as the spec writes it; level: high, medium or low; note: a few words).
List actions from highest to lowest priority. Include every action exactly once.`;
export const RANK_SCHEMA = { type: 'object', additionalProperties: false, required: ['ranking'], properties: { ranking: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['id', 'score', 'reason', 'criteria'], properties: {
    id: { type: 'string' }, score: { type: 'integer' }, reason: { type: 'string' },
    criteria: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['criterion', 'level', 'note'],
      properties: { criterion: { type: 'string' }, level: { type: 'string', enum: ['high', 'medium', 'low'] }, note: { type: 'string' } } } } } } } } };

// Pure: what the model reads about each action.
export function rankUser(spec, actions, fById, label = x => x) {
  return `SPEC\n${spec.trim()}\n\nACTIONS (${actions.length})\n` + actions.map(a => [
    `${a.id} [${a.type}; for ${a.who}; technology: ${label('technology_classes', a.technology_class)}]: ${a.action_en}`,
    `  Not yet known: ${a.evidence_gap}`, `  Risks: ${a.risks}`,
    ...a.finding_ids.map(id => fById.get(id)).filter(Boolean).map(f => `  Finding ${f.id} (${f.practice_en}; welfare problem: ${label('welfare_problems', f.welfare_problem)}; strength: ${f.strength}; ${f.counts.papers} papers, ${f.counts.claims} claims, ${f.counts.measured} measured, ${f.counts.supportive} in favour, ${f.counts.opposing} against or no effect): ${f.statement_en}`)
  ].join('\n')).join('\n\n') + '\n\nReturn JSON.';
}

// Pure: apply the model's ranking. Every action appears once; unknown ids are ignored; an action the model
// left out goes last with no score. Order: score, then the model's own order.
export function applyRanking(actions, ranking) {
  const seen = new Map();
  ranking.forEach((r, k) => { if (!seen.has(r.id) && actions.some(a => a.id === r.id)) seen.set(r.id, { ...r, k }); });
  const ranked = actions.map(a => ({ a, r: seen.get(a.id) })).sort((x, y) =>
    (x.r ? 0 : 1) - (y.r ? 0 : 1) || (y.r?.score ?? 0) - (x.r?.score ?? 0) || (x.r?.k ?? 0) - (y.r?.k ?? 0) || x.a.id.localeCompare(y.a.id));
  return { actions: ranked.map(({ a, r }, i) => ({ ...a, rank: i + 1, priority: r
    ? { score: Math.max(0, Math.min(100, r.score)) / 100, reason: r.reason, criteria: r.criteria, method: 'model' }
    : { score: null, reason: null, criteria: [], method: 'not_ranked' } })), missing: actions.filter(a => !seen.has(a.id)).map(a => a.id) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const relPath = arg('release'), dir = dirname(relPath), specPath = arg('spec', 'pipeline/priority-spec.md');
  const rel = JSON.parse(readFileSync(relPath, 'utf8'));
  const spec = readFileSync(specPath, 'utf8'), specSha = createHash('sha1').update(spec).digest('hex').slice(0, 12);
  const findings = (rel.finding_files || []).flatMap(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const fById = new Map(findings.map(f => [f.id, f]));
  const actionsFile = join(dir, rel.action_files[0]);
  const actions = JSON.parse(readFileSync(actionsFile, 'utf8'));
  const label = (kind, id) => (rel.taxonomy[kind].find(x => x.id === id) || {}).en || id;
  const client = createClient({ logPath: arg('log', join(dir, '..', '..', `rank-${new Date().toISOString().slice(0, 10)}.calls.jsonl`)) });
  const r = await client.call('rank', { system: RANK_SYSTEM, user: rankUser(spec, actions, fById, label), schema: RANK_SCHEMA });
  if (!r.data) { console.error('rank: unparsed output; nothing changed'); process.exit(1); }
  const by = { model: r.entry.model, version: RANK_VERSION, spec: specPath.replace(/^.*pipeline\//, 'pipeline/'), spec_sha: specSha, as_of: new Date().toISOString().slice(0, 10) };
  const out = applyRanking(actions, r.data.ranking);
  writeFileSync(actionsFile, JSON.stringify(out.actions.map(a => ({ ...a, priority: { ...a.priority, by } }))) + '\n');
  const shell = JSON.parse(readFileSync(relPath, 'utf8'));
  writeFileSync(relPath, JSON.stringify({ ...shell, action_ranking: by }, null, 1) + '\n');
  console.log({ actions: actions.length, ranked: actions.length - out.missing.length, missing: out.missing, spec: by.spec, spec_sha: specSha,
    top: out.actions.slice(0, 5).map(a => [a.rank, a.priority.score, a.type, a.action_en]), spent_usd: client.spent });
}
