/**
 * Production career path scoring for simulation: hybrid vectors only.
 *
 * Runs {@link scoreNextRole} and {@link scoreOutOfTheBox} (embedding fusion + seniority penalty).
 */
// ENGLISH_ONLY_PIPELINE: Hybrid scoring consumes canonical-English vector space only.

const { scoreNextRole, scoreOutOfTheBox } = require('../embedding/roleMatchingScorer');
const { buildUserProfileForHybrid } = require('./hybridUserProfileForMatching');

/**
 * Hybrid-only scoring for simulation: runs scoreNextRole + scoreOutOfTheBox in parallel.
 *
 * @returns {Promise<{ hybridScoreNextRole, hybridCosineNextRole, hybridScoreOutOfTheBox, hybridCosineOutOfTheBox }>}
 */
async function enrichCareerPathWithHybridScores(userProfile, careerPath) {
  const userProfileForHybrid =
    userProfile && typeof userProfile === 'object' && userProfile.userSkills != null && userProfile.userCareerPreferences != null
      ? userProfile
      : buildUserProfileForHybrid(userProfile);
  let hybridScoreNextRole = null;
  let hybridCosineNextRole = null;
  let hybridScoreOutOfTheBox = null;
  let hybridCosineOutOfTheBox = null;
  let structuredSimilarityOutOfTheBox = null;
  let identitySimilarityOutOfTheBox = null;
  const [nextResult, outResult] = await Promise.all([
    scoreNextRole(userProfileForHybrid, careerPath),
    scoreOutOfTheBox(userProfileForHybrid, careerPath),
  ]);
  if (nextResult != null) {
    hybridScoreNextRole = nextResult.score;
    hybridCosineNextRole = nextResult.cosine;
  }
  if (outResult != null) {
    hybridScoreOutOfTheBox = outResult.score;
    hybridCosineOutOfTheBox = outResult.cosine;
    structuredSimilarityOutOfTheBox =
      Number.isFinite(outResult.structuredSimilarity) ? outResult.structuredSimilarity : null;
    identitySimilarityOutOfTheBox =
      Number.isFinite(outResult.identitySimilarity) ? outResult.identitySimilarity : null;
  }
  return {
    hybridScoreNextRole,
    hybridCosineNextRole,
    hybridScoreOutOfTheBox,
    hybridCosineOutOfTheBox,
    structuredSimilarityOutOfTheBox,
    identitySimilarityOutOfTheBox,
  };
}

module.exports = {
  enrichCareerPathWithHybridScores,
};
