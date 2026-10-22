// Run log: one entry per run, kept in STORE/run-log.json, so the site can show what each run read, how it was
// set up, what changed since the run before, how long each step took and what the run added or changed.
//   node pipeline/runlog.mjs start   --store STORE --run run-3 --title "..." [--inputs FILE.json] [--release REL] [--note "..."]... [--planned]
//   node pipeline/runlog.mjs finish  --store STORE --run run-3 --root RUN_DIR --release public/data/release.json [--note "..."]...
//   node pipeline/runlog.mjs note    --store STORE --run run-3 --note "..."
//   node pipeline/runlog.mjs publish --store STORE --out public/data/runs.json
// start snapshots the settings (model per stage, a fingerprint and version of every prompt, the ranking spec's
// checksum), the code version, and the store as it stands (claims, papers, each finding's claim set, each
// action), and lists what changed since the previous run: models, prompts, the spec, and the commits that
// touched pipeline/ since that run ended. Notes are written by people, for what code cannot see. With --planned the
// entry is shown as planned; running start again without it begins the run, with a fresh snapshot, keeping the notes.
// finish reads the run's step records (RUN_DIR/ledger.jsonl, written by step.mjs) and compares the store and
// release with the snapshot: claims and papers added, findings new, rewritten, unchanged or gone, actions.
// publish writes the site file without model costs (they stay in the private store).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { CONFIG } from './llm.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const args = n => process.argv.flatMap((a, i) => (a === '--' + n ? [process.argv[i + 1]] : []));
const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
const jl = p => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const js = (p, d = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const here = dirname(new URL(import.meta.url).pathname);
const git = cmd => { try { return execSync(`git ${cmd}`, { cwd: here, encoding: 'utf8' }).trim(); } catch { return ''; } };

// The prompt behind each stage: its version where the module declares one, and a fingerprint of the system
// prompt and schema, so a changed prompt shows even when nobody bumped its version.
export async function promptSettings() {
  const P = await import('./prompts.mjs');
  const mods = { reconcile: ['reconcile.mjs', 'RECONCILE'], cluster: ['cluster.mjs', 'CLUSTER'], findings: ['findings.mjs', 'FINDINGS'],
    actions: ['actions.mjs', 'ACTIONS'], rank: ['rank.mjs', 'RANK'], affiliations: ['affiliations.mjs', 'AFFIL'] };
  const out = {
    extract: { version: P.PROMPT_VERSION, sha: sha(P.EXTRACT_SYSTEM + JSON.stringify(P.EXTRACT_SCHEMA)) },
    map: { version: null, sha: sha(P.MAP_SYSTEM + JSON.stringify(P.MAP_SCHEMA)) },
    verify: { version: null, sha: sha(P.VERIFY_SYSTEM + JSON.stringify(P.VERIFY_SCHEMA)) }
  };
  out.translate = { version: P.RENDER_VERSION, sha: sha(P.RENDER_SYSTEM + JSON.stringify(P.RENDER_SCHEMA)) };
  for (const [stage, [file, name]] of Object.entries(mods)) {
    const m = await import('./' + file);
    out[stage] = { version: m[name + '_VERSION'] || null, sha: m[name + '_SYSTEM'] ? sha(m[name + '_SYSTEM'] + JSON.stringify(m[name + '_SCHEMA'] || '')) : null };
  }
  return out;
}

// The stages a run uses, in pipeline order (models.json also keeps settings for stages no run uses now).
export const RUN_STAGES = ['extract', 'map', 'verify', 'translate', 'reconcile', 'embed', 'cluster', 'findings', 'actions', 'rank', 'affiliations'];
export function modelSettings(profile = 'demo') {
  const p = CONFIG.profiles[profile];
  return Object.fromEntries(RUN_STAGES.filter(k => p[k]?.model).map(k => [k, p[k].model]));
}

// Pure: what changed between two settings snapshots, as plain entries.
export function settingsChanges(prev, cur) {
  const out = [];
  if (!prev) return out;
  for (const [stage, model] of Object.entries(cur.models || {})) {
    const was = prev.models?.[stage];
    if (!was) out.push({ kind: 'model', stage, en: `New stage ${stage}, on ${model}.` });
    else if (was !== model) out.push({ kind: 'model', stage, en: `${stage}: model ${was} → ${model}.` });
  }
  for (const stage of Object.keys(prev.models || {})) if (!(stage in (cur.models || {}))) out.push({ kind: 'model', stage, en: `Stage ${stage} removed.` });
  for (const [stage, p] of Object.entries(cur.prompts || {})) {
    const was = prev.prompts?.[stage];
    if (!was) continue;
    if (was.version && p.version && was.version !== p.version) out.push({ kind: 'prompt', stage, en: `${stage}: prompt ${was.version} → ${p.version}.` });
    else if (was.sha && p.sha && was.sha !== p.sha) out.push({ kind: 'prompt', stage, en: `${stage}: prompt changed (same version label).` });
  }
  if (prev.spec_sha && cur.spec_sha && prev.spec_sha !== cur.spec_sha) out.push({ kind: 'spec', en: `Ranking spec changed (${prev.spec_sha} → ${cur.spec_sha}).` });
  return out;
}

// Pure: compare the store and release before and after a run.
export function results(before, after) {
  const fb = before.findings || {}, fa = after.findings || {};
  const ids = new Set([...Object.keys(fb), ...Object.keys(fa)]);
  const f = { new: 0, rewritten: 0, unchanged: 0, gone: 0, total: Object.keys(fa).length };
  for (const id of ids) {
    if (!(id in fb)) f.new++; else if (!(id in fa)) f.gone++; else if (fb[id] !== fa[id]) f.rewritten++; else f.unchanged++;
  }
  const ab = new Set((before.actions || []).map(a => a.text)), aa = after.actions || [];
  return {
    claims: { before: before.claims, after: after.claims, added: after.claims - before.claims },
    papers: { before: before.papers, after: after.papers, added: after.papers - before.papers },
    findings: f,
    actions: { before: (before.actions || []).length, after: aa.length, same_text: aa.filter(a => ab.has(a.text)).length,
      top: aa.filter(a => a.rank).sort((x, y) => x.rank - y.rank).slice(0, 5).map(a => ({ id: a.id, rank: a.rank, text: a.text })) }
  };
}

function storeSnapshot(store, releasePath) {
  const claims = jl(join(store, 'claims.jsonl')).length;
  const papers = Object.keys(js(join(store, 'sources.json'), {})).length;
  const findings = Object.fromEntries(jl(join(store, 'findings.jsonl')).map(f => [f.id, f.claims_hash || sha((f.claim_ids || []).join(','))]));
  let actions = [];
  if (releasePath && existsSync(releasePath)) {
    const rel = js(releasePath), dir = dirname(releasePath);
    actions = (rel.action_files || []).flatMap(f => js(join(dir, f), [])).map(a => ({ id: a.id, rank: a.rank, text: a.action_en }));
  }
  return { claims, papers, findings, actions };
}

const logPath = store => join(store, 'run-log.json');
const load = store => js(logPath(store), []);
const save = (store, log) => writeFileSync(logPath(store), JSON.stringify(log, null, 1) + '\n');

async function start(store) {
  let log = load(store); const run = arg('run');
  const old = log.find(r => r.id === run);
  if (old && old.status !== 'planned') throw new Error(`${run} is already in the log`);
  log = log.filter(r => r.id !== run);
  const prev = [...log].reverse().find(r => r.status === 'done') || null;
  const specPath = join(here, 'priority-spec.md');
  const settings = { profile: 'demo', models: modelSettings('demo'), prompts: await promptSettings(), spec_sha: existsSync(specPath) ? sha(readFileSync(specPath, 'utf8')) : null };
  const since = prev?.finished || prev?.started || null;
  const commits = since ? git(`log --since="${since}" --format=%h%x09%ad%x09%s --date=short -- .`).split('\n').filter(Boolean).map(l => { const [h, d, ...s] = l.split('\t'); return { commit: h, date: d, en: s.join('\t') }; }) : [];
  const planned = process.argv.includes('--planned');
  const entry = { id: run, title_en: arg('title', old?.title_en || run), status: planned ? 'planned' : 'running', started: planned ? null : new Date().toISOString(), finished: null,
    git: { commit: git('rev-parse --short HEAD'), branch: git('rev-parse --abbrev-ref HEAD') }, inputs: arg('inputs') ? js(arg('inputs')) : old?.inputs || null, settings,
    changes: { since: prev?.id || null, settings: settingsChanges(prev?.settings, settings), code: commits, notes: [...(old?.changes?.notes || []), ...args('note').map(en => ({ en, at: new Date().toISOString() }))] },
    baseline: storeSnapshot(store, arg('release')), steps: [], results: null };
  log.push(entry); save(store, log);
  console.log({ run, since: prev?.id || null, settings_changes: entry.changes.settings.length, code_commits: commits.length, notes: entry.changes.notes.length });
}

function finish(store) {
  const log = load(store), e = log.find(r => r.id === arg('run'));
  if (!e) throw new Error(`${arg('run')} is not in the log; run start first`);
  e.steps = jl(join(arg('root'), 'ledger.jsonl')).map(r => ({ phase: r.phase, step: r.step, started: r.started, seconds: r.seconds, calls: r.calls ?? null,
    cost_usd: r.cost_usd ?? null, exit_code: r.exit_code, rows_out: (r.outputs || []).reduce((m, o) => Math.max(m, o.rows || 0), 0) || null }));
  e.results = results(e.baseline, storeSnapshot(store, arg('release')));
  for (const en of args('note')) e.changes.notes.push({ en, at: new Date().toISOString() });
  e.finished = new Date().toISOString(); e.status = 'done';
  save(store, log);
  console.log({ run: e.id, steps: e.steps.length, results: e.results });
}

function note(store) {
  const log = load(store), e = log.find(r => r.id === arg('run'));
  if (!e) throw new Error(`${arg('run')} is not in the log`);
  for (const en of args('note')) e.changes.notes.push({ en, at: new Date().toISOString() });
  save(store, log);
}

// The site file: every run, newest first, with no costs and no snapshot internals.
export function publicLog(log) {
  return log.map(({ baseline, ...e }) => ({ ...e, steps: (e.steps || []).map(({ cost_usd, ...s }) => s) })).reverse();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], store = arg('store');
  if (cmd === 'start') await start(store);
  else if (cmd === 'finish') finish(store);
  else if (cmd === 'note') note(store);
  else if (cmd === 'publish') { const runs = publicLog(load(store)); writeFileSync(arg('out'), JSON.stringify({ as_of: new Date().toISOString().slice(0, 10), runs }, null, 1) + '\n'); console.log({ runs: runs.length }); }
  else { console.error('usage: runlog.mjs start|finish|note|publish --store STORE ...'); process.exit(1); }
}
