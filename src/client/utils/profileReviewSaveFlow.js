const { validateSeniorityPayload, seniorityPayloadsMatch } = require('./validateSeniorityPayload');
const {
  detectPendingNarrativesFromProfile,
  resolveNarrativePendingFromProfileResponse,
} = require('./profileNarrativePolling');
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
const PROFILE_NARRATIVE_POLL_MAX_ATTEMPTS = 120;
const DOCUMENT_CACHE_POLL_MAX_ATTEMPTS = 240;
/** Brief pre-save poll when nothing is in flight on the server. */
const DOCUMENT_CACHE_PRE_SAVE_POLL_MS = 1500;
/** Wait for step-5 / server in-flight narrative work before starting a duplicate warm. */
const DOCUMENT_CACHE_INFLIGHT_POLL_MS = 45000;
/** Step-5 UI may show a slow warning after this; warm itself is not cut off at this mark. */
const WIZARD_NARRATIVE_WARM_SLOW_WARNING_MS = 60_000;

/** @type {Map<string, Promise<unknown>>} */
const narrativeWarmInflightByKey = new Map();

function buildNarrativeWarmRegistryKey(documentId, userIdentity, structuredUserInfo, acceptedFields) {
  return JSON.stringify({
    documentId: String(documentId || '').trim(),
    userIdentity: userIdentity && typeof userIdentity === 'object' ? userIdentity : {},
    structuredUserInfo:
      structuredUserInfo && typeof structuredUserInfo === 'object' ? structuredUserInfo : {},
    acceptedFields: acceptedFields && typeof acceptedFields === 'object' ? acceptedFields : {},
  });
}

function getOrCreateNarrativeWarmWork(registryKey, workFactory) {
  const existing = narrativeWarmInflightByKey.get(registryKey);
  if (existing) return existing;
  const promise = Promise.resolve()
    .then(workFactory)
    .finally(() => {
      if (narrativeWarmInflightByKey.get(registryKey) === promise) {
        narrativeWarmInflightByKey.delete(registryKey);
      }
    });
  narrativeWarmInflightByKey.set(registryKey, promise);
  return promise;
}

async function awaitRegisteredNarrativeWarm(registryKey) {
  const inflight = narrativeWarmInflightByKey.get(registryKey);
  if (!inflight) return;
  try {
    await inflight;
  } catch {
    // Wizard warm failures are non-fatal; save will poll or warm once.
  }
}

function isNarrativeCacheStatusReady(status) {
  return status?.ready === true && status?.fingerprintMatches === true;
}

/** No enrichment persisted yet — safe to start (or restart) warm after a brief poll. */
function isNarrativeCacheAbsent(status) {
  if (status?.ready === true || status?.inFlight === true) return false;
  const pending = Array.isArray(status?.pending) ? status.pending : [];
  if (pending.length === 0) return true;
  return pending.length === 1 && pending[0] === 'narrativeEnrichment';
}

/** Narrative sections we can detect as complete via narrative-cache-status `pending`. */
const NARRATIVE_WARM_TRACKABLE_COUNT = 6;
/** Typical full-regen duration used for linear fallback progress on step 5. */
const NARRATIVE_WARM_EXPECTED_MS = 30000;

/**
 * Estimate warm progress (0–100) for step-5 UI.
 * Server `pending` lists incomplete dimensions only after partial cache is persisted.
 * Full regen runs as one LLM job and writes atomically, so there is no % until then.
 */
function computeNarrativeWarmProgressEstimate(status, elapsedMs = 0) {
  if (isNarrativeCacheStatusReady(status)) {
    return 100;
  }

  const pending = Array.isArray(status?.pending) ? status.pending : [];
  const trackablePending = pending.filter(
    (item) => item.startsWith('structuredUserInfo.') || item === 'who_are_you'
  );

  let serverProgress = null;
  if (trackablePending.length > 0) {
    const completed = NARRATIVE_WARM_TRACKABLE_COUNT - trackablePending.length;
    serverProgress = Math.round((completed / NARRATIVE_WARM_TRACKABLE_COUNT) * 92);
  }

  const timeProgress = Math.min(
    90,
    Math.round(8 + (Math.max(0, elapsedMs) / NARRATIVE_WARM_EXPECTED_MS) * 82)
  );

  if (serverProgress != null) {
    return Math.max(serverProgress, timeProgress);
  }
  return timeProgress;
}

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
  pollMaxAttempts = PROFILE_NARRATIVE_POLL_MAX_ATTEMPTS,
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
 * After a fast profile section save, poll until narratives are ready then run `onReady`.
 * Non-blocking when used via `scheduleProfileNarrativeRefreshAfterSave`.
 */
