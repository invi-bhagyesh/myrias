// Pure helpers for the public site. No DOM access, so they can be tested in Node.

export const SCHEMA = 'myrias-landscape/1';
export const VERIFICATION = ['unchecked', 'supported', 'partial', 'unsupported'];
export const PUBLIC_VERIFICATION = ['supported', 'partial'];
export const KINDS = ['measured', 'claimed', 'reported_background', 'inferred', 'speculative'];
export const POLARITY = ['supportive', 'counterevidence', 'null', 'mixed', 'descriptive'];
export const CELL_STATUS = ['has_records', 'probed_empty', 'not_collected'];

// Pick a localized field: obj.field_<lang>, then obj.field_en, then obj.<lang>, then obj.field.
export function pick(obj, field, lang) {
  if (!obj) return '';
  const candidates = [obj[`${field}_${lang}`], obj[`${field}_en`], obj[lang], obj.en, obj[field]];
  for (const value of candidates) if (typeof value === 'string' && value) return value;
  return '';
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function safeUrl(value) {
  if (!value) return '';
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
  } catch { return ''; }
}

const byId = list => new Map((list || []).map(x => [x.id, x]));

// Rows = welfare problems, columns = technology classes. Each cell is one of
// has_records / probed_empty / not_collected, never a silent blank.
export function buildMatrix(data, speciesId = 'all') {
  const species = speciesId === 'all' ? data.species : data.species.filter(s => s.id === speciesId);
  const speciesIds = new Set(species.map(s => s.id));
  const apps = data.applications.filter(a => speciesIds.has(a.species_id));
  const statusKey = (sp, p, c) => `${sp}|${p}|${c}`;
  const marked = new Map((data.cells_status || []).map(x => [statusKey(x.species_id, x.welfare_problem, x.technology_class), x.status]));
  const rows = data.taxonomy.welfare_problems.map(problem => ({
    problem,
    cells: data.taxonomy.technology_classes.map(cls => {
      const applications = apps.filter(a => a.welfare_problem === problem.id && a.technology_class === cls.id);
      let status = 'not_collected';
      if (applications.length) status = 'has_records';
      else if (species.length && species.every(s => marked.get(statusKey(s.id, problem.id, cls.id)) === 'probed_empty')) status = 'probed_empty';
      return { problem_id: problem.id, class_id: cls.id, status, applications };
    })
  }));
  return { columns: data.taxonomy.technology_classes, rows };
}

