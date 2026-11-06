// Corpus page charts: where the papers came from and how many survive each step, by language
// (a flow like the home page's "What we found"), then welfare topics and papers by decade.
// Reads only the counts in data/corpus.json.
import { escapeHtml as esc } from './site-lib.js';

// Validated pair (dataviz validator: CVD ΔE 34.6 light, 28.2 dark); dark-mode steps set in site.css.
export const LANG_COLOR = { en: 'var(--lang-en)', zh: 'var(--lang-zh)' };
const n = x => Number(x || 0).toLocaleString();
const W = 1000, TOP = 46, H0 = 340;

// Stage bars drawn as columns; English on top, Chinese below, linked by ribbons of the same colour.
export function flowModel(charts) {
  const stages = charts.stages.filter(s => s.id !== 'tried');
  const max = Math.max(...stages.map(s => s.n), 1);
  const scale = H0 / max;
  const xs = [470, 660, 850];
  const cols = stages.map((s, i) => {
    const hEn = Math.max(s.by_lang.en ? 2 : 0, s.by_lang.en * scale), hZh = Math.max(s.by_lang.zh ? 2 : 0, s.by_lang.zh * scale);
    const y0 = TOP + (H0 - hEn - hZh) / 2;
    return { ...s, x: xs[i], en: { y: y0, h: hEn }, zh: { y: y0 + hEn, h: hZh } };
  });
  return { cols, scale };
}

function barsHtml(c, tr) {
  const ch = c.charts;
  if (!ch) return '';
  const stages = ch.stages.filter(s => s.id !== 'tried');
  const found = stages[0].n || 1;
  const pct = (a, b) => (b ? (100 * a / b < 10 ? (100 * a / b).toFixed(1) : Math.round(100 * a / b)) : 0) + '%';
  // Where we searched: bar = papers each source found; the darker part is what no other source had.
  const src = Object.entries(ch.sources).sort((a, b) => b[1].papers - a[1].papers);
  const maxP = Math.max(...src.map(([, v]) => v.papers), 1);
  const off = Object.entries(c.headline.sources || {}).filter(([, v]) => v !== 'ok').map(([k]) => k);
  const srcRows = src.map(([k, v]) => `<li><span class="fx-name">${esc(tr('corpus.src.' + k))}</span>
      <span class="fx-track" title="${esc(tr('cv.src.papers', { n: n(v.papers) }))} · ${esc(tr('cv.src.only', { n: n(v.only_here) }))}"><i class="fx-all" style="width:${(100 * v.papers / maxP).toFixed(1)}%"><i class="fx-only" style="width:${(100 * v.only_here / v.papers).toFixed(1)}%"></i></i></span>
      <span class="fx-val">${n(v.papers)}<small>${esc(tr('cv.src.only', { n: n(v.only_here) }))}</small></span></li>`).join('')
    + off.map(k => `<li class="is-off"><span class="fx-name">${esc(tr('corpus.src.' + k))}</span><span class="fx-track is-off"></span><span class="fx-val"><small>${esc(tr('cv.off'))}</small></span></li>`).join('');
  // What made it through: one stacked bar per stage, English then Chinese, scaled to all papers found.
  const stageRows = stages.map((st, i) => {
    const drop = i ? `<li class="fx-drop" aria-hidden="true"><span>↓ ${esc(tr('cv.lost.' + st.id, { n: n(stages[i - 1].n - st.n) }))}</span></li>` : '';
    const seg = l => `<i class="fx-seg" style="width:${(100 * st.by_lang[l] / found).toFixed(2)}%;background:${LANG_COLOR[l]}" title="${esc(tr('cv.lang.' + l))}: ${n(st.by_lang[l])}"></i>`;
    return `${drop}<li class="fx-stage"><span class="fx-name">${esc(tr('cv.stage.' + st.id))}</span>
      <span class="fx-bar">${seg('en')}${st.by_lang.zh ? seg('zh') : ''}<b class="fx-n">${n(st.n)}</b></span>
      <span class="fx-split">${esc(tr('cv.split', { en: n(st.by_lang.en), zh: n(st.by_lang.zh) }))}${st.by_route ? ' · ' + esc(Object.entries(st.by_route).map(([k, v]) => tr('cv.route.' + k, { n: n(v) })).join(' · ')) : ''}</span></li>`;
  }).join('');
  const first = stages[0], last = stages[stages.length - 1];
  const keep = tr('cv.keep', { en: pct(last.by_lang.en, first.by_lang.en), zh: pct(last.by_lang.zh, first.by_lang.zh),
    en_n: n(last.by_lang.en), en_of: n(first.by_lang.en), zh_n: n(last.by_lang.zh), zh_of: n(first.by_lang.zh) });
  return `<div class="fx"><section class="fx-col"><h3>${esc(tr('cv.col.sources.title'))}</h3><ul class="fx-rows fx-src">${srcRows}</ul>
      <p class="fx-key"><i class="fx-all"></i>${esc(tr('cv.key.found'))} <i class="fx-only"></i>${esc(tr('cv.key.only'))}</p></section>
    <section class="fx-col"><h3>${esc(tr('cv.col.through'))}</h3><ol class="fx-rows fx-funnel">${stageRows}</ol><p class="fx-keep">${esc(keep)}</p></section></div>`;
}

