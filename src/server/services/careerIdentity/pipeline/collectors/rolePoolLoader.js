/**
 * Load a CareerPath pool for delta job matching (identity_vector-ready).
 * When the user has skills, prefer skill-linked paths so the pool itself is
 * profile-grounded; fill the remainder with identity-ready catalog roles.
 */

const mongoose = require('mongoose');
const CareerPath = require('../../../../models/CareerPath');
const { EMBEDDING_DIMS } = require('../../../embedding/embeddingService');
const { mergeSimulationPoolFilter } = require('../../../simulation/simulationCareerPathPoolFilter');
const { resolveUserSkillsForPoolFetch } = require('../../../simulation/userSkillKeysForPoolFetch');
const { IDENTITY_PIPELINE_CONFIG } = require('../../../../../constants/identityPipelineConfig');
const logger = require('../../../../utils/logger');

const ROLE_POOL_PROJECTION = Object.freeze({
  _id: 1,
  escoId: 1,
  title: 1,
  domain: 1,
  seniority: 1,
  'roleVectors.identity_vector': 1,
  'roleVectors.dims': 1,
  'roleVectors.finalVectors': 1,
  'roleVectors.structured_vector_occupation_group': 1,
  'roleVectors.structured_vector_skill_domains': 1,
  'roleVectors.structured_vector_responsibilities': 1,
  'roleVectors.structured_vector_required_skills': 1,
  'roleVectors.structured_vector_optional_skills': 1,
  'roleVectors.structured_vector_domains': 1,
});

/**
 * @param {object} role
 * @returns {boolean}
 */
function hasUsableIdentityVector(role) {
  const vec = role?.roleVectors?.identity_vector;
  return Array.isArray(vec) && vec.length === EMBEDDING_DIMS;
}

/**
 * @param {object[]} roles
 * @param {number} limit
 * @param {Set<string>} [seen]
 * @returns {object[]}
 */
function takeUsableRoles(roles, limit, seen = new Set()) {
  const usable = [];
  for (const role of roles) {
    if (!hasUsableIdentityVector(role)) continue;
    const key = String(role.escoId || role._id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    usable.push(role);
    if (usable.length >= limit) break;
  }
  return usable;
}

/**
 * @param {string[]} careerPathIds
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function loadRolesByIds(careerPathIds, limit) {
  const objectIds = [];
  for (const id of careerPathIds || []) {
    try {
      objectIds.push(new mongoose.Types.ObjectId(id));
    } catch {
      /* invalid id */
    }
    if (objectIds.length >= limit * 2) break;
  }
  if (objectIds.length === 0) return [];

  return CareerPath.find(
    mergeSimulationPoolFilter({
      _id: { $in: objectIds },
      'roleVectors.identity_vector.0': { $exists: true },
    })
  )
    .select(ROLE_POOL_PROJECTION)
    .limit(limit * 2)
    .lean();
}

/**
 * @param {number} limit
 * @param {string[]} [excludeIds]
 * @returns {Promise<object[]>}
 */
async function loadFallbackIdentityRoles(limit, excludeIds = []) {
  const filter = mergeSimulationPoolFilter({
    'roleVectors.identity_vector.0': { $exists: true },
  });
  if (excludeIds.length > 0) {
    filter._id = { $nin: excludeIds };
  }

  return CareerPath.find(filter)
    .select(ROLE_POOL_PROJECTION)
    .limit(limit * 2)
    .lean();
}

/**
 * @param {{
 *   limit?: number,
 *   pipelineId?: string,
 *   userId?: string,
 *   skillLabels?: string[],
 * }} [options]
 * @returns {Promise<object[]>}
 */
async function loadRolePoolForDeltaMatching(options = {}) {
  const limit = Math.max(
    1,
    Number(options.limit) || IDENTITY_PIPELINE_CONFIG.ROLE_POOL_LIMIT
  );

  const seen = new Set();
  /** @type {object[]} */
  let usable = [];
  let skillLinkedCount = 0;

  const skillLabels = Array.isArray(options.skillLabels)
    ? options.skillLabels.map(String).filter(Boolean)
    : [];

  if (skillLabels.length > 0) {
    try {
      const poolResolution = await resolveUserSkillsForPoolFetch(skillLabels);
      const linkedIds = poolResolution?.careerPathIds || [];
      if (linkedIds.length > 0) {
        const linkedRoles = await loadRolesByIds(linkedIds, limit);
        usable = takeUsableRoles(linkedRoles, limit, seen);
        skillLinkedCount = usable.length;
      }
    } catch (err) {
      logger.warn('identity.pipeline.role_pool_skill_link_failed', {
        pipelineId: options.pipelineId,
        userId: options.userId ? String(options.userId) : undefined,
        message: err?.message || String(err),
      });
    }
  }

  if (usable.length < limit) {
    const excludeIds = usable
      .map((r) => r._id)
      .filter(Boolean);
    const fallback = await loadFallbackIdentityRoles(limit - usable.length, excludeIds);
    const more = takeUsableRoles(fallback, limit - usable.length, seen);
    usable = usable.concat(more);
  }

  logger.info('identity.pipeline.role_pool_loaded', {
    pipelineId: options.pipelineId,
    userId: options.userId ? String(options.userId) : undefined,
    requestedLimit: limit,
    loadedCount: usable.length,
    skillLinkedCount,
    skillLabelCount: skillLabels.length,
  });

  return usable;
}

module.exports = {
  loadRolePoolForDeltaMatching,
  ROLE_POOL_PROJECTION,
  hasUsableIdentityVector,
};
