const User = require('../models/User');
const CareerPath = require('../models/CareerPath');
const CareerPathPlan = require('../models/CareerPathPlan');
const {
  getCachedProfileResponse,
  setCachedProfileResponse,
} = require('../services/profileGetResponseCache');
const { getDisplayLimits } = require('../config/displayLimits');
const { validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SimulationPrioritizedItem = require('../models/SimulationPrioritizedItem');
const SimulationJob = require('../models/SimulationJob');
const {
  createSimulationJob,
  reclaimStaleRunningSimulationJobs,
} = require('../services/simulationJobService');
const { runSimulationInChildProcess } = require('../services/simulation/simulationForkRunner');
const { getSimulationJobExecutionLimitMs } = require('../services/simulation/simulationJobExecutionLimits');
const { attachSimulationPoolPrefetch, buildSimulationPoolPrefetchForUserId } = require('../services/simulation/simulationPoolPrefetch');
const { generateStepId, mapPrioritizedListCategoryToStepCategory } = require('../utils/stepId');
const { getEnrichedSimulationInputs } = require('../services/documents/profileEnrichmentService');
const {
  scheduleRefreshUserIdentityEmbeddingForUser,
  normalizeUserIdentityAnswers,
  USER_IDENTITY_ANSWER_KEYS,
  mergeProfileIdentityAnswers,
} = require('../services/embedding/userIdentityEmbeddingTextService');
const {
  scheduleIdentityExplorationAfterActivity,
} = require('../services/careerIdentity/scheduleIdentityExplorationAfterActivity');
const {
  ensureExplorationAccumulationUnlocked,
} = require('../services/careerIdentity/explorationUnlockService');
const identityEngine = require('../services/careerIdentity/identityEngine');
const {
  logUserActivity,
  maybeRecordProfileFilled,
  maybeRecordFirstSimulation,
  ACTIVITY_TYPES,
} = require('../services/userHistory/logUserActivity');
const { buildUserHistoryTimeline } = require('../services/userHistory/buildUserHistoryTimeline');
const {
  mergeCvExtractLocalizationPatch,
  overlayIdentityAnswersWithCvLocalization,
  overlayStructuredUserInfoListsWithCvLocalization,
  syncCvExtractUserIdentityFromFlat,
} = require('../services/documents/cvExtractLocalization');
const {
  generateDimensionSummary,
  EMPTY_PLACEHOLDER,
} = require('../services/jobAnalysis/dimensionSummaryGenerator');
const {
  PLACEHOLDER: WHO_ARE_YOU_PLACEHOLDER,
  generateWhoAreYouNarratives,
} = require('../services/jobAnalysis/whoAreYouNarrativeGenerator');
const {
  PLACEHOLDER: WHO_ARE_YOU_IDENTITY_PLACEHOLDER,
  generateWhoAreYouIdentityEmbeddingText,
} = require('../services/jobAnalysis/whoAreYouIdentityEmbeddingTextGenerator');
const { evaluateProfileReviewFollowUps } = require('../services/jobAnalysis/inputQualityDiagnosisService');
const { normalizeCoachingCvContext } = require('../services/profile/coachingCvContext');
const { advanceWorkEnjoyCoaching } = require('../services/profile/workEnjoyCoachingService');
const { advanceTopicsIndustriesCoaching } = require('../services/profile/topicsIndustriesCoachingService');
const { advanceNaturallyGoodAtCoaching } = require('../services/profile/naturallyGoodAtCoachingService');
const { advanceWorkEnvironmentCoaching } = require('../services/profile/workEnvironmentCoachingService');
const { advanceWorkingLifeAchievementCoaching } = require('../services/profile/workingLifeAchievementCoachingService');
const { advanceCareerPathCoaching, normalizeRole } = require('../services/profile/careerPathCoachingService');
const {
  scheduleCareerPathEnrichmentPrefetch,
} = require('../services/profile/careerPathPlanning/careerPathEnrichmentPrefetch');
const { applyLocalizedFieldsToCareerPathPayload } = require('../utils/localizedResponse');
const { resolveEvaluationFlowRoles, areBothSimulationRankingsComplete } = require('../utils/evaluationFlowRoles');
const {
  mergeLocalizedCareerPathStep,
  listDistinctRoleSkillsForSelection,
  searchRoleSkillsForSelection,
  resolveRoleSkillsForSelection,
  searchRoleSkillDomainsForSelection,
} = require('../services/careerPathSkillService');
const localizedContentService = require('../services/localization/localizedContentService');
const { cachedTranslate } = require('../services/ai/translationCache');
const { translateStructured } = require('../services/ai/translateStructured');
const { getOrCreateRoleFitExplanation } = require('../services/roleFitExplanation/getOrCreateRoleFitExplanation');
const {
  buildMergedStructuredPayloadForNormalization,
  buildMergedUserIdentity,
  normalizeSeniorityFields,
  applySeniorityToUser,
  readSeniorityFromProfile,
  verifySeniorityPersisted,
  loadExtractionBaselineFromDocument,
  resolveReuseExtractionNarrativeKeys,
  resolveDimensionKeysNeedingLlmRegeneration,
  userIdentityMatchesExtraction,
} = require('../services/profile/profileReviewSaveService');
const { getNarrativeEnrichmentFromDocument } = require('../services/profile/extractionNarrativeEnrichmentService');
const {
  getProfileDisplayNarrativesReadiness,
  getProfileNarrativeQualityReadiness,
  isWhoAreYouNarrativeReady,
  isWhoAreYouNarrativeDisplayReady,
} = require('../services/profile/profileNarrativeReadinessService');
const {
  meetsWhoAreYouNarrativesQuality,
  meetsWhoAreYouLineQuality,
} = require('../services/profile/narrativeQualityGate');
const {
  classifyIdentityAnswerChanges,
} = require('../services/profile/identityAnswerChangeClassifier');
const { schedulePostProfileReviewSaveWork } = require('../services/profile/profilePostReviewSaveService');
const { scheduleDeferredProfileNarrativesForUser } = require('../services/profile/deferredProfileNarrativeService');
const { serializeEmbeddedDocumentForClient } = require('../services/documents/serializeEmbeddedDocument');
const {
  tryBuildProfileNarrativesFromDocumentCache,
  schedulePersistNarrativeEnrichmentFromApply,
} = require('../services/profile/profileReviewNarrativeApplyService');
const FIXED_MAX_SAVED_SIMULATIONS = 20;

function logControllerError(context, err, extra = undefined) {
  const payload = {
    message: err?.message || String(err),
    stack: err?.stack,
  };
  if (extra !== undefined) payload.extra = extra;
  console.error(`[profileController] ${context}`, payload);
}

const {
  normalizeStructuredListItemLabels,
} = require('../../constants/structuredListItemLabel');

function normalizeDisplayStringArray(arr = [], language = 'en') {
  return normalizeStructuredListItemLabels(arr, language);
}

function toPositiveIntEnv(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeEscoIdForLookup(value) {
  if (value == null) return '';
  return String(value).trim().replace(/\/+\s*$/g, '');
}

/**
 * Load canonical CareerPath docs for step overlays. Steps may reference `careerPathId` / `_id`
 * (reliable) or `escoId` (string variants must match the DB for `find`).
 * @returns {{ byEsco: Map<string, object>, byId: Map<string, object> }}
 */
async function buildCareerPathDocMapsForSteps(steps = []) {
  const list = Array.isArray(steps) ? steps : [];
  const escoCandidates = new Set();
  const mongoIds = [];
  for (const s of list) {
    if (!s) continue;
    if (s.escoId) {
      const r = String(s.escoId).trim();
      escoCandidates.add(r);
      escoCandidates.add(normalizeEscoIdForLookup(r));
    }
    const mid = s.careerPathId != null ? s.careerPathId : s._id;
    if (mid != null) mongoIds.push(mid);
  }

  const byEsco = new Map();
  const byId = new Map();

  function addDocToEscoMap(d) {
    if (!d || !d.escoId) return;
    const raw = String(d.escoId).trim();
    const norm = normalizeEscoIdForLookup(d.escoId);
    byEsco.set(raw, d);
    if (norm && norm !== raw) byEsco.set(norm, d);
    byEsco.set(raw.toLowerCase(), d);
    const merged = d.mergedFromEscoIds;
    if (Array.isArray(merged)) {
      for (const m of merged) {
        if (!m) continue;
        const ms = String(m).trim();
        byEsco.set(ms, d);
        byEsco.set(normalizeEscoIdForLookup(ms), d);
        byEsco.set(ms.toLowerCase(), d);
      }
    }
  }

  const escoList = [...escoCandidates].filter(Boolean);
  if (escoList.length > 0) {
    const fromEsco = await CareerPath.find({ escoId: { $in: escoList } })
      .select({
        escoId: 1,
        mergedFromEscoIds: 1,
        title: 1,
        description: 1,
        keyResponsibilities: 1,
        keyResponsibilitiesDe: 1,
        altTitles: 1,
        altTitlesDe: 1,
        hiddenTitles: 1,
        hiddenTitlesDe: 1,
      })
      .lean();
    for (const d of fromEsco) {
      addDocToEscoMap(d);
    }
  }
  if (mongoIds.length > 0) {
    const fromId = await CareerPath.find({ _id: { $in: mongoIds } })
      .select({
        _id: 1,
        escoId: 1,
        mergedFromEscoIds: 1,
        title: 1,
        description: 1,
        keyResponsibilities: 1,
        keyResponsibilitiesDe: 1,
        altTitles: 1,
        altTitlesDe: 1,
        hiddenTitles: 1,
        hiddenTitlesDe: 1,
      })
      .lean();
    for (const d of fromId) {
      if (d && d._id) byId.set(String(d._id), d);
      addDocToEscoMap(d);
    }
  }
  return { byEsco, byId };
}

function pickCareerPathDocForStep(step, maps) {
  if (!step || !maps) return null;
  const mid = step.careerPathId != null ? step.careerPathId : step._id;
  if (mid != null) {
    const fromId = maps.byId.get(String(mid));
    if (fromId) return fromId;
  }
  if (step.escoId) {
    const r = String(step.escoId).trim();
    return (
      maps.byEsco.get(r) ||
      maps.byEsco.get(r.toLowerCase()) ||
      maps.byEsco.get(normalizeEscoIdForLookup(r)) ||
      null
    );
  }
  return null;
}

function overlayStepFromCareerPathDoc(step, lang, careerPathMaps) {
  if (!step || typeof step !== 'object' || !careerPathMaps) return step;
  const cp = pickCareerPathDocForStep(step, careerPathMaps);
  if (!cp) return step;
  const td = applyLocalizedFieldsToCareerPathPayload(cp, lang, { includeSkillDomains: false });
  const out = {
    ...step,
    ...(td.title != null && td.title !== '' ? { title: td.title } : {}),
    ...(td.description != null && td.description !== '' ? { description: td.description } : {}),
  };
  if (
    td.keyResponsibilities &&
    typeof td.keyResponsibilities === 'object' &&
    Array.isArray(td.keyResponsibilities.responsibilities) &&
    td.keyResponsibilities.responsibilities.length > 0
  ) {
    out.keyResponsibilities = {
      ...(step.keyResponsibilities && typeof step.keyResponsibilities === 'object' ? step.keyResponsibilities : {}),
      responsibilities: td.keyResponsibilities.responsibilities,
    };
  }
  if (Array.isArray(td.altTitles) && td.altTitles.length > 0) {
    out.altTitles = td.altTitles;
  }
  if (Array.isArray(td.hiddenTitles) && td.hiddenTitles.length > 0) {
    out.hiddenTitles = td.hiddenTitles;
  }
  return out;
}

/**
 * Localize embedded i18n on title/description, then resolve skill + skill-domain labels for `lang`
 * (Skill collection + domain i18n). Must not run `applyLocalizedFieldsToCareerPathList` for domains first,
 * or domain objects become strings and `buildLocalizedSkillsResponse` cannot run.
 * @param {{ byEsco: Map, byId: Map }|null} [careerPathMaps] — from `buildCareerPathDocMapsForSteps` for title/description overlay
 */
async function localizeOneCareerPathShapedStep(step, language, careerPathMaps = null) {
  if (!step || typeof step !== 'object') return step;
  const lang = language || 'en';
  const withI18nText = applyLocalizedFieldsToCareerPathPayload(step, lang, { includeSkillDomains: false });
  const merged = await mergeLocalizedCareerPathStep(withI18nText, lang);
  return overlayStepFromCareerPathDoc(merged, lang, careerPathMaps);
}

/** Persist roles[] + flags only; derived dual lists / ranked boards are client-normalized on read. */
function stripDerivedEvaluationViews(flow) {
  if (!flow || typeof flow !== 'object') return flow;
  const {
    nextSteps: _nextSteps,
    outsideTheBox: _outsideTheBox,
    ranked: _ranked,
    ...rest
  } = flow;
  return rest;
}

/** Keep evaluationFlow.simulationId aligned with results.simulationId for saved-simulation UI gates. */
function syncEvaluationFlowSimulationId(results) {
  if (!results || typeof results !== 'object') return;
  const sid = results.simulationId;
  if (sid == null || sid === '') return;
  const ef = results.evaluationFlow;
  if (!ef || typeof ef !== 'object') return;
  ef.simulationId = sid;
}

async function localizeSimulationResults(results, language) {
  if (!results || typeof results !== 'object') return results;

  const normalizedLanguage = language || 'en';
  const nextRaw = Array.isArray(results.nextSteps) ? results.nextSteps : [];
  const outsideRaw = Array.isArray(results.outsideTheBox) ? results.outsideTheBox : [];
  const prioritizedNextRaw = Array.isArray(results?.prioritizedLists?.nextCareerRoles)
    ? results.prioritizedLists.nextCareerRoles
    : [];
  const prioritizedOutsideRaw = Array.isArray(results?.prioritizedLists?.outsideTheBoxRoles)
    ? results.prioritizedLists.outsideTheBoxRoles
    : [];

  const evalFlow = results.evaluationFlow && typeof results.evaluationFlow === 'object'
    ? results.evaluationFlow
    : null;
  const efRolesRaw = evalFlow ? resolveEvaluationFlowRoles(evalFlow) : [];

  const allStepsForCareerPath = [
    ...nextRaw,
    ...outsideRaw,
    ...prioritizedNextRaw,
    ...prioritizedOutsideRaw,
    ...efRolesRaw,
  ];
  const careerPathMaps = await buildCareerPathDocMapsForSteps(allStepsForCareerPath);

  const localizedNext = await Promise.all(
    nextRaw.map((s) => localizeOneCareerPathShapedStep(s, normalizedLanguage, careerPathMaps))
  );
  const localizedOutside = await Promise.all(
    outsideRaw.map((s) => localizeOneCareerPathShapedStep(s, normalizedLanguage, careerPathMaps))
  );
  const localizedPrioritizedNext = await Promise.all(
    prioritizedNextRaw.map((s) => localizeOneCareerPathShapedStep(s, normalizedLanguage, careerPathMaps))
  );
  const localizedPrioritizedOutside = await Promise.all(
    prioritizedOutsideRaw.map((s) => localizeOneCareerPathShapedStep(s, normalizedLanguage, careerPathMaps))
  );

  let localizedEvalFlow;
  if (evalFlow) {
    const locRoles = efRolesRaw.length
      ? await Promise.all(
          efRolesRaw.map((s) => localizeOneCareerPathShapedStep(s, normalizedLanguage, careerPathMaps))
        )
      : [];
    localizedEvalFlow = stripDerivedEvaluationViews({
      ...evalFlow,
      roles: locRoles,
    });
  }

  const localizedResults = {
    ...results,
    nextSteps: localizedNext,
    outsideTheBox: localizedOutside,
    ...(localizedEvalFlow ? { evaluationFlow: localizedEvalFlow } : {}),
  };

  if (results.prioritizedLists && typeof results.prioritizedLists === 'object') {
    localizedResults.prioritizedLists = {
      ...results.prioritizedLists,
      nextCareerRoles: localizedPrioritizedNext,
      outsideTheBoxRoles: localizedPrioritizedOutside,
    };
  }

  syncEvaluationFlowSimulationId(localizedResults);
  return localizedResults;
}

/** Mongoose subdocument or plain object (e.g. migrated BSON). */
function plainSimulationResultEntry(sim) {
  if (sim && typeof sim.toObject === 'function') {
    return sim.toObject();
  }
  if (sim && typeof sim === 'object') {
    return { ...sim };
  }
  return sim;
}

function normalizeSimulationResultEntryForResponse(sim, language = 'en') {
  const simulationData = plainSimulationResultEntry(sim);
  if (!simulationData || typeof simulationData !== 'object') return simulationData;
  const { careerGoal: _careerGoal, ...rest } = simulationData;
  return rest;
}

const { filterIndustryDomainRawItems } = require('../constants/industryDomainFilters');
const { normalizeIndustryDomains, normalizeOccupationDomain } = require('../../constants/industries');

const STRUCTURED_DIMENSIONS = [
  { key: 'skillDomains', label: 'Strengths' },
  { key: 'skills', label: 'Skills' },
  { key: 'skillsInDevelopment', label: 'Skills in Development' },
  { key: 'keyResponsibilities', label: 'Responsibilities' },
  { key: 'domains', label: 'Industry sectors' },
];
const SUPPORTED_NARRATIVE_LANGS = ['en', 'de'];

function normalizeLangCode(value, fallback = 'en') {
  const code = String(value || fallback).toLowerCase().split('-')[0] || fallback;
  return SUPPORTED_NARRATIVE_LANGS.includes(code) ? code : fallback;
}

function resolveNarrativeSourceLanguage(profile, fallback = 'en') {
  const fromCv = profile?.cvExtractLocalization?.documentLanguage;
  if (fromCv) return normalizeLangCode(fromCv, fallback);
  return normalizeLangCode(fallback, 'en');
}

function hydrateLocalizedSummaryField(existingField, canonicalText, canonicalLanguage, localizedMap = {}) {
  const canonicalLang = normalizeLangCode(canonicalLanguage, 'en');
  let field = localizedContentService.ensureNested(existingField, canonicalLang);
  field.original_language = canonicalLang;
  field.original = canonicalText;
  field.translations = {
    ...(field.translations || {}),
    [canonicalLang]: canonicalText,
  };
  for (const lang of SUPPORTED_NARRATIVE_LANGS) {
    const localizedText = localizedMap?.[lang];
    if (typeof localizedText !== 'string' || !localizedText.trim()) continue;
    field.translations[lang] = localizedText.trim();
  }
  return field;
}

async function ensureBilingualSummaryField(existingField, canonicalText, canonicalLanguage, localizedMap = {}) {
  const canonicalLang = normalizeLangCode(canonicalLanguage, 'en');
  let field = hydrateLocalizedSummaryField(existingField, canonicalText, canonicalLang, localizedMap);
  for (const lang of SUPPORTED_NARRATIVE_LANGS) {
    if (lang === canonicalLang) continue;
    const existing = String(localizedContentService.get(field, lang) || '').trim();
    if (existing) continue;
    try {
      const translated = await cachedTranslate(canonicalText, lang, () => translateStructured(canonicalText, lang));
      const safe = String(translated || '').trim();
      if (safe) {
        field = localizedContentService.set(field, lang, safe);
      }
    } catch (_) {
      // Keep canonical text only if translation fails.
    }
  }
  return field;
}

function isWhoAreYouPlaceholderSummaryJson(summaryText = '') {
  const parsed = parseWhoAreYouNarratives(summaryText);
  return parsed.length === 5 && parsed.every((value) => value === WHO_ARE_YOU_PLACEHOLDER);
}

function whoAreYouSummaryJsonDiffers(leftJson = '', rightJson = '') {
  try {
    const left = JSON.parse(String(leftJson || '').trim());
    const right = JSON.parse(String(rightJson || '').trim());
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== 5 || right.length !== 5) {
      return true;
    }
    return left.some((line, idx) => String(line || '').trim() !== String(right[idx] || '').trim());
  } catch (_) {
    return true;
  }
}

function buildDeferredWhoAreYouSummaryText({
  parsedForQuality = [],
  rawAnswers = [],
  currentSummaryIsPlaceholder = false,
  currentSummary = '',
  changedRaw: _changedRaw = false,
  narrativesStaleForAnswers = false,
  identityChangeClass = null,
  previousRawAnswers = [],
}) {
  if (
    !currentSummary
    || currentSummaryIsPlaceholder
    || parsedForQuality.every((value) => value === WHO_ARE_YOU_PLACEHOLDER)
  ) {
    return JSON.stringify(Array(5).fill(WHO_ARE_YOU_PLACEHOLDER));
  }

  const patched = [...parsedForQuality];
  while (patched.length < 5) patched.push(WHO_ARE_YOU_PLACEHOLDER);
  const changeClass = identityChangeClass || classifyIdentityAnswerChanges(previousRawAnswers, rawAnswers);
  const indicesToInvalidate = new Set(changeClass.changedIndices);
  if (narrativesStaleForAnswers && !changeClass.hasChanges) {
    for (let idx = 0; idx < 5; idx += 1) {
      if (!meetsWhoAreYouLineQuality(patched[idx], rawAnswers[idx])) {
        indicesToInvalidate.add(idx);
      }
    }
  }
  for (const idx of indicesToInvalidate) {
    if (idx >= 0 && idx < 5) patched[idx] = WHO_ARE_YOU_PLACEHOLDER;
  }
  return JSON.stringify(patched.slice(0, 5));
}

async function ensureBilingualWhoAreYouSummaryField(existingField, canonicalSummaryText, canonicalLanguage, localizedMap = {}) {
  const canonicalLang = normalizeLangCode(canonicalLanguage, 'en');
  const canonicalArray = parseWhoAreYouNarratives(canonicalSummaryText);
  const invalidateStaleTranslations = isWhoAreYouPlaceholderSummaryJson(canonicalSummaryText);
  const baseField = invalidateStaleTranslations ? undefined : existingField;
  let field = hydrateLocalizedSummaryField(baseField, canonicalSummaryText, canonicalLang, localizedMap);
  for (const lang of SUPPORTED_NARRATIVE_LANGS) {
    if (lang === canonicalLang) continue;
    if (invalidateStaleTranslations) {
      field = localizedContentService.set(field, lang, canonicalSummaryText);
      continue;
    }
    const existingRaw = String(localizedContentService.get(field, lang) || '').trim();
    if (existingRaw && !whoAreYouSummaryJsonDiffers(existingRaw, canonicalSummaryText)) continue;
    try {
      const translated = await cachedTranslate(canonicalArray, lang, () => translateStructured(canonicalArray, lang));
      if (Array.isArray(translated) && translated.length === 5) {
        const safeJson = JSON.stringify(
          translated.map((value) => String(value || '').trim() || WHO_ARE_YOU_PLACEHOLDER)
        );
        field = localizedContentService.set(field, lang, safeJson);
      }
    } catch (_) {
      // Keep canonical text only if translation fails.
    }
  }
  return field;
}

function readDimensionRawItems(value) {
  if (Array.isArray(value)) return normalizeDisplayStringArray(value);
  if (value && typeof value === 'object' && Array.isArray(value.raw_items)) {
    return normalizeDisplayStringArray(value.raw_items);
  }
  return [];
}

function readDimensionSummaryText(value, language = 'en') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const lang = normalizeLangCode(language, 'en');
  if (typeof value.summary_text === 'string') {
    return String(value.summary_text).trim();
  }
  const summary = localizedContentService.get(value.summary_text, lang);
  if (typeof summary === 'string') return summary.trim();
  return '';
}

