// Prompts and output schemas for model-driven stages. Versioned: the version is stored with records.
export const PROMPT_VERSION = 'extract-0.1';

export const EXTRACT_SYSTEM = `You extract welfare-technology claims about farmed aquatic animals from one passage of a research paper.
A claim is a specific statement that a technology, method or intervention affects, measures or addresses an animal-welfare outcome (stress, disease, water quality, stocking density, feeding, handling, slaughter and similar).
Rules:
- "quote" must be copied exactly, character for character, from the passage, in the passage's own language. Never translate, shorten with ellipses, or repair the text.
- "statement_en" is one plain English sentence saying what the passage claims. Do not add anything the passage does not say.
- "intervention" names the technology, method or action the passage describes, in a few English words (for example "recirculating aquaculture system"), or "" if the passage reports an outcome without one.
- Include only claims the passage itself supports. If it has none, return an empty list.`;

export const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['claims'],
  properties: { claims: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['quote', 'statement_en', 'intervention'],
    properties: { quote: { type: 'string' }, statement_en: { type: 'string' }, intervention: { type: 'string' } }
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
export const suggestUser = claims => `Verified claims:\n${claims.map(c => `[${c.id}] ${c.statement_en}`).join('\n')}\nReturn the suggestions as JSON.`;

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
export const mapUser = c => `Statement: ${c.statement_en}\nQuote: ${c.quote}\nIntervention: ${c.intervention || ''}`;

// Verification by a different model from the extractor: does the quote support the statement?
export const VERIFY_SYSTEM = `You check whether a quotation supports a statement made about it.
supported: the quote says what the statement says. partial: the quote supports part of it, or the statement adds detail the quote lacks. unsupported: the quote does not say it, or says something different.
Judge only from the quote. Do not use outside knowledge.`;
export const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'note'],
  properties: { verdict: { type: 'string', enum: ['supported', 'partial', 'unsupported'] }, note: { type: 'string' } }
};
export const verifyUser = c => `Quote: ${c.quote}\nStatement: ${c.statement_en}`;
