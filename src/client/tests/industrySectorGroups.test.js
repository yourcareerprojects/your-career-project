const { INDUSTRY_TAXONOMY } = require('../../constants/industries');
const { INDUSTRY_SECTOR_GROUPS } = require('../utils/industrySectorGroups');

describe('industrySectorGroups', () => {
  test('assigns every taxonomy id to exactly one thematic group', () => {
    const taxonomyIds = new Set(INDUSTRY_TAXONOMY.map((entry) => entry.id));
    const groupedIds = INDUSTRY_SECTOR_GROUPS.flatMap((group) => group.ids);
    const groupedSet = new Set(groupedIds);

    expect(groupedIds.length).toBe(groupedSet.size);
    expect(groupedSet.size).toBe(taxonomyIds.size);
    for (const id of taxonomyIds) {
      expect(groupedSet.has(id)).toBe(true);
    }
  });
});
