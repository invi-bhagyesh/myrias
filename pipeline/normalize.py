#!/usr/bin/env python3
"""Normalize stage: PDFs -> canonical Markdown with page anchors, plus a conversion report.

  python3 -I pipeline/normalize.py SRC_DIR OUT_DIR

Needs PyMuPDF (`pip install pymupdf`). Output must stay outside the repository (licensed text).
Each source becomes OUT_DIR/<id>.md with a `<!-- page N -->` line before every page, OUT_DIR/pages.jsonl
({"source","page","text"} for the extract stage) and OUT_DIR/report.json. The text is NOT repaired:
the report counts known glitches so they are visible, and the quote check normalises them.
"""
import glob, hashlib, json, os, re, sys
import pymupdf

GLITCHES = {"full_stop_glyph": "⒚"}

def cjk_ratio(t):
    letters = [c for c in t if c.strip()]
    return round(sum('一' <= c <= '鿿' for c in letters) / len(letters), 3) if letters else 0.0

def main(src, out):
    os.makedirs(out, exist_ok=True)
    report, rows = [], []
    for path in sorted(glob.glob(os.path.join(src, "*.pdf"))):
        name = os.path.basename(path)
        sid = hashlib.sha1(name.encode()).hexdigest()[:10]
        entry = {"source": name, "id": sid, "pages": 0, "empty_pages": [], "chars": 0, "cjk_ratio": 0.0, "glitches": {}, "status": "ok"}
        try:
            doc = pymupdf.open(path)
        except Exception as e:
            entry["status"] = f"unreadable: {e}"; report.append(entry); continue
        md, alltext = [f"<!-- source: {name} -->"], ""
        for i, pg in enumerate(doc, 1):
            text = re.sub(r"[ \t]+\n", "\n", pg.get_text().strip())
            entry["pages"] += 1
            if len(text) < 50:
                entry["empty_pages"].append(i)
            md.append(f"\n<!-- page {i} -->\n{text}")
            alltext += text
            if text:
                rows.append({"source": name, "page": i, "text": text})
        entry["chars"] = len(alltext); entry["cjk_ratio"] = cjk_ratio(alltext)
        entry["glitches"] = {k: alltext.count(v) for k, v in GLITCHES.items() if alltext.count(v)}
        if entry["pages"] and len(entry["empty_pages"]) / entry["pages"] > 0.5:
            entry["status"] = "needs_ocr"
        open(os.path.join(out, sid + ".md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
        report.append(entry)
    with open(os.path.join(out, "pages.jsonl"), "w", encoding="utf-8") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    json.dump(report, open(os.path.join(out, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(report)} sources, {len(rows)} pages; needs_ocr: {[r['source'] for r in report if r['status'] == 'needs_ocr']}")

if __name__ == "__main__":
    if len(sys.argv) != 3: sys.exit(__doc__)
    main(*sys.argv[1:])
