const { validateSeniorityPayload, seniorityPayloadsMatch } = require('./validateSeniorityPayload');
const {
  validateReviewSavePayload,
  validateReviewIdentityStep,
  parseReviewSaveValidationErrors,
  translateReviewFieldErrors,
  buildStructuredGoodAtFromReview,
} = require('./validateReviewProfilePayload');

const USER_IDENTITY_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_POLL_MAX_ATTEMPTS = 24;
const DOCUMENT_CACHE_POLL_MAX_ATTEMPTS = 240;
const DOCUMENT_CACHE_WARM_TIMEOUT_MS = 120000;

/** True when all five identity prompts have non-empty trimmed answers (review save + step 2 gate). */
function isReviewUserIdentityComplete(userIdentity = {}) {
  const identity = userIdentity && typeof userIdentity === 'object' ? userIdentity : {};
  return USER_IDENTITY_KEYS.every((key) => String(identity[key] || '').trim());
}

const SENIORITY_ERROR_KEYS = {
  currentStatus: 'profilePage.seniorityForm.errors.currentStatusRequired',
  highestDegree: 'profilePage.seniorityForm.errors.highestDegreeRequired',
  mostSeniorWorkExperience: 'profilePage.seniorityForm.errors.mostSeniorRequired',
};

class ProfileReviewSaveError extends Error {
  constructor(message, { userMessage, fieldErrors, focusStep } = {}) {
    super(message);
    this.name = 'ProfileReviewSaveError';
    this.userMessage = userMessage || message;
    /** @type {Record<string, string>|undefined} Pre-translated messages keyed by review field path */
    this.fieldErrors = fieldErrors;
    this.focusStep = focusStep;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLangFromQuery(langQuery = '') {
  const raw = String(langQuery || '').replace(/^\?/, '');
  const params = new URLSearchParams(raw);
  return params.get('lang') || 'en';
}

/** Ensures profile PUTs surface failures instead of navigating away with stale React Query cache. */
async function throwIfSaveNotOk(res, translate = (key) => key) {
  if (res.ok) return;
  let message = `Request failed (${res.status})`;
  try {
    const data = await res.json();
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      const parsed = parseReviewSaveValidationErrors(data.errors);
      if (Object.keys(parsed.fieldErrors).length > 0) {
        throw new ProfileReviewSaveError('Validation failed', {
          userMessage: translate('documentUpload.review.errors.fixHighlightedFields'),
          fieldErrors: translateReviewFieldErrors(parsed.fieldErrors, translate),
          focusStep: parsed.focusStep,
        });
      }
    }
    const fromServer =
      (typeof data?.message === 'string' && data.message.trim()) ||
      (typeof data?.error === 'string' && data.error.trim()) ||
      (Array.isArray(data?.errors) && data.errors[0] && String(data.errors[0].msg || '').trim());
    if (fromServer) message = fromServer;
  } catch (err) {
    if (err instanceof ProfileReviewSaveError) throw err;
    /* ignore JSON parse errors */
  }
  throw new Error(message);
}

function buildReviewSaveUserMessage(err, translate) {
  if (err instanceof ProfileReviewSaveError) {
    if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
      return err.userMessage || translate('documentUpload.review.errors.fixHighlightedFields');
    }
    return err.userMessage;
  }
  const detail = err && typeof err.message === 'string' ? err.message : '';
  return detail
    ? `${translate('profileCreation.errors.saveFailed')} ${detail}`
    : translate('profileCreation.errors.saveFailed');
}

async function pollJsonEndpoint({
  url,
  fetchImpl,
  getAuthToken,
  isReady,
  intervalMs,
  maxAttempts,
}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    await throwIfSaveNotOk(res);
    const data = await res.json().catch(() => ({}));
    if (isReady(data)) return data;
    if (attempt < maxAttempts - 1) {
      await delay(intervalMs);
    }
  }
  throw new ProfileReviewSaveError('Narrative readiness timed out', {
    userMessage: 'Profile narratives are still being prepared. Please try again in a moment.',
  });
}

/**
 * Wait for extraction narrative cache on the CV document (save screen), so review-save can reuse it.
 */
async function waitForDocumentNarrativeCache({
  documentId,
  langQuery,
  fetchImpl,
  getAuthToken,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  pollMaxAttempts = DOCUMENT_CACHE_POLL_MAX_ATTEMPTS,
}) {
  const docId = documentId != null ? String(documentId).trim() : '';
  if (!docId) return;

  await pollJsonEndpoint({
    url: `/api/documents/${encodeURIComponent(docId)}/narrative-cache-status?${langQuery}`,
    fetchImpl,
    getAuthToken,
    isReady: (data) => data?.ready === true,
    intervalMs: pollIntervalMs,
    maxAttempts: pollMaxAttempts,
  });
}

