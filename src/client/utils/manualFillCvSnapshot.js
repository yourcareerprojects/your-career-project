const USER_IDENTITY_HINT_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

const { normalizeGermanCvResponsibilityList } = require('../../constants/normalizeGermanCvResponsibilities');

function hasNonEmptyString(value) {
  return String(value || '').trim().length > 0;
}

function normalizeStringList(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (typeof item === 'string' ? item : item?.name || ''))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

/**
 * Build identity hints from extracted profile (coaching prompts only — not reviewProfile.userIdentity).
 * @param {object|null|undefined} extractedProfile
 */
function buildIdentityHintsFromExtractedProfile(extractedProfile) {
  const userIdentity = extractedProfile?.userIdentity && typeof extractedProfile.userIdentity === 'object'
    ? extractedProfile.userIdentity
    : {};
  const hints = {};
  for (const key of USER_IDENTITY_HINT_KEYS) {
    hints[key] = String(userIdentity[key] || '').trim();
  }
  return hints;
}

/**
 * @param {object|null|undefined} extractedProfile
 * @param {object} options
 */
function buildManualFillCvSnapshot(extractedProfile, options = {}) {
  const profile = extractedProfile && typeof extractedProfile === 'object' ? extractedProfile : {};
  const structured = profile.structuredUserInfo && typeof profile.structuredUserInfo === 'object'
    ? profile.structuredUserInfo
    : {};
  const seniority = profile.seniority && typeof profile.seniority === 'object' ? profile.seniority : {};
  const documentLanguage = options.cvExtractLocalization?.documentLanguage === 'de'
    ? 'de'
    : (options.documentLanguage === 'de' ? 'de' : 'en');
  const rawKeyResponsibilities = normalizeStringList(structured.keyResponsibilities);

  return {
    pendingUploadedDocId: options.pendingUploadedDocId
      ? String(options.pendingUploadedDocId)
      : null,
    seniority: {
      currentStatus: String(seniority.currentStatus || '').trim(),
      yearsOfExperience: seniority.yearsOfExperience ?? null,
      highestDegree: String(seniority.highestDegree || '').trim(),
      mostSeniorWorkExperience: String(seniority.mostSeniorWorkExperience || '').trim(),
    },
    structuredUserInfo: {
      skillDomains: normalizeStringList(structured.skillDomains),
      skills: normalizeStringList(structured.skills).map((name) => ({ name })),
      domains: normalizeStringList(structured.domains),
      keyResponsibilities: documentLanguage === 'de'
        ? normalizeGermanCvResponsibilityList(rawKeyResponsibilities, { force: true })
        : rawKeyResponsibilities,
      skillsInDevelopment: normalizeStringList(structured.skillsInDevelopment).map((name) => ({ name })),
    },
    identityHints: buildIdentityHintsFromExtractedProfile(profile),
    cvExtractLocalization: options.cvExtractLocalization && typeof options.cvExtractLocalization === 'object'
      ? options.cvExtractLocalization
      : null,
  };
}

/**
 * @param {object|null|undefined} snapshot
 */
function hasManualFillCvSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (hasNonEmptyString(snapshot.pendingUploadedDocId)) return true;
  if (hasIdentityHints(snapshot.identityHints)) return true;
  if (hasStructuredSnapshot(snapshot.structuredUserInfo)) return true;
  return hasSenioritySnapshot(snapshot.seniority);
}

function hasIdentityHints(identityHints) {
  if (!identityHints || typeof identityHints !== 'object') return false;
  return USER_IDENTITY_HINT_KEYS.some((key) => hasNonEmptyString(identityHints[key]));
}

function hasSenioritySnapshot(seniority) {
  if (!seniority || typeof seniority !== 'object') return false;
  return Boolean(
    hasNonEmptyString(seniority.currentStatus)
    || (seniority.yearsOfExperience !== null && seniority.yearsOfExperience !== undefined)
    || hasNonEmptyString(seniority.highestDegree)
    || hasNonEmptyString(seniority.mostSeniorWorkExperience)
  );
}

function hasStructuredSnapshot(structuredUserInfo) {
  if (!structuredUserInfo || typeof structuredUserInfo !== 'object') return false;
  return ['skills', 'domains', 'skillDomains', 'keyResponsibilities', 'skillsInDevelopment'].some(
    (key) => Array.isArray(structuredUserInfo[key]) && structuredUserInfo[key].length > 0
  );
}

/**
 * API payload for coaching endpoints.
 * @param {object|null|undefined} snapshot
 */
function buildCoachingCvContextFromSnapshot(snapshot) {
  if (!hasManualFillCvSnapshot(snapshot)) return null;
  return {
    documentId: snapshot.pendingUploadedDocId ? String(snapshot.pendingUploadedDocId) : undefined,
    seniority: snapshot.seniority || {},
    structuredUserInfo: snapshot.structuredUserInfo || {},
    identityHints: snapshot.identityHints || {},
  };
}

