// Expert review (front-end demo): a reviewer marks each claim right, partly right, wrong or can't tell (or each
// draft action sound, needing changes, not to recommend or can't tell), says what is wrong, and leaves a comment.
// Reviews stay in this browser (localStorage); nothing is sent anywhere. They can be exported as JSON or CSV to
// share, and imported again. Claims (C…) and actions (X…) share one store, keyed by id.
import { escapeHtml as esc } from './site-lib.js';

const KEY = 'myrias-reviews-v1';
export const VERDICTS = ['correct', 'partly', 'wrong', 'unsure'];
export const ISSUES = ['quote', 'statement', 'english', 'practice', 'labels', 'direction'];
export const ACTION_ISSUES = ['evidence', 'overstated', 'who', 'practical', 'welfare', 'priority'];
// What differs between reviewing a claim and reviewing an action: the question, the answers' wording, the issues.
export const KINDS = {
  claim: { q: 'rv.q', v: 'rv.v.', issues: ISSUES, i: 'rv.i.' },
  action: { q: 'rv.a.q', v: 'rv.a.v.', issues: ACTION_ISSUES, i: 'rv.a.i.' }
};
export const kindOf = id => (/^X\d/.test(String(id)) ? 'action' : 'claim');

export function loadReviews() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function saveReview(id, review) {
  const all = loadReviews();
  if (review) all[id] = { ...review, at: new Date().toISOString() }; else delete all[id];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private window: kept for this page only */ }
  return all;
}

// Pure: rows for export, one per reviewed claim, with what the reviewer saw.
export function exportRows(reviews, claims) {
  return Object.entries(reviews).filter(([id]) => kindOf(id) === 'claim').map(([id, r]) => {
    const c = claims.get(id) || {};
    return { claim_id: id, source_id: c.source_id || null, page: c.locator?.page ?? null, verdict: r.verdict, issues: (r.issues || []).join(';'), comment: r.comment || '',
      reviewer: r.reviewer || '', reviewed_at: r.at, quote: c.quote || '', statement: c.text_en || c.statement || '', verification_by_model: c.verification || '' };
  });
}
// Pure: the same for reviewed actions.
export function exportActionRows(reviews, actions) {
  return Object.entries(reviews).filter(([id]) => kindOf(id) === 'action').map(([id, r]) => {
    const a = actions.get(id) || {};
    return { action_id: id, species: a.species_id || null, rank: a.rank ?? null, type: a.type || '', who: a.who || '', verdict: r.verdict, issues: (r.issues || []).join(';'),
      comment: r.comment || '', reviewer: r.reviewer || '', reviewed_at: r.at, action: a.action_en || a.action_zh || '', finding_ids: (a.finding_ids || []).join(';') };
  });
}
export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map(r => cols.map(k => cell(r[k])).join(','))].join('\n');
}

// Pure: what share of reviewed claims the reviewer found right, partly right or wrong, overall and by the model's verdict.
export function reviewStats(reviews, claims, kind = 'claim') {
  const out = { n: 0, by: {}, by_model: {} };
  for (const [id, r] of Object.entries(reviews)) {
    if (kindOf(id) !== kind) continue;
    out.n++; out.by[r.verdict] = (out.by[r.verdict] || 0) + 1;
    const mv = claims.get(id)?.verification || 'unknown';
    const m = out.by_model[mv] ||= {}; m[r.verdict] = (m[r.verdict] || 0) + 1;
  }
  return out;
}

// The review form for one claim or action. The claim's page, the action cards and the review page all use it.
export function reviewFormHtml(c, review, tr, { compact = false } = {}) {
  const r = review || {}, k = KINDS[kindOf(c.id)];
  return `<form class="rv-form${compact ? ' is-compact' : ''}" data-rv-form="${esc(c.id)}">
    <fieldset class="rv-verdicts"><legend>${esc(tr(k.q))}</legend>${VERDICTS.map((v, i) => `<label class="rv-v v-${v}"><input type="radio" name="verdict" value="${v}"${r.verdict === v ? ' checked' : ''}>
      <span><kbd>${i + 1}</kbd>${esc(tr(k.v + v))}</span></label>`).join('')}</fieldset>
    <fieldset class="rv-issues"><legend>${esc(tr('rv.issues'))}</legend>${k.issues.map(x => `<label><input type="checkbox" name="issues" value="${x}"${(r.issues || []).includes(x) ? ' checked' : ''}> ${esc(tr(k.i + x))}</label>`).join('')}</fieldset>
    <label class="rv-comment">${esc(tr('rv.comment'))}<textarea name="comment" rows="${compact ? 2 : 3}" placeholder="${esc(tr('rv.comment.ph'))}">${esc(r.comment || '')}</textarea></label>
    <div class="rv-row"><label class="rv-who">${esc(tr('rv.reviewer'))}<input type="text" name="reviewer" value="${esc(r.reviewer || '')}" placeholder="${esc(tr('rv.reviewer.ph'))}"></label>
      <button type="submit" class="button small">${esc(tr('rv.save'))}</button>${review ? `<button type="button" class="button small rv-clear" data-rv-clear>${esc(tr('rv.clear'))}</button>` : ''}
      <span class="rv-saved" data-rv-saved>${review ? esc(tr('rv.saved.at', { d: String(review.at || '').slice(0, 16).replace('T', ' ') })) : ''}</span></div></form>`;
}

