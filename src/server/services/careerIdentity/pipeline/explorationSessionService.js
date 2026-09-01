/**
 * Read helpers for stored identity exploration sessions.
 */

const IdentityExplorationSession = require('../../../models/IdentityExplorationSession');
const CareerIdentityProfile = require('../../../models/CareerIdentityProfile');
const logger = require('../../../utils/logger');

/**
 * @param {object|null|undefined} session
 * @returns {boolean}
 */
function isNotifiableExplorationSession(session) {
  if (!session) return false;
  if (session.status !== 'completed') return false;
  const jobCount = Array.isArray(session.explorationJobs) ? session.explorationJobs.length : 0;
  return jobCount > 0;
}

/**
 * @param {object|null|undefined} session
 * @returns {boolean}
 */
function isUnreadNotifiableExplorationSession(session) {
  return isNotifiableExplorationSession(session) && session.seenAt == null;
}

/**
 * Lean ranking-progress summary for Discover CTA / resume copy.
 * @param {object|null|undefined} session
 * @returns {{
 *   hasProgress: boolean,
 *   evaluatedCount: number,
 *   totalCount: number,
 *   phase: string|null,
 *   wizardPaused: boolean,
 * }|null}
 */
function summarizeRankingProgress(session) {
  const progress = session?.rankingProgress;
  if (!progress || typeof progress !== 'object') return null;

  const jobCount = Array.isArray(session?.explorationJobs) ? session.explorationJobs.length : 0;
  const evaluatedCount = Math.max(0, Number(progress.evaluatedCount) || 0);
  const totalCount = Math.max(
    0,
    Number(progress.totalCount) || jobCount || 0
  );
  const phase = progress.phase === 'ranked' ? 'ranked' : 'eval';
  const hasProgress =
    evaluatedCount > 0
    || phase === 'ranked'
    || Boolean(progress.wizardPaused);

  if (!hasProgress) return null;

  return {
    hasProgress: true,
    evaluatedCount,
    totalCount,
    phase,
    wizardPaused: Boolean(progress.wizardPaused),
  };
}

function buildExplorationNotification(session) {
  const jobCount = Array.isArray(session?.explorationJobs) ? session.explorationJobs.length : 0;
  const hasUnreadExploration = isUnreadNotifiableExplorationSession(session);
  const rankingProgress = summarizeRankingProgress(session);

  if (!hasUnreadExploration) {
    return {
      hasUnreadExploration: false,
      sessionId: null,
      jobCount: 0,
      status: session?.status || null,
      rankingProgress: null,
    };
  }

  return {
    hasUnreadExploration: true,
    sessionId: String(session._id),
    jobCount,
    status: session.status,
    prominence: session.gate?.presentation?.prominence || null,
    intensity: session.gate?.presentation?.intensity ?? null,
    rankingProgress,
  };
}

/**
 * Prefer an unread completed delivery over the profile pointer / latest-any session.
 * Protects Discover CTA from later empty-pool / failed runs overwriting the pointer.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<object|null>}
 */