async function refreshProfileWhenNarrativesReady({
  langQuery,
  fetchImpl = fetch,
  getAuthToken = () => localStorage.getItem('token'),
  onReady,
  onPendingUpdate,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  pollMaxAttempts = PROFILE_NARRATIVE_POLL_MAX_ATTEMPTS,
}) {
  for (let attempt = 0; attempt < pollMaxAttempts; attempt += 1) {
    const status = await fetchProfileNarrativesStatus({
      langQuery,
      fetchImpl,
      getAuthToken,
    });
    if (status.ready) {
      if (typeof onPendingUpdate === 'function') {
        onPendingUpdate([]);
      }
      if (typeof onReady === 'function') {
        await onReady();
      }
      return;
    }
    if (typeof onPendingUpdate === 'function') {
      onPendingUpdate(status.pending);
    }
    if (attempt < pollMaxAttempts - 1) {
      await delay(pollIntervalMs);
    }
  }
  throw new ProfileReviewSaveError('Narrative readiness timed out', {
    userMessage: 'Profile narratives are still being prepared. Please try again in a moment.',
  });
}

function scheduleProfileNarrativeRefreshAfterSave({
  narrativesReady,
  narrativePending,
  langQuery,
  onReady,
  onPendingUpdate,
  fetchImpl = fetch,
  getAuthToken = () => localStorage.getItem('token'),
}) {
  const pending = Array.isArray(narrativePending) ? narrativePending : [];
  if (narrativesReady !== false && pending.length === 0) return;
  if (typeof onPendingUpdate === 'function') {
    onPendingUpdate(pending);
  }
  void refreshProfileWhenNarrativesReady({
    langQuery,
    fetchImpl,
    getAuthToken,
    onReady,
    onPendingUpdate,
  }).catch((err) => {
    console.warn('Background profile narrative refresh failed:', err);
  });
}

async function fetchProfileNarrativesStatus({
  langQuery,
  fetchImpl = fetch,
  getAuthToken = () => localStorage.getItem('token'),
} = {}) {
  const res = await fetchImpl(`/api/profile/narratives-status?${langQuery}`, {
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || 'Failed to read narrative status');
    err.status = res.status;
    throw err;
  }
  return {
    ready: data.ready === true,
    pending: Array.isArray(data.pending) ? data.pending : [],
  };
}

/**
 * Merge server structuredUserInfo with the review dialog lists so profile chips render
 * immediately after save (before GET /api/profile finishes).
 */
function mergeStructuredUserInfoForProfileSeed(serverStructured = {}, reviewStructured = {}) {
  const STRUCTURED_LIST_KEYS = [
    'skillDomains',
    'skills',
    'skillsInDevelopment',
    'keyResponsibilities',
    'domains',
  ];
  const readRawItems = (value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && Array.isArray(value.raw_items)) return value.raw_items;
    return [];
  };

  const server = serverStructured && typeof serverStructured === 'object' ? serverStructured : {};
  const review = reviewStructured && typeof reviewStructured === 'object' ? reviewStructured : {};
  const out = { ...server };

  for (const key of STRUCTURED_LIST_KEYS) {
    const serverDim = server[key];
    const serverRaw = readRawItems(serverDim);
    const reviewRaw = readRawItems(review[key]);
    const rawItems = serverRaw.length > 0 ? serverRaw : reviewRaw;
    if (rawItems.length === 0 && serverDim == null) continue;

    const baseDim = typeof serverDim === 'object' && !Array.isArray(serverDim) ? serverDim : {};
    out[key] = {
      ...baseDim,
      raw_items: rawItems,
    };
  }

  return out;
}

/**
 * Seed React Query from review-save response so Profile can render immediately.
 */
