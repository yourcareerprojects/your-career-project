/**
 * User profile shape for hybrid embedding scoring (NEXT_ROLE / OUT_OF_THE_BOX).
 * Shared by production simulation enrichment and the legacy multi-dimensional scorer.
 */

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

const HYBRID_PROFILE_CACHE = Symbol('hybridProfileCache');

/** Fields required by scoreNextRole / scoreOutOfTheBox. */
function buildUserProfileForHybrid(userProfile) {
  if (userProfile && typeof userProfile === 'object' && userProfile[HYBRID_PROFILE_CACHE]) {
    return userProfile[HYBRID_PROFILE_CACHE];
  }

  const userSkills = safeArray(userProfile.userSkills);
  const normalizedProfile = {
    userSkills,
    userSkillDomains: safeArray(userProfile.userSkillDomains),
    userSkillsInDevelopment: userProfile.userSkillsInDevelopment || [],
    userWorkExperience: safeArray(userProfile.userWorkExperience),
    userEducation: userProfile.userEducation && typeof userProfile.userEducation === 'object' ? userProfile.userEducation : {},
    userCareerPreferences:
      userProfile.userCareerPreferences && typeof userProfile.userCareerPreferences === 'object'
        ? userProfile.userCareerPreferences
        : {},
    userInterests: safeArray(userProfile.userInterests),
    careerGoal: userProfile.careerGoal,
    bio: userProfile.bio,
    userIdentityAnswers:
      userProfile.userIdentityAnswers && typeof userProfile.userIdentityAnswers === 'object'
        ? userProfile.userIdentityAnswers
        : {},
    dateOfBirth: userProfile.dateOfBirth,
    currentStatus: userProfile.currentStatus,
    yearsOfExperience: userProfile.yearsOfExperience,
    highestDegree: userProfile.highestDegree,
    mostSeniorWorkExperience: userProfile.mostSeniorWorkExperience,
    embeddingOptimizedUserIdentityText: userProfile.embeddingOptimizedUserIdentityText,
    embeddingUserIdentitySourceFingerprint: userProfile.embeddingUserIdentitySourceFingerprint,
    identityEmbeddingText: userProfile.identityEmbeddingText,
    language: userProfile.language,
  };

  if (userProfile && typeof userProfile === 'object') {
    userProfile[HYBRID_PROFILE_CACHE] = normalizedProfile;
  }

  return normalizedProfile;
}

module.exports = {
  safeArray,
  buildUserProfileForHybrid,
};
