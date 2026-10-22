// Keep earlier versions: after a run changes the release, archive what the previous release said about every
// claim, finding and action that changed or went, so the site can show earlier versions beside the current one.
//   node pipeline/versions.mjs --old OLD_RELEASE_DIR --new public/data --run run-2 [--version 0.3.0] [--as-of 2026-10-21]
// OLD_RELEASE_DIR holds the previous release files (release.json and the claim, finding and action files it
// lists). --run names the run that produced that previous release. Writes into the new release folder:
//   versions/<run>/claims.json    previous record of every claim whose public record changed or went
//   versions/<run>/findings.json  previous record of every finding whose sentence, claims or strength changed, or that went
//   versions/<run>/actions.json   the whole previous set of actions (each run drafts and ranks them afresh)
//   versions.json                 one entry per archived version, newest first: counts, and which ids changed,
//                                 so a page knows whether to offer an earlier version without loading it
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const js = p => JSON.parse(readFileSync(p, 'utf8'));
export function loadRelease(dir) {
  const rel = js(join(dir, 'release.json'));
  const part = files => (files || []).flatMap(f => js(join(dir, f)));
  return { rel, claims: part(rel.claim_files), findings: part(rel.finding_files), actions: part(rel.action_files) };
}

const stable = x => JSON.stringify(x, Object.keys(x).sort());
const findingKey = f => JSON.stringify([f.statement_en, f.statement_zh, [...(f.claim_ids || [])].sort(), f.strength]);

// Pure: what changed between two releases, with the previous records of everything that changed or went.
export function diffReleases(oldR, newR) {
  const nc = new Map(newR.claims.map(c => [c.id, c])), nf = new Map(newR.findings.map(f => [f.id, f]));
  const claims = oldR.claims.filter(c => !nc.has(c.id) || stable(nc.get(c.id)) !== stable(c)).map(c => ({ ...c, _change: nc.has(c.id) ? 'changed' : 'gone' }));
  const findings = oldR.findings.filter(f => !nf.has(f.id) || findingKey(nf.get(f.id)) !== findingKey(f)).map(f => ({ ...f, _change: nf.has(f.id) ? 'changed' : 'gone' }));
  return { claims, findings, actions: oldR.actions };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
  const oldR = loadRelease(arg('old')), out = arg('new'), newR = loadRelease(out), run = arg('run');
  const d = diffReleases(oldR, newR);
  const dir = join(out, 'versions', run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'claims.json'), JSON.stringify(d.claims) + '\n');
  writeFileSync(join(dir, 'findings.json'), JSON.stringify(d.findings) + '\n');
  writeFileSync(join(dir, 'actions.json'), JSON.stringify(d.actions) + '\n');
  const idxPath = join(out, 'versions.json');
  const idx = existsSync(idxPath) ? js(idxPath) : { versions: [] };
  const entry = { run, version: arg('version', oldR.rel.release?.version || null), as_of: arg('as-of', oldR.rel.release?.as_of || null), replaced_by: newR.rel.release?.version || null,
    counts: { claims: oldR.claims.length, findings: oldR.findings.length, actions: oldR.actions.length },
    changed: { claims: d.claims.map(c => c.id), findings: d.findings.map(f => f.id) },
    files: { claims: `versions/${run}/claims.json`, findings: `versions/${run}/findings.json`, actions: `versions/${run}/actions.json` } };
  idx.versions = [entry, ...idx.versions.filter(v => v.run !== run)];
  writeFileSync(idxPath, JSON.stringify(idx, null, 1) + '\n');
  console.log({ run, claims_changed_or_gone: d.claims.length, findings_changed_or_gone: d.findings.length, actions_archived: d.actions.length });
}
