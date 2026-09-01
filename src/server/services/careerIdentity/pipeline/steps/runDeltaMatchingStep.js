/**
 * Pipeline step: delta job matching (previous snapshot vs current identity).
 */

const logger = require('../../../../utils/logger');
const deltaJobMatchingService = require('../../deltaJobMatchingService');
const { loadRolePoolForDeltaMatching } = require('../collectors/rolePoolLoader');

/**
 * @param {{
 *   pipelineId: string,
 *   userId: string,
 *   previousSnapshot: object,
 *   currentSnapshot: object,
 *   roles?: object[],
 * }} ctx
 * @returns {Promise<{ deltaJobMatches: object[], rolePoolSize: number }>}
 */
async function runDeltaMatchingStep(ctx) {
  const roles =
    Array.isArray(ctx.roles) && ctx.roles.length > 0
      ? ctx.roles
      : await loadRolePoolForDeltaMatching({
          pipelineId: ctx.pipelineId,
          userId: ctx.userId,
          limit: ctx.rolePoolLimit,
        });

  logger.info('identity.pipeline.step.delta_matching_start', {
    pipelineId: ctx.pipelineId,
    userId: String(ctx.userId),
    rolePoolSize: roles.length,
  });

  const deltaJobMatches = await deltaJobMatchingService.matchJobsByIdentityDelta({
    previousIdentity: ctx.previousSnapshot,
    currentIdentity: ctx.currentSnapshot,
    roles,
  });

  logger.info('identity.pipeline.step.delta_matching_done', {
    pipelineId: ctx.pipelineId,
    userId: String(ctx.userId),
    rolePoolSize: roles.length,
    deltaMatchCount: deltaJobMatches.length,
    topDeltas: deltaJobMatches.slice(0, 5).map((m) => ({
      key: m.role?.escoId || m.role?._id || m.role?.id,
      delta: m.delta,
      newScore: m.newScore,
    })),
  });

  return { deltaJobMatches, rolePoolSize: roles.length };
}

module.exports = { runDeltaMatchingStep };
