// Stepped, pixel-grid landscape for the hero and the footer. Shapes are computed on a
// small art-pixel grid and drawn as merged column rectangles with crisp edges, so they
// scale up as hard squares. The approach follows ValueArena's PixelHills.

const W = 240;
const H = 80;

const LAYERS = {
  // Rising sheets, like a curve climbing to the right
  hero: [
    { top: x => H - 8 - 70 * Math.pow(x / W, 2.6) - 6 * Math.sin(x / 19), fill: 'var(--hill-1)', dither: true },
    { top: x => H - 2 - 58 * Math.pow(Math.max(0, x - 30) / (W - 30), 2.2), fill: 'var(--hill-2)', edge: 'var(--hill-edge)' },
    { top: x => H + 4 - 44 * Math.pow(Math.max(0, x - 70) / (W - 70), 1.8), fill: 'var(--hill-3)', edge: 'var(--hill-edge)' }
  ],
  // Rolling hills for the footer wordmark to stand on
  footer: [
    { top: x => 30 + 9 * Math.sin(x / 23) + 6 * Math.sin(x / 9 + 1), fill: 'var(--hill-1)', dither: true },
    { top: x => 44 + 8 * Math.sin(x / 17 + 2) + 4 * Math.sin(x / 7), fill: 'var(--hill-2)', edge: 'var(--hill-edge)' },
    { top: x => 58 + 6 * Math.sin(x / 13 + 4), fill: 'var(--hill-3)', edge: 'var(--hill-edge)' }
  ]
};

// Merge runs of columns that share a height into one rectangle each.
export function columns(top) {
  const runs = [];
  for (let x = 0; x < W; x++) {
    const y = Math.max(0, Math.min(H, Math.round(top(x))));
    const last = runs[runs.length - 1];
    if (last && last.y === y) last.w += 1;
    else runs.push({ x, w: 1, y });
  }
  return runs;
}

export function pixelHills(variant, extraClass = '') {
  const layers = LAYERS[variant] || LAYERS.hero;
  const rect = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  const body = layers.map(layer => {
    const runs = columns(layer.top);
    let out = '';
    if (layer.dither) {
      // A checkerboard fringe along the top edge softens the step.
      for (const r of runs) for (let k = 0; k < r.w; k++) if ((r.x + k + r.y) % 2 === 0) out += rect(r.x + k, r.y - 2, 1, 1, layer.fill);
    }
    for (const r of runs) out += rect(r.x, r.y, r.w, H - r.y, layer.fill);
    if (layer.edge) for (const r of runs) out += rect(r.x, r.y, r.w, 1, layer.edge);
    return `<g>${out}</g>`;
  }).join('');
  return `<svg class="pixel-hills pixel-hills-${variant}${extraClass ? ' ' + extraClass : ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMaxYMax slice" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${body}</svg>`;
}
