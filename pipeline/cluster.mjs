// Cluster practices: find the practice names that mean the same practice, so their claims are read together.
//   node pipeline/cluster.mjs --release public/data/release.json --store STORE_DIR [--threshold 0.30] [--log FILE]
// Follows the shape of Inverse Constitutional AI (Findeis et al., 2025): propose, cluster, test.
//   1. Items: one per practice name within a technology class, as the claims name it.
//   2. Embed each item (its names in English and Chinese plus up to three of its claims) and cluster
//      within its technology class: average-linkage agglomerative clustering on cosine distance, merging
//      while the distance stays under --threshold. No fixed number of clusters.
//   3. Test: each cluster of two or more goes to the cluster model with its members and their claims.
//      It names the practice (dose and conditions stay detail, not a new practice), drops members that
//      are a different practice, and drops single claims that are not about it. Dropped members and
//      claims go back to their own name.
// Writes three groupings to STORE, each a map from claim id to practice { key, name_en, name_zh }:
//   practices-exact.json (as the claims name it), practices-embed.json (clusters, untested) and
//   practices.json (clusters after the test, the one findings use), plus practice-clusters.json with
//   every cluster, the test's verdicts and why. Embeddings are cached in practice-embeddings.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from './llm.mjs';

export const CLUSTER_VERSION = 'cluster-0.1';
export const CLUSTER_SYSTEM = `You check a cluster of practice names that an algorithm grouped as possibly the same farming practice, for one farmed fish species.
Decide the practice most members share and name it: name_en (short, plain English, lowercase) and name_zh (the name a Chinese fish farmer or researcher would use).
Dose, level, duration or conditions are details of one practice, not separate practices (a 13% and a 30% carbohydrate diet are both "dietary carbohydrate level"). A different substance, procedure or purpose is a different practice (anaesthesia used for vaccination is not vaccination).
List in drop_members the member numbers that are a different practice from the one you named. List in drop_claims the ids of claims that are not about the named practice at all.
Give a one-sentence reason.`;
export const CLUSTER_SCHEMA = { type: 'object', additionalProperties: false, required: ['name_en', 'name_zh', 'drop_members', 'drop_claims', 'reason'], properties: {
  name_en: { type: 'string' }, name_zh: { type: 'string' }, drop_members: { type: 'array', items: { type: 'integer' } }, drop_claims: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } } };

const norm = s => String(s || '').toLowerCase().trim();

// Pure: one item per technology class and practice name, with its claim ids.
export function practiceItems(release) {
  const iv = new Map(release.interventions.map(i => [i.id, i]));
  const items = new Map();
  for (const a of release.applications) {
    const i = iv.get(a.intervention_id);
    const name = norm(i?.name_en || i?.name_zh || a.intervention_id);
    const key = `${a.technology_class}|${name}`;
    const it = items.get(key) || { key, cls: a.technology_class, name_en: i?.name_en || null, name_zh: i?.name_zh || null, claim_ids: [] };
    for (const id of a.claim_ids) if (!it.claim_ids.includes(id)) it.claim_ids.push(id);
    items.set(key, it);
  }
  return [...items.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };

// Pure: average-linkage agglomerative clustering on cosine distance. Merges the closest pair while its
// average distance is under the threshold. Returns arrays of indices.
export function agglomerate(vectors, threshold) {
  const n = vectors.length;
  const dist = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 1 - cosine(vectors[i], vectors[j]))));
  let clusters = vectors.map((_, i) => [i]);
  const avg = (A, B) => { let s = 0; for (const i of A) for (const j of B) s += dist[i][j]; return s / (A.length * B.length); };
  for (;;) {
    let best = null;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const d = avg(clusters[i], clusters[j]);
      if (d < threshold && (!best || d < best.d)) best = { i, j, d };
    }
    if (!best) break;
    clusters[best.i] = [...clusters[best.i], ...clusters[best.j]];
    clusters.splice(best.j, 1);
  }
  return clusters;
}

