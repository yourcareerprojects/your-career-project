/**
 * Pipeline step: compute Identity Change Score and evaluate the adaptive gate.
 */

const logger = require('../../../../utils/logger');
const { calculateIdentityChangeScore } = require('../../identityEvolutionService');
const { getSnapshotPieces } = require('../../snapshotService');
const adaptiveEvolutionGate = require('../../adaptiveEvolutionGate');

/**
 * @param {{
 *   pipelineId: string,
 *   userId: string,
 *   previousSnapshot: object|null,
 *   currentSnapshot: object,
 *   language?: 'en'|'de',
 *   traitVoteCount?: number,
 *   adaptiveConfig?: object,
 *   signals?: object,
 * }} ctx
 * @returns {Promise<{
 *   changeScore: number,
 *   reasons: string[],
 *   shouldExplore: boolean,
 *   gate: object,
 * }>}
 */
async function calculateChangeScoreStep(ctx) {
  const previousPieces = getSnapshotPieces(ctx.previousSnapshot);
  const currentPieces = getSnapshotPieces(ctx.currentSnapshot);

  const result = calculateIdentityChangeScore(previousPieces, currentPieces, {
    language: ctx.language === 'en' ? 'en' : 'de',
  });

  const gate = await adaptiveEvolutionGate.evaluateAdaptiveExplorationGate({
    userId: ctx.userId,
    changeScore: result.changeScore,
    reasons: result.reasons,
    currentSnapshot: ctx.currentSnapshot,
    previousSnapshot: ctx.previousSnapshot,
    traitVoteCount: ctx.traitVoteCount,
    signals: ctx.signals,
    config: ctx.adaptiveConfig,
  });

  logger.info('identity.pipeline.step.calculate_change_score', {
    pipelineId: ctx.pipelineId,
    userId: String(ctx.userId),
    changeScore: result.changeScore,
    reasonCount: result.reasons.length,
    reasons: result.reasons.slice(0, 5),
    shouldExplore: gate.trigger,
    threshold: gate.threshold,
    explorationSize: gate.explorationSize,
    evolutionTier: gate.evolutionTier,
    triggerReason: gate.triggerReason,
    previousPieceCount: previousPieces.length,
    currentPieceCount: currentPieces.length,
  });

  return {
    changeScore: result.changeScore,
    reasons: result.reasons,
    shouldExplore: gate.trigger,
    gate,
  };
}

module.exports = { calculateChangeScoreStep };
