const identityEngine = require('../services/careerIdentity/identityEngine');
const {
  enqueueIdentityExplorationForUser,
  shouldEnqueueProgressKick,
} = require('../services/careerIdentity/pipeline/registerIdentityPipelineHandlers');
const {
  getLatestExplorationSession,
  getExplorationSessionById,
  markExplorationSessionSeen,
  markAllUnreadExplorationSessionsSeen,
  updateExplorationRankingProgress,
  withExplorationNotification,
  isNotifiableExplorationSession,
} = require('../services/careerIdentity/pipeline/explorationSessionService');
const {
  getIdentityExplorationProgress,
  resetExplorationProgressBaseline,
} = require('../services/careerIdentity/explorationProgressService');
const {
  ensureExplorationAccumulationUnlocked,
  hasCompletedFirstSimulationRankings,
  isExplorationAccumulationUnlocked,
} = require('../services/careerIdentity/explorationUnlockService');
const {
  IDENTITY_PIPELINE_EVENTS,
  subscribeIdentityEvent,
  emitIdentityEvent,
} = require('../services/careerIdentity/pipeline/identityEventBus');
const logger = require('../utils/logger');

function getUserId(req) {
  return req.user && req.user.userId;
}

function getLanguage(req) {
  const lang = String(req.query.lang || req.body?.lang || req.language || '').toLowerCase();
  return lang === 'en' ? 'en' : 'de';
}

function handleError(res, err, fallbackMessage) {
  const status = err.status || 500;
  if (status >= 500) {
    logger.error('careerIdentity.controller_error', { error: err });
  }
  return res.status(status).json({
    message: err.message || fallbackMessage,
  });
}

async function respondWithIdentity(res, userId, identity, options = {}) {
  // Until exploration accumulation is unlocked, clear false Discover sessions
  // and reseed the baseline so onboarding never shows inflated progress.
  // When rankings are complete, stamp the unlock using a refreshed identity.
  let identityForResponse = identity;
  let didUnlock = false;
  let healedOnboarding = false;

  if (!(await isExplorationAccumulationUnlocked(userId))) {
    if (await hasCompletedFirstSimulationRankings(userId)) {
      try {
        identityForResponse = await identityEngine.forceRefreshIdentity(userId, {
          language: options.language === 'en' ? 'en' : 'de',
          skipPipelineEmit: true,
        });
      } catch (refreshErr) {
        logger.warn('identity.exploration.unlock_refresh_failed', {
          userId: String(userId),
          error: refreshErr?.message || String(refreshErr),
        });
        identityForResponse = identity;
      }
    }

    ({ didUnlock, healedOnboarding } = await ensureExplorationAccumulationUnlocked(
      userId,
      identityForResponse
    ));
  }

  const enriched = await withExplorationNotification(identityForResponse, userId);
  const explorationProgress = await getIdentityExplorationProgress(userId, enriched, {
    ...options,
    hasUnreadExploration: Boolean(enriched.explorationNotification?.hasUnreadExploration),
  });

  if (
    !didUnlock
    && !healedOnboarding
    && (
      explorationProgress.phase === 'ready'
      || explorationProgress.phase === 'preparing'
    )
    && !enriched.explorationNotification?.hasUnreadExploration
    // Empty/failed searches stay in "preparing" on purpose — retry on new
    // user activity (scheduleIdentityExplorationAfterActivity), not every GET.
    && explorationProgress.latestSessionStatus !== 'skipped_empty_pool'
    && explorationProgress.latestSessionStatus !== 'failed'
    && shouldEnqueueProgressKick(userId)
  ) {
    try {
      emitIdentityEvent(IDENTITY_PIPELINE_EVENTS.PUZZLE_UPDATED, {
        userId: String(userId),
        identity: enriched,
        traits: (enriched.nodes || []).map((node) => ({
          traitId: node.id,
          category: node.category,
          confidence: node.confidence,
          layer: node.layer,
        })),
        language: options.language === 'en' ? 'en' : 'de',
        force: true,
      });
    } catch (err) {
      logger.error('identity.exploration.progress_kick_failed', {
        userId: String(userId),
        error: err,
      });
    }
  }

  return res.json({
    identity: {
      ...enriched,
      explorationProgress,
    },
  });
}

/**
 * GET /api/career-identity
 */
async function getCareerIdentity(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const identity = await identityEngine.getIdentity(userId, {
      language: getLanguage(req),
    });
    return respondWithIdentity(res, userId, identity, {
      language: getLanguage(req),
    });
  } catch (err) {
    return handleError(res, err, 'Failed to load career identity');
  }
}

