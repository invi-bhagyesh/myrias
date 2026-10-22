#!/usr/bin/env python3
"""Write the numbers the Pipeline page draws: one entry per step with what went in, what came out, whether a
model or plain code did it, and how many model calls it made, over every run so far. Reading steps (extract to
English text) add up across runs; combining steps (practices, findings, actions) show the store and release as
they stand. Everything is read from the run folders, the species store and the release; nothing is typed in.

  python3 pipeline/pipeline_summary.py STORE_DIR public/data RUN_DIR[,RUN_DIR...] [EXAMPLE_CLAIM_ID]

A run folder holds one folder per phase; a phase holds numbered step folders (NN-name, written by step.mjs)
or, for the oldest phase, flat files (claims.jsonl, mapped.jsonl, verified.jsonl, calls.jsonl).
"""
import json, os, re, sys, glob, collections

store, data, runs = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
jl = lambda p: [json.loads(l) for l in open(p) if l.strip()] if os.path.exists(p) else []
js = lambda p: json.load(open(p))
cost = collections.defaultdict(float); calls = collections.Counter(); last = ''
for run in runs:
    for r in jl(os.path.join(run, 'ledger.jsonl')):
        k = r['step'].split('-', 1)[1]; cost[k] += r.get('cost_usd') or 0; calls[k] += r.get('calls') or 0; last = max(last, r['finished'])
# The first findings pass and later re-ranks logged their calls beside the store.
for f in os.listdir(os.path.dirname(store)):
    k = f.split('-', 1)[0]
    if k in ('findings', 'rank', 'actions') and f.endswith('.calls.jsonl'):
        for c in jl(os.path.join(os.path.dirname(store), f)): cost[k] += c.get('cost_usd') or 0; calls[k] += 1

def phases():
    for run in runs:
        for ph in sorted(d for d in glob.glob(os.path.join(run, '*')) if os.path.isdir(d) and re.fullmatch(r'[A-Z]', os.path.basename(d))):
            yield run, ph

def step_dir(ph, name):
    hits = sorted(glob.glob(os.path.join(ph, f'[0-9][0-9]-{name}')))
    return hits[-1] if hits else None

# Reading steps, summed over every phase of every run.
R = collections.Counter(); verdicts = collections.Counter()
for run, ph in phases():
    ext = step_dir(ph, 'extract')
    if ext:
        sm = js(os.path.join(ext, 'summary.json')); R['windows'] += sm['windows']; R['claims'] += sm['claims_after_merge']; R['quote'] += sm['quote_found']
        prep = step_dir(ph, 'prepare'); pr = json.loads(open(os.path.join(prep, 'stdout.log')).read()) if prep else {}
        R['pages'] += pr.get('pages', 0)
        mapped = jl(os.path.join(step_dir(ph, 'map'), 'mapped.jsonl')); ver = jl(os.path.join(step_dir(ph, 'verify'), 'verified.jsonl'))
    else:  # the oldest phase: flat files
        if not os.path.exists(os.path.join(ph, 'claims.jsonl')): continue
        cl = jl(os.path.join(ph, 'claims.jsonl')); R['windows'] += len(jl(os.path.join(ph, 'calls.jsonl'))); R['claims'] += len(cl)
        R['quote'] += sum(1 for c in cl if c.get('quote_check') == 'found'); R['pages'] += len(jl(os.path.join(ph, 'pages.jsonl')))
        mapped = jl(os.path.join(ph, 'mapped.jsonl')); ver = jl(os.path.join(ph, 'verified.jsonl'))
        for name, f in (('extract', 'calls.jsonl'), ('map', 'mapped.jsonl.calls.jsonl'), ('verify', 'verified.jsonl.calls.jsonl'), ('render', 'final.jsonl.calls.jsonl'), ('reconcile', 'reconciled.jsonl.calls.jsonl')):
            for c in jl(os.path.join(ph, f)): calls[name] += 1; cost[name] += c.get('cost_usd') or 0
    R['relevant'] += sum(1 for c in mapped if c.get('quote_check') == 'found' and (c.get('map') or {}).get('welfare_relevant') is True)
    verdicts.update((c.get('verify') or {}).get('verdict') for c in ver if c.get('verify'))
    mg = step_dir(ph, 'merge')
    if mg: R['passing'] += json.loads(open(os.path.join(mg, 'stdout.log')).read())['claims_passing']
    else: R['passing'] += sum(1 for c in ver if (c.get('verify') or {}).get('verdict') in ('supported', 'partial'))
