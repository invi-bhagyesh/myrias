// Weekly digest, laid out as a newsletter: a masthead, topic tags to filter by, the top story, then desks
// (welfare, health and handling, in the news, ministry and vets), and how the issue was collected.
// China-focused animal welfare links in any language; papers may be discovered after publication.
import { escapeHtml as esc } from './site-lib.js';

export const TIERS = ['welfare', 'related', 'mention', 'animal'];

// Topic tags, from words in the title (Chinese or English) and the item's kind. Words that contain an animal
// character by accident are removed first (熊猫 is a panda, not a cat).
const NOT = ['熊猫', '猫眼', '牛市', '鸡汤'];
export const TOPICS = [
  ['policy', /法|条例|规范|标准|征求意见|公告|通知|决定|办法|人大|政策|\b(law|regulation|standard|policy|guideline)s?\b/i],
  ['slaughter', /屠宰|致晕|宰前|运输|\b(slaughter|stunning|transport)/i],
  ['wildlife', /野生动物|候鸟|鸟|湿地|保护区|鹤|物种|熊猫|\b(wildlife|birds?|panda|wetland)\b/i],
  ['livestock', /猪|牛|羊|畜|\b(pigs?|swine|sows?|piglets?|cattle|cows?|calves|dairy|sheep|goats?)\b/i],
  ['poultry', /鸡|鸭|鹅|禽|蛋|\b(poultry|chickens?|broilers?|hens?|ducks?|geese|goose|eggs?)\b/i],
  ['aquatic', /鱼|虾|蟹|水产|渔|\b(fish|shrimp|aquaculture|carp)\b/i],
  ['health', /兽医|兽药|疫病|疾病|防疫|应激|\b(veterinar\w*|disease|stress|health)\b/i],
  ['companion', /宠物|犬|狗|猫|\b(pets?|dogs?|cats?)\b/i],
  ['lab', /实验动物|\blaboratory animals?\b/i]
];
export function tagsOf(item) {
  const title = String(item.title || ''), text = NOT.reduce((t, w) => t.split(w).join(' '), title);
  const tags = TOPICS.filter(([, re]) => re.test(text)).map(([k]) => k);
  if (/熊猫|panda/i.test(title) && !tags.includes('wildlife')) tags.push('wildlife');
  if (item.kind === 'paper') tags.push('research');
  return tags;
}
export const TAGS = [...TOPICS.map(([k]) => k), 'research'];

// Pure: the items of an issue, in tier order, with each tier's items newest first.
export function groupIssue(issue) {
  const by = Object.fromEntries(TIERS.map(t => [t, []]));
  for (const it of issue.items || []) (by[it.tier] || (by[it.tier] = [])).push(it);
  for (const t of Object.keys(by)) by[t].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return by;
}

const day = (d, lang, long = false) => {
  if (!d || Number.isNaN(Date.parse(d))) return '—';
  try { return new Date(d + 'T00:00:00').toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB', long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' }); } catch { return d; }
};

