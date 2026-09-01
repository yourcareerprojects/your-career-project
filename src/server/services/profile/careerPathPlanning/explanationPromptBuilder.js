/**
 * Prompt builder for the AI career coach.
 * The application supplies structured facts; the LLM synthesizes a personalized plan.
 */

const { formatKnownAnswers } = require('./stateManager');
const {
  formatUserContext,
  resolvePathPlanningAudience,
} = require('../../../prompts/careerPathCoachingPrompts');
const { formatCareerContextForPrompt } = require('./careerContextBuilder');
const {
  normalizePathPlanningAudience,
} = require('./questionnaireConfig');
const {
  buildCareerCoachJsonSchemaBlock,
  buildSharedOutputRules,
} = require('./careerCoachJsonContract');

function normalizeLang(lang) {
  return String(lang || 'de').toLowerCase().startsWith('en') ? 'en' : 'de';
}

/** Shared rule: all German user-facing coach copy must use Du-Form. */
const GERMAN_DU_ADDRESS_RULE = `- Sprich die Person IMMER per Du an (du/dich/dir/dein/deine) — niemals Sie/Ihnen/Ihr/Ihre.
- Das gilt für alle Zielgruppen inkl. Berufstätige und Führungskräfte.
- Alle JSON-Textfelder müssen in Du-Form sein.`;

/**
 * Audience-specific coach framing (tone + scope). Shared JSON/output rules live elsewhere.
 * @type {Record<string, { en: { intro: string, tone: string }, de: { intro: string, tone: string } }>}
 */
const AUDIENCE_COACH_FRAMING = {
  pupil: {
    en: {
      intro: `You are an experienced career coach for teenagers exploring careers after school (about 15–17 years old).
Your job is NOT to explain every possible pathway — recommend the single most suitable path and explain why.`,
      tone: 'Use simple, encouraging language for teenagers.',
    },
    de: {
      intro: `Du bist ein erfahrener Karrierecoach für Jugendliche in der Berufsorientierung (ca. 15–17 Jahre).
Deine Aufgabe ist NICHT, jeden möglichen Weg zu erklären — empfehle den EINEN am besten passenden Weg und erkläre warum.`,
      tone: 'Einfache, ermutigende Sprache für Teenager.',
    },
  },
  student: {
    en: {
      intro: `You are an experienced career coach for students, apprentices, and interns.
Recommend the single most suitable path; tie whyThisPath to study pace and extra qualification preferences.`,
      tone: 'Language appropriate for young adults (not school-pupil tone).',
    },
    de: {
      intro: `Du bist ein erfahrener Karrierecoach für Studierende, Azubis und Praktikant:innen.
Empfehle den EINEN am besten passenden Weg; verknüpfe whyThisPath mit Studientempo und Zusatzqualifikation.`,
      tone: 'Sprache auf Augenhöhe mit jungen Erwachsenen (kein Schüler-Ton).',
    },
  },
  senior: {
    en: {
      intro: `You are an experienced career coach for seasoned individual contributors and leaders.
Focus on impact, responsibility, and realistic transitions — no school-leaver or apprenticeship framing unless clearly relevant.`,
      tone: 'Clear professional language for experienced workers.',
    },
    de: {
      intro: `Du bist ein erfahrener Karrierecoach für erfahrene Fach- und Führungskräfte.
Fokus auf Wirkung, Verantwortung und realistische Übergänge — kein Schüler- oder Ausbildungs-Framing, sofern nicht klar passend.`,
      tone: 'Professionelle, klare Sprache für erfahrene Berufstätige — aber immer per Du.',
    },
  },
  career: {
    en: {
      intro: `You are an experienced career coach for early- to mid-career professionals.
Recommend the single most suitable path; tie whyThisPath to timeline, gap-closing approach, and move type (deepen/pivot/leadership).`,
      tone: 'Language appropriate for working professionals (not teen tone).',
    },
    de: {
      intro: `Du bist ein erfahrener Karrierecoach für Berufstätige mit erster bis solider Berufserfahrung.
Empfehle den EINEN am besten passenden Weg; verknüpfe whyThisPath mit Zeitrahmen, Skill-Lücken und Move-Typ.`,
      tone: 'Sprache für Berufstätige (kein Teenager-Ton) — aber immer per Du, nie Sie.',
    },
  },
};

/**
 * @param {'pupil' | 'student' | 'career' | 'senior'} audience
 * @param {boolean} isDe
 * @returns {{ intro: string, tone: string, jsonRules: string }}
 */
