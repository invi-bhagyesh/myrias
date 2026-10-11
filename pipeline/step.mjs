// Run one pipeline step and record exactly what it did.
//   node pipeline/step.mjs --root RUNDIR --phase B --step 02-extract --in a.jsonl[,b] --out RUNDIR/B/02-extract -- node pipeline/run.mjs ...
// Steps are numbered folders under RUNDIR/<phase>/ so their order is visible. Each gets DIR/step.json:
// run, phase, step, start and finish times, the command, the git commit, every input and output file
// with its size, row count and sha256, the models called, how many calls and what they cost. One line
// per step is appended to RUNDIR/ledger.jsonl, so the whole run reads in order in one file.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';
import { join, basename } from 'node:path';

export function fileInfo(path) {
  const data = readFileSync(path);
  const rows = /\.(jsonl|csv)$/.test(path) ? data.toString('utf8').split('\n').filter(Boolean).length : null;
  return { path, bytes: data.length, rows, sha256: createHash('sha256').update(data).digest('hex') };
}

// Pure: what the call logs of a step say: calls, cost, models, finish reasons.
export function callSummary(lines) {
  const calls = lines.filter(Boolean).map(l => JSON.parse(l));
  const models = {};
  for (const c of calls) {
    const m = models[c.model || c.requested_model || 'unknown'] ||= { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };
    m.calls++; m.cost_usd += c.cost_usd || 0; m.input_tokens += c.input_tokens || 0; m.output_tokens += c.output_tokens || 0;
  }
  const finish = {}; for (const c of calls) finish[c.finish || 'unknown'] = (finish[c.finish || 'unknown'] || 0) + 1;
  for (const m of Object.values(models)) m.cost_usd = Math.round(m.cost_usd * 1e6) / 1e6;
  return { calls: calls.length, cost_usd: Math.round(calls.reduce((s, c) => s + (c.cost_usd || 0), 0) * 1e6) / 1e6, models, finish };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sep = process.argv.indexOf('--');
  const own = process.argv.slice(2, sep < 0 ? undefined : sep), cmd = sep < 0 ? [] : process.argv.slice(sep + 1);
  const arg = n => { const i = own.indexOf('--' + n); return i < 0 ? null : own[i + 1]; };
  const root = arg('root'), phase = arg('phase'), step = arg('step'), out = arg('out');
  if (!root || !phase || !step || !out || !cmd.length) { console.error('usage: step.mjs --root DIR --phase P --step NN-name --out DIR [--in files] -- command…'); process.exit(2); }
  mkdirSync(out, { recursive: true });
  const inputs = (arg('in') || '').split(',').filter(Boolean).map(fileInfo);
  let commit = null; try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ }
  const started = new Date().toISOString();
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
  const finished = new Date().toISOString();
  writeFileSync(join(out, 'stdout.log'), r.stdout || ''); writeFileSync(join(out, 'stderr.log'), r.stderr || '');
  const files = readdirSync(out).filter(f => f !== 'step.json' && statSync(join(out, f)).isFile());
  const callLines = files.filter(f => f.endsWith('calls.jsonl')).flatMap(f => readFileSync(join(out, f), 'utf8').split('\n'));
  const meta = {
    run: basename(root), phase, step, started, finished, seconds: Math.round((Date.parse(finished) - Date.parse(started)) / 1000),
    exit_code: r.status, command: cmd.join(' '), git_commit: commit, inputs,
    outputs: files.filter(f => !f.endsWith('.log')).map(f => fileInfo(join(out, f))), ...callSummary(callLines)
  };
  writeFileSync(join(out, 'step.json'), JSON.stringify(meta, null, 1));
  appendFileSync(join(root, 'ledger.jsonl'), JSON.stringify({ run: meta.run, phase, step, started, finished, exit_code: r.status, calls: meta.calls, cost_usd: meta.cost_usd, outputs: meta.outputs.map(o => ({ path: basename(o.path), rows: o.rows })) }) + '\n');
  process.stdout.write(r.stdout || '');
  if (r.status !== 0) { process.stderr.write(r.stderr || ''); process.exit(r.status || 1); }
}
