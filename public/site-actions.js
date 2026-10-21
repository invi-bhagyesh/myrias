// Draft actions on the site: one card per action, with its type, who it is for, its priority and the
// findings it rests on. Shared by the species page and the Actions page.
import { escapeHtml as esc, linkIds } from './site-lib.js';

const SPEC_URL = 'https://github.com/invi-bhagyesh/myrias/blob/main/';
// The note under a list of actions: who ranked them and against which spec, with a link to the spec.
export function rankNoteHtml(release, tr) {
  const by = release?.action_ranking;
  if (!by) return '';
  return `<p class="small-note">${esc(tr('ac.formula', { model: by.model }))} <a href="${esc(SPEC_URL + by.spec)}" target="_blank" rel="noopener">${esc(tr('ac.spec'))} ↗</a></p>`;
}

// One row per action: rank, type, the action on one line and its priority. Click to open the full card.
export function actionItemHtml(a, ctx, fById) {
  const { tr, link, lang } = ctx;
  const notes = new Map((a.basis?.findings || []).map(f => [f.id, f.why])), note = id => notes.get(id);
  return `<li class="ac t-${esc(a.type)}"><details class="row" data-row><summary class="row-sum">
      <span class="ac-rank">${a.rank ?? ''}</span><span class="ac-type">${esc(tr('ac.type.' + a.type))}</span><span class="row-line">${esc(lang === 'zh' ? a.action_zh || a.action_en : a.action_en || a.action_zh)}</span>
      <span class="row-n"><span class="ac-score" title="${esc(tr('ac.score.tip', { s: Math.round(100 * (a.priority?.score || 0)) }))}"><i style="width:${Math.round(100 * (a.priority?.score || 0))}%"></i></span>${a.priority?.score == null ? '—' : esc(a.priority.score.toFixed(2))}</span></summary>
    <div class="row-body"><div class="ac-head"><span class="ac-who">${esc(tr('ac.who', { who: tr('ac.who.' + a.who.replace(/ /g, '_')) }))}</span><span class="ac-draft">${esc(tr('ac.draft'))}</span>
      ${a.welfare_problems.map(p => `<span class="sp-chip">${esc(ctx.taxonomyLabel('welfare_problems', p))}</span>`).join('')}</div>
      ${a.basis?.reason ? `<p class="ac-note ac-reason"><b>${esc(tr('ac.reason'))}</b> ${linkIds(a.basis.reason, link)}</p>` : ''}
      <p class="ac-note"><b>${esc(tr('ac.gap'))}</b> ${linkIds(a.evidence_gap, link)}</p><p class="ac-note"><b>${esc(tr('ac.risks'))}</b> ${linkIds(a.risks, link)}</p>
      <p class="ac-note"><b>${esc(tr(a.finding_ids.length === 1 ? 'ac.why.one' : 'ac.why', { n: a.finding_ids.length }))}</b></p>
      <ul class="ac-findings">${a.finding_ids.map(id => fById.get(id)).filter(Boolean).map(f => `<li><a href="${link('findings/' + encodeURIComponent(f.id))}">${esc(lang === 'zh' ? f.statement_zh || f.statement_en : f.statement_en || f.statement_zh)}</a> <span class="fd-meta">${esc(tr('fd.strength.' + f.strength))} · ${esc(tr('fd.papers', { n: f.counts.papers }))}</span>${note(f.id) ? `<span class="ac-fwhy">${linkIds(note(f.id), link)}</span>` : ''}</li>`).join('')}</ul>
      ${a.priority?.reason ? `<details class="ac-rankwhy"><summary>${esc(tr('ac.rank.why'))} ${esc(tr('ac.rank.n', { r: a.rank, s: Math.round(100 * a.priority.score) }))}</summary><p class="ac-note">${linkIds(a.priority.reason, link)}</p>${(a.priority.criteria || []).length ? `<ul class="ac-crit">${a.priority.criteria.map(c => `<li class="lv-${esc(c.level)}"><span>${esc(c.criterion)}</span><b>${esc(tr('ac.level.' + c.level))}</b><small>${linkIds(c.note, link)}</small></li>`).join('')}</ul>` : ''}</details>` : ''}</div></details></li>`;
}
