/**
 * Pre-generate profile narratives at CV extraction (and during review steps) so review-save can copy them synchronously.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../../models/User');
const localizedContentService = require('../localization/localizedContentService');
const { cachedTranslate } = require('../ai/translationCache');
const { translateStructured } = require('../ai/translateStructured');
const { generateDimensionSummary, EMPTY_PLACEHOLDER } = require('../jobAnalysis/dimensionSummaryGenerator');
const {
  generateWhoAreYouNarratives,
  PLACEHOLDER: WHO_ARE_YOU_PLACEHOLDER,
} = require('../jobAnalysis/whoAreYouNarrativeGenerator');
const {
  PLACEHOLDER: WHO_ARE_YOU_IDENTITY_PLACEHOLDER,
  generateWhoAreYouIdentityEmbeddingText,
} = require('../jobAnalysis/whoAreYouIdentityEmbeddingTextGenerator');
const { filterIndustryDomainRawItems } = require('../../constants/industryDomainFilters');
const { normalizeStructuredListItemLabel } = require('../../../constants/structuredListItemLabel');
const {
  USER_IDENTITY_ANSWER_KEYS,
  normalizeUserIdentityAnswers,
} = require('../embedding/userIdentityEmbeddingTextService');
const {
  STRUCTURED_DIMENSION_KEYS,
  buildStructuredBaselineFromExtraction,
  comparableRawListForDimension,
  structuredRawListsEqual,
  getRawItems,
} = require('./profileReviewSaveService');
const { isCvNarrativeBatchEnabled } = require('../../../constants/cvNarrativeBatch');
const {
  estimateLegacyOpenAiCallCount,
  logNarrativeGenerationMetrics,
} = require('./narrativeGenerationMetrics');
const { updateUserDocumentWithVersionRetry } = require('../documents/userDocumentVersionedSave');
const {
  getDocumentNarrativeCacheReadiness,
  isDimensionNarrativeReady,
  isWhoAreYouNarrativeReady,
} = require('./profileNarrativeReadinessService');
const {
  isNarrativeCacheQualityVersionCurrent,
  stampNarrativeEnrichmentQuality,
} = require('./narrativeQualityGate');

/** @type {Map<string, Promise<{ updated?: boolean, reason?: string }>>} */
const narrativeInFlight = new Map();

function narrativeFlightKey(userId, documentId) {
  return `${String(userId)}:${String(documentId)}`;
}

function isExtractionNarrativeInFlight(userId, documentId) {
  return narrativeInFlight.has(narrativeFlightKey(userId, documentId));
}

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

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(String(value));
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
      // Keep canonical only if translation fails.
    }
  }
  return field;
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

async function ensureBilingualWhoAreYouSummaryField(existingField, canonicalSummaryText, canonicalLanguage, localizedMap = {}) {
  const canonicalLang = normalizeLangCode(canonicalLanguage, 'en');
  let field = hydrateLocalizedSummaryField(existingField, canonicalSummaryText, canonicalLang, localizedMap);
  for (const lang of SUPPORTED_NARRATIVE_LANGS) {
    if (lang === canonicalLang) continue;
    const existingRaw = String(localizedContentService.get(field, lang) || '').trim();
    if (existingRaw) continue;
    try {
      const canonicalArray = parseWhoAreYouNarratives(canonicalSummaryText);
      const translated = await cachedTranslate(canonicalArray, lang, () => translateStructured(canonicalArray, lang));
      if (Array.isArray(translated) && translated.length === 5) {
        const safeJson = JSON.stringify(
          translated.map((value) => String(value || '').trim() || WHO_ARE_YOU_PLACEHOLDER)
        );
        field = localizedContentService.set(field, lang, safeJson);
      }
    } catch (_) {
      // Keep canonical only if translation fails.
    }
  }
  return field;
}

function buildWhoAreYouRawAnswersFromIdentity(identityAnswers = {}) {
  const normalized = normalizeUserIdentityAnswers(identityAnswers || {});
  return USER_IDENTITY_ANSWER_KEYS.map((key) => String(normalized[key] || '').trim());
}