export function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// A leading BOM lets Excel open Chinese text correctly.
export function toCSV(rows, columns) {
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) lines.push(columns.map(c => csvEscape(row[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function claimRow(claim, data) {
  const source = (data.sources || []).find(s => s.id === claim.source_id);
  return {
    claim_id: claim.id,
    species_id: claim.species_id,
    source_id: claim.source_id,
    source_title: source ? source.title : '',
    page: claim.locator?.page ?? '',
    char_start: claim.locator?.start ?? '',
    char_end: claim.locator?.end ?? '',
    quote: claim.quote,
    quote_lang: claim.quote_lang,
    statement_record: claim.statement || '',
    statement_record_lang: claim.statement_lang || '',
    statement_en: claim.text_en || '',
    statement_en_derived: claim.rendering ? 'yes' : (claim.statement && claim.statement_lang !== 'en' ? '' : 'no'),
    rendering_model: claim.rendering?.model || '',
    statement_zh: claim.text_zh || '',
    kind: claim.kind,
    outcome: claim.outcome || '',
    direction: claim.direction || '',
    magnitude: claim.magnitude || '',
    welfare_link: claim.welfare_link,
    verification: claim.verification,
    audit: claim.audit
  };
}

// The text to show for a claim: in the Chinese view the record; in the English view the derived
// rendering, falling back to the record when there is none. Says which one it returned.
export function claimText(claim, lang) {
  if (lang === 'zh') {
    const t = claim.text_zh || (claim.statement_lang === 'zh' ? claim.statement : '') || claim.text_en || claim.statement || '';
    return { text: t, derived: !claim.text_zh && !(claim.statement_lang === 'zh') && !!claim.text_en };
  }
  if (claim.text_en) return { text: claim.text_en, derived: !!(claim.statement && claim.statement_lang !== 'en') };
  return { text: claim.statement || '', derived: false };
}

export function formatLocator(locator) {
  if (!locator) return '';
  const parts = [];
  if (locator.page !== undefined && locator.page !== null) parts.push(`p. ${locator.page}`);
  if (locator.start !== undefined && locator.end !== undefined) parts.push(`chars ${locator.start}–${locator.end}`);
  return parts.join(' · ');
}

export function formatPercent(x) {
  return typeof x === 'number' && Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—';
}

// Returns a list of problems; empty means the export is publishable.
export function validateExport(data) {
  const errors = [];
  const fail = msg => errors.push(msg);
  if (!data || typeof data !== 'object') return ['Export is not an object.'];
  if (data.schema !== SCHEMA) fail(`schema must be ${SCHEMA}`);
  if (!data.release || typeof data.release.sample !== 'boolean') fail('release.sample must be true or false');
  for (const key of ['species', 'sources', 'claims', 'interventions', 'applications', 'cells_status', 'runs']) {
    if (!Array.isArray(data[key])) fail(`${key} must be an array`);
  }
  if (errors.length) return errors;
  const tax = data.taxonomy || {};
  for (const key of ['technology_classes', 'welfare_problems', 'maturity', 'outcome_evidence']) {
    if (!Array.isArray(tax[key]) || !tax[key].length) fail(`taxonomy.${key} must be a non-empty array`);
  }
  if (errors.length) return errors;

  const ids = (name, list) => {
    const seen = new Set();
    for (const x of list) {
      if (!x.id) fail(`${name}: record without id`);
      else if (seen.has(x.id)) fail(`${name}: duplicate id ${x.id}`);
      seen.add(x.id);
    }
    return seen;
  };
  const speciesIds = ids('species', data.species);
  const sourceIds = ids('sources', data.sources);
  // While the claim files are still downloading the shell is checked on its own; references are checked once they arrive.
  const claimIds = data.claims_pending ? { has: () => true } : ids('claims', data.claims);
  ids('applications', data.applications);
  ids('runs', data.runs);
  const classIds = new Set(tax.technology_classes.map(x => x.id));
  const problemIds = new Set(tax.welfare_problems.map(x => x.id));
  const maturityIds = new Set(tax.maturity.map(x => x.id));
  const outcomeIds = new Set(tax.outcome_evidence.map(x => x.id));

  const forbidden = ['fulltext', 'full_text', 'body_text', 'pdf', 'markdown'];
  const scan = (value, path) => {
    if (Array.isArray(value)) value.forEach((v, i) => scan(v, `${path}[${i}]`));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (forbidden.includes(k.toLowerCase())) fail(`${path}.${k}: full text must not be published`);
        scan(v, `${path}.${k}`);
      }
    }
  };
  scan(data, 'export');

  for (const c of data.claims) {
    if (!sourceIds.has(c.source_id)) fail(`claim ${c.id}: unknown source ${c.source_id}`);
    if (c.species_id && !speciesIds.has(c.species_id)) fail(`claim ${c.id}: unknown species ${c.species_id}`);
    if (!c.quote || typeof c.quote !== 'string') fail(`claim ${c.id}: missing quote`);
    else if (c.quote.length > 600) fail(`claim ${c.id}: quote longer than 600 characters`);
    if (!c.locator || c.locator.page === undefined) fail(`claim ${c.id}: missing locator`);
    if (!KINDS.includes(c.kind)) fail(`claim ${c.id}: unknown kind ${c.kind}`);
    if (!VERIFICATION.includes(c.verification)) fail(`claim ${c.id}: unknown verification ${c.verification}`);
    // The source-language statement is the record; English is a derived view beside it. A claim
    // needs either an English statement (older releases, English sources) or a record.
    if (!c.text_en && !c.statement) fail(`claim ${c.id}: missing statement`);
    if (c.statement && !c.statement_lang) fail(`claim ${c.id}: record statement without its language`);
    if (c.statement && c.statement_lang !== 'en' && c.text_en) {
      if (!c.rendering || !c.rendering.model || !c.rendering.check) fail(`claim ${c.id}: English rendering without provenance`);
      else if (c.rendering.check !== 'numbers_ok') fail(`claim ${c.id}: English rendering failed its check (${c.rendering.check})`);
    }
    if (c.statement && c.statement_lang === 'zh' && c.text_zh && c.text_zh !== c.statement) fail(`claim ${c.id}: Chinese text differs from the record`);
    if (c.polarity != null && !POLARITY.includes(c.polarity)) fail(`claim ${c.id}: unknown polarity ${c.polarity}`);
    if (data.release.sample === false && !PUBLIC_VERIFICATION.includes(c.verification)) {
      fail(`claim ${c.id}: ${c.verification} claims must not be published`);
    }
  }
  for (const a of data.applications) {
    if (!speciesIds.has(a.species_id)) fail(`application ${a.id}: unknown species ${a.species_id}`);
    if (!classIds.has(a.technology_class)) fail(`application ${a.id}: unknown technology class ${a.technology_class}`);
    if (!problemIds.has(a.welfare_problem)) fail(`application ${a.id}: unknown welfare problem ${a.welfare_problem}`);
    if (!maturityIds.has(a.maturity)) fail(`application ${a.id}: unknown maturity ${a.maturity}`);
    if (!outcomeIds.has(a.outcome_evidence)) fail(`application ${a.id}: unknown outcome evidence ${a.outcome_evidence}`);
    if (!Array.isArray(a.claim_ids) || !a.claim_ids.length) fail(`application ${a.id}: needs at least one claim`);
    for (const cid of a.claim_ids || []) if (!claimIds.has(cid)) fail(`application ${a.id}: unknown claim ${cid}`);
  }
  // Suggested actions are optional proposals built from released claims. They are never evidence
  // and never ranked; a real release may carry only ones a person has reviewed.
  for (const x of data.suggestions || []) {
    if (!x.id) fail('suggestion without id');
    if (!speciesIds.has(x.species_id)) fail(`suggestion ${x.id}: unknown species ${x.species_id}`);
    if (!x.action_en) fail(`suggestion ${x.id}: missing action`);
    if (!x.evidence_gap) fail(`suggestion ${x.id}: missing evidence gap`);
    if (!['draft', 'reviewed'].includes(x.status)) fail(`suggestion ${x.id}: status must be draft or reviewed`);
    if (data.release.sample === false && x.status !== 'reviewed') fail(`suggestion ${x.id}: draft suggestions must not be published`);
    if (!Array.isArray(x.claim_ids) || !x.claim_ids.length) fail(`suggestion ${x.id}: needs at least one claim`);
    for (const cid of x.claim_ids || []) if (!claimIds.has(cid)) fail(`suggestion ${x.id}: unknown claim ${cid}`);
    if ('rank' in x || 'score' in x) fail(`suggestion ${x.id}: suggestions are not ranked`);
  }
  // Findings summarise the released claims about one practice and one welfare problem. Each must rest
  // on claims in this release, and its counts must match those claims.
  for (const f of data.findings || []) {
    if (!f.id) fail('finding without id');
    if (!speciesIds.has(f.species_id)) fail(`finding ${f.id}: unknown species ${f.species_id}`);
    if (!f.statement_en && !f.statement_zh) fail(`finding ${f.id}: no statement`);
    if (!Array.isArray(f.claim_ids) || !f.claim_ids.length) fail(`finding ${f.id}: needs at least one claim`);
    for (const cid of f.claim_ids || []) if (!claimIds.has(cid)) fail(`finding ${f.id}: unknown claim ${cid}`);
    if (f.counts?.claims !== f.claim_ids?.length) fail(`finding ${f.id}: claim count does not match its claims`);
  }
  // Actions are drafts written from findings. They may carry a rank only with the published formula
  // behind it, and every one must say it is a draft until a person has reviewed it.
  const findingIds = new Set((data.findings || []).map(f => f.id));
  for (const x of data.actions || []) {
    if (!x.id) fail('action without id');
    if (!x.action_en && !x.action_zh) fail(`action ${x.id}: missing text`);
    if (!['draft', 'reviewed'].includes(x.status)) fail(`action ${x.id}: status must be draft or reviewed`);
    if (!Array.isArray(x.finding_ids) || !x.finding_ids.length) fail(`action ${x.id}: needs at least one finding`);
    for (const fid of x.finding_ids || []) if (!findingIds.has(fid)) fail(`action ${x.id}: unknown finding ${fid}`);
    if ('rank' in x && !x.priority?.basis) fail(`action ${x.id}: a rank needs its published priority formula`);
  }
  for (const x of data.cells_status) {
    if (!CELL_STATUS.includes(x.status)) fail(`cells_status: unknown status ${x.status}`);
    if (!speciesIds.has(x.species_id)) fail(`cells_status: unknown species ${x.species_id}`);
  }
  for (const r of data.runs) {
    if (r.species_id && !speciesIds.has(r.species_id)) fail(`run ${r.id}: unknown species ${r.species_id}`);
  }
  return errors;
}
