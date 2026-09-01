const { callOpenAI } = require('../ai/callOpenAI');
const { normalizeCoachingLang } = require('./workEnjoyCoachingService');

const {
  createInitialState,
  normalizeState,
  mergeAnswers,
  completeQuestionnaire,
  completeRoadmapGeneration,
  completeRoadmapExplanation,
  isPreferencesComplete,
} = require('./careerPathPlanning/stateManager');
const {
  resolvePathPlanningAudience,
  normalizePathPlanningAudience,
  buildQuestionnairePayload,
} = require('./careerPathPlanning/questionnaireConfig');
const { buildCareerContext } = require('./careerPathPlanning/careerContextBuilder');
const {
  enrichCareerContext,
} = require('./careerPathPlanning/careerKnowledgeEnrichmentService');
const {
  buildCareerCoachSystemPrompt,
  buildCareerCoachUserPrompt,
} = require('./careerPathPlanning/explanationPromptBuilder');
const { parseExplanationWithRetry } = require('./careerPathPlanning/explanationParser');
const {
  CAREER_COACH_RESPONSE_FORMAT,
  CAREER_COACH_MAX_LLM_ATTEMPTS,
} = require('./careerPathPlanning/careerCoachJsonContract');
const {
  buildPathPlanFromCoachPlan,
  parseLegacyPathPlanFromText,
} = require('./careerPathPlanning/roadmapGenerator');
const {
  enforceGermanDuAddressDeep,
} = require('./careerPathPlanning/germanInformalAddress');
const {
  resolveCareerContextWithPrefetch,
} = require('./careerPathPlanning/careerPathEnrichmentPrefetch');

function normalizeRole(role) {
  if (!role || typeof role !== 'object') return {};
  return {
    title: role.title ?? role.name ?? '',
    description: role.description ?? '',
    matchScore: role.matchScore ?? role.score ?? null,
    skillGaps: Array.isArray(role.skillGaps) ? role.skillGaps : [],
    recommendedActions: Array.isArray(role.recommendedActions) ? role.recommendedActions : [],
    progressionNotes: Array.isArray(role.progressionNotes) ? role.progressionNotes : [],
    requiredSkills: Array.isArray(role.requiredSkills) ? role.requiredSkills : [],
    keyResponsibilities: Array.isArray(role.keyResponsibilities)
      ? role.keyResponsibilities
      : (Array.isArray(role.keyResponsibilities?.responsibilities)
        ? role.keyResponsibilities.responsibilities
        : []),
    skillDomains: role.skillDomains && typeof role.skillDomains === 'object'
      ? role.skillDomains
      : null,
    seniority: role.seniority && typeof role.seniority === 'object' ? role.seniority : null,
    escoId: role.escoId ?? '',
    careerPathId: role.careerPathId ?? role._id ?? null,
    iscoGroup: role.iscoGroup ?? '',
    category: role.category ?? role.listCategory ?? '',
    altTitles: Array.isArray(role.altTitles) ? role.altTitles : [],
  };
}

function normalizeUserContext(userContext) {
  if (!userContext || typeof userContext !== 'object') return {};
  return {
    seniority: userContext.seniority && typeof userContext.seniority === 'object'
      ? userContext.seniority
      : {},
    skills: Array.isArray(userContext.skills) ? userContext.skills : [],
    skillsInDevelopment: Array.isArray(userContext.skillsInDevelopment)
      ? userContext.skillsInDevelopment
      : [],
    domains: Array.isArray(userContext.domains) ? userContext.domains : [],
    keyResponsibilities: Array.isArray(userContext.keyResponsibilities)
      ? userContext.keyResponsibilities
      : [],
    interests: Array.isArray(userContext.interests) ? userContext.interests : [],
    bio: userContext.bio ?? '',
    careerGoal: userContext.careerGoal ?? '',
    workEnjoyMost: userContext.workEnjoyMost ?? '',
    naturallyGoodAt: userContext.naturallyGoodAt ?? '',
    topicsIndustriesInterest: userContext.topicsIndustriesInterest ?? '',
  };
}

