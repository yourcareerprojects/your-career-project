/**
 * Pipeline step: build a lightweight snapshot from the current identity traits.
 */

const logger = require('../../../../utils/logger');
const { createSnapshot } = require('../../snapshotService');

/**
 * @param {{ pipelineId: string, userId: string, currentIdentity: object }} ctx
 * @returns {object}
 */
function createCurrentSnapshotStep(ctx) {
  const source = ctx.currentIdentity?.nodes
    ? { nodes: ctx.currentIdentity.nodes }
    : Array.isArray(ctx.currentTraits)
      ? ctx.currentTraits
      : ctx.currentIdentity;

  const snapshot = createSnapshot(source, {
    capturedAt: ctx.capturedAt || new Date(),
  });

  logger.info('identity.pipeline.step.create_current_snapshot', {
    pipelineId: ctx.pipelineId,
    userId: String(ctx.userId),
    pieceCount: snapshot.pieces.length,
    domainCount: snapshot.domains.length,
  });

  return snapshot;
}

module.exports = { createCurrentSnapshotStep };
