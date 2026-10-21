// Findings: what the claims about one practice and one welfare problem say together.
//   node pipeline/findings.mjs --release public/data/release.json --store STORE_DIR [--practices STORE/practices.json] [--species-name "mandarin fish (Siniperca chuatsi)"] [--log FILE] [--concurrency 8]
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
// Each finding keeps its basis, so the site can show how it was put together:
//   basis.grouping  the practice names joined into it, and the cluster model's reason (from cluster.mjs);
//   basis.strength  the counts the strength label comes from, in one sentence written by code;
//   basis.summary   the findings model's reason for its sentence: which claims weigh most and why.
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from './llm.mjs';

export const FINDINGS_VERSION = 'findings-0.2';
export const FINDINGS_SYSTEM = `You summarise what several claims from research papers say about one farming practice and one welfare problem, for one farmed fish species.
Write one or two plain sentences: what the practice did to the animals' welfare, and under what conditions if the claims state them.
If the claims disagree or some show no effect, say so. If most claims only describe the practice without an effect on welfare, say that.
Use only what the claims say. Do not add numbers, doses or conditions that are not in them. Do not recommend anything. No hype.
Give the same content in Chinese (statement_zh), written as a fish farmer or researcher in China would say it.
List the ids of the claims your sentences rest on in claim_ids.
In reason, say in one sentence why you summarised it this way: which claims carry the most weight and why (measured or only described, how many papers), and how you treated any disagreement.`;
export const FINDINGS_SCHEMA = { type: 'object', additionalProperties: false, required: ['statement_en', 'statement_zh', 'claim_ids', 'reason'],
  properties: { statement_en: { type: 'string' }, statement_zh: { type: 'string' }, claim_ids: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } } };

const OPPOSE = new Set(['counterevidence', 'null', 'mixed']);
const pad = (n, w) => String(n).padStart(w, '0');

