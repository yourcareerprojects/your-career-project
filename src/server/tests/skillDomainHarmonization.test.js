const {
  normalizeSkillDomainDedupeKey,
  buildSkillDomainHarmonizationPlan,
  harmonizeSkillDomainRows,
  dedupeSkillDomainCatalogEntries,
} = require('../utils/skillDomainHarmonization');

describe('skillDomainHarmonization', () => {
  it('groups variants by German label for dedupe', () => {
    const key = normalizeSkillDomainDedupeKey({
      en: '3D Modelling Techniques',
      de: '3D-Modellierung',
    });
    expect(key).toBe('3d-modellierung');
    expect(normalizeSkillDomainDedupeKey({
      en: '3D Modeling',
      de: '3D-Modellierung',
    })).toBe(key);
  });

  it('builds alias map to the most common key in a German bucket', () => {
    const { keyAliasMap } = buildSkillDomainHarmonizationPlan([
      { key: '3d_modeling', domainI18n: { en: '3D Modeling', de: '3D-Modellierung' }, count: 5 },
      { key: '3d_modelling_techniques', domainI18n: { en: '3D Modelling Techniques', de: '3D-Modellierung' }, count: 1 },
    ]);
    expect(keyAliasMap.get('3d_modelling_techniques')).toBe('3d_modeling');
    expect(keyAliasMap.get('3d_modeling')).toBe('3d_modeling');
  });

  it('merges rows on a career path that share the same German label', () => {
    const { canonicalByDedupeKey } = buildSkillDomainHarmonizationPlan([
      { key: '3d_modeling', domainI18n: { en: '3D Modeling', de: '3D-Modellierung' } },
      { key: '3d_modelling_techniques', domainI18n: { en: '3D Modelling Techniques', de: '3D-Modellierung' } },
    ]);
    const merged = harmonizeSkillDomainRows([
      {
        domain: { en: '3D Modeling', de: '3D-Modellierung' },
        importance: 'important',
        mapped_items: ['render scenes'],
      },
      {
        domain: { en: '3D Modelling Techniques', de: '3D-Modellierung' },
        importance: 'core',
        mapped_items: ['build meshes'],
      },
    ], canonicalByDedupeKey);

    expect(merged).toHaveLength(1);
    expect(merged[0].key).toBe('3d_modeling');
    expect(merged[0].importance).toBe('core');
    expect(merged[0].mapped_items).toEqual(expect.arrayContaining(['render scenes', 'build meshes']));
  });

  it('dedupes catalog entries by German label', () => {
    const deduped = dedupeSkillDomainCatalogEntries([
      {
        key: '3d_modeling',
        label: '3D-Modellierung',
        domainI18n: { en: '3D Modeling', de: '3D-Modellierung' },
      },
      {
        key: '3d_modelling_techniques',
        label: '3D-Modellierung',
        domainI18n: { en: '3D Modelling Techniques', de: '3D-Modellierung' },
      },
    ], new Map([
      ['3d_modeling', 4],
      ['3d_modelling_techniques', 1],
    ]));

    expect(deduped).toHaveLength(1);
    expect(deduped[0].key).toBe('3d_modeling');
    expect(deduped[0].label).toBe('3D-Modellierung');
  });
});
