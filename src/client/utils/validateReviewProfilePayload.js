const {
  PROFILE_REVIEW_USER_IDENTITY_MAX,
  PROFILE_REVIEW_STRUCTURED_MAX,
  PROFILE_REVIEW_STRUCTURED_KEYS,
  PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY,
} = require('../../constants/profileReviewFieldLimits');
const { normalizeStructuredListItemLabel } = require('../../constants/structuredListItemLabel');

const USER_IDENTITY_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

const STRUCTURED_I18N_CATEGORY = {
  skillDomains: 'skillDomains',
  domains: 'domains',
  keyResponsibilities: 'keyResponsibilities',
  skills: 'skills',
  skillsInDevelopment: 'skillsInDevelopment',
};

/**
 * @typedef {{ i18nKey: string, params?: Record<string, unknown> }} ReviewFieldErrorSpec
 */

/**
 * @param {string} fieldKey
 * @param {ReviewFieldErrorSpec} spec
 * @param {Record<string, ReviewFieldErrorSpec>} fieldErrors
 */
function addFieldError(fieldErrors, fieldKey, spec) {
  if (!fieldErrors[fieldKey]) fieldErrors[fieldKey] = spec;
}

/** Only checked rows with non-empty trimmed values; unchecked rows omitted. */
function buildStructuredGoodAtFromReview(reviewProfile, acceptedFields = {}) {
  const structuredUserInfo = reviewProfile?.structuredUserInfo || {};

  const pickStrings = (key) => {
    const items = structuredUserInfo[key] || [];
    const out = [];
    for (let i = 0; i < items.length && out.length < PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY; i += 1) {
      if (acceptedFields[`structuredUserInfo.${key}.${i}`] === false) continue;
      const v = normalizeStructuredListItemLabel(items[i]);
      if (v) out.push(v);
    }
    return out;
  };

  return {
    skillDomains: pickStrings('skillDomains'),
    domains: pickStrings('domains'),
    keyResponsibilities: pickStrings('keyResponsibilities'),
    skillsInDevelopment: pickStrings('skillsInDevelopment'),
    skills: pickStrings('skills'),
  };
}

function countStructuredGoodAtItems(structuredUserInfo = {}) {
  let count = 0;
  for (const arrayKey of PROFILE_REVIEW_STRUCTURED_KEYS) {
    const items = structuredUserInfo[arrayKey];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (normalizeStructuredListItemLabel(item)) count += 1;
    }
  }
  return count;
}

function countCategoryItems(structuredUserInfo, arrayKey) {
  const items = structuredUserInfo?.[arrayKey];
  if (!Array.isArray(items)) return 0;
  let count = 0;
  for (const item of items) {
    if (normalizeStructuredListItemLabel(item)) count += 1;
  }
  return count;
}

/** Each “What are you good at?” subcategory needs ≥1 accepted non-empty entry. */
function validateAllGoodAtCategoriesFilled(reviewProfile = {}, acceptedFields = {}) {
  const fieldErrors = {};
  const built = buildStructuredGoodAtFromReview(reviewProfile, acceptedFields);
  for (const arrayKey of PROFILE_REVIEW_STRUCTURED_KEYS) {
    const items = built[arrayKey];
    const len = Array.isArray(items) ? items.length : 0;
    if (len === 0) {
      addFieldError(fieldErrors, `structuredUserInfo.${arrayKey}`, {
        i18nKey: 'documentUpload.review.errors.structuredCategoryRequired',
        params: { category: STRUCTURED_I18N_CATEGORY[arrayKey] || arrayKey },
      });
    }
  }
  return fieldErrors;
}

function validateSavePayloadCategoriesRequired(structuredUserInfo = {}, fieldErrors) {
  for (const arrayKey of PROFILE_REVIEW_STRUCTURED_KEYS) {
    if (countCategoryItems(structuredUserInfo, arrayKey) === 0) {
      addFieldError(fieldErrors, `structuredUserInfo.${arrayKey}`, {
        i18nKey: 'documentUpload.review.errors.structuredCategoryRequired',
        params: { category: STRUCTURED_I18N_CATEGORY[arrayKey] || arrayKey },
      });
    }
  }
}

