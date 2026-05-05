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

function ensure(field) {
  if (!field || typeof field === 'string') {
    return { en: field || null, de: null };
  }

  if (isNestedLocalizedShape(field)) {
    const normalizedOriginalLang = normalizeCode(field.original_language || 'en', 'en');
    const safeTranslations = isObject(field.translations) ? field.translations : {};
    const normalizedTranslations = {};
    for (const [lang, value] of Object.entries(safeTranslations)) {
      if (value == null) continue;
      normalizedTranslations[normalizeCode(lang)] = String(value);
    }
    return {
      original_language: normalizedOriginalLang,
      original: field.original == null ? null : String(field.original),
      translations: normalizedTranslations,
    };
  }

  return {
    en: field.en || null,
    de: field.de || null,
  };
}

function ensureNested(field, fallbackOriginalLanguage = 'en') {
  const fallbackLang = normalizeCode(fallbackOriginalLanguage, 'en');
  if (!field || typeof field === 'string') {
    const text = String(field || '').trim();
    return {
      original_language: fallbackLang,
      original: text || null,
      translations: text ? { [fallbackLang]: text } : {},
    };
  }

  const safe = ensure(field);
  if (isNestedLocalizedShape(safe)) {
    const originalLang = normalizeCode(safe.original_language || fallbackLang, fallbackLang);
    const original = safe.original == null ? null : String(safe.original);
    const translations = isObject(safe.translations) ? { ...safe.translations } : {};
    if (original && !translations[originalLang]) {
      translations[originalLang] = original;
    }
    return {
      original_language: originalLang,
      original: original || translations[originalLang] || null,
      translations,
    };
  }

  const en = safe.en == null ? '' : String(safe.en).trim();
  const de = safe.de == null ? '' : String(safe.de).trim();
  const translations = {};
  if (en) translations.en = en;
  if (de) translations.de = de;
  const original = translations[fallbackLang] || en || de || null;
  return {
    original_language: fallbackLang,
    original,
    translations,
  };
}

function hasAnyTranslationText(translations) {
  if (!translations || typeof translations !== 'object') return false;
  return Object.values(translations).some((v) => v != null && String(v).trim());
}

function get(field, lang = 'en') {
  if (!field) return null;
  if (typeof field === 'string') return field;

  const code = normalizeCode(lang, 'en');
  const safe = ensure(field);
  if (isNestedLocalizedShape(safe)) {
    const translations = safe.translations || {};
    const slot = translations[code];
    if (slot != null && String(slot).trim()) return String(slot).trim();

    if (code !== 'en') {
      const enSlot = translations.en;
      if (enSlot != null && String(enSlot).trim()) return String(enSlot).trim();
    }

    const origLang = normalizeCode(safe.original_language, 'en');
    const orig = safe.original == null ? null : String(safe.original).trim();
    if (orig && origLang === code) return orig;

    // Legacy: only when there are no translation slots at all (empty map / all blank).
    if (orig && !hasAnyTranslationText(translations)) return orig;

    // Do not return `original` or another locale's translation when requesting `en` but only `de`
    // (etc.) is populated — that produced German copy on an English UI.
    return null;
  }
  return safe[code] || safe.en || null;
}

function set(field, lang, value) {
  const safeField = ensure(field);
  const code = normalizeCode(lang, 'en');
  const normalizedValue = value == null ? null : String(value);

  if (isNestedLocalizedShape(safeField)) {
    const out = {
      ...safeField,
      translations: {
        ...(safeField.translations || {}),
      },
    };
    out.translations[code] = normalizedValue;
    if (normalizeCode(out.original_language || 'en', 'en') === code) {
      out.original = normalizedValue;
    }
    return out;
  }

  return {
    ...safeField,
    [code]: normalizedValue,
  };
}

function normalizeForResponse(field, lang = 'en') {
  return get(field, lang);
}

module.exports = {
  get,
  set,
  ensure,
  ensureNested,
  normalizeForResponse,
};
