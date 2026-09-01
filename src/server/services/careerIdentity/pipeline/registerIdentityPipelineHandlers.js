/**
 * Register event handlers that connect puzzle updates → exploration pipeline.
 * Call once at server startup.
 */

const logger = require('../../../utils/logger');
const { IDENTITY_PIPELINE_CONFIG } = require('../../../../constants/identityPipelineConfig');
const {
  IDENTITY_PIPELINE_EVENTS,
  onIdentityEvent,
  areHandlersRegistered,
  markHandlersRegistered,
} = require('./identityEventBus');
const { runIdentityExplorationPipeline } = require('./identityExplorationPipeline');

/** @type {Map<string, Promise<unknown>>} */
const pipelineChainsByUser = new Map();
/** @type {Map<string, number>} */
const progressKickAtByUser = new Map();
const PROGRESS_KICK_COOLDOWN_MS = 20_000;

/**
 * @param {string|import('mongoose').Types.ObjectId|null|undefined} userId
 * @returns {boolean}
 */
function isIdentityExplorationQueuedForUser(userId) {
  if (!userId) return false;
  return pipelineChainsByUser.has(String(userId));
}

/**
 * Whether a progress-kick (respondWithIdentity) should enqueue another run.
 * Skips when a run is already queued/in-flight or a kick happened recently.
 *
 * @param {string|import('mongoose').Types.ObjectId|null|undefined} userId
 * @returns {boolean}
 */
function shouldEnqueueProgressKick(userId) {
  if (!userId) return false;
  const userKey = String(userId);
  if (pipelineChainsByUser.has(userKey)) return false;
  const last = progressKickAtByUser.get(userKey) || 0;
  if (Date.now() - last < PROGRESS_KICK_COOLDOWN_MS) return false;
  progressKickAtByUser.set(userKey, Date.now());
  return true;
}

/**
 * Serialize exploration pipeline runs per user so out-of-order async
 * completions cannot overwrite a newer baseline with an older snapshot.
 *
 * @param {object} options
 * @returns {Promise<object|void>}
 */
function enqueueIdentityExplorationForUser(options = {}) {
  const userId = options.userId;
  if (!userId) {
    logger.warn('identity.pipeline.enqueue_missing_user');
    return Promise.resolve();
  }

  const userKey = String(userId);
  const previous = pipelineChainsByUser.get(userKey) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      logger.info('identity.pipeline.enqueue.run', {
        userId: userKey,
        language: options.language,
        triggerSource: options.triggerSource || IDENTITY_PIPELINE_EVENTS.PUZZLE_UPDATED,
        force: Boolean(options.force),
      });

      return runIdentityExplorationPipeline({
        userId,
        currentIdentity: options.identity || options.currentIdentity,
        currentTraits: options.traits || options.currentTraits,
        language: options.language,
        triggerSource: options.triggerSource || IDENTITY_PIPELINE_EVENTS.PUZZLE_UPDATED,
        roles: options.roles,
        rolePoolLimit: options.rolePoolLimit,
        recentlyRatedJobIds: options.recentlyRatedJobIds,
        acceptedJobIds: options.acceptedJobIds,
        traitVoteCount: options.traitVoteCount,
        adaptiveConfig: options.adaptiveConfig,
        signals: options.signals,
        skipSaveSnapshot: options.skipSaveSnapshot,
        pipelineId: options.pipelineId,
      });
    })
    .finally(() => {
      if (pipelineChainsByUser.get(userKey) === next) {
        pipelineChainsByUser.delete(userKey);
      }
    });

  pipelineChainsByUser.set(userKey, next);
  return next;
}

/**
 * @param {object} payload
 */
async function handlePuzzleUpdated(payload = {}) {
  const userId = payload.userId;
  if (!userId) {
    logger.warn('identity.pipeline.puzzle_updated_missing_user');
    return;
  }

  logger.info('identity.pipeline.handler.puzzle_updated', {
    userId: String(userId),
    language: payload.language,
    force: Boolean(payload.force),
  });

  await enqueueIdentityExplorationForUser({
    userId,
    identity: payload.identity,
    traits: payload.traits,
    language: payload.language,
    force: Boolean(payload.force),
    triggerSource: IDENTITY_PIPELINE_EVENTS.PUZZLE_UPDATED,
  });
}

/**
 * Subscribe pipeline handlers to the identity event bus.
 * Idempotent — safe to call multiple times.
 */
function registerIdentityPipelineHandlers() {
  if (areHandlersRegistered()) {
    logger.info('identity.pipeline.handlers_already_registered');
    return;
  }

  onIdentityEvent(IDENTITY_PIPELINE_EVENTS.PUZZLE_UPDATED, (payload) => {
    if (IDENTITY_PIPELINE_CONFIG.RUN_EVENT_HANDLERS_ASYNC) {
      setImmediate(() => {
        handlePuzzleUpdated(payload).catch((err) => {
          logger.error('identity.pipeline.async_handler_failed', {
            userId: payload?.userId ? String(payload.userId) : undefined,
            error: err,
          });
        });
      });
      return;
    }
    return handlePuzzleUpdated(payload);
  });

  markHandlersRegistered();
  logger.info('identity.pipeline.handlers_registered', {
    events: [IDENTITY_PIPELINE_EVENTS.PUZZLE_UPDATED],
    async: IDENTITY_PIPELINE_CONFIG.RUN_EVENT_HANDLERS_ASYNC,
  });
}

module.exports = {
  registerIdentityPipelineHandlers,
  handlePuzzleUpdated,
  enqueueIdentityExplorationForUser,
  isIdentityExplorationQueuedForUser,
  shouldEnqueueProgressKick,
};
