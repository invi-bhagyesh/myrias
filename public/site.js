import { t } from './i18n.js';
import * as L from './site-lib.js';
import { pixelHills } from './site-art.js';
import { STAGES, funnel } from './site-pipeline.js';

import { buildGraph, placeholderGraph, simplifyGraph, mountGraph, legendHtml, MIN_REAL_CLAIMS } from './site-graph.js';

const { escapeHtml: esc, safeUrl, pick } = L;
const ISSUES_URL = 'https://github.com/invi-bhagyesh/myrias/issues/new';
const $ = selector => document.querySelector(selector);
const params0 = new URLSearchParams(location.search);
const useSample = params0.get('data') === 'sample';

const state = { data: null, error: null, lang: 'en', index: null, lastPath: null, graphView: null };
const tr = (key, vars) => t(state.lang, key, vars);

function store(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  return null;
}

// ---------- data ----------
async function load() {
  state.error = null;
  try {
    const response = await fetch(useSample ? 'data/sample.json' : 'data/release.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const problems = L.validateExport(data);
    if (problems.length) throw new Error('Invalid export: ' + problems.slice(0, 3).join('; '));
    state.data = data;
    const map = list => new Map(list.map(x => [x.id, x]));
    state.index = {
      species: map(data.species), sources: map(data.sources), claims: map(data.claims),
      interventions: map(data.interventions), applications: map(data.applications)
    };
  } catch (error) {
    state.data = null;
    state.error = error.message;
  }
}

const taxonomyLabel = (kind, id) => {
  const entry = state.data.taxonomy[kind].find(x => x.id === id);
  return entry ? pick(entry, '', state.lang) : id;
};
const speciesName = id => { const s = state.index.species.get(id); return s ? pick(s, 'common', state.lang) : id; };
const interventionName = id => { const i = state.index.interventions.get(id); return i ? pick(i, 'name', state.lang) : id; };

// ---------- routing ----------
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(query) };
}
function link(path = '', query = {}) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all')).toString();
  return `#/${path}${q ? '?' + q : ''}`;
}