function isPlaceholderDimensionSummary(summaryText) {
  const s = String(summaryText || '').trim();
  return !s || s === EMPTY_PLACEHOLDER;
}

function hasNarrativeDimensionShape(value, language = 'en') {
  const summary = value && typeof value === 'object'
    ? localizedContentService.get(value.summary_text, normalizeLangCode(language, 'en'))
    : null;
  return Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray(value.raw_items) &&
    typeof summary === 'string'
  );
}

/** True when every structured dimension already has persisted raw_items + readable summary_text. */
function structuredUserInfoHasPersistedNarratives(structured = {}, language = 'en') {
  if (!structured || typeof structured !== 'object') return false;
  const lang = normalizeLangCode(language, 'en');
  return STRUCTURED_DIMENSIONS.every(({ key }) => hasNarrativeDimensionShape(structured[key], lang));
}

function profileWhoAreYouNeedsNarrativeWork(
  profile = {},
  sourceLang = 'en',
  identityChangeClass = null
) {
  const lang = normalizeLangCode(sourceLang, 'en');
  const rawAnswers = buildWhoAreYouRawAnswersFromIdentity(profile.userIdentityAnswers || {});
  if (!rawAnswers.some(Boolean)) return false;
  const who = profile.who_are_you || {};
  const currentSummary = String(localizedContentService.get(who.summary_text, lang) || '').trim();
  const parsed = parseWhoAreYouNarratives(currentSummary);
  const currentSummaryIsPlaceholder = !currentSummary || parsed.every((value) => value === WHO_ARE_YOU_PLACEHOLDER);
  const storedRaw = Array.isArray(who.raw_answers)
    ? who.raw_answers.map((value) => String(value || '').trim())
    : [];
  const changeClass = identityChangeClass || classifyIdentityAnswerChanges(storedRaw, rawAnswers);
  if (currentSummaryIsPlaceholder) return true;
  if (changeClass.onlyMinorChanges) return false;
  if (!changeClass.hasChanges) {
    return !meetsWhoAreYouNarrativesQuality(parsed, rawAnswers);
  }
  return changeClass.hasMajorChange;
}

function schedulePendingProfileNarrativesIfNeeded(userId, profile = {}, language = 'en') {
  const narrativeStatus = ensureProfileNarrativeBackfillScheduled(userId, profile, language);
  return {
    narrativesReady: narrativeStatus.ready,
    narrativePending: narrativeStatus.pending,
  };
}

function ensureProfileNarrativeBackfillScheduled(userId, profile = {}, language = 'en') {
  const narrativeSourceLanguage = resolveNarrativeSourceLanguage(profile || {}, 'en');
  const displayReadiness = getProfileDisplayNarrativesReadiness(profile || {}, language);
  const qualityReadiness = getProfileNarrativeQualityReadiness(profile || {}, language);
  if (!displayReadiness.ready || !qualityReadiness.ready) {
    const pendingSource = !qualityReadiness.ready ? qualityReadiness : displayReadiness;
    const dimensionKeys = pendingSource.pending
      .filter((field) => field.startsWith('structuredUserInfo.'))
      .map((field) => field.slice('structuredUserInfo.'.length));
    scheduleDeferredProfileNarrativesForUser(userId, {
      dimensionKeys,
      deferWhoAreYou: pendingSource.pending.includes('who_are_you'),
      language,
      sourceLanguage: narrativeSourceLanguage,
    });
  }
  return displayReadiness;
}

async function toNarrativeDimension(
  value,
  label,
  { forceRegenerate = false, deferLlm = false, language = 'en', sourceLanguage = 'en' } = {}
) {
  const targetLang = normalizeLangCode(language, 'en');
  const sourceLang = normalizeLangCode(sourceLanguage, 'en');
  const rawItems = readDimensionRawItems(value);
  if (rawItems.length === 0) {
    return {
      raw_items: [],
      summary_text: await ensureBilingualSummaryField(
        value?.summary_text,
        EMPTY_PLACEHOLDER,
        sourceLang,
        {}
      ),
    };
  }
  const existingSummaryRaw = readDimensionSummaryText(value, sourceLang);
  const existingSummary = isPlaceholderDimensionSummary(existingSummaryRaw) ? '' : existingSummaryRaw;
  let summaryText = (!forceRegenerate && existingSummary)
    ? existingSummary
    : '';
  if (!summaryText && deferLlm) {
    return {
      raw_items: rawItems,
      summary_text: await ensureBilingualSummaryField(
        value?.summary_text,
        EMPTY_PLACEHOLDER,
        sourceLang,
        {}
      ),
    };
  }
  if (!summaryText) {
    const generated = await generateDimensionSummary(
      { dimension: label, rawItems },
      { lang: targetLang, sourceLang, returnBundle: true }
    );
    summaryText = String(generated?.canonical || '').trim() || EMPTY_PLACEHOLDER;
    const canonicalLanguage = normalizeLangCode(generated?.canonicalLanguage || sourceLang, sourceLang);
    const summaryField = await ensureBilingualSummaryField(
      value?.summary_text,
      summaryText || EMPTY_PLACEHOLDER,
      canonicalLanguage,
      generated?.localized || {}
    );
    return {
      raw_items: rawItems,
      summary_text: summaryField,
    };
  }
  return {
    raw_items: rawItems,
    summary_text: await ensureBilingualSummaryField(
      value?.summary_text,
      summaryText || EMPTY_PLACEHOLDER,
      sourceLang,
      {}
    ),
  };
}

async function normalizeStructuredUserInfoForStorage(
  structuredInfo = {},
  { forceRegenerate = false, deferLlmDimensionKeys = [], language = 'en', sourceLanguage = 'en' } = {}
) {
  const targetLang = normalizeLangCode(language, 'en');
  const sourceLang = normalizeLangCode(sourceLanguage, 'en');
  const input = structuredInfo && typeof structuredInfo === 'object' ? structuredInfo : {};
  const deferLlmSet = new Set(Array.isArray(deferLlmDimensionKeys) ? deferLlmDimensionKeys : []);
  const pairs = await Promise.all(
    STRUCTURED_DIMENSIONS.map(async (dimension) => {
      const originalSource = input[dimension.key];
      let source = originalSource;
      let domainSanitized = false;
      if (dimension.key === 'domains') {
        const before = readDimensionRawItems(originalSource);
        const after = normalizeIndustryDomains(
          filterIndustryDomainRawItems(before),
          { keepUnknown: true }
        );
        if (before.length !== after.length || before.some((b, i) => b !== after[i])) {
          domainSanitized = true;
        }
        if (Array.isArray(originalSource)) {
          source = after;
        } else if (originalSource && typeof originalSource === 'object') {
          source = { ...originalSource, raw_items: after };
        } else {
          source = { raw_items: after, summary_text: readDimensionSummaryText(originalSource, sourceLang) };
        }
      }
      const value = await toNarrativeDimension(source, dimension.label, {
        forceRegenerate,
        deferLlm: deferLlmSet.has(dimension.key),
        language: targetLang,
        sourceLanguage: sourceLang,
      });
      const dimensionChanged =
        domainSanitized ||
        forceRegenerate ||
        !hasNarrativeDimensionShape(originalSource, sourceLang) ||
        !readDimensionSummaryText(originalSource, sourceLang);
      return { key: dimension.key, value, dimensionChanged };
    })
  );
  const normalized = {};
  let changed = false;
  for (const { key, value, dimensionChanged } of pairs) {
    normalized[key] = value;
    if (dimensionChanged) changed = true;
  }
  return { normalized, changed };
}

function buildWhoAreYouRawAnswersFromIdentity(identityAnswers = {}) {
  const normalized = normalizeUserIdentityAnswers(identityAnswers || {});
  return USER_IDENTITY_ANSWER_KEYS.map((key) => String(normalized[key] || '').trim());
}

function parseWhoAreYouNarratives(summaryText = '') {
  const fallback = Array(5).fill(WHO_ARE_YOU_PLACEHOLDER);
  const raw = String(summaryText || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 5) return fallback;
    return parsed.map((value) => String(value || '').trim() || WHO_ARE_YOU_PLACEHOLDER);
  } catch (_) {
    return fallback;
  }
}

/**
 * Set selected narrative slots to the placeholder across bilingual summary_text.
 * Used when regenerating only specific who-are-you sub-sections.
 */
function invalidateWhoAreYouSummaryIndices(summaryField, indices = []) {
  const indexSet = new Set(
    (Array.isArray(indices) ? indices : [])
      .map((idx) => Number(idx))
      .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < 5)
  );
  if (indexSet.size === 0) return summaryField;

  const patchJson = (raw) => {
    const parsed = parseWhoAreYouNarratives(raw);
    for (const idx of indexSet) {
      parsed[idx] = WHO_ARE_YOU_PLACEHOLDER;
    }
    return JSON.stringify(parsed);
  };

  if (summaryField == null || typeof summaryField === 'string') {
    return patchJson(summaryField || '');
  }
  if (typeof summaryField !== 'object' || Array.isArray(summaryField)) {
    return patchJson('');
  }

  let field = {
    ...summaryField,
    translations: { ...(summaryField.translations || {}) },
  };
  const langs = new Set([
    ...SUPPORTED_NARRATIVE_LANGS,
    normalizeLangCode(field.original_language, 'en'),
    ...Object.keys(field.translations || {}),
  ]);
  for (const lang of langs) {
    const existing = String(localizedContentService.get(field, lang) || '').trim();
    if (!existing) continue;
    field = localizedContentService.set(field, lang, patchJson(existing));
  }
  if (typeof field.original === 'string' && field.original.trim()) {
    field.original = patchJson(field.original);
  }
  return field;
}

/**
 * Regenerate one (or more) who-are-you narrative slots without wiping the others.
 * Updates only the selected raw_answers indices to current identity answers.
 */
function applyPartialWhoAreYouForceRegenerate({
  existingWhoAreYou = {},
  nextRawAnswers = [],
  indices = [],
} = {}) {
  const indexSet = new Set(
    (Array.isArray(indices) ? indices : [])
      .map((idx) => Number(idx))
      .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < 5)
  );
  const existingRaw = Array.isArray(existingWhoAreYou.raw_answers)
    ? existingWhoAreYou.raw_answers.map((value) => String(value || '').trim())
    : [];
  const identityRaw = Array.isArray(nextRawAnswers)
    ? nextRawAnswers.map((value) => String(value || '').trim())
    : [];
  const mergedRaw = [];
  for (let idx = 0; idx < 5; idx += 1) {
    if (indexSet.has(idx) || !existingRaw[idx]) {
      mergedRaw[idx] = identityRaw[idx] || '';
    } else {
      mergedRaw[idx] = existingRaw[idx];
    }
  }
  return {
    ...existingWhoAreYou,
    raw_answers: mergedRaw,
    summary_text: invalidateWhoAreYouSummaryIndices(existingWhoAreYou.summary_text, [...indexSet]),
    identity_embedding_text: String(existingWhoAreYou.identity_embedding_text || '').trim(),
  };
}

async function normalizeWhoAreYouForStorage(
  profile = {},
  {
    forceRegenerate = false,
    deferLlm = false,
    language = 'en',
    sourceLanguage = 'en',
    identityChangeClass = null,
  } = {}
) {
  const targetLang = normalizeLangCode(language, 'en');
  const sourceLang = normalizeLangCode(sourceLanguage, 'en');
  const source = profile && typeof profile === 'object' ? profile : {};
  const rawAnswers = buildWhoAreYouRawAnswersFromIdentity(source.userIdentityAnswers || {});
  const currentSummary = String(localizedContentService.get(source.who_are_you?.summary_text, sourceLang) || '').trim();
  const currentIdentityEmbeddingText = String(source.who_are_you?.identity_embedding_text || '').trim();
  const hasRawAnswers = rawAnswers.some(Boolean);
  const changedRaw =
    !Array.isArray(source.who_are_you?.raw_answers) ||
    JSON.stringify((source.who_are_you?.raw_answers || []).map((v) => String(v || '').trim())) !== JSON.stringify(rawAnswers);

  let summaryText = currentSummary;
  let identityEmbeddingText = currentIdentityEmbeddingText;
  let changed = changedRaw;
  let localizedSummaryMap = {};
  let summaryFieldSourceLang = sourceLang;

  if (!hasRawAnswers) {
    const placeholderSummary = JSON.stringify(Array(5).fill(WHO_ARE_YOU_PLACEHOLDER));
    if (summaryText !== placeholderSummary) changed = true;
    summaryText = placeholderSummary;
    if (identityEmbeddingText !== WHO_ARE_YOU_IDENTITY_PLACEHOLDER) changed = true;
    identityEmbeddingText = WHO_ARE_YOU_IDENTITY_PLACEHOLDER;
  } else {
    const parsed = parseWhoAreYouNarratives(summaryText);
    const currentSummaryIsPlaceholder = !currentSummary || parsed.every((value) => value === WHO_ARE_YOU_PLACEHOLDER);
    const parsedForQuality = parseWhoAreYouNarratives(summaryText);
    const narrativesStaleForAnswers =
      changedRaw
      || !meetsWhoAreYouNarrativesQuality(parsedForQuality, rawAnswers);
    const onlyMinorChanges = identityChangeClass?.onlyMinorChanges === true;
    const needsGeneration = !deferLlm && (
      forceRegenerate
      || (
        !onlyMinorChanges
        && (
          currentSummaryIsPlaceholder
          || narrativesStaleForAnswers
        )
      )
    );
    if (
      onlyMinorChanges
      && changedRaw
      && !currentSummaryIsPlaceholder
      && !deferLlm
      && !forceRegenerate
    ) {
      const patched = [...parsedForQuality];
      for (const idx of identityChangeClass.minorIndices) {
        patched[idx] = String(rawAnswers[idx] || '').trim() || WHO_ARE_YOU_PLACEHOLDER;
      }
      summaryText = JSON.stringify(patched);
      localizedSummaryMap = Object.fromEntries(
        SUPPORTED_NARRATIVE_LANGS.map((langCode) => [langCode, summaryText])
      );
      changed = true;
    } else if (needsGeneration) {
      const generated = await generateWhoAreYouNarratives(rawAnswers, {
        lang: targetLang,
        sourceLang,
        returnBundle: true,
      });
      const safeNarratives = Array.isArray(generated?.canonical) && generated.canonical.length === 5
        ? generated.canonical.map((value) => String(value || '').trim() || WHO_ARE_YOU_PLACEHOLDER)
        : Array(5).fill(WHO_ARE_YOU_PLACEHOLDER);
      summaryText = JSON.stringify(safeNarratives);
      summaryFieldSourceLang = normalizeLangCode(generated?.canonicalLanguage || sourceLang, sourceLang);
      localizedSummaryMap = Object.fromEntries(
        Object.entries(generated?.localized || {}).map(([lang, arr]) => [
          lang,
          Array.isArray(arr)
            ? JSON.stringify(arr.map((value) => String(value || '').trim() || WHO_ARE_YOU_PLACEHOLDER))
            : null,
        ])
      );
      changed = true;
    } else if (
      deferLlm
      && (
        forceRegenerate
        || changedRaw
        || narrativesStaleForAnswers
        || !currentSummary
        || parsed.every((value) => value === WHO_ARE_YOU_PLACEHOLDER)
      )
    ) {
      if (forceRegenerate) {
        summaryText = JSON.stringify(Array(5).fill(WHO_ARE_YOU_PLACEHOLDER));
      } else {
        const previousRawAnswers = Array.isArray(source.who_are_you?.raw_answers)
          ? source.who_are_you.raw_answers.map((value) => String(value || '').trim())
          : [];
        summaryText = buildDeferredWhoAreYouSummaryText({
          parsedForQuality,
          rawAnswers,
          currentSummaryIsPlaceholder,
          currentSummary,
          changedRaw,
          narrativesStaleForAnswers,
          identityChangeClass,
          previousRawAnswers,
        });
      }
      changed = true;
    }
    const needsIdentityGeneration = !deferLlm && (forceRegenerate || !currentIdentityEmbeddingText);
    if (needsIdentityGeneration) {
      identityEmbeddingText = await generateWhoAreYouIdentityEmbeddingText(rawAnswers);
      changed = true;
    } else if (deferLlm && (forceRegenerate || !currentIdentityEmbeddingText)) {
      identityEmbeddingText = WHO_ARE_YOU_IDENTITY_PLACEHOLDER;
      changed = true;
    }
  }

  let summaryField = await ensureBilingualWhoAreYouSummaryField(
    source.who_are_you?.summary_text,
    summaryText,
    summaryFieldSourceLang,
    localizedSummaryMap
  );

  for (const code of SUPPORTED_NARRATIVE_LANGS) {
    const before = String(localizedContentService.get(source.who_are_you?.summary_text, code) || '').trim();
    const after = String(localizedContentService.get(summaryField, code) || '').trim();
    if (before !== after) {
      changed = true;
      break;
    }
  }

  return {
    normalized: {
      raw_answers: rawAnswers,
      summary_text: summaryField,
      identity_embedding_text: identityEmbeddingText,
    },
    changed,
  };
}