/**
 * @param {object} userIdentity
 * @param {Record<string, ReviewFieldErrorSpec>} fieldErrors
 */
function validateUserIdentityLengths(userIdentity = {}, fieldErrors) {
  for (const key of USER_IDENTITY_KEYS) {
    const text = String(userIdentity[key] || '');
    if (text.length > PROFILE_REVIEW_USER_IDENTITY_MAX) {
      addFieldError(fieldErrors, `userIdentity.${key}`, {
        i18nKey: 'documentUpload.review.errors.identityMaxLength',
        params: { max: PROFILE_REVIEW_USER_IDENTITY_MAX },
      });
    }
  }
}

/** Each identity prompt must have a non-empty trimmed answer (review step 2). */
function validateUserIdentityRequired(userIdentity = {}, fieldErrors) {
  for (const key of USER_IDENTITY_KEYS) {
    if (!String(userIdentity[key] || '').trim()) {
      addFieldError(fieldErrors, `userIdentity.${key}`, {
        i18nKey: 'documentUpload.review.errors.identityRequired',
        params: { questionKey: `identityQuestions.${key}` },
      });
    }
  }
}

/**
 * Validate step 2 identity answers (required + max length).
 * @param {{ userIdentity?: object }} reviewProfile
 */
function validateReviewIdentityStep(reviewProfile = {}) {
  const fieldErrors = {};
  const userIdentity = reviewProfile.userIdentity || {};
  validateUserIdentityRequired(userIdentity, fieldErrors);
  validateUserIdentityLengths(userIdentity, fieldErrors);
  const firstField = Object.keys(fieldErrors)[0] || null;
  return {
    ok: firstField === null,
    fieldErrors,
    firstField,
    focusStep: resolveReviewFocusStep(firstField),
  };
}

/**
 * @param {string} arrayKey
 * @param {number} index
 * @param {string} value
 * @param {Record<string, ReviewFieldErrorSpec>} fieldErrors
 */
/** Map a review field key to wizard step (2=identity, 3=good at, 4=context, 5=seniority). */
function resolveReviewFocusStep(fieldKey) {
  if (!fieldKey || typeof fieldKey !== 'string') return 2;
  if (fieldKey.startsWith('userIdentity.')) return 2;
  if (fieldKey === 'structuredUserInfo' || fieldKey.startsWith('structuredUserInfo.')) return 3;
  if (fieldKey.startsWith('seniority.')) return 5;
  return 4;
}

function validateStructuredItemLength(arrayKey, index, value, fieldErrors) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return;
  const max = PROFILE_REVIEW_STRUCTURED_MAX[arrayKey];
  if (trimmed.length <= max) return;
  addFieldError(fieldErrors, `structuredUserInfo.${arrayKey}.${index}`, {
    i18nKey: 'documentUpload.review.errors.structuredItemMaxLength',
    params: {
      category: STRUCTURED_I18N_CATEGORY[arrayKey] || arrayKey,
      index: index + 1,
      max,
      length: trimmed.length,
    },
  });
}

/**
 * Validate structured rows that will be submitted (post buildStructuredGoodAtFromReview shape).
 * @param {object} structuredUserInfo
 * @param {Record<string, ReviewFieldErrorSpec>} fieldErrors
 */
function validateStructuredPayloadLengths(structuredUserInfo = {}, fieldErrors) {
  for (const arrayKey of PROFILE_REVIEW_STRUCTURED_KEYS) {
    const items = structuredUserInfo[arrayKey];
    if (!Array.isArray(items)) continue;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const raw = normalizeStructuredListItemLabel(item);
      validateStructuredItemLength(arrayKey, i, raw, fieldErrors);
    }
  }
}

/**
 * Validate review dialog state (respects accepted-field checkboxes).
 * @param {object} reviewProfile
 * @param {Record<string, boolean>} acceptedFields
 * @param {{ requireGoodAt?: boolean }} [options]
 */
