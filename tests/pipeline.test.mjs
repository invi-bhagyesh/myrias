import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalise, checkQuote, bigramOverlap } from '../pipeline/quote.mjs';
import { CONFIG, stageSetting, createClient, estimateCost, SpendCapError } from '../pipeline/llm.mjs';
import { scorePassage, summarise, runModel } from '../pipeline/bakeoff.mjs';
import { EXTRACT_SCHEMA } from '../pipeline/prompts.mjs';

test('config: every profile sets every stage, models look like provider/name, prices known', () => {
  for (const [name, p] of Object.entries(CONFIG.profiles)) {
    for (const stage of CONFIG.stages) {
      assert.ok(p[stage], `${name}.${stage}`);
      assert.match(p[stage].model, /^[a-z0-9-]+\/[a-z0-9._-]+$/i);
      assert.ok(CONFIG.prices[p[stage].model], `price for ${p[stage].model}`);
    }
  }
  assert.equal(CONFIG.provider.data_collection, 'deny');
});

test('config: the verifier is never the same model as the extractor', () => {
  for (const [name, p] of Object.entries(CONFIG.profiles)) assert.notEqual(p.verify.model, p.extract.model, name);
});

test('stageSetting: profile switch and unknown names', () => {
  assert.equal(stageSetting('extract', 'demo').profile, 'demo');
  assert.notEqual(stageSetting('extract', 'demo').model, stageSetting('extract', 'full').model);
  assert.throws(() => stageSetting('extract', 'nope'));
  assert.throws(() => stageSetting('nope', 'demo'));
});

test('quote check: spacing, width, the full-stop glyph, and failures', () => {
  const page = '循环水养殖系统可降低氨氮浓度⒚ 鳜鱼的应激反应下降。\nWater quality improved.';
  assert.ok(checkQuote('循环水养殖系统可降低氨氮浓度。', page).ok);
  assert.ok(checkQuote('鳜鱼的应激 反应下降。', page).ok);
  assert.ok(checkQuote('water QUALITY improved', page).ok);
  assert.equal(checkQuote('', page).reason, 'empty');
  assert.equal(checkQuote('短', page).reason, 'too_short');
  assert.equal(checkQuote('循环水养殖系统可提高氨氮浓度。', page).reason, 'not_on_page');
  assert.equal(normalise('Ａ－Ｂ'), 'a-b');
});

test('bigram overlap', () => {
  assert.equal(bigramOverlap('abcdef', 'abcdef'), 1);
  assert.ok(bigramOverlap('abcdef', 'abcdxx') < 0.8);
  assert.ok(bigramOverlap('循环水养殖系统可降低氨氮浓度', '循环水养殖系统可降低氨氮浓度。') > 0.9);
});

const okFetch = (content, cost = 0.001) => async () => ({ ok: true, status: 200, json: async () => ({ model: 'm/x', choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost } }) });

test('client: needs a cap, logs fields, never logs the key, parses JSON schema output', async () => {
  assert.throws(() => createClient({ apiKey: 'k' }), /capUsd/);
  const calls = [];
  const client = createClient({ apiKey: 'sk-secret', capUsd: 1, fetchImpl: async (u, o) => { calls.push({ u, o }); return okFetch('{"claims":[]}')(); } });
  const out = await client.call('extract', { user: 'hi', schema: EXTRACT_SCHEMA });
  assert.deepEqual(out.data, { claims: [] });
  assert.equal(client.spent, 0.001);
  const body = JSON.parse(calls[0].o.body);
  assert.equal(body.provider.data_collection, 'deny');
  assert.equal(body.response_format.type, 'json_schema');
  assert.ok(!JSON.stringify(out.entry).includes('sk-secret'));
  assert.equal(out.entry.stage, 'extract');
});

test('client: stops before a call that would break the cap, and without a key', async () => {
  const client = createClient({ apiKey: 'k', capUsd: 0.0001, fetchImpl: okFetch('x') });
  await assert.rejects(client.call('extract', { user: 'x'.repeat(30000), maxTokens: 4000, model: 'qwen/qwen3.8-max-0902' }), SpendCapError);
  const noKey = createClient({ apiKey: '', capUsd: 1, fetchImpl: okFetch('x') });
  await assert.rejects(noKey.call('extract', { user: 'x' }), /OPENROUTER_API_KEY/);
  assert.ok(estimateCost('qwen/qwen3.8-flash', 3000, 1000) > 0);
});