# The latest naming step: how many new names it grouped and how many joined groups already in the store.
rc_txt = ''
for run, ph in phases():
    d = step_dir(ph, 'reconcile')
    if d: rc_txt = open(os.path.join(d, 'stdout.log')).read()
rc_num = lambda k: int(m.group(1)) if (m := re.search(r'(?<![_a-z])' + k + r':\s*(\d+)', rc_txt)) else None

corpus = js(os.path.join(data, 'corpus.json')); h = corpus['headline']
stages = {s['id']: s for s in corpus['charts']['stages']}
sources = js(os.path.join(store, 'sources.json'))
# Supplied papers: any the open search did not find (not in the intake's records).
intake_ids = {r['id'] for r in jl(os.path.join(os.path.dirname(store), 'intake', 'records.jsonl'))}
supplied = sum(1 for s in sources.values() if s.get('record_id') not in intake_ids)
claims_store = len(jl(os.path.join(store, 'claims.jsonl')))
rel = js(os.path.join(data, 'release.json'))
released = sum(len(json.load(open(os.path.join(data, f)))) for f in rel['claim_files'])
findings = [f for x in rel.get('finding_files', []) for f in js(os.path.join(data, x))]
actions = [a for x in rel.get('action_files', []) for a in js(os.path.join(data, x))]
prac = lambda f: len({p['key'] for p in js(os.path.join(store, f)).values()})

def step(i, lane, key, model, n_in, n_out, extra=None):
    return {'id': i, 'lane': lane, 'key': key, 'model': model, 'in': n_in, 'out': n_out, 'calls': calls.get(key, 0), **(extra or {})}

models = {k: v.get('model') for k, v in js(os.path.join(os.path.dirname(__file__), 'models.json'))['profiles']['demo'].items() if isinstance(v, dict)}
steps = [
    step(1, 'collect', 'search', None, sum(1 for v in h['sources'].values() if v == 'ok'), h['papers_found']),
    step(2, 'collect', 'screen', None, h['papers_found'], stages['about']['n']),
    step(3, 'collect', 'fetch', None, stages['about']['n'], h['full_text']),
    step(4, 'collect', 'supplied', None, None, supplied),
    step(5, 'collect', 'prepare', None, len(sources), R['pages']),
    step(6, 'read', 'extract', models.get('extract'), R['windows'], R['claims']),
    step(7, 'read', 'quote', None, R['claims'], R['quote']),
    step(8, 'read', 'map', models.get('map'), R['quote'], R['relevant']),
    step(9, 'read', 'verify', models.get('verify'), R['relevant'], verdicts['supported'] + verdicts['partial'], {'split': dict(verdicts)}),
    step(10, 'read', 'render', models.get('translate'), calls.get('render', 0), calls.get('render', 0)),
    step(11, 'combine', 'reconcile', models.get('reconcile'), rc_num('new_names'), rc_num('groups'), {'joined_existing': rc_num('joined_existing')}),
    step(12, 'combine', 'merge', None, R['passing'], claims_store),
    step(13, 'combine', 'export', None, claims_store, released),
    step(14, 'combine', 'cluster', models.get('cluster'), prac('practices-exact.json'), prac('practices.json'), {'embed_model': models.get('embed'), 'embed_only': prac('practices-embed.json')}),
    step(15, 'combine', 'findings', models.get('findings'), released, len(findings), {'multi_paper': sum(1 for f in findings if f['counts']['papers'] > 1)}),
    step(16, 'combine', 'actions', models.get('actions'), sum(1 for f in findings if f['counts']['papers'] > 1), len(actions)),
    step(17, 'combine', 'rank', models.get('rank'), len(actions), sum(1 for a in actions if a.get('rank'))),
    step(18, 'check', 'audit', None, None, None, {'status': 'planned'}),
]
# Costs stay in the run records and the private dataset; the public page shows no spending.
out = {'run': ', '.join(os.path.basename(r) for r in runs), 'as_of': last[:10], 'steps': steps, 'totals': {'calls': sum(calls.values())}}
json.dump(out, open(os.path.join(data, 'pipeline.json'), 'w'), indent=1)
print(json.dumps(out['totals']), len(steps), 'steps', 'model cost (not published):', round(sum(cost.values()), 2))

