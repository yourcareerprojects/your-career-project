/**
 * Build a profile-fit scorer for identity exploration using the same
 * OUT_OF_THE_BOX hybrid scoring path as first-time simulation.
 */

const {
  scoreOutOfTheBox,
} = require('../embedding/roleMatchingScorer');
const {
  buildUserHybridVector,
  buildUserStructuredVector,
  buildUserIdentityVector,
} = require('../embedding/userProfileVectorBuilder');
const { getRoleKey } = require('./careerExplorationService');

/**
 * Prefetch / cache user hybrid + structured + identity vectors so the first
 * role in a pool does not pay cold OpenAI embedding latency mid-loop.
 *
 * @param {object|null|undefined} userProfile
 * @returns {Promise<void>}
 */
async function warmProfileFitVectors(userProfile) {
  if (!userProfile || typeof userProfile !== 'object') return;
  await Promise.all([
    buildUserHybridVector(userProfile, 'OUT_OF_THE_BOX'),
    buildUserStructuredVector(userProfile, 'OUT_OF_THE_BOX'),
    buildUserIdentityVector(userProfile),
  ]);
}

/**
 * @param {object|null|undefined} userProfile - hybrid-ready profile
 * @returns {null|((role: object) => Promise<number|null>)}
 */
function createProfileFitScorer(userProfile) {
  if (!userProfile || typeof userProfile !== 'object') return null;

  /** @type {Map<string, number|null>} */
  const cache = new Map();

  return async function scoreProfileFit(role) {
    const key = getRoleKey(role) || '';
    if (key && cache.has(key)) return cache.get(key);

    let fit = null;
    try {
      const result = await scoreOutOfTheBox(userProfile, role);
      if (result && Number.isFinite(result.score)) {
        fit = Number(result.score);
      }
    } catch {
      fit = null;
    }

    if (key) cache.set(key, fit);
    return fit;
  };
}

module.exports = {
  createProfileFitScorer,
  warmProfileFitVectors,
};