// ---------- small renderers ----------
const badge = (cls, text) => `<span class="badge ${cls}">${esc(text)}</span>`;
const langBadge = lang => badge('b-lang', tr(`lang.${lang}`));
const verBadge = v => badge(`b-ver-${v}`, tr(`ver.${v}`));
const kindBadge = k => badge('b-kind', tr(`kind.${k}`));
const auditBadge = a => badge(`b-audit-${a}`, tr(`audit.${a}`));
const orUnknown = v => (v === null || v === undefined || v === '' ? `<span class="unknown">${esc(tr('unknown'))}</span>` : esc(v));
const dl = rows => `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
const lead = (kicker, title, desc, aside = '') => `<section class="lead"><div><div class="record-type">${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>${aside}</section>`;
const empty = (title, text) => `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;

function issueLink(title, body) {
  return `${ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

// ---------- views ----------
function viewPipeline() {
  const i = state.lang === 'zh' ? 1 : 0;
  const run = state.data.runs[0];
  const stages = STAGES.map(st => `<article class="pipe-stage st-${st.status}"><div class="pipe-id"><span>${esc(st.id)}</span></div>
    <div class="pipe-body"><div class="pipe-head"><h3>${esc(st.name[i])}</h3><span class="pipe-badge">${esc(tr('pipe.status.' + st.status))}</span></div>
      <p class="pipe-what">${esc(st.what[i])}</p>
      <dl class="pipe-facts"><dt>${esc(tr('pipe.how'))}</dt><dd>${esc(st.how[i])}</dd>
        <dt>${esc(tr('pipe.model'))}</dt><dd>${st.model ? `<code>${esc(st.model)}</code>` : esc(tr('pipe.nomodel'))}</dd>
        <dt>${esc(tr('pipe.out'))}</dt><dd>${esc(st.out[i])}</dd>${st.check ? `<dt>${esc(tr('pipe.check'))}</dt><dd>${esc(st.check[i])}</dd>` : ''}</dl></div></article>`).join('');
  const steps = funnel(run), top = steps.length ? Math.max(...steps.map(x => x.value)) : 1;
  const bars = steps.length ? `<h2>${esc(tr('pipe.funnel'))}</h2><p class="small-note">${esc(tr('pipe.funnel.note'))}</p><ol class="funnel">${steps.map(x => `<li><span class="funnel-label">${esc(x.label[i])}</span><span class="funnel-bar"><i style="width:${Math.max(3, Math.round(100 * x.value / top))}%"></i></span><b>${x.value}</b></li>`).join('')}</ol>` : '';
  return { title: tr('nav.pipeline'), html: lead(tr('pipe.kicker'), tr('pipe.title'), tr('pipe.lead')) + bars + `<h2>${esc(tr('pipe.stages'))}</h2><div class="pipe-flow">${stages}</div>` };
}

function viewExplore(params) {
  const d = state.data;
  const speciesId = params.get('species') || 'all';
  const matrix = L.buildMatrix(d, speciesId);
  const selected = params.get('cell') || '';
  const supported = d.claims.filter(c => c.verification === 'supported').length;
  const zhSources = d.sources.filter(s => s.lang === 'zh').length;
  const aside = `<aside class="lead-aside"><h2>${esc(tr('land.ledger'))}</h2><dl class="ledger">
    <dt>${esc(tr('land.l.species'))}</dt><dd>${d.species.length}</dd>
    <dt>${esc(tr('land.l.apps'))}</dt><dd>${d.applications.length}</dd>
    <dt>${esc(tr(isDemo(d) ? 'land.l.claims.demo' : 'land.l.claims'))}</dt><dd>${supported}</dd>
    <dt>${esc(tr('land.l.sources'))}</dt><dd>${d.sources.length}</dd>
    <dt>${esc(tr('land.l.zh'))}</dt><dd>${zhSources}</dd></dl></aside>`;

  const speciesOptions = [`<option value="all">${esc(tr('land.allspecies'))}</option>`]
    .concat(d.species.map(s => `<option value="${esc(s.id)}" ${s.id === speciesId ? 'selected' : ''}>${esc(pick(s, 'common', state.lang))}</option>`)).join('');

  const head = matrix.columns.map(c => `<th scope="col">${esc(pick(c, '', state.lang))}</th>`).join('');
  const body = matrix.rows.map(row => {
    const cells = row.cells.map(cell => {
      const key = `${cell.problem_id}|${cell.class_id}`;
      const label = `${pick(row.problem, '', state.lang)} × ${pick(matrix.columns.find(c => c.id === cell.class_id), '', state.lang)}: ${tr('cell.' + cell.status)}${cell.status === 'has_records' ? ` (${cell.applications.length})` : ''}`;
      const inner = cell.status === 'has_records' ? `<strong>${cell.applications.length}</strong>`
        : cell.status === 'probed_empty' ? `<span aria-hidden="true">0</span><small>${esc(tr('cell.probed_empty'))}</small>`
        : `<span aria-hidden="true">·</span>`;
      return `<td><a class="cell st-${cell.status}${selected === key ? ' selected' : ''}" href="${link('explore', { species: speciesId, cell: key })}" aria-label="${esc(label)}" ${selected === key ? 'aria-current="true"' : ''}>${inner}</a></td>`;
    }).join('');
    return `<tr><th scope="row">${esc(pick(row.problem, '', state.lang))}</th>${cells}</tr>`;
  }).join('');

  const legend = ['has_records', 'probed_empty', 'not_collected'].map(s => `<li><span class="swatch st-${s}" aria-hidden="true"></span>${esc(tr('cell.' + s))}</li>`).join('');

  let panel = `<p class="small-note">${esc(tr('cell.select'))}</p>`;
  if (selected) {
    const [pid, cid] = selected.split('|');
    const cell = matrix.rows.find(r => r.problem.id === pid)?.cells.find(c => c.class_id === cid);
    if (cell) {
      const title = tr('cell.title', { problem: taxonomyLabel('welfare_problems', pid), cls: taxonomyLabel('technology_classes', cid) });
      panel = `<h3>${esc(title)}</h3>` + (cell.applications.length
        ? cell.applications.map(a => applicationCard(a)).join('')
        : `<p>${esc(tr('cell.empty.' + cell.status))}</p>`);
    }
  }

  return {
    title: tr('nav.explore'),
    html: lead(tr('land.kicker'), tr('land.title'), tr('land.desc'), aside) +
      `<p class="subnav">${esc(tr('explore.browse'))}: <a href="${link('species')}">${esc(tr('nav.species'))}</a> \u00b7 <a href="${link('sources')}">${esc(tr('nav.sources'))}</a></p>
       <div class="section-head"><h2>${esc(tr('land.explorer'))}</h2>
        <label class="inline-field">${esc(tr('land.species'))} <select id="species-filter" aria-label="${esc(tr('land.species'))}">${speciesOptions}</select></label></div>
       <p class="small-note">${esc(tr('land.how'))}</p>
       <div class="matrix-wrap" tabindex="0" role="region" aria-label="${esc(tr('land.explorer'))}"><table class="matrix"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
       <ul class="legend" aria-label="${esc(tr('land.legend'))}">${legend}</ul>
       <section class="cell-panel" aria-live="polite">${panel}</section>`
  };
}

const isDemo = d => !d.release.sample && d.release.status === 'pre-release' && d.claims.length > 0;
const statusText = d => isDemo(d) ? tr('status.demo') : tr(d.release.sample ? 'status.sample' : d.release.status === 'pre-release' ? 'status.pre-release' : 'status.released');

const BANDS = ['var(--bg)', 'var(--band-sage)', 'var(--band-sand)', 'var(--band-clay)', 'var(--band-mint)', 'var(--bg)'];
// Each section sits on a tint; neighbouring bands meet on a shared mix of their two colours.
const band = i => `--band-from: color-mix(in srgb, ${BANDS[i - 1]} 50%, ${BANDS[i]}); --band-color: ${BANDS[i]}; --band-to: color-mix(in srgb, ${BANDS[i]} 50%, ${BANDS[i + 1]});`;
const SECTIONS = [['numbers', 'sec.numbers'], ['how', 'how.title'], ['map', 'fig.title'], ['rely', 'prin.title'], ['help', 'join.title']];

function viewOverview() {
  const d = state.data;
  const supported = d.claims.filter(c => c.verification === 'supported').length;
  const zhSources = d.sources.filter(x => x.lang === 'zh').length;
  const stats = [[supported, isDemo(d) ? 'stats.claims.demo' : 'stats.claims'], [d.sources.length, 'stats.sources'], [zhSources, 'stats.zh'], [d.species.length, 'stats.species']];
  const note = isDemo(d) ? 'stats.note.demo' : d.release.sample ? 'stats.note.sample' : d.release.status === 'pre-release' ? 'stats.note.prerelease' : 'stats.note.released';
  const matrix = L.buildMatrix(d, 'all');
  const cells = matrix.rows.flatMap(r => r.cells);
  const count = s => cells.filter(c => c.status === s).length;
  const mini = matrix.rows.map(r => r.cells.map(c => `<span class="mini-cell st-${c.status}"></span>`).join('')).join('');
  const issue = (title, body) => esc(issueLink(title, `${body}\nRelease: ${d.release.version} (${d.release.as_of})\n\n`));
  const some = count('has_records') > 0;
  const notes = [
    ['note.read.k', tr('note.read.t'), tr('note.read.d')],
    ['note.stand.k', some ? tr('note.stand.t.some', { n: count('has_records'), total: cells.length }) : tr('note.stand.t.none'),
      some ? tr('note.stand.d.some', { empty: count('probed_empty'), not: count('not_collected') }) : tr('note.stand.d.none')],
    ['note.why.k', tr('note.why.t'), tr('note.why.d')]
  ];
  const rows = (prefix) => [1, 2, 3].map(i => `<li>${esc(tr(`${prefix}.${i}`))}</li>`).join('');
  return {
    title: tr('site.title'),
    html: `<div class="arena-home">
      <section class="hero hero-with-hills" aria-labelledby="home-title"><div class="hero-aurora" aria-hidden="true"></div>
        ${d.release.sample ? `<span class="pill">${esc(statusText(d))}</span>` : ''}<div class="record-type">${esc(tr('hero.kicker'))}</div>
        <h1 id="home-title">${esc(tr('hero.title'))}</h1><p class="hero-sub">${esc(tr('hero.sub'))}</p>
        <div class="home-actions"><a class="button-primary" href="${link('explore')}">${esc(tr('hero.cta.explore'))} <span aria-hidden="true">↗</span></a><a class="button-secondary" href="${link('methods')}">${esc(tr('hero.cta.methods'))} <span aria-hidden="true">→</span></a></div>
      </section>
      <section class="graph-feature" aria-labelledby="graph-title"><h2 class="vh" id="graph-title">${esc(tr('graph.title'))}</h2>
        <figure class="band-card graph-card"><div class="graph-head"><div class="graph-tabs" role="group" aria-label="${esc(tr('graph.view.label'))}">${GRAPH_VIEWS.map(v => `<button type="button" data-gview="${v}" aria-pressed="${v === graphView(d)}">${esc(tr('graph.view.' + v))}</button>`).join('')}</div><span class="graph-badge" data-gbadge${isPlaceholder(d) && graphView(d) !== 'today' ? '' : ' hidden'}>${esc(tr('graph.badge'))}</span></div><div class="graph-stage" data-graph></div><div data-glegend></div>
          <figcaption class="graph-note" data-gnote></figcaption></figure></section>
      <nav class="home-contents" aria-label="${esc(tr('contents'))}"><span>${esc(tr('contents'))}</span>${SECTIONS.map(([id, key], i) => `<a href="${link()}" data-jump="${id}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(tr(key))}</a>`).join('')}</nav>

      <section class="band-section" id="numbers" style="${band(1)}"><div class="story-copy"><h2>${esc(tr('sec.numbers'))}</h2>${d.release.sample ? `<p>${esc(tr(note))}</p>` : ''}</div>
        <ul class="stat-list">${stats.map(([n, key]) => `<li><strong>${esc(n)}</strong><span>${esc(tr(key))}</span></li>`).join('')}</ul></section>

      <section class="band-section" id="how" style="${band(2)}"><div class="story-copy"><h2>${esc(tr('how.title'))}</h2><p>${esc(tr('how.lead'))}</p></div>
        <div class="band-card"><dl class="arena-protocol">${[1, 2, 3].map(i => `<div><dt>${esc(tr(`how.${i}.t`))}</dt><dd>${esc(tr(`how.${i}.d`))}</dd></div>`).join('')}</dl></div></section>

      <section class="band-section" id="map" style="${band(3)}"><div class="story-copy"><h2>${esc(tr('fig.title'))}</h2><p>${esc(tr('map.lead'))}</p></div>
        <div class="band-split"><div class="band-card"><a class="mini" style="--cols:${matrix.columns.length}" href="${link('explore')}" aria-label="${esc(tr('fig.cta'))}">${mini}</a>
          <a class="button small" href="${link('explore')}">${esc(tr('fig.cta'))}</a></div>
          <aside class="band-notes" aria-label="${esc(tr('fig.title'))}">${notes.map(([k, t, text]) => `<div class="band-note"><span class="band-note-dot" aria-hidden="true"></span><p class="band-note-kicker">${esc(tr(k))}</p><h3>${esc(t)}</h3><p>${esc(text)}</p></div>`).join('')}</aside></div></section>

      <section class="band-section" id="rely" style="${band(4)}"><div class="story-copy"><h2>${esc(tr('prin.title'))}</h2><p>${esc(tr('rely.lead'))}</p></div>
        <div class="band-card"><ul class="arena-rows">${rows('prin')}</ul></div>
        <p class="story-small"><strong>${esc(tr('cav.label'))}.</strong> ${esc(tr('cav.text'))}</p></section>

      <section class="story-closing" id="help"><h2>${esc(tr('join.title'))}</h2><p class="small-note">${esc(tr('help.lead'))}</p>
        <ul class="arena-rows">${rows('join')}</ul>
        <div class="home-actions"><a class="button-primary" href="${issue('Offer to review', 'Languages, fish-welfare background, hours available:')}" target="_blank" rel="noopener noreferrer">${esc(tr('join.review'))} <span aria-hidden="true">↗</span></a>
          <a class="button-secondary" href="${issue('Correction or missing source', 'What is wrong or missing:')}" target="_blank" rel="noopener noreferrer">${esc(tr('join.report'))} <span aria-hidden="true">↗</span></a>
          <a class="button-secondary" href="${link('download')}">${esc(tr('join.download'))} <span aria-hidden="true">→</span></a></div></section>
    </div>`
  };
}

function applicationCard(app) {
  const claims = app.claim_ids.map(id => state.index.claims.get(id)).filter(Boolean);
  return `<article class="run-entry"><span class="record-type">${esc(speciesName(app.species_id))}</span>
    <h3>${esc(interventionName(app.intervention_id))}</h3>
    <p class="badges">${badge('b-plain', `${tr('app.maturity')}: ${taxonomyLabel('maturity', app.maturity)}`)} ${badge('b-plain', `${tr('app.outcome')}: ${taxonomyLabel('outcome_evidence', app.outcome_evidence)}`)}</p>
    <ul class="claim-list">${claims.map(c => `<li><a href="${link('claims/' + encodeURIComponent(c.id))}">${esc(pick(c, 'text', state.lang))}</a> ${verBadge(c.verification)}</li>`).join('')}</ul></article>`;
}

function viewSpeciesList() {
  const d = state.data;
  return {
    title: tr('nav.species'),
    html: lead(tr('sp.kicker'), tr('sp.title'), tr('sp.desc')) + d.species.map(s => `<article class="run-entry">
      <span class="record-type">${esc(tr('run.' + s.run_status))}</span>
      <h2><a href="${link('species/' + encodeURIComponent(s.id))}">${esc(pick(s, 'common', state.lang))}</a></h2>
      <p class="meta"><i>${esc(s.scientific)}</i> · ${esc(tr('group.' + s.group))}</p><p>${esc(pick(s, 'summary', state.lang))}</p></article>`).join('')
  };
}

function viewSpecies(id) {
  const s = state.index.species.get(id);
  if (!s) return viewNotFound();
  const d = state.data;
  const apps = d.applications.filter(a => a.species_id === id);
  const counts = { has_records: 0, probed_empty: 0, not_collected: 0 };
  L.buildMatrix(d, id).rows.forEach(r => r.cells.forEach(c => { counts[c.status]++; }));
  const runs = d.runs.filter(r => r.species_id === id);
  return {
    title: pick(s, 'common', state.lang),
    html: `<p class="meta"><a href="${link('species')}">← ${esc(tr('nav.species'))}</a></p>` +
      `<header class="species-title"><div class="record-type">${esc(tr('sp.kicker'))}</div><h1>${esc(pick(s, 'common', state.lang))}</h1><p><i>${esc(s.scientific)}</i></p></header>
       <p class="species-intro">${esc(pick(s, 'summary', state.lang))}</p>` +
      dl([[tr('sp.scientific'), `<i>${esc(s.scientific)}</i>`], [tr('sp.group'), esc(tr('group.' + s.group))], [tr('sp.runstatus'), esc(tr('run.' + s.run_status))]]) +
      `<h2>${esc(tr('sp.apps'))}</h2>` + (apps.length ? apps.map(applicationCard).join('') : `<p>${esc(tr('sp.noapps'))}</p>`) +
      suggestionBlock(id) +
      `<h2>${esc(tr('sp.cells'))}</h2><p>${esc(tr('sp.cells.line', { has: counts.has_records, empty: counts.probed_empty, not: counts.not_collected }))}</p>
       <p><a class="button small" href="${link('explore', { species: id })}">${esc(tr('nav.explore'))}</a></p>` +
      `<h2>${esc(tr('sp.runs'))}</h2>` + runs.map(runCard).join('')
  };
}

function suggestionBlock(speciesId) {
  const list = (state.data.suggestions || []).filter(x => x.species_id === speciesId);
  if (!list.length) return '';
  const cards = list.map(x => `<article class="run-entry suggestion">
    <span class="record-type">${esc(tr('sug.' + x.status))}</span>
    <p><strong>${esc(pick(x, 'action', state.lang))}</strong></p>
    ${dl([[tr('sug.who'), esc(x.who || '—')], [tr('sug.gap'), esc(pick(x, 'evidence_gap', state.lang))], [tr('sug.risks'), esc(pick(x, 'risks', state.lang) || '—')],
      [tr('sug.claims'), x.claim_ids.map(c => `<a href="${link('claims/' + encodeURIComponent(c))}">${esc(c)}</a>`).join(', ')]])}</article>`).join('');
  return `<h2>${esc(tr('sug.title'))}</h2><p>${esc(tr('sug.lead'))}</p>${cards}`;
}

function runCard(run) {
  const c = run.counts || {};
  return `<article class="run-entry"><span class="record-type">${esc(tr('run.' + run.status))}</span>
    <p>${esc(tr('run.focus'))}: ${esc(pick(run, 'focus', state.lang))}</p>
    ${dl([[tr('run.collected'), esc(c.documents_collected ?? '—')], [tr('run.released'), esc(c.sources_released ?? '—')], [tr('run.extracted'), esc(c.claims_extracted ?? '—')], [tr('run.supported'), esc(c.claims_supported ?? '—')]])}</article>`;
}

function sourceItems(q, lang) {
  const needle = q.trim().toLowerCase();
  return state.data.sources.filter(s => (!lang || s.lang === lang) &&
    (!needle || [s.title, s.title_en, (s.authors || []).join(' '), s.venue].filter(Boolean).join(' ').toLowerCase().includes(needle)));
}
function sourceListHtml(items) {
  if (!state.data.sources.length) return empty(tr('src.title'), tr('src.empty'));
  if (!items.length) return `<p>${esc(tr('src.nomatch'))}</p>`;
  return `<ul class="source-list">${items.map(s => `<li><a href="${link('sources/' + encodeURIComponent(s.id))}" lang="${esc(s.lang)}">${esc(s.title)}</a>
    <div class="meta">${esc((s.authors || []).join(', '))}${s.year ? ' · ' + esc(s.year) : ''}${s.venue ? ' · ' + esc(s.venue) : ''}</div>
    <div class="badges">${langBadge(s.lang)} ${badge('b-plain', tr('access.' + s.access))}</div></li>`).join('')}</ul>`;
}

function viewSources(params) {
  const q = params.get('q') || '';
  const lang = params.get('lang') || '';
  return {
    title: tr('nav.sources'),
    html: lead(tr('src.kicker'), tr('src.title'), tr('src.desc')) +
      `<div class="toolbar"><label class="inline-field grow">${esc(tr('src.search'))}<input id="source-q" type="search" value="${esc(q)}" placeholder="${esc(tr('src.search.ph'))}"></label>
       <label class="inline-field">${esc(tr('src.lang'))}<select id="source-lang"><option value="">${esc(tr('src.lang.all'))}</option>
       <option value="en" ${lang === 'en' ? 'selected' : ''}>${esc(tr('lang.en'))}</option><option value="zh" ${lang === 'zh' ? 'selected' : ''}>${esc(tr('lang.zh'))}</option></select></label></div>
       <div id="source-list" aria-live="polite">${sourceListHtml(sourceItems(q, lang))}</div>`
  };
}

function viewSource(id) {
  const s = state.index.sources.get(id);
  if (!s) return viewNotFound();
  const claims = state.data.claims.filter(c => c.source_id === id);
  const url = safeUrl(s.url) || (s.doi ? safeUrl('https://doi.org/' + s.doi) : '');
  return {
    title: s.title,
    html: `<p class="meta"><a href="${link('sources')}">← ${esc(tr('nav.sources'))}</a></p>
      <header class="species-title"><div class="record-type">${esc(tr('src.kicker'))}</div><h1 lang="${esc(s.lang)}">${esc(s.title)}</h1>${s.title_en && s.title_en !== s.title ? `<p>${esc(s.title_en)}</p>` : ''}</header>` +
      dl([[tr('src.authors'), orUnknown((s.authors || []).join(', '))], [tr('src.year'), orUnknown(s.year)], [tr('src.venue'), orUnknown(s.venue)],
          [tr('src.lang'), esc(tr('lang.' + s.lang))], [tr('src.access'), esc(tr('access.' + s.access))], [tr('src.licence'), orUnknown(s.licence_note)]]) +
      (url ? `<p><a class="button small" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(tr('src.link'))} ↗</a></p>` : '') +
      `<h2>${esc(tr('src.claims'))}</h2>` +
      (claims.length ? `<ul class="claim-list">${claims.map(c => `<li><a href="${link('claims/' + encodeURIComponent(c.id))}">${esc(pick(c, 'text', state.lang))}</a> ${verBadge(c.verification)}</li>`).join('')}</ul>` : `<p>${esc(tr('src.noclaims'))}</p>`)
  };
}

function viewClaim(id) {
  const c = state.index.claims.get(id);
  if (!c) return viewNotFound();
  const s = state.index.sources.get(c.source_id);
  const pop = c.population || {};
  const popText = [pop.species, pop.life_stage, pop.system].filter(Boolean).join(' · ');
  const reportBody = `Claim: ${c.id}\nSource: ${c.source_id}\nRelease: ${state.data.release.version} (${state.data.release.as_of})\nPage: ${location.href}\n\nWhat is wrong:\n`;
  return {
    title: `${tr('claim.kicker')} ${c.id}`,
    html: `<p class="meta"><a href="${s ? link('sources/' + encodeURIComponent(s.id)) : link('sources')}">← ${esc(s ? s.title : tr('nav.sources'))}</a></p>
      <header class="species-title"><div class="record-type">${esc(tr('claim.kicker'))} ${esc(c.id)}</div><h1>${esc(pick(c, 'text', state.lang))}</h1>
        <p class="badges">${verBadge(c.verification)} ${kindBadge(c.kind)} ${auditBadge(c.audit)}</p></header>
      <h2>${esc(tr('claim.quote'))}</h2>
      <blockquote class="quote" lang="${esc(c.quote_lang || 'und')}">${esc(c.quote)}</blockquote>
      <p class="meta">${esc(tr('claim.locator'))}: ${esc(L.formatLocator(c.locator))} · ${esc(tr('claim.source'))}: ${s ? `<a href="${link('sources/' + encodeURIComponent(s.id))}" lang="${esc(s.lang)}">${esc(s.title)}</a>` : esc(c.source_id)}</p>
      <h2>${esc(tr('claim.details'))}</h2>` +
      dl([[tr('claim.species'), c.species_id ? esc(speciesName(c.species_id)) : orUnknown(null)], [tr('claim.population'), orUnknown(popText)],
          [tr('claim.intervention'), orUnknown(c.intervention)], [tr('claim.comparator'), orUnknown(c.comparator)], [tr('claim.outcome'), orUnknown(c.outcome)],
          [tr('claim.direction'), esc(tr('dir.' + (c.direction || 'not_applicable')))], [tr('claim.magnitude'), orUnknown(c.magnitude)],
          [tr('claim.welfare'), `${esc(tr('welfare.' + c.welfare_link))}${c.welfare_link_note ? `<br><span class="meta">${esc(c.welfare_link_note)}</span>` : ''}`]]) +
      `<p><a class="button small" href="${esc(issueLink(`Correction: claim ${c.id}`, reportBody))}" target="_blank" rel="noopener noreferrer">${esc(tr('claim.report'))} ↗</a></p>
       <p class="small-note">${esc(tr('claim.report.note'))}</p>`
  };
}

function viewMethods() {
  const d = state.data;
  const audits = d.runs.filter(r => r.audit && r.audit.n > 0);
  const models = [...new Set(d.runs.flatMap(r => r.models || []))];
  const changes = d.runs.flatMap(r => (r.changelog || []).map(x => ({ run: r.id, ...x })));
  const limits = d.methods?.[`limits_${state.lang}`] || d.methods?.limits_en || [];
  return {
    title: tr('nav.methods'),
    html: lead(tr('m.kicker'), tr('m.title'), tr('m.desc')) +
      `<h2>${esc(tr('m.pipeline'))}</h2><ol class="steps">${tr('m.steps').map(x => `<li>${esc(x)}</li>`).join('')}</ol>
       <h2>${esc(tr('m.verified'))}</h2><p>${esc(tr('m.verified.text'))}</p>
       <h2>${esc(tr('m.audit'))}</h2>` +
      (audits.length ? `<table class="plain"><thead><tr><th>${esc(tr('m.audit.run'))}</th><th>${esc(tr('m.audit.n'))}</th><th>${esc(tr('m.audit.precision'))}</th><th>${esc(tr('m.audit.ci'))}</th></tr></thead><tbody>${audits.map(r =>
        `<tr><td>${esc(r.id)}</td><td>${esc(r.audit.n)}</td><td>${esc(L.formatPercent(r.audit.precision))}</td><td>${r.audit.ci ? esc(r.audit.ci.map(L.formatPercent).join(' – ')) : '—'}</td></tr>`).join('')}</tbody></table>` : `<p>${esc(tr('m.audit.none'))}</p>`) +
      `<h2>${esc(tr('m.limits'))}</h2><ul>${[...tr('m.limits.fixed'), ...limits].map(x => `<li>${esc(x)}</li>`).join('')}</ul>
       <h2>${esc(tr('m.models'))}</h2>${models.length ? `<ul>${models.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p>${esc(tr('m.models.none'))}</p>`}
       <h2>${esc(tr('m.changelog'))}</h2>${changes.length ? `<ul>${changes.map(x => `<li>${esc(x.date)} · ${esc(pick(x, 'text', state.lang))}</li>`).join('')}</ul>` : `<p>${esc(tr('m.changelog.none'))}</p>`}`
  };
}

function viewDownload() {
  const d = state.data;
  const r = d.release;
  const year = /^\d{4}/.test(r.as_of) ? r.as_of.slice(0, 4) : 'n.d.';
  const cite = tr('dl.cite.text', { year, version: r.version, asof: r.as_of, url: location.origin + location.pathname });
  const items = [['json', tr('dl.json'), true], ['sources', tr('dl.sources'), d.sources.length > 0], ['claims', tr('dl.claims'), d.claims.length > 0], ['apps', tr('dl.apps'), d.applications.length > 0]];
  return {
    title: tr('nav.download'),
    html: lead(tr('dl.kicker'), tr('dl.title'), tr('dl.desc')) +
      `<h2>${esc(tr('dl.files'))}</h2><p>${items.map(([key, label, ok]) => `<button class="button small" type="button" data-download="${key}" ${ok ? '' : 'disabled'}>${esc(label)}</button>`).join(' ')}</p>
       ${items.slice(1).every(i => !i[2]) ? `<p class="small-note">${esc(tr('dl.none'))}</p>` : ''}
       <h2>${esc(tr('dl.cite'))}</h2><p class="cite">${esc(cite)}</p>
       <h2>${esc(tr('dl.licence'))}</h2><p>${esc(r.licence || tr('dl.licence.none'))}</p>
       <h2>${esc(tr('dl.feedback'))}</h2><p>${esc(tr('dl.feedback.text'))}</p>
       <p><a class="button small" href="${esc(issueLink('Correction or suggested source', `Release: ${r.version} (${r.as_of})\nPage: ${location.href}\n\n`))}" target="_blank" rel="noopener noreferrer">${esc(tr('dl.feedback.button'))} ↗</a></p>`
  };
}

function viewNotFound() {
  return { title: tr('notfound'), html: empty(tr('notfound'), '') + `<p style="text-align:center"><a class="button small" href="${link()}">${esc(tr('nav.explore'))}</a></p>` };
}

function viewError() {
  return { title: tr('error.load'), html: `<div class="empty"><h3>${esc(tr('error.load'))}</h3><p>${esc(state.error || '')}</p><button class="button" type="button" data-retry>${esc(tr('error.retry'))}</button></div>` };
}

// ---------- chrome and rendering ----------
function applyChrome() {
  renderFooter();
  document.documentElement.lang = state.lang === 'zh' ? 'zh-Hans' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = tr(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = tr(el.dataset.i18nHtml); });
  $('meta[name="description"]').setAttribute('content', tr('site.desc'));
  $('#lang-toggle').textContent = tr('lang.switch');
  $('#lang-toggle').setAttribute('lang', state.lang === 'zh' ? 'en' : 'zh-Hans');
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-toggle').textContent = tr(dark ? 'theme.light' : 'theme.dark');
  $('#theme-toggle').setAttribute('aria-pressed', String(dark));
  $('.sections').setAttribute('aria-label', tr('nav.label'));
  const banner = $('#banner');
  const d = state.data;
  if (d && d.release.sample) { banner.hidden = false; banner.className = 'notice sample'; banner.textContent = tr('banner.sample'); }
  else banner.hidden = true;
  $('#release-line').textContent = d && !d.release.sample ? tr('subhead.version', { version: d.release.version, asof: d.release.as_of }) : '';
  $('#release-status').textContent = d && d.release.sample ? statusText(d) : '';
}

function render(navigated = false) {
  observers.forEach(o => o.disconnect()); observers = [];
  applyChrome();
  const { parts, params } = parseHash();
  let view;
  if (!state.data) view = state.error ? viewError() : { title: tr('loading'), html: `<p class="loading">${esc(tr('loading'))}</p>` };
  else {
    const [head, id] = parts;
    if (!head || head === 'content') view = viewOverview();
    else if (head === 'explore') view = viewExplore(params);
    else if (head === 'species') view = id ? viewSpecies(id) : viewSpeciesList();
    else if (head === 'sources') view = id ? viewSource(id) : viewSources(params);
    else if (head === 'claims' && id) view = viewClaim(id);
    else if (head === 'pipeline') view = viewPipeline();
    else if (head === 'methods') view = viewMethods();
    else if (head === 'download') view = viewDownload();
    else view = viewNotFound();
  }
  const section = parts[0] || '';
  const active = ['explore', 'species', 'sources', 'claims'].includes(section) ? 'explore' : section;
  document.querySelectorAll('.sections a').forEach(a => {
    const on = a.dataset.route === active;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  moveBlob(true);
  const wide = !parts[0] || ['content', 'explore', 'pipeline'].includes(parts[0]);
  $('#content').innerHTML = wide ? view.html : `<div class="narrow">${view.html}</div>`;
  document.title = `${view.title} — ${tr('site.title')}`;
  const pathKey = parts.join('/');
  if (navigated && pathKey !== state.lastPath) { window.scrollTo(0, 0); $('#content').focus({ preventScroll: true }); }
  else if (navigated && params.get('cell')) { const panel = $('.cell-panel'); if (panel) panel.scrollIntoView({ block: 'nearest' }); }
  state.lastPath = pathKey;
  if (!parts[0] || parts[0] === 'content') setupHomeEffects();
}

// ---------- footer and home-page effects ----------
function renderFooter() {
  const d = state.data;
  const year = new Date().getFullYear();
  const reviewLink = esc(issueLink('Offer to review', 'Languages, fish-welfare background, hours available:\n\n'));
  const list = items => `<ul>${items.map(([label, href, ext]) => `<li><a href="${esc(href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(label)}${ext ? ' ↗' : ''}</a></li>`).join('')}</ul>`;
  const card = (key, items) => `<nav class="site-footer-card" aria-label="${esc(tr(key))}"><h2>${esc(tr(key))}</h2>${list(items)}</nav>`;
  $('#site-footer').innerHTML = `<div class="site-footer-panel"><div class="site-footer-cards">
      ${card('foot.explore', [[tr('nav.explore'), link('explore')], [tr('nav.species'), link('species')], [tr('nav.sources'), link('sources')]])}
      ${card('foot.learn', [[tr('nav.methods'), link('methods')], [tr('nav.download'), link('download')]])}
      ${card('foot.open', [['myrias.org', 'https://myrias.org/', true], [tr('footer.repo'), 'https://github.com/invi-bhagyesh/myrias', true], [tr('footer.workspace'), 'workspace.html']])}
      <div class="site-footer-card site-footer-cta"><div><p>${esc(tr('foot.cta'))}</p><a class="site-footer-button" href="${reviewLink}" target="_blank" rel="noopener noreferrer">${esc(tr('foot.cta.btn'))} <span aria-hidden="true">→</span></a></div></div>
    </div>
    <div class="site-footer-meta"><span>${esc(tr('foot.copy', { year }))} · <span id="release-line"></span> <span id="release-status" role="status"></span></span>
      <a href="https://valuearena.github.io/" target="_blank" rel="noopener noreferrer">${esc(tr('foot.credit'))} ↗</a></div>
    <div class="site-footer-scene" aria-hidden="true">${pixelHills('footer')}<span class="site-footer-wordmark">Myrias</span></div></div>`;
}

// The front page can show the network three ways. "full" is the intended end state and "simple" its
// hubs only; both are labelled placeholder data until a release holds enough verified claims.
// "today" is always the real release.
const GRAPH_VIEWS = ['full', 'simple', 'today'];
const isPlaceholder = d => d.claims.length < MIN_REAL_CLAIMS;
const graphView = d => (GRAPH_VIEWS.includes(state.graphView) ? state.graphView : isPlaceholder(d) ? 'full' : 'today');
function viewGraph(d, lang, view) {
  if (view === 'today') return buildGraph(d, lang, link);
  const g = placeholderGraph(d, lang, link);
  return view === 'simple' ? simplifyGraph(g) : g;
}
// Liquid highlight in the header: one soft pill glides to the hovered item, then back to the current page.
function moveBlob(instant = false, target) {
  const nav = document.querySelector('.sections'), blob = nav && nav.querySelector('.nav-blob');
  if (!blob) return;
  const a = target || nav.querySelector('a[aria-current="page"]');
  if (!a) { blob.classList.remove('is-on'); return; }
  blob.classList.toggle('is-instant', instant || !blob.classList.contains('is-on'));
  blob.style.translate = `${a.offsetLeft}px ${a.offsetTop}px`;
  blob.style.width = a.offsetWidth + 'px'; blob.style.height = a.offsetHeight + 'px';
  blob.classList.add('is-on');
}
function setupNav() {
  const nav = document.querySelector('.sections');
  if (!nav) return;
  nav.addEventListener('mouseover', e => { const a = e.target.closest('a'); if (a) moveBlob(false, a); });
  nav.addEventListener('mouseleave', () => moveBlob());
  nav.addEventListener('focusin', e => { const a = e.target.closest('a'); if (a) moveBlob(false, a); });
  nav.addEventListener('focusout', () => moveBlob());
  addEventListener('resize', () => moveBlob(true));
  document.fonts && document.fonts.ready.then(() => moveBlob(true));
}
setupNav();
let observers = [];
function setupHomeEffects() {
  const home = document.querySelector('.arena-home');
  if (!home || !('IntersectionObserver' in window)) return;
  const stage = home.querySelector('[data-graph]');
  if (stage && state.data) {
    let handle = null;
    const show = () => {
      const d = state.data, view = graphView(d), g = viewGraph(d, state.lang, view);
      const sample = view !== 'today' && isPlaceholder(d);
      if (handle) handle.destroy();
      handle = mountGraph(stage, g, { tr, navigate: href => { location.hash = href; } });
      home.querySelector('[data-glegend]').innerHTML = legendHtml(g, tr);
      home.querySelector('[data-gbadge]').hidden = !sample;
      const note = sample ? tr('graph.note.placeholder') : (view === 'today' && !d.claims.length ? tr('graph.note.empty') : '');
      home.querySelector('[data-gnote]').textContent = tr('graph.hint');
      home.querySelectorAll('[data-gview]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.gview === view)));
    };
    home.querySelectorAll('[data-gview]').forEach(btn => btn.addEventListener('click', () => { state.graphView = btn.dataset.gview; show(); }));
    show();
    observers.push({ disconnect: () => handle && handle.destroy() });
  }
  const targets = home.querySelectorAll('.band-section');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) targets.forEach(t => t.classList.add('is-visible'));
  else {
    // Only hide content once the observer is in place to reveal it again.
    home.classList.add('reveal-ready');
    const reveal = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
        // Anything at or above a revealed section has already been scrolled past, so reveal it too.
        for (const t of targets) { t.classList.add('is-visible'); reveal.unobserve(t); if (t === entry.target) break; }
      }
    }, { rootMargin: '0px 0px -12% 0px' });
    targets.forEach(t => reveal.observe(t));
    observers.push(reveal);
  }
  const spy = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      home.querySelectorAll('.home-contents a').forEach(a => {
        if (a.dataset.jump === entry.target.id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
      });
    }
  }, { rootMargin: '-15% 0px -65% 0px' });
  home.querySelectorAll('section[id]').forEach(s => spy.observe(s));
  observers.push(spy);
}

// ---------- events ----------
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleDownload(kind) {
  const d = state.data;
  const stem = `myrias-landscape-${d.release.version}`;
  if (kind === 'json') return download(`${stem}.json`, JSON.stringify(d, null, 1), 'application/json');
  if (kind === 'sources') {
    const rows = d.sources.map(s => ({ ...s, authors: (s.authors || []).join('; ') }));
    return download(`${stem}-sources.csv`, L.toCSV(rows, ['id', 'title', 'title_en', 'authors', 'year', 'lang', 'venue', 'doi', 'url', 'access', 'licence_note']), 'text/csv;charset=utf-8');
  }
  if (kind === 'claims') {
    const rows = d.claims.map(c => L.claimRow(c, d));
    return download(`${stem}-claims.csv`, L.toCSV(rows, Object.keys(rows[0])), 'text/csv;charset=utf-8');
  }
  if (kind === 'apps') {
    const rows = d.applications.map(a => ({ id: a.id, intervention: interventionName(a.intervention_id), species_id: a.species_id, technology_class: a.technology_class,
      welfare_problem: a.welfare_problem, maturity: a.maturity, outcome_evidence: a.outcome_evidence, claim_ids: a.claim_ids.join('; ') }));
    return download(`${stem}-applications.csv`, L.toCSV(rows, Object.keys(rows[0])), 'text/csv;charset=utf-8');
  }
}

document.addEventListener('click', event => {
  const target = event.target.closest('button, a');
  if (!target) return;
  if (target.id === 'lang-toggle') { state.lang = state.lang === 'zh' ? 'en' : 'zh'; store('myrias-lang', state.lang); render(); }
  else if (target.id === 'theme-toggle') {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; store('myrias-theme', next); applyChrome();
  } else if (target.dataset.download) handleDownload(target.dataset.download);
  else if (target.hasAttribute('data-retry')) { state.data = null; render(); load().then(render); }
  else if (target.dataset.jump) { event.preventDefault(); const el = document.getElementById(target.dataset.jump); if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
  else if (target.classList.contains('skip')) { event.preventDefault(); $('#content').focus(); }
});

document.addEventListener('change', event => {
  if (event.target.id === 'species-filter') {
    const { params } = parseHash();
    location.hash = link('explore', { species: event.target.value, cell: params.get('cell') || '' });
  }
  if (event.target.id === 'source-lang') updateSourceList();
});
document.addEventListener('input', event => { if (event.target.id === 'source-q') updateSourceList(); });

function updateSourceList() {
  const q = $('#source-q').value, lang = $('#source-lang').value;
  $('#source-list').innerHTML = sourceListHtml(sourceItems(q, lang));
  const query = new URLSearchParams(Object.entries({ q, lang }).filter(([, v]) => v)).toString();
  history.replaceState(null, '', `${location.pathname}${location.search}#/sources${query ? '?' + query : ''}`);
}

window.addEventListener('hashchange', () => render(true));

// ---------- start ----------
let preferredLang = store('myrias-lang');
if (!preferredLang) preferredLang = (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
state.lang = preferredLang === 'zh' ? 'zh' : 'en';
let preferredTheme = store('myrias-theme');
if (!preferredTheme) { try { preferredTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { preferredTheme = 'light'; } }
document.documentElement.dataset.theme = preferredTheme;

render();
load().then(render);
