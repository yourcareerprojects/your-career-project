/**
 * Collect recently rated and accepted job ids for exploration exclusions.
 */

const User = require('../../../../models/User');
const logger = require('../../../../utils/logger');
const {
  getEvaluationFlow,
  listEvaluationFlowRoles,
} = require('../../../../utils/evaluationFlowRoles');
const {
  collectCoolOccupationRefsFromUser,
} = require('../../../careerPuzzle/simulationCoolOccupationSteps');

function isRatedEvaluation(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return key === 'keep' || key === 'cool' || key === 'skip' || key === 'dislike';
}

function pushRoleIds(target, role) {
  if (!role || typeof role !== 'object') return;
  const escoId = String(role.escoId || role.step?.escoId || '').trim();
  const careerPathId = String(
    role.careerPathId || role.step?.careerPathId || role._id || role.step?._id || role.id || role.stepId || ''
  ).trim();
  if (escoId) target.add(escoId);
  if (careerPathId) target.add(careerPathId);
}

function collectRatedRolesFromFlow(flow, ratedIds) {
  for (const role of listEvaluationFlowRoles(flow)) {
    if (!isRatedEvaluation(role.userEvaluation)) continue;
    pushRoleIds(ratedIds, role);
  }
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<{ recentlyRatedJobIds: string[], acceptedJobIds: string[] }>}
 */
async function collectRatedAndAcceptedJobIds(userId) {
  const user = await User.findById(userId)
    .select({
      lastSimulationResult: 1,
      simulationResults: 1,
    })
    .lean();

  const recentlyRated = new Set();
  const accepted = new Set();

  if (!user) {
    logger.warn('identity.pipeline.rated_jobs_user_missing', { userId: String(userId) });
    return { recentlyRatedJobIds: [], acceptedJobIds: [] };
  }

  for (const ref of collectCoolOccupationRefsFromUser(user)) {
    if (ref.escoId) accepted.add(String(ref.escoId));
    if (ref.careerPathId) accepted.add(String(ref.careerPathId));
  }

  const flows = [];
  const lastFlow = getEvaluationFlow(user.lastSimulationResult);
  if (lastFlow) flows.push(lastFlow);
  for (const sim of user.simulationResults || []) {
    if (sim?.status && sim.status !== 'active') continue;
    const flow = getEvaluationFlow(sim);
    if (flow) flows.push(flow);
  }
  for (const flow of flows) {
    collectRatedRolesFromFlow(flow, recentlyRated);
  }

  const recentlyRatedJobIds = [...recentlyRated];
  const acceptedJobIds = [...accepted];

  logger.info('identity.pipeline.rated_jobs_collected', {
    userId: String(userId),
    recentlyRatedCount: recentlyRatedJobIds.length,
    acceptedCount: acceptedJobIds.length,
  });

  return { recentlyRatedJobIds, acceptedJobIds };
}

module.exports = {
  collectRatedAndAcceptedJobIds,
  collectRatedRolesFromFlow,
};
