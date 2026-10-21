#!/usr/bin/env python3
"""Gather every PDF for one species into one organised folder, raw/, with an index, ready to upload to the
corpus dataset on Hugging Face.

  python3 pipeline/organize_raw.py SPECIES_DIR OUT_DIR [--batch DIR --batch-index FILE.xlsx --batch-name NAME]...

SPECIES_DIR is the species corpus folder (intake/pdf, first-run/source-pdfs, store/sources.json, intake/records.jsonl).
Each --batch is a folder of supplied PDFs with its spreadsheet index (columns as in the 2026-10-20 batch:
English file name, English title, Author (pinyin), 中文文件名, 相关性, 主题, 年份, 第一作者, 标题, 来源, 类型, 物种,
要点, 关键数据, 原文件名).

Writes OUT_DIR/raw/<species>/{zh,en}/<file>.pdf, OUT_DIR/raw/index.csv and index.json (one row per PDF), the
batch spreadsheets as supplied, and a README. Identical files (same SHA-256), and a paper held in two collections under the same
title, are kept once; the index records every origin of the copy it keeps. Files are named
year_author_title, ASCII where an English title exists; supplied batches keep their own names.
"""
import csv, hashlib, json, os, re, shutil, sys
import pymupdf as fitz  # PyMuPDF, for page counts and whether the text layer is readable

TOPIC_EN = {'开口期与早期饵料': 'First feeding and early feeds', '驯化方法与成功率': 'Feed-training methods and success',
            '驯化机理与选育': 'Training mechanisms and breeding', '产业规模与经济': 'Industry and economics',
            '福利相关养殖管理': 'Welfare-related farm management', '养成期营养与饲料': 'Grow-out nutrition and feed',
            '品质与生理对比': 'Quality and physiology', '斑鳜常规养殖': 'Spotted mandarin fish farming',
            '鳜常规养殖与模式': 'General farming and models', '无关': 'Unrelated'}
TYPE_EN = {'实验研究': 'experiment', '技术推广文章': 'extension article', '生产试验': 'production trial', '学位论文': 'thesis',
           '综述': 'review', '新闻报道': 'news', '会议报道': 'conference report', '企业宣传': 'company material', '无关': 'unrelated'}
COLS = ['path', 'lang', 'year', 'first_author', 'title', 'title_en', 'journal', 'type', 'topic', 'topic_en', 'relevance', 'species',
        'origin', 'doi', 'record_id', 'source_id', 'pages', 'text', 'bytes', 'sha256', 'old_paths', 'key_points', 'key_data']


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def slug(s, n=90):
    s = re.sub(r'[\\/:*?"<>|\n\r\t]+', ' ', str(s or '')).strip()
    s = re.sub(r'\s+', ' ', s)
    return s[:n].rstrip(' .') or 'untitled'


def norm_title(s):
    return re.sub(r'\W', '', str(s or '')).lower()


def pdf_info(p):
    try:
        d = fitz.open(p)
        text = ''.join(pg.get_text() for pg in d)
        return d.page_count, 'ok' if len(text.strip()) > 200 * max(1, d.page_count) * 0.2 else 'needs_ocr'
    except Exception:
        return None, 'unreadable'


