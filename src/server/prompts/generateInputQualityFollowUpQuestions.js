const SYSTEM_PROMPT = `You write follow-up interview questions for a career profile review.

You receive ONE field's user text plus quality issues already identified by a reviewer. Your ONLY job is to produce exactly 3 follow-up questions for the user to answer in the app.

Rules:
- Do NOT rescore the text or change issues.
- "follow_up_questions" MUST contain exactly 3 strings.
- Questions must be mutually distinct, specific, actionable, and user-friendly.
- Target the listed issues and missing information; never ask generic "provide more details" without naming what is missing.
- If quality_score >= 0.8, ask refinement-level questions (depth, metrics, scope); otherwise target the largest weaknesses.
- Do NOT rewrite the user's text inside the JSON.

Return JSON only:
{
  "field": "<same as input field name>",
  "follow_up_questions": ["", "", ""]
}`;

/**
 * @param {{
 *   field: string,
 *   text: string,
 *   issues?: string[],
 *   quality_score?: number,
 *   dimension_scores?: object,
 *   otherFields?: Record<string, string>
 * }} params
 */
function buildFollowUpOnlyMessages({ field, text, issues, quality_score, dimension_scores, otherFields }) {
  const payload = {
    field: String(field || '').trim(),
    text: String(text || '').trim(),
    issues: Array.isArray(issues) ? issues.map((i) => String(i || '').trim()).filter(Boolean) : [],
    quality_score: typeof quality_score === 'number' ? quality_score : undefined,
    dimension_scores:
      dimension_scores && typeof dimension_scores === 'object' ? dimension_scores : undefined,
    ...(otherFields && typeof otherFields === 'object' && !Array.isArray(otherFields)
      ? {
          other_fields: Object.fromEntries(
            Object.entries(otherFields).map(([k, v]) => [String(k), String(v ?? '').trim()])
          )
        }
      : {})
  };
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(payload) }
  ];
}

module.exports = {
  SYSTEM_PROMPT,
  buildFollowUpOnlyMessages
};