function sankeyHtml(c, tr) {
  const ch = c.charts;
  const stages = ch.stages.filter(s => s.id !== 'tried');
  const W = 1000, TOP = 64, H0 = 240, BW = 18, GAP = 2, H = TOP + H0 + 50;
  const xs = [440, 650, 860];
  const scale = H0 / Math.max(...stages.map(s => s.n), 1);
  const cols = stages.map((st, i) => {
    const hEn = Math.max(st.by_lang.en ? 3 : 0, st.by_lang.en * scale), hZh = Math.max(st.by_lang.zh ? 3 : 0, st.by_lang.zh * scale);
    const y0 = TOP + (H0 - hEn - hZh - GAP) / 2;
    return { ...st, x: xs[i], en: { y: y0, h: hEn }, zh: { y: y0 + hEn + GAP, h: hZh } };
  });
  // The flow between stages is drawn as strands, not a filled band: thin threads spread across each
  // language's share, bunching together as papers drop out. Outer threads are a little stronger.
  const edge = (y0, y1, x0, x1) => { const m = (x0 + x1) / 2; return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1}`; };
  const strands = (a, b, x0, x1) => { const k = Math.max(2, Math.round(Math.max(a.h, b.h) / 4)); let d = '';
    for (let j = 0; j <= k; j++) { const t = j / k; d += edge(a.y + t * a.h, b.y + t * b.h, x0, x1) + ' '; } return d.trim(); };
  // A bar with 4px rounded outer ends: the top of English and the bottom of Chinese.
  const seg = (x, r, top, bottom) => { const rt = top ? Math.min(4, r.h / 2) : 0, rb = bottom ? Math.min(4, r.h / 2) : 0;
    return `M${x},${r.y + rt} Q${x},${r.y} ${x + rt},${r.y} L${x + BW - rt},${r.y} Q${x + BW},${r.y} ${x + BW},${r.y + rt} L${x + BW},${r.y + r.h - rb} Q${x + BW},${r.y + r.h} ${x + BW - rb},${r.y + r.h} L${x + rb},${r.y + r.h} Q${x},${r.y + r.h} ${x},${r.y + r.h - rb} Z`; };
  let out = '';
  for (let i = 0; i < cols.length - 1; i++) for (const l of ['en', 'zh']) if (cols[i + 1].by_lang[l]) {
    const A = cols[i], B = cols[i + 1], x0 = A.x + BW + 2, x1 = B.x - 2;
    out += `<g class="sk-flow" style="stroke:${LANG_COLOR[l]}"><title>${esc(tr('cv.lang.' + l))}: ${n(A.by_lang[l])} → ${n(B.by_lang[l])}</title>`
      + `<path class="sk-strand" d="${strands(A[l], B[l], x0, x1)}"/>`
      + `<path class="sk-edge" d="${edge(A[l].y, B[l].y, x0, x1)} ${edge(A[l].y + A[l].h, B[l].y + B[l].h, x0, x1)}"/></g>`;
  }
  cols.forEach((col, i) => {
    out += `<text class="sk-stage" x="${col.x + BW / 2}" y="${TOP - 40}" text-anchor="middle">${esc(tr('cv.stage.' + col.id))}</text>`;
    out += `<path style="fill:${LANG_COLOR.en}" d="${seg(col.x, col.en, true, !col.by_lang.zh)}"><title>${esc(tr('cv.lang.en'))}: ${n(col.by_lang.en)}</title></path>`;
    if (col.by_lang.zh) out += `<path style="fill:${LANG_COLOR.zh}" d="${seg(col.x, col.zh, false, true)}"><title>${esc(tr('cv.lang.zh'))}: ${n(col.by_lang.zh)}</title></path>`;
    const bottom = col.zh.y + col.zh.h, cx = col.x + BW / 2;
    out += `<text class="sk-n" x="${cx}" y="${col.en.y - 8}" text-anchor="middle">${n(col.n)}</text>`;
    out += `<text class="sk-split" x="${cx}" y="${bottom + 16}" text-anchor="middle">${esc(tr('cv.split', { en: n(col.by_lang.en), zh: n(col.by_lang.zh) }))}</text>`;
    if (i > 0) out += `<text class="sk-drop" x="${cx}" y="${bottom + 32}" text-anchor="middle">↓ ${esc(tr('cv.lost.' + col.id, { n: n(cols[i - 1].n - col.n) }))}</text>`;
  });
  // Sources: compact rows, a small bar for papers found, hairlines into the first stage.
  const src = Object.entries(ch.sources).sort((a, b) => b[1].papers - a[1].papers);
  const off = Object.entries(c.headline.sources || {}).filter(([, v]) => v !== 'ok').map(([k]) => k);
  const rows = src.length + off.length, maxP = Math.max(...src.map(([, v]) => v.papers), 1);
  const rowY = i => TOP + 8 + (H0 - 16) * (rows === 1 ? 0.5 : i / (rows - 1));
  const target = cols[0].en.y + (cols[0].en.h + cols[0].zh.h) / 2;
  out += `<text class="sk-stage" x="20" y="${TOP - 40}">${esc(tr('cv.col.sources.title'))}</text>`;
  src.forEach(([k, v], i) => {
    const y = rowY(i), bw = 80 * v.papers / maxP;
    out += `<path class="sk-link" d="M${322},${y} C${385},${y} ${385},${target} ${cols[0].x - 4},${target}"/>`;
    out += `<text class="sk-src" x="20" y="${y + 4}">${esc(tr('corpus.src.' + k))}</text>`;
    out += `<rect class="sk-srcbar" x="${232}" y="${y - 3}" width="${bw.toFixed(1)}" height="6" rx="3"><title>${esc(tr('cv.src.papers', { n: n(v.papers) }))} · ${esc(tr('cv.src.only', { n: n(v.only_here) }))}</title></rect>`;
    out += `<text class="sk-srcn" x="${226}" y="${y + 4}" text-anchor="end">${n(v.papers)}</text>`;
  });
  off.forEach((k, j) => {
    const y = rowY(src.length + j);
    out += `<text class="sk-src is-off" x="20" y="${y + 4}">${esc(tr('corpus.src.' + k))}</text><text class="sk-srcn is-off" x="226" y="${y + 4}" text-anchor="end">${esc(tr('cv.off'))}</text>`;
  });
  return `<svg class="cv-svg sk" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr('cv.aria'))}">${out}</svg>`;
}