def main():
    args = sys.argv[1:]
    species_dir, out = args[0], args[1]
    batches, i = [], 2
    while i < len(args):
        if args[i] == '--batch': batches.append({'dir': args[i + 1]}); i += 2
        elif args[i] == '--batch-index': batches[-1]['index'] = args[i + 1]; i += 2
        elif args[i] == '--batch-name': batches[-1]['name'] = args[i + 1]; i += 2
        else: sys.exit(f'unknown argument {args[i]}')
    species = os.path.basename(os.path.normpath(species_dir))
    store = json.load(open(os.path.join(species_dir, 'store', 'sources.json')))
    records = {}
    for l in open(os.path.join(species_dir, 'intake', 'records.jsonl')):
        if l.strip(): r = json.loads(l); records[r['id']] = r
    by_record = {v.get('record_id') or k: v for k, v in store.items()}
    rows = []  # candidate rows, each with 'src' (where the file is now)

    # Supplied batches: their own index is the richest metadata, so they come first.
    for b in batches:
        import openpyxl
        ws = openpyxl.load_workbook(b['index'], read_only=True).worksheets[0]
        it = ws.iter_rows(values_only=True); head = next(it)
        for vals in it:
            x = dict(zip(head, vals))
            if not x.get('English file name'): continue
            src = os.path.join(b['dir'], x['English file name'])
            if not os.path.exists(src): continue
            y = str(x.get('年份') or '')
            rows.append({'src': src, 'name': x['English file name'], 'lang': 'zh', 'year': int(y[:4]) if y[:4].isdigit() else None,
                         'first_author': x.get('第一作者'), 'title': x.get('标题'), 'title_en': x.get('English title'), 'journal': x.get('来源'),
                         'type': TYPE_EN.get(x.get('类型'), x.get('类型')), 'topic': x.get('主题'), 'topic_en': TOPIC_EN.get(x.get('主题'), x.get('主题')),
                         'relevance': x.get('相关性'), 'species': x.get('物种'), 'origin': b['name'], 'old': f"{b['name']}/{x['English file name']}",
                         'key_points': x.get('要点'), 'key_data': x.get('关键数据'), 'orig_name': x.get('原文件名')})

    # The Chinese papers the first run read, as supplied.
    fr = os.path.join(species_dir, 'first-run', 'source-pdfs')
    for f in sorted(os.listdir(fr)) if os.path.isdir(fr) else []:
        s = store.get(f, {})
        title = s.get('title') or f.rsplit('_', 1)[0]
        author = (s.get('authors') or [f.rsplit('_', 1)[-1].replace('.pdf', '')])[0]
        rows.append({'src': os.path.join(fr, f), 'name': f"{s.get('year') or 'n.d.'}_{slug(author, 20)}_{slug(title, 60)}.pdf", 'lang': 'zh', 'year': s.get('year'),
                     'first_author': author, 'title': title, 'journal': s.get('venue'), 'origin': 'first-run (supplied)', 'source_id': s.get('id'),
                     'old': f'{species}/first-run/source-pdfs/{f}', 'orig_name': f})

    # Open-access PDFs the intake downloaded, named by record id.
    ip = os.path.join(species_dir, 'intake', 'pdf')
    for f in sorted(os.listdir(ip)) if os.path.isdir(ip) else []:
        rid = f[:-4]; r = records.get(rid, {}); s = by_record.get(rid, {})
        author = (r.get('authors') or ['anon'])[0]
        last = re.sub(r'[^A-Za-z-]', '', author.split()[0] if ' ' in author else author) or 'anon'
        rows.append({'src': os.path.join(ip, f), 'name': f"{r.get('year') or 'n.d.'}_{last}_{slug(r.get('title'), 80)}.pdf", 'lang': r.get('lang') or 'en',
                     'year': r.get('year'), 'first_author': author, 'title': r.get('title'), 'title_en': r.get('title') if r.get('lang') == 'en' else None,
                     'journal': r.get('venue'), 'type': r.get('type'), 'origin': 'open-access intake', 'doi': r.get('doi'), 'record_id': rid,
                     'source_id': s.get('id'), 'old': f'{species}/intake/pdf/{f}'})

    # Keep each paper once: same bytes, or the same title (the first run's PDFs reappear in the batch).
    kept, by_sha, by_title = [], {}, {}
    for r in rows:
        r['sha256'] = sha(r['src'])
        # A title match merges only across collections: within one batch, the same title is often a different
        # article (another author or journal reprinting the topic).
        tt = by_title.get(norm_title(r['title']))
        twin = by_sha.get(r['sha256']) or (tt if tt is not None and r['origin'] not in tt['origin'] else None)
        if twin is not None:
            for k in ('source_id', 'record_id', 'doi', 'journal', 'year'):
                if not twin.get(k) and r.get(k): twin[k] = r[k]
            twin['origin'] += '; ' + r['origin']; twin['old'] += '; ' + r['old']
            continue
        by_sha[r['sha256']] = r
        if norm_title(r['title']): by_title[norm_title(r['title'])] = r
        kept.append(r)
    # Batch papers the store already holds under the first run's file name.
    for r in kept:
        if not r.get('source_id') and r.get('orig_name') in store: r['source_id'] = store[r['orig_name']]['id']

    root = os.path.join(out, 'raw'); used = set()
    for r in kept:
        sub = os.path.join(species, r['lang'] if r['lang'] in ('zh', 'en') else 'other')
        name = r['name']
        while os.path.join(sub, name) in used: name = name[:-4] + '_2.pdf'
        r['path'] = os.path.join(sub, name); used.add(r['path'])
        os.makedirs(os.path.join(root, sub), exist_ok=True)
        shutil.copy2(r['src'], os.path.join(root, r['path']))
        r['bytes'] = os.path.getsize(r['src']); r['pages'], r['text'] = pdf_info(r['src']); r['old_paths'] = r.pop('old')
    for b in batches:
        os.makedirs(os.path.join(root, 'batch-indexes'), exist_ok=True)
        shutil.copy2(b['index'], os.path.join(root, 'batch-indexes', f"{b['name']}.xlsx"))
    kept.sort(key=lambda r: (r['lang'], r.get('year') or 0, r['path']))
    with open(os.path.join(root, 'index.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction='ignore'); w.writeheader(); w.writerows(kept)
    json.dump([{k: r.get(k) for k in COLS} for r in kept], open(os.path.join(root, 'index.json'), 'w'), ensure_ascii=False, indent=1)
    n = lambda f: sum(1 for r in kept if f(r))
    print(json.dumps({'candidates': len(rows), 'kept': len(kept), 'duplicates': len(rows) - len(kept), 'zh': n(lambda r: r['lang'] == 'zh'),
                      'en': n(lambda r: r['lang'] == 'en'), 'needs_ocr': n(lambda r: r['text'] != 'ok'), 'read_by_pipeline': n(lambda r: r.get('source_id')),
                      'bytes': sum(r['bytes'] for r in kept)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
