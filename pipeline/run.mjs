// Run the extract stage over a pages file, end to end and resumable.
//   node pipeline/run.mjs --pages pages.jsonl --out DIR --cap 1.00 [--profile demo] [--limit N]
//        [--concurrency 6] [--max-tokens 6000] [--gold gold.jsonl --min-recall 0.7]
// pages.jsonl: {"source","page","text"} per line. DIR must be outside the repository (licensed text).
//
// Stages, after WelfareLens's intake funnel:
//   0  dedup: drop duplicate papers before any model call (no cost)
//   1  split each paper into overlapping, page-locating windows (no cost)
//   2  extract claims per window; check every quote against the window and locate its page
//   3  merge the duplicates the overlaps create; optional recall gate against a gold set
// Every window is a task with a stable id. Finished tasks are checkpointed in DIR/tasks.jsonl, so a
// rerun with the same inputs and settings skips them; a rerun with different ones refuses to mix.
// Tasks cut off by the output limit are recorded as truncated and retried on the next run.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient, SpendCapError, stageSetting, CONFIG } from './llm.mjs';
import { checkQuote, bigramOverlap } from './quote.mjs';
import { windows, locatePage, mergeOverlaps } from './chunk.mjs';
import { dedupSources } from './dedup.mjs';
import { EXTRACT_SYSTEM, EXTRACT_SCHEMA, extractUser, PROMPT_VERSION } from './prompts.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const readJsonl = path => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

// Everything that changes what a task would produce. Resuming is only allowed when this matches.
export function runConfig({ profile, size, overlap, maxTokens }) {
  return { prompt_version: PROMPT_VERSION, prompt_hash: sha(EXTRACT_SYSTEM + JSON.stringify(EXTRACT_SCHEMA)).slice(0, 16),
    extract: stageSetting('extract', profile), provider: CONFIG.provider, window: { size, overlap }, max_tokens: maxTokens };
}
export const taskId = (source, w, configHash) => sha(`${source}|${w.index}|${sha(w.text)}|${configHash}`).slice(0, 20);

// Share of gold quotes found by some extracted quote from the same source.
export function recall(claims, gold, match = 0.8) {
  if (!gold.length) return null;
  const found = gold.filter(g => claims.some(c => c.source === g.source && bigramOverlap(c.quote, g.quote) >= match)).length;
  return found / gold.length;
}

async function main() {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const out = arg('out'); mkdirSync(out, { recursive: true });
  const profile = arg('profile', 'demo'), size = Number(arg('window', 1800)), overlap = Number(arg('overlap', 300));
  const maxTokens = arg('max-tokens') ? Number(arg('max-tokens')) : null, cap = Number(arg('cap', 0));
  const allPages = readJsonl(arg('pages'));

  // Stage 0
  const { pages, dropped } = dedupSources(allPages);
  // Manifest: refuse to resume into a directory produced with different inputs or settings.
  const config = runConfig({ profile, size, overlap, maxTokens });
  const configHash = sha(JSON.stringify(config)).slice(0, 16);
  const manifest = { config, config_hash: configHash, input_hash: sha(readFileSync(arg('pages'))).slice(0, 16), dropped_duplicates: dropped };
  const mPath = `${out}/manifest.json`;
  if (existsSync(mPath)) {
    const prev = JSON.parse(readFileSync(mPath, 'utf8'));
    if (prev.config_hash !== configHash || prev.input_hash !== manifest.input_hash) {
      console.error(`${out} holds a run with different inputs or settings; use a new --out directory.`); process.exit(2);
    }
  } else writeFileSync(mPath, JSON.stringify(manifest, null, 2));

  // Stage 1
  const bySource = new Map();
  for (const p of pages) (bySource.get(p.source) || bySource.set(p.source, []).get(p.source)).push(p);
  const tasks = [];
  for (const [source, list] of bySource) for (const w of windows(list, { size, overlap })) tasks.push({ id: taskId(source, w, configHash), source, w, pages: list });
  const done = new Set(readJsonl(`${out}/tasks.jsonl`).filter(t => t.status === 'done').map(t => t.id));
  const queue = tasks.filter(t => !done.has(t.id)).slice(0, Number(arg('limit', tasks.length)));

  // Stage 2
  const client = createClient({ capUsd: cap, logPath: `${out}/calls.jsonl`, profile });
  let stopped = null;
  async function worker() {
    while (queue.length && !stopped) {
      const t = queue.shift();
      try {
        const r = await client.call('extract', { system: EXTRACT_SYSTEM, user: extractUser(t.w.text), schema: EXTRACT_SCHEMA, maxTokens });
        if (!r.data) { appendFileSync(`${out}/tasks.jsonl`, JSON.stringify({ id: t.id, source: t.source, window: t.w.index, status: r.entry.finish === 'length' ? 'truncated' : 'unparsed', model: r.entry.model }) + '\n'); continue; }
        for (const c of r.data.claims) {
          const q = checkQuote(c.quote, t.w.text);
          const page = q.ok ? (locatePage(c.quote, t.pages) ?? t.w.page_start) : t.w.page_start;
          appendFileSync(`${out}/raw-claims.jsonl`, JSON.stringify({ source: t.source, page, window: t.w.index, task: t.id, ...c, quote_check: q.reason, ...(q.gaps ? { quote_gaps: q.gaps } : {}), model: r.entry.model, prompt_version: PROMPT_VERSION }) + '\n');
        }
        appendFileSync(`${out}/tasks.jsonl`, JSON.stringify({ id: t.id, source: t.source, window: t.w.index, status: 'done', claims: r.data.claims.length, model: r.entry.model }) + '\n');
      } catch (e) { stopped = e instanceof SpendCapError ? 'spend cap' : e.message; }
    }
  }
  await Promise.all(Array.from({ length: Number(arg('concurrency', 6)) }, worker));

  // Stage 3
  const raw = readJsonl(`${out}/raw-claims.jsonl`);
  const claims = mergeOverlaps(raw);
  writeFileSync(`${out}/claims.jsonl`, claims.map(c => JSON.stringify(c)).join('\n') + (claims.length ? '\n' : ''));
  const taskLog = readJsonl(`${out}/tasks.jsonl`);
  const last = new Map(taskLog.map(t => [t.id, t.status]));
  const count = s => [...last.values()].filter(v => v === s).length;
  const gold = arg('gold') ? readJsonl(arg('gold')) : [];
  const r = recall(claims.filter(c => c.quote_check === 'found'), gold);
  const minRecall = Number(arg('min-recall', 0));
  const summary = {
    sources: bySource.size, duplicates_dropped: dropped.length, windows: tasks.length,
    tasks_done: count('done'), tasks_truncated: count('truncated'), tasks_unparsed: count('unparsed'), tasks_pending: tasks.length - last.size,
    claims_raw: raw.length, claims_after_merge: claims.length, quote_found: claims.filter(c => c.quote_check === 'found').length,
    recall: r, gate: gold.length ? (r >= minRecall ? 'pass' : 'fail') : 'not_measured',
    stopped, spent_usd_this_run: client.spent, cap_usd: cap > 0 ? cap : null, config_hash: configHash
  };
  writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(summary);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
