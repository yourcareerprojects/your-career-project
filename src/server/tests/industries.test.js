const {
  INDUSTRY_CANONICAL_LABELS,
  UNASSIGNED_ROLE_DOMAIN,
  OCCUPATION_DOMAIN_VALUES,
  isValidOccupationDomain,
  normalizeOccupationDomain,
  normalizeIndustryLabel,
  normalizeIndustryDomains,
  resolveCanonicalIndustry,
  resolveIndustryId,
  resolveIndustryDisplayLabel,
  listOccupationDomainFilterValues,
  listIndustryOptions,
  formatIndustryTaxonomyForPrompt,
  inferIndustriesFromText,
} = require('../../constants/industries');

describe('industries taxonomy', () => {
  test('exposes a non-empty canonical list', () => {
    expect(INDUSTRY_CANONICAL_LABELS.length).toBeGreaterThan(20);
    expect(INDUSTRY_CANONICAL_LABELS).toContain('Healthcare');
    expect(INDUSTRY_CANONICAL_LABELS).toContain('Animals and Veterinary');
    expect(INDUSTRY_CANONICAL_LABELS).toContain('Finance');
    expect(INDUSTRY_CANONICAL_LABELS).toContain('Economy');
    expect(INDUSTRY_CANONICAL_LABELS).not.toContain('Life Sciences');
    expect(INDUSTRY_CANONICAL_LABELS).not.toContain('MedTech');
    expect(INDUSTRY_CANONICAL_LABELS).not.toContain('Painting & Finishing');
  });

  test('occupation domain values reuse taxonomy plus UNASSIGNED', () => {
    expect(OCCUPATION_DOMAIN_VALUES).toContain(UNASSIGNED_ROLE_DOMAIN);
    expect(OCCUPATION_DOMAIN_VALUES).toEqual(
      expect.arrayContaining(INDUSTRY_CANONICAL_LABELS)
    );
    expect(isValidOccupationDomain(UNASSIGNED_ROLE_DOMAIN)).toBe(true);
    expect(isValidOccupationDomain('Healthcare')).toBe(true);
    expect(isValidOccupationDomain('Animals and Veterinary')).toBe(true);
    expect(normalizeOccupationDomain('Tiere und Veterinärwesen')).toBe('Animals and Veterinary');
    expect(isValidOccupationDomain('NotARealDomain')).toBe(false);
    expect(normalizeOccupationDomain(null)).toBe(UNASSIGNED_ROLE_DOMAIN);
    expect(normalizeOccupationDomain('')).toBe(UNASSIGNED_ROLE_DOMAIN);
    expect(normalizeOccupationDomain('fintech')).toBe('Finance');
    expect(normalizeOccupationDomain('Marketing')).toBe('Marketing');
    expect(normalizeOccupationDomain('Product Management')).toBeNull();
  });

  test('normalizes aliases and blocks job functions', () => {
    expect(normalizeIndustryLabel('Tiere und Veterinärwesen')).toBe('Animals and Veterinary');
    expect(normalizeIndustryLabel('veterinary medicine')).toBe('Animals and Veterinary');
    expect(normalizeIndustryLabel('Tierpflege')).toBe('Animals and Veterinary');
    expect(normalizeIndustryLabel('MedTech')).toBe('Healthcare');
    expect(normalizeIndustryLabel('medtech')).toBe('Healthcare');
    expect(normalizeIndustryLabel('medical device')).toBe('Healthcare');
    expect(normalizeIndustryLabel('digital health')).toBe('Healthcare');
    expect(normalizeIndustryLabel('fintech')).toBe('Finance');
    expect(normalizeIndustryLabel('financial services')).toBe('Finance');
    expect(normalizeIndustryLabel('biotech')).toBe('Natural Sciences');
    expect(normalizeIndustryLabel('Life Sciences')).toBe('Natural Sciences');
    expect(normalizeIndustryLabel('Biophysik')).toBe('Natural Sciences');
    expect(normalizeIndustryLabel('Biologie')).toBe('Natural Sciences');
    expect(normalizeIndustryLabel('Physik')).toBe('Natural Sciences');
    expect(normalizeIndustryLabel('Chemie')).toBe('Natural Sciences');
    expect(normalizeIndustryLabel('Chemiewissenschaften')).toBe('Natural Sciences');
    expect(normalizeIndustryLabel('Mathematics')).toBe('Natural Sciences');
    expect(normalizeIndustryLabel('Geowissenschaften')).toBe('Natural Sciences');
    expect(normalizeIndustryLabel('Naturwissenschaften')).toBe('Natural Sciences');
    expect(normalizeIndustryLabel('Food Trades')).toBe('Food & Beverage');
    expect(normalizeIndustryLabel('Lebensmittelhandwerk')).toBe('Food & Beverage');
    expect(normalizeIndustryLabel('Roofing & Building Envelope')).toBe('Construction');
    expect(normalizeIndustryLabel('Dach & Gebäudehülle')).toBe('Construction');
    expect(normalizeIndustryLabel('Stadtplanung')).toBe('Architecture');
    expect(normalizeIndustryLabel('Urban Planning')).toBe('Architecture');
    expect(normalizeIndustryLabel('Kfz-Handwerk')).toBe('Automotive');
    expect(normalizeIndustryLabel('Automotive Trades')).toBe('Automotive');
    expect(normalizeIndustryLabel('Mining & Metals')).toBe('Mining');
    expect(normalizeIndustryLabel('Bergbau & Metalle')).toBe('Mining');
    expect(normalizeIndustryLabel('Bergbau')).toBe('Mining');
    expect(normalizeIndustryLabel('Sozial- und Sprachwissenschaften')).toBe('Social and Language Sciences');
    expect(normalizeIndustryLabel('social sciences')).toBe('Social and Language Sciences');
    expect(normalizeIndustryLabel('linguistics')).toBe('Social and Language Sciences');
    expect(normalizeIndustryLabel('Soziale Arbeit')).toBe('Social Work');
    expect(normalizeIndustryLabel('Handwerk')).toBe('Skilled Trades');
    expect(normalizeIndustryLabel('Painting & Finishing')).toBe('Skilled Trades');
    expect(normalizeIndustryLabel('Maler & Lackierer')).toBe('Skilled Trades');
    expect(normalizeIndustryLabel('maler')).toBe('Skilled Trades');
    expect(normalizeIndustryLabel('Elektrotechnik')).toBe('Electrical Trades');
    expect(normalizeIndustryLabel('Garten- & Landschaftsbau')).toBe('Gardening & Landscaping');
    expect(normalizeIndustryLabel('Kultur')).toBe('Culture');
    expect(normalizeIndustryLabel('Wirtschaft')).toBe('Economy');
    expect(normalizeIndustryLabel('Economics')).toBe('Economy');
    expect(normalizeIndustryLabel('Technology')).toBe('Software');
    expect(normalizeIndustryLabel('Marketing')).toBe('Marketing');
    expect(normalizeIndustryLabel('digital marketing')).toBe('Marketing');
    expect(normalizeIndustryLabel('E-commerce')).toBe('Sales and Customer Service');
    expect(normalizeIndustryLabel('E-Commerce')).toBe('Sales and Customer Service');
    expect(normalizeIndustryLabel('Vertrieb und Kundenservice')).toBe('Sales and Customer Service');
    expect(normalizeIndustryLabel('Sales')).toBe('Sales and Customer Service');
    expect(normalizeIndustryLabel('Product Management')).toBeNull();
  });

  test('deduplicates mixed inputs', () => {
    expect(normalizeIndustryDomains(['fintech', 'Finance', 'banking'], { keepUnknown: false }))
      .toEqual(['Finance']);
    expect(
      normalizeIndustryDomains(['Biology', 'Physics', 'Chemie', 'Mathematics'], { keepUnknown: false })
    ).toEqual(['Natural Sciences']);
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
    expect(resolveIndustryDisplayLabel('MedTech', 'de')).toBe('Gesundheitswesen');
    expect(resolveIndustryDisplayLabel('MedTech', 'en')).toBe('Healthcare');
    expect(resolveIndustryDisplayLabel('Animals and Veterinary', 'de')).toBe('Tiere und Veterinärwesen');
    expect(resolveIndustryDisplayLabel('Tiere und Veterinärwesen', 'en')).toBe('Animals and Veterinary');
    expect(resolveIndustryDisplayLabel('Economy', 'de')).toBe('Wirtschaft');
    expect(resolveIndustryDisplayLabel('Wirtschaft', 'en')).toBe('Economy');
    expect(resolveIndustryDisplayLabel('Mining', 'de')).toBe('Bergbau');
    expect(resolveIndustryDisplayLabel('Mining & Metals', 'de')).toBe('Bergbau');
    expect(resolveIndustryDisplayLabel('Social and Language Sciences', 'de')).toBe(
      'Sozial- und Sprachwissenschaften'
    );
    expect(resolveIndustryDisplayLabel('Natural Sciences', 'de')).toBe('Naturwissenschaften');
    expect(resolveIndustryDisplayLabel('Life Sciences', 'de')).toBe('Naturwissenschaften');
    expect(resolveIndustryDisplayLabel('Painting & Finishing', 'de')).toBe('Handwerk');
    expect(resolveIndustryDisplayLabel('Maler & Lackierer', 'en')).toBe('Skilled Trades');
    expect(resolveIndustryDisplayLabel('Biology', 'de')).toBe('Naturwissenschaften');
    expect(resolveIndustryDisplayLabel('Chemie', 'en')).toBe('Natural Sciences');
    expect(resolveIndustryDisplayLabel('Sales and Customer Service', 'de')).toBe(
      'Vertrieb und Kundenservice'
    );
    expect(resolveIndustryDisplayLabel('E-commerce', 'de')).toBe('Vertrieb und Kundenservice');
  });

  test('lists occupation domain filter values including legacy labels', () => {
    const values = listOccupationDomainFilterValues('Naturwissenschaften');
    expect(values).toEqual(expect.arrayContaining([
      'Natural Sciences',
      'Life Sciences',
      'Biology',
      'Physics',
      'Chemistry',
      'Chemicals',
      'Mathematics',
      'Earth Sciences',
      'Biologie',
      'Physik',
      'Chemie',
      'Chemiewissenschaften',
      'Mathematik',
      'Geowissenschaften',
    ]));
    expect(listOccupationDomainFilterValues('Handwerk')).toEqual(expect.arrayContaining([
      'Skilled Trades',
      'Painting & Finishing',
      'Maler & Lackierer',
    ]));
    expect(listOccupationDomainFilterValues('Healthcare')).toEqual(expect.arrayContaining([
      'Healthcare',
      'MedTech',
      'medtech',
    ]));
  });

  test('lists localized picker options', () => {
    const deOptions = listIndustryOptions('de');
    const healthcare = deOptions.find((option) => option.value === 'Healthcare');
    expect(healthcare?.label).toBe('Gesundheitswesen');
    const animalsVeterinary = deOptions.find((option) => option.value === 'Animals and Veterinary');
    expect(animalsVeterinary?.label).toBe('Tiere und Veterinärwesen');
    expect(animalsVeterinary?.id).toBe('animals_veterinary');
    expect(deOptions.find((option) => option.value === 'Life Sciences')).toBeUndefined();
    expect(deOptions.find((option) => option.value === 'MedTech')).toBeUndefined();
    expect(deOptions.find((option) => option.value === 'Painting & Finishing')).toBeUndefined();
  });

  test('formats prompt taxonomy in requested language', () => {
    expect(formatIndustryTaxonomyForPrompt('en')).toContain('Healthcare');
    expect(formatIndustryTaxonomyForPrompt('de')).toContain('Gesundheitswesen');
    expect(formatIndustryTaxonomyForPrompt('en')).toContain('Animals and Veterinary');
    expect(formatIndustryTaxonomyForPrompt('de')).toContain('Tiere und Veterinärwesen');
  });

  test('infers industries from CV text heuristics', () => {
    expect(inferIndustriesFromText('Worked at a fintech startup in banking')).toEqual(
      expect.arrayContaining(['Finance'])
    );
    expect(inferIndustriesFromText('Worked as a veterinarian in animal care')).toEqual(
      expect.arrayContaining(['Animals and Veterinary'])
    );
    expect(inferIndustriesFromText('Worked in medtech medical devices')).toEqual(
      expect.arrayContaining(['Healthcare'])
    );
    expect(resolveCanonicalIndustry('medtech')).toBe('Healthcare');
    expect(resolveIndustryId('MedTech')).toBe('healthcare');
    expect(resolveIndustryId('Biophysik')).toBe('natural_sciences');
    expect(resolveIndustryId('Life Sciences')).toBe('natural_sciences');
    expect(resolveIndustryId('Painting & Finishing')).toBe('skilled_trades');
    expect(resolveIndustryId('Maler & Lackierer')).toBe('skilled_trades');
    expect(resolveIndustryId('biotech')).toBe('natural_sciences');
    expect(resolveIndustryId('Tiere und Veterinärwesen')).toBe('animals_veterinary');
    expect(resolveIndustryId('veterinary medicine')).toBe('animals_veterinary');
    expect(resolveIndustryId('Food Trades')).toBe('food_beverage');
    expect(resolveIndustryId('Roofing & Building Envelope')).toBe('construction');
    expect(resolveIndustryId('Urban Planning')).toBe('architecture');
    expect(resolveIndustryId('Automotive Trades')).toBe('automotive');
    expect(resolveIndustryId('Chemiewissenschaften')).toBe('natural_sciences');
    expect(resolveIndustryId('Chemicals')).toBe('natural_sciences');
  });
});
