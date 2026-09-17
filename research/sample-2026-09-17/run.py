"""Run two bounded source-note analyses through GPT-4o. Credentials never persisted."""
import json, subprocess, getpass, urllib.request, datetime, hashlib
from pathlib import Path
root=Path(__file__).resolve().parent
sources=json.loads((root/'source-notes.json').read_text())
p=subprocess.run(['/usr/bin/security','find-generic-password','-a',getpass.getuser(),'-s','iaa/OPENROUTER_API_KEY','-w'],capture_output=True,text=True)
key=p.stdout.strip() if p.returncode==0 else ''
if not key: raise SystemExit('OpenRouter credential unavailable; no request submitted.')
template=Path('/Users/invi/Desktop/TopoReformer/active/myrias-aquaculture/framework-v0.1/framework/decision-template.md').read_text()
(root/'decision-template.md').write_text(template)
for species,notes in sources.items():
 output=root/(species+'.md');guard=root/(species+'-attempt.json')
 if output.exists(): continue
 if guard.exists(): raise SystemExit('Previous attempt exists; inspect before retry.')
 prompt='''Write a substantive preliminary Myrias aquaculture welfare analysis, 650-850 words, based ONLY on the supplied source notes and this decision template. This is an actual bounded sample analysis, not fictional demo content. Use the headings: Executive judgment, Scope and comparator, Evidence ledger, Welfare pathways and affected animals, Implementation and business case, Decision and next research, Limitations, References. Use Markdown paragraphs/bullets, no tables. Include source IDs and source URLs. Limit all material derived from each source across the report to 160 words per source; avoid repeating study summaries. Use remaining space for explicitly labeled analyst proposals and unknowns. No outside factual claims, invented population estimates, effect sizes, prices, scores or citations. Preserve the distinction between measurements, inference, and proposed work. Do not turn physiological biomarkers into a numerical estimate of suffering. Provide a concrete proposed research sequence with stop/reversal conditions, responsible roles, evidence needed, implementation risks and unknown additionality. Keep population scale separate from intervention efficacy and research priority separate from welfare promisingness. State author is GPT-4o via OpenRouter, source packet is analyst-curated notes with differing access depth, not autonomous full-text retrieval or systematic review. Status preliminary; not expert reviewed. Date 2026-09-17. Do not claim the graph has accepted the conclusions. Species: '''+species+'\nDECISION TEMPLATE\n'+template+'\nSOURCE NOTES\n'+json.dumps(notes,ensure_ascii=False)
 payload={'model':'openai/gpt-4o','temperature':0,'max_tokens':2200,'provider':{'only':['OpenAI'],'allow_fallbacks':False},'messages':[{'role':'user','content':prompt}]}
 (root/(species+'-request.json')).write_text(json.dumps(payload,indent=2))
 guard.write_text(json.dumps({'status':'submitted','date':datetime.datetime.now(datetime.timezone.utc).isoformat(),'prompt_sha256':hashlib.sha256(prompt.encode()).hexdigest()}))
 req=urllib.request.Request('https://openrouter.ai/api/v1/chat/completions',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=180) as response: data=json.load(response)
 except Exception as exc: raise SystemExit('Request failed: '+type(exc).__name__+'; no automatic retry.')
 (root/(species+'-response.json')).write_text(json.dumps(data,indent=2))
 choice=data['choices'][0]
 output.write_text(choice['message']['content'])
 guard.write_text(json.dumps({'status':'completed','model':data.get('model'),'provider':data.get('provider'),'usage':data.get('usage'),'finish_reason':choice.get('finish_reason')},indent=2))
 print(species,choice.get('finish_reason'),flush=True)
 if choice.get('finish_reason')!='stop':raise SystemExit('Incomplete output saved; inspect before publication.')
