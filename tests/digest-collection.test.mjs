import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, main, parseArgs, completedWeek, classify, findDate } from '../pipeline/digest.mjs';
import { createClient } from '../pipeline/digest/readers.mjs';
import { emptyState, ingest, recordRun, sourceWindow, assembleIssue, publishIssue, readState, importIssues, writeJson } from '../pipeline/digest/state.mjs';
import { restore } from '../pipeline/digest/restore.mjs';
import { digestHtml } from '../public/site-digest.js';
import { t } from '../public/i18n.js';

const terms = JSON.parse(readFileSync(new URL('../pipeline/digest/terms.json', import.meta.url)));
const registry = JSON.parse(readFileSync(new URL('../pipeline/digest/sources.json', import.meta.url)));
const source = type => structuredClone(registry.sources.find(s => s.access.type === type));
const window = { from: '2026-10-31', to: '2026-11-06' };
const now = new Date('2026-11-07T01:17:00Z');
const env = { WFDATA_APP_KEY: 'fixture-wanfang-key', OPENALEX_API_KEY: 'fixture-openalex-key' };
const run = (src, request, extra = {}) => collect({ sources: [src], terms, ...window, request, env, ...extra });
const epmcRecord = (overrides = {}) => ({ id: '123', source: 'MED', doi: '10.1234/cattle', title: 'Castration and pain in cattle',
  firstPublicationDate: '2026-08-06', firstIndexDate: '2026-11-03', language: 'chi',
  authorList: { author: [{ authorAffiliationDetailsList: { authorAffiliation: [{ affiliation: 'Zhejiang University, China' }] } }] }, ...overrides });
const epmcResponse = (rows, overrides = {}) => JSON.stringify({ hitCount: rows.length, resultList: { result: rows }, ...overrides });
const item = (overrides = {}) => ({ source: 'europepmc-cn', kind: 'paper', provider_id: 'MED:123', doi: '10.1234/cattle',
  title: 'Castration and pain in cattle', url: 'https://doi.org/10.1234/cattle', date: '2026-08-06', indexed_at: '2026-11-03',
  lang: 'en', tier: 'welfare', matched: ['castration', 'cattle'], ...overrides });
function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'digest-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('Europe PMC collects late-indexed papers, retains actual language and follows cursors', async () => {
  let calls = 0;
  const result = await run(source('europepmc'), async (_url, opts) => {
    const body = new URLSearchParams(opts.body);
    assert.match(body.get('query'), /FIRST_IDATE:\[2026-10-31 TO 2026-11-06\]/);
    assert.equal(body.get('resultType'), 'core');
    calls++;
    if (calls === 1) return epmcResponse(Array.from({ length: 100 }, () => epmcRecord()), { hitCount: 101, nextCursorMark: 'page2' });
    assert.equal(body.get('cursorMark'), 'page2');
    return epmcResponse([epmcRecord({ id: '124', doi: '10.1234/pigs', title: 'Animal welfare in pigs' })], { hitCount: 101 });
  });
  assert.equal(calls, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].date, '2026-08-06');
  assert.equal(result.items[0].indexed_at, '2026-11-03');
  assert.equal(result.items[0].lang, 'zh');
  assert.equal(result.items[0].title_lang, 'en');
  assert.equal(result.status[0].in_window, 2);
});

test('malformed API responses and truncated pagination are failures, not empty weeks', async () => {
  for (const type of ['europepmc', 'people-search', 'wanfang', 'openalex']) {
    const result = await run(source(type), async () => JSON.stringify({ error: 'temporarily unavailable' }));
    assert.equal(result.status[0].status, 'failed', type);
    assert.equal(result.items.length, 0);
  }
  const src = source('europepmc'); src.access.max_pages = 1;
  const result = await run(src, async () => epmcResponse([epmcRecord()], { hitCount: 2, nextCursorMark: 'next' }));
  assert.equal(result.status[0].status, 'failed');
  assert.equal(result.items.length, 0);
});

test('missing optional keys skip only that source and key values are redacted', async () => {
  let called = false;
  const result = await run(source('wanfang'), async () => { called = true; }, { env: {} });
  assert.equal(called, false);
  assert.equal(result.status[0].status, 'skipped');
  const failed = await run(source('wanfang'), async () => { throw new Error(env.WFDATA_APP_KEY); });
  assert.ok(!JSON.stringify(failed).includes(env.WFDATA_APP_KEY));
});

