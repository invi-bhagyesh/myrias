import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorModel, authorLayout, authorFlowHtml, AF_GROUPS } from '../public/site-corpusviz.js';
import { t, STR } from '../public/i18n.js';

test('affiliation ribbons conserve paper counts and share one scale at both ends', () => {
  const model = authorModel(JSON.parse(readFileSync(new URL('../public/data/papers.json', import.meta.url))));
  const layout = authorLayout(model);
  assert.ok(layout.scale > 0);
  assert.equal(layout.links.reduce((sum, l) => sum + l.v, 0), model.n);
  for (const [side, key] of [['left', 'g'], ['right', 'k']]) {
    for (const [id, node] of Object.entries(layout[side])) {
      const links = layout.links.filter(l => l[key] === id);
      assert.ok(Math.abs(links.reduce((sum, l) => sum + l.h, 0) - node.h) < 1e-8);
      assert.ok(Math.abs(node.h - node.count * layout.scale) < 1e-8);
      assert.ok(node.y >= 0 && node.y + node.h <= layout.height);
    }
  }
  for (const link of layout.links) assert.ok(Math.abs(link.h / link.v - layout.scale) < 1e-8);
});

test('rare affiliations retain label space without inflating their bars', () => {
  const papers = Array.from({ length: 1000 }, () => ({ group: 'cn_university', kind: 'experiment' }));
  for (const [group] of AF_GROUPS.slice(1)) papers.push({ group, country: group === 'us' ? 'US' : undefined, kind: 'review' });
  const m = authorModel({ papers }), layout = authorLayout(m);
  assert.ok(Math.abs(layout.left.cn_university.h / layout.left.europe.h - 1000) < 1e-8);
  const centers = Object.values(layout.left).map(r => r.y + r.h / 2);
  for (let i = 1; i < centers.length; i++) assert.ok(centers[i] - centers[i - 1] >= 48);
});

test('unrecognized and missing affiliation groups remain counted in Others', () => {
  const m = authorModel({ papers: [{ kind: 'review' }, { group: 'new_group', kind: 'experiment' }] });
  assert.deepEqual(m.groups, [['other', 2]]);
  assert.equal(m.links.reduce((sum, l) => sum + l.v, 0), 2);
});

test('interactive chart labels have complete English and Chinese copy', () => {
  const meta = { papers: [{ group: 'europe', kind: 'experiment' }] };
  for (const lang of ['en', 'zh']) {
    const html = authorFlowHtml(meta, (key, vars) => {
      assert.ok(STR[lang][key] !== undefined, `${lang}: ${key}`);
      return t(lang, key, vars);
    });
    assert.ok(!/NaN|undefined|\{\w+\}/.test(html));
    assert.ok(!html.includes('af-table'));
    assert.match(html, /role="button" tabindex="0"/);
    assert.ok(!html.includes('data-af-filter'));
    assert.ok(!html.includes('data-af-reset'));
  }
  assert.equal(authorFlowHtml({ papers: [] }, k => k), '');
});

test('US grouping uses the first affiliation country; other Americas and unstated affiliations merge into Others', () => {
  const m = authorModel({ papers: [
    { group: 'americas', country: 'BR', countries: ['BR', 'US'], kind: 'experiment' },
    { group: 'americas', country: 'CA', kind: 'review' },
    { group: 'americas', country: 'US', kind: 'review' },
    { group: 'unknown', kind: 'review' },
    { group: 'other', country: 'RU', kind: 'experiment' }
  ] });
  assert.deepEqual(m.groups, [['us', 1], ['other', 4]]);
  assert.equal(m.links.reduce((sum, l) => sum + l.v, 0), 5);
});