/**
 * Stable fingerprint for extraction / review snapshot (identity + structured lists).
 *
 * @param {object} profileData
 * @param {Record<string, boolean>} [acceptedFields]
 */
function computeNarrativeSourceFingerprint(profileData = {}, acceptedFields = {}) {
  const baseline = buildStructuredBaselineFromExtraction(profileData, acceptedFields);
  const payload = {
    identity: baseline.userIdentity,
    lists: STRUCTURED_DIMENSION_KEYS.reduce((acc, key) => {
      acc[key] = comparableRawListForDimension(key, baseline.lists[key]);
      return acc;
    }, {}),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

/**
 * @param {Record<string, string[]>} lists
 * @param {{ language?: string, sourceLanguage?: string, onlyKeys?: string[] }} options
 */
async function buildStructuredNarrativesFromLists(lists = {}, options = {}) {
  const targetLang = normalizeLangCode(options.language, 'en');
  const sourceLang = normalizeLangCode(options.sourceLanguage, 'en');
  const onlyKeys = Array.isArray(options.onlyKeys) && options.onlyKeys.length > 0
    ? new Set(options.onlyKeys)
    : null;
  const out = {};

  await Promise.all(
    STRUCTURED_DIMENSIONS.filter(({ key }) => !onlyKeys || onlyKeys.has(key)).map(async ({ key, label }) => {
      let rawItems = Array.isArray(lists[key])
        ? lists[key].map((v) => normalizeStructuredListItemLabel(v)).filter(Boolean)
        : [];
      if (key === 'domains') {
        rawItems = filterIndustryDomainRawItems(rawItems);
      }
      if (rawItems.length === 0) {
        out[key] = {
          raw_items: [],
          summary_text: await ensureBilingualSummaryField(null, EMPTY_PLACEHOLDER, sourceLang, {}),
        };
        return;
      }
      try {
        const generated = await generateDimensionSummary(
          { dimension: label, rawItems },
          { lang: targetLang, sourceLang, returnBundle: true }
        );
        const summaryText = String(generated?.canonical || '').trim() || EMPTY_PLACEHOLDER;
        const canonicalLanguage = normalizeLangCode(generated?.canonicalLanguage || sourceLang, sourceLang);
        out[key] = {
          raw_items: rawItems,
          summary_text: await ensureBilingualSummaryField(
            null,
            summaryText,
            canonicalLanguage,
            generated?.localized || {}
          ),
        };
      } catch (err) {
        console.warn(`[extractionNarrativeEnrichment] dimension ${key} failed:`, err?.message || err);
        out[key] = {
          raw_items: rawItems,
          summary_text: await ensureBilingualSummaryField(null, EMPTY_PLACEHOLDER, sourceLang, {}),
        };
      }
    })
  );

  return out;
}

/**
 * @param {Record<string, string>} userIdentity
 * @param {{ language?: string, sourceLanguage?: string }} options
 */
async function buildWhoAreYouNarrativeFromIdentity(userIdentity = {}, options = {}) {
  const targetLang = normalizeLangCode(options.language, 'en');
  const sourceLang = normalizeLangCode(options.sourceLanguage, 'en');
  const deferIdentityEmbedding = options.deferIdentityEmbedding === true;
  const rawAnswers = buildWhoAreYouRawAnswersFromIdentity(userIdentity);

  if (!rawAnswers.some(Boolean)) {
    const placeholderSummary = JSON.stringify(Array(5).fill(WHO_ARE_YOU_PLACEHOLDER));
    return {
      raw_answers: rawAnswers,
      summary_text: await ensureBilingualWhoAreYouSummaryField(null, placeholderSummary, sourceLang, {}),
      identity_embedding_text: WHO_ARE_YOU_IDENTITY_PLACEHOLDER,
    };
  }

  const generated = await generateWhoAreYouNarratives(rawAnswers, {
    lang: targetLang,
    sourceLang,
    returnBundle: true,
  });
  const safeNarratives = Array.isArray(generated?.canonical) && generated.canonical.length === 5
    ? generated.canonical.map((value) => String(value || '').trim() || WHO_ARE_YOU_PLACEHOLDER)
    : Array(5).fill(WHO_ARE_YOU_PLACEHOLDER);
  const summaryJson = JSON.stringify(safeNarratives);
  const canonicalLang = normalizeLangCode(generated?.canonicalLanguage || sourceLang, sourceLang);
  const localizedSummaryMap = Object.fromEntries(
    Object.entries(generated?.localized || {}).map(([lang, arr]) => [
      lang,
      Array.isArray(arr)
        ? JSON.stringify(arr.map((value) => String(value || '').trim() || WHO_ARE_YOU_PLACEHOLDER))
        : null,
    ])
  );
  let identityEmbeddingText = '';
  if (!deferIdentityEmbedding) {
    try {
      identityEmbeddingText = await generateWhoAreYouIdentityEmbeddingText(rawAnswers);
    } catch (err) {
      console.warn('[extractionNarrativeEnrichment] identity_embedding_text failed:', err?.message || err);
      identityEmbeddingText = WHO_ARE_YOU_IDENTITY_PLACEHOLDER;
    }
  }

  return {
    raw_answers: rawAnswers,
    summary_text: await ensureBilingualWhoAreYouSummaryField(
      null,
      summaryJson,
      canonicalLang,
      localizedSummaryMap
    ),
    ...(deferIdentityEmbedding
      ? {}
      : { identity_embedding_text: identityEmbeddingText }),
  };
}

/**
 * Batched narrative path — uses the same production-quality generators as legacy
 * (per-dimension summaries + who-are-you). The unified single-call path was removed
 * because it degraded narrative quality.
 *
 * @param {object} profileData
 * @param {object} options
 */
async function generateNarrativeEnrichmentBatched(profileData = {}, options = {}) {
  return generateNarrativeEnrichmentLegacy(profileData, options);
}

/**
 * Legacy per-dimension / per-task narrative path.
 */
async function generateNarrativeEnrichmentLegacy(profileData = {}, options = {}) {
  const started = Date.now();
  const acceptedFields = options.acceptedFields && typeof options.acceptedFields === 'object'
    ? options.acceptedFields
    : {};
  const baseline = buildStructuredBaselineFromExtraction(profileData, acceptedFields);
  const language = normalizeLangCode(options.language, 'en');
  const sourceLanguage = normalizeLangCode(options.sourceLanguage || options.language, 'en');
  const rawAnswers = buildWhoAreYouRawAnswersFromIdentity(baseline.userIdentity);

  const [structuredUserInfo, who_are_you] = await Promise.all([
    buildStructuredNarrativesFromLists(baseline.lists, {
      language,
      sourceLanguage,
      onlyKeys: options.onlyDimensionKeys,
    }),
    options.includeWhoAreYou === false
      ? null
      : buildWhoAreYouNarrativeFromIdentity(baseline.userIdentity, {
          language,
          sourceLanguage,
          deferIdentityEmbedding: options.deferIdentityEmbedding === true,
        }),
  ]);

  const previousOpenAICallCount = estimateLegacyOpenAiCallCount({
    lists: baseline.lists,
    rawAnswers,
    onlyDimensionKeys: options.onlyDimensionKeys,
    includeWhoAreYou: options.includeWhoAreYou !== false,
    includeEmbedding: options.includeWhoAreYou !== false && options.deferIdentityEmbedding !== true,
  });

  logNarrativeGenerationMetrics({
    batchEnabled: false,
    previousOpenAICallCount,
    newOpenAICallCount: previousOpenAICallCount,
    latencyMs: Date.now() - started,
    incremental: Boolean(options.onlyDimensionKeys?.length),
    userId: options.userId,
    documentId: options.documentId,
  });

  const result = {
    language,
    sourceLanguage,
    fingerprint: computeNarrativeSourceFingerprint(profileData, acceptedFields),
    structuredUserInfo,
    generatedAt: new Date().toISOString(),
  };
  if (who_are_you) result.who_are_you = who_are_you;
  return stampNarrativeEnrichmentQuality(result);
}

/**
 * Build narrative enrichment payload from an extraction/review profile snapshot.
 *
 * @param {object} profileData - { userIdentity, structuredUserInfo }
 * @param {{ language?: string, sourceLanguage?: string, acceptedFields?: Record<string, boolean> }} [options]
 */
async function generateNarrativeEnrichmentFromProfileData(profileData = {}, options = {}) {
  if (isCvNarrativeBatchEnabled()) {
    try {
      return await generateNarrativeEnrichmentBatched(profileData, options);
    } catch (err) {
      console.warn(
        '[extractionNarrativeEnrichment] batched narrative failed, falling back to legacy:',
        err?.message || err
      );
    }
  }
  return generateNarrativeEnrichmentLegacy(profileData, options);
}

/**
 * @param {string} userId
 * @param {string} documentId
 * @param {object} enrichment
 */
/**
 * @param {string} userId
 * @param {string} documentId
 * @param {'pending'|'complete'|'skipped'} status
 */
async function setDocumentNarrativeEnrichmentStatus(userId, documentId, status) {
  const uid = toObjectId(userId);
  const did = toObjectId(documentId);
  const result = await updateUserDocumentWithVersionRetry(uid, did, (_user, doc) => {
    doc.narrativeEnrichmentStatus = String(status).slice(0, 32);
  });
  if (!result.ok) return { updated: false, reason: result.reason || 'save_failed' };
  return { updated: true };
}

async function persistNarrativeEnrichmentOnDocument(userId, documentId, enrichment) {
  if (!enrichment || typeof enrichment !== 'object') return { updated: false };
  const uid = toObjectId(userId);
  const did = toObjectId(documentId);
  const result = await updateUserDocumentWithVersionRetry(uid, did, (_user, doc) => {
    doc.narrativeEnrichment = enrichment;
    doc.narrativeEnrichmentStatus = 'complete';
  });
  if (!result.ok) return { updated: false, reason: result.reason || 'save_failed' };
  return { updated: true };
}

/**
 * Generate and store narratives for a document's extracted profile (all rows accepted).
 *
 * @param {string} userId
 * @param {string} documentId
 * @param {{ language?: string, sourceLanguage?: string }} [options]
 */
async function generateAndPersistExtractionNarratives(userId, documentId, options = {}) {
  const uid = toObjectId(userId);
  const did = toObjectId(documentId);
  const user = await User.findById(uid);
  if (!user) return { updated: false, reason: 'user_not_found' };
  const doc = user.profile?.documents?.id(did);
  if (!doc?.extractedProfileData) {
    await setDocumentNarrativeEnrichmentStatus(userId, documentId, 'skipped').catch(() => {});
    return { updated: false, reason: 'no_extracted_profile' };
  }

  await setDocumentNarrativeEnrichmentStatus(userId, documentId, 'pending').catch(() => {});

  const sourceLanguage = normalizeLangCode(
    options.sourceLanguage
    || doc.cvExtractLocalization?.documentLanguage
    || user.profile?.cvExtractLocalization?.documentLanguage
    || 'en',
    'en'
  );
  const language = normalizeLangCode(options.language || sourceLanguage, 'en');

  const enrichment = await generateNarrativeEnrichmentFromProfileData(doc.extractedProfileData, {
    language,
    sourceLanguage,
    acceptedFields: {},
    userId,
    documentId,
  });

  try {
    return await persistNarrativeEnrichmentOnDocument(userId, documentId, enrichment);
  } catch (err) {
    await setDocumentNarrativeEnrichmentStatus(userId, documentId, 'skipped').catch(() => {});
    throw err;
  }
}

async function runExtractionNarrativesOnce(userId, documentId, options = {}) {
  const key = narrativeFlightKey(userId, documentId);
  const existing = narrativeInFlight.get(key);
  if (existing) return existing;

  const promise = generateAndPersistExtractionNarratives(userId, documentId, options).finally(() => {
    if (narrativeInFlight.get(key) === promise) narrativeInFlight.delete(key);
  });
  narrativeInFlight.set(key, promise);
  return promise;
}

function scheduleExtractionNarrativeEnrichment(userId, documentId, options = {}) {
  if (!userId || !documentId) return;
  void runExtractionNarrativesOnce(userId, documentId, options)
    .then(async (result) => {
      if (!result.updated) {
        await setDocumentNarrativeEnrichmentStatus(userId, documentId, 'skipped').catch(() => {});
      }
    })
    .catch(async (e) => {
      await setDocumentNarrativeEnrichmentStatus(userId, documentId, 'skipped').catch(() => {});
      console.warn('generateAndPersistExtractionNarratives failed (non-fatal):', e?.message || e);
    });
}

/**
 * Warm or refresh narrative cache from current review wizard state (step transitions).
 *
 * @param {string} userId
 * @param {string} documentId
 * @param {object} reviewSnapshot - { userIdentity, structuredUserInfo }
 * @param {{ language?: string, acceptedFields?: Record<string, boolean> }} [options]
 */
/**
 * Which structured dimensions / who-are-you need regeneration vs existing document cache.
 *
 * @param {object|null} existingEnrichment
 * @param {object} profileData
 * @param {Record<string, boolean>} acceptedFields
 */
function resolveNarrativeWarmDelta(existingEnrichment, profileData = {}, acceptedFields = {}, language = 'en') {
  const newBaseline = buildStructuredBaselineFromExtraction(profileData, acceptedFields);
  const cacheStructured = existingEnrichment?.structuredUserInfo || {};
  const dimensionKeysToRegen = [];

  for (const key of STRUCTURED_DIMENSION_KEYS) {
    const newList = comparableRawListForDimension(key, newBaseline.lists[key]);
    const oldList = comparableRawListForDimension(key, cacheStructured[key]?.raw_items || []);
    if (!structuredRawListsEqual(newList, oldList)) {
      dimensionKeysToRegen.push(key);
    }
  }

  const newWhoAnswers = buildWhoAreYouRawAnswersFromIdentity(newBaseline.userIdentity);
  const cachedWhoAnswers = Array.isArray(existingEnrichment?.who_are_you?.raw_answers)
    ? existingEnrichment.who_are_you.raw_answers.map((v) => String(v || '').trim())
    : [];
  let whoChanged = !structuredRawListsEqual(cachedWhoAnswers, newWhoAnswers);

  const lang = normalizeLangCode(language, 'en');

  for (const key of STRUCTURED_DIMENSION_KEYS) {
    if (dimensionKeysToRegen.includes(key)) continue;
    const dim = cacheStructured[key];
    const rawItems = getRawItems(dim);
    if (rawItems.length > 0 && !isDimensionNarrativeReady(dim, lang)) {
      dimensionKeysToRegen.push(key);
    }
  }

  if (!whoChanged) {
    const cachedWho = existingEnrichment?.who_are_you || {};
    if (
      newWhoAnswers.some(Boolean)
      && !isWhoAreYouNarrativeReady({ ...cachedWho, raw_answers: newWhoAnswers }, lang)
    ) {
      whoChanged = true;
    }
  }

  if (!isNarrativeCacheQualityVersionCurrent(existingEnrichment)) {
    for (const key of STRUCTURED_DIMENSION_KEYS) {
      if (dimensionKeysToRegen.includes(key)) continue;
      if (getRawItems(cacheStructured[key]).length > 0) {
        dimensionKeysToRegen.push(key);
      }
    }
    if (newWhoAnswers.some(Boolean)) {
      whoChanged = true;
    }
  }

  return {
    dimensionKeysToRegen: [...new Set(dimensionKeysToRegen)],
    whoChanged,
    newBaseline,
  };
}

async function awaitDocumentNarrativeWorkIfInFlight(userId, documentId, options = {}) {
  if (!isExtractionNarrativeInFlight(userId, documentId)) {
    return { awaited: false };
  }
  await runExtractionNarrativesOnce(userId, documentId, options).catch(() => {});
  return { awaited: true };
}

async function warmReviewNarrativeCache(userId, documentId, reviewSnapshot = {}, options = {}) {
  const uid = toObjectId(userId);
  const did = toObjectId(documentId);
  let user = await User.findById(uid);
  if (!user) return { updated: false, reason: 'user_not_found' };
  let doc = user.profile?.documents?.id(did);
  if (!doc?.extractedProfileData) return { updated: false, reason: 'no_extracted_profile' };

  const sourceLanguage = normalizeLangCode(
    options.sourceLanguage
    || doc.cvExtractLocalization?.documentLanguage
    || user.profile?.cvExtractLocalization?.documentLanguage
    || 'en',
    'en'
  );
  const language = normalizeLangCode(options.language || sourceLanguage, 'en');

  await awaitDocumentNarrativeWorkIfInFlight(userId, documentId, { language, sourceLanguage });
  user = await User.findById(uid);
  doc = user?.profile?.documents?.id(did);
  if (!doc?.extractedProfileData) return { updated: false, reason: 'no_extracted_profile' };

  const profileData = {
    userIdentity: reviewSnapshot.userIdentity || doc.extractedProfileData.userIdentity || {},
    structuredUserInfo: {
      ...(doc.extractedProfileData.structuredUserInfo || {}),
      ...(reviewSnapshot.structuredUserInfo || {}),
    },
  };
  const acceptedFields = options.acceptedFields && typeof options.acceptedFields === 'object'
    ? options.acceptedFields
    : {};
  const fingerprint = computeNarrativeSourceFingerprint(profileData, acceptedFields);
  const cacheReadiness = getDocumentNarrativeCacheReadiness(doc, language);
  if (
    doc.narrativeEnrichment?.fingerprint === fingerprint
    && cacheReadiness.ready
  ) {
    return { updated: false, reason: 'unchanged', fingerprint, ready: true };
  }

  const existing = doc.narrativeEnrichment;
  const delta = existing
    ? resolveNarrativeWarmDelta(existing, profileData, acceptedFields, language)
    : null;
  const canIncremental = Boolean(
    existing
    && delta
    && (delta.dimensionKeysToRegen.length > 0 || delta.whoChanged)
    && delta.dimensionKeysToRegen.length < STRUCTURED_DIMENSION_KEYS.length
  );

  const needsFullRegen = !existing
    || !delta
    || !isNarrativeCacheQualityVersionCurrent(existing)
    || delta.dimensionKeysToRegen.length >= STRUCTURED_DIMENSION_KEYS.length;
  if (needsFullRegen && options.background !== false) {
    await awaitDocumentNarrativeWorkIfInFlight(userId, documentId, { language, sourceLanguage });
    user = await User.findById(uid);
    doc = user?.profile?.documents?.id(did);
    if (
      doc?.narrativeEnrichment?.fingerprint === fingerprint
      && getDocumentNarrativeCacheReadiness(doc, language).ready
    ) {
      return { updated: false, reason: 'unchanged', fingerprint, ready: true };
    }
    void (async () => {
      try {
        await setDocumentNarrativeEnrichmentStatus(userId, documentId, 'pending');
        const fullEnrichment = await generateNarrativeEnrichmentFromProfileData(profileData, {
          language,
          sourceLanguage,
          acceptedFields,
          userId,
          documentId,
        });
        await persistNarrativeEnrichmentOnDocument(userId, documentId, fullEnrichment);
      } catch (err) {
        await setDocumentNarrativeEnrichmentStatus(userId, documentId, 'skipped').catch(() => {});
        console.warn('[warmReviewNarrativeCache] background full regen failed:', err?.message || err);
      }
    })();
    return { updated: false, reason: 'warming', fingerprint };
  }

  let enrichment;
  if (canIncremental) {
    const structuredUserInfo = { ...(existing.structuredUserInfo || {}) };
    let who_are_you = existing.who_are_you;

    if (isCvNarrativeBatchEnabled()) {
      try {
        const partial = await generateNarrativeEnrichmentBatched(profileData, {
          language,
          sourceLanguage,
          acceptedFields,
          onlyDimensionKeys: delta.dimensionKeysToRegen,
          includeWhoAreYou: delta.whoChanged,
          deferIdentityEmbedding: true,
          userId,
          documentId,
        });
        for (const key of delta.dimensionKeysToRegen) {
          if (partial.structuredUserInfo?.[key]) structuredUserInfo[key] = partial.structuredUserInfo[key];
        }
        if (delta.whoChanged && partial.who_are_you) {
          who_are_you = partial.who_are_you;
        } else if (!delta.whoChanged) {
          who_are_you = {
            ...existing.who_are_you,
            raw_answers: buildWhoAreYouRawAnswersFromIdentity(delta.newBaseline.userIdentity),
          };
        }
      } catch (err) {
        console.warn('[warmReviewNarrativeCache] batched incremental failed, using legacy:', err?.message || err);
        if (delta.dimensionKeysToRegen.length > 0) {
          const partialLists = {};
          for (const key of delta.dimensionKeysToRegen) {
            partialLists[key] = delta.newBaseline.lists[key];
          }
          const regen = await buildStructuredNarrativesFromLists(partialLists, {
            language,
            sourceLanguage,
            onlyKeys: delta.dimensionKeysToRegen,
          });
          for (const key of delta.dimensionKeysToRegen) {
            structuredUserInfo[key] = regen[key];
          }
        }
        if (delta.whoChanged) {
          who_are_you = await buildWhoAreYouNarrativeFromIdentity(delta.newBaseline.userIdentity, {
            language,
            sourceLanguage,
            deferIdentityEmbedding: true,
          });
        } else {
          who_are_you = {
            ...existing.who_are_you,
            raw_answers: buildWhoAreYouRawAnswersFromIdentity(delta.newBaseline.userIdentity),
          };
        }
      }
    } else if (delta.dimensionKeysToRegen.length > 0) {
      const partialLists = {};
      for (const key of delta.dimensionKeysToRegen) {
        partialLists[key] = delta.newBaseline.lists[key];
      }
      const regen = await buildStructuredNarrativesFromLists(partialLists, {
        language,
        sourceLanguage,
        onlyKeys: delta.dimensionKeysToRegen,
      });
      for (const key of delta.dimensionKeysToRegen) {
        structuredUserInfo[key] = regen[key];
      }
    }
    if (!isCvNarrativeBatchEnabled() && delta.whoChanged) {
      who_are_you = await buildWhoAreYouNarrativeFromIdentity(delta.newBaseline.userIdentity, {
        language,
        sourceLanguage,
        deferIdentityEmbedding: true,
      });
    } else if (!isCvNarrativeBatchEnabled() && !delta.whoChanged) {
      who_are_you = {
        ...existing.who_are_you,
        raw_answers: buildWhoAreYouRawAnswersFromIdentity(delta.newBaseline.userIdentity),
      };
    }

    enrichment = stampNarrativeEnrichmentQuality({
      ...existing,
      language,
      sourceLanguage,
      fingerprint,
      structuredUserInfo,
      who_are_you,
      generatedAt: new Date().toISOString(),
    });
  } else {
    enrichment = await generateNarrativeEnrichmentFromProfileData(profileData, {
      language,
      sourceLanguage,
      acceptedFields,
      userId,
      documentId,
    });
  }

  const result = await persistNarrativeEnrichmentOnDocument(userId, documentId, enrichment);
  return {
    ...result,
    fingerprint,
    ready: getDocumentNarrativeCacheReadiness(
      { narrativeEnrichment: enrichment },
      language
    ).ready,
    incremental: Boolean(canIncremental),
    regenDimensions: canIncremental ? delta.dimensionKeysToRegen : STRUCTURED_DIMENSION_KEYS,
    regenWho: canIncremental ? delta.whoChanged : true,
  };
}

function getNarrativeEnrichmentFromDocument(doc) {
  if (!doc?.narrativeEnrichment || typeof doc.narrativeEnrichment !== 'object') return null;
  return doc.narrativeEnrichment;
}

module.exports = {
  generateNarrativeEnrichmentFromProfileData,
  generateNarrativeEnrichmentBatched,
  generateNarrativeEnrichmentLegacy,
  generateAndPersistExtractionNarratives,
  runExtractionNarrativesOnce,
  isExtractionNarrativeInFlight,
  awaitDocumentNarrativeWorkIfInFlight,
  scheduleExtractionNarrativeEnrichment,
  setDocumentNarrativeEnrichmentStatus,
  warmReviewNarrativeCache,
  resolveNarrativeWarmDelta,
  persistNarrativeEnrichmentOnDocument,
  getNarrativeEnrichmentFromDocument,
  computeNarrativeSourceFingerprint,
  buildWhoAreYouRawAnswersFromIdentity,
  buildStructuredNarrativesFromLists,
  buildWhoAreYouNarrativeFromIdentity,
};
