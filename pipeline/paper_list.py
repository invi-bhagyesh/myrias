#!/usr/bin/env python3
"""The paper list the Corpus page shows: every paper retrieved for every species, how far it got and why.

  python3 pipeline/paper_list.py public/data SPECIES_DIR[,SPECIES_DIR...] [--raw-index raw/index.json]

For each species folder (intake/records.jsonl, intake/fetch.jsonl, store/sources.json, store/paper-meta.json) every
paper the search found gets one row, and so does every supplied paper in the raw index under raw/<species>/. A row
says how far the paper got, so anyone can audit what was left out:
  screened_out    the species is not named in the title, or no welfare topic matched (why_out says which)
  no_full_text    passed the screen, but no open full text could be fetched (why_not says why)
  read_no_claims  read, but no claim passed the checks
  read            read, with claims in the release (source_id links to the paper's page; claims counts them)
Supplied papers are always read (scans through OCR), so they are read or read_no_claims.
plus its links (DOI, PubMed, publisher page, open PDF) and, for papers read, the first author's institution.
Writes public/data/corpus-papers-N.json (column format, under the site's 400 KB file limit) and lists them in
corpus.json. Bibliographic details only: no abstracts or text.
"""
import json, os, re, sys, glob, collections

FIELDS = ['id', 'species', 'set', 'title', 'year', 'venue', 'lang', 'authors', 'doi', 'pmid', 'pmcid', 'sources', 'topics', 'about', 'landing', 'pdf_url',
          'full_text', 'tried', 'why_not', 'file', 'stage', 'why_out', 'source_id', 'claims', 'institution', 'inst_group', 'title_en']


def jl(p):
    return [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()] if os.path.exists(p) else []


def js(p, d=None):
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d


def why_not(f):
    if not f or f.get('via'): return None
    t = ' '.join(f.get('tried') or [])
    if not t: return 'no_link'
    if 'paywall' in t or 'login' in t or 'not a PDF' in t: return 'paywall'
    if 'HTTP 403' in t or 'HTTP 401' in t: return 'refused'
    if 'no PDF link' in t: return 'no_pdf_link'
    if any(k in t for k in ('HTTP 429', 'HTTP 503', 'HTTP 418', 'timeout', 'fetch failed', 'HTTP 500')): return 'retry_later'
    if 'HTTP 404' in t: return 'broken_link'
    return 'failed'


def clean_title(t):
    # Italics markers some indexes leave behind: "( i Siniperca chuatsi /i )" -> "(Siniperca chuatsi)".
    t = re.sub(r'(?<![A-Za-z])i\s+([^/]{1,80}?)\s*/i(?![A-Za-z])', r'\1', str(t or ''))
    return re.sub(r'\(\s+', '(', re.sub(r'\s+\)', ')', re.sub(r'\s+', ' ', t))).strip()


def inst(meta):
    """First author's institution and its group, from paper-meta.json (pipeline/affiliations.mjs)."""
    if not meta: return None, None
    fa, insts = meta.get('first_author', -1), meta.get('institutions') or []
    i = insts[fa] if 0 <= fa < len(insts) else None
    if not i: return None, 'unknown'
    c, sec = str(i.get('country') or '').upper(), i.get('sector')
    g = ('cn_university' if sec == 'university' else 'cn_company' if sec == 'company' else 'cn_institute' if sec in ('research_institute', 'government') else 'cn_other') if c == 'CN' else c or 'unknown'
    return i.get('name'), g


