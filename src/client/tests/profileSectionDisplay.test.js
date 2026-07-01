jest.mock('../utils/localizedContentService', () => ({
  __esModule: true,
  default: {
    getLocalizedWithFallback: (field, lang, fallback = '') => {
      if (!field) return fallback;
      if (typeof field === 'string') return field;
      const code = String(lang || 'en').toLowerCase().split('-')[0];
      return field.translations?.[code] || field.original || fallback;
    },
  },
}));

jest.mock('../components/profile/WorkEnjoyMostCoaching', () => ({
  parseActivitiesFromText: (text) => String(text || '').split('\n').map((line) => line.trim()).filter(Boolean),
  formatActivitiesAsText: (items) => items.join('\n'),
}));

jest.mock('../components/profile/TopicsIndustriesCoaching', () => ({
  parseInterestTopicsFromText: (text) => String(text || '').split('\n').map((line) => line.trim()).filter(Boolean),
  formatInterestTopicsAsText: (items) => items.join('\n'),
}));

jest.mock('../components/profile/NaturallyGoodAtCoaching', () => ({
  parseNaturallyGoodAtFromText: (text) => ({
    strengths: String(text || '').split('\n').map((line) => line.trim()).filter(Boolean),
  }),
  formatNaturallyGoodAtAsText: ({ strengths = [] }) => strengths.join('\n'),
}));

jest.mock('../components/profile/WorkEnvironmentCoaching', () => ({
  parseWorkEnvironmentFromText: (text) => ({
    workStyles: String(text || '').split('\n').map((line) => line.trim()).filter(Boolean),
    workEnvironments: [],
  }),
  formatWorkEnvironmentAsText: ({ workStyles = [], workEnvironments = [] }) => [
    ...workStyles,
    ...workEnvironments,
  ].join('\n'),
}));

jest.mock('../components/profile/WorkingLifeAchievementCoaching', () => ({
  parseWorkingLifeAchievementFromText: (text) => ({
    careerGoals: String(text || '').split('\n').map((line) => line.trim()).filter(Boolean),
    priorities: [],
  }),
  formatWorkingLifeAchievementAsText: ({ careerGoals = [], priorities = [] }) => [
    ...careerGoals,
    ...priorities,
  ].join('\n'),
}));

const {
  getWhoAreYouNarratives,
  hasIdentityNarrative,
  parseIdentityFieldToBullets,
  parseIdentityFieldForEdit,
  formatIdentityFieldFromEdit,
  identityFieldDraftHasContent,
  resolveSectionDisplayMode,
  PROFILE_DISPLAY_MODE,
  WHO_ARE_YOU_PLACEHOLDER,
} = require('../utils/profileSectionDisplay');

describe('profileSectionDisplay', () => {
  test('parses coaching-style identity answers into bullet lines', () => {
    expect(parseIdentityFieldToBullets('workEnjoyMost', 'Design reviews\nMentoring juniors')).toEqual([
      'Design reviews',
      'Mentoring juniors',
    ]);
    expect(parseIdentityFieldToBullets('naturallyGoodAt', 'Spotting risks\nExplaining complex topics')).toEqual([
      'Spotting risks',
      'Explaining complex topics',
    ]);
  });

  test('extracts who-are-you narratives and ignores placeholders', () => {
    const narratives = getWhoAreYouNarratives({
      summary_text: {
        original_language: 'en',
        original: JSON.stringify([
          'You move fast on problems.',
          WHO_ARE_YOU_PLACEHOLDER,
          'Third answer.',
          'Fourth.',
          'Fifth.',
        ]),
        translations: { en: JSON.stringify(['You move fast on problems.', '', 'Third answer.', 'Fourth.', 'Fifth.']) },
      },
    }, 'en');

    expect(narratives[0]).toBe('You move fast on problems.');
    expect(narratives[1]).toBe('');
    expect(hasIdentityNarrative(narratives, 0)).toBe(true);
    expect(hasIdentityNarrative(narratives, 1)).toBe(false);
  });

  test('round-trips identity edit drafts for bullet fields', () => {
    const draft = parseIdentityFieldForEdit('workEnjoyMost', 'Design reviews\nMentoring juniors');
    expect(draft).toEqual({ kind: 'bullets', items: ['Design reviews', 'Mentoring juniors'] });
    expect(formatIdentityFieldFromEdit('workEnjoyMost', draft)).toBe('Design reviews\nMentoring juniors');
    expect(identityFieldDraftHasContent('workEnjoyMost', draft)).toBe(true);
  });

  test('defaults to bullets and only uses narrative when available', () => {
    expect(resolveSectionDisplayMode({}, 'identity.workEnjoyMost', false)).toBe(PROFILE_DISPLAY_MODE.BULLETS);
    expect(resolveSectionDisplayMode(
      { 'identity.workEnjoyMost': PROFILE_DISPLAY_MODE.NARRATIVE },
      'identity.workEnjoyMost',
      true
    )).toBe(PROFILE_DISPLAY_MODE.NARRATIVE);
    expect(resolveSectionDisplayMode(
      { 'identity.workEnjoyMost': PROFILE_DISPLAY_MODE.NARRATIVE },
      'identity.workEnjoyMost',
      false
    )).toBe(PROFILE_DISPLAY_MODE.BULLETS);
  });
});
