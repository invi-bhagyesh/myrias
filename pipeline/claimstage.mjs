// Run a per-claim stage (map or verify) over claims.jsonl. Only claims whose quote was found on the page are sent.
//   node pipeline/claimstage.mjs map|verify --in claims.jsonl --out out.jsonl --cap 0.20 [--only-relevant] [--concurrency 6]
// --only-relevant (verify): skip claims mapping marked as not about welfare. The export drops those anyway.
// Each result is appended to OUT.partial.jsonl as it arrives; a rerun with the same --out skips claims already done,
// so a stopped run resumes instead of paying again. Exits 3 when any claim is missing, so scripts can rerun.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createClient, SpendCapError } from './llm.mjs';
import { MAP_SYSTEM, MAP_SCHEMA, mapUser, VERIFY_SYSTEM, VERIFY_SCHEMA, verifyUser } from './prompts.mjs';

export const STAGES = { map: [MAP_SYSTEM, MAP_SCHEMA, mapUser], verify: [VERIFY_SYSTEM, VERIFY_SCHEMA, verifyUser] };

export async function runClaimStage(stage, claims, client, concurrency = 6, { onlyRelevant = false, done = new Map(), onResult = () => {} } = {}) {
  const [system, schema, user] = STAGES[stage];
  const out = claims.map((c, i) => (done.has(i) ? { ...c, [stage]: done.get(i) } : { ...c }));
  const queue = claims.map((c, i) => [c, i]).filter(([c, i]) => !done.has(i) && c.quote_check === 'found' && (!onlyRelevant || c.map?.welfare_relevant === true));
  // A call that still fails after the client's retries skips that claim (a rerun picks it up); the stage stops
  // only on the spend cap or after 20 failures in a row (the service is down).
  let stopped = null, failed = 0, inRow = 0;
  async function worker() {
    while (queue.length && !stopped) {
      const [c, i] = queue.shift();
      try {
        const r = await client.call(stage, { system, user: user(c), schema });
        out[i][stage] = r.data ? { ...r.data, model: r.entry.model } : { error: 'unparsed' };
        onResult(i, out[i][stage]);
        inRow = 0;
      } catch (e) {
        if (e instanceof SpendCapError) { stopped = 'spend cap'; break; }
        failed++;
        if (++inRow >= 20) stopped = e.message;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { out, stopped, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const stage = process.argv[2];
  const claims = readFileSync(arg('in'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const client = createClient({ capUsd: Number(arg('cap', 0)), logPath: `${arg('out')}.calls.jsonl` });
  const onlyRelevant = process.argv.includes('--only-relevant');
  const partial = `${arg('out')}.partial.jsonl`;
  const done = new Map(existsSync(partial) ? readFileSync(partial, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.i, r.result]) : []);
  const onResult = (i, result) => appendFileSync(partial, JSON.stringify({ i, result }) + '\n');
  const { out, stopped, failed } = await runClaimStage(stage, claims, client, Number(arg('concurrency', 6)), { onlyRelevant, done, onResult });
  writeFileSync(arg('out'), out.map(c => JSON.stringify(c)).join('\n') + '\n');
  console.log({ stage, claims: claims.length, resumed: done.size, sent: claims.filter(c => c.quote_check === 'found' && (!onlyRelevant || c.map?.welfare_relevant === true)).length, stopped, failed, spent_usd: client.spent });
  // Not complete: exit 3 so a script can rerun (the partial file means only the missing claims are sent).
  if (stopped || failed) process.exitCode = 3;
}