// One handler on the document saves any review form, including forms drawn later (action rows appear as the
// list pages and filters). After a save or clear the form gets an 'rv:saved' event with { id, all }.
let trNow = k => k;
const lastReviewer = () => Object.values(loadReviews()).map(r => r.reviewer).filter(Boolean).pop() || '';
export function bindReviews(tr) {
  trNow = tr;
  if (bindReviews.done || typeof document === 'undefined') return;
  bindReviews.done = true;
  document.addEventListener('submit', e => {
    const form = e.target.closest?.('[data-rv-form]'); if (!form) return;
    e.preventDefault();
    const fd = new FormData(form), verdict = fd.get('verdict'), saved = form.querySelector('[data-rv-saved]');
    if (!verdict) { saved.textContent = trNow('rv.need'); return; }
    const all = saveReview(form.dataset.rvForm, { verdict, issues: fd.getAll('issues'), comment: String(fd.get('comment') || '').trim(), reviewer: String(fd.get('reviewer') || '').trim() });
    saved.textContent = trNow('rv.saved');
    form.dispatchEvent(new CustomEvent('rv:saved', { detail: { id: form.dataset.rvForm, all } }));
  });
  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-rv-clear]'); if (!b) return;
    const form = b.closest('[data-rv-form]'), all = saveReview(form.dataset.rvForm, null);
    form.reset(); form.querySelectorAll('input[type=radio],input[type=checkbox]').forEach(x => { x.checked = false; });
    form.querySelector('textarea').value = ''; form.querySelector('[data-rv-saved]').textContent = ''; b.remove();
    form.dispatchEvent(new CustomEvent('rv:saved', { detail: { id: form.dataset.rvForm, all } }));
  });
  // The reviewer's name carries over from their last review.
  document.addEventListener('focusin', e => { const who = e.target.closest?.('[data-rv-form] [name=reviewer]'); if (who && !who.value) who.value = lastReviewer(); });
}

// Wire the review forms under root. onSaved(id, reviews) runs after each save or clear.
export function mountReviewForms(root, tr, onSaved = () => {}) {
  bindReviews(tr);
  root.querySelectorAll('[data-rv-form]').forEach(form => {
    const who = form.querySelector('[name=reviewer]');
    if (who && !who.value) who.value = lastReviewer();
    form.addEventListener('rv:saved', e => onSaved(e.detail.id, e.detail.all));
  });
}

// A folded review block inside an action card.
export function actionReviewHtml(a, tr) {
  const r = loadReviews()[a.id];
  return `<details class="rv-inline"><summary>${esc(tr('rv.a.h'))}${r ? ` <span class="rv-badge v-${esc(r.verdict)}">${esc(tr('rv.a.v.' + r.verdict))}</span>` : ''}</summary>${reviewFormHtml(a, r, tr, { compact: true })}</details>`;
}

// The panel under a claim on its own page.
export function claimReviewPanelHtml(c, tr, link) {
  const r = loadReviews()[c.id];
  return `<section class="rv-panel" id="review"><h2>${esc(tr('rv.h'))}</h2><p class="small-note">${esc(tr('rv.note'))} <a href="${link('review')}">${esc(tr('rv.go'))} →</a></p>${reviewFormHtml(c, r, tr)}</section>`;
}