function resolveDomainsFromStructuredInfo(structuredInfo = {}) {
  return readDimensionRawItems(structuredInfo.domains);
}

async function enrichCareerSimulationInputsForClientResponse(
  careerSimulationInputs,
  _profileStructured = {},
  options = {}
) {
  if (!careerSimulationInputs || typeof careerSimulationInputs !== 'object') {
    return careerSimulationInputs;
  }
  const plain =
    typeof careerSimulationInputs.toObject === 'function'
      ? careerSimulationInputs.toObject({ flattenMaps: true })
      : { ...careerSimulationInputs };
  const csiStructured =
    plain.structuredUserInfo && typeof plain.structuredUserInfo === 'object' ? plain.structuredUserInfo : {};
  plain.structuredUserInfo = normalizeLocalizedProfileFieldsForResponse(
    { structuredUserInfo: csiStructured },
    options.language || 'en'
  ).structuredUserInfo;
  return plain;
}

function normalizeLocalizedProfileFieldsForResponse(profile, language = 'en') {
  if (!profile || typeof profile !== 'object') return profile;
  const out = { ...profile };
  const serializeSummary = (dimension) => {
    if (!dimension || typeof dimension !== 'object') return dimension;
    return {
      ...dimension,
      summary_text: localizedContentService.normalizeForResponse(dimension.summary_text, language) || '',
    };
  };

  if (out.who_are_you && typeof out.who_are_you === 'object') {
    out.who_are_you = {
      ...out.who_are_you,
      summary_text: localizedContentService.normalizeForResponse(out.who_are_you.summary_text, language) || '',
    };
  }

  if (out.structuredUserInfo && typeof out.structuredUserInfo === 'object') {
    out.structuredUserInfo = {
      ...out.structuredUserInfo,
      skillDomains: serializeSummary(out.structuredUserInfo.skillDomains),
      skills: serializeSummary(out.structuredUserInfo.skills),
      skillsInDevelopment: serializeSummary(out.structuredUserInfo.skillsInDevelopment),
      keyResponsibilities: serializeSummary(out.structuredUserInfo.keyResponsibilities),
      domains: serializeSummary(out.structuredUserInfo.domains),
    };
  }

  if (out.careerSimulationInputs && typeof out.careerSimulationInputs === 'object') {
    const csiStructured = out.careerSimulationInputs.structuredUserInfo;
    if (csiStructured && typeof csiStructured === 'object') {
      out.careerSimulationInputs = {
        ...out.careerSimulationInputs,
        structuredUserInfo: {
          ...csiStructured,
          skillDomains: serializeSummary(csiStructured.skillDomains),
          skills: serializeSummary(csiStructured.skills),
          skillsInDevelopment: serializeSummary(csiStructured.skillsInDevelopment),
          keyResponsibilities: serializeSummary(csiStructured.keyResponsibilities),
          domains: serializeSummary(csiStructured.domains),
        },
      };
    }
  }

  return out;
}

// Function to calculate and update career simulation inputs
const calculateCareerSimulationInputs = async (profile) => {
  const inputs = {
    structuredUserInfo: {
      skillDomains: [],
      skills: [],
      skillsInDevelopment: [],
      keyResponsibilities: [],
      domains: []
    },
    userIdentity: normalizeUserIdentityAnswers({}),
    seniority: {
      currentStatus: '',
      yearsOfExperience: null,
      highestDegree: '',
      mostSeniorWorkExperience: ''
    },
    lastCalculated: new Date()
  };

  const structured =
    profile.structuredUserInfo && typeof profile.structuredUserInfo === 'object'
      ? (typeof profile.structuredUserInfo.toObject === 'function'
        ? profile.structuredUserInfo.toObject()
        : profile.structuredUserInfo)
      : {};

  const narrativeSourceLang = resolveNarrativeSourceLanguage(profile, 'en');
  if (structuredUserInfoHasPersistedNarratives(structured, narrativeSourceLang)) {
    inputs.structuredUserInfo = structured;
  } else {
    const { normalized } = await normalizeStructuredUserInfoForStorage(structured, {
      forceRegenerate: false,
      language: narrativeSourceLang,
      sourceLanguage: narrativeSourceLang,
    });
    inputs.structuredUserInfo = normalized;
  }
  // Seniority (used for seniority sub-vector and penalty)
  inputs.seniority = {
    currentStatus: profile.seniority?.currentStatus ? String(profile.seniority.currentStatus).trim() : '',
    yearsOfExperience: typeof profile.seniority?.yearsOfExperience === 'number' ? profile.seniority.yearsOfExperience : null,
    highestDegree: profile.seniority?.highestDegree ? String(profile.seniority.highestDegree).trim() : '',
    mostSeniorWorkExperience: profile.seniority?.mostSeniorWorkExperience ? String(profile.seniority.mostSeniorWorkExperience).trim() : ''
  };

  inputs.userIdentity = normalizeUserIdentityAnswers(profile.userIdentityAnswers || {});

  return inputs;
};


// Phase 2 versioning (persisted with simulation payloads)
const ALGORITHM_VERSION = '2';
const SCORING_VERSION = '2';

const attachDeterministicStepIdsToPrioritizedLists = (prioritizedLists, simulationId) => {
  if (!prioritizedLists || typeof prioritizedLists !== 'object') return prioritizedLists;

  for (const [listCategory, items] of Object.entries(prioritizedLists)) {
    if (!Array.isArray(items)) continue;
    const stepCategory = mapPrioritizedListCategoryToStepCategory(listCategory);
    for (let i = 0; i < items.length; i++) {
      const item = items[i] || {};
      const stepId = generateStepId(item.title, simulationId, stepCategory, i);
      items[i] = {
        ...item,
        stepId,
        // Backward compatibility: many frontend components still use `id` as the React key
        id: stepId,
        // Keep a stable 0-based position for DB indexing + cursor usage
        position: i,
        rank: i + 1
      };
    }
  }

  return prioritizedLists;
};

const upsertSimulationPrioritizedItems = async ({ userId, simulationId, prioritizedLists }) => {
  if (!userId || !simulationId || !prioritizedLists) return;

  const ops = [];
  for (const [category, items] of Object.entries(prioritizedLists)) {
    if (!Array.isArray(items)) continue;
    for (let position = 0; position < items.length; position++) {
      const item = items[position];
      if (!item || !item.stepId) continue;

      ops.push({
        replaceOne: {
          filter: { userId, simulationId, category, position },
          replacement: { userId, simulationId, category, position, stepId: item.stepId, item },
          upsert: true
        }
      });
    }
  }

  if (ops.length === 0) return;
  await SimulationPrioritizedItem.bulkWrite(ops, { ordered: false });
};

const getPrioritizedItemByPosition = async ({ userId, simulationId, category, position }) => {
  if (!userId || !simulationId || !category || typeof position !== 'number') return null;

  const doc = await SimulationPrioritizedItem.findOne({
    userId,
    simulationId,
    category,
    position
  }).lean();

  return doc && doc.item ? doc.item : null;
};

/** Minimum profile completion (%) to run simulation — matches Profile page threshold. */
const MIN_SIMULATION_PROFILE_COMPLETION_PCT = 85;

/**
 * Profile completion for gating and UI. Display name is not included (set at account creation).
 * Profile picture does not affect `overall`.
 * If there is no uploaded document, `overall` is capped at MIN_SIMULATION_PROFILE_COMPLETION_PCT (same as
 * simulation minimum, currently 85%) even when seniority / structured / identity are complete.
 *
 * @param {object} profile - user.profile (may be undefined)
 * @returns {{ overall: number, seniority: number, structuredUserInfo: number, userIdentity: number, documents: number }}
 */
function computeProfileCompletion(profile) {
  const p = profile || {};

  const calculateDocumentsCompletion = () => {
    if (!p.documents) return 0;
    return p.documents.length > 0 ? 100 : 0;
  };

  const calculateSeniorityCompletion = () => {
    const seniority = p.seniority || {};
    let filled = 0;
    const total = 4;
    if (seniority.currentStatus) filled++;
    if (seniority.yearsOfExperience !== undefined && seniority.yearsOfExperience !== null) filled++;
    if (seniority.highestDegree) filled++;
    if (seniority.mostSeniorWorkExperience) filled++;
    return total > 0 ? Math.round((filled / total) * 100) : 0;
  };

  const calculateStructuredUserInfoCompletion = () => {
    const s = p.structuredUserInfo || {};
    let filled = 0;
    const total = 5;
    if (readDimensionRawItems(s.skillDomains).length > 0) filled++;
    if (readDimensionRawItems(s.skills).length > 0) filled++;
    if (readDimensionRawItems(s.skillsInDevelopment).length > 0) filled++;
    if (readDimensionRawItems(s.keyResponsibilities).length > 0) filled++;
    if (resolveDomainsFromStructuredInfo(s).length > 0) filled++;
    return Math.round((filled / total) * 100);
  };

  const calculateUserIdentityCompletion = () => {
    const u = normalizeUserIdentityAnswers(p.userIdentityAnswers || {});
    let filled = 0;
    const total = USER_IDENTITY_ANSWER_KEYS.length;
    for (const k of USER_IDENTITY_ANSWER_KEYS) {
      if (u[k]) filled++;
    }
    return Math.round((filled / total) * 100);
  };

  const seniority = calculateSeniorityCompletion();
  const structuredUserInfo = calculateStructuredUserInfoCompletion();
  const userIdentity = calculateUserIdentityCompletion();
  const documents = calculateDocumentsCompletion();

  const baseOverall = Math.round(
    (seniority + structuredUserInfo + userIdentity) / 3
  );
  const hasUploadedDocument = documents >= 100;
  const overall = hasUploadedDocument
    ? baseOverall
    : Math.min(baseOverall, MIN_SIMULATION_PROFILE_COMPLETION_PCT);

  return {
    overall,
    seniority,
    structuredUserInfo,
    userIdentity,
    documents,
  };
}

exports.__careerSimulationDepsForEngine = Object.freeze({
  computeProfileCompletion,
  MIN_SIMULATION_PROFILE_COMPLETION_PCT,
  readDimensionRawItems,
  resolveDomainsFromStructuredInfo,
  calculateCareerSimulationInputs,
  toPositiveIntEnv,
  attachDeterministicStepIdsToPrioritizedLists,
  buildCareerPathDocMapsForSteps,
  localizeOneCareerPathShapedStep,
  logControllerError,
  ALGORITHM_VERSION,
  SCORING_VERSION,
});

// Career simulation: hybrid scoring + Phase 2 prioritized lists (no 6-dim path scorer)
exports.runSimulation = async (req, res) => {
  if (typeof res.setTimeout === 'function') {
    res.setTimeout(180000);
  }
  const { executeCareerSimulation } = require('../services/simulation/simulationEngine');
  const reqLike = {
    user: req.user,
    body: req.body || {},
    language: req.language,
  };
  return executeCareerSimulation(reqLike, res, { context: 'http' });
};

function getAuthUserId(reqLike) {
  return reqLike?.user?.id || reqLike?.user?.userId || null;
}

async function runSimulationViaController(userId, language = 'en') {
  const { executeCareerSimulation } = require('../services/simulation/simulationEngine');
  const reqLike = {
    user: { id: userId, userId },
    body: {},
    language,
    method: 'POST',
    path: '/api/profile/simulation',
  };

  return new Promise((resolve) => {
    const resLike = {
      statusCode: 200,
      headersSent: false,
      setTimeout() {
        /* no-op stub for non-Express callers */
      },
      status(code) {
        this.statusCode = Number(code) || 500;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode || 200, payload });
        return this;
      },
    };

    executeCareerSimulation(reqLike, resLike, { context: 'sync-request' }).catch((err) => {
      resolve({
        statusCode: 500,
        payload: { success: false, message: 'Simulation failed.', error: err?.message || String(err) },
      });
    });
  });
}

exports.runSimulationViaController = runSimulationViaController;

function simulationOrchestrationLog(event, extra = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: 'simulation-job-orchestrator',
      event,
      ...extra,
    })
  );
}

/**
 * Fork subprocess IPC cannot reliably carry multi‑MB bodies. Successful runs persist on `User.lastSimulationResult`;
 * the worker rebuilds the same shape `executeCareerSimulation` returns over HTTP.
 */
async function buildSimulationForkJobResultPayload(jobDoc, { attempts = 2, delayMs = 75 } = {}) {
  const userId = jobDoc?.userId;
  if (!userId) return null;
  const lang = jobDoc.language || 'en';
  for (let tryIdx = 0; tryIdx < attempts; tryIdx += 1) {
    /* eslint-disable no-await-in-loop */
    const user = await User.findById(userId).select({ profile: 1, lastSimulationResult: 1 }).lean();
    /* eslint-enable no-await-in-loop */
    const lsr = user?.lastSimulationResult;
    if (user && lsr?.results) {
      const profileCompletion = computeProfileCompletion(user.profile).overall;
      return {
        success: true,
        results: lsr.results,
        profileCompletion,
      };
    }
    if (tryIdx + 1 < attempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

function humanizeSimulationWorkerError(errText) {
  const text = String(errText || '');
  if (
    text.includes('SIGABRT') ||
    text.includes('memory_limit_exceeded') ||
    text.includes('MEMORY_LIMIT_EXCEEDED')
  ) {
    return 'Simulation ran out of memory on the server. Please try again in a moment.';
  }
  if (text.includes('Simulation timeout')) {
    return 'Simulation took too long to complete. Please try again.';
  }
  return text;
}

async function processOneSimulationJob({ onlyJobId = null } = {}) {
  const jobExecutionLimitMs = getSimulationJobExecutionLimitMs();
  const reclaimed = await reclaimStaleRunningSimulationJobs();
  if (reclaimed > 0) {
    console.log(`[simulation-job] requeued ${reclaimed} stale running job(s)`);
  }

  const claimFilter = onlyJobId
    ? { _id: onlyJobId, status: { $in: ['queued', 'pending'] } }
    : { status: { $in: ['queued', 'pending'] } };

  const job = await SimulationJob.findOneAndUpdate(
    claimFilter,
    { $set: { status: 'running', startedAt: new Date(), progress: 10, error: '' } },
    { sort: { createdAt: 1 }, returnDocument: 'after' }
  );

  if (!job) return null;

  const jobId = job._id;
  const jobType = job.payload?.jobType || 'simulation_run';
  simulationOrchestrationLog('job_claimed', {
    jobId: String(jobId),
    jobType,
    userId: String(job.userId),
    pid: process.pid,
    jobExecutionLimitMs,
  });

  const heartbeatMs = Number(process.env.SIMULATION_JOB_HEARTBEAT_LOG_MS || 30000);
  const processStarted = Date.now();
  /** Long simulations block the worker loop; periodic logs prove this process is working. */
  const heartbeat =
    Number.isFinite(heartbeatMs) && heartbeatMs > 0
      ? setInterval(() => {
          console.log(
            `[simulation-job] heartbeat job ${String(jobId)} jobType=${jobType} elapsedSec=${Math.floor(
              (Date.now() - processStarted) / 1000
            )}`
          );
        }, heartbeatMs)
      : null;

  async function markJobCompleted(resultPayload) {
    await SimulationJob.updateOne(
      { _id: jobId, status: 'running' },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          progress: 100,
          error: '',
          result: resultPayload,
        },
      }
    );
  }

  async function markJobFailed(error, extra = {}) {
    await SimulationJob.updateOne(
      { _id: jobId, status: 'running' },
      {
        $set: {
          status: 'failed',
          completedAt: new Date(),
          error: error?.message || 'Unknown error',
          ...extra,
        },
      }
    );
  }

  try {
    simulationOrchestrationLog('job_started', { jobId: String(jobId), jobType });

    if (jobType === 'document_enrichment_refresh') {
      const user = await User.findById(job.userId).lean();
      const baseInputs = user?.profile?.careerSimulationInputs || {};
      await Promise.race([
        getEnrichedSimulationInputs({
          userId: String(job.userId),
          baseInputs,
          force: true,
          cacheOnly: false,
        }),
        new Promise((_, rej) => {
          setTimeout(() => rej(new Error('Job exceeded execution limit')), jobExecutionLimitMs);
        }),
      ]);
      simulationOrchestrationLog('job_finished', { jobId: String(jobId), jobType, outcome: 'enrichment_ok' });
      await markJobCompleted({
        success: true,
        jobType,
        refreshedAt: new Date().toISOString(),
      });
    } else {
      if (!job.payload?._poolPrefetch) {
        try {
          await attachSimulationPoolPrefetch(jobId, { job });
        } catch (prefetchErr) {
          console.warn(
            '[simulation-job] pool prefetch failed (non-fatal):',
            prefetchErr?.message || prefetchErr
          );
        }
      }

      const result = await runSimulationInChildProcess(jobId, {
        wallClockLimitMs: jobExecutionLimitMs,
      });

      const httpOk = typeof result.statusCode === 'number' && result.statusCode >= 200 && result.statusCode < 300;

      let completedPayload = null;
      if (httpOk && result.hydratePayloadFromUser === true) {
        completedPayload = await buildSimulationForkJobResultPayload(job);
      }
      if (httpOk && !completedPayload?.results && result.payload?.results) {
        completedPayload = result.payload;
      }

      const hasSimulationResults = !!(completedPayload && completedPayload.results);

      if (httpOk && hasSimulationResults) {
        simulationOrchestrationLog('job_finished', { jobId: String(jobId), jobType, outcome: 'simulation_ok' });
        await markJobCompleted(completedPayload);
      } else {
        const errMsg = humanizeSimulationWorkerError(
          result.payload?.error || result.payload?.message || `Simulation failed with status ${result.statusCode}`
        );
        simulationOrchestrationLog('job_failed', { jobId: String(jobId), jobType, outcome: 'simulation_soft_fail', error: errMsg });
        await SimulationJob.updateOne(
          { _id: jobId, status: 'running' },
          {
            $set: {
              status: 'failed',
              completedAt: new Date(),
              progress: 100,
              error: errMsg,
              result: result.payload || null,
            },
          }
        );
      }
    }
  } catch (error) {
    const errText = humanizeSimulationWorkerError(error?.message || String(error));
    let ipcMissRecovered = false;

    if (
      jobType === 'simulation_run' &&
      errText.includes('Child process exited without result')
    ) {
      const hydrated = await buildSimulationForkJobResultPayload(job);
      if (hydrated?.results) {
        ipcMissRecovered = true;
        simulationOrchestrationLog('job_recovered_ipc_miss', {
          jobId: String(jobId),
          jobType,
          note: 'Child exited cleanly but IPC missing; hydrated from User.lastSimulationResult.',
        });
        try {
          await markJobCompleted(hydrated);
        } catch (recErr) {
          ipcMissRecovered = false;
          console.error('[simulation-job] recovery persist failed job=%s', String(jobId), recErr);
        }
      }
    }

    if (!ipcMissRecovered) {
      simulationOrchestrationLog('job_failed', {
        jobId: String(jobId),
        jobType,
        outcome: 'exception',
        error: errText,
      });
      console.error('[simulation-job] error', error);
      try {
        await markJobFailed(new Error(errText));
      } catch (persistErr) {
        console.error(`[simulation-job] failed to persist job failure job=${String(jobId)}`, persistErr);
      }
      logControllerError('Simulation async job failed', error, { jobId: String(jobId) });
    }
  } finally {
    try {
      const row = await SimulationJob.findOne({ _id: jobId }).select({ status: 1 }).lean();
      if (row?.status === 'running') {
        await SimulationJob.updateOne(
          { _id: jobId, status: 'running' },
          {
            $set: {
              status: 'failed',
              completedAt: new Date(),
              error: 'Worker finalization failed (could not persist job outcome)',
            },
          }
        );
        console.error(`[simulation-job] emergency finalization job=${String(jobId)}`);
      }
    } catch (emergencyErr) {
      console.error(`[simulation-job] emergency finalization error job=${String(jobId)}`, emergencyErr);
    }
    if (heartbeat) clearInterval(heartbeat);
  }

  const updated = await SimulationJob.findById(jobId).lean();
  simulationOrchestrationLog('job_finalized', {
    jobId: String(jobId),
    jobType,
    status: updated?.status,
    elapsedSec: Math.floor((Date.now() - processStarted) / 1000),
  });
  console.log(
    `[simulation-job] finished job ${String(jobId)} status=${updated?.status} elapsedSec=${Math.floor(
      (Date.now() - processStarted) / 1000
    )}`
  );

  return SimulationJob.findById(jobId);
}

exports.startSimulation = async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const language = req.language || 'en';

    const [_, poolPrefetch] = await Promise.all([
      SimulationJob.updateMany(
        {
          userId,
          status: 'running',
          'payload.jobType': 'simulation_run',
        },
        {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            progress: 100,
            error: 'Superseded by a new simulation run.',
          },
        }
      ),
      buildSimulationPoolPrefetchForUserId(userId),
    ]);

    const job = await createSimulationJob({
      userId,
      language,
      payload: {
        ...(req.body || {}),
        jobType: 'simulation_run',
        ...(poolPrefetch ? { _poolPrefetch: poolPrefetch } : {}),
      },
    });

    return res.json({
      status: 'queued',
      jobId: String(job._id),
    });
  } catch (err) {
    logControllerError('Start simulation job error', err);
    return res.status(500).json({ success: false, message: 'Failed to start simulation job.', error: err.message });
  }
};

