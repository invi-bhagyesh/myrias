import { chinaDay, shiftDate, findDate, parseList, classify, cleanText, normalizeDoi, chinaEvidence, languageCode, titleLanguage } from './core.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// One request per host per second. Never include credentials or provider error bodies in logs.
export function createClient({ fetchImpl = globalThis.fetch, pause = sleep, interval = 1000 } = {}) {
  const lastHit = new Map();
  return async (url, { ua, encoding, headers = {}, ...options } = {}) => {
    const host = new URL(url).host;
    const authenticated = Object.keys(headers).some(k => /authorization|app.key/i.test(k));
    if (authenticated && !url.startsWith('https://')) throw new Error('credentials require HTTPS');
    for (let attempt = 0; attempt < 3; attempt++) {
      await pause(Math.max(0, (lastHit.get(host) || 0) + interval - Date.now()));
      lastHit.set(host, Date.now());
      let res;
      try {
        res = await fetchImpl(url, { ...options, headers: { 'User-Agent': ua, ...headers }, signal: AbortSignal.timeout(20000), redirect: authenticated ? 'error' : 'follow' });
      } catch {
        if (attempt === 2) throw new Error('request failed or timed out');
        await pause(2000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < 2) {
          const retry = Number(res.headers.get('retry-after'));
          await pause(Math.min(60000, retry > 0 ? retry * 1000 : 2000 * 2 ** attempt));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const charset = encoding || (res.headers.get('content-type') || '').match(/charset=["']?([\w-]+)/i)?.[1]
        || buf.subarray(0, 2048).toString('latin1').match(/charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
      let text = new TextDecoder(/^gb/i.test(charset) ? 'gb18030' : charset).decode(buf);
      if (/^gb/i.test(charset) && (text.match(/�/g) || []).length > 20) text = buf.toString('utf8');
      return text;
    }
  };
}

async function json(ctx, url, options = {}) {
  const text = await ctx.request(url, { ua: ctx.ua, ...options });
  try { return JSON.parse(text); } catch { throw new Error('invalid JSON response'); }
}

function paper(src, ctx, data) {
  if (!data.title || !data.provider_id) throw new Error('paper response missing title or id');
  const title = cleanText(data.title);
  const classification = classify(title, ctx.terms, 'paper');
  if (!classification.keep) return null;
  const china_basis = chinaEvidence({ ...data, title }, ctx.terms);
  if (!china_basis) return null;
  const doi = normalizeDoi(data.doi);
  return { source: src.id, kind: 'paper', provider_id: String(data.provider_id), title,
    url: doi ? `https://doi.org/${doi}` : data.url, doi,
    date: findDate(data.date), indexed_at: findDate(data.indexed_at),
    lang: languageCode(data.lang), title_lang: titleLanguage(title, data.lang), china_basis,
    venue: cleanText(data.venue), ...classification };
}

const affiliations = r => (r.authorList?.author || []).flatMap(a => (a.authorAffiliationDetailsList?.authorAffiliation || []).map(x => x.affiliation));
const flattenAbstract = index => Object.entries(index || {}).flatMap(([word, places]) => places.map(i => [i, word])).sort((a, b) => a[0] - b[0]).map(x => x[1]).join(' ');
const asArray = value => value == null ? [] : Array.isArray(value) ? value.flatMap(asArray)
  : typeof value === 'object' ? asArray(value.values ?? value.value ?? []) : [String(value)];

export const READERS = {
  async 'html-list'(src, ctx) {
    const html = await ctx.request(src.access.url, { ua: ctx.ua, encoding: src.access.encoding });
    if (html.length < 500) throw new Error('list page came back nearly empty');
    const rows = parseList(html, src.access.url, src.access);
    if (!rows.length) throw new Error('no article links found; check the page layout');
    const items = [];
    for (const row of rows) {
      const c = classify(row.title, ctx.terms, src.scope);
      if (!c.keep) continue;
      if (!row.date && src.access.date_from_page && (!row.month || row.month >= ctx.from.slice(0, 7) && row.month <= ctx.to.slice(0, 7))) {
        row.date = findDate((await ctx.request(row.url, { ua: ctx.ua, encoding: src.access.encoding })).slice(0, 20000));
      }
      items.push({ ...row, ...c });
    }
    return { items, scanned: rows.length };
  },

  async 'people-search'(src, ctx) {
    const items = []; let scanned = 0;
    const dateOf = r => typeof (r.inputTime || r.displayTime) === 'number'
      ? chinaDay(new Date(r.inputTime || r.displayTime)) : findDate(r.displayTime);
    for (const key of src.access.keywords) {
      const limit = 20, pages = src.access.pages || 20;
      let complete = false;
      for (let page = 1; page <= pages; page++) {
        const body = JSON.stringify({ key, page, limit, hasTitle: true, hasContent: true, isFuzzy: false, type: 0, sortType: 0, startTime: 0, endTime: 0 });
        const d = await json(ctx, src.access.url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
        if (!Array.isArray(d?.data?.records)) throw new Error('search response missing records');
        const rows = d.data.records;
        scanned += rows.length;
        for (const r of rows) {
          const c = classify(cleanText(r.title), ctx.terms, src.scope, cleanText(r.content).slice(0, 400));
          if (c.keep) items.push({ title: cleanText(r.title), url: r.url, date: dateOf(r), ...c });
        }
        const lastDate = rows.length ? dateOf(rows.at(-1)) : null;
        if (rows.length < limit || lastDate && lastDate < ctx.from) { complete = true; break; }
      }
      if (!complete) throw new Error('search page limit reached before the date window ended');
    }
    return { items, scanned };
  },

  async europepmc(src, ctx) {
    const query = `(${src.access.query}) AND FIRST_IDATE:[${ctx.from} TO ${ctx.to}]`;
    const items = []; let cursor = '*', scanned = 0;
    const seen = new Set();
    for (let page = 0; page < (src.access.max_pages || 20); page++) {
      const body = new URLSearchParams({ query, format: 'json', pageSize: '100', resultType: 'core', cursorMark: cursor }).toString();
      const d = await json(ctx, src.access.url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!Number.isFinite(d.hitCount) || !Array.isArray(d.resultList?.result)) throw new Error('Europe PMC response missing result list or count');
      const rows = d.resultList.result;
      scanned += rows.length;
      for (const r of rows) {
        const item = paper(src, ctx, { provider_id: `${r.source}:${r.id}`, title: r.title, doi: r.doi,
          url: `https://europepmc.org/article/${r.source}/${r.id}`, date: r.firstPublicationDate,
          indexed_at: r.firstIndexDate, lang: r.language, venue: r.journalInfo?.journal?.title,
          affiliations: [...affiliations(r), r.affiliation || ''], abstract: r.abstractText || '' });
        if (item) items.push(item);
      }
      if (scanned >= d.hitCount) return { items, scanned };
      if (!rows.length || !d.nextCursorMark || seen.has(d.nextCursorMark) || d.nextCursorMark === cursor) throw new Error('Europe PMC pagination stopped early');
      seen.add(cursor); cursor = d.nextCursorMark;
    }
    throw new Error('Europe PMC page limit reached');
  },

  async openalex(src, ctx) {
    const items = []; let scanned = 0, requests = 0;
    const from = shiftDate(ctx.to, -(ctx.backfill ? src.access.backfill_days : src.access.lookback_days));
    const maxPages = src.access.max_pages || 20;
    async function searchWindow(mode, start, end) {
      let cursor = '*', queryScanned = 0;
      const seen = new Set();
      async function splitWindow() {
        if (start === end) throw new Error(`OpenAlex page limit reached for ${start}`);
        const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
        const middle = shiftDate(start, Math.floor(days / 2));
        await searchWindow(mode, start, middle);
        await searchWindow(mode, shiftDate(middle, 1), end);
      }
      for (let page = 0; page < maxPages; page++) {
        if (++requests > (src.access.max_requests || 400)) throw new Error('OpenAlex request limit reached');
        const url = new URL(src.access.url);
        url.search = new URLSearchParams({ 'search.title_and_abstract': mode === 'context' ? `(${src.access.query}) AND (China OR Chinese)` : src.access.query,
          filter: [`from_publication_date:${start}`, `to_publication_date:${end}`, ...(mode === 'affiliation' ? ['authorships.institutions.country_code:cn|hk|mo'] : [])].join(','),
          per_page: '100', cursor, select: 'id,doi,title,publication_date,language,primary_location,authorships,abstract_inverted_index' });
        const d = await json(ctx, url.href, { headers: { Authorization: `Bearer ${ctx.env[src.access.key_env]}` } });
        if (!Array.isArray(d.results) || !Number.isFinite(d.meta?.count)) throw new Error('OpenAlex response missing results or count');
        scanned += d.results.length; queryScanned += d.results.length;
        // Split crowded inclusive date ranges before spending requests paging through them.
        if (d.meta.count > maxPages * 100) return splitWindow();
        for (const r of d.results) {
          const authors = r.authorships || [];
          const item = paper(src, ctx, { provider_id: r.id, title: r.title, doi: r.doi,
            url: r.primary_location?.landing_page_url || r.id, date: r.publication_date, lang: r.language,
            venue: r.primary_location?.source?.display_name,
            countries: authors.flatMap(a => [...(a.countries || []), ...(a.institutions || []).map(i => i.country_code)]),
            affiliations: authors.flatMap(a => a.raw_affiliation_strings || []), abstract: flattenAbstract(r.abstract_inverted_index) });
          if (item) items.push(item);
        }
        if (queryScanned >= d.meta.count) return;
        const next = d.meta.next_cursor;
        if (!d.results.length || !next || next === cursor || seen.has(next)) throw new Error('OpenAlex pagination stopped early');
        seen.add(cursor); cursor = next;
      }
      return splitWindow();
    }
    // Affiliation and China-in-text searches are separate: OpenAlex cannot OR different filters.
    for (const mode of ['affiliation', 'context']) await searchWindow(mode, from, ctx.to);
    return { items, scanned };
  },

  async wanfang(src, ctx) {
    const fromYear = Number(ctx.to.slice(0, 4)) - (src.access.lookback_years || 2);
    // The public schema does not specify the online-date format. Use a bounded year search until
    // an authenticated account verifies that format; persistent IDs handle repeated results.
    const china = ctx.terms.china_affiliations.map(w => `"${w}"`).join(' OR ');
    const query = `(${src.access.query}) AND (OrganizationForSearch:(${china}) OR Title:(China OR Chinese OR 中国) OR Abstract:(China OR Chinese OR 中国)) AND PublishYear:[${fromYear} TO ${ctx.to.slice(0, 4)}]`;
    const items = []; let scanned = 0;
    const rows = 50;
    for (let page = 0; page < (src.access.max_pages || 40); page++) {
      const d = await json(ctx, src.access.url, { method: 'POST', headers: { 'X-App-Key': ctx.env[src.access.key_env], 'Content-Type': 'application/json' },
        body: JSON.stringify({ collections: ['OpenPeriodical'], query, start: page * rows, rows,
          returned_fields: ['Id', 'Title', 'OriginalOrganization', 'Abstract', 'DOI', 'PeriodicalTitle', 'Language', 'PublishDate', 'MetadataOnlineDate'],
          sort: { sorts: [{ by: 'PublishYear', order: 'DESC' }, { by: 'Id', order: 'ASC' }] } }) });
      const result = d.data ?? d;
      const rawTotal = result.num_found ?? result.numFound;
      // The live JSON gateway serializes numFound as a decimal string.
      const total = typeof rawTotal === 'string' && /^\d+$/.test(rawTotal) ? Number(rawTotal) : rawTotal;
      if (!Array.isArray(result.documents) || !Number.isSafeInteger(total) || total < 0) throw new Error('Wanfang response missing documents or count');
      scanned += result.documents.length;
      for (const r of result.documents) {
        const f = r.fields;
        if (!f || typeof f !== 'object') throw new Error('Wanfang document missing fields');
        const id = asArray(f.Id)[0] || r.id;
        const item = paper(src, ctx, { provider_id: id, title: asArray(f.Title)[0], doi: asArray(f.DOI)[0],
          url: `https://d.wanfangdata.com.cn/periodical/${encodeURIComponent(id)}`,
          date: asArray(f.PublishDate)[0], indexed_at: asArray(f.MetadataOnlineDate)[0],
          lang: asArray(f.Language)[0], venue: asArray(f.PeriodicalTitle)[0],
          affiliations: asArray(f.OriginalOrganization), abstract: asArray(f.Abstract).join(' ') });
        if (item) items.push(item);
      }
      if (scanned >= total) return { items, scanned };
      if (!result.documents.length) throw new Error('Wanfang pagination stopped early');
    }
    throw new Error('Wanfang page limit reached');
  }
};