/**
 * GET /api/career-identity/traits/:traitId
 */
async function getTraitDetail(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const trait = await identityEngine.getTraitDetail(userId, req.params.traitId, {
      language: getLanguage(req),
    });
    return res.json({ trait });
  } catch (err) {
    return handleError(res, err, 'Failed to load trait detail');
  }
}

/**
 * PUT /api/career-identity/traits/:traitId/vote
 * Body: { vote: 'confirm' | 'unsure' | 'reject' | null }
 */
async function voteOnTrait(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const identity = await identityEngine.setTraitVote(
      userId,
      req.params.traitId,
      req.body?.vote,
      { language: getLanguage(req) }
    );
    try {
      const { logUserActivity, ACTIVITY_TYPES } = require('../services/userHistory/logUserActivity');
      logUserActivity(userId, {
        type: ACTIVITY_TYPES.TRAIT_VOTED,
        meta: {
          traitId: req.params.traitId,
          vote: req.body?.vote ?? null,
        },
      });
    } catch (historyErr) {
      logger.warn('careerIdentity.trait_vote_history_log_failed', {
        error: historyErr?.message || String(historyErr),
      });
    }
    return respondWithIdentity(res, userId, identity, {
      language: getLanguage(req),
    });
  } catch (err) {
    return handleError(res, err, 'Failed to save trait vote');
  }
}

/**
 * POST /api/career-identity/refresh
 */
async function refreshCareerIdentity(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const identity = await identityEngine.forceRefreshIdentity(userId, {
      language: getLanguage(req),
    });
    return respondWithIdentity(res, userId, identity, {
      language: getLanguage(req),
    });
  } catch (err) {
    return handleError(res, err, 'Failed to refresh career identity');
  }
}

/**
 * POST /api/career-identity/exploration/run
 * Explicitly runs the exploration pipeline against the current identity.
 */
async function runCareerExploration(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const language = getLanguage(req);

    const identity = await identityEngine.forceRefreshIdentity(userId, {
      language,
      // API runs the pipeline explicitly — avoid duplicate event-driven run.
      skipPipelineEmit: true,
    });
    const result = await enqueueIdentityExplorationForUser({
      userId,
      identity,
      language,
      triggerSource: 'api',
    });

    const enrichedIdentity = await withExplorationNotification(identity, userId);
    const explorationProgress = await getIdentityExplorationProgress(userId, enrichedIdentity, {
      language,
      hasUnreadExploration: Boolean(
        enrichedIdentity.explorationNotification?.hasUnreadExploration
      ),
    });
    return res.json({
      exploration: result,
      identity: {
        ...enrichedIdentity,
        explorationProgress,
      },
    });
  } catch (err) {
    return handleError(res, err, 'Failed to run career exploration');
  }
}

/**
 * GET /api/career-identity/exploration/latest
 */
async function getLatestCareerExploration(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const session = await getLatestExplorationSession(userId);
    return res.json({
      session,
      hasUnreadExploration:
        Boolean(session) &&
        isNotifiableExplorationSession(session) &&
        session.seenAt == null,
    });
  } catch (err) {
    return handleError(res, err, 'Failed to load exploration session');
  }
}

/**
 * GET /api/career-identity/exploration/:sessionId
 */
async function getCareerExplorationById(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const session = await getExplorationSessionById(userId, req.params.sessionId);
    if (!session) return res.status(404).json({ message: 'Exploration session not found' });
    return res.json({
      session,
      hasUnreadExploration:
        isNotifiableExplorationSession(session) && session.seenAt == null,
    });
  } catch (err) {
    return handleError(res, err, 'Failed to load exploration session');
  }
}

/**
 * PUT /api/career-identity/exploration/:sessionId/ranking
 * Persist mid-flow Discover Keep/Skip/Dislike progress (pause/resume).
 */
async function updateCareerExplorationRanking(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const rankingProgress = req.body?.rankingProgress;
    if (!rankingProgress || typeof rankingProgress !== 'object') {
      return res.status(400).json({ message: 'rankingProgress is required' });
    }

    const session = await updateExplorationRankingProgress(
      userId,
      req.params.sessionId,
      rankingProgress
    );
    if (!session) {
      return res.status(404).json({ message: 'Exploration session not found or already completed' });
    }

    return res.json({
      success: true,
      session,
      hasUnreadExploration:
        isNotifiableExplorationSession(session) && session.seenAt == null,
    });
  } catch (err) {
    return handleError(res, err, 'Failed to persist exploration ranking progress');
  }
}

