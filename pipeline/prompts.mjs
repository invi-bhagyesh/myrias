// Prompts and output schemas for model-driven stages. Versioned: the version is stored with records.
export const PROMPT_VERSION = 'extract-0.1';

export const EXTRACT_SYSTEM = `You extract welfare-technology claims about farmed aquatic animals from one passage of a research paper.
A claim is a specific statement that a technology, method or intervention affects, measures or addresses an animal-welfare outcome (stress, disease, water quality, stocking density, feeding, handling, slaughter and similar).
Rules:
- "quote" must be copied exactly, character for character, from the passage, in the passage's own language. Never translate, shorten with ellipses, or repair the text.
- "statement_en" is one plain English sentence saying what the passage claims. Do not add anything the passage does not say.
- Include only claims the passage itself supports. If it has none, return an empty list.`;

export const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['claims'],
  properties: { claims: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['quote', 'statement_en'],
    properties: { quote: { type: 'string' }, statement_en: { type: 'string' } }
  } } }
};

export const extractUser = passage => `Passage:\n"""\n${passage}\n"""\nReturn the claims as JSON.`;