async function getUnreadExplorationSession(userId) {
  const unread = await IdentityExplorationSession.findOne({
    userId,
    status: 'completed',
    seenAt: null,
    'explorationJobs.0': { $exists: true },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (unread) {
    logger.debug('identity.pipeline.unread_session', {
      userId: String(userId),
      sessionId: String(unread._id),
    });
  }

  return unread || null;
}

/**
 * Lightweight unread hint for identity API responses.
 * @param {string|import('mongoose').Types.ObjectId} userId
 */
async function getExplorationNotification(userId) {
  const unread = await getUnreadExplorationSession(userId);
  if (unread) return buildExplorationNotification(unread);

  const session = await getLatestExplorationSession(userId);
  return buildExplorationNotification(session);
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<object|null>}
 */
async function getLatestExplorationSession(userId) {
  // Prefer an unread delivery so clients never lose Discover behind a newer skip/fail.
  const unread = await getUnreadExplorationSession(userId);
  if (unread) return unread;

  const profile = await CareerIdentityProfile.findOne({ userId })
    .select('lastExplorationSessionId')
    .lean();

  if (profile?.lastExplorationSessionId) {
    const byLink = await IdentityExplorationSession.findById(profile.lastExplorationSessionId).lean();
    if (byLink) {
      logger.debug('identity.pipeline.latest_session_via_profile', {
        userId: String(userId),
        sessionId: String(byLink._id),
      });
      return byLink;
    }
  }

  const latest = await IdentityExplorationSession.findOne({ userId })
    .sort({ createdAt: -1 })
    .lean();

  logger.debug('identity.pipeline.latest_session_via_query', {
    userId: String(userId),
    sessionId: latest?._id ? String(latest._id) : null,
  });

  return latest || null;
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} sessionId
 * @returns {Promise<object|null>}
 */
async function getExplorationSessionById(userId, sessionId) {
  return IdentityExplorationSession.findOne({ _id: sessionId, userId }).lean();
}

/**
 * Mark an exploration session as seen so the toast is not repeated.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} sessionId
 * @returns {Promise<object|null>}
 */
async function markExplorationSessionSeen(userId, sessionId) {
  const session = await IdentityExplorationSession.findOneAndUpdate(
    { _id: sessionId, userId, seenAt: null },
    { $set: { seenAt: new Date(), rankingProgress: null } },
    { new: true }
  ).lean();

  if (session) {
    logger.info('identity.pipeline.exploration_session_seen', {
      userId: String(userId),
      sessionId: String(session._id),
    });
    return session;
  }

  // Already seen or missing — return current doc if owned by user.
  return getExplorationSessionById(userId, sessionId);
}

/**
 * Persist mid-flow Discover ranking so the user can close and resume later.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} sessionId
 * @param {object} rankingProgress
 * @returns {Promise<object|null>}
 */
async function updateExplorationRankingProgress(userId, sessionId, rankingProgress) {
  if (!rankingProgress || typeof rankingProgress !== 'object') {
    const err = new Error('rankingProgress is required');
    err.status = 400;
    throw err;
  }

  const session = await IdentityExplorationSession.findOneAndUpdate(
    {
      _id: sessionId,
      userId,
      status: 'completed',
      seenAt: null,
    },
    {
      $set: {
        rankingProgress: {
          ...rankingProgress,
          updatedAt: new Date().toISOString(),
        },
      },
    },
    { new: true }
  ).lean();

  if (session) {
    logger.debug('identity.pipeline.exploration_ranking_progress', {
      userId: String(userId),
      sessionId: String(session._id),
      evaluatedCount: Number(rankingProgress.evaluatedCount) || 0,
      phase: rankingProgress.phase || 'eval',
    });
  }

  return session || null;
}

/**
 * Consume every unread completed delivery for the user.
 * Prevents a second stacked session from re-showing Discover after Done.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId|null|undefined} [preferredSessionId]
 * @returns {Promise<{ markedCount: number, preferredSession: object|null }>}
 */
async function markAllUnreadExplorationSessionsSeen(userId, preferredSessionId = null) {
  const now = new Date();
  const result = await IdentityExplorationSession.updateMany(
    {
      userId,
      status: 'completed',
      seenAt: null,
      'explorationJobs.0': { $exists: true },
    },
    { $set: { seenAt: now, rankingProgress: null } }
  );

  const markedCount = Number(result?.modifiedCount || result?.nModified || 0);
  logger.info('identity.pipeline.exploration_sessions_seen_all', {
    userId: String(userId),
    markedCount,
    preferredSessionId: preferredSessionId ? String(preferredSessionId) : null,
  });

  const preferredSession = preferredSessionId
    ? await getExplorationSessionById(userId, preferredSessionId)
    : null;

  return { markedCount, preferredSession };
}

/**
 * Attach explorationNotification onto a serialized identity payload.
 * @param {object} identity
 * @param {string|import('mongoose').Types.ObjectId} userId
 */
async function withExplorationNotification(identity, userId) {
  const explorationNotification = await getExplorationNotification(userId);
  return {
    ...identity,
    explorationNotification,
  };
}

module.exports = {
  getLatestExplorationSession,
  getUnreadExplorationSession,
  getExplorationSessionById,
  getExplorationNotification,
  buildExplorationNotification,
  summarizeRankingProgress,
  isNotifiableExplorationSession,
  isUnreadNotifiableExplorationSession,
  markExplorationSessionSeen,
  markAllUnreadExplorationSessionsSeen,
  updateExplorationRankingProgress,
  withExplorationNotification,
};
