// Findings: what the claims about one practice and one welfare problem say together.
//   node pipeline/findings.mjs --release public/data/release.json --store STORE_DIR [--log DIR/findings.calls.jsonl] [--concurrency 8]
// Run after export. Groups the released claims by technology class, welfare problem and practice name
// (two records with the same name are one practice), and writes one finding per group:
//   - code counts claims, papers, measured claims, and how many support, contradict or show no effect,
//     and labels the strength from those counts (never the model);
//   - a group with one claim takes that claim's own statement, with no model call;
//   - a larger group goes to the findings model, which writes one or two plain sentences in English and
//     Chinese from the claims alone and names the claims it used; code checks that every number in the
//     English sentence appears in those claims or in the counts.
// Findings keep their ids (F0001...) across runs in STORE/findings.jsonl, and a finding is only rewritten
// when its set of claims changes, so a new run builds on the last one. The claims stay as they are and
// every finding lists them. Output: release-findings-N.json beside the release, listed in finding_files.
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from './llm.mjs';

export const FINDINGS_VERSION = 'findings-0.1';
export const FINDINGS_SYSTEM = `You summarise what several claims from research papers say about one farming practice and one welfare problem, for one farmed fish species.
Write one or two plain sentences: what the practice did to the animals' welfare, and under what conditions if the claims state them.
If the claims disagree or some show no effect, say so. If most claims only describe the practice without an effect on welfare, say that.
Use only what the claims say. Do not add numbers, doses or conditions that are not in them. Do not recommend anything. No hype.
Give the same content in Chinese (statement_zh), written as a fish farmer or researcher in China would say it.
List the ids of the claims your sentences rest on in claim_ids.`;
export const FINDINGS_SCHEMA = { type: 'object', additionalProperties: false, required: ['statement_en', 'statement_zh', 'claim_ids'],
  properties: { statement_en: { type: 'string' }, statement_zh: { type: 'string' }, claim_ids: { type: 'array', items: { type: 'string' } } } };

const OPPOSE = new Set(['counterevidence', 'null', 'mixed']);
const pad = (n, w) => String(n).padStart(w, '0');

// Pure: groups of released claims, one per technology class x welfare problem x practice name.
export function findingGroups(release) {
  const iv = new Map(release.interventions.map(i => [i.id, i]));
  const claims = new Map(release.claims.map(c => [c.id, c]));
  const groups = new Map();
  for (const a of release.applications) {
    const i = iv.get(a.intervention_id);
    const name = (i?.name_en || i?.name_zh || a.intervention_id).toLowerCase();
    const key = `${a.technology_class}|${a.welfare_problem}|${name}`;
    const g = groups.get(key) || { key, technology_class: a.technology_class, welfare_problem: a.welfare_problem, species_id: a.species_id,
      practice_en: i?.name_en || null, practice_zh: i?.name_zh || null, application_ids: [], intervention_ids: [], claim_ids: [] };
    g.application_ids.push(a.id); if (!g.intervention_ids.includes(a.intervention_id)) g.intervention_ids.push(a.intervention_id);
    for (const id of a.claim_ids) if (claims.has(id) && !g.claim_ids.includes(id)) g.claim_ids.push(id);
    groups.set(key, g);
  }
  return [...groups.values()].filter(g => g.claim_ids.length).map(g => ({ ...g, claim_ids: g.claim_ids.sort() }));
}

// Pure: counts and the strength label, from the claims alone.
export function findingCounts(g, claims) {
  const cs = g.claim_ids.map(id => claims.get(id));
  const papers = new Set(cs.map(c => c.source_id));
  const n = p => cs.filter(p).length;
  const counts = { claims: cs.length, papers: papers.size, measured: n(c => c.kind === 'measured'),
    supportive: n(c => c.polarity === 'supportive'), opposing: n(c => OPPOSE.has(c.polarity)), descriptive: n(c => !c.polarity || c.polarity === 'descriptive') };
  // Strength from the counts: one paper; described (more claims only describe the practice than take a
  // side); agree or against (80% or more of the claims that take a side point one way); otherwise mixed.
  const sided = counts.supportive + counts.opposing, share = sided ? counts.supportive / sided : 0;
  const strength = counts.papers === 1 ? 'one_paper'
    : sided < counts.descriptive || !sided ? 'described'
    : share >= 0.8 ? 'agree'
    : share <= 0.2 ? 'against'
    : 'mixed';
  return { counts, strength };
}

// Every number in the sentence must appear in the claims it rests on, or be one of the counts.
const nums = s => (String(s || '').match(/\d+(?:\.\d+)?/g) || []);
export function numbersOk(statement, claims, counts, extra = []) {
  const pool = new Set([...claims.flatMap(c => [...nums(c.text_en), ...nums(c.statement), ...nums(c.quote)]), ...Object.values(counts).map(String), ...extra.map(String)]);
  return nums(statement).every(x => pool.has(x));
}

