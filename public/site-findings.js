// Findings on the site: what the claims about one practice and one welfare problem say together.
// A finding is a summary, never evidence on its own: each one shows its counts and the claims under it,
// each with its quote and paper, so a reader can check it against the source.
import { escapeHtml as esc } from './site-lib.js';

export const findingText = (f, lang) => (lang === 'zh' ? f.statement_zh || f.statement_en : f.statement_en || f.statement_zh) || '';
const n = x => Number(x).toLocaleString();

// Findings that take a side across several papers first (agree, disagree, mostly against), then ones that
// only describe a practice, then single-paper ones; within each, most papers, then most claims.
const TIER = { agree: 0, mixed: 0, against: 0, described: 1, one_paper: 2 };
export const byWeight = (a, b) => (TIER[a.strength] ?? 3) - (TIER[b.strength] ?? 3) || b.counts.papers - a.counts.papers || b.counts.claims - a.counts.claims || a.id.localeCompare(b.id);

function claimItems(f, ctx) {
  const { link, lang, claims, sources, claimText } = ctx;
  return f.claim_ids.map(id => claims.get(id)).filter(Boolean).map(c => {
    const s = sources.get(c.source_id);
    return `<li><a href="${link('claims/' + encodeURIComponent(c.id))}">${esc(claimText(c, lang).text)}</a>
      <blockquote class="fd-quote" lang="${esc(c.quote_lang || 'und')}">${esc(c.quote)}</blockquote>
      <span class="fd-src">${esc(c.id)} · ${s ? `<span lang="${esc(s.lang)}">${esc(s.title)}</span>${s.year ? ' · ' + esc(s.year) : ''}` : esc(c.source_id)}${c.polarity ? ' · ' + esc(ctx.tr('pol.' + c.polarity)) : ''}</span></li>`;
  }).join('');
}

const meta = (f, tr) => [tr(f.counts.papers === 1 ? 'fd.papers.one' : 'fd.papers', { n: n(f.counts.papers) }), tr(f.counts.claims === 1 ? 'fd.claims.one' : 'fd.claims', { n: n(f.counts.claims) }),
  ...(f.counts.supportive || f.counts.opposing ? [tr('fd.split', { s: f.counts.supportive, o: f.counts.opposing })] : [])].join(' · ');

export function findingItemHtml(f, ctx) {
  const { tr, link, lang, taxonomyLabel } = ctx;
  const practice = (lang === 'zh' ? f.practice_zh || f.practice_en : f.practice_en || f.practice_zh) || '';
  return `<li class="fd s-${esc(f.strength)}">
    <div class="fd-head"><span class="fd-strength">${esc(tr('fd.strength.' + f.strength))}</span><span class="sp-chip">${esc(taxonomyLabel('welfare_problems', f.welfare_problem))}</span>
      <span class="fd-practice">${esc(practice)} · ${esc(taxonomyLabel('technology_classes', f.technology_class))}</span></div>
    <p class="fd-text"><a href="${link('findings/' + encodeURIComponent(f.id))}">${esc(findingText(f, lang))}</a></p>
    <p class="fd-meta">${esc(meta(f, tr))}${f.check && f.check !== 'numbers_ok' ? ` · <span class="fd-warn">${esc(tr('fd.check.' + f.check))}</span>` : ''}</p>
    <details class="fd-claims"><summary>${esc(tr(f.counts.claims === 1 ? 'fd.show.one' : 'fd.show', { n: n(f.counts.claims) }))}</summary><ol>${claimItems(f, ctx)}</ol></details></li>`;
}

// A list: the first `first` findings shown, the rest folded, each folded group labelled with its count.
export function findingsListHtml(findings, ctx, { first = 8, rest: showRest = true } = {}) {
  const list = [...findings].sort(byWeight);
  if (!list.length) return `<p class="small-note">${esc(ctx.tr('fd.none'))}</p>`;
  const rest = showRest ? list.slice(first) : [];
  return `<ol class="fd-list">${list.slice(0, first).map(f => findingItemHtml(f, ctx)).join('')}</ol>` +
    (rest.length ? `<details class="sp-more"><summary>${esc(ctx.tr('fd.more', { n: n(rest.length) }))}</summary><ol class="fd-list">${rest.map(f => findingItemHtml(f, ctx)).join('')}</ol></details>` : '');
}

// The page for one finding: the sentence, how it was written, the counts, and every claim under it.
export function findingPageHtml(f, ctx) {
  const { tr, link, lang, taxonomyLabel } = ctx;
  const practice = (lang === 'zh' ? f.practice_zh || f.practice_en : f.practice_en || f.practice_zh) || '';
  const how = f.written_by === 'single_claim' ? tr('fd.how.single') : f.written_by?.model ? tr('fd.how.model', { model: f.written_by.model }) : '';
  return `<p class="meta"><a href="${link('species/' + encodeURIComponent(f.species_id))}">← ${esc(tr('fd.back'))}</a></p>
    <header class="species-title fd-page"><div class="record-type">${esc(tr('fd.kicker'))} ${esc(f.id)} · ${esc(tr('fd.strength.' + f.strength))}</div><h1>${esc(findingText(f, lang))}</h1></header>
    <dl class="facts"><dt>${esc(tr('fd.practice'))}</dt><dd>${esc(practice)}</dd><dt>${esc(tr('fd.problem'))}</dt><dd>${esc(taxonomyLabel('welfare_problems', f.welfare_problem))}</dd>
      <dt>${esc(tr('fd.class'))}</dt><dd>${esc(taxonomyLabel('technology_classes', f.technology_class))}</dd><dt>${esc(tr('fd.evidence'))}</dt><dd>${esc(meta(f, tr))}${f.counts.measured ? ' · ' + esc(tr('fd.measured', { n: f.counts.measured })) : ''}</dd>
      <dt>${esc(tr('fd.written'))}</dt><dd>${esc(how)}${f.check && f.check !== 'numbers_ok' ? ` <span class="fd-warn">${esc(tr('fd.check.' + f.check))}</span>` : ''}</dd></dl>
    <p class="small-note">${esc(tr('fd.note'))}</p>
    <h2>${esc(tr(f.counts.claims === 1 ? 'fd.claims.h.one' : 'fd.claims.h', { n: n(f.counts.claims) }))}</h2><ol class="fd-claimlist">${claimItems(f, ctx)}</ol>`;
}
