// Restore the collector's checkpoint and unmerged issues onto the current main checkout.
// Files already on main win: editors may have corrected an issue since the last automated run.
import { existsSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, writeJson, rebuildIndex } from './state.mjs';

export function restore(snapshot, root = '.') {
  const state = join(snapshot, 'pipeline/digest/state.json');
  if (existsSync(state)) writeJson(join(root, 'pipeline/digest/state.json'), readState(state));
  const archived = join(snapshot, 'public/data/digest'), out = join(root, 'public/data/digest');
  mkdirSync(out, { recursive: true });
  if (existsSync(archived)) for (const file of readdirSync(archived).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
    if (!existsSync(join(out, file))) copyFileSync(join(archived, file), join(out, file));
  }
  rebuildIndex(out);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('snapshot directory required');
  restore(process.argv[2]);
}