const itemText = (it, claims) => [it.name_en, it.name_zh].filter(Boolean).join(' / ') + ': ' +
  it.claim_ids.slice(0, 3).map(id => claims.get(id)).filter(Boolean).map(c => c.text_en || c.statement).join(' ').slice(0, 900);

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const relPath = arg('release'), dir = dirname(relPath), store = arg('store');
  const rel = JSON.parse(readFileSync(relPath, 'utf8'));
  rel.claims = (rel.claim_files || []).flatMap(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const claims = new Map(rel.claims.map(c => [c.id, c]));
  const client = createClient({ logPath: arg('log', join(store, '..', `cluster-${new Date().toISOString().slice(0, 10)}.calls.jsonl`)) });
  const items = practiceItems(rel);
  // Embeddings, cached by the text embedded.
  const cachePath = join(store, 'practice-embeddings.json');
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const texts = items.map(it => itemText(it, claims)), hashes = texts.map(t => createHash('sha1').update(t).digest('hex').slice(0, 16));
  const missing = [...new Set(hashes.filter(h => !cache[h]))];
  if (missing.length) {
    const vecs = await client.embed('embed', missing.map(h => texts[hashes.indexOf(h)]));
    missing.forEach((h, i) => { cache[h] = vecs[i]; });
    writeFileSync(cachePath, JSON.stringify(cache));
  }
  const vec = hashes.map(h => cache[h]);
  const threshold = Number(arg('threshold', 0.3));
  // Cluster within each technology class.
  const clusters = [];
  for (const cls of [...new Set(items.map(it => it.cls))]) {
    const idx = items.map((it, i) => (it.cls === cls ? i : -1)).filter(i => i >= 0);
    for (const c of agglomerate(idx.map(i => vec[i]), threshold)) clusters.push(c.map(k => idx[k]));
  }
  if (process.argv.includes('--dry')) {
    // Calibration: cluster counts at several thresholds, and the closest pairs, with no model calls.
    for (const t of [0.15, 0.2, 0.25, 0.3, 0.35, 0.4]) {
      let n = 0, multi = 0;
      for (const cls of [...new Set(items.map(it => it.cls))]) { const idx = items.map((it, i) => (it.cls === cls ? i : -1)).filter(i => i >= 0); const cs = agglomerate(idx.map(i => vec[i]), t); n += cs.length; multi += cs.filter(c => c.length > 1).length; }
      console.log(`threshold ${t}: ${n} clusters, ${multi} with 2+ members`);
    }
    const pairs = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (items[i].cls === items[j].cls) pairs.push([1 - cosine(vec[i], vec[j]), items[i].name_en, items[j].name_en]);
    pairs.sort((a, b) => a[0] - b[0]);
    for (const q of [0, 50, 100, 150, 200, 250, 300, 400, 500]) if (pairs[q]) console.log(q, pairs[q][0].toFixed(3), '|', pairs[q][1], '|', pairs[q][2]);
    console.log('spent', client.spent);
    process.exit(0);
  }
  const pick = (it, name_en = it.name_en, name_zh = it.name_zh) => ({ key: `${it.cls}|${norm(name_en || name_zh)}`, name_en, name_zh });
  const exact = {}, embed = {}, tested = {};
  for (const it of items) for (const id of it.claim_ids) exact[id] = pick(it);
  // Untested clusters: the member with the most claims names the practice.
  for (const c of clusters) {
    const head = c.map(i => items[i]).sort((a, b) => b.claim_ids.length - a.claim_ids.length)[0];
    for (const i of c) for (const id of items[i].claim_ids) embed[id] = pick(head);
  }
  // Tested clusters: the cluster model names the practice and drops members and claims that do not belong.
  const record = [];
  const multi = clusters.filter(c => c.length > 1), queue = [...multi];
  for (const c of clusters.filter(c => c.length === 1)) for (const id of items[c[0]].claim_ids) tested[id] = pick(items[c[0]]);
  await Promise.all(Array.from({ length: Number(arg('concurrency', 8)) }, async () => {
    while (queue.length) {
      const c = queue.shift(), members = c.map(i => items[i]);
      const user = `Technology class: ${members[0].cls}\nMembers:\n` + members.map((m, k) => `${k}. ${[m.name_en, m.name_zh].filter(Boolean).join(' / ')} (${m.claim_ids.length} claims)\n` +
        m.claim_ids.slice(0, 6).map(id => claims.get(id)).filter(Boolean).map(cl => `   ${cl.id}: ${cl.text_en || cl.statement}`).join('\n')).join('\n') + '\nReturn JSON.';
      const r = await client.call('cluster', { system: CLUSTER_SYSTEM, user, schema: CLUSTER_SCHEMA });
      if (!r.data) { for (const m of members) for (const id of m.claim_ids) tested[id] = pick(m); record.push({ members: members.map(m => m.key), error: 'unparsed' }); continue; }
      const dropM = new Set(r.data.drop_members), dropC = new Set(r.data.drop_claims);
      const kept = members.filter((_, k) => !dropM.has(k));
      for (const m of members) for (const id of m.claim_ids) tested[id] = (kept.includes(m) && !dropC.has(id)) ? pick(m, r.data.name_en, r.data.name_zh) : pick(m);
      record.push({ key: pick(members[0], r.data.name_en, r.data.name_zh).key, name_en: r.data.name_en, name_zh: r.data.name_zh, members: members.map(m => m.key), dropped_members: members.filter((_, k) => dropM.has(k)).map(m => m.key),
        dropped_claims: [...dropC].filter(id => members.some(m => m.claim_ids.includes(id))), reason: r.data.reason, model: r.entry.model, version: CLUSTER_VERSION });
    }
  }));
  const groups = m => new Set(Object.values(m).map(p => p.key)).size;
  writeFileSync(join(store, 'practices-exact.json'), JSON.stringify(exact));
  writeFileSync(join(store, 'practices-embed.json'), JSON.stringify(embed));
  writeFileSync(join(store, 'practices.json'), JSON.stringify(tested));
  writeFileSync(join(store, 'practice-clusters.json'), JSON.stringify({ threshold, embed_model: 'qwen/qwen3-embedding-8b', clusters: record.sort((a, b) => (a.name_en || '').localeCompare(b.name_en || '')) }, null, 1));
  console.log({ items: items.length, threshold, clusters: clusters.length, multi_member: multi.length, practices: { exact: groups(exact), embed: groups(embed), tested: groups(tested) },
    members_dropped: record.reduce((n, r) => n + (r.dropped_members?.length || 0), 0), claims_dropped: record.reduce((n, r) => n + (r.dropped_claims?.length || 0), 0), spent_usd: client.spent });
}
