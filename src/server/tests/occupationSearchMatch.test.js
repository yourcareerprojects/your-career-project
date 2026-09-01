const {
  matchQuality,
  classifyOccupationSearchMatch,
  compareOccupationSearchResults,
} = require('../utils/occupationSearchMatch');

describe('occupationSearchMatch', () => {
  test('scores word-boundary matches stronger than mid-token substrings', () => {
    expect(matchQuality('Tierpfleger*in', 'Tier')).toBe(1);
    expect(matchQuality('Fachkraft für die Gesundheit aquatischer Tiere', 'Tier')).toBe(1);
    expect(matchQuality('alternative Tiertherapeut*in', 'Tier')).toBe(1);
    expect(matchQuality('Montierer*in für Steuerungstechnik', 'Tier')).toBe(2);
    expect(matchQuality('Chocolatier*in', 'Tier')).toBe(2);
    expect(matchQuality('Hotelportier*in', 'Tier')).toBe(2);
    expect(matchQuality('Ingenieur*in für rotierende Maschinen', 'Tier')).toBe(2);
  });

  test('classifies cross-language alt hits as altTitles, not title', () => {
    const rawDoc = {
      title: { en: 'Bow Maker', de: 'Bogenmacher*in' },
      altTitles: ['Archetier'],
      altTitlesDe: ['Bogenbauer*in'],
    };
    const localized = {
      title: 'Bogenmacher*in',
      altTitles: ['Bogenbauer*in'],
    };

    const match = classifyOccupationSearchMatch(rawDoc, localized, 'Tier');
    expect(match.matchedBy).toBe('altTitles');
    expect(match.matchedValue).toBe('Archetier');
  });

  test('sorts strong title matches alphabetically before mid-token title matches and before alt matches', () => {
    const rows = [
      {
        title: 'Montierer*in',
        matchedBy: 'title',
        matchQuality: 2,
      },
      {
        title: 'Bakteriologie-Techniker*in',
        matchedBy: 'altTitles',
        matchQuality: 1,
      },
      {
        title: 'Fachkraft für die Gesundheit aquatischer Tiere',
        matchedBy: 'title',
        matchQuality: 1,
      },
      {
        title: 'Tierpfleger*in',
        matchedBy: 'title',
        matchQuality: 1,
      },
    ];

    rows.sort((a, b) => compareOccupationSearchResults(a, b, 'de', { hasQuery: true }));
    expect(rows.map((r) => r.title)).toEqual([
      'Fachkraft für die Gesundheit aquatischer Tiere',
      'Tierpfleger*in',
      'Montierer*in',
      'Bakteriologie-Techniker*in',
    ]);
  });
});
