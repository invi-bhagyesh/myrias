#!/usr/bin/env python3
"""Write the numbers the Pipeline page draws: one entry per step with what went in, what came out, whether a
model or plain code did it, and how many model calls it made. Everything is read from the run folder, the species store and
the release; nothing is typed in by hand.

  python3 pipeline/pipeline_summary.py RUN_DIR STORE_DIR public/data [EXAMPLE_CLAIM_ID]
"""
import json, os, sys, collections

run, store, data = sys.argv[1:4]
jl = lambda p: [json.loads(l) for l in open(p) if l.strip()]
js = lambda p: json.load(open(p))
ledger = jl(os.path.join(run, 'ledger.jsonl'))
cost = collections.defaultdict(float); calls = collections.Counter()
for r in ledger:
    if r['phase'] == 'B':
        k = r['step'].split('-', 1)[1]; cost[k] += r.get('cost_usd') or 0; calls[k] += r.get('calls') or 0
# The first findings pass logged its calls beside the store.
for f in os.listdir(os.path.dirname(store)):
    if f.startswith('findings-') and f.endswith('.calls.jsonl'):
        for c in jl(os.path.join(os.path.dirname(store), f)): cost['findings'] += c.get('cost_usd') or 0; calls['findings'] += 1

corpus = js(os.path.join(data, 'corpus.json')); h = corpus['headline']
stages = {s['id']: s for s in corpus['charts']['stages']}
B = os.path.join(run, 'B')
prep = json.loads(open(os.path.join(B, '01-prepare', 'stdout.log')).read())
ext = js(os.path.join(B, '02-extract', 'summary.json'))
mapped = jl(os.path.join(B, '03-map', 'mapped.jsonl'))
relevant = sum(1 for c in mapped if c.get('quote_check') == 'found' and (c.get('map') or {}).get('welfare_relevant') is True)
verified = jl(os.path.join(B, '04-verify', 'verified.jsonl'))
verdicts = collections.Counter((c.get('verify') or {}).get('verdict') for c in verified if c.get('verify'))
merge = json.loads(open(os.path.join(B, '07-merge', 'stdout.log')).read())
rel = js(os.path.join(data, 'release.json'))
findings = [f for x in rel.get('finding_files', []) for f in js(os.path.join(data, x))]
actions = [a for x in rel.get('action_files', []) for a in js(os.path.join(data, x))]
prac = lambda f: len({p['key'] for p in js(os.path.join(store, f)).values()})
import re
rc = open(os.path.join(B, '06-reconcile', 'stdout.log')).read()
rc_num = lambda k: int(m.group(1)) if (m := re.search(r'(?<![_a-z])' + k + r':\s*(\d+)', rc)) else None
plan = js(os.path.join(data, 'next-run.json'))
phase_a = next((p for p in plan['phases'] if p['id'] == 'A'), {}).get('actual') or {}

def step(i, lane, key, model, n_in, n_out, extra=None):
    return {'id': i, 'lane': lane, 'key': key, 'model': model, 'in': n_in, 'out': n_out, 'calls': calls.get(key, 0), **(extra or {})}

models = {k: v.get('model') for k, v in js(os.path.join(os.path.dirname(__file__), 'models.json'))['profiles']['demo'].items() if isinstance(v, dict)}
steps = [
    step(1, 'collect', 'search', None, sum(1 for v in h['sources'].values() if v == 'ok'), h['papers_found']),
    step(2, 'collect', 'screen', None, h['papers_found'], stages['about']['n']),
    step(3, 'collect', 'fetch', None, stages['about']['n'], h['full_text']),
    step(4, 'collect', 'prepare', None, prep['sources'], prep['pages']),
    step(5, 'read', 'extract', models.get('extract'), ext['windows'], ext['claims_after_merge']),
    step(6, 'read', 'quote', None, ext['claims_after_merge'], ext['quote_found']),
    step(7, 'read', 'map', models.get('map'), ext['quote_found'], relevant),
    step(8, 'read', 'verify', models.get('verify'), relevant, verdicts['supported'] + verdicts['partial'], {'split': dict(verdicts)}),
    step(9, 'read', 'render', models.get('translate'), calls.get('render', 0), calls.get('render', 0)),
    step(10, 'combine', 'reconcile', models.get('reconcile'), rc_num('new_names'), rc_num('groups'), {'joined_existing': rc_num('joined_existing')}),
    step(11, 'combine', 'merge', None, merge['claims_passing'], merge['store_claims']),
    step(12, 'combine', 'export', None, merge['store_claims'], sum(len(json.load(open(os.path.join(data, f)))) for f in rel['claim_files'])),
    step(13, 'combine', 'cluster', models.get('cluster'), prac('practices-exact.json'), prac('practices.json'), {'embed_model': models.get('embed'), 'embed_only': prac('practices-embed.json')}),
    step(14, 'combine', 'findings', models.get('findings'), sum(len(json.load(open(os.path.join(data, f)))) for f in rel['claim_files']), len(findings), {'multi_paper': sum(1 for f in findings if f['counts']['papers'] > 1)}),
    step(15, 'combine', 'actions', models.get('actions'), sum(1 for f in findings if f['counts']['papers'] > 1), len(actions)),
    step(16, 'check', 'audit', None, None, None, {'status': 'planned'}),
]
total = sum(cost.values()) + (phase_a.get('spent_usd') or 0)
# Costs stay in the run records and the private dataset; the public page shows no spending.
out = {'run': os.path.basename(run), 'as_of': ledger[-1]['finished'][:10], 'steps': steps, 'totals': {'calls': sum(calls.values())}}
json.dump(out, open(os.path.join(data, 'pipeline.json'), 'w'), indent=1)
print(json.dumps(out['totals']), len(steps), 'steps', 'model cost (not published):', round(total, 2))

# One claim followed through every step, for the walkthrough on the Pipeline page. Everything is read from
# the run, the store and the release: the paper's record, its pages, the model's own labels and verdict,
# the practice names before and after clustering, and the finding and action it ends up in. Only the short
# quote the site already shows is copied; no other paper text.
def example(cid):
    base = os.path.dirname(store)
    claim = next((c for c in jl(os.path.join(store, 'claims.jsonl')) if c.get('release_id') == cid), None)
    if not claim: return None
    rec = next((r for r in jl(os.path.join(base, 'intake', 'records.jsonl')) if r['id'] == claim['source']), {})
    pages = sum(1 for p in jl(os.path.join(B, '01-prepare', 'pages.jsonl')) if p['source'] == claim['source'])
    ext_all = [c for c in jl(os.path.join(B, '02-extract', 'claims.jsonl')) if c['source'] == claim['source']]
    windows = sum(1 for t in jl(os.path.join(B, '02-extract', 'tasks.jsonl')) if t.get('source') == claim['source'])
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
        'findings': finding and {k: finding[k] for k in ('id', 'statement_en', 'statement_zh', 'counts', 'strength', 'welfare_problem', 'practice_en', 'practice_zh')},
        'actions': action and {k: action[k] for k in ('id', 'rank', 'action_en', 'action_zh', 'type', 'who', 'priority', 'evidence_gap', 'risks')},
    }

out['example'] = example(sys.argv[4] if len(sys.argv) > 4 else 'C0269')
json.dump(out, open(os.path.join(data, 'pipeline.json'), 'w'), indent=1, ensure_ascii=False)
