// Feed acclimation: everything the evidence says about moving farmed fish from live or fresh food onto formulated
// feed. Mandarin fish eat only live fish in the wild, so training them onto feed is one of the biggest welfare
// questions in their farming (hunger, failed training, deaths, stress), and it matters for other carnivorous fish too.
// The section gathers findings by their practice name, sorted into four groups, plus the draft actions that cite
// them. The rules are plain patterns, published here, so anyone can see what is and is not counted.
import { escapeHtml as esc } from './site-lib.js';

const FEED = /(feed|feeding|diet|bait|pellet|prey|food|饲料|饵|食)/i;
const TRAIN = /(\btrain|domesticat|wean|transition|acclimat|accept|switch|induc\w* consumption|co-feeding|驯食|驯化|转食|诱食)/i;
const COMPARE = /(replac\w*|versus|\bvs\.?|instead of|comparison|compared)/i;
const FRESH = /(live|trash|fresh|chilled|frozen|dead) (bait|fish|prey|feed|food)|活饵|冰鲜|鲜鱼|饵料鱼/i;
const FORMULATED = /(artificial|formulated|compound|pellet|dry) (feed|diet)|人工饲料|配合饲料|颗粒饲料/i;
// Look-alikes: acclimation to something other than feed.
const NOT = /(temperature|thermal|flow|velocity|salinity|recirculat|water quality|light|photoperiod|phosphorus|energy ratio|transport)/i;

// Pure: is this practice about moving fish onto formulated feed?
export function isFeedAcclimation(name) {
  const t = String(name || '');
  if (!t || NOT.test(t)) return false;
  if (TRAIN.test(t) && FEED.test(t)) return true;
  if (FRESH.test(t) && (FORMULATED.test(t) || COMPARE.test(t))) return true;
  if (FORMULATED.test(t) && COMPARE.test(t)) return true;
  return /驯食|转食/.test(t);
}

// Pure: which of the four groups a practice falls in.
export const GROUPS = ['method', 'compare', 'aids', 'breeding'];
export function feedGroup(name) {
  const t = String(name || '');
  if (/(selective breeding|breeding for|strain|hybrid|选育|育种|品系)/i.test(t)) return 'breeding';
  if (/(probiotic|attractant|additive|betaine|supplement|soft pellet|training feed|mince|flavou?r|诱食剂|添加|益生菌)/i.test(t) || /(miaozhuangyuan|yujia)/i.test(t)) return 'aids';
  if (COMPARE.test(t) || /(live bait farming|feeding mode|natural feed)/i.test(t) || (FRESH.test(t) && !TRAIN.test(t))) return 'compare';
  return 'method';
}

// Pure: the findings, actions, claims and papers that belong to the topic.
export function feedModel(data) {
  const findings = (data.findings || []).filter(f => isFeedAcclimation(f.practice_en) || isFeedAcclimation(f.practice_zh));
  const ids = new Set(findings.map(f => f.id));
  const actions = (data.actions || []).filter(a => a.finding_ids.some(id => ids.has(id))).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const claimIds = new Set(findings.flatMap(f => f.claim_ids));
  const claims = (data.claims || []).filter(c => claimIds.has(c.id));
  const papers = new Set(claims.map(c => c.source_id));
  const byGroup = Object.fromEntries(GROUPS.map(g => [g, []]));
  for (const f of findings) byGroup[feedGroup(f.practice_en || f.practice_zh)].push(f);
  const strength = findings.reduce((m, f) => ({ ...m, [f.strength]: (m[f.strength] || 0) + 1 }), {});
  return { findings, actions, byGroup, strength, claims: claimIds.size, papers: papers.size, practices: new Set(findings.map(f => f.practice_en)).size };
}

export function feedPageHtml(m, ctx) {
  const { tr, findingsHtml, actionsHtml } = ctx;
  const n = x => Number(x).toLocaleString();
  const tiles = [[m.papers, tr('fa.t.papers')], [m.claims, tr('fa.t.claims')], [m.findings.length, tr('fa.t.findings')], [m.actions.length, tr('fa.t.actions')]];
  const groups = GROUPS.filter(g => m.byGroup[g].length).map(g => `<section class="fa-group" id="fa-${g}"><h2>${esc(tr('fa.g.' + g))} <span class="fa-n">${n(m.byGroup[g].length)}</span></h2>
      <p class="sp-lead">${esc(tr('fa.g.' + g + '.d'))}</p>${findingsHtml(m.byGroup[g], { first: 6 })}</section>`).join('');
  return `<section class="lead fa-lead"><div><div class="record-type">${esc(tr('fa.kicker'))}</div><h1>${esc(tr('fa.title'))}</h1><p>${esc(tr('fa.lead'))}</p></div></section>
    <ul class="corpus-tiles fa-tiles">${tiles.map(([v, l]) => `<li><strong>${n(v)}</strong><span>${esc(l)}</span></li>`).join('')}</ul>
    <nav class="fa-jump">${GROUPS.filter(g => m.byGroup[g].length).map(g => `<a href="#fa-${g}" data-jump-id="fa-${g}">${esc(tr('fa.g.' + g))} · ${n(m.byGroup[g].length)}</a>`).join('')}${m.actions.length ? `<a href="#fa-actions" data-jump-id="fa-actions">${esc(tr('fa.t.actions'))} · ${n(m.actions.length)}</a>` : ''}</nav>
    ${m.actions.length ? `<section class="fa-group" id="fa-actions"><h2>${esc(tr('fa.actions'))}</h2><p class="sp-lead">${esc(tr('fa.actions.d'))}</p>${actionsHtml(m.actions)}</section>` : ''}
    ${groups}
    <p class="small-note">${esc(tr('fa.how'))} <a href="https://github.com/invi-bhagyesh/myrias/blob/main/public/site-topic.js" target="_blank" rel="noopener">${esc(tr('fa.how.link'))} ↗</a></p>`;
}
