import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as L from '../public/site-lib.js';
import { STR, t } from '../public/i18n.js';
import { pixelHills, columns } from '../public/site-art.js';
import { buildGraph, placeholderGraph, simplifyGraph, layoutGraph, shortLabel, legendHtml, MIN_REAL_CLAIMS } from '../public/site-graph.js';
import { speciesModel, speciesSteps, speciesPageHtml, PROFILES } from '../public/site-species.js';

const read = name => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
// The pre-release export with no records, kept as a fixture; the live release.json now holds real claims.
const release = JSON.parse(readFileSync(new URL('./empty-release.json', import.meta.url), 'utf8'));
const live = (r => ({ ...r, ...(r.claim_files ? { claims: r.claim_files.flatMap(f => read(f)) } : {}), ...(r.finding_files ? { findings: r.finding_files.flatMap(f => read(f)) } : {}), ...(r.action_files ? { actions: r.action_files.flatMap(f => read(f)) } : {}) }))(read('release.json'));
const sample = read('sample.json');
const clone = x => structuredClone(x);

test('release export is valid and not marked as sample', () => {
  assert.deepEqual(L.validateExport(release), []);
  assert.equal(release.release.sample, false);
});

test('release contains no records that are not verified', () => {
  for (const c of release.claims) assert.ok(L.PUBLIC_VERIFICATION.includes(c.verification), c.id);
});

test('sample export is valid, flagged, and every record is visibly a placeholder', () => {
  assert.deepEqual(L.validateExport(sample), []);
  assert.equal(sample.release.sample, true);
  const marked = s => /^\[Sample\]|^【示例】/.test(s);
  for (const s of sample.sources) assert.ok(marked(s.title), s.id);
  for (const c of sample.claims) { assert.ok(marked(c.quote), c.id); assert.ok(marked(c.text_en), c.id); }
  for (const s of sample.species) assert.ok(marked(s.common_en), s.id);
});

test('validation rejects unsupported claims in a real release but allows them in a sample', () => {
  const bad = clone(sample); bad.release.sample = false; bad.claims[0].verification = 'unsupported';
  assert.ok(L.validateExport(bad).some(e => e.includes('must not be published')));
  const ok = clone(sample); ok.claims[0].verification = 'unsupported';
  assert.deepEqual(L.validateExport(ok), []);
});

test('validation rejects missing locators, quotes and dangling references', () => {
  let d = clone(sample); delete d.claims[0].locator;
  assert.ok(L.validateExport(d).some(e => e.includes('missing locator')));
  d = clone(sample); d.claims[0].quote = '';
  assert.ok(L.validateExport(d).some(e => e.includes('missing quote')));
  d = clone(sample); d.claims[0].source_id = 'nope';
  assert.ok(L.validateExport(d).some(e => e.includes('unknown source')));
  d = clone(sample); d.applications[0].claim_ids = ['nope'];
  assert.ok(L.validateExport(d).some(e => e.includes('unknown claim')));
  d = clone(sample); d.applications[0].claim_ids = [];
  assert.ok(L.validateExport(d).some(e => e.includes('at least one claim')));
});

test('validation refuses full text and over-long quotes, and duplicate ids', () => {
  let d = clone(sample); d.sources[0].fulltext = 'x';
  assert.ok(L.validateExport(d).some(e => e.includes('full text must not be published')));
  d = clone(sample); d.claims[0].quote = 'x'.repeat(601);
  assert.ok(L.validateExport(d).some(e => e.includes('longer than 600')));
  d = clone(sample); d.claims[1].id = d.claims[0].id;
  assert.ok(L.validateExport(d).some(e => e.includes('duplicate id')));
});

