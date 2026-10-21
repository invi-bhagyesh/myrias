// The Pipeline page: the framework in four phases, then a walkthrough that follows one real claim through
// every step. Numbers and the example come from data/pipeline.json, which pipeline/pipeline_summary.py
// writes from the run's step records, the store and the release; nothing on this page is typed in by hand.
import { escapeHtml as esc, linkIds } from './site-lib.js';

// The pipeline as it runs today, one entry per step, for the diagram on the Pipeline tab. Numbers come
// from data/pipeline.json, which pipeline/pipeline_summary.py writes from the run's step records.
// name, out (what the number counts), what (one plain sentence), how (how it is done and checked).
export const LANES = [['collect', ['Collect', '收集']], ['read', ['Read', '阅读']], ['combine', ['Combine', '汇总']], ['check', ['Check', '检验']]];
export const STEP_TEXT = {
  search: { name: ['Search', '检索'], in: ['indexes', '个数据库'], out: ['papers found', '篇论文'],
    what: ['Search five open indexes for the species and merge the records that are the same paper.', '在五个开放数据库中检索该物种，合并指向同一论文的记录。'],
    how: ['Europe PMC, Crossref, DOAJ, OpenAlex, Semantic Scholar. Matched by DOI, PubMed ids and title. CNKI, Wanfang and CQVIP are not included yet.', 'Europe PMC、Crossref、DOAJ、OpenAlex、Semantic Scholar。按 DOI、PubMed 编号和标题匹配。知网、万方、维普尚未纳入。'] },
  screen: { name: ['Screen', '筛选'], in: ['papers', '篇'], out: ['about the fish and welfare', '篇涉及该鱼与福利'],
    what: ['Keep papers that name the species in the title and touch a welfare topic.', '保留标题中出现该物种且涉及福利主题的论文。'],
    how: ['Keyword rules in English and Chinese, no model.', '中英文关键词规则，不用模型。'] },
  fetch: { name: ['Fetch full text', '获取全文'], in: ['papers', '篇'], out: ['with open full text', '篇有开放全文'],
    what: ['Download the open full text where it exists.', '在有开放全文时下载。'],
    how: ['Europe PMC XML, publisher pages and open PDFs. Paywalled papers are recorded, not fetched.', 'Europe PMC XML、出版商页面和开放 PDF。付费论文只做记录，不下载。'] },
  prepare: { name: ['Prepare', '整理'], in: ['papers', '篇'], out: ['pages to read', '页待读'],
    what: ['Turn each paper into numbered pages and cut the reference list.', '把每篇论文整理成带页码的文本，并去掉参考文献。'],
    how: ['Plain code. Scanned pages are transcribed from images first.', '普通代码。扫描页先从图像转录。'] },
  extract: { name: ['Extract claims', '提取论断'], in: ['text windows', '个文本窗口'], out: ['claims', '条论断'],
    what: ['A model reads each page window and writes every claim with a word-for-word quote.', '模型逐个窗口阅读，写出每条论断并附逐字引文。'],
    how: ['Overlapping windows so a claim across a page break is seen whole; repeated claims from the overlap are merged.', '窗口相互重叠，跨页论断不会被截断；重叠处的重复论断会合并。'] },
  quote: { name: ['Check the quote', '核对引文'], in: ['claims', '条'], out: ['quotes found on the page', '条引文在原页找到'],
    what: ['Code checks that every quote is really on its page. Claims whose quote is not are dropped.', '代码核对每条引文确实在所在页，找不到的论断被剔除。'],
    how: ['Ignores spacing, punctuation width and known glyph errors. It can only reject, never wrongly accept.', '忽略空格、全半角标点和已知字形错误；只会拒绝，不会错误放行。'] },
  map: { name: ['Map', '归类'], in: ['claims', '条'], out: ['about welfare', '条涉及福利'],
    what: ['Label each claim: is it about welfare, which technology, which welfare problem, what kind of evidence.', '为每条论断标注：是否涉及福利、属于哪类技术、哪种福利问题、证据类型。'],
    how: ['One call per claim, answers limited to the fixed taxonomy.', '每条论断一次调用，答案限定在固定分类内。'] },
  verify: { name: ['Verify', '核验'], in: ['claims', '条'], out: ['supported or partly', '条支持或部分支持'],
    what: ['A second model, from a different lab, checks each claim against its quote.', '另一家机构的模型对照引文核验每条论断。'],
    how: ['Supported, partly supported or not supported. Only the first two are released.', '分为支持、部分支持、不支持；只发布前两类。'] },
  render: { name: ['English text', '英文呈现'], in: ['claims', '条'], out: ['translated', '条已翻译'],
    what: ['Write an English version beside each claim kept in its own language.', '在保持原语言的论断旁写出英文版本。'],
    how: ['Code checks that every number survives the translation. The original stays the record.', '代码核对每个数字在译文中都保留；原文始终是记录。'] },
  reconcile: { name: ['Name practices', '统一做法名称'], in: ['new names', '个新名称'], out: ['groups', '组'],
    what: ['Give each practice one name, joining existing groups where it is the same practice.', '为每种做法统一名称；若是同一做法则并入已有组。'],
    how: ['In batches, each batch sees the groups so far. The original wording is kept.', '分批处理，每批都能看到已有分组；保留原始措辞。'] },
  merge: { name: ['Merge into the store', '并入数据库'], in: ['claims that passed', '条通过'], out: ['claims in the store', '条在库中'],
    what: ['Add the run to everything found before. A claim found again is not added twice.', '把本次结果并入已有数据；再次找到的论断不会重复加入。'],
    how: ['Permanent ids for claims and papers, so links never break.', '论断和论文使用永久编号，链接不会失效。'] },
  export: { name: ['Release', '发布'], in: ['claims', '条'], out: ['claims released', '条已发布'],
    what: ['Write the files this site reads.', '写出本站读取的文件。'],
    how: ['Split into small files. Quotes longer than 600 characters are held back.', '拆分为小文件；超过 600 字符的引文暂不发布。'] },
  cluster: { name: ['Cluster practices', '做法聚类'], in: ['practice names', '个做法名称'], out: ['practices', '种做法'],
    what: ['Find the names that mean the same practice, so their claims are read together.', '找出指同一做法的不同名称，使相关论断合在一起看。'],
    how: ['Embeddings and clustering, then a model tests each cluster and removes what does not belong (after Inverse Constitutional AI).', '先用向量嵌入聚类，再由模型逐组检验并剔除不属于该组的内容（参照 Inverse Constitutional AI）。'] },
  findings: { name: ['Write findings', '撰写发现'], in: ['claims', '条论断'], out: ['findings', '条发现'],
    what: ['One finding per practice and welfare problem, summing up its claims.', '每种做法与福利问题一条发现，概括其论断。'],
    how: ['Counts and strength by code; the sentence by a model from the claims only; numbers checked against them.', '计数和强度由代码给出；句子由模型仅依据论断撰写；数字逐一核对。'] },
  actions: { name: ['Draft actions', '起草行动'], in: ['multi-paper findings', '条多篇论文发现'], out: ['draft actions', '条行动草案'],
    what: ['Propose next steps from findings that rest on two or more papers.', '依据来自两篇及以上论文的发现提出下一步。'],
    how: ['Each action cites its findings and says who would do it, what is not yet known, the risks, and why. Ranking is the next step.', '每项行动都引用其依据的发现，并写明由谁执行、尚不清楚之处、风险和理由。排序在下一步进行。'] },
  rank: { name: ['Rank actions', '行动排序'], in: ['draft actions', '条行动草案'], out: ['ranked', '条已排序'],
    what: ['A model ranks all actions against each other, following a written spec of what priority means.', '模型按一份写明“优先级”含义的规范，把所有行动放在一起排序。'],
    how: ['The spec (pipeline/priority-spec.md) weighs welfare gain, strength of evidence, whether it can be done now and the risk if wrong. Each action gets a score, a reason and a note per criterion; change the spec to change the ranking.', '规范（pipeline/priority-spec.md）权衡福利收益、证据强度、能否立即实施以及出错时的风险。每项行动都有分数、理由和逐项评估；修改规范即可改变排序。'] },
  audit: { name: ['Expert audit', '专家审核'], in: null, out: null,
    what: ['A fish-welfare expert checks a sample of claims and findings, and the error rates are published.', '由鱼类福利专家抽查论断和发现，并公布错误率。'],
    how: ['Not started. Until then everything here is a lead to check, not a finding to rely on.', '尚未开始。在此之前，这里的一切都只是待核查的线索。'] }
};

