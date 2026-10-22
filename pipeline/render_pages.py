#!/usr/bin/env python3
"""Render PDF pages to PNG images for the OCR stage.

  python3 pipeline/render_pages.py PDF_DIR LIST.txt OUT_DIR [--dpi 150]

LIST.txt names one PDF per line (file names inside PDF_DIR). Writes OUT_DIR/<pdf name>/<page>.png, one per
page, numbered from 1 like the page text, and skips images that already exist.
"""
import os, sys
import pymupdf


def main(pdf_dir, listing, out, dpi=150):
    names = [l.strip() for l in open(listing, encoding='utf-8') if l.strip()]
    pages = 0
    for name in names:
        d = pymupdf.open(os.path.join(pdf_dir, name))
        target = os.path.join(out, name)
        os.makedirs(target, exist_ok=True)
        for i, page in enumerate(d, start=1):
            p = os.path.join(target, f'{i}.png')
            if not os.path.exists(p): page.get_pixmap(dpi=dpi).save(p)
            pages += 1
    print({'pdfs': len(names), 'pages': pages})


if __name__ == '__main__':
    a = sys.argv[1:]
    dpi = int(a[a.index('--dpi') + 1]) if '--dpi' in a else 150
    if '--dpi' in a: del a[a.index('--dpi'):a.index('--dpi') + 2]
    if len(a) != 3: sys.exit(__doc__)
    main(*a, dpi=dpi)
