/**
 * Pipeline step: persist the current identity as lastIdentitySnapshot.
 */

const logger = require('../../../../utils/logger');
const { saveSnapshot } = require('../../snapshotService');

/**
 * @param {{
 *   pipelineId: string,
 *   userId: string,
 *   currentSnapshot: object,
 * }} ctx
 * @returns {Promise<object>}
 */
async function saveIdentitySnapshotStep(ctx) {
  const saved = await saveSnapshot(ctx.userId, ctx.currentSnapshot);

  logger.info('identity.pipeline.step.save_identity_snapshot', {
    pipelineId: ctx.pipelineId,
    userId: String(ctx.userId),
    pieceCount: saved.pieces.length,
    domainCount: saved.domains.length,
    capturedAt: saved.capturedAt,
  });

  return saved;
}

module.exports = { saveIdentitySnapshotStep };
