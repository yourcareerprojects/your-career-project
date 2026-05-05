/**
 * Production career path scoring for simulation: hybrid vectors only.
 *
 * Runs {@link scoreNextRole} and {@link scoreOutOfTheBox} (embedding fusion + seniority penalty).
 * Multi-dimensional weighted scoring (skills, experience, education modifier, calibration, etc.)
 * Full multi-dimensional scorer: `services/scoring/legacy/careerPathScorerLegacy.js` (tests / offline tools only).
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
  const userProfileForHybrid = buildUserProfileForHybrid(userProfile);
  let hybridScoreNextRole = null;
  let hybridCosineNextRole = null;
  let hybridScoreOutOfTheBox = null;
  let hybridCosineOutOfTheBox = null;
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
  }
  return {
    hybridScoreNextRole,
    hybridCosineNextRole,
    hybridScoreOutOfTheBox,
    hybridCosineOutOfTheBox,
  };
}

module.exports = {
  enrichCareerPathWithHybridScores,
};
