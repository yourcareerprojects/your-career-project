const {
  scoreCareerPath,
  scoreCareerPaths,
  mapUserDegreeToLevel,
  inferRoleDegreeLevel,
  computeEducationMatchDimension,
  calculateEducationModifier,
  EDUCATION_MATCH_CATEGORY,
  analyzeScoreDistribution,
} = require('../services/scoring/legacy/careerPathScorerLegacy');

const {
  calibrateScore,
  powerCalibration,
  sigmoidCalibration
} = require('../services/scoring/scoreCalibration');

describe('careerPathScorerLegacy', () => {
  test('scores required skill matches and returns metadata', async () => {
    const userProfile = {
      userSkills: ['JavaScript', 'React', 'Leadership'],
      userWorkExperience: [{ title: 'Software Engineer' }],
      userEducation: { highestDegree: 'Bachelor Degree' },
      userCareerPreferences: { domains: ['software'] },
      userInterests: ['engineering']
    };

    const careerPath = {
      title: 'Senior Software Engineer',
      description: 'We require strong JavaScript skills. Bachelor degree preferred. Software engineering role.',
      requiredSkills: ['JavaScript', 'Node.js']
    };

    const result = await scoreCareerPath(userProfile, careerPath);

    expect(result.score).toBeGreaterThan(0);
    expect(result.scoreBreakdown).toBeTruthy();
    expect(result.scoreBreakdown.skillsMatch).toBeTruthy();
    expect(typeof result.scoreBreakdown.skillsMatch.raw).toBe('number');
    expect(result.matchedSkills).toContain('JavaScript');
    expect(result.matchedInputs.join(' ')).toMatch(/JavaScript/);
    expect(result.educationMatch).toEqual({
      matched: true,
      matchedDegree: 'Bachelor Degree'
    });
    expect(result.experienceAlignment.matchedCount).toBe(1);
    expect(result.experienceAlignment.matchedTitles).toContain('Software Engineer');
    expect(Array.isArray(result.skillGaps)).toBe(true);
    expect(Array.isArray(result.recommendedActions)).toBe(true);
    expect(Array.isArray(result.progressionNotes)).toBe(true);
  });

  test('partial required skill match scores lower than exact', async () => {
    const userProfile = {
      userSkills: ['Project management'],
      userWorkExperience: [],
      userEducation: {},
      userCareerPreferences: {},
      userInterests: []
    };

    const [exact, partial] = await Promise.all([
      scoreCareerPath(userProfile, { title: 'x', description: 'x', requiredSkills: ['Project management'] }),
      scoreCareerPath(userProfile, { title: 'x', description: 'x', requiredSkills: ['Project management tools'] }),
    ]);

    expect(exact.score).toBeGreaterThan(partial.score);
  });

  test('weights shift dimension influence', async () => {
    const userProfile = {
      userSkills: ['JavaScript'],
      userWorkExperience: [],
      userEducation: { highestDegree: 'Bachelor Degree' },
      userCareerPreferences: {},
      userInterests: []
    };

    const careerPath = {
      title: 'Software Engineer',
      description: 'Bachelor Degree preferred.',
      requiredSkills: ['JavaScript']
    };

    const [skillsHeavy, expHeavy] = await Promise.all([
      scoreCareerPath(userProfile, careerPath, { weights: { skillsMatch: 0.6, experienceAlignment: 0.1 } }),
      scoreCareerPath(userProfile, careerPath, { weights: { skillsMatch: 0.1, experienceAlignment: 0.6 } }),
    ]);

    expect(skillsHeavy.scoreBreakdown.skillsMatch.weight).toBeGreaterThan(expHeavy.scoreBreakdown.skillsMatch.weight);
    expect(expHeavy.scoreBreakdown.experienceAlignment.weight).toBeGreaterThan(skillsHeavy.scoreBreakdown.experienceAlignment.weight);
  });

  test('returns scoringDebug with baseScore, educationModifier, rawScore, calibratedScore, calibrationMode, finalScore', async () => {
    const result = await scoreCareerPath(
      { userSkills: ['X'], userWorkExperience: [], userEducation: { highestDegree: 'bachelors' }, userCareerPreferences: {}, userInterests: [] },
      { title: 'Analyst', description: 'Bachelor required', requiredSkills: ['X'] }
    );
    expect(result.scoringDebug).toBeDefined();
    expect(typeof result.scoringDebug.baseScore).toBe('number');
    expect(typeof result.scoringDebug.educationModifier).toBe('number');
    expect(typeof result.scoringDebug.rawScore).toBe('number');
    expect(typeof result.scoringDebug.calibratedScore).toBe('number');
    expect(typeof result.scoringDebug.calibrationMode).toBe('string');
    expect(typeof result.scoringDebug.finalScore).toBe('number');
    expect(typeof result.scoringDebug.educationMatchCategory).toBe('string');
    expect(result.score).toBe(result.scoringDebug.finalScore);
  });
});

