'use strict';

/**
 * Seniority-aware candidate pool expansion for simulation fallback.
 * Includes roles at the user's level and one level above (promotion step).
 */

const mongoose = require('mongoose');
const CareerPath = require('../../models/CareerPath');
const { inferUserSeniorityLevel } = require('../embedding/userProfileVectorBuilder');
const { mergeSimulationPoolFilter } = require('./simulationCareerPathPoolFilter');

const MAX_SENIORITY_LEVEL = 6;

/**
 * @param {number} userLevel — inferred user seniority 0–6
 * @returns {number[]} Allowed role seniority levels (inclusive range)
 */
function buildAllowedRoleSeniorityLevels(userLevel) {
  const level = Math.max(
    0,
    Math.min(MAX_SENIORITY_LEVEL, Math.floor(Number(userLevel) || 0))
  );
  const maxRoleLevel = Math.min(MAX_SENIORITY_LEVEL, level + 1);
  const out = [];
  for (let l = level; l <= maxRoleLevel; l += 1) out.push(l);
  return out;
}

/**
 * @param {object} params
 * @returns {object} Shape for {@link inferUserSeniorityLevel}
 */
function buildUserSeniorityProfileFromSimulationContext(params = {}) {
  return {
    currentStatus: params.currentStatus,
    yearsOfExperience: params.yearsOfExperience,
    highestDegree: params.highestDegree,
    mostSeniorWorkExperience: params.mostSeniorWorkExperience,
    userWorkExperience: params.userWorkExperience,
  };
}

/**
 * Fetch career paths whose stored seniority is at the user's level or one step above.
 *
 * @param {object} options
 * @param {object} options.userSeniorityProfile — passed to inferUserSeniorityLevel
 * @param {string[]} [options.excludeIds] — career path _id strings already in pool
 * @param {number} options.limit — max documents to return
 * @param {object} [options.projection] — Mongo projection
 * @returns {Promise<{ docs: object[], userLevel: number, allowedLevels: number[] }>}
 */
async function fetchSeniorityAwareFallbackCareerPaths({
  userSeniorityProfile,
  excludeIds = [],
  limit,
  projection = null,
}) {
  const userLevel = inferUserSeniorityLevel(userSeniorityProfile || {});
  const allowedLevels = buildAllowedRoleSeniorityLevels(userLevel);

  const filter = mergeSimulationPoolFilter({
    'seniority.seniority_level': { $in: allowedLevels },
  });

  const excludeObjectIds = [];
  for (let ei = 0; ei < excludeIds.length; ei += 1) {
    try {
      excludeObjectIds.push(new mongoose.Types.ObjectId(String(excludeIds[ei])));
    } catch {
      /* skip invalid id */
    }
  }
  if (excludeObjectIds.length > 0) {
    filter._id = { $nin: excludeObjectIds };
  }

  const docs = await CareerPath.find(filter, projection, {
    limit: Math.max(1, Number(limit) || 1),
    sort: { 'seniority.seniority_level': 1, _id: 1 },
  }).lean();

  return { docs, userLevel, allowedLevels };
}

module.exports = {
  MAX_SENIORITY_LEVEL,
  buildAllowedRoleSeniorityLevels,
  buildUserSeniorityProfileFromSimulationContext,
  fetchSeniorityAwareFallbackCareerPaths,
};