function validateReviewProfileInDialog(reviewProfile = {}, acceptedFields = {}, options = {}) {
  const fieldErrors = {};
  const isAccepted = (fieldKey) => acceptedFields[fieldKey] !== false;

  validateUserIdentityLengths(reviewProfile.userIdentity || {}, fieldErrors);

  const structured = reviewProfile.structuredUserInfo || {};
  for (const arrayKey of PROFILE_REVIEW_STRUCTURED_KEYS) {
    const items = structured[arrayKey] || [];
    for (let i = 0; i < items.length; i += 1) {
      const fieldKey = `structuredUserInfo.${arrayKey}.${i}`;
      if (!isAccepted(fieldKey)) continue;
      const item = items[i];
      const raw = normalizeStructuredListItemLabel(item);
      validateStructuredItemLength(arrayKey, i, raw, fieldErrors);
    }
  }

  if (options.requireGoodAt) {
    Object.assign(fieldErrors, validateAllGoodAtCategoriesFilled(reviewProfile, acceptedFields));
  }

  const firstField = Object.keys(fieldErrors)[0] || null;
  return {
    ok: firstField === null,
    fieldErrors,
    firstField,
    focusStep: resolveReviewFocusStep(firstField),
  };
}

/**
 * Validate payload passed to review-save API.
 * @param {{ userIdentity?: object, structuredUserInfo?: object }} payload
 */
function validateReviewSavePayload(payload = {}) {
  const fieldErrors = {};
  validateUserIdentityLengths(payload.userIdentity || {}, fieldErrors);
  validateStructuredPayloadLengths(payload.structuredUserInfo || {}, fieldErrors);
  validateSavePayloadCategoriesRequired(payload.structuredUserInfo || {}, fieldErrors);
  const firstField = Object.keys(fieldErrors)[0] || null;
  return {
    ok: firstField === null,
    fieldErrors,
    firstField,
    focusStep: resolveReviewFocusStep(firstField),
  };
}

/**
 * @param {string} path
 */
function normalizeValidatorPath(path) {
  if (!path || typeof path !== 'string') return '';
  return path.replace(/\[(\d+)\]/g, '.$1');
}

const SERVER_LABEL_TO_STRUCTURED_KEY = {
  'skill domains': 'skillDomains',
  skills: 'skills',
  'skills in development': 'skillsInDevelopment',
  'key responsibilities': 'keyResponsibilities',
  domains: 'domains',
  'industry sectors': 'domains',
};

/**
 * @param {Array<{ path?: string, param?: string, msg?: string }>} errors
 */
