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

export function corpusFlowHtml(c, tr) {
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
