// Reconstruction test: do findings carry what their claims say? (After Inverse Constitutional AI,
// Findeis et al., 2025, which scores a set of principles by how well a model reproduces the original
// labels from them.)
//   node pipeline/reconstruct.mjs --release public/data/release.json --store STORE_DIR --out DIR [--n 240] [--seed 7]
// 1. Hold out a sample of claims that take a side: supportive (the practice helps welfare) or
//    counterevidence / null (it does not help). Half of each, chosen with a fixed seed.
// 2. For each way of grouping practices (exact names, embedding clusters, clusters after the model test),
//    build the finding for each held-out claim's group from the OTHER claims in that group only.
// 3. A different model reads only that finding and the held-out claim's practice, welfare problem and
//    outcome (not its statement or quote) and answers: helps, does not help, or cannot tell.
// 4. Score: accuracy over all held-out claims (no finding or "cannot tell" counts as wrong), coverage
//    (share with a finding to read), and accuracy where it answered. A baseline with no finding at all
//    shows what the model guesses from the practice name alone.
// Findings built here are for the test only and are cached in DIR by their set of claims.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from './llm.mjs';
import { findingGroups, FINDINGS_SYSTEM, FINDINGS_SCHEMA } from './findings.mjs';

export const RECON_SYSTEM = `You predict the result of a study from a summary of earlier research. You get a summary of what earlier papers found about one farming practice and one welfare problem in mandarin fish, and the practice and outcome a new study measured.
Based only on the summary, answer whether the practice helped the fish's welfare on that outcome (helps), did not help (no effect, or worse: does_not_help), or the summary does not say enough (cannot_tell).`;
export const RECON_SCHEMA = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string', enum: ['helps', 'does_not_help', 'cannot_tell'] } } };

const label = c => (c.polarity === 'supportive' ? 'helps' : ['counterevidence', 'null'].includes(c.polarity) ? 'does_not_help' : null);

// Pure: a seeded shuffle, so the held-out set is the same every time.
export function seeded(list, seed) {
  const a = [...list]; let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Pure: the scores for one method from its answers.
export function score(rows) {
  const n = rows.length, covered = rows.filter(r => r.finding), right = rows.filter(r => r.answer === r.label);
  const answered = rows.filter(r => r.answer && r.answer !== 'cannot_tell');
  return { n, coverage: +(covered.length / n).toFixed(3), accuracy: +(right.length / n).toFixed(3),
    accuracy_answered: answered.length ? +(answered.filter(r => r.answer === r.label).length / answered.length).toFixed(3) : null, answered: answered.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const relPath = arg('release'), dir = dirname(relPath), store = arg('store'), out = arg('out');
  mkdirSync(out, { recursive: true });
  const rel = JSON.parse(readFileSync(relPath, 'utf8'));
  rel.claims = (rel.claim_files || []).flatMap(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const claims = new Map(rel.claims.map(c => [c.id, c]));
  const problemLabel = new Map(rel.taxonomy.welfare_problems.map(p => [p.id, p.en]));
  const client = createClient({ logPath: join(out, 'reconstruct.calls.jsonl') });
  const methods = { exact: 'practices-exact.json', embed: 'practices-embed.json', tested: 'practices.json' };
  const maps = Object.fromEntries(Object.entries(methods).map(([k, f]) => [k, JSON.parse(readFileSync(join(store, f), 'utf8'))]));
  // Held-out claims: in some practice, taking a side; balanced, seeded.
  const inApps = new Set(rel.applications.flatMap(a => a.claim_ids));
  const pool = rel.claims.filter(c => inApps.has(c.id) && label(c));
  const n = Number(arg('n', 240)), seed = Number(arg('seed', 7));
  const helps = seeded(pool.filter(c => label(c) === 'helps'), seed), not = seeded(pool.filter(c => label(c) === 'does_not_help'), seed + 1);
  const test = [...helps.slice(0, n / 2), ...not.slice(0, n / 2)];
  const testIds = new Set(test.map(c => c.id));
  // Findings from the remaining claims, per method, cached by the set of claims they rest on.
  const cachePath = join(out, 'findings-cache.json');
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const train = { ...rel, claims: rel.claims.filter(c => !testIds.has(c.id)) };
  const write = async (g, ids) => {
    const h = createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 12);
    if (cache[h]) return cache[h];
    const cs = ids.map(id => claims.get(id));
    const user = `Species: mandarin fish (Siniperca chuatsi)\nPractice: ${g.practice_en || g.practice_zh}\nWelfare problem: ${problemLabel.get(g.welfare_problem)}\nClaims (${cs.length}):\n` +
      cs.map(c => `${c.id} [paper ${c.source_id}; ${c.kind || '?'}; ${c.polarity || 'descriptive'}]: ${c.text_en || c.statement}`).join('\n') + '\nReturn JSON.';
    const r = await client.call('findings', { system: FINDINGS_SYSTEM, user, schema: FINDINGS_SCHEMA });
    cache[h] = r.data?.statement_en || null;
    return cache[h];
  };
  // The group a held-out claim belongs to under each method, from its application and the method's map.
  const appOf = new Map(rel.applications.flatMap(a => a.claim_ids.map(id => [id, a])));
  const rows = { none: [], exact: [], embed: [], tested: [] };
  const jobs = [];
  for (const [m, map] of Object.entries(maps)) {
    const groups = new Map(findingGroups(train, map).map(g => [g.key, g]));
    for (const c of test) {
      const a = appOf.get(c.id), p = map[c.id];
      const g = groups.get(`${a.technology_class}|${a.welfare_problem}|${p.key.split('|').slice(1).join('|')}`);
      jobs.push({ m, c, a, g });
    }
  }
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Number(arg('concurrency', 8)) }, async () => {
    while (queue.length) { const j = queue.shift(); j.finding = j.g ? await write(j.g, j.g.claim_ids) : null; }
  }));
  writeFileSync(cachePath, JSON.stringify(cache));
  const ask = async (c, a, finding) => {
    const user = `Summary of earlier research: ${finding || '(none)'}\n\nNew study: practice "${c.intervention || '?'}", welfare problem "${problemLabel.get(a.welfare_problem)}", outcome measured: ${c.outcome || 'not stated'}.\nReturn JSON.`;
    const r = await client.call('reconstruct', { system: RECON_SYSTEM, user, schema: RECON_SCHEMA });
    return r.data?.answer || 'cannot_tell';
  };
  const asks = [...test.map(c => ({ m: 'none', c, a: appOf.get(c.id), finding: null })), ...jobs.filter(j => j.finding)];
  const q2 = [...asks];
  await Promise.all(Array.from({ length: Number(arg('concurrency', 8)) }, async () => {
    while (q2.length) { const j = q2.shift(); j.answer = await ask(j.c, j.a, j.finding); }
  }));
  for (const j of [...asks, ...jobs.filter(j => !j.finding)]) rows[j.m].push({ claim: j.c.id, label: label(j.c), finding: j.m === 'none' ? null : j.finding, answer: j.finding || j.m === 'none' ? j.answer : null });
  const practices = Object.fromEntries(Object.entries(maps).map(([k, map]) => [k, new Set(Object.values(map).map(p => p.key)).size]));
  const result = { seed, n: test.length, practices, scores: Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, score(r)])), spent_usd: +client.spent.toFixed(4) };
  writeFileSync(join(out, 'reconstruct.json'), JSON.stringify({ ...result, rows }, null, 1));
  console.log(JSON.stringify(result, null, 1));
}
