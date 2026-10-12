// Draft actions on the site: one card per action, with its type, who it is for, its priority and the
// findings it rests on. Shared by the species page and the Actions page.
import { escapeHtml as esc } from './site-lib.js';

export function actionItemHtml(a, ctx, fById) {
  const { tr, link, lang } = ctx;
  return `<li class="ac t-${esc(a.type)}"><span class="ac-rank">${a.rank ?? ''}</span><div>
      <div class="ac-head"><span class="ac-type">${esc(tr('ac.type.' + a.type))}</span><span class="ac-who">${esc(tr('ac.who', { who: tr('ac.who.' + a.who.replace(/ /g, '_')) }))}</span><span class="ac-draft">${esc(tr('ac.draft'))}</span></div>
      <p class="ac-text">${esc(lang === 'zh' ? a.action_zh || a.action_en : a.action_en || a.action_zh)}</p>
      <p class="ac-meta"><span class="ac-score" title="${esc(tr('ac.score.tip', { e: a.priority.evidence, d: a.priority.actionability }))}"><i style="width:${Math.round(100 * a.priority.score)}%"></i></span>${esc(tr('ac.score', { s: a.priority.score.toFixed(2) }))} · ${a.welfare_problems.map(p => `<span class="sp-chip">${esc(ctx.taxonomyLabel('welfare_problems', p))}</span>`).join('')}</p>
      <details class="fd-claims"><summary>${esc(tr(a.finding_ids.length === 1 ? 'ac.why.one' : 'ac.why', { n: a.finding_ids.length }))}</summary>
        <ul class="ac-findings">${a.finding_ids.map(id => fById.get(id)).filter(Boolean).map(f => `<li><a href="${link('findings/' + encodeURIComponent(f.id))}">${esc(lang === 'zh' ? f.statement_zh || f.statement_en : f.statement_en || f.statement_zh)}</a> <span class="fd-meta">${esc(tr('fd.papers', { n: f.counts.papers }))}</span></li>`).join('')}</ul>
        <p class="ac-note"><b>${esc(tr('ac.gap'))}</b> ${esc(a.evidence_gap)}</p><p class="ac-note"><b>${esc(tr('ac.risks'))}</b> ${esc(a.risks)}</p></details></div></li>`;
}
