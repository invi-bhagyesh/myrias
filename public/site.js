import { t } from './i18n.js';
import * as L from './site-lib.js';
import { pixelHills } from './site-art.js';
import { pipelineHtml, mountPipeline } from './site-pipeline.js';
import { matrixChart } from './site-chart.js';

import { placeholderGraph, simplifyGraph, mountGraph, legendHtml, MIN_REAL_CLAIMS } from './site-graph.js';
import { evidenceModel, evidenceMapHtml, mountEvidenceMap } from './site-evmap.js';
import { speciesModel, speciesPageHtml, speciesCardsHtml } from './site-species.js';
import { findingsListHtml, findingPageHtml, findingText, findingItemHtml, byWeight, claimItemsHtml } from './site-findings.js';
import { actionItemHtml } from './site-actions.js';
import { browseHtml, mountBrowse } from './site-browse.js';
import { corpusFlowHtml, topicBarsHtml, decadeColumnsHtml, LANG_COLOR } from './site-corpusviz.js';
import { controlsHtml, mountCorpusList, FILTER_DEFAULTS, unpackPapers } from './site-corpuslist.js';

const { escapeHtml: esc, safeUrl, pick } = L;
const ISSUES_URL = 'https://github.com/invi-bhagyesh/myrias/issues/new';
const $ = selector => document.querySelector(selector);
const params0 = new URLSearchParams(location.search);
const useSample = params0.get('data') === 'sample';

const state = { data: null, error: null, lang: 'en', index: null, lastPath: null, graphView: null, full: false, listsReady: false, listsWaiters: [], fullPromise: null, fullError: null };
const tr = (key, vars) => t(state.lang, key, vars);

function store(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  return null;
}

// ---------- data ----------
// The first screen needs only the release shell (taxonomy, sources, practices) and the small summaries, so
// that is all load() waits for. Claims, findings and actions (about 6 MB, 1.2 MB compressed) download in the
// background; pages that list them wait for loadFull(). Files carry the release version in the address, so
// the browser keeps them between visits.
const json = (url, opt) => fetch(url, opt).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.json(); });
const optional = url => json(url, { cache: 'no-cache' }).catch(() => null);
const indexOf = list => new Map((list || []).map(x => [x.id, x]));

async function load() {
  state.error = null; state.full = false; state.listsReady = false; state.fullPromise = null;
  const [shell, corpus, nextRun, pipeline] = await Promise.all([
    json(useSample ? 'data/sample.json' : 'data/release.json', { cache: 'no-cache' }).catch(e => ({ __error: e.message })),
    optional('data/corpus.json'), optional('data/next-run.json'), optional('data/pipeline.json')]);
  state.corpus = corpus; state.nextRun = nextRun; state.pipeline = pipeline;
  if (shell.__error) { state.data = null; state.error = shell.__error; return; }
  const data = shell, pending = (data.claim_files || []).length > 0;
  const v = encodeURIComponent(data.release?.version || '0');
  data.claims_pending = pending;
  if (pending) { data.claims = []; data.findings = []; data.actions = []; }
  const problems = L.validateExport(data);
  if (problems.length) { state.data = null; state.error = 'Invalid export: ' + problems.slice(0, 3).join('; '); return; }
  state.data = data;
  state.index = { species: indexOf(data.species), sources: indexOf(data.sources), claims: indexOf(data.claims), findings: indexOf(data.findings),
    interventions: indexOf(data.interventions), applications: indexOf(data.applications) };
  if (!pending) { state.full = true; state.listsReady = true; return; }
  state.fullPromise = loadFull(data, v);
}

