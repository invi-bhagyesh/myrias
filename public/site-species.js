// One page per species: who the fish is, what the papers say, where the evidence came from, and the
// steps that produced it. Everything is computed from the release, the corpus summary and the run plan;
// only the short profile below is written by hand.
import { pick, escapeHtml as esc } from './site-lib.js';
import { actionItemHtml } from './site-actions.js';

// Hand-kept profile per species. Short, general facts a reader needs to follow the evidence.
export const PROFILES = {
  'mandarin-fish': {
    image: 'art/species/mandarin-fish.webp',
    family: ['Sinipercidae', '鮨鲈科'],
    range: ['Rivers and lakes of East Asia, mainly China', '东亚的江河湖泊，主要在中国'],
    farmed: ['Farmed widely in China in ponds and cages', '在中国广泛养殖，以池塘和网箱为主'],
    diet: ['Eats only live fish in the wild; farms train it onto dead or formulated feed', '野生状态下只吃活鱼；养殖中需要驯化它吃冰鲜鱼或人工饲料'],
    why: ['Feed training, live-prey supply, disease and stocking density shape most of its welfare on farms.', '驯食、活饵供应、疾病和放养密度决定了它在养殖中的大部分福利状况。']
  }
};

const n = x => (x === null || x === undefined ? '—' : Number(x).toLocaleString());

// Pure: the numbers and lists the page shows for one species.
export function speciesModel(data, id, { corpus = null, nextRun = null } = {}) {
  const s = data.species.find(x => x.id === id);
  if (!s) return null;
  const claims = data.claims.filter(c => c.species_id === id);
  const apps = data.applications.filter(a => a.species_id === id);
  // Until the claim files arrive the release's own summary stands in for them.
  const stats = !claims.length ? data.species_stats?.[id] : null;
  const bySource = new Map(stats ? Object.entries(stats.by_source) : []);
  const claimCount = stats ? stats.claims : claims.length;
  for (const c of claims) bySource.set(c.source_id, (bySource.get(c.source_id) || 0) + 1);
  const sources = data.sources.filter(x => bySource.has(x.id)).map(x => ({ ...x, claims: bySource.get(x.id) })).sort((a, b) => b.claims - a.claims || (a.year || 0) - (b.year || 0));
  const verdicts = stats ? { ...stats.verdicts } : {};
  for (const c of claims) verdicts[c.verification] = (verdicts[c.verification] || 0) + 1;
  const interventions = new Map((data.interventions || []).map(i => [i.id, i]));
  const byIntervention = new Map();
  // One row per practice name within a technology class: two records with the same name are one practice.
  for (const a of apps) {
    const iv = interventions.get(a.intervention_id);
    const key = `${a.technology_class}|${(iv?.name_en || iv?.name_zh || a.intervention_id).toLowerCase()}`;
    const row = byIntervention.get(key) || { id: a.intervention_id, intervention: iv, cls: a.technology_class, problems: new Set(), claims: new Set() };
    row.problems.add(a.welfare_problem); a.claim_ids.forEach(c => row.claims.add(c));
    byIntervention.set(key, row);
  }
  const claimById = new Map(claims.map(c => [c.id, c]));
  const top = [...byIntervention.values()].map(r => {
    const cs = [...r.claims].map(c => claimById.get(c)).filter(Boolean);
    return { ...r, problems: [...r.problems], claims: cs.length, supported: cs.filter(c => c.verification === 'supported').length };
  }).sort((a, b) => b.claims - a.claims);
  const runs = data.runs.filter(r => r.species_id === id);
  const findings = (data.findings || []).filter(f => f.species_id === id);
  const actions = (data.actions || []).filter(a => a.species_id === id).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const ownCorpus = corpus && corpus.species === id ? corpus : null;
  const ownPlan = nextRun && nextRun.species === id ? nextRun : null;
  return { s, claims, claimCount, apps, sources, verdicts, top, runs, findings, actions, corpus: ownCorpus, plan: ownPlan,
    data: { ...data, claims, applications: apps, sources: data.sources.filter(x => bySource.has(x.id)), species: [s] } };
}

