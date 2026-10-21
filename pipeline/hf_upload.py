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
    ('run-*/A/pages.jsonl', 'The pages this phase read: text layer with every hand transcription swapped in'),
    ('run-*/*/raw-claims.jsonl', 'Every claim as extracted, before overlapping windows were merged'),
    ('run-*/*/claims.jsonl', 'Claims after merging: Chinese record, quote, page, labels, quote check'),
    ('run-*/*/mapped.jsonl', 'Plus the taxonomy labels from the map stage'),
    ('run-*/*/verified.jsonl', 'Plus the verify verdict, for welfare-relevant claims'),
    ('run-*/*/final.jsonl', 'Plus the English rendering and its number check'),
    ('run-*/*/reconciled.jsonl', 'Plus one name per practice from the reconcile step; original wording kept'),
    ('run-*/*calls.jsonl', 'Every model call of that step: model, tokens, cost, finish reason'),
    ('run-*/*/*calls.jsonl', 'Every model call of that step: model, tokens, cost, finish reason'),
    ('run-*/*/tasks.jsonl', 'One line per text window: done, truncated or unparsed'),
    ('run-*/*/manifest.json', 'Settings and input hash the run was started with'),
    ('run-*/*/summary.json', 'Counts and cost of the extraction step'),
    ('run-*/*/*.log', 'Console output of each step'),
    ('run-*/release.json', 'The release built from this run, as the site shows it'),
    ('run-*/plan.json', 'The run plan and settings, with actual results'),
    ('run-*/release-findings-*.json', 'The released findings, split into files the site loads together'),
    ('run-*/release-actions.json', 'Draft actions with their priority score and the findings they rest on'),
    ('run-*/*/*/reconstruct.json', 'Reconstruction test: held-out claims, the answer for each grouping, and the scores'),
    ('run-*/*/*/findings-cache.json', 'Findings built for the reconstruction test only'),
    ('run-*/release-claims-*.json', 'The released claims, split into files the site loads together'),
    ('run-*/ledger.jsonl', 'One line per step of the run, in order: times, calls, cost, outputs'),
    ('run-*/*.sh', 'The script that ran the steps unattended'),
    ('run-*/*.log', 'Console output of the unattended run'),
    ('run-*/*/*/step.json', 'What this step did: times, command, git commit, every input and output with size, rows and checksum, models, calls, cost'),
    ('run-*/*/store-before-merge/*', 'The species store as it was before this phase merged into it, so the merge can be undone'),
    ('run-*/*/*/*calls.jsonl', 'Every model call of that step: model, tokens, cost, finish reason'),
    ('run-*/*/*/*.partial.jsonl', 'Results saved as they arrived, so a stopped step resumes'),
    ('run-*/*/*/*.log', 'Console output of the step'),
    ('run-*/*/*/pages.jsonl', 'The pages this phase read, with the reference sections trimmed'),
    ('run-*/*/*/sources.json', 'The papers this phase read: title, year, language, DOI, pages, characters trimmed'),
    ('run-*/*/*/raw-claims.jsonl', 'Every claim as extracted, before overlapping windows were merged'),
    ('run-*/*/*/claims.jsonl', 'Claims after merging: record, quote, page, labels, quote check'),
    ('run-*/*/*/mapped.jsonl', 'Plus the taxonomy labels from the map step'),
    ('run-*/*/*/verified.jsonl', 'Plus the verify verdict, for welfare-relevant claims'),
    ('run-*/*/*/final.jsonl', 'Plus the English rendering and its number check'),
    ('run-*/*/*/reconciled.jsonl', 'Plus one name per practice from the reconcile step; original wording kept'),
    ('run-*/*/*/*.json', 'Settings, counts and cost of the step'),
    ('findings-*.calls.jsonl', 'Every model call that wrote a finding: model, tokens, cost'),
    ('store/claims.jsonl', 'Every claim that has passed in any run, with a permanent id (C0001...), the run that added it and every run that found it again'),
    ('store/findings.jsonl', 'One finding per practice and welfare problem: its sentence in English and Chinese, counts, strength, and the claims it rests on; ids kept across runs'),
    ('store/practices.json', 'Claim id to practice after clustering and the model test; findings use this'),
    ('store/practices-exact.json', 'Claim id to practice as the claims name it (for the reconstruction test)'),
    ('store/practices-embed.json', 'Claim id to practice from embedding clusters alone (for the reconstruction test)'),
    ('store/practice-clusters.json', 'Every practice cluster: members, what the model test dropped and why'),
    ('store/practice-embeddings.json', 'Embedding of each practice name with its claims (qwen3-embedding-8b)'),
    ('store/sources.json', 'Every paper with claims, with a permanent id (S001...)'),
    ('store/runs.json', 'One line per merge: claims in, added, already present, papers added'),
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
    'run-2': 'Run 2: phase A re-read the Chinese papers with the current extraction; phase B read the 176 open-access papers. Each step has a numbered folder with its record',
    'store': 'The species store: every claim that has passed in any run, merged, with permanent ids',
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
            if rel == 'MANIFEST.json' or n.lower().endswith('.pdf'): continue
            data = open(p, 'rb').read()
            rows = data.count(b'\n') if n.endswith('.jsonl') or n.endswith('.csv') else None
            files.append({'path': rel, 'bytes': len(data), 'rows': rows, 'sha256': hashlib.sha256(data).hexdigest(), 'about': describe(rel)})
    return sorted(files, key=lambda f: f['path'])

