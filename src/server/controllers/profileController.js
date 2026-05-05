const User = require('../models/User');
const CareerPath = require('../models/CareerPath');
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
const { enrichCareerPathWithHybridScores } = require('../services/scoring/careerPathScorer');
const { generateStepId, mapPrioritizedListCategoryToStepCategory } = require('../utils/stepId');
const { buildSavedCareerStepKey } = require('../utils/savedCareerStepIdentity');
const { generatePrioritizedListsPhase2 } = require('../services/simulation/prioritizedListGenerator');
const { getEnrichedSimulationInputs } = require('../services/documents/profileEnrichmentService');
const {
  ensureUserIdentityEmbeddingCachedByUserId,
  refreshUserIdentityEmbeddingOnUserDocument,
  normalizeUserIdentityAnswers,
  USER_IDENTITY_ANSWER_KEYS,
  topicsStringToInterestTokens,
  mergeProfileIdentityAnswers,
} = require('../services/embedding/userIdentityEmbeddingTextService');
const {
  mergeCvExtractLocalizationPatch,
  overlayIdentityAnswersWithCvLocalization,
  overlayStructuredUserInfoListsWithCvLocalization,
  syncCvExtractUserIdentityFromFlat,
} = require('../services/documents/cvExtractLocalization');
const { inferIscoFromDomains, ISCO_CODE_PATTERN } = require('../services/embedding/userOccupationInference');
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
const { generateCareerSlogan } = require('../services/jobAnalysis/careerSloganGenerator');
const { evaluateProfileReviewFollowUps } = require('../services/jobAnalysis/inputQualityDiagnosisService');
const { applyLocalizedFieldsToCareerPathList, applyLocalizedFieldsToCareerPathPayload } = require('../utils/localizedResponse');
const { mergeLocalizedCareerPathStep } = require('../services/careerPathSkillService');
const localizedContentService = require('../services/localization/localizedContentService');
const { cachedTranslate } = require('../services/ai/translationCache');
const { translateStructured } = require('../services/ai/translateStructured');
const { getOrCreateRoleFitExplanation } = require('../services/roleFitExplanation/getOrCreateRoleFitExplanation');
const FIXED_MAX_SAVED_SIMULATIONS = 20;

function logControllerError(context, err, extra = undefined) {
  const payload = {
    message: err?.message || String(err),
    stack: err?.stack,
  };
  if (extra !== undefined) payload.extra = extra;
  console.error(`[profileController] ${context}`, payload);
}

function normalizeStringArray(arr = []) {
  return Array.isArray(arr)
    ? arr.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
    : [];
}

