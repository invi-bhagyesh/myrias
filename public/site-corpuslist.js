// Corpus page: every paper we found, with its tags and details. Reads data/corpus-papers.json
// (bibliographic details only; abstracts and full text stay in the private dataset).
import { escapeHtml as esc, safeUrl } from './site-lib.js';

export const PAGE = 50;
// Every paper is shown by default, screened out or not, so the filtering can be audited.
export const FILTER_DEFAULTS = { q: '', lang: 'all', topic: 'all', ft: 'all', set: 'all', stage: 'all', group: 'all', species: 'all', sort: 'new' };
export const STAGES = ['read', 'read_no_claims', 'no_full_text', 'screened_out'];

// The file is in column format ({fields, rows}); a file of 'x' means the Europe PMC full-text pages.
export function unpackPapers(j) {
  if (Array.isArray(j.papers)) return j.papers;
  return (j.rows || []).map(r => {
    const p = Object.fromEntries(j.fields.map((k, i) => [k, r[i]]));
    if (p.file === 'x') p.file = 'intake/xml-pages.jsonl';
    for (const k of ['authors', 'sources', 'topics', 'why_out']) p[k] = p[k] || [];
    p.stage ||= p.about === false ? 'screened_out' : p.full_text ? 'read' : 'no_full_text';
    return p;
  });
}

// Pure: which papers a filter keeps, in order.
export function filterPapers(papers, f) {
  const q = (f.q || '').trim().toLowerCase();
  const hit = p => !q || [p.title, p.title_en, p.venue, p.doi, p.pmid, p.pmcid, p.source_id, p.institution, ...(p.authors || [])].some(x => String(x || '').toLowerCase().includes(q));
  const ft = p => (f.ft === 'all' ? true : f.ft === 'with' ? Boolean(p.full_text) : !p.full_text);
  const out = papers.filter(p => hit(p) && (f.lang === 'all' || p.lang === f.lang) && (f.topic === 'all' || (p.topics || []).includes(f.topic))
    && ft(p) && (f.set === 'all' || p.set === f.set) && (!f.stage || f.stage === 'all' || p.stage === f.stage)
    && (!f.group || f.group === 'all' || p.inst_group === f.group) && (!f.species || f.species === 'all' || p.species === f.species));
  const year = p => p.year || 0;
  if (f.sort === 'old') out.sort((a, b) => (year(a) || 9999) - (year(b) || 9999));
  else if (f.sort === 'title') out.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  else out.sort((a, b) => year(b) - year(a));
  return out;
}

const chip = (cls, text, title = '') => `<span class="cl-tag ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;

export function tagsHtml(p, tr) {
  const t = [chip('t-lang', p.lang === 'zh' ? '中文' : 'EN')];
  t.push(chip('t-stage s-' + p.stage, p.stage === 'read' && p.claims ? tr('cl.stage.read.n', { n: p.claims }) : tr('cl.stage.' + p.stage)));
  for (const w of p.why_out || []) t.push(chip('t-out', tr('cl.why.' + w)));
  if (p.set === 'first-run' || p.set === 'supplied') t.push(chip('t-first', tr('cl.tag.' + (p.set === 'supplied' ? 'supplied' : 'first'))));
  if (p.full_text) t.push(chip('t-ft', tr('cl.tag.ft.' + p.full_text)));
  else if (p.tried) t.push(chip('t-noft', tr('cl.tag.why.' + (p.why_not || 'failed'))));
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
    [tr('cl.f.stage'), esc(tr('cl.stage.' + p.stage)) + ((p.why_out || []).length ? ': ' + esc(p.why_out.map(w => tr('cl.why.' + w)).join(', ')) : '')],
    p.source_id ? [tr('cl.f.read'), `<a href="#/sources/${esc(encodeURIComponent(p.source_id))}">${esc(p.source_id)}</a>${p.claims ? ' · ' + esc(tr('cl.stage.read.n', { n: p.claims })) : ''}`] : null,
    p.institution ? [tr('cl.f.inst'), esc(p.institution)] : null,
    file ? [tr('cl.f.file'), file] : null, open ? [tr('cl.f.links'), open] : null, [tr('cl.f.id'), `<code>${esc(p.id)}</code>`]
  ].filter(Boolean);
  const meta = [p.year, p.venue, (p.authors || []).slice(0, 3).join(', ') + ((p.authors || []).length > 3 ? ' …' : '')].filter(Boolean).map(x => esc(x)).join(' · ');
  return `<li><details class="cl-paper"><summary><span class="cl-title" ${p.lang === 'zh' ? 'lang="zh-Hans"' : ''}>${esc(p.title)}</span><span class="cl-meta">${meta}</span>${tagsHtml(p, tr)}</summary>
    <dl class="cl-facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl></details></li>`;
}

