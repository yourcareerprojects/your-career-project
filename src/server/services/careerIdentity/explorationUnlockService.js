/**
 * Gate identity → role-suggestion accumulation behind the first completed simulation.
 *
 * Until both Next and Outside-the-Box rankings are done, onboarding identity growth
 * (profile fill, first sim ratings) must not inflate the progress bar or deliver
 * Discover sessions. On every identity read while still locked we clear false
 * Discover deliveries and reseed the baseline to 0%.
 */

const User = require('../../models/User');
const CareerIdentityProfile = require('../../models/CareerIdentityProfile');
const {
  getEvaluationFlow,
  areBothSimulationRankingsComplete,
} = require('../../utils/evaluationFlowRoles');
const {
  markAllUnreadExplorationSessionsSeen,
} = require('./pipeline/explorationSessionService');
const { resetExplorationProgressBaseline } = require('./explorationProgressService');
const logger = require('../../utils/logger');

/**
 * @param {object|null|undefined} user — lean or mongoose user with lastSimulationResult / simulationResults
 * @returns {boolean}
 */
function userHasCompletedFirstSimulationRankings(user) {
  if (!user) return false;

  const candidates = [];
  if (user.lastSimulationResult) candidates.push(user.lastSimulationResult);
  if (Array.isArray(user.simulationResults)) {
    for (const result of user.simulationResults) {
      if (result && result.status !== 'deleted') candidates.push(result);
    }
  }

  return candidates.some((result) =>
    areBothSimulationRankingsComplete(getEvaluationFlow(result))
  );
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<boolean>}
 */
async function hasCompletedFirstSimulationRankings(userId) {
  if (!userId) return false;
  const user = await User.findById(userId)
    .select('lastSimulationResult simulationResults')
    .lean();
  return userHasCompletedFirstSimulationRankings(user);
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<boolean>}
 */
async function isExplorationAccumulationUnlocked(userId) {
  if (!userId) return false;
  const profile = await CareerIdentityProfile.findOne({ userId })
    .select('explorationAccumulationUnlockedAt')
    .lean();
  return Boolean(profile?.explorationAccumulationUnlockedAt);
}

/**
 * Whether the pipeline may deliver Discover jobs for this user.
 * Requires rankings complete and the one-time unlock stamp.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<boolean>}
 */
async function canDeliverExplorationRoles(userId) {
  if (!(await hasCompletedFirstSimulationRankings(userId))) return false;
  return isExplorationAccumulationUnlocked(userId);
}

/**
 * While accumulation is locked: clear any Discover deliveries and keep the
 * progress baseline aligned with the current identity (0% bar).
 * When rankings are complete, stamp the unlock so later activity can accumulate.
 *
 * Safe to call on every identity GET — no-ops once unlocked.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {object} [currentIdentity]
 * @returns {Promise<{ unlocked: boolean, didUnlock: boolean, healedOnboarding: boolean }>}
 */
async function ensureExplorationAccumulationUnlocked(userId, currentIdentity = null) {
  if (!userId) {
    return { unlocked: false, didUnlock: false, healedOnboarding: false };
  }

  const profile = await CareerIdentityProfile.findOne({ userId })
    .select('explorationAccumulationUnlockedAt')
    .lean();

  if (profile?.explorationAccumulationUnlockedAt) {
    return { unlocked: true, didUnlock: false, healedOnboarding: false };
  }

  // Still locked: never leave onboarding Discover / inflated progress visible.
  const { markedCount } = await markAllUnreadExplorationSessionsSeen(userId);
  if (currentIdentity) {
    await resetExplorationProgressBaseline(userId, currentIdentity);
  }

  const rankingsComplete = await hasCompletedFirstSimulationRankings(userId);
  let didUnlock = false;

  if (rankingsComplete) {
    const now = new Date();
    await CareerIdentityProfile.findOneAndUpdate(
      { userId, explorationAccumulationUnlockedAt: null },
      { $set: { explorationAccumulationUnlockedAt: now } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    didUnlock = true;
  }

  logger.info('identity.exploration.onboarding_gate_sync', {
    userId: String(userId),
    markedUnreadCount: markedCount,
    resetBaseline: Boolean(currentIdentity),
    rankingsComplete,
    didUnlock,
  });

  return {
    unlocked: didUnlock,
    didUnlock,
    healedOnboarding: true,
  };
}

module.exports = {
  userHasCompletedFirstSimulationRankings,
  hasCompletedFirstSimulationRankings,
  isExplorationAccumulationUnlocked,
  canDeliverExplorationRoles,
  ensureExplorationAccumulationUnlocked,
};