# One claim followed through every step, for the walkthrough on the Pipeline page. Everything is read from
# the run, the store and the release: the paper's record, its pages, the model's own labels and verdict,
# the practice names before and after clustering, and the finding and action it ends up in. Only the short
# quote the site already shows is copied; no other paper text.
def example(cid):
    base = os.path.dirname(store)
    claim = next((c for c in jl(os.path.join(store, 'claims.jsonl')) if c.get('release_id') == cid), None)
    if not claim: return None
    rec = next((r for r in jl(os.path.join(base, 'intake', 'records.jsonl')) if r['id'] == claim['source']), {})
    # The phase that added the claim: its prepare and extract steps.
    ph = next(os.path.join(r, claim['added_in']['phase']) for r in runs if os.path.basename(r) == claim['added_in']['run'])
    pages = sum(1 for p in jl(os.path.join(step_dir(ph, 'prepare'), 'pages.jsonl')) if p['source'] == claim['source'])
    ext_all = [c for c in jl(os.path.join(step_dir(ph, 'extract'), 'claims.jsonl')) if c['source'] == claim['source']]
    windows = sum(1 for t in jl(os.path.join(step_dir(ph, 'extract'), 'tasks.jsonl')) if t.get('source') == claim['source'])
    pub = next(c for f in rel['claim_files'] for c in js(os.path.join(data, f)) if c['id'] == cid)
    src = next(s for s in rel['sources'] if s['id'] == pub['source_id'])
    exact, clustered = js(os.path.join(store, 'practices-exact.json')), js(os.path.join(store, 'practices.json'))
    key = clustered[claim['release_id']]['key']
    names = collections.Counter(exact[c]['name_en'] for c in clustered if clustered[c]['key'] == key and c in exact)
    cl = next((c for c in js(os.path.join(store, 'practice-clusters.json'))['clusters'] if key.split('|', 1)[1] == c['name_en'].lower() and key.split('|')[0] == c['members'][0].split('|')[0]), {})
    finding = next((f for f in findings if cid in f['claim_ids'] and f['welfare_problem'] == claim['map']['welfare_problem']), None) or next((f for f in findings if cid in f['claim_ids']), None)
    action = next((a for a in sorted(actions, key=lambda a: a['rank']) if finding and finding['id'] in a['finding_ids']), None)
    nums = sorted(set(re.findall(r'\d+(?:\.\d+)?', claim['statement'])), key=lambda x: claim['statement'].index(x))
    return {
        'claim_id': cid, 'source_id': src['id'], 'title': src['title'], 'year': src['year'], 'venue': src.get('venue'), 'doi': src.get('doi'),
        'search': {'indexes': rec.get('sources', []), 'found_of': h['papers_found']},
        'screen': {'species_in_title': rec.get('species_in_title'), 'topics': rec.get('topics', [])},
        'fetch': {'format': rec.get('fetched')},
        'prepare': {'pages': pages, 'page': claim['page']},
        'extract': {'windows': windows, 'claims_from_paper': len(ext_all), 'window': claim['window'], 'quote': claim['quote'], 'statement': claim['statement'],
                    'lang': pub['quote_lang'], 'intervention': claim['intervention_original'], 'basis': claim['basis'], 'polarity': claim['polarity'], 'model': claim['model']},
        'quote': {'check': claim['quote_check'], 'page': claim['page'], 'found_in_paper': sum(1 for c in ext_all if c.get('quote_check') == 'found')},
        'map': {k: claim['map'][k] for k in ('welfare_relevant', 'technology_class', 'welfare_problem', 'kind', 'welfare_link', 'reason', 'model')},
        'verify': {'verdict': claim['verify']['verdict'], 'note': claim['verify'].get('note'), 'model': claim['verify']['model']},
        'render': {'text_en': claim['statement_en'], 'numbers': nums, 'check': claim['rendering']['check'], 'model': claim['rendering']['model']},
        'reconcile': {'before': [claim['intervention_original'], claim.get('intervention_en_original')], 'after': [exact[cid]['name_en'], exact[cid]['name_zh']]},
        'merge': {'uid': claim['uid'], 'id': cid, 'source_id': src['id'], 'run': claim['added_in']['run']},
        'export': {'released': True},
        'cluster': {'names': names.most_common(), 'name': [clustered[cid]['name_en'], clustered[cid]['name_zh']], 'reason': cl.get('reason'), 'model': cl.get('model')},
        'findings': finding and {k: finding[k] for k in ('id', 'statement_en', 'statement_zh', 'counts', 'strength', 'welfare_problem', 'practice_en', 'practice_zh', 'basis') if k in finding},
        'actions': action and {k: action[k] for k in ('id', 'rank', 'action_en', 'action_zh', 'type', 'who', 'priority', 'evidence_gap', 'risks', 'basis') if k in action},
        'rank_of': len(actions),
    }

out['example'] = example(sys.argv[4] if len(sys.argv) > 4 else 'C0269')
json.dump(out, open(os.path.join(data, 'pipeline.json'), 'w'), indent=1, ensure_ascii=False)