// What each phase is for, in one line each, for the overview.
export const PHASE_TEXT = {
  collect: ['Find the papers and get their text.', '找到论文并取得全文。'],
  read: ['Pull out every claim, then check it twice.', '提取每条论断，并做两道核对。'],
  combine: ['Join claims into practices, findings and actions.', '把论断汇总为做法、发现和行动。'],
  check: ['A person checks a sample before anyone relies on it.', '在使用前由专家抽查。']
};
// Steps whose input and output count the same thing, so a "kept" share means something.
const SAME_UNIT = new Set(['screen', 'fetch', 'quote', 'map', 'verify', 'export']);
const LAB = { qwen: 'Alibaba', 'z-ai': 'Zhipu', anthropic: 'Anthropic', deepseek: 'DeepSeek', openai: 'OpenAI', google: 'Google' };
const INDEX = { openalex: 'OpenAlex', semanticscholar: 'Semantic Scholar', europepmc: 'Europe PMC', crossref: 'Crossref', doaj: 'DOAJ' };
const n = x => (x === null || x === undefined ? '—' : Number(x).toLocaleString());
const short = m => (m ? m.split('/').pop() : '');
const pad = x => String(x).padStart(2, '0');

// The example at one step: the real record as it looked after that step ran.
function exampleHtml(key, e, c) {
  const L = (en, zh) => (c.lang === 'zh' ? zh : en);
  const lab = m => LAB[(m || '').split('/')[0]] || '';
  const hi = (text, nums) => nums.reduce((s, x) => s.split(x).join(`\u0000${x}\u0001`), esc(text)).replace(/\u0000/g, '<mark>').replace(/\u0001/g, '</mark>');
  const quote = `<blockquote class="ex-quote" lang="${esc(e.extract.lang)}">${esc(e.extract.quote)}</blockquote>`;
  const paper = `<div class="ex-paper"><span class="ex-k">${esc(e.source_id)} · ${esc(e.year)}${e.venue ? ' · ' + esc(e.venue) : ''}</span><b>${esc(e.title)}</b>${e.doi ? `<span class="ex-k">doi ${esc(e.doi)}</span>` : ''}</div>`;
  const chip = (label, value, cls = '') => `<span class="ex-chip ${cls}"><i>${esc(label)}</i>${esc(value)}</span>`;
  const ok = text => `<p class="ex-ok"><span aria-hidden="true">✓</span>${esc(text)}</p>`;
  switch (key) {
    case 'search': return paper + `<p class="ex-p">${esc(L(`Found in ${e.search.indexes.map(x => INDEX[x] || x).join(' and ')}, and merged into one record. One of ${n(e.search.found_of)} papers found.`,
      `在 ${e.search.indexes.map(x => INDEX[x] || x).join('、')} 中找到，合并为一条记录；共找到 ${n(e.search.found_of)} 篇论文。`))}</p>`;
    case 'screen': return paper + ok(L('Names the species in the title', '标题中出现该物种')) +
      ok(L('Touches welfare topics: ', '涉及福利主题：') + e.screen.topics.map(t => c.taxonomyLabel('welfare_problems', t).replace(/_/g, ' ')).join(', ')) +
      `<p class="ex-verdict v-pass">${esc(L('Kept', '保留'))}</p>`;
    case 'fetch': return paper + `<p class="ex-file"><span>${esc((e.fetch.format || 'pdf').toUpperCase())}</span>${esc(L('Open-access full text downloaded. Stays private, never published.', '已下载开放获取全文；仅内部使用，不公开。'))}</p>`;
    case 'prepare': return `<div class="ex-pages">${Array.from({ length: e.prepare.pages }, (_, k) => `<span class="${k + 1 === e.prepare.page ? 'on' : ''}">${k + 1}</span>`).join('')}</div>` +
      `<p class="ex-p">${esc(L(`${e.prepare.pages} pages of text, each with its page number. Our claim will come from page ${e.prepare.page}.`, `共 ${e.prepare.pages} 页文本，每页保留页码；我们的论断来自第 ${e.prepare.page} 页。`))}</p>`;
    case 'extract': return `<div class="ex-windows" aria-hidden="true">${Array.from({ length: e.extract.windows }, (_, k) => `<span class="${k === e.extract.window ? 'on' : ''}"></span>`).join('')}</div>` +
      `<p class="ex-k">${esc(L(`window ${e.extract.window + 1} of ${e.extract.windows} · one of ${e.extract.claims_from_paper} claims from this paper`, `第 ${e.extract.window + 1}/${e.extract.windows} 个窗口 · 本文 ${e.extract.claims_from_paper} 条论断之一`))}</p>` +
      quote + `<p class="ex-p" lang="${esc(e.extract.lang)}">${esc(e.extract.statement)}</p>` +
      `<div class="ex-chips">${chip(L('practice', '做法'), e.extract.intervention)}${chip(L('basis', '依据'), c.tr('kind.' + e.extract.basis))}${chip(L('direction', '倾向'), c.tr('pol.' + e.extract.polarity))}</div>` +
      `<p class="ex-k">${esc(L('Written in the paper’s own language. Nothing is translated yet.', '用论文原语言写成，此时尚未翻译。'))}</p>`;
    case 'quote': return `<div class="ex-page"><span class="ex-k">${esc(L('page', '第'))} ${e.quote.page}</span><i></i><i></i><mark lang="${esc(e.extract.lang)}">${esc(e.extract.quote)}</mark><i></i><i class="s"></i></div>` +
      ok(L(`Found word for word on page ${e.quote.page}`, `在第 ${e.quote.page} 页逐字找到`)) +
      `<p class="ex-k">${esc(L(`${e.quote.found_in_paper} of ${e.extract.claims_from_paper} claims from this paper passed.`, `本文 ${e.extract.claims_from_paper} 条论断中 ${e.quote.found_in_paper} 条通过。`))}</p>`;
    case 'map': return `<div class="ex-chips">${chip(L('about welfare', '涉及福利'), e.map.welfare_relevant ? L('yes', '是') : L('no', '否'), 'c-yes')}
        ${chip(L('technology', '技术'), c.taxonomyLabel('technology_classes', e.map.technology_class))}${chip(L('welfare problem', '福利问题'), c.taxonomyLabel('welfare_problems', e.map.welfare_problem))}
        ${chip(L('evidence', '证据'), c.tr('kind.' + e.map.kind))}${chip(L('link to welfare', '与福利的关系'), e.map.welfare_link === 'proxy' ? L('indirect (growth)', '间接（生长）') : e.map.welfare_link)}</div>` +
      `<details class="ex-why"><summary>${esc(L('The model’s reason', '模型给出的理由'))} · ${esc(short(e.map.model))}</summary><p>${linkIds(e.map.reason, c.link)}</p></details>`;
    case 'verify': return quote + `<p class="ex-verdict v-pass">${esc(c.tr('ver.' + e.verify.verdict))}</p>` +
      (e.verify.note ? `<p class="ex-note" lang="zh"><span class="ex-k">${esc(short(e.verify.model))}:</span> ${esc(e.verify.note)}</p>` : '') +
      `<p class="ex-k">${esc(L(`Checked by ${short(e.verify.model)} (${lab(e.verify.model)}); the claim was written by ${short(e.extract.model)} (${lab(e.extract.model)}).`, `由 ${short(e.verify.model)}（${lab(e.verify.model)}）核验；论断由 ${short(e.extract.model)}（${lab(e.extract.model)}）写出。`))}</p>`;
    case 'render': return `<div class="ex-two"><div><span class="ex-k">${esc(L('record', '原始记录'))}</span><p lang="${esc(e.extract.lang)}">${hi(e.extract.statement, e.render.numbers)}</p></div>
        <div><span class="ex-k">English</span><p lang="en">${hi(e.render.text_en, e.render.numbers)}</p></div></div>` +
      ok(L(`Every number survives: ${e.render.numbers.join(', ')}`, `所有数字都保留：${e.render.numbers.join('、')}`));
    case 'reconcile': return `<div class="ex-flow"><div><span class="ex-k">${esc(L('as written', '原写法'))}</span><b lang="zh">${esc(e.reconcile.before[0])}</b>${e.reconcile.before[1] ? `<span>${esc(e.reconcile.before[1])}</span>` : ''}</div>
        <span class="ex-arrow" aria-hidden="true">→</span><div class="on"><span class="ex-k">${esc(L('practice name', '做法名称'))}</span><b>${esc(L(e.reconcile.after[0], e.reconcile.after[1]))}</b><span>${esc(L(e.reconcile.after[1], e.reconcile.after[0]))}</span></div></div>` +
      `<p class="ex-k">${esc(L('The wording in the paper is kept beside the name.', '论文原有措辞与名称一同保留。'))}</p>`;
    case 'merge': return `<div class="ex-flow"><div><span class="ex-k">${esc(L('fingerprint of paper + page + quote', '论文+页码+引文的指纹'))}</span><code>${esc(e.merge.uid)}</code></div>
        <span class="ex-arrow" aria-hidden="true">→</span><div class="on"><span class="ex-k">${esc(L('permanent id', '永久编号'))}</span><b>${esc(e.merge.id)}</b><span>${esc(L('paper', '论文'))} ${esc(e.merge.source_id)}</span></div></div>` +
      `<p class="ex-p">${esc(L('If a later run finds the same quote on the same page, it gets the same fingerprint and is not added again.', '以后的运行若在同一页找到同一引文，指纹相同，不会重复加入。'))}</p>`;
    case 'export': return `<a class="ex-claim" href="${c.link('claims/' + encodeURIComponent(e.claim_id))}"><span class="ex-k">${esc(e.claim_id)} · ${esc(e.source_id)}, ${esc(L('page', '第'))} ${e.prepare.page}${c.lang === 'zh' ? ' 页' : ''}</span>
        <b>${esc(L(e.render.text_en, e.extract.statement))}</b><span class="ex-open">${esc(L('Open it on the site', '在本站打开'))} →</span></a>`;
    case 'cluster': {
      const max = Math.max(...e.cluster.names.map(x => x[1]));
      return `<ul class="ex-bars">${e.cluster.names.map(([name, k]) => `<li class="${name === e.reconcile.after[0] ? 'on' : ''}"><span>${esc(name)}</span><i style="--w:${Math.round(100 * k / max)}%"></i><b>${k}</b></li>`).join('')}</ul>` +
        `<p class="ex-merged"><span aria-hidden="true">↳</span> ${esc(L(`${e.cluster.names.length} names, one practice:`, `${e.cluster.names.length} 个名称，同一做法：`))} <b>${esc(L(e.cluster.name[0], e.cluster.name[1]))}</b></p>` +
        (e.cluster.reason ? `<details class="ex-why"><summary>${esc(L('Why the model kept them together', '模型认为它们属于同一做法的理由'))} · ${esc(short(e.cluster.model))}</summary><p>${linkIds(e.cluster.reason, c.link)}</p></details>` : '');
    }
    case 'findings': { const f = e.findings; if (!f) return '';
      return `<a class="ex-claim ex-finding" href="${c.link('findings/' + encodeURIComponent(f.id))}"><span class="ex-k">${esc(f.id)} · ${esc(L(f.practice_en, f.practice_zh))} × ${esc(c.taxonomyLabel('welfare_problems', f.welfare_problem))}</span>
        <span class="ex-verdict v-${esc(f.strength)}">${esc(c.tr('fd.strength.' + f.strength))}</span><b>${esc(L(f.statement_en, f.statement_zh))}</b>
        <span class="ex-nums"><span><strong>${f.counts.claims}</strong>${esc(L('claims', '条论断'))}</span><span><strong>${f.counts.papers}</strong>${esc(L('papers', '篇论文'))}</span><span><strong>${f.counts.measured}</strong>${esc(L('measured', '条实测'))}</span><span><strong>${f.counts.opposing}</strong>${esc(L('against', '条反对'))}</span></span>
        <span class="ex-open">${esc(L('Open the finding and all its claims', '打开该发现及其全部论断'))} →</span></a>` +
        (f.basis?.strength ? `<p class="ex-k">${esc(L('Why this label (by code): ', '为何是这个标签（代码判定）：') + L(f.basis.strength.en, f.basis.strength.zh))}</p>` : '') +
        (f.basis?.summary ? `<details class="ex-why"><summary>${esc(L('Why the model summarised it this way', '模型为何这样概括'))}</summary><p>${linkIds(f.basis.summary, c.link)}</p></details>` : ''); }
    case 'actions': { const a = e.actions; if (!a) return '';
      const p = a.priority;
      return `<a class="ex-claim ex-action" href="${c.link('actions')}"><span class="ex-k">${esc(a.id)} · ${esc(L(a.type, a.type))} · ${esc(L(a.who, a.who))}</span><b>${esc(L(a.action_en, a.action_zh))}</b></a>` +
        `<p class="ex-k">${esc(L('Cites', '依据'))} ${esc(e.findings?.id || '')} · ${esc(L('still a draft until reviewed', '审核前仍为草案'))}</p>` +
        (a.basis?.reason ? `<details class="ex-why"><summary>${esc(L('How the model built it from the findings', '模型如何由发现得出它'))}</summary><p>${linkIds(a.basis.reason, c.link)}</p></details>` : ''); }
    case 'rank': { const a = e.actions; if (!a?.priority) return '';
      const p = a.priority;
      return `<div class="ex-formula"><span>${esc(L('rank', '排名'))}</span><b>${a.rank}</b><span>${esc(L(`of ${e.rank_of}`, `/ ${e.rank_of}`))}</span><span>·</span><span>${esc(L('score', '分数'))} <b>${Math.round(100 * p.score)}</b><i>/100</i></span></div>` +
        (p.reason ? `<p class="ex-p">${linkIds(p.reason, c.link)}</p>` : '') +
        ((p.criteria || []).length ? `<ul class="ac-crit">${p.criteria.map(k => `<li><span>${esc(k.criterion)}</span><b>${esc(c.tr('ac.level.' + k.level))}</b><small>${linkIds(k.note, c.link)}</small></li>`).join('')}</ul>` : '') +
        `<p class="ex-k">${esc(L(`${short(p.by?.model)} against ${p.by?.spec || 'the spec'}`, `${short(p.by?.model)} 按 ${p.by?.spec || '规范'} 排序`))}</p>`; }
    case 'audit': return `<div class="ex-todo"><p>${esc(L(`An expert opens page ${e.prepare.page} of ${e.source_id}, reads the quote, and marks ${e.claim_id}, ${e.findings?.id || ''} and ${e.actions?.id || ''} right or wrong.`, `专家打开 ${e.source_id} 第 ${e.prepare.page} 页，阅读引文，判断 ${e.claim_id}、${e.findings?.id || ''} 和 ${e.actions?.id || ''} 是否正确。`))}</p>
        <p class="ex-k">${esc(L('Not started. Until then, everything here is a lead to check.', '尚未开始。在此之前，这里的一切都只是待核查的线索。'))}</p></div>`;
    default: return '';
  }
}

