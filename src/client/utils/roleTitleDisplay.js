/**
 * Display string for a role/occupation title from API payloads.
 * The server usually returns a single-language string, but some paths still return { en, de }.
 * @param {unknown} title
 * @param {string} [language] – e.g. en, de (base code from i18n)
 * @returns {string}
 */
export function getRoleTitleForLocale(title, language = 'en') {
  if (title == null || title === '') return '';
  if (typeof title === 'string' || typeof title === 'number') return String(title);
  if (typeof title === 'object' && !Array.isArray(title)) {
    const nonEmpty = (v) => {
      if (v == null) return '';
      const s = typeof v === 'string' ? v : String(v);
      return s.trim() === '' ? '' : s.trim();
    };
    const code = (language && String(language).toLowerCase().split('-')[0]) || 'en';
    if (Object.prototype.hasOwnProperty.call(title, code)) {
      const t = nonEmpty(title[code]);
      if (t) return t;
    }
    for (const k of ['en', 'de', 'fr', 'it', 'es']) {
      if (k === code) continue;
      if (Object.prototype.hasOwnProperty.call(title, k)) {
        const t = nonEmpty(title[k]);
        if (t) return t;
      }
    }
    for (const v of Object.values(title)) {
      const t = nonEmpty(v);
      if (t) return t;
    }
    return '';
  }
  return String(title);
}

/**
 * English-normalized string for matching saved steps / evaluation keys (language-agnostic keys).
 * @param {unknown} value – title or other embedded i18n
 * @returns {string}
 */
export function getRoleTitleEnglishForMatch(value) {
  return getRoleTitleForLocale(value, 'en');
}

/**
 * @param {unknown} str
 * @returns {string}
 */
export function normalizeTextForI18nMatch(str) {
  return getRoleTitleEnglishForMatch(str).toLowerCase().trim().replace(/\s+/g, ' ');
}
