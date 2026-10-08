// Run a per-claim stage (map or verify) over claims.jsonl. Only claims whose quote was found on the page are sent.
//   node pipeline/claimstage.mjs map|verify --in claims.jsonl --out out.jsonl --cap 0.20
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient, SpendCapError } from './llm.mjs';
import { MAP_SYSTEM, MAP_SCHEMA, mapUser, VERIFY_SYSTEM, VERIFY_SCHEMA, verifyUser } from './prompts.mjs';

export const STAGES = { map: [MAP_SYSTEM, MAP_SCHEMA, mapUser], verify: [VERIFY_SYSTEM, VERIFY_SCHEMA, verifyUser] };

export async function runClaimStage(stage, claims, client, concurrency = 6) {
  const [system, schema, user] = STAGES[stage];
  const queue = claims.map((c, i) => [c, i]).filter(([c]) => c.quote_check === 'found');
  const out = claims.map(c => ({ ...c }));
  let stopped = null;
  async function worker() {
    while (queue.length && !stopped) {
      const [c, i] = queue.shift();
      try {
        const r = await client.call(stage, { system, user: user(c), schema, maxTokens: stage === 'verify' ? 4000 : 800 });
        out[i][stage] = r.data ? { ...r.data, model: r.entry.model } : { error: 'unparsed' };
      } catch (e) { stopped = e instanceof SpendCapError ? 'spend cap' : e.message; }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { out, stopped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const stage = process.argv[2];
  const claims = readFileSync(arg('in'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const client = createClient({ capUsd: Number(arg('cap', 0)), logPath: `${arg('out')}.calls.jsonl` });
  const { out, stopped } = await runClaimStage(stage, claims, client);
  writeFileSync(arg('out'), out.map(c => JSON.stringify(c)).join('\n') + '\n');
  console.log({ stage, claims: claims.length, sent: claims.filter(c => c.quote_check === 'found').length, stopped, spent_usd: client.spent });
}
