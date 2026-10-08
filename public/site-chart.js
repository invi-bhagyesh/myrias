// The explorer matrix as a bubble chart with axes: technology class across the bottom, welfare problem
// down the side, bubble area = number of claims, colour = strongest welfare evidence in the cell,
// bars in the margins = totals. Returns an SVG string; every cell is a link.
import { pick, escapeHtml } from './site-lib.js';

const EV = ['none', 'detection_only', 'proxy_improved', 'outcome_improved'];
const short = s => String(s || '').replace(/\s*[(（].*$/, '');
function wrap(text, max) {
  const out = []; let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= max) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
// CJK has no spaces: break by length instead.
const lines = (text, max) => (/[一-鿿]/.test(text) ? String(text).match(new RegExp(`.{1,${Math.ceil(max / 1.6)}}`, 'g')) || [''] : wrap(text, max));

export function chartModel(matrix, data) {
  const claimsIn = cell => new Set(cell.applications.flatMap(a => a.claim_ids)).size;
  const evidence = cell => cell.applications.reduce((m, a) => Math.max(m, EV.indexOf(a.outcome_evidence)), 0);
  const cells = matrix.rows.map(r => r.cells.map(c => ({ ...c, claims: claimsIn(c), ev: evidence(c) })));
  const colTotals = matrix.columns.map((_, j) => cells.reduce((n, row) => n + row[j].claims, 0));
  const rowTotals = cells.map(row => row.reduce((n, c) => n + c.claims, 0));
  const max = Math.max(1, ...cells.flat().map(c => c.claims));
  return { cells, colTotals, rowTotals, max };
}

export function matrixChart({ matrix, data, lang, selected, speciesId, link, tr }) {
  const m = chartModel(matrix, data);
  const cols = matrix.columns.length, rows = matrix.rows.length;
  const L = 196, R = 92, T = 92, B = 118, cw = 102, rh = 64;
  const W = L + cols * cw + R, H = T + rows * rh + B;
  const maxR = Math.min(cw, rh) / 2 - 6, rad = n => (n ? Math.max(9, maxR * Math.sqrt(n / m.max)) : 0);
  const maxCol = Math.max(1, ...m.colTotals), maxRow = Math.max(1, ...m.rowTotals);
  const evLabel = i => pick((data.taxonomy.outcome_evidence || []).find(x => x.id === EV[i]), '', lang);
  const x = j => L + j * cw + cw / 2, y = i => T + i * rh + rh / 2;
  const out = [];
  out.push(`<svg class="mchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(tr('land.explorer'))}" xmlns="http://www.w3.org/2000/svg">`);
  // plot background and gridlines
  out.push(`<rect class="mc-plot" x="${L}" y="${T}" width="${cols * cw}" height="${rows * rh}" rx="14"/>`);
  for (let j = 0; j <= cols; j++) out.push(`<line class="mc-grid" x1="${L + j * cw}" y1="${T}" x2="${L + j * cw}" y2="${T + rows * rh}"/>`);
  for (let i = 0; i <= rows; i++) out.push(`<line class="mc-grid" x1="${L}" y1="${T + i * rh}" x2="${L + cols * cw}" y2="${T + i * rh}"/>`);
  // top marginal bars (claims per technology class)
  matrix.columns.forEach((c, j) => {
    const h = m.colTotals[j] ? Math.max(3, 40 * m.colTotals[j] / maxCol) : 0;
    out.push(`<rect class="mc-bar" x="${x(j) - 16}" y="${T - 10 - h}" width="32" height="${h}" rx="4"/>`);
    out.push(`<text class="mc-total" x="${x(j)}" y="${T - 14 - h}" text-anchor="middle">${m.colTotals[j]}</text>`);
  });
  // right marginal bars (claims per welfare problem)
  matrix.rows.forEach((r, i) => {
    const w = m.rowTotals[i] ? Math.max(3, 52 * m.rowTotals[i] / maxRow) : 0;
    out.push(`<rect class="mc-bar" x="${L + cols * cw + 12}" y="${y(i) - 10}" width="${w}" height="20" rx="4"/>`);
    out.push(`<text class="mc-total" x="${L + cols * cw + 18 + w}" y="${y(i) + 4}">${m.rowTotals[i]}</text>`);
  });
  // y axis labels and title
  matrix.rows.forEach((r, i) => {
    const ls = lines(short(pick(r.problem, '', lang)), 22), y0 = y(i) - ((ls.length - 1) * 8);
    out.push(`<text class="mc-ylab" x="${L - 14}" y="${y0 + 4}" text-anchor="end">${ls.map((t, k) => `<tspan x="${L - 14}" dy="${k ? 16 : 0}">${escapeHtml(t)}</tspan>`).join('')}</text>`);
  });
  out.push(`<text class="mc-axis" transform="translate(16 ${T + rows * rh / 2}) rotate(-90)" text-anchor="middle">${escapeHtml(tr('chart.y'))} →</text>`);
  // x axis labels and title
  matrix.columns.forEach((c, j) => {
    const ls = lines(short(pick(c, '', lang)), 14);
    out.push(`<text class="mc-xlab" x="${x(j)}" y="${T + rows * rh + 26}" text-anchor="middle">${ls.map((t, k) => `<tspan x="${x(j)}" dy="${k ? 15 : 0}">${escapeHtml(t)}</tspan>`).join('')}</text>`);
  });
  out.push(`<text class="mc-axis" x="${L + cols * cw / 2}" y="${H - 14}" text-anchor="middle">${escapeHtml(tr('chart.x'))} →</text>`);
  out.push(`<text class="mc-axis small" x="${L + cols * cw / 2}" y="22" text-anchor="middle">${escapeHtml(tr('chart.top'))}</text>`);
  // cells
  matrix.rows.forEach((r, i) => r.cells.forEach((cell, j) => {
    const c = m.cells[i][j], key = `${cell.problem_id}|${cell.class_id}`;
    const label = `${short(pick(r.problem, '', lang))} × ${short(pick(matrix.columns[j], '', lang))}: ${c.status === 'has_records' ? tr('chart.claims', { n: c.claims }) + ', ' + evLabel(c.ev) : tr('cell.' + c.status)}`;
    const sel = selected === key ? ' selected' : '';
    let mark;
    if (c.status === 'has_records') mark = `<circle class="mc-b ev-${c.ev}" cx="${x(j)}" cy="${y(i)}" r="${rad(c.claims).toFixed(1)}"/><text class="mc-n" x="${x(j)}" y="${y(i) + 5}" text-anchor="middle">${c.claims}</text>`;
    else if (c.status === 'probed_empty') mark = `<circle class="mc-empty" cx="${x(j)}" cy="${y(i)}" r="10"/><text class="mc-n dim" x="${x(j)}" y="${y(i) + 4}" text-anchor="middle">0</text>`;
    else mark = `<circle class="mc-dot" cx="${x(j)}" cy="${y(i)}" r="2.6"/>`;
    out.push(`<a class="mc-cell st-${c.status}${sel}" href="${link('explore', { species: speciesId, cell: key })}" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title><rect class="mc-hit" x="${L + j * cw + 2}" y="${T + i * rh + 2}" width="${cw - 4}" height="${rh - 4}" rx="10"/>${mark}</a>`);
  }));
  out.push('</svg>');
  // legend (HTML so it wraps)
  const used = [...new Set(m.cells.flat().filter(c => c.status === 'has_records').map(c => c.ev))].sort();
  const legend = `<div class="mc-legend"><span class="mc-lg"><b>${escapeHtml(tr('chart.colour'))}</b>${(used.length ? used : [0, 1, 2, 3]).map(i => `<span class="mc-key"><i class="ev-${i}"></i>${escapeHtml(evLabel(i))}</span>`).join('')}</span>
    <span class="mc-lg"><b>${escapeHtml(tr('chart.size'))}</b><span class="mc-key"><i class="sz s1"></i>1</span><span class="mc-key"><i class="sz s2"></i>${Math.max(2, Math.round(m.max / 2))}</span><span class="mc-key"><i class="sz s3"></i>${m.max}</span></span>
    <span class="mc-lg"><span class="mc-key"><i class="mc-ring"></i>${escapeHtml(tr('cell.probed_empty'))}</span><span class="mc-key"><i class="mc-pt"></i>${escapeHtml(tr('cell.not_collected'))}</span></span></div>`;
  return `<div class="mchart-wrap">${out.join('')}</div>${legend}`;
}
