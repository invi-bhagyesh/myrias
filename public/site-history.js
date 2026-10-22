// Earlier versions of claims, findings and actions, from data/versions.json (written by pipeline/versions.mjs)
// and the archived files it lists. A page offers an earlier version only when the index says the item changed;
// the archived file loads when the reader opens it.
import { escapeHtml as esc } from './site-lib.js';

const cache = new Map();
export const loadVersionFile = path => {
  if (!cache.has(path)) cache.set(path, fetch('data/' + path).then(r => (r.ok ? r.json() : [])).catch(() => []));
  return cache.get(path);
};

// The archived versions that hold an earlier record of this item, newest first.
export const versionsOf = (V, kind, id) => (V?.versions || []).filter(v => v.changed?.[kind]?.includes(id));

export function historyHtml(V, kind, id, tr, { open = false } = {}) {
  const vs = versionsOf(V, kind, id);
  if (!vs.length) return '';
  return `<details class="hist" data-hist="${esc(kind)}" data-hist-id="${esc(id)}"${open ? ' open' : ''}><summary>${esc(tr('hist.earlier', { n: vs.length }))}</summary>
    <div class="hist-body" data-hist-body><p class="small-note">${esc(tr('loading'))}</p></div></details>`;
}

// Fill each history block the first time it is opened. render(kind, record, version) -> HTML.
export function mountHistory(root, V, render) {
  root.querySelectorAll('[data-hist]').forEach(d => {
    const fill = async () => {
      if (!d.open || d.dataset.done) return;
      d.dataset.done = '1';
      const kind = d.dataset.hist, id = d.dataset.histId;
      const parts = await Promise.all(versionsOf(V, kind, id).map(async v => [v, (await loadVersionFile(v.files[kind])).find(x => x.id === id)]));
      d.querySelector('[data-hist-body]').innerHTML = parts.filter(([, x]) => x).map(([v, x]) => render(kind, x, v)).join('');
    };
    d.addEventListener('toggle', fill);
    fill();
  });
}

// The heading of one archived version: which run it came from and whether the item changed or went.
export const versionHead = (v, x, tr) => `<p class="hist-when">${esc(tr('hist.asof', { run: v.run, v: v.version || '—', d: v.as_of || '' }))}${x?._change ? ` · <span class="hist-ch">${esc(tr('hist.' + x._change))}</span>` : ''}</p>`;