exports.getSimulationJobStatus = async (req, res) => {
  try {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'Surrogate-Control': 'no-store',
    });
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const job = await SimulationJob.findOne({ _id: req.params.jobId, userId })
      .select({ status: 1, progress: 1, createdAt: 1, startedAt: 1, completedAt: 1, error: 1 })
      .lean();
    if (!job) {
      return res.status(404).json({ success: false, message: 'Simulation job not found.' });
    }
    return res.json({ success: true, job });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch simulation job status.', error: err.message });
  }
};

exports.streamSimulationJobEvents = async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const jobId = req.params.jobId;
    const snapshot = await SimulationJob.findOne({ _id: jobId, userId })
      .select({ status: 1, progress: 1, error: 1 })
      .lean();
    if (!snapshot) {
      return res.status(404).json({ success: false, message: 'Simulation job not found.' });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    let closed = false;
    let lastFp = '';
    let pollDelayMs = 1000;
    const maxPollDelayMs = 5000;
    let pollTimer = null;
    let heartbeatTimer = null;
    const heartbeatIntervalMs = Math.max(
      5000,
      Number(process.env.SIMULATION_JOB_SSE_HEARTBEAT_MS || 15000)
    );

    const fingerprint = (j) => `${j.status}:${j.progress ?? 0}`;

    const writeData = (payload) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const writeHeartbeat = () => {
      if (closed) return;
      res.write('event: heartbeat\ndata: {}\n\n');
    };

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const endStream = () => {
      cleanup();
      try {
        res.end();
      } catch {
        /* ignore */
      }
    };

    const pushIfChanged = (j) => {
      const fp = fingerprint(j);
      if (fp === lastFp) return false;
      lastFp = fp;
      const payload = { status: j.status, progress: j.progress ?? 0 };
      if (j.error) payload.error = j.error;
      writeData(payload);
      return true;
    };

    pushIfChanged(snapshot);
    if (snapshot.status === 'completed' || snapshot.status === 'failed') {
      return endStream();
    }

    heartbeatTimer = setInterval(writeHeartbeat, heartbeatIntervalMs);

    req.once('close', () => {
      cleanup();
    });

    const runPoll = async () => {
      if (closed) return;
      pollTimer = null;
      try {
        const j = await SimulationJob.findOne({ _id: jobId, userId })
          .select({ status: 1, progress: 1, error: 1 })
          .lean();
        if (!j) {
          writeData({ status: 'failed', error: 'Simulation job not found.', progress: 0 });
          return endStream();
        }

        const fp = fingerprint(j);
        if (fp !== lastFp) {
          lastFp = fp;
          pollDelayMs = 1000;
          const payload = { status: j.status, progress: j.progress ?? 0 };
          if (j.error) payload.error = j.error;
          writeData(payload);
        } else {
          pollDelayMs = Math.min(Math.round(pollDelayMs * 1.5), maxPollDelayMs);
        }

        if (j.status === 'completed' || j.status === 'failed') {
          return endStream();
        }

        schedulePoll(pollDelayMs);
      } catch (err) {
        writeData({ status: 'failed', error: err.message || 'Stream error', progress: 0 });
        endStream();
      }
    };

    const schedulePoll = (delayMs) => {
      if (closed) return;
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = setTimeout(runPoll, delayMs);
    };

    schedulePoll(pollDelayMs);
  } catch (err) {
    logControllerError('Simulation job SSE stream error', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: 'Failed to stream simulation job events.', error: err.message });
    }
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
};

exports.getSimulationJobResult = async (req, res) => {
  try {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'Surrogate-Control': 'no-store',
    });
    const userId = getAuthUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const job = await SimulationJob.findOne({ _id: req.params.jobId, userId }).lean();
    if (!job) {
      return res.status(404).json({ success: false, message: 'Simulation job not found.' });
    }
    if (job.status !== 'completed') {
      return res.status(409).json({
        success: false,
        message: 'Simulation job is not completed yet.',
        status: job.status,
        error: job.error || '',
      });
    }
    if (job.result?.results) {
      return res.json(job.result);
    }
    // Fork worker stores large payloads on User.lastSimulationResult; job.result may be lean or missing.
    const hydrated = await buildSimulationForkJobResultPayload(job, { attempts: 5, delayMs: 250 });
    if (hydrated?.results) {
      return res.json(hydrated);
    }
    return res.json(job.result || { success: false, message: 'Simulation result payload missing.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch simulation job result.', error: err.message });
  }
};

exports.processOneSimulationJob = processOneSimulationJob;

// New endpoint: get last simulation result for logged-in user
exports.getLastSimulationResult = async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const user = await User.findById(userId).select('lastSimulationResult').lean();
    if (!user || !user.lastSimulationResult || !user.lastSimulationResult.results) {
      return res.json({ success: true, results: null });
    }
    const localizedResults = await localizeSimulationResults(
      user.lastSimulationResult.results,
      req.language
    );

    return res.json({
      success: true,
      results: localizedResults,
      date: user.lastSimulationResult.date
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch last simulation result.', error: err.message });
  }
};

/**
 * Persist ranking / evaluation progress for the user's latest (unsaved) simulation run.
 * Does not create a saved simulation — only updates `lastSimulationResult.results.evaluationFlow`.
 */
exports.updateLastSimulationResult = async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { evaluationFlow } = req.body || {};
    if (!evaluationFlow || typeof evaluationFlow !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'evaluationFlow is required and must be an object.',
      });
    }

    const user = await User.findById(userId);
    if (!user || !user.lastSimulationResult || !user.lastSimulationResult.results) {
      return res.status(404).json({
        success: false,
        message: 'No last simulation result to update.',
      });
    }

    const storedResults = user.lastSimulationResult.results;
    const storedSimId = storedResults.simulationId;
    const flowSimId = evaluationFlow.simulationId;
    if (
      storedSimId
      && flowSimId
      && flowSimId !== 'local'
      && storedSimId !== flowSimId
    ) {
      return res.status(409).json({
        success: false,
        message: 'Evaluation flow does not match the current last simulation.',
      });
    }

    storedResults.evaluationFlow = stripDerivedEvaluationViews(evaluationFlow);
    syncEvaluationFlowSimulationId(storedResults);
    user.lastSimulationResult.results = storedResults;
    user.markModified('lastSimulationResult');
    await user.save();

    // Unlock exploration accumulation once both rankings are done so the
    // progress card starts at 0% (onboarding identity growth must not count).
    // Refresh identity first so simulation ratings are in the baseline.
    if (areBothSimulationRankingsComplete(storedResults.evaluationFlow)) {
      try {
        const language = req.language === 'en' ? 'en' : 'de';
        const identity = await identityEngine.forceRefreshIdentity(userId, {
          language,
          skipPipelineEmit: true,
        });
        await ensureExplorationAccumulationUnlocked(userId, identity);
      } catch (unlockErr) {
        logControllerError(
          'Exploration accumulation unlock after simulation rankings failed (non-fatal)',
          unlockErr
        );
      }
    }

    const localizedResults = await localizeSimulationResults(
      user.lastSimulationResult.results,
      req.language
    );

    return res.json({
      success: true,
      results: localizedResults,
      date: user.lastSimulationResult.date,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update last simulation result.',
      error: err.message,
    });
  }
};

// Update career simulation inputs (manual edit)
exports.updateCareerSimulationInputs = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const {
      structuredUserInfo,
      userIdentity,
      seniority
    } = req.body;

    // Basic validation
    if (!structuredUserInfo || typeof structuredUserInfo !== 'object') {
      return res.status(400).json({ error: 'structuredUserInfo is required and must be an object.' });
    }

    const { normalized: normalizedStructuredUserInfo } = await normalizeStructuredUserInfoForStorage(
      structuredUserInfo,
      {
        forceRegenerate: true,
        language: req.language,
        sourceLanguage: resolveNarrativeSourceLanguage(user.profile || {}, 'en'),
      }
    );

    const normalizedUserIdentity = normalizeUserIdentityAnswers({
      ...(user.profile.careerSimulationInputs?.userIdentity &&
      typeof user.profile.careerSimulationInputs.userIdentity === 'object'
        ? user.profile.careerSimulationInputs.userIdentity
        : {}),
      ...(userIdentity && typeof userIdentity === 'object' ? userIdentity : {}),
    });
    if (!user.profile.userIdentityAnswers || typeof user.profile.userIdentityAnswers !== 'object') {
      user.profile.userIdentityAnswers = {};
    }
    if (USER_IDENTITY_ANSWER_KEYS.some((k) => !normalizedUserIdentity[k])) {
      return res.status(400).json({
        error: 'All five user identity answers are required.',
      });
    }
    Object.assign(user.profile.userIdentityAnswers, normalizedUserIdentity);
    user.markModified('profile.userIdentityAnswers');
    const { normalized: normalizedWhoAreYou } = await normalizeWhoAreYouForStorage(
      user.profile || {},
      {
        forceRegenerate: true,
        language: req.language,
        sourceLanguage: resolveNarrativeSourceLanguage(user.profile || {}, 'en'),
      }
    );
    user.profile.who_are_you = normalizedWhoAreYou;
    user.markModified('profile.who_are_you');

    // Normalize seniority
    const normalizedSeniority = seniority && typeof seniority === 'object' ? {
      currentStatus: String(seniority.currentStatus || '').trim(),
      yearsOfExperience: typeof seniority.yearsOfExperience === 'number' ? seniority.yearsOfExperience : null,
      highestDegree: String(seniority.highestDegree || '').trim(),
      mostSeniorWorkExperience: String(seniority.mostSeniorWorkExperience || '').trim()
    } : user.profile.careerSimulationInputs?.seniority || {
      currentStatus: '', yearsOfExperience: null, highestDegree: '', mostSeniorWorkExperience: ''
    };

    user.profile.careerSimulationInputs = {
      ...user.profile.careerSimulationInputs,
      structuredUserInfo: normalizedStructuredUserInfo,
      userIdentity: normalizedUserIdentity,
      seniority: normalizedSeniority,
      isManuallyEdited: true,
      lastManualEdit: new Date(),
      lastCalculated: user.profile.careerSimulationInputs.lastCalculated || new Date(),
      editHistory: [
        ...(user.profile.careerSimulationInputs.editHistory || []),
        {
          editedAt: new Date(),
          editor: req.user.userId,
          changes: { structuredUserInfo: normalizedStructuredUserInfo, userIdentity: normalizedUserIdentity, seniority: normalizedSeniority }
        }
      ]
    };
    await user.save();
    scheduleRefreshUserIdentityEmbeddingForUser(req.user.userId, {
      forceRegenerate: true,
      reuseWhoAreYouText: false,
    });
    const profileStructured = user.profile.structuredUserInfo || {};
    const responseWhoAreYou = normalizeLocalizedProfileFieldsForResponse(
      { who_are_you: user.profile.who_are_you || { raw_answers: [], summary_text: '' } },
      req.language
    ).who_are_you;
    res.json({
      success: true,
      who_are_you: responseWhoAreYou,
      careerSimulationInputs: await enrichCareerSimulationInputsForClientResponse(
        user.profile.careerSimulationInputs,
        profileStructured,
        { language: req.language }
      ),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update career simulation inputs', details: err.message });
  }
};

// Get career simulation inputs for logged-in user
exports.getCareerSimulationInputs = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const raw = user.profile.careerSimulationInputs;
    const profileStructured = user.profile.structuredUserInfo || {};
    const inputs =
      raw && typeof raw === 'object'
        ? await enrichCareerSimulationInputsForClientResponse(raw, profileStructured, { language: req.language })
        : {};
    res.json({ success: true, careerSimulationInputs: inputs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch career simulation inputs', details: err.message });
  }
};

// Get simulation results for logged-in user
exports.getSimulationResults = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const results = (user.simulationResults || []).map((sim) =>
      normalizeSimulationResultEntryForResponse(sim, req.language)
    );
    res.json({ success: true, simulationResults: results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch simulation results', details: err.message });
  }
};

// Save simulation result
exports.saveSimulationResult = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      logControllerError('User not found', new Error('User not found for ID'), { userId: req.user.userId });
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Accept data directly from request body (frontend sends it this way)
    const { name, results, profileCompletion } = req.body;
    
    if (!results) {
      logControllerError('Missing results payload', new Error('No results provided in request body'));
      return res.status(400).json({ error: 'Simulation results are required' });
    }

    // Preserve a stable simulationId if the client provides one (generated by backend in runSimulation).
    const incomingSimulationId = req.body.simulationId || results.simulationId || crypto.randomUUID();

    // Ensure versioning is present and persisted
    const algorithmVersion = results.algorithmVersion || ALGORITHM_VERSION;
    const scoringVersion = results.scoringVersion || SCORING_VERSION;
    const scoringWeights = results.scoringWeights || req.body.scoringWeights || undefined;
    
    // Ensure results has all required fields
    if (!results.prioritizedLists) {
      console.warn('Missing prioritizedLists in results, adding defaults');
      results.prioritizedLists = {
        nextCareerRoles: [],
        outsideTheBoxRoles: []
      };
    }

    // Ensure deterministic stepIds exist for prioritized lists (legacy clients may not include them)
    const prioritizedListsWithIds = attachDeterministicStepIdsToPrioritizedLists(
      results.prioritizedLists,
      incomingSimulationId
    );
    results.prioritizedLists = prioritizedListsWithIds;
    
    if (!results.currentPositions) {
      console.warn('Missing currentPositions in results, adding defaults');
      results.currentPositions = {
        nextCareerRoles: 3,
        outsideTheBoxRoles: 3
      };
    }

    // Ensure results payload carries version + simulationId fields
    results.simulationId = incomingSimulationId;
    syncEvaluationFlowSimulationId(results);
    if (results.evaluationFlow) {
      results.evaluationFlow = stripDerivedEvaluationViews(results.evaluationFlow);
    }
    results.algorithmVersion = algorithmVersion;
    results.scoringVersion = scoringVersion;
    results.scoringWeights = scoringWeights || undefined;
    results.prioritizedListTotals = results.prioritizedListTotals || {
      nextCareerRoles: Array.isArray(results.prioritizedLists.nextCareerRoles) ? results.prioritizedLists.nextCareerRoles.length : 0,
      outsideTheBoxRoles: Array.isArray(results.prioritizedLists.outsideTheBoxRoles) ? results.prioritizedLists.outsideTheBoxRoles.length : 0
    };
    
    // Calculate results count from the actual results
    const resultsCount = {
      nextSteps: Array.isArray(results.nextSteps) ? results.nextSteps.length : 0,
      outsideTheBox: Array.isArray(results.outsideTheBox) ? results.outsideTheBox.length : 0,
      furtherAdvice: Array.isArray(results.furtherAdvice) ? results.furtherAdvice.length : 0
    };

    const newSimulation = {
      id: incomingSimulationId,
      algorithmVersion,
      scoringVersion,
      name: name || `Simulation - ${new Date().toLocaleString()}`,
      results,
      resultsCount, // Add the required resultsCount field
      profileCompletion: profileCompletion || 100,
      timestamp: new Date(),
      profileSnapshot: user.profile || {}, // Add the required profileSnapshot field
      status: 'active',
      // Add required fields with defaults
      replacementPools: {
        nextSteps: [],
        outsideTheBox: [],
        furtherAdvice: []
      },
      removedSteps: {
        nextSteps: [],
        outsideTheBox: [],
        furtherAdvice: []
      },
      // Initialize per-category display tracking
      categoryDisplayCounts: {
        nextSteps: 3,
        outsideTheBox: 3
      },
      // Initialize per-category display limits
      categoryLimits: {
        nextSteps: 10,
        outsideTheBox: 10
      }
    };
    
    // Upsert by deterministic id (avoid duplicates)
    const existingIndex = user.simulationResults.findIndex((sim) => sim.id === incomingSimulationId);
    if (existingIndex !== -1) {
      user.simulationResults[existingIndex] = {
        ...user.simulationResults[existingIndex],
        ...newSimulation,
      };
    } else {
      const activeSimulations = user.simulationResults.filter((sim) => sim.status === 'active');
      if (activeSimulations.length >= FIXED_MAX_SAVED_SIMULATIONS) {
        const oldestSimulation = activeSimulations.reduce((oldest, current) =>
          current.timestamp < oldest.timestamp ? current : oldest
        );
        oldestSimulation.status = 'deleted';
      }
      user.simulationResults.push(newSimulation);
    }
    // Unsaved "last run" is now persisted as a saved simulation; clear so /puzzle-job
    // and nav do not treat an ephemeral last run as still active.
    user.lastSimulationResult = undefined;
    try {
      await user.save();
    } catch (saveError) {
      logControllerError('Save simulation validation error', saveError, saveError?.errors);
      throw saveError;
    }

    scheduleIdentityExplorationAfterActivity(user._id, { language: req.language });

    logUserActivity(user._id, {
      type: ACTIVITY_TYPES.SIMULATION_SAVED,
      meta: {
        simulationId: incomingSimulationId,
        simulationName: newSimulation.name || null,
      },
    });

    // Persist prioritized list items for indexed retrieval
    await upsertSimulationPrioritizedItems({
      userId: user._id,
      simulationId: incomingSimulationId,
      prioritizedLists: results.prioritizedLists
    });

    res.json({
      success: true,
      savedSimulation: normalizeSimulationResultEntryForResponse(newSimulation, req.language),
    });
  } catch (err) {
    logControllerError('Error saving simulation', err);
    res.status(500).json({ error: 'Failed to save simulation result', details: err.message });
  }
};

