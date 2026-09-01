/**
 * Identity Exploration Pipeline Orchestrator
 * ==========================================
 *
 * Event-driven flow after Career Identity puzzle pieces update:
 *
 *   puzzle updated
 *     → load previous snapshot
 *     → create current snapshot
 *     → mode: first (no prior) | subsequent (has prior)
 *     → exploration gate (first-fit or delta change score + adaptive gate)
 *     → (below threshold → store skipped session → save snapshot → stop)
 *     → job matching (initial fit or delta)
 *     → generate exploration jobs
 *     → store exploration session
 *     → save new identity snapshot
 *
 * Each step lives in `./steps/*`. This module only sequences them and logs.
 */

const crypto = require('crypto');
const logger = require('../../../utils/logger');
const { IDENTITY_PIPELINE_MODES } = require('../../../../constants/identityPipelineModes');
const { IDENTITY_PIPELINE_EVENTS } = require('./identityEventBus');
const { emitIdentityEvent } = require('./identityEventBus');

const { loadPreviousSnapshotStep } = require('./steps/loadPreviousSnapshotStep');
const { createCurrentSnapshotStep } = require('./steps/createCurrentSnapshotStep');
const { evaluateExplorationGateStep } = require('./steps/evaluateExplorationGateStep');
const { runJobMatchingStep } = require('./steps/runJobMatchingStep');
const { generateExplorationStep } = require('./steps/generateExplorationStep');
const { storeExplorationSessionStep } = require('./steps/storeExplorationSessionStep');
const { saveIdentitySnapshotStep } = require('./steps/saveIdentitySnapshotStep');
const { getUnreadExplorationSession } = require('./explorationSessionService');
const {
  canDeliverExplorationRoles,
  ensureExplorationAccumulationUnlocked,
  hasCompletedFirstSimulationRankings,
} = require('../explorationUnlockService');

/**
 * @param {object} [options]
 * @returns {string}
 */
