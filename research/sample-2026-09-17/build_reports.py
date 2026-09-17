"""Publish Markdown, static report catalog and printable HTML from saved model outputs."""
from pathlib import Path
import json,re,html
root=Path(__file__).resolve().parent
public=root.parents[1]/'public'
records=[]
for species,title in [('mandarin-fish','Mandarin fish: assessing feed transition'),('nile-tilapia','Nile tilapia: handling and transport welfare')]:
 md=(root/(species+'-final.md')).read_text()
 provenance='Preliminary source-note analysis | GPT-4o / Codex-edited | 17 September 2026 | Not expert reviewed'
 record={'id':'sample-analysis-'+species,'title':title,'markdown':md,'runId':'source-note-run-'+species,'created':'2026-09-17','status':'Source-backed sample analysis · preliminary','revision':None,'pdf':'./reports/'+species+'-analysis.pdf'}
 records.append(record)
 (public/'reports'/(species+'-analysis.md')).write_text(md)
 def inline(s):
  s=html.escape(s)
  s=re.sub(r'\[([^\]]+)\]\((https?://[^\s)]+)\)',r'<a href="\2">\1</a>',s)
  return re.sub(r'\*\*(.+?)\*\*',r'<strong>\1</strong>',s)
 blocks=[]
 for block in md.split('\n\n'):
  if block.startswith('#'):
   level=min(len(block)-len(block.lstrip('#')),3);blocks.append(f'<h{level}>'+inline(block.lstrip('# ').strip())+f'</h{level}>')
  elif block.startswith('- '):blocks.append('<ul>'+''.join('<li>'+inline(line.lstrip('- '))+'</li>' for line in block.splitlines())+'</ul>')
  else:blocks.append('<p>'+inline(block).replace('\n','<br>')+'</p>')
 document='''<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:20mm 18mm 22mm}body{font:11pt/1.55 Georgia,serif;color:#252723}header{border-bottom:3px double #252723;padding-bottom:16px;margin-bottom:24px}header strong{font-size:34pt}header p{font:9pt/1.5 Arial,sans-serif;color:#59625d}h1{font-size:24pt;line-height:1.2}h2{font-size:16pt;border-bottom:1px solid #c3c8c1;padding-bottom:5px;margin-top:24px}h3{font-size:13pt}h1,h2,h3{break-after:avoid}p,li{orphans:3;widows:3}a{color:#89432d;overflow-wrap:anywhere}li{margin-bottom:5px}.end{border-top:1px solid #aaa;margin-top:24px;padding-top:12px;font:9pt Arial,sans-serif}</style></head><body><header><strong>Myrias</strong><p>Aquaculture welfare research<br>'''+html.escape(provenance)+'</p></header><h1>'+html.escape(title)+'</h1>'+''.join(blocks)+'<p class="end">Run record and source-note packet are preserved with this report. These conclusions have not been accepted into the reviewed knowledge graph. This report is a bounded sample, not a farm operating protocol.</p></body></html>'
 (public/'reports'/(species+'-analysis.html')).write_text(document)
(public/'sample-reports.js').write_text('export const sampleReports = '+json.dumps(records,ensure_ascii=False,indent=2)+';\n')
