// Home-page network: species, technology classes, welfare problems, applications, claims and
// sources, drawn from the release export. Position is a layout for navigation only; it carries
// no information about how strong the evidence is. The layout is deterministic.
import { buildMatrix, pick, escapeHtml } from './site-lib.js';

// Categorical colours, readable on both the light and the dark background.
export const PALETTE = ['#2f7d5b', '#c7782b', '#3f6fb0', '#b0475f', '#7b57b0', '#1f8f94', '#8c9330', '#d1583a'];
const SOURCE_COLOR = '#8d8f98';
const MAX_TIP = 110;

export const shortLabel = s => String(s || '').replace(/\s*[(（].*$/, '');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// href(path, query) must return a router link such as '#/explore?species=x'.
export function buildGraph(data, lang = 'en', href = path => `#/${path}`) {
  const tax = data.taxonomy;
  const nodes = [], edges = [], byId = new Map();
  const add = node => { node.degree = 0; byId.set(node.id, node); nodes.push(node); return node; };
  const link = (a, b, kind, status) => {
    const A = byId.get(a), B = byId.get(b);
    if (!A || !B) return;
    A.degree++; B.degree++;
    edges.push({ a, b, kind, status });
  };

  tax.technology_classes.forEach((c, i) => add({
    id: 'c:' + c.id, type: 'class', group: 'class:' + c.id, color: PALETTE[i % PALETTE.length],
    label: shortLabel(pick(c, '', lang)), tip: pick(c, '', lang), href: href('explore'), r: 8, index: i
  }));
  tax.welfare_problems.forEach((p, i) => add({
    id: 'p:' + p.id, type: 'problem', group: 'problem', color: 'soft',
    label: shortLabel(pick(p, '', lang)), tip: pick(p, '', lang), href: href('explore'), r: 7, index: i
  }));
  data.species.forEach((s, i) => add({
    id: 's:' + s.id, type: 'species', group: 'species', color: 'ink',
    label: pick(s, 'common', lang), tip: `${pick(s, 'common', lang)} (${s.scientific})`, href: href('species/' + encodeURIComponent(s.id)), r: 9, index: i
  }));

  // The frame: every technology x problem combination, with its search status.
  for (const row of buildMatrix(data, 'all').rows) {
    for (const cell of row.cells) link('c:' + cell.class_id, 'p:' + cell.problem_id, 'cell', cell.status);
  }

  const appOfClaim = new Map();
  for (const a of data.applications) {
    const cls = byId.get('c:' + a.technology_class);
    add({
      id: 'a:' + a.id, type: 'application', group: 'class:' + a.technology_class, color: cls ? cls.color : SOURCE_COLOR,
      label: '', tip: a.intervention_id || a.id, r: 5,
      href: href('explore', { species: a.species_id, cell: `${a.welfare_problem}|${a.technology_class}` })
    });
    link('a:' + a.id, 'c:' + a.technology_class, 'link');
    link('a:' + a.id, 'p:' + a.welfare_problem, 'link');
    link('a:' + a.id, 's:' + a.species_id, 'link');
    for (const cid of a.claim_ids) if (!appOfClaim.has(cid)) appOfClaim.set(cid, a);
  }
  for (const s of data.sources) add({
    id: 'x:' + s.id, type: 'source', group: 'source', color: SOURCE_COLOR, label: '',
    tip: clip(pick(s, 'title', lang) || s.title, MAX_TIP), r: 3.5, href: href('sources/' + encodeURIComponent(s.id))
  });
  for (const c of data.claims) {
    const app = appOfClaim.get(c.id);
    const cls = app ? byId.get('c:' + app.technology_class) : null;
    add({
      id: 'k:' + c.id, type: 'claim', group: app ? 'class:' + app.technology_class : 'source', color: cls ? cls.color : SOURCE_COLOR,
      label: '', tip: clip(pick(c, 'text', lang), MAX_TIP), r: 3, href: href('claims/' + encodeURIComponent(c.id))
    });
    if (app) link('k:' + c.id, 'a:' + app.id, 'claim');
    link('k:' + c.id, 'x:' + c.source_id, 'claim');
  }

  const legend = tax.technology_classes.map((c, i) => ({ key: 'class:' + c.id, label: shortLabel(pick(c, '', lang)), color: PALETTE[i % PALETTE.length] }));
  legend.push({ key: 'problem', labelKey: 'graph.legend.problems', color: 'soft' }, { key: 'species', labelKey: 'graph.legend.species', color: 'ink' });
  if (data.sources.length) legend.push({ key: 'source', labelKey: 'graph.legend.sources', color: SOURCE_COLOR });
  return { nodes, edges, legend, byId };
}

// Small deterministic generator, so the layout is the same on every visit.
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function groupCenter(node, graph) {
  const classes = graph.nodes.filter(n => n.type === 'class').length || 1;
  const problems = graph.nodes.filter(n => n.type === 'problem').length || 1;
  const spread = (i, n) => 0.1 + (0.8 * (n === 1 ? 0.5 : i / (n - 1)));
  if (node.type === 'class') return [0.2, spread(node.index, classes)];
  if (node.type === 'problem') return [0.8, spread(node.index, problems)];
  if (node.type === 'species') {
    const species = graph.nodes.filter(n => n.type === 'species').length || 1;
    return [0.5 + (node.index - (species - 1) / 2) * Math.min(0.2, 0.5 / species), 0.08];
  }
  if (node.group.startsWith('class:')) {
    const c = graph.byId.get('c:' + node.group.slice(6));
    return c ? [0.2, spread(c.index, classes)] : [0.5, 0.5];
  }
  return [0.5, 0.88];
}

// Force layout in the unit square: repulsion, edge springs and a pull towards each group.
export function layoutGraph(graph, { iterations } = {}) {
  const { nodes, edges, byId } = graph;
  const n = nodes.length;
  const rng = lcg(20261008);
  const its = iterations || (n > 1200 ? 90 : n > 500 ? 160 : 260);
  nodes.forEach((node, i) => {
    const [cx, cy] = groupCenter(node, graph);
    node.cx = cx; node.cy = cy;
    node.x = cx + (rng() - 0.5) * 0.12;
    node.y = cy + (rng() - 0.5) * 0.12;
    node.phase = rng() * Math.PI * 2;
    node.fixed = node.type === 'class' || node.type === 'problem' || node.type === 'species';
  });
  const fx = new Float64Array(n), fy = new Float64Array(n);
  const idx = new Map(nodes.map((node, i) => [node.id, i]));
  const rest = { cell: 0.6, link: 0.12, claim: 0.07 };
  const stiff = { cell: 0.004, link: 0.08, claim: 0.12 };
  for (let it = 0; it < its; it++) {
    const temp = 1 - it / its;
    fx.fill(0); fy.fill(0);
    for (let i = 0; i < n; i++) {
      const A = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const B = nodes[j];
        let dx = A.x - B.x, dy = A.y - B.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) { dx = (rng() - 0.5) * 1e-3; dy = (rng() - 0.5) * 1e-3; d2 = dx * dx + dy * dy; }
        const strength = (A.fixed && B.fixed ? 0.0004 : 0.00025) / d2;
        const f = Math.min(strength, 0.6);
        fx[i] += dx * f; fy[i] += dy * f; fx[j] -= dx * f; fy[j] -= dy * f;
      }
    }
    for (const e of edges) {
      const i = idx.get(e.a), j = idx.get(e.b);
      const A = nodes[i], B = nodes[j];
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1e-6;
      const k = (stiff[e.kind] || 0.05) * (d - (rest[e.kind] || 0.1)) / d;
      fx[i] += dx * k; fy[i] += dy * k; fx[j] -= dx * k; fy[j] -= dy * k;
    }
    for (let i = 0; i < n; i++) {
      const A = nodes[i];
      const g = A.fixed ? 0.9 : 0.05;
      fx[i] += (A.cx - A.x) * g; fy[i] += (A.cy - A.y) * g;
      const step = A.fixed ? 0.5 : 1;
      const mx = Math.max(-0.02, Math.min(0.02, fx[i] * 0.05 * (0.25 + temp) * step));
      const my = Math.max(-0.02, Math.min(0.02, fy[i] * 0.05 * (0.25 + temp) * step));
      A.x = Math.max(0.03, Math.min(0.97, A.x + mx));
      A.y = Math.max(0.05, Math.min(0.95, A.y + my));
    }
  }
  return graph;
}

