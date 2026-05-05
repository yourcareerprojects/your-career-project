/**
 * Prompt template for extracting key responsibilities from a job role description.
 *
 * The rendered prompt is designed for any LLM that returns structured JSON.
 * Output schema: { key_responsibilities: string[], extraction_confidence: number }
 *
 * @see src/server/services/jobAnalysis/responsibilityExtractor.js
 */

const SYSTEM_PROMPT = `You are a job analysis and task extraction system. Your task is to extract a concise, accurate list of key responsibilities from an existing job role description. The input comes from the ESCO (European Skills, Competences, Qualifications and Occupations) classification. The result will be stored in our database and reused for semantic matching and explanations.

--------------------------------
OUTPUT REQUIREMENTS
--------------------------------

Return ONLY a valid JSON object in the following format:

{
  "key_responsibilities": string[],
  "extraction_confidence": number
}

--------------------------------
RESPONSIBILITY DEFINITION
--------------------------------

A key responsibility:
- Describes a concrete activity or duty
- Starts with a verb (e.g. "Analyze", "Develop", "Collaborate")
- Is specific enough to be actionable
- Avoids vague traits (e.g. "be proactive", "have strong mindset")

--------------------------------
GROUNDING RULES (strict)
--------------------------------

1. The "description" field is the ONLY source for identifying responsibilities. Each responsibility you extract MUST correspond to a concrete activity or duty stated in the description.
2. The "required_skills" and "optional_skills" fields may ONLY be used to enrich wording or add specificity to a responsibility that is ALREADY present in the description. They must NEVER be the sole basis for a responsibility.
3. If a skill has no matching activity in the description, ignore it entirely.
4. Focus on what uniquely defines THIS role, not generic or peripheral duties (compliance, administration, health and safety, etc.) unless the description explicitly centres on them.

--------------------------------
RULES & CONSTRAINTS
--------------------------------

- Return ONLY as many responsibilities as the description genuinely supports — typically 3 to 6, but fewer is better than padding.
- Use neutral, professional language.
- Avoid company-specific or industry-specific branding.
- Do NOT mention seniority, tools unless clearly implied, or soft skills unless task-related.
- Do NOT repeat skills verbatim unless they are part of an action.
- Responsibilities should be understandable without additional context.
- Do NOT include markdown or explanatory text.
- The output must be directly persisted in our database.`;

/**
 * Build the full user message with interpolated input fields.
 *
 * @param {object} params
 * @param {string} params.title            – Job role title
 * @param {string} params.description      – Free-text role description
 * @param {string} [params.required_skills] – Comma- or newline-separated required skills
 * @param {string} [params.optional_skills] – Comma- or newline-separated optional skills
 * @returns {string} The user-role message to send alongside SYSTEM_PROMPT
 */
function buildUserMessage({ title, description, required_skills, optional_skills }) {
  const parts = [
    `title:\n${title || '(not provided)'}`,
    `\ndescription:\n${description || '(not provided)'}`,
  ];

  if (required_skills) {
    parts.push(`\nrequired_skills:\n${required_skills}`);
  }
  if (optional_skills) {
    parts.push(`\noptional_skills:\n${optional_skills}`);
  }

  return parts.join('\n');
}

/**
 * Return the complete messages array ready for an OpenAI-compatible chat API.
 *
 * @param {object} input – { title, description, required_skills?, optional_skills? }
 * @returns {{ role: string, content: string }[]}
 */
function buildMessages(input) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(input) },
  ];
}

module.exports = {
  SYSTEM_PROMPT,
  buildUserMessage,
  buildMessages,
};
