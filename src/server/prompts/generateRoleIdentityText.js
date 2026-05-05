/**
 * Prompt template for generating a Role Identity Text from a job role's
 * structured fields.
 *
 * The Role Identity Text is a semantically stable paragraph designed to be
 * embedded into a vector for similarity matching, recommendation ranking,
 * and explainable AI reasoning.
 *
 * The rendered prompt is designed for any LLM that returns structured JSON.
 * Output schema: { role_identity_text: string }
 *
 * @see src/server/services/jobAnalysis/roleIdentityComposer.js
 */

const SYSTEM_PROMPT = `You create compact, standardized Role Identity Text for embeddings.

Allowed inputs only:
- title (canonical)
- alternative_titles
- description

Primary objective:
- maximize semantic clarity, precision, keyword density, terminology consistency, and comparability across roles
- optimize for role-to-user identity similarity: dense prose a candidate would recognize as "this is me," not a dry spec with section labels

Strict generation rules:
1. Ground every claim in the title and description. Do not invent employers, tools, products, metrics, or niche domain facts not supported there.
2. You may add at most one short clause of standard, occupational collegial context (for example: interfaces with maintenance, quality, operations, or engineering) only when that pattern is typical for the title family and consistent with the description, and keep it generic (no named teams or systems).
3. Output a single fluent paragraph under 90 words. No bullet lists, no colons used as section headers (for example, never lead with "Environment:" or "Focuses on:").
4. Start with the canonical title, then meaningful alternative titles in parentheses, comma-separated.
5. Choose alternatives that expand retrieval: include broader occupational synonyms where accurate, and drop near-duplicates that only repeat the same wording with minor edits.
6. Describe work with active verbs (for example: operates, monitors, coordinates, assesses, troubleshoots, optimizes) and prefer one clear outcome or value-chain phrase (for example, material-to-deliverable or process-to-customer impact) over isolated jargon fragments when the description supports it.
7. In one clause, pack 3 to 5 parallel capability or trait signals when supported (technical and behavioral: for example hands-on skill, problem-solving, attention to detail, adaptability, precision); avoid collapsing everything into a vague "technical skills" label.
8. When stakeholders or partnership are stated or strongly implied, include one compact sentence on how the role collaborates or aligns with adjacent functions to stabilize or improve the work (for example troubleshooting and process optimization with other specialists).
9. Include identity-alignment phrasing for embeddings: after responsibilities and skills, use a short "Suited to" or "Ideal for individuals" phrase tying motivations and work style to evidence (for example practical mechanical work, tangible results, analytical depth)—no hype or stock phrases unsupported by the text.
10. Close with one synthesis clause (for example: emphasizes …) that bundles the role's dominant emphasis—technical competence, process awareness, domain passion, service orientation—using only supported themes.
11. Include environment, sector, and distinguishing domain keywords woven into sentences, not as labeled segments.
12. Prefer standardized role-family terminology when supported (for example: supply chain planning, inventory planning, procurement planning).
13. Avoid storytelling, subjective hype, filler, and duplicative near-synonyms in the same sentence.

Preferred flow (same paragraph, continuous prose):
[Title] ([Alternative titles]). [What they do and the outcomes or flow they own]. [Clustered skills and traits]. [Collaboration or operating pattern if allowed by rules 2 and 8]. [Suited-to / ideal-for motivation and temperament]. [Setting and domain keywords]. [Closing emphasis clause].

Return ONLY valid JSON:
{
  "role_identity_text": "<single paragraph, under 90 words>"
}
No explanations. No additional text.`;

/**
 * Build the full user message with interpolated input fields.
 *
 * @param {object} params
 * @param {string}   params.title                – Job role title
 * @param {string}   [params.alternative_titles]  – Comma-separated alternative titles
 * @param {string}   [params.description]         – Free-text role description
 * @param {string}   [params.required_skills]     – Comma-separated required/core skills
 * @param {string}   [params.optional_skills]     – Comma-separated optional skills
 * @param {string}   [params.skill_domains]       – Formatted skill domains block
 * @param {string}   [params.key_responsibilities] – Newline-separated responsibilities
 * @returns {string} The user-role message to send alongside SYSTEM_PROMPT
 */
function buildUserMessage({
  title,
  alternative_titles,
  description,
}) {
  const parts = [
    `title:\n${title || '(not provided)'}`,
  ];

  if (alternative_titles) {
    parts.push(`\nalternative_titles:\n${alternative_titles}`);
  }
  if (description) {
    parts.push(`\ndescription:\n${description}`);
  }

  return parts.join('\n');
}

/**
 * Return the complete messages array ready for an OpenAI-compatible chat API.
 *
 * @param {object} input – { title, alternative_titles?, description?, required_skills?, optional_skills?, skill_domains?, key_responsibilities? }
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
