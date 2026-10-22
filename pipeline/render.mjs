// Render: give each claim an English view derived from its record. The record (the statement in
// the source's own language) is never changed. Each rendering carries its provenance and a
// deterministic check that every number in the record survives into the English.
//   node pipeline/render.mjs --in claims.jsonl --out rendered.jsonl [--cap 0.10] [--concurrency 16] [--all]
// Only claims that can be released are rendered: quote found, not marked as off welfare, and supported or
// partly supported when they have been verified (--all renders every claim with a found quote). Each result is
// appended to OUT.partial.jsonl as it arrives, so a stopped step resumes without repeating calls.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createClient, SpendCapError } from './llm.mjs';
import { RENDER_SYSTEM, RENDER_SCHEMA, RENDER_VERSION, renderUser } from './prompts.mjs';

export const sourceLang = s => ((String(s).match(/[一-鿿]/g) || []).length > String(s).length / 4 ? 'zh' : 'en');

// Numbers in the record, each with the values an English rendering may use for it
// (25万 may become 25 万, 250,000 or 250 thousand). Chinese numerals such as 三 are not checked.
function recordNumbers(text) {
  const s = String(text).normalize('NFKC');
  const out = [];
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(\s*[万亿千百])?/g)) {
    const n = Number(m[1]), unit = (m[2] || '').trim();
    const mult = { 万: 1e4, 亿: 1e8, 千: 1e3, 百: 1e2 }[unit];
    out.push({ shown: m[1], accept: mult ? [n, n * mult] : [n] });
  }
  return out;
}
const englishNumbers = text => [...String(text).normalize('NFKC').replace(/(\d),(?=\d{3}\b)/g, '$1').matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0]));

// Every number in the record must appear in the English (as itself or its expanded value).
export function numbersPreserved(record, english) {
  const pool = englishNumbers(english);
  const missing = [];
  for (const n of recordNumbers(record)) {
    const k = pool.findIndex(v => n.accept.some(a => Math.abs(a - v) < 1e-9));
    if (k >= 0) pool.splice(k, 1); else missing.push(n.shown);
  }
  return { ok: missing.length === 0, missing };
}

// Pure: whether a claim can reach the release, so is worth an English rendering.
export const releasable = c => c.quote_check === 'found' && !!c.statement && c.map?.welfare_relevant !== false &&
  (!c.verify || ['supported', 'partial'].includes(c.verify.verdict));

export async function runRender(claims, client, concurrency = 6, { all = true, done = new Map(), onResult = () => {} } = {}) {
  const out = claims.map(c => ({ ...c }));
  for (const [i, r] of done) Object.assign(out[i], r);
  const queue = out.map((c, i) => [c, i]).filter(([c, i]) => !done.has(i) && (all ? c.quote_check === 'found' && c.statement : releasable(c)));
  let stopped = null, failed = 0;
  async function worker() {
    while (queue.length && !stopped) {
      const [c, i] = queue.shift();
      const lang = sourceLang(c.statement);
      if (lang === 'en') { out[i].statement_en = c.statement; out[i].intervention_en = c.intervention; out[i].rendering = null; continue; }
      try {
        const r = await client.call('translate', { system: RENDER_SYSTEM, user: renderUser(c), schema: RENDER_SCHEMA });
        if (!r.data) { out[i].rendering = { from: lang, model: r.entry.model, version: RENDER_VERSION, check: 'unparsed' }; continue; }
        const chk = numbersPreserved(c.statement, r.data.statement_en);
        out[i].statement_en = r.data.statement_en;
        out[i].intervention_en = r.data.intervention_en;
        out[i].rendering = { from: lang, model: r.entry.model, version: RENDER_VERSION, check: chk.ok ? 'numbers_ok' : 'numbers_mismatch', ...(chk.ok ? {} : { missing: chk.missing }) };
        onResult(i, { statement_en: out[i].statement_en, intervention_en: out[i].intervention_en, rendering: out[i].rendering });
      } catch (e) {
        // A spend cap stops the step; any other error (a timeout, a gateway error) skips this claim, and the
        // step reports it so a re-run fills the gap from the partial file.
        if (e instanceof SpendCapError) stopped = 'spend cap'; else { failed++; console.error(`render: claim ${i}: ${e.message}`); }
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { out, stopped, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const claims = readFileSync(arg('in'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const client = createClient({ capUsd: Number(arg('cap', 0)), logPath: `${arg('out')}.calls.jsonl` });
  const partial = `${arg('out')}.partial.jsonl`;
  const done = new Map(existsSync(partial) ? readFileSync(partial, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.i, r.fields]) : []);
  const { out, stopped, failed } = await runRender(claims, client, Number(arg('concurrency', 16)), { all: process.argv.includes('--all'), done,
    onResult: (i, fields) => appendFileSync(partial, JSON.stringify({ i, fields }) + '\n') });
  writeFileSync(arg('out'), out.map(c => JSON.stringify(c)).join('\n') + '\n');
  const r = out.filter(c => c.rendering);
  console.log({ rendered: r.length, numbers_ok: r.filter(c => c.rendering.check === 'numbers_ok').length, numbers_mismatch: r.filter(c => c.rendering.check === 'numbers_mismatch').length, failed, stopped, spent_usd: client.spent });
  // Not finished: say so in the exit code, so a run script stops here instead of carrying on without English.
  if (stopped || failed) process.exit(3);
}
