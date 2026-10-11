// Corpus page: every paper we found, with its tags and details. Reads data/corpus-papers.json
// (bibliographic details only; abstracts and full text stay in the private dataset).
import { escapeHtml as esc, safeUrl } from './site-lib.js';

export const PAGE = 50;
export const FILTER_DEFAULTS = { q: '', lang: 'all', topic: 'all', ft: 'all', set: 'all', about: true, sort: 'new' };

// The file is in column format ({fields, rows}); a file of 'x' means the Europe PMC full-text pages.
export function unpackPapers(j) {
  if (Array.isArray(j.papers)) return j.papers;
  return (j.rows || []).map(r => {
    const p = Object.fromEntries(j.fields.map((k, i) => [k, r[i]]));
    if (p.file === 'x') p.file = 'intake/xml-pages.jsonl';
    for (const k of ['authors', 'sources', 'topics']) p[k] = p[k] || [];
    return p;
  });
}

// Pure: which papers a filter keeps, in order.
export function filterPapers(papers, f) {
  const q = (f.q || '').trim().toLowerCase();
  const hit = p => !q || [p.title, p.venue, p.doi, p.pmid, p.pmcid, ...(p.authors || [])].some(x => String(x || '').toLowerCase().includes(q));
  const ft = p => (f.ft === 'all' ? true : f.ft === 'with' ? Boolean(p.full_text) : !p.full_text);
  const out = papers.filter(p => hit(p) && (f.lang === 'all' || p.lang === f.lang) && (f.topic === 'all' || (p.topics || []).includes(f.topic))
    && ft(p) && (f.set === 'all' || p.set === f.set) && (!f.about || p.about));
  const year = p => p.year || 0;
  if (f.sort === 'old') out.sort((a, b) => (year(a) || 9999) - (year(b) || 9999));
  else if (f.sort === 'title') out.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  else out.sort((a, b) => year(b) - year(a));
  return out;
}

const chip = (cls, text, title = '') => `<span class="cl-tag ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;

export function tagsHtml(p, tr) {
  const t = [chip('t-lang', p.lang === 'zh' ? '中文' : 'EN')];
  if (p.set === 'first-run') t.push(chip('t-first', tr('cl.tag.first')));
  if (p.full_text) t.push(chip('t-ft', tr('cl.tag.ft.' + p.full_text)));
  else if (p.tried) t.push(chip('t-noft', tr('cl.tag.why.' + (p.why_not || 'failed'))));
  if (!p.about) t.push(chip('t-out', tr('cl.tag.outside')));
  for (const k of p.topics || []) t.push(chip('t-topic', tr('cv.topic.' + k)));
  for (const s of p.sources || []) t.push(chip('t-src', tr('corpus.src.' + s)));
  return `<span class="cl-tags">${t.join('')}</span>`;
}

export function paperHtml(p, tr, c) {
  const link = (url, text) => (safeUrl(url) ? `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>` : '');
  const ids = [p.doi && link(`https://doi.org/${p.doi}`, `DOI ${p.doi}`), p.pmid && link(`https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`, `PubMed ${p.pmid}`),
    p.pmcid && link(`https://europepmc.org/article/PMC/${p.pmcid}`, p.pmcid)].filter(Boolean).join(' · ');
  const open = [p.landing && link(p.landing, tr('cl.f.landing')), p.pdf_url && link(p.pdf_url, tr('cl.f.pdfurl'))].filter(Boolean).join(' · ');
  const file = p.file && c ? link(`https://huggingface.co/datasets/${c.repo}/blob/main/${c.species}/${p.file.split('/').map(encodeURIComponent).join('/')}`, p.file) : '';
  const ft = p.full_text ? tr('cl.tag.ft.' + p.full_text) : p.tried ? tr('cl.tag.why.' + (p.why_not || 'failed')) : tr('cl.notried');
  const rows = [
    [tr('cl.f.authors'), esc((p.authors || []).join(', ') || '—')], [tr('cl.f.venue'), esc(p.venue || '—')], [tr('cl.f.year'), esc(p.year || '—')],
    p.type ? [tr('cl.f.type'), esc(p.type)] : null, [tr('cl.f.ids'), ids || '—'], [tr('cl.f.found'), esc((p.sources || []).map(s => tr('corpus.src.' + s)).join(', '))],
    [tr('cl.f.topics'), esc((p.topics || []).map(k => tr('cv.topic.' + k)).join(', ') || tr('cl.notopic'))], [tr('cl.f.fulltext'), esc(ft)],
    file ? [tr('cl.f.file'), file] : null, open ? [tr('cl.f.links'), open] : null, [tr('cl.f.id'), `<code>${esc(p.id)}</code>`]
  ].filter(Boolean);
  const meta = [p.year, p.venue, (p.authors || []).slice(0, 3).join(', ') + ((p.authors || []).length > 3 ? ' …' : '')].filter(Boolean).map(x => esc(x)).join(' · ');
  return `<li><details class="cl-paper"><summary><span class="cl-title" ${p.lang === 'zh' ? 'lang="zh-Hans"' : ''}>${esc(p.title)}</span><span class="cl-meta">${meta}</span>${tagsHtml(p, tr)}</summary>
    <dl class="cl-facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl></details></li>`;
}

