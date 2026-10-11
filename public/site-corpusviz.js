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
    + off.map(k => `<li class="is-off"><span class="fx-name">${esc(tr('corpus.src.' + k))}</span><span class="fx-track is-off"></span><span class="fx-val"><small>${esc(tr('cv.needs'))}</small></span></li>`).join('');
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
  // The flow is drawn as outlines only, no fill: the top edge (English), the line where English meets
  // Chinese, and the bottom edge (Chinese). The space between them narrows as papers drop out.
  const edge = (y0, y1, x0, x1) => { const m = (x0 + x1) / 2; return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1}`; };
  // A bar with 4px rounded outer ends: the top of English and the bottom of Chinese.
  const seg = (x, r, top, bottom) => { const rt = top ? Math.min(4, r.h / 2) : 0, rb = bottom ? Math.min(4, r.h / 2) : 0;
    return `M${x},${r.y + rt} Q${x},${r.y} ${x + rt},${r.y} L${x + BW - rt},${r.y} Q${x + BW},${r.y} ${x + BW},${r.y + rt} L${x + BW},${r.y + r.h - rb} Q${x + BW},${r.y + r.h} ${x + BW - rb},${r.y + r.h} L${x + rb},${r.y + r.h} Q${x},${r.y + r.h} ${x},${r.y + r.h - rb} Z`; };
  let out = '';
  for (let i = 0; i < cols.length - 1; i++) {
    const A = cols[i], B = cols[i + 1], x0 = A.x + BW + 3, x1 = B.x - 3;
    const tip = l => `<title>${esc(tr('cv.lang.' + l))}: ${n(A.by_lang[l])} → ${n(B.by_lang[l])}</title>`;
    out += `<path class="sk-edge" style="stroke:${LANG_COLOR.en}" d="${edge(A.en.y, B.en.y, x0, x1)}">${tip('en')}</path>`;
    out += `<path class="sk-edge is-mid" d="${edge(A.zh.y - GAP / 2, B.zh.y - GAP / 2, x0, x1)}"/>`;
    out += `<path class="sk-edge" style="stroke:${LANG_COLOR.zh}" d="${edge(A.zh.y + A.zh.h, B.zh.y + B.zh.h, x0, x1)}">${tip('zh')}</path>`;
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
    out += `<text class="sk-src is-off" x="20" y="${y + 4}">${esc(tr('corpus.src.' + k))}</text><text class="sk-srcn is-off" x="226" y="${y + 4}" text-anchor="end">${esc(tr('cv.needs'))}</text>`;
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
