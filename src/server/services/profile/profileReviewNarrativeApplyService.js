/**
 * Apply pre-generated document narrative cache to profile without LLM normalization.
 */

const {
  computeNarrativeSourceFingerprint,
  buildWhoAreYouRawAnswersFromIdentity,
  resolveNarrativeWarmDelta,
  buildStructuredNarrativesFromLists,
  buildWhoAreYouNarrativeFromIdentity,
  persistNarrativeEnrichmentOnDocument,
  awaitDocumentNarrativeWorkIfInFlight,
} = require('./extractionNarrativeEnrichmentService');
const {
  buildStructuredBaselineFromExtraction,
  STRUCTURED_DIMENSION_KEYS,
  structuredRawListsEqual,
} = require('./profileReviewSaveService');
const {
  getDocumentNarrativeCacheReadiness,
  isDimensionNarrativeReady,
  isWhoAreYouNarrativeReady,
} = require('./profileNarrativeReadinessService');
const { EMPTY_PLACEHOLDER } = require('../jobAnalysis/dimensionSummaryGenerator');
/**
 * Profile snapshot used for narrative fingerprinting (aligned with warmReviewNarrativeCache).
 *
 * @param {object} doc
 * @param {object} body - review-save request body
 */
function buildReviewProfileDataForNarrativeFingerprint(doc, body = {}) {
  const extracted = doc?.extractedProfileData && typeof doc.extractedProfileData === 'object'
    ? doc.extractedProfileData
    : {};
  return {
    userIdentity: body.userIdentity || extracted.userIdentity || {},
    structuredUserInfo: {
      ...(extracted.structuredUserInfo || {}),
      ...(body.structuredUserInfo || {}),
    },
  };
}

/**
 * @param {object} doc
 * @param {object} body
 * @param {Record<string, boolean>} acceptedFields
 */
function reviewNarrativeFingerprintMatchesDocument(doc, body, acceptedFields = {}) {
  const enrichment = doc?.narrativeEnrichment;
  if (!enrichment?.fingerprint) return false;
  const profileData = buildReviewProfileDataForNarrativeFingerprint(doc, body);
  const expected = computeNarrativeSourceFingerprint(profileData, acceptedFields);
  return enrichment.fingerprint === expected;
}

/**
 * Effective list values for each dimension after review checkboxes.
 *
 * @param {object} doc
 * @param {object} body
 * @param {Record<string, boolean>} acceptedFields
 */
function buildEffectiveReviewLists(doc, body, acceptedFields = {}) {
  const profileData = buildReviewProfileDataForNarrativeFingerprint(doc, body);
  const baseline = buildStructuredBaselineFromExtraction(profileData, acceptedFields);
  return baseline.lists || {};
}

function emptyDimensionWithPlaceholder() {
  return {
    raw_items: [],
    summary_text: {
      original_language: 'en',
      original: EMPTY_PLACEHOLDER,
      translations: { en: EMPTY_PLACEHOLDER },
    },
  };
}

/**
 * Copy cached narratives onto profile-shaped payloads (updates raw_items from review lists).
 *
 * @param {object} narrativeEnrichment
 * @param {Record<string, string[]>} effectiveLists
 * @param {Record<string, string>} mergedIdentityAnswers
 */
function buildProfileNarrativesFromDocumentCache(
  narrativeEnrichment,
  effectiveLists,
  mergedIdentityAnswers,
  language = 'en'
) {
  const cacheStructured = narrativeEnrichment?.structuredUserInfo || {};
  const structuredUserInfo = {};

  for (const key of STRUCTURED_DIMENSION_KEYS) {
    const rawItems = Array.isArray(effectiveLists[key]) ? effectiveLists[key] : [];
    const cachedDim = cacheStructured[key];
    if (rawItems.length === 0) {
      structuredUserInfo[key] = cachedDim?.summary_text
        ? { raw_items: [], summary_text: cachedDim.summary_text }
        : emptyDimensionWithPlaceholder();
      continue;
    }
    if (!cachedDim?.summary_text || !isDimensionNarrativeReady(cachedDim, language)) {
      return null;
    }
    structuredUserInfo[key] = {
      raw_items: rawItems,
      summary_text: cachedDim.summary_text,
    };
  }

  const cachedWho = narrativeEnrichment?.who_are_you;
  if (!cachedWho?.summary_text || !isWhoAreYouNarrativeReady(cachedWho, language)) {
    return null;
  }

  const whoAnswers = buildWhoAreYouRawAnswersFromIdentity(mergedIdentityAnswers);
  const cachedWhoAnswers = Array.isArray(cachedWho.raw_answers)
    ? cachedWho.raw_answers.map((v) => String(v || '').trim())
    : [];
  const provisionalWho = {
    ...cachedWho,
    raw_answers: whoAnswers,
  };
  if (
    !structuredRawListsEqual(cachedWhoAnswers, whoAnswers)
    || !isWhoAreYouNarrativeReady(provisionalWho, language)
  ) {
    return null;
  }

  const who_are_you = provisionalWho;

  return { structuredUserInfo, who_are_you };
}

