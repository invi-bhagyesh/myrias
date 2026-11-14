// English titles for a weekly digest issue.
//
//   node pipeline/digest_translate.mjs public/data/digest/2026-11-06.json [more issue files] [--force] [--dry-run] [--log PATH]
//
// Adds title_en to every item whose title is not already English, using the pipeline's 'translate' model
// (pipeline/models.json). Titles go 25 to a call; each keeps its number so answers cannot shift between items.
// Items that already have title_en are skipped unless --force is given. The original title is never changed.
// Model calls (with their cost) are logged only when --log PATH is given; keep that file outside public/.
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from './llm.mjs';

export const SYSTEM = `You translate the titles of Chinese news items, government notices and research papers about animals into English.
Rules:
- Translate faithfully and plainly. Do not add, explain or summarise.
- Keep names of people, places, species and organisations; give official English names where they exist (农业农村部 = Ministry of Agriculture and Rural Affairs; 全国人民代表大会 = National People's Congress).
- Keep numbers, dates and quotation marks. Book-title marks 《》 become double quotes.
- Write it as a headline: capitalise the main words, no full stop at the end.
Return JSON: {"titles": [{"i": <number>, "en": "<English title>"}]} with one entry per input number.`;
export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['titles'],
  properties: { titles: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['i', 'en'], properties: { i: { type: 'integer' }, en: { type: 'string' } } } } }
};
export const needsEnglish = it => /[㐀-鿿]/.test(it.title || '');
export const batchUser = rows => rows.map(([i, t]) => `${i}. ${t}`).join('\n') + '\n\nReturn the English titles as JSON.';

// Pure: put the model's answers back on the items, by number; ignore numbers that were not asked for.
export function applyTitles(items, asked, answers) {
  const want = new Set(asked);
  let n = 0;
  for (const a of answers || []) {
    if (!want.has(a.i) || !items[a.i] || typeof a.en !== 'string' || !a.en.trim()) continue;
    items[a.i].title_en = a.en.trim().replace(/[.。]\s*$/, '');
    n++;
  }
  return n;
}

export async function translateIssue(issue, client, { force = false, size = 25 } = {}) {
  const items = issue.items || [];
  const todo = items.map((it, i) => [i, it]).filter(([, it]) => needsEnglish(it) && (force || !it.title_en));
  let done = 0;
  for (let k = 0; k < todo.length; k += size) {
    const rows = todo.slice(k, k + size).map(([i, it]) => [i, it.title]);
    const r = await client.call('translate', { system: SYSTEM, user: batchUser(rows), schema: SCHEMA });
    done += applyTitles(items, rows.map(([i]) => i), r.data?.titles);
  }
  return { asked: todo.length, translated: done };
}

// Keep the file's own indentation so a rewrite only changes what was added.
const indentOf = text => (text.match(/^\{\n( +)"/) || [])[1]?.length || 0;

async function main() {
  const args = process.argv.slice(2), li = args.indexOf('--log'), logPath = li >= 0 ? args[li + 1] : undefined;
  const files = args.filter((a, i) => !a.startsWith('--') && (li < 0 || i !== li + 1));
  if (!files.length) { console.error('usage: node pipeline/digest_translate.mjs ISSUE.json [...] [--force] [--dry-run] [--log PATH]'); process.exit(2); }
  for (const f of files) {
    const issue = JSON.parse(readFileSync(f, 'utf8'));
    const client = createClient({ capUsd: 1, logPath });
    const res = await translateIssue(issue, client, { force: process.argv.includes('--force') });
    console.log(JSON.stringify({ issue: f, ...res, spent_usd: Number(client.spent.toFixed(5)) }));
    if (!process.argv.includes('--dry-run')) writeFileSync(f, JSON.stringify(issue, null, indentOf(readFileSync(f, 'utf8'))) + (readFileSync(f, 'utf8').endsWith('\n') ? '\n' : ''));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