function parseReviewSaveValidationErrors(errors = []) {
  const fieldErrors = {};
  if (!Array.isArray(errors)) {
    return { fieldErrors, firstField: null, focusStep: 2 };
  }

  for (const err of errors) {
    const path = normalizeValidatorPath(err.path || err.param || '');
    const msg = String(err.msg || err.message || '').trim();
    if (!path && !msg) continue;

    if (path.startsWith('userIdentity.')) {
      const key = path.slice('userIdentity.'.length);
      if (USER_IDENTITY_KEYS.includes(key)) {
        addFieldError(fieldErrors, path, {
          i18nKey: 'documentUpload.review.errors.identityMaxLength',
          params: { max: PROFILE_REVIEW_USER_IDENTITY_MAX },
        });
      }
      continue;
    }

    const structuredCategoryMatch = path.match(/^structuredUserInfo\.([^.]+)$/);
    if (
      structuredCategoryMatch
      && PROFILE_REVIEW_STRUCTURED_KEYS.includes(structuredCategoryMatch[1])
    ) {
      const arrayKey = structuredCategoryMatch[1];
      addFieldError(fieldErrors, path, {
        i18nKey: 'documentUpload.review.errors.structuredCategoryRequired',
        params: { category: STRUCTURED_I18N_CATEGORY[arrayKey] || arrayKey },
      });
      continue;
    }

    const structuredMatch = path.match(/^structuredUserInfo\.([^.]+)\.(\d+)$/);
    if (structuredMatch) {
      const [, arrayKey, indexStr] = structuredMatch;
      if (PROFILE_REVIEW_STRUCTURED_KEYS.includes(arrayKey)) {
        addFieldError(fieldErrors, path, {
          i18nKey: 'documentUpload.review.errors.structuredItemMaxLength',
          params: {
            category: STRUCTURED_I18N_CATEGORY[arrayKey] || arrayKey,
            index: Number.parseInt(indexStr, 10) + 1,
            max: PROFILE_REVIEW_STRUCTURED_MAX[arrayKey],
          },
        });
      }
      continue;
    }

    const maxIdentity = msg.match(/at most (\d+) characters/i);
    if (maxIdentity && path.startsWith('userIdentity.')) {
      addFieldError(fieldErrors, path, {
        i18nKey: 'documentUpload.review.errors.identityMaxLength',
        params: { max: Number.parseInt(maxIdentity[1], 10) || PROFILE_REVIEW_USER_IDENTITY_MAX },
      });
      continue;
    }

    if (/at least one strength or skill entry is required/i.test(msg)) {
      addFieldError(fieldErrors, 'structuredUserInfo', {
        i18nKey: 'documentUpload.review.errors.structuredGoodAtRequired',
      });
      continue;
    }

    const categoryRequired = msg.match(/^(.+?) requires at least one entry$/i);
    if (categoryRequired) {
      const label = categoryRequired[1].trim().toLowerCase();
      const arrayKey = SERVER_LABEL_TO_STRUCTURED_KEY[label];
      if (arrayKey) {
        addFieldError(fieldErrors, `structuredUserInfo.${arrayKey}`, {
          i18nKey: 'documentUpload.review.errors.structuredCategoryRequired',
          params: { category: STRUCTURED_I18N_CATEGORY[arrayKey] || arrayKey },
        });
      }
      continue;
    }

    const structuredItem = msg.match(/^(.+?) item must be 1-(\d+) characters$/i);
    if (structuredItem) {
      const label = structuredItem[1].trim().toLowerCase();
      const max = Number.parseInt(structuredItem[2], 10);
      const arrayKey = SERVER_LABEL_TO_STRUCTURED_KEY[label];
      const indexMatch = path.match(/\.(\d+)$/);
      const index = indexMatch ? Number.parseInt(indexMatch[1], 10) : 0;
      if (arrayKey) {
        const fieldKey = path.includes('structuredUserInfo.')
          ? path
          : `structuredUserInfo.${arrayKey}.${index}`;
        addFieldError(fieldErrors, fieldKey, {
          i18nKey: 'documentUpload.review.errors.structuredItemMaxLength',
          params: {
            category: STRUCTURED_I18N_CATEGORY[arrayKey] || arrayKey,
            index: index + 1,
            max,
          },
        });
      }
    }
  }

  const firstField = Object.keys(fieldErrors)[0] || null;
  return {
    fieldErrors,
    firstField,
    focusStep: resolveReviewFocusStep(firstField),
  };
}

/**
 * @param {Record<string, ReviewFieldErrorSpec>} fieldErrors
 * @param {(key: string, params?: object) => string} translate
 */
function translateReviewFieldErrors(fieldErrors, translate) {
  const out = {};
  for (const [field, spec] of Object.entries(fieldErrors || {})) {
    const params = { ...(spec.params || {}) };
    if (params.category) {
      const categoryKey = `documentUpload.review.goodAtCategories.${params.category}`;
      const translatedCategory = translate(categoryKey);
      params.category = translatedCategory !== categoryKey ? translatedCategory : params.category;
    }
    if (params.questionKey) {
      const translatedQuestion = translate(params.questionKey);
      params.question =
        translatedQuestion !== params.questionKey ? translatedQuestion : params.questionKey;
      delete params.questionKey;
    }
    out[field] = translate(spec.i18nKey, params);
  }
  return out;
}

module.exports = {
  USER_IDENTITY_KEYS,
  PROFILE_REVIEW_USER_IDENTITY_MAX,
  PROFILE_REVIEW_STRUCTURED_MAX,
  resolveReviewFocusStep,
  buildStructuredGoodAtFromReview,
  countStructuredGoodAtItems,
  validateAllGoodAtCategoriesFilled,
  validateUserIdentityRequired,
  validateReviewIdentityStep,
  validateReviewProfileInDialog,
  validateReviewSavePayload,
  parseReviewSaveValidationErrors,
  translateReviewFieldErrors,
  normalizeValidatorPath,
};