# The public site shows no spending: cost is dropped from the file descriptions it gets.
def public_about(text):
    t = re.sub(r'([Cc])ounts and cost\b', r'\1ounts', text or '')
    return re.sub(r'(,\s*|\s+and\s+)cost\b', '', t)

def site_summary(species, repo, private, files, root):
    # Folder tree with counts; leaf files only where a folder holds a few named files.
    tree = {}
    for f in files:
        parts = f['path'].split('/')
        d = '/'.join(parts[:-1])
        node = tree.setdefault(d, {'files': 0, 'bytes': 0, 'about': '', 'items': []})
        node['files'] += 1; node['bytes'] += f['bytes']
        node['items'].append({'name': parts[-1], 'bytes': f['bytes'], 'rows': f['rows'], 'about': public_about(f['about'])})
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
            'parts': PARTS, 'headline': headline, 'charts': charts(root), 'folders': folders}

def charts(root):
    # Counts for the Corpus page charts, from the intake records. Counts only, never text.
    path = os.path.join(root, 'intake/records.jsonl')
    if not os.path.exists(path): return None
    recs = [json.loads(l) for l in open(path) if l.strip()]
    fetch_path = os.path.join(root, 'intake/fetch.jsonl')
    via = {f['id']: f.get('via') for f in (json.loads(l) for l in open(fetch_path) if l.strip())} if os.path.exists(fetch_path) else {}
    langs = ['en', 'zh']
    by_lang = lambda rows: {l: sum(1 for r in rows if r['lang'] == l) for l in langs}
    about = [r for r in recs if r.get('species_in_title') and r.get('welfare_relevant')]
    full = [r for r in about if via.get(r['id'])]
    stages = [
        {'id': 'found', 'n': len(recs), 'by_lang': by_lang(recs)},
        {'id': 'about', 'n': len(about), 'by_lang': by_lang(about)},
        {'id': 'tried', 'n': sum(1 for r in about if r['id'] in via), 'by_lang': by_lang([r for r in about if r['id'] in via])},
        {'id': 'full_text', 'n': len(full), 'by_lang': by_lang(full),
         'by_route': {k: sum(1 for r in full if via.get(r['id']) == k) for k in sorted({v for v in via.values() if v})}},
    ]
    sources = {}
    for r in recs:
        for s in r['sources']:
            e = sources.setdefault(s, {'papers': 0, 'only_here': 0, 'zh': 0})
            e['papers'] += 1; e['zh'] += r['lang'] == 'zh'; e['only_here'] += len(r['sources']) == 1
    topics = {}
    for r in about:
        for t in r.get('topics', []):
            topics.setdefault(t, {l: 0 for l in langs})[r['lang']] += 1
    decades = {}
    for r in recs:
        d = f"{(r['year'] // 10) * 10}s" if r.get('year') else 'unknown'
        decades.setdefault(d, {l: 0 for l in langs})[r['lang']] += 1
    return {'stages': stages, 'sources': sources, 'topics': dict(sorted(topics.items(), key=lambda kv: -sum(kv[1].values()))),
            'decades': dict(sorted(decades.items()))}

