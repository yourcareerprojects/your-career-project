jest.mock('../models/Skill', () => ({
  find: jest.fn(),
}));

jest.mock('../models/CareerPath', () => ({
  find: jest.fn(),
}));

jest.mock('../models/CareerPathSkill', () => ({
  find: jest.fn(),
}));

const Skill = require('../models/Skill');
const CareerPath = require('../models/CareerPath');
const CareerPathSkill = require('../models/CareerPathSkill');
const { listDistinctRoleSkillsForSelection } = require('../services/careerPathSkillService');

describe('listDistinctRoleSkillsForSelection', () => {
  const skillDocs = [
    { _id: 'skill-a', key: 'project_management', label: { en: 'Project Management', de: 'Projektmanagement' } },
    { _id: 'skill-b', key: 'public_speaking', label: { en: 'Public Speaking', de: 'Öffentliches Sprechen' } },
    { _id: 'skill-c', key: 'project_mgmt', label: { en: 'Project Mgmt', de: 'Projektmanagement' } },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    Skill.find.mockImplementation((query) => ({
      lean: jest.fn().mockResolvedValue(
        skillDocs.filter((skill) => {
          if (query?._id?.$in) return query._id.$in.includes(skill._id);
          if (query?.key?.$in) return query.key.$in.includes(skill.key);
          return true;
        }),
      ),
    }));
  });

  test('returns localized required and optional-only skills from career path links', async () => {
    CareerPathSkill.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { skillId: 'skill-a', type: 'required' },
        { skillId: 'skill-b', type: 'optional' },
        { skillId: 'skill-a', type: 'optional' },
        { skillId: 'skill-c', type: 'required' },
      ]),
    });
    const result = await listDistinctRoleSkillsForSelection('de');

    expect(result.requiredSkills).toEqual([
      { key: 'project_management', label: 'Projektmanagement' },
    ]);
    expect(result.optionalSkills).toEqual([
      { key: 'public_speaking', label: 'Öffentliches Sprechen' },
    ]);
    expect(CareerPath.find).not.toHaveBeenCalled();
    expect(Skill.find).toHaveBeenCalledTimes(1);
  });

  test('falls back to career path skill lists when no links exist', async () => {
    CareerPathSkill.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
    CareerPath.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          requiredSkills: ['Data Analysis'],
          skillModel: { optional_skills: ['Negotiation'] },
        },
      ]),
    });
    Skill.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    const result = await listDistinctRoleSkillsForSelection('en');

    expect(result.requiredSkills).toEqual([
      { key: 'data_analysis', label: 'Data Analysis' },
    ]);
    expect(result.optionalSkills).toEqual([
      { key: 'negotiation', label: 'Negotiation' },
    ]);
  });
});
