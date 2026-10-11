// Stage 0: drop duplicate papers before any model call. Two files are the same paper when their
// normalised text is identical, or their normalised titles match (the same article reposted or
// renamed). The first copy is kept; every drop is reported with its reason.
import { createHash } from 'node:crypto';
import { normalise } from './quote.mjs';

const titleOf = source => normalise(String(source).replace(/\.pdf$/i, '').replace(/_[^_]*$/, '').replace(/[()（）[\]【】]/g, ''));
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 16);

export function dedupSources(pages) {
  const bySource = new Map();
  for (const p of pages) (bySource.get(p.source) || bySource.set(p.source, []).get(p.source)).push(p);
  const seenText = new Map(), seenTitle = new Map(), kept = [], dropped = [];
  for (const [source, list] of bySource) {
    const body = normalise(list.sort((a, b) => a.page - b.page).map(p => p.text).join(''));
    const h = hash(body), t = titleOf(source);
    if (body && seenText.has(h)) { dropped.push({ source, reason: 'same_text', duplicate_of: seenText.get(h) }); continue; }
    if (t && seenTitle.has(t)) { dropped.push({ source, reason: 'same_title', duplicate_of: seenTitle.get(t) }); continue; }
    if (body) seenText.set(h, source);
    if (t) seenTitle.set(t, source);
    kept.push(source);
  }
  return { kept, dropped, pages: pages.filter(p => kept.includes(p.source)) };
}
