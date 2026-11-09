import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { identityKeys, shiftDate, validDate } from './core.mjs';

export const emptyState = () => ({ version: 1, records: [], sources: {} });

export function readState(path) {
  if (!existsSync(path)) return emptyState();
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (state.version !== 1 || !Array.isArray(state.records) || !state.sources || typeof state.sources !== 'object') throw new Error('invalid digest state; refusing to reset it');
  if (state.records.some(r => !Array.isArray(r.keys) || !r.keys.length || !r.item?.title || !r.item?.url || !r.first_seen_at)) throw new Error('invalid digest records; refusing to reset them');
  return state;
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  renameSync(temp, path);
}

// Whitelist metadata: abstracts, affiliation text and response bodies never enter the repository.
const FIELDS = ['source', 'kind', 'provider_id', 'doi', 'url', 'title', 'date', 'indexed_at', 'lang', 'title_lang', 'china_basis', 'venue', 'tier', 'matched'];
function metadata(item) {
  return Object.fromEntries(FIELDS.filter(k => item[k] != null).map(k => [k, item[k]]));
}

export function ingest(state, items, timestamp, issuedIn = null) {
  const lookup = new Map();
  for (const record of state.records) for (const key of record.keys) lookup.set(key, record);
  let added = 0;
  for (const item of items) {
    const keys = identityKeys(item);
    const matches = [...new Set(keys.map(k => lookup.get(k)).filter(Boolean))];
    let record = matches.find(r => r.issued_in) || matches[0];
    if (!record) {
      record = { id: createHash('sha256').update(keys[0]).digest('hex').slice(0, 24), keys: [], first_seen_at: timestamp, item: metadata(item) };
      state.records.push(record); added++;
    }
    // A later DOI can connect earlier provider records. Retain every alias.
    for (const other of matches.filter(r => r !== record)) {
      record.keys.push(...other.keys);
      record.first_seen_at = [record.first_seen_at, other.first_seen_at].sort()[0];
      state.records.splice(state.records.indexOf(other), 1);
    }
    record.keys = [...new Set([...record.keys, ...keys])];
    record.keys.forEach(k => lookup.set(k, record));
    record.last_seen_at = [record.last_seen_at || timestamp, timestamp].sort().at(-1);
    for (const k of ['doi', 'indexed_at', 'date', 'title_lang', 'china_basis']) if (!record.item[k] && item[k]) record.item[k] = item[k];
    if (issuedIn) record.issued_in ||= issuedIn;
  }
  return added;
}

export function importIssues(state, out) {
  if (!existsSync(out)) return;
  for (const file of readdirSync(out).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()) {
    const issue = JSON.parse(readFileSync(join(out, file), 'utf8'));
    if (!validDate(issue.id) || !Array.isArray(issue.items)) throw new Error(`invalid existing issue ${file}`);
    ingest(state, issue.items, issue.generated_at || `${issue.to}T23:59:59Z`, issue.id);
  }
}

export function sourceWindow(state, source, to, from) {
  const last = state.sources[source.id]?.last_success;
  return { from: last && last < to ? shiftDate(last, -2) : from, to };
}

export function recordRun(state, statuses, to, timestamp) {
  for (const status of statuses) {
    const previous = state.sources[status.id] || {};
    state.sources[status.id] = { ...previous, latest: status, checked_at: timestamp };
    if (['ok', 'empty'].includes(status.status)) state.sources[status.id].last_success = previous.last_success && previous.last_success > to ? previous.last_success : to;
  }
}

export function assembleIssue(state, registry, { from, to, now }) {
  const selected = state.records.filter(r => !r.issued_in && (!r.item.date || r.item.date <= to) && r.first_seen_at <= now);
  const tiers = { welfare: 0, related: 1, mention: 2, animal: 3 };
  const items = selected.map(r => ({ ...r.item, first_seen_at: r.first_seen_at })).sort((a, b) => tiers[a.tier] - tiers[b.tier] || String(b.date || '').localeCompare(String(a.date || '')));
  const sources = registry.sources.map(src => ({ id: src.id, name_zh: src.name_zh, name_en: src.name_en, kind: src.kind,
    ...(state.sources[src.id]?.latest || { status: 'skipped', reason: 'not collected' }),
    in_window: items.filter(i => i.source === src.id).length,
    checked_at: state.sources[src.id]?.checked_at || null }));
  for (const src of sources) if (['ok', 'empty'].includes(src.status) && state.sources[src.id]?.last_success < to) src.status = 'stale';
  const issue = { id: to, from, to, generated_at: now, date_basis: 'discovery',
    counts: { items: items.length, welfare: items.filter(i => i.tier === 'welfare').length },
    partial: sources.some(s => ['failed', 'skipped', 'stale'].includes(s.status)), sources, not_used: registry.not_used, items };
  return { issue, selected };
}

export function rebuildIndex(out) {
  const issues = readdirSync(out).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(file => {
    const d = JSON.parse(readFileSync(join(out, file), 'utf8'));
    return { id: d.id, from: d.from, to: d.to, items: d.items.length, welfare: d.items.filter(i => i.tier === 'welfare').length, file };
  }).sort((a, b) => b.id.localeCompare(a.id));
  const path = join(out, 'index.json');
  if (existsSync(path)) {
    try { if (isDeepStrictEqual(JSON.parse(readFileSync(path, 'utf8')), { issues })) return; } catch { /* Repair an interrupted or invalid index. */ }
  }
  writeJson(path, { issues });
}

export function publishIssue(out, issue, selected) {
  const path = join(out, `${issue.id}.json`);
  if (existsSync(path)) throw new Error(`issue ${issue.id} already exists; refusing to overwrite it`);
  // The next run imports identities if interrupted after the issue write.
  writeJson(path, issue);
  rebuildIndex(out);
  for (const record of selected) record.issued_in = issue.id;
}