describe('education match (distance-based)', () => {
  test('mapUserDegreeToLevel maps canonical and alias strings', () => {
    expect(mapUserDegreeToLevel('bachelors')).toBe(3);
    expect(mapUserDegreeToLevel('Bachelor Degree')).toBe(3);
    expect(mapUserDegreeToLevel('masters')).toBe(4);
    expect(mapUserDegreeToLevel('phd')).toBe(5);
    expect(mapUserDegreeToLevel('none')).toBe(0);
    expect(mapUserDegreeToLevel('')).toBeNull();
    expect(mapUserDegreeToLevel(null)).toBeNull();
    expect(mapUserDegreeToLevel('unknown')).toBeNull();
    expect(mapUserDegreeToLevel('hauptschulabschluss')).toBe(1);
    expect(mapUserDegreeToLevel('realschulabschluss')).toBe(2);
    expect(mapUserDegreeToLevel('ausbildung')).toBe(2);
    expect(mapUserDegreeToLevel('fachabitur')).toBe(3);
    expect(mapUserDegreeToLevel('staatsexamen')).toBe(6);
  });

  test('inferRoleDegreeLevel uses heuristic from title/description', () => {
    expect(inferRoleDegreeLevel({ title: 'PhD Researcher', description: '' })).toBe(5);
    expect(inferRoleDegreeLevel({ title: 'Engineer', description: 'Master degree required' })).toBe(4);
    expect(inferRoleDegreeLevel({ title: 'Analyst', description: 'Bachelor degree preferred' })).toBe(3);
    expect(inferRoleDegreeLevel({ title: 'Intern', description: 'No degree required' })).toBeNull();
  });

  test('inferRoleDegreeLevel uses role.requiredEducation when present', () => {
    expect(inferRoleDegreeLevel({ title: 'X', description: 'Y', requiredEducation: { level: 4 } })).toBe(4);
  });

  test('user meets or exceeds role requirement → raw = 1', () => {
    const edu = computeEducationMatchDimension({
      userEducation: { highestDegree: 'bachelors' },
      role: { title: 'Analyst', description: 'Bachelor degree required' }
    });
    expect(edu.raw).toBe(1);
    expect(edu.evidence.diff).toBeGreaterThanOrEqual(0);
  });

  test('user exceeds role requirement (master vs bachelor) → raw = 1', () => {
    const edu = computeEducationMatchDimension({
      userEducation: { highestDegree: 'masters' },
      role: { title: 'Analyst', description: 'Bachelor degree required' }
    });
    expect(edu.raw).toBe(1);
  });

  test('user 1 level below role requirement → gradual penalty (raw = 0.7)', () => {
    const edu = computeEducationMatchDimension({
      userEducation: { highestDegree: 'bachelors' },
      role: { title: 'Researcher', description: 'Master degree required' }
    });
    expect(edu.raw).toBeCloseTo(0.7, 2); // 1 - 1*0.3 = 0.7
  });

  test('user 2 levels below role requirement → raw = 0.4', () => {
    const edu = computeEducationMatchDimension({
      userEducation: { highestDegree: 'bachelors' },
      role: { title: 'Professor', description: 'PhD required' }
    });
    expect(edu.raw).toBeCloseTo(0.4, 2); // 1 - 2*0.3 = 0.4
  });

  test('role has no explicit degree requirement → raw = 0.5 (neutral)', () => {
    const edu = computeEducationMatchDimension({
      userEducation: { highestDegree: 'bachelors' },
      role: { title: 'Customer Support', description: 'Strong communication skills' }
    });
    expect(edu.raw).toBe(0.5);
    expect(edu.evidence.roleDegreeLevel).toBeNull();
  });

  test('user has no degree (null) → treated as level 0', () => {
    const edu = computeEducationMatchDimension({
      userEducation: {},
      role: { title: 'Analyst', description: 'Bachelor degree required' }
    });
    expect(edu.raw).toBeCloseTo(0.1, 2); // 1 - 3*0.3 = 0.1 (bachelor=3, user=0)
  });
});