import re
# Titles fetched before the intake fix carry the remains of escaped tags: "( i Siniperca chuatsi /i )".
def clean_title(t):
    t = str(t or '')
    if re.search(r'(^|\s)/(i|sub|sup|b)(\s|\)|$)', t):
        t = re.sub(r'(?:(?<=\s)|(?<=\()|^)/?(?:i|sub|sup|b)(?=\s|\)|$)', '', t)
        t = re.sub(r'\(\s+', '(', re.sub(r'\s+\)', ')', re.sub(r'\s{2,}', ' ', t))).strip()
    return t

def catalog(root):
    # Every paper's bibliographic details for the Corpus page: no abstracts, no text.
    out = []
    path = os.path.join(root, 'intake/records.jsonl')
    fetch = {}
    fp = os.path.join(root, 'intake/fetch.jsonl')
    if os.path.exists(fp):
        for l in open(fp):
            if l.strip(): f = json.loads(l); fetch[f['id']] = f
    def why(f):
        if not f: return None
        if f.get('via'): return None
        t = ' '.join(f.get('tried') or [])
        if not t: return 'no_link'
        if 'paywall' in t or 'login' in t or 'not a PDF' in t: return 'paywall'
        if 'HTTP 403' in t or 'HTTP 401' in t: return 'refused'
        if 'no PDF link' in t: return 'no_pdf_link'
        if any(k in t for k in ('HTTP 429', 'HTTP 503', 'HTTP 418', 'timeout', 'fetch failed', 'HTTP 500')): return 'retry_later'
        if 'HTTP 404' in t: return 'broken_link'
        return 'failed'
    if os.path.exists(path):
        for l in open(path):
            if not l.strip(): continue
            r = json.loads(l); f = fetch.get(r['id'])
            file = f"intake/pdf/{r['id']}.pdf" if f and f.get('via') in ('pdf', 'landing_meta') else 'intake/xml-pages.jsonl' if f and f.get('via') == 'europepmc_xml' else None
            out.append({'id': r['id'], 'set': 'intake', 'title': clean_title(r.get('title')), 'year': r.get('year'), 'venue': r.get('venue'), 'lang': r.get('lang'),
                        'authors': (r.get('authors') or [])[:8], 'doi': r.get('doi'), 'pmid': r.get('pmid'), 'pmcid': r.get('pmcid'), 'type': r.get('type'),
                        'sources': r.get('sources'), 'topics': r.get('topics'), 'about': bool(r.get('species_in_title') and r.get('welfare_relevant')),
                        'landing': (r.get('oa') or {}).get('landing'), 'pdf_url': (r.get('oa') or {}).get('pdf'),
                        'full_text': (f or {}).get('via'), 'tried': bool(f), 'why_not': why(f), 'file': file})
    meta = os.path.join(root, 'first-run/sources-meta.json')
    pdfs = sorted(os.listdir(os.path.join(root, 'first-run/source-pdfs'))) if os.path.isdir(os.path.join(root, 'first-run/source-pdfs')) else []
    m = json.load(open(meta)) if os.path.exists(meta) else {}
    for i, name in enumerate(pdfs):
        title = name.rsplit('_', 1)[0] if '_' in name else name.removesuffix('.pdf')
        info = next((v for k, v in m.items() if not k.startswith('_') and (k in title or title in k)), {})
        out.append({'id': f'F{i + 1:02d}', 'set': 'first-run', 'title': title, 'year': info.get('year'), 'venue': info.get('venue'), 'lang': 'zh',
                    'authors': [name.rsplit('_', 1)[1].removesuffix('.pdf')] if '_' in name else [], 'sources': ['supplied'], 'topics': [], 'about': True,
                    'full_text': 'supplied_pdf', 'tried': True, 'why_not': None, 'file': f'first-run/source-pdfs/{name}', 'in_release': bool(info)})
    return out

