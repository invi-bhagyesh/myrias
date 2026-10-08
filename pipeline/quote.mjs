// Deterministic quote check (L5, first half). A claim's quote must appear in the page it cites,
// after normalising spacing, punctuation width and known encoding substitutions. No model is used.

// Known substitutions in the Chinese journal PDFs: a circled-digit glyph stands for the full stop.
const SUBSTITUTIONS = [[/⒚/g, '。']];

export function normalise(text) {
  let s = String(text ?? '');
  for (const [from, to] of SUBSTITUTIONS) s = s.replace(from, to);
  s = s.normalize('NFKC');                     // full-width forms to ASCII, ligatures, etc.
  s = s.replace(/[‐-―−]/g, '-') // dashes
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[。.]/g, '.')                    // full stop in either script
    .replace(/\s+/g, '');                      // PDF line breaks split words and Chinese runs
  return s.toLowerCase();
}

// Returns { ok, reason }. reason: 'found' | 'empty' | 'too_short' | 'not_on_page'
export function checkQuote(quote, pageText, { minChars = 8 } = {}) {
  const q = normalise(quote);
  if (!q) return { ok: false, reason: 'empty' };
  if (q.length < minChars) return { ok: false, reason: 'too_short' };
  return normalise(pageText).includes(q) ? { ok: true, reason: 'found' } : { ok: false, reason: 'not_on_page' };
}

// Overlap of two quotes as a share of character bigrams, used to match a model quote to a gold quote.
export function bigramOverlap(a, b) {
  const grams = s => { const n = normalise(s), out = new Map(); for (let i = 0; i < n.length - 1; i++) { const g = n.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; };
  const A = grams(a), B = grams(b);
  let shared = 0, total = 0;
  for (const [g, c] of A) shared += Math.min(c, B.get(g) || 0);
  for (const c of A.values()) total += c;
  for (const c of B.values()) total += c;
  return total ? (2 * shared) / total : 0;
}
