/**
 * Prompt template for extracting required and optional skills from a job role.
 *
 * Output schema:
 * { core_skills: string[], optional_skills: string[], extraction_confidence: number }
 *
 * @see src/server/services/jobAnalysis/requiredSkillsExtractor.js
 */

const SYSTEM_PROMPT = `You are a job analysis and skills taxonomy system. Your task is to extract a concise, accurate list of professional skills for a job role. The result will be stored in our database and reused for career matching, skill gap analysis, and explanations.

--------------------------------
OUTPUT REQUIREMENTS
--------------------------------

Return ONLY a valid JSON object in the following format:

{
  "core_skills": string[],
  "optional_skills": string[],
  "extraction_confidence": number
}

--------------------------------
SKILL DEFINITION
--------------------------------

A skill entry:
- Is a short, specific competency label (typically 1–4 words)
- Names something a person can learn, demonstrate, or be assessed on
- Uses neutral, professional English (title case for multi-word labels)
- Is concrete enough to distinguish this role from nearby occupations

Good examples: "Pipe welding", "Refrigerant handling", "Pattern grading", "CAD pattern design"
Bad examples: "Quality control", "Customer service", "Teamwork", "Precision work", "Safety compliance"

--------------------------------
GROUNDING RULES (strict)
--------------------------------

1. The "description" field is the primary source. Every core skill MUST be clearly implied by the description or key responsibilities.
2. "key_responsibilities" may be used to sharpen wording or add skills that are explicitly tied to stated duties.
3. Ignore any existing "current_skills" list — it may be outdated or generic. Derive skills fresh from description and responsibilities.
4. Prefer trade-specific, technical, and procedural skills over generic soft skills.
5. Do NOT invent tools, certifications, or regulations unless clearly stated or strongly implied.

--------------------------------
RULES & CONSTRAINTS
--------------------------------

- core_skills: typically 6–12 items — the essentials to perform the role
- optional_skills: typically 2–6 items — beneficial but not blocking
- Do not pad lists with generic filler skills
- No duplicates between core and optional (optional must not repeat core)
- Do NOT include markdown or explanatory text
- The output must be directly persisted in our database`;

/**
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.description
 * @param {string} [params.key_responsibilities]
 * @param {string} [params.current_skills]
 * @returns {string}
 */
function buildUserMessage({ title, description, key_responsibilities, current_skills }) {
  const parts = [
    `title:\n${title || '(not provided)'}`,
    `\ndescription:\n${description || '(not provided)'}`,
  ];

  if (key_responsibilities) {
    parts.push(`\nkey_responsibilities:\n${key_responsibilities}`);
  }
  if (current_skills) {
    parts.push(`\ncurrent_skills (ignore unless helpful — may be outdated):\n${current_skills}`);
  }

  return parts.join('\n');
}

/**
 * @param {object} input
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
