/**
 * Collect signals that drive the adaptive exploration threshold.
 *
 * Modular on purpose — swap or extend collectors without touching the gate.
 */

const User = require('../../../../models/User');
const IdentityExplorationSession = require('../../../../models/IdentityExplorationSession');
const { getSnapshotPieces } = require('../../snapshotService');
const {
  ADAPTIVE_EVOLUTION_STABILITY,
  ADAPTIVE_EVOLUTION_FATIGUE,
} = require('../../../../../constants/adaptiveEvolutionConfig');
const logger = require('../../../../utils/logger');

/**
 * @param {object|null|undefined} snapshot
 * @returns {number} average confidence 0–1
 */
function averagePuzzleConfidence(snapshot) {
  const pieces = getSnapshotPieces(snapshot);
  if (pieces.length === 0) return 0;
  const sum = pieces.reduce((acc, p) => acc + (Number(p.confidence) || 0), 0);
  return sum / pieces.length;
}

/**
 * Jaccard similarity of trait id sets (0 = disjoint, 1 = identical).
 * @param {object|null|undefined} previousSnapshot
 * @param {object|null|undefined} currentSnapshot
 * @returns {number}
 */
function traitSetStability(previousSnapshot, currentSnapshot) {
  const prev = new Set(getSnapshotPieces(previousSnapshot).map((p) => p.traitId));
  const curr = new Set(getSnapshotPieces(currentSnapshot).map((p) => p.traitId));
  if (prev.size === 0 && curr.size === 0) return 1;
  if (prev.size === 0 || curr.size === 0) return 0;

  let intersection = 0;
  for (const id of prev) {
    if (curr.has(id)) intersection += 1;
  }
  const union = prev.size + curr.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Rough interaction volume from the user document + current puzzle evidence.
 * @param {object|null|undefined} user
 * @param {object|null|undefined} currentSnapshot
 * @returns {number}
 */
function countInteractions(user, currentSnapshot) {
  let count = 0;

  const pieces = getSnapshotPieces(currentSnapshot);
  for (const piece of pieces) {
    count += Math.max(0, Number(piece.evidenceCount) || 0);
  }

  const sims = Array.isArray(user?.simulationResults) ? user.simulationResults : [];
  count += sims.length;
  if (user?.lastSimulationResult) count += 1;

  // Trait votes are not on User — loaded separately when provided via options.
  return count;
}

/**
 * @param {Array<{ changeScore?: number, status?: string }>} recentSessions
 * @returns {number} 0–1 calmness (1 = historically calm)
 */
function historicalCalmness(recentSessions) {
  const scored = (recentSessions || [])
    .filter((s) => s && Number.isFinite(s.changeScore))
    .slice(0, ADAPTIVE_EVOLUTION_STABILITY.HISTORY_WINDOW);

  if (scored.length === 0) return 0.5; // neutral prior

  const avg =
    scored.reduce((acc, s) => acc + Math.max(0, Number(s.changeScore) || 0), 0)
    / scored.length;
  // Map avg changeScore 0–100 → calmness 1–0
  return Math.max(0, Math.min(1, 1 - avg / 100));
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{
 *   currentSnapshot?: object,
 *   previousSnapshot?: object,
 *   traitVoteCount?: number,
 *   now?: Date,
 * }} [options]
 * @returns {Promise<{
 *   interactionCount: number,
 *   averageConfidence: number,
 *   stability: number,
 *   traitOverlap: number,
 *   historicalCalmness: number,
 *   recentExplorationSessions: number,
 *   recentExplorationJobs: number,
 *   hoursSinceLastExploration: number|null,
 * }>}
 */
async function collectAdaptiveEvolutionSignals(userId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const windowMs = ADAPTIVE_EVOLUTION_FATIGUE.WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const since = new Date(now.getTime() - windowMs);

  const [user, recentSessions, lastCompleted] = await Promise.all([
    User.findById(userId)
      .select({
        simulationResults: 1,
        lastSimulationResult: 1,
      })
      .lean(),
    IdentityExplorationSession.find({
      userId,
      createdAt: { $gte: since },
      status: { $in: ['completed', 'skipped_below_threshold', 'skipped_empty_pool'] },
    })
      .sort({ createdAt: -1 })
      .select({ changeScore: 1, status: 1, explorationJobs: 1, createdAt: 1 })
      .limit(20)
      .lean(),
    IdentityExplorationSession.findOne({
      userId,
      status: 'completed',
    })
      .sort({ createdAt: -1 })
      .select({ createdAt: 1, explorationJobs: 1 })
      .lean(),
  ]);

  const completedRecent = recentSessions.filter((s) => s.status === 'completed');
  const recentExplorationSessions = completedRecent.length;
  const recentExplorationJobs = completedRecent.reduce(
    (acc, s) => acc + (Array.isArray(s.explorationJobs) ? s.explorationJobs.length : 0),
    0
  );

  let hoursSinceLastExploration = null;
  if (lastCompleted?.createdAt) {
    hoursSinceLastExploration =
      (now.getTime() - new Date(lastCompleted.createdAt).getTime()) / (1000 * 60 * 60);
  }

  const traitOverlap = traitSetStability(options.previousSnapshot, options.currentSnapshot);
  const calm = historicalCalmness(recentSessions);
  const stability = Math.max(
    0,
    Math.min(
      1,
      traitOverlap * ADAPTIVE_EVOLUTION_STABILITY.OVERLAP_WEIGHT
        + calm * ADAPTIVE_EVOLUTION_STABILITY.HISTORICAL_WEIGHT
    )
  );

  const interactionCount =
    countInteractions(user, options.currentSnapshot)
    + Math.max(0, Number(options.traitVoteCount) || 0);

  const averageConfidence = averagePuzzleConfidence(options.currentSnapshot);

  const signals = {
    interactionCount,
    averageConfidence: Math.round(averageConfidence * 1000) / 1000,
    stability: Math.round(stability * 1000) / 1000,
    traitOverlap: Math.round(traitOverlap * 1000) / 1000,
    historicalCalmness: Math.round(calm * 1000) / 1000,
    recentExplorationSessions,
    recentExplorationJobs,
    hoursSinceLastExploration:
      hoursSinceLastExploration == null
        ? null
        : Math.round(hoursSinceLastExploration * 10) / 10,
  };

  logger.info('identity.adaptive.signals', {
    userId: String(userId),
    ...signals,
  });

  return signals;
}

module.exports = {
  collectAdaptiveEvolutionSignals,
  averagePuzzleConfidence,
  traitSetStability,
  countInteractions,
  historicalCalmness,
};
