// Prepare (L1d): turn corpus pages into the pages a run reads, and list the papers going in.
//   node pipeline/prepare.mjs --pages a.jsonl[,b.jsonl] --out DIR [--records records.jsonl] [--trim-references]
// Writes DIR/pages.jsonl (sorted by source and page) and DIR/sources.json: one entry per paper with its
// title, year, language and DOI when --records gives them, its page count and how many characters were
// trimmed. Trimming drops everything from a "References" (参考文献, Acknowledgements…) heading to the
// end of the paper: those pages hold no claims and only cost extraction calls. No model is called.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const REF = /^\s*(?:\d+\.?\s*)?(references|literature cited|bibliography|acknowledg(?:e)?ments?|参考文献|致谢)\s*[:：]?\s*$/im;

// Pure: pages of one paper, in order, with the reference section and everything after it removed.
export function trimReferences(pages) {
  const out = [];
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    const first = String(p.text).split('\n').find(l => l.trim()) || '';
    if (p.locator === 'section' && REF.test(first)) break;
    const m = String(p.text).match(REF);
    if (m && p.locator !== 'section') {
      const head = p.text.slice(0, m.index);
      if (head.trim()) out.push({ ...p, text: head });
      break;
    }
    out.push(p);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const jl = p => readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const out = arg('out'); mkdirSync(out, { recursive: true });
  const trim = process.argv.includes('--trim-references');
  const records = arg('records') ? new Map(jl(arg('records')).map(r => [r.id, r])) : new Map();
  const bySource = new Map();
  for (const f of arg('pages').split(',')) for (const p of jl(f)) (bySource.get(p.source) || bySource.set(p.source, []).get(p.source)).push(p);
  const pages = [], sources = [];
  for (const [source, list] of [...bySource.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const kept = trim ? trimReferences(list) : [...list].sort((a, b) => a.page - b.page);
    const chars = list.reduce((n, p) => n + p.text.length, 0), keptChars = kept.reduce((n, p) => n + p.text.length, 0);
    pages.push(...kept);
    const r = records.get(source) || {};
    sources.push({ source, title: r.title || null, year: r.year || null, lang: r.lang || null, doi: r.doi || null, venue: r.venue || null,
      pages: list.length, pages_kept: kept.length, chars, chars_trimmed: chars - keptChars, locator: list[0]?.locator || 'page' });
  }
  writeFileSync(`${out}/pages.jsonl`, pages.map(p => JSON.stringify(p)).join('\n') + '\n');
  writeFileSync(`${out}/sources.json`, JSON.stringify(sources, null, 1));
  const total = sources.reduce((n, s) => n + s.chars, 0), trimmed = sources.reduce((n, s) => n + s.chars_trimmed, 0);
  console.log(JSON.stringify({ sources: sources.length, pages: pages.length, chars: total, chars_trimmed: trimmed }));
}
