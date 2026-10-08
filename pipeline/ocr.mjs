// OCR stage: page image -> faithful text. Used for PDFs whose text layer is missing or damaged
// (no digits, one character per line). Compare candidate models with pipeline/ocr-compare.mjs first.
import { readFileSync } from 'node:fs';

export const OCR_SYSTEM = `You transcribe one page of a scanned Chinese or English journal article.
Copy the text exactly as printed: keep every digit, unit, symbol, Latin name and punctuation mark. Do not translate, correct, summarise or add anything. Keep paragraph breaks. Write tables as Markdown tables. Skip running headers, page numbers and watermarks. Output only the transcription.`;
export const OCR_USER = 'Transcribe this page.';

export const imageUrl = path => `data:image/png;base64,${readFileSync(path).toString('base64')}`;

export async function ocrPage(client, path, model) {
  const r = await client.call('ocr', { system: OCR_SYSTEM, user: OCR_USER, images: [imageUrl(path)], maxTokens: 6000, model });
  return { text: r.text.trim(), entry: r.entry };
}
