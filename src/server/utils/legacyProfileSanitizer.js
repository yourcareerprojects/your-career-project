const mongoose = require('mongoose');
const User = require('../models/User');

const NARRATIVE_DIMENSIONS = [
  'skillDomains',
  'skills',
  'skillsInDevelopment',
  'keyResponsibilities',
  'domains',
];

function normalizeStringList(values = []) {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function extractRawItems(value) {
  if (Array.isArray(value)) {
    return normalizeStringList(
      value.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return item.name || item.description || item.value || '';
        }
        return '';
      })
    );
  }

  if (typeof value === 'string') {
    return normalizeStringList(value.split(','));
  }

  if (value && typeof value === 'object') {
    if (Array.isArray(value.raw_items)) {
      return normalizeStringList(value.raw_items);
    }
    if (Array.isArray(value.items)) {
      return normalizeStringList(value.items);
    }
  }

  return [];
}

function isNarrativeDimensionShape(value) {
  const hasLocalizedSummary =
    value &&
    typeof value === 'object' &&
    value.summary_text &&
    typeof value.summary_text === 'object' &&
    !Array.isArray(value.summary_text);
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray(value.raw_items) &&
      (typeof value.summary_text === 'string' || hasLocalizedSummary)
  );
}

function normalizeLocalizedSummary(summaryText) {
  if (summaryText && typeof summaryText === 'object' && !Array.isArray(summaryText)) {
    if (summaryText.translations || summaryText.original || summaryText.original_language) {
      const originalLanguage = String(summaryText.original_language || 'en').toLowerCase().split('-')[0] || 'en';
      const translations = summaryText.translations && typeof summaryText.translations === 'object'
        ? Object.fromEntries(
          Object.entries(summaryText.translations)
            .map(([lang, val]) => [String(lang).toLowerCase().split('-')[0], val == null ? '' : String(val).trim()])
            .filter(([, val]) => val)
        )
        : {};
      const original = summaryText.original == null ? '' : String(summaryText.original).trim();
      if (original && !translations[originalLanguage]) translations[originalLanguage] = original;
      return {
        original_language: originalLanguage,
        original: original || translations[originalLanguage] || null,
        translations,
      };
    }
    const en = summaryText.en == null ? '' : String(summaryText.en).trim();
    const de = summaryText.de == null ? '' : String(summaryText.de).trim();
    const translations = {};
    if (en) translations.en = en;
    if (de) translations.de = de;
    return {
      original_language: 'en',
      original: en || de || null,
      translations,
    };
  }
  const text = String(summaryText || '').trim();
  return {
    original_language: 'en',
    original: text || null,
    translations: text ? { en: text } : {},
  };
}

function toNarrativeDimension(value) {
  if (isNarrativeDimensionShape(value)) {
    return {
      raw_items: normalizeStringList(value.raw_items),
      summary_text: normalizeLocalizedSummary(value.summary_text),
    };
  }

  return {
    raw_items: extractRawItems(value),
    summary_text: { original_language: 'en', original: null, translations: {} },
  };
}

function hasLegacyNarrativeValidationError(error) {
  const message = String(error?.message || '');
  return (
    (
      message.includes('Tried to set nested object field') &&
      message.includes('structuredUserInfo')
    ) ||
    (
      message.includes('Cast to Embedded failed') &&
      message.includes('summary_text')
    )
  );
}

function toObjectId(id) {
  try {
    if (!id) return null;
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
    return null;
  } catch (_) {
    return null;
  }
}

async function sanitizeLegacyNarrativeProfileById(userId) {
  const objectId = toObjectId(userId);
  if (!objectId) return { sanitized: false, reason: 'invalid_user_id' };

  const rawUser = await User.collection.findOne({ _id: objectId });
  if (!rawUser) return { sanitized: false, reason: 'user_not_found' };

  const profile = rawUser.profile && typeof rawUser.profile === 'object' ? rawUser.profile : {};
  const profileStructured =
    profile.structuredUserInfo && typeof profile.structuredUserInfo === 'object'
      ? profile.structuredUserInfo
      : {};
  const csiStructured =
    profile.careerSimulationInputs &&
    typeof profile.careerSimulationInputs === 'object' &&
    profile.careerSimulationInputs.structuredUserInfo &&
    typeof profile.careerSimulationInputs.structuredUserInfo === 'object'
      ? profile.careerSimulationInputs.structuredUserInfo
      : {};

  const setPayload = {};

  for (const key of NARRATIVE_DIMENSIONS) {
    const profileValue = profileStructured[key];
    if (!isNarrativeDimensionShape(profileValue)) {
      setPayload[`profile.structuredUserInfo.${key}`] = toNarrativeDimension(profileValue);
    }

    const csiValue = csiStructured[key];
    if (!isNarrativeDimensionShape(csiValue)) {
      setPayload[`profile.careerSimulationInputs.structuredUserInfo.${key}`] =
        toNarrativeDimension(csiValue);
    }
  }

  if (Object.keys(setPayload).length === 0) {
    return { sanitized: false, reason: 'already_normalized' };
  }

  await User.updateOne({ _id: objectId }, { $set: setPayload });
  return { sanitized: true, reason: 'updated', fieldsUpdated: Object.keys(setPayload).length };
}

module.exports = {
  hasLegacyNarrativeValidationError,
  sanitizeLegacyNarrativeProfileById,
};
