#!/usr/bin/env python3
"""Inputs for a run over a supplied batch: which papers need OCR, the page text to read, and paper records.

  python3 pipeline/batch_inputs.py ocr-list  RAW_INDEX.json NORM_PAGES.jsonl ORIGIN OUT.txt
  python3 pipeline/batch_inputs.py build     RAW_INDEX.json NORM_PAGES.jsonl ORIGIN OUT_DIR [--ocr OCR_PAGES.jsonl]

RAW_INDEX is raw/index.json (pipeline/organize_raw.py). Papers come from ORIGIN (e.g. cnki-batch-2026-10-20) and
are left out if the pipeline has read them already (source_id set). ocr-list names the papers whose text layer
is damaged (more than 5% junk characters: control, private-use or replacement glyphs) or nearly empty, or that
the index marks as needing OCR. build writes OUT_DIR/pages.jsonl (OCR text where a paper was OCR'd, the text
layer otherwise) and OUT_DIR/records.jsonl (one record per paper, id = file name, as merge.mjs reads them).
"""
import json, re, sys, collections

BAD = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f-�]')


def papers(index, origin):
    return {r['path'].rsplit('/', 1)[-1]: r for r in json.load(open(index, encoding='utf-8')) if origin in (r['origin'] or '') and not r['source_id']}


def text_by_source(pages):
    t, n = collections.defaultdict(str), collections.Counter()
    for l in open(pages, encoding='utf-8'):
        if l.strip(): p = json.loads(l); t[p['source']] += p['text']; n[p['source']] += 1
    return t, n


def damaged(text, pages):
    return len(BAD.findall(text)) / max(1, len(text)) > 0.05 or len(text) < 60 * max(1, pages)


def main():
    cmd, index, norm, origin, out = sys.argv[1:6]
    want = papers(index, origin)
    text, count = text_by_source(norm)
    if cmd == 'ocr-list':
        sel = sorted(s for s, r in want.items() if r['text'] != 'ok' or s not in text or damaged(text[s], count[s]))
        open(out, 'w', encoding='utf-8').write('\n'.join(sel) + '\n')
        print({'papers': len(want), 'ocr': len(sel), 'pages': sum(count[s] or (want[s]['pages'] or 0) for s in sel)})
        return
    ocr = sys.argv[sys.argv.index('--ocr') + 1] if '--ocr' in sys.argv else None
    ocr_pages = collections.defaultdict(list)
    if ocr:
        for l in open(ocr, encoding='utf-8'):
            if l.strip(): p = json.loads(l); ocr_pages[p['source']].append(p)
    n_ocr = 0
    with open(f'{out}/pages.jsonl', 'w', encoding='utf-8') as f:
        for l in open(norm, encoding='utf-8'):
            if not l.strip(): continue
            p = json.loads(l)
            if p['source'] in want and p['source'] not in ocr_pages: f.write(json.dumps(p, ensure_ascii=False) + '\n')
        for s, ps in ocr_pages.items():
            if s not in want: continue
            n_ocr += 1
            for p in sorted(ps, key=lambda p: p['page']):
                f.write(json.dumps({'source': s, 'page': p['page'], 'text': p['text'], 'ocr': p.get('ocr')}, ensure_ascii=False) + '\n')
    with open(f'{out}/records.jsonl', 'w', encoding='utf-8') as f:
        for s, r in sorted(want.items()):
            f.write(json.dumps({'id': s, 'title': r['title'], 'title_en': r.get('title_en'), 'authors': [r['first_author']] if r.get('first_author') else [],
                                'year': r.get('year'), 'lang': r.get('lang') or 'zh', 'venue': r.get('journal'), 'doi': r.get('doi'), 'type': r.get('type'),
                                'topic_en': r.get('topic_en'), 'relevance': r.get('relevance'), 'raw_path': r['path']}, ensure_ascii=False) + '\n')
    print({'papers': len(want), 'from_ocr': n_ocr, 'from_text_layer': len([s for s in want if s in text and s not in ocr_pages]), 'no_text': len([s for s in want if s not in text and s not in ocr_pages])})


if __name__ == '__main__':
    main()
