import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as L from '../public/site-lib.js';
import { STR, t } from '../public/i18n.js';

const read = name => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
const release = read('release.json');
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
  assert.ok(keys.length > 5);
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