async function loadFull(data, v) {
  const part = files => Promise.all((files || []).map(f => json(`data/${f}?v=${v}`))).then(a => a.flat());
  try {
    // First the small files the Findings and Actions pages are built from, then the claims behind them.
    const [findings, actions] = await Promise.all([part(data.finding_files), part(data.action_files)]);
    data.findings = findings; data.actions = actions; state.index.findings = indexOf(findings); state.listsReady = true;
    state.listsWaiters.splice(0).forEach(fn => fn());
    const claims = await part(data.claim_files);
    data.claims = claims; data.claims_pending = false;
    const problems = L.validateExport(data);
    if (problems.length) throw new Error('Invalid export: ' + problems.slice(0, 3).join('; '));
    state.index.claims = indexOf(claims);
    state.full = true;
  } catch (error) { state.fullError = error.message; }
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
// The pipeline: the framework in four phases, then a walkthrough of one real claim, step by step (see
// site-pipeline.js). The run settings are folded below.
function viewPipeline() {
  const P = state.pipeline, start = Number(parseHash().params.get('step')) || 1;
  const body = P ? pipelineHtml(P, { lang: state.lang, tr, link, taxonomyLabel }) : '';
  return { title: tr('nav.pipeline'), html: lead(tr('pipe.kicker'), tr('pipe.title'), tr('pl.lead')) + body +
      `<details class="pl-fold"><summary>${esc(tr('pl.fold.runs'))}</summary>${nextRunHtml(state.nextRun)}</details>`,
    mount: root => mountPipeline(root, { start, onStep: k => history.replaceState(null, '', link('pipeline', k > 1 ? { step: k } : {})) }) };
}

// The planned run and its settings, from data/next-run.json. Nothing here has been run.
function nextRunHtml(p) {
  if (!p) return '';
  const zh = state.lang === 'zh', L = (o, k) => (zh ? o[k + '_zh'] || o[k + '_en'] : o[k + '_en']) || '', B = o => (zh ? o.zh || o.en : o.en);
  const actual = ph => (ph.actual ? `<p class="nr-actual">${esc(tr('nr.actual', { extracted: ph.actual.claims_extracted, found: ph.actual.claims_quote_found, relevant: ph.actual.claims_relevant, released: ph.actual.claims_released, supported: ph.actual.claims_supported, sources: ph.actual.sources_released, interventions: ph.actual.interventions }))}</p>${ph.notes_en ? `<p class="small-note">${esc(L(ph, 'notes'))}</p>` : ''}` : '');
  const phases = p.phases.map(ph => `<article class="nr-phase st-${esc(ph.status || 'planned')}"><div class="nr-phase-head"><span class="nr-id">${esc(ph.id)}</span><h3>${esc(L(ph, 'name'))}</h3><span class="nr-badge">${esc(tr('nr.status.' + (ph.status || 'planned')))}</span></div>
    <ul class="nr-nums"><li><b>${ph.papers}</b>${esc(tr('nr.papers'))}</li><li><b>${Number(ph.windows).toLocaleString()}</b>${esc(tr('nr.windows'))}</li><li><b>~${ph.minutes} min</b>${esc(tr('nr.time'))}</li></ul>
    ${actual(ph)}<p>${esc(L(ph, 'why'))}</p><p class="small-note"><code>${esc(ph.input)}</code></p>
    <details class="nr-cmds"><summary>${esc(tr('nr.commands'))}</summary><pre>${esc(ph.commands.join('\n'))}</pre></details></article>`).join('');
  const rows = p.stages.map(st => `<tr><td>${esc(st.id)}</td><td>${st.model ? `<code>${esc(st.model)}</code>${st.fallback ? `<br><small>${esc(tr('nr.fallback'))}: <code>${esc(st.fallback.join(', '))}</code></small>` : ''}` : esc(tr('pipe.nomodel'))}</td>
    <td>${esc(st.reasoning || '—')}</td><td>${st.max_output_tokens ? Number(st.max_output_tokens).toLocaleString() : '—'}</td><td>${esc(st.per)}${st.note_en ? `<br><small>${esc(L(st, 'note'))}</small>` : ''}</td></tr>`).join('');
  const gates = p.gates.map(g => `<li class="nr-gate g-${esc(g.status)}"><span>${esc(tr('nr.gate.' + g.status))}</span>${esc(B(g))}</li>`).join('');
  const build = p.to_build_first.map(x => `<li>${esc(B(x))}</li>`).join('');
  const outs = p.outputs.map(x => `<li>${esc(B(x))}</li>`).join('');
  return `<section class="next-run"><div class="nr-top"><span class="pill">${esc(tr('nr.status.' + p.status))}</span><h2>${esc(tr('nr.title'))}</h2>
      <p>${esc(L(p, 'goal'))}</p></div>
    <div class="nr-phases">${phases}</div>
    <h3>${esc(tr('nr.config'))}</h3>
    <dl class="nr-settings"><dt>${esc(tr('nr.profile'))}</dt><dd><code>${esc(p.profile)}</code></dd><dt>${esc(tr('nr.router'))}</dt><dd>${esc(p.provider.router)} · data_collection: <code>${esc(p.provider.data_collection)}</code></dd>
      <dt>${esc(tr('nr.window'))}</dt><dd>${p.window.size_chars.toLocaleString()} / ${p.window.overlap_chars}</dd><dt>${esc(tr('nr.prompts'))}</dt><dd>${Object.entries(p.prompt_versions).map(([k, v]) => `${esc(k)} <code>${esc(v)}</code>`).join(' · ')}</dd></dl>
    <div class="nr-table"><table class="plain"><thead><tr><th>${esc(tr('nr.stage'))}</th><th>${esc(tr('pipe.model'))}</th><th>${esc(tr('nr.reasoning'))}</th><th>${esc(tr('nr.maxout'))}</th><th>${esc(tr('nr.per'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="nr-cols"><div><h3>${esc(tr('nr.gates'))}</h3><ul class="nr-gates">${gates}</ul></div>
      <div><h3>${esc(tr('nr.build'))}</h3><ul class="nr-list">${build}</ul><h3>${esc(tr('nr.outputs'))}</h3><ul class="nr-list">${outs}</ul></div></div>
    <p class="small-note"><b>${esc(tr('nr.notin'))}</b> ${esc(L(p, 'not_in_this_run'))} · <a href="data/next-run.json">next-run.json</a></p></section>`;
}

const fmtBytes = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B');
function viewCorpus() {
  const c = state.corpus;
  if (!c) return { title: tr('nav.corpus'), html: lead(tr('corpus.kicker'), tr('corpus.title'), tr('corpus.lead')) + `<p>${esc(tr('corpus.none'))}</p>` };
  const h = c.headline, n = x => (x === null || x === undefined ? '—' : Number(x).toLocaleString());
  const tiles = [[h.papers_found, 'corpus.h.papers'], [(h.about_species_and_welfare?.en || 0) + (h.about_species_and_welfare?.zh || 0), 'corpus.h.relevant'],
    [h.full_text, 'corpus.h.fulltext'], [h.by_language?.zh, 'corpus.h.zh'], [h.first_run_claims, 'corpus.h.claims'], [h.links, 'corpus.h.links']];
  const srcs = Object.entries(h.sources || {}).map(([k, v]) => `<li class="src-${esc(v)}"><b>${esc(tr('corpus.src.' + k))}</b><span>${esc(tr('corpus.status.' + v))}</span></li>`).join('');
  const groups = new Map();
  for (const f of c.folders) { const top = f.path.split('/')[0] || ''; (groups.get(top) || groups.set(top, []).get(top)).push(f); }
  const order = [...Object.keys(c.parts), ''].filter(k => groups.has(k));
  const item = it => `<li><code>${esc(it.name)}</code><span class="ct-meta">${it.rows !== null && it.rows !== undefined ? esc(tr('corpus.rows', { n: n(it.rows) })) + ' · ' : ''}${fmtBytes(it.bytes)}</span>${it.about ? `<span class="ct-about">${esc(it.about)}</span>` : ''}</li>`;
  const folder = f => `<div class="ct-folder"><div class="ct-row"><code>${esc(c.species)}/${esc(f.path ? f.path + '/' : '')}</code><span class="ct-meta">${esc(tr('corpus.files', { n: n(f.files) }))} · ${fmtBytes(f.bytes)}</span></div>
    ${f.items.length ? `<ul class="ct-items">${f.items.map(item).join('')}</ul>` : `<p class="ct-about">${esc(f.about)}</p>`}</div>`;
  const parts = order.map(k => {
    const list = groups.get(k), files = list.reduce((a, f) => a + f.files, 0), bytes = list.reduce((a, f) => a + f.bytes, 0);
    return `<details class="ct-part" ${k === 'intake' || k === 'first-run' ? 'open' : ''}><summary><span class="ct-name">${esc(k ? k + '/' : tr('corpus.top'))}</span><span class="ct-meta">${esc(tr('corpus.files', { n: n(files) }))} · ${fmtBytes(bytes)}</span>
      <span class="ct-desc">${esc(k ? tr('corpus.part.' + k) : tr('corpus.part.top'))}</span></summary>${list.map(folder).join('')}</details>`;
  }).join('');
  const where = `<p class="small-note">${esc(tr(c.private ? 'corpus.private' : 'corpus.public'))} <a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">${esc(c.repo)} ↗</a> · ${esc(tr('corpus.asof', { d: c.as_of }))}</p>`;
  let charts = '';
  if (c.charts) {
    const st = Object.fromEntries(c.charts.stages.map(x => [x.id, x]));
    const top = Object.entries(c.charts.sources).sort((a, b) => b[1].only_here - a[1].only_here)[0];
    const legend = `<p class="cv-legend">${['en', 'zh'].map(l => `<span><i style="background:${LANG_COLOR[l]}"></i>${esc(tr('cv.lang.' + l))}</span>`).join('')}</p>`;
    const total = Object.values(c.charts.decades).reduce((a, v) => a + v.en + v.zh, 0);
    charts = `<h2>${esc(tr('cv.title'))}</h2>${legend}<div class="cv-card">${corpusFlowHtml(c, tr)}</div>
      <p class="cv-note">${esc(tr('cv.note', { top: tr('corpus.src.' + top[0]), only: n(top[1].only_here), zf: n(st.found.by_lang.zh), za: n(st.about.by_lang.zh), zt: n(st.full_text.by_lang.zh) }))}</p>
      <div class="cv-two"><section><h3>${esc(tr('cv.topics'))}</h3>${topicBarsHtml(c.charts.topics, k => tr('cv.topic.' + k))}<p class="cv-note">${esc(tr('cv.topics.note', { n: n(st.about.n) }))}</p></section>
      <section><h3>${esc(tr('cv.decades'))}</h3>${decadeColumnsHtml(c.charts.decades)}<p class="cv-note">${esc(tr('cv.decades.note', { n: n(total) }))}</p></section></div>`;
  }
  // The paper list loads on first visit (about 1 MB of bibliographic details).
  if (state.papers === undefined) {
    state.papers = null;
    Promise.all((c.paper_files || []).map(f => fetch('data/' + f, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : { rows: [], fields: [] }))))
      .then(parts => { state.papers = parts.flatMap(unpackPapers); if (parseHash().parts[0] === 'corpus') render(); }).catch(() => { state.papers = []; });
  }
  const topics = c.charts ? Object.keys(c.charts.topics) : [];
  const listBlock = `<h2 id="papers">${esc(tr('cl.title'))}</h2><p class="cv-note">${esc(tr('cl.lead'))}</p>` + (state.papers
    ? `<div class="cl-root" data-cl-root>${controlsHtml(state.corpusFilter || FILTER_DEFAULTS, topics, tr)}<p class="cl-count" data-cl-count></p><ul class="cl-list" data-cl-list></ul><button type="button" class="button small" data-cl-more hidden></button></div>`
    : `<p class="loading">${esc(tr('loading'))}</p>`);
  return {
    title: tr('nav.corpus'),
    html: lead(tr('corpus.kicker'), tr('corpus.title'), tr('corpus.lead')) + where +
      `<ul class="corpus-tiles">${tiles.map(([v, k]) => `<li><strong>${n(v)}</strong><span>${esc(tr(k))}</span></li>`).join('')}</ul>` + charts +
      `<div class="corpus-sources-wrap"><h2>${esc(tr('corpus.sources'))}</h2><ul class="corpus-sources">${srcs}</ul></div>` + listBlock +
      `<h2>${esc(tr('corpus.tree'))}</h2><p class="small-note">${esc(tr('corpus.tree.note', { n: n(h.files), size: fmtBytes(h.bytes) }))}</p><div class="corpus-tree">${parts}</div>`
  };
}

