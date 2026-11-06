import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseList, findDate, dateFromUrl, classify, dedupe, cleanText, inWindow } from '../pipeline/digest.mjs';
import { digestHtml, groupIssue, TIERS } from '../public/site-digest.js';
import { STR, t } from '../public/i18n.js';

const terms = JSON.parse(readFileSync(new URL('../pipeline/digest/terms.json', import.meta.url), 'utf8'));
const registry = JSON.parse(readFileSync(new URL('../pipeline/digest/sources.json', import.meta.url), 'utf8'));

test('digest: dates in Chinese and Western forms, and from URLs', () => {
  assert.equal(findDate('[ 2026-11-05 ]'), '2026-11-05');
  assert.equal(findDate('发布时间：2026年11月5日'), '2026-11-05');
  assert.equal(findDate('2026/1/9 10:00'), '2026-01-09');
  assert.equal(findDate('no date'), null);
  assert.deepEqual(dateFromUrl('http://www.moa.gov.cn/xw/zwdt/202611/t20261106_6489276.htm', 't(\\d{4})(\\d{2})(\\d{2})_'), { date: '2026-11-06', month: '2026-11' });
  assert.deepEqual(dateFromUrl('https://news.sciencenet.cn/htmlnews/2026/11/574321.shtm', 'htmlnews/(\\d{4})/(\\d{1,2})/'), { date: null, month: '2026-11' });
  assert.ok(inWindow('2026-11-02', '2026-10-31', '2026-11-06') && !inWindow('2026-10-30', '2026-10-31', '2026-11-06') && !inWindow(null, 'a', 'b'));
});

test('digest: list pages give links with titles from the attribute or the text, and dates beside them', () => {
  const moa = `<li><a href="./202611/t20261106_1.htm" target="_blank" title='全国首届兽医化验员检测技能竞赛决赛在山东举办'>全国首届…</a></li>
    <li><a href="./202611/t20261106_1.htm">duplicate</a></li><a href="/about.html">关于我们</a>`;
  const rows = parseList(moa, 'http://www.moa.gov.cn/xw/zwdt/', { link: '\\./\\d{6}/t\\d{8}_\\d+\\.htm', title: 'attr', date_from_url: 't(\\d{4})(\\d{2})(\\d{2})_' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'http://www.moa.gov.cn/xw/zwdt/202611/t20261106_1.htm');
  assert.equal(rows[0].title, '全国首届兽医化验员检测技能竞赛决赛在山东举办');
  assert.equal(rows[0].date, '2026-11-06');
  const cvma = `<a href="/6849/202611/74577.html" target="_blank">· 关于征求《牛屠宰质量管理规范》意见的通知</a><span>[ 2026-11-05 ]</span>`;
  const r2 = parseList(cvma, 'https://www.cvma.org.cn/', { link: '/\\d{4}/\\d{6}/\\d+\\.html', title: 'text', date_near: true });
  assert.deepEqual([r2[0].title, r2[0].date, r2[0].url], ['关于征求《牛屠宰质量管理规范》意见的通知', '2026-11-05', 'https://www.cvma.org.cn/6849/202611/74577.html']);
  assert.equal(cleanText('· <b>猪</b>&nbsp;福利'), '猪 福利');
});

test('digest: the title decides the tier; panda is not a cat; general sources drop plain farming news', () => {
  assert.equal(classify('农业农村部关于征求《牛屠宰质量管理规范》意见', terms, 'veterinary').tier, 'welfare');
  assert.equal(classify('动物福利与可持续农食大会在北京召开', terms, 'general').tier, 'welfare');
  assert.equal(classify('生猪运输应激的防控', terms, 'agriculture').tier, 'related');
  assert.equal(classify('全国畜牧业统计监测劳动竞赛举办', terms, 'agriculture').tier, 'animal');
  assert.equal(classify('全国畜牧业统计监测劳动竞赛举办', terms, 'general').keep, false);
  assert.equal(classify('2026全球熊猫伙伴大会在成都举行', terms, 'general', '野生动物保护').tier, 'mention');
  assert.ok(!classify('2026全球熊猫伙伴大会在成都举行', terms, 'general').matched.includes('猫'));
  assert.equal(classify('Heat stress alters feeding behaviour in broilers', terms, 'paper').tier, 'related');
  assert.equal(classify('Genome-wide association of growth traits in ducks', terms, 'paper').keep, false);
});

test('digest: duplicates by URL or by title are dropped', () => {
  const items = [{ url: 'http://a.cn/1', title: '猪福利 新规' }, { url: 'https://a.cn/1/', title: 'other' }, { url: 'http://b.cn/2', title: '猪福利新规！' }, { url: 'http://c.cn/3', title: '不同' }];
  assert.deepEqual(dedupe(items).map(i => i.url), ['http://a.cn/1', 'http://c.cn/3']);
});

test('digest registry: every source has an id, names, a kind, a scope and a known access type', () => {
  const types = new Set(['html-list', 'people-search', 'europepmc', 'wanfang', 'openalex']);
  for (const s of registry.sources) {
    assert.ok(s.id && s.name_zh && s.name_en && s.kind && s.scope, s.id);
    assert.ok(types.has(s.access.type), s.id);
    if (s.access.type === 'html-list') assert.doesNotThrow(() => new RegExp(s.access.link), s.id);
  }
  assert.ok(registry.user_agent.includes('github.com/invi-bhagyesh/myrias'));
});

test('digest page: groups by tier, links open the source, every string translated', () => {
  const issue = { id: '2026-11-06', from: '2026-10-31', to: '2026-11-06', sources: [{ id: 'cvma', name_zh: '中国兽医协会', name_en: 'Chinese Veterinary Medical Association', kind: 'association', status: 'ok', scanned: 65, in_window: 1 }, { id: 'x', name_zh: 'X', name_en: 'X', kind: 'news', status: 'failed', error: 'HTTP 503' }],
    not_used: [{ name: 'WeChat', why: 'no open feed' }],
    items: [{ source: 'cvma', kind: 'association', lang: 'zh', url: 'https://www.cvma.org.cn/1.html', title: '牛屠宰质量管理规范', date: '2026-11-05', tier: 'welfare', matched: ['屠宰', '牛'] }, { source: 'cvma', kind: 'association', lang: 'zh', url: 'https://www.cvma.org.cn/2.html', title: '兽医竞赛', date: '2026-11-06', tier: 'animal', matched: ['兽医'] }] };
  assert.deepEqual(Object.fromEntries(Object.entries(groupIssue(issue)).map(([k, v]) => [k, v.length])), { welfare: 1, related: 0, mention: 0, animal: 1 });
  for (const lang of ['en', 'zh']) {
    const html = digestHtml({ issues: [{ id: issue.id, to: issue.to }] }, issue, { tr: (k, v) => t(lang, k, v), link: p => '#/' + p, lang });
    assert.ok(html.includes('href="https://www.cvma.org.cn/1.html"') && html.includes('rel="noopener noreferrer"'));
    assert.ok(html.includes('HTTP 503') && html.includes('WeChat'));
    assert.ok(!/undefined|NaN|dg\.[a-z]/.test(html), lang);
  }
  for (const k of [...TIERS.flatMap(x => ['dg.tier.' + x, 'dg.tier.' + x + '.d']), 'dg.title', 'dg.sum', 'dg.nav', 'dg.st.ok', 'dg.st.empty', 'dg.st.failed']) assert.ok(STR.en[k] && STR.zh[k], k);
});
