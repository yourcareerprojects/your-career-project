const {
  buildSkillHarmonizationPlan,
  dedupeSkillCatalogEntries,
  buildSkillLabelAliasMaps,
  harmonizeSkillNameList,
} = require('../utils/skillHarmonization');

describe('skillHarmonization', () => {
  const skills = [
    { key: 'customer_consultation', label: { en: 'Customer Consultation', de: 'Kundenberatung' } },
    { key: 'client_counseling', label: { en: 'Client Counseling', de: 'Kundenberatung' } },
    { key: 'quality_control', label: { en: 'Quality Control', de: 'Qualitätskontrolle' } },
  ];

  it('builds alias map from German label buckets', () => {
    const keyCounts = new Map([
      ['customer_consultation', 10],
      ['client_counseling', 2],
      ['quality_control', 5],
    ]);
    const { keyAliasMap } = buildSkillHarmonizationPlan(skills, keyCounts);
    expect(keyAliasMap.get('client_counseling')).toBe('customer_consultation');
    expect(keyAliasMap.get('customer_consultation')).toBe('customer_consultation');
  });

  it('dedupes catalog entries by German label', () => {
    const deduped = dedupeSkillCatalogEntries([
      {
        key: 'customer_consultation',
        label: 'Kundenberatung',
        labelI18n: { en: 'Customer Consultation', de: 'Kundenberatung' },
      },
      {
        key: 'client_counseling',
        label: 'Kundenberatung',
        labelI18n: { en: 'Client Counseling', de: 'Kundenberatung' },
      },
    ], new Map([
      ['customer_consultation', 10],
      ['client_counseling', 2],
    ]));
    expect(deduped).toHaveLength(1);
    expect(deduped[0].key).toBe('customer_consultation');
  });

  it('harmonizes user-facing skill name lists via label aliases', () => {
    const keyCounts = new Map([
      ['customer_consultation', 10],
      ['client_counseling', 2],
    ]);
    const { keyAliasMap } = buildSkillHarmonizationPlan(skills, keyCounts);
    const labelAliasMaps = buildSkillLabelAliasMaps(skills, keyAliasMap);
    const next = harmonizeSkillNameList(
      ['Client Counseling', 'Kundenberatung', 'Quality Control'],
      labelAliasMaps,
    );
    expect(next).toEqual(['Customer Consultation', 'Quality Control']);
  });

  it('collapses mixed-language duplicates for the same harmonized skill', () => {
    const keyCounts = new Map([
      ['customer_consultation', 10],
      ['client_counseling', 2],
    ]);
    const { keyAliasMap } = buildSkillHarmonizationPlan(skills, keyCounts);
    const labelAliasMaps = buildSkillLabelAliasMaps(skills, keyAliasMap);
    expect(harmonizeSkillNameList(['Client Counseling', 'Kundenberatung'], labelAliasMaps))
      .toEqual(['Customer Consultation']);
  });
});
