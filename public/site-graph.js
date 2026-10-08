// Home-page network: species, technology classes, welfare problems, applications, claims and
// sources. Position is a layout for navigation only; it carries no information about how strong
// the evidence is. The layout is deterministic.
//
// Until a release holds enough verified claims, the page draws a clearly labelled placeholder
// network (placeholderGraph) so the display can be judged; every placeholder node says "[Sample]".
import { buildMatrix, pick, escapeHtml } from './site-lib.js';

// Categorical colours, readable on both the light and the dark background.
export const PALETTE = ['#0e8aa6', '#e08a2c', '#6f5bd6', '#e0527a', '#2f9e6b', '#3b82f6', '#c9a21a', '#e4572e'];
export const MIN_REAL_CLAIMS = 50;
const SOURCE_COLOR = '#8d9aa3';
const MAX_TIP = 110;
const DENSE_AT = 60;

export const shortLabel = s => String(s || '').replace(/\s*[(（].*$/, '');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Small deterministic generator, so the picture is the same on every visit.
export function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function newGraph() {
  const nodes = [], edges = [], byId = new Map();
  const add = node => { node.degree = 0; node.cluster = node.cluster || node.group; byId.set(node.id, node); nodes.push(node); return node; };
  const link = (a, b, kind, status) => {
    const A = byId.get(a), B = byId.get(b);
    if (!A || !B) return;
    A.degree++; B.degree++;
    edges.push({ a, b, kind, status });
  };
  return { nodes, edges, byId, add, link, legend: [] };
}

function addTaxonomy(g, tax, lang, href) {
  tax.technology_classes.forEach((c, i) => g.add({
    id: 'c:' + c.id, type: 'class', group: 'class:' + c.id, color: PALETTE[i % PALETTE.length],
    label: shortLabel(pick(c, '', lang)), tip: pick(c, '', lang), href: href('explore'), r: 8, index: i
  }));
  tax.welfare_problems.forEach((p, i) => g.add({
    id: 'p:' + p.id, type: 'problem', group: 'problem', color: 'soft',
    label: shortLabel(pick(p, '', lang)), tip: pick(p, '', lang), href: href('explore'), r: 6, index: i
  }));
}

function legendFor(tax, lang, withSources) {
  const legend = tax.technology_classes.map((c, i) => ({ key: 'class:' + c.id, label: shortLabel(pick(c, '', lang)), color: PALETTE[i % PALETTE.length] }));
  legend.push({ key: 'problem', labelKey: 'graph.legend.problems', color: 'soft' }, { key: 'species', labelKey: 'graph.legend.species', color: 'ink' });
  if (withSources) legend.push({ key: 'source', labelKey: 'graph.legend.sources', color: SOURCE_COLOR });
  return legend;
}

// href(path, query) must return a router link such as '#/explore?species=x'.
export function buildGraph(data, lang = 'en', href = path => `#/${path}`) {
  const tax = data.taxonomy;
  const g = newGraph();
  addTaxonomy(g, tax, lang, href);
  data.species.forEach((s, i) => g.add({
    id: 's:' + s.id, type: 'species', group: 'species', color: 'ink',
    label: pick(s, 'common', lang), tip: `${pick(s, 'common', lang)} (${s.scientific})`, href: href('species/' + encodeURIComponent(s.id)), r: 7, index: i
  }));

  // The frame: every technology x problem combination, with its search status.
  for (const row of buildMatrix(data, 'all').rows) {
    for (const cell of row.cells) g.link('c:' + cell.class_id, 'p:' + cell.problem_id, 'cell', cell.status);
  }

  const appOfClaim = new Map();
  for (const a of data.applications) {
    const cls = g.byId.get('c:' + a.technology_class);
    g.add({
      id: 'a:' + a.id, type: 'application', group: 'class:' + a.technology_class, color: cls ? cls.color : SOURCE_COLOR,
      label: '', tip: a.intervention_id || a.id, r: 4,
      href: href('explore', { species: a.species_id, cell: `${a.welfare_problem}|${a.technology_class}` })
    });
    g.link('a:' + a.id, 'c:' + a.technology_class, 'link');
    g.link('a:' + a.id, 'p:' + a.welfare_problem, 'far');
    g.link('a:' + a.id, 's:' + a.species_id, 'far');
    for (const cid of a.claim_ids) if (!appOfClaim.has(cid)) appOfClaim.set(cid, a);
  }
  for (const s of data.sources) g.add({
    id: 'x:' + s.id, type: 'source', group: 'source', cluster: '', color: SOURCE_COLOR, label: '',
    tip: clip(pick(s, 'title', lang) || s.title, MAX_TIP), r: 2, href: href('sources/' + encodeURIComponent(s.id))
  });
  for (const c of data.claims) {
    const app = appOfClaim.get(c.id);
    const cls = app ? g.byId.get('c:' + app.technology_class) : null;
    g.add({
      id: 'k:' + c.id, type: 'claim', group: app ? 'class:' + app.technology_class : 'source', color: cls ? cls.color : SOURCE_COLOR,
      label: '', tip: clip(pick(c, 'text', lang), MAX_TIP), r: 2, href: href('claims/' + encodeURIComponent(c.id))
    });
    if (app) g.link('k:' + c.id, 'a:' + app.id, 'claim');
    g.link('k:' + c.id, 'x:' + c.source_id, 'src');
  }
  g.legend = legendFor(tax, lang, data.sources.length > 0);
  g.placeholder = false;
  return g;
}

// Invented network for the pre-release front page. It shares the real taxonomy (the technology
// classes and welfare problems are the ones we will search) and nothing else: no real species,
// no real claims. Every other node is labelled "[Sample]" and links nowhere.
const SAMPLE_CLAIMS = [440, 360, 310, 270, 230, 195, 160, 130];
export function placeholderGraph(data, lang = 'en', href = path => `#/${path}`) {
  const tax = data.taxonomy;
  const g = newGraph();
  const rng = lcg(7719);
  const sample = lang === 'zh' ? '[示例]' : '[Sample]';
  const nClass = tax.technology_classes.length, nProb = tax.welfare_problems.length;
  addTaxonomy(g, tax, lang, href);
  const speciesIds = [];
  for (let i = 0; i < 6; i++) {
    const id = 's:sample-' + i;
    speciesIds.push(id);
    g.add({ id, type: 'species', group: 'species', color: 'ink', label: '', tip: `${sample} ${lang === 'zh' ? '物种' : 'Species'} ${i + 1}`, href: null, r: 6, index: i });
  }
  // Frame, as on the real page.
  for (let i = 0; i < nClass; i++) for (let j = 0; j < nProb; j++) g.link('c:' + tax.technology_classes[i].id, 'p:' + tax.welfare_problems[j].id, 'cell', 'not_collected');

  const appsByClass = [], claimsByClass = [];
  let sourceCount = 0;
  const claimWord = lang === 'zh' ? '论断' : 'claim', appWord = lang === 'zh' ? '应用' : 'Application', srcWord = lang === 'zh' ? '来源' : 'source';
  tax.technology_classes.forEach((c, ci) => {
    const color = PALETTE[ci % PALETTE.length], group = 'class:' + c.id, cname = shortLabel(pick(c, '', lang));
    const nApps = 9 + Math.floor(rng() * 7);
    const apps = [], weights = [];
    for (let k = 0; k < nApps; k++) {
      const id = `a:s${ci}-${k}`;
      g.add({ id, type: 'application', group, color, label: '', tip: `${sample} ${appWord} · ${cname}`, href: null, r: 3.6 });
      g.link(id, 'c:' + c.id, 'link');
      g.link(id, 'p:' + tax.welfare_problems[Math.floor(rng() * nProb)].id, 'far');
      if (rng() < 0.5) g.link(id, speciesIds[Math.floor(rng() * speciesIds.length)], 'far');
      apps.push(id); weights.push(1 / (k + 1.5));
    }
    const wsum = weights.reduce((a, b) => a + b, 0);
    const pickApp = () => { let x = rng() * wsum; for (let k = 0; k < apps.length; k++) { x -= weights[k]; if (x <= 0) return apps[k]; } return apps[apps.length - 1]; };
    const nClaims = SAMPLE_CLAIMS[ci % SAMPLE_CLAIMS.length];
    const sources = [], claims = [];
    for (let k = 0; k < nClaims; k++) {
      const id = `k:s${ci}-${k}`;
      g.add({ id, type: 'claim', group, color, label: '', tip: `${sample} ${claimWord} · ${cname}`, href: null, r: 1.8 });
      g.link(id, pickApp(), 'claim');
      let src;
      if (sources.length && rng() < 0.72) src = sources[Math.floor(rng() * sources.length)];
      else {
        src = `x:s${ci}-${sources.length}`;
        g.add({ id: src, type: 'source', group, color: SOURCE_COLOR, label: '', tip: `${sample} ${srcWord} · ${cname}`, href: null, r: 1.6 });
        sources.push(src); sourceCount++;
      }
      g.link(id, src, 'src');
      claims.push(id);
    }
    appsByClass.push(apps); claimsByClass.push(claims);
  });
  // A few links between clusters: claims that touch two technologies, and application pairs.
  for (let ci = 0; ci < nClass; ci++) {
    const mine = claimsByClass[ci];
    for (let k = 0; k < Math.round(mine.length * 0.05); k++) {
      let cj = Math.floor(rng() * nClass); if (cj === ci) cj = (cj + 1) % nClass;
      const other = claimsByClass[cj];
      g.link(mine[Math.floor(rng() * mine.length)], other[Math.floor(rng() * other.length)], 'cross');
    }
  }
  for (let k = 0; k < 40; k++) {
    const ci = Math.floor(rng() * nClass); let cj = Math.floor(rng() * nClass); if (cj === ci) cj = (cj + 1) % nClass;
    g.link(appsByClass[ci][Math.floor(rng() * appsByClass[ci].length)], appsByClass[cj][Math.floor(rng() * appsByClass[cj].length)], 'cross');
  }
  g.legend = legendFor(tax, lang, sourceCount > 0);
  g.placeholder = true;
  return g;
}

// The hubs and applications of a network without its claims and sources: a quieter, readable version.
export function simplifyGraph(g) {
  const keep = n => ['class', 'problem', 'species', 'application'].includes(n.type);
  const nodes = g.nodes.filter(keep).map(n => ({ ...n, cluster: n.group, degree: 0 }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = g.edges.filter(e => e.kind !== 'cross' && !(e.kind === 'far' && (e.a.startsWith('s:') || e.b.startsWith('s:'))) && byId.has(e.a) && byId.has(e.b)).map(e => ({ ...e }));
  for (const e of edges) { byId.get(e.a).degree++; byId.get(e.b).degree++; }
  for (const n of nodes) if (n.type === 'application') n.r = 5;
  return { ...g, nodes, edges, byId, legend: g.legend.filter(l => l.key !== 'source') };
}

// ---- Layout ----

const STIFF = { cell: 0.002, link: 0.1, far: 0.004, claim: 0.28, src: 0.1, cross: 0 };
const REST = { cell: 0.5, link: 0.05, far: 0.22, claim: 0.011, src: 0.018, cross: 0 };

// Where each cluster sits. Returns [x, y] in the unit square.
function clusterCenter(node, graph, dense) {
  const classes = graph.nodes.filter(n => n.type === 'class');
  const problems = graph.nodes.filter(n => n.type === 'problem').length || 1;
  const species = graph.nodes.filter(n => n.type === 'species').length || 1;
  const key = node.cluster || node.group;
  if (dense) {
    const ring = (i, n, rx, ry, phase = -Math.PI / 2) => { const a = phase + (2 * Math.PI * i) / n; return [0.5 + rx * Math.cos(a), 0.5 + ry * Math.sin(a)]; };
    if (node.type === 'class') return ring(node.index, classes.length || 1, 0.31, 0.29);
    if (node.type === 'problem') return ring(node.index, problems, 0.095, 0.085, -Math.PI / 2 + 0.2);
    if (node.type === 'species') return ring(node.index, species, 0.18, 0.165, -Math.PI / 2 + Math.PI / species);
    if (key.startsWith('class:')) { const c = graph.byId.get('c:' + key.slice(6)); if (c) return ring(c.index, classes.length || 1, 0.31, 0.29); }
    return [0.5, 0.5];
  }
  const spread = (i, n) => 0.1 + (0.8 * (n === 1 ? 0.5 : i / (n - 1)));
  if (node.type === 'class') return [0.2, spread(node.index, classes.length || 1)];
  if (node.type === 'problem') return [0.8, spread(node.index, problems)];
  if (node.type === 'species') return [0.5 + (node.index - (species - 1) / 2) * Math.min(0.2, 0.5 / species), 0.08];
  if (key.startsWith('class:')) {
    const c = graph.byId.get('c:' + key.slice(6));
    return c ? [0.2, spread(c.index, classes.length || 1)] : [0.5, 0.5];
  }
  return [0.5, 0.88];
}

// Force layout in the unit square: grid-based repulsion (so it scales to thousands of nodes),
// edge springs and a pull towards each node's cluster. Same input gives the same output.
export function layoutGraph(graph, { iterations } = {}) {
  const { nodes, edges, byId } = graph;
  const n = nodes.length;
  const dense = n > DENSE_AT;
  graph.mode = dense ? 'radial' : 'columns';
  const rng = lcg(20261008);
  const idx = new Map(nodes.map((node, i) => [node.id, i]));

  // Nodes without a cluster (sources) join the cluster of their first neighbour that has one.
  for (let pass = 0; pass < 2; pass++) for (const e of edges) {
    const A = byId.get(e.a), B = byId.get(e.b);
    if (!A.cluster && B.cluster && B.type !== 'species' && B.type !== 'problem') A.cluster = B.cluster;
    if (!B.cluster && A.cluster && A.type !== 'species' && A.type !== 'problem') B.cluster = A.cluster;
  }
  const spreadR = dense ? 0.08 : 0.06;
  nodes.forEach(node => {
    const [cx, cy] = clusterCenter(node, graph, dense);
    node.cx = cx; node.cy = cy;
    node.fixed = node.type === 'class' || node.type === 'problem' || node.type === 'species';
    const a = rng() * Math.PI * 2, rad = node.fixed ? 0 : Math.sqrt(rng()) * spreadR;
    node.x = cx + Math.cos(a) * rad; node.y = cy + Math.sin(a) * rad;
    node.phase = rng() * Math.PI * 2;
  });

  const its = iterations || (n > 1200 ? 110 : n > 500 ? 160 : 260);
  const R = dense ? 0.026 : 0.12;
  const G = Math.ceil(1 / R) + 3;
  const head = new Int32Array(G * G), next = new Int32Array(n);
  const fx = new Float64Array(n), fy = new Float64Array(n);
  const charge = node => (node.type === 'class' ? 5 : node.type === 'problem' || node.type === 'species' ? 3 : node.type === 'application' ? 1.6 : 1);
  const rep = dense ? 0.16 : 0.05;
  const grav = dense ? 0.16 : 0.05;
  const cap = 0.012;
  for (let it = 0; it < its; it++) {
    const temp = 1 - it / its;
    fx.fill(0); fy.fill(0); head.fill(-1);
    for (let i = 0; i < n; i++) {
      const gx = Math.max(0, Math.min(G - 1, Math.floor(nodes[i].x / R) + 1)), gy = Math.max(0, Math.min(G - 1, Math.floor(nodes[i].y / R) + 1));
      const cell = gy * G + gx;
      next[i] = head[cell]; head[cell] = i;
    }
    for (let i = 0; i < n; i++) {
      const A = nodes[i];
      const gx = Math.max(0, Math.min(G - 1, Math.floor(A.x / R) + 1)), gy = Math.max(0, Math.min(G - 1, Math.floor(A.y / R) + 1));
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const x = gx + ox, y = gy + oy;
        if (x < 0 || y < 0 || x >= G || y >= G) continue;
        for (let j = head[y * G + x]; j !== -1; j = next[j]) {
          if (j <= i) continue;
          const B = nodes[j];
          let dx = A.x - B.x, dy = A.y - B.y;
          let d = Math.hypot(dx, dy);
          if (d >= R) continue;
          if (d < 1e-6) { dx = (rng() - 0.5) * 1e-3; dy = (rng() - 0.5) * 1e-3; d = Math.hypot(dx, dy); }
          const f = rep * Math.sqrt(charge(A) * charge(B)) * (R - d) / R / d;
          fx[i] += dx * f; fy[i] += dy * f; fx[j] -= dx * f; fy[j] -= dy * f;
        }
      }
    }
    for (const e of edges) {
      const k0 = STIFF[e.kind]; if (!k0) continue;
      const i = idx.get(e.a), j = idx.get(e.b);
      const A = nodes[i], B = nodes[j];
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1e-6;
      const k = k0 * (d - REST[e.kind]) / d;
      fx[i] += dx * k; fy[i] += dy * k; fx[j] -= dx * k; fy[j] -= dy * k;
    }
    for (let i = 0; i < n; i++) {
      const A = nodes[i];
      if (A.fixed) { A.x = A.cx; A.y = A.cy; continue; }
      fx[i] += (A.cx - A.x) * grav; fy[i] += (A.cy - A.y) * grav;
      const m = 0.5 * (0.3 + temp);
      A.x += Math.max(-cap, Math.min(cap, fx[i] * m));
      A.y += Math.max(-cap, Math.min(cap, fy[i] * m));
    }
  }

  // Fit the picture to the unit square so nothing is clipped.
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const node of nodes) { x0 = Math.min(x0, node.x); x1 = Math.max(x1, node.x); y0 = Math.min(y0, node.y); y1 = Math.max(y1, node.y); }
  if (dense) {
    const sx = 0.94 / (x1 - x0 || 1), sy = 0.9 / (y1 - y0 || 1);
    for (const node of nodes) { node.x = 0.03 + (node.x - x0) * sx; node.y = 0.05 + (node.y - y0) * sy; }
  } else {
    for (const node of nodes) { node.x = Math.max(0.03, Math.min(0.97, node.x)); node.y = Math.max(0.05, Math.min(0.95, node.y)); }
  }
  return graph;
}

export function legendHtml(graph, tr) {
  const colour = c => (c === 'ink' ? 'var(--ink)' : c === 'soft' ? 'var(--soft)' : c);
  return `<ul class="graph-legend">${graph.legend.map(item => `<li><span class="sw" style="background:${colour(item.color)}"></span>${escapeHtml(item.labelKey ? tr(item.labelKey) : item.label)}</li>`).join('')}</ul>`;
}

// ---- Drawing ----

const ease = p => 1 - Math.pow(1 - p, 3);

// Draws the graph on a canvas. Returns { destroy }.
export function mountGraph(stage, graph, { tr, navigate }) {
  layoutGraph(graph);
  const dense = graph.mode === 'radial';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const tip = document.createElement('div');
  tip.className = 'graph-tip';
  tip.hidden = true;
  stage.append(canvas, tip);
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const INTRO = 1300;
  let w = 0, h = 0, dpr = 1, hover = null, raf = 0, visible = true, last = 0, destroyed = false;
  let born = 0, progress = dense && !reduced ? 0 : 1;
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Neighbour lists for hover highlighting.
  const adj = new Map(graph.nodes.map(node => [node.id, new Set([node.id])]));
  for (const e of graph.edges) { adj.get(e.a).add(e.b); adj.get(e.b).add(e.a); }
  const tintOf = e => {
    const A = graph.byId.get(e.a), B = graph.byId.get(e.b);
    return [A, B].map(n => n.color).find(c => c && c[0] === '#' && c !== SOURCE_COLOR) || '';
  };

  const resolve = (c, ink, soft) => (c === 'ink' ? ink : c === 'soft' ? soft : c);
  function place(t) {
    const padX = dense ? (w < 620 ? 16 : 36) : (w < 620 ? 14 : 150), padY = dense ? 22 : 26;
    const e = ease(progress);
    for (const node of graph.nodes) {
      let x = node.x, y = node.y;
      if (!dense && !reduced) { x += Math.sin(t * 0.0006 + node.phase) * 0.004; y += Math.cos(t * 0.0005 + node.phase) * 0.004; }
      if (progress < 1) { x = 0.5 + (x - 0.5) * e; y = 0.5 + (y - 0.5) * e; }
      node.px = padX + x * (w - 2 * padX);
      node.py = padY + y * (h - 2 * padY);
    }
  }
  function draw(t = 0) {
    if (!w) return;
    const ink = css('--ink') || '#0f1d24', soft = css('--soft') || '#4f616b', bg = css('--card-bg') || css('--bg') || '#ffffff';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    place(t);
    const near = hover ? adj.get(hover.id) : null;
    const fade = progress < 1 ? 0.25 + 0.75 * ease(progress) : 1;

    // Edges, batched by colour and weight so thousands of hairlines stay cheap.
    const batches = new Map();
    for (const e of graph.edges) {
      const hot = near && (e.a === hover.id || e.b === hover.id);
      if (near && !hot && dense) { const key = 'dim'; (batches.get(key) || batches.set(key, { color: ink, alpha: 0.025, width: 0.6, dash: [], list: [] }).get(key)).list.push(e); continue; }
      let color = tintOf(e) || ink, alpha, width, dash = [];
      if (e.kind === 'cell') {
        if (e.status === 'has_records') { alpha = 0.9; width = 2.2; }
        else if (e.status === 'probed_empty') { alpha = 0.5; width = 1.2; dash = [2, 3]; }
        else { alpha = dense ? 0.22 : 0.4; width = dense ? 0.9 : 1.4; dash = dense ? [3, 4] : [4, 4]; }
        if (dense) color = soft;
      } else if (e.kind === 'cross') { alpha = 0.1; width = 0.5; color = soft; }
      else if (e.kind === 'far') { alpha = dense ? 0.14 : 0.5; width = dense ? 0.6 : 1; }
      else if (e.kind === 'link') { alpha = dense ? 0.4 : 0.5; width = dense ? 0.9 : 1; }
      else { alpha = dense ? 0.2 : 0.3; width = dense ? 0.5 : 1; }
      if (hot) { alpha = Math.min(1, alpha * 2.6 + 0.3); width = Math.max(width, 1.2); }
      else if (near) alpha *= 0.2;
      const key = `${color}|${alpha.toFixed(2)}|${width}|${dash.join()}`;
      (batches.get(key) || batches.set(key, { color, alpha, width, dash, list: [] }).get(key)).list.push(e);
    }
    for (const b of batches.values()) {
      ctx.globalAlpha = Math.min(1, b.alpha * fade); ctx.strokeStyle = b.color; ctx.lineWidth = b.width; ctx.setLineDash(b.dash);
      ctx.beginPath();
      for (const e of b.list) { const A = graph.byId.get(e.a), B = graph.byId.get(e.b); ctx.moveTo(A.px, A.py); ctx.lineTo(B.px, B.py); }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Nodes: small ones first, hubs on top.
    const order = dense ? [...graph.nodes].sort((a, b) => a.r - b.r) : graph.nodes;
    const scale = dense ? Math.max(0.8, Math.min(1.35, w / 900)) : 1;
    for (const node of order) {
      const dim = near && !near.has(node.id);
      const hub = node.type === 'class' || node.type === 'problem' || node.type === 'species';
      const r = (dense ? node.r * scale : node.r * (1 + Math.min(0.5, Math.sqrt(node.degree) * 0.04))) * (node === hover ? 1.4 : 1);
      ctx.globalAlpha = (dim ? 0.1 : (dense && !hub ? 0.85 : 1)) * fade;
      ctx.beginPath(); ctx.arc(node.px, node.py, r, 0, Math.PI * 2);
      ctx.fillStyle = resolve(node.color, ink, soft); ctx.fill();
      if (hub || !dense) { ctx.lineWidth = 1.5; ctx.strokeStyle = bg; ctx.stroke(); }
      if (node.type === 'class' || (node.type === 'problem' && dense)) {
        ctx.globalAlpha = (dim ? 0.06 : 0.35) * fade; ctx.beginPath(); ctx.arc(node.px, node.py, r + 4, 0, Math.PI * 2);
        ctx.lineWidth = 1; ctx.strokeStyle = resolve(node.color, ink, soft); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Hub labels, with a halo so they stay readable over the dots.
    if (progress >= 1 && (w >= 620 || hover)) {
      const fam = getComputedStyle(document.body).fontFamily;
      ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      for (const node of graph.nodes) {
        if (!node.label || (near && !near.has(node.id))) continue;
        if (w < 620 && node !== hover) continue;
        const cls = node.type === 'class';
        ctx.font = `${cls ? 600 : 500} ${dense ? (cls ? 13 : 11) : 12}px ${fam}`;
        let x = node.px, y = node.py;
        if (dense) { ctx.textAlign = 'center'; y = node.py - node.r * scale - (cls ? 13 : 9); }
        else if (cls) { ctx.textAlign = 'right'; x = node.px - node.r - 12; }
        else if (node.type === 'problem') { ctx.textAlign = 'left'; x = node.px + node.r + 12; }
        else { ctx.textAlign = 'center'; y = node.py - node.r - 10; }
        ctx.lineWidth = 4; ctx.strokeStyle = bg; ctx.globalAlpha = 0.9; ctx.strokeText(node.label, x, y);
        ctx.globalAlpha = 1; ctx.fillStyle = ink; ctx.fillText(node.label, x, y);
      }
    }
  }
  function resize() {
    const rect = stage.getBoundingClientRect();
    w = Math.max(280, Math.round(rect.width));
    h = Math.round(dense ? Math.max(340, Math.min(640, w * 0.6)) : Math.max(300, Math.min(500, w * 0.5)));
    stage.style.height = h + 'px';
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    draw(performance.now());
  }
  // Dense graphs animate only while they settle in; the small frame graph drifts gently.
  function frame(t) {
    raf = 0;
    if (destroyed || !visible || document.hidden) return;
    if (progress < 1) {
      if (!born) born = t;
      progress = Math.min(1, (t - born) / INTRO);
      draw(t);
    } else if (!dense && !reduced && t - last > 33) { last = t; draw(t); }
    if (progress < 1 || (!dense && !reduced)) raf = requestAnimationFrame(frame);
  }
  const start = () => { if (!raf && visible && (progress < 1 || (!dense && !reduced))) raf = requestAnimationFrame(frame); };

  function pointer(e) {
    if (progress < 1) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = null, bestD = 1e9;
    for (const node of graph.nodes) {
      const d = Math.hypot(node.px - x, node.py - y);
      const reach = (dense && node.r < 4 ? 6 : node.r + 8);
      if (d < bestD && d <= reach) { best = node; bestD = d; }
    }
    if (best !== hover) { hover = best; draw(performance.now()); }
    canvas.style.cursor = hover && hover.href ? 'pointer' : 'default';
    if (hover) {
      tip.hidden = false;
      tip.textContent = `${tr('graph.type.' + hover.type)}: ${hover.tip || hover.label}`;
      tip.style.left = Math.min(w - 220, Math.max(6, x + 14)) + 'px';
      tip.style.top = Math.max(6, y - 34) + 'px';
    } else tip.hidden = true;
  }
  const leave = () => { hover = null; tip.hidden = true; draw(performance.now()); };
  const click = () => { if (hover && hover.href) navigate(hover.href); };
  canvas.addEventListener('pointermove', pointer);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('click', click);

  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);
  const io = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) start(); }, { threshold: 0.05 });
  io.observe(stage);
  const mo = new MutationObserver(() => draw(performance.now()));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const onVisibility = () => { if (!document.hidden) start(); };
  document.addEventListener('visibilitychange', onVisibility);
  resize(); start();

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect(); mo.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.remove(); tip.remove();
    }
  };
}
