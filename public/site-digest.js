// Weekly digest: links to Chinese-language animal welfare news, notices and papers from one week, collected by
// pipeline/digest.mjs into data/digest/. Links only for now; titles stay in Chinese as published.
import { escapeHtml as esc } from './site-lib.js';

export const TIERS = ['welfare', 'related', 'mention', 'animal'];

// Pure: the items of an issue, in tier order, with each tier's items newest first.
export function groupIssue(issue) {
  const by = Object.fromEntries(TIERS.map(t => [t, []]));
  for (const it of issue.items || []) (by[it.tier] || (by[it.tier] = [])).push(it);
  for (const t of Object.keys(by)) by[t].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return by;
}

const day = (d, lang) => {
  try { return new Date(d + 'T00:00:00').toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB', { day: 'numeric', month: 'short' }); } catch { return d; }
};

export function digestHtml(index, issue, ctx) {
  const { tr, link, lang } = ctx;
  const src = new Map((issue.sources || []).map(s => [s.id, s]));
  const name = id => { const s = src.get(id); return s ? (lang === 'zh' ? s.name_zh : s.name_en || s.name_zh) : id; };
  const by = groupIssue(issue);
  const item = it => `<li class="dg-item"><a class="dg-title" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" lang="${esc(it.lang === 'en' ? 'en' : 'zh-Hans')}">${esc(it.title)}</a>
      <span class="dg-meta"><span class="dg-kind k-${esc(it.kind)}">${esc(tr('dg.kind.' + it.kind))}</span><span>${esc(name(it.source))}</span><span>${esc(day(it.date, lang))}</span>${it.venue ? `<span>${esc(it.venue)}</span>` : ''}
      ${(it.matched || []).length ? `<span class="dg-terms" title="${esc(tr('dg.matched'))}">${it.matched.slice(0, 4).map(w => `<i>${esc(w)}</i>`).join('')}</span>` : ''}</span></li>`;
  const sections = TIERS.filter(t => by[t].length).map(t => `<section class="dg-sec t-${t}"><h2>${esc(tr('dg.tier.' + t))} <span>${by[t].length}</span></h2><p class="dg-sec-note">${esc(tr('dg.tier.' + t + '.d'))}</p><ul class="dg-list">${by[t].map(item).join('')}</ul></section>`).join('');
  const issues = (index.issues || []).length > 1 ? `<nav class="ac-versions" aria-label="${esc(tr('dg.issue'))}"><span>${esc(tr('dg.issue'))}</span>${index.issues.map(i => `<a href="${link('digest', { issue: i.id })}"${i.id === issue.id ? ' aria-current="page"' : ''}>${esc(day(i.to, lang))}</a>`).join('')}</nav>` : '';
  const status = (issue.sources || []).map(s => `<tr class="st-${esc(s.status || 'unknown')}"><td>${esc(lang === 'zh' ? s.name_zh : s.name_en || s.name_zh)}</td><td>${esc(tr('dg.kind.' + s.kind))}</td><td><b>${esc(tr('dg.st.' + (s.status || 'unknown')))}</b>${s.error ? `<small>${esc(s.error)}</small>` : ''}</td><td>${s.scanned ?? '—'}</td><td>${s.in_window ?? '—'}</td></tr>`).join('');
  const notUsed = (issue.not_used || []).map(x => `<li><b>${esc(x.name)}</b> ${esc(x.why)}</li>`).join('');
  return `<header class="list-head"><div class="list-head-main"><div class="record-type">${esc(tr('dg.kicker'))}</div><h1>${esc(tr('dg.title'))}</h1>
      <p>${esc(tr('dg.sum', { from: day(issue.from, lang), to: day(issue.to, lang), n: (issue.items || []).length, w: (by.welfare || []).length }))}</p></div></header>
    ${issues}<p class="dg-note">${esc(tr('dg.note'))}</p>
    ${sections || `<p class="empty">${esc(tr('dg.none'))}</p>`}
    <details class="dg-how"><summary>${esc(tr('dg.how'))}</summary><p class="small-note">${esc(tr('dg.how.d'))} <a href="https://github.com/invi-bhagyesh/myrias/blob/main/pipeline/digest/METHOD.md" target="_blank" rel="noopener">${esc(tr('dg.method'))} ↗</a></p>
      <table class="dg-status"><thead><tr><th>${esc(tr('dg.th.source'))}</th><th>${esc(tr('dg.th.kind'))}</th><th>${esc(tr('dg.th.status'))}</th><th>${esc(tr('dg.th.scanned'))}</th><th>${esc(tr('dg.th.kept'))}</th></tr></thead><tbody>${status}</tbody></table>
      ${notUsed ? `<h3>${esc(tr('dg.notused'))}</h3><ul class="dg-notused">${notUsed}</ul>` : ''}</details>`;
}