/**
 * @param {object} doc
 * @param {object} body
 * @param {Record<string, boolean>} acceptedFields
 * @param {Record<string, string>} mergedIdentityAnswers
 * @param {string} [language]
 * @returns {{ ok: boolean, structuredUserInfo?: object, who_are_you?: object, reason?: string }}
 */
function tryBuildProfileNarrativesFromDocumentCache(
  doc,
  body,
  acceptedFields,
  mergedIdentityAnswers,
  language = 'en'
) {
  if (!doc?.narrativeEnrichment) {
    return { ok: false, reason: 'no_cache' };
  }
  const cacheReadiness = getDocumentNarrativeCacheReadiness(doc, language);
  if (!cacheReadiness.ready) {
    return { ok: false, reason: 'cache_not_ready', pending: cacheReadiness.pending };
  }
  if (!reviewNarrativeFingerprintMatchesDocument(doc, body, acceptedFields)) {
    return { ok: false, reason: 'fingerprint_mismatch' };
  }

  const effectiveLists = buildEffectiveReviewLists(doc, body, acceptedFields);
  const built = buildProfileNarrativesFromDocumentCache(
    doc.narrativeEnrichment,
    effectiveLists,
    mergedIdentityAnswers,
    language
  );
  if (!built) {
    return { ok: false, reason: 'cache_incomplete' };
  }

  return { ok: true, ...built };
}

/**
 * Apply document narrative cache, waiting for in-flight extraction narrative or a sync warm when needed.
 *
 * @param {string} userId
 * @param {string} documentId
 * @param {object} doc
 * @param {object} body
 * @param {Record<string, boolean>} acceptedFields
 * @param {Record<string, string>} mergedIdentityAnswers
 * @param {{ language?: string, sourceLanguage?: string }} options
 */
async function applyReviewSaveNarrativesWithRetry(
  userId,
  documentId,
  doc,
  body,
  acceptedFields,
  mergedIdentityAnswers,
  options = {}
) {
  let currentDoc = doc;
  let cacheApply = await applyReviewSaveNarrativesFromDocument(
    currentDoc,
    body,
    acceptedFields,
    mergedIdentityAnswers,
    options
  );
  if (cacheApply.ok) return cacheApply;

  await awaitDocumentNarrativeWorkIfInFlight(userId, documentId, options);

  const reloadDoc = async () => {
    const User = require('../../models/User');
    const user = await User.findById(userId);
    return user?.profile?.documents?.id?.(documentId) || null;
  };

  currentDoc = (await reloadDoc()) || currentDoc;
  cacheApply = await applyReviewSaveNarrativesFromDocument(
    currentDoc,
    body,
    acceptedFields,
    mergedIdentityAnswers,
    options
  );
  if (cacheApply.ok) return cacheApply;

  const retryReasons = new Set([
    'no_cache',
    'cache_not_ready',
    'fingerprint_mismatch',
    'cache_incomplete',
  ]);
  if (!retryReasons.has(cacheApply.reason)) {
    return cacheApply;
  }

  return cacheApply;
}

/**
 * Apply document narrative cache on review-save (full match or incremental LLM for deltas only).
 *
 * @param {object} doc
 * @param {object} body
 * @param {Record<string, boolean>} acceptedFields
 * @param {Record<string, string>} mergedIdentityAnswers
 * @param {{ language?: string, sourceLanguage?: string }} options
 */
