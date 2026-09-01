/**
 * Unit tests for exploration profile loader (profile-grounded matching).
 */

const {
  buildExplorationMatchingProfile,
  readDimensionRawItems,
} = require('../services/careerIdentity/pipeline/collectors/userProfileForExplorationLoader');

describe('userProfileForExplorationLoader', () => {
  it('readDimensionRawItems supports raw_items and plain arrays', () => {
    expect(readDimensionRawItems({ raw_items: [' Python ', 'SQL'] })).toEqual(['Python', 'SQL']);
    expect(readDimensionRawItems(['A', 'B'])).toEqual(['A', 'B']);
  });

  it('builds a hybrid-ready profile from career simulation inputs', () => {
    const profile = buildExplorationMatchingProfile({
      personalInfo: { bio: 'I enjoy mentoring' },
      careerSimulationInputs: {
        structuredUserInfo: {
          skills: { raw_items: ['JavaScript', 'Coaching'] },
          domains: { raw_items: ['Software Engineering'] },
          keyResponsibilities: { raw_items: ['Lead teams'] },
        },
        seniority: {
          currentStatus: 'employed',
          yearsOfExperience: 5,
        },
      },
      userIdentityAnswers: {
        workEnjoyMost: 'Helping others grow',
        workingLifeAchievement: 'Lead a product team',
        topicsIndustriesInterest: 'tech, education',
      },
    });

    expect(profile).toBeTruthy();
    expect(profile.userSkills).toEqual(['JavaScript', 'Coaching']);
    expect(profile.userCareerPreferences.domains).toEqual(['Software Engineering']);
    expect(profile.careerGoal).toBe('Lead a product team');
    expect(profile.yearsOfExperience).toBe(5);
  });

  it('returns null when the profile has no usable matching signals', () => {
    expect(buildExplorationMatchingProfile({})).toBeNull();
    expect(buildExplorationMatchingProfile(null)).toBeNull();
  });
});
