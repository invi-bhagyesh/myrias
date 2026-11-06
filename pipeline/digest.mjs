// Daily discovery and weekly publication of China-focused animal welfare links, in any language.
// See pipeline/digest/METHOD.md for keys, schedules and recovery.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chinaDay, shiftDate, completedWeek, validDate, inWindow, dedupe, titleLanguage } from './digest/core.mjs';
import { READERS, createClient } from './digest/readers.mjs';
import { readState, importIssues, sourceWindow, ingest, recordRun, assembleIssue, publishIssue, rebuildIndex, writeJson } from './digest/state.mjs';
export * from './digest/core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function collect({ sources, terms, from, to, only = null, ua, state = { sources: {} }, env = process.env, request = createClient(), backfill = false }) {
  if (!validDate(from) || !validDate(to) || from > to) throw new Error('invalid collection date window');
  if (only?.some(id => !sources.some(s => s.id === id))) throw new Error('unknown source in --only');
  const status = [], all = [];
  for (const src of sources) {
    if (only && !only.includes(src.id)) continue;
    if (src.enabled === false || src.access.key_env && !env[src.access.key_env]) {
      status.push({ id: src.id, status: 'skipped', reason: src.enabled === false ? 'disabled' : `configure ${src.access.key_env}` });
      continue;
    }
    const window = sourceWindow(state, src, to, from);
    try {
      if (!READERS[src.access.type]) throw new Error('unknown source access type');
      const { items, scanned } = await READERS[src.access.type](src, { ...window, ua, terms, env, request, backfill });
      // Future-dated papers remain queued until their issue date; do not lose them after their index window passes.
      const kept = dedupe(items.filter(i => src.kind === 'paper' || inWindow(i.date, window.from, to)));
      for (const item of kept) {
        if (!/^https?:\/\//.test(item.url || '') || !item.title) throw new Error('invalid article URL or title');
      }
      all.push(...kept.map(item => ({ ...item, source: src.id, kind: src.kind, lang: item.lang || 'zh', title_lang: item.title_lang || titleLanguage(item.title) })));
      status.push({ id: src.id, status: kept.length ? 'ok' : 'empty', scanned, relevant: items.length, in_window: kept.length, undated: items.filter(i => !i.date).length, ...window });
    } catch (e) {
      let error = String(e.message || e);
      for (const key of sources.map(s => s.access.key_env).filter(Boolean)) if (env[key]) error = error.split(env[key]).join('[redacted]');
      status.push({ id: src.id, status: 'failed', error: error.slice(0, 200), ...window });
    }
  }
  const items = dedupe(all);
  for (const s of status) if (['ok', 'empty'].includes(s.status)) s.in_window = items.filter(i => i.source === s.id).length;
  return { items, observations: all, status };
}

export function parseArgs(args, now = new Date()) {
  const flags = new Set(['dry-run', 'collect-only', 'publish-only', 'backfill', 'weekly']);
  const values = new Set(['from', 'to', 'sources', 'out', 'state', 'only']);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i].replace(/^--/, '');
    if (args[i] !== '--' + name || !flags.has(name) && !values.has(name)) throw new Error(`unknown argument: ${args[i]}`);
    if (flags.has(name)) options[name] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`missing value for --${name}`);
      options[name] = args[++i];
    }
  }
  if (options['collect-only'] && options['publish-only']) throw new Error('choose collection or publication');
  const week = completedWeek(now);
  const to = options.to || (options.weekly ? week.to : shiftDate(chinaDay(now), -1));
  const from = options.from || shiftDate(to, -6);
  if (!validDate(from) || !validDate(to) || from > to || to >= chinaDay(now)) throw new Error('use a valid window ending on a completed day in Beijing');
  if (options.only && !options['collect-only'] && !options['dry-run']) throw new Error('--only requires --collect-only or --dry-run');
  return { ...options, from, to };
}

export async function main(args = process.argv.slice(2), { now = new Date(), request, env = process.env } = {}) {
  const options = parseArgs(args, now);
  const registry = JSON.parse(readFileSync(options.sources || join(HERE, 'digest/sources.json'), 'utf8'));
  const terms = JSON.parse(readFileSync(join(HERE, 'digest/terms.json'), 'utf8'));
  const out = options.out || 'public/data/digest';
  const statePath = options.state || 'pipeline/digest/state.json';
  const state = readState(statePath);
  importIssues(state, out);
  const timestamp = now.toISOString();
  let result = null;
  if (!options['publish-only']) {
    result = await collect({ ...options, sources: registry.sources, terms, only: options.only?.split(','), ua: registry.user_agent, state, env, request, backfill: options.backfill });
    console.log(JSON.stringify({ from: options.from, to: options.to, candidates: result.items.length, sources: result.status }, null, 2));
    if (!result.status.some(s => ['ok', 'empty'].includes(s.status))) throw new Error('no source succeeded; existing data has been preserved');
    ingest(state, result.observations, timestamp);
    recordRun(state, result.status, options.to, timestamp);
  }
  let issue;
  if (!options['collect-only']) {
    if (!Object.values(state.sources).some(s => s.last_success >= options.to)) throw new Error('collect through the issue end before publishing');
    const assembled = assembleIssue(state, registry, { ...options, now: timestamp });
    issue = assembled.issue;
    const path = join(out, `${issue.id}.json`);
    if (!existsSync(path) && !options['dry-run']) publishIssue(out, issue, assembled.selected);
    else if (existsSync(path)) {
      issue = JSON.parse(readFileSync(path, 'utf8'));
      if (!options['dry-run']) rebuildIndex(out);
      console.log(`Issue ${issue.id} already exists; left unchanged. Newly discovered items stay queued.`);
    }
    console.log(JSON.stringify({ issue: issue.id, items: issue.items.length, partial: issue.partial }));
  }
  if (!options['dry-run']) writeJson(statePath, state);
  return { result, issue, state };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exitCode = 1; });