test('Wanfang uses the authenticated JSON API, screens China relevance and keeps no abstracts', async () => {
  const result = await run(source('wanfang'), async (url, opts) => {
    assert.ok(url.startsWith('https://'));
    assert.equal(opts.headers['X-App-Key'], env.WFDATA_APP_KEY);
    const body = JSON.parse(opts.body);
    assert.deepEqual(body.collections, ['OpenPeriodical']);
    assert.match(body.query, /PublishYear:\[2024 TO 2026\]/);
    assert.equal(body.start, 0);
    return JSON.stringify({ num_found: 2, documents: [
      { id: 'a1', fields: { Title: ['养殖密度对鱼类福利的影响', 'Fish welfare'], OriginalOrganization: ['浙江大学'], Abstract: ['private abstract'], DOI: '10.1234/fish', PublishDate: '2026-08-01', MetadataOnlineDate: '2026-11-02', Language: 'chi' } },
      { id: 'a2', fields: { Title: ['Animal welfare in pigs'], OriginalOrganization: ['University of Oxford'], Abstract: ['Study in the UK'], PublishDate: '2026-11-01' } }
    ] });
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].china_basis, 'affiliation');
  assert.equal(result.items[0].lang, 'zh');
  const state = emptyState(); ingest(state, result.observations, now.toISOString());
  assert.ok(!JSON.stringify(state).includes('private abstract'));
  assert.ok(!JSON.stringify(state).includes('浙江大学'));
});

test('Wanfang accepts live string counts and continues through all result pages', async () => {
  const starts = [];
  const records = Array.from({ length: 51 }, (_, i) => ({ fields: { Id: `wf${i}`, Title: [`鱼类动物福利研究 ${i}`], OriginalOrganization: ['浙江大学'], PublishDate: '2026-10-01' } }));
  const result = await run(source('wanfang'), async (_url, opts) => {
    const { start, rows } = JSON.parse(opts.body);
    starts.push(start);
    return JSON.stringify({ numFound: '51', documents: records.slice(start, start + rows) });
  });
  assert.equal(result.status[0].status, 'ok');
  assert.equal(result.items.length, 51);
  assert.deepEqual(starts, [0, 50]);
  const empty = await run(source('wanfang'), async () => JSON.stringify({ numFound: '0', documents: [] }));
  assert.equal(empty.status[0].status, 'empty');
});

test('Wanfang rejects invalid counts instead of declaring a successful empty collection', async () => {
  for (const count of [undefined, null, '', ' ', true, false, '2e1', '1.5', 'NaN', '-1', -1, 0.5, '9007199254740992']) {
    const result = await run(source('wanfang'), async () => JSON.stringify({ numFound: count, documents: [] }));
    assert.equal(result.status[0].status, 'failed', String(count));
    assert.equal(result.items.length, 0);
  }
});

test('OpenAlex searches affiliations and China context separately without a language filter', async () => {
  let calls = 0;
  const result = await run(source('openalex'), async (url, opts) => {
    calls++;
    assert.equal(opts.headers.Authorization, `Bearer ${env.OPENALEX_API_KEY}`);
    const params = new URL(url).searchParams;
    assert.equal(params.get('per_page'), '100');
    assert.equal(params.has('search'), false);
    assert.ok(params.get('search.title_and_abstract').includes('animal welfare'));
    assert.equal(params.get('search.title_and_abstract').includes('China OR Chinese'), calls === 2);
    assert.ok(!params.get('filter').includes('language:'));
    assert.ok(!params.get('filter').includes('updated_date'));
    assert.equal(params.get('filter').includes('country_code'), calls === 1);
    return JSON.stringify({ meta: { count: 1, next_cursor: null }, results: [{ id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1234/cattle',
      title: 'Castration and pain in cattle in China', publication_date: '2026-10-01', language: 'en',
      authorships: calls === 1 ? [{ countries: ['CN'] }] : [] }] });
  });
  assert.equal(calls, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].lang, 'en');
});

const oaRecord = (id, date) => ({ id: `https://openalex.org/W${id}`, title: `Animal welfare in pigs in China ${id}`,
  doi: `10.1234/pig${id}`, publication_date: date, language: 'en', authorships: [{ countries: ['CN'] }] });
