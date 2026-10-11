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
// A quote may skip text with an ellipsis ("…" or "..."): it passes only if every piece is on the page,
// in order, and each piece is long enough not to match by chance. `gaps` says how many were skipped.
export function checkQuote(quote, pageText, { minChars = 8, minPiece = 6 } = {}) {
  const q = normalise(quote);
  if (!q) return { ok: false, reason: 'empty' };
  if (q.length < minChars) return { ok: false, reason: 'too_short' };
  const page = normalise(pageText);
  if (page.includes(q)) return { ok: true, reason: 'found' };
  const pieces = String(quote).split(/\s*(?:…+|\.{3,}|。{3,})\s*/).map(normalise).filter(Boolean);
  if (pieces.length > 1 && pieces.every(x => x.length >= minPiece)) {
    let at = 0;
    for (const x of pieces) { const i = page.indexOf(x, at); if (i < 0) return { ok: false, reason: 'not_on_page' }; at = i + x.length; }
    return { ok: true, reason: 'found', gaps: pieces.length - 1 };
  }
  return { ok: false, reason: 'not_on_page' };
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
