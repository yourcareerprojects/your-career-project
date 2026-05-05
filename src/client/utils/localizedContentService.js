function normalizeCode(lang, fallback = 'en') {
  return String(lang || fallback).toLowerCase().split('-')[0] || fallback;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNestedLocalizedShape(field) {
  return isObject(field) && (
    isObject(field.translations) ||
    Object.prototype.hasOwnProperty.call(field, 'original') ||
    Object.prototype.hasOwnProperty.call(field, 'original_language')
  );
}

function hasAnyTranslationText(translations) {
  if (!translations || typeof translations !== 'object') return false;
  return Object.values(translations).some((v) => v != null && String(v).trim());
}

export function get(field, lang = 'en') {
  if (field == null) return null;
  if (typeof field === 'string') return field;
  if (typeof field !== 'object' || Array.isArray(field)) return null;

  const code = normalizeCode(lang, 'en');
  if (isNestedLocalizedShape(field)) {
    const translations = isObject(field.translations) ? field.translations : {};
    const slot = translations[code];
    if (slot != null && String(slot).trim()) return String(slot).trim();

    if (code !== 'en') {
      const enSlot = translations.en;
      if (enSlot != null && String(enSlot).trim()) return String(enSlot).trim();
    }

    const origLang = normalizeCode(field.original_language, 'en');
    const orig = field.original == null ? null : String(field.original).trim();
    if (orig && origLang === code) return orig;

    if (orig && !hasAnyTranslationText(translations)) return orig;

    return null;
  }
  return field[code] || field.en || null;
}

export function getLocalizedWithFallback(field, lang = 'en', missing = '[MISSING]') {
  const localized = get(field, lang);
  if (localized && String(localized).trim()) return String(localized).trim();

  const english = get(field, 'en');
  if (english && String(english).trim()) return String(english).trim();

  return missing;
}

export default {
  get,
  getLocalizedWithFallback,
};