// Pure: groups of released claims, one per technology class x welfare problem x practice. The practice is
// the claim's own practice name, or, given a practice map (claim id -> { key, name_en, name_zh } from
// cluster.mjs), the clustered practice the claim was tested into.
export function findingGroups(release, practices = null) {
  const iv = new Map(release.interventions.map(i => [i.id, i]));
  const claims = new Map(release.claims.map(c => [c.id, c]));
  const groups = new Map();
  for (const a of release.applications) {
    const i = iv.get(a.intervention_id);
    for (const id of a.claim_ids) {
      if (!claims.has(id)) continue;
      const p = practices?.[id] || { key: `${a.technology_class}|${(i?.name_en || i?.name_zh || a.intervention_id).toLowerCase()}`, name_en: i?.name_en || null, name_zh: i?.name_zh || null };
      const key = `${a.technology_class}|${a.welfare_problem}|${p.key.split('|').slice(1).join('|')}`;
      const g = groups.get(key) || { key, technology_class: a.technology_class, welfare_problem: a.welfare_problem, species_id: a.species_id,
        practice_en: p.name_en, practice_zh: p.name_zh, application_ids: [], intervention_ids: [], claim_ids: [] };
      if (!g.application_ids.includes(a.id)) g.application_ids.push(a.id);
      if (!g.intervention_ids.includes(a.intervention_id)) g.intervention_ids.push(a.intervention_id);
      if (!g.claim_ids.includes(id)) g.claim_ids.push(id);
      groups.set(key, g);
    }
  }
  return [...groups.values()].map(g => ({ ...g, claim_ids: g.claim_ids.sort() }));
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

// Pure: the strength label explained from the counts, in English and Chinese.
export function strengthBasis({ counts: c, strength }) {
  const sided = c.supportive + c.opposing;
  const en = strength === 'one_paper' ? `All ${c.claims} claims come from one paper.`
    : strength === 'described' ? `${c.descriptive} of ${c.claims} claims only describe the practice; ${sided} take a side.`
    : `Of ${sided} claims that take a side: ${c.supportive} in favour, ${c.opposing} against or no effect` + (strength === 'mixed' ? '. Neither side reaches 80%.' : '. At least 80% point one way.');
  const zh = strength === 'one_paper' ? `全部 ${c.claims} 条论断来自同一篇论文。`
    : strength === 'described' ? `${c.claims} 条论断中 ${c.descriptive} 条仅描述做法，${sided} 条有明确倾向。`
    : `${sided} 条有明确倾向的论断中，${c.supportive} 条支持，${c.opposing} 条反对或无效果` + (strength === 'mixed' ? '，任何一方都未达到 80%。' : '，至少 80% 指向同一方向。');
  return { en, zh, rule: 'one paper; described if more claims describe than take a side; agree or against at 80% or more one way; otherwise mixed' };
}

// Pure: the names joined into a practice and why, from the cluster record (practice-clusters.json) and the
// practice map. A practice no cluster touched is its own name.
export function groupingBasis(claimIds, practices, clusters) {
  if (!practices) return null;
  const key = practices[claimIds[0]]?.key;
  const c = (clusters || []).find(c => (c.key || `${(c.members[0] || '').split('|')[0]}|${String(c.name_en || '').toLowerCase().trim()}`) === key);
  if (!c) return { names: [], reason: null, model: null };
  return { names: c.members.filter(m => !(c.dropped_members || []).includes(m)).map(m => m.split('|').slice(1).join('|')),
    dropped: (c.dropped_members || []).map(m => m.split('|').slice(1).join('|')), reason: c.reason || null, model: c.model || null };
}

// Every number in the sentence must appear in the claims it rests on, or be one of the counts.
const nums = s => (String(s || '').match(/\d+(?:\.\d+)?/g) || []);
export function numbersOk(statement, claims, counts, extra = []) {
  const pool = new Set([...claims.flatMap(c => [...nums(c.text_en), ...nums(c.statement), ...nums(c.quote)]), ...Object.values(counts).map(String), ...extra.map(String)]);
  return nums(statement).every(x => pool.has(x));
}

const hashOf = ids => createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 12);
const findingUser = (g, cs, sourceYear, label, species = 'mandarin fish (Siniperca chuatsi)') => `Species: ${species}
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
  const practices = arg('practices') ? JSON.parse(readFileSync(arg('practices'), 'utf8')) : null;
  const clusterPath = arg('practices') ? join(dirname(arg('practices')), 'practice-clusters.json') : null;
  const clusters = clusterPath && existsSync(clusterPath) ? JSON.parse(readFileSync(clusterPath, 'utf8')).clusters : [];
  const groups = findingGroups(rel, practices);
  const out = [];
  let reused = 0, single = 0, written = 0;
  const todo = [];
  for (const g of groups) {
    const { counts, strength } = findingCounts(g, claims);
    const hash = hashOf(g.claim_ids), old = cache.get(g.key);
    const base = { id: old?.id || 'F' + pad(++next, 4), key: g.key, species_id: g.species_id, technology_class: g.technology_class, welfare_problem: g.welfare_problem,
      practice_en: g.practice_en, practice_zh: g.practice_zh, intervention_ids: g.intervention_ids, application_ids: g.application_ids, claim_ids: g.claim_ids, claims_hash: hash, counts, strength,
      basis: { grouping: groupingBasis(g.claim_ids, practices, clusters), strength: strengthBasis({ counts, strength }), summary: old?.claims_hash === hash ? old.basis?.summary || null : null } };
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
      const r = await client.call('findings', { system: FINDINGS_SYSTEM, user: findingUser(base, cs, sourceYear, problemLabel.get(base.welfare_problem), arg('species-name') || undefined), schema: FINDINGS_SCHEMA });
      if (!r.data) { console.error(`findings: unparsed output for ${base.key}`); out.push({ ...base, statement_en: null, statement_zh: null, written_by: null, check: 'unparsed' }); continue; }
      const used = r.data.claim_ids.filter(id => base.claim_ids.includes(id));
      const usedClaims = used.length ? used.map(id => claims.get(id)) : cs;
      const ok = numbersOk(r.data.statement_en, usedClaims, base.counts, usedClaims.map(c => sourceYear.get(c.source_id)).filter(Boolean));
      out.push({ ...base, basis: { ...base.basis, summary: r.data.reason || null }, statement_en: r.data.statement_en, statement_zh: r.data.statement_zh, used_claim_ids: used.length ? used : base.claim_ids,
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
