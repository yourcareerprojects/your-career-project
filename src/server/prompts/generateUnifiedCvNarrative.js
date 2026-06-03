const { WHO_ARE_YOU_QUESTIONS, SYSTEM_PROMPT: WHO_ARE_YOU_SYSTEM_PROMPT } = require('./generateWhoAreYouNarratives');

const STRUCTURED_DIMENSION_SPECS = [
  { key: 'skillDomains', label: 'Strengths' },
  { key: 'skills', label: 'Skills' },
  { key: 'skillsInDevelopment', label: 'Skills in Development' },
  { key: 'keyResponsibilities', label: 'Responsibilities' },
  { key: 'domains', label: 'Industry sectors' },
];

const EMPTY_DIMENSION_PLACEHOLDER = 'No information available yet';
const EMPTY_WHO_PLACEHOLDER = 'No personal profile information available yet.';

const SYSTEM_PROMPT = `You generate bilingual profile narratives from structured bullet lists.

Return JSON only (no markdown fences).

## Structured dimensions (skillDomains, skills, skillsInDevelopment, keyResponsibilities, domains)

Follow these rules for each dimension with non-empty raw_items:
- Write exactly one paragraph per language in second person (plain text, no bullet lists).
- Do not copy bullets one by one; combine related ideas with light abstraction and clear meaning.
- Keep the tone polished and specific; typically 2–4 sentences (not a single short line).
- Avoid repetition and generic filler.
- If only 1–2 bullet points are provided, still write a natural, complete paragraph.
- For empty raw_items: set both de and en to exactly: "${EMPTY_DIMENSION_PLACEHOLDER}"
- German and English must be natural equivalents, not word-for-word copies.

## Who are you (only when raw_answers are provided in the user payload)

When raw_answers contains five non-empty strings, apply the full identity narrative rules below to produce whoAreYou.answers.de and whoAreYou.answers.en (five paragraphs per language, same order as raw_answers):

${WHO_ARE_YOU_SYSTEM_PROMPT.trim()}

When raw_answers are empty or all blank: each of the five strings in both languages must be exactly: "${EMPTY_WHO_PLACEHOLDER}"

## Embedding text

embeddingText: one first-person paragraph (max 650 chars) for semantic search; neutral if identity is empty.

Do not invent facts not present in the input.

Output schema:
{
  "dimensions": {
    "skillDomains": { "de": "...", "en": "..." },
    "skills": { "de": "...", "en": "..." },
    "skillsInDevelopment": { "de": "...", "en": "..." },
    "keyResponsibilities": { "de": "...", "en": "..." },
    "domains": { "de": "...", "en": "..." }
  },
  "whoAreYou": {
    "answers": {
      "de": ["...", "...", "...", "...", "..."],
      "en": ["...", "...", "...", "...", "..."]
    }
  },
  "embeddingText": "..."
}`;

/**
 * @param {{
 *   dimensions: Record<string, { label: string, rawItems: string[] }>,
 *   rawAnswers: string[],
 *   sourceLanguage?: string,
 * }} payload
 */
function buildMessages(payload = {}) {
  const sourceLanguage = String(payload.sourceLanguage || 'en').toLowerCase().split('-')[0] || 'en';
  const includeWhoAreYou = payload.includeWhoAreYou !== false;
  const rawAnswers = includeWhoAreYou && Array.isArray(payload.rawAnswers) ? payload.rawAnswers : [];
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        source_language: sourceLanguage,
        dimensions: payload.dimensions || {},
        ...(includeWhoAreYou
          ? {
              who_are_you_questions: WHO_ARE_YOU_QUESTIONS,
              raw_answers: rawAnswers,
            }
          : { raw_answers: [] }),
      }),
    },
  ];
}

module.exports = {
  SYSTEM_PROMPT,
  STRUCTURED_DIMENSION_SPECS,
  EMPTY_DIMENSION_PLACEHOLDER,
  EMPTY_WHO_PLACEHOLDER,
  buildMessages,
};