async function applyReviewSaveNarrativesFromDocument(
  doc,
  body,
  acceptedFields,
  mergedIdentityAnswers,
  options = {}
) {
  const enrichment = doc?.narrativeEnrichment;
  if (!enrichment) {
    return { ok: false, reason: 'no_cache' };
  }

  const language = String(options.language || 'en').toLowerCase().split('-')[0] || 'en';
  const sourceLanguage = String(options.sourceLanguage || language).toLowerCase().split('-')[0] || 'en';

  const profileDataForDelta = buildReviewProfileDataForNarrativeFingerprint(doc, body);
  const delta = resolveNarrativeWarmDelta(enrichment, profileDataForDelta, acceptedFields, language);
  const effectiveLists = buildEffectiveReviewLists(doc, body, acceptedFields);
  const cachedWho = enrichment.who_are_you;

  const fullApply = tryBuildProfileNarrativesFromDocumentCache(
    doc,
    body,
    acceptedFields,
    mergedIdentityAnswers,
    language
  );
  if (fullApply.ok) {
    return { ...fullApply, applyMode: 'full_cache' };
  }

  // Follow-ups change identity but not structured lists: reuse cached dimension narratives without
  // requiring fingerprint equality (avoids full normalize path after a failed pre-save warm).
  if (delta.dimensionKeysToRegen.length === 0) {
    const built = buildProfileNarrativesFromDocumentCache(
      enrichment,
      effectiveLists,
      mergedIdentityAnswers,
      language
    );
    if (built) {
      let who_are_you = built.who_are_you;
      const whoNeedsRegen =
        delta.whoChanged || !isWhoAreYouNarrativeReady(cachedWho, language);
      if (whoNeedsRegen) {
        who_are_you = await buildWhoAreYouNarrativeFromIdentity(delta.newBaseline.userIdentity, {
          language,
          sourceLanguage,
          deferIdentityEmbedding: true,
        });
      }
      return {
        ok: true,
        structuredUserInfo: built.structuredUserInfo,
        who_are_you,
        applyMode: 'structured_cache_who_delta',
        regenDimensions: [],
        regenWho: whoNeedsRegen,
      };
    }
  }
  const cacheStructured = enrichment.structuredUserInfo || {};
  const structuredUserInfo = {};
  const keysToRegen = new Set(delta.dimensionKeysToRegen);

  for (const key of STRUCTURED_DIMENSION_KEYS) {
    const rawItems = Array.isArray(effectiveLists[key]) ? effectiveLists[key] : [];
    if (keysToRegen.has(key)) {
      continue;
    }
    const cachedDim = cacheStructured[key];
    if (rawItems.length === 0) {
      if (cachedDim?.summary_text && isDimensionNarrativeReady(cachedDim, language)) {
        structuredUserInfo[key] = { raw_items: [], summary_text: cachedDim.summary_text };
      } else {
        keysToRegen.add(key);
      }
      continue;
    }
    if (!cachedDim?.summary_text || !isDimensionNarrativeReady(cachedDim, language)) {
      keysToRegen.add(key);
      continue;
    }
    structuredUserInfo[key] = {
      raw_items: rawItems,
      summary_text: cachedDim.summary_text,
    };
  }

  if (keysToRegen.size > 0) {
    const regenKeys = [...keysToRegen];
    const partialLists = {};
    for (const key of regenKeys) {
      partialLists[key] = delta.newBaseline.lists[key];
    }
    const regen = await buildStructuredNarrativesFromLists(partialLists, {
      language,
      sourceLanguage,
      onlyKeys: regenKeys,
    });
    for (const key of regenKeys) {
      structuredUserInfo[key] = regen[key];
    }
  }

  let who_are_you;
  const whoAnswers = buildWhoAreYouRawAnswersFromIdentity(mergedIdentityAnswers);
  if (
    delta.whoChanged
    || !cachedWho?.summary_text
    || !isWhoAreYouNarrativeReady(cachedWho, language)
  ) {
    who_are_you = await buildWhoAreYouNarrativeFromIdentity(delta.newBaseline.userIdentity, {
      language,
      sourceLanguage,
      deferIdentityEmbedding: true,
    });
  } else {
    who_are_you = {
      ...cachedWho,
      raw_answers: whoAnswers,
    };
  }

  return {
    ok: true,
    structuredUserInfo,
    who_are_you,
    applyMode: 'incremental_cache',
    regenDimensions: [...keysToRegen],
    regenWho: delta.whoChanged
      || !isWhoAreYouNarrativeReady(cachedWho, language),
  };
}

/**
 * Persist document narrative cache after a successful review-save apply (non-blocking).
 */
function schedulePersistNarrativeEnrichmentFromApply(
  userId,
  documentId,
  doc,
  body,
  acceptedFields,
  structuredUserInfo,
  who_are_you,
  language,
  sourceLanguage
) {
  if (!userId || !documentId) return;
  const profileData = buildReviewProfileDataForNarrativeFingerprint(doc, body);
  void (async () => {
    try {
      await persistNarrativeEnrichmentOnDocument(userId, documentId, {
        language,
        sourceLanguage,
        fingerprint: computeNarrativeSourceFingerprint(profileData, acceptedFields),
        structuredUserInfo,
        who_are_you,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[schedulePersistNarrativeEnrichmentFromApply] failed:', err?.message || err);
    }
  })();
}

module.exports = {
  buildReviewProfileDataForNarrativeFingerprint,
  reviewNarrativeFingerprintMatchesDocument,
  buildEffectiveReviewLists,
  buildProfileNarrativesFromDocumentCache,
  tryBuildProfileNarrativesFromDocumentCache,
  applyReviewSaveNarrativesFromDocument,
  applyReviewSaveNarrativesWithRetry,
  schedulePersistNarrativeEnrichmentFromApply,
};
