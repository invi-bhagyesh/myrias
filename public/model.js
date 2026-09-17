export const TYPES = ['species', 'segment', 'problem', 'intervention', 'claim', 'source'];
export const RELATIONS = ['farms', 'experiences', 'targets', 'applies_to', 'supports', 'contradicts', 'informs', 'affects', 'related_to'];
export const SCHEMA_VERSION = 1;
const MAX_TEXT = 200000;
export function assert(condition, message) { if (!condition) throw new Error(message); }
export function text(value, name, max = MAX_TEXT) { assert(typeof value === 'string' && value.length <= max, `${name} must be text of at most ${max} characters.`); return value; }
export function id(value) { assert(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value), 'Use a stable ID with letters, digits, underscores or hyphens.'); return value; }
export function safeUrl(value) { if (!value) return ''; let u; try { u = new URL(value); } catch { throw new Error('Enter a complete https:// or http:// source URL.'); } assert(['https:', 'http:'].includes(u.protocol), 'Only http:// and https:// links are accepted.'); return u.href; }
export function normalizeNode(raw) {
  assert(raw && typeof raw === 'object', 'A node must be an object.');
  const node = { id: id(raw.id), type: raw.type, title: text(raw.title, 'Title', 300), summary: text(raw.summary || '', 'Summary'), status: text(raw.status || 'draft', 'Status', 80), species: text(raw.species || '', 'Species', 300), scope: text(raw.scope || '', 'Scope', 2000), sourceIds: raw.sourceIds || [], values: raw.values || {}, updated: text(raw.updated || new Date().toISOString(), 'Updated date', 100) };
  assert(TYPES.includes(node.type), 'Unknown node type.'); assert(node.title.trim(), 'A node needs a title.');
  assert(Array.isArray(node.sourceIds) && node.sourceIds.length <= 1000, 'Invalid source references.'); node.sourceIds.forEach(id);
  assert(node.values && typeof node.values === 'object' && !Array.isArray(node.values), 'Values must be an object.');
  for (const [k, v] of Object.entries(node.values)) { assert(!['__proto__','constructor','prototype'].includes(k), 'Invalid value key.'); assert(v === null || typeof v === 'number' && Number.isFinite(v) || typeof v === 'string' && v.length <= 2000, 'Values must be finite numbers, text or null.'); }
  return node;
}
export function normalizeEdge(raw) {
  const edge = { id: id(raw.id), from: id(raw.from), to: id(raw.to), relation: raw.relation, confidence: raw.confidence ?? null, basis: text(raw.basis || '', 'Relationship basis', 10000), sourceIds: raw.sourceIds || [] };
  assert(RELATIONS.includes(edge.relation), 'Unknown relationship type.'); assert(edge.from !== edge.to, 'A relationship must connect two different nodes.');
  assert(edge.confidence === null || typeof edge.confidence === 'number' && edge.confidence >= 0 && edge.confidence <= 1, 'Relationship confidence must be null or between 0 and 1.');
  assert(edge.confidence === null || edge.basis.trim(), 'A confidence value needs a written basis.');
  assert(Array.isArray(edge.sourceIds), 'Invalid relationship source references.'); edge.sourceIds.forEach(id);return edge;
}
export function validateGraph(nodes, edges, sources = []) {
  assert(Array.isArray(nodes) && nodes.length <= 5000, 'At most 5,000 nodes are supported in this browser workspace.'); assert(Array.isArray(edges) && edges.length <= 15000, 'At most 15,000 relationships are supported.');
  const nn = nodes.map(normalizeNode), ee = edges.map(normalizeEdge), ids = new Set(nn.map(n => n.id));
  assert(ids.size === nn.length, 'Duplicate node IDs.'); assert(new Set(ee.map(e => e.id)).size === ee.length, 'Duplicate relationship IDs.');
  const sourceIds = new Set([...nn.filter(n => n.type === 'source').map(n => n.id), ...sources.map(s => s.id)]);
  for (const node of nn) for (const ref of node.sourceIds) assert(sourceIds.has(ref), `Missing evidence source: ${ref}.`);
  for (const edge of ee) { assert(ids.has(edge.from) && ids.has(edge.to), `Relationship ${edge.id} refers to a missing node.`); for (const ref of edge.sourceIds) assert(sourceIds.has(ref), `Missing evidence source: ${ref}.`); }
  return { nodes: nn, edges: ee };
}
export function normalizeSource(s) {
  const source = { id: id(s.id), title: text(s.title, 'Source title', 300), url: safeUrl(s.url || ''), filename: text(s.filename || '', 'Filename', 300), hash: text(s.hash || '', 'File hash', 100), fileKey: text(s.fileKey || '', 'File reference', 100), mime: text(s.mime || '', 'File type', 150), bytes: s.bytes || 0, access: text(s.access || 'metadata only', 'Access status', 100), added: text(s.added || '', 'Acquisition date', 100), extracted: text(s.extracted || '', 'Extracted text'), note: text(s.note || '', 'Source note', 10000) };
  assert(Number.isFinite(source.bytes) && source.bytes >= 0 && source.bytes <= 20 * 1024 * 1024, 'Source files must be at most 20 MB.'); return source;
}
export function normalizeReport(r) { return { id: id(r.id), title: text(r.title, 'Report title', 300), markdown: text(r.markdown || '', 'Report text'), runId: text(r.runId || '', 'Run reference', 100), created: text(r.created || '', 'Report date', 100), status: text(r.status || 'draft', 'Report status', 100), revision: Number.isInteger(r.revision) ? r.revision : null }; }
export function validateWorkspace(raw) {
  assert(raw && raw.schemaVersion === SCHEMA_VERSION, 'This is not a supported Myrias workspace (schemaVersion 1).');
  assert(Array.isArray(raw.sources) && raw.sources.length <= 5000, 'Invalid source collection.'); const sources = raw.sources.map(normalizeSource);
  assert(new Set(sources.map(s => s.id)).size === sources.length, 'Duplicate source IDs.');
  const graph = validateGraph(raw.nodes, raw.edges, sources);
  assert(Number.isInteger(raw.revision) && raw.revision >= 0, 'Invalid workspace revision.');
  assert(Array.isArray(raw.runs) && raw.runs.length <= 1000 && Array.isArray(raw.reports) && raw.reports.length <= 1000, 'Invalid runs or reports.');
  const runs = raw.runs.map(r => { id(r.id); text(r.question, 'Run question', 3000); assert(['prepared','pending review','accepted','rejected'].includes(r.status), 'Invalid run status.'); assert(Number.isInteger(r.baseRevision) && r.baseRevision >= 0, 'Invalid run revision.'); text(r.scope || '', 'Run scope', 3000); assert(Array.isArray(r.sourceIds), 'Invalid run source IDs.'); r.sourceIds.forEach(ref => { id(ref); assert(sources.some(s=>s.id===ref), `Run refers to missing source ${ref}.`); }); if (r.result) validateResult(r.result, r, { ...graph, sources, revision: r.baseRevision }, false); return { id:r.id,question:r.question,scope:r.scope||'',sourceIds:r.sourceIds,status:r.status,baseRevision:r.baseRevision,created:r.created||'',result:r.result||null }; });
  assert(new Set(runs.map(r=>r.id)).size===runs.length,'Duplicate run IDs.'); const reports=raw.reports.map(normalizeReport);assert(new Set(reports.map(r=>r.id)).size===reports.length,'Duplicate report IDs.');
  assert(Array.isArray(raw.history || []) && (raw.history || []).length <= 10000,'Invalid revision history.');
  return { schemaVersion:1, revision:raw.revision, nodes:graph.nodes, edges:graph.edges, sources, runs, reports, history:(raw.history||[]).map(h=>({ revision:h.revision,date:text(h.date||'','History date',100),message:text(h.message||'','History entry',5000)})), example:raw.example===true };
}
export function validateResult(raw, run, workspace, checkGraph = true) {
  assert(raw && raw.schemaVersion === 1 && raw.kind === 'research-result', 'Import a research-result JSON file, not a source file or workspace backup.');
  assert(raw.runId === run.id, 'The result does not belong to this research request.');assert(raw.baseRevision === run.baseRevision, 'The result revision does not match the request.');
  const changes = raw.changes || {};assert(Array.isArray(changes.nodes) && Array.isArray(changes.edges),'A result needs changes.nodes and changes.edges arrays.');
  const nodes=changes.nodes.map(normalizeNode),edges=changes.edges.map(normalizeEdge);
  assert(new Set(nodes.map(n=>n.id)).size===nodes.length && new Set(edges.map(e=>e.id)).size===edges.length,'Duplicate changes in research result.');
  const result={schemaVersion:1,kind:'research-result',runId:run.id,baseRevision:run.baseRevision,summary:text(raw.summary||'','Result summary',10000),report:{title:text(raw.report?.title||'Research report','Report title',300),markdown:text(raw.report?.markdown||'','Report text')},changes:{nodes,edges}};
  assert(result.report.markdown.trim(),'A completed result must include its research report text.');
  if(checkGraph) mergeChanges(workspace,result,false);return result;
}
export function mergeChanges(workspace,result,checkRevision=true) {
  if(checkRevision) assert(workspace.revision===result.baseRevision,'The knowledge base has changed since this request. Prepare a new request against the current revision before applying it.');
  const nm=new Map(workspace.nodes.map(n=>[n.id,n])),em=new Map(workspace.edges.map(e=>[e.id,e]));
  for(const n of result.changes.nodes) { const old=nm.get(n.id);assert(!old||old.type===n.type,'A result cannot silently change an existing node type.');nm.set(n.id,normalizeNode(n)); }
  for(const e of result.changes.edges)em.set(e.id,normalizeEdge(e));
  return validateGraph([...nm.values()],[...em.values()],workspace.sources);
}
export function emptyWorkspace() { return {schemaVersion:1,revision:0,nodes:[],edges:[],sources:[],runs:[],reports:[],history:[],example:false}; }
export function newId(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`; }
export function makeRequest(workspace,question,scope,sourceIds) {
  assert(question.trim(),'Write a research question.');assert(sourceIds.length,'Select at least one source.');
  for(const ref of sourceIds)assert(workspace.sources.some(s=>s.id===ref),'Source selection is invalid.');
  return {id:newId('run'),question:text(question.trim(),'Question',3000),scope:text(scope.trim(),'Scope',3000),sourceIds,status:'prepared',baseRevision:workspace.revision,created:new Date().toISOString(),result:null};
}
export function requestPacket(workspace,run) { return {schemaVersion:1,kind:'research-request',runId:run.id,baseRevision:run.baseRevision,question:run.question,scope:run.scope,sources:workspace.sources.filter(s=>run.sourceIds.includes(s.id)).map(({fileKey,...s})=>s),context:{nodes:workspace.nodes,edges:workspace.edges},requiredOutput:{schemaVersion:1,kind:'research-result',runId:run.id,baseRevision:run.baseRevision,summary:'Explain findings, uncertainty and proposed changes.',report:{title:'Research report title',markdown:'Source-linked research report; disclose evidence access and review status.'},changes:{nodes:[],edges:[]}},instructions:'Research outside this static frontend. Preserve source locators, observation/inference boundaries, affected populations, contradictions, uncertainty and dated reasoning. Return proposed changes only; review is required before application. No deletions or identity-type changes are accepted by this browser prototype.'}; }
export function snapshotMarkdown(workspace,title,selectedIds) { const nodes=workspace.nodes.filter(n=>selectedIds.includes(n.id)); assert(nodes.length,'Select at least one knowledge record.'); return `# ${title}\n\nKnowledge-base snapshot, revision ${workspace.revision}. ${new Date().toISOString().slice(0,10)}.\n\nThis is a formatted export of stored records, not a new research synthesis or independently validated assessment.\n\n`+nodes.map(n=>`## ${n.title}\n\nType: ${n.type}. Status: ${n.status}.\n\n${n.summary}\n\n${n.scope?'Scope: '+n.scope+'\n\n':''}${Object.keys(n.values).length?'Values: '+JSON.stringify(n.values)+'\n\n':''}Evidence: ${n.sourceIds.length?n.sourceIds.join(', '):'No source-linked evidence recorded.'}\n\nRelationships:\n${workspace.edges.filter(e=>e.from===n.id||e.to===n.id).map(e=>`- ${workspace.nodes.find(x=>x.id===e.from)?.title} — ${e.relation.replaceAll('_',' ')} → ${workspace.nodes.find(x=>x.id===e.to)?.title}. Confidence: ${e.confidence??'unassigned'}. ${e.basis}`).join('\n')||'- None recorded.'}\n`).join('\n')+'\n## Sources\n\n'+workspace.sources.filter(s=>nodes.some(n=>n.sourceIds.includes(s.id))).map(s=>`- ${s.id}: ${s.title}. ${s.url||s.filename} Access: ${s.access}.`).join('\n'); }
export function exampleWorkspace() {
  const w=emptyWorkspace();w.example=true;const day='2026-09-17';
  const refs=[['s01','Artificial diets and muscle metabolism','10.3389/fmars.2024.1445902','A public feeding study relevant to metabolic, oxidative and inflammatory endpoints.'],['s02','Live and artificial feed: physiology and bacterial resistance','10.1016/j.fsi.2025.110169','A public comparative feeding study. Bacterial-challenge outcomes must be distinguished from routine farm survival.'],['s03','Diet and transport-stress responses','10.3390/ani15142154','A public study examining diet-associated responses to transport.']];
  for(const [rid,title,doi,note]of refs){w.sources.push(normalizeSource({id:rid,title,url:'https://doi.org/'+doi,access:'metadata only',added:day,note}));w.nodes.push(normalizeNode({id:rid,type:'source',title,summary:note,status:'Bibliographic lead',sourceIds:[],updated:day}));}
  for(const n of [{id:'mandarin-fish',type:'species',title:'Mandarin fish',summary:'Siniperca chuatsi is the first research case. This sample collection contains citation metadata, not a completed species assessment.',species:'Siniperca chuatsi',status:'Research scope'},{id:'feeding-welfare',type:'problem',title:'Welfare during feeding transitions',summary:'How should a change from live prey to formulated feed be assessed across the target fish, prey fish and replacement-feed animals?',species:'Siniperca chuatsi',status:'Question to investigate',sourceIds:['s01','s02','s03']},{id:'feed-transition',type:'intervention',title:'Transition to formulated feed',summary:'A candidate intervention family. Formulation, life stage, transition protocol and comparator must be resolved before judging its effects.',species:'Siniperca chuatsi',status:'Unassessed',sourceIds:['s01','s02','s03'],values:{welfare_benefit:null,business_case:null,actionability:null,uncertainty:null,promisingness:null}}])w.nodes.push(normalizeNode({...n,updated:day}));
  for(const [i,from,to,relation]of [[1,'feed-transition','feeding-welfare','targets'],[2,'feed-transition','mandarin-fish','applies_to'],[3,'s01','feed-transition','informs'],[4,'s02','feed-transition','informs'],[5,'s03','feed-transition','informs']])w.edges.push(normalizeEdge({id:'edge-'+i,from,to,relation,basis:'An organizing link in the sample research collection; not a measured effect or endorsement.'}));
  return validateWorkspace(w);
}
