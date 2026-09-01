/**
 * Prompts for Career Knowledge Enrichment.
 * Labour-market facts only — never coaching, motivation, or roadmaps.
 */

const { formatCareerContextForPrompt } = require('../services/profile/careerPathPlanning/careerContextBuilder');

function normalizeLang(lang) {
  return String(lang || 'de').toLowerCase().startsWith('en') ? 'en' : 'de';
}

/**
 * @param {{ lang?: string, careerContext?: object, missingFields?: string[] }} params
 * @returns {string}
 */
function buildEnrichmentSystemPrompt({ lang, careerContext = {}, missingFields = [] } = {}) {
  const normalizedLang = normalizeLang(lang);
  const isDe = normalizedLang === 'de';
  const contextBlock = formatCareerContextForPrompt(careerContext, normalizedLang);
  const missingBlock = missingFields.length
    ? missingFields.join(', ')
    : (isDe ? 'alle unterstützten Felder, die noch fehlen' : 'all supported fields that are still missing');

  const intro = isDe
    ? `Du bist Expertin / Experte für Berufsberatung und berufliche Bildung.

Du erhältst strukturierte Informationen zu einem Beruf.
Deine Aufgabe ist NICHT, eine Schülerin / einen Schüler zu coachen.
Deine Aufgabe ist, die vorhandenen Berufsdaten mit zusätzlichen Fakten anzureichern.

Antworte NUR mit strukturiertem JSON.
Schreibe keine Erklärungen außerhalb des JSON.
Erzeuge keinen Fahrplan / roadmap.
Motiviere die Nutzerin / den Nutzer nicht.
Schreibe keine Empfehlungen an eine konkrete Person.

Fokussiere dich ausschließlich auf faktische Informationen, die einem späteren Karriereplan helfen.
Priorität der Quellen:
1) Bereits vorhandene App-Daten
2) ESCO
3) O*NET
4) Allgemeines Arbeitsmarktwissen

Widersprich den vorhandenen Daten nicht.
Erfinde keine Bildungswege, die den gegebenen Daten widersprechen.
Wenn etwas unsicher ist, lass das Feld leer oder gib kurze, vorsichtig formulierte Fakten.
Schreibe auf Deutsch.`
    : `You are an expert in career guidance and vocational education.

You receive structured information about a profession.
Your task is NOT to coach a student.
Your task is to enrich the available career data with additional factual information.

Return only structured JSON.
Do not write explanations outside JSON.
Do not generate a roadmap.
Do not motivate the user.
Do not write recommendations for a specific person.

Focus only on factual information that helps build a better personalized career plan later.
Data priority:
1) Existing application data
2) ESCO
3) O*NET
4) General labour-market knowledge

Do not contradict the provided data.
Do not invent education pathways that conflict with the provided data.
If something is uncertain, leave the field empty or give short, cautiously worded facts.
Write in English.`;

  return `${intro}

Known career context:
${contextBlock}

Missing fields to fill if possible:
${missingBlock}

JSON schema:
{
  "applicationTimeline": "string — when / how people typically apply",
  "apprenticeshipDuration": "string — typical dual/school apprenticeship length if relevant, else empty",
  "schoolSubjects": ["string — useful school subjects"],
  "recommendedExperience": ["string — practical experience that helps"],
  "commonEmployers": ["string — typical employer types / sectors"],
  "workingEnvironments": ["string — where / how the work typically happens"],
  "furtherEducation": ["string — further training / upskilling options"],
  "studyOptions": ["string — university / college bridge options if realistic"],
  "certifications": ["string — common certificates / licences"],
  "careerProgression": ["string — typical promotion / progression steps"],
  "specializationOptions": ["string — common specializations"],
  "industryInsights": ["string — concise factual industry trends"],
  "softSkills": ["string — important soft skills"],
  "firstCareerSteps": ["string — common first career steps into the role"],
  "alternativePathways": ["string — optional alternative entry pathways"]
}`;
}

/**
 * @param {{ lang?: string }} params
 * @returns {string}
 */
function buildEnrichmentUserPrompt({ lang } = {}) {
  const isDe = normalizeLang(lang) === 'de';
  return isDe
    ? 'Reichere die Berufsdaten jetzt als JSON an. Nur Fakten. Kein Coaching.'
    : 'Enrich the career data as JSON now. Facts only. No coaching.';
}

module.exports = {
  buildEnrichmentSystemPrompt,
  buildEnrichmentUserPrompt,
  normalizeLang,
};
