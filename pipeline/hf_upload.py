#!/usr/bin/env python3
"""Upload a species corpus folder to a Hugging Face dataset repository (private by default), and write
the summary the site's Corpus page reads.

  HF_TOKEN=... python3 pipeline/hf_upload.py DIR OWNER/NAME [--site public/data/corpus.json] [--public] [--dry-run]

DIR is one species folder (its name becomes the folder in the repository), laid out as below. The
files are third-party abstracts and full text under many licences, so the repository is created
private; make it public only after checking that every file may be redistributed. The site summary
holds file names, counts and sizes only, never text.
"""
import hashlib, json, os, sys, fnmatch
from datetime import date

# What each part of a species folder holds. First matching pattern wins.
DESCRIBE = [
    ('intake/records.jsonl', 'Every paper found, merged across sources: title, abstract, authors, year, venue, language, DOI/PMID/PMCID, which sources found it, welfare topics, open-access links'),
    ('intake/status.json', 'What each source returned, or why it was not searched'),
    ('intake/summary.json', 'Counts by source, language, decade, topic and access'),
    ('intake/fetch.jsonl', 'For each paper we tried to download: how the full text was found, or why not'),
    ('intake/pdf/*', 'Open-access PDFs, named by record id'),
    ('intake/xml-pages.jsonl', 'Europe PMC full text, one "page" per article section'),
    ('intake/pages.jsonl', 'All intake full text as {source, page, locator, text}, ready for the extract stage'),
    ('intake/pdf-conversion-report.json', 'PDF to text conversion report'),
    ('first-run/source-pdfs/*', 'The Chinese papers the first run read, as supplied'),
    ('first-run/pages/pages-pymupdf.jsonl', 'Page text read from the PDF text layer'),
    ('first-run/pages/pages-hand-transcribed.jsonl', 'Pages transcribed by hand where the text layer was broken'),
    ('first-run/pages/pages-used-in-run.jsonl', 'The page text the run actually read (text layer, with hand transcriptions swapped in)'),
    ('first-run/pages/markdown/*', 'Each paper as Markdown with page markers'),
    ('first-run/pages/markdown-hand-transcribed/*', 'Hand-transcribed papers as Markdown'),
    ('first-run/pages/pdf-conversion-report.json', 'PDF to text conversion report'),
    ('first-run/extraction/1-extracted.jsonl', 'Claims as extracted: Chinese quote, page, English statement, intervention, quote check'),
    ('first-run/extraction/2-verified.jsonl', 'Plus the second model\'s verdict on whether the quote supports the statement'),
    ('first-run/extraction/3-mapped.jsonl', 'Plus the taxonomy labels: technology, welfare problem, kind, link to welfare, outcome evidence'),
    ('first-run/extraction/4-final.jsonl', 'The final claims the release was built from'),
    ('first-run/extraction/trial-runs/*', 'Earlier trial runs, kept for comparison'),
    ('first-run/model-calls/*', 'Every model call: model, tokens, cost, finish reason'),
    ('first-run/translation/english-statements.jsonl', 'Each Chinese quote beside its English statement'),
    ('first-run/suggestions.json', 'Draft suggested actions, not reviewed'),
    ('first-run/release.json', 'The release the public site shows'),
    ('first-run/sources-meta.json', 'Year and venue of each first-run paper'),
    ('gap-pilot/*/english-records.json', 'English papers found for each intervention, with the model\'s judgment'),
    ('gap-pilot/*/gap.json', 'Result per intervention: Chinese only, related English only, or both'),
    ('gap-pilot/*/judge-calls.jsonl', 'Every judging call'),
    ('gap-pilot/intervention-map.json', 'The 12 interventions and the search terms used for each'),
    ('ground-truth/*', 'No expert gold set yet; a non-expert spot-check of the gap pilot'),
    ('config/*', 'Model profile and species search terms used'),
    ('links.csv', 'Every link in one table: intake records, gap-pilot English papers and first-run papers'),
    ('MANIFEST.json', 'This list, with sizes, row counts and checksums'),
]
PARTS = {
    'intake': 'New search across Europe PMC, Crossref, DOAJ, OpenAlex and Semantic Scholar, with the open full text it could fetch',
    'first-run': 'The first run on 20 Chinese papers: source PDFs, page text, extraction, verification, mapping, English statements, model calls',
    'gap-pilot': 'Language-gap pilot: English evidence for each intervention found in Chinese',
    'ground-truth': 'Checked answers to score the pipeline against',
    'config': 'Settings',
}