const oaResponse = (results, count = results.length, next_cursor = null) => JSON.stringify({ meta: { count, next_cursor }, results });

test('OpenAlex splits crowded backfills without losing papers at date boundaries', async () => {
  const src = source('openalex'); src.access.max_pages = 1; src.access.backfill_days = 3;
  const records = Array.from({ length: 101 }, (_, i) => oaRecord(i, i < 50 ? '2026-11-04' : '2026-11-05'));
  const windows = [];
  const result = await run(src, async url => {
    const p = new URL(url).searchParams;
    if (!p.get('filter').includes('country_code')) return oaResponse([]);
    const start = p.get('filter').match(/from_publication_date:([^,]+)/)[1];
    const end = p.get('filter').match(/to_publication_date:([^,]+)/)[1];
    windows.push([start, end]);
    const rows = records.filter(r => r.publication_date >= start && r.publication_date <= end);
    return oaResponse(rows.slice(0, 100), rows.length, rows.length > 100 ? 'next' : null);
  }, { backfill: true });
  assert.equal(result.status[0].status, 'ok');
  assert.equal(result.items.length, 101);
  assert.deepEqual(windows, [['2026-11-03', '2026-11-06'], ['2026-11-03', '2026-11-04'], ['2026-11-05', '2026-11-06']]);
});

test('OpenAlex follows cursors within each date range and rejects broken pagination', async () => {
  const records = Array.from({ length: 101 }, (_, i) => oaRecord(i, '2026-11-05'));
  const cursors = [];
  const result = await run(source('openalex'), async url => {
    const p = new URL(url).searchParams;
    if (!p.get('filter').includes('country_code')) return oaResponse([]);
    const cursor = p.get('cursor'); cursors.push(cursor);
    return cursor === '*' ? oaResponse(records.slice(0, 100), 101, 'next') : oaResponse(records.slice(100), 101);
  });
  assert.equal(result.status[0].status, 'ok');
  assert.equal(result.items.length, 101);
  assert.deepEqual(cursors, ['*', 'next']);
  const failed = await run(source('openalex'), async () => oaResponse([records[0]], 101, '*'));
  assert.equal(failed.status[0].status, 'failed');
  assert.match(failed.status[0].error, /pagination stopped early/);
  assert.equal(failed.items.length, 0);
});

test('OpenAlex fails visibly on a crowded single day or exhausted request budget', async () => {
  const src = source('openalex'); src.access.max_pages = 1; src.access.lookback_days = 0;
  const crowded = await run(src, async () => oaResponse([oaRecord(1, window.to)], 101, 'next'));
  assert.equal(crowded.status[0].status, 'failed');
  assert.match(crowded.status[0].error, /page limit reached for 2026-11-06/);
  assert.equal(crowded.items.length, 0);
  src.access.lookback_days = 3; src.access.max_requests = 1;
  let requests = 0;
  const exhausted = await run(src, async () => { requests++; return oaResponse([oaRecord(1, window.to)], 101, 'next'); });
  assert.equal(requests, 1);
  assert.equal(exhausted.status[0].status, 'failed');
  assert.match(exhausted.status[0].error, /request limit reached/);
  assert.equal(exhausted.items.length, 0);
});

test('People search uses Beijing dates at the boundary and counts unique links', async () => {
  const src = source('people-search'); src.access.keywords = ['动物福利', '福利养殖'];
  const result = await run(src, async () => JSON.stringify({ data: { records: [
    { title: '生猪动物福利新规范', url: 'https://people.cn/1', inputTime: Date.parse('2026-10-30T17:00:00Z') }
  ] } }));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].date, '2026-10-31');
  assert.equal(result.status[0].in_window, 1);
});

test('English matching requires animals and does not match pain inside Spain', () => {
  assert.equal(classify('Pain treatment in humans', terms, 'paper').keep, false);
  assert.equal(classify('Cattle farming in Spain', terms, 'paper').keep, false);
  assert.equal(classify('Heat stress in broilers', terms, 'paper').tier, 'related');
  assert.equal(findDate('2026-02-31'), null);
});