describe('education modifier (multiplicative)', () => {
  test('no requirement → modifier 1.00', () => {
    const { modifier, category } = calculateEducationModifier(
      { highestDegree: 'bachelors' },
      { title: 'Support', description: 'Strong communication skills' }
    );
    expect(modifier).toBe(1);
    expect(category).toBe(EDUCATION_MATCH_CATEGORY.NO_REQUIREMENT);
  });

  test('exact match → modifier 1.00', () => {
    const { modifier, category } = calculateEducationModifier(
      { highestDegree: 'bachelors' },
      { title: 'Analyst', description: 'Bachelor degree required' }
    );
    expect(modifier).toBe(1);
    expect(category).toBe(EDUCATION_MATCH_CATEGORY.EXACT_MATCH);
  });

  test('overqualified → modifier 1.02', () => {
    const { modifier, category } = calculateEducationModifier(
      { highestDegree: 'masters' },
      { title: 'Analyst', description: 'Bachelor degree required' }
    );
    expect(modifier).toBe(1.02);
    expect(category).toBe(EDUCATION_MATCH_CATEGORY.OVERQUALIFIED);
  });

  test('slightly below (1 level) → modifier 0.95', () => {
    const { modifier, category } = calculateEducationModifier(
      { highestDegree: 'bachelors' },
      { title: 'Researcher', description: 'Master degree required' }
    );
    expect(modifier).toBe(0.95);
    expect(category).toBe(EDUCATION_MATCH_CATEGORY.SLIGHTLY_BELOW);
  });

  test('clearly below (2+ levels) → modifier 0.85', () => {
    const { modifier, category } = calculateEducationModifier(
      { highestDegree: 'bachelors' },
      { title: 'Professor', description: 'PhD required' }
    );
    expect(modifier).toBe(0.85);
    expect(category).toBe(EDUCATION_MATCH_CATEGORY.CLEARLY_BELOW);
  });

  test('modifier applied multiplicatively: rawScore = baseScore * modifier', async () => {
    const opts = { calibrationMode: 'none' };
    const [below, exact] = await Promise.all([
      scoreCareerPath(
        { userSkills: ['X'], userWorkExperience: [], userEducation: { highestDegree: 'bachelors' }, userCareerPreferences: {}, userInterests: [] },
        { title: 'Professor', description: 'PhD required', requiredSkills: ['X'] },
        opts
      ),
      scoreCareerPath(
        { userSkills: ['X'], userWorkExperience: [], userEducation: { highestDegree: 'phd' }, userCareerPreferences: {}, userInterests: [] },
        { title: 'Professor', description: 'PhD required', requiredSkills: ['X'] },
        opts
      ),
    ]);
    expect(below.scoringDebug.educationModifier).toBe(0.85);
    expect(exact.scoringDebug.educationModifier).toBe(1);
    expect(below.scoringDebug.rawScore).toBeCloseTo(below.scoringDebug.baseScore * 0.85, 2);
    expect(exact.scoringDebug.rawScore).toBeCloseTo(exact.scoringDebug.baseScore * 1, 2);
    expect(below.score).toBeCloseTo(below.scoringDebug.baseScore * 0.85, 2);
    expect(exact.score).toBeCloseTo(exact.scoringDebug.baseScore * 1, 2);
  });
});

