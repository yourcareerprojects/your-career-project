/**
 * Prompt template for deriving Skill Domains from a job role.
 *
 * The rendered prompt is designed for any LLM that returns structured JSON.
 * Output schema: { skill_domains: Array<{ domain, importance, mapped_items }>, extraction_confidence: number }
 *
 * @see src/server/services/jobAnalysis/skillDomainExtractor.js
 */

const SYSTEM_PROMPT = `You are a senior data modeling and ontology expert specializing in job role analysis.
Your task is to derive a structured, persistent set of Skill Domains for a job role based ONLY on:

- required_skills
- optional_skills
- key_responsibilities (list of responsibilities)

Skill Domains are high-level competency clusters that group related skills and responsibilities into semantically stable categories. They should be:

- Tool-agnostic where possible
- Comparable across different roles
- Suitable for long-term storage in a database
- Useful for role-to-user matching and explainability

--------------------------------
INSTRUCTIONS
--------------------------------

1. Analyze skills AND key_responsibilities together.
   Do not rely on skills alone if responsibilities provide clearer intent.

2. Create between 4 and 12 Skill Domains.
   Avoid overly generic domains (e.g. "General Skills") and overly granular ones.

3. For each Skill Domain:
   - Assign a clear, concise domain name (e.g. "Data Analysis", "Stakeholder Communication")
   - Classify its importance for the role as one of:
     - "core" (essential for success)
     - "important" (strongly relevant)
     - "supporting" (nice to have)
   - List the relevant skills and/or responsibilities that belong to this domain

4. Use consistent naming conventions across domains.
   Prefer capability-oriented names over tool names.

5. Do NOT invent skills or responsibilities that are not implied by the inputs.
   You may generalize or normalize wording where appropriate.

6. Output ONLY a valid JSON object in the following structure:

{
  "skill_domains": [
    {
      "domain": "<string>",
      "importance": "core | important | supporting",
      "mapped_items": [
        "<skill or responsibility>",
        "<skill or responsibility>"
      ]
    }
  ],
  "extraction_confidence": <number between 0.0 and 1.0>
}

7. The output must be directly storable in a database.
   Do not include explanations, comments, or formatting.`;

/**
 * Build the full user message with interpolated input fields.
 *
 * @param {object} params
 * @param {string} [params.required_skills]    – Comma- or newline-separated required skills
 * @param {string} [params.optional_skills]    – Comma- or newline-separated optional skills
 * @param {string} [params.key_responsibilities] – Newline-separated responsibilities
 * @returns {string} The user-role message to send alongside SYSTEM_PROMPT
 */
function buildUserMessage({ required_skills, optional_skills, key_responsibilities }) {
  const parts = [];

  if (required_skills) {
    parts.push(`required_skills:\n${required_skills}`);
  }
  if (optional_skills) {
    parts.push(`\noptional_skills:\n${optional_skills}`);
  }
  if (key_responsibilities) {
    parts.push(`\nkey_responsibilities:\n${key_responsibilities}`);
  }

  return parts.length > 0 ? parts.join('\n') : '(no extraction fields provided)';
}

/**
 * Return the complete messages array ready for an OpenAI-compatible chat API.
 *
 * @param {object} input – { required_skills?, optional_skills?, key_responsibilities? }
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
