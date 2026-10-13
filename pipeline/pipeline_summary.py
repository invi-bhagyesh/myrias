#!/usr/bin/env python3
"""Write the numbers the Pipeline page draws: one entry per step with what went in, what came out, whether a
model or plain code did it, and how many model calls it made. Everything is read from the run folder, the species store and
the release; nothing is typed in by hand.

  python3 pipeline/pipeline_summary.py RUN_DIR STORE_DIR public/data
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