CARD = """---
license: other
pretty_name: Myrias corpus
tags: [aquaculture, animal-welfare, fish, chinese]
---
# Myrias corpus

Source material and run outputs for [Myrias](https://github.com/invi-bhagyesh/myrias), an open,
bilingual, source-linked evidence base on welfare technology for farmed aquatic animals. One folder per
species; each has a `MANIFEST.json` describing every file.

**Private.** The files include third-party abstracts and full texts under many licences. Do not make
this repository public, or share files from it, until each licence has been checked.

| Folder | What it holds |
|---|---|
""" + ''.join(f'| `<species>/{k}/` | {v} |\n' for k, v in PARTS.items()) + """| `<species>/links.csv` | Every link in one table |

Built with `pipeline/intake.mjs`, `pipeline/normalize.py` and `pipeline/run.mjs`. Search and download
used no model; the first run's extraction, verification and mapping did, and every call is logged.
"""

def describe(rel):
    for pat, text in DESCRIBE:
        if fnmatch.fnmatch(rel, pat): return text
    return ''

def manifest(root):
    files = []
    for dirpath, _, names in os.walk(root):
        for n in sorted(names):
            p = os.path.join(dirpath, n); rel = os.path.relpath(p, root)
            if rel == 'MANIFEST.json': continue
            data = open(p, 'rb').read()
            rows = data.count(b'\n') if n.endswith('.jsonl') or n.endswith('.csv') else None
            files.append({'path': rel, 'bytes': len(data), 'rows': rows, 'sha256': hashlib.sha256(data).hexdigest(), 'about': describe(rel)})
    return sorted(files, key=lambda f: f['path'])

def site_summary(species, repo, private, files, root):
    # Folder tree with counts; leaf files only where a folder holds a few named files.
    tree = {}
    for f in files:
        parts = f['path'].split('/')
        d = '/'.join(parts[:-1])
        node = tree.setdefault(d, {'files': 0, 'bytes': 0, 'about': '', 'items': []})
        node['files'] += 1; node['bytes'] += f['bytes']
        node['items'].append({'name': parts[-1], 'bytes': f['bytes'], 'rows': f['rows'], 'about': f['about']})
    folders = []
    for d, node in sorted(tree.items()):
        many = node['files'] > 8
        folders.append({'path': d, 'files': node['files'], 'bytes': node['bytes'], 'about': node['items'][0]['about'] if many else '',
                        'items': [] if many else node['items']})
    j = lambda p: json.load(open(os.path.join(root, p))) if os.path.exists(os.path.join(root, p)) else {}
    intake = j('intake/summary.json')
    final = os.path.join(root, 'first-run/extraction/4-final.jsonl')
    headline = {
        'papers_found': intake.get('papers'), 'by_language': intake.get('by_language'), 'about_species_and_welfare': intake.get('about_species_and_welfare'),
        'full_text': sum(v for k, v in (intake.get('fetched') or {}).items() if k != 'not_fetched'),
        'sources': {k: v.get('status') for k, v in (intake.get('sources') or {}).items()},
        'first_run_papers': len([f for f in files if f['path'].startswith('first-run/source-pdfs/')]),
        'first_run_claims': sum(1 for _ in open(final)) if os.path.exists(final) else None,
        'links': next((f['rows'] - 1 for f in files if f['path'] == 'links.csv'), None),
        'files': len(files), 'bytes': sum(f['bytes'] for f in files),
    }
    return {'species': species, 'repo': repo, 'url': f'https://huggingface.co/datasets/{repo}', 'private': private, 'as_of': date.today().isoformat(),
            'parts': PARTS, 'headline': headline, 'folders': folders}

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    root, repo = os.path.normpath(args[0]), args[1]
    opt = lambda n: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else None
    species, private = os.path.basename(root), '--public' not in sys.argv
    files = manifest(root)
    json.dump({'species': species, 'files': files}, open(os.path.join(root, 'MANIFEST.json'), 'w'), indent=1, ensure_ascii=False)
    if opt('--site'):
        json.dump(site_summary(species, repo, private, files, root), open(opt('--site'), 'w'), indent=1, ensure_ascii=False)
    print(f'{len(files)} files, {sum(f["bytes"] for f in files) / 1e6:.1f} MB')
    if '--dry-run' in sys.argv: return
    from huggingface_hub import HfApi
    api = HfApi(token=os.environ['HF_TOKEN'])
    api.create_repo(repo, repo_type='dataset', private=private, exist_ok=True)
    api.upload_file(path_or_fileobj=CARD.encode(), path_in_repo='README.md', repo_id=repo, repo_type='dataset', commit_message='Dataset card')
    info = api.upload_folder(folder_path=root, path_in_repo=species, repo_id=repo, repo_type='dataset', commit_message=f'Upload {species} corpus')
    print(json.dumps({'repo': repo, 'private': private, 'folder': species, 'commit': str(info)}, indent=1))

if __name__ == '__main__':
    main()