// Desktop: the flow with ribbons showing what each language carries to the next stage, then the keep rate.
// Phones: the same numbers as stacked bars, which stay legible at that width.
export function corpusFlowHtml(c, tr) {
  if (!c.charts) return '';
  const st = c.charts.stages.filter(s => s.id !== 'tried'), first = st[0], last = st[st.length - 1];
  const pct = (a, b) => (b ? (100 * a / b < 10 ? (100 * a / b).toFixed(1) : Math.round(100 * a / b)) : 0) + '%';
  const keep = tr('cv.keep', { en: pct(last.by_lang.en, first.by_lang.en), zh: pct(last.by_lang.zh, first.by_lang.zh), en_n: n(last.by_lang.en), en_of: n(first.by_lang.en), zh_n: n(last.by_lang.zh), zh_of: n(first.by_lang.zh) });
  return `<div class="fx-sankey">${sankeyHtml(c, tr)}<p class="fx-keep fx-keep-row">${esc(keep)}</p></div><div class="fx-phone">${barsHtml(c, tr)}</div>`;
}

// Stacked horizontal bars (topics) and columns (decades), English and Chinese.
export function topicBarsHtml(topics, label) {
  const rows = Object.entries(topics);
  const max = Math.max(...rows.map(([, v]) => v.en + v.zh), 1);
  return `<ul class="cv-bars">${rows.map(([k, v]) => `<li><span class="cv-bar-label">${esc(label(k))}</span>
    <span class="cv-bar"><i style="width:${(100 * v.en / max).toFixed(1)}%;background:${LANG_COLOR.en}"></i><i style="width:${(100 * v.zh / max).toFixed(1)}%;background:${LANG_COLOR.zh}"></i></span>
    <span class="cv-bar-n">${n(v.en + v.zh)}<small>${n(v.en)} / ${n(v.zh)}</small></span></li>`).join('')}</ul>`;
}
export function decadeColumnsHtml(decades) {
  const rows = Object.entries(decades).filter(([k]) => k !== 'unknown');
  const max = Math.max(...rows.map(([, v]) => v.en + v.zh), 1);
  return `<div class="cv-cols">${rows.map(([k, v]) => `<div class="cv-col"><span class="cv-col-n">${n(v.en + v.zh)}</span>
    <span class="cv-col-bar"><i style="height:${(100 * v.zh / max).toFixed(1)}%;background:${LANG_COLOR.zh}"></i><i style="height:${(100 * v.en / max).toFixed(1)}%;background:${LANG_COLOR.en}"></i></span>
    <span class="cv-col-label">${esc(k)}</span></div>`).join('')}</div>`;
}

