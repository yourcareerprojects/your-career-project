/**
 * Coerce request body for saved career steps into strict embedded i18n.
 * Accepts legacy plain strings; slot chosen by `sourceLanguage` (UI when saving) so
 * German UI text is not always stored in `en` (fixes language switching on read).
 */

const { MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH } = require('../../constants/savedCareerStepLimits');

function normalizeSavedStepI18n(title, description, { sourceLanguage = 'en' } = {}) {
  const code = String(sourceLanguage || 'en').toLowerCase().split('-')[0] || 'en';
  const isDe = code === 'de';

  let t;
  if (
    title &&
    typeof title === 'object' &&
    !Array.isArray(title) &&
    ((title.en != null && String(title.en).trim() !== '') || (title.de != null && String(title.de).trim() !== ''))
  ) {
    t = {
      en: title.en == null || String(title.en).trim() === '' ? '' : String(title.en).trim().slice(0, 200),
      de: title.de == null || title.de === '' || String(title.de).trim() === '' ? null : String(title.de).trim().slice(0, 200),
    };
    if (!t.en && t.de) {
      t = { en: t.de, de: t.de };
    }
  } else if (typeof title === 'string' && title.trim() !== '') {
    const s = title.trim().slice(0, 200);
    if (isDe) {
      t = { en: s, de: s };
    } else {
      t = { en: s, de: null };
    }
  } else {
    throw new Error('title must be a non-empty string or { en, de? }');
  }

  let d;
  if (description == null || description === '') {
    d = { en: '', de: null };
  } else if (typeof description === 'string') {
    const s = String(description).slice(0, MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH);
    d = isDe ? { en: s, de: s } : { en: s, de: null };
  } else if (typeof description === 'object' && (description.en != null || description.de != null)) {
    d = {
      en: description.en == null ? '' : String(description.en).slice(0, MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH),
      de:
        description.de == null || description.de === ''
          ? null
          : String(description.de).slice(0, MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH),
    };
  } else {
    d = { en: '', de: null };
  }

  return { title: t, description: d };
}

module.exports = { normalizeSavedStepI18n };
