/**
 * Pipeline step: evaluate whether exploration should run (first vs subsequent mode).
 */

const logger = require('../../../../utils/logger');
const { IDENTITY_PIPELINE_MODES } = require('../../../../../constants/identityPipelineModes');
const adaptiveEvolutionGate = require('../../adaptiveEvolutionGate');
const { calculateChangeScoreStep } = require('./calculateChangeScoreStep');

/**
 * @param {{
 *   pipelineId: string,
 *   userId: string,
 *   explorationMode: string,
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
 *   explorationMode: string,
 * }>}
 */
async function evaluateExplorationGateStep(ctx) {
  const explorationMode =
    ctx.explorationMode === IDENTITY_PIPELINE_MODES.FIRST
      ? IDENTITY_PIPELINE_MODES.FIRST
      : IDENTITY_PIPELINE_MODES.SUBSEQUENT;

  if (explorationMode === IDENTITY_PIPELINE_MODES.FIRST) {
    const gate = await adaptiveEvolutionGate.evaluateFirstExplorationGate({
      userId: ctx.userId,
      currentSnapshot: ctx.currentSnapshot,
      language: ctx.language,
      traitVoteCount: ctx.traitVoteCount,
      signals: ctx.signals,
      config: ctx.adaptiveConfig,
    });

    logger.info('identity.pipeline.step.evaluate_exploration_gate', {
      pipelineId: ctx.pipelineId,
      userId: String(ctx.userId),
      explorationMode,
      changeScore: gate.changeScore,
      shouldExplore: gate.trigger,
      explorationSize: gate.explorationSize,
    });

    return {
      changeScore: gate.changeScore,
      reasons: gate.reasons || [],
      shouldExplore: gate.trigger,
      gate,
      explorationMode,
    };
  }

  const change = await calculateChangeScoreStep(ctx);

  return {
    ...change,
    gate: {
      ...change.gate,
      adjustments: {
        ...(change.gate?.adjustments || {}),
        explorationMode: IDENTITY_PIPELINE_MODES.SUBSEQUENT,
      },
    },
    explorationMode,
  };
}

module.exports = { evaluateExplorationGateStep };
