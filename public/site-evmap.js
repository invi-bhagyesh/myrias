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
const OPEN_MAX = 12;
const W = 1000, TOP = 58, ROW = 54, XC = 262, XA = 388, XAE = 702, XP = 800, BAR = 115;

function rowsY(n, height) {
  const step = height / n;
  return Array.from({ length: n }, (_, i) => TOP + step * (i + 0.5));
}
const curve = (x0, y0, x1, y1) => { const m = (x0 + x1) / 2; return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1}`; };

// The map as markup: an SVG for wide screens and a list for phones. href(path, query) builds router links.
// Compact by default: one line per technology and welfare problem, sized by claims. `open` names the
// technology whose interventions unfold in the middle column (clicking a technology toggles it).
export function evidenceMapHtml(model, { tr, href, open = null }) {
  const { classes, problems, apps, totals } = model;
  // The open technology's practices: one row per practice name (a practice can touch several welfare
  // problems), biggest first, the top OPEN_MAX shown and the rest counted in a link to the full table.
  const rowsFor = cls => {
    const byLabel = new Map();
    for (const a of apps.filter(x => x.cls === cls)) {
      const r = byLabel.get(a.label) || { ...a, claims: 0, probs: new Map(), ids: [] };
      r.claims += a.claims; r.ids.push(a.id); r.probs.set(a.prob, (r.probs.get(a.prob) || 0) + a.claims);
      if (!r.outcome && a.outcome) r.outcome = a.outcome;
      byLabel.set(a.label, r);
    }
    return [...byLabel.values()].sort((x, y) => y.claims - x.claims);
  };
  const allOpen = open ? rowsFor(open) : [];
  const openApps = allOpen.slice(0, OPEN_MAX), moreApps = allOpen.length - openApps.length;
  const n = Math.max(classes.length, problems.length, openApps.length + (moreApps ? 1 : 0), 1);
  const height = n * ROW;
  const H = TOP + height + 14;
  const yc = rowsY(classes.length, height), yp = rowsY(problems.length, height), ya = rowsY(Math.max(openApps.length + (moreApps ? 1 : 0), 1), height);
  const cY = new Map(classes.map((c, i) => [c.id, yc[i]])), pY = new Map(problems.map((p, i) => [p.id, yp[i]]));
  const explore = (q = {}) => esc(href('explore', q));
  // Lines between a technology and a problem, summed over its interventions.
  const pairs = new Map();
  for (const a of apps) { const k = a.cls + '|' + a.prob; const e = pairs.get(k) || { cls: a.cls, prob: a.prob, claims: 0, color: a.color }; e.claims += a.claims; pairs.set(k, e); }
  const maxPair = Math.max(1, ...[...pairs.values()].map(e => e.claims)), maxApp = Math.max(1, ...openApps.map(a => a.claims));
  const w = (k, max) => (1.6 + 8 * Math.sqrt(k / max)).toFixed(1);

  let links = '';
  for (const e of pairs.values()) {
    if (e.cls === open) continue;
    links += `<path class="em-link${open ? ' is-faint' : ''}" data-k="c:${e.cls} p:${e.prob}" d="${curve(XC + 8, cY.get(e.cls), XP - 8, pY.get(e.prob))}" stroke="${e.color}" stroke-width="${w(e.claims, maxPair)}"><title>${esc(tr('evmap.claims', { n: e.claims }))}</title></path>`;
  }
  openApps.forEach((a, i) => {
    const keys = `c:${a.cls} a:${a.id} ${[...a.probs.keys()].map(p => 'p:' + p).join(' ')}`;
    links += `<path class="em-link" data-k="${keys}" d="${curve(XC + 8, cY.get(a.cls), XA - 10, ya[i])}" stroke="${a.color}" stroke-width="${w(a.claims, maxApp)}"/>`;
    for (const [prob, k] of a.probs) links += `<path class="em-link" data-k="${keys}" d="${curve(XAE + 6, ya[i], XP - 8, pY.get(prob))}" stroke="${a.color}" stroke-width="${w(k, maxApp)}"/>`;
  });

  const head = [[XC, 'end', 'evmap.col.class'], [XA, 'start', open ? 'evmap.col.app' : null], [XP, 'start', 'evmap.col.problem']].filter(x => x[2])
    .map(([x, anchor, key]) => `<text class="em-head" x="${anchor === 'end' ? x + 6 : x}" y="22" text-anchor="${anchor}">${esc(tr(key))}</text>`).join('')
    + (open ? '' : `<text class="em-hint" x="${(XC + XP) / 2}" y="22" text-anchor="middle">${esc(tr('evmap.hint.open'))}</text>`);

  const count = (key, k) => tr(k === 1 ? key + '.one' : key, { n: k });
  const sub = x => (x.apps ? `${count('evmap.apps', x.apps)} · ${count('evmap.claims', x.claims)}` : tr('evmap.none'));
  const oe = id => { const s = tr('evmap.oe.' + id); return s === 'evmap.oe.' + id ? '' : s; };
  const classNodes = classes.map((c, i) => {
    const isOpen = c.id === open, can = c.apps > 0;
    const attrs = can ? `role="button" tabindex="0" aria-expanded="${isOpen}" data-open="${esc(c.id)}"` : '';
    return `<g class="em-node em-class${can ? ' is-toggle' : ' is-empty'}${isOpen ? ' is-open' : ''}" data-k="c:${c.id}" ${attrs}>
    <rect class="em-hit" x="0" y="${yc[i] - 22}" width="${XC + 14}" height="44" rx="10"/>
    <circle cx="${XC}" cy="${yc[i]}" r="7" ${can ? `fill="${c.color}"` : `fill="none" stroke="${c.color}"`}/>
    <text x="${XC - 16}" y="${yc[i] - 3}" text-anchor="end" class="em-label">${can ? `<tspan class="em-chev">${isOpen ? '▾' : '▸'}</tspan> ` : ''}${esc(c.label)}</text>
    <text x="${XC - 16}" y="${yc[i] + 13}" text-anchor="end" class="em-sub">${esc(sub(c))}</text></g>`;
  }).join('');
  const probNodes = problems.map((p, i) => `<a href="${explore()}" class="em-node${p.apps ? '' : ' is-empty'}" data-k="p:${p.id}">
    <circle cx="${XP}" cy="${yp[i]}" r="6" ${p.apps ? 'class="em-pfill"' : 'class="em-pempty"'}/>
    <text x="${XP + 14}" y="${yp[i] - 3}" class="em-label">${esc(p.label)}</text>
    <text x="${XP + 14}" y="${yp[i] + 13}" class="em-sub">${esc(sub(p))}</text></a>`).join('');
  const appNodes = openApps.map((a, i) => {
    const bar = 6 + BAR * (a.claims / maxApp);
    const prob = [...a.probs.entries()].sort((x, y) => y[1] - x[1])[0][0];
    return `<a href="${explore({ species: a.species, cell: `${prob}|${a.cls}` })}" class="em-node" data-k="a:${a.id}">
      <title>${esc(a.label)}</title>
      <text x="${XA}" y="${ya[i] - 6}" class="em-label em-app">${esc(clip(a.label, 44))}</text>
      <rect x="${XA}" y="${ya[i] + 2}" width="${bar.toFixed(1)}" height="7" rx="3.5" fill="${a.color}"/>
      <text x="${XA + bar + 8}" y="${ya[i] + 9}" class="em-sub">${esc(count('evmap.claims', a.claims))}${oe(a.outcome) ? ' · ' + esc(oe(a.outcome)) : ''}</text></a>`;
  }).join('') + (moreApps ? `<a href="${explore({ species: openApps[0].species })}" class="em-node em-more"><text x="${XA}" y="${ya[openApps.length] + 4}" class="em-sub">${esc(tr('evmap.more', { n: moreApps }))} →</text></a>` : '');
  const empty = !apps.length ? `<text x="${(XC + XP) / 2}" y="${TOP + height / 2}" text-anchor="middle" class="em-sub">${esc(tr('evmap.noapps'))}</text>` : '';

  const svg = `<svg class="em-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr('evmap.aria'))}">${head}<g class="em-links">${links}</g>${classNodes}${appNodes}${probNodes}${empty}</svg>`;

  // Phone layout: each technology folds open to its interventions.
  const list = classes.filter(c => c.apps).map(c => `<li><details ${c.id === open ? 'open' : ''}><summary><span class="sw" style="background:${c.color}"></span>${esc(c.label)}<span class="em-list-n">${esc(sub(c))}</span></summary><ul>${(r => r.slice(0, OPEN_MAX).map(a => { const prob = [...a.probs.entries()].sort((x, y) => y[1] - x[1])[0][0];
    return `<li><a href="${explore({ species: a.species, cell: `${prob}|${a.cls}` })}">${esc(a.label)}</a><span>${esc(count('evmap.claims', a.claims))} → ${esc([...a.probs.keys()].map(p => problems.find(x => x.id === p).label).join(', '))}</span></li>`; }).join('')
    + (r.length > OPEN_MAX ? `<li><a href="${explore({ species: r[0].species })}">${esc(tr('evmap.more', { n: r.length - OPEN_MAX }))} →</a></li>` : ''))(rowsFor(c.id))}</ul></details></li>`).join('');
  const gaps = classes.filter(c => !c.apps).map(c => c.label);
  const src = tr(totals.zh === totals.sources ? 'evmap.src.allzh' : 'evmap.src', { n: totals.sources, zh: totals.zh });
  const summary = tr('evmap.summary', { src, claims: totals.claims, inApps: totals.inApps, apps: apps.length, k: totals.classesWith, K: classes.length }) +
    (gaps.length ? ' ' + tr('evmap.gaps', { list: gaps.join(', ') }) : '');
  return `<div class="evmap">${svg}<ul class="em-list">${list}</ul><p class="em-summary">${esc(summary)}</p></div>`;
}

// Hover: light up an item and everything it connects to. Returns { destroy }.
export function mountEvidenceMap(stage, render, { open: initial = null } = {}) {
  // Opens on the technology with the most claims, so the middle column is never empty on arrival.
  let open = initial;
  const draw = focusId => {
    stage.innerHTML = typeof render === 'function' ? render(open) : render;
    wire();
    if (focusId) stage.querySelector(`[data-open="${focusId}"]`)?.focus();
  };
  function wire() {
    const svg = stage.querySelector('.em-svg');
    if (!svg) return;
    const items = [...svg.querySelectorAll('[data-k]')];
    const keysOf = el => el.dataset.k.split(' ');
    const on = e => {
      const el = e.target.closest('[data-k]');
      if (!el) return;
      // An intervention or a link lights its own path; a technology or problem lights every path through it.
      const focus = keysOf(el).find(k => k.startsWith('a:')) || keysOf(el)[0];
      const lit = items.filter(x => x.classList.contains('em-link') && keysOf(x).includes(focus));
      const hit = new Set([focus, ...lit.flatMap(keysOf)]);
      svg.classList.add('is-focus');
      for (const x of items) x.classList.toggle('is-on', x.classList.contains('em-link') ? lit.includes(x) : hit.has(keysOf(x)[0]));
    };
    const off = () => { svg.classList.remove('is-focus'); items.forEach(x => x.classList.remove('is-on')); };
    svg.addEventListener('pointerover', on); svg.addEventListener('focusin', on); svg.addEventListener('pointerleave', off); svg.addEventListener('focusout', off);
    const toggle = el => { const id = el.dataset.open; open = open === id ? null : id; draw(id); };
    svg.addEventListener('click', e => { const el = e.target.closest('[data-open]'); if (el) toggle(el); });
    svg.addEventListener('keydown', e => { const el = e.target.closest('[data-open]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(el); } });
  }
  draw();
  return { destroy() { stage.innerHTML = ''; } };
}