// One claim in the review queue: the paper, the quote, what the pipeline made of it, and the form.
export function reviewCardHtml(c, ctx) {
  const { tr, link, lang, sources, claimText, taxonomyLabel } = ctx;
  const s = sources.get(c.source_id);
  return `<article class="rv-card">
    <p class="rv-src">${esc(c.id)} · ${s ? `<a href="${link('sources/' + encodeURIComponent(s.id))}" lang="${esc(s.lang)}">${esc(s.title)}</a>${s.year ? ' · ' + esc(s.year) : ''}` : esc(c.source_id)} · ${esc(tr('rv.page', { p: c.locator?.page ?? '?' }))}</p>
    <h3 class="rv-quote-h">${esc(tr('rv.quote'))}</h3><blockquote class="quote" lang="${esc(c.quote_lang || 'und')}">${esc(c.quote)}</blockquote>
    <h3 class="rv-quote-h">${esc(tr('rv.made'))}</h3>
    <dl class="rv-made"><dt>${esc(tr('rv.statement'))}</dt><dd lang="${esc(c.statement_lang || 'und')}">${esc(c.statement || c.text_zh || '')}</dd>
      ${c.text_en && c.text_en !== c.statement ? `<dt>English</dt><dd lang="en">${esc(c.text_en)}</dd>` : ''}
      <dt>${esc(tr('rv.practice'))}</dt><dd>${esc(c.intervention || '—')}</dd>
      <dt>${esc(tr('rv.labels'))}</dt><dd>${esc([c.kind && tr('kind.' + c.kind), c.polarity && tr('pol.' + c.polarity), c.welfare_link && tr('welfare.' + c.welfare_link)].filter(Boolean).join(' · '))}</dd>
      <dt>${esc(tr('rv.model'))}</dt><dd>${esc(tr('ver.' + c.verification))}</dd></dl>
    ${reviewFormHtml(c, loadReviews()[c.id], tr, { compact: true })}
    <p class="rv-open"><a href="${link('claims/' + encodeURIComponent(c.id))}">${esc(tr('rv.openclaim'))} →</a></p></article>`;
}

// One action in the review queue: the action, why it was written, the findings it rests on, and the form.
export function reviewActionCardHtml(a, ctx) {
  const { tr, link, lang, findings, speciesName, taxonomyLabel } = ctx;
  const text = lang === 'zh' ? a.action_zh || a.action_en : a.action_en || a.action_zh;
  const fs = a.finding_ids.map(id => findings.get(id)).filter(Boolean);
  return `<article class="rv-card">
    <p class="rv-src">${esc(a.id)} · ${esc(speciesName(a.species_id))} · ${esc(tr('rv.a.rank', { r: a.rank ?? '—' }))} · ${esc(tr('ac.type.' + a.type))} · ${esc(tr('ac.who', { who: tr('ac.who.' + a.who.replace(/ /g, '_')) }))}</p>
    <h3 class="rv-quote-h">${esc(tr('rv.a.action'))}</h3><blockquote class="quote rv-action">${esc(text)}</blockquote>
    <dl class="rv-made"><dt>${esc(tr('rv.labels'))}</dt><dd>${esc(a.welfare_problems.map(p => taxonomyLabel('welfare_problems', p)).join(' · '))}</dd>
      ${a.basis?.reason ? `<dt>${esc(tr('ac.reason'))}</dt><dd>${esc(a.basis.reason)}</dd>` : ''}
      <dt>${esc(tr('ac.gap'))}</dt><dd>${esc(a.evidence_gap || '—')}</dd><dt>${esc(tr('ac.risks'))}</dt><dd>${esc(a.risks || '—')}</dd>
      ${a.priority?.reason ? `<dt>${esc(tr('ac.rank.why'))}</dt><dd>${esc(a.priority.reason)}</dd>` : ''}</dl>
    <h3 class="rv-quote-h">${esc(tr(fs.length === 1 ? 'ac.why.one' : 'ac.why', { n: fs.length }))}</h3>
    <ul class="rv-findings">${fs.map(f => `<li><a href="${link('findings/' + encodeURIComponent(f.id))}">${esc(f.id)}</a> ${esc(lang === 'zh' ? f.statement_zh || f.statement_en : f.statement_en || f.statement_zh)} <span class="fd-meta">${esc(tr('fd.strength.' + f.strength))} · ${esc(tr('fd.papers', { n: f.counts.papers }))}</span></li>`).join('')}</ul>
    ${reviewFormHtml(a, loadReviews()[a.id], tr, { compact: true })}
    <p class="rv-open"><a href="${link('actions', { q: a.id })}">${esc(tr('rv.a.open'))} →</a></p></article>`;
}

