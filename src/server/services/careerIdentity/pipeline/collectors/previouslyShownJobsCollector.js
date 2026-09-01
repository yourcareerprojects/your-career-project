/**
 * Collect job ids surfaced in recent completed exploration sessions (dedupe source).
 */

const IdentityExplorationSession = require('../../../../models/IdentityExplorationSession');
const { EXPLORATION_PRESENTATION_FATIGUE } = require('../../../../../constants/explorationPresentationConfig');
const { matchJobKey } = require('../../explorationRankingService');

/**
 * @param {object} job
 * @returns {string[]}
 */
function jobStorageKeys(job) {
  const keys = [];
  if (job?.careerPathId) keys.push(String(job.careerPathId));
  if (job?.escoId) keys.push(String(job.escoId));
  return keys;
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ windowDays?: number, now?: Date }} [options]
 * @returns {Promise<string[]>}
 */
async function collectPreviouslyShownJobIds(userId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const windowDays =
    Number(options.windowDays)
    || EXPLORATION_PRESENTATION_FATIGUE.PREVIOUSLY_SHOWN_WINDOW_DAYS
    || 90;
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const sessions = await IdentityExplorationSession.find({
    userId,
    status: 'completed',
    createdAt: { $gte: since },
  })
    .select({ explorationJobs: 1 })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  const ids = new Set();
  for (const session of sessions) {
    for (const job of session.explorationJobs || []) {
      for (const key of jobStorageKeys(job)) {
        ids.add(key);
      }
      // Also match live delta keys when stored titles-only jobs lack ids
      const pseudo = matchJobKey({ role: job });
      if (pseudo) ids.add(pseudo);
    }
  }

  return [...ids];
}

module.exports = {
  collectPreviouslyShownJobIds,
  jobStorageKeys,
};
