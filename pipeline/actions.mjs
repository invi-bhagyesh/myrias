// Draft actions: what farms, feed makers, vets or researchers could do next, from the findings.
//   node pipeline/actions.mjs --release public/data/release.json [--min-papers 2] [--species-name "mandarin fish (Siniperca chuatsi)"] [--log FILE]
// Only findings that rest on at least --min-papers papers are used. For each technology class (the same
// categories as the map), the actions model reads those findings and proposes a few actions, each citing
// the findings it rests on and saying what type of action it is, who would do it, what evidence is missing
// and what could go wrong. The model never ranks. Code then scores each action, from the findings it cites
// and its type, with a fixed and published formula:
//   evidence      = average over cited findings of 0.4 x papers (capped at 5, scaled 0-1)
//                   + 0.3 x agreement (agree or mostly against 1.0, mixed 0.4, described 0.2)
//                   + 0.3 x share of claims that were measured
//   actionability = by type: adopt 1.0, avoid 1.0, test on farms 0.8, monitor 0.6, research 0.4
//   priority      = 0.6 x evidence + 0.4 x actionability
// Every action is a draft until an expert reviews it, and the site says so on each one.
// Output: release-actions.json beside the release, listed in action_files.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { createClient } from './llm.mjs';

export const ACTIONS_VERSION = 'actions-0.1';
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
No hype, no recommendations the findings do not support.`;
export const ACTIONS_SCHEMA = { type: 'object', additionalProperties: false, required: ['actions'], properties: { actions: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['action_en', 'action_zh', 'type', 'who', 'evidence_gap', 'risks', 'finding_ids'],
  properties: { action_en: { type: 'string' }, action_zh: { type: 'string' }, type: { type: 'string', enum: ACTION_TYPES }, who: { type: 'string', enum: ['farmers', 'feed makers', 'vets', 'researchers', 'policy'] },
    evidence_gap: { type: 'string' }, risks: { type: 'string' }, finding_ids: { type: 'array', items: { type: 'string' } } } } } } };

const AGREE = { agree: 1, against: 1, mixed: 0.4, described: 0.2, one_paper: 0.1 };
const DOABLE = { adopt: 1, avoid: 1, test_on_farms: 0.8, monitor: 0.6, research: 0.4 };
const r2 = x => Math.round(x * 100) / 100;

// Pure: the priority of one action from the findings it cites and its type. Returns the parts too.
export function priority(type, findings) {
  const ev = findings.length ? findings.reduce((s, f) => s + 0.4 * Math.min(f.counts.papers, 5) / 5 + 0.3 * (AGREE[f.strength] ?? 0) + 0.3 * (f.counts.claims ? f.counts.measured / f.counts.claims : 0), 0) / findings.length : 0;
  const doable = DOABLE[type] ?? 0;
  return { score: r2(0.6 * ev + 0.4 * doable), evidence: r2(ev), actionability: doable, basis: 'priority = 0.6 x evidence + 0.4 x actionability (see pipeline/actions.mjs)' };
}

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
      out.push({ technology_class: cls, species_id: fsCited[0].species_id, ...a, finding_ids: cited,
        claim_ids: [...new Set(fsCited.flatMap(f => f.claim_ids))], welfare_problems: [...new Set(fsCited.map(f => f.welfare_problem))],
        priority: priority(a.type, fsCited), status: 'draft', written_by: { model: r.entry.model, version: ACTIONS_VERSION } });
    }
  }
  out.sort((a, b) => b.priority.score - a.priority.score || a.technology_class.localeCompare(b.technology_class));
  out.forEach((a, i) => { a.id = 'X' + String(i + 1).padStart(3, '0'); a.rank = i + 1; });
  writeFileSync(join(dir, `${stem}-actions.json`), JSON.stringify(out) + '\n');
  const shell = JSON.parse(readFileSync(relPath, 'utf8'));
  writeFileSync(relPath, JSON.stringify({ ...shell, action_files: [`${stem}-actions.json`] }, null, 1) + '\n');
  console.log({ findings_used: used.length, classes: new Set(used.map(f => f.technology_class)).size, actions: out.length,
    by_type: out.reduce((m, a) => ({ ...m, [a.type]: (m[a.type] || 0) + 1 }), {}), top: out.slice(0, 5).map(a => [a.priority.score, a.type, a.action_en]), spent_usd: client.spent });
}
