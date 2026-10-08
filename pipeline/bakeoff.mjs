// Compare models on the extract stage against a small hand-checked gold set.
//   node pipeline/bakeoff.mjs --gold pipeline/gold/mandarin.jsonl --models a/b,c/d            (dry run: cost estimate only)
//   node pipeline/bakeoff.mjs --gold ... --models ... --cap 0.50 --run                          (spends money, needs OPENROUTER_API_KEY)
// Gold format: one JSON object per line: {"id","lang","text","claims":[{"quote"}]}; see pipeline/gold/README.md.
import { readFileSync, mkdirSync } from 'node:fs';
import { createClient, estimateCost, CONFIG } from './llm.mjs';
import { checkQuote, bigramOverlap } from './quote.mjs';
import { EXTRACT_SYSTEM, EXTRACT_SCHEMA, extractUser } from './prompts.mjs';

export function loadGold(path) {
  return readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).map((l, i) => {
    const g = JSON.parse(l);
    if (!g.id || !g.text || !Array.isArray(g.claims)) throw new Error(`${path}:${i + 1}: needs id, text, claims`);
    return g;
  });
}

// Score one passage. A returned claim is valid if its quote is on the page. A gold quote is found
// if some returned quote overlaps it by at least `match` (bigram Dice).
export function scorePassage(gold, returned, match = 0.8) {
  const quotes = returned.map(c => c.quote);
  const valid = quotes.filter(q => checkQuote(q, gold.text).ok).length;
  const found = gold.claims.filter(g => quotes.some(q => bigramOverlap(q, g.quote) >= match)).length;
  return { returned: quotes.length, valid, gold: gold.claims.length, found };
}

export function summarise(rows) {
  const sum = k => rows.reduce((n, r) => n + r[k], 0);
  const returned = sum('returned'), gold = sum('gold');
  return { returned, valid_quote_rate: returned ? sum('valid') / returned : null, recall: gold ? sum('found') / gold : null, gold };
}

export async function runModel(model, golds, client) {
  const rows = []; let parseFailures = 0;
  for (const g of golds) {
    const out = await client.call('extract', { model, system: EXTRACT_SYSTEM, user: extractUser(g.text), schema: EXTRACT_SCHEMA, maxTokens: 1500 });
    if (!out.data) { parseFailures++; rows.push({ returned: 0, valid: 0, gold: g.claims.length, found: 0 }); continue; }
    rows.push(scorePassage(g, out.data.claims));
  }
  return { model, ...summarise(rows), parse_failures: parseFailures, passages: golds.length };
}

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i < 0 ? def : (process.argv[i + 1] ?? true); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const gold = arg('gold'); const models = String(arg('models', '')).split(',').filter(Boolean);
  if (!gold || !models.length) { console.error('usage: --gold FILE --models a/b,c/d [--cap USD --run]'); process.exit(2); }
  const golds = loadGold(gold);
  const chars = golds.reduce((n, g) => n + g.text.length, 0);
  const estimate = models.map(m => ({ m, usd: estimateCost(m, chars + EXTRACT_SYSTEM.length * golds.length, 1500 * golds.length) }));
  console.log(`${golds.length} passages, ${chars} characters`);
  for (const e of estimate) console.log(`  ${e.m}: about $${e.usd.toFixed(4)}${CONFIG.prices[e.m] ? '' : ' (price unknown)'}`);
  if (!process.argv.includes('--run')) { console.log('Dry run. Add --run and --cap USD to spend.'); process.exit(0); }
  const cap = Number(arg('cap', 0)); mkdirSync('pipeline/runs', { recursive: true });
  const client = createClient({ capUsd: cap, logPath: `pipeline/runs/bakeoff-${Date.now()}.jsonl` });
  const results = [];
  for (const m of models) results.push({ ...(await runModel(m, golds, client)), spent_usd: client.spent });
  console.table(results.map(r => ({ model: r.model, valid_quotes: r.valid_quote_rate?.toFixed(2), recall: r.recall?.toFixed(2), claims: r.returned, parse_fail: r.parse_failures })));
  console.log(`total spent $${client.spent.toFixed(4)} of cap $${cap}`);
}
