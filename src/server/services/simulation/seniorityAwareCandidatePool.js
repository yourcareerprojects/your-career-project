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

  const excludeObjectIds = [];
  for (let ei = 0; ei < excludeIds.length; ei += 1) {
    try {
      excludeObjectIds.push(new mongoose.Types.ObjectId(String(excludeIds[ei])));
    } catch {
      /* skip invalid id */
    }
  }
  // Fetch per seniority level (indexed equality) instead of $in + sort.
  // A compound $in + sort forced an in-memory sort on staging and hit MongoDB's
  // 32MB limit ("Sort exceeded memory limit … Pass allowDiskUse:true").
  const safeLimit = Math.max(1, Number(limit) || 1);
  const perLevelLimit = Math.max(1, Math.ceil(safeLimit / allowedLevels.length));
  const docs = [];
  const collectedIds = new Set(excludeObjectIds.map((id) => String(id)));

  for (let li = 0; li < allowedLevels.length; li += 1) {
    const level = allowedLevels[li];
    const levelFilter = mergeSimulationPoolFilter({
      'seniority.seniority_level': level,
    });
    if (excludeObjectIds.length > 0) {
      levelFilter._id = { $nin: excludeObjectIds };
    }

    const levelDocs = await CareerPath.find(levelFilter, projection, {
      limit: perLevelLimit,
    }).lean();

    for (let di = 0; di < levelDocs.length; di += 1) {
      const cp = levelDocs[di];
      const id = cp._id != null ? String(cp._id) : '';
      if (id && collectedIds.has(id)) continue;
      if (id) collectedIds.add(id);
      docs.push(cp);
      if (docs.length >= safeLimit) break;
    }
    if (docs.length >= safeLimit) break;
  }

  return { docs: docs.slice(0, safeLimit), userLevel, allowedLevels };
}

module.exports = {
  MAX_SENIORITY_LEVEL,
  buildAllowedRoleSeniorityLevels,
  buildUserSeniorityProfileFromSimulationContext,
  fetchSeniorityAwareFallbackCareerPaths,
};