// Who wrote the papers we read, and what kind of papers they are: a flow from where each paper's first
// author works (China by sector, then other regions) to the kind of paper. Reads data/papers.json, which
// pipeline/affiliations.mjs writes from the papers' title pages. Groups are coloured in a fixed order
// checked with the dataviz validator (light #ECEADF and dark #20241C: CVD and normal-vision separation pass).
export const AF_GROUPS = [['cn_university', '#b5562a'], ['cn_institute', '#008c80'], ['cn_other', '#97761f'], ['asia', '#b04a6e'], ['europe', '#2a67a4'], ['us', '#4e8a3a'], ['other', '#8457a8']];
export const AF_KINDS = ['experiment', 'field_study', 'methods', 'review', 'thesis', 'other', 'unknown'];

// Display groups only: source records retain their original region and country.
// The US is determined by the first affiliation's country, not coauthor countries.
export function authorModel(meta) {
  const groupOf = p => {
    if (['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(String(p.country || '').trim().toUpperCase())) return 'us';
    if (p.group === 'cn_company') return 'cn_other';
    return AF_GROUPS.some(([id]) => id !== 'us' && id === p.group) ? p.group : 'other';
  };
  const papers = (meta?.papers || []).map(p => ({ ...p, group: groupOf(p), kind: AF_KINDS.includes(p.kind) ? p.kind : 'other' }));
  const count = (f, keys) => keys.map(k => [k, papers.filter(p => f(p) === k).length]).filter(([, v]) => v);
  const groups = count(p => p.group, AF_GROUPS.map(([k]) => k)), kinds = count(p => p.kind, AF_KINDS);
  const links = [];
  for (const [g] of groups) for (const [k] of kinds) { const v = papers.filter(p => p.group === g && p.kind === k).length; if (v) links.push({ g, k, v }); }
  const china = papers.filter(p => p.group.startsWith('cn_')).length;
  return { n: papers.length, groups, kinds, links, china, intl: papers.filter(p => (p.countries || []).length > 1).length,
    countries: [...new Set(papers.filter(p => !p.group.startsWith('cn_') && p.country).map(p => p.country))].sort() };
}


// A single papers-to-pixels scale on both sides keeps every ribbon proportional.
// Small nodes reserve label space without inflating their data bars.
export function authorLayout(model, height = 400) {
  const gap = 8, minRoom = 40;
  const room = (rows, scale) => rows.reduce((sum, [, v]) => sum + Math.max(minRoom, v * scale), 0) + Math.max(0, rows.length - 1) * gap;
  let lo = 0, hi = height / Math.max(1, model.n);
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (Math.max(room(model.groups, mid), room(model.kinds, mid)) <= height) lo = mid; else hi = mid;
  }
  const place = rows => {
    let y = (height - room(rows, lo)) / 2;
    return Object.fromEntries(rows.map(([id, count]) => {
      const slot = Math.max(minRoom, count * lo), h = count * lo;
      const node = { y: y + (slot - h) / 2, h, count, used: 0 };
      y += slot + gap; return [id, node];
    }));
  };
  const left = place(model.groups), right = place(model.kinds);
  const links = model.links.map(link => {
    const a = left[link.g], b = right[link.k], h = link.v * lo;
    const ribbon = { ...link, y0: a.y + a.used, y1: b.y + b.used, h };
    a.used += h; b.used += h; return ribbon;
  });
  return { left, right, links, scale: lo, height };
}

const afPercent = (count, total) => `${(100 * count / Math.max(1, total)).toFixed(1)}%`;
const afColor = id => Object.fromEntries(AF_GROUPS)[id];

function authorDiagram(m, tr, width = 960, height = 340) {
  const layout = authorLayout(m, height), top = 36, bw = 12;
  const xl = Math.max(235, Math.min(width * .27, 280));
  const xr = width - Math.max(190, Math.min(width * .25, 260));
  const fmt = v => Number(v.toFixed(3));
  const ribbon = l => {
    const x0 = xl + bw, x1 = xr, mid = (x0 + x1) / 2;
    const y0 = fmt(l.y0 + top), y1 = fmt(l.y1 + top), b0 = fmt(y0 + l.h), b1 = fmt(y1 + l.h);
    return `M${x0},${y0}C${mid},${y0} ${mid},${y1} ${x1},${y1}L${x1},${b1}C${mid},${b1} ${mid},${b0} ${x0},${b0}Z`;
  };
  const description = l => `${tr('af.g.' + l.g)} → ${tr('af.k.' + l.k)}: ${tr('af.papers', { n: n(l.v) })} (${afPercent(l.v, m.n)})`;
  const paths = layout.links.map(l => `<path class="af-ribbon" data-af-g="${l.g}" data-af-k="${l.k}" data-af-description="${esc(description(l))}" style="--flow:${afColor(l.g)}" d="${ribbon(l)}"><title>${esc(description(l))}</title></path>`).join('');
  const labelLines = label => {
    if (label.length <= 28 || !label.includes(' ')) return [label];
    const words = label.split(' '), lines = [''];
    for (const word of words) {
      if (lines.at(-1).length + word.length > 28) lines.push(word);
      else lines[lines.length - 1] += (lines.at(-1) ? ' ' : '') + word;
    }
    return lines;
  };
  const nodes = (rows, positions, side) => rows.map(([id, count]) => {
    const left = side === 'g', r = positions[id], y = r.y + top, cy = y + r.h / 2;
    const textX = left ? 12 : xr + 30, name = tr(`af.${side}.${id}`), lines = labelLines(name);
    const labelY = cy - (lines.length > 1 ? 15 : 7);
    const groupSegments = left ? '' : layout.links.filter(l => l.k === id).map(l => `<rect class="af-segment" data-af-g="${l.g}" data-af-k="${l.k}" x="${xr}" y="${fmt(l.y1 + top)}" width="${bw}" height="${fmt(l.h)}" fill="${afColor(l.g)}"/>`).join('');
    return `<g class="af-node" role="button" tabindex="0" aria-pressed="false" aria-label="${esc(tr('af.select', { name }))}" data-af-${side}="${id}">
      <rect class="af-hit" x="${left ? 0 : xr - 4}" y="${fmt(cy - 24)}" width="${left ? xl + bw + 4 : width - xr + 4}" height="48" rx="6"/>
      ${left ? `<rect x="${xl}" y="${fmt(y)}" width="${bw}" height="${fmt(r.h)}" fill="${afColor(id)}"/>` : groupSegments}
      <text class="af-label" x="${textX}" y="${fmt(labelY)}">${lines.map((line, i) => `<tspan x="${textX}" dy="${i ? 17 : 0}">${esc(line)}</tspan>`).join('')}</text>
      <text class="af-count" x="${textX}" y="${fmt(cy + (lines.length > 1 ? 21 : 14))}">${n(count)}<tspan class="af-percent"> / ${afPercent(count, m.n)}</tspan></text>
    </g>`;
  }).join('');
  return `<svg class="af-diagram" viewBox="0 0 ${width} ${height + 54}" role="group" aria-label="${esc(tr('af.aria', { n: n(m.n) }))}">
      <text class="af-axis" x="12" y="20">${esc(tr('af.left'))}</text><text class="af-axis" x="${xr + 30}" y="20">${esc(tr('af.right'))}</text>
      <g class="af-ribbons">${paths}</g>${nodes(m.groups, layout.left, 'g')}${nodes(m.kinds, layout.right, 'k')}</svg>`;
}

export function authorFlowHtml(meta, tr) {
  const m = authorModel(meta);
  if (!m.n) return '';
  return `<div class="af-explorer" data-affiliations>
    <div class="af-toolbar"><p class="af-total"><strong>${n(m.n)}</strong> ${esc(tr('af.totalLabel'))}</p>
</div>
    <div class="af-visual">${authorDiagram(m, tr)}</div>
    <div class="af-feedback"><p data-af-status role="status" aria-live="polite"></p></div>
    <div class="af-breakdowns" data-af-breakdowns tabindex="0" role="region" aria-label="${esc(tr('af.title'))}"></div>
  </div>`;
}

export function mountAuthorFlow(root, meta, tr) {
  const m = authorModel(meta), selected = { g: '', k: '' };
  const controller = new AbortController(), signal = controller.signal;
  let flows = [], nodes = [];
  const visual = root.querySelector('.af-visual');
  const status = root.querySelector('[data-af-status]');
  const matching = (l, f) => (!f.g || l.g === f.g) && (!f.k || l.k === f.k);
  const paint = (filter = selected) => {
    const active = m.links.filter(l => matching(l, filter));
    flows.forEach(el => el.classList.toggle('is-muted', !matching({ g: el.dataset.afG, k: el.dataset.afK }, filter)));
    nodes.forEach(el => {
      const side = el.dataset.afG ? 'g' : 'k', id = el.dataset.afG || el.dataset.afK;
      el.classList.toggle('is-muted', !active.some(l => l[side] === id));
      el.classList.toggle('is-selected', selected[side] === id);
      el.setAttribute('aria-pressed', String(selected[side] === id));
    });
  };
  const update = () => {
    const focused = root.contains(document.activeElement) && document.activeElement.matches('.af-breakdown') ? document.activeElement : null;
    const active = m.links.filter(l => matching(l, selected)), count = active.reduce((sum, l) => sum + l.v, 0);
    const labels = [selected.g && tr('af.g.' + selected.g), selected.k && tr('af.k.' + selected.k)].filter(Boolean);
    status.textContent = tr('af.selection', { n: n(count), total: n(m.n), pct: afPercent(count, m.n) }) + (labels.length ? ` — ${labels.join(' → ')}` : '');
    root.dataset.filtered = String(Boolean(selected.g || selected.k));
    const list = (rows, side) => {
      const items = rows.map(([id]) => [id, active.filter(l => l[side] === id).reduce((sum, l) => sum + l.v, 0)]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
      return `<section><h3>${esc(tr(side === 'g' ? 'af.left' : 'af.right'))}</h3><ul>${items.map(([id, v]) => `<li><button type="button" class="af-breakdown" data-af-${side}="${id}" aria-pressed="${selected[side] === id}"><span>${esc(tr(`af.${side}.${id}`))}</span><strong>${n(v)} <small>${afPercent(v, count)}</small></strong><span class="af-track"><i style="width:${100 * v / count}%;background:${side === 'g' ? afColor(id) : 'var(--accent)'}"></i></span></button></li>`).join('')}</ul></section>`;
    };
    root.querySelector('[data-af-breakdowns]').innerHTML = count ? list(m.groups, 'g') + list(m.kinds, 'k') : `<p>${esc(tr('af.noMatch'))}</p>`;
    paint();
    if (focused) {
      const side = focused.dataset.afG ? 'g' : 'k', id = focused.dataset.afG || focused.dataset.afK;
      (root.querySelector(`.af-breakdown[data-af-${side}="${id}"]`) || root.querySelector('[data-af-breakdowns]')).focus({ preventScroll: true });
    }
  };
  const activate = el => {
    if (el.classList.contains('af-ribbon')) {
      const same = selected.g === el.dataset.afG && selected.k === el.dataset.afK;
      selected.g = same ? '' : el.dataset.afG; selected.k = same ? '' : el.dataset.afK;
    }
    else { const side = el.dataset.afG ? 'g' : 'k', id = el.dataset.afG || el.dataset.afK; selected[side] = selected[side] === id ? '' : id; }
    update();
  };
  root.addEventListener('click', e => {
    const el = e.target.closest('.af-node, .af-ribbon, .af-breakdown'); if (el) activate(el);
  }, { signal });
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') { selected.g = ''; selected.k = ''; update(); }
    else if (e.target.matches('.af-node') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); activate(e.target); }
  }, { signal });
  const preview = e => {
    const el = e.target.closest('.af-node, .af-ribbon'); if (!el) return;
    const filter = { ...selected, ...(el.dataset.afG ? { g: el.dataset.afG } : {}), ...(el.dataset.afK ? { k: el.dataset.afK } : {}) };
    paint(filter);
  };
  root.addEventListener('pointerover', preview, { signal });
  root.addEventListener('focusin', preview, { signal });
  const clear = () => { paint(); };
  root.querySelector('.af-visual').addEventListener('pointerout', e => { if (!e.relatedTarget?.closest?.('.af-node, .af-ribbon')) clear(); }, { signal });
  root.querySelector('.af-visual').addEventListener('pointerleave', clear, { signal });
  root.addEventListener('focusout', clear, { signal });
  let previousSize = '', pending = 0;
  const resize = () => {
    const width = Math.floor(visual.clientWidth - 32);
    if (width <= 0) return;
    const rows = Math.max(m.groups.length, m.kinds.length);
    const height = Math.round(Math.max(rows * 48 - 8, Math.min(innerHeight * .4, width * .4)));
    const size = `${width}:${height}`;
    if (size === previousSize) return;
    previousSize = size;
    const focused = visual.contains(document.activeElement) ? document.activeElement : null;
    visual.innerHTML = authorDiagram(m, tr, width, height);
    flows = [...visual.querySelectorAll('.af-ribbon, .af-segment')];
    nodes = [...visual.querySelectorAll('.af-node')];
    paint();
    if (focused?.dataset.afG || focused?.dataset.afK) {
      const side = focused.dataset.afG ? 'g' : 'k';
      visual.querySelector(`.af-node[data-af-${side}="${focused.dataset.afG || focused.dataset.afK}"]`)?.focus({ preventScroll: true });
    }
  };
  const scheduleResize = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(resize); };
  const observer = new ResizeObserver(scheduleResize);
  observer.observe(root);
  const hero = root.closest('.arena-home')?.querySelector('.hero');
  if (hero) observer.observe(hero);
  document.fonts?.ready.then(() => { if (!signal.aborted) scheduleResize(); });
  addEventListener('resize', scheduleResize, { signal });
  resize();
  update();
  return { destroy: () => { controller.abort(); observer.disconnect(); cancelAnimationFrame(pending); } };
}