// Delete simulation result
exports.deleteSimulationResult = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      logControllerError('User not found', new Error('User not found for ID'), { userId: req.user.userId });
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { id } = req.params;
    if (!id) {
      logControllerError('Missing required parameter', new Error('No ID provided in params'));
      return res.status(400).json({ error: 'Simulation ID is required' });
    }
    
    const simulationIndex = user.simulationResults.findIndex(sim => sim.id === id);
    
    if (simulationIndex === -1) {
      logControllerError('Simulation not found', new Error('Simulation not found with ID'), { simulationId: id });
      return res.status(404).json({ error: 'Simulation result not found' });
    }
    
    user.simulationResults[simulationIndex].status = 'deleted';
    await user.save();

    // Cleanup indexed prioritized items (optional but keeps collection small)
    try {
      await SimulationPrioritizedItem.deleteMany({
        userId: user._id,
        simulationId: id
      });
    } catch (e) {
      console.warn('Failed to cleanup prioritized items for deleted simulation:', e.message);
    }
    
    res.json({ success: true, message: 'Simulation result deleted successfully' });
  } catch (err) {
    logControllerError('Error deleting simulation', err);
    res.status(500).json({ error: 'Failed to delete simulation result', details: err.message });
  }
};

// Get user profile
exports.getProfile = async (req, res) => {
  const timingEnabled = process.env.PROFILE_GET_TIMING === '1';
  const t0 = timingEnabled ? Date.now() : 0;
  const logPhase = (label) => {
    if (timingEnabled) {
      console.log(`[getProfile] ${label} +${Date.now() - t0}ms user=${req.user?.userId}`);
    }
  };

  try {
    // Exclude very large embedded arrays and per-document extraction payloads (multi‑MB).
    const user = await User.findById(req.user.userId).select({
      simulationResults: 0,
      lastSimulationResult: 0,
      'profile.documents.extractedProfileData': 0,
      'profile.documents.cvExtractLocalization': 0,
      'profile.documents.semanticInterpretation': 0,
      'profile.documents.narrativeEnrichment': 0,
    }).lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    logPhase('afterFind');

    const narrativeStatus = ensureProfileNarrativeBackfillScheduled(
      user._id,
      user.profile || {},
      req.language
    );

    const cached = getCachedProfileResponse(user._id, user.updatedAt, req.language);
    if (cached) {
      logPhase('cacheHit');
      const responseBody = cached.completion != null
        ? cached
        : { ...cached, completion: computeProfileCompletion(cached.profile) };
      return res.json({
        ...responseBody,
        narrativesReady: narrativeStatus.ready,
        narrativePending: narrativeStatus.pending,
      });
    }
    logPhase('cacheMiss');

    const profilePayload = { ...(user.profile || {}) };
    const cvExtractLocalization = profilePayload.cvExtractLocalization;
    profilePayload.structuredUserInfo = overlayStructuredUserInfoListsWithCvLocalization(
      profilePayload.structuredUserInfo,
      cvExtractLocalization,
      req.language
    );
    if (profilePayload.careerSimulationInputs?.structuredUserInfo) {
      profilePayload.careerSimulationInputs = {
        ...profilePayload.careerSimulationInputs,
        structuredUserInfo: overlayStructuredUserInfoListsWithCvLocalization(
          profilePayload.careerSimulationInputs.structuredUserInfo,
          cvExtractLocalization,
          req.language
        ),
      };
    }

    const mergedIdentityAnswers = mergeProfileIdentityAnswers(profilePayload);
    profilePayload.userIdentity = overlayIdentityAnswersWithCvLocalization(
      mergedIdentityAnswers,
      cvExtractLocalization?.userIdentity,
      req.language
    );
    const existingWhoAreYou = profilePayload.who_are_you && typeof profilePayload.who_are_you === 'object'
      ? profilePayload.who_are_you
      : {};
    const existingWhoRawAnswers = Array.isArray(existingWhoAreYou.raw_answers)
      ? existingWhoAreYou.raw_answers.map((value) => String(value || '').trim())
      : [];
    // Keep summary-source raw_answers when present so the client can detect
    // bullet edits that have not yet been used to regenerate the AI summary.
    profilePayload.who_are_you = {
      ...existingWhoAreYou,
      raw_answers: existingWhoRawAnswers.some(Boolean)
        ? existingWhoRawAnswers
        : buildWhoAreYouRawAnswersFromIdentity(mergedIdentityAnswers),
    };
    const profileStructured = profilePayload?.structuredUserInfo || {};

    if (profilePayload?.careerSimulationInputs && typeof profilePayload.careerSimulationInputs === 'object') {
      profilePayload.careerSimulationInputs = await enrichCareerSimulationInputsForClientResponse(
        profilePayload.careerSimulationInputs,
        profileStructured,
        { language: req.language }
      );
    }
    if (Array.isArray(profilePayload.documents)) {
      profilePayload.documents = profilePayload.documents
        .map((doc) => serializeEmbeddedDocumentForClient(doc, {
          uiLanguage: req.language,
          includeExtractionPayload: false,
        }))
        .filter(Boolean);
    }
    delete profilePayload.cvExtractLocalization;
    const localizedProfilePayload = normalizeLocalizedProfileFieldsForResponse(
      profilePayload,
      req.language
    );

    const responseBody = {
      success: true,
      profile: localizedProfilePayload,
      completion: computeProfileCompletion(localizedProfilePayload),
      name: user.name || '',
      email: user.email,
      narrativesReady: narrativeStatus.ready,
      narrativePending: narrativeStatus.pending,
    };
    logPhase('beforeCacheSet');
    const bodyForCache =
      typeof structuredClone === 'function'
        ? structuredClone(responseBody)
        : JSON.parse(JSON.stringify(responseBody));
    setCachedProfileResponse(user._id, user.updatedAt, bodyForCache, req.language);
    logPhase('done');
    return res.json(responseBody);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile', details: err.message });
  }
};

// Get profile completion percentage
exports.getProfileCompletion = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('profile');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const completion = computeProfileCompletion(user.profile);
    res.json({ success: true, completion });
  } catch (err) {
    res.status(500).json({ error: 'Failed to calculate profile completion', details: err.message });
  }
};

/**
 * GET /api/profile/history — chronological milestone timeline for Saved & Search → History.
 */
exports.getUserHistory = async (req, res) => {
  try {
    const timeline = await buildUserHistoryTimeline(req.user.userId, {
      language: req.language,
    });
    res.json({ success: true, ...timeline });
  } catch (err) {
    if (err?.status === 404) {
      return res.status(404).json({ error: 'User not found' });
    }
    logControllerError('Error getting user history', err);
    res.status(500).json({ error: 'Failed to load history', details: err.message });
  }
};

/**
 * POST body: { userIdentity?, structuredUserInfo? } — same shape as the extraction review dialog.
 * Scores only the five identity prompts plus key responsibilities and learning goals; returns
 * { followUps: [ { field, quality_score, dimension_scores, issues, follow_up_question } ] } (three lowest; does not persist).
 */
exports.diagnoseProfileInputQuality = async (req, res) => {
  try {
    const snapshot = req.body && typeof req.body === 'object' ? req.body : {};
    const force = Boolean(req.query?.force || req.body?.force);
    const result = await evaluateProfileReviewFollowUps(
      {
        userIdentity: snapshot.userIdentity,
        structuredUserInfo: snapshot.structuredUserInfo,
      },
      { lang: req.language, userId: req.user?.userId, force }
    );
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('diagnoseProfileInputQuality', err);
    res.status(500).json({ error: 'Failed to run input quality diagnosis', details: err.message });
  }
};

/**
 * POST body: { seniority, messages?: { role, content }[] }
 * Returns the next coaching question or a summary list of work activities.
 */
exports.postWorkEnjoyCoaching = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const seniority = body.seniority && typeof body.seniority === 'object' ? body.seniority : null;
    if (!seniority) {
      return res.status(400).json({ success: false, error: 'seniority is required' });
    }
    const explicitLang = body.lang || req.query?.lang || req.query?.language;
    const result = await advanceWorkEnjoyCoaching({
      seniority,
      messages: body.messages,
      cvContext: normalizeCoachingCvContext(body.cvContext),
      lang: explicitLang || req.language || 'de',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('postWorkEnjoyCoaching', err);
    const status = /too many|answer the current/i.test(String(err.message || '')) ? 400 : 500;
    res.status(status).json({
      success: false,
      error: status === 400 ? err.message : 'Failed to run work-enjoy coaching',
      details: err.message,
    });
  }
};

exports.postTopicsIndustriesCoaching = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const seniority = body.seniority && typeof body.seniority === 'object' ? body.seniority : null;
    if (!seniority) {
      return res.status(400).json({ success: false, error: 'seniority is required' });
    }
    const explicitLang = body.lang || req.query?.lang || req.query?.language;
    const result = await advanceTopicsIndustriesCoaching({
      seniority,
      messages: body.messages,
      cvContext: normalizeCoachingCvContext(body.cvContext),
      lang: explicitLang || req.language || 'de',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('postTopicsIndustriesCoaching', err);
    const status = /too many|answer the current/i.test(String(err.message || '')) ? 400 : 500;
    res.status(status).json({
      success: false,
      error: status === 400 ? err.message : 'Failed to run topics-industries coaching',
      details: err.message,
    });
  }
};

exports.postNaturallyGoodAtCoaching = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const seniority = body.seniority && typeof body.seniority === 'object' ? body.seniority : null;
    if (!seniority) {
      return res.status(400).json({ success: false, error: 'seniority is required' });
    }
    const explicitLang = body.lang || req.query?.lang || req.query?.language;
    const result = await advanceNaturallyGoodAtCoaching({
      seniority,
      messages: body.messages,
      cvContext: normalizeCoachingCvContext(body.cvContext),
      lang: explicitLang || req.language || 'de',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('postNaturallyGoodAtCoaching', err);
    const status = /too many|answer the current/i.test(String(err.message || '')) ? 400 : 500;
    res.status(status).json({
      success: false,
      error: status === 400 ? err.message : 'Failed to run naturally-good-at coaching',
      details: err.message,
    });
  }
};

exports.postWorkEnvironmentCoaching = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const seniority = body.seniority && typeof body.seniority === 'object' ? body.seniority : null;
    if (!seniority) {
      return res.status(400).json({ success: false, error: 'seniority is required' });
    }
    const explicitLang = body.lang || req.query?.lang || req.query?.language;
    const result = await advanceWorkEnvironmentCoaching({
      seniority,
      messages: body.messages,
      cvContext: normalizeCoachingCvContext(body.cvContext),
      lang: explicitLang || req.language || 'de',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('postWorkEnvironmentCoaching', err);
    const status = /too many|answer the current/i.test(String(err.message || '')) ? 400 : 500;
    res.status(status).json({
      success: false,
      error: status === 400 ? err.message : 'Failed to run work-environment coaching',
      details: err.message,
    });
  }
};

exports.postWorkingLifeAchievementCoaching = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const seniority = body.seniority && typeof body.seniority === 'object' ? body.seniority : null;
    if (!seniority) {
      return res.status(400).json({ success: false, error: 'seniority is required' });
    }
    const explicitLang = body.lang || req.query?.lang || req.query?.language;
    const result = await advanceWorkingLifeAchievementCoaching({
      seniority,
      messages: body.messages,
      cvContext: normalizeCoachingCvContext(body.cvContext),
      lang: explicitLang || req.language || 'de',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('postWorkingLifeAchievementCoaching', err);
    const status = /too many|answer the current/i.test(String(err.message || '')) ? 400 : 500;
    res.status(status).json({
      success: false,
      error: status === 400 ? err.message : 'Failed to run working-life-achievement coaching',
      details: err.message,
    });
  }
};

/**
 * GET — distinct required/optional skills across career paths (manual profile skill picker).
 */
exports.getRoleSkillsForSelection = async (req, res) => {
  try {
    const lang = req.query?.lang || req.query?.language || req.language || 'en';
    const skills = await listDistinctRoleSkillsForSelection(lang);
    res.json({ success: true, ...skills });
  } catch (err) {
    logControllerError('getRoleSkillsForSelection', err);
    res.status(500).json({
      success: false,
      error: 'Failed to load role skills',
      details: err.message,
    });
  }
};

/**
 * POST body: { query?, contextTexts?, selectedLabels?, limit? }
 * Returns search matches or profile-based recommendations (never the full catalog).
 */
exports.searchRoleSkillsForSelection = async (req, res) => {
  try {
    const lang = req.query?.lang || req.query?.language || req.language || 'en';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await searchRoleSkillsForSelection(lang, {
      query: body.query,
      contextTexts: body.contextTexts,
      selectedLabels: body.selectedLabels,
      limit: body.limit,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('searchRoleSkillsForSelection', err);
    res.status(500).json({
      success: false,
      error: 'Failed to search role skills',
      details: err.message,
    });
  }
};

/**
 * POST body: { labels?: string[] }
 * Maps CV / free-text skill labels to canonical catalog entries.
 */
exports.resolveRoleSkillsForSelection = async (req, res) => {
  try {
    const lang = req.query?.lang || req.query?.language || req.language || 'en';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await resolveRoleSkillsForSelection(lang, {
      labels: body.labels,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('resolveRoleSkillsForSelection', err);
    res.status(500).json({
      success: false,
      error: 'Failed to resolve role skills',
      details: err.message,
    });
  }
};

/**
 * GET — bounded skill-domain recommendations (legacy; prefer POST /role-skill-domains/search).
 */
exports.getRoleSkillDomainsForSelection = async (req, res) => {
  try {
    const lang = req.query?.lang || req.query?.language || req.language || 'en';
    const result = await searchRoleSkillDomainsForSelection(lang, {
      contextTexts: [],
      limit: 24,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('getRoleSkillDomainsForSelection', err);
    res.status(500).json({
      success: false,
      error: 'Failed to load role skill domains',
      details: err.message,
    });
  }
};

/**
 * POST body: { query?, contextTexts?, selectedLabels?, limit? }
 * Returns search matches or profile-based recommendations (never the full catalog).
 */
exports.searchRoleSkillDomainsForSelection = async (req, res) => {
  try {
    const lang = req.query?.lang || req.query?.language || req.language || 'en';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await searchRoleSkillDomainsForSelection(lang, {
      query: body.query,
      contextTexts: body.contextTexts,
      selectedLabels: body.selectedLabels,
      limit: body.limit,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('searchRoleSkillDomainsForSelection', err);
    res.status(500).json({
      success: false,
      error: 'Failed to search role skill domains',
      details: err.message,
    });
  }
};

/**
 * POST body: { role, language | lang, simulationScopeId?, roleContext?, debug? }
 * Returns cached or freshly generated explanation (persisted). { success, text, source, cached }.
 */
/**
 * POST body: { role, userContext?, messages?: { role, content }[] }
 * Returns the next path-planning question or a structured path summary.
 */
exports.postCareerPathCoaching = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const role = body.role && typeof body.role === 'object' ? body.role : null;
    if (!role) {
      return res.status(400).json({ success: false, error: 'role is required' });
    }
    const explicitLang = body.lang || req.query?.lang || req.query?.language;
    const userId = req.user && req.user.userId;
    const result = await advanceCareerPathCoaching({
      role,
      userContext: body.userContext,
      messages: body.messages,
      state: body.state,
      preferences: body.preferences,
      lang: explicitLang || req.language || 'de',
      userId,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('postCareerPathCoaching', err);
    const status = /too many|answer the current|role\.title/i.test(String(err.message || '')) ? 400 : 500;
    res.status(status).json({
      success: false,
      error: status === 400 ? err.message : 'Failed to run career path coaching',
      details: err.message,
    });
  }
};

/**
 * POST body: { role, lang? }
 * Warms career context enrichment while the user answers the questionnaire.
 */
exports.postCareerPathCoachingPrefetch = async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const role = normalizeRole(body.role);
    const roleTitle = String(role.title || '').trim();
    if (!roleTitle) {
      return res.status(400).json({ success: false, error: 'role.title is required' });
    }
    const explicitLang = body.lang || req.query?.lang || req.query?.language;
    const prefetchStatus = scheduleCareerPathEnrichmentPrefetch({
      userId,
      role,
      lang: explicitLang || req.language || 'de',
    });
    res.json({ success: true, prefetch: prefetchStatus });
  } catch (err) {
    logControllerError('postCareerPathCoachingPrefetch', err);
    res.status(500).json({
      success: false,
      error: 'Failed to prefetch career path enrichment',
      details: err.message,
    });
  }
};

function normalizeCareerPathPlanEscoId(value) {
  return String(value || '').trim().toLowerCase().slice(0, 512);
}

function normalizeCareerPathPlanLang(value) {
  return String(value || 'en').toLowerCase().split('-')[0] === 'de' ? 'de' : 'en';
}

function serializeCareerPathPlan(doc) {
  if (!doc) return null;
  return {
    escoId: doc.escoId,
    language: doc.language,
    roleTitle: doc.roleTitle ?? null,
    pathPlan: doc.pathPlan ?? null,
    answers: doc.answers ?? {},
    audience: doc.audience ?? null,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
  };
}

/**
 * GET /api/profile/career-path-plans
 * Returns all persisted career path plans for the current user (keyed by escoId).
 */
exports.listCareerPathPlans = async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const plans = await CareerPathPlan.find({ userId }).lean();
    res.json({
      success: true,
      careerPathPlans: plans.map(serializeCareerPathPlan).filter(Boolean),
    });
  } catch (err) {
    logControllerError('listCareerPathPlans', err);
    res.status(500).json({ success: false, error: 'Failed to load career path plans' });
  }
};

/**
 * PUT /api/profile/career-path-plans/:escoId
 * Upserts the user's generated plan for a role. Body: { pathPlan, answers?, audience?, roleTitle?, lang? }
 */
exports.upsertCareerPathPlan = async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const escoId = normalizeCareerPathPlanEscoId(req.params.escoId);
    if (!escoId) {
      return res.status(400).json({ success: false, error: 'escoId is required' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!body.pathPlan || typeof body.pathPlan !== 'object') {
      return res.status(400).json({ success: false, error: 'pathPlan is required' });
    }
    const language = normalizeCareerPathPlanLang(body.lang || body.language || req.language);
    const filter = { userId, escoId, language };
    const update = {
      $set: {
        pathPlan: body.pathPlan,
        answers: body.answers && typeof body.answers === 'object' ? body.answers : {},
        audience: body.audience || null,
        roleTitle: body.roleTitle ?? null,
        language,
      },
    };
    let doc;
    try {
      doc = await CareerPathPlan.findOneAndUpdate(filter, update, {
        upsert: true,
        new: true,
      }).lean();
    } catch (err) {
      if (err && err.code === 11000) {
        await CareerPathPlan.updateOne(filter, update);
        doc = await CareerPathPlan.findOne(filter).lean();
      } else {
        throw err;
      }
    }
    res.json({ success: true, careerPathPlan: serializeCareerPathPlan(doc) });
  } catch (err) {
    logControllerError('upsertCareerPathPlan', err);
    res.status(500).json({ success: false, error: 'Failed to save career path plan' });
  }
};

/**
 * DELETE /api/profile/career-path-plans/:escoId
 * Removes the user's plan for a role (used by "start over").
 */
exports.deleteCareerPathPlan = async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const escoId = normalizeCareerPathPlanEscoId(req.params.escoId);
    if (!escoId) {
      return res.status(400).json({ success: false, error: 'escoId is required' });
    }
    // With ?lang, delete only that language's plan; otherwise remove all languages for the role.
    const langParam = req.query && (req.query.lang || req.query.language);
    const filter = { userId, escoId };
    if (langParam) {
      filter.language = normalizeCareerPathPlanLang(langParam);
    }
    await CareerPathPlan.deleteMany(filter);
    res.json({ success: true });
  } catch (err) {
    logControllerError('deleteCareerPathPlan', err);
    res.status(500).json({ success: false, error: 'Failed to delete career path plan' });
  }
};

exports.postRoleFitExplanation = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const {
      role,
      simulationScopeId,
      roleContext,
      debug,
      language,
      lang,
    } = body;
    if (!role || typeof role !== 'object') {
      return res.status(400).json({ success: false, error: 'role is required' });
    }
    const resolvedLang = lang || language || req.language || 'en';
    const userId = req.user && req.user.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (debug) {
      console.debug('[postRoleFitExplanation] role keys', Object.keys(role));
    }
    const result = await getOrCreateRoleFitExplanation({
      userId,
      language: resolvedLang,
      role,
      simulationScopeId,
      roleContext,
      debug: Boolean(debug),
    });
    if (debug) {
      console.debug('[postRoleFitExplanation] done', {
        cached: result.fromCache,
        source: result.explanationSource,
      });
    }
    res.json({
      success: true,
      text: result.text,
      bullets: result.bullets,
      source: result.explanationSource,
      cached: result.fromCache,
    });
  } catch (err) {
    logControllerError('postRoleFitExplanation', err);
    const msg = err.message || String(err);
    const status =
      msg.includes('OPENAI_API_KEY') || msg.includes('OpenAI API error') ? 503 : 500;
    res.status(status).json({
      success: false,
      error: msg || 'Role-fit explanation failed',
    });
  }
};

