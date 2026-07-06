const {
  searchSkillCatalog,
  mergeSkillCatalogResults,
  flattenRoleSkillCatalog,
  splitSkillsByType,
  shortlistSkillDomainsForCoaching,
  resolveSelectedSkillCatalogEntries,
  buildRoleSkillSearchBundle,
} = require('../services/careerPathSkillService');

const CATALOG = {
  requiredSkills: [
    { key: 'data_analysis', label: 'Data Analysis' },
    { key: 'communication', label: 'Communication' },
    { key: 'mathematics_instruction', label: 'Mathematics Instruction' },
  ],
  optionalSkills: [
    { key: 'problem_solving', label: 'Problem Solving' },
    { key: 'team_leadership', label: 'Team Leadership' },
  ],
};

describe('role skill search + recommendations', () => {
  it('flattens required and optional skills with type metadata', () => {
    const flat = flattenRoleSkillCatalog(CATALOG);
    expect(flat).toHaveLength(5);
    expect(flat.find((item) => item.label === 'Data Analysis')?.skillType).toBe('required');
    expect(flat.find((item) => item.label === 'Problem Solving')?.skillType).toBe('optional');
  });

  it('searchSkillCatalog returns prefix matches first and respects limit', () => {
    const flat = flattenRoleSkillCatalog(CATALOG);
    const matches = searchSkillCatalog(flat, 'data', { limit: 1 });
    expect(matches.map((item) => item.label)).toEqual(['Data Analysis']);
  });

  it('shortlists relevant skills ahead of unrelated ones', () => {
    const flat = flattenRoleSkillCatalog(CATALOG);
    const answers = ['I explain math problems clearly to classmates'];
    const shortlist = shortlistSkillDomainsForCoaching(flat, answers, { limit: 3 });
    const labels = shortlist.map((item) => item.label);
    expect(labels).toContain('Mathematics Instruction');
  });

  it('mergeSkillCatalogResults keeps selected entries and dedupes', () => {
    const selected = [{ key: 'communication', label: 'Communication', skillType: 'required' }];
    const recommendations = [
      { key: 'communication', label: 'Communication', skillType: 'required' },
      { key: 'problem_solving', label: 'Problem Solving', skillType: 'optional' },
    ];
    const merged = mergeSkillCatalogResults(selected, recommendations, 3);
    expect(merged.map((item) => item.label)).toEqual(['Communication', 'Problem Solving']);
  });

  it('splitSkillsByType separates required and optional skills', () => {
    const merged = [
      { key: 'communication', label: 'Communication', skillType: 'required' },
      { key: 'problem_solving', label: 'Problem Solving', skillType: 'optional' },
    ];
    const split = splitSkillsByType(merged);
    expect(split.requiredSkills).toEqual([{ key: 'communication', label: 'Communication' }]);
    expect(split.optionalSkills).toEqual([{ key: 'problem_solving', label: 'Problem Solving' }]);
  });

  it('resolveSelectedSkillCatalogEntries maps free-text labels to catalog entries', () => {
    const flat = flattenRoleSkillCatalog(CATALOG);
    const matched = resolveSelectedSkillCatalogEntries(flat, ['data analysis', 'Unknown Skill']);
    expect(matched.map((item) => ({ key: item.key, label: item.label }))).toEqual([
      { key: 'data_analysis', label: 'Data Analysis' },
    ]);
  });

  it('buildRoleSkillSearchBundle precomputes scoring metadata for catalog items', () => {
    const bundle = buildRoleSkillSearchBundle(CATALOG);
    expect(bundle.flatCatalog).toHaveLength(5);
    expect(bundle.flatCatalog[0]._labelTokens).toEqual(expect.any(Array));
    expect(bundle.flatCatalog[0]._labelLower).toBe('data analysis');
    expect(bundle.catalogIndex.byLabel.get('data analysis')).toBeTruthy();
  });

  it('shortlist skips unrelated catalog entries without scoring them', () => {
    const largeCatalog = [
      ...flattenRoleSkillCatalog(CATALOG),
      ...Array.from({ length: 200 }, (_, index) => ({
        key: `unrelated_${index}`,
        label: `Unrelated Topic ${index}`,
        skillType: 'optional',
      })),
    ];
    const answers = ['I explain math problems clearly to classmates'];
    const shortlist = shortlistSkillDomainsForCoaching(largeCatalog, answers, { limit: 3 });
    const labels = shortlist.map((item) => item.label);
    expect(labels).toContain('Mathematics Instruction');
    expect(labels.some((label) => String(label).startsWith('Unrelated Topic'))).toBe(false);
  });
});
