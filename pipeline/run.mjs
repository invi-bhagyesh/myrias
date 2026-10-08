// Run profile+extract over a pages file and check every quote deterministically.
//   node pipeline/run.mjs --pages pages.jsonl --out DIR --cap 1.00 [--limit N] [--profile demo]
// pages.jsonl: {"source","page","text"} per line. Output DIR/claims.jsonl, DIR/summary.json, DIR/calls.jsonl.
// Licensed text stays in DIR, which must be outside the repository.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { createClient, SpendCapError } from './llm.mjs';
import { checkQuote } from './quote.mjs';
import { EXTRACT_SYSTEM, EXTRACT_SCHEMA, extractUser, PROMPT_VERSION } from './prompts.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const pages = readFileSync(arg('pages'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const out = arg('out'); mkdirSync(out, { recursive: true });
const limit = Number(arg('limit', pages.length)), cap = Number(arg('cap', 0));
const client = createClient({ capUsd: cap, logPath: `${out}/calls.jsonl`, profile: arg('profile', 'demo') });
const stats = { pages: 0, skipped_short: 0, parse_failures: 0, claims: 0, quote_ok: 0, stopped: null };
const reasons = {};
const queue = pages.slice(0, limit);
async function worker() {
  while (queue.length && !stats.stopped) {
    const pg = queue.shift();
    if (pg.text.length < 200) { stats.skipped_short++; continue; }
    try {
      const r = await client.call('extract', { system: EXTRACT_SYSTEM, user: extractUser(pg.text), schema: EXTRACT_SCHEMA, maxTokens: 6000 });
      stats.pages++;
      if (!r.data) { stats.parse_failures++; continue; }
      for (const c of r.data.claims) {
        const q = checkQuote(c.quote, pg.text);
        stats.claims++; if (q.ok) stats.quote_ok++; reasons[q.reason] = (reasons[q.reason] || 0) + 1;
        appendFileSync(`${out}/claims.jsonl`, JSON.stringify({ source: pg.source, page: pg.page, ...c, quote_check: q.reason, model: r.entry.model, prompt_version: PROMPT_VERSION }) + '\n');
      }
    } catch (e) { stats.stopped = e instanceof SpendCapError ? 'spend cap' : e.message; }
  }
}
// Calls are slow (reasoning models, about a minute a page), so run several at once. The cap can be
// overshot by at most the calls already in flight.
await Promise.all(Array.from({ length: Number(arg('concurrency', 6)) }, worker));
const summary = { ...stats, quote_reasons: reasons, spent_usd: client.spent, cap_usd: cap, calls: client.calls };
writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
console.log(summary);
