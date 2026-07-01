const {
  INDUSTRY_CANONICAL_LABELS,
  normalizeIndustryLabel,
  normalizeIndustryDomains,
  resolveCanonicalIndustry,
  resolveIndustryId,
  resolveIndustryDisplayLabel,
  listIndustryOptions,
  formatIndustryTaxonomyForPrompt,
  inferIndustriesFromText,
} = require('../../constants/industries');

describe('industries taxonomy', () => {
  test('exposes a non-empty canonical list', () => {
    expect(INDUSTRY_CANONICAL_LABELS.length).toBeGreaterThan(20);
    expect(INDUSTRY_CANONICAL_LABELS).toContain('Healthcare');
    expect(INDUSTRY_CANONICAL_LABELS).toContain('Finance');
  });

  test('normalizes aliases and blocks job functions', () => {
    expect(normalizeIndustryLabel('fintech')).toBe('Finance');
    expect(normalizeIndustryLabel('financial services')).toBe('Finance');
    expect(normalizeIndustryLabel('biotech')).toBe('Life Sciences');
    expect(normalizeIndustryLabel('Biophysik')).toBe('Biophysics');
    expect(normalizeIndustryLabel('Biologie')).toBe('Biology');
    expect(normalizeIndustryLabel('Physik')).toBe('Physics');
    expect(normalizeIndustryLabel('Soziale Arbeit')).toBe('Social Work');
    expect(normalizeIndustryLabel('Handwerk')).toBe('Skilled Trades');
    expect(normalizeIndustryLabel('Elektrotechnik')).toBe('Electrical Trades');
    expect(normalizeIndustryLabel('Kfz-Handwerk')).toBe('Automotive Trades');
    expect(normalizeIndustryLabel('Garten- & Landschaftsbau')).toBe('Gardening & Landscaping');
    expect(normalizeIndustryLabel('Kultur')).toBe('Culture');
    expect(normalizeIndustryLabel('Stadtplanung')).toBe('Urban Planning');
    expect(normalizeIndustryLabel('Technology')).toBe('Software');
    expect(normalizeIndustryLabel('Marketing')).toBeNull();
    expect(normalizeIndustryLabel('Product Management')).toBeNull();
  });

  test('deduplicates mixed inputs', () => {
    expect(normalizeIndustryDomains(['fintech', 'Finance', 'banking'], { keepUnknown: false }))
      .toEqual(['Finance']);
  });

  test('keeps unknown legacy labels when requested', () => {
    expect(normalizeIndustryDomains(['Custom Niche'], { keepUnknown: true }))
      .toEqual(['Custom Niche']);
    expect(normalizeIndustryDomains(['Custom Niche'], { keepUnknown: false }))
      .toEqual([]);
  });

  test('resolves localized display labels', () => {
    expect(resolveIndustryDisplayLabel('Healthcare', 'de')).toBe('Gesundheitswesen');
    expect(resolveIndustryDisplayLabel('Gesundheitswesen', 'en')).toBe('Healthcare');
  });

  test('lists localized picker options', () => {
    const deOptions = listIndustryOptions('de');
    const healthcare = deOptions.find((option) => option.value === 'Healthcare');
    expect(healthcare?.label).toBe('Gesundheitswesen');
  });

  test('formats prompt taxonomy in requested language', () => {
    expect(formatIndustryTaxonomyForPrompt('en')).toContain('Healthcare');
    expect(formatIndustryTaxonomyForPrompt('de')).toContain('Gesundheitswesen');
  });

  test('infers industries from CV text heuristics', () => {
    expect(inferIndustriesFromText('Worked at a fintech startup in banking')).toEqual(
      expect.arrayContaining(['Finance'])
    );
    expect(resolveCanonicalIndustry('medtech')).toBe('MedTech');
    expect(resolveIndustryId('Biophysik')).toBe('biophysics');
    expect(resolveIndustryId('Chemiewissenschaften')).toBe('chemistry_science');
  });
});
