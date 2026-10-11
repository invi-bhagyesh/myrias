// Overlapping, locator-preserving windows over a paper's pages, so a claim that crosses a page
// break is still seen whole. Every window knows which pages it covers, and a quote found in a
// window is located back to the page where it starts.
import { normalise } from './quote.mjs';

export function windows(pages, { size = 1800, overlap = 300 } = {}) {
  const ordered = [...pages].sort((a, b) => a.page - b.page);
  let text = '';
  const starts = [];
  for (const p of ordered) { starts.push({ page: p.page, at: text.length }); text += p.text.trim() + '\n'; }
  const pageAt = i => { let pg = starts[0]?.page ?? 1; for (const s of starts) if (s.at <= i) pg = s.page; else break; return pg; };
  const out = [];
  if (!text.trim()) return out;
  const step = Math.max(1, size - overlap);
  for (let i = 0; i < text.length; i += step) {
    const end = Math.min(text.length, i + size);
    out.push({ index: out.length, text: text.slice(i, end), page_start: pageAt(i), page_end: pageAt(end - 1) });
    if (end >= text.length) break;
  }
  return out;
}

// The page where a quote starts, from the per-page text; null if it is on no single page or spans.
export function locatePage(quote, pages) {
  const q = normalise(quote);
  if (!q) return null;
  const ordered = [...pages].sort((a, b) => a.page - b.page);
  for (const p of ordered) if (normalise(p.text).includes(q)) return p.page;
  // Spanning a page break: find it in the joined text and return the page where it begins.
  let joined = '', marks = [];
  for (const p of ordered) { marks.push({ page: p.page, at: joined.length }); joined += normalise(p.text); }
  const at = joined.indexOf(q);
  if (at < 0) return null;
  let pg = marks[0].page; for (const m of marks) if (m.at <= at) pg = m.page;
  return pg;
}

// Overlapping windows report the same claim twice. Keep one per source and quote: when one quote
// contains the other, keep the longer one.
export function mergeOverlaps(claims) {
  const kept = [];
  for (const c of claims) {
    const q = normalise(c.quote);
    const i = kept.findIndex(k => k.source === c.source && (normalise(k.quote).includes(q) || q.includes(normalise(k.quote))));
    if (i < 0) kept.push(c);
    else if (q.length > normalise(kept[i].quote).length) kept[i] = c;
  }
  return kept;
}
