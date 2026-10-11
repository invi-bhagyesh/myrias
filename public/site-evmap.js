// Home-page evidence map for the real release: technology class -> intervention -> welfare problem.
// Every node is labelled; link width follows the number of claims behind an intervention. Empty
// technology classes and welfare problems stay on the map, marked "nothing found yet", because the
// gaps are part of the answer.
import { pick, escapeHtml as esc } from './site-lib.js';
import { PALETTE, shortLabel } from './site-graph.js';

// Pure: what the map shows. Testable in Node.
export function evidenceModel(data, lang = 'en') {
  const tax = data.taxonomy;
  const interventions = new Map((data.interventions || []).map(i => [i.id, i]));
  const classes = tax.technology_classes.map((c, i) => ({ id: c.id, label: shortLabel(pick(c, '', lang)), color: PALETTE[i % PALETTE.length], apps: 0, claims: 0 }));
  const problems = tax.welfare_problems.map(p => ({ id: p.id, label: shortLabel(pick(p, '', lang)), apps: 0, claims: 0 }));
  const cIdx = new Map(classes.map((c, i) => [c.id, i])), pIdx = new Map(problems.map((p, i) => [p.id, i]));
  const apps = data.applications
    .filter(a => cIdx.has(a.technology_class) && pIdx.has(a.welfare_problem))
    .map(a => ({
      id: a.id, species: a.species_id, cls: a.technology_class, prob: a.welfare_problem, claims: a.claim_ids.length,
      label: pick(interventions.get(a.intervention_id), 'name', lang) || a.intervention_id || a.id,
      outcome: a.outcome_evidence || ''
    }))
    .sort((a, b) => cIdx.get(a.cls) - cIdx.get(b.cls) || b.claims - a.claims);
  for (const a of apps) {
    const c = classes[cIdx.get(a.cls)], p = problems[pIdx.get(a.prob)];
    c.apps++; c.claims += a.claims; p.apps++; p.claims += a.claims;
    a.color = c.color;
  }
  const inApps = new Set(data.applications.flatMap(a => a.claim_ids));
  return {
    classes, problems, apps,
    totals: {
      claims: data.claims.length, inApps: data.claims.filter(c => inApps.has(c.id)).length,
      sources: data.sources.length, zh: data.sources.filter(s => s.lang === 'zh').length, species: data.species.length,
      classesWith: classes.filter(c => c.apps).length
    }
  };
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const W = 1000, TOP = 58, ROW = 54, XC = 262, XA = 388, XAE = 702, XP = 800, BAR = 115;

function rowsY(n, height) {
  const step = height / n;
  return Array.from({ length: n }, (_, i) => TOP + step * (i + 0.5));
}
const curve = (x0, y0, x1, y1) => { const m = (x0 + x1) / 2; return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1}`; };

// The map as markup: an SVG for wide screens and a list for phones. href(path, query) builds router links.
export function evidenceMapHtml(model, { tr, href }) {
  const { classes, problems, apps, totals } = model;
  const n = Math.max(classes.length, problems.length, apps.length, 1);
  const height = n * ROW;
  const H = TOP + height + 14;
  const yc = rowsY(classes.length, height), yp = rowsY(problems.length, height), ya = rowsY(Math.max(apps.length, 1), height);
  const maxClaims = Math.max(1, ...apps.map(a => a.claims));
  const width = k => (1.4 + 7 * Math.sqrt(k / maxClaims)).toFixed(1);
  const cY = new Map(classes.map((c, i) => [c.id, yc[i]])), pY = new Map(problems.map((p, i) => [p.id, yp[i]]));
  const explore = (q = {}) => esc(href('explore', q));

  const links = apps.map((a, i) => {
    const keys = `c:${a.cls} a:${a.id} p:${a.prob}`;
    return `<path class="em-link" data-k="${keys}" d="${curve(XC + 8, cY.get(a.cls), XA - 10, ya[i])}" stroke="${a.color}" stroke-width="${width(a.claims)}"/>` +
      `<path class="em-link" data-k="${keys}" d="${curve(XAE + 6, ya[i], XP - 8, pY.get(a.prob))}" stroke="${a.color}" stroke-width="${width(a.claims)}"/>`;
  }).join('');

  const head = [[XC, 'end', 'evmap.col.class'], [XA, 'start', 'evmap.col.app'], [XP, 'start', 'evmap.col.problem']]
    .map(([x, anchor, key]) => `<text class="em-head" x="${anchor === 'end' ? x + 6 : x}" y="22" text-anchor="${anchor}">${esc(tr(key))}</text>`).join('');

  const count = (key, k) => tr(k === 1 ? key + '.one' : key, { n: k });
  const sub = x => (x.apps ? `${count('evmap.apps', x.apps)} · ${count('evmap.claims', x.claims)}` : tr('evmap.none'));
  const oe = id => { const s = tr('evmap.oe.' + id); return s === 'evmap.oe.' + id ? '' : s; };
  const classNodes = classes.map((c, i) => `<a href="${explore()}" class="em-node${c.apps ? '' : ' is-empty'}" data-k="c:${c.id}">
    <circle cx="${XC}" cy="${yc[i]}" r="7" ${c.apps ? `fill="${c.color}"` : `fill="none" stroke="${c.color}"`}/>
    <text x="${XC - 16}" y="${yc[i] - 3}" text-anchor="end" class="em-label">${esc(c.label)}</text>
    <text x="${XC - 16}" y="${yc[i] + 13}" text-anchor="end" class="em-sub">${esc(sub(c))}</text></a>`).join('');
  const probNodes = problems.map((p, i) => `<a href="${explore()}" class="em-node${p.apps ? '' : ' is-empty'}" data-k="p:${p.id}">
    <circle cx="${XP}" cy="${yp[i]}" r="6" ${p.apps ? 'class="em-pfill"' : 'class="em-pempty"'}/>
    <text x="${XP + 14}" y="${yp[i] - 3}" class="em-label">${esc(p.label)}</text>
    <text x="${XP + 14}" y="${yp[i] + 13}" class="em-sub">${esc(sub(p))}</text></a>`).join('');
  const appNodes = apps.length ? apps.map((a, i) => {
    const bar = 6 + BAR * (a.claims / maxClaims);
    return `<a href="${explore({ species: a.species, cell: `${a.prob}|${a.cls}` })}" class="em-node" data-k="a:${a.id}">
      <title>${esc(a.label)}</title>
      <text x="${XA}" y="${ya[i] - 6}" class="em-label em-app">${esc(clip(a.label, 44))}</text>
      <rect x="${XA}" y="${ya[i] + 2}" width="${bar.toFixed(1)}" height="7" rx="3.5" fill="${a.color}"/>
      <text x="${XA + bar + 8}" y="${ya[i] + 9}" class="em-sub">${esc(count('evmap.claims', a.claims))}${oe(a.outcome) ? ' · ' + esc(oe(a.outcome)) : ''}</text></a>`;
  }).join('') : `<text x="${(XA + XAE) / 2}" y="${TOP + height / 2}" text-anchor="middle" class="em-sub">${esc(tr('evmap.noapps'))}</text>`;

  const svg = `<svg class="em-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr('evmap.aria'))}">${head}<g class="em-links">${links}</g>${classNodes}${appNodes}${probNodes}</svg>`;

  // Phone layout: the same content as a list, grouped by technology.
  const list = classes.filter(c => c.apps).map(c => `<li><h3><span class="sw" style="background:${c.color}"></span>${esc(c.label)}</h3><ul>${apps.filter(a => a.cls === c.id).map(a =>
    `<li><a href="${explore({ species: a.species, cell: `${a.prob}|${a.cls}` })}">${esc(a.label)}</a><span>${esc(count('evmap.claims', a.claims))} → ${esc(problems.find(p => p.id === a.prob).label)}</span></li>`).join('')}</ul></li>`).join('');
  const gaps = classes.filter(c => !c.apps).map(c => c.label);
  const src = tr(totals.zh === totals.sources ? 'evmap.src.allzh' : 'evmap.src', { n: totals.sources, zh: totals.zh });
  const summary = tr('evmap.summary', { src, claims: totals.claims, inApps: totals.inApps, apps: apps.length, k: totals.classesWith, K: classes.length }) +
    (gaps.length ? ' ' + tr('evmap.gaps', { list: gaps.join(', ') }) : '');
  return `<div class="evmap">${svg}<ul class="em-list">${list}</ul><p class="em-summary">${esc(summary)}</p></div>`;
}

// Hover: light up an item and everything it connects to. Returns { destroy }.
export function mountEvidenceMap(stage, html) {
  stage.innerHTML = html;
  const svg = stage.querySelector('.em-svg');
  const items = svg ? [...svg.querySelectorAll('[data-k]')] : [];
  const keysOf = el => el.dataset.k.split(' ');
  const on = e => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    // An intervention or a link lights its own path; a class or problem lights every path through it.
    const focus = keysOf(el).find(k => k.startsWith('a:')) || keysOf(el)[0];
    const lit = items.filter(x => x.classList.contains('em-link') && keysOf(x).includes(focus));
    const hit = new Set([focus, ...lit.flatMap(keysOf)]);
    svg.classList.add('is-focus');
    for (const x of items) x.classList.toggle('is-on', x.classList.contains('em-link') ? lit.includes(x) : hit.has(keysOf(x)[0]));
  };
  const off = () => { svg.classList.remove('is-focus'); items.forEach(x => x.classList.remove('is-on')); };
  if (svg) { svg.addEventListener('pointerover', on); svg.addEventListener('focusin', on); svg.addEventListener('pointerleave', off); svg.addEventListener('focusout', off); }
  return { destroy() { stage.innerHTML = ''; } };
}