/**
 * Poll profile narratives after save until display-critical text is ready.
 */
async function waitForProfileNarrativesReady({
  langQuery,
  fetchImpl,
  getAuthToken,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  pollMaxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
}) {
  return pollJsonEndpoint({
    url: `/api/profile/narratives-status?${langQuery}`,
    fetchImpl,
    getAuthToken,
    isReady: (data) => data?.ready === true,
    intervalMs: pollIntervalMs,
    maxAttempts: pollMaxAttempts,
  });
}

/**
 * Seed React Query from review-save response so Profile can render immediately.
 */
function seedProfileCacheFromReviewSave(reviewSaveData, langQuery, queryClientImpl) {
  const {
    getProfileFullQueryKeyFull,
    invalidateProfileCompletionQuery,
  } = require('../hooks/useProfileQueries');
  const { queryClient } = require('../queryClient');
  const resolveQueryClient = queryClientImpl || queryClient;
  const lang = parseLangFromQuery(langQuery);
  const prev = resolveQueryClient.getQueryData(getProfileFullQueryKeyFull(lang));
  const base = prev && typeof prev === 'object' ? prev : {};
  const baseProfile = base.profile && typeof base.profile === 'object' ? base.profile : {};

  invalidateProfileCompletionQuery();
  resolveQueryClient.setQueryData(getProfileFullQueryKeyFull(lang), {
    ...base,
    success: true,
    /** Profile page renders from this immediately; refreshes full GET in the background. */
    _seededFromReviewSave: true,
    name: reviewSaveData?.name ?? base.name,
    email: reviewSaveData?.email ?? base.email,
    profile: {
      ...baseProfile,
      seniority: reviewSaveData?.seniority ?? baseProfile.seniority,
      userIdentity: reviewSaveData?.userIdentity ?? baseProfile.userIdentity,
      who_are_you: reviewSaveData?.who_are_you ?? baseProfile.who_are_you,
      structuredUserInfo: reviewSaveData?.structuredUserInfo ?? baseProfile.structuredUserInfo,
      documents: Array.isArray(reviewSaveData?.documents)
        ? reviewSaveData.documents
        : (baseProfile.documents || []),
    },
  });
}

/**
 * Invalidate completion + seed full profile cache after narratives are guaranteed.
 */
async function prefetchProfileCacheAfterSave({
  langQuery,
  fetchFullProfileImpl,
  queryClientImpl,
}) {
  const {
    fetchFullProfile,
    getProfileFullQueryKeyFull,
    invalidateProfileCompletionQuery,
    invalidateFullProfileQuery,
  } = require('../hooks/useProfileQueries');
  const { queryClient } = require('../queryClient');
  const resolveFetchFullProfile = fetchFullProfileImpl || fetchFullProfile;
  const resolveQueryClient = queryClientImpl || queryClient;
  const lang = parseLangFromQuery(langQuery);
  invalidateProfileCompletionQuery();
  const profileData = await resolveFetchFullProfile(lang);
  resolveQueryClient.setQueryData(getProfileFullQueryKeyFull(lang), profileData);
  await invalidateFullProfileQuery();
  return profileData;
}

/**
 * Validates and persists CV review profile data. Rejects on any validation or API failure
 * so callers (e.g. DocumentUploadForm) can keep the review dialog open.
 */