test('persistent identities prevent repeats across providers and weekly issues', () => {
  const state = emptyState();
  ingest(state, [item()], now.toISOString());
  recordRun(state, [{ id: 'europepmc-cn', status: 'ok' }], window.to, now.toISOString());
  const first = assembleIssue(state, registry, { ...window, now: now.toISOString() });
  assert.equal(first.issue.items.length, 1);
  first.selected[0].issued_in = first.issue.id;
  ingest(state, [item({ source: 'openalex-cn', provider_id: 'W1', title: 'Different translated title', url: 'https://openalex.org/W1', doi: 'https://doi.org/10.1234/CATTLE' })], '2026-11-14T01:17:00Z');
  ingest(state, [item({ source: 'openalex-cn', provider_id: 'W1', title: 'Another title', url: 'https://openalex.org/W1', doi: null })], '2026-11-14T01:17:00Z');
  const next = assembleIssue(state, registry, { from: '2026-11-07', to: '2026-11-13', now: '2026-11-14T01:17:00Z' });
  assert.equal(next.issue.items.length, 0);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].first_seen_at, now.toISOString());
});

test('failed sources retain watermarks and late papers retain publication dates', () => {
  const state = emptyState();
  recordRun(state, [{ id: 'europepmc-cn', status: 'ok' }], '2026-11-01', now.toISOString());
  recordRun(state, [{ id: 'europepmc-cn', status: 'failed' }], '2026-11-06', now.toISOString());
  assert.equal(sourceWindow(state, source('europepmc'), '2026-11-07', '2026-11-01').from, '2026-10-30');
  ingest(state, [item()], now.toISOString());
  const { issue } = assembleIssue(state, registry, { ...window, now: now.toISOString() });
  assert.equal(issue.items[0].date, '2026-08-06');
  assert.equal(issue.date_basis, 'discovery');
  assert.equal(issue.partial, true);
});

test('future-dated papers are queued so an old indexing date cannot lose them', async () => {
  const result = await run(source('europepmc'), async () => epmcResponse([epmcRecord({ firstPublicationDate: '2026-11-20' })]));
  assert.equal(result.items.length, 1);
  const state = emptyState(); ingest(state, result.observations, now.toISOString());
  assert.equal(assembleIssue(state, registry, { ...window, now: now.toISOString() }).issue.items.length, 0);
  assert.equal(assembleIssue(state, registry, { from: '2026-11-14', to: '2026-11-20', now: '2026-11-21T01:17:00Z' }).issue.items.length, 1);
});

test('CLI validates dates, completed Beijing weeks, and partial publication', () => {
  assert.deepEqual(completedWeek(now), window);
  assert.deepEqual(completedWeek(new Date('2026-11-06T15:59:00Z')), { from: '2026-10-24', to: '2026-10-30' });
  assert.deepEqual(completedWeek(new Date('2026-11-06T16:00:00Z')), window);
  assert.equal(parseArgs(['--weekly'], now).to, '2026-11-06');
  for (const args of [['--to'], ['--to', '2026-02-31'], ['--to', '2026-11-07'], ['--typo'], ['--only', 'cvma']]) assert.throws(() => parseArgs(args, now));
});

test('all-source failure and dry runs preserve the existing issue and state', async t => {
  const dir = temp(t), out = join(dir, 'out'), statePath = join(dir, 'state.json'), sourcesPath = join(dir, 'sources.json');
  mkdirSync(out);
  const oldIssue = { id: window.to, ...window, generated_at: now.toISOString(), items: [item()], sources: [] };
  writeJson(join(out, `${window.to}.json`), oldIssue);
  writeJson(statePath, emptyState());
  writeJson(sourcesPath, { sources: [source('europepmc')], user_agent: 'test' });
  const beforeState = readFileSync(statePath, 'utf8'), beforeIssue = readFileSync(join(out, `${window.to}.json`), 'utf8');
  const args = ['--sources', sourcesPath, '--out', out, '--state', statePath, '--weekly'];
  await assert.rejects(main(args, { now, request: async () => '{}' }), /no source succeeded/);
  await main([...args, '--dry-run'], { now, request: async () => epmcResponse([epmcRecord()]) });
  assert.equal(readFileSync(statePath, 'utf8'), beforeState);
  assert.equal(readFileSync(join(out, `${window.to}.json`), 'utf8'), beforeIssue);
});

