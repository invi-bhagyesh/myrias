// Draft actions: what farms, feed makers, vets or researchers could do next, from the findings.
//   node pipeline/actions.mjs --release public/data/release.json [--min-papers 2] [--species-name "mandarin fish (Siniperca chuatsi)"] [--log FILE]
// Only findings that rest on at least --min-papers papers are used. For each technology class (the same
// categories as the map), the actions model reads those findings and proposes a few actions, each citing
// the findings it rests on and saying what type of action it is, who would do it, what evidence is missing
// and what could go wrong. Ranking is a separate step: pipeline/rank.mjs places every action against the
// written spec in pipeline/priority-spec.md. Run it after this one; until then actions carry no priority.
// Every action is a draft until an expert reviews it, and the site says so on each one.
// Each action keeps its basis, so the site can show how it was put together: why the model combined these
// findings into one action and chose them over the other findings for this technology (basis.reason), what
// each cited finding contributes (basis.findings[].why), and each finding's strength and counts.
// Output: release-actions.json beside the release, listed in action_files.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { createClient } from './llm.mjs';

export const ACTIONS_VERSION = 'actions-0.3';
export const ACTION_TYPES = ['adopt', 'avoid', 'test_on_farms', 'monitor', 'research'];
export const ACTIONS_SYSTEM = `You propose practical next steps for the welfare of one farmed fish species, from a set of research findings about one kind of technology.
Each finding says what several papers found about one practice and one welfare problem, and how strongly they agree.
Propose up to 5 actions. Each must rest on the findings you cite (finding ids), and must not go beyond what they say. Prefer fewer, concrete actions over many vague ones. If the findings disagree or only describe a practice, propose testing or research, not adoption.
For each action give:
- action_en: one plain sentence, starting with a verb, saying who should do what.
- action_zh: the same in Chinese.
- type: adopt (the evidence agrees it helps), avoid (the evidence agrees it harms), test_on_farms (promising but needs trials under farm conditions), monitor (watch a risk or indicator), research (the evidence is too thin or conflicting).
- who: farmers, feed makers, vets, researchers, or policy (one).
- evidence_gap: what is not yet known, in one sentence.
- risks: what could go wrong or what it costs the fish or the farm, in one sentence.
- finding_ids: the findings it rests on.
- reason: two or three plain sentences on how you built this action: why these findings belong together in one action, why you chose them over the other findings listed, and why they lead to this type (what held you back from a stronger one).
- finding_notes: for each cited finding, its id and a few words on what it contributes to the action.
No hype, no recommendations the findings do not support.`;
export const ACTIONS_SCHEMA = { type: 'object', additionalProperties: false, required: ['actions'], properties: { actions: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['action_en', 'action_zh', 'type', 'who', 'evidence_gap', 'risks', 'finding_ids', 'reason', 'finding_notes'],
  properties: { action_en: { type: 'string' }, action_zh: { type: 'string' }, type: { type: 'string', enum: ACTION_TYPES }, who: { type: 'string', enum: ['farmers', 'feed makers', 'vets', 'researchers', 'policy'] },
    evidence_gap: { type: 'string' }, risks: { type: 'string' }, finding_ids: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' },
    finding_notes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'why'], properties: { id: { type: 'string' }, why: { type: 'string' } } } } } } } } };

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const relPath = arg('release'), dir = dirname(relPath), stem = basename(relPath).replace(/\.json$/, '');
  const rel = JSON.parse(readFileSync(relPath, 'utf8'));
  const findings = (rel.finding_files || []).flatMap(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const byId = new Map(findings.map(f => [f.id, f]));
  const minPapers = Number(arg('min-papers', 2));
  const used = findings.filter(f => f.counts.papers >= minPapers && (f.statement_en || f.statement_zh));
  const classLabel = new Map(rel.taxonomy.technology_classes.map(t => [t.id, t.en]));
  const problemLabel = new Map(rel.taxonomy.welfare_problems.map(p => [p.id, p.en]));
  const client = createClient({ logPath: arg('log', join(dir, '..', '..', `actions-${new Date().toISOString().slice(0, 10)}.calls.jsonl`)) });
  const out = [];
  for (const cls of [...new Set(used.map(f => f.technology_class))].sort()) {
    const fs = used.filter(f => f.technology_class === cls);
    const user = `Species: ${arg('species-name') || 'mandarin fish (Siniperca chuatsi)'}\nTechnology: ${classLabel.get(cls)}\nFindings:\n` + fs.map(f =>
      `${f.id} [${f.practice_en}; welfare problem: ${problemLabel.get(f.welfare_problem)}; ${f.counts.papers} papers, ${f.counts.claims} claims, ${f.counts.measured} measured; strength: ${f.strength}]: ${f.statement_en}`).join('\n') + '\nReturn JSON.';
    const r = await client.call('actions', { system: ACTIONS_SYSTEM, user, schema: ACTIONS_SCHEMA });
    if (!r.data) { console.error(`actions: unparsed output for ${cls}`); continue; }
    for (const a of r.data.actions) {
      const cited = a.finding_ids.filter(id => fs.some(f => f.id === id));
      if (!cited.length) continue;
      const fsCited = cited.map(id => byId.get(id));
      const { reason, finding_notes, ...act } = a;
      const why = new Map((finding_notes || []).map(x => [x.id, x.why]));
      out.push({ technology_class: cls, species_id: fsCited[0].species_id, ...act, finding_ids: cited,
        basis: { reason: reason || null, findings: fsCited.map(f => ({ id: f.id, why: why.get(f.id) || null, practice_en: f.practice_en, practice_zh: f.practice_zh, welfare_problem: f.welfare_problem, strength: f.strength, papers: f.counts.papers, claims: f.counts.claims, measured: f.counts.measured })) },
        claim_ids: [...new Set(fsCited.flatMap(f => f.claim_ids))], welfare_problems: [...new Set(fsCited.map(f => f.welfare_problem))],
        status: 'draft', written_by: { model: r.entry.model, version: ACTIONS_VERSION } });
    }
  }
  // Ids by technology class; rank.mjs sets rank and priority.
  out.sort((a, b) => a.technology_class.localeCompare(b.technology_class));
  out.forEach((a, i) => { a.id = 'X' + String(i + 1).padStart(3, '0'); a.rank = null; a.priority = null; });
  writeFileSync(join(dir, `${stem}-actions.json`), JSON.stringify(out) + '\n');
  const shell = JSON.parse(readFileSync(relPath, 'utf8'));
  writeFileSync(relPath, JSON.stringify({ ...shell, action_files: [`${stem}-actions.json`] }, null, 1) + '\n');
  console.log({ findings_used: used.length, classes: new Set(used.map(f => f.technology_class)).size, actions: out.length,
    by_type: out.reduce((m, a) => ({ ...m, [a.type]: (m[a.type] || 0) + 1 }), {}), next: 'node pipeline/rank.mjs --release ' + relPath, spent_usd: client.spent });
}
