import { t } from './i18n.js';
import * as L from './site-lib.js';

const { escapeHtml: esc, safeUrl, pick } = L;
const ISSUES_URL = 'https://github.com/invi-bhagyesh/myrias/issues/new';
const $ = selector => document.querySelector(selector);
const params0 = new URLSearchParams(location.search);
const useSample = params0.get('data') === 'sample';

const state = { data: null, error: null, lang: 'en', index: null, lastPath: null };
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
    <dt>${esc(tr('land.l.claims'))}</dt><dd>${supported}</dd>
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

const statusText = d => tr(d.release.sample ? 'status.sample' : d.release.status === 'pre-release' ? 'status.pre-release' : 'status.released');

function viewOverview() {
  const d = state.data;
  const supported = d.claims.filter(c => c.verification === 'supported').length;
  const zhSources = d.sources.filter(x => x.lang === 'zh').length;
  const stats = [[supported, 'stats.claims'], [d.sources.length, 'stats.sources'], [zhSources, 'stats.zh'], [d.species.length, 'stats.species']];
  const note = d.release.sample ? 'stats.note.sample' : d.release.status === 'pre-release' ? 'stats.note.prerelease' : 'stats.note.released';
  const matrix = L.buildMatrix(d, 'all');
  const mini = matrix.rows.map(r => r.cells.map(c => `<span class="mini-cell st-${c.status}"></span>`).join('')).join('');
  const issue = (title, body) => esc(issueLink(title, `${body}\nRelease: ${d.release.version} (${d.release.as_of})\n\n`));
  return {
    title: tr('site.title'),
    html: `<section class="hero"><span class="pill">${esc(statusText(d))}</span><div class="record-type">${esc(tr('hero.kicker'))}</div>
        <h1>${esc(tr('hero.title'))}</h1><p class="hero-sub">${esc(tr('hero.sub'))}</p>
        <p class="hero-cta"><a class="button primary" href="${link('explore')}">${esc(tr('hero.cta.explore'))}</a> <a class="button" href="${link('methods')}">${esc(tr('hero.cta.methods'))}</a></p></section>
      <section class="stats"><ul class="stat-list">${stats.map(([n, key]) => `<li><strong>${esc(n)}</strong><span>${esc(tr(key))}</span></li>`).join('')}</ul>
        <p class="small-note">${esc(tr(note))}</p></section>
      <section class="how"><h2>${esc(tr('how.title'))}</h2><ol class="how-steps">${[1, 2, 3].map(i => `<li><span class="num" aria-hidden="true">${i}</span><h3>${esc(tr(`how.${i}.t`))}</h3><p>${esc(tr(`how.${i}.d`))}</p></li>`).join('')}</ol></section>
      <section class="figure"><h2>${esc(tr('fig.title'))}</h2>
        <a class="mini" style="--cols:${matrix.columns.length}" href="${link('explore')}" aria-label="${esc(tr('fig.cta'))}">${mini}</a>
        <div class="figure-text"><p class="caption">${esc(tr('fig.caption'))}</p><p><a class="button small" href="${link('explore')}">${esc(tr('fig.cta'))}</a></p></div></section>
      <section class="principles"><h2>${esc(tr('prin.title'))}</h2><ul>${[1, 2, 3].map(i => `<li>${esc(tr(`prin.${i}`))}</li>`).join('')}</ul></section>
      <section class="join"><h2>${esc(tr('join.title'))}</h2><ul>${[1, 2, 3].map(i => `<li>${esc(tr(`join.${i}`))}</li>`).join('')}</ul>
        <p><a class="button small" href="${issue('Correction or missing source', 'What is wrong or missing:')}" target="_blank" rel="noopener noreferrer">${esc(tr('join.report'))} ↗</a>
        <a class="button small" href="${issue('Offer to review', 'Languages, fish-welfare background, hours available:')}" target="_blank" rel="noopener noreferrer">${esc(tr('join.review'))} ↗</a>
        <a class="button small" href="${link('download')}">${esc(tr('join.download'))}</a></p></section>`
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
      `<h2>${esc(tr('sp.cells'))}</h2><p>${esc(tr('sp.cells.line', { has: counts.has_records, empty: counts.probed_empty, not: counts.not_collected }))}</p>
       <p><a class="button small" href="${link('explore', { species: id })}">${esc(tr('nav.explore'))}</a></p>` +
      `<h2>${esc(tr('sp.runs'))}</h2>` + runs.map(runCard).join('')
  };
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
  else if (d && d.release.status === 'pre-release' && parseHash().parts.length) { banner.hidden = false; banner.className = 'notice prerelease'; banner.textContent = tr('banner.prerelease'); }
  else banner.hidden = true;
  $('#release-line').textContent = d && !d.release.sample ? tr('subhead.version', { version: d.release.version, asof: d.release.as_of }) : '';
  $('#release-status').textContent = d ? statusText(d) : '';
}

function render(navigated = false) {
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
  const wide = !parts[0] || ['content', 'explore'].includes(parts[0]);
  $('#content').innerHTML = wide ? view.html : `<div class="narrow">${view.html}</div>`;
  document.title = `${view.title} — ${tr('site.title')}`;
  const pathKey = parts.join('/');
  if (navigated && pathKey !== state.lastPath) { window.scrollTo(0, 0); $('#content').focus({ preventScroll: true }); }
  else if (navigated && params.get('cell')) { const panel = $('.cell-panel'); if (panel) panel.scrollIntoView({ block: 'nearest' }); }
  state.lastPath = pathKey;
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
