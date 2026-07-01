const { CURRENT_EMPLOYMENT_STATUS_CANONICAL } = require('../../constants/currentEmploymentStatus');
const { formatIndustryTaxonomyForPrompt } = require('../../constants/industries');

function buildMessages(cvText, lang = 'en') {
  const safeCvText = String(cvText || '').slice(0, 30000);
  const requested =
    String(lang || 'en')
      .toLowerCase()
      .split('-')[0] === 'de'
      ? 'de'
      : 'en';
  const outputLangHuman = requested === 'de' ? 'German' : 'English';

  const system = `You are an expert career analyst and semantic CV interpreter.
Return STRICT JSON only and follow the schema exactly.
Use interpretation over literal extraction.
If uncertain, keep confidence low and evidence empty.

Output language (${requested}) — all readable strings must be articulate ${outputLangHuman} at professional CV quality comparable across locales.`;

  const user = `Your task is NOT to extract text literally, but to INTERPRET the CV and map it into structured profile fields and seniority.
Do NOT output userIdentity.

The CV may be incomplete, inconsistently formatted, or ambiguous. Use best judgment and inference where needed.

Return STRICT JSON only:

{
  "structuredProfile": {
    "skillDomains": [{ "name": "", "confidence": 0.0, "evidence": [] }],
    "domains": [{ "name": "", "confidence": 0.0, "evidence": [] }],
    "responsibilities": [{ "description": "", "confidence": 0.0, "evidence": [] }],
    "skills": [{ "name": "", "level": "beginner|intermediate|advanced", "confidence": 0.0, "evidence": [] }],
    "learningGoals": [{ "name": "", "confidence": 0.0, "evidence": [] }]
  },
  "seniority": {
    "currentStatus": { "value": "", "confidence": 0.0, "evidence": [] },
    "yearsOfExperience": { "value": "", "confidence": 0.0, "evidence": [] },
    "highestDegree": { "value": "", "confidence": 0.0, "evidence": [] },
    "mostSeniorRole": { "value": "", "confidence": 0.0, "evidence": [] }
  }
}

STRUCTURED PROFILE

skillDomains requirements:
- high-level skill clusters (more generic capability themes)
- examples: Strategy, Leadership, Communication, Analysis, Execution, Design
- put job functions/capabilities here (e.g. Marketing, Sales, Business Development, Social Media, Product Management) — NOT in domains
- return 3-6 distinct skillDomains when signals exist

Domains requirements (critical — industry / sector ONLY):
- domains must be ECONOMIC SECTORS or SCIENTIFIC / INDUSTRY VERTICALS the person works in or wants to work in
- use ONLY labels from this canonical list (exact spelling): ${formatIndustryTaxonomyForPrompt(requested)}
- NEVER put these in domains (use skillDomains or skills instead): Marketing, Digital Marketing, Social Media, Business Development, Sales, HR, Product Management, Project Management, Operations, Analytics, Consulting (as a role), Design (as a job function), Customer Success
- infer from employers, products, regulated environments, and industry nouns — not from channel or go-to-market verbs
- generalize: hospital/clinic -> Healthcare; drug R&D -> Life Sciences or Pharmaceuticals; factory floor -> Manufacturing; university -> Education
- return 3-6 distinct domains when signals exist; prefer fewer if unclear
- deduplicate synonyms; map to the closest canonical sector name

Responsibilities requirements:
- return 5-10 detailed activity statements when enough signals exist
- use "description" field (not "name")
- each 8-20 words, start with an active verb
- include action + context (+ optional outcome)
- avoid short labels like "Project Management" or "Marketing"
- merge overlapping activities and avoid duplicates
${requested === 'de' ? `
Responsibilities requirements (German — mandatory):
- Write EVERY responsibility in fluent, grammatical German at professional CV quality.
- Use timeless profile-style phrases in Präsens or nominal style (e.g. "Leitung cross-funktionaler Teams", "Entwicklung von Softwarelösungen", "Verantwortung für die Budgetplanung") — not narrative CV copy.
- Do NOT use Präteritum (leitete, entwickelte, koordinierte) or Perfekt (hat geleitet, habe entwickelt, wurde eingeführt).
- Do NOT use English verb forms (Leading, Led, Managed, Developing).
- Rewrite past-tense bullets from the source CV into correct present-tense or nominal German before returning them.
- Keep subject–verb agreement and case government correct (von + Dative, für + Accusative).` : ''}

skills requirements:
- concrete tools, methods, and capabilities with level when inferable
- return up to 15 distinct skills when signals exist

learningGoals requirements:
- skills in development inferred from CV (courses, certifications in progress, stated goals, adjacent role transitions)
- return 2-6 items when signals exist

SENIORITY INFERENCE AND DISPLAY LANGUAGE (${requested})
- Write any human-readable seniority evidence in ${outputLangHuman} (same as the rest of the profile).
- Machine-readable VALUE fields MUST stay parser-safe:
  - seniority.currentStatus.value must be exactly one of these English slugs (never localized tokens): ${CURRENT_EMPLOYMENT_STATUS_CANONICAL.join(', ')}, or "". Examples: Schüler/Schülerin→pupil; Student/Studierende/Werkstudent→student; Praktikum/Praktikant/Auszubildende→intern; Angestellt/Beschäftigt→employed; Teilzeit→part_time; Selbstständig→self-employed; arbeitslos→unemployed. Prefer student/pupil/intern over employed when education or training clearly dominates.
  - highestDegree.value: prefer canonical slugs (none, high_school, hauptschulabschluss, realschulabschluss, ausbildung, fachabitur, associate, bachelors, masters, phd, staatsexamen, professional). Abitur→high_school; use German school slugs when the CV states them explicitly.
  - mostSeniorRole.value: prefer canonical slugs (intern, entry_level, mid_level, senior, lead, manager, director, vp, c_suite) OR a job title string we can normalize. When ambiguous, choose the LOWER level (e.g. Product Manager / Project Manager→mid_level, not manager). Reserve manager/director/vp/c_suite for clear people/org leadership, not IC role names containing "manager".
- yearsOfExperience: robust estimation from roles (not inflated).
- highestDegree: highest completed qualification only.
- mostSeniorRole: peak individual-contributor or leadership level reached; do not equate "Senior X" with executive tier.

CONFIDENCE SCORING: Use 0.0–1.0.
EVIDENCE: Do not hallucinate evidence.
MISSING DATA: Return empty value/array, confidence 0.0, evidence [].
NORMALIZATION: Avoid duplicates.

CV TEXT:
${safeCvText}`;

  return [
    { role: 'system', content: `${system}\nRequested document output locale: ${requested} (${outputLangHuman}).` },
    { role: 'user', content: user },
  ];
}

module.exports = {
  buildMessages,
};