// species: [[id, name, count, image]] of the species in the list; the species tabs show when there is more than one.
export function controlsHtml(f, topics, tr, species = []) {
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  const total = species.reduce((n, x) => n + (x[2] || 0), 0);
  const tab = (id, name, n, img) => `<button type="button" class="sp-tab" data-cl-species="${esc(id)}"${(f.species || 'all') === id ? ' aria-current="page"' : ''}>${img ? `<img src="${esc(img)}" alt="" width="40" height="36">` : '<span class="sp-tab-all" aria-hidden="true">✶</span>'}<span>${esc(name)}</span><b>${Number(n).toLocaleString()}</b></button>`;
  const tabs = species.length > 1 ? `<div class="sp-tabs" role="group" aria-label="${esc(tr('nav.species'))}">${tab('all', tr('cl.species.all'), total)}${species.map(([id, name, n, img]) => tab(id, name, n, img)).join('')}</div>` : '';
  return `${tabs}<div class="cl-controls">
    <input type="search" data-cl="q" value="${esc(f.q)}" placeholder="${esc(tr('cl.search'))}" aria-label="${esc(tr('cl.search'))}">
    <select data-cl="lang" aria-label="${esc(tr('cl.lang'))}">${opt('all', tr('cl.lang.all'), f.lang)}${opt('en', tr('cv.lang.en'), f.lang)}${opt('zh', tr('cv.lang.zh'), f.lang)}</select>
    <select data-cl="topic" aria-label="${esc(tr('cl.topic'))}">${opt('all', tr('cl.topic.all'), f.topic)}${topics.map(k => opt(k, tr('cv.topic.' + k), f.topic)).join('')}</select>
    <select data-cl="ft" aria-label="${esc(tr('cl.ft'))}">${opt('all', tr('cl.ft.all'), f.ft)}${opt('with', tr('cl.ft.with'), f.ft)}${opt('without', tr('cl.ft.without'), f.ft)}</select>
    <select data-cl="stage" aria-label="${esc(tr('cl.stage'))}">${opt('all', tr('cl.stage.all'), f.stage)}${STAGES.map(s => opt(s, tr('cl.stage.' + s), f.stage)).join('')}</select>
    <select data-cl="set" aria-label="${esc(tr('cl.set'))}">${opt('all', tr('cl.set.all'), f.set)}${opt('intake', tr('cl.set.intake'), f.set)}${opt('supplied', tr('cl.set.supplied'), f.set)}</select>
    <select data-cl="group" aria-label="${esc(tr('cl.group'))}">${opt('all', tr('cl.group.all'), f.group)}${['cn_university', 'cn_institute', 'cn_company', 'cn_other', 'KR', 'JP', 'unknown'].map(g => opt(g, tr('cl.group.' + g), f.group)).join('')}</select>
    <select data-cl="sort" aria-label="${esc(tr('cl.sort'))}">${opt('new', tr('cl.sort.new'), f.sort)}${opt('old', tr('cl.sort.old'), f.sort)}${opt('title', tr('cl.sort.title'), f.sort)}</select>
    </div><details class="cl-insts" data-cl-insts><summary>${esc(tr('cl.insts'))}</summary><ol data-cl-inst-list></ol></details>`;
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
  root.querySelectorAll('[data-cl-species]').forEach(b => b.addEventListener('click', () => {
    f.species = b.dataset.clSpecies; shown = PAGE;
    root.querySelectorAll('[data-cl-species]').forEach(x => x.toggleAttribute('aria-current', x === b));
    root.querySelectorAll('[data-cl-species][aria-current]').forEach(x => x.setAttribute('aria-current', 'page'));
    draw();
  }));
  // Institutions, most papers first: clicking one searches for it.
  const insts = [...papers.reduce((m, p) => (p.institution ? m.set(p.institution, (m.get(p.institution) || 0) + 1) : m), new Map())].sort((a, b) => b[1] - a[1]);
  const il = root.querySelector('[data-cl-inst-list]');
  if (il) {
    il.innerHTML = insts.map(([name, k]) => `<li><button type="button" data-inst="${esc(name)}">${esc(name)}</button><b>${k}</b></li>`).join('');
    il.addEventListener('click', e => {
      const b = e.target.closest('[data-inst]'); if (!b) return;
      f.q = b.dataset.inst; const box = root.querySelector('[data-cl="q"]'); if (box) box.value = f.q; shown = PAGE; draw();
      root.querySelector('[data-cl-count]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  draw();
}