describe('score calibration', () => {
  test('power calibration preserves ranking order', async () => {
    const userProfile = {
      userSkills: ['A', 'B', 'C'],
      userWorkExperience: [],
      userEducation: { highestDegree: 'bachelors' },
      userCareerPreferences: {},
      userInterests: []
    };
    const paths = [
      { title: 'Role A', description: 'x', requiredSkills: ['A', 'B', 'C'] },
      { title: 'Role B', description: 'x', requiredSkills: ['A', 'B'] },
      { title: 'Role C', description: 'x', requiredSkills: ['A'] }
    ];
    const scored = await scoreCareerPaths(userProfile, paths);
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    expect(sorted[0].title).toBe('Role A');
    expect(sorted[1].title).toBe('Role B');
    expect(sorted[2].title).toBe('Role C');
  });

  test('power calibration: high scores remain high, mid scores decrease relative to top', async () => {
    const opts = { calibrationMode: 'power' };
    const [high, mid] = await Promise.all([
      scoreCareerPath(
        { userSkills: ['X', 'Y', 'Z'], userWorkExperience: [], userEducation: { highestDegree: 'bachelors' }, userCareerPreferences: {}, userInterests: [] },
        { title: 'Engineer', description: 'Bachelor required', requiredSkills: ['X', 'Y', 'Z'] },
        opts
      ),
      scoreCareerPath(
        { userSkills: ['X'], userWorkExperience: [], userEducation: { highestDegree: 'bachelors' }, userCareerPreferences: {}, userInterests: [] },
        { title: 'Engineer', description: 'Bachelor required', requiredSkills: ['X', 'Y', 'Z'] },
        opts
      ),
    ]);
    expect(high.score).toBeGreaterThan(mid.score);
    expect(high.scoringDebug.calibratedScore).toBeGreaterThan(mid.scoringDebug.calibratedScore);
  });

  test('calibration does not produce NaN or overflow', () => {
    expect(calibrateScore(0)).toBe(0);
    expect(calibrateScore(1)).toBe(1);
    expect(calibrateScore(0.5)).toBeGreaterThan(0);
    expect(calibrateScore(0.5)).toBeLessThanOrEqual(1);
    expect(calibrateScore(NaN)).toBe(0);
    expect(calibrateScore(Infinity)).toBeLessThanOrEqual(1);
    expect(calibrateScore(-1)).toBe(0);
  });

  test('switching calibration mode works', () => {
    const raw = 0.7;
    const power = calibrateScore(raw, { calibrationMode: 'power' });
    const sigmoid = calibrateScore(raw, { calibrationMode: 'sigmoid' });
    const none = calibrateScore(raw, { calibrationMode: 'none' });
    expect(power).toBeGreaterThan(0);
    expect(power).toBeLessThanOrEqual(1);
    expect(sigmoid).toBeGreaterThan(0);
    expect(sigmoid).toBeLessThanOrEqual(1);
    expect(none).toBe(0.7);
  });

  test('power calibration shrinks scores < 1', () => {
    const x = 0.5;
    const calibrated = powerCalibration(x);
    expect(calibrated).toBeLessThan(x);
    expect(calibrated).toBeGreaterThan(0);
  });

  test('analyzeScoreDistribution returns min, max, mean, stdDev', () => {
    const scores = [0.3, 0.5, 0.7, 0.9];
    const dist = analyzeScoreDistribution(scores);
    expect(dist.min).toBe(0.3);
    expect(dist.max).toBe(0.9);
    expect(dist.mean).toBeCloseTo(0.6, 2);
    expect(dist.stdDev).toBeGreaterThan(0);
  });

  test('analyzeScoreDistribution handles empty array', () => {
    const dist = analyzeScoreDistribution([]);
    expect(dist).toEqual({ min: 0, max: 0, mean: 0, stdDev: 0 });
  });

  test('scoreCareerPaths with analyzeDistribution logs raw and calibrated distributions', async () => {
    const consoleSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const userProfile = {
      userSkills: ['X'],
      userWorkExperience: [],
      userEducation: {},
      userCareerPreferences: {},
      userInterests: []
    };
    const paths = [
      { title: 'A', description: 'x', requiredSkills: ['X'] },
      { title: 'B', description: 'x', requiredSkills: ['Y'] }
    ];
    await scoreCareerPaths(userProfile, paths, { analyzeDistribution: true });
    expect(consoleSpy).toHaveBeenCalledWith('[careerPathScorerLegacy] Raw score distribution:', expect.any(Object));
    expect(consoleSpy).toHaveBeenCalledWith('[careerPathScorerLegacy] Calibrated score distribution:', expect.any(Object));
    consoleSpy.mockRestore();
  });
});
