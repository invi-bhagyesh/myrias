// Expert review (front-end demo): a reviewer marks each claim right, partly right, wrong or can't tell, says
// which part is wrong, and leaves a comment. Reviews stay in this browser (localStorage); nothing is sent
// anywhere. They can be exported as JSON or CSV to share, and imported again.
import { escapeHtml as esc } from './site-lib.js';

const KEY = 'myrias-reviews-v1';
export const VERDICTS = ['correct', 'partly', 'wrong', 'unsure'];
export const ISSUES = ['quote', 'statement', 'english', 'practice', 'labels', 'direction'];

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
  return Object.entries(reviews).map(([id, r]) => {
    const c = claims.get(id) || {};
    return { claim_id: id, source_id: c.source_id || null, page: c.locator?.page ?? null, verdict: r.verdict, issues: (r.issues || []).join(';'), comment: r.comment || '',
      reviewer: r.reviewer || '', reviewed_at: r.at, quote: c.quote || '', statement: c.text_en || c.statement || '', verification_by_model: c.verification || '' };
  });
}
export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map(r => cols.map(k => cell(r[k])).join(','))].join('\n');
}

// Pure: what share of reviewed claims the reviewer found right, partly right or wrong, overall and by the model's verdict.
export function reviewStats(reviews, claims) {
  const out = { n: 0, by: {}, by_model: {} };
  for (const [id, r] of Object.entries(reviews)) {
    out.n++; out.by[r.verdict] = (out.by[r.verdict] || 0) + 1;
    const mv = claims.get(id)?.verification || 'unknown';
    const m = out.by_model[mv] ||= {}; m[r.verdict] = (m[r.verdict] || 0) + 1;
  }
  return out;
}

// The review form for one claim. The claim's own page and the review page both use it.
export function reviewFormHtml(c, review, tr, { compact = false } = {}) {
  const r = review || {};
  return `<form class="rv-form${compact ? ' is-compact' : ''}" data-rv-form="${esc(c.id)}">
    <fieldset class="rv-verdicts"><legend>${esc(tr('rv.q'))}</legend>${VERDICTS.map((v, i) => `<label class="rv-v v-${v}"><input type="radio" name="verdict" value="${v}"${r.verdict === v ? ' checked' : ''}>
      <span><kbd>${i + 1}</kbd>${esc(tr('rv.v.' + v))}</span></label>`).join('')}</fieldset>
    <fieldset class="rv-issues"><legend>${esc(tr('rv.issues'))}</legend>${ISSUES.map(k => `<label><input type="checkbox" name="issues" value="${k}"${(r.issues || []).includes(k) ? ' checked' : ''}> ${esc(tr('rv.i.' + k))}</label>`).join('')}</fieldset>
    <label class="rv-comment">${esc(tr('rv.comment'))}<textarea name="comment" rows="${compact ? 2 : 3}" placeholder="${esc(tr('rv.comment.ph'))}">${esc(r.comment || '')}</textarea></label>
    <div class="rv-row"><label class="rv-who">${esc(tr('rv.reviewer'))}<input type="text" name="reviewer" value="${esc(r.reviewer || '')}" placeholder="${esc(tr('rv.reviewer.ph'))}"></label>
      <button type="submit" class="button small">${esc(tr('rv.save'))}</button>${review ? `<button type="button" class="button small rv-clear" data-rv-clear>${esc(tr('rv.clear'))}</button>` : ''}
      <span class="rv-saved" data-rv-saved>${review ? esc(tr('rv.saved.at', { d: String(review.at || '').slice(0, 16).replace('T', ' ') })) : ''}</span></div></form>`;
}

// Wire every review form under root. onSaved(id, reviews) runs after each save or clear.
export function mountReviewForms(root, tr, onSaved = () => {}) {
  const lastReviewer = () => Object.values(loadReviews()).map(r => r.reviewer).filter(Boolean).pop() || '';
  root.querySelectorAll('[data-rv-form]').forEach(form => {
    const who = form.querySelector('[name=reviewer]');
    if (who && !who.value) who.value = lastReviewer();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(form), verdict = fd.get('verdict');
      const saved = form.querySelector('[data-rv-saved]');
      if (!verdict) { saved.textContent = tr('rv.need'); return; }
      const all = saveReview(form.dataset.rvForm, { verdict, issues: fd.getAll('issues'), comment: String(fd.get('comment') || '').trim(), reviewer: String(fd.get('reviewer') || '').trim() });
      saved.textContent = tr('rv.saved');
      onSaved(form.dataset.rvForm, all);
    });
    form.querySelector('[data-rv-clear]')?.addEventListener('click', () => { const all = saveReview(form.dataset.rvForm, null); onSaved(form.dataset.rvForm, all); });
  });
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

