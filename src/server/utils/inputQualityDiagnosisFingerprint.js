/** @typedef {{ userIdentity?: object, structuredUserInfo?: object }} DiagnosisSnapshot */

const QUALITY_DIAGNOSIS_IDENTITY_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

/**
 * @param {DiagnosisSnapshot} [snapshot]
 */
function qualityDiagnosisInputFromSnapshot(snapshot = {}) {
  const srcIdentity =
    snapshot.userIdentity && typeof snapshot.userIdentity === 'object' ? snapshot.userIdentity : {};
  const srcStructured =
    snapshot.structuredUserInfo && typeof snapshot.structuredUserInfo === 'object'
      ? snapshot.structuredUserInfo
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
 * Stable cache key (content + lang). Must stay aligned with client `qualityDiagnosisFingerprint`.
 *
 * @param {DiagnosisSnapshot} [snapshot]
 * @param {string} [lang]
 * @returns {string}
 */
function qualityDiagnosisFingerprint(snapshot = {}, lang = 'en') {
  return JSON.stringify({
    lang: String(lang || 'en').toLowerCase().split('-')[0] || 'en',
    ...qualityDiagnosisInputFromSnapshot(snapshot),
  });
}

/**
 * @param {string|undefined|null} userId
 * @param {DiagnosisSnapshot} snapshot
 * @param {string} lang
 */
function inputQualityDiagnosisSessionCacheKey(userId, snapshot, lang) {
  return `${String(userId || 'anon')}:${qualityDiagnosisFingerprint(snapshot, lang)}`;
}

module.exports = {
  QUALITY_DIAGNOSIS_IDENTITY_KEYS,
  qualityDiagnosisInputFromSnapshot,
  qualityDiagnosisFingerprint,
  inputQualityDiagnosisSessionCacheKey,
};