# Column format for the site: one list of field names, then one short row per paper, empty values
# dropped to null and links the site can rebuild (a DOI's own URL) left out. Keeps the file small.
FIELDS = ['id', 'set', 'title', 'year', 'venue', 'lang', 'authors', 'doi', 'pmid', 'pmcid', 'sources', 'topics', 'about', 'landing', 'pdf_url', 'full_text', 'tried', 'why_not', 'file']
def pack(papers):
    rows = []
    for p in papers:
        p = dict(p)
        p['authors'] = (p.get('authors') or [])[:4]
        if p.get('doi') and p.get('landing') and p['doi'].lower() in str(p['landing']).lower(): p['landing'] = None
        if p.get('file') == 'intake/xml-pages.jsonl': p['file'] = 'x'
        rows.append([p.get(k) if p.get(k) not in ('', [], None) else None for k in FIELDS])
    return {'fields': FIELDS, 'rows': rows}

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    root, repo = os.path.normpath(args[0]), args[1]
    opt = lambda n: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else None
    species, private = os.path.basename(root), '--public' not in sys.argv
    files = manifest(root)
    json.dump({'species': species, 'files': files}, open(os.path.join(root, 'MANIFEST.json'), 'w'), indent=1, ensure_ascii=False)
    if opt('--site'):
        json.dump(site_summary(species, repo, private, files, root), open(opt('--site'), 'w'), indent=1, ensure_ascii=False)
        # The paper list in chunks of 700, each well under the site's 400 KB file limit.
        site_dir, papers = os.path.dirname(opt('--site')), catalog(root)
        for old in [f for f in os.listdir(site_dir) if f.startswith('corpus-papers')]: os.remove(os.path.join(site_dir, old))
        names = []
        for i in range(0, len(papers), 700):
            names.append(f'corpus-papers-{i // 700}.json')
            json.dump(pack(papers[i:i + 700]), open(os.path.join(site_dir, names[-1]), 'w'), ensure_ascii=False, separators=(',', ':'))
        summary = json.load(open(opt('--site'))); summary['paper_files'] = names
        json.dump(summary, open(opt('--site'), 'w'), indent=1, ensure_ascii=False)
    print(f'{len(files)} files, {sum(f["bytes"] for f in files) / 1e6:.1f} MB')
    if '--dry-run' in sys.argv: return
    from huggingface_hub import HfApi
    api = HfApi(token=os.environ['HF_TOKEN'])
    api.create_repo(repo, repo_type='dataset', private=private, exist_ok=True)
    api.upload_file(path_or_fileobj=CARD.encode(), path_in_repo='README.md', repo_id=repo, repo_type='dataset', commit_message='Dataset card')
    # PDFs live once, in the dataset's top-level raw/ folder (pipeline/organize_raw.py), not in the species folder.
    info = api.upload_folder(folder_path=root, path_in_repo=species, repo_id=repo, repo_type='dataset', commit_message=f'Upload {species} corpus', ignore_patterns=['*.pdf'])
    print(json.dumps({'repo': repo, 'private': private, 'folder': species, 'commit': str(info)}, indent=1))

if __name__ == '__main__':
    main()
