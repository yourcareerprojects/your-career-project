'use strict';

const User = require('../../models/User');
const SimulationJob = require('../../models/SimulationJob');
const { resolveUserSkillsForPoolFetch } = require('./userSkillKeysForPoolFetch');

function readDimensionRawItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          return String(item.name || item.label || item.title || '').trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function readUserSkillsFromProfile(profile = {}) {
  const csiSkills = readDimensionRawItems(profile.careerSimulationInputs?.structuredUserInfo?.skills);
  const profileSkills = readDimensionRawItems(profile.structuredUserInfo?.skills);
  return csiSkills.length > 0 ? csiSkills : profileSkills;
}

/**
 * @param {object|null|undefined} profile
 * @returns {Promise<{ requiredSkillKeys: string[], careerPathIds: string[], matchedSkillCount: number }|null>}
 */
async function buildSimulationPoolPrefetchFromProfile(profile) {
  const userSkills = readUserSkillsFromProfile(profile);
  return resolveUserSkillsForPoolFetch(userSkills);
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<{ requiredSkillKeys: string[], careerPathIds: string[], matchedSkillCount: number }|null>}
 */
async function buildSimulationPoolPrefetchForUserId(userId) {
  const user = await User.findById(userId)
    .select({
      'profile.careerSimulationInputs.structuredUserInfo.skills': 1,
      'profile.structuredUserInfo.skills': 1,
    })
    .lean();
  if (!user) return null;
  return buildSimulationPoolPrefetchFromProfile(user.profile || {});
}

/**
 * Resolve skill→career-path pool keys in the parent worker (more RAM headroom than the fork child).
 * Persists on the job payload so the child can skip loading the full Skill catalog index.
 */
async function attachSimulationPoolPrefetch(jobId, { job: jobDoc } = {}) {
  const job =
    jobDoc ||
    (await SimulationJob.findById(jobId).select({ userId: 1, payload: 1 }).lean());
  if (!job?.userId) return false;
  if (job.payload?._poolPrefetch && typeof job.payload._poolPrefetch === 'object') {
    return true;
  }

  const prefetch = await buildSimulationPoolPrefetchForUserId(job.userId);
  if (!prefetch) return false;

  await SimulationJob.updateOne(
    { _id: jobId },
    { $set: { 'payload._poolPrefetch': prefetch } }
  );
  return true;
}

module.exports = {
  buildSimulationPoolPrefetchForUserId,
  buildSimulationPoolPrefetchFromProfile,
  attachSimulationPoolPrefetch,
};
