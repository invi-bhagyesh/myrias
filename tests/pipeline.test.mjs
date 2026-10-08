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