function viewExplore(params) {
  const d = state.data;
  const speciesId = params.get('species') || 'all';
  const matrix = L.buildMatrix(d, speciesId);
  const selected = params.get('cell') || '';
  const supported = d.claims.length ? d.claims.filter(c => c.verification === 'supported').length : (d.runs[0]?.counts?.claims_supported ?? 0);
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
      const cellFindings = (state.data.findings || []).filter(f => f.welfare_problem === pid && f.technology_class === cid && (speciesId === 'all' || f.species_id === speciesId));
      panel = `<h3>${esc(title)}</h3>` + (cellFindings.length ? `<h4 class="fd-h">${esc(tr('fd.title'))}</h4>${findingsListHtml(cellFindings, findingCtx(), { first: 5 })}<h4 class="fd-h">${esc(tr('sp.apps'))}</h4>` : '') + (cell.applications.length
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
       ${matrixChart({ matrix, data: d, lang: state.lang, selected, speciesId, link, tr })}
       <details class="matrix-details"><summary>${esc(tr('chart.table'))}</summary><div class="matrix-wrap" tabindex="0" role="region" aria-label="${esc(tr('land.explorer'))}"><table class="matrix"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div></details>
       <ul class="legend" aria-label="${esc(tr('land.legend'))}">${legend}</ul>
       <section class="cell-panel" aria-live="polite">${panel}</section>`
  };
}

const claimCount = d => d.claims.length || d.runs?.[0]?.counts?.claims_released || 0;
const isDemo = d => !d.release.sample && d.release.status === 'pre-release' && claimCount(d) > 0;
const statusText = d => isDemo(d) ? tr('status.demo') : tr(d.release.sample ? 'status.sample' : d.release.status === 'pre-release' ? 'status.pre-release' : 'status.released');

const BANDS = ['var(--bg)', 'var(--band-sage)', 'var(--band-sand)', 'var(--band-clay)', 'var(--band-mint)', 'var(--bg)'];
// Each section sits on a tint; neighbouring bands meet on a shared mix of their two colours.
const band = i => `--band-from: color-mix(in srgb, ${BANDS[i - 1]} 50%, ${BANDS[i]}); --band-color: ${BANDS[i]}; --band-to: color-mix(in srgb, ${BANDS[i]} 50%, ${BANDS[i + 1]});`;
const SECTIONS = [['numbers', 'sec.numbers'], ['how', 'how.title'], ['map', 'fig.title'], ['rely', 'prin.title'], ['help', 'join.title']];

function viewOverview() {
  const d = state.data;
  const supported = d.claims.length ? d.claims.filter(c => c.verification === 'supported').length : (d.runs[0]?.counts?.claims_supported ?? 0);
  const zhSources = d.sources.filter(x => x.lang === 'zh').length;
  const stats = [[supported, isDemo(d) ? 'stats.claims.demo' : 'stats.claims'], [d.sources.length, 'stats.sources'], [zhSources, 'stats.zh'], [d.species.length, 'stats.species']];
  const note = isDemo(d) ? 'stats.note.demo' : d.release.sample ? 'stats.note.sample' : d.release.status === 'pre-release' ? 'stats.note.prerelease' : 'stats.note.released';
  const matrix = L.buildMatrix(d, 'all');
  const cells = matrix.rows.flatMap(r => r.cells);
  const count = s => cells.filter(c => c.status === s).length;
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
      <section class="hero hero-with-hills" aria-labelledby="home-title"><div class="hero-hills" aria-hidden="true">${pixelHills('hero')}</div>
        <div class="hero-copy">
        ${d.release.sample ? `<span class="pill">${esc(statusText(d))}</span>` : ''}<div class="record-type">${esc(tr('hero.kicker'))}</div>
        <h1 id="home-title">${esc(tr('hero.title'))}</h1><p class="hero-sub">${esc(tr('hero.sub'))}</p>
        <div class="home-actions"><a class="button-primary" href="${link('explore')}">${esc(tr('hero.cta.explore'))} <span aria-hidden="true">↗</span></a><a class="button-secondary" href="${link('methods')}">${esc(tr('hero.cta.methods'))} <span aria-hidden="true">→</span></a></div>
        </div>
        <button type="button" class="scroll-cue" data-scroll="graph-title"><span>${esc(tr('hero.scroll'))}</span><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 7l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <aside class="hero-side" aria-hidden="true"><img class="hero-art" src="art/research-desk.webp" width="1004" height="849" alt="" decoding="async"><div class="hero-tiles">${stats.slice(0, 3).map(([n, key], k) => `<div class="hero-tile t${k}"><strong>${esc(n)}</strong><span>${esc(tr(key))}</span></div>`).join('')}</div></aside>
      </section>
      ${state.corpus && state.corpus.charts ? `<section class="home-flow" aria-labelledby="home-flow-title"><div class="home-flow-head"><h2 id="home-flow-title">${esc(tr('cv.title'))}</h2>
        <p class="cv-legend">${['en', 'zh'].map(l => `<span><i style="background:${LANG_COLOR[l]}"></i>${esc(tr('cv.lang.' + l))}</span>`).join('')}<a href="${link('corpus')}">${esc(tr('home.flow.more'))} →</a></p></div>
        <div class="cv-card">${corpusFlowHtml(state.corpus, tr)}</div></section>` : ''}
      <nav class="home-contents" aria-label="${esc(tr('contents'))}"><span>${esc(tr('contents'))}</span>${SECTIONS.map(([id, key], i) => `<a href="${link()}" data-jump="${id}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(tr(key))}</a>`).join('')}</nav>
      <section class="graph-feature" aria-labelledby="graph-title">
        <figure class="band-card graph-card"><div class="graph-head"><h2 class="graph-name" id="graph-title">${esc(tr('graph.title'))}</h2><div class="graph-tabs" role="group" aria-label="${esc(tr('graph.view.label'))}">${GRAPH_VIEWS.map(v => `<button type="button" data-gview="${v}" aria-pressed="${v === graphView(d)}">${esc(tr('graph.view.' + v))}</button>`).join('')}</div><span class="graph-badge" data-gbadge${graphView(d) !== 'today' ? '' : ' hidden'}>${esc(tr('graph.badge'))}</span></div><div class="graph-stage" data-graph></div><div data-glegend></div>
          <figcaption class="graph-note" data-gnote></figcaption></figure></section>

      <section class="band-section" id="numbers" style="${band(1)}"><div class="story-copy"><h2>${esc(tr('sec.numbers'))}</h2>${d.release.sample ? `<p>${esc(tr(note))}</p>` : ''}</div>
        <ul class="stat-list">${stats.map(([n, key]) => `<li><strong>${esc(n)}</strong><span>${esc(tr(key))}</span></li>`).join('')}</ul></section>

      <section class="band-section" id="how" style="${band(2)}"><div class="story-copy"><h2>${esc(tr('how.title'))}</h2><p>${esc(tr('how.lead'))}</p></div>
        <div class="band-card"><dl class="arena-protocol">${[1, 2, 3].map(i => `<div><dt>${esc(tr(`how.${i}.t`))}</dt><dd>${esc(tr(`how.${i}.d`))}</dd></div>`).join('')}</dl></div></section>

      <section class="band-section" id="map" style="${band(3)}"><div class="story-copy"><h2>${esc(tr('fig.title'))}</h2><p>${esc(tr('map.lead'))}</p></div>
        <div class="band-split is-wide"><div class="home-chart">${matrixChart({ matrix, data: d, lang: state.lang, selected: null, speciesId: 'all', link, tr })}
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
    <ul class="claim-list">${claims.map(c => `<li><a href="${link('claims/' + encodeURIComponent(c.id))}">${esc(L.claimText(c, state.lang).text)}</a> ${verBadge(c.verification)}</li>`).join('')}</ul></article>`;
}

const findingCtx = () => ({ tr, link, lang: state.lang, claims: state.index.claims, sources: state.index.sources, taxonomyLabel, claimText: L.claimText });

// A finding's claim list is filled in when it is first opened, so the lists load without the claims.
document.addEventListener('toggle', e => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.open) return;
  const ol = d.querySelector('[data-fd-claims]');
  if (!ol || ol.dataset.filled) return;
  const fill = () => { const f = state.index.findings.get(ol.dataset.fdClaims); if (f) { ol.innerHTML = claimItemsHtml(f, findingCtx()); ol.dataset.filled = '1'; } };
  if (state.full) fill(); else { ol.innerHTML = `<li class="loading">${esc(tr('loading.data'))}</li>`; (state.fullPromise || Promise.resolve()).then(fill); }
}, true);

function viewFinding(id) {
  const f = state.index.findings.get(id);
  if (!f) return viewNotFound();
  return { title: `${tr('fd.kicker')} ${f.id}`, html: findingPageHtml(f, findingCtx()) };
}

// All findings: an index by technology, filters, and grouped or ranked views.
function viewFindings(params) {
  const d = state.data, sp = params.get('species') || '';
  const items = (d.findings || []).filter(f => !sp || f.species_id === sp).sort(byWeight);
  const tax = d.taxonomy;
  const filters = [
    { key: 'q', type: 'search', label: tr('br.search'), placeholder: tr('fd.search.ph') },
    { key: 'strength', type: 'select', label: tr('fd.f.strength'), options: ['agree', 'mixed', 'against', 'described', 'one_paper'].map(k => [k, tr('fd.strength.' + k)]) },
    { key: 'problem', type: 'select', label: tr('fd.problem'), options: tax.welfare_problems.map(p => [p.id, pick(p, '', state.lang)]) },
    { key: 'multi', type: 'check', label: tr('fd.f.multi') }];
  return { title: tr('nav.findings'), html: lead(tr('fd.kicker'), tr('fd.page.title'), tr('fd.page.lead', { n: items.length.toLocaleString(), multi: items.filter(f => f.counts.papers > 1).length })) +
      browseHtml({ filters, views: [['group', tr('br.view.group')], ['rank', tr('br.view.rank')]], tr }),
    mount: root => mountBrowse(root, { items, tr, listClass: 'fd-list', groups: tax.technology_classes.map(t => [t.id, pick(t, '', state.lang)]), groupOf: f => f.technology_class,
      render: f => findingItemHtml(f, findingCtx()),
      test: (f, v) => (!v.strength || f.strength === v.strength) && (!v.problem || f.welfare_problem === v.problem) && (!v.multi || f.counts.papers > 1) &&
        (!v.q || [f.statement_en, f.statement_zh, f.practice_en, f.practice_zh].filter(Boolean).join(' ').toLowerCase().includes(v.q.toLowerCase())) }) };
}

// All draft actions: ranked by priority or grouped by technology, with filters.
function viewActions(params) {
  const d = state.data, sp = params.get('species') || '';
  const items = (d.actions || []).filter(a => !sp || a.species_id === sp).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const fById = new Map((d.findings || []).map(f => [f.id, f]));
  const filters = [
    { key: 'q', type: 'search', label: tr('br.search'), placeholder: tr('ac.search.ph') },
    { key: 'type', type: 'select', label: tr('ac.f.type'), options: ['adopt', 'avoid', 'test_on_farms', 'monitor', 'research'].filter(t => items.some(a => a.type === t)).map(t => [t, tr('ac.type.' + t)]) },
    { key: 'who', type: 'select', label: tr('ac.f.who'), options: [...new Set(items.map(a => a.who))].map(w => [w, tr('ac.who.' + w.replace(/ /g, '_'))]) },
    { key: 'problem', type: 'select', label: tr('fd.problem'), options: d.taxonomy.welfare_problems.filter(p => items.some(a => a.welfare_problems.includes(p.id))).map(p => [p.id, pick(p, '', state.lang)]) }];
  return { title: tr('nav.actions'), html: lead(tr('ac.kicker'), tr('ac.page.title'), tr('ac.lead', { n: items.length, multi: (d.findings || []).filter(f => f.counts.papers > 1).length, f: new Set(items.flatMap(a => a.finding_ids)).size })) +
      browseHtml({ filters, views: [['rank', tr('ac.view.rank')], ['group', tr('ac.view.class')]], tr }) + `<p class="small-note">${esc(tr('ac.formula'))}</p>`,
    mount: root => mountBrowse(root, { items, tr, listClass: 'ac-list', pageSize: 30, perGroup: 10, groups: d.taxonomy.technology_classes.map(t => [t.id, pick(t, '', state.lang)]), groupOf: a => a.technology_class,
      render: a => actionItemHtml(a, findingCtx(), fById),
      test: (a, v) => (!v.type || a.type === v.type) && (!v.who || a.who === v.who) && (!v.problem || a.welfare_problems.includes(v.problem)) &&
        (!v.q || [a.action_en, a.action_zh, a.evidence_gap, a.risks].filter(Boolean).join(' ').toLowerCase().includes(v.q.toLowerCase())) }) };
}

function viewSpeciesList() {
  const d = state.data;
  return { title: tr('nav.species'), html: lead(tr('sp.kicker'), tr('sp.title'), tr('sp.desc')) + speciesCardsHtml(d, { tr, link, lang: state.lang }) };
}

function viewSpecies(id) {
  const m = speciesModel(state.data, id, { corpus: state.corpus, nextRun: state.nextRun });
  if (!m) return viewNotFound();
  const flowHtml = c => corpusFlowHtml(c, tr);
  const topicsHtml = c => {
    const st = Object.fromEntries(c.charts.stages.map(x => [x.id, x]));
    const total = Object.values(c.charts.decades).reduce((a, v) => a + v.en + v.zh, 0);
    return `<div class="cv-two"><section><h3>${esc(tr('cv.topics'))}</h3>${topicBarsHtml(c.charts.topics, k => tr('cv.topic.' + k))}<p class="cv-note">${esc(tr('cv.topics.note', { n: Number(st.about.n).toLocaleString() }))}</p></section>
      <section><h3>${esc(tr('cv.decades'))}</h3>${decadeColumnsHtml(c.charts.decades)}<p class="cv-note">${esc(tr('cv.decades.note', { n: total.toLocaleString() }))}</p></section></div>`;
  };
  return { title: pick(m.s, 'common', state.lang), html: speciesPageHtml(m, { tr, link, lang: state.lang, flowHtml, topicsHtml, taxonomyLabel, findingsHtml: (list, o) => findingsListHtml(list, findingCtx(), o) }) + suggestionBlock(id), model: m };
}

// Species page: the evidence map for this species, and the contents links.
function setupSpeciesPage(m) {
  const page = document.querySelector('.sp-page');
  if (!page || !m) return;
  page.querySelectorAll('[data-sp-jump]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const t = document.getElementById(a.dataset.spJump); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  // The contents bar stays at the top and marks the section in view.
  if ('IntersectionObserver' in window) {
    const links = new Map([...page.querySelectorAll('[data-sp-jump]')].map(a => [a.dataset.spJump, a]));
    const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) links.forEach((a, id) => a.toggleAttribute('aria-current', id === e.target.id)); }, { rootMargin: '-30% 0px -60% 0px' });
    links.forEach((_, id) => { const t = document.getElementById(id); if (t) io.observe(t); });
    observers.push(io);
  }
  page.querySelectorAll('[data-ac-view]').forEach(b => b.addEventListener('click', () => {
    const box = b.closest('[data-ac]');
    box.querySelectorAll('[data-ac-view]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    box.querySelectorAll('[data-ac-pane]').forEach(p => { p.hidden = p.dataset.acPane !== b.dataset.acView; });
  }));
  const stage = page.querySelector('[data-sp-map]');
  if (stage) {
    const model = evidenceModel(m.data, state.lang);
    const biggest = [...model.classes].sort((a, b) => b.claims - a.claims)[0];
    mountEvidenceMap(stage, open => evidenceMapHtml(model, { tr, href: link, open }), { open: biggest && biggest.claims ? biggest.id : null });
  }
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
      (claims.length ? `<ul class="claim-list">${claims.map(c => `<li><a href="${link('claims/' + encodeURIComponent(c.id))}">${esc(L.claimText(c, state.lang).text)}</a> ${verBadge(c.verification)}</li>`).join('')}</ul>` : `<p>${esc(tr('src.noclaims'))}</p>`)
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
      <header class="species-title"><div class="record-type">${esc(tr('claim.kicker'))} ${esc(c.id)}</div><h1>${esc(L.claimText(c, state.lang).text)}</h1>
        <p class="badges">${verBadge(c.verification)} ${kindBadge(c.kind)} ${auditBadge(c.audit)}</p></header>
      ${recordBlock(c)}
      ${(state.data.findings || []).filter(f => f.claim_ids.includes(c.id)).map(f => `<p class="fd-of">${esc(tr('fd.partof'))} <a href="${link('findings/' + encodeURIComponent(f.id))}">${esc(findingText(f, state.lang))}</a></p>`).join('')}
      <h2>${esc(tr('claim.quote'))}</h2>
      <blockquote class="quote" lang="${esc(c.quote_lang || 'und')}">${esc(c.quote)}</blockquote>
      <p class="meta">${esc(tr('claim.locator'))}: ${esc(L.formatLocator(c.locator))} · ${esc(tr('claim.source'))}: ${s ? `<a href="${link('sources/' + encodeURIComponent(s.id))}" lang="${esc(s.lang)}">${esc(s.title)}</a>` : esc(c.source_id)}</p>
      <h2>${esc(tr('claim.details'))}</h2>` +
      dl([[tr('claim.species'), c.species_id ? esc(speciesName(c.species_id)) : orUnknown(null)], [tr('claim.population'), orUnknown(popText)],
          [tr('claim.intervention'), orUnknown(c.intervention)], [tr('claim.comparator'), orUnknown(c.comparator)], [tr('claim.outcome'), orUnknown(c.outcome)],
          [tr('claim.direction'), esc(tr('dir.' + (c.direction || 'not_applicable')))], [tr('claim.magnitude'), orUnknown(c.magnitude)],
          ...(c.polarity ? [[tr('claim.polarity'), esc(tr('pol.' + c.polarity))]] : []),
          ...(c.limitations ? [[tr('claim.limits'), esc(c.limitations)]] : []), ...(c.counterevidence ? [[tr('claim.counter'), esc(c.counterevidence)]] : []),
          [tr('claim.welfare'), `${esc(tr('welfare.' + c.welfare_link))}${c.welfare_link_note ? `<br><span class="meta">${esc(c.welfare_link_note)}</span>` : ''}`]]) +
      `<p><a class="button small" href="${esc(issueLink(`Correction: claim ${c.id}`, reportBody))}" target="_blank" rel="noopener noreferrer">${esc(tr('claim.report'))} ↗</a></p>
       <p class="small-note">${esc(tr('claim.report.note'))}</p>`
  };
}