test('bakeoff scoring: fabricated quotes are caught, recall counted', async () => {
  const gold = { id: 'g', text: '循环水养殖系统可降低氨氮浓度。鳜鱼的应激反应下降明显。', claims: [{ quote: '循环水养殖系统可降低氨氮浓度。' }, { quote: '鳜鱼的应激反应下降明显。' }] };
  const s = scorePassage(gold, [{ quote: '循环水养殖系统可降低氨氮浓度。' }, { quote: '这句话页面上并不存在的内容。' }]);
  assert.deepEqual(s, { returned: 2, valid: 1, gold: 2, found: 1 });
  const sum = summarise([s]);
  assert.equal(sum.valid_quote_rate, 0.5); assert.equal(sum.recall, 0.5);
  const client = createClient({ apiKey: 'k', capUsd: 1, fetchImpl: okFetch(JSON.stringify({ claims: [{ quote: '循环水养殖系统可降低氨氮浓度。', statement_en: 'x' }] })) });
  const r = await runModel('qwen/qwen3.8-flash', [gold], client);
  assert.equal(r.valid_quote_rate, 1); assert.equal(r.recall, 0.5); assert.equal(r.parse_failures, 0);
});

test('no API key or secrets in the pipeline files', () => {
  for (const f of ['llm.mjs', 'models.json', 'bakeoff.mjs', 'prompts.mjs']) assert.ok(!/sk-or-|sk-[a-z0-9]{20}/i.test(readFileSync(new URL('../pipeline/' + f, import.meta.url), 'utf8')), f);
});

import { groupClaims, cleanSuggestions } from '../pipeline/suggest.mjs';
import { validateExport } from '../public/site-lib.js';

test('client: falls back to the next model after repeated rate limits, and records who answered', async () => {
  const seen = [];
  const fetchImpl = async (u, o) => { const b = JSON.parse(o.body); seen.push(b.model); return b.model === 'qwen/qwen3.8-flash' ? { ok: false, status: 429, json: async () => ({ error: { message: 'Provider returned error' } }) } : okFetch('{"claims":[]}')(); };
  const client = createClient({ apiKey: 'k', capUsd: 1, fetchImpl, retryMs: 1, retries: 1 });
  const out = await client.call('extract', { user: 'x', schema: EXTRACT_SCHEMA });
  assert.deepEqual(seen, ['qwen/qwen3.8-flash', 'qwen/qwen3.8-flash', 'deepseek/deepseek-v4.1-flash']);
  assert.equal(out.entry.requested_model, 'qwen/qwen3.8-flash');
});

test('suggestions: only quote-checked claims, cited ids must exist, no rank', () => {
  const g = groupClaims([{ quote_check: 'found', intervention: 'RAS', statement_en: 'a' }, { quote_check: 'not_on_page', intervention: 'RAS', statement_en: 'b' }, { quote_check: 'found', intervention: '', statement_en: 'c' }]);
  assert.equal(g.get('ras').length, 1);
  assert.equal(cleanSuggestions([{ claim_ids: ['c0'] }, { claim_ids: ['zz'] }, { claim_ids: [] }], g.get('ras')).length, 1);
});

