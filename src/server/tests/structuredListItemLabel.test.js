const {
  normalizeStructuredListItemLabel,
  normalizeStructuredListItemLabels,
} = require('../../constants/structuredListItemLabel');

describe('structuredListItemLabel', () => {
  test('normalizes plain strings and { name } objects', () => {
    expect(normalizeStructuredListItemLabel('Analytics')).toBe('Analytics');
    expect(normalizeStructuredListItemLabel({ name: 'Project management' })).toBe('Project management');
  });

  test('normalizes bilingual name pairs without [object Object]', () => {
    expect(
      normalizeStructuredListItemLabel(
        { name: { en: 'Data analysis', de: 'Datenanalyse' } },
        'de'
      )
    ).toBe('Datenanalyse');
    expect(
      normalizeStructuredListItemLabel(
        { name: { en: 'Data analysis', de: 'Datenanalyse' } },
        'en'
      )
    ).toBe('Data analysis');
  });

  test('normalizeStructuredListItemLabels drops empty entries', () => {
    expect(
      normalizeStructuredListItemLabels([
        { name: { en: 'SQL', de: 'SQL' } },
        { name: '' },
        null,
      ], 'en')
    ).toEqual(['SQL']);
  });
});
