const {
  buildAllowedRoleSeniorityLevels,
  buildUserSeniorityProfileFromSimulationContext,
} = require('../services/simulation/seniorityAwareCandidatePool');
const { inferUserSeniorityLevel } = require('../services/embedding/userProfileVectorBuilder');

describe('seniorityAwareCandidatePool', () => {
  test('buildAllowedRoleSeniorityLevels includes user level and one step up', () => {
    expect(buildAllowedRoleSeniorityLevels(0)).toEqual([0, 1]);
    expect(buildAllowedRoleSeniorityLevels(3)).toEqual([3, 4]);
    expect(buildAllowedRoleSeniorityLevels(6)).toEqual([6]);
  });

  test('buildAllowedRoleSeniorityLevels clamps invalid input', () => {
    expect(buildAllowedRoleSeniorityLevels(-2)).toEqual([0, 1]);
    expect(buildAllowedRoleSeniorityLevels(99)).toEqual([6]);
  });

  test('buildUserSeniorityProfileFromSimulationContext passes seniority fields through', () => {
    const profile = buildUserSeniorityProfileFromSimulationContext({
      currentStatus: 'pupil',
      yearsOfExperience: 0,
      highestDegree: 'realschulabschluss',
      mostSeniorWorkExperience: 'intern',
      userWorkExperience: [{ title: 'Helper' }],
    });
    expect(inferUserSeniorityLevel(profile)).toBe(0);
  });
});
