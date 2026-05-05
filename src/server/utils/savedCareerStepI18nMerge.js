const CareerPath = require('../models/CareerPath');
const { MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH } = require('../../constants/savedCareerStepLimits');
const { normalizeLanguage } = require('./languageResolution');

/**
 * @param {unknown} o
 * @param {string} k
 * @param {number} max
 * @returns {string}
 */
function pickStr(o, k, max) {
  if (!o || typeof o !== 'object') return '';
  if (!Object.prototype.hasOwnProperty.call(o, k)) return '';
  const v = o[k];
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

/**
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
function trimTo(s, max) {
  if (s == null) return '';
  return String(s).trim().slice(0, max);
}

/**
 * @param {unknown} escoId
 * @param {unknown} careerPathId
 * @returns {Promise<object|null>}
 */
async function findCareerPathForEnrichment(escoId, careerPathId) {
  if (careerPathId) {
    const byId = await CareerPath.findById(careerPathId).lean().select('title description');
    if (byId) return byId;
  }
  if (escoId) {
    const e = String(escoId).trim();
    let doc = await CareerPath.findOne({ escoId: e }).lean().select('title description');
    if (doc) return doc;
    doc = await CareerPath.findOne({ mergedFromEscoIds: e }).lean().select('title description');
    if (doc) return doc;
  }
  return null;
}

/**
 * After normalizeSavedStepI18n, fill both locales from canonical CareerPath when available,
 * then overlay the exact strings the user saw in the current UI language.
 * This allows GET ?lang=de vs ?lang=en to return the correct string from stored { en, de }.
 *
 * @param {object} newStep – in/out (title, description are plain { en, de? })
 * @param {{ rawTitle: unknown, rawDescription: unknown, sourceLanguage: string }} opts
 * @returns {Promise<void>}
 */
async function applyCareerPathAndUserLocaleToSavedStep(newStep, { rawTitle, rawDescription, sourceLanguage = 'en' }) {
  if (!newStep || typeof newStep !== 'object') return;
  const ui = normalizeLanguage(sourceLanguage, 'en');
  const isDe = ui === 'de';
  const cp = await findCareerPathForEnrichment(newStep.escoId, newStep.careerPathId);

  let tEn = pickStr(newStep.title, 'en', 200);
  let tDe = newStep.title && Object.prototype.hasOwnProperty.call(newStep.title, 'de') && newStep.title.de != null
    ? (String(newStep.title.de).trim() === '' ? null : String(newStep.title.de).trim().slice(0, 200))
    : null;

  if (cp && cp.title && typeof cp.title === 'object') {
    const cpEn = pickStr(cp.title, 'en', 200);
    if (cpEn) tEn = cpEn;
    if (cp.title.de != null && String(cp.title.de).trim() !== '') {
      tDe = String(cp.title.de).trim().slice(0, 200);
    }
  }

  if (rawTitle != null) {
    if (typeof rawTitle === 'string' && rawTitle.trim()) {
      if (isDe) tDe = trimTo(rawTitle, 200);
      else tEn = trimTo(rawTitle, 200);
    } else if (rawTitle && typeof rawTitle === 'object' && !Array.isArray(rawTitle)) {
      if (rawTitle.en != null && String(rawTitle.en).trim() !== '') tEn = pickStr(rawTitle, 'en', 200) || tEn;
      if (Object.prototype.hasOwnProperty.call(rawTitle, 'de')) {
        tDe = rawTitle.de == null || String(rawTitle.de).trim() === '' ? null : pickStr(rawTitle, 'de', 200);
      }
    }
  }
  if (!tEn && tDe) tEn = tDe;
  if (!tEn) tEn = tDe || 'Career step';
  newStep.title = { en: tEn, de: tDe };

  let dEn = pickStr(newStep.description, 'en', MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH);
  let dDe = newStep.description && Object.prototype.hasOwnProperty.call(newStep.description, 'de') && newStep.description.de != null
    ? (String(newStep.description.de).trim() === '' ? null : String(newStep.description.de).trim().slice(0, MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH))
    : null;

  if (cp && cp.description && typeof cp.description === 'object') {
    const cpDEn = pickStr(cp.description, 'en', MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH);
    if (cpDEn) dEn = cpDEn;
    if (cp.description.de != null && String(cp.description.de).trim() !== '') {
      dDe = String(cp.description.de).trim().slice(0, MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH);
    }
  }

  if (rawDescription != null) {
    if (typeof rawDescription === 'string' && rawDescription.trim()) {
      if (isDe) dDe = rawDescription.slice(0, MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH);
      else dEn = rawDescription.slice(0, MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH);
    } else if (rawDescription && typeof rawDescription === 'object' && !Array.isArray(rawDescription)) {
      if (Object.prototype.hasOwnProperty.call(rawDescription, 'en') && String(rawDescription.en).trim() !== '') {
        dEn = String(rawDescription.en).slice(0, MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH);
      }
      if (Object.prototype.hasOwnProperty.call(rawDescription, 'de')) {
        dDe = rawDescription.de == null || rawDescription.de === '' ? null : String(rawDescription.de).slice(0, MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH);
      }
    }
  }
  if (!dEn && dDe) dEn = dDe;
  newStep.description = { en: dEn, de: dDe };
}

module.exports = { applyCareerPathAndUserLocaleToSavedStep };
