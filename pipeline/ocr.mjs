// OCR stage: page image -> faithful text. Used for PDFs whose text layer is missing or damaged
// (no digits, one character per line, junk glyphs).
//   node pipeline/ocr.mjs --images DIR --out ocr-pages.jsonl [--concurrency 12] [--log FILE]
// DIR holds one folder per PDF with one PNG per page (pipeline/render_pages.py). Writes one line per page,
// {source, page, text, ocr: {model}}, appending as each page returns, so a stopped run resumes where it left off.
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from './llm.mjs';

export const OCR_SYSTEM = `You transcribe one page of a scanned Chinese or English journal article.
Copy the text exactly as printed: keep every digit, unit, symbol, Latin name and punctuation mark. Do not translate, correct, summarise or add anything. Keep paragraph breaks. Write tables as Markdown tables. Skip running headers, page numbers and watermarks. Output only the transcription.`;
export const OCR_USER = 'Transcribe this page.';

export const imageUrl = path => `data:image/png;base64,${readFileSync(path).toString('base64')}`;

export async function ocrPage(client, path, model) {
  const r = await client.call('ocr', { system: OCR_SYSTEM, user: OCR_USER, images: [imageUrl(path)], model });
  return { text: r.text.trim(), entry: r.entry };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const dir = arg('images'), out = arg('out');
  const done = new Set(existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.source}|${r.page}`; }) : []);
  const todo = readdirSync(dir).flatMap(src => readdirSync(join(dir, src)).filter(f => f.endsWith('.png')).map(f => ({ src, page: Number(f.slice(0, -4)), path: join(dir, src, f) })))
    .filter(t => !done.has(`${t.src}|${t.page}`)).sort((a, b) => a.src.localeCompare(b.src) || a.page - b.page);
  const client = createClient({ logPath: arg('log', `${out}.calls.jsonl`) });
  let n = 0, failed = 0;
  await Promise.all(Array.from({ length: Number(arg('concurrency', 12)) }, async () => {
    while (todo.length) {
      const t = todo.shift();
      try {
        const r = await ocrPage(client, t.path);
        appendFileSync(out, JSON.stringify({ source: t.src, page: t.page, text: r.text, ocr: { model: r.entry.model } }) + '\n');
        if (++n % 50 === 0) console.error(`ocr: ${n} pages, ${todo.length} left`);
      } catch (e) { failed++; console.error(`ocr: ${t.src} p${t.page}: ${e.message}`); }
    }
  }));
  console.log({ pages: n, already_done: done.size, failed, spent_usd: client.spent });
}
