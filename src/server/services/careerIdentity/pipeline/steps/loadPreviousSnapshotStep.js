/**
 * Pipeline step: load the user's previous identity snapshot (if any).
 */

const logger = require('../../../../utils/logger');
const { loadLatestSnapshot } = require('../../snapshotService');

/**
 * @param {{ userId: string, pipelineId: string }} ctx
 * @returns {Promise<object|null>}
 */
async function loadPreviousSnapshotStep(ctx) {
  const snapshot = await loadLatestSnapshot(ctx.userId);
  logger.info('identity.pipeline.step.load_previous_snapshot', {
    pipelineId: ctx.pipelineId,
    userId: String(ctx.userId),
    hasSnapshot: Boolean(snapshot),
    pieceCount: snapshot?.pieces?.length || 0,
    domainCount: snapshot?.domains?.length || 0,
    capturedAt: snapshot?.capturedAt || null,
  });
  return snapshot;
}

module.exports = { loadPreviousSnapshotStep };