async function saveExtractedProfileReview({
  profileData,
  refreshUser,
  fetchImpl = fetch,
  getAuthToken = () => localStorage.getItem('token'),
  langQuery,
  translate = (key) => key,
  onSavePhase,
  prefetchProfile = false,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  pollMaxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
  documentCacheWarmTimeoutMs = DOCUMENT_CACHE_WARM_TIMEOUT_MS,
  fetchFullProfileImpl,
  queryClientImpl,
}) {
  const emitPhase = (phase) => {
    if (typeof onSavePhase === 'function') onSavePhase(phase);
  };

  const structuredUserInfo = profileData?.structuredUserInfo || {};
  const userIdentity = profileData?.userIdentity || {};
  const reviewMode = profileData?.__reviewOptions?.mode || 'merge';

  const seniorityCheck = validateSeniorityPayload(profileData?.seniority || {});
  if (!seniorityCheck.ok) {
    const key = SENIORITY_ERROR_KEYS[seniorityCheck.field] || 'profileCreation.errors.saveFailed';
    throw new ProfileReviewSaveError(`Seniority validation failed: ${seniorityCheck.field}`, {
      userMessage: translate(key),
    });
  }
  const normalizedSeniority = seniorityCheck.value;

  const authRefresh = await refreshUser();
  if (!authRefresh.success && !authRefresh.skipped) {
    throw new ProfileReviewSaveError('Session expired', {
      userMessage: translate('profileCreation.errors.sessionExpired'),
    });
  }

  const identityCheck = validateReviewIdentityStep({ userIdentity });
  if (!identityCheck.ok) {
    throw new ProfileReviewSaveError('Identity validation failed', {
      userMessage: translate('documentUpload.review.errors.fixHighlightedFields'),
      fieldErrors: translateReviewFieldErrors(identityCheck.fieldErrors, translate),
      focusStep: identityCheck.focusStep,
    });
  }

  const lengthCheck = validateReviewSavePayload({ userIdentity, structuredUserInfo });
  if (!lengthCheck.ok) {
    throw new ProfileReviewSaveError('Review field validation failed', {
      userMessage: translate('documentUpload.review.errors.fixHighlightedFields'),
      fieldErrors: translateReviewFieldErrors(lengthCheck.fieldErrors, translate),
      focusStep: lengthCheck.focusStep,
    });
  }

  const cvExtractLocalization =
    profileData?.__cvExtractLocalization && typeof profileData.__cvExtractLocalization === 'object'
      ? profileData.__cvExtractLocalization
      : undefined;

  const documentId =
    profileData?.documentId != null ? String(profileData.documentId).trim() : '';
  const acceptedFields =
    profileData?.acceptedFields && typeof profileData.acceptedFields === 'object'
      ? profileData.acceptedFields
      : undefined;

    // Ensure document narrative cache matches the save payload before review-save (fast copy path).
    // Waits for in-flight extraction narrative or runs warm once — avoids duplicate LLM on save.
    if (documentId) {
      emitPhase('narratives');
      await ensureReviewNarrativeCacheBeforeSave({
        documentId,
        userIdentity,
        structuredUserInfo,
        acceptedFields: acceptedFields || {},
        langQuery,
        fetchImpl,
        getAuthToken,
        translate,
        documentCacheWarmTimeoutMs,
      });
    }

    emitPhase('saving');
    const reviewSaveRes = await fetchImpl(`/api/profile/review-save?${langQuery}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify({
      mode: reviewMode,
      ...(profileData?.name?.trim() ? { name: profileData.name.trim() } : {}),
      seniority: normalizedSeniority,
      userIdentity,
      structuredUserInfo,
      ...(documentId ? { documentId } : {}),
      ...(acceptedFields ? { acceptedFields } : {}),
      ...(cvExtractLocalization ? { cvExtractLocalization } : {}),
    }),
  });
  await throwIfSaveNotOk(reviewSaveRes, translate);
  const reviewSaveData = await reviewSaveRes.json().catch(() => ({}));
  if (!seniorityPayloadsMatch(normalizedSeniority, reviewSaveData?.seniority || {})) {
    throw new Error('Seniority fields were not persisted correctly. Please try saving again.');
  }

  emitPhase('profile_cache');
  seedProfileCacheFromReviewSave(reviewSaveData, langQuery, queryClientImpl);
  if (prefetchProfile) {
    await prefetchProfileCacheAfterSave({
      langQuery,
      fetchFullProfileImpl,
      queryClientImpl,
    });
  }

  emitPhase('done');
  return { reviewSaveData, normalizedSeniority };
}

function buildReviewNarrativeCacheRequestBody({
  documentId,
  userIdentity = {},
  structuredUserInfo = {},
  acceptedFields = {},
  awaitReady = false,
}) {
  return {
    documentId: String(documentId).trim(),
    acceptedFields: acceptedFields && typeof acceptedFields === 'object' ? acceptedFields : {},
    userIdentity: userIdentity && typeof userIdentity === 'object' ? userIdentity : {},
    structuredUserInfo:
      structuredUserInfo && typeof structuredUserInfo === 'object' ? structuredUserInfo : {},
    ...(awaitReady ? { awaitReady: true } : {}),
  };
}

async function pollReviewNarrativeCacheReady({
  documentId,
  userIdentity,
  structuredUserInfo,
  acceptedFields,
  langQuery,
  fetchImpl,
  getAuthToken,
  translate,
  deadlineMs = DOCUMENT_CACHE_WARM_TIMEOUT_MS,
}) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const polled = await fetchDocumentNarrativeCacheStatus({
      documentId,
      userIdentity,
      structuredUserInfo,
      acceptedFields,
      langQuery,
      fetchImpl,
      getAuthToken,
      translate,
    });
    if (polled?.ready === true && polled?.fingerprintMatches === true) {
      return polled;
    }
    await delay(500);
  }
  return null;
}

/**
 * Run review-narrative-cache PUT only when needed; wait until generation completes.
 */
async function ensureReviewNarrativeCacheBeforeSave({
  documentId,
  userIdentity,
  structuredUserInfo,
  acceptedFields,
  langQuery,
  fetchImpl = fetch,
  getAuthToken = () => localStorage.getItem('token'),
  translate = (key) => key,
  documentCacheWarmTimeoutMs = DOCUMENT_CACHE_WARM_TIMEOUT_MS,
}) {
  const docId = documentId != null ? String(documentId).trim() : '';
  if (!docId) return;

  const pollParams = {
    documentId: docId,
    userIdentity,
    structuredUserInfo,
    acceptedFields,
    langQuery,
    fetchImpl,
    getAuthToken,
    translate,
  };

  const ready = await pollReviewNarrativeCacheReady({ ...pollParams, deadlineMs: documentCacheWarmTimeoutMs });
  if (ready) return ready;

  const warmRes = await fetchImpl(`/api/profile/review-narrative-cache?${langQuery}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify(
      buildReviewNarrativeCacheRequestBody({
        documentId: docId,
        userIdentity,
        structuredUserInfo,
        acceptedFields,
        awaitReady: true,
      })
    ),
  });
  await throwIfSaveNotOk(warmRes, translate);

  const warmed = await pollReviewNarrativeCacheReady({ ...pollParams, deadlineMs: documentCacheWarmTimeoutMs });
  if (warmed) return warmed;

  // Cache warm did not finish in time — proceed to review-save anyway. The server can apply
  // the cache incrementally or run full narrative normalization on the save request.
  console.warn(
    '[saveExtractedProfileReview] document narrative cache not ready before save; continuing to review-save'
  );
  return null;
}

