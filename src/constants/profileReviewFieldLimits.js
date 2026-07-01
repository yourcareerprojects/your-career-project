/** Mirrors express-validator limits on PUT /api/profile/review-save (profile routes). */
const PROFILE_REVIEW_USER_IDENTITY_MAX = 2000;

const PROFILE_REVIEW_STRUCTURED_MAX = {
  skillDomains: 120,
  skills: 100,
  skillsInDevelopment: 100,
  keyResponsibilities: 300,
  domains: 120,
};

const PROFILE_REVIEW_STRUCTURED_KEYS = Object.keys(PROFILE_REVIEW_STRUCTURED_MAX);

/** Max rows per list in “What are you good at?” (review + save). */
const PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY = 25;

/**
 * UI list caps per structured dimension (aligned with coaching + pickers).
 * Each value must be ≤ PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY.
 */
const PROFILE_STRUCTURED_LIST_MAX_ITEMS = {
  skillDomains: 5,
  domains: 5,
  keyResponsibilities: 25,
  skills: 25,
  skillsInDevelopment: 25,
};

function getProfileStructuredListMaxItems(dimensionKey) {
  const key = String(dimensionKey || '').trim();
  return PROFILE_STRUCTURED_LIST_MAX_ITEMS[key] ?? PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY;
}

module.exports = {
  PROFILE_REVIEW_USER_IDENTITY_MAX,
  PROFILE_REVIEW_STRUCTURED_MAX,
  PROFILE_REVIEW_STRUCTURED_KEYS,
  PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY,
  PROFILE_STRUCTURED_LIST_MAX_ITEMS,
  getProfileStructuredListMaxItems,
};