function normalizeDisplayStringArray(arr = []) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (!item || typeof item !== 'object') return '';
      const candidate =
        item.label ??
        item.title ??
        item.name ??
        item.preferredLabel ??
        item.value ??
        item.key;
      return typeof candidate === 'string' ? candidate.trim() : '';
    })
    .filter(Boolean);
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
      .select({ escoId: 1, mergedFromEscoIds: 1, title: 1, description: 1, keyResponsibilities: 1, keyResponsibilitiesDe: 1 })
      .lean();
    for (const d of fromEsco) {
      addDocToEscoMap(d);
    }
  }
  if (mongoIds.length > 0) {
    const fromId = await CareerPath.find({ _id: { $in: mongoIds } })
      .select({ _id: 1, escoId: 1, mergedFromEscoIds: 1, title: 1, description: 1, keyResponsibilities: 1, keyResponsibilitiesDe: 1 })
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

/**
 * Drag-and-rank row: mirrors `row.title` from `row.step` on the client; localize `step` and keep `title` in sync.
 */
async function localizeRankedEvaluationRow(row, language, careerPathMaps) {
  if (!row || typeof row !== 'object') return row;
  const step = row.step;
  if (!step || typeof step !== 'object') return row;
  const locStep = await localizeOneCareerPathShapedStep(step, language, careerPathMaps);
  return {
    ...row,
    step: locStep,
    title: locStep.title != null && locStep.title !== '' ? locStep.title : row.title,
  };
}

function collectStepsFromRankedRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => r && r.step).filter((s) => s && typeof s === 'object');
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

  const evalFlow = results.evaluationFlow && typeof results.evaluationFlow === 'object' ? results.evaluationFlow : null;
  const efNextRaw = evalFlow && Array.isArray(evalFlow.nextSteps) ? evalFlow.nextSteps : [];
  const efOutsideRaw = evalFlow && Array.isArray(evalFlow.outsideTheBox) ? evalFlow.outsideTheBox : [];
  const rankedNextSource = evalFlow?.ranked?.nextSteps;
  const rankedOutsideSource = evalFlow?.ranked?.outsideTheBox;
  const rankedNextRows = Array.isArray(rankedNextSource) ? rankedNextSource : [];
  const rankedOutsideRows = Array.isArray(rankedOutsideSource) ? rankedOutsideSource : [];

  const allStepsForCareerPath = [
    ...nextRaw,
    ...outsideRaw,
    ...prioritizedNextRaw,
    ...prioritizedOutsideRaw,
    ...efNextRaw,
    ...efOutsideRaw,
    ...collectStepsFromRankedRows(rankedNextRows),
    ...collectStepsFromRankedRows(rankedOutsideRows),
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
    const locEfNext = await Promise.all(
      efNextRaw.map((s) => localizeOneCareerPathShapedStep(s, normalizedLanguage, careerPathMaps))
    );
    const locEfOutside = await Promise.all(
      efOutsideRaw.map((s) => localizeOneCareerPathShapedStep(s, normalizedLanguage, careerPathMaps))
    );
    const locRankedNext = Array.isArray(rankedNextSource)
      ? await Promise.all(
          rankedNextRows.map((row) => localizeRankedEvaluationRow(row, normalizedLanguage, careerPathMaps))
        )
      : rankedNextSource;
    const locRankedOutside = Array.isArray(rankedOutsideSource)
      ? await Promise.all(
          rankedOutsideRows.map((row) => localizeRankedEvaluationRow(row, normalizedLanguage, careerPathMaps))
        )
      : rankedOutsideSource;

    localizedEvalFlow = {
      ...evalFlow,
      nextSteps: locEfNext,
      outsideTheBox: locEfOutside,
      ranked: {
        ...(evalFlow.ranked && typeof evalFlow.ranked === 'object' ? evalFlow.ranked : {}),
        nextSteps: locRankedNext,
        outsideTheBox: locRankedOutside,
      },
    };
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

async function localizeSavedCareerSteps(savedSteps = [], language) {
  if (!Array.isArray(savedSteps) || savedSteps.length === 0) return savedSteps;
  const lang = language || 'en';
  const plainSteps = savedSteps.map(plainSavedCareerStepSubdoc);
  const careerPathMaps = await buildCareerPathDocMapsForSteps(plainSteps);
  const localized = await Promise.all(
    plainSteps.map((step) => localizeOneCareerPathShapedStep(step, lang, careerPathMaps))
  );
  return localized.map((step) => {
    const withDisplay = ensureSavedStepDisplayFields(step);
    // Always recompute on response so legacy keys with old category labels normalize consistently.
    withDisplay.savedKey = buildSavedCareerStepKey(withDisplay);
    return withDisplay;
  });
}

/** Decode :stepId once when the client sent an encoded segment (Express usually decodes once; this covers drift). */
function decodeStepIdParam(paramStepId) {
  if (paramStepId == null || paramStepId === '') return '';
  const s = String(paramStepId);
  try {
    const once = decodeURIComponent(s);
    return once !== s ? once : s;
  } catch {
    return s;
  }
}

/**
 * Match a route :stepId to a stored subdocument (exact + single decode fallback).
 * @returns {number} index in user.savedCareerSteps, or -1
 */
function findSavedCareerStepIndex(user, paramStepId) {
  const list = user?.savedCareerSteps;
  if (!Array.isArray(list) || list.length === 0) return -1;
  const raw = String(paramStepId || '');
  const candidates = new Set([raw, decodeStepIdParam(raw)].filter(Boolean));
  for (const c of candidates) {
    const idx = list.findIndex((step) => step && step.stepId === c);
    if (idx !== -1) return idx;
  }
  return -1;
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
  return {
    ...simulationData,
    careerGoal: localizedContentService.normalizeForResponse(simulationData.careerGoal, language) || '',
  };
}

/**
 * Plain POJO for saved career step subdocs so `getLocalizedFieldLenient` and spreads see { en, de }.
 * Raw Mongoose subdocs often fail to enumerate nested i18n on `{ ...sub }` / JSON, yielding empty strings.
 */
function plainSavedCareerStepSubdoc(step) {
  if (step == null) return step;
  if (typeof step.toObject === 'function') {
    try {
      return step.toObject({ flattenMaps: true, depopulate: true, virtuals: false });
    } catch (e) {
      return { ...step };
    }
  }
  if (typeof step === 'object' && !Array.isArray(step)) {
    return { ...step };
  }
  return step;
}

/**
 * If localization still left empty display strings, fill from esco / stepId (never send blank cards).
 */
function ensureSavedStepDisplayFields(step) {
  if (step == null || typeof step !== 'object' || Array.isArray(step)) return step;
  const out = { ...step };
  const t = out.title;
  const titleEmpty =
    t == null ||
    t === '' ||
    (typeof t === 'string' && !t.trim()) ||
    (typeof t === 'object' && !Array.isArray(t) && !Object.values(t).some((v) => v != null && String(v).trim() !== ''));
  if (titleEmpty) {
    if (out.escoId && String(out.escoId).trim()) {
      out.title = String(out.escoId).trim();
    } else if (out.stepId && String(out.stepId).trim()) {
      out.title = String(out.stepId)
        .split('-')
        .filter((p) => p && /[a-zA-Z]/.test(p))
        .join(' ')
        .trim() || String(out.stepId).trim();
    } else {
      out.title = 'Career step';
    }
  }
  return out;
}

const { filterIndustryDomainRawItems } = require('../constants/industryDomainFilters');
const { normalizeSavedStepI18n } = require('../utils/savedStepI18n');
const { applyCareerPathAndUserLocaleToSavedStep } = require('../utils/savedCareerStepI18nMerge');

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

async function ensureBilingualWhoAreYouSummaryField(existingField, canonicalSummaryText, canonicalLanguage, localizedMap = {}) {
  const canonicalLang = normalizeLangCode(canonicalLanguage, 'en');
  const canonicalArray = parseWhoAreYouNarratives(canonicalSummaryText);
  let field = hydrateLocalizedSummaryField(existingField, canonicalSummaryText, canonicalLang, localizedMap);
  for (const lang of SUPPORTED_NARRATIVE_LANGS) {
    if (lang === canonicalLang) continue;
    const existingRaw = String(localizedContentService.get(field, lang) || '').trim();
    if (existingRaw) continue;
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
  if (value && typeof value === 'object') {
    const summary = localizedContentService.get(value.summary_text, normalizeLangCode(language, 'en'));
    if (typeof summary === 'string') return summary.trim();
  }
  return '';
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

async function toNarrativeDimension(
  value,
  label,
  { forceRegenerate = false, language = 'en', sourceLanguage = 'en' } = {}
) {
  const targetLang = normalizeLangCode(language, 'en');
  const sourceLang = normalizeLangCode(sourceLanguage, 'en');
  const rawItems = readDimensionRawItems(value);
  const existingSummary = readDimensionSummaryText(value, sourceLang);
  let summaryText = (!forceRegenerate && existingSummary)
    ? existingSummary
    : '';
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
  { forceRegenerate = false, language = 'en', sourceLanguage = 'en' } = {}
) {
  const targetLang = normalizeLangCode(language, 'en');
  const sourceLang = normalizeLangCode(sourceLanguage, 'en');
  const input = structuredInfo && typeof structuredInfo === 'object' ? structuredInfo : {};
  const pairs = await Promise.all(
    STRUCTURED_DIMENSIONS.map(async (dimension) => {
      const originalSource = input[dimension.key];
      let source = originalSource;
      let domainSanitized = false;
      if (dimension.key === 'domains') {
        const before = readDimensionRawItems(originalSource);
        const after = filterIndustryDomainRawItems(before);
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
  const excludedDerivedInferredIscoCodes = Array.isArray(input.excludedDerivedInferredIscoCodes)
    ? [...new Set(
      input.excludedDerivedInferredIscoCodes
        .map((code) => String(code || '').trim())
        .filter((code) => ISCO_CODE_PATTERN.test(code))
    )]
    : [];
  normalized.excludedDerivedInferredIscoCodes = excludedDerivedInferredIscoCodes;
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

async function normalizeWhoAreYouForStorage(
  profile = {},
  { forceRegenerate = false, language = 'en', sourceLanguage = 'en' } = {}
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
    const needsGeneration = forceRegenerate || !currentSummary || parsed.every((value) => value === WHO_ARE_YOU_PLACEHOLDER);
    if (needsGeneration) {
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
    }
    const needsIdentityGeneration = forceRegenerate || !currentIdentityEmbeddingText;
    if (needsIdentityGeneration) {
      identityEmbeddingText = await generateWhoAreYouIdentityEmbeddingText(rawAnswers);
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

function resolveSkillDomainsFromStructuredInfo(structuredInfo = {}) {
  return readDimensionRawItems(structuredInfo.skillDomains);
}

function resolveExcludedDerivedInferredIscoCodes(structuredInfo = {}) {
  if (!Array.isArray(structuredInfo?.excludedDerivedInferredIscoCodes)) return [];
  return [...new Set(
    structuredInfo.excludedDerivedInferredIscoCodes
      .map((code) => String(code || '').trim())
      .filter((code) => ISCO_CODE_PATTERN.test(code))
  )];
}

async function deriveInferredIscoFromStructuredInfo(structuredInfo = {}, fallbackStructuredInfo = {}) {
  const primaryDomains = resolveDomainsFromStructuredInfo(structuredInfo);
  const fallbackDomains = resolveDomainsFromStructuredInfo(fallbackStructuredInfo);
  const domains = primaryDomains.length > 0 ? primaryDomains : fallbackDomains;
  if (domains.length === 0) return [];
  const inferred = await inferIscoFromDomains(domains, { method: 'rule_based' });
  const excludedCodes = new Set(resolveExcludedDerivedInferredIscoCodes(structuredInfo));
  return (Array.isArray(inferred?.inferred) ? inferred.inferred : []).filter((row) => {
    const code = String(row?.code || '').trim();
    return code && !excludedCodes.has(code);
  });
}

function structuredInferredIscoInputsFingerprint(structuredInfo = {}) {
  return JSON.stringify({
    d: resolveDomainsFromStructuredInfo(structuredInfo),
    s: resolveSkillDomainsFromStructuredInfo(structuredInfo),
  });
}

async function enrichCareerSimulationInputsForClientResponse(
  careerSimulationInputs,
  profileStructured = {},
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
  const derivedInferredIsco =
    options.reuseProfileDerivedInferredIsco !== undefined
      ? options.reuseProfileDerivedInferredIsco
      : await deriveInferredIscoFromStructuredInfo(csiStructured, profileStructured);
  plain.structuredUserInfo = {
    ...csiStructured,
    derivedInferredIsco,
  };
  plain.structuredUserInfo = normalizeLocalizedProfileFieldsForResponse(
    { structuredUserInfo: plain.structuredUserInfo },
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

  const structured = profile.structuredUserInfo && typeof profile.structuredUserInfo === 'object'
    ? profile.structuredUserInfo
    : {};

  const narrativeSourceLang = resolveNarrativeSourceLanguage(profile, 'en');
  const { normalized } = await normalizeStructuredUserInfoForStorage(structured, {
    forceRegenerate: false,
    language: narrativeSourceLang,
    sourceLanguage: narrativeSourceLang,
  });
  inputs.structuredUserInfo = normalized;
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

// Career simulation: hybrid scoring + Phase 2 prioritized lists (no 6-dim path scorer)
exports.runSimulation = async (req, res) => {
  try {
    res.setTimeout(180000); // 3 minutes for embedding + scoring

    const userId = req.user && (req.user.id || req.user.userId);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Fetch user profile
    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const completionBreakdown = computeProfileCompletion(user.profile);
    if (completionBreakdown.overall < MIN_SIMULATION_PROFILE_COMPLETION_PCT) {
      return res.status(403).json({
        success: false,
        message: `Your profile is ${completionBreakdown.overall}% complete. Complete at least ${MIN_SIMULATION_PROFILE_COMPLETION_PCT}% of your profile to run a simulation.`,
        profileCompletion: completionBreakdown.overall,
        completion: completionBreakdown,
        minRequired: MIN_SIMULATION_PROFILE_COMPLETION_PCT,
      });
    }
    const completion = completionBreakdown.overall;

    const profile = user.profile || {};
    // Deterministic IDs require a stable simulationId generated server-side.
    const simulationId = crypto.randomUUID();

    // Use career simulation inputs as primary source for matching
    const careerInputs = profile.careerSimulationInputs || {};

    // If inputs are missing/empty (common when profile was edited but inputs not recalculated),
    // compute them on the fly so we can actually match against the user's profile.
    const hasAnyCareerInputs =
      readDimensionRawItems(careerInputs.structuredUserInfo?.skills).length > 0 ||
      readDimensionRawItems(careerInputs.structuredUserInfo?.keyResponsibilities).length > 0 ||
      resolveDomainsFromStructuredInfo(careerInputs.structuredUserInfo || {}).length > 0;

    const computedInputs = (!careerInputs.isManuallyEdited && !hasAnyCareerInputs)
      ? await calculateCareerSimulationInputs(profile)
      : null;

    const activeInputs = computedInputs || careerInputs;

    // Phase 3: Enrich simulation inputs from uploaded documents (CV/resume/LinkedIn PDF).
    // This is additive: it merges signals into activeInputs and caches extraction on the user.
    let enrichment = null;
    let enrichedInputs = activeInputs;
    try {
      const enrichmentResult = await getEnrichedSimulationInputs({
        userId,
        baseInputs: activeInputs,
        force: false
      });
      enrichedInputs = enrichmentResult.inputs || activeInputs;
      enrichment = enrichmentResult.enrichment || null;
    } catch (e) {
      console.warn('Document enrichment failed (non-fatal):', e.message);
    }

    // Opportunistically persist computed inputs for future runs (but don't override manual edits)
    if (computedInputs) {
      try {
        await User.findByIdAndUpdate(userId, {
          $set: {
            'profile.careerSimulationInputs': {
              ...computedInputs,
              isManuallyEdited: false
            }
          }
        });
      } catch (e) {
        // Non-fatal: simulation can continue even if we can't persist.
        console.warn('Failed to persist computed careerSimulationInputs:', e.message);
      }
    }

    try {
      const identityCache = await ensureUserIdentityEmbeddingCachedByUserId(userId);
      if (identityCache && enrichedInputs && typeof enrichedInputs === 'object') {
        enrichedInputs.embeddingOptimizedUserIdentityText = identityCache.text;
        enrichedInputs.embeddingUserIdentitySourceFingerprint = identityCache.fingerprint;
      }
    } catch (e) {
      console.warn('User identity embedding cache failed (non-fatal):', e.message);
    }

    const userSkills = readDimensionRawItems(enrichedInputs.structuredUserInfo?.skills);
    const userSkillsInDevelopment = readDimensionRawItems(enrichedInputs.structuredUserInfo?.skillsInDevelopment);
    const userSkillNames = userSkills.map(s => s.toLowerCase());

    // Also include other relevant data from career simulation inputs
    const userWorkExperience = readDimensionRawItems(enrichedInputs.structuredUserInfo?.keyResponsibilities).length > 0
      ? [{ title: 'What are you good at?', keyResponsibilities: readDimensionRawItems(enrichedInputs.structuredUserInfo?.keyResponsibilities) }]
      : [];
    const userEducation = {};
    const userSkillDomains = readDimensionRawItems(enrichedInputs.structuredUserInfo?.skillDomains);
    const rawDomains = readDimensionRawItems(enrichedInputs.structuredUserInfo?.domains);
    const derivedInferredIsco = Array.isArray(enrichedInputs.structuredUserInfo?.derivedInferredIsco)
      ? enrichedInputs.structuredUserInfo.derivedInferredIsco
      : (Array.isArray(profile.structuredUserInfo?.derivedInferredIsco) ? profile.structuredUserInfo.derivedInferredIsco : []);
    const userCareerPreferences = {
      domains: rawDomains,
      derivedInferredIsco
    };
    const mergedIdentityAnswers = normalizeUserIdentityAnswers({
      ...(profile.userIdentityAnswers && typeof profile.userIdentityAnswers === 'object' ? profile.userIdentityAnswers : {}),
      ...(enrichedInputs.userIdentity && typeof enrichedInputs.userIdentity === 'object' ? enrichedInputs.userIdentity : {}),
    });
    const userInterests = topicsStringToInterestTokens(mergedIdentityAnswers.topicsIndustriesInterest);

    // Identity and seniority: prefer merged simulation identity answers, optional request body goal for this run
    const bio =
      mergedIdentityAnswers.workEnjoyMost ||
      (profile.personalInfo?.bio ? String(profile.personalInfo.bio).trim() : '');
    const rawCareerGoal =
      mergedIdentityAnswers.workingLifeAchievement ||
      (req.body?.careerGoal ? String(req.body.careerGoal).trim() : null) ||
      null;
    const careerGoalResult = await generateCareerSlogan(rawCareerGoal || '', {
      lang: req.language,
      returnBundle: true,
    });
    const careerGoal = careerGoalResult.canonical;
    const localizedCareerGoal = careerGoalResult.localized?.[req.language] || '';
    const seniorityInputs = enrichedInputs.seniority && typeof enrichedInputs.seniority === 'object' ? enrichedInputs.seniority : {};
    const currentStatus = seniorityInputs.currentStatus ?? profile.seniority?.currentStatus ?? '';
    const yearsOfExperience = seniorityInputs.yearsOfExperience != null ? seniorityInputs.yearsOfExperience : profile.seniority?.yearsOfExperience;
    const highestDegree = seniorityInputs.highestDegree ?? profile.seniority?.highestDegree ?? '';
    const mostSeniorWorkExperience = seniorityInputs.mostSeniorWorkExperience ?? profile.seniority?.mostSeniorWorkExperience ?? '';
    const dateOfBirth = profile.personalInfo?.dateOfBirth ?? enrichedInputs.dateOfBirth ?? null;

    const normalizeSkillKey = (value) => {
      if (!value) return '';
      return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    };

    // Fetch cached career paths.
    // Data quality + relevance: first try a targeted pull using normalized requiredSkillKeys.
    const escoService = require('../services/escoService');

    const userSkillKeys = userSkills.map(normalizeSkillKey).filter(Boolean);
    const picked = [];
    const seen = new Set();

    if (userSkillKeys.length > 0) {
      const skillMatched = await escoService.getCachedCareerPaths(
        { requiredSkillKeys: { $in: userSkillKeys } },
        { limit: 2000 }
      );
      for (const cp of skillMatched) {
        const id = cp.escoId || cp._id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        picked.push(cp);
      }
    }

    // Fallback/coverage: add more occupations so the sim still works for sparse profiles.
    if (picked.length < 500) {
      const extra = await escoService.getCachedCareerPaths({}, { limit: 2000 });
      for (const cp of extra) {
        const id = cp.escoId || cp._id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        picked.push(cp);
        if (picked.length >= 2000) break;
      }
    }

    const allCareerPaths = picked;

    const userProfileForScoring = {
      userSkills,
      userSkillDomains,
      userDerivedInferredIsco: derivedInferredIsco,
      userSkillsInDevelopment,
      userWorkExperience,
      userEducation,
      userCareerPreferences,
      userInterests,
      careerGoal,
      bio,
      userIdentityAnswers: mergedIdentityAnswers,
      dateOfBirth,
      currentStatus,
      yearsOfExperience,
      highestDegree,
      mostSeniorWorkExperience,
      embeddingOptimizedUserIdentityText: enrichedInputs.embeddingOptimizedUserIdentityText,
      embeddingUserIdentitySourceFingerprint: enrichedInputs.embeddingUserIdentitySourceFingerprint,
      identityEmbeddingText: String(profile?.who_are_you?.identity_embedding_text || '').trim(),
    };

    const SCORE_CHUNK_SIZE = 150;
    const scoredPaths = [];
    for (let i = 0; i < allCareerPaths.length; i += SCORE_CHUNK_SIZE) {
      const chunk = allCareerPaths.slice(i, i + SCORE_CHUNK_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (cp, chunkIndex) => {
          const index = i + chunkIndex;
          const scored = await enrichCareerPathWithHybridScores(userProfileForScoring, cp);
          return { ...cp, ...scored };
        })
      );
      scoredPaths.push(...chunkResults);
    }

    let prioritizedListsRaw;
    try {
      prioritizedListsRaw = await generatePrioritizedListsPhase2(scoredPaths, {
        userSkills,
        userSkillDomains,
        userDerivedInferredIsco: derivedInferredIsco,
        userSkillsInDevelopment,
        userWorkExperience,
        userEducation,
        userCareerPreferences,
        userInterests,
        careerGoal,
        bio,
        userIdentityAnswers: mergedIdentityAnswers,
        dateOfBirth,
        currentStatus,
        yearsOfExperience,
        highestDegree,
        mostSeniorWorkExperience,
        embeddingOptimizedUserIdentityText: enrichedInputs.embeddingOptimizedUserIdentityText,
        embeddingUserIdentitySourceFingerprint: enrichedInputs.embeddingUserIdentitySourceFingerprint,
        identityEmbeddingText: String(profile?.who_are_you?.identity_embedding_text || '').trim(),
      }, {
        nextK: 25,
        outsideK: 25
      });
    } catch (phase2Err) {
      logControllerError('Phase 2 prioritized lists error', phase2Err);
      throw phase2Err;
    }

    // Attach deterministic server-generated step IDs (stable across saves/removals)
    const prioritizedLists = attachDeterministicStepIdsToPrioritizedLists(prioritizedListsRaw, simulationId);

    // Strip roleVectors and hybrid_vector from steps before response (client doesn't need them; avoids buffer/size issues)
    const stripVectors = (step) => {
      const { roleVectors, hybrid_vector, ...rest } = step;
      return rest;
    };
    const nextRolesRaw = prioritizedLists.nextCareerRoles.map(stripVectors);
    const outsideRolesRaw = prioritizedLists.outsideTheBoxRoles.map(stripVectors);
    const responseLanguage = req.language;
    const careerPathMaps = await buildCareerPathDocMapsForSteps([...nextRolesRaw, ...outsideRolesRaw]);
    const nextRolesForResponse = await Promise.all(
      nextRolesRaw.map((s) => localizeOneCareerPathShapedStep(s, responseLanguage, careerPathMaps))
    );
    const outsideRolesForResponse = await Promise.all(
      outsideRolesRaw.map((s) => localizeOneCareerPathShapedStep(s, responseLanguage, careerPathMaps))
    );

    // Initial display: top 10 per category (client handles evaluation UX; lists stay full for ranking context)
    const nextSteps = nextRolesForResponse.slice(0, 10).map((item) => ({
      ...item,
      listCategory: 'nextCareerRoles',
      category: 'nextSteps'
    }));

    const outsideTheBox = outsideRolesForResponse.slice(0, 10).map((item) => ({
      ...item,
      listCategory: 'outsideTheBoxRoles',
      category: 'outsideTheBox'
    }));

    const results = {
      simulationId,
      algorithmVersion: ALGORITHM_VERSION,
      scoringVersion: SCORING_VERSION,
      profileEnrichment: enrichment || undefined,
      embeddingProvider: 'openai',
      embeddingVersion: '1',
      nextSteps,
      outsideTheBox,
      furtherAdvice: [
        { 
          id: `advice-${simulationId}-0`,
          title: 'Career Development Advice',
          advice: 'Keep learning and updating your skills to stay relevant.' 
        }
      ],
      // Store the complete prioritized lists for future use (without roleVectors to avoid size/buffer issues)
      prioritizedLists: {
        nextCareerRoles: nextRolesForResponse,
        outsideTheBoxRoles: outsideRolesForResponse
      },
      prioritizedListTotals: {
        nextCareerRoles: nextRolesForResponse.length,
        outsideTheBoxRoles: outsideRolesForResponse.length
      },
      // Track current positions in each list (legacy remove/replace endpoints; aligned with 10 visible roles)
      currentPositions: {
        nextCareerRoles: 10,
        outsideTheBoxRoles: 10
      }
    };

    // Save simulation results to user
    await User.findByIdAndUpdate(userId, {
      $set: {
        lastSimulationResult: {
          results,
          selectedGoal: (() => {
            let field = localizedContentService.set(null, 'en', careerGoal || '');
            if (localizedCareerGoal && req.language !== 'en') {
              field = localizedContentService.set(field, req.language, localizedCareerGoal);
            }
            return field;
          })(),
          date: new Date()
        }
      }
    });

    return res.json({
      success: true,
      results,
      careerGoal: localizedCareerGoal || careerGoal || '',
      profileCompletion: completion,
    });
  } catch (err) {
    logControllerError('Simulation error', err);
    const message = err.message || 'Simulation failed.';
    const isDev = process.env.NODE_ENV !== 'production';
    return res.status(500).json({
      success: false,
      message: 'Simulation failed.',
      error: message,
      ...(isDev && { stack: err.stack }),
    });
  }
};

// New endpoint: get last simulation result for logged-in user
exports.getLastSimulationResult = async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const user = await User.findById(userId);
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
      selectedGoal: localizedContentService.normalizeForResponse(user.lastSimulationResult.selectedGoal, req.language) || '',
      date: user.lastSimulationResult.date
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch last simulation result.', error: err.message });
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
    try {
      await refreshUserIdentityEmbeddingOnUserDocument(user, {
        forceRegenerate: true,
        reuseWhoAreYouText: false,
      });
    } catch (e) {
      console.warn('refreshUserIdentityEmbeddingOnUserDocument failed (non-fatal):', e.message);
    }
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

// Recalculate career simulation inputs from profile data
exports.recalculateCareerSimulationInputs = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has manual edits
    const hasManualEdits = user.profile.careerSimulationInputs?.isManuallyEdited || false;
    
    // Calculate new inputs from current profile
    const newInputs = await calculateCareerSimulationInputs(user.profile);
    
    // Update the career simulation inputs
    user.profile.careerSimulationInputs = {
      ...newInputs,
      isManuallyEdited: false, // Reset manual edit flag
      lastCalculated: new Date(),
      editHistory: [
        ...(user.profile.careerSimulationInputs?.editHistory || []),
        {
          editedAt: new Date(),
          editor: req.user.userId,
          changes: { recalculated: true }
        }
      ]
    };
    
    await user.save();
    try {
      await refreshUserIdentityEmbeddingOnUserDocument(user, {
        forceRegenerate: true,
        reuseWhoAreYouText: false,
      });
    } catch (e) {
      console.warn('refreshUserIdentityEmbeddingOnUserDocument failed (non-fatal):', e.message);
    }
    const profileStructured = user.profile.structuredUserInfo || {};
    res.json({
      success: true,
      careerSimulationInputs: await enrichCareerSimulationInputsForClientResponse(
        user.profile.careerSimulationInputs,
        profileStructured,
        { language: req.language }
      ),
      wasRecalculated: true,
      hadManualEdits: hasManualEdits,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to recalculate career simulation inputs', details: err.message });
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

// Get saved career steps for logged-in user
exports.getSavedCareerSteps = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const savedSteps = await localizeSavedCareerSteps(
      user.savedCareerSteps || [],
      req.language
    );
    res.json({ success: true, savedCareerSteps: savedSteps });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch saved career steps', details: err.message });
  }
};

// Get specific saved career step
exports.getSavedCareerStep = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { stepId } = req.params;
    if (!stepId) {
      return res.status(400).json({ error: 'Step ID is required' });
    }
    
    // Saved career steps are keyed by step.stepId (not step.id)
    const stepIdx = findSavedCareerStepIndex(user, stepId);
    const step = stepIdx >= 0 ? user.savedCareerSteps[stepIdx] : null;
    if (!step) {
      return res.status(404).json({ error: 'Career step not found' });
    }
    
    const [localizedStep] = await localizeSavedCareerSteps([step], req.language);
    res.json({ success: true, savedCareerStep: localizedStep || step });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch career step', details: err.message });
  }
};

const normalizeSavedStepUserEvaluation = (raw) => {
  if (raw == null || raw === '') return undefined;
  const v = String(raw).toLowerCase();
  if (v === 'keep' || v === 'skip' || v === 'dislike') return v;
  return undefined;
};

// Save career step
exports.saveCareerStep = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      logControllerError('User not found', new Error('User not found for ID'), { userId: req.user.userId });
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Accept data directly from request body (frontend sends it this way)
    const { stepId, title, description, matchedProfileInputs, simulationResultId,
            requiredSkills, altTitles, hiddenTitles, seniority, keyResponsibilities, skillDomains, skillModel,
            listCategory, category, hybridScoreNextRole, hybridScoreOutOfTheBox, userEvaluation, escoId, careerPathId, _id } = req.body;
    
    // Validate input data
    const validation = require('../utils/duplicateDetection').validateStepData({
      stepId,
      title,
      description
    });
    
    if (!validation.isValid) {
      logControllerError('Validation errors', new Error('Invalid input data'), validation.errors);
      return res.status(400).json({ 
        error: 'Invalid input data', 
        details: validation.errors 
      });
    }
    
    let titleDesc;
    try {
      titleDesc = normalizeSavedStepI18n(title, description, {
        sourceLanguage: req.language || 'en',
      });
    } catch (e) {
      return res.status(400).json({ error: e.message || 'Invalid title/description' });
    }

    // Prepare new step data
    const newStep = {
      stepId,
      title: titleDesc.title,
      description: titleDesc.description,
      matchedProfileInputs: matchedProfileInputs || [],
      simulationResultId: simulationResultId || '',
      savedAt: new Date(),
      escoId: typeof escoId === 'string' && escoId.trim() ? escoId.trim() : undefined,
      careerPathId: careerPathId || _id || undefined,
      // Enrichment fields (optional)
      requiredSkills: normalizeDisplayStringArray(requiredSkills),
      altTitles: normalizeDisplayStringArray(altTitles),
      hiddenTitles: normalizeDisplayStringArray(hiddenTitles),
      seniority: seniority || null,
      keyResponsibilities: keyResponsibilities || null,
      skillDomains: skillDomains || null,
      skillModel: skillModel || null
    };

    const categoryForStorage = listCategory != null && String(listCategory).trim() !== ''
      ? String(listCategory).trim()
      : (category != null && String(category).trim() !== '' ? String(category).trim() : '');
    if (categoryForStorage) {
      newStep.listCategory = categoryForStorage;
    }
    if (typeof hybridScoreNextRole === 'number' && Number.isFinite(hybridScoreNextRole)) {
      newStep.hybridScoreNextRole = hybridScoreNextRole;
    }
    if (typeof hybridScoreOutOfTheBox === 'number' && Number.isFinite(hybridScoreOutOfTheBox)) {
      newStep.hybridScoreOutOfTheBox = hybridScoreOutOfTheBox;
    }

    const evalNorm = normalizeSavedStepUserEvaluation(userEvaluation);
    if (evalNorm) {
      newStep.userEvaluation = evalNorm;
    }

    await applyCareerPathAndUserLocaleToSavedStep(newStep, {
      rawTitle: title,
      rawDescription: description,
      sourceLanguage: req.language || 'en',
    });
    newStep.savedKey = buildSavedCareerStepKey(newStep);
    
    // Enhanced duplicate detection using multi-level checking
    const { detectDuplicates, getDuplicateMessage } = require('../utils/duplicateDetection');
    const duplicateResult = detectDuplicates(newStep, user.savedCareerSteps);
    
    if (duplicateResult.hasDuplicate) {
      const message = getDuplicateMessage(duplicateResult);
      const savedLocalized = await localizeSavedCareerSteps(
        user.savedCareerSteps || [],
        req.language
      );
      return res.status(409).json({
        success: false,
        message: message,
        duplicateType: duplicateResult.duplicateType,
        existingStep: duplicateResult.existingStep,
        similarity: duplicateResult.similarity,
        savedCareerSteps: savedLocalized,
      });
    }
    
    // No duplicate found, proceed with saving
    user.savedCareerSteps.push(newStep);
    await user.save();
    const savedLocalized = await localizeSavedCareerSteps(
      user.savedCareerSteps || [],
      req.language
    );
    const savedCareerStepForClient =
      savedLocalized.find((s) => s && s.stepId === newStep.stepId) || newStep;
    res.json({ 
      success: true, 
      savedCareerStep: savedCareerStepForClient,
      savedCareerSteps: savedLocalized 
    });
  } catch (err) {
    logControllerError('Error saving career step', err);
    res.status(500).json({ error: 'Failed to save career step', details: err.message });
  }
};

// Delete saved career step
exports.deleteSavedCareerStep = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      logControllerError('User not found', new Error('User not found for ID'), { userId: req.user.userId });
      return res.status(404).json({ error: 'User not found' });
    }
    
    const { stepId } = req.params;
    if (!stepId) {
      logControllerError('Missing required parameter', new Error('No stepId provided in params'));
      return res.status(400).json({ error: 'Step ID is required' });
    }
    
    // Fix: Look for step.stepId instead of step.id (tolerate encoding drift vs stored key)
    const stepIndex = findSavedCareerStepIndex(user, stepId);
    
    if (stepIndex === -1) {
      logControllerError('Career step not found', new Error('Career step not found with stepId'), { stepId });
      return res.status(404).json({ error: 'Career step not found' });
    }

    user.savedCareerSteps.splice(stepIndex, 1);
    await user.save();
    const savedLocalized = await localizeSavedCareerSteps(
      user.savedCareerSteps || [],
      req.language
    );
    // Return the updated list of saved career steps so frontend can update its state
    res.json({ 
      success: true, 
      message: 'Career step deleted successfully',
      savedCareerSteps: savedLocalized
    });
  } catch (err) {
    logControllerError('Error deleting career step', err);
    res.status(500).json({ error: 'Failed to delete career step', details: err.message });
  }
};

// Bulk delete saved career steps (atomic pull by stepId set)
exports.bulkDeleteSavedCareerSteps = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const incomingStepIds = Array.isArray(req.body?.stepIds) ? req.body.stepIds : [];
    const stepIds = [...new Set(
      incomingStepIds
        .map((id) => (id == null ? '' : String(id).trim()))
        .filter(Boolean)
        .map((id) => decodeStepIdParam(id))
    )];

    if (stepIds.length === 0) {
      return res.status(400).json({ error: 'stepIds must be a non-empty array of step IDs' });
    }

    const user = await User.findById(userId).select('savedCareerSteps');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existingStepIds = new Set(
      (user.savedCareerSteps || [])
        .map((step) => (step?.stepId == null ? '' : String(step.stepId)))
        .filter(Boolean)
    );
    const matchedStepIds = stepIds.filter((id) => existingStepIds.has(id));
    const notFoundStepIds = stepIds.filter((id) => !existingStepIds.has(id));

    if (matchedStepIds.length > 0) {
      await User.updateOne(
        { _id: userId },
        { $pull: { savedCareerSteps: { stepId: { $in: matchedStepIds } } } }
      );
    }

    const refreshed = await User.findById(userId).select('savedCareerSteps');
    const savedLocalized = await localizeSavedCareerSteps(
      refreshed?.savedCareerSteps || [],
      req.language
    );

    return res.json({
      success: true,
      requestedCount: stepIds.length,
      removedCount: matchedStepIds.length,
      notFoundStepIds,
      savedCareerSteps: savedLocalized,
    });
  } catch (err) {
    logControllerError('Error bulk deleting saved career steps', err);
    return res.status(500).json({ error: 'Failed to bulk delete career steps', details: err.message });
  }
};

// Update Keep / Skip / Dislike on a saved career step (null clears to unrated)
exports.patchSavedCareerStep = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { stepId } = req.params;
    if (!stepId) {
      return res.status(400).json({ error: 'Step ID is required' });
    }
    if (!Object.prototype.hasOwnProperty.call(req.body, 'userEvaluation')) {
      return res.status(400).json({ error: 'userEvaluation is required (use null to clear)' });
    }

    const user = await User.findById(userId).select('savedCareerSteps');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const stepIdx = findSavedCareerStepIndex(user, stepId);
    if (stepIdx === -1) {
      return res.status(404).json({ error: 'Career step not found' });
    }
    const actualStepId = user.savedCareerSteps[stepIdx].stepId;

    const raw = req.body.userEvaluation;
    const filter = { _id: userId };
    const arrayOpts = { arrayFilters: [{ 's.stepId': actualStepId }] };

    if (raw === null || raw === '') {
      await User.updateOne(
        filter,
        { $unset: { 'savedCareerSteps.$[s].userEvaluation': '' } },
        arrayOpts
      );
    } else {
      const evalNorm = normalizeSavedStepUserEvaluation(raw);
      if (!evalNorm) {
        return res.status(400).json({ error: 'userEvaluation must be keep, skip, dislike, or null' });
      }
      await User.updateOne(
        filter,
        { $set: { 'savedCareerSteps.$[s].userEvaluation': evalNorm } },
        arrayOpts
      );
    }

    const refreshed = await User.findById(userId);
    const savedLocalized = await localizeSavedCareerSteps(
      refreshed?.savedCareerSteps || [],
      req.language
    );
    res.json({
      success: true,
      savedCareerSteps: savedLocalized,
    });
  } catch (err) {
    logControllerError('Error patching saved career step', err);
    res.status(500).json({ error: 'Failed to update career step', details: err.message });
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
    const { name, results, careerGoal, profileCompletion } = req.body;
    
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
      careerGoal: localizedContentService.set(null, 'en', careerGoal || ''),
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
        careerGoal: localizedContentService.set(
          user.simulationResults[existingIndex].careerGoal,
          'en',
          careerGoal || ''
        ),
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
    // Unsaved "last run" is now persisted as a saved simulation; clear so /simulation/results
    // and nav do not treat an ephemeral last run as still active.
    user.lastSimulationResult = undefined;
    try {
      await user.save();
    } catch (saveError) {
      logControllerError('Save simulation validation error', saveError, saveError?.errors);
      throw saveError;
    }
    
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
    // Exclude very large embedded arrays (multi‑MB). Keep password + other fields so read-time migrations can `save()` safely.
    const user = await User.findById(req.user.userId).select(
      '-simulationResults -savedCareerSteps -lastSimulationResult'
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    logPhase('afterFind');

    const cached = getCachedProfileResponse(user._id, user.updatedAt, req.language);
    if (cached) {
      logPhase('cacheHit');
      return res.json(cached);
    }
    logPhase('cacheMiss');

    let profileNeedsSave = false;
    const profileStructuredSource = user.profile?.structuredUserInfo || {};
    const { normalized: normalizedProfileStructured, changed: profileStructuredChanged } =
      await normalizeStructuredUserInfoForStorage(profileStructuredSource, {
        forceRegenerate: false,
        language: req.language,
        sourceLanguage: resolveNarrativeSourceLanguage(user.profile || {}, 'en'),
      });
    if (profileStructuredChanged) {
      user.profile.structuredUserInfo = normalizedProfileStructured;
      user.markModified('profile.structuredUserInfo');
      profileNeedsSave = true;
    }

    const csiStructuredSource = user.profile?.careerSimulationInputs?.structuredUserInfo || {};
    const { normalized: normalizedCsiStructured, changed: csiStructuredChanged } =
      await normalizeStructuredUserInfoForStorage(csiStructuredSource, {
        forceRegenerate: false,
        language: req.language,
        sourceLanguage: resolveNarrativeSourceLanguage(user.profile || {}, 'en'),
      });
    if (csiStructuredChanged) {
      if (!user.profile.careerSimulationInputs || typeof user.profile.careerSimulationInputs !== 'object') {
        user.profile.careerSimulationInputs = {};
      }
      user.profile.careerSimulationInputs.structuredUserInfo = normalizedCsiStructured;
      user.markModified('profile.careerSimulationInputs.structuredUserInfo');
      profileNeedsSave = true;
    }

    const { normalized: normalizedWhoAreYou, changed: whoAreYouChanged } =
      await normalizeWhoAreYouForStorage(user.profile || {}, {
        forceRegenerate: false,
        language: req.language,
        sourceLanguage: resolveNarrativeSourceLanguage(user.profile || {}, 'en'),
      });
    if (whoAreYouChanged) {
      user.profile.who_are_you = normalizedWhoAreYou;
      user.markModified('profile.who_are_you');
      profileNeedsSave = true;
    }

    if (profileNeedsSave) {
      await user.save();
    }

    const profilePayload = user.profile?.toObject ? user.profile.toObject() : { ...(user.profile || {}) };
    profilePayload.structuredUserInfo = overlayStructuredUserInfoListsWithCvLocalization(
      profilePayload.structuredUserInfo,
      profilePayload.cvExtractLocalization,
      req.language
    );
    if (profilePayload.careerSimulationInputs?.structuredUserInfo) {
      profilePayload.careerSimulationInputs = {
        ...profilePayload.careerSimulationInputs,
        structuredUserInfo: overlayStructuredUserInfoListsWithCvLocalization(
          profilePayload.careerSimulationInputs.structuredUserInfo,
          profilePayload.cvExtractLocalization,
          req.language
        ),
      };
    }

    const mergedIdentityAnswers = mergeProfileIdentityAnswers(profilePayload);
    profilePayload.userIdentity = overlayIdentityAnswersWithCvLocalization(
      mergedIdentityAnswers,
      profilePayload.cvExtractLocalization?.userIdentity,
      req.language
    );
    profilePayload.who_are_you = (
      await normalizeWhoAreYouForStorage(profilePayload, {
        forceRegenerate: false,
        language: req.language,
        sourceLanguage: resolveNarrativeSourceLanguage(profilePayload || {}, 'en'),
      })
    ).normalized;
    const profileStructured = profilePayload?.structuredUserInfo || {};
    const profileDerivedInferredIsco = await deriveInferredIscoFromStructuredInfo(profileStructured);
    profilePayload.structuredUserInfo = {
      ...profileStructured,
      derivedInferredIsco: profileDerivedInferredIsco,
    };

    if (profilePayload?.careerSimulationInputs && typeof profilePayload.careerSimulationInputs === 'object') {
      const csiStructured = profilePayload.careerSimulationInputs.structuredUserInfo || {};
      const reuseIsco =
        structuredInferredIscoInputsFingerprint(csiStructured)
        === structuredInferredIscoInputsFingerprint(profileStructured);
      profilePayload.careerSimulationInputs = await enrichCareerSimulationInputsForClientResponse(
        profilePayload.careerSimulationInputs,
        profileStructured,
        {
          reuseProfileDerivedInferredIsco: reuseIsco ? profileDerivedInferredIsco : undefined,
          language: req.language,
        }
      );
    }
    const localizedProfilePayload = normalizeLocalizedProfileFieldsForResponse(
      profilePayload,
      req.language
    );

    const responseBody = {
      success: true,
      profile: localizedProfilePayload,
      name: user.name || '',
      email: user.email,
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
 * POST body: { userIdentity?, structuredUserInfo? } — same shape as the extraction review dialog.
 * Scores only the five identity prompts plus key responsibilities and learning goals; returns
 * { followUps: [ { field, quality_score, dimension_scores, issues, follow_up_question } ] } (three lowest; does not persist).
 */
exports.diagnoseProfileInputQuality = async (req, res) => {
  try {
    const snapshot = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await evaluateProfileReviewFollowUps({
      userIdentity: snapshot.userIdentity,
      structuredUserInfo: snapshot.structuredUserInfo
    }, { lang: req.language });
    res.json({ success: true, ...result });
  } catch (err) {
    logControllerError('diagnoseProfileInputQuality', err);
    res.status(500).json({ error: 'Failed to run input quality diagnosis', details: err.message });
  }
};

/**
 * POST body: { role, language | lang, simulationScopeId?, roleContext?, debug? }
 * Returns cached or freshly generated explanation (persisted). { success, text, source, cached }.
 */
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
    const { cvExtractLocalization: incomingCvLoc, ...answersBody } = bodyRaw;

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
    Object.assign(user.profile.userIdentityAnswers, nextAnswers);
    user.markModified('profile.userIdentityAnswers');

    if (user.profile.cvExtractLocalization) {
      if (syncCvExtractUserIdentityFromFlat(user.profile.cvExtractLocalization, nextAnswers, req.language)) {
        user.markModified('profile.cvExtractLocalization');
      }
    }
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

    try {
      await refreshUserIdentityEmbeddingOnUserDocument(user);
    } catch (e) {
      console.warn('refreshUserIdentityEmbeddingOnUserDocument failed (non-fatal):', e.message);
    }

    const profileStructured = user.profile.structuredUserInfo || {};
    const responseWhoAreYou = normalizeLocalizedProfileFieldsForResponse(
      { who_are_you: user.profile.who_are_you || { raw_answers: [], summary_text: '' } },
      req.language
    ).who_are_you;
    res.json({
      success: true,
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

    const profileStructured = user.profile.structuredUserInfo || {};
    res.json({
      success: true,
      seniority: {
        currentStatus: user.profile.seniority?.currentStatus || '',
        yearsOfExperience: user.profile.seniority?.yearsOfExperience ?? null,
        highestDegree: user.profile.seniority?.highestDegree || '',
        mostSeniorWorkExperience: user.profile.seniority?.mostSeniorWorkExperience || ''
      },
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

    const { normalized: structuredUserInfo } = await normalizeStructuredUserInfoForStorage(
      structuredBodyOnly,
      {
        forceRegenerate: true,
        language: req.language,
        sourceLanguage: resolveNarrativeSourceLanguage(user.profile || {}, 'en'),
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

    try {
      await refreshUserIdentityEmbeddingOnUserDocument(user);
    } catch (e) {
      console.warn('refreshUserIdentityEmbeddingOnUserDocument failed (non-fatal):', e.message);
    }

    const profileStructured = user.profile.structuredUserInfo || {};
    const profileDerivedInferredIsco = await deriveInferredIscoFromStructuredInfo(profileStructured);
    res.json({
      success: true,
      structuredUserInfo: {
        ...profileStructured,
        derivedInferredIsco: profileDerivedInferredIsco,
      },
      careerSimulationInputs: await enrichCareerSimulationInputsForClientResponse(
        user.profile.careerSimulationInputs,
        profileStructured,
        {
          reuseProfileDerivedInferredIsco: profileDerivedInferredIsco,
          language: req.language,
        }
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
      simulationData.careerGoal = localizedContentService.normalizeForResponse(simulationData.careerGoal, req.language) || '';

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
        simulationData.careerGoal = localizedContentService.normalizeForResponse(simulationData.careerGoal, req.language) || '';
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

// Remove career step (alias for deleteSavedCareerStep)
exports.removeCareerStep = exports.deleteSavedCareerStep;

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

      } else {
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
    const incomingCareerGoal = localizedContentService.normalizeForResponse(validatedData.careerGoal, 'en') || '';
    user.simulationResults[simulationIndex] = {
      ...existingSimulation,
      ...validatedData,
      // Preserve original metadata
      name: validatedData.name || existingSimulation.name,
      careerGoal: localizedContentService.set(
        existingSimulation.careerGoal,
        'en',
        incomingCareerGoal || (localizedContentService.normalizeForResponse(existingSimulation.careerGoal, 'en') || '')
      ),
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


