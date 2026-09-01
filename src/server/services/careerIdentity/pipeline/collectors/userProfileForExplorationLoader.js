/**
 * Load a hybrid-matching user profile for identity exploration scoring.
 * Reuses the same field shape as simulation OOTB scoring (skills, domains,
 * identity answers, seniority) without running the full simulation pipeline.
 */

const User = require('../../../../models/User');
const { buildUserProfileForHybrid } = require('../../../scoring/hybridUserProfileForMatching');
const {
  mergeProfileIdentityAnswers,
  topicsStringToInterestTokens,
  ensureUserIdentityEmbeddingCachedByUserId,
} = require('../../../embedding/userIdentityEmbeddingTextService');
const logger = require('../../../../utils/logger');

function readDimensionRawItems(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          return String(item.name || item.label || item.title || '').trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  if (value && typeof value === 'object' && Array.isArray(value.raw_items)) {
    return value.raw_items
      .map((item) => (typeof item === 'string' ? item.trim() : String(item?.name || item?.label || '').trim()))
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/**
 * Prefer careerSimulationInputs; fall back to top-level structuredUserInfo.
 * @param {object} profile
 * @returns {object}
 */
function resolveActiveInputs(profile = {}) {
  const csi = profile.careerSimulationInputs && typeof profile.careerSimulationInputs === 'object'
    ? profile.careerSimulationInputs
    : {};
  const csiSkills = readDimensionRawItems(csi.structuredUserInfo?.skills);
  const profileSkills = readDimensionRawItems(profile.structuredUserInfo?.skills);
  if (csiSkills.length > 0 || Object.keys(csi).length > 0) {
    return {
      structuredUserInfo: {
        ...(profile.structuredUserInfo && typeof profile.structuredUserInfo === 'object'
          ? profile.structuredUserInfo
          : {}),
        ...(csi.structuredUserInfo && typeof csi.structuredUserInfo === 'object'
          ? csi.structuredUserInfo
          : {}),
        skills: csiSkills.length > 0 ? csi.structuredUserInfo?.skills : profile.structuredUserInfo?.skills,
      },
      seniority: csi.seniority && typeof csi.seniority === 'object' ? csi.seniority : profile.seniority,
      userIdentity: csi.userIdentity,
      embeddingOptimizedUserIdentityText: csi.embeddingOptimizedUserIdentityText,
      embeddingUserIdentitySourceFingerprint: csi.embeddingUserIdentitySourceFingerprint,
      dateOfBirth: csi.dateOfBirth,
    };
  }
  return {
    structuredUserInfo: profile.structuredUserInfo || {},
    seniority: profile.seniority,
    userIdentity: null,
    embeddingOptimizedUserIdentityText: undefined,
    embeddingUserIdentitySourceFingerprint: undefined,
    dateOfBirth: null,
  };
}

/**
 * @param {object} profile
 * @param {object} [identityCache]
 * @returns {object|null} hybrid-ready user profile, or null when too empty to ground
 */
function buildExplorationMatchingProfile(profile, identityCache = null) {
  if (!profile || typeof profile !== 'object') return null;

  const active = resolveActiveInputs(profile);
  const structured = active.structuredUserInfo && typeof active.structuredUserInfo === 'object'
    ? active.structuredUserInfo
    : {};

  const userSkills = readDimensionRawItems(structured.skills);
  const userSkillsInDevelopment = readDimensionRawItems(structured.skillsInDevelopment);
  const userSkillDomains = readDimensionRawItems(structured.skillDomains);
  const rawDomains = readDimensionRawItems(structured.domains);
  const keyResponsibilities = readDimensionRawItems(structured.keyResponsibilities);

  const mergedIdentityAnswers = mergeProfileIdentityAnswers(profile);
  const userInterests = topicsStringToInterestTokens(mergedIdentityAnswers.topicsIndustriesInterest);
  const bio =
    mergedIdentityAnswers.workEnjoyMost
    || (profile.personalInfo?.bio ? String(profile.personalInfo.bio).trim() : '');
  const careerGoal = mergedIdentityAnswers.workingLifeAchievement || '';

  const seniorityInputs = active.seniority && typeof active.seniority === 'object'
    ? active.seniority
    : {};
  const profileSeniority = profile.seniority && typeof profile.seniority === 'object'
    ? profile.seniority
    : {};

  const hasSignal =
    userSkills.length > 0
    || rawDomains.length > 0
    || keyResponsibilities.length > 0
    || Boolean(bio)
    || Boolean(careerGoal)
    || userInterests.length > 0;

  if (!hasSignal) return null;

  const scoringProfile = {
    userSkills,
    userSkillDomains,
    userSkillsInDevelopment,
    userWorkExperience: keyResponsibilities.length > 0
      ? [{ title: 'What are you good at?', keyResponsibilities }]
      : [],
    userEducation: {},
    userCareerPreferences: { domains: rawDomains },
    userInterests,
    careerGoal,
    bio,
    userIdentityAnswers: mergedIdentityAnswers,
    dateOfBirth: profile.personalInfo?.dateOfBirth ?? active.dateOfBirth ?? null,
    currentStatus: seniorityInputs.currentStatus ?? profileSeniority.currentStatus ?? '',
    yearsOfExperience:
      seniorityInputs.yearsOfExperience != null
        ? seniorityInputs.yearsOfExperience
        : profileSeniority.yearsOfExperience,
    highestDegree: seniorityInputs.highestDegree ?? profileSeniority.highestDegree ?? '',
    mostSeniorWorkExperience:
      seniorityInputs.mostSeniorWorkExperience ?? profileSeniority.mostSeniorWorkExperience ?? '',
    embeddingOptimizedUserIdentityText:
      identityCache?.text
      || active.embeddingOptimizedUserIdentityText
      || undefined,
    embeddingUserIdentitySourceFingerprint:
      identityCache?.fingerprint
      || active.embeddingUserIdentitySourceFingerprint
      || undefined,
    identityEmbeddingText: String(profile?.who_are_you?.identity_embedding_text || '').trim(),
  };

  return buildUserProfileForHybrid(scoringProfile);
}

/**
 * @param {{
 *   userId: string|import('mongoose').Types.ObjectId,
 *   pipelineId?: string,
 *   userProfile?: object|null,
 * }} options
 * @returns {Promise<{
 *   userProfile: object|null,
 *   skillLabels: string[],
 *   profileAvailable: boolean,
 * }>}
 */
async function loadUserProfileForExplorationMatching(options = {}) {
  if (options.userProfile && typeof options.userProfile === 'object') {
    const skillLabels = Array.isArray(options.userProfile.userSkills)
      ? options.userProfile.userSkills.map(String)
      : [];
    return {
      userProfile: options.userProfile,
      skillLabels,
      profileAvailable: true,
    };
  }

  const userId = options.userId;
  if (!userId) {
    return { userProfile: null, skillLabels: [], profileAvailable: false };
  }

  const user = await User.findById(userId).select({ profile: 1 }).lean();
  const profile = user?.profile || null;

  let identityCache = null;
  try {
    identityCache = await ensureUserIdentityEmbeddingCachedByUserId(userId);
  } catch (err) {
    logger.warn('identity.pipeline.profile_identity_cache_failed', {
      pipelineId: options.pipelineId,
      userId: String(userId),
      message: err?.message || String(err),
    });
  }

  const userProfile = buildExplorationMatchingProfile(profile, identityCache);
  const skillLabels = userProfile?.userSkills
    ? userProfile.userSkills.map(String)
    : [];

  logger.info('identity.pipeline.profile_loaded_for_matching', {
    pipelineId: options.pipelineId,
    userId: String(userId),
    profileAvailable: Boolean(userProfile),
    skillCount: skillLabels.length,
    domainCount: Array.isArray(userProfile?.userCareerPreferences?.domains)
      ? userProfile.userCareerPreferences.domains.length
      : 0,
  });

  return {
    userProfile,
    skillLabels,
    profileAvailable: Boolean(userProfile),
  };
}

module.exports = {
  loadUserProfileForExplorationMatching,
  buildExplorationMatchingProfile,
  readDimensionRawItems,
  resolveActiveInputs,
};
