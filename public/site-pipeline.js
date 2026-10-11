// The pipeline, stage by stage, for the Pipeline tab. Models are the demo profile in pipeline/models.json
// (a test checks they stay in step). status: built, partial, planned.
export const STAGES = [
  { id: 'L1', status: 'partial', name: ['Intake', '收集'],
    what: ['Collect the papers for one species and keep a record of every file.', '收集某一物种的论文，并记录每个文件。'],
    how: ['Files are supplied by hand today. Automatic discovery of new papers is not built.', '目前由人工提供文件，尚未实现自动发现新论文。'],
    model: null, out: ['A list of source files with page counts.', '带页数的来源文件清单。'] },
  { id: 'L1b', status: 'built', name: ['Normalize', '规范化'],
    what: ['Turn each PDF into text with a page marker before every page, and report what could not be read.', '把每个 PDF 转成带页码标记的文本，并报告无法读取之处。'],
    how: ['PyMuPDF reads the text layer. Where the layer is missing digits or garbled, pages are transcribed from images by hand. OCR with a vision model is prepared but not used.', 'PyMuPDF 读取文本层；文本层缺数字或乱码的页面，由人工看图转写。已备好视觉模型 OCR，但尚未使用。'],
    model: null, out: ['Markdown per paper and a conversion report.', '每篇论文一份 Markdown，以及转换报告。'],
    check: ['The report counts empty pages, missing digits and known glyph glitches.', '报告统计空白页、缺失数字和已知字形问题。'] },
  { id: 'L1c', status: 'built', name: ['Deduplicate', '去重'],
    what: ['Drop duplicate papers before any model call: the same text, or the same title under another file name.', '在调用任何模型之前剔除重复论文：正文相同，或同一标题换了文件名。'],
    how: ['Plain code. The first copy is kept and every drop is reported with its reason.', '普通代码。保留第一份，并说明每一份被剔除的原因。'],
    model: null, out: ['The list of papers kept and dropped.', '保留与剔除的论文清单。'] },
  { id: 'L2', status: 'partial', name: ['Profile', '画像'],
    what: ['Describe each paper: species, language, study design.', '描述每篇论文：物种、语言、研究设计。'],
    how: ['A model stage is configured but was not run for the demo.', '已配置模型阶段，演示中未运行。'],
    model: 'deepseek/deepseek-v4.1-flash', out: ['A profile per paper.', '每篇论文的画像。'] },
  { id: 'L3', status: 'partial', name: ['Screen', '筛选'],
    what: ['Decide whether a passage or claim concerns welfare technology at all.', '判断某段文字或论断是否涉及福利技术。'],
    how: ['In the demo this is folded into the Map step: breeding doses and basic biology are marked not relevant.', '演示中并入“归类”步骤：与福利无关的繁殖剂量和基础生物学被标为不相关。'],
    model: 'qwen/qwen3.8-flash', out: ['A relevance flag.', '相关性标记。'] },
  { id: 'L4', status: 'built', name: ['Extract', '提取'],
    what: ['Pull out each claim with a verbatim quote and a one-sentence English statement.', '提取每条论断，附原文引文和一句英文陈述。'],
    how: ['Each paper is read in overlapping windows (1,800 characters, 300 overlapping) that remember their pages, so a claim that crosses a page break is seen whole; duplicates from the overlaps are merged. Each claim separates what the study measured from what it claims, attributes to others, infers or proposes, and records whether the evidence points for, against, or finds no effect, plus stated limitations and counterevidence. Every window is a checkpointed task: a stopped run resumes where it left off, and a run with changed settings cannot mix into an old one. Model reasoning is off here, because it used up the output budget. The current release was extracted with the earlier version, one page per call.', '每篇论文按带页码的重叠窗口读取（1800 字，重叠 300 字），跨页的论断也能完整读到；重叠产生的重复会被合并。每条论断区分研究实测、仅有陈述、引自他人、作者推断和设想，并记录证据是支持、反对还是未发现效果，以及文中所述的局限和反证。每个窗口都是有检查点的任务：中断后可接着运行，设置改变后不会与旧结果混在一起。此处关闭模型推理，因为推理会耗尽输出额度。当前发布使用的是旧版（每页一次调用）。'],
    model: 'qwen/qwen3.8-flash', out: ['Claims: quote, statement, intervention and its key, basis, polarity, limitations, counterevidence, page.', '论断：引文、陈述、干预措施及其标签、依据类型、证据倾向、局限、反证、页码。'],
    check: ['The quote must appear in its window (next stage). Each call reserves its worst-case cost before it is sent, so the run cannot pass its spending cap.', '引文必须出现在其窗口中（见下一阶段）。每次调用发出前先预留最坏情况的费用，因此运行不会超过费用上限。'] },
  { id: 'L5', status: 'built', name: ['Verify', '核验'],
    what: ['Check that the quote is really on the page, then that it supports the statement.', '先核对引文确在该页，再核对它是否支持该陈述。'],
    how: ['First a deterministic text match that ignores spacing, punctuation width and known glyph errors. Then a second model, from a different lab than the extractor, judges supported, partial or unsupported from the quote alone.', '先做确定性的文本比对（忽略空格、标点宽度和已知字形错误）；再由与提取模型不同厂商的第二个模型，仅根据引文判断“支持、部分支持、不支持”。'],
    model: 'z-ai/glm-5.3', out: ['A verdict per claim; claims whose quote is not on the page are dropped.', '每条论断一个结论；引文不在该页的论断被剔除。'],
    check: ['The match can only reject, never wrongly accept a quote.', '文本比对只会拒绝，不会错误放行引文。'] },
  { id: 'L6', status: 'built', name: ['Map', '归类'],
    what: ['Place each claim on the map: technology class, welfare problem, kind of claim, link to welfare, strength of evidence.', '把每条论断放到地图上：技术类别、福利问题、论断类型、与福利的关联、证据强度。'],
    how: ['One call per claim, answers limited to the fixed taxonomy.', '每条论断一次调用，答案限定在固定分类之内。'],
    model: 'qwen/qwen3.8-flash', out: ['Labels used for the matrix and the network.', '用于矩阵和网络图的标签。'] },
  { id: 'L7', status: 'planned', name: ['Reconcile', '整合'],
    what: ['Merge duplicates, flag claims that disagree, carry nothing across species.', '合并重复内容，标出相互矛盾的论断，不跨物种外推。'],
    how: ['Planned, with the strongest model in the profile.', '计划中，使用配置中最强的模型。'],
    model: 'qwen/qwen3.8-max-0902', out: ['A reconciled set per species.', '每个物种一组整合后的论断。'] },
  { id: 'L8', status: 'partial', name: ['Gates', '关卡'],
    what: ['Expert audit of a sample, recall check, saturation and gap probes before anything is released.', '发布前：专家抽样审核、召回检查、饱和度与缺口探测。'],
    how: ['The recall gate is built: a run can be scored against a hand-checked gold set and fail below a threshold. The gold set itself does not exist yet, and nobody has audited the current claims.', '召回关卡已实现：运行结果可与人工核对的标准集比较，低于阈值即不通过。但标准集尚未建立，目前的论断也尚无人审核。'],
    model: null, out: ['Measured error rates for the Methods page.', '用于“方法与局限”页的实测错误率。'] },
  { id: 'L9', status: 'built', name: ['Commit and export', '提交与导出'],
    what: ['Write the release file the site reads.', '写出本站读取的发布文件。'],
    how: ['Only claims that are relevant, quote-checked and supported or partial are exported. Within each technology and problem, claims are grouped by intervention key; claims that are evidence but not an intervention support the cell without forming one. The site validator rejects anything else, including full text.', '只导出相关、引文核对通过、且被判为“支持”或“部分支持”的论断。在每个技术与问题组合内，按干预标签分组；只是证据而非干预措施的论断支持该格，但不单独成为一项应用。站点校验器会拒绝其他内容，包括全文。'],
    model: null, out: ['release.json (schema myrias-landscape/1).', 'release.json（模式 myrias-landscape/1）。'] },
  { id: 'S', status: 'partial', name: ['Suggest', '建议行动'],
    what: ['Draft possible actions from claims that passed, naming who could act, what evidence is missing and the risks.', '根据通过核验的论断起草可能的行动，注明可由谁行动、缺少哪些证据及风险。'],
    how: ['Drafts only. They stay out of the public release until a person has reviewed them.', '仅为草稿。经人工审核前不会进入公开发布。'],
    model: 'qwen/qwen3.8-max-0902', out: ['Draft suggestions with the claims they rest on.', '附依据论断的草稿建议。'] }
];

// The funnel from the run counts in release.json; steps with no number are skipped.
export function funnel(run) {
  const c = (run && run.counts) || {};
  const steps = [['documents_collected', 'Papers collected', '收集的论文'], ['documents_processed', 'Papers processed', '已处理的论文'], ['claims_extracted', 'Claims extracted', '提取的论断'],
    ['claims_quote_found', 'Quote found on the page', '引文在该页找到'], ['claims_relevant', 'About welfare technology', '涉及福利技术'], ['claims_released', 'Released (supported or partial)', '已发布（支持或部分支持）']];
  return steps.filter(([k]) => Number.isFinite(c[k])).map(([k, en, zh]) => ({ key: k, value: c[k], label: [en, zh] }));
}
