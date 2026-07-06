jest.mock('../models/Skill', () => ({
  find: jest.fn(() => ({
    lean: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../utils/escoUriToTitleMap', () => ({
  resolveEscoSkillTitles: jest.fn().mockResolvedValue({}),
  findTitleForEscoUri: jest.fn(),
}));

const Skill = require('../models/Skill');
const {
  toSkillDomainObjects,
  mergeLocalizedCareerPathStep,
} = require('../services/careerPathSkillService');

describe('careerPathSkillService skillDomains parsing', () => {
  test('toSkillDomainObjects accepts localized API rows with label + items', () => {
    const rows = toSkillDomainObjects({
      skillDomains: [
        {
          key: 'client_engagement',
          label: 'Kundenengagement',
          items: [{ key: 'prepare_sales', label: 'Prepare sales presentations' }],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('client_engagement');
    expect(rows[0].domainI18n).toEqual({ en: 'Kundenengagement', de: null });
    expect(rows[0].items).toHaveLength(1);
  });

  test('toSkillDomainObjects accepts legacy skill_domains wrapper', () => {
    const rows = toSkillDomainObjects({
      skillDomains: {
        skill_domains: [
          {
            domain: { en: 'Data Analysis', de: 'Datenanalyse' },
            importance: 'core',
            mapped_items: ['statistics'],
          },
        ],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Data Analysis');
    expect(rows[0].domainI18n.de).toBe('Datenanalyse');
  });

  test('toSkillDomainObjects accepts skill_domains array at top level', () => {
    const rows = toSkillDomainObjects({
      skillDomains: [
        {
          domain: 'Stakeholder Communication',
          importance: 'important',
          mapped_items: ['present findings'],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].domainI18n.en).toBe('Stakeholder Communication');
  });

  test('mergeLocalizedCareerPathStep does not warn on re-localized skillDomains array', async () => {
    Skill.find.mockImplementation(() => ({
      lean: jest.fn().mockResolvedValue([]),
    }));
    const warnings = [];
    const logger = {
      warn: (msg) => warnings.push(msg),
      error: () => {},
      debug: () => {},
    };
    const step = {
      title: { en: 'Sales Manager', de: null },
      skillDomains: [
        {
          key: 'client_engagement',
          label: 'Client Engagement',
          items: [{ key: 'prepare_sales', label: 'Prepare sales presentations' }],
        },
      ],
      requiredSkills: [],
      optionalSkills: [],
    };
    const merged = await mergeLocalizedCareerPathStep(step, 'en', logger);
    expect(warnings).toHaveLength(0);
    expect(Array.isArray(merged.skillDomains)).toBe(true);
    expect(merged.skillDomains[0].label).toBe('Client Engagement');
    expect(merged.skillDomains[0].items[0].label).toBe('Prepare sales presentations');
  });
});