test('matrix cells are never silently blank', () => {
  const all = L.buildMatrix(sample, 'all');
  const cell = (m, p, c) => m.rows.find(r => r.problem.id === p).cells.find(x => x.class_id === c);
  assert.equal(cell(all, 'feeding', 'feeds').status, 'has_records');
  assert.equal(cell(all, 'feeding', 'feeds').applications.length, 1);
  assert.equal(cell(all, 'stunning_slaughter', 'stunning_equipment').status, 'probed_empty');
  assert.equal(cell(all, 'water_quality', 'monitoring').status, 'not_collected');
  const shrimp = L.buildMatrix(sample, 'sample-shrimp');
  assert.equal(cell(shrimp, 'feeding', 'feeds').status, 'not_collected');
  for (const row of all.rows) for (const c of row.cells) assert.ok(L.CELL_STATUS.includes(c.status));
  const none = L.buildMatrix(release, 'all');
  assert.ok(none.rows.every(r => r.cells.every(c => c.status === 'not_collected')));
});

test('a cell is probed_empty only when every selected species was probed', () => {
  const d = clone(sample);
  d.cells_status = d.cells_status.filter(x => x.species_id === 'sample-fish');
  const m = L.buildMatrix(d, 'all');
  assert.equal(m.rows.find(r => r.problem.id === 'stunning_slaughter').cells.find(c => c.class_id === 'stunning_equipment').status, 'not_collected');
});

test('CSV escaping and BOM', () => {
  const csv = L.toCSV([{ a: 'x,y', b: 'say "hi"', c: 'line\nbreak', d: null, e: '鳜鱼' }], ['a', 'b', 'c', 'd', 'e']);
  assert.ok(csv.startsWith('﻿a,b,c,d,e\r\n'));
  assert.ok(csv.includes('"x,y","say ""hi""","line\nbreak",,鳜鱼'));
});

test('claim rows carry locator, quote and verification', () => {
  const row = L.claimRow(sample.claims[0], sample);
  assert.equal(row.page, 3); assert.equal(row.char_start, 120); assert.ok(row.quote); assert.equal(row.verification, 'supported');
});

test('helpers: pick, locator, percent, urls, escaping', () => {
  assert.equal(L.pick({ common_en: 'A', common_zh: '甲' }, 'common', 'zh'), '甲');
  assert.equal(L.pick({ common_en: 'A' }, 'common', 'zh'), 'A');
  assert.equal(L.pick({ en: 'A', zh: '甲' }, '', 'zh'), '甲');
  assert.equal(L.pick({ en: 'A' }, '', 'zh'), 'A');
  assert.equal(L.formatLocator({ page: 2, start: 5, end: 9 }), 'p. 2 · chars 5–9');
  assert.equal(L.formatPercent(0.9123), '91.2%');
  assert.equal(L.formatPercent(null), '—');
  assert.equal(L.safeUrl('javascript:alert(1)'), '');
  assert.equal(L.safeUrl('https://example.org/x'), 'https://example.org/x');
  assert.equal(L.escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('English and Chinese strings stay in sync', () => {
  const en = Object.keys(STR.en).sort(), zh = Object.keys(STR.zh).sort();
  assert.deepEqual(zh, en);
  const placeholders = s => (typeof s === 'string' ? (s.match(/\{\w+\}/g) || []).sort() : []);
  for (const k of en) {
    if (Array.isArray(STR.en[k])) { assert.ok(Array.isArray(STR.zh[k]), k); assert.equal(STR.zh[k].length, STR.en[k].length, k); }
    else assert.deepEqual(placeholders(STR.zh[k]), placeholders(STR.en[k]), k);
    assert.ok(STR.zh[k] !== '' && STR.en[k] !== '', k);
  }
  assert.equal(t('zh', 'nope.key'), 'nope.key');
  assert.equal(t('en', 'sp.cells.line', { has: 1, empty: 2, not: 3 }), '1 with records, 2 searched and empty, 3 not searched yet.');
});

test('every i18n key used in index.html exists', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length >= 4);
  for (const k of keys) assert.ok(k in STR.en, k);
});

test('taxonomy has English and Chinese labels for every entry', () => {
  for (const data of [release, sample]) for (const list of Object.values(data.taxonomy).filter(Array.isArray)) {
    for (const x of list) { assert.ok(x.en, x.id); assert.ok(x.zh, x.id); }
  }
});

test('the public folder contains no PDFs or large files', () => {
  const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const p of walk(new URL('../public', import.meta.url).pathname)) {
    assert.ok(!/\.(pdf|docx?|epub)$/i.test(p), p);
    assert.ok(statSync(p).size < 400_000, `${p} is large`);
  }
});