// The record and its English view, side by side. The record is never replaced by the rendering.
function recordBlock(c) {
  if (!c.statement || c.statement_lang === 'en') return '';
  const shown = L.claimText(c, state.lang);
  const rec = `<div class="record-pair"><div><div class="record-type">${esc(tr('claim.record', { lang: tr('lang.' + c.statement_lang) }))}</div><p lang="${esc(c.statement_lang)}">${esc(c.statement)}</p></div>`;
  const ren = c.text_en ? `<div><div class="record-type">${esc(tr('claim.rendering', { model: c.rendering?.model || '' }))}</div><p lang="en">${esc(c.text_en)}</p></div>` : `<div><p class="small-note">${esc(tr('claim.norender'))}</p></div>`;
  return shown.text === c.statement && state.lang === 'zh' && !c.text_en ? rec + '</div>' : rec + ren + '</div>';
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

function viewError(message) {
  return { title: tr('error.load'), html: `<div class="empty"><h3>${esc(tr('error.load'))}</h3><p>${esc(message || state.error || '')}</p><button class="button" type="button" data-retry>${esc(tr('error.retry'))}</button></div>` };
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
  // Compact: an icon, with the full words for screen readers and on hover.
  $('#theme-toggle').innerHTML = dark ? '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  $('#theme-toggle').setAttribute('aria-label', tr(dark ? 'theme.light' : 'theme.dark'));
  $('#theme-toggle').title = tr(dark ? 'theme.light' : 'theme.dark');
  $('#theme-toggle').setAttribute('aria-pressed', String(dark));
  $('.sections').setAttribute('aria-label', tr('nav.label'));
  const banner = $('#banner');
  const d = state.data;
  if (d && d.release.sample) { banner.hidden = false; banner.className = 'notice sample'; banner.textContent = tr('banner.sample'); }
  else banner.hidden = true;
}

// Phone header: one row (brand + menu button); the sections and tools fold out beneath it.
function setMenu(open) {
  const bar = document.querySelector('.topbar'), btn = $('#menu-toggle');
  if (!bar || !btn) return;
  bar.classList.toggle('is-open', open);
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', tr(open ? 'nav.close' : 'nav.menu'));
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('.topbar.is-open')) { setMenu(false); $('#menu-toggle').focus(); } });
document.addEventListener('click', e => { if (!e.target.closest('.topbar')) setMenu(false); });

