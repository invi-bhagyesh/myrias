// Draft actions on the site: one card per action, with its type, who it is for, its priority and the
// findings it rests on. Shared by the species page and the Actions page.
import { escapeHtml as esc, linkIds } from './site-lib.js';
import { actionReviewHtml } from './site-review.js';

const SPEC_URL = 'https://github.com/invi-bhagyesh/myrias/blob/main/';
// The note under a list of actions: who ranked them and against which spec, with a link to the spec.
export function rankNoteHtml(release, tr) {
  const by = release?.action_ranking;
  if (!by) return '';
  return `<p class="small-note">${esc(tr('ac.formula', { model: by.model }))} <a href="${esc(SPEC_URL + by.spec)}" target="_blank" rel="noopener">${esc(tr('ac.spec'))} ↗</a></p>`;
}

// A section label from a run-in label ("Risks:" -> "Risks").
const label = t => String(t).replace(/[:：]\s*$/, '');

// One row per action: rank, type, the action on one line and its priority. Click to open the full card: who it
// is for, how it was built, what is not known, risks, the findings it rests on as cards, then (folded) why it
// ranks where it does and the review form.
export function actionItemHtml(a, ctx, fById) {
  const { tr, link, lang } = ctx;
  const notes = new Map((a.basis?.findings || []).map(f => [f.id, f.why])), note = id => notes.get(id);
  return `<li class="ac t-${esc(a.type)}"><details class="row" data-row><summary class="row-sum">
      <span class="ac-rank">${a.rank ?? ''}</span><span class="ac-type">${esc(tr('ac.type.' + a.type))}</span><span class="row-line">${esc(lang === 'zh' ? a.action_zh || a.action_en : a.action_en || a.action_zh)}</span>
      <span class="row-n"><span class="ac-score" title="${esc(tr('ac.score.tip', { s: Math.round(100 * (a.priority?.score || 0)) }))}"><i style="width:${Math.round(100 * (a.priority?.score || 0))}%"></i></span>${a.priority?.score == null ? '—' : esc(a.priority.score.toFixed(2))}</span></summary>
    <div class="row-body ac-body">
      <div class="ac-head"><span class="ac-who">${esc(tr('ac.who', { who: tr('ac.who.' + a.who.replace(/ /g, '_')) }))}</span>
        ${a.welfare_problems.map(p => `<span class="sp-chip">${esc(ctx.taxonomyLabel('welfare_problems', p))}</span>`).join('')}<span class="ac-draft">${esc(tr('ac.draft'))}</span></div>
      <div class="ac-blocks">
        ${a.basis?.reason ? `<section class="ac-block ac-block-why"><h4>${esc(label(tr('ac.reason')))}</h4><p>${linkIds(a.basis.reason, link)}</p></section>` : ''}
        <section class="ac-block"><h4>${esc(label(tr('ac.gap')))}</h4><p>${linkIds(a.evidence_gap, link)}</p></section>
        <section class="ac-block ac-block-risk"><h4>${esc(label(tr('ac.risks')))}</h4><p>${linkIds(a.risks, link)}</p></section>
      </div>
      <h4 class="ac-sub">${esc(tr(a.finding_ids.length === 1 ? 'ac.why.one' : 'ac.why', { n: a.finding_ids.length }))}</h4>
      <ul class="ac-fcards">${a.finding_ids.map(id => fById.get(id)).filter(Boolean).map(f => `<li class="ac-fcard s-${esc(f.strength)}">
        <a class="ac-fcard-main" href="${link('findings/' + encodeURIComponent(f.id))}"><span class="ac-fcard-top"><code>${esc(f.id)}</code><span class="ac-fcard-strength">${esc(tr('fd.strength.' + f.strength))}</span><span class="ac-fcard-n">${esc(tr('fd.papers', { n: f.counts.papers }))}</span></span>
          <span class="ac-fcard-text">${esc(lang === 'zh' ? f.statement_zh || f.statement_en : f.statement_en || f.statement_zh)}</span></a>
        ${note(f.id) ? `<p class="ac-fcard-why">${esc(note(f.id))}</p>` : ''}</li>`).join('')}</ul>
      <div class="ac-folds">${a.priority?.reason ? `<details class="ac-rankwhy"><summary>${esc(tr('ac.rank.why'))} <span>${esc(tr('ac.rank.n', { r: a.rank, s: Math.round(100 * a.priority.score) }))}</span></summary><p class="ac-note">${linkIds(a.priority.reason, link)}</p>${(a.priority.criteria || []).length ? `<ul class="ac-crit">${a.priority.criteria.map(c => `<li class="lv-${esc(c.level)}"><span>${esc(c.criterion)}</span><b>${esc(tr('ac.level.' + c.level))}</b><small>${linkIds(c.note, link)}</small></li>`).join('')}</ul>` : ''}</details>` : ''}
      ${ctx.review === false ? '' : actionReviewHtml(a, tr)}</div></div></details></li>`;
}