export function controlsHtml(f, topics, tr) {
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  return `<div class="cl-controls">
    <input type="search" data-cl="q" value="${esc(f.q)}" placeholder="${esc(tr('cl.search'))}" aria-label="${esc(tr('cl.search'))}">
    <select data-cl="lang" aria-label="${esc(tr('cl.lang'))}">${opt('all', tr('cl.lang.all'), f.lang)}${opt('en', tr('cv.lang.en'), f.lang)}${opt('zh', tr('cv.lang.zh'), f.lang)}</select>
    <select data-cl="topic" aria-label="${esc(tr('cl.topic'))}">${opt('all', tr('cl.topic.all'), f.topic)}${topics.map(k => opt(k, tr('cv.topic.' + k), f.topic)).join('')}</select>
    <select data-cl="ft" aria-label="${esc(tr('cl.ft'))}">${opt('all', tr('cl.ft.all'), f.ft)}${opt('with', tr('cl.ft.with'), f.ft)}${opt('without', tr('cl.ft.without'), f.ft)}</select>
    <select data-cl="set" aria-label="${esc(tr('cl.set'))}">${opt('all', tr('cl.set.all'), f.set)}${opt('intake', tr('cl.set.intake'), f.set)}${opt('first-run', tr('cl.set.first'), f.set)}</select>
    <select data-cl="sort" aria-label="${esc(tr('cl.sort'))}">${opt('new', tr('cl.sort.new'), f.sort)}${opt('old', tr('cl.sort.old'), f.sort)}${opt('title', tr('cl.sort.title'), f.sort)}</select>
    <label class="cl-check"><input type="checkbox" data-cl="about" ${f.about ? 'checked' : ''}> ${esc(tr('cl.about'))}</label></div>`;
}

// Wires the controls to the list. Re-renders only the list, so typing keeps focus.
export function mountCorpusList(root, papers, c, tr, state) {
  const f = state.filter || (state.filter = { ...FILTER_DEFAULTS });
  let shown = PAGE;
  const list = root.querySelector('[data-cl-list]'), count = root.querySelector('[data-cl-count]'), more = root.querySelector('[data-cl-more]');
  const draw = () => {
    const rows = filterPapers(papers, f);
    count.textContent = tr('cl.showing', { n: Math.min(shown, rows.length).toLocaleString(), total: rows.length.toLocaleString() });
    list.innerHTML = rows.length ? rows.slice(0, shown).map(p => paperHtml(p, tr, c)).join('') : `<li class="cl-none">${esc(tr('cl.none'))}</li>`;
    more.hidden = rows.length <= shown;
    more.textContent = tr('cl.more', { n: Math.min(PAGE, rows.length - shown).toLocaleString() });
  };
  root.querySelectorAll('[data-cl]').forEach(el => el.addEventListener(el.type === 'search' ? 'input' : 'change', () => {
    f[el.dataset.cl] = el.type === 'checkbox' ? el.checked : el.value; shown = PAGE; draw();
  }));
  more.addEventListener('click', () => { shown += PAGE; draw(); });
  draw();
}
