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
  if (!ch) return '';
  const { cols } = flowModel(ch);
  const BW = 26, H = TOP + H0 + 90;
  const src = Object.entries(ch.sources).sort((a, b) => b[1].papers - a[1].papers);
  const notSearched = Object.entries(c.headline.sources || {}).filter(([, v]) => v !== 'ok').map(([k]) => k);
  const rows = src.length + notSearched.length;
  const rowY = i => TOP + 10 + (H0 - 20) * (rows === 1 ? 0.5 : i / (rows - 1));
  const maxP = Math.max(...src.map(([, v]) => v.papers), 1);
  const found = cols[0];
  const mid = found.en.y + (found.en.h + found.zh.h) / 2;
  const curve = (x0, y0, x1, y1) => { const m = (x0 + x1) / 2; return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1}`; };
  const ribbon = (a, b, x0, x1) => { const m = (x0 + x1) / 2; return `M${x0},${a.y} C${m},${a.y} ${m},${b.y} ${x1},${b.y} L${x1},${b.y + b.h} C${m},${b.y + b.h} ${m},${a.y + a.h} ${x0},${a.y + a.h} Z`; };

  let out = `<text class="cv-head" x="290" y="20" text-anchor="end">${esc(tr('cv.col.sources'))}</text>`;
  cols.forEach(col => { out += `<text class="cv-head" x="${col.x + BW / 2}" y="20" text-anchor="middle">${esc(tr('cv.stage.' + col.id))}</text>`; });
  // Sources: link width follows the papers each found (they overlap, so widths do not add up).
  src.forEach(([k, v], i) => {
    const y = rowY(i), w = 1.2 + 9 * Math.sqrt(v.papers / maxP);
    out += `<path class="cv-link" d="${curve(308, y, found.x - 4, mid)}" stroke-width="${w.toFixed(1)}"/>`;
    out += `<circle cx="302" cy="${y}" r="5" class="cv-src"/><text x="290" y="${y - 3}" text-anchor="end" class="cv-label">${esc(tr('corpus.src.' + k))}</text>`;
    out += `<text x="290" y="${y + 12}" text-anchor="end" class="cv-sub">${esc(tr('cv.src.papers', { n: n(v.papers) }))} · ${esc(tr('cv.src.only', { n: n(v.only_here) }))} · ${esc(tr('cv.src.zh', { n: n(v.zh) }))}</text>`;
  });
  notSearched.forEach((k, j) => {
    const y = rowY(src.length + j);
    out += `<circle cx="302" cy="${y}" r="5" class="cv-src-off"/><text x="290" y="${y - 3}" text-anchor="end" class="cv-label is-off">${esc(tr('corpus.src.' + k))}</text>`;
    out += `<text x="290" y="${y + 12}" text-anchor="end" class="cv-sub is-off">${esc(tr('corpus.status.not_searched'))}</text>`;
  });
  // Ribbons between stages, one per language.
  for (let i = 0; i < cols.length - 1; i++) for (const l of ['en', 'zh']) {
    out += `<path class="cv-ribbon" style="fill:${LANG_COLOR[l]}" d="${ribbon(cols[i][l], cols[i + 1][l], cols[i].x + BW, cols[i + 1].x)}"/>`;
  }
  cols.forEach((col, i) => {
    for (const l of ['en', 'zh']) out += `<rect x="${col.x}" y="${col[l].y}" width="${BW}" height="${col[l].h.toFixed(1)}" rx="3" style="fill:${LANG_COLOR[l]}"><title>${esc(tr('cv.lang.' + l))}: ${n(col.by_lang[l])}</title></rect>`;
    const bottom = col.zh.y + col.zh.h;
    out += `<text x="${col.x + BW / 2}" y="${bottom + 22}" text-anchor="middle" class="cv-big">${n(col.n)}</text>`;
    out += `<text x="${col.x + BW / 2}" y="${bottom + 38}" text-anchor="middle" class="cv-sub">${esc(tr('cv.split', { en: n(col.by_lang.en), zh: n(col.by_lang.zh) }))}</text>`;
    let line = bottom + 54;
    if (col.by_route) { out += `<text x="${col.x + BW / 2}" y="${line}" text-anchor="middle" class="cv-sub">${esc(Object.entries(col.by_route).map(([k, v]) => tr('cv.route.' + k, { n: n(v) })).join(' · '))}</text>`; line += 16; }
    if (i > 0) out += `<text x="${col.x + BW / 2}" y="${line}" text-anchor="middle" class="cv-sub cv-lost">${esc(tr('cv.lost.' + col.id, { n: n(cols[i - 1].n - col.n) }))}</text>`;
  });
  const svg = `<svg class="cv-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tr('cv.aria'))}">${out}</svg>`;
  // Phone layout: the same numbers as a list.
  const list = `<ol class="cv-list">${cols.map(col => `<li><b>${n(col.n)}</b> ${esc(tr('cv.stage.' + col.id))}<span>${esc(tr('cv.split', { en: n(col.by_lang.en), zh: n(col.by_lang.zh) }))}</span></li>`).join('')}</ol>`;
  return `${svg}${list}`;
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