const hashOf = ids => createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 12);
const findingUser = (g, cs, sourceYear, label) => `Species: mandarin fish (Siniperca chuatsi)
Practice: ${g.practice_en || g.practice_zh}${g.practice_zh && g.practice_en ? ` (${g.practice_zh})` : ''}
Welfare problem: ${label}
Claims (${cs.length}, from ${new Set(cs.map(c => c.source_id)).size} papers):
${cs.map(c => `${c.id} [paper ${c.source_id}${sourceYear.get(c.source_id) ? ', ' + sourceYear.get(c.source_id) : ''}; ${c.kind || '?'}; ${c.polarity || 'descriptive'}]: ${c.text_en || c.statement}`).join('\n')}
Return JSON.`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const relPath = arg('release'), dir = dirname(relPath), stem = basename(relPath).replace(/\.json$/, '');
  const rel = JSON.parse(readFileSync(relPath, 'utf8'));
  rel.claims = (rel.claim_files || []).flatMap(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const claims = new Map(rel.claims.map(c => [c.id, c]));
  const sourceYear = new Map(rel.sources.map(s => [s.id, s.year]));
  const problemLabel = new Map(rel.taxonomy.welfare_problems.map(p => [p.id, p.en || p.name_en || p.id]));
  const cachePath = join(arg('store'), 'findings.jsonl');
  const cache = new Map(existsSync(cachePath) ? readFileSync(cachePath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(f => [f.key, f]) : []);
  let next = [...cache.values()].reduce((m, f) => Math.max(m, Number(f.id.slice(1)) || 0), 0);
  const client = createClient({ logPath: arg('log', join(arg('store'), '..', `findings-${new Date().toISOString().slice(0, 10)}.calls.jsonl`)) });
  const groups = findingGroups(rel);
  const out = [];
  let reused = 0, single = 0, written = 0;
  const todo = [];
  for (const g of groups) {
    const { counts, strength } = findingCounts(g, claims);
    const hash = hashOf(g.claim_ids), old = cache.get(g.key);
    const base = { id: old?.id || 'F' + pad(++next, 4), key: g.key, species_id: g.species_id, technology_class: g.technology_class, welfare_problem: g.welfare_problem,
      practice_en: g.practice_en, practice_zh: g.practice_zh, intervention_ids: g.intervention_ids, application_ids: g.application_ids, claim_ids: g.claim_ids, claims_hash: hash, counts, strength };
    if (old && old.claims_hash === hash && old.statement_en) {
      // Reused as written; the number check is run again so a fix to the check applies to old findings too.
      const used = (old.used_claim_ids || g.claim_ids).map(id => claims.get(id)).filter(Boolean);
      const check = old.written_by === 'single_claim' ? 'numbers_ok' : numbersOk(old.statement_en, used, counts, used.map(c => sourceYear.get(c.source_id)).filter(Boolean)) ? 'numbers_ok' : 'numbers_not_in_claims';
      out.push({ ...old, ...base, statement_en: old.statement_en, statement_zh: old.statement_zh, check }); reused++; continue;
    }
    if (g.claim_ids.length === 1) {
      const c = claims.get(g.claim_ids[0]);
      out.push({ ...base, statement_en: c.text_en || null, statement_zh: c.text_zh || null, used_claim_ids: g.claim_ids, written_by: 'single_claim', check: 'numbers_ok' }); single++; continue;
    }
    todo.push(base);
  }
  // Groups with several claims: one model call each, several at a time.
  const queue = [...todo];
  await Promise.all(Array.from({ length: Number(arg('concurrency', 8)) }, async () => {
    while (queue.length) {
      const base = queue.shift();
      const cs = base.claim_ids.map(id => claims.get(id));
      const r = await client.call('findings', { system: FINDINGS_SYSTEM, user: findingUser(base, cs, sourceYear, problemLabel.get(base.welfare_problem)), schema: FINDINGS_SCHEMA });
      if (!r.data) { console.error(`findings: unparsed output for ${base.key}`); out.push({ ...base, statement_en: null, statement_zh: null, written_by: null, check: 'unparsed' }); continue; }
      const used = r.data.claim_ids.filter(id => base.claim_ids.includes(id));
      const usedClaims = used.length ? used.map(id => claims.get(id)) : cs;
      const ok = numbersOk(r.data.statement_en, usedClaims, base.counts, usedClaims.map(c => sourceYear.get(c.source_id)).filter(Boolean));
      out.push({ ...base, statement_en: r.data.statement_en, statement_zh: r.data.statement_zh, used_claim_ids: used.length ? used : base.claim_ids,
        written_by: { model: r.entry.model, version: FINDINGS_VERSION }, check: ok ? 'numbers_ok' : 'numbers_not_in_claims' });
      written++;
    }
  }));
  out.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(cachePath, out.map(f => JSON.stringify(f)).join('\n') + '\n');
  // Beside the release: findings in files under 350 KB, listed in release.json.
  for (const f of readdirSync(dir)) if (new RegExp(`^${stem}-findings-\\d+\\.json$`).test(f)) unlinkSync(join(dir, f));
  const pub = out.filter(f => f.statement_en || f.statement_zh).map(({ key, claims_hash, ...f }) => f);
  const files = []; let part = [], size = 0;
  const flush = () => { if (!part.length) return; const f = `${stem}-findings-${files.length}.json`; writeFileSync(join(dir, f), JSON.stringify(part) + '\n'); files.push(f); part = []; size = 0; };
  for (const f of pub) { const n = Buffer.byteLength(JSON.stringify(f)); if (size + n > 350_000) flush(); part.push(f); size += n + 1; }
  flush();
  const shell = JSON.parse(readFileSync(relPath, 'utf8'));
  writeFileSync(relPath, JSON.stringify({ ...shell, finding_files: files }, null, 1) + '\n');
  console.log({ groups: groups.length, findings: pub.length, reused, single_claim: single, written, numbers_not_in_claims: pub.filter(f => f.check === 'numbers_not_in_claims').length,
    by_strength: pub.reduce((m, f) => ({ ...m, [f.strength]: (m[f.strength] || 0) + 1 }), {}), spent_usd: client.spent });
}
