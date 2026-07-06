const EscoSkill = require('../models/EscoSkill');
const EscoOccupationSkillRelation = require('../models/EscoOccupationSkillRelation');
const {
  canonicalEscoUri,
  findTitleForEscoUri,
  resolveEscoSkillTitles,
  getOccupationSkillEntries,
} = require('../services/escoSkillLookupService');

describe('escoSkillLookupService', () => {
  const skillUri = 'http://data.europa.eu/esco/skill/test-skill-1';
  const occUri = 'http://data.europa.eu/esco/occupation/test-occ-1';

  beforeEach(async () => {
    await EscoSkill.deleteMany({});
    await EscoOccupationSkillRelation.deleteMany({});
  });

  test('canonicalEscoUri trims trailing slashes', () => {
    expect(canonicalEscoUri(`${skillUri}/`)).toBe(skillUri);
  });

  test('resolveEscoSkillTitles returns labels from MongoDB', async () => {
    await EscoSkill.create({
      uri: skillUri,
      label: { en: 'Project management', de: null },
    });

    const map = await resolveEscoSkillTitles([`${skillUri}/`]);
    expect(map[skillUri]).toBe('Project management');
    expect(findTitleForEscoUri(`${skillUri}/`, map)).toBe('Project management');
  });

  test('getOccupationSkillEntries groups essential and optional relations', async () => {
    const essentialUri = 'http://data.europa.eu/esco/skill/essential-1';
    const optionalUri = 'http://data.europa.eu/esco/skill/optional-1';

    await EscoSkill.insertMany([
      { uri: essentialUri, label: { en: 'Lead teams', de: null } },
      { uri: optionalUri, label: { en: 'Write reports', de: null } },
    ]);

    await EscoOccupationSkillRelation.insertMany([
      {
        occupationUri: occUri,
        skillUri: essentialUri,
        relationType: 'essential',
        skillType: 'skill/competence',
      },
      {
        occupationUri: occUri,
        skillUri: optionalUri,
        relationType: 'optional',
        skillType: 'knowledge',
      },
    ]);

    const { essential, optional } = await getOccupationSkillEntries(occUri);
    expect(essential).toHaveLength(1);
    expect(essential[0].title).toBe('Lead teams');
    expect(optional).toHaveLength(1);
    expect(optional[0].title).toBe('Write reports');
  });
});
