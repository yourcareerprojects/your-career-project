const { loadLatestSnapshot, createSnapshot, getSnapshotPieces, saveSnapshot } = require('./snapshotService');
const { calculateIdentityChangeScore } = require('./identityEvolutionService');
const { getLatestExplorationSession } = require('./pipeline/explorationSessionService');
const {
  EXPLORATION_MEANINGFUL_CHANGE_SCORE,
} = require('../../../constants/explorationPresentationConfig');

function roundScore(value) {
  return Math.round(Math.max(0, Number(value) || 0) * 10) / 10;
}

function resolveSessionTimestamp(session) {
  if (!session) return 0;
  const value = session.createdAt || session.updatedAt;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @param {Date|string|number|null|undefined} baselineCapturedAt
 * @param {object|null|undefined} session
 */
function sessionIsAfterBaseline(baselineCapturedAt, session) {
  if (!session) return false;
  const baselineTs = baselineCapturedAt ? new Date(baselineCapturedAt).getTime() : 0;
  return resolveSessionTimestamp(session) > baselineTs;
}

/**
 * @param {{
 *   changeScore: number,
 *   threshold: number,
 *   hasUnreadExploration?: boolean,
 *   latestSession?: object|null,
 *   baselineCapturedAt?: Date|string|null,
 * }} input
 * @returns {'accumulating'|'ready'|'preparing'|'delivered'}
 */
function resolveExplorationProgressPhase(input) {
  const threshold = Number(input.threshold) || EXPLORATION_MEANINGFUL_CHANGE_SCORE;
  const changeScore = Number(input.changeScore) || 0;
  const session = input.latestSession || null;
  const afterBaseline = sessionIsAfterBaseline(input.baselineCapturedAt, session);

  if (input.hasUnreadExploration) {
    return 'delivered';
  }

  if (changeScore < threshold) {
    return 'accumulating';
  }

  if (
    afterBaseline
    && (session?.status === 'failed' || session?.status === 'skipped_empty_pool')
  ) {
    return 'preparing';
  }

  return 'ready';
}

/**
 * Compute how far the current identity has moved from the last exploration
 * baseline toward the next meaningful-change threshold.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {object} currentIdentity
 * @param {{ language?: 'en'|'de', hasUnreadExploration?: boolean }} [options]
 */
async function getIdentityExplorationProgress(userId, currentIdentity, options = {}) {
  const baseline = await loadLatestSnapshot(userId);
  const threshold = Number(EXPLORATION_MEANINGFUL_CHANGE_SCORE) || 5;
  const latestSession = await getLatestExplorationSession(userId);

  if (!baseline) {
    return {
      hasBaseline: false,
      phase: 'accumulating',
      changeScore: 0,
      cappedChangeScore: 0,
      threshold,
      progressPercent: 0,
      remainingScore: threshold,
      isReady: false,
      reasons: [],
      baselineCapturedAt: null,
      latestSessionStatus: latestSession?.status || null,
    };
  }

  const currentSnapshot = createSnapshot(
    currentIdentity?.nodes ? { nodes: currentIdentity.nodes } : currentIdentity
  );
  const result = calculateIdentityChangeScore(
    getSnapshotPieces(baseline),
    getSnapshotPieces(currentSnapshot),
    { language: options.language === 'en' ? 'en' : 'de' }
  );

  const changeScore = roundScore(result.changeScore);
  const cappedChangeScore = roundScore(Math.min(changeScore, threshold));
  const remainingScore = roundScore(Math.max(0, threshold - changeScore));
  const progressPercent = Math.max(
    0,
    Math.min(100, Math.round((cappedChangeScore / threshold) * 100))
  );
  const phase = resolveExplorationProgressPhase({
    changeScore,
    threshold,
    hasUnreadExploration: Boolean(options.hasUnreadExploration),
    latestSession,
    baselineCapturedAt: baseline.capturedAt || null,
  });

  return {
    hasBaseline: true,
    phase,
    changeScore,
    cappedChangeScore,
    threshold,
    progressPercent,
    remainingScore,
    isReady: changeScore >= threshold,
    reasons: Array.isArray(result.reasons) ? result.reasons.slice(0, 3) : [],
    baselineCapturedAt: baseline.capturedAt || null,
    latestSessionStatus: latestSession?.status || null,
  };
}

/**
 * Start a fresh accumulation cycle after the user has consumed role suggestions.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {object} currentIdentity
 */
async function resetExplorationProgressBaseline(userId, currentIdentity) {
  const snapshot = createSnapshot(
    currentIdentity?.nodes ? { nodes: currentIdentity.nodes } : currentIdentity,
    { capturedAt: new Date() }
  );
  return saveSnapshot(userId, snapshot);
}

module.exports = {
  getIdentityExplorationProgress,
  resetExplorationProgressBaseline,
  resolveExplorationProgressPhase,
};