def species_rows(sdir, claims_by_source, raw_rows):
    species = os.path.basename(os.path.normpath(sdir))
    recs, fetch = jl(f'{sdir}/intake/records.jsonl'), {f['id']: f for f in jl(f'{sdir}/intake/fetch.jsonl')}
    sources = js(f'{sdir}/store/sources.json', {})
    meta = js(f'{sdir}/store/paper-meta.json', {})
    by_record = {}
    for key, s in sources.items(): by_record[s.get('record_id') or key] = (key, s)
    out = []
    for r in recs:
        f = fetch.get(r['id'])
        about = bool(r.get('species_in_title') and r.get('welfare_relevant'))
        key, s = by_record.get(r['id'], (None, None))
        sid = s and s.get('id')
        n = claims_by_source.get(sid, 0) if sid else 0
        stage = ('read' if n else 'read_no_claims') if sid or (f and f.get('via')) else 'no_full_text' if about else 'screened_out'
        why_out = None if about else [w for w, ok in (('no_species_in_title', r.get('species_in_title')), ('no_welfare_topic', r.get('welfare_relevant'))) if not ok]
        name, group = inst(meta.get(key)) if key else (None, None)
        out.append({'id': r['id'], 'species': species, 'set': 'intake', 'title': clean_title(r.get('title')), 'year': r.get('year'), 'venue': r.get('venue'), 'lang': r.get('lang'),
                    'authors': (r.get('authors') or [])[:4], 'doi': r.get('doi'), 'pmid': r.get('pmid'), 'pmcid': r.get('pmcid'), 'sources': r.get('sources'), 'topics': r.get('topics'),
                    'about': about, 'landing': (r.get('oa') or {}).get('landing'), 'pdf_url': (r.get('oa') or {}).get('pdf'), 'full_text': (f or {}).get('via'), 'tried': bool(f),
                    'why_not': why_not(f), 'stage': stage, 'why_out': why_out, 'source_id': sid, 'claims': n or None, 'institution': name, 'inst_group': group})
    # Supplied papers (not found by the search): from the raw index.
    seen = {r['id'] for r in recs}
    for x in raw_rows:
        if not x['path'].startswith(species + '/') or x.get('record_id') in seen: continue
        fname = x['path'].rsplit('/', 1)[-1]
        olds = [p.strip().rsplit('/', 1)[-1] for p in (x.get('old_paths') or '').split(';')]
        hit = next(((k, s) for k, s in sources.items() if (s.get('record_id') or k) in [fname, *olds]), (None, None))
        key, s = hit
        sid = s and s.get('id')
        n = claims_by_source.get(sid, 0) if sid else 0
        name, group = inst(meta.get(key)) if key else (None, None)
        out.append({'id': x.get('sha256', '')[:10] or fname, 'species': species, 'set': 'supplied', 'title': clean_title(x.get('title')), 'year': x.get('year'), 'venue': x.get('journal'),
                    'lang': x.get('lang'), 'authors': [x['first_author']] if x.get('first_author') else [], 'doi': x.get('doi'), 'sources': ['supplied'], 'topics': [], 'about': True,
                    'full_text': 'supplied_pdf' if x.get('text') == 'ok' else 'scan', 'tried': True, 'why_not': None, 'file': f"raw/{x['path']}",
                    'stage': 'read' if n else 'read_no_claims', 'why_out': None, 'source_id': sid, 'claims': n or None, 'institution': name, 'inst_group': group,
                    'title_en': x.get('title_en')})
    return out


def pack(papers):
    rows = []
    for p in papers:
        p = dict(p)
        if p.get('doi') and p.get('landing') and p['doi'].lower() in str(p['landing']).lower(): p['landing'] = None
        rows.append([p.get(k) if p.get(k) not in ('', [], None) else None for k in FIELDS])
    return {'fields': FIELDS, 'rows': rows}


def main():
    data, sdirs = sys.argv[1], sys.argv[2].split(',')
    raw = js(sys.argv[sys.argv.index('--raw-index') + 1], []) if '--raw-index' in sys.argv else []
    rel = js(f'{data}/release.json')
    claims_by_source = collections.Counter(c['source_id'] for f in rel.get('claim_files', []) for c in js(f'{data}/{f}', []))
    papers = [p for d in sdirs for p in species_rows(d, claims_by_source, raw)]
    for old in glob.glob(f'{data}/corpus-papers-*.json'): os.remove(old)
    names, part, size = [], [], 0
    def flush():
        nonlocal part, size
        if not part: return
        names.append(f'corpus-papers-{len(names)}.json')
        json.dump(pack(part), open(f'{data}/{names[-1]}', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        part, size = [], 0
    for p in papers:
        n = len(json.dumps(pack([p])['rows'][0], ensure_ascii=False))
        if size + n > 340_000: flush()
        part.append(p); size += n + 1
    flush()
    corpus = js(f'{data}/corpus.json', {})
    corpus['paper_files'] = names
    json.dump(corpus, open(f'{data}/corpus.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    count = lambda k: dict(collections.Counter(p[k] for p in papers))
    print(json.dumps({'papers': len(papers), 'files': len(names), 'by_species': dict(collections.Counter(p['species'] for p in papers)), 'by_stage': count('stage'),
                      'with_institution': sum(1 for p in papers if p.get('institution'))}, ensure_ascii=False))


if __name__ == '__main__':
    main()