function getAudiencePromptBlocks(audience, isDe) {
  const normalized = normalizePathPlanningAudience(audience);
  const langKey = isDe ? 'de' : 'en';
  const framing = AUDIENCE_COACH_FRAMING[normalized]?.[langKey]
    || AUDIENCE_COACH_FRAMING.career[langKey];

  const jsonRules = isDe
    ? `Sprache & Anrede:
- ${framing.tone}
${GERMAN_DU_ADDRESS_RULE}
- Schreibe auf Deutsch.`
    : `Language:
- ${framing.tone}
- Write in English.`;

  return {
    intro: framing.intro,
    tone: framing.tone,
    jsonRules,
  };
}

function buildAlternativePathSeedsBlock(careerContext, isDe) {
  const seeds = [
    ...(Array.isArray(careerContext?.alternativePaths) ? careerContext.alternativePaths : []),
    ...(Array.isArray(careerContext?.enrichment?.alternativePathways)
      ? careerContext.enrichment.alternativePathways
      : []),
    ...(Array.isArray(careerContext?.enrichment?.studyOptions)
      ? careerContext.enrichment.studyOptions
      : []),
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, idx, arr) => arr.indexOf(item) === idx)
    .slice(0, 4);

  if (seeds.length < 2) return '';

  const lines = seeds.map((seed, idx) => `${idx + 1}. ${seed}`);
  return isDe
    ? `Alternativ-Inspiration (genau 2 getrennte alternatives-Einträge, je einer pro Weg):
${lines.join('\n')}`
    : `Alternative path seeds (exactly 2 separate alternatives entries, one per pathway):
${lines.join('\n')}`;
}

/**
 * @param {{
 *   lang: string,
 *   state: object,
 *   careerContext?: object,
 *   userContext?: object,
 *   audience?: string,
 * }} params
 * @returns {string}
 */
function buildCareerCoachSystemPrompt({
  lang,
  state,
  careerContext = {},
  userContext = {},
  audience,
}) {
  const normalizedLang = normalizeLang(lang);
  const isDe = normalizedLang === 'de';
  const resolvedAudience = normalizePathPlanningAudience(
    audience
    || state?.audience
    || resolvePathPlanningAudience(userContext?.seniority || {})
  );
  const answersBlock = formatKnownAnswers(state?.answers || {}, normalizedLang);
  const contextBlock = formatCareerContextForPrompt(careerContext, normalizedLang);
  const userBlock = formatUserContext(userContext, normalizedLang);
  const targetCareer = state?.targetCareer || careerContext?.career?.title || '';
  const { intro, jsonRules } = getAudiencePromptBlocks(resolvedAudience, isDe);
  const alternativeSeedsBlock = buildAlternativePathSeedsBlock(careerContext, isDe);
  const sharedOutputRules = buildSharedOutputRules(isDe);
  const jsonSchemaBlock = buildCareerCoachJsonSchemaBlock(isDe);

  const addressReminder = isDe
    ? '\nWICHTIG — Anrede: ausschließlich Du (du/dich/dir/dein); niemals Sie/Ihnen/Ihr.'
    : '';

  return `${intro}

${sharedOutputRules}

${jsonRules}${addressReminder}

${jsonSchemaBlock}

Audience / Zielgruppe: ${resolvedAudience}

Target career / Zielberuf:
${targetCareer}

User preferences / Nutzerpräferenzen:
${answersBlock}

${userBlock}

${contextBlock}

${alternativeSeedsBlock ? `${alternativeSeedsBlock}\n` : ''}`.trim();
}

/**
 * @param {'de'|'en'} lang
 * @returns {string}
 */
function buildCareerCoachUserPrompt(lang, options = {}) {
  const isDe = normalizeLang(lang) === 'de';
  const retryHint = options.retryHint ? `\n\n${options.retryHint}` : '';
  return (isDe
    ? 'Erstelle jetzt den personalisierten Karriereplan als JSON-Objekt gemäß Schema. Sei konkret und berufsspezifisch. Formuliere alle Texte per Du (nie Sie).'
    : 'Create the personalized career plan as a JSON object matching the schema. Be concrete and profession-specific.') + retryHint;
}

/** @deprecated Use buildCareerCoachSystemPrompt */
function buildExplanationSystemPrompt(params) {
  return buildCareerCoachSystemPrompt(params);
}

/** @deprecated Use buildCareerCoachUserPrompt */
function buildExplanationUserPrompt(lang) {
  return buildCareerCoachUserPrompt(lang);
}

module.exports = {
  buildCareerCoachSystemPrompt,
  buildCareerCoachUserPrompt,
  buildExplanationSystemPrompt,
  buildExplanationUserPrompt,
  getAudiencePromptBlocks,
  normalizeLang,
  GERMAN_DU_ADDRESS_RULE,
};