test('site validator: suggestions need real claims, an evidence gap, and review in a real release', async () => {
  const sample = JSON.parse(readFileSync(new URL('../public/data/sample.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateExport(sample), []);
  const bad = structuredClone(sample); bad.suggestions[0].claim_ids = ['nope']; bad.suggestions[0].rank = 1;
  assert.ok(validateExport(bad).some(e => /unknown claim/.test(e)) && validateExport(bad).some(e => /not ranked/.test(e)));
  const real = structuredClone(sample); real.release.sample = false; real.claims.forEach(c => { c.verification = 'supported'; });
  assert.ok(validateExport(real).some(e => /draft suggestions must not be published/.test(e)));
});

import { runClaimStage } from '../pipeline/claimstage.mjs';
test('claim stage: only quote-checked claims are sent, results attached with the model', async () => {
  const sent = [];
  const fetchImpl = async (u, o) => { sent.push(JSON.parse(o.body)); return okFetch('{"verdict":"supported","note":"x"}')(); };
  const client = createClient({ apiKey: 'k', capUsd: 1, fetchImpl });
  const { out } = await runClaimStage('verify', [{ quote: 'a', statement_en: 's', quote_check: 'found' }, { quote: 'b', statement_en: 't', quote_check: 'not_on_page' }], client, 2);
  assert.equal(sent.length, 1);
  assert.equal(out[0].verify.verdict, 'supported');
  assert.equal(out[1].verify, undefined);
});

test('suggestions skip claims judged irrelevant or unsupported when those stages ran', () => {
  const base = { quote_check: 'found', intervention: 'RAS', statement_en: 'a' };
  const g = groupClaims([{ ...base, map: { welfare_relevant: true }, verify: { verdict: 'supported' } }, { ...base, map: { welfare_relevant: false } }, { ...base, verify: { verdict: 'partial' } }]);
  assert.equal([...g.values()].flat().length, 1);
});

import { buildRelease } from '../pipeline/export.mjs';
test('export: only relevant, quote-checked, supported claims; valid against the site validator; no suggestions', () => {
  const base = JSON.parse(readFileSync(new URL('../public/data/release.json', import.meta.url), 'utf8'));
  const mk = (over = {}) => ({ source: '题目_作者.pdf', page: 1, quote: '循环水养殖系统可降低氨氮浓度。', statement_en: 'RAS lowers ammonia.', intervention: 'RAS', quote_check: 'found', map: { welfare_relevant: true, technology_class: 'water_systems', welfare_problem: 'water_quality', kind: 'measured', welfare_link: 'proxy', outcome_evidence: 'proxy_improved', reason: 'r' }, verify: { verdict: 'supported' }, ...over });
  const rel = buildRelease({ claims: [mk(), mk({ quote_check: 'not_on_page' }), mk({ verify: { verdict: 'unsupported' } }), mk({ map: { welfare_relevant: false } })], base });
  assert.deepEqual(validateExport(rel), []);
  assert.equal(rel.claims.length, 1);
  assert.equal(rel.applications.length, 1);
  assert.equal(rel.release.sample, false);
  assert.ok(!('suggestions' in rel));
  assert.equal(rel.cells_status.length, 48);
});

import { windows, locatePage, mergeOverlaps } from '../pipeline/chunk.mjs';
import { dedupSources } from '../pipeline/dedup.mjs';
import { recall, taskId } from '../pipeline/run.mjs';
import { estimateTokens } from '../pipeline/llm.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync as wf } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('windows overlap, cover every page, and a quote across a page break is located to its first page', () => {
  const pages = [{ page: 1, text: 'a'.repeat(1500) + '鳜鱼驯化' }, { page: 2, text: '成功率高。' + 'b'.repeat(1500) }];
  const w = windows(pages, { size: 1000, overlap: 200 });
  assert.ok(w.length >= 3);
  assert.equal(w[0].page_start, 1); assert.equal(w.at(-1).page_end, 2);
  for (let i = 1; i < w.length; i++) assert.ok(w[i - 1].text.endsWith(w[i].text.slice(0, 200)));
  assert.equal(locatePage('鳜鱼驯化成功率高。', pages), 1);
  assert.equal(locatePage('成功率高', pages), 2);
  assert.equal(locatePage('不存在的句子', pages), null);
});

test('overlap duplicates merge to the longer quote, per source', () => {
  const m = mergeOverlaps([{ source: 'a', quote: '鳜鱼驯化成功' }, { source: 'a', quote: '鳜鱼驯化成功率高' }, { source: 'b', quote: '鳜鱼驯化成功' }]);
  assert.equal(m.length, 2);
  assert.equal(m.find(c => c.source === 'a').quote, '鳜鱼驯化成功率高');
});

test('stage 0 drops the same text or the same title and says why', () => {
  const r = dedupSources([
    { source: '鳜鱼驯化_张三.pdf', page: 1, text: '正文一' }, { source: '鳜鱼驯化_张三 (1).pdf', page: 1, text: '正文一' },
    { source: '鳜鱼驯化_李四.pdf', page: 1, text: '不同正文' }, { source: '其他论文_王五.pdf', page: 1, text: '正文二' }]);
  assert.deepEqual(r.kept, ['鳜鱼驯化_张三.pdf', '其他论文_王五.pdf']);
  assert.deepEqual(r.dropped.map(d => d.reason).sort(), ['same_text', 'same_title']);
});

test('budget reservation: concurrent calls can never pass the cap', async () => {
  let inFlight = 0, maxInFlight = 0;
  const fetchImpl = async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise(r => setTimeout(r, 5)); inFlight--; return okFetch('{"claims":[]}', 0.0001)(); };
  const client = createClient({ apiKey: 'k', capUsd: 0.01, fetchImpl });
  const one = () => client.call('extract', { user: '鳜'.repeat(100), schema: EXTRACT_SCHEMA, maxTokens: 2000 });
  const results = await Promise.allSettled(Array.from({ length: 20 }, one));
  const ok = results.filter(r => r.status === 'fulfilled').length;
  assert.ok(ok > 0 && ok < 20, String(ok));
  assert.ok(results.some(r => r.status === 'rejected' && r.reason instanceof SpendCapError));
  assert.ok(client.spent <= 0.01);
  assert.equal(client.reserved, 0);
  assert.ok(estimateTokens('鳜鱼') > estimateTokens('ab'));
});

