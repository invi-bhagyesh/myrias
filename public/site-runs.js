// Run history on the Pipeline page: one card per run, newest first, from data/runs.json (written by
// pipeline/runlog.mjs). Each card says what the run read, what changed since the run before (models,
// prompts, the ranking spec, code, and notes written by people), how long each step took, and what the run
// added or changed. No costs: they stay in the private store.
import { escapeHtml as esc, linkIds } from './site-lib.js';

const REPO = 'https://github.com/invi-bhagyesh/myrias/commit/';
const n = x => (x === null || x === undefined ? '—' : Number(x).toLocaleString());
const day = s => (s ? String(s).slice(0, 10) : '');
const dur = s => { if (!s && s !== 0) return '—'; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : m ? `${m} min` : `${s} s`; };
const signed = x => (x > 0 ? '+' : '') + n(x);

export function runCardHtml(r, ctx) {
  const { tr, link } = ctx;
  const steps = r.steps || [], ch = r.changes || {}, res = r.results;
  const secs = steps.reduce((s, x) => s + (x.seconds || 0), 0), calls = steps.reduce((s, x) => s + (x.calls || 0), 0);
  const inputs = r.inputs ? `<p class="rn-in"><b>${n(r.inputs.papers)}</b> ${esc(tr('rn.papers'))}${r.inputs.by_lang ? ' · ' + Object.entries(r.inputs.by_lang).map(([l, v]) => `${n(v)} ${esc(tr('lang.' + l))}`).join(', ') : ''}
      ${r.inputs.by_origin ? `<span class="rn-chips">${Object.entries(r.inputs.by_origin).map(([o, v]) => `<span>${esc(o)} · ${n(v)}</span>`).join('')}</span>` : ''}</p>${r.inputs.note_en ? `<p class="small-note">${linkIds(r.inputs.note_en, link)}</p>` : ''}` : '';
  const kindIcon = { model: '◆', prompt: '✎', spec: '⚖' };
  const changes = [...(ch.settings || []).map(c => `<li class="rn-ch k-${esc(c.kind)}"><i aria-hidden="true">${kindIcon[c.kind] || '•'}</i>${linkIds(c.en, link)}</li>`),
    ...(ch.notes || []).map(c => `<li class="rn-ch k-note"><i aria-hidden="true">✦</i>${linkIds(c.en, link)}</li>`)].join('');
  const code = (ch.code || []).length ? `<details class="rn-fold"><summary>${esc(tr('rn.code', { n: ch.code.length }))}</summary><ul class="rn-code">${ch.code.map(c =>
    `<li><a href="${esc(REPO + c.commit)}" target="_blank" rel="noopener"><code>${esc(c.commit)}</code></a><span>${esc(c.date)}</span>${esc(c.en)}</li>`).join('')}</ul></details>` : '';
  const stepRows = steps.length ? `<details class="rn-fold"><summary>${esc(tr('rn.steps', { n: steps.length, t: dur(secs), c: n(calls) }))}</summary><table class="rn-steps"><thead><tr>
      <th>${esc(tr('rn.step'))}</th><th>${esc(tr('rn.started'))}</th><th>${esc(tr('rn.time'))}</th><th>${esc(tr('rn.calls'))}</th><th>${esc(tr('rn.rows'))}</th></tr></thead><tbody>${steps.map(s =>
      `<tr${s.exit_code ? ' class="is-fail"' : ''}><td>${s.phase ? `<span class="rn-ph">${esc(s.phase)}</span>` : ''}${esc(s.step)}</td><td>${esc(String(s.started || '').slice(5, 16).replace('T', ' '))}</td><td>${esc(dur(s.seconds))}</td><td>${n(s.calls)}</td><td>${n(s.rows_out)}</td></tr>`).join('')}</tbody></table></details>` : '';
  const tiles = res ? `<ul class="rn-res">
      <li><strong>${signed(res.claims.added)}</strong><span>${esc(tr('rn.claims', { n: n(res.claims.after) }))}</span></li>
      <li><strong>${signed(res.papers.added)}</strong><span>${esc(tr('rn.papersin', { n: n(res.papers.after) }))}</span></li>
      <li><strong>${n(res.findings.total)}</strong><span>${esc(tr('rn.findings', { a: n(res.findings.new), r: n(res.findings.rewritten), u: n(res.findings.unchanged), g: n(res.findings.gone) }))}</span></li>
      <li><strong>${n(res.actions.after)}</strong><span>${esc(tr('rn.actions', { b: n(res.actions.before), s: n(res.actions.same_text) }))}</span></li></ul>
      ${res.funnel ? `<p class="small-note">${esc(tr('rn.funnel', { e: n(res.funnel.claims_extracted), q: n(res.funnel.quote_found), w: n(res.funnel.about_welfare), r: n(res.funnel.released) }))}</p>` : ''}
      ${res.note_en ? `<p class="small-note">${linkIds(res.note_en, link)}</p>` : ''}` : `<p class="small-note">${esc(tr('rn.pending'))}</p>`;
  const models = Object.entries(r.settings?.models || {}).map(([k, m]) => `<span><i>${esc(k)}</i>${esc(m.split('/').pop())}</span>`).join('');
  return `<article class="rn st-${esc(r.status)}" id="run-${esc(r.id)}"><header class="rn-h"><div><span class="rn-id">${esc(r.id)}</span><h3>${esc(r.title_en || r.id)}</h3></div>
      <p class="rn-meta"><span class="rn-st">${esc(tr('rn.status.' + r.status))}</span>${esc(day(r.started))}${r.finished && day(r.finished) !== day(r.started) ? ' – ' + esc(day(r.finished)) : ''}${secs ? ' · ' + esc(dur(secs)) : ''}${calls ? ' · ' + esc(tr('rn.ncalls', { n: n(calls) })) : ''}${r.git?.commit ? ` · <a href="${esc(REPO + r.git.commit)}" target="_blank" rel="noopener"><code>${esc(r.git.commit)}</code></a>` : ''}</p></header>
    <div class="rn-body"><section><h4>${esc(tr('rn.read'))}</h4>${inputs}${models ? `<p class="rn-models">${models}</p>` : ''}${r.settings?.window_en ? `<p class="small-note">${esc(r.settings.window_en)}</p>` : ''}</section>
      <section><h4>${esc(ch.since ? tr('rn.changed', { prev: ch.since }) : tr('rn.first'))}</h4>${changes ? `<ul class="rn-changes">${changes}</ul>` : `<p class="small-note">${esc(tr('rn.nochange'))}</p>`}${code}</section>
      <section><h4>${esc(tr('rn.result'))}</h4>${tiles}</section></div>${stepRows}</article>`;
}

export function runsHtml(R, ctx) {
  if (!R?.runs?.length) return '';
  const { tr } = ctx;
  return `<section class="rn-wrap" id="runs" aria-labelledby="runs-title"><div class="record-type">${esc(tr('rn.kicker'))}</div><h2 id="runs-title">${esc(tr('rn.title'))}</h2>
    <p class="rn-lead">${esc(tr('rn.lead'))}</p><ol class="rn-list">${R.runs.map(r => `<li>${runCardHtml(r, ctx)}</li>`).join('')}</ol></section>`;
}
