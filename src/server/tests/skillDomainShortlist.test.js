const {
  shortlistSkillDomainsForCoaching,
  normalizeSkillDomainSelection,
  findBestSkillDomainMatch,
  searchSkillDomainCatalog,
  mergeSkillDomainCatalogResults,
} = require('../services/careerPathSkillService');

const CATALOG = [
  { key: 'data_analysis', label: 'Data Analysis' },
  { key: 'communication', label: 'Communication' },
  { key: 'problem_solving', label: 'Problem Solving' },
  { key: 'team_leadership', label: 'Team Leadership' },
  { key: 'client_engagement', label: 'Client Engagement' },
  { key: 'mathematics_instruction', label: 'Mathematics Instruction' },
];

describe('skill domain shortlist + matching', () => {
  it('shortlists relevant domains ahead of unrelated ones', () => {
    const answers = ['I explain math problems clearly to classmates'];
    const shortlist = shortlistSkillDomainsForCoaching(CATALOG, answers, { limit: 3 });
    const labels = shortlist.map((item) => item.label);
    expect(labels).toContain('Mathematics Instruction');
  });

  it('fuzzy-matches near-miss LLM labels to catalog entries', () => {
    const matched = normalizeSkillDomainSelection(['Math Instruction', 'Communication'], CATALOG, { maxItems: 5 });
    expect(matched).toContain('Communication');
    expect(matched).toContain('Mathematics Instruction');
  });

  it('findBestSkillDomainMatch prefers exact labels', () => {
    expect(findBestSkillDomainMatch('Data Analysis', CATALOG)?.label).toBe('Data Analysis');
  });

  it('dedupes normalized selections that map to the same German bucket', () => {
    const catalog = [
      {
        key: '3d_modeling',
        label: '3D-Modellierung',
        domainI18n: { en: '3D Modeling', de: '3D-Modellierung' },
        dedupeKey: '3d-modellierung',
      },
      {
        key: '3d_modelling_techniques',
        label: '3D-Modellierung',
        domainI18n: { en: '3D Modelling Techniques', de: '3D-Modellierung' },
        dedupeKey: '3d-modellierung',
      },
    ];
    const matched = normalizeSkillDomainSelection(
      ['3D Modeling', '3D Modelling Techniques'],
      catalog,
      { maxItems: 5 },
    );
    expect(matched).toEqual(['3D-Modellierung']);
  });

  it('searchSkillDomainCatalog returns prefix matches first and respects limit', () => {
    const catalog = [
      { key: 'data_analysis', label: 'Data Analysis' },
      { key: 'data_engineering', label: 'Data Engineering' },
      { key: 'communication', label: 'Communication' },
    ];
    const matches = searchSkillDomainCatalog(catalog, 'data', { limit: 2 });
    expect(matches.map((item) => item.label)).toEqual(['Data Analysis', 'Data Engineering']);
  });

  it('mergeSkillDomainCatalogResults keeps selected entries and dedupes', () => {
    const selected = [{ key: 'communication', label: 'Communication' }];
    const recommendations = [
      { key: 'communication', label: 'Communication' },
      { key: 'problem_solving', label: 'Problem Solving' },
    ];
    const merged = mergeSkillDomainCatalogResults(selected, recommendations, 3);
    expect(merged.map((item) => item.label)).toEqual(['Communication', 'Problem Solving']);
  });
});