test('pixel landscape is deterministic, decorative and merges equal-height columns', () => {
  const a = pixelHills('hero', 'hero-hills'), b = pixelHills('hero', 'hero-hills');
  assert.equal(a, b);
  assert.ok(a.startsWith('<svg class="pixel-hills pixel-hills-hero hero-hills"'));
  assert.ok(a.includes('aria-hidden="true"') && a.includes('shape-rendering="crispEdges"'));
  assert.ok(pixelHills('footer').includes('pixel-hills-footer'));
  const runs = columns(() => 10);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].w, 240);
  const stepped = columns(x => (x < 100 ? 5 : 20));
  assert.deepEqual(stepped.map(r => [r.x, r.w, r.y]), [[0, 100, 5], [100, 140, 20]]);
});

test('every id used by the overview contents list is a section the page defines', () => {
  const src = readFileSync(new URL('../public/site.js', import.meta.url), 'utf8');
  const ids = [...src.matchAll(/\['(\w+)', '[\w.]+'\]/g)].map(m => m[1]).filter(id => ['numbers', 'how', 'map', 'rely', 'help'].includes(id));
  assert.deepEqual(ids, ['numbers', 'how', 'map', 'rely', 'help']);
  for (const id of ids) assert.ok(src.includes(`id="${id}"`), id);
});

test('graph: the empty release draws only the frame, every combination unsearched', () => {
  const g = buildGraph(release, 'en');
  assert.equal(g.nodes.length, 7 + 7 + 1);
  assert.equal(g.edges.length, 49);
  assert.ok(g.edges.every(e => e.kind === 'cell' && e.status === 'not_collected'));
  assert.ok(!g.nodes.some(n => ['claim', 'source', 'application'].includes(n.type)));
});

test('graph: sample data adds applications, claims and sources, and every edge resolves', () => {
  const g = buildGraph(sample, 'en', (path, q) => '#/' + path);
  const count = type => g.nodes.filter(n => n.type === type).length;
  assert.equal(count('application'), sample.applications.length);
  assert.equal(count('claim'), sample.claims.length);
  assert.equal(count('source'), sample.sources.length);
  for (const e of g.edges) { assert.ok(g.byId.has(e.a), e.a); assert.ok(g.byId.has(e.b), e.b); }
  assert.ok(g.edges.some(e => e.kind === 'cell' && e.status === 'has_records'));
  assert.ok(g.nodes.every(n => n.href.startsWith('#/')));
  assert.ok(g.nodes.filter(n => n.type === 'claim').every(n => n.degree >= 1));
});

