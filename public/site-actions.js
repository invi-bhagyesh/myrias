// Draft actions on the site: one card per action, with its type, who it is for, its priority and the
// findings it rests on. Shared by the species page and the Actions page.
import { escapeHtml as esc } from './site-lib.js';

// One row per action: rank, type, the action on one line and its priority. Click to open the full card.
export function actionItemHtml(a, ctx, fById) {
  const { tr, link, lang } = ctx;
  return `<li class="ac t-${esc(a.type)}"><details class="row" data-row><summary class="row-sum">
      <span class="ac-rank">${a.rank ?? ''}</span><span class="ac-type">${esc(tr('ac.type.' + a.type))}</span><span class="row-line">${esc(lang === 'zh' ? a.action_zh || a.action_en : a.action_en || a.action_zh)}</span>
      <span class="row-n"><span class="ac-score" title="${esc(tr('ac.score.tip', { e: a.priority.evidence, d: a.priority.actionability }))}"><i style="width:${Math.round(100 * a.priority.score)}%"></i></span>${esc(a.priority.score.toFixed(2))}</span></summary>
    <div class="row-body"><div class="ac-head"><span class="ac-who">${esc(tr('ac.who', { who: tr('ac.who.' + a.who.replace(/ /g, '_')) }))}</span><span class="ac-draft">${esc(tr('ac.draft'))}</span>
      ${a.welfare_problems.map(p => `<span class="sp-chip">${esc(ctx.taxonomyLabel('welfare_problems', p))}</span>`).join('')}</div>
      <p class="ac-note"><b>${esc(tr('ac.gap'))}</b> ${esc(a.evidence_gap)}</p><p class="ac-note"><b>${esc(tr('ac.risks'))}</b> ${esc(a.risks)}</p>
      <p class="ac-note"><b>${esc(tr(a.finding_ids.length === 1 ? 'ac.why.one' : 'ac.why', { n: a.finding_ids.length }))}</b></p>
      <ul class="ac-findings">${a.finding_ids.map(id => fById.get(id)).filter(Boolean).map(f => `<li><a href="${link('findings/' + encodeURIComponent(f.id))}">${esc(lang === 'zh' ? f.statement_zh || f.statement_en : f.statement_en || f.statement_zh)}</a> <span class="fd-meta">${esc(tr('fd.papers', { n: f.counts.papers }))}</span></li>`).join('')}</ul></div></details></li>`;
}