test('daily collection, restart, weekly publication and rerun leave late arrivals queued', async t => {
  const dir = temp(t), out = join(dir, 'out'), statePath = join(dir, 'state.json'), sourcesPath = join(dir, 'sources.json');
  writeJson(sourcesPath, { sources: [source('europepmc')], user_agent: 'test', not_used: [] });
  const args = ['--sources', sourcesPath, '--out', out, '--state', statePath];
  await main([...args, '--collect-only'], { now, request: async () => epmcResponse([epmcRecord()]) });
  assert.equal(existsSync(out), false);
  await main([...args, '--weekly', '--publish-only'], { now });
  const bytes = readFileSync(join(out, `${window.to}.json`), 'utf8');
  assert.equal(JSON.parse(bytes).items.length, 1);
  await main([...args, '--collect-only'], { now, request: async () => epmcResponse([epmcRecord({ id: '999', doi: '10.1234/new', title: 'Pig welfare in China' })]) });
  await main([...args, '--weekly', '--publish-only'], { now });
  assert.equal(readFileSync(join(out, `${window.to}.json`), 'utf8'), bytes);
  assert.equal(readState(statePath).records.filter(r => !r.issued_in).length, 1);
  assert.throws(() => publishIssue(out, JSON.parse(bytes), []), /refusing to overwrite/);
});

test('restore carries pending issues across unmerged PRs and respects edited main issues', t => {
  const root = temp(t), snapshot = join(root, 'snapshot'), checkout = join(root, 'checkout');
  writeJson(join(snapshot, 'pipeline/digest/state.json'), emptyState());
  const old = { id: window.to, ...window, items: [item()] };
  writeJson(join(snapshot, `public/data/digest/${window.to}.json`), old);
  writeJson(join(checkout, `public/data/digest/${window.to}.json`), { ...old, items: [] });
  writeJson(join(snapshot, 'public/data/digest/2026-11-13.json'), { ...old, id: '2026-11-13', to: '2026-11-13' });
  restore(snapshot, checkout);
  assert.equal(JSON.parse(readFileSync(join(checkout, `public/data/digest/${window.to}.json`))).items.length, 0);
  assert.equal(JSON.parse(readFileSync(join(checkout, 'public/data/digest/index.json'))).issues.length, 2);
  const state = readState(join(checkout, 'pipeline/digest/state.json'));
  importIssues(state, join(checkout, 'public/data/digest'));
  assert.equal(state.records[0].issued_in, '2026-11-13');
});

test('HTTP client retries throttling, rejects missing auth without retry, and prevents credential redirects', async () => {
  let calls = 0; const delays = [];
  const request = createClient({ interval: 0, pause: async ms => delays.push(ms), fetchImpl: async (_url, opts) => {
    assert.equal(opts.redirect, 'error'); calls++;
    return calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': '2' } }) : new Response('{}');
  } });
  assert.equal(await request('https://api.example.test', { headers: { 'X-App-Key': 'key' } }), '{}');
  assert.equal(calls, 2); assert.ok(delays.includes(2000));
  await assert.rejects(request('http://api.example.test', { headers: { 'X-App-Key': 'key' } }), /HTTPS/);
  calls = 0;
  const unauthorized = createClient({ interval: 0, pause: async () => {}, fetchImpl: async () => { calls++; return new Response('', { status: 401 }); } });
  await assert.rejects(unauthorized('https://api.example.test'), /HTTP 401/);
  assert.equal(calls, 1);
});

test('digest renders publication and discovery dates and skipped sources in both languages', () => {
  const issue = { id: window.to, ...window, date_basis: 'discovery', partial: true, items: [item({ first_seen_at: now.toISOString(), china_basis: 'affiliation', title_lang: 'en' })],
    sources: [{ id: 'europepmc-cn', kind: 'paper', name_zh: '论文', name_en: 'Papers', status: 'skipped' }] };
  for (const lang of ['en', 'zh']) {
    const html = digestHtml({ issues: [] }, issue, { lang, tr: (k, v) => t(lang, k, v), link: x => '#/' + x });
    assert.ok(!/undefined|NaN|Invalid Date|dg\.[a-z]/.test(html));
    assert.ok(html.includes('lang="en"'));
    assert.ok(html.includes(t(lang, 'dg.partial')));
  }
});
