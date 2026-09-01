/** OpenAI response_format for career coach completions. */
const CAREER_COACH_RESPONSE_FORMAT = { type: 'json_object' };

/** Default retry budget — JSON mode + validation rarely need a third attempt. */
const CAREER_COACH_MAX_LLM_ATTEMPTS = 2;

/**
 * Compact JSON contract embedded once in the system prompt (replaces a long inline example).
 * @param {boolean} isDe
 * @returns {string}
 */
function buildCareerCoachJsonSchemaBlock(isDe) {
  if (isDe) {
    return `JSON-Schema (Pflichtfelder; alternatives = genau 2 getrennte Objekte mit je eigenem steps-Array):
{
  "introduction": "string",
  "whyThisPath": "string",
  "recommendedPath": { "timeline": "string?", "steps": [{ "title": "string", "description": "string", "duration": "string?" }] },
  "alternatives": [
    { "title": "string", "steps": [{ "title": "string", "description": "string", "duration": "string?" }] },
    { "title": "string", "steps": [{ "title": "string", "description": "string", "duration": "string?" }] }
  ],
  "keySkills": ["string"]
}`;
  }
  return `JSON schema (required fields; alternatives = exactly 2 separate objects, each with its own "steps" array):
{
  "introduction": "string",
  "whyThisPath": "string",
  "recommendedPath": { "timeline": "string?", "steps": [{ "title": "string", "description": "string", "duration": "string?" }] },
  "alternatives": [
    { "title": "string", "steps": [{ "title": "string", "description": "string", "duration": "string?" }] },
    { "title": "string", "steps": [{ "title": "string", "description": "string", "duration": "string?" }] }
  ],
  "keySkills": ["string"]
}`;
}

/**
 * Shared output rules for every audience (quality guardrails kept; wording deduplicated).
 * @param {boolean} isDe
 * @returns {string}
 */
function buildSharedOutputRules(isDe) {
  if (isDe) {
    return `Ausgabe-Regeln:
- Antworte NUR mit gültigem JSON (kein Markdown, kein Text außerhalb des JSON).
- Empfehle genau EINEN Hauptweg in recommendedPath (3–5 Phasen mit title + description).
- alternatives muss ein Array mit genau 2 getrennten Objekten sein — jede Alternative braucht einen eigenen steps-Fahrplan mit 3–5 Phasen (nur title + steps auf Alternativ-Ebene).
- keySkills: 3–6 wichtige Skills aus den strukturierten Daten, wenn vorhanden.
- Sei berufsspezifisch und konkret; vermeide austauschbare Generika.
- Priorität der Fakten: 1) App-Daten 2) ESCO 3) O*NET 4) vorsichtiges Allgemeinwissen.
- Erfinde keine Bildungswege, die den bereitgestellten Daten widersprechen.
- Zwei verschiedene Berufe müssen klar unterschiedliche Pläne ergeben.`;
  }
  return `Output rules:
- Reply ONLY with valid JSON (no markdown, no text outside JSON).
- Recommend exactly ONE main path in recommendedPath (3–5 phases with title + description).
- alternatives must be an array of exactly 2 separate objects — each alternative must include its own steps roadmap with 3–5 phases (title + steps only at alternative level).
- keySkills: 3–6 important skills from structured data when available.
- Be profession-specific and concrete; avoid generic interchangeable advice.
- Fact priority: 1) application data 2) ESCO 3) O*NET 4) careful general knowledge.
- Do not invent education pathways that contradict the provided data.
- Two different professions must produce clearly different plans.`;
}

module.exports = {
  CAREER_COACH_RESPONSE_FORMAT,
  CAREER_COACH_MAX_LLM_ATTEMPTS,
  buildCareerCoachJsonSchemaBlock,
  buildSharedOutputRules,
};
