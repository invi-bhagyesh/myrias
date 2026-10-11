// Prompts and output schemas for model-driven stages. Versioned: the version is stored with records.
export const PROMPT_VERSION = 'extract-0.3';

// The source language is the record. Extraction writes every free-text field in the passage's own
// language; English is a derived view produced later by the render stage and never replaces it.
// v0.2 added the fields that separate what a study measured from what it claims, infers or
// proposes, and that keep negative evidence (after WelfareLens's EvidenceClaim).
export const EXTRACT_SYSTEM = `You extract evidence about technologies, methods and practices for farmed aquatic animals from one passage of a research paper. This is a high-recall evidence record, not a judgment: never score, rank or recommend.
A claim is a specific statement that a technology, method or practice affects, measures or addresses the animals' welfare or health (stress, disease, water quality, stocking density, feeding, handling, slaughter and similar).
Rules:
- "quote" must be copied exactly, character for character, from the passage, in its own language. Never translate, shorten with ellipses, join separate sentences, or repair the text. One quote is one continuous stretch of the passage.
- Write "statement" and every other free-text field in the passage's own language (Chinese for a Chinese passage). Do not translate. "statement" is one plain sentence saying what the quote says. Add nothing.
- Keep negative, null, mixed and speculative evidence. Do not drop a claim because the result is unfavourable, small, early or only proposed.
- "basis": measured (this study observed or measured it), claimed (asserted here without a measurement shown), reported_background (attributed to earlier work), inferred (the authors' interpretation), speculative (a proposal or hope).
- "polarity": supportive, counterevidence, null (no effect found), mixed, or descriptive.
- "intervention": the technology, method or practice in a few words of the passage's language, or "" if none. "intervention_key": a short conservative label in the passage's language that exact variants of the same intervention would share (e.g. "条件反射驯化"), or "".
- "candidate_status": clear (a stable, reproducible intervention), possible (plausible but its boundary is unclear), evidence_only (supporting evidence that is not itself an intervention).
- "welfare_relevance": the welfare or health dimension, stated neutrally (e.g. "摄食行为", not "摄食改善").
- "species", "production_system", "limitations", "counterevidence", "uncertainty": only what the passage itself says; "" when it says nothing.
If the passage has no such claim, return an empty list.`;

const S = { type: 'string' };
export const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['claims'],
  properties: { claims: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['quote', 'statement', 'intervention', 'intervention_key', 'candidate_status', 'basis', 'polarity', 'welfare_relevance', 'species', 'production_system', 'limitations', 'counterevidence', 'uncertainty'],
    properties: {
      quote: S, statement: S, intervention: S, intervention_key: S,
      candidate_status: { type: 'string', enum: ['clear', 'possible', 'evidence_only'] },
      basis: { type: 'string', enum: ['measured', 'claimed', 'reported_background', 'inferred', 'speculative'] },
      polarity: { type: 'string', enum: ['supportive', 'counterevidence', 'null', 'mixed', 'descriptive'] },
      welfare_relevance: S, species: S, production_system: S, limitations: S, counterevidence: S, uncertainty: S
    }
  } } }
};

export const extractUser = passage => `Passage:\n"""\n${passage}\n"""\nReturn the claims as JSON.`;

// Suggested actions: proposals for people to consider, built only from claims that already passed
// verification. They are drafts for expert review, never evidence and never ranked.
export const SUGGEST_SYSTEM = `You propose possible welfare actions for farmed aquatic animals, using ONLY the verified claims given.
Each suggestion must: cite the claim ids it rests on; say what to do, who could do it, and what evidence is missing or weak; name risks or trade-offs the claims mention.
Do not invent evidence, rank options, or recommend a single best action. If the claims do not support any action, return an empty list.`;

