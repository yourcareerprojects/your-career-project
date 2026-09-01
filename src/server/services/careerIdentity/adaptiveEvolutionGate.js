/**
 * Adaptive Evolution Gate
 * =======================
 *
 * Legacy entry point — delegates presentation decisions to
 * explorationPresentationStrategy.js.
 *
 * `trigger` now means "meaningful change worth computing exploration for".
 * Magnitude → job count / prominence / notification intensity.
 */

const {
  collectAdaptiveEvolutionSignals,
} = require('./pipeline/collectors/adaptiveSignalsCollector');
const {
  resolveExplorationPresentation,
} = require('./explorationPresentationStrategy');
const {
  EXPLORATION_MEANINGFUL_CHANGE_SCORE,
  EXPLORATION_PRESENTATION_BANDS,
} = require('../../../constants/explorationPresentationConfig');
const logger = require('../../utils/logger');

/**
 * @typedef {Object} AdaptiveGateExplanation
 * @property {boolean} trigger
 * @property {string} triggerReason
 * @property {number} threshold
 * @property {number} changeScore
 * @property {number} explorationSize
 * @property {string} [evolutionTier]
 * @property {object} [presentation]
 * @property {object} [signals]
 * @property {object} [adjustments]
 */

/**
 * @param {number} changeScore
 * @param {object} [config]
 * @returns {{ evolutionTier: string, explorationSize: number, minJobs: number, maxJobs: number }}
 */
function resolveExplorationSize(changeScore, config = {}) {
  const presentation = resolveExplorationPresentation(changeScore, {
    interactionCount: 0,
    averageConfidence: 0.5,
    stability: 0.5,
    traitOverlap: 0.5,
    historicalCalmness: 0.5,
    recentExplorationSessions: 0,
    recentExplorationJobs: 0,
    hoursSinceLastExploration: null,
  }, { config });

  if (!presentation.shouldExplore) {
    return { evolutionTier: 'none', explorationSize: 0, minJobs: 0, maxJobs: 0 };
  }

  return {
    evolutionTier: presentation.tier,
    explorationSize: presentation.targetJobCount,
    minJobs: presentation.minJobs,
    maxJobs: presentation.maxJobs,
  };
}

/**
 * @deprecated Threshold is no longer used to block exploration. Returns meaningful-change floor.
 */
function computeAdaptiveThreshold(signals, config = {}) {
  const floor = config?.meaningfulChangeScore ?? EXPLORATION_MEANINGFUL_CHANGE_SCORE;
  return {
    threshold: floor,
    adjustments: {
      legacy: true,
      meaningfulChangeFloor: floor,
      signalsSummary: {
        interactionCount: signals?.interactionCount,
        recentExplorationSessions: signals?.recentExplorationSessions,
      },
    },
  };
}

/**
 * @param {number} changeScore
 * @param {object} signals
 * @param {{ reasons?: string[], config?: object, language?: string }} [options]
 * @returns {AdaptiveGateExplanation}
 */
function evaluateAdaptiveGateFromSignals(changeScore, signals, options = {}) {
  const score = Number(changeScore) || 0;
  const presentation = resolveExplorationPresentation(score, signals, options);
  const floor = options.config?.meaningfulChangeScore ?? EXPLORATION_MEANINGFUL_CHANGE_SCORE;

  return {
    trigger: presentation.shouldExplore,
    triggerReason: presentation.reason,
    threshold: floor,
    changeScore: score,
    explorationSize: presentation.targetJobCount,
    evolutionTier: presentation.tier,
    signals,
    adjustments: presentation.adjustments,
    presentation,
    reasons: Array.isArray(options.reasons) ? options.reasons : [],
  };
}

/**
 * @param {{
 *   userId: string|import('mongoose').Types.ObjectId,
 *   changeScore: number,
 *   reasons?: string[],
 *   currentSnapshot?: object,
 *   previousSnapshot?: object,
 *   traitVoteCount?: number,
 *   signals?: object,
 *   config?: object,
 *   language?: string,
 *   now?: Date,
 * }} options
 * @returns {Promise<AdaptiveGateExplanation>}
 */
async function evaluateAdaptiveExplorationGate(options = {}) {
  const signals =
    options.signals
    || (await collectAdaptiveEvolutionSignals(options.userId, {
      currentSnapshot: options.currentSnapshot,
      previousSnapshot: options.previousSnapshot,
      traitVoteCount: options.traitVoteCount,
      now: options.now,
    }));

  const explanation = evaluateAdaptiveGateFromSignals(
    options.changeScore,
    signals,
    { reasons: options.reasons, config: options.config, language: options.language }
  );

  logger.info('identity.adaptive.gate', {
    userId: options.userId ? String(options.userId) : undefined,
    trigger: explanation.trigger,
    threshold: explanation.threshold,
    changeScore: explanation.changeScore,
    explorationSize: explanation.explorationSize,
    evolutionTier: explanation.evolutionTier,
    prominence: explanation.presentation?.prominence,
    notify: explanation.presentation?.notify,
  });

  return explanation;
}