/**
 * Check whether the document cache matches the save payload and is display-ready.
 */
async function fetchDocumentNarrativeCacheStatus({
  documentId,
  userIdentity,
  structuredUserInfo,
  acceptedFields,
  langQuery,
  fetchImpl = fetch,
  getAuthToken = () => localStorage.getItem('token'),
  translate = (key) => key,
}) {
  const docId = documentId != null ? String(documentId).trim() : '';
  if (!docId) return { ready: false, fingerprintMatches: false };

  const statusRes = await fetchImpl(
    `/api/documents/${encodeURIComponent(docId)}/narrative-cache-status?${langQuery}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify(
        buildReviewNarrativeCacheRequestBody({
          documentId: docId,
          userIdentity,
          structuredUserInfo,
          acceptedFields,
        })
      ),
    }
  );
  await throwIfSaveNotOk(statusRes, translate);
  return statusRes.json().catch(() => ({}));
}

/**
 * Pre-generate narratives while the user advances the review wizard (fire-and-forget).
 * Save uses ensureReviewNarrativeCacheBeforeSave (poll + single awaitReady warm) then fast review-save.
 */
async function warmReviewNarrativeCacheForStep({
  documentId,
  reviewProfile = {},
  acceptedFields = {},
  step,
  fetchImpl = fetch,
  getAuthToken = () => localStorage.getItem('token'),
  langQuery = '',
  translate = (key) => key,
  /** When true, block until cache is ready (save path only). Wizard uses fire-and-forget PUT. */
  awaitReady = false,
}) {
  const docId = documentId != null ? String(documentId).trim() : '';
  if (!docId || !step) return;

  const body = {
    acceptedFields: acceptedFields && typeof acceptedFields === 'object' ? acceptedFields : {},
  };
  if (step >= 3) {
    body.userIdentity = reviewProfile.userIdentity || {};
  }
  if (step >= 4) {
    body.structuredUserInfo = buildStructuredGoodAtFromReview(reviewProfile, acceptedFields);
  }

  const cachePayload = buildReviewNarrativeCacheRequestBody({
    documentId: docId,
    userIdentity: body.userIdentity,
    structuredUserInfo: body.structuredUserInfo,
    acceptedFields: body.acceptedFields,
    awaitReady,
  });

  try {
    if (step >= 4 && body.structuredUserInfo && awaitReady) {
      await ensureReviewNarrativeCacheBeforeSave({
        documentId: docId,
        userIdentity: body.userIdentity || {},
        structuredUserInfo: body.structuredUserInfo,
        acceptedFields: body.acceptedFields,
        langQuery,
        fetchImpl,
        getAuthToken,
        translate,
      });
      return;
    }
    await fetchImpl(`/api/profile/review-narrative-cache?${langQuery}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify(cachePayload),
    });
  } catch (err) {
    if (err instanceof ProfileReviewSaveError) throw err;
    // Non-fatal for mid-wizard warm (including step 4 context → seniority).
  }
}

module.exports = {
  ProfileReviewSaveError,
  USER_IDENTITY_KEYS,
  buildReviewSaveUserMessage,
  isReviewUserIdentityComplete,
  saveExtractedProfileReview,
  warmReviewNarrativeCacheForStep,
  ensureReviewNarrativeCacheBeforeSave,
  fetchDocumentNarrativeCacheStatus,
  waitForDocumentNarrativeCache,
  waitForProfileNarrativesReady,
  seedProfileCacheFromReviewSave,
  prefetchProfileCacheAfterSave,
  throwIfSaveNotOk,
  translateReviewFieldErrors,
};