function createPipelineId(options = {}) {
  if (options.pipelineId) return String(options.pipelineId);
  return `idp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * @param {object|null|undefined} previousSnapshot
 * @returns {string}
 */
function resolveExplorationMode(previousSnapshot) {
  return previousSnapshot ? IDENTITY_PIPELINE_MODES.SUBSEQUENT : IDENTITY_PIPELINE_MODES.FIRST;
}

/**
 * Persist a comparison baseline when:
 * - seeding the very first snapshot (no prior baseline), or
 * - still in onboarding (simulation rankings incomplete) so profile/sim
 *   identity growth does not inflate the progress bar.
 *
 * Do **not** advance the baseline on empty-pool / failed searches after unlock —
 * that snapped the progress card from 100% "Preparing…" back to 0%. Phase
 * `preparing` (change still ≥ threshold + latest empty/failed session)
 * is the intended UX until roles can be delivered or the user consumes a
 * successful delivery (baseline reset on mark-seen).
 *
 * Successful `completed` sessions also do **not** advance the baseline here —
 * reset happens when the user consumes the delivered roles
 * (`resetExplorationProgressBaseline` on mark-seen / consume).
 *
 * @param {{
 *   previousSnapshot: object|null|undefined,
 *   sessionStatus?: string,
 *   shouldExplore?: boolean,
 *   hasUnreadExploration?: boolean,
 *   reseedWhileLocked?: boolean,
 *   changeScore?: number,
 * }} options
 * @returns {boolean}
 */
function shouldPersistExplorationBaseline(options = {}) {
  if (!options.previousSnapshot) return true;
  // While locked, only reseed when identity actually moved. Identical baselines
  // (changeScore 0) are no-ops — re-saving them caused tight pipeline ↔ SSE loops.
  if (options.reseedWhileLocked) return Number(options.changeScore) > 0;
  return false;
}

/**
 * Run the full identity → exploration pipeline for a user.
 *
 * @param {object} options
 * @param {string|import('mongoose').Types.ObjectId} options.userId
 * @param {object} options.currentIdentity - serializeProfile output (nodes/traits)
 * @param {object[]} [options.currentTraits]
 * @param {'en'|'de'} [options.language]
 * @param {string} [options.triggerSource]
 * @param {string} [options.pipelineId]
 * @param {object[]} [options.roles] - optional preloaded CareerPath pool
 * @param {boolean} [options.skipSaveSnapshot] - test hook
 * @param {boolean} [options.bypassSimulationUnlockGate] - test hook: allow delivery without first-sim unlock
 * @returns {Promise<object>}
 */
async function runIdentityExplorationPipeline(options = {}) {
  const userId = options.userId;
  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  const pipelineId = createPipelineId(options);
  const language = options.language === 'en' ? 'en' : 'de';
  const triggerSource = options.triggerSource || IDENTITY_PIPELINE_EVENTS.PUZZLE_UPDATED;
  const startedAt = Date.now();

  logger.info('identity.pipeline.start', {
    pipelineId,
    userId: String(userId),
    triggerSource,
    language,
  });

  try {
    // Never stack another Discover delivery while one is still unread.
    const pendingUnread = await getUnreadExplorationSession(userId);
    if (pendingUnread) {
      const session = await storeExplorationSessionStep({
        userId,
        pipelineId,
        status: 'skipped_pending_delivery',
        changeScore: 0,
        reasons: [],
        triggerLevel: 'none',
        explanation:
          'Skipped because an unread role-suggestion delivery is still waiting for the user.',
        explorationJobs: [],
        deltaMatchCount: 0,
        rolePoolSize: 0,
        language,
        triggerSource,
      });

      const result = {
        pipelineId,
        status: 'skipped_pending_delivery',
        changeScore: 0,
        reasons: [],
        shouldExplore: false,
        triggerLevel: 'none',
        explanation: {
          trigger: false,
          triggerReason: session.explanation,
          threshold: null,
          changeScore: 0,
          explorationSize: 0,
        },
        explorationJobs: [],
        sessionId: String(session._id),
        pendingSessionId: String(pendingUnread._id),
        durationMs: Date.now() - startedAt,
      };

      emitIdentityEvent(IDENTITY_PIPELINE_EVENTS.PIPELINE_COMPLETED, {
        userId: String(userId),
        pipelineId,
        status: result.status,
        changeScore: 0,
        sessionId: result.sessionId,
        jobCount: 0,
        pendingSessionId: result.pendingSessionId,
      });

      logger.info('identity.pipeline.completed', { ...result, userId: String(userId) });
      return result;
    }

    const previousSnapshot = await loadPreviousSnapshotStep({ userId, pipelineId });
    const currentSnapshot = createCurrentSnapshotStep({
      userId,
      pipelineId,
      currentIdentity: options.currentIdentity,
      currentTraits: options.currentTraits,
    });
    let explorationMode = resolveExplorationMode(previousSnapshot);

    const bypassUnlockGate = Boolean(options.bypassSimulationUnlockGate);
    let comparisonSnapshot = previousSnapshot;
    let deliveryAllowed = true;
    let reseedWhileLocked = false;

    if (!bypassUnlockGate) {
      const rankingsComplete = await hasCompletedFirstSimulationRankings(userId);
      if (rankingsComplete) {
        const { didUnlock } = await ensureExplorationAccumulationUnlocked(
          userId,
          options.currentIdentity || { nodes: [] }
        );
        if (didUnlock) {
          // In-memory prior snapshot is stale after the unlock baseline reset —
          // compare against current so this run cannot deliver onboarding delta.
          comparisonSnapshot = currentSnapshot;
          explorationMode = IDENTITY_PIPELINE_MODES.SUBSEQUENT;
        }
      }

      deliveryAllowed = await canDeliverExplorationRoles(userId);
      reseedWhileLocked = !deliveryAllowed;
    }

    logger.info('identity.pipeline.mode', {
      pipelineId,
      userId: String(userId),
      explorationMode,
      hasPreviousSnapshot: Boolean(previousSnapshot),
      deliveryAllowed,
      bypassUnlockGate,
    });

    let change = await evaluateExplorationGateStep({
      userId,
      pipelineId,
      explorationMode,
      previousSnapshot: comparisonSnapshot,
      currentSnapshot,
      language,
      traitVoteCount: options.traitVoteCount,
      adaptiveConfig: options.adaptiveConfig,
      signals: options.signals,
    });

    if (!deliveryAllowed && change.shouldExplore) {
      change = {
        ...change,
        shouldExplore: false,
        gate: {
          ...(change.gate || {}),
          trigger: false,
          triggerReason:
            language === 'de'
              ? 'Berufssimulation noch nicht abgeschlossen — Explorations-Baseline wird nur aktualisiert.'
              : 'First simulation rankings incomplete — reseeding exploration baseline only.',
          explorationSize: 0,
          adjustments: {
            ...(change.gate?.adjustments || {}),
            awaitingSimulationUnlock: true,
          },
        },
      };
    }

    if (!change.shouldExplore) {
      const isUnchangedLockedBaseline =
        reseedWhileLocked
        && Boolean(previousSnapshot)
        && Number(change.changeScore) === 0;

      // No identity movement while still locked — skip session spam / SSE churn.
      if (isUnchangedLockedBaseline) {
        const result = {
          pipelineId,
          explorationMode,
          status: 'skipped_unchanged',
          changeScore: change.changeScore,
          reasons: change.reasons,
          shouldExplore: false,
          triggerLevel: 'none',
          explanation: change.gate || {
            trigger: false,
            triggerReason:
              'Identity unchanged while exploration is still locked — baseline left as-is.',
            threshold: null,
            changeScore: change.changeScore,
            explorationSize: 0,
          },
          explorationJobs: [],
          sessionId: null,
          durationMs: Date.now() - startedAt,
        };
        logger.info('identity.pipeline.completed', { ...result, userId: String(userId) });
        return result;
      }

      const isFirstBaseline =
        (explorationMode === IDENTITY_PIPELINE_MODES.FIRST && !previousSnapshot)
        || reseedWhileLocked;

      const session = await storeExplorationSessionStep({
        userId,
        pipelineId,
        status: isFirstBaseline || reseedWhileLocked
          ? 'seeded_baseline'
          : 'skipped_below_threshold',
        changeScore: change.changeScore,
        reasons: change.reasons,
        triggerLevel: 'none',
        explanation: change.gate?.triggerReason
          || (isFirstBaseline || reseedWhileLocked
            ? 'Baseline identity snapshot stored. Role discovery unlocks after the first simulation.'
            : 'Identity change was too small to trigger exploration.'),
        gate: change.gate,
        explorationJobs: [],
        deltaMatchCount: 0,
        rolePoolSize: 0,
        language,
        triggerSource,
      });

      if (
        !options.skipSaveSnapshot
        && shouldPersistExplorationBaseline({
          previousSnapshot,
          sessionStatus: session.status,
          shouldExplore: false,
          reseedWhileLocked,
          changeScore: change.changeScore,
        })
      ) {
        await saveIdentitySnapshotStep({ userId, pipelineId, currentSnapshot });
      }

      const result = {
        pipelineId,
        explorationMode,
        status: session.status,
        changeScore: change.changeScore,
        reasons: change.reasons,
        shouldExplore: false,
        triggerLevel: 'none',
        explanation: change.gate || {
          trigger: false,
          triggerReason: session.explanation,
          threshold: null,
          changeScore: change.changeScore,
          explorationSize: 0,
        },
        explorationJobs: [],
        sessionId: String(session._id),
        durationMs: Date.now() - startedAt,
      };

      emitIdentityEvent(IDENTITY_PIPELINE_EVENTS.PIPELINE_COMPLETED, {
        userId: String(userId),
        pipelineId,
        status: result.status,
        changeScore: result.changeScore,
        sessionId: result.sessionId,
        jobCount: 0,
        explorationMode,
      });

      logger.info('identity.pipeline.completed', { ...result, userId: String(userId) });
      return result;
    }

    // Notify clients as soon as the unlock threshold is crossed so the progress
    // card can leave 0%/accumulating and show "Preparing…" while matching runs.
    emitIdentityEvent(IDENTITY_PIPELINE_EVENTS.EXPLORATION_THRESHOLD_REACHED, {
      userId: String(userId),
      pipelineId,
      changeScore: change.changeScore,
      threshold: change.gate?.threshold ?? null,
      explorationSize: change.gate?.explorationSize ?? null,
      explorationMode,
      reasons: change.reasons,
    });

    const { deltaJobMatches, rolePoolSize } = await runJobMatchingStep({
      userId,
      pipelineId,
      explorationMode,
      previousSnapshot,
      currentSnapshot,
      roles: options.roles,
      rolePoolLimit: options.rolePoolLimit,
    });

    if (!deltaJobMatches.length) {
      const session = await storeExplorationSessionStep({
        userId,
        pipelineId,
        status: 'skipped_empty_pool',
        changeScore: change.changeScore,
        reasons: change.reasons,
        triggerLevel: 'none',
        explanation:
          explorationMode === IDENTITY_PIPELINE_MODES.FIRST
            ? 'First identity exploration could not find matching roles in the pool.'
            : 'Identity changed significantly, but no delta job matches were available.',
        gate: change.gate,
        explorationJobs: [],
        deltaMatchCount: 0,
        rolePoolSize,
        language,
        triggerSource,
      });

      if (
        !options.skipSaveSnapshot
        && shouldPersistExplorationBaseline({
          previousSnapshot,
          sessionStatus: session.status,
          shouldExplore: true,
          hasUnreadExploration: Boolean(await getUnreadExplorationSession(userId)),
        })
      ) {
        await saveIdentitySnapshotStep({ userId, pipelineId, currentSnapshot });
      }

      const result = {
        pipelineId,
        explorationMode,
        status: 'skipped_empty_pool',
        changeScore: change.changeScore,
        reasons: change.reasons,
        shouldExplore: true,
        triggerLevel: 'none',
        explanation: change.gate || {
          trigger: true,
          triggerReason: session.explanation,
          threshold: null,
          changeScore: change.changeScore,
          explorationSize: change.gate?.explorationSize || 0,
        },
        explorationJobs: [],
        sessionId: String(session._id),
        rolePoolSize,
        durationMs: Date.now() - startedAt,
      };

      emitIdentityEvent(IDENTITY_PIPELINE_EVENTS.PIPELINE_COMPLETED, {
        userId: String(userId),
        pipelineId,
        status: result.status,
        sessionId: result.sessionId,
        jobCount: 0,
        changeScore: result.changeScore,
        explorationMode,
      });

      logger.info('identity.pipeline.completed', { ...result, userId: String(userId) });
      return result;
    }

    const exploration = await generateExplorationStep({
      userId,
      pipelineId,
      deltaJobMatches,
      changeScore: change.changeScore,
      reasons: change.reasons,
      previousSnapshot,
      currentSnapshot,
      language,
      recentlyRatedJobIds: options.recentlyRatedJobIds,
      acceptedJobIds: options.acceptedJobIds,
      explorationSize: change.gate?.explorationSize,
      gate: change.gate,
    });

    if (!exploration.explorationJobs.length) {
      const session = await storeExplorationSessionStep({
        userId,
        pipelineId,
        status: 'skipped_empty_pool',
        changeScore: change.changeScore,
        reasons: change.reasons,
        triggerLevel: 'none',
        explanation:
          'Identity changed, but no new career matches remained after quality and deduplication filters.',
        gate: {
          ...change.gate,
          ranking: exploration.ranking,
        },
        explorationJobs: [],
        deltaMatchCount: deltaJobMatches.length,
        rolePoolSize,
        language,
        triggerSource,
      });

      if (
        !options.skipSaveSnapshot
        && shouldPersistExplorationBaseline({
          previousSnapshot,
          sessionStatus: session.status,
          shouldExplore: true,
          hasUnreadExploration: Boolean(await getUnreadExplorationSession(userId)),
        })
      ) {
        await saveIdentitySnapshotStep({ userId, pipelineId, currentSnapshot });
      }

      const result = {
        pipelineId,
        explorationMode,
        status: 'skipped_empty_pool',
        changeScore: change.changeScore,
        reasons: change.reasons,
        shouldExplore: true,
        triggerLevel: 'none',
        explanation: change.gate,
        explorationJobs: [],
        sessionId: String(session._id),
        rolePoolSize,
        deltaMatchCount: deltaJobMatches.length,
        ranking: exploration.ranking,
        durationMs: Date.now() - startedAt,
      };

      emitIdentityEvent(IDENTITY_PIPELINE_EVENTS.PIPELINE_COMPLETED, {
        userId: String(userId),
        pipelineId,
        status: result.status,
        sessionId: result.sessionId,
        jobCount: 0,
        changeScore: result.changeScore,
        explorationMode,
      });

      logger.info('identity.pipeline.completed', { ...result, userId: String(userId) });
      return result;
    }

    const session = await storeExplorationSessionStep({
      userId,
      pipelineId,
      status: 'completed',
      changeScore: change.changeScore,
      reasons: change.reasons,
      triggerLevel: exploration.triggerLevel,
      explanation: exploration.explanation,
      gate: {
        ...change.gate,
        ranking: exploration.ranking,
      },
      explorationJobs: exploration.explorationJobs,
      deltaMatchCount: deltaJobMatches.length,
      rolePoolSize,
      language,
      triggerSource,
    });

    if (
      !options.skipSaveSnapshot
      && shouldPersistExplorationBaseline({
        previousSnapshot,
        sessionStatus: session.status,
        shouldExplore: true,
      })
    ) {
      await saveIdentitySnapshotStep({ userId, pipelineId, currentSnapshot });
    }

    const result = {
      pipelineId,
      explorationMode,
      status: 'completed',
      changeScore: change.changeScore,
      reasons: change.reasons,
      shouldExplore: true,
      triggerLevel: exploration.triggerLevel,
      explanation: change.gate || {
        trigger: true,
        triggerReason: exploration.explanation,
        threshold: null,
        changeScore: change.changeScore,
        explorationSize: exploration.explorationJobs.length,
      },
      narrativeExplanation: exploration.explanation,
      explorationJobs: exploration.explorationJobs,
      sessionId: String(session._id),
      deltaMatchCount: deltaJobMatches.length,
      rolePoolSize,
      durationMs: Date.now() - startedAt,
    };

    emitIdentityEvent(IDENTITY_PIPELINE_EVENTS.PIPELINE_COMPLETED, {
      userId: String(userId),
      pipelineId,
      status: result.status,
      triggerLevel: result.triggerLevel,
      jobCount: result.explorationJobs.length,
      changeScore: result.changeScore,
      sessionId: result.sessionId,
      explorationMode,
    });

    logger.info('identity.pipeline.completed', {
      pipelineId,
      userId: String(userId),
      explorationMode,
      status: result.status,
      triggerLevel: result.triggerLevel,
      jobCount: result.explorationJobs.length,
      changeScore: result.changeScore,
      durationMs: result.durationMs,
    });

    return result;
  } catch (err) {
    logger.error('identity.pipeline.failed', {
      pipelineId,
      userId: String(userId),
      error: err,
    });

    try {
      await storeExplorationSessionStep({
        userId,
        pipelineId,
        status: 'failed',
        changeScore: 0,
        reasons: [],
        triggerLevel: 'none',
        explanation: '',
        explorationJobs: [],
        language,
        triggerSource,
        errorMessage: err.message || 'Pipeline failed',
      });
    } catch (persistErr) {
      logger.error('identity.pipeline.failed_session_persist_error', {
        pipelineId,
        userId: String(userId),
        error: persistErr,
      });
    }

    emitIdentityEvent(IDENTITY_PIPELINE_EVENTS.PIPELINE_FAILED, {
      userId: String(userId),
      pipelineId,
      message: err.message,
    });

    throw err;
  }
}

module.exports = {
  runIdentityExplorationPipeline,
  createPipelineId,
  resolveExplorationMode,
  shouldPersistExplorationBaseline,
};
