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
