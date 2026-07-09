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

/**
 * Resolve skill→career-path pool keys in the parent worker (more RAM headroom than the fork child).
 * Persists on the job payload so the child can skip loading the full Skill catalog index.
 */
async function attachSimulationPoolPrefetch(jobId) {
  const job = await SimulationJob.findById(jobId)
    .select({ userId: 1, payload: 1 })
    .lean();
  if (!job?.userId) return false;

  const user = await User.findById(job.userId)
    .select({
      'profile.careerSimulationInputs.structuredUserInfo.skills': 1,
      'profile.structuredUserInfo.skills': 1,
    })
    .lean();
  if (!user) return false;

  const profile = user.profile || {};
  const csiSkills = readDimensionRawItems(profile.careerSimulationInputs?.structuredUserInfo?.skills);
  const profileSkills = readDimensionRawItems(profile.structuredUserInfo?.skills);
  const userSkills = csiSkills.length > 0 ? csiSkills : profileSkills;

  const prefetch = await resolveUserSkillsForPoolFetch(userSkills);
  await SimulationJob.updateOne(
    { _id: jobId },
    { $set: { 'payload._poolPrefetch': prefetch } }
  );
  return true;
}

module.exports = {
  attachSimulationPoolPrefetch,
};
