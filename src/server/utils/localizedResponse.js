/**
 * Map embedded i18n on career-path-shaped API payloads to a single-language string view.
 * Does not read any translation collection.
 */

const { getLocalizedFieldLenient } = require('./i18nFields');
const { DEFAULT_LANGUAGE, normalizeLanguage } = require('./languageResolution');
const { mergeResponsibilityTranslations } = require('../../client/utils/mergeResponsibilityTranslations');

/**
 * @param {object} obj — Career path, simulation step, or similar
 * @param {string} [language]
 * @param {{ includeSkillDomains?: boolean }} [options] — set false when skill domain strings are built elsewhere (e.g. buildLocalizedSkillsResponse)
 * @returns {object} shallow clone with title, description, and optionally skillDomains localized
 */
function applyLocalizedFieldsToCareerPathPayload(
  obj,
  language = DEFAULT_LANGUAGE,
  { includeSkillDomains = true } = {},
) {
  if (!obj || typeof obj !== 'object') return obj;
  const lang = normalizeLanguage(language);
  const out = { ...obj };
  if (out.title !== undefined) out.title = getLocalizedFieldLenient(out.title, lang);
  if (out.description !== undefined) out.description = getLocalizedFieldLenient(out.description, lang);
  if (Array.isArray(out.altTitles) || Array.isArray(out.altTitlesDe)) {
    out.altTitles = lang === 'de'
      ? (Array.isArray(out.altTitlesDe) && out.altTitlesDe.length > 0 ? out.altTitlesDe : (out.altTitles || []))
      : (out.altTitles || []);
  }
  if (Array.isArray(out.hiddenTitles) || Array.isArray(out.hiddenTitlesDe)) {
    out.hiddenTitles = lang === 'de'
      ? (Array.isArray(out.hiddenTitlesDe) && out.hiddenTitlesDe.length > 0 ? out.hiddenTitlesDe : (out.hiddenTitles || []))
      : (out.hiddenTitles || []);
  }
  if (includeSkillDomains && out.skillDomains?.skill_domains) {
    out.skillDomains = {
      ...out.skillDomains,
      skill_domains: out.skillDomains.skill_domains.map((sd) => ({
        ...sd,
        domain: getLocalizedFieldLenient(sd.domain, lang),
      })),
    };
  }
  // Key responsibilities: English on keyResponsibilities.responsibilities; DE on keyResponsibilitiesDe (may be partial vs EN)
  if (out.keyResponsibilities && typeof out.keyResponsibilities === 'object') {
    const enList = Array.isArray(out.keyResponsibilities.responsibilities)
      ? out.keyResponsibilities.responsibilities
      : [];
    const deTop = Array.isArray(out.keyResponsibilitiesDe) ? out.keyResponsibilitiesDe : [];
    const deNested = Array.isArray(out.keyResponsibilities.responsibilitiesDe)
      ? out.keyResponsibilities.responsibilitiesDe
      : [];
    const deList = deTop.length > 0 ? deTop : deNested;
    if (lang === 'de' && deList.length > 0) {
      const merged = mergeResponsibilityTranslations(enList, deList);
      if (merged.length > 0) {
        out.keyResponsibilities = {
          ...out.keyResponsibilities,
          responsibilities: merged,
        };
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(out, 'keyResponsibilitiesDe')) {
    delete out.keyResponsibilitiesDe;
  }
  return out;
}

/**
 * @param {Array} careerPaths
 * @param {string} language
 */
function applyLocalizedFieldsToCareerPathList(careerPaths = [], language = DEFAULT_LANGUAGE) {
  if (!Array.isArray(careerPaths) || careerPaths.length === 0) return careerPaths;
  const lang = normalizeLanguage(language);
  return careerPaths.map((cp) => applyLocalizedFieldsToCareerPathPayload(cp, lang));
}

module.exports = {
  applyLocalizedFieldsToCareerPathPayload,
  applyLocalizedFieldsToCareerPathList,
};