// The whole page body. ctx: { lang, tr, link, taxonomyLabel, step }.
export function pipelineHtml(P, c) {
  const i = c.lang === 'zh' ? 1 : 0, L = (en, zh) => (c.lang === 'zh' ? zh : en);
  const by = k => P.steps.find(s => s.key === k) || {};
  const kind = st => (st.status === 'planned' ? 'k-people' : st.model ? 'k-model' : 'k-code');
  const who = st => (st.status === 'planned' ? L('people', '人工') : st.model ? short(st.model) : L('plain code', '普通代码'));
  const io = {
    collect: [[by('search').out, L('papers found', '篇论文')], [by('fetch').out, L('with full text', '篇有全文')]],
    read: [[by('extract').out, L('claims written', '条论断')], [by('verify').out, L('checked claims', '条通过核对')]],
    combine: [[by('findings').out, L('findings', '条发现')], [by('actions').out, L('draft actions', '条行动草案')]],
    check: null
  };
  const phases = LANES.map(([id, label], k) => `<article class="fw-ph ph-${id}"><header><span class="fw-ph-n">${pad(k + 1)}</span><h3>${esc(label[i])}</h3></header>
      <p>${esc(PHASE_TEXT[id][i])}</p>
      <div class="fw-ph-io">${io[id] ? io[id].map(([v, l]) => `<span><strong>${n(v)}</strong>${esc(l)}</span>`).join('<span class="fw-to" aria-hidden="true">→</span>') : `<span class="fw-ph-todo">${esc(L('Not started', '尚未开始'))}</span>`}</div>
      <ol class="fw-chips">${P.steps.filter(s => s.lane === id).map(st => `<li><button type="button" class="${kind(st)}" data-go="${st.id}"><span>${pad(st.id)}</span>${esc((STEP_TEXT[st.key] || { name: [st.key, st.key] }).name[i])}</button></li>`).join('')}</ol></article>`).join('');
  const models = P.steps.filter(s => s.model).length, code = P.steps.filter(s => !s.model && s.status !== 'planned').length;
  const overview = `<section class="fw-over" aria-label="${esc(L('The framework', '框架'))}"><div class="fw-phases">${phases}</div>
    <p class="fw-key"><span><i class="k-model"></i>${esc(L(`a model does it (${models} steps)`, `由模型完成（${models} 步）`))}</span><span><i class="k-code"></i>${esc(L(`plain code, no model (${code} steps)`, `普通代码，不用模型（${code} 步）`))}</span><span><i class="k-people"></i>${esc(L('people', '人工'))}</span>
      <span class="fw-asof">${esc(L(`${n(P.totals.calls)} model calls · ${P.run}, ${P.as_of}`, `${n(P.totals.calls)} 次模型调用 · ${P.run}，${P.as_of}`))}</span></p></section>`;

  const e = P.example;
  const lane = id => LANES.find(l => l[0] === id)[1][i];
  const rail = LANES.map(([id, label]) => `<li class="fw-rail-g"><span class="fw-rail-l">${esc(label[i])}</span><ol>${P.steps.filter(s => s.lane === id).map(st =>
    `<li><button type="button" class="${kind(st)}" data-go="${st.id}" aria-label="${esc(pad(st.id) + ' ' + (STEP_TEXT[st.key]?.name[i] || st.key))}" title="${esc(pad(st.id) + ' · ' + (STEP_TEXT[st.key]?.name[i] || st.key))}">${pad(st.id)}</button></li>`).join('')}</ol></li>`).join('');
  const panel = st => {
    const t = STEP_TEXT[st.key] || { name: [st.key, st.key], what: ['', ''], how: ['', ''] };
    const planned = st.status === 'planned';
    const kept = SAME_UNIT.has(st.key) && st.in ? Math.min(100, Math.round(100 * st.out / st.in)) : null;
    const ioHtml = planned ? '' : `<div class="fw-io"><div><strong>${n(st.in)}</strong><span>${esc(t.in ? t.in[i] : '')}</span></div>
        <div class="fw-io-mid"><span class="fw-io-who ${kind(st)}">${esc(who(st))}</span><svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path d="M0 5H96"/><path d="M90 1L97 5L90 9"/></svg>${st.calls ? `<span class="fw-io-calls">${esc(L(`${n(st.calls)} calls`, `${n(st.calls)} 次调用`))}</span>` : ''}</div>
        <div class="fw-io-out"><strong>${n(st.out)}</strong><span>${esc(t.out ? t.out[i] : '')}</span></div></div>` +
      (kept !== null ? `<div class="fw-kept"><span style="--w:${kept}%"></span><em>${esc(L(`${kept}% kept`, `保留 ${kept}%`))}</em></div>` : '');
    return `<article class="fw-step ${kind(st)}" data-step="${st.id}" hidden>
      <div class="fw-explain"><div class="fw-step-h"><span class="fw-num">${pad(st.id)}</span><div><span class="fw-lane">${esc(lane(st.lane))}</span><h3>${esc(t.name[i])}</h3></div></div>
        <p class="fw-what">${esc(t.what[i])}</p>${ioHtml}
        <p class="fw-how"><b>${esc(L('How it is done and checked', '做法与核对'))}</b>${esc(t.how[i])}</p></div>
      ${e ? `<div class="fw-ex"><p class="fw-ex-h">${esc(L('Our example after this step', '本步之后的示例'))}</p>${exampleHtml(st.key, e, c)}</div>` : ''}</article>`;
  };
  const walk = `<section class="fw-walk" data-walk data-n="${P.steps.length}">
    <header class="fw-walk-h"><div><div class="record-type">${esc(L('Walkthrough', '逐步演示'))}</div><h2>${esc(L('Follow one claim through every step', '跟随一条论断走完每一步'))}</h2>
      ${e ? `<p>${esc(L(`A real claim from page ${e.prepare.page} of a ${e.year} paper on water temperature, and where it ends up.`, `一条真实论断：来自 ${e.year} 年一篇水温论文的第 ${e.prepare.page} 页，看它最终走到哪里。`))}</p>` : ''}</div>
      <div class="fw-ctrl"><button type="button" data-prev aria-label="${esc(L('Previous step', '上一步'))}">←</button><span data-pos></span><button type="button" data-next aria-label="${esc(L('Next step', '下一步'))}">→</button></div></header>
    <ol class="fw-rail">${rail}</ol>
    <div class="fw-stage">${P.steps.map(panel).join('')}</div>
    <p class="fw-tip">${esc(L('Use ← and → to move between steps.', '用 ← 和 → 键切换步骤。'))}</p></section>`;
  return overview + walk;
}