function seedProfileCacheFromReviewSave(reviewSaveData, langQuery, queryClientImpl, reviewSnapshot = {}) {
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

  const mergedStructuredUserInfo = mergeStructuredUserInfoForProfileSeed(
    reviewSaveData?.structuredUserInfo || baseProfile.structuredUserInfo,
    reviewSnapshot?.structuredUserInfo
  );
  const cvExtractLocalization =
    reviewSnapshot?.__cvExtractLocalization && typeof reviewSnapshot.__cvExtractLocalization === 'object'
      ? reviewSnapshot.__cvExtractLocalization
      : baseProfile.cvExtractLocalization;

  invalidateProfileCompletionQuery();
  resolveQueryClient.setQueryData(getProfileFullQueryKeyFull(lang), {
    ...base,
    success: true,
    /** Profile page renders from this immediately; refreshes full GET in the background. */
    _seededFromReviewSave: true,
    narrativesReady: reviewSaveData?.narrativesReady === true,
    narrativePending: Array.isArray(reviewSaveData?.narrativePending)
      ? reviewSaveData.narrativePending
      : [],
    name: reviewSaveData?.name ?? base.name,
    email: reviewSaveData?.email ?? base.email,
    profile: {
      ...baseProfile,
      seniority: reviewSaveData?.seniority ?? baseProfile.seniority,
      userIdentity: reviewSaveData?.userIdentity ?? baseProfile.userIdentity,
      who_are_you: reviewSaveData?.who_are_you ?? baseProfile.who_are_you,
      structuredUserInfo: mergedStructuredUserInfo,
      ...(cvExtractLocalization ? { cvExtractLocalization } : {}),
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
  pollIntervalMs: _pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  pollMaxAttempts: _pollMaxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
  documentCacheWarmTimeoutMs: _documentCacheWarmTimeoutMs = DOCUMENT_CACHE_INFLIGHT_POLL_MS,
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

  if (typeof refreshUser === 'function') {
    const authRefresh = await refreshUser();
    if (!authRefresh.success && !authRefresh.skipped) {
      throw new ProfileReviewSaveError('Session expired', {
        userMessage: translate('profileCreation.errors.sessionExpired'),
      });
    }
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
  seedProfileCacheFromReviewSave(reviewSaveData, langQuery, queryClientImpl, profileData);
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
  deadlineMs = DOCUMENT_CACHE_PRE_SAVE_POLL_MS,
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
    // Cache exists but does not match save payload — polling cannot fix fingerprint drift.
    if (polled?.ready === true && polled?.fingerprintMatches === false) {
      return null;
    }
    await delay(500);
  }
  return null;
}

/**
 * Blocking warm: PUT review-narrative-cache with awaitReady so LLM runs here, not inside review-save.
 */
async function requestReviewNarrativeCacheAwaitReady({
  documentId,
  userIdentity = {},
  structuredUserInfo = {},
  acceptedFields = {},
  langQuery,
  fetchImpl = fetch,
  getAuthToken = () => localStorage.getItem('token'),
  translate = (key) => key,
}) {
  const docId = documentId != null ? String(documentId).trim() : '';
  if (!docId) return null;

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
  return warmRes.json().catch(() => ({}));
}

async function runEnsureReviewNarrativeCacheBeforeSave({
  documentId,
  userIdentity,
  structuredUserInfo,
  acceptedFields,
  langQuery,
  fetchImpl,
  getAuthToken,
  translate,
  documentCacheWarmTimeoutMs,
  skipBriefPoll,
}) {
  const docId = documentId != null ? String(documentId).trim() : '';
  if (!docId) return;

  const cacheParams = {
    documentId: docId,
    userIdentity,
    structuredUserInfo,
    acceptedFields,
    langQuery,
    fetchImpl,
    getAuthToken,
    translate,
  };

  const registryKey = buildNarrativeWarmRegistryKey(
    docId,
    userIdentity,
    structuredUserInfo,
    acceptedFields
  );

  if (skipBriefPoll) {
    try {
      const warmResult = await requestReviewNarrativeCacheAwaitReady(cacheParams);
      if (warmResult?.ready === true) {
        return { ...warmResult, fingerprintMatches: true };
      }
      const verified = await fetchDocumentNarrativeCacheStatus(cacheParams);
      if (isNarrativeCacheStatusReady(verified)) {
        return verified;
      }
    } catch (err) {
      if (err instanceof ProfileReviewSaveError) throw err;
      console.warn(
        '[saveExtractedProfileReview] awaitReady narrative cache warm failed:',
        err?.message || err
      );
    }
    console.warn(
      '[saveExtractedProfileReview] document narrative cache not ready after awaitReady warm; continuing to review-save'
    );
    return null;
  }

  // Save joins step-5 wizard warm before polling or starting duplicate work.
  await awaitRegisteredNarrativeWarm(registryKey);

  let status = await fetchDocumentNarrativeCacheStatus(cacheParams);
  if (isNarrativeCacheStatusReady(status)) return status;

  if (status?.ready === true && status?.fingerprintMatches === false) {
    // Mismatch — polling cannot help; go straight to sync warm below.
  } else {
    const pollDeadlineMs = status?.inFlight
      ? DOCUMENT_CACHE_INFLIGHT_POLL_MS
      : (isNarrativeCacheAbsent(status)
        ? DOCUMENT_CACHE_PRE_SAVE_POLL_MS
        : documentCacheWarmTimeoutMs);
    const polled = await pollReviewNarrativeCacheReady({
      ...cacheParams,
      deadlineMs: pollDeadlineMs,
    });
    if (polled) return polled;

    status = await fetchDocumentNarrativeCacheStatus(cacheParams);
    if (isNarrativeCacheStatusReady(status)) return status;

    if (status?.inFlight) {
      const inflightPolled = await pollReviewNarrativeCacheReady({
        ...cacheParams,
        deadlineMs: DOCUMENT_CACHE_INFLIGHT_POLL_MS,
      });
      if (inflightPolled) return inflightPolled;
    }
  }

  try {
    const warmResult = await requestReviewNarrativeCacheAwaitReady(cacheParams);
    if (warmResult?.ready === true) {
      return { ...warmResult, fingerprintMatches: true };
    }

    const verified = await fetchDocumentNarrativeCacheStatus(cacheParams);
    if (isNarrativeCacheStatusReady(verified)) {
      return verified;
    }
  } catch (err) {
    if (err instanceof ProfileReviewSaveError) throw err;
    console.warn(
      '[saveExtractedProfileReview] awaitReady narrative cache warm failed:',
      err?.message || err
    );
  }

  console.warn(
    '[saveExtractedProfileReview] document narrative cache not ready after awaitReady warm; continuing to review-save'
  );
  return null;
}

/**
 * Join step-5 wizard warm, poll while server work is in flight, then one awaitReady warm if needed.
 */
async function ensureReviewNarrativeCacheBeforeSave(options = {}) {
  const docId = options.documentId != null ? String(options.documentId).trim() : '';
  if (!docId) return;

  const registryKey = buildNarrativeWarmRegistryKey(
    docId,
    options.userIdentity,
    options.structuredUserInfo,
    options.acceptedFields
  );

  if (options.skipBriefPoll) {
    return getOrCreateNarrativeWarmWork(registryKey, () =>
      runEnsureReviewNarrativeCacheBeforeSave(options)
    );
  }

  return runEnsureReviewNarrativeCacheBeforeSave(options);
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
 * Pre-generate narratives while the user advances the review wizard.
 * Steps 3–4: fire-and-forget PUT. Step 5: awaitReady warm in the background while seniority is filled.
 * Save: ensureReviewNarrativeCacheBeforeSave (brief poll + single awaitReady warm) then fast review-save.
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
  /** When true, blocking warm (wizard step 5 background + save fallback). */
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

  const registryKey = buildNarrativeWarmRegistryKey(
    docId,
    body.userIdentity,
    body.structuredUserInfo,
    body.acceptedFields
  );
  const cacheParams = {
    documentId: docId,
    userIdentity: body.userIdentity || {},
    structuredUserInfo: body.structuredUserInfo || {},
    acceptedFields: body.acceptedFields,
    langQuery,
    fetchImpl,
    getAuthToken,
    translate,
  };

  const runBackgroundNarrativeWarm = async () => {
    let status = await fetchDocumentNarrativeCacheStatus(cacheParams);
    if (isNarrativeCacheStatusReady(status)) return status;

    const warmRes = await fetchImpl(`/api/profile/review-narrative-cache?${langQuery}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify(cachePayload),
    });
    await throwIfSaveNotOk(warmRes, translate);
    const warmData = await warmRes.json().catch(() => ({}));
    if (warmData?.ready === true) {
      return { ...warmData, fingerprintMatches: true };
    }

    status = await fetchDocumentNarrativeCacheStatus(cacheParams);
    if (isNarrativeCacheStatusReady(status)) return status;

    const polled = await pollReviewNarrativeCacheReady({
      ...cacheParams,
      deadlineMs: DOCUMENT_CACHE_INFLIGHT_POLL_MS,
    });
    return polled;
  };

  const pollNarrativeCacheUntilReady = async (initialStatus) => {
    let status = initialStatus;
    if (isNarrativeCacheStatusReady(status)) return status;

    if (status?.ready !== true || status?.fingerprintMatches !== false) {
      const pollDeadlineMs =
        status?.inFlight
        || (awaitReady && !isNarrativeCacheAbsent(status))
          ? DOCUMENT_CACHE_INFLIGHT_POLL_MS
          : DOCUMENT_CACHE_PRE_SAVE_POLL_MS;
      const polled = await pollReviewNarrativeCacheReady({
        ...cacheParams,
        deadlineMs: pollDeadlineMs,
      });
      if (polled) return polled;

      status = await fetchDocumentNarrativeCacheStatus(cacheParams);
      if (isNarrativeCacheStatusReady(status)) return status;

      if (status?.inFlight) {
        const inflightPolled = await pollReviewNarrativeCacheReady({
          ...cacheParams,
          deadlineMs: DOCUMENT_CACHE_INFLIGHT_POLL_MS,
        });
        if (inflightPolled) return inflightPolled;
      }
    }
    return null;
  };

  try {
    if (awaitReady) {
      await getOrCreateNarrativeWarmWork(registryKey, async () => {
        const initialStatus = await fetchDocumentNarrativeCacheStatus(cacheParams);
        const polledReady = await pollNarrativeCacheUntilReady(initialStatus);
        if (polledReady) return polledReady;

        return runEnsureReviewNarrativeCacheBeforeSave({
          ...cacheParams,
          skipBriefPoll: true,
        });
      });
      return;
    }
    void getOrCreateNarrativeWarmWork(registryKey, async () => {
      try {
        return await runBackgroundNarrativeWarm();
      } catch (err) {
        if (err instanceof ProfileReviewSaveError) throw err;
        return null;
      }
    });
  } catch (err) {
    if (err instanceof ProfileReviewSaveError) throw err;
    // Non-fatal for mid-wizard warm (including step 4 context → seniority).
  }
}

/** Test-only: await and clear in-flight narrative warm registry entries. */
async function flushNarrativeWarmRegistryForTests() {
  const pending = [...narrativeWarmInflightByKey.values()];
  narrativeWarmInflightByKey.clear();
  await Promise.allSettled(pending);
}

module.exports = {
  ProfileReviewSaveError,
  USER_IDENTITY_KEYS,
  buildReviewSaveUserMessage,
  isReviewUserIdentityComplete,
  saveExtractedProfileReview,
  warmReviewNarrativeCacheForStep,
  ensureReviewNarrativeCacheBeforeSave,
  requestReviewNarrativeCacheAwaitReady,
  fetchDocumentNarrativeCacheStatus,
  flushNarrativeWarmRegistryForTests,
  computeNarrativeWarmProgressEstimate,
  WIZARD_NARRATIVE_WARM_SLOW_WARNING_MS,
  mergeStructuredUserInfoForProfileSeed,
  waitForDocumentNarrativeCache,
  waitForProfileNarrativesReady,
  refreshProfileWhenNarrativesReady,
  scheduleProfileNarrativeRefreshAfterSave,
  fetchProfileNarrativesStatus,
  PROFILE_NARRATIVE_POLL_MAX_ATTEMPTS,
  detectPendingNarrativesFromProfile,
  resolveNarrativePendingFromProfileResponse,
  seedProfileCacheFromReviewSave,
  prefetchProfileCacheAfterSave,
  throwIfSaveNotOk,
  translateReviewFieldErrors,
};