exports.updateProfileName = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.name = String(req.body.name || '').trim();
    await user.save();

    res.json({ success: true, name: user.name });
  } catch (err) {
    logControllerError('Update profile name error', err);
    res.status(500).json({ error: 'Failed to update profile name', details: err.message });
  }
};

// Update user identity answers (five self-assessment prompts) - User Identity section
exports.updateUserIdentity = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const bodyRaw = req.body || {};
    const {
      cvExtractLocalization: incomingCvLoc,
      forceRegenerateWhoAreYou: forceRegenerateWhoAreYouRaw,
      forceRegenerateWhoAreYouField: forceRegenerateWhoAreYouFieldRaw,
      ...answersBody
    } = bodyRaw;
    const forceRegenerateFieldKey = String(forceRegenerateWhoAreYouFieldRaw || '').trim();
    const forceRegenerateFieldIndex = USER_IDENTITY_ANSWER_KEYS.indexOf(forceRegenerateFieldKey);
    const forceRegenerateAll = Boolean(forceRegenerateWhoAreYouRaw);
    const forceRegenerateIndices = forceRegenerateFieldIndex >= 0
      ? [forceRegenerateFieldIndex]
      : (forceRegenerateAll ? [0, 1, 2, 3, 4] : []);
    const wantsForceRegenerate = forceRegenerateIndices.length > 0;

    const nextAnswers = normalizeUserIdentityAnswers({});
    for (const k of USER_IDENTITY_ANSWER_KEYS) {
      nextAnswers[k] = String(answersBody[k] ?? '').trim();
    }

    if (incomingCvLoc && typeof incomingCvLoc === 'object') {
      user.profile.cvExtractLocalization = mergeCvExtractLocalizationPatch(
        user.profile.cvExtractLocalization,
        incomingCvLoc
      );
      user.markModified('profile.cvExtractLocalization');
    }

    if (!user.profile.userIdentityAnswers || typeof user.profile.userIdentityAnswers !== 'object') {
      user.profile.userIdentityAnswers = {};
    }
    const previousRawAnswers = buildWhoAreYouRawAnswersFromIdentity(user.profile.userIdentityAnswers || {});
    const storedWhoRaw = Array.isArray(user.profile.who_are_you?.raw_answers)
      ? user.profile.who_are_you.raw_answers.map((value) => String(value || '').trim())
      : [];
    const baselineRawAnswers = storedWhoRaw.some(Boolean) ? storedWhoRaw : previousRawAnswers;

    Object.assign(user.profile.userIdentityAnswers, nextAnswers);
    user.markModified('profile.userIdentityAnswers');

    if (user.profile.cvExtractLocalization) {
      if (syncCvExtractUserIdentityFromFlat(user.profile.cvExtractLocalization, nextAnswers, req.language)) {
        user.markModified('profile.cvExtractLocalization');
      }
    }
    const narrativeSourceLanguage = resolveNarrativeSourceLanguage(user.profile || {}, 'en');
    const nextRawAnswers = buildWhoAreYouRawAnswersFromIdentity(user.profile.userIdentityAnswers || {});
    const identityChangeClass = classifyIdentityAnswerChanges(baselineRawAnswers, nextRawAnswers);
    // Manual bullet edits keep the last saved AI summary until the user explicitly regenerates
    // (or coaching restart / first-fill paths request force regenerate).
    const existingWhoAreYou = user.profile.who_are_you || {};
    const existingWhoRawAnswers = Array.isArray(existingWhoAreYou.raw_answers)
      ? existingWhoAreYou.raw_answers.map((value) => String(value || '').trim())
      : [];
    const hasExistingWhoAreYouSummary = existingWhoRawAnswers.some(Boolean)
      && isWhoAreYouNarrativeDisplayReady(existingWhoAreYou, narrativeSourceLanguage);
    const canPreserveWhoAreYouNarrative = !wantsForceRegenerate && hasExistingWhoAreYouSummary;

    if (forceRegenerateFieldIndex >= 0 && hasExistingWhoAreYouSummary) {
      // Regenerate only the requested sub-section; keep other AI summaries intact.
      user.profile.who_are_you = applyPartialWhoAreYouForceRegenerate({
        existingWhoAreYou,
        nextRawAnswers,
        indices: forceRegenerateIndices,
      });
      user.markModified('profile.who_are_you');
    } else if (!canPreserveWhoAreYouNarrative) {
      const deferWhoAreYouNarrative = wantsForceRegenerate || profileWhoAreYouNeedsNarrativeWork(
        user.profile || {},
        narrativeSourceLanguage,
        identityChangeClass
      );
      const { normalized: normalizedWhoAreYou } = await normalizeWhoAreYouForStorage(
        user.profile || {},
        {
          forceRegenerate: forceRegenerateAll,
          deferLlm: deferWhoAreYouNarrative,
          language: req.language,
          sourceLanguage: narrativeSourceLanguage,
          identityChangeClass,
        }
      );
      user.profile.who_are_you = normalizedWhoAreYou;
      user.markModified('profile.who_are_you');
    }

    try {
      const computed = await calculateCareerSimulationInputs(user.profile);
      const defaultEnrichment = {
        status: 'none',
        message: '',
        extractedSkills: [],
        extractedWorkExperience: [],
        extractedEducation: [],
        extractedCertifications: [],
        extractedProjects: [],
        sourceDocumentIds: [],
        lastParsedAt: null
      };
      if (!user.profile.careerSimulationInputs) {
        user.profile.careerSimulationInputs = { documentEnrichment: defaultEnrichment };
      }
      const csi = user.profile.careerSimulationInputs;
      if (!csi.documentEnrichment || typeof csi.documentEnrichment !== 'object') {
        csi.documentEnrichment = defaultEnrichment;
      }
      csi.structuredUserInfo = computed.structuredUserInfo;
      csi.userIdentity = computed.userIdentity;
      csi.seniority = computed.seniority;
      csi.lastCalculated = new Date();
      csi.isManuallyEdited = csi.isManuallyEdited || false;
      if (Array.isArray(csi.editHistory)) {
        csi.editHistory.push({
          editedAt: new Date(),
          editor: req.user.userId,
          changes: { recalculatedFromProfile: true }
        });
      } else {
        csi.editHistory = [];
      }
    } catch (calcErr) {
      console.warn('Career simulation inputs recalculation failed (non-fatal):', calcErr.message);
    }

    await user.save();

    const narrativeStatus = schedulePendingProfileNarrativesIfNeeded(
      req.user.userId,
      user.profile,
      req.language
    );
    if (narrativeStatus.narrativesReady && identityChangeClass.hasMajorChange) {
      scheduleRefreshUserIdentityEmbeddingForUser(req.user.userId);
    }

    scheduleIdentityExplorationAfterActivity(req.user.userId, { language: req.language });

    logUserActivity(req.user.userId, {
      type: ACTIVITY_TYPES.PROFILE_SECTION_UPDATED,
      meta: { section: 'userIdentity' },
    });
    void maybeRecordProfileFilled(
      req.user.userId,
      computeProfileCompletion(user.profile).overall
    );

    const profileStructured = user.profile.structuredUserInfo || {};
    const responseWhoAreYou = normalizeLocalizedProfileFieldsForResponse(
      { who_are_you: user.profile.who_are_you || { raw_answers: [], summary_text: '' } },
      req.language
    ).who_are_you;
    res.json({
      success: true,
      narrativesReady: narrativeStatus.narrativesReady,
      narrativePending: narrativeStatus.narrativePending,
      identityEditMagnitude: identityChangeClass.hasMajorChange ? 'major' : (identityChangeClass.onlyMinorChanges ? 'minor' : 'none'),
      userIdentity: overlayIdentityAnswersWithCvLocalization(
        normalizeUserIdentityAnswers(user.profile.userIdentityAnswers || {}),
        user.profile.cvExtractLocalization?.userIdentity,
        req.language
      ),
      who_are_you: responseWhoAreYou,
      careerSimulationInputs: await enrichCareerSimulationInputsForClientResponse(
        user.profile.careerSimulationInputs,
        profileStructured,
        { language: req.language }
      ),
    });
  } catch (err) {
    logControllerError('Update user identity error', err);
    res.status(500).json({
      message: err.message || 'Failed to update user identity',
      error: err.message
    });
  }
};

// Update seniority (currentStatus, yearsOfExperience, highestDegree, mostSeniorWorkExperience)
exports.updateSeniority = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { currentStatus, yearsOfExperience, highestDegree, mostSeniorWorkExperience } = req.body;

    if (currentStatus !== undefined) {
      if (!user.profile.seniority) user.profile.seniority = {};
      user.profile.seniority.currentStatus = currentStatus ? String(currentStatus).trim() : '';
    }
    if (yearsOfExperience !== undefined) {
      if (!user.profile.seniority) user.profile.seniority = {};
      const val = yearsOfExperience === '' || yearsOfExperience === null || yearsOfExperience === undefined
        ? null
        : parseInt(yearsOfExperience, 10);
      user.profile.seniority.yearsOfExperience = (val >= 0 && val <= 50) ? val : null;
    }
    if (highestDegree !== undefined) {
      if (!user.profile.seniority) user.profile.seniority = {};
      user.profile.seniority.highestDegree = highestDegree ? String(highestDegree).trim() : '';
    }
    if (mostSeniorWorkExperience !== undefined) {
      if (!user.profile.seniority) user.profile.seniority = {};
      user.profile.seniority.mostSeniorWorkExperience = mostSeniorWorkExperience ? String(mostSeniorWorkExperience).trim() : '';
    }
    user.markModified('profile.seniority');

    try {
      const computed = await calculateCareerSimulationInputs(user.profile);
      const defaultEnrichment = {
        status: 'none',
        message: '',
        extractedSkills: [],
        extractedWorkExperience: [],
        extractedEducation: [],
        extractedCertifications: [],
        extractedProjects: [],
        sourceDocumentIds: [],
        lastParsedAt: null
      };
      if (!user.profile.careerSimulationInputs) {
        user.profile.careerSimulationInputs = { documentEnrichment: defaultEnrichment };
      }
      const csi = user.profile.careerSimulationInputs;
      if (!csi.documentEnrichment || typeof csi.documentEnrichment !== 'object') {
        csi.documentEnrichment = defaultEnrichment;
      }
      csi.structuredUserInfo = computed.structuredUserInfo;
      csi.userIdentity = computed.userIdentity;
      csi.seniority = computed.seniority;
      csi.lastCalculated = new Date();
      csi.isManuallyEdited = csi.isManuallyEdited || false;
      if (Array.isArray(csi.editHistory)) {
        csi.editHistory.push({
          editedAt: new Date(),
          editor: req.user.userId,
          changes: { recalculatedFromProfile: true }
        });
      } else {
        csi.editHistory = [];
      }
    } catch (calcErr) {
      console.warn('Career simulation inputs recalculation failed (non-fatal):', calcErr.message);
    }

    await user.save();

    logUserActivity(req.user.userId, {
      type: ACTIVITY_TYPES.PROFILE_SECTION_UPDATED,
      meta: { section: 'seniority' },
    });
    void maybeRecordProfileFilled(
      req.user.userId,
      computeProfileCompletion(user.profile).overall
    );

    const responseSeniority = {
      currentStatus: user.profile.seniority?.currentStatus || '',
      yearsOfExperience: user.profile.seniority?.yearsOfExperience ?? null,
      highestDegree: user.profile.seniority?.highestDegree || '',
      mostSeniorWorkExperience: user.profile.seniority?.mostSeniorWorkExperience || '',
    };

    const expectedCurrentStatus = currentStatus !== undefined
      ? (currentStatus ? String(currentStatus).trim() : '')
      : responseSeniority.currentStatus;
    const expectedYears = yearsOfExperience !== undefined
      ? (yearsOfExperience === '' || yearsOfExperience === null || yearsOfExperience === undefined
        ? null
        : (() => {
          const val = parseInt(yearsOfExperience, 10);
          return (val >= 0 && val <= 50) ? val : null;
        })())
      : responseSeniority.yearsOfExperience;
    const expectedHighestDegree = highestDegree !== undefined
      ? (highestDegree ? String(highestDegree).trim() : '')
      : responseSeniority.highestDegree;
    const expectedMostSenior = mostSeniorWorkExperience !== undefined
      ? (mostSeniorWorkExperience ? String(mostSeniorWorkExperience).trim() : '')
      : responseSeniority.mostSeniorWorkExperience;

    if (
      responseSeniority.currentStatus !== expectedCurrentStatus
      || responseSeniority.yearsOfExperience !== expectedYears
      || responseSeniority.highestDegree !== expectedHighestDegree
      || responseSeniority.mostSeniorWorkExperience !== expectedMostSenior
    ) {
      return res.status(500).json({
        message: 'Seniority fields were not persisted correctly',
        error: 'Seniority persist verification failed',
      });
    }

    const profileStructured = user.profile.structuredUserInfo || {};
    res.json({
      success: true,
      seniority: responseSeniority,
      careerSimulationInputs: await enrichCareerSimulationInputsForClientResponse(
        user.profile.careerSimulationInputs,
        profileStructured,
        { language: req.language }
      ),
    });
  } catch (err) {
    logControllerError('Update seniority error', err);
    res.status(500).json({
      message: err.message || 'Failed to update seniority',
      error: err.message
    });
  }
};

// Update structured user info source fields
exports.updateStructuredUserInfo = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const rawStructured = req.body || {};
    const { cvExtractLocalization: structuredCvPatch, ...structuredBodyOnly } = rawStructured;

    if (structuredCvPatch && typeof structuredCvPatch === 'object') {
      user.profile.cvExtractLocalization = mergeCvExtractLocalizationPatch(
        user.profile.cvExtractLocalization,
        structuredCvPatch
      );
      user.markModified('profile.cvExtractLocalization');
    }

    const existingStructured =
      user.profile.structuredUserInfo && typeof user.profile.structuredUserInfo === 'object'
        ? (typeof user.profile.structuredUserInfo.toObject === 'function'
          ? user.profile.structuredUserInfo.toObject()
          : user.profile.structuredUserInfo)
        : {};
    const narrativeSourceLanguage = resolveNarrativeSourceLanguage(user.profile || {}, 'en');
    const mergedStructuredBody = buildMergedStructuredPayloadForNormalization(
      existingStructured,
      structuredBodyOnly,
      'replace'
    );
    const dimensionsNeedingLlm = resolveDimensionKeysNeedingLlmRegeneration(mergedStructuredBody);
    if (dimensionsNeedingLlm.length > 0) {
      console.log(
        '[updateStructuredUserInfo] regenerating dimension narratives:',
        dimensionsNeedingLlm.join(', ')
      );
    }

    const { normalized: structuredUserInfo } = await normalizeStructuredUserInfoForStorage(
      mergedStructuredBody,
      {
        forceRegenerate: false,
        deferLlmDimensionKeys: dimensionsNeedingLlm,
        language: req.language,
        sourceLanguage: narrativeSourceLanguage,
      }
    );

    user.profile.structuredUserInfo = structuredUserInfo;

    try {
      const computed = await calculateCareerSimulationInputs(user.profile);
      const defaultEnrichment = {
        status: 'none',
        message: '',
        extractedSkills: [],
        extractedWorkExperience: [],
        extractedEducation: [],
        extractedCertifications: [],
        extractedProjects: [],
        sourceDocumentIds: [],
        lastParsedAt: null
      };
      if (!user.profile.careerSimulationInputs) {
        user.profile.careerSimulationInputs = { documentEnrichment: defaultEnrichment };
      }
      const csi = user.profile.careerSimulationInputs;
      if (!csi.documentEnrichment || typeof csi.documentEnrichment !== 'object') {
        csi.documentEnrichment = defaultEnrichment;
      }
      csi.structuredUserInfo = computed.structuredUserInfo;
      csi.userIdentity = computed.userIdentity;
      csi.seniority = computed.seniority;
      csi.lastCalculated = new Date();
      csi.isManuallyEdited = false;
      if (Array.isArray(csi.editHistory)) {
        csi.editHistory.push({
          editedAt: new Date(),
          editor: req.user.userId,
          changes: { recalculatedFromStructuredUserInfo: true }
        });
      } else {
        csi.editHistory = [];
      }
    } catch (calcErr) {
      console.warn('Career simulation inputs recalculation failed (non-fatal):', calcErr.message);
    }

    await user.save();

    const narrativeStatus = schedulePendingProfileNarrativesIfNeeded(
      req.user.userId,
      user.profile,
      req.language
    );
    if (narrativeStatus.narrativesReady) {
      scheduleRefreshUserIdentityEmbeddingForUser(req.user.userId);
    }

    scheduleIdentityExplorationAfterActivity(req.user.userId, { language: req.language });

    logUserActivity(req.user.userId, {
      type: ACTIVITY_TYPES.PROFILE_SECTION_UPDATED,
      meta: { section: 'structuredUserInfo' },
    });
    void maybeRecordProfileFilled(
      req.user.userId,
      computeProfileCompletion(user.profile).overall
    );

    const profileStructured = user.profile.structuredUserInfo || {};
    res.json({
      success: true,
      narrativesReady: narrativeStatus.narrativesReady,
      narrativePending: narrativeStatus.narrativePending,
      structuredUserInfo: profileStructured,
      careerSimulationInputs: await enrichCareerSimulationInputsForClientResponse(
        user.profile.careerSimulationInputs,
        profileStructured,
        { language: req.language }
      ),
    });
  } catch (err) {
    logControllerError('Update structured user info error', err);
    res.status(500).json({
      message: err.message || 'Failed to update structured user info',
      error: err.message
    });
  }
};