/**
 * POST /api/career-identity/exploration/:sessionId/seen
 * Marks the session as seen so the discovery CTA is not repeated.
 */
async function markCareerExplorationSeen(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const language = getLanguage(req);
    const preferredSessionId = req.params.sessionId;

    // Consume every stacked unread delivery so Discover cannot reappear immediately.
    const { preferredSession, markedCount } = await markAllUnreadExplorationSessionsSeen(
      userId,
      preferredSessionId
    );
    const session =
      preferredSession
      || (await markExplorationSessionSeen(userId, preferredSessionId));
    if (!session) return res.status(404).json({ message: 'Exploration session not found' });

    const shouldResetBaseline =
      markedCount > 0
      || (
        session.status === 'completed'
        && Array.isArray(session.explorationJobs)
        && session.explorationJobs.length > 0
      );

    if (shouldResetBaseline) {
      // Baseline only needs current nodes for change-score zeroing — avoid a full
      // force recompute so the client can leave Discover without waiting on it.
      const identity = await identityEngine.getIdentity(userId, {
        language,
        skipPipelineEmit: true,
      });
      await resetExplorationProgressBaseline(userId, identity);
    }

    return res.json({
      session,
      hasUnreadExploration: false,
      markedCount,
    });
  } catch (err) {
    return handleError(res, err, 'Failed to mark exploration session as seen');
  }
}

/**
 * GET /api/career-identity/exploration/events
 * SSE stream of exploration pipeline completion for the authenticated user.
 * EventSource cannot send Authorization headers — use ?access_token=.
 */
async function streamCareerExplorationEvents(req, res) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const userIdStr = String(userId);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let closed = false;
  const heartbeatIntervalMs = Math.max(
    5000,
    Number(process.env.IDENTITY_EXPLORATION_SSE_HEARTBEAT_MS || 15000)
  );

  const writeData = (payload) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const writeHeartbeat = () => {
    if (closed) return;
    res.write('event: heartbeat\ndata: {}\n\n');
  };

  const onCompleted = (payload = {}) => {
    if (String(payload.userId || '') !== userIdStr) return;
    const jobCount = Number(payload.jobCount || 0);
    const status = payload.status || null;

    if (status === 'completed' && jobCount > 0) {
      writeData({
        type: 'exploration_completed',
        sessionId: payload.sessionId || null,
        pipelineId: payload.pipelineId || null,
        status,
        jobCount,
        changeScore: payload.changeScore ?? null,
        triggerLevel: payload.triggerLevel || null,
        hasUnreadExploration: true,
      });
      return;
    }

    // Let clients leave the "ready / preparing" progress state when a run
    // finishes without deliverable roles (empty pool, below threshold, etc.).
    writeData({
      type: 'exploration_finished',
      sessionId: payload.sessionId || null,
      pipelineId: payload.pipelineId || null,
      status,
      jobCount,
      changeScore: payload.changeScore ?? null,
    });
  };

  const onThresholdReached = (payload = {}) => {
    if (String(payload.userId || '') !== userIdStr) return;
    writeData({
      type: 'exploration_preparing',
      pipelineId: payload.pipelineId || null,
      changeScore: payload.changeScore ?? null,
      threshold: payload.threshold ?? null,
      explorationSize: payload.explorationSize ?? null,
    });
  };

  const heartbeatTimer = setInterval(writeHeartbeat, heartbeatIntervalMs);

  const unsubscribeCompleted = subscribeIdentityEvent(
    IDENTITY_PIPELINE_EVENTS.PIPELINE_COMPLETED,
    onCompleted
  );
  const unsubscribeThreshold = subscribeIdentityEvent(
    IDENTITY_PIPELINE_EVENTS.EXPLORATION_THRESHOLD_REACHED,
    onThresholdReached
  );

  writeData({ type: 'connected' });
  writeHeartbeat();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    unsubscribeCompleted();
    unsubscribeThreshold();
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);

  logger.info('identity.exploration.sse_connected', { userId: userIdStr });
}

module.exports = {
  getCareerIdentity,
  getTraitDetail,
  voteOnTrait,
  refreshCareerIdentity,
  runCareerExploration,
  getLatestCareerExploration,
  getCareerExplorationById,
  updateCareerExplorationRanking,
  markCareerExplorationSeen,
  streamCareerExplorationEvents,
};
