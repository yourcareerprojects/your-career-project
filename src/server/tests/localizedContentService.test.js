const localizedContentService = require('../services/localization/localizedContentService');

describe('server localizedContentService', () => {
  test('legacy { en, de } still resolves and falls back', () => {
    const field = { en: 'Hello', de: 'Hallo' };
    expect(localizedContentService.get(field, 'de')).toBe('Hallo');
    expect(localizedContentService.get({ en: 'Hello', de: null }, 'de')).toBe('Hello');
    expect(localizedContentService.normalizeForResponse(field, 'de')).toBe('Hallo');
  });

  test('nested { original_language, original, translations } resolves preferred locale', () => {
    const field = {
      original_language: 'en',
      original: 'Original EN',
      translations: {
        de: 'Uebersetzt DE',
        en: 'Translated EN',
      },
    };
    expect(localizedContentService.get(field, 'de')).toBe('Uebersetzt DE');
    expect(localizedContentService.get(field, 'en')).toBe('Translated EN');
    expect(localizedContentService.normalizeForResponse(field, 'de')).toBe('Uebersetzt DE');
  });

  test('nested shape: requesting en does not return German-only translations or wrong-language original', () => {
    const onlyDeSlot = {
      original_language: 'de',
      original: 'Nur DE Original',
      translations: {
        de: JSON.stringify(['a', 'b', 'c', 'd', 'e']),
      },
    };
    expect(localizedContentService.get(onlyDeSlot, 'en')).toBeNull();
    expect(localizedContentService.normalizeForResponse(onlyDeSlot, 'en')).toBeNull();
    expect(localizedContentService.get(onlyDeSlot, 'de')).toContain('a');
  });

  test('nested shape falls back to english translation then original', () => {
    const withEnglishOnly = {
      original_language: 'de',
      original: 'Original DE',
      translations: {
        en: 'Translated EN',
      },
    };
    expect(localizedContentService.get(withEnglishOnly, 'de')).toBe('Translated EN');

    const withOriginalOnly = {
      original_language: 'de',
      original: 'Original DE',
      translations: {},
    };
    expect(localizedContentService.get(withOriginalOnly, 'en')).toBe('Original DE');
  });

  test('set preserves nested shape and updates translations', () => {
    const field = {
      original_language: 'de',
      original: 'Original DE',
      translations: { de: 'Alt DE', en: 'Old EN' },
    };
    const updated = localizedContentService.set(field, 'en', 'New EN');
    expect(updated.original_language).toBe('de');
    expect(updated.original).toBe('Original DE');
    expect(updated.translations.en).toBe('New EN');
    expect(updated.translations.de).toBe('Alt DE');
  });
});