// Atomic CV review save: seniority, identity, structured lists, optional name — one transaction.
exports.saveProfileReview = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const body = req.body || {};
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const normalizedSeniority = normalizeSeniorityFields(body.seniority || {});

    const existingIdentity = overlayIdentityAnswersWithCvLocalization(
      normalizeUserIdentityAnswers(user.profile.userIdentityAnswers || {}),
      user.profile.cvExtractLocalization?.userIdentity,
      req.language
    );
    const existingStructuredForMerge =
      user.profile.structuredUserInfo && typeof user.profile.structuredUserInfo.toObject
        === 'function'
        ? user.profile.structuredUserInfo.toObject()
        : (user.profile.structuredUserInfo || {});
    const incomingStructured = body.structuredUserInfo || {};
    const acceptedFields =
      body.acceptedFields && typeof body.acceptedFields === 'object' ? body.acceptedFields : {};
    let extractionBaseline = null;
    const documentId = body.documentId != null ? String(body.documentId).trim() : '';
    let sourceDoc = null;
    if (documentId) {
      sourceDoc = user.profile.documents?.id?.(documentId) || null;
      extractionBaseline = loadExtractionBaselineFromDocument(sourceDoc, acceptedFields);
    }
    const narrativeEnrichment = getNarrativeEnrichmentFromDocument(sourceDoc);
    const reuseExtractionNarrativeKeys = extractionBaseline
      ? resolveReuseExtractionNarrativeKeys({
        existingStructured: existingStructuredForMerge,
        incomingStructured,
        extractionBaseline,
        mode,
      })
      : [];
    const reuseExtractionWhoAreYou = Boolean(
      extractionBaseline
      && userIdentityMatchesExtraction(body.userIdentity || {}, extractionBaseline.userIdentity)
      && isWhoAreYouNarrativeReady(narrativeEnrichment?.who_are_you || {}, req.language)
    );
    const mergedStructuredBody = buildMergedStructuredPayloadForNormalization(
      existingStructuredForMerge,
      incomingStructured,
      mode,
      {
        extractionNarrativeCache: narrativeEnrichment,
        reuseExtractionNarrativeKeys,
      }
    );
    const mergedIdentityAnswers = buildMergedUserIdentity(
      existingIdentity,
      body.userIdentity || {},
      mode
    );
    const narrativeSourceLanguage = resolveNarrativeSourceLanguage(user.profile || {}, 'en');

    if (body.cvExtractLocalization && typeof body.cvExtractLocalization === 'object') {
      user.profile.cvExtractLocalization = mergeCvExtractLocalizationPatch(
        user.profile.cvExtractLocalization,
        body.cvExtractLocalization
      );
      user.markModified('profile.cvExtractLocalization');
    }

    applySeniorityToUser(user, normalizedSeniority);

    if (typeof body.name === 'string' && body.name.trim().length >= 2) {
      user.name = body.name.trim();
    }

    if (!user.profile.userIdentityAnswers || typeof user.profile.userIdentityAnswers !== 'object') {
      user.profile.userIdentityAnswers = {};
    }
    Object.assign(user.profile.userIdentityAnswers, mergedIdentityAnswers);
    user.markModified('profile.userIdentityAnswers');

    if (user.profile.cvExtractLocalization) {
      if (syncCvExtractUserIdentityFromFlat(user.profile.cvExtractLocalization, mergedIdentityAnswers, req.language)) {
        user.markModified('profile.cvExtractLocalization');
      }
    }

    let structuredUserInfo;
    let normalizedWhoAreYou;
    let usedNarrativeCacheFastPath = false;
    let narrativeApplyMode = 'none';

    const cacheResult = sourceDoc
      ? tryBuildProfileNarrativesFromDocumentCache(
        sourceDoc,
        body,
        acceptedFields,
        mergedIdentityAnswers,
        req.language
      )
      : { ok: false, reason: 'no_document' };

    if (cacheResult.ok) {
      usedNarrativeCacheFastPath = true;
      narrativeApplyMode = 'full_cache';
      structuredUserInfo = cacheResult.structuredUserInfo;
      normalizedWhoAreYou = cacheResult.who_are_you;
      console.log('[saveProfileReview] applied document narrative cache: full_cache');
      if (sourceDoc && documentId) {
        schedulePersistNarrativeEnrichmentFromApply(
          req.user.userId,
          documentId,
          sourceDoc,
          body,
          acceptedFields,
          structuredUserInfo,
          normalizedWhoAreYou,
          req.language,
          narrativeSourceLanguage
        );
      }
    } else if (cacheResult.reason && cacheResult.reason !== 'no_document') {
      console.log('[saveProfileReview] narrative cache not ready for fast apply:', cacheResult.reason);
    }

    if (!usedNarrativeCacheFastPath) {
      narrativeApplyMode = 'deferred';
      const dimensionsNeedingLlm = resolveDimensionKeysNeedingLlmRegeneration(mergedStructuredBody);
      if (dimensionsNeedingLlm.length > 0) {
        console.log(
          '[saveProfileReview] deferring dimension narratives:',
          dimensionsNeedingLlm.join(', ')
        );
      }

      const storedRawAnswers = buildWhoAreYouRawAnswersFromIdentity(existingIdentity);
      const mergedRawAnswers = buildWhoAreYouRawAnswersFromIdentity(mergedIdentityAnswers);
      const identityChangeClass = classifyIdentityAnswerChanges(storedRawAnswers, mergedRawAnswers);

      const profileSnapshotForNarratives = {
        ...(typeof user.profile?.toObject === 'function' ? user.profile.toObject() : (user.profile || {})),
        userIdentityAnswers: mergedIdentityAnswers,
        who_are_you:
          typeof user.profile?.who_are_you?.toObject === 'function'
            ? user.profile.who_are_you.toObject()
            : (user.profile?.who_are_you || {}),
      };

      const whoNeedsDefer = !reuseExtractionWhoAreYou
        && profileWhoAreYouNeedsNarrativeWork(
          profileSnapshotForNarratives,
          narrativeSourceLanguage,
          identityChangeClass
        );
      if (whoNeedsDefer) {
        console.log('[saveProfileReview] deferring who_are_you narratives');
      }

      const whoAreYouPromise = reuseExtractionWhoAreYou
        ? Promise.resolve({
          normalized: {
            ...narrativeEnrichment.who_are_you,
            raw_answers: mergedRawAnswers,
          },
        })
        : normalizeWhoAreYouForStorage(profileSnapshotForNarratives, {
          forceRegenerate: false,
          deferLlm: whoNeedsDefer,
          language: req.language,
          sourceLanguage: narrativeSourceLanguage,
          identityChangeClass,
        });

      const normalized = await Promise.all([
        normalizeStructuredUserInfoForStorage(mergedStructuredBody, {
          forceRegenerate: false,
          deferLlmDimensionKeys: dimensionsNeedingLlm,
          language: req.language,
          sourceLanguage: narrativeSourceLanguage,
        }),
        whoAreYouPromise,
      ]);
      structuredUserInfo = normalized[0].normalized;
      normalizedWhoAreYou = normalized[1].normalized;
    }

    if (!user.profile.structuredUserInfo || typeof user.profile.structuredUserInfo !== 'object') {
      user.profile.structuredUserInfo = {};
    }
    for (const { key } of STRUCTURED_DIMENSIONS) {
      user.profile.structuredUserInfo[key] = structuredUserInfo[key];
      user.markModified(`profile.structuredUserInfo.${key}`);
    }
    user.markModified('profile.structuredUserInfo');
    user.profile.who_are_you = normalizedWhoAreYou;
    user.markModified('profile.who_are_you');

    await user.save();

    logUserActivity(req.user.userId, {
      type: ACTIVITY_TYPES.PROFILE_SECTION_UPDATED,
      meta: { section: 'profileReview' },
    });
    void maybeRecordProfileFilled(
      req.user.userId,
      computeProfileCompletion(user.profile).overall
    );

    const narrativeStatus = schedulePendingProfileNarrativesIfNeeded(
      req.user.userId,
      user.profile,
      req.language
    );
    if (narrativeStatus.narrativesReady) {
      scheduleRefreshUserIdentityEmbeddingForUser(req.user.userId);
    }
    schedulePostProfileReviewSaveWork(req.user.userId, {
      editorId: req.user.userId,
      changes: { recalculatedFromProfileReview: true },
    });

    if (!verifySeniorityPersisted(user.profile.seniority, normalizedSeniority)) {
      return res.status(500).json({
        message: 'Seniority fields were not persisted correctly',
        error: 'Seniority persist verification failed',
      });
    }

    const responseSeniority = readSeniorityFromProfile(user.profile);
    const profileStructured = user.profile.structuredUserInfo || {};
    const normalizedForResponse = normalizeLocalizedProfileFieldsForResponse(
      {
        structuredUserInfo: profileStructured,
        who_are_you: user.profile.who_are_you || { raw_answers: [], summary_text: '' },
      },
      req.language
    );
    const responseWhoAreYou = normalizedForResponse.who_are_you;
    let responseStructuredUserInfo = {
      ...(normalizedForResponse.structuredUserInfo || profileStructured),
    };
    if (user.profile?.cvExtractLocalization) {
      responseStructuredUserInfo = overlayStructuredUserInfoListsWithCvLocalization(
        responseStructuredUserInfo,
        user.profile.cvExtractLocalization,
        req.language
      );
    }
    const responseDocuments = Array.isArray(user.profile?.documents)
      ? user.profile.documents.map((doc) => serializeEmbeddedDocumentForClient(doc, { uiLanguage: req.language }))
      : [];

    res.json({
      success: true,
      narrativesReady: narrativeStatus.narrativesReady,
      narrativePending: narrativeStatus.narrativePending,
      usedNarrativeCacheFastPath,
      narrativeApplyMode,
      name: user.name || '',
      email: user.email || '',
      documents: responseDocuments,
      seniority: responseSeniority,
      userIdentity: overlayIdentityAnswersWithCvLocalization(
        normalizeUserIdentityAnswers(user.profile.userIdentityAnswers || {}),
        user.profile.cvExtractLocalization?.userIdentity,
        req.language
      ),
      who_are_you: responseWhoAreYou,
      structuredUserInfo: responseStructuredUserInfo,
    });
  } catch (err) {
    logControllerError('Save profile review error', err);
    res.status(500).json({
      message: err.message || 'Failed to save profile review',
      error: err.message,
    });
  }
};

/** Poll until display-critical narratives are ready on the saved profile. */
exports.getProfileNarrativesStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const readiness = ensureProfileNarrativeBackfillScheduled(
      req.user.userId,
      user.profile || {},
      req.language
    );
    res.json({ success: true, ...readiness });
  } catch (err) {
    logControllerError('Get profile narratives status error', err);
    res.status(500).json({
      message: err.message || 'Failed to read profile narratives status',
      error: err.message,
    });
  }
};

/** Pre-generate narratives for the current CV review wizard snapshot (step transitions). */
exports.warmReviewNarrativeCache = async (req, res) => {
  try {
    const documentId = req.body?.documentId != null ? String(req.body.documentId).trim() : '';
    if (!documentId) {
      return res.status(400).json({ message: 'documentId is required' });
    }

    const acceptedFields =
      req.body?.acceptedFields && typeof req.body.acceptedFields === 'object'
        ? req.body.acceptedFields
        : {};

    const { warmReviewNarrativeCache } = require('../services/profile/extractionNarrativeEnrichmentService');
    const awaitReady = req.body?.awaitReady === true;
    const result = await warmReviewNarrativeCache(
      req.user.userId,
      documentId,
      {
        userIdentity: req.body?.userIdentity,
        structuredUserInfo: req.body?.structuredUserInfo,
      },
      {
        language: req.language,
        acceptedFields,
        background: !awaitReady,
      }
    );

    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('Warm review narrative cache error', err);
    res.status(500).json({
      message: err.message || 'Failed to warm review narrative cache',
      error: err.message,
    });
  }
};

// Update preferences
exports.updatePreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    user.profile.preferences = { ...user.profile.preferences, ...req.body };
    await user.save();
    
    res.json({ success: true, preferences: user.profile.preferences });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update preferences', details: err.message });
  }
};

// Update profile picture
exports.updateProfilePicture = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No profile picture uploaded' });
    }
    
    // Verify file exists
    if (!fs.existsSync(req.file.path)) {
      logControllerError('Uploaded file missing on disk', new Error('Uploaded file does not exist at path'), { path: req.file.path });
      return res.status(500).json({ error: 'File was not saved correctly' });
    }
    
    // Delete old profile picture if it exists
    const oldPicture = user.profile?.personalInfo?.profilePicture;
    if (oldPicture) {
      const oldPicturePath = path.join(__dirname, '../../uploads', oldPicture);
      try {
        if (fs.existsSync(oldPicturePath)) {
          fs.unlinkSync(oldPicturePath);
        }
      } catch (deleteErr) {
        logControllerError('Error deleting old profile picture', deleteErr);
        // Continue with upload even if old file deletion fails
      }
    }
    
    // Update profile picture in personalInfo
    if (!user.profile.personalInfo) {
      user.profile.personalInfo = {};
    }
    user.profile.personalInfo.profilePicture = req.file.filename;
    await user.save();
    
    // Return updated personalInfo to ensure frontend has correct data
    res.json({ 
      success: true, 
      profilePicture: req.file.filename,
      personalInfo: user.profile.personalInfo
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile picture', details: err.message });
  }
};

// Delete profile picture
exports.deleteProfilePicture = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const profilePicture = user.profile?.personalInfo?.profilePicture;
    if (!profilePicture) {
      return res.status(400).json({ error: 'No profile picture to delete' });
    }
    
    // Delete file from filesystem
    const picturePath = path.join(__dirname, '../../uploads', profilePicture);
    try {
      if (fs.existsSync(picturePath)) {
        fs.unlinkSync(picturePath);
      }
    } catch (deleteErr) {
      logControllerError('Error deleting profile picture file', deleteErr);
      // Continue with database update even if file deletion fails
    }
    
    // Remove profile picture from user profile
    if (user.profile.personalInfo) {
      user.profile.personalInfo.profilePicture = undefined;
      await user.save();
    }
    
    res.json({ success: true, message: 'Profile picture deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete profile picture', details: err.message });
  }
};

// Recalculate all career simulation inputs (migration function)
exports.recalculateAllCareerSimulationInputs = async (req, res) => {
  try {
    const users = await User.find({});
    let updatedCount = 0;
    
    for (const user of users) {
      if (user.profile) {
        const newInputs = await calculateCareerSimulationInputs(user.profile);
        user.profile.careerSimulationInputs = {
          ...newInputs,
          isManuallyEdited: false,
          lastCalculated: new Date()
        };
        await user.save();
        updatedCount++;
      }
    }
    
    res.json({ 
      success: true, 
      message: `Updated career simulation inputs for ${updatedCount} users` 
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to recalculate career simulation inputs', details: err.message });
  }
};

// Get saved simulations
exports.getSavedSimulations = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const activeSimulations = user.simulationResults.filter(sim => sim.status === 'active');
    const sortedActive = [...activeSimulations].sort((a, b) => {
      const ta = new Date(a.timestamp || 0).getTime();
      const tb = new Date(b.timestamp || 0).getTime();
      return tb - ta;
    });
    const savedSimulations = await Promise.all(sortedActive.map(async (sim) => {
      const localizedResults = await localizeSimulationResults(
        sim.results,
        req.language
      );
      const simulationData = plainSimulationResultEntry(sim);
      delete simulationData.description;
      simulationData.results = localizedResults;

      return {
      ...simulationData,
      resultsCount: {
        nextSteps: sim.results?.nextSteps?.length || 0,
        outsideTheBox: sim.results?.outsideTheBox?.length || 0,
        furtherAdvice: sim.results?.furtherAdvice?.length || 0
      }
    };
    }));
    
    res.json({ success: true, savedSimulations });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch saved simulations', details: err.message });
  }
};

// Get specific saved simulation
exports.getSavedSimulation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { id } = req.params;
    const simulation = user.simulationResults.find(sim => sim.id === id && sim.status === 'active');
    
    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }
    
    const localizedResults = await localizeSimulationResults(
      simulation.results,
      req.language
    );

    const simulationWithCounts = {
      ...(() => {
        const simulationData = plainSimulationResultEntry(simulation);
        delete simulationData.description;
        simulationData.results = localizedResults;
        return simulationData;
      })(),
      resultsCount: {
        nextSteps: simulation.results?.nextSteps?.length || 0,
        outsideTheBox: simulation.results?.outsideTheBox?.length || 0,
        furtherAdvice: simulation.results?.furtherAdvice?.length || 0
      }
    };
    
    res.json({ success: true, simulation: simulationWithCounts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch simulation', details: err.message });
  }
};

// Update saved simulation
exports.updateSavedSimulation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { id } = req.params;
    const { name } = req.body;
    
    const simulationIndex = user.simulationResults.findIndex(sim => sim.id === id && sim.status === 'active');
    if (simulationIndex === -1) {
      return res.status(404).json({ error: 'Simulation not found' });
    }
    
    user.simulationResults[simulationIndex].name = name || user.simulationResults[simulationIndex].name;
    delete user.simulationResults[simulationIndex].description;
    
    await user.save();
    
    const simulationData = normalizeSimulationResultEntryForResponse(
      user.simulationResults[simulationIndex].toObject(),
      req.language
    );
    delete simulationData.description;
    res.json({ success: true, simulation: simulationData });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update simulation', details: err.message });
  }
};

// Archive saved simulation
exports.archiveSavedSimulation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { id } = req.params;
    const simulationIndex = user.simulationResults.findIndex(sim => sim.id === id && sim.status === 'active');
    
    if (simulationIndex === -1) {
      return res.status(404).json({ error: 'Simulation not found' });
    }
    
    user.simulationResults[simulationIndex].status = 'archived';
    await user.save();
    
    res.json({ success: true, message: 'Simulation archived successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive simulation', details: err.message });
  }
};