// The steps from search to released claims, as numbered rows with their counts and status.
export function speciesSteps(m) {
  const steps = [];
  const c = m.corpus;
  if (c) {
    const st = Object.fromEntries((c.charts?.stages || []).map(x => [x.id, x]));
    const ok = Object.values(c.headline.sources || {}).filter(v => v === 'ok').length;
    steps.push({ key: 'search', status: 'done', n: c.headline.papers_found, vars: { db: ok, en: n(c.headline.by_language?.en), zh: n(c.headline.by_language?.zh) } });
    if (st.about) steps.push({ key: 'screen', status: 'done', n: st.about.n, vars: { en: n(st.about.by_lang.en), zh: n(st.about.by_lang.zh) } });
    if (st.full_text) steps.push({ key: 'fulltext', status: 'done', n: st.full_text.n, vars: { en: n(st.full_text.by_lang.en), zh: n(st.full_text.by_lang.zh) } });
  }
  const phases = m.plan ? m.plan.phases : [];
  for (const ph of phases) {
    const a = ph.actual;
    steps.push({ key: 'phase', status: ph.status || 'planned', n: a ? a.claims_released : null, phase: ph,
      vars: a ? { id: ph.id, papers: n(ph.papers), extracted: n(a.claims_extracted), found: n(a.claims_quote_found), relevant: n(a.claims_relevant), supported: n(a.claims_supported) }
        : { id: ph.id, papers: n(ph.papers), windows: n(ph.windows) } });
  }
  steps.push({ key: 'audit', status: m.runs.some(r => r.audit) ? 'done' : 'planned', n: null, vars: {} });
  return steps;
}

export const SPECIES_SECTIONS = [['sp-about', 'sp.sec.about'], ['sp-found', 'sp.sec.found'], ['sp-do', 'sp.sec.do'], ['sp-from', 'sp.sec.from'], ['sp-steps', 'sp.sec.steps'], ['sp-limits', 'sp.sec.limits']];