test('graph layout is deterministic, bounded, and puts technologies left of problems', () => {
  const run = () => layoutGraph(buildGraph(sample, 'en')).nodes.map(n => [n.x.toFixed(6), n.y.toFixed(6)]);
  assert.deepEqual(run(), run());
  const g = layoutGraph(buildGraph(sample, 'en'));
  for (const n of g.nodes) { assert.ok(n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1, n.id); }
  const mean = type => { const xs = g.nodes.filter(n => n.type === type).map(n => n.x); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  assert.ok(mean('class') < mean('problem'));
});

test('graph labels and legend', () => {
  assert.equal(shortLabel('Monitoring (cameras, acoustics, sensors)'), 'Monitoring');
  assert.equal(shortLabel('监测（摄像、声学、传感器）'), '监测');
  const g = buildGraph(release, 'zh');
  const html = legendHtml(g, k => `<${k}>`);
  assert.ok(html.includes('&lt;graph.legend.problems&gt;'));
  assert.ok(!html.includes('<graph.legend'));
  assert.equal(g.legend.filter(l => l.key === 'source').length, 0);
});

test('placeholder graph: dense, deterministic, labelled, bounded, and links nowhere invented', () => {
  const run = () => layoutGraph(placeholderGraph(release, 'en'));
  const g = run();
  assert.ok(g.nodes.length > 1000, String(g.nodes.length));
  assert.ok(g.edges.length > g.nodes.length);
  assert.equal(g.placeholder, true);
  assert.equal(g.mode, 'radial');
  assert.deepEqual(run().nodes.map(n => [n.x.toFixed(5), n.y.toFixed(5)]), g.nodes.map(n => [n.x.toFixed(5), n.y.toFixed(5)]));
  for (const n of g.nodes) assert.ok(n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1, n.id);
  for (const e of g.edges) { assert.ok(g.byId.has(e.a), e.a); assert.ok(g.byId.has(e.b), e.b); }
  const invented = g.nodes.filter(n => !['class', 'problem'].includes(n.type));
  assert.ok(invented.every(n => n.href === null));
  assert.ok(!g.nodes.some(n => n.id === 's:mandarin-fish'));
  assert.ok(placeholderGraph(release, 'zh').nodes.filter(n => n.type === 'claim').every(n => n.href === null));
});

test('the placeholder is used only below the real-claim threshold', () => {
  assert.equal(MIN_REAL_CLAIMS, 50);
  assert.ok(release.claims.length < MIN_REAL_CLAIMS);
});

test('simple view keeps hubs and applications only, with resolvable edges', () => {
  const full = placeholderGraph(release, 'en');
  const g = layoutGraph(simplifyGraph(full));
  assert.ok(g.nodes.length < full.nodes.length / 5);
  assert.ok(g.nodes.every(n => ['class', 'problem', 'species', 'application'].includes(n.type)));
  for (const e of g.edges) { assert.ok(g.byId.has(e.a) && g.byId.has(e.b)); assert.notEqual(e.kind, 'cross'); }
  assert.ok(!g.legend.some(l => l.key === 'source'));
  assert.equal(full.nodes.filter(n => n.type === 'claim').length > 1000, true);
});

test('the live release validates, is not a sample, and has enough claims for the real graph', () => {
  assert.deepEqual(L.validateExport(live), []);
  assert.equal(live.release.sample, false);
  assert.ok(live.claims.length >= MIN_REAL_CLAIMS);
  assert.ok(live.claims.every(c => ['supported', 'partial'].includes(c.verification) && c.quote.length <= 600 && c.locator.page));
  assert.ok(live.claims.every(c => c.audit === 'not_audited'));
  assert.ok(!('suggestions' in live));
  const g = layoutGraph(buildGraph(live, 'en'));
  assert.ok(g.nodes.some(n => n.type === 'claim'));
});

import { STEP_TEXT, LANES, PHASE_TEXT, pipelineHtml } from '../public/site-pipeline.js';
test('pipeline page: every step is bilingual, models match the demo profile, the example is followed through every step', () => {
  const P = read('pipeline.json');
  const cfg = JSON.parse(readFileSync(new URL('../pipeline/models.json', import.meta.url), 'utf8')).profiles.demo;
  for (const st of P.steps) {
    const t = STEP_TEXT[st.key];
    assert.ok(t, st.key);
    for (const f of ['name', 'what', 'how']) assert.ok(t[f][0] && t[f][1], `${st.key}.${f}`);
    assert.ok(LANES.some(([id]) => id === st.lane), st.lane);
    if (st.model) assert.equal(st.model, cfg[{ render: 'translate' }[st.key] || st.key].model, st.key);
  }
  for (const [id] of LANES) assert.ok(PHASE_TEXT[id][0] && PHASE_TEXT[id][1]);
  const live = read('release.json');
  const tx = (kind, id) => (live.taxonomy[kind].find(x => x.id === id) || {}).en || id;
  for (const lang of ['en', 'zh']) {
    const html = pipelineHtml(P, { lang, tr: (k, v) => t(lang, k, v), link: p => '#/' + p, taxonomyLabel: tx });
    assert.equal((html.match(/data-step="/g) || []).length, P.steps.length);
    // A value that failed to render, not the English word inside a model's sentence.
    assert.ok(!/[>"(]undefined|undefined[<")]|\bNaN\b|\[object/.test(html), lang);
    assert.ok(html.includes(P.example.claim_id) && html.includes(P.example.findings.id) && html.includes(P.example.actions.id));
  }
  // The example is a released claim, and the finding and action it shows really contain it.
  const claims = live.claim_files.flatMap(f => read(f)), findings = live.finding_files.flatMap(f => read(f)), actions = live.action_files.flatMap(f => read(f));
  const c = claims.find(x => x.id === P.example.claim_id);
  assert.ok(c && c.quote === P.example.extract.quote && c.locator.page === P.example.prepare.page);
  assert.ok(findings.find(f => f.id === P.example.findings.id).claim_ids.includes(c.id));
  assert.ok(actions.find(a => a.id === P.example.actions.id).finding_ids.includes(P.example.findings.id));
});

test('evidence map: every intervention is placed, empty classes and problems stay on the map', async () => {
  const esc = L.escapeHtml;
  const { evidenceModel, evidenceMapHtml } = await import('../public/site-evmap.js');
  const live = (r => ({ ...r, ...(r.claim_files ? { claims: r.claim_files.flatMap(f => read(f)) } : {}), ...(r.finding_files ? { findings: r.finding_files.flatMap(f => read(f)) } : {}), ...(r.action_files ? { actions: r.action_files.flatMap(f => read(f)) } : {}) }))(read('release.json'));
  const m = evidenceModel(live, 'en');
  assert.equal(m.apps.length, live.applications.length);
  assert.equal(m.classes.length, live.taxonomy.technology_classes.length);
  assert.equal(m.problems.length, live.taxonomy.welfare_problems.length);
  assert.equal(m.classes.reduce((s, c) => s + c.claims, 0), live.applications.reduce((s, a) => s + a.claim_ids.length, 0));
  assert.ok(m.totals.inApps <= m.totals.claims);
  const html = evidenceMapHtml(m, { tr: (k, v) => t('en', k, v), href: (p, q = {}) => '#/' + p + '?' + new URLSearchParams(q) });
  // Compact by default: no intervention rows until a technology is opened. Opened, a technology shows
  // its practices merged by name, biggest first, at most 12, and links to the full table for the rest.
  assert.ok(!m.apps.some(a => html.includes(`data-k="a:${a.id}"`)));
  for (const c of m.classes.filter(c => c.apps)) {
    const opened = evidenceMapHtml(m, { tr: (k, v) => t('en', k, v), href: p => '#/' + p, open: c.id });
    const totals = new Map();
    for (const a of m.apps.filter(a => a.cls === c.id)) totals.set(a.label, (totals.get(a.label) || 0) + a.claims);
    const top = [...totals.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12);
    for (const [label] of top) assert.ok(opened.includes(esc(label.length > 44 ? label.slice(0, 43) : label)), label);
    assert.equal((opened.match(/class="em-label em-app"/g) || []).length, top.length);
    if (totals.size > 12) assert.ok(opened.includes(t('en', 'evmap.more', { n: totals.size - 12 })));
    assert.ok(opened.includes('aria-expanded="true"'));
  }
  assert.ok(!/\{\w+\}/.test(html), 'no unfilled placeholders');
  const empty = evidenceModel(release, 'zh');
  assert.equal(empty.apps.length, 0);
  assert.ok(evidenceMapHtml(empty, { tr: (k, v) => t('zh', k, v), href: p => '#/' + p }).includes(t('zh', 'evmap.noapps')));
});

test('corpus list: unpacks the column format, filters and sorts', async () => {
  const { unpackPapers, filterPapers, FILTER_DEFAULTS } = await import('../public/site-corpuslist.js');
  const j = { fields: ['id', 'title', 'year', 'lang', 'authors', 'topics', 'about', 'full_text', 'set', 'file'],
    rows: [['a', 'Feed training of mandarin fish', 2001, 'en', ['Li X'], ['feeding'], true, 'pdf', 'intake', 'x'],
      ['b', '鳜鱼人工繁殖', 1983, 'zh', null, null, true, null, 'intake', null], ['c', 'Genome', 2020, 'en', null, null, false, null, 'intake', null]] };
  const papers = unpackPapers(j);
  assert.equal(papers[0].file, 'intake/xml-pages.jsonl');
  assert.deepEqual(papers[1].topics, []);
  assert.deepEqual(filterPapers(papers, FILTER_DEFAULTS).map(p => p.id), ['a', 'b']);
  assert.deepEqual(filterPapers(papers, { ...FILTER_DEFAULTS, about: false, sort: 'old' }).map(p => p.id), ['b', 'a', 'c']);
  assert.deepEqual(filterPapers(papers, { ...FILTER_DEFAULTS, q: 'li x' }).map(p => p.id), ['a']);
  assert.deepEqual(filterPapers(papers, { ...FILTER_DEFAULTS, lang: 'zh' }).map(p => p.id), ['b']);
  assert.deepEqual(filterPapers(papers, { ...FILTER_DEFAULTS, ft: 'with' }).map(p => p.id), ['a']);
  for (const f of readdirSync(new URL('../public/data', import.meta.url)).filter(f => f.startsWith('corpus-papers'))) {
    const rows = unpackPapers(read(f));
    assert.ok(rows.length && rows.every(p => p.id && p.title && !('abstract' in p)), f);
  }
});

test('species page: counts come from the release, steps from corpus and plan, every key translated', () => {
  const corpus = read('corpus.json'), plan = read('next-run.json');
  const m = speciesModel(live, 'mandarin-fish', { corpus, nextRun: plan });
  assert.equal(m.claims.length, live.claims.filter(c => c.species_id === 'mandarin-fish').length);
  assert.equal(m.sources.reduce((a, s) => a + s.claims, 0), m.claims.length);
  assert.equal((m.verdicts.supported || 0) + (m.verdicts.partial || 0), m.claims.length);
  const steps = speciesSteps(m);
  assert.equal(steps[0].n, corpus.headline.papers_found);
  assert.equal(steps.filter(s => s.key === 'phase').length, plan.phases.length);
  assert.equal(speciesModel(live, 'no-such-fish'), null);
  for (const lang of ['en', 'zh']) {
    const tr = (k, v) => { assert.ok(STR[lang][k] !== undefined, `${lang}: ${k}`); return t(lang, k, v); };
    const html = speciesPageHtml(m, { tr, link: p => '#/' + p, lang, flowHtml: () => '', topicsHtml: () => '', taxonomyLabel: (k, id) => id });
    assert.ok(!/\{\w+\}/.test(html), 'unfilled placeholder');
  }
  for (const p of Object.values(PROFILES)) statSync(new URL('../public/' + p.image, import.meta.url));
});

test('home author flow: counts per group, kind and pair add up; companies fold into China other', async () => {
  const { authorModel, authorFlowHtml, AF_GROUPS, AF_KINDS } = await import('../public/site-corpusviz.js');
  const meta = { papers: [{ group: 'cn_university', kind: 'experiment', countries: ['CN'] }, { group: 'cn_company', kind: 'review', countries: ['CN'] },
    { group: 'europe', kind: 'experiment', country: 'DE', countries: ['DE', 'CN'] }, { group: 'unknown', kind: 'odd', countries: [] }] };
  const m = authorModel(meta);
  assert.equal(m.n, 4);
  assert.deepEqual(m.groups, [['cn_university', 1], ['cn_other', 1], ['europe', 1], ['unknown', 1]]);
  assert.equal(m.links.reduce((s, l) => s + l.v, 0), 4);
  assert.equal(m.china, 2); assert.equal(m.intl, 1); assert.deepEqual(m.countries, ['DE']);
  for (const lang of ['en', 'zh']) {
    const html = authorFlowHtml(meta, (k, v) => t(lang, k, v));
    for (const [g] of AF_GROUPS) assert.ok(t(lang, 'af.g.' + g) !== 'af.g.' + g, g);
    for (const k of AF_KINDS) assert.ok(t(lang, 'af.k.' + k) !== 'af.k.' + k, k);
    assert.ok(!/undefined|NaN/.test(html));
  }
  assert.equal(authorFlowHtml({ papers: [] }, k => k), '');
});
