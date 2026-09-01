/**
 * Enqueue an identity refresh + exploration pipeline for a user after
 * identity-affecting writes (profile edits, role ratings, etc.).
 *
 * Fire-and-forget from controllers — does not block the write response.
 */

const logger = require('../../utils/logger');
const identityEngine = require('./identityEngine');
const { enqueueIdentityExplorationForUser } = require('./pipeline/registerIdentityPipelineHandlers');
const { getUnreadExplorationSession } = require('./pipeline/explorationSessionService');
const {
  ensureExplorationAccumulationUnlocked,
} = require('./explorationUnlockService');

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ language?: 'en'|'de', force?: boolean }} [options]
 */
function scheduleIdentityExplorationAfterActivity(userId, options = {}) {
  if (!userId) return;

  const language = options.language === 'en' ? 'en' : 'de';
  const force = options.force !== false;

  setImmediate(() => {
    Promise.resolve()
      .then(async () => {
        const pendingUnread = await getUnreadExplorationSession(userId);
        if (pendingUnread) {
          logger.info('identity.exploration.schedule_after_activity_skipped_pending', {
            userId: String(userId),
            pendingSessionId: String(pendingUnread._id),
          });
          return;
        }

        const identity = force
          ? await identityEngine.forceRefreshIdentity(userId, {
              language,
              // Pipeline is enqueued below — avoid double emit from engine.
              skipPipelineEmit: true,
            })
          : await identityEngine.getIdentity(userId, { language });

        // Align baseline to the post-simulation identity on first unlock so
        // onboarding ratings do not immediately unlock Discover.
        const { didUnlock } = await ensureExplorationAccumulationUnlocked(userId, identity);
        if (didUnlock) {
          logger.info('identity.exploration.schedule_after_activity_unlocked_baseline', {
            userId: String(userId),
          });
          return;
        }

        // Re-check after refresh in case a delivery landed during the await.
        const stillPending = await getUnreadExplorationSession(userId);
        if (stillPending) {
          logger.info('identity.exploration.schedule_after_activity_skipped_pending', {
            userId: String(userId),
            pendingSessionId: String(stillPending._id),
          });
          return;
        }

        await enqueueIdentityExplorationForUser({
          userId,
          identity,
          traits: (identity.nodes || []).map((node) => ({
            traitId: node.id,
            category: node.category,
            confidence: node.confidence,
            layer: node.layer,
          })),
          language,
          force,
        });
      })
      .catch((err) => {
        logger.error('identity.exploration.schedule_after_activity_failed', {
          userId: String(userId),
          error: err,
        });
      });
  });
}

module.exports = {
  scheduleIdentityExplorationAfterActivity,
};