// Remove individual career step from simulation results
exports.removeCareerStepFromSimulation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      logControllerError('User not found', new Error('User not found for ID'), { userId: req.user.userId });
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { simulationId, stepId } = req.params;
    if (!simulationId || !stepId) {
      logControllerError('Missing required parameters', new Error('Simulation ID and Step ID are required'), { simulationId, stepId });
      return res.status(400).json({ error: 'Simulation ID and Step ID are required' });
    }
    
    // Find the simulation
    const simulation = user.simulationResults.find(sim => sim.id === simulationId && sim.status === 'active');
    if (!simulation) {
      logControllerError('Simulation not found', new Error('Simulation not found with ID'), { simulationId });
      return res.status(404).json({ error: 'Simulation not found' });
    }
    
    // Find the career step in the results
    let stepFound = false;
    let stepType = null;
    let stepIndex = -1;
    
    // Phase 1: Prefer deterministic server-generated step IDs.
    const findIndexByStepId = (arr) => {
      if (!Array.isArray(arr)) return -1;
      return arr.findIndex((step) => step && (step.stepId === stepId || step.id === stepId));
    };

    const nextIndexById = findIndexByStepId(simulation.results.nextSteps);
    if (nextIndexById !== -1) {
      stepFound = true;
      stepType = 'nextSteps';
      stepIndex = nextIndexById;
    }

    const outsideIndexById = !stepFound ? findIndexByStepId(simulation.results.outsideTheBox) : -1;
    if (!stepFound && outsideIndexById !== -1) {
      stepFound = true;
      stepType = 'outsideTheBox';
      stepIndex = outsideIndexById;
    }

    const adviceIndexById = !stepFound ? findIndexByStepId(simulation.results.furtherAdvice) : -1;
    if (!stepFound && adviceIndexById !== -1) {
      stepFound = true;
      stepType = 'furtherAdvice';
      stepIndex = adviceIndexById;
    }
    
    // Legacy fallback: Extract the actual title from the (old) stepId and match by title.
    // (Some older saved simulations didn't store stepId on step objects.)
    let stepTitle = stepId;
    
    // Try to extract title from the generated stepId format: "title-simulationId-category-index"
    if (!stepFound && stepId.includes('-')) {
      const parts = stepId.split('-');
      // Find where the simulationId starts (it's usually a UUID format)
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let titleEndIndex = parts.length;
      
      for (let i = 0; i < parts.length; i++) {
        if (uuidPattern.test(parts[i])) {
          titleEndIndex = i;
          break;
        }
      }
      
      // Reconstruct the title (everything before the UUID, excluding the index)
      if (titleEndIndex > 1) {
        // Remove the last part before UUID (which is the index) and join the rest as title
        stepTitle = parts.slice(0, titleEndIndex - 1).join(' ');
      } else if (titleEndIndex > 0) {
        // Fallback: just take everything before UUID
        stepTitle = parts.slice(0, titleEndIndex).join(' ');
      }
    }
    
    // First try to find by exact title match
    if (!stepFound && simulation.results.nextSteps) {
      const nextStepIndex = simulation.results.nextSteps.findIndex(step => step.title === stepTitle);
      if (nextStepIndex !== -1) {
        stepFound = true;
        stepType = 'nextSteps';
        stepIndex = nextStepIndex;
      }
    }
    
    // Check in outsideTheBox if not found in nextSteps
    if (!stepFound && simulation.results.outsideTheBox) {
      const outsideStepIndex = simulation.results.outsideTheBox.findIndex(step => step.title === stepTitle);
      if (outsideStepIndex !== -1) {
        stepFound = true;
        stepType = 'outsideTheBox';
        stepIndex = outsideStepIndex;
      }
    }
    
    // Check in furtherAdvice if not found in other sections
    if (!stepFound && simulation.results.furtherAdvice) {
      const adviceIndex = simulation.results.furtherAdvice.findIndex(step => 
        step.title === stepTitle || step.advice === stepTitle
      );
      if (adviceIndex !== -1) {
        stepFound = true;
        stepType = 'furtherAdvice';
        stepIndex = adviceIndex;
      }
    }
    
    // If still not found, try to find by partial title match (for cases where the title was truncated)
    if (!stepFound) {
      if (simulation.results.nextSteps) {
        const nextStepIndex = simulation.results.nextSteps.findIndex(step => 
          step.title.toLowerCase().includes(stepTitle.toLowerCase()) || 
          stepTitle.toLowerCase().includes(step.title.toLowerCase())
        );
        if (nextStepIndex !== -1) {
          stepFound = true;
          stepType = 'nextSteps';
          stepIndex = nextStepIndex;
        }
      }
      
      if (!stepFound && simulation.results.outsideTheBox) {
        const outsideStepIndex = simulation.results.outsideTheBox.findIndex(step => 
          step.title.toLowerCase().includes(stepTitle.toLowerCase()) || 
          stepTitle.toLowerCase().includes(step.title.toLowerCase())
        );
        if (outsideStepIndex !== -1) {
          stepFound = true;
          stepType = 'outsideTheBox';
          stepIndex = outsideStepIndex;
        }
      }
      
      if (!stepFound && simulation.results.furtherAdvice) {
        const adviceIndex = simulation.results.furtherAdvice.findIndex(step => 
          (step.title && step.title.toLowerCase().includes(stepTitle.toLowerCase())) || 
          (step.advice && step.advice.toLowerCase().includes(stepTitle.toLowerCase())) ||
          stepTitle.toLowerCase().includes((step.title || step.advice || '').toLowerCase())
        );
        if (adviceIndex !== -1) {
          stepFound = true;
          stepType = 'furtherAdvice';
          stepIndex = adviceIndex;
        }
      }
    }
    
    if (!stepFound) {
      logControllerError('Career step not found', new Error('Career step not found with stepId'), { stepId });
      return res.status(404).json({ error: 'Career step not found' });
    }
    
    // Remove the career step
    const removedStep = simulation.results[stepType][stepIndex];
    simulation.results[stepType].splice(stepIndex, 1);

    // Update the results count
    if (simulation.resultsCount && simulation.resultsCount[stepType]) {
      simulation.resultsCount[stepType] = Math.max(0, simulation.resultsCount[stepType] - 1);
    }
    
    // Try to find a replacement step using prioritized lists
    let replacementStep = null;
    const { category } = req.body;
    
    // Map category names to prioritized list keys
    const listKey = category === 'nextSteps' ? 'nextCareerRoles' : 
                   category === 'outsideTheBox' ? 'outsideTheBoxRoles' : null;
    
    // Use prioritized lists approach if available
    if (category && listKey) {
      const currentPosition = simulation.results.currentPositions?.[listKey] || 3;

      // Prefer indexed DB lookup
      replacementStep = await getPrioritizedItemByPosition({
        userId: user._id,
        simulationId,
        category: listKey,
        position: currentPosition
      });

      // Legacy fallback: embedded list
      if (!replacementStep) {
        const prioritizedList = simulation.results.prioritizedLists?.[listKey];
        if (Array.isArray(prioritizedList) && currentPosition < prioritizedList.length) {
          replacementStep = prioritizedList[currentPosition];
        }
      }

      if (replacementStep) {
        // Ensure deterministic IDs exist (legacy payloads)
        const stepCategory = mapPrioritizedListCategoryToStepCategory(listKey);
        const stableStepId = replacementStep.stepId || replacementStep.id || generateStepId(
          replacementStep.title,
          simulationId,
          stepCategory,
          currentPosition
        );

        simulation.results[category].push({
          ...replacementStep,
          stepId: stableStepId,
          id: stableStepId,
          listCategory: listKey,
          category,
          isReplacement: true
        });

        // Update counts
        if (simulation.resultsCount && simulation.resultsCount[category] !== undefined) {
          simulation.resultsCount[category] = (simulation.resultsCount[category] || 0) + 1;
        }

        // Update the current position
        if (!simulation.results.currentPositions) {
          simulation.results.currentPositions = {};
        }
        simulation.results.currentPositions[listKey] = currentPosition + 1;
      }
    }
    // Fallback to old replacement pool approach for backward compatibility
    else if (category && simulation.replacementPools && simulation.replacementPools[category] && simulation.replacementPools[category].length > 0) {
      // Get the next best alternative from the replacement pool
      replacementStep = simulation.replacementPools[category].shift();
      
      // Add the replacement to the results
      if (replacementStep) {
        simulation.results[category].push(replacementStep);
        simulation.resultsCount[category] = (simulation.resultsCount[category] || 0) + 1;
        
      }
    }

    // Save the updated user
    await user.save();
    // Prepare response message
    let message = 'Career step removed successfully';
    if (replacementStep) {
      message = `Career step removed and replaced with "${replacementStep.title}"`;
    } else if (category) {
      message = 'Career step removed. No more alternatives available for this category.';
    }
    
    // Return the updated simulation results with replacement information
    res.json({ 
      success: true, 
      message: message,
      removedStep: {
        stepId: removedStep.stepId || removedStep.id,
        title: removedStep.title,
        category: stepType
      },
      replacementStep: replacementStep ? {
        stepId: replacementStep.stepId || replacementStep.id,
        title: replacementStep.title,
        description: replacementStep.description,
        matchedProfileInputs: replacementStep.matchedProfileInputs || replacementStep.matchedInputs || [],
        category: category,
        score:
          replacementStep.hybridScoreNextRole ??
          replacementStep.hybridScoreOutOfTheBox ??
          replacementStep.score ??
          0.8,
        isReplacement: true
      } : null,
      updatedResults: simulation.results,
      updatedCounts: simulation.resultsCount
    });
    
  } catch (err) {
    logControllerError('Error removing career step', err);

    // Enhanced error handling with proper error classification
    const errorResponse = {
      success: false,
      error: {
        type: 'server',
        code: 'REMOVE_STEP_ERROR',
        message: 'Failed to remove career step',
        details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
        timestamp: new Date().toISOString(),
        requestId: req.id || 'unknown'
      }
    };
    
    res.status(500).json(errorResponse);
  }
};

// Replace career step with next best alternative
exports.replaceCareerStep = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      logControllerError('User not found', new Error('User not found for ID'), { userId: req.user.userId });
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { simulationId, stepId } = req.params;
    const { category } = req.body;
    
    if (!simulationId || !stepId || !category) {
      logControllerError('Missing required parameters', new Error('Simulation ID, Step ID, and category are required'), { simulationId, stepId, category });
      return res.status(400).json({ error: 'Simulation ID, Step ID, and category are required' });
    }
    
    // Find the simulation
    const simulation = user.simulationResults.find(sim => sim.id === simulationId && sim.status === 'active');
    if (!simulation) {
      logControllerError('Simulation not found', new Error('Simulation not found with ID'), { simulationId });
      return res.status(404).json({ error: 'Simulation not found' });
    }
    
    // Initialize per-category tracking if it doesn't exist
    if (!simulation.categoryDisplayCounts) {
      simulation.categoryDisplayCounts = {
        nextSteps: 3,
        outsideTheBox: 3
      };
    }
    
    if (!simulation.categoryLimits) {
      simulation.categoryLimits = {
        nextSteps: 10,
        outsideTheBox: 10
      };
    }
    
    // Check per-category display limit
    const displayLimits = getDisplayLimits();
    const currentCategoryCount = simulation.categoryDisplayCounts[category] || 3;
    const categoryLimit = simulation.categoryLimits[category] || displayLimits[category] || 10;
    
    if (currentCategoryCount >= categoryLimit) {
      return res.status(400).json({
        error: `Maximum of ${categoryLimit} career steps can be displayed in ${category} category`,
        categoryLimit: categoryLimit,
        currentCount: currentCategoryCount
      });
    }
    
    // Initialize replacement pools if they don't exist
    if (!simulation.replacementPools) {
      simulation.replacementPools = {
        nextSteps: [],
        outsideTheBox: [],
        furtherAdvice: []
      };
    }
    
    // Initialize removed steps tracking if it doesn't exist
    if (!simulation.removedSteps) {
      simulation.removedSteps = {
        nextSteps: [],
        outsideTheBox: [],
        furtherAdvice: []
      };
    }
    
    // Get the replacement pool for this category
    const replacementPool = simulation.replacementPools[category] || [];
    const removedSteps = simulation.removedSteps[category] || [];
    
    // If no replacement pool exists, use prioritized lists approach
    if (replacementPool.length === 0) {
      // The prioritized lists approach should handle replacements
      // This fallback is no longer needed
    }
    
    // Find the next best replacement from the pool
    const availableReplacements = simulation.replacementPools[category].filter(step => 
      !removedSteps.some(removed => removed.title === step.title)
    );
    
    if (availableReplacements.length === 0) {
      return res.json({
        success: true,
        replacementStep: null,
        remainingAlternatives: 0,
        message: 'No more alternatives available for this category',
        updatedResults: simulation.results
      });
    }
    
    // Get the next best replacement (highest score)
    const replacementStep = availableReplacements[0];
    
    // Add the removed step to the tracking
    simulation.removedSteps[category].push({
      title: replacementStep.title,
      removedAt: new Date()
    });
    
    // Add the replacement to the current results
    if (!simulation.results[category]) {
      simulation.results[category] = [];
    }
    simulation.results[category].push({
      ...replacementStep,
      isReplacement: true,
      replacementIndex: simulation.results[category].length
    });
    
    // Update the results count
    if (simulation.resultsCount && simulation.resultsCount[category]) {
      simulation.resultsCount[category] = simulation.resultsCount[category] + 1;
    }
    
    // Update the category display count
    simulation.categoryDisplayCounts[category] = (simulation.categoryDisplayCounts[category] || 3) + 1;
    
    // Save the updated user
    await user.save();
    // Return the replacement step and updated results
    res.json({
      success: true,
      replacementStep: {
        ...replacementStep,
        isReplacement: true,
        replacementIndex: simulation.results[category].length - 1
      },
      remainingAlternatives: availableReplacements.length - 1,
      updatedResults: simulation.results,
      updatedCounts: simulation.resultsCount,
      categoryDisplayCounts: simulation.categoryDisplayCounts,
      categoryLimits: simulation.categoryLimits
    });
    
  } catch (err) {
    logControllerError('Error replacing career step', err);
    res.status(500).json({ error: 'Failed to replace career step', details: err.message });
  }
};

// Update existing simulation with changes (save changes functionality)
exports.updateSimulationResult = async (req, res) => {
  try {
    const { simulationId } = req.params;
    const updatedSimulationData = req.body;
    
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Find the simulation to update
    const simulationIndex = user.simulationResults.findIndex(
      sim => sim.id === simulationId
    );
    
    if (simulationIndex === -1) {
      return res.status(404).json({ error: 'Simulation not found' });
    }
    
    const existingSimulation = user.simulationResults[simulationIndex];
    // Validate the incoming data structure
    if (!updatedSimulationData.results) {
      return res.status(400).json({ error: 'Missing results data' });
    }
    
    // Ensure required fields are present
    const algorithmVersion =
      updatedSimulationData.algorithmVersion ||
      updatedSimulationData.results?.algorithmVersion ||
      existingSimulation.algorithmVersion ||
      ALGORITHM_VERSION;

    const scoringVersion =
      updatedSimulationData.scoringVersion ||
      updatedSimulationData.results?.scoringVersion ||
      existingSimulation.scoringVersion ||
      SCORING_VERSION;

    const validatedData = {
      ...updatedSimulationData,
      id: simulationId, // Preserve the original ID
      algorithmVersion,
      scoringVersion,
      timestamp: existingSimulation.timestamp, // Preserve original timestamp
      lastModified: new Date(), // Add modification timestamp
      // Ensure all required fields are present
      resultsCount: updatedSimulationData.resultsCount || {
        nextSteps: Array.isArray(updatedSimulationData.results.nextSteps) ? updatedSimulationData.results.nextSteps.length : 0,
        outsideTheBox: Array.isArray(updatedSimulationData.results.outsideTheBox) ? updatedSimulationData.results.outsideTheBox.length : 0,
        furtherAdvice: Array.isArray(updatedSimulationData.results.furtherAdvice) ? updatedSimulationData.results.furtherAdvice.length : 0
      },
      replacementPools: updatedSimulationData.replacementPools || {
        nextSteps: [],
        outsideTheBox: [],
        furtherAdvice: []
      },
      removedSteps: updatedSimulationData.removedSteps || {
        nextSteps: [],
        outsideTheBox: [],
        furtherAdvice: []
      }
    };
    
    // Ensure results has all required fields
    if (!validatedData.results.prioritizedLists) {
      console.warn('Missing prioritizedLists in results, adding defaults');
      validatedData.results.prioritizedLists = {
        nextCareerRoles: [],
        outsideTheBoxRoles: []
      };
    }

    // Ensure deterministic step IDs are present for prioritized lists
    validatedData.results.prioritizedLists = attachDeterministicStepIdsToPrioritizedLists(
      validatedData.results.prioritizedLists,
      simulationId
    );
    
    if (!validatedData.results.currentPositions) {
      console.warn('Missing currentPositions in results, adding defaults');
      validatedData.results.currentPositions = {
        nextCareerRoles: 3,
        outsideTheBoxRoles: 3
      };
    }

    validatedData.results.simulationId = simulationId;
    syncEvaluationFlowSimulationId(validatedData.results);
    if (validatedData.results.evaluationFlow) {
      validatedData.results.evaluationFlow = stripDerivedEvaluationViews(
        validatedData.results.evaluationFlow
      );
    }
    validatedData.results.algorithmVersion = algorithmVersion;
    validatedData.results.scoringVersion = scoringVersion;
    validatedData.results.scoringWeights =
      updatedSimulationData.results?.scoringWeights ||
      updatedSimulationData.scoringWeights ||
      existingSimulation.results?.scoringWeights ||
      undefined;
    validatedData.results.prioritizedListTotals = validatedData.results.prioritizedListTotals || {
      nextCareerRoles: Array.isArray(validatedData.results.prioritizedLists.nextCareerRoles) ? validatedData.results.prioritizedLists.nextCareerRoles.length : 0,
      outsideTheBoxRoles: Array.isArray(validatedData.results.prioritizedLists.outsideTheBoxRoles) ? validatedData.results.prioritizedLists.outsideTheBoxRoles.length : 0
    };
    
    // Update the simulation with new data
    user.simulationResults[simulationIndex] = {
      ...existingSimulation,
      ...validatedData,
      // Preserve original metadata
      name: validatedData.name || existingSimulation.name,
      profileCompletion: validatedData.profileCompletion || existingSimulation.profileCompletion,
      profileSnapshot: validatedData.profileSnapshot || existingSimulation.profileSnapshot,
      status: validatedData.status || existingSimulation.status
    };
    
    // Save the updated user
    await user.save();

    // Persist prioritized list items for indexed retrieval
    await upsertSimulationPrioritizedItems({
      userId: user._id,
      simulationId,
      prioritizedLists: user.simulationResults[simulationIndex].results?.prioritizedLists
    });
    
    // Return the updated simulation
    res.json({
      success: true,
      updatedSimulation: normalizeSimulationResultEntryForResponse(
        user.simulationResults[simulationIndex],
        req.language
      ),
      message: 'Simulation updated successfully'
    });
    
  } catch (err) {
    logControllerError('Error updating simulation', err, err?.errors);
    res.status(500).json({ 
      error: 'Failed to update simulation', 
      details: err.message,
      validationErrors: err.errors ? Object.keys(err.errors).map(key => ({
        field: key,
        message: err.errors[key].message
      })) : undefined
    });
  }
};


