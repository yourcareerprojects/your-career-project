const {
  getLocalizedField,
  getLocalizedFieldLenient,
  getEnglishField,
  assertIsLocalizedField,
  InvalidI18nFieldError,
} = require('../utils/i18nFields');

describe('i18nFields (strict)', () => {
  test('getLocalizedField returns de when set', () => {
    expect(getLocalizedField({ en: 'Hello', de: 'Hallo' }, 'de')).toBe('Hallo');
  });

  test('getLocalizedField falls back to en when lang missing or null', () => {
    expect(getLocalizedField({ en: 'Hello', de: null }, 'de')).toBe('Hello');
  });

  test('getLocalizedField throws on string', () => {
    expect(() => getLocalizedField('x', 'en')).toThrow(InvalidI18nFieldError);
  });

  test('getLocalizedField throws when en missing', () => {
    expect(() => getLocalizedField({ de: 'x' }, 'en')).toThrow(InvalidI18nFieldError);
  });

  test('getEnglishField returns en string', () => {
    expect(getEnglishField({ en: 'A', de: null })).toBe('A');
  });

  test('assertIsLocalizedField throws for corrupt data', () => {
    expect(() => assertIsLocalizedField(null)).toThrow(InvalidI18nFieldError);
  });
});

describe('i18nFields (lenient, API display)', () => {
  test('getLocalizedFieldLenient returns plain string as-is', () => {
    expect(getLocalizedFieldLenient('Software Engineer', 'en')).toBe('Software Engineer');
  });

  test('getLocalizedFieldLenient maps strict object like getLocalizedField', () => {
    expect(getLocalizedFieldLenient({ en: 'Hello', de: 'Hallo' }, 'de')).toBe('Hallo');
  });

  test('getLocalizedFieldLenient does not throw on legacy object without en', () => {
    expect(getLocalizedFieldLenient({ de: 'Nur DE' }, 'de')).toBe('Nur DE');
  });

  test('getLocalizedFieldLenient returns empty string for null', () => {
    expect(getLocalizedFieldLenient(null, 'en')).toBe('');
  });
});