/**
 * First pipeline run — uses presentation bands on a synthetic richness score.
 */
async function evaluateFirstExplorationGate(options = {}) {
  const { IDENTITY_PIPELINE_CONFIG } = require('../../../constants/identityPipelineConfig');
  const { getSnapshotPieces } = require('./snapshotService');
  const { DELTA_JOB_MATCHING_WEIGHTS } = require('../../../constants/deltaJobMatchingThresholds');
  const { buildIdentityVectorFromPieces } = require('./deltaJobMatchingService');

  const language = options.language === 'en' ? 'en' : 'de';
  const pieces = getSnapshotPieces(options.currentSnapshot);
  const minPieces = Math.max(1, Number(IDENTITY_PIPELINE_CONFIG.FIRST_EXPLORATION_MIN_PIECES) || 1);
  const minConfidence = DELTA_JOB_MATCHING_WEIGHTS.MIN_PIECE_CONFIDENCE;

  const scorablePieces = pieces.filter((p) => (Number(p.confidence) || 0) >= minConfidence);
  const hasVector = Boolean(buildIdentityVectorFromPieces(scorablePieces));

  const signals =
    options.signals
    || (await collectAdaptiveEvolutionSignals(options.userId, {
      currentSnapshot: options.currentSnapshot,
      previousSnapshot: null,
      traitVoteCount: options.traitVoteCount,
      now: options.now,
    }));

  const avgConfidence =
    scorablePieces.length > 0
      ? scorablePieces.reduce((sum, p) => sum + (Number(p.confidence) || 0), 0) / scorablePieces.length
      : 0;

  const syntheticScore = Math.min(
    100,
    Math.round(scorablePieces.length * 14 + avgConfidence * 36)
  );

  const identityReady =
    IDENTITY_PIPELINE_CONFIG.FIRST_EXPLORATION_ENABLED
    && scorablePieces.length >= minPieces
    && hasVector;

  const presentation = resolveExplorationPresentation(syntheticScore, signals, {
    ...options,
    language,
  });

  /** @type {string[]} */
  const reasons = [];
  if (language === 'de') {
    reasons.push(
      scorablePieces.length === 1
        ? 'Erstes Identitäts-Puzzle-Stück etabliert'
        : `${scorablePieces.length} Puzzle-Stücke etabliert`
    );
    reasons.push('Erste Karriere-Exploration');
  } else {
    reasons.push(
      scorablePieces.length === 1
        ? 'First career identity puzzle piece established'
        : `${scorablePieces.length} puzzle pieces established`
    );
    reasons.push('Initial career exploration');
  }

  const trigger = identityReady && presentation.shouldExplore;
  const triggerReason = !identityReady
    ? (
      language === 'de'
        ? 'Identität noch nicht ausreichend für eine erste Exploration (keine verwertbaren Puzzle-Stücke).'
        : 'Identity not yet ready for first exploration (no scorable puzzle pieces).'
    )
    : presentation.reason;

  const explanation = {
    trigger,
    triggerReason,
    threshold: EXPLORATION_MEANINGFUL_CHANGE_SCORE,
    changeScore: syntheticScore,
    explorationSize: trigger ? presentation.targetJobCount : 0,
    evolutionTier: trigger ? presentation.tier : 'none',
    signals,
    presentation: trigger ? presentation : { ...presentation, shouldExplore: false },
    adjustments: {
      explorationMode: 'first',
      scorablePieceCount: scorablePieces.length,
      averageConfidence: Math.round(avgConfidence * 100) / 100,
      ...presentation.adjustments,
    },
    reasons,
  };

  logger.info('identity.adaptive.first_exploration_gate', {
    userId: options.userId ? String(options.userId) : undefined,
    trigger: explanation.trigger,
    scorablePieceCount: scorablePieces.length,
    syntheticScore: explanation.changeScore,
    explorationSize: explanation.explorationSize,
    prominence: presentation.prominence,
  });

  return explanation;
}

function buildTriggerReason() {
  return 'Use presentation.reason from resolveExplorationPresentation.';
}

module.exports = {
  evaluateAdaptiveExplorationGate,
  evaluateFirstExplorationGate,
  evaluateAdaptiveGateFromSignals,
  computeAdaptiveThreshold,
  resolveExplorationSize,
  buildTriggerReason,
  EXPLORATION_PRESENTATION_BANDS,
};