/**
 * Pre-fill seniority on review profile without touching userIdentity.
 * @param {object} reviewProfile
 * @param {object|null|undefined} snapshot
 */
function applySeniorityFromCvSnapshot(reviewProfile, snapshot) {
  if (!reviewProfile || typeof reviewProfile !== 'object') return reviewProfile;
  if (!hasSenioritySnapshot(snapshot?.seniority)) return reviewProfile;
  return {
    ...reviewProfile,
    seniority: {
      ...(reviewProfile.seniority || {}),
      ...snapshot.seniority,
    },
  };
}

/**
 * Merge CV structured suggestions into review profile for empty categories only.
 * @param {object} reviewProfile
 * @param {object|null|undefined} snapshot
 * @param {object} options
 */
function mergeStructuredFromCvSnapshot(reviewProfile, snapshot, options = {}) {
  if (!reviewProfile || typeof reviewProfile !== 'object') return reviewProfile;
  const structured = snapshot?.structuredUserInfo;
  if (!hasStructuredSnapshot(structured)) return reviewProfile;

  const existing = reviewProfile.structuredUserInfo && typeof reviewProfile.structuredUserInfo === 'object'
    ? reviewProfile.structuredUserInfo
    : {};
  const next = { ...existing };

  const mergeListIfEmpty = (key, normalize = (items) => items) => {
    const current = Array.isArray(existing[key]) ? existing[key] : [];
    if (current.length > 0) return;
    if (options[`${key}UserEdited`]) return;
    let incoming = normalize(Array.isArray(structured[key]) ? structured[key] : []);
    if (key === 'keyResponsibilities' && (options.uiLanguage === 'de' || options.documentLanguage === 'de')) {
      incoming = normalizeGermanCvResponsibilityList(incoming, { force: true });
    }
    if (incoming.length > 0) next[key] = incoming;
  };

  mergeListIfEmpty('skillDomains');
  mergeListIfEmpty('domains', (items) => {
    if (options.topicsIndustriesUserEdited) return [];
    return items;
  });
  mergeListIfEmpty('skills', (items) => items.map((item) => (
    typeof item === 'string' ? { name: item } : item
  )));
  mergeListIfEmpty('keyResponsibilities');
  // skillsInDevelopment is resolved against the role-skill catalog when entering the learning-goals step.

  if (options.naturallyGoodAtUserEdited) {
    next.skillDomains = existing.skillDomains || [];
  }

  return {
    ...reviewProfile,
    structuredUserInfo: next,
  };
}

/**
 * CV skill names suggested for the skills-selection step.
 * @param {object|null|undefined} snapshot
 */
function buildCvSkillSelectionCandidates(snapshot) {
  const structured = snapshot?.structuredUserInfo;
  if (!structured || typeof structured !== 'object') return [];
  return normalizeStringList(structured.skills);
}

/**
 * CV skill names for learning goals: all CV skills minus those already selected.
 * @param {object|null|undefined} snapshot
 * @param {string[]} excludeLabels
 */
function buildCvSkillsToLearnCandidates(snapshot, excludeLabels = []) {
  const structured = snapshot?.structuredUserInfo;
  if (!structured || typeof structured !== 'object') return [];
  const excluded = new Set(
    (Array.isArray(excludeLabels) ? excludeLabels : [])
      .map((label) => String(label || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const combined = [
    ...normalizeStringList(structured.skills),
    ...normalizeStringList(structured.skillsInDevelopment),
  ];
  const seen = new Set();
  const out = [];
  for (const name of combined) {
    const key = name.toLowerCase();
    if (excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Apply extraction to manual-fill CV snapshot without pre-filling identity (coaching stays in chat mode).
 * @param {object} reviewProfile
 * @param {object} extractedProfile
 * @param {object} options
 */
function applyManualFillCvExtraction(reviewProfile, extractedProfile, options = {}) {
  const snapshot = buildManualFillCvSnapshot(extractedProfile, options);
  let nextProfile = applySeniorityFromCvSnapshot(reviewProfile, snapshot);
  const userIdentity = { ...(nextProfile.userIdentity || {}) };
  for (const key of USER_IDENTITY_HINT_KEYS) {
    delete userIdentity[key];
  }
  nextProfile = {
    ...nextProfile,
    userIdentity,
  };
  return {
    snapshot,
    reviewProfile: nextProfile,
    pendingUploadedDocId: snapshot.pendingUploadedDocId,
    cvExtractLocalization: snapshot.cvExtractLocalization,
  };
}

module.exports = {
  USER_IDENTITY_HINT_KEYS,
  buildIdentityHintsFromExtractedProfile,
  buildManualFillCvSnapshot,
  hasManualFillCvSnapshot,
  buildCoachingCvContextFromSnapshot,
  applySeniorityFromCvSnapshot,
  mergeStructuredFromCvSnapshot,
  buildCvSkillSelectionCandidates,
  buildCvSkillsToLearnCandidates,
  applyManualFillCvExtraction,
};
