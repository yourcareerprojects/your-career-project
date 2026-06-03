/** Identity fields included in step 3 input-quality diagnosis (server REVIEW_STEP3 set). */
const QUALITY_DIAGNOSIS_IDENTITY_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

/**
 * @param {object} [profile]
 * @returns {{ userIdentity: Record<string, string>, structuredUserInfo: { keyResponsibilities: string[], skillsInDevelopment: string[] } }}
 */
function qualityDiagnosisInputFromProfile(profile = {}) {
  const srcIdentity = profile?.userIdentity && typeof profile.userIdentity === 'object' ? profile.userIdentity : {};
  const srcStructured = profile?.structuredUserInfo && typeof profile.structuredUserInfo === 'object'
    ? profile.structuredUserInfo
    : {};
  const userIdentity = {};
  for (const key of QUALITY_DIAGNOSIS_IDENTITY_KEYS) {
    userIdentity[key] = String(srcIdentity[key] || '').trim();
  }
  return {
    userIdentity,
    structuredUserInfo: {
      keyResponsibilities: Array.isArray(srcStructured.keyResponsibilities)
        ? srcStructured.keyResponsibilities.map((v) => String(v || '').trim()).filter(Boolean)
        : [],
      skillsInDevelopment: Array.isArray(srcStructured.skillsInDevelopment)
        ? srcStructured.skillsInDevelopment.map((v) => String(v || '').trim()).filter(Boolean)
        : [],
    },
  };
}

/**
 * Stable cache key for diagnosis prefetch (identity + responsibilities + learning goals + lang).
 *
 * @param {object} [profile]
 * @param {string} [uiLangCode]
 * @returns {string}
 */
function qualityDiagnosisFingerprint(profile = {}, uiLangCode = 'en') {
  return JSON.stringify({
    lang: String(uiLangCode || 'en').toLowerCase().split('-')[0] || 'en',
    ...qualityDiagnosisInputFromProfile(profile),
  });
}

/**
 * @param {number} reviewStep
 * @returns {number}
 */
function inputQualityDiagnosisPrefetchDebounceMs(reviewStep) {
  return reviewStep === 3 ? 250 : 0;
}

const MAX_CLIENT_DIAGNOSIS_CACHE_ENTRIES = 12;

/**
 * @param {Map<string, { followUps: object[] }>} map
 * @returns {Record<string, { followUps: object[] }>}
 */
function diagnosisCacheMapToDraft(map) {
  /** @type {Record<string, { followUps: object[] }>} */
  const out = {};
  if (!map || typeof map.entries !== 'function') return out;
  for (const [key, value] of map.entries()) {
    if (value && Array.isArray(value.followUps) && value.followUps.length > 0) {
      out[key] = { followUps: value.followUps };
    }
  }
  return out;
}

/**
 * @param {unknown} draftObj
 * @returns {Map<string, { followUps: object[] }>}
 */
function diagnosisCacheMapFromDraft(draftObj) {
  const map = new Map();
  if (!draftObj || typeof draftObj !== 'object' || Array.isArray(draftObj)) return map;
  for (const [key, value] of Object.entries(draftObj)) {
    if (value && typeof value === 'object' && Array.isArray(value.followUps) && value.followUps.length > 0) {
      map.set(key, { followUps: value.followUps });
    }
  }
  return map;
}

/**
 * @param {Map<string, { followUps: object[] }>} map
 * @param {number} [maxEntries]
 */
function trimDiagnosisCacheMap(map, maxEntries = MAX_CLIENT_DIAGNOSIS_CACHE_ENTRIES) {
  if (!map || typeof map.entries !== 'function') return;
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

module.exports = {
  QUALITY_DIAGNOSIS_IDENTITY_KEYS,
  qualityDiagnosisInputFromProfile,
  qualityDiagnosisFingerprint,
  inputQualityDiagnosisPrefetchDebounceMs,
  diagnosisCacheMapToDraft,
  diagnosisCacheMapFromDraft,
  trimDiagnosisCacheMap,
  MAX_CLIENT_DIAGNOSIS_CACHE_ENTRIES,
};
