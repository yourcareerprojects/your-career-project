jest.mock('../models/Skill', () => ({
  find: jest.fn(),
}));

jest.mock('../models/CareerPath', () => ({
  aggregate: jest.fn(),
}));

jest.mock('../models/CareerPathSkill', () => ({
  find: jest.fn(),
}));

const Skill = require('../models/Skill');
const CareerPath = require('../models/CareerPath');
const CareerPathSkill = require('../models/CareerPathSkill');
const mongoose = require('mongoose');
const {
  resolveUserSkillsForPoolFetch,
  resetUserSkillPoolIndexForTests,
} = require('../services/simulation/userSkillKeysForPoolFetch');

function mockLean(resolved) {
  return { lean: jest.fn().mockResolvedValue(resolved) };
}

function mockFindLean(resolved) {
  return {
    select: jest.fn().mockReturnValue(mockLean(resolved)),
  };
}

describe('userSkillKeysForPoolFetch', () => {
  beforeEach(() => {
    resetUserSkillPoolIndexForTests();
    jest.clearAllMocks();
  });

  test('maps German profile skills to English requiredSkillKeys via Skill labels', async () => {
    Skill.find.mockReturnValue(
      mockLean([
        {
          _id: 'skill-teamwork',
          key: 'teamwork',
          label: { en: 'Teamwork', de: 'Teamarbeit' },
        },
        {
          _id: 'skill-pm',
          key: 'project_management',
          label: { en: 'Project Management', de: 'Projektmanagement' },
        },
      ])
    );
    CareerPath.aggregate.mockResolvedValue([
      { _id: 'project management' },
      { _id: 'manage engineering project' },
      { _id: 'teamwork' },
    ]);
    CareerPathSkill.find.mockReturnValue(mockFindLean([]));

    const result = await resolveUserSkillsForPoolFetch([
      'Teamarbeit',
      'Projektmanagement',
    ]);

    expect(result.matchedSkillCount).toBe(2);
    expect(result.requiredSkillKeys).toContain('project management');
    expect(result.requiredSkillKeys).not.toContain('teamarbeit');
  });

  test('includes career paths linked through CareerPathSkill', async () => {
    const teamworkId = new mongoose.Types.ObjectId();
    const linked1 = new mongoose.Types.ObjectId();
    const linked2 = new mongoose.Types.ObjectId();

    Skill.find.mockReturnValue(
      mockLean([
        {
          _id: teamworkId,
          key: 'teamwork',
          label: { en: 'Teamwork', de: 'Teamarbeit' },
        },
      ])
    );
    CareerPath.aggregate.mockResolvedValue([{ _id: 'operational collaboration' }]);
    CareerPathSkill.find.mockReturnValue(
      mockFindLean([{ careerPathId: linked1 }, { careerPathId: linked2 }])
    );

    const result = await resolveUserSkillsForPoolFetch(['Teamarbeit']);

    expect(result.careerPathIds).toEqual([String(linked1), String(linked2)]);
  });

  test('keeps direct English requiredSkillKeys when user already typed them', async () => {
    Skill.find.mockReturnValue(mockLean([]));
    CareerPath.aggregate.mockResolvedValue([{ _id: 'communication' }]);
    CareerPathSkill.find.mockReturnValue(mockFindLean([]));

    const result = await resolveUserSkillsForPoolFetch(['Communication']);

    expect(result.requiredSkillKeys).toContain('communication');
  });
});
