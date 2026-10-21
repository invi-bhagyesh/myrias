// A long list made easy to move through: a sticky index of groups with counts, filters, a choice between
// one ranked list and a list grouped under headings, and "show more" instead of hundreds of rows at once.
// Used by the Findings and Actions pages.
import { escapeHtml as esc } from './site-lib.js';

// Markup: index on the left (a row of chips on phones), filters and the list on the right.
// filters: [{ key, label, type: 'search' | 'select' | 'check', options: [[value, label]] }]
// views: [[value, label]] for the ranked / grouped toggle (optional).
export function browseHtml({ filters = [], views = [], tr }) {
  const control = f => f.type === 'search'
    ? `<label class="br-f br-search"><span>${esc(f.label)}</span><input type="search" data-bf="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}"></label>`
    : f.type === 'check' ? `<label class="br-f br-check"><input type="checkbox" data-bf="${esc(f.key)}"> <span>${esc(f.label)}</span></label>`
    : `<label class="br-f"><span>${esc(f.label)}</span><select data-bf="${esc(f.key)}"><option value="">${esc(tr('br.all'))}</option>${f.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></label>`;
  return `<div class="br" data-br>
    <aside class="br-index" aria-label="${esc(tr('br.index'))}"><p class="br-index-h">${esc(tr('br.index'))}</p><ol data-b-index></ol></aside>
    <div class="br-main">
      <div class="br-controls">${views.length ? `<div class="graph-tabs br-views" role="group">${views.map(([v, l], i) => `<button type="button" data-bview="${esc(v)}" aria-pressed="${i === 0}">${esc(l)}</button>`).join('')}</div>` : ''}
        <details class="br-fbox" open data-bfbox><summary>${esc(tr('br.filters'))}</summary><div class="br-filters">${filters.map(control).join('')}</div></details></div>
      <div class="br-bar"><p class="br-count" data-b-count aria-live="polite"></p><button type="button" class="br-expand" data-bexpand aria-pressed="false">${esc(tr('br.expand'))}</button></div>
      <div data-b-list></div>
      <button type="button" class="button small br-more" data-b-more hidden></button>
    </div></div>`;
}

// Behaviour. items: the full list, already in rank order. groupOf(item) -> group id; groups: [[id, label]] in
// display order. test(item, values) -> keep or not. render(item) -> <li>. In the grouped view every group
// shows its first `perGroup` items with its own "show more"; in the ranked view the list shows `pageSize`
// at a time. The index always lists the groups with their counts under the current filters.
export function mountBrowse(root, { items, groups, groupOf, test, render, tr, pageSize = 20, perGroup = 6, initialView = null, listClass = '', initial = {} }) {
  const box = root.querySelector('[data-br]');
  // On phones the filters start folded so the list is on the first screen.
  if (window.innerWidth < 860) box.querySelector('[data-bfbox]')?.removeAttribute('open');
  // Filters can start set from the address (a link to one action opens the list filtered to it).
  const values = {};
  box.querySelectorAll('[data-bf]').forEach(el => { const v = initial[el.dataset.bf]; if (v) { if (el.type === 'checkbox') el.checked = true; else el.value = v; values[el.dataset.bf] = el.type === 'checkbox' ? true : v; } });
  let view = initialView || box.querySelector('[data-bview]')?.dataset.bview || 'group';
  let shown = pageSize, expanded = false;
  const applyExpand = () => box.querySelectorAll('[data-b-list] [data-row]').forEach(d => { d.open = expanded; });
  const ex = box.querySelector('[data-bexpand]');
  ex.addEventListener('click', () => { expanded = !expanded; ex.setAttribute('aria-pressed', String(expanded)); ex.textContent = tr(expanded ? 'br.collapse' : 'br.expand'); applyExpand(); });
  const open = new Set();
  const idOf = g => 'br-g-' + String(g).replace(/[^a-z0-9_-]/gi, '-');
  const draw = () => {
    const rows = items.filter(it => test(it, values));
    const byGroup = new Map(groups.map(([g]) => [g, []]));
    for (const it of rows) { const g = groupOf(it); (byGroup.get(g) || byGroup.set(g, []).get(g)).push(it); }
    const label = new Map(groups);
    box.querySelector('[data-b-index]').innerHTML = [...byGroup].filter(([, l]) => l.length).map(([g, l]) =>
      `<li><a href="#${idOf(g)}" data-bjump="${esc(idOf(g))}"><span>${esc(label.get(g) || g)}</span><b>${l.length}</b></a></li>`).join('') || `<li class="br-none">${esc(tr('br.none'))}</li>`;
    box.querySelector('[data-b-count]').textContent = tr('br.count', { n: rows.length.toLocaleString(), total: items.length.toLocaleString() });
    const list = box.querySelector('[data-b-list]'), more = box.querySelector('[data-b-more]');
    if (view === 'rank') {
      list.innerHTML = rows.length ? `<ol class="${esc(listClass)}">${rows.slice(0, shown).map(render).join('')}</ol>` : `<p class="br-none">${esc(tr('br.none'))}</p>`;
      more.hidden = rows.length <= shown;
      more.textContent = tr('br.more', { n: Math.min(pageSize, rows.length - shown) });
    } else {
      list.innerHTML = [...byGroup].filter(([, l]) => l.length).map(([g, l]) => {
        const all = open.has(g), cut = all ? l : l.slice(0, perGroup);
        return `<section class="br-group" id="${idOf(g)}"><h3>${esc(label.get(g) || g)} <span>${l.length}</span></h3><ol class="${esc(listClass)}">${cut.map(render).join('')}</ol>` +
          (l.length > perGroup ? `<button type="button" class="br-gmore" data-bgroup="${esc(g)}">${esc(all ? tr('br.less') : tr('br.gmore', { n: l.length - perGroup }))}</button>` : '') + `</section>`;
      }).join('') || `<p class="br-none">${esc(tr('br.none'))}</p>`;
      more.hidden = true;
      list.querySelectorAll('[data-bgroup]').forEach(b => b.addEventListener('click', () => { const g = b.dataset.bgroup; open.has(g) ? open.delete(g) : open.add(g); draw(); }));
    }
    if (expanded) applyExpand();
    // Filtered down to one item from the address: open it.
    else if (rows.length === 1 && Object.values(initial).some(Boolean)) list.querySelector('[data-row]')?.setAttribute('open', '');
    box.querySelectorAll('[data-bjump]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      if (view === 'rank') { view = 'group'; box.querySelectorAll('[data-bview]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.bview === 'group'))); draw(); }
      document.getElementById(a.dataset.bjump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  };
  box.querySelectorAll('[data-bf]').forEach(el => el.addEventListener(el.type === 'search' ? 'input' : 'change', () => {
    values[el.dataset.bf] = el.type === 'checkbox' ? el.checked : el.value; shown = pageSize; draw();
  }));
  box.querySelectorAll('[data-bview]').forEach(b => b.addEventListener('click', () => {
    view = b.dataset.bview; box.querySelectorAll('[data-bview]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw();
  }));
  box.querySelector('[data-b-more]').addEventListener('click', () => { shown += pageSize; draw(); });
  draw();
}