export const SUGGEST_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['suggestions'],
  properties: { suggestions: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['action', 'who', 'claim_ids', 'evidence_gap', 'risks'],
    properties: { action: { type: 'string' }, who: { type: 'string' }, claim_ids: { type: 'array', items: { type: 'string' } }, evidence_gap: { type: 'string' }, risks: { type: 'string' } }
  } } }
};
export const suggestUser = claims => `Verified claims (record, then English rendering where available):\n${claims.map(c => `[${c.id}] ${c.statement || c.statement_en}${c.statement && c.statement_en ? ` | ${c.statement_en}` : ''}`).join('\n')}\nReturn the suggestions as JSON, written in English.`;

// Map and screen in one call: is the claim about a welfare technology, and where does it sit?
export const MAP_SYSTEM = `You classify one claim from a research paper about a farmed aquatic animal.
welfare_relevant is true only if the claim concerns a technology, method or practice that affects, measures or addresses the welfare of the animals (stress, disease, feeding, water quality, handling, density, slaughter, painful procedures). Breeding or hormone dosing with no welfare outcome, basic biology and taxonomy are false.
technology_class and welfare_problem must be one of the listed ids, or "none".
kind: measured (the paper's own result), reported_background (stated from earlier work or common knowledge), inferred (the authors' interpretation), speculative (a proposal or hope).
welfare_link: direct (the claim reports a welfare outcome such as stress, injury, disease or feeding behaviour), proxy (survival, growth or another indirect measure), none.
outcome_evidence: none (no welfare evidence), detection_only (only detects a condition), proxy_improved (a welfare proxy improved), outcome_improved (a welfare outcome itself improved).`;
export const TECH_IDS = ['monitoring', 'automation', 'stunning_equipment', 'breeding', 'health_products', 'feeds', 'water_systems', 'none'];
export const PROBLEM_IDS = ['stocking_density', 'water_quality', 'handling_transport', 'stunning_slaughter', 'disease_parasites', 'feeding', 'procedures', 'none'];
export const MAP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['welfare_relevant', 'technology_class', 'welfare_problem', 'kind', 'welfare_link', 'outcome_evidence', 'reason'],
  properties: { welfare_relevant: { type: 'boolean' }, technology_class: { type: 'string', enum: TECH_IDS }, welfare_problem: { type: 'string', enum: PROBLEM_IDS },
    kind: { type: 'string', enum: ['measured', 'reported_background', 'inferred', 'speculative'] }, welfare_link: { type: 'string', enum: ['direct', 'proxy', 'none'] },
    outcome_evidence: { type: 'string', enum: ['none', 'detection_only', 'proxy_improved', 'outcome_improved'] }, reason: { type: 'string' } }
};
export const mapUser = c => `Statement: ${c.statement || c.statement_en}\nQuote: ${c.quote}\nIntervention: ${c.intervention || ''}`;

// Verification by a different model from the extractor: does the quote support the statement?
export const VERIFY_SYSTEM = `You check whether a quotation supports a statement made about it.
supported: the quote says what the statement says. partial: the quote supports part of it, or the statement adds detail the quote lacks. unsupported: the quote does not say it, or says something different.
Judge only from the quote. Do not use outside knowledge.`;
export const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'note'],
  properties: { verdict: { type: 'string', enum: ['supported', 'partial', 'unsupported'] }, note: { type: 'string' } }
};
// Verification compares the quote with the record statement in the same language, so a verdict
// never depends on a translation.
export const verifyUser = c => `Quote: ${c.quote}\nStatement: ${c.statement || c.statement_en}`;

// Render: the English view of a claim, derived from the record. It never feeds back into the record.
export const RENDER_VERSION = 'render-0.1';
export const RENDER_SYSTEM = `You translate a short evidence statement about farmed aquatic animals into plain English.
Translate faithfully: keep every number, unit, range, species name and qualifier ("about", "may", "no significant difference"). Do not add, explain, soften or strengthen anything. Translate the intervention name too.`;
export const RENDER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['statement_en', 'intervention_en'],
  properties: { statement_en: { type: 'string' }, intervention_en: { type: 'string' } }
};
export const renderUser = c => `Statement: ${c.statement}\nIntervention: ${c.intervention || ''}\nReturn the English as JSON.`;