// The page. ctx: { tr, link, lang, flowHtml(corpus), topicsHtml(corpus), taxonomyLabel(kind, id) }
export function speciesPageHtml(m, ctx) {
  const { tr, link, lang } = ctx;
  const { s } = m;
  const p = PROFILES[s.id] || {};
  const i = lang === 'zh' ? 1 : 0;
  const other = lang === 'zh' ? s.common_en : s.common_zh;
  const supported = m.verdicts.supported || 0, partial = m.verdicts.partial || 0;
  const zhPapers = m.sources.filter(x => x.lang === 'zh').length;
  const tiles = [[supported, 'sp.t.supported'], [m.sources.length, 'sp.t.papers'], [m.top.length, 'sp.t.interventions'], [m.corpus ? m.corpus.headline.papers_found : null, 'sp.t.found']];
  const cls = id => ctx.taxonomyLabel('technology_classes', id), prob = id => ctx.taxonomyLabel('welfare_problems', id);

  const hero = `<section class="sp-hero"><div class="sp-hero-copy">
      <p class="sp-crumb"><a href="${link('species')}">${esc(tr('nav.species'))}</a> / ${esc(tr('group.' + s.group))}</p>
      <h1>${esc(pick(s, 'common', lang))}${other ? ` <span class="sp-other" lang="${lang === 'zh' ? 'en' : 'zh'}">${esc(other)}</span>` : ''}</h1>
      <p class="sp-sci"><i>${esc(s.scientific)}</i>${p.family ? ` · ${esc(p.family[i])}` : ''}</p>
      <p class="sp-status"><span class="pill">${esc(tr('run.' + s.run_status))}</span><span>${esc(pick(s, 'summary', lang) || '')}</span></p>
      <ul class="sp-tiles">${tiles.map(([v, k]) => `<li><strong>${n(v)}</strong><span>${esc(tr(k))}</span></li>`).join('')}</ul>
    </div>${p.image ? `<figure class="sp-art"><img src="${esc(p.image)}" alt="${esc(tr('sp.img.alt', { name: pick(s, 'common', lang) }))}" width="725" height="652" decoding="async"></figure>` : ''}</section>`;

  const contents = `<nav class="home-contents sp-contents" aria-label="${esc(tr('contents'))}"><span>${esc(tr('contents'))}</span>${SPECIES_SECTIONS.map(([id, key], k) => `<a href="${link('species/' + encodeURIComponent(s.id))}" data-sp-jump="${esc(id)}"><span>${String(k + 1).padStart(2, '0')}</span>${esc(tr(key))}</a>`).join('')}</nav>`;

  const facts = [[tr('sp.scientific'), `<i>${esc(s.scientific)}</i>`], [tr('sp.names'), `${esc(s.common_en)} · <span lang="zh">${esc(s.common_zh || '—')}</span>`]];
  if (p.family) facts.push([tr('sp.family'), esc(p.family[i])]);
  if (p.range) facts.push([tr('sp.range'), esc(p.range[i])]);
  if (p.farmed) facts.push([tr('sp.farmed'), esc(p.farmed[i])]);
  if (p.diet) facts.push([tr('sp.diet'), esc(p.diet[i])]);
  const about = `<section class="sp-sec" id="sp-about"><h2>${esc(tr('sp.sec.about'))}</h2>${p.why ? `<p class="sp-lead">${esc(p.why[i])}</p>` : ''}
    <dl class="sp-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl></section>`;

  const total = supported + partial;
  const verdictBar = total ? `<div class="sp-verdict" role="img" aria-label="${esc(tr('sp.verdict', { s: supported, p: partial }))}"><i class="v-sup" style="flex:${supported}"></i><i class="v-par" style="flex:${partial}"></i></div>
    <p class="sp-verdict-key"><span><i class="v-sup"></i>${esc(tr('sp.v.supported', { n: supported }))}</span><span><i class="v-par"></i>${esc(tr('sp.v.partial', { n: partial }))}</span></p>` : '';
  const maxC = Math.max(1, ...m.top.map(r => r.claims));
  const row = r => `<tr><td><a href="${link('explore', { species: s.id, cell: `${r.problems[0]}|${r.cls}` })}">${esc(pick(r.intervention, 'name', lang) || r.id)}</a><small>${esc(cls(r.cls))}</small></td>
      <td>${r.problems.map(x => `<span class="sp-chip">${esc(prob(x))}</span>`).join('')}</td>
      <td class="sp-num"><span class="sp-meter"><i style="width:${(100 * r.claims / maxC).toFixed(1)}%"></i></span>${r.claims}<small>${esc(tr('sp.of.supported', { n: r.supported }))}</small></td></tr>`;
  const head = `<thead><tr><th>${esc(tr('sp.col.intervention'))}</th><th>${esc(tr('sp.col.problem'))}</th><th>${esc(tr('sp.col.claims'))}</th></tr></thead>`;
  const FIRST = 8, rest = m.top.slice(FIRST);
  const found = `<section class="sp-sec" id="sp-found"><h2>${esc(tr('sp.sec.found'))}</h2><p class="sp-lead">${esc(tr('sp.found.lead', { claims: n(m.claimCount), papers: n(m.sources.length), zh: n(zhPapers) }))}</p>
    ${verdictBar}
    ${m.findings.length && ctx.findingsHtml ? `<h3>${esc(tr('fd.title'))}</h3><p class="sp-lead">${esc(tr('fd.lead', { n: n(m.findings.length), multi: n(m.findings.filter(f => f.counts.papers > 1).length) }))}</p>${ctx.findingsHtml(m.findings, { first: 6, rest: false })}<p><a class="button small" href="${link('findings', { species: s.id })}">${esc(tr('fd.all', { n: n(m.findings.length) }))} →</a></p>`
    : m.top.length ? `<h3>${esc(tr('sp.top'))}</h3><div class="sp-table"><table class="plain">${head}<tbody>${m.top.slice(0, FIRST).map(row).join('')}</tbody></table>${rest.length ? `<details class="sp-more"><summary>${esc(tr('sp.more', { n: rest.length }))}</summary><table class="plain"><tbody>${rest.map(row).join('')}</tbody></table></details>` : ''}</div>` : `<p>${esc(tr('sp.noapps'))}</p>`}
    <h3>${esc(tr('sp.map'))}</h3><div class="cv-card sp-map"><div class="graph-stage" data-sp-map></div><p class="graph-note">${esc(tr('evmap.hint'))}</p></div>
    <p><a class="button small" href="${link('explore', { species: s.id })}">${esc(tr('sp.explore'))} →</a></p></section>`;

  const paper = x => `<li><a href="${link('sources/' + encodeURIComponent(x.id))}" lang="${esc(x.lang)}">${esc(x.title)}</a>
      <span class="sp-pmeta">${x.year ? esc(x.year) + ' · ' : ''}${esc(tr('lang.' + x.lang))} · ${esc(tr('sp.claims.n', { n: x.claims }))}</span></li>`;
  const morePapers = m.sources.slice(8);
  const from = `<section class="sp-sec" id="sp-from"><h2>${esc(tr('sp.sec.from'))}</h2>
    ${m.corpus && m.corpus.charts ? `<p class="sp-lead">${esc(tr('sp.from.lead'))}</p><p class="cv-legend">${['en', 'zh'].map(l => `<span><i style="background:var(--lang-${l})"></i>${esc(tr('cv.lang.' + l))}</span>`).join('')}<a href="${link('corpus')}">${esc(tr('home.flow.more'))} →</a></p>
      <div class="cv-card">${ctx.flowHtml(m.corpus)}</div>${ctx.topicsHtml(m.corpus)}` : ''}
    <h3>${esc(tr('sp.papers', { n: m.sources.length }))}</h3><ol class="sp-papers">${m.sources.slice(0, 8).map(paper).join('')}</ol>${morePapers.length ? `<details class="sp-more"><summary>${esc(tr('sp.more.papers', { n: morePapers.length }))}</summary><ol class="sp-papers" start="9">${morePapers.map(paper).join('')}</ol></details>` : ''}</section>`;

  const steps = speciesSteps(m);
  const stepRows = steps.map((st, k) => `<li class="sp-step is-${esc(st.status)}"><span class="sp-step-n">${String(k + 1).padStart(2, '0')}</span>
      <div><h3>${esc(tr('sp.step.' + st.key + '.t', st.vars))} <span class="sp-step-badge">${esc(tr('nr.status.' + st.status))}</span></h3>
      <p>${esc(tr('sp.step.' + st.key + (st.key === 'phase' && !st.phase.actual ? '.plan' : '') + '.d', st.vars))}</p></div>
      ${st.n !== null && st.n !== undefined ? `<strong class="sp-step-big">${n(st.n)}</strong>` : '<span></span>'}</li>`).join('');
  const stepsSec = `<section class="sp-sec" id="sp-steps"><h2>${esc(tr('sp.sec.steps'))}</h2><p class="sp-lead">${esc(tr('sp.steps.lead'))}</p><ol class="sp-steps">${stepRows}</ol>
    <p class="small-note"><a href="${link('pipeline')}">${esc(tr('sp.steps.more'))} →</a></p></section>`;

  const limits = [tr('sp.lim.audit'), m.corpus && Object.values(m.corpus.headline.sources || {}).some(v => v !== 'ok') ? tr('sp.lim.db') : null,
    m.corpus ? tr('sp.lim.zh', { zh: n(m.corpus.charts?.stages.find(x => x.id === 'full_text')?.by_lang.zh), of: n(m.corpus.charts?.stages.find(x => x.id === 'about')?.by_lang.zh) }) : null,
    tr('sp.lim.species')].filter(Boolean);
  const limitsSec = `<section class="sp-sec" id="sp-limits"><h2>${esc(tr('sp.sec.limits'))}</h2><ul class="arena-rows">${limits.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>`;

  // Draft actions: the top five here; the Actions page has all of them, by priority or by technology.
  const fById = new Map(m.findings.map(f => [f.id, f]));
  const doSec = m.actions.length ? `<section class="sp-sec" id="sp-do"><h2>${esc(tr('sp.sec.do'))}</h2><p class="sp-lead">${esc(tr('ac.lead', { n: m.actions.length, multi: m.findings.filter(f => f.counts.papers > 1).length, f: new Set(m.actions.flatMap(a => a.finding_ids)).size }))}</p>
    <ol class="ac-list">${m.actions.slice(0, 5).map(a => actionItemHtml(a, ctx, fById)).join('')}</ol>
    <p><a class="button small" href="${link('actions', { species: s.id })}">${esc(tr('ac.all', { n: m.actions.length }))} →</a></p>
    ${ctx.rankNote || ''}</section>` : '';
  return `<div class="sp-page">${hero}${contents}${about}${found}${doSec}${from}${stepsSec}${limitsSec}</div>`;
}

// Cards for the species list.
export function speciesCardsHtml(data, ctx) {
  const { tr, link, lang } = ctx;
  return `<ul class="sp-cards">${data.species.map(s => {
    const p = PROFILES[s.id] || {}, claims = data.claims.filter(c => c.species_id === s.id).length;
    return `<li><a class="sp-card" href="${link('species/' + encodeURIComponent(s.id))}">${p.image ? `<img src="${esc(p.image)}" alt="" width="725" height="652" loading="lazy">` : '<span class="sp-card-blank"></span>'}
      <span class="sp-card-body"><span class="record-type">${esc(tr('run.' + s.run_status))} · ${esc(tr('group.' + s.group))}</span><strong>${esc(pick(s, 'common', lang))}</strong>
      <i>${esc(s.scientific)}</i><span class="sp-card-n">${esc(tr('sp.card.claims', { n: claims }))}</span></span></a></li>`;
  }).join('')}</ul>`;
}