export function legendHtml(graph, tr) {
  const colour = c => (c === 'ink' ? 'var(--ink)' : c === 'soft' ? 'var(--soft)' : c);
  return `<ul class="graph-legend">${graph.legend.map(item => `<li><span class="sw" style="background:${colour(item.color)}"></span>${escapeHtml(item.labelKey ? tr(item.labelKey) : item.label)}</li>`).join('')}</ul>`;
}

// Draws the graph on a canvas. Returns { destroy }.
export function mountGraph(stage, graph, { tr, navigate }) {
  layoutGraph(graph);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const tip = document.createElement('div');
  tip.className = 'graph-tip';
  tip.hidden = true;
  stage.append(canvas, tip);
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, dpr = 1, hover = null, raf = 0, visible = true, last = 0, destroyed = false;
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const resolve = (c, ink, soft) => (c === 'ink' ? ink : c === 'soft' ? soft : c);
  function place(t) {
    const padX = w < 620 ? 14 : 150, padY = 26;
    for (const node of graph.nodes) {
      const drift = reduced ? 0 : Math.sin(t * 0.0006 + node.phase) * 0.004;
      node.px = padX + (node.x + drift) * (w - 2 * padX);
      node.py = padY + (node.y + (reduced ? 0 : Math.cos(t * 0.0005 + node.phase) * 0.004)) * (h - 2 * padY);
    }
  }
  function neighbours(node) {
    const set = new Set([node.id]);
    for (const e of graph.edges) { if (e.a === node.id) set.add(e.b); if (e.b === node.id) set.add(e.a); }
    return set;
  }
  function draw(t = 0) {
    if (!w) return;
    const ink = css('--ink') || '#242922', soft = css('--soft') || '#565d55', accent = css('--accent') || '#35644c', bg = css('--card-bg') || css('--bg') || '#fbf8f2';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    place(t);
    const near = hover ? neighbours(hover) : null;
    for (const e of graph.edges) {
      const A = graph.byId.get(e.a), B = graph.byId.get(e.b);
      const tint = [A, B].map(n => n.color).find(c => c && c[0] === '#' && c !== SOURCE_COLOR) || ink;
      let alpha = 0.12, width = 1, color = tint, dash = [];
      if (e.kind === 'cell') {
        if (e.status === 'has_records') { alpha = 0.9; width = 2.2; }
        else if (e.status === 'probed_empty') { alpha = 0.55; width = 1.4; dash = [2, 3]; }
        else { alpha = 0.4; width = 1.4; dash = [4, 4]; }
      } else alpha = e.kind === 'link' ? 0.5 : 0.3;
      if (near) alpha *= (e.a === hover.id || e.b === hover.id) ? 2.4 : 0.2;
      ctx.globalAlpha = Math.min(1, alpha); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(A.px, A.py); ctx.lineTo(B.px, B.py); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const node of graph.nodes) {
      const dim = near && !near.has(node.id);
      const empty = node.type === 'class' || node.type === 'problem' || node.type === 'species';
      const r = node.r * (1 + Math.min(0.5, Math.sqrt(node.degree) * 0.04)) * (node === hover ? 1.3 : 1);
      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.beginPath(); ctx.arc(node.px, node.py, r, 0, Math.PI * 2);
      ctx.fillStyle = resolve(node.color, ink, soft); ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = bg; ctx.stroke();
      if (empty && node.type !== 'species') { ctx.globalAlpha = dim ? 0.1 : 0.5; ctx.beginPath(); ctx.arc(node.px, node.py, r + 3, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.strokeStyle = resolve(node.color, ink, soft); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    if (w >= 620 || hover) {
      ctx.font = `500 12px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textBaseline = 'middle';
      for (const node of graph.nodes) {
        if (!node.label || (near && !near.has(node.id))) continue;
        if (w < 620 && node !== hover) continue;
        ctx.fillStyle = ink;
        if (node.type === 'class') { ctx.textAlign = 'right'; ctx.fillText(node.label, node.px - node.r - 12, node.py); }
        else if (node.type === 'problem') { ctx.textAlign = 'left'; ctx.fillText(node.label, node.px + node.r + 12, node.py); }
        else { ctx.textAlign = 'center'; ctx.fillText(node.label, node.px, node.py - node.r - 10); }
      }
    }
  }
  function resize() {
    const rect = stage.getBoundingClientRect();
    w = Math.max(280, Math.round(rect.width));
    h = Math.round(Math.max(300, Math.min(500, w * 0.5)));
    stage.style.height = h + 'px';
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    draw(performance.now());
  }
  function frame(t) {
    raf = 0;
    if (destroyed || !visible || document.hidden || reduced) return;
    if (t - last > 33) { last = t; draw(t); }
    raf = requestAnimationFrame(frame);
  }
  const start = () => { if (!raf && !reduced && visible) raf = requestAnimationFrame(frame); };

  function pointer(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = null, bestD = 1e9;
    for (const node of graph.nodes) {
      const d = Math.hypot(node.px - x, node.py - y);
      if (d < bestD && d <= node.r + 10) { best = node; bestD = d; }
    }
    if (best !== hover) { hover = best; draw(performance.now()); }
    canvas.style.cursor = hover ? 'pointer' : 'default';
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
