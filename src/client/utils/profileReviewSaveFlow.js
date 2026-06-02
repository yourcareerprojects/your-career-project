const { validateSeniorityPayload, seniorityPayloadsMatch } = require('./validateSeniorityPayload');
const {
  validateReviewSavePayload,
  validateReviewIdentityStep,
  parseReviewSaveValidationErrors,
  translateReviewFieldErrors,
} = require('./validateReviewProfilePayload');

const USER_IDENTITY_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

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
}) {
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
      ...(cvExtractLocalization ? { cvExtractLocalization } : {}),
    }),
  });
  await throwIfSaveNotOk(reviewSaveRes, translate);
  const reviewSaveData = await reviewSaveRes.json().catch(() => ({}));
  if (!seniorityPayloadsMatch(normalizedSeniority, reviewSaveData?.seniority || {})) {
    throw new Error('Seniority fields were not persisted correctly. Please try saving again.');
  }

  return { reviewSaveData, normalizedSeniority };
}

module.exports = {
  ProfileReviewSaveError,
  USER_IDENTITY_KEYS,
  buildReviewSaveUserMessage,
  isReviewUserIdentityComplete,
  saveExtractedProfileReview,
  throwIfSaveNotOk,
  translateReviewFieldErrors,
};