test('extract schema keeps the quote and separates basis, polarity and candidate status', () => {
  const item = EXTRACT_SCHEMA.properties.claims.items;
  for (const k of ['quote', 'basis', 'polarity', 'candidate_status', 'intervention_key', 'counterevidence', 'limitations']) assert.ok(item.required.includes(k), k);
  assert.ok(item.properties.polarity.enum.includes('null'));
});

test('recall and stable task ids', () => {
  assert.equal(recall([{ source: 'a', quote: '鳜鱼驯化成功率高' }], [{ source: 'a', quote: '鳜鱼驯化成功率高' }, { source: 'a', quote: '完全不同的一句' }]), 0.5);
  assert.equal(recall([], []), null);
  const w = { index: 0, text: 'x' };
  assert.equal(taskId('s', w, 'h'), taskId('s', w, 'h'));
  assert.notEqual(taskId('s', w, 'h'), taskId('s', w, 'h2'));
});

test('run end to end with a fake model: dedup, windows, quote check, resume without new calls, refuse mixed settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myrias-run-'));
  const pagesFile = join(dir, 'pages.jsonl'), gold = join(dir, 'gold.jsonl'), out = join(dir, 'out');
  const text = '鳜鱼经条件反射驯化后可摄食人工饲料。' + '其后逐渐增加配合饲料比例，摄食情况良好。'.repeat(200);
  wf(pagesFile, [{ source: '驯化_甲.pdf', page: 1, text }, { source: '驯化_甲 (1).pdf', page: 1, text }].map(x => JSON.stringify(x)).join('\n'));
  wf(gold, JSON.stringify({ source: '驯化_甲.pdf', quote: '鳜鱼经条件反射驯化后可摄食人工饲料。' }) + '\n');
  const env = { ...process.env, OPENROUTER_API_KEY: 'test' };
  const run = (...extra) => spawnSync(process.execPath, ['--import', './tests/fixtures/fake-openrouter.mjs', 'pipeline/run.mjs', '--pages', pagesFile, '--out', out, '--cap', '0.5', '--gold', gold, '--min-recall', '0.9', ...extra], { env, encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const s1 = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
  assert.equal(s1.duplicates_dropped, 1);
  assert.ok(s1.windows > 1);
  assert.equal(s1.tasks_done, s1.windows);
  assert.ok(s1.quote_found >= 1 && s1.quote_found < s1.claims_after_merge);
  assert.equal(s1.gate, 'pass');
  const calls1 = readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').length;
  const second = run();
  assert.equal(second.status, 0);
  assert.equal(readFileSync(join(out, 'calls.jsonl'), 'utf8').trim().split('\n').length, calls1);
  const mixed = run('--window', '900');
  assert.equal(mixed.status, 2);
});