/**
 * @param {object} answers
 * @returns {object}
 */
function normalizePreferences(answers) {
  return mergeAnswers({}, answers || {});
}

function seniorityHasSignals(seniority) {
  if (!seniority || typeof seniority !== 'object') return false;
  return Boolean(
    seniority.currentStatus
    || seniority.highestDegree
    || seniority.mostSeniorWorkExperience
    || (seniority.yearsOfExperience != null && seniority.yearsOfExperience !== '')
  );
}

/**
 * Prefer live seniority signals; otherwise reuse a persisted state audience; else default map.
 * @param {{ userContext?: object, state?: object }} input
 * @returns {'pupil' | 'student' | 'career' | 'senior'}
 */
function resolveAudienceFromInput(input = {}) {
  const seniority = input.userContext?.seniority;
  if (seniorityHasSignals(seniority)) {
    return resolvePathPlanningAudience(seniority);
  }
  if (input.state?.audience) {
    return normalizePathPlanningAudience(input.state.audience);
  }
  return resolvePathPlanningAudience(seniority && typeof seniority === 'object' ? seniority : {});
}

/**
 * Ask the LLM career coach to synthesize a personalized plan from structured context.
 */
async function generateCareerCoachPlan({
  lang,
  state,
  careerContext,
  userContext,
  audience,
  llm,
}) {
  const system = buildCareerCoachSystemPrompt({
    lang,
    state,
    careerContext,
    userContext,
    audience,
  });

  return parseExplanationWithRetry(
    async (attempt, lastError) => {
      const isDe = String(lang || 'de').toLowerCase().startsWith('de');
      const retryHint = attempt > 1
        ? (isDe
          ? `Korrigiere die vorherige Antwort: ${lastError}. alternatives muss genau 2 getrennte Objekte mit jeweils eigenem steps-Array enthalten.`
          : `Fix the previous response: ${lastError}. alternatives must contain exactly 2 separate objects, each with its own steps array.`)
        : '';
      const user = buildCareerCoachUserPrompt(lang, { retryHint });

      const { text } = await llm({
        model: process.env.OPENAI_MODEL,
        temperature: 0.45,
        responseFormat: CAREER_COACH_RESPONSE_FORMAT,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      return text;
    },
    { maxAttempts: CAREER_COACH_MAX_LLM_ATTEMPTS, requireSteps: true, requireAlternatives: true }
  );
}

/** @deprecated Use generateCareerCoachPlan */
async function generateRoadmapExplanation(input) {
  return generateCareerCoachPlan(input);
}

/**
 * Generate a complete path plan from structured preferences + enriched career context.
 * Application collects/enrichs facts; the LLM career coach owns the personalized roadmap.
 * @param {{
 *   role?: object,
 *   userContext?: object,
 *   preferences?: object,
 *   state?: object,
 *   lang?: string,
 *   llm?: Function,
 *   enrichmentLlm?: Function,
 *   buildContext?: Function,
 *   enrichContext?: Function,
 *   skipEnrichment?: boolean,
 *   userId?: string|number|null,
 * }} input
 */
async function generateCareerPathPlan(input = {}) {
  const lang = normalizeCoachingLang(input.lang);
  const llm = typeof input.llm === 'function' ? input.llm : callOpenAI;
  const enrichmentLlm = typeof input.enrichmentLlm === 'function' ? input.enrichmentLlm : llm;
  const role = normalizeRole(input.role);
  const userContext = normalizeUserContext(input.userContext);
  const audience = resolveAudienceFromInput({ ...input, userContext });
  const buildContext = typeof input.buildContext === 'function'
    ? input.buildContext
    : buildCareerContext;
  const enrichContext = typeof input.enrichContext === 'function'
    ? input.enrichContext
    : enrichCareerContext;

  const roleTitle = String(role.title || '').trim();
  if (!roleTitle) {
    throw new Error('role.title is required');
  }

  let state = input.state
    ? normalizeState(input.state, roleTitle, audience)
    : createInitialState(roleTitle, audience);

  state = { ...state, audience };

  if (input.preferences) {
    state = {
      ...state,
      answers: normalizePreferences(input.preferences),
    };
  }

  if (!state.targetCareer) {
    state = { ...state, targetCareer: roleTitle };
  }

  if (!isPreferencesComplete(state, audience)) {
    throw new Error('All questionnaire preferences are required');
  }

  state = completeQuestionnaire(state);

  const careerContext = await resolveCareerContextWithPrefetch({
    userId: input.userId,
    role,
    lang,
    buildContext,
    enrichContext: (args) => enrichContext({
      ...args,
      llm: enrichmentLlm,
    }),
    skipEnrichment: Boolean(input.skipEnrichment),
  });

  state = completeRoadmapGeneration(state);

  const coachPlanRaw = await generateCareerCoachPlan({
    lang,
    state,
    careerContext,
    userContext,
    audience,
    llm,
  });

  const coachPlan = lang === 'de'
    ? enforceGermanDuAddressDeep(coachPlanRaw)
    : coachPlanRaw;

  state = completeRoadmapExplanation(state);

  const pathPlanRaw = buildPathPlanFromCoachPlan(coachPlan, state, lang, {
    keySkillsFallback: [
      ...(careerContext?.career?.requiredSkills || []),
      ...(careerContext?.enrichment?.softSkills || []),
    ].filter(Boolean),
  });

  const pathPlan = lang === 'de' && pathPlanRaw
    ? enforceGermanDuAddressDeep(pathPlanRaw)
    : pathPlanRaw;

  if (!pathPlan) {
    throw new Error('Failed to build path plan from career coach response');
  }

  return {
    phase: 'summary',
    complete: true,
    audience,
    pathPlan,
    careerContext,
    state,
  };
}

/**
 * Backwards-compatible entry point for POST /api/profile/career-path-coaching.
 * @param {{
 *   role?: object,
 *   userContext?: object,
 *   messages?: { role: string, content: string }[],
 *   state?: object,
 *   preferences?: object,
 *   lang?: string,
 *   llm?: Function,
 *   enrichmentLlm?: Function,
 *   buildContext?: Function,
 *   enrichContext?: Function,
 *   skipEnrichment?: boolean,
 *   userId?: string|number|null,
 * }} input
 */
async function advanceCareerPathCoaching(input = {}) {
  const role = normalizeRole(input.role);
  const roleTitle = String(role.title || '').trim();
  if (!roleTitle) {
    throw new Error('role.title is required');
  }

  const userContext = normalizeUserContext(input.userContext);
  const audience = resolveAudienceFromInput({ ...input, userContext });
  const questionnaire = buildQuestionnairePayload(audience);

  const preferences = input.preferences
    || (input.state?.answers && isPreferencesComplete({
      answers: mergeAnswers({}, input.state.answers),
      audience,
    }, audience)
      ? input.state.answers
      : null);

  if (!preferences || !isPreferencesComplete({ answers: normalizePreferences(preferences), audience }, audience)) {
    const state = input.state
      ? normalizeState(input.state, roleTitle, audience)
      : createInitialState(roleTitle, audience);

    return {
      phase: 'questionnaire',
      complete: false,
      audience,
      ...questionnaire,
      state: { ...state, audience },
    };
  }

  return generateCareerPathPlan({
    role: input.role,
    userContext,
    preferences,
    state: input.state,
    lang: input.lang,
    llm: input.llm,
    enrichmentLlm: input.enrichmentLlm,
    buildContext: input.buildContext,
    enrichContext: input.enrichContext,
    skipEnrichment: input.skipEnrichment,
    userId: input.userId,
  });
}

module.exports = {
  normalizeRole,
  normalizeUserContext,
  normalizePreferences,
  parsePathPlanFromText: parseLegacyPathPlanFromText,
  generateCareerPathPlan,
  generateCareerCoachPlan,
  generateRoadmapExplanation,
  advanceCareerPathCoaching,
  createInitialState,
  normalizeState,
  resolveAudienceFromInput,
};