// Wires the walkthrough: one step shown at a time, the rail and the overview chips jump to a step, arrows and
// the keyboard move through them, and the step is kept in the address so a link opens on it.
export function mountPipeline(root, { start = 1, onStep } = {}) {
  const walk = root.querySelector('[data-walk]');
  if (!walk) return;
  const total = Number(walk.dataset.n);
  let cur = 0;
  const show = (k, scroll) => {
    k = Math.max(1, Math.min(total, k));
    if (k === cur) { if (scroll) walk.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    cur = k;
    walk.querySelectorAll('[data-step]').forEach(a => { a.hidden = Number(a.dataset.step) !== k; });
    root.querySelectorAll('[data-go]').forEach(b => { if (Number(b.dataset.go) === k) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    walk.querySelector('[data-pos]').textContent = `${pad(k)} / ${pad(total)}`;
    walk.querySelector('[data-prev]').disabled = k === 1;
    walk.querySelector('[data-next]').disabled = k === total;
    const on = walk.querySelector('.fw-rail [aria-current]');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (scroll) walk.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (onStep) onStep(k);
  };
  root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => show(Number(b.dataset.go), !walk.contains(b))));
  walk.querySelector('[data-prev]').addEventListener('click', () => show(cur - 1));
  walk.querySelector('[data-next]').addEventListener('click', () => show(cur + 1));
  const key = ev => {
    if (!walk.isConnected) { document.removeEventListener('keydown', key); return; }
    if (ev.altKey || ev.ctrlKey || ev.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    if (ev.key === 'ArrowRight') { show(cur + 1); ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft') { show(cur - 1); ev.preventDefault(); }
  };
  document.addEventListener('keydown', key);
  show(start);
}