export function digestHtml(index, issue, ctx) {
  const { tr, link, lang } = ctx;
  const src = new Map((issue.sources || []).map(s => [s.id, s]));
  const name = id => { const s = src.get(id); return s ? (lang === 'zh' ? s.name_zh : s.name_en || s.name_zh) : id; };
  const items = (issue.items || []).map(it => ({ ...it, tags: tagsOf(it) }));
  const by = groupIssue({ items });
  const included = items.reduce((counts, item) => counts.set(item.source, (counts.get(item.source) || 0) + 1), new Map());
  const issues = index.issues || [];
  const number = issues.length - Math.max(0, issues.findIndex(i => i.id === issue.id));

  const tagsHtml = it => it.tags.length ? `<span class="nl-tags-in">${it.tags.map(t => `<i class="nl-tag g-${t}">${esc(tr('dg.tag.' + t))}</i>`).join('')}</span>` : '';
  const when = it => esc(it.kind === 'paper' ? tr('dg.published', { date: day(it.date, lang) }) : day(it.date, lang));
  const extra = it => [it.venue, it.first_seen_at ? tr('dg.found', { date: day(new Date(Date.parse(it.first_seen_at) + 8 * 3600e3).toISOString().slice(0, 10), lang) }) : null,
    it.china_basis ? tr('dg.china.' + it.china_basis) : null].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
  const byline = it => `<p class="nl-by"><span class="nl-src">${esc(name(it.source))}</span><span>${esc(tr('dg.kind.' + it.kind))}</span><span>${when(it)}</span>${extra(it)}</p>`;
  const headline = (it, cls) => `<a class="${cls}" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" lang="${esc(it.title_lang || it.lang || 'und')}">${esc(it.title)}</a>`;
  const attrs = it => `data-tags="${esc(it.tags.join(' '))}"`;

  // The top story: the newest welfare item, else the newest related one.
  const lead = by.welfare[0] || by.related[0] || null;
  const rest = t => by[t].filter(it => it !== lead);
  const story = it => `<li class="nl-story" ${attrs(it)}>${tagsHtml(it)}${headline(it, 'nl-hl')}${byline(it)}</li>`;
  const brief = it => `<li class="nl-brief" ${attrs(it)}>${headline(it, 'nl-hl-sm')}${byline(it)}</li>`;
  const desk = (key, list, kind) => list.length ? `<section class="nl-desk d-${key}" data-desk><header class="nl-desk-h"><h2>${esc(tr('dg.tier.' + key))}</h2><span>${esc(tr('dg.tier.' + key + '.d'))}</span></header>
      <ul class="${kind === 'story' ? 'nl-stories' : 'nl-briefs'}">${list.map(kind === 'story' ? story : brief).join('')}</ul></section>` : '';

  const counts = Object.fromEntries(TAGS.map(t => [t, items.filter(it => it.tags.includes(t)).length]));
  const tagBar = `<nav class="nl-filter" aria-label="${esc(tr('dg.tags'))}"><button type="button" data-tag="" aria-pressed="true">${esc(tr('dg.tag.all'))} <b>${items.length}</b></button>${TAGS.filter(t => counts[t]).map(t => `<button type="button" data-tag="${t}" aria-pressed="false" class="g-${t}">${esc(tr('dg.tag.' + t))} <b>${counts[t]}</b></button>`).join('')}</nav>`;

  const archive = issues.length > 1 ? `<section class="nl-archive"><h2>${esc(tr('dg.archive'))}</h2><ol>${issues.map((i, k) => `<li><a href="${link('digest', { issue: i.id })}"${i.id === issue.id ? ' aria-current="page"' : ''}><b>${esc(tr('dg.issue.n', { n: issues.length - k }))}</b> ${esc(day(i.from, lang))} – ${esc(day(i.to, lang))}</a><span>${esc(tr('dg.links', { n: i.items }))}</span></li>`).join('')}</ol></section>` : '';
  const status = (issue.sources || []).map(s => `<tr class="st-${esc(s.status || 'unknown')}"><td>${esc(lang === 'zh' ? s.name_zh : s.name_en || s.name_zh)}</td><td>${esc(tr('dg.kind.' + s.kind))}</td><td><b>${esc(tr('dg.st.' + (s.status || 'unknown')))}</b>${s.error ? `<small>${esc(s.error)}</small>` : ''}</td><td>${s.scanned ?? '—'}</td><td>${included.get(s.id) || 0}</td></tr>`).join('');
  const notUsed = (issue.not_used || []).map(x => `<li><b>${esc(x.name)}</b> ${esc(x.why)}</li>`).join('');

  return `<article class="nl">
    <header class="nl-mast">
      <p class="nl-strap"><span>${esc(tr('dg.issue.n', { n: number }))}</span><span>${esc(tr('dg.kicker'))}</span><span>${esc(day(issue.from, lang))} – ${esc(day(issue.to, lang, true))}</span></p>
      <h1 class="nl-name">${esc(tr('dg.name'))}</h1>
      <p class="nl-dek">${esc(tr('dg.dek'))} · ${esc(tr('dg.sum.short', { n: items.length, w: by.welfare.length }))}</p>
    </header>
    ${items.length ? tagBar : ''}
    <p class="nl-note">${esc(tr(issue.date_basis === 'discovery' ? 'dg.note.discovery' : 'dg.note'))}${issue.partial ? ' ' + esc(tr('dg.partial')) : ''}</p>
    ${lead ? `<section class="nl-lead" ${attrs(lead)} data-desk><p class="nl-kicker">${esc(tr('dg.lead'))}</p>${headline(lead, 'nl-hl-lead')}${byline(lead)}${tagsHtml(lead)}
      <a class="nl-read" href="${esc(lead.url)}" target="_blank" rel="noopener noreferrer">${esc(tr('dg.read'))} ↗</a></section>` : ''}
    ${desk('welfare', rest('welfare'), 'story')}${desk('related', rest('related'), 'story')}${desk('mention', by.mention, 'brief')}${desk('animal', by.animal, 'brief')}
    ${items.length ? `<p class="nl-empty" data-empty hidden>${esc(tr('dg.tag.none'))}</p>` : `<p class="empty">${esc(tr('dg.none'))}</p>`}
    ${archive}
    <details class="dg-how"><summary>${esc(tr('dg.how'))}</summary><p class="small-note">${esc(tr('dg.how.d'))} <a href="https://github.com/invi-bhagyesh/myrias/blob/main/pipeline/digest/METHOD.md" target="_blank" rel="noopener">${esc(tr('dg.method'))} ↗</a></p>
      <table class="dg-status"><thead><tr><th>${esc(tr('dg.th.source'))}</th><th>${esc(tr('dg.th.kind'))}</th><th>${esc(tr('dg.th.status'))}</th><th>${esc(tr('dg.th.scanned'))}</th><th>${esc(tr('dg.th.kept'))}</th></tr></thead><tbody>${status}</tbody></table>
      ${notUsed ? `<h3>${esc(tr('dg.notused'))}</h3><ul class="dg-notused">${notUsed}</ul>` : ''}</details>
  </article>`;
}

// Tag filter: a tag shows only the stories carrying it; desks left empty are hidden.
export function mountDigest(root) {
  const bar = root.querySelector('.nl-filter');
  if (!bar) return;
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-tag]'); if (!b) return;
    const tag = b.dataset.tag;
    bar.querySelectorAll('[data-tag]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    root.querySelectorAll('[data-tags]').forEach(el => { el.hidden = !!tag && !el.dataset.tags.split(' ').includes(tag); });
    root.querySelectorAll('[data-desk]').forEach(d => { d.hidden = d.matches('[data-tags]') ? d.hidden : ![...d.querySelectorAll('[data-tags]')].some(x => !x.hidden); });
    const none = root.querySelector('[data-empty]');
    if (none) none.hidden = [...root.querySelectorAll('[data-tags]')].some(x => !x.hidden);
  });
}