// Findings and Actions lists need only the small findings and actions files; a single finding, the species page,
// sources, claims, Explore and Download need the claims too.
const needsLists = (head, id) => (head === 'findings' && !id) || head === 'actions' || (head === 'species' && id);
const needsFull = (head, id) => !needsLists(head, id) && ['explore', 'species', 'sources', 'claims', 'findings', 'download'].includes(head);

function render(navigated = false) {
  setMenu(false);
  observers.forEach(o => o.disconnect()); observers = [];
  applyChrome();
  const { parts, params } = parseHash();
  let view;
  if (!state.data) view = state.error ? viewError() : { title: tr('loading'), html: `<p class="loading">${esc(tr('loading'))}</p>` };
  else if ((!state.full && needsFull(parts[0], parts[1])) || (!state.listsReady && needsLists(parts[0], parts[1]))) {
    // These pages list claims, findings or actions: show a placeholder until the background download is done.
    view = state.fullError ? viewError(state.fullError) : { title: tr('loading'), html: `<div class="load-skel" aria-busy="true"><p class="loading">${esc(tr('loading.data'))}</p><i></i><i></i><i></i></div>` };
    if (state.fullPromise && !state.fullWaiting) {
      state.fullWaiting = true;
      const again = () => { state.fullWaiting = false; render(); };
      if (needsLists(parts[0], parts[1])) state.listsWaiters.push(again); else state.fullPromise.then(again);
    }
  } else {
    const [head, id] = parts;
    if (!head || head === 'content') view = viewOverview();
    else if (head === 'explore') view = viewExplore(params);
    else if (head === 'species') view = id ? viewSpecies(id) : viewSpeciesList();
    else if (head === 'sources') view = id ? viewSource(id) : viewSources(params);
    else if (head === 'claims' && id) view = viewClaim(id);
    else if (head === 'findings') view = id ? viewFinding(id) : viewFindings(params);
    else if (head === 'actions') view = viewActions(params);
    else if (head === 'pipeline') view = viewPipeline();
    else if (head === 'corpus') view = viewCorpus();
    else if (head === 'methods') view = viewMethods();
    else if (head === 'download') view = viewDownload();
    else view = viewNotFound();
  }
  const section = parts[0] || '';
  const active = ['explore', 'sources', 'claims'].includes(section) ? 'explore' : section;
  document.querySelectorAll('.sections a').forEach(a => {
    const on = a.dataset.route === active;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  moveBlob(true);
  const wide = !parts[0] || ['content', 'explore', 'pipeline', 'corpus', 'actions'].includes(parts[0]) || (parts[0] === 'species' && parts[1]) || (parts[0] === 'findings' && !parts[1]);
  $('#content').innerHTML = wide ? view.html : `<div class="narrow">${view.html}</div>`;
  // A short fade when the page changes (not when a filter redraws part of it).
  if (navigated) { const c = $('#content'); c.classList.remove('is-enter'); void c.offsetWidth; c.classList.add('is-enter'); }
  document.title = `${view.title} — ${tr('site.title')}`;
  const pathKey = parts.join('/');
  if (navigated && pathKey !== state.lastPath) { window.scrollTo(0, 0); $('#content').focus({ preventScroll: true }); }
  else if (navigated && params.get('cell')) { const panel = $('.cell-panel'); if (panel) panel.scrollIntoView({ block: 'nearest' }); }
  state.lastPath = pathKey;
  if (!parts[0] || parts[0] === 'content') setupHomeEffects();
  if (parts[0] === 'species' && parts[1]) setupSpeciesPage(view.model);
  if (view.mount) view.mount($('#content'));
  setupReveal();
  if (parts[0] === 'corpus' && state.papers && state.corpus) {
    const root = document.querySelector('[data-cl-root]');
    if (root) { const holder = { filter: state.corpusFilter }; mountCorpusList(root, state.papers, state.corpus, tr, holder); state.corpusFilter = holder.filter; }
  }
}

// Sections, pipeline lanes and list groups fade in as they reach the screen, so each reads as its own block.
function setupReveal() {
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const els = [...document.querySelectorAll('#content .sp-sec, #content .fw-over, #content .fw-walk, #content .br-group, #content .corpus-tree, #content .cv-two')];
  const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of els) { if (el.getBoundingClientRect().top < innerHeight) continue; el.classList.add('reveal'); io.observe(el); }
  observers.push(io);
}

// ---------- footer and home-page effects ----------
function renderFooter() {
  const d = state.data;
  const reviewLink = esc(issueLink('Offer to review', 'Languages, fish-welfare background, hours available:\n\n'));
  const list = items => `<ul>${items.map(([label, href, ext]) => `<li><a href="${esc(href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(label)}${ext ? ' ↗' : ''}</a></li>`).join('')}</ul>`;
  const card = (key, items) => `<nav class="site-footer-card" aria-label="${esc(tr(key))}"><h2>${esc(tr(key))}</h2>${list(items)}</nav>`;
  $('#site-footer').innerHTML = `<div class="site-footer-panel"><div class="site-footer-cards">
      ${card('foot.explore', [[tr('nav.explore'), link('explore')], [tr('nav.species'), link('species')], [tr('nav.findings'), link('findings')], [tr('nav.actions'), link('actions')], [tr('nav.sources'), link('sources')]])}
      ${card('foot.learn', [[tr('nav.methods'), link('methods')], [tr('nav.download'), link('download')], [tr('nav.pipeline'), link('pipeline')], [tr('nav.corpus'), link('corpus')]])}
      ${card('foot.open', [['myrias.org', 'https://myrias.org/', true], [tr('footer.repo'), 'https://github.com/invi-bhagyesh/myrias', true]])}
      <div class="site-footer-card site-footer-cta"><div><p>${esc(tr('foot.cta'))}</p><a class="site-footer-button" href="${reviewLink}" target="_blank" rel="noopener noreferrer">${esc(tr('foot.cta.btn'))} <span aria-hidden="true">→</span></a></div></div>
    </div>
    <div class="site-footer-scene" aria-hidden="true">${pixelHills('footer')}<span class="site-footer-wordmark">Myrias</span></div></div>`;
}

// The front page can show the network three ways. "full" is the intended end state and "simple" its
// hubs only; both are labelled placeholder data until a release holds enough verified claims.
// "today" is always the real release.
const GRAPH_VIEWS = ['full', 'simple', 'today'];
const isPlaceholder = d => claimCount(d) < MIN_REAL_CLAIMS;
const graphView = d => (GRAPH_VIEWS.includes(state.graphView) ? state.graphView : isPlaceholder(d) ? 'full' : 'today');
function viewGraph(d, lang, view) {
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
  home.querySelectorAll('[data-scroll]').forEach(b => b.addEventListener('click', () => { const t = document.getElementById(b.dataset.scroll); if (t) t.closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  const stage = home.querySelector('[data-graph]');
  if (stage && state.data) {
    let handle = null;
    const show = () => {
      const d = state.data, view = graphView(d);
      // "Full picture" and "Simple" are always invented data, so they always carry the badge.
      const sample = view !== 'today';
      if (handle) handle.destroy();
      stage.style.height = '';
      if (view === 'today') {
        const model = evidenceModel(d, state.lang);
        const biggest = [...model.classes].sort((a, b) => b.claims - a.claims)[0];
        handle = mountEvidenceMap(stage, open => evidenceMapHtml(model, { tr, href: link, open }), { open: biggest && biggest.claims ? biggest.id : null });
        home.querySelector('[data-glegend]').innerHTML = '';
      } else {
        const g = viewGraph(d, state.lang, view);
        handle = mountGraph(stage, g, { tr, navigate: href => { location.hash = href; } });
        home.querySelector('[data-glegend]').innerHTML = legendHtml(g, tr);
      }
      home.querySelector('[data-gbadge]').hidden = true;
      home.querySelector('[data-gnote]').textContent = sample ? tr('graph.note.placeholder') : tr('evmap.hint');
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
  if (target.id === 'menu-toggle') setMenu(!document.querySelector('.topbar').classList.contains('is-open'));
  else if (target.id === 'lang-toggle') { state.lang = state.lang === 'zh' ? 'en' : 'zh'; store('myrias-lang', state.lang); render(); }
  else if (target.id === 'theme-toggle') {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; store('myrias-theme', next); applyChrome();
  } else if (target.dataset.download) handleDownload(target.dataset.download);
  else if (target.hasAttribute('data-retry')) { state.data = null; state.fullError = null; render(); load().then(render); }
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
// English is the default; a visitor who switches to Chinese keeps that choice.
state.lang = store('myrias-lang') === 'zh' ? 'zh' : 'en';
let preferredTheme = store('myrias-theme');
if (!preferredTheme) { try { preferredTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { preferredTheme = 'light'; } }
document.documentElement.dataset.theme = preferredTheme;

render();
load().then(render);
