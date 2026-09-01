/**
 * Background narrative generation for profile dimensions / who_are_you deferred on CV review-save.
 */

const User = require('../../models/User');
const localizedContentService = require('../localization/localizedContentService');
const { cachedTranslate } = require('../ai/translationCache');
const { translateStructured } = require('../ai/translateStructured');
const { generateDimensionSummary, EMPTY_PLACEHOLDER } = require('../jobAnalysis/dimensionSummaryGenerator');
const {
  generateWhoAreYouNarratives,
  PLACEHOLDER: WHO_ARE_YOU_PLACEHOLDER,
} = require('../jobAnalysis/whoAreYouNarrativeGenerator');
const { generateWhoAreYouIdentityEmbeddingText, PLACEHOLDER: WHO_ARE_YOU_IDENTITY_PLACEHOLDER } = require('../jobAnalysis/whoAreYouIdentityEmbeddingTextGenerator');
const { filterIndustryDomainRawItems } = require('../../constants/industryDomainFilters');
const { getRawItems } = require('./profileReviewSaveService');
const { meetsWhoAreYouLineQuality, meetsDimensionSummaryQuality } = require('./narrativeQualityGate');
const {
  buildWhoAreYouRawAnswersFromIdentity,
  getEffectiveIdentityAnswersForNarratives,
  isWhoAreYouSummaryDisplayReadyForLanguage,
} = require('./profileNarrativeReadinessService');

function whoAreYouSummaryMissingLanguage(summaryField, lang, rawAnswers = []) {
  return !isWhoAreYouSummaryDisplayReadyForLanguage(summaryField, rawAnswers, lang);
}

function dimensionSummaryNeedsLanguage(summaryField, lang) {
  const existing = String(localizedContentService.get(summaryField, lang) || '').trim();
  if (!existing) return true;
  return existing === EMPTY_PLACEHOLDER;
}

const STRUCTURED_DIMENSIONS = [
  { key: 'skillDomains', label: 'Strengths' },
  { key: 'skills', label: 'Skills' },
  { key: 'skillsInDevelopment', label: 'Skills in Development' },
  { key: 'keyResponsibilities', label: 'Responsibilities' },
  { key: 'domains', label: 'Industry sectors' },
];

const SUPPORTED_NARRATIVE_LANGS = ['en', 'de'];

function normalizeLangCode(value, fallback = 'en') {
  const code = String(value || fallback).toLowerCase().split('-')[0] || fallback;
  return SUPPORTED_NARRATIVE_LANGS.includes(code) ? code : fallback;
}

function readDimensionSummaryText(value, language = 'en') {
  if (value && typeof value === 'object') {
    const summary = localizedContentService.get(value.summary_text, normalizeLangCode(language, 'en'));
    if (typeof summary === 'string') return summary.trim();
  }
  return '';
}

function isPlaceholderSummary(summaryText) {
  const s = String(summaryText || '').trim();
  return !s || s === EMPTY_PLACEHOLDER;
}

function unwrapDimensionSummaryGenerated(generated) {
  if (generated && typeof generated === 'object' && generated !== null && 'canonical' in generated) {
    return {
      summaryText: String(generated.canonical || '').trim() || EMPTY_PLACEHOLDER,
      canonicalLanguage: generated.canonicalLanguage,
      localized: generated.localized || {},
    };
  }
  if (typeof generated === 'string') {
    return {
      summaryText: String(generated).trim() || EMPTY_PLACEHOLDER,
      canonicalLanguage: undefined,
      localized: {},
    };
  }
  return { summaryText: EMPTY_PLACEHOLDER, canonicalLanguage: undefined, localized: {} };
}

function unwrapWhoAreYouGenerated(generated) {
  if (generated && typeof generated === 'object' && generated !== null && Array.isArray(generated.canonical)) {
    return {
      narratives: generated.canonical,
      canonicalLanguage: generated.canonicalLanguage,
      localized: generated.localized || {},
    };
  }
  if (Array.isArray(generated)) {
    return { narratives: generated, canonicalLanguage: undefined, localized: {} };
  }
  return { narratives: null, canonicalLanguage: undefined, localized: {} };
}

function readDimensionRawItems(value) {
  const raw = getRawItems(value);
  return raw.map((v) => String(v || '').trim()).filter(Boolean);
}

function hydrateLocalizedSummaryField(existingField, canonicalText, canonicalLanguage, localizedMap = {}) {
  const canonicalLang = normalizeLangCode(canonicalLanguage, 'en');
  let field = localizedContentService.ensureNested(existingField, canonicalLang);
  field.original_language = canonicalLang;
  field.original = canonicalText;
  field.translations = {
    ...(field.translations || {}),
    [canonicalLang]: canonicalText,
  };
  for (const lang of SUPPORTED_NARRATIVE_LANGS) {
    const localizedText = localizedMap?.[lang];
    if (typeof localizedText !== 'string' || !localizedText.trim()) continue;
    field.translations[lang] = localizedText.trim();
  }
  return field;
}

async function ensureBilingualSummaryField(existingField, canonicalText, canonicalLanguage, localizedMap = {}) {
  const canonicalLang = normalizeLangCode(canonicalLanguage, 'en');
  let field = hydrateLocalizedSummaryField(existingField, canonicalText, canonicalLang, localizedMap);
  for (const lang of SUPPORTED_NARRATIVE_LANGS) {
    if (lang === canonicalLang) continue;
    if (!dimensionSummaryNeedsLanguage(field, lang)) continue;
    try {
      const translated = await cachedTranslate(canonicalText, lang, () => translateStructured(canonicalText, lang));
      const safe = String(translated || '').trim();
      if (safe) {
        field = localizedContentService.set(field, lang, safe);
      }
    } catch (_) {
      // Keep canonical only if translation fails.
    }
  }
  return field;
}

async function ensureBilingualWhoAreYouSummaryField(
  existingField,
  canonicalSummaryText,
  canonicalLanguage,
  localizedMap = {},
  rawAnswers = []
) {
  const canonicalLang = normalizeLangCode(canonicalLanguage, 'en');
  const canonicalArray = parseWhoAreYouNarratives(canonicalSummaryText);
  let field = hydrateLocalizedSummaryField(existingField, canonicalSummaryText, canonicalLang, localizedMap);
  for (const lang of SUPPORTED_NARRATIVE_LANGS) {
    if (lang === canonicalLang) continue;
    if (isWhoAreYouSummaryDisplayReadyForLanguage(field, rawAnswers, lang)) continue;
    try {
      const translated = await cachedTranslate(canonicalArray, lang, () => translateStructured(canonicalArray, lang));
      if (Array.isArray(translated) && translated.length === 5) {
        const safeJson = JSON.stringify(
          translated.map((value) => String(value || '').trim() || WHO_ARE_YOU_PLACEHOLDER)
        );
        field = localizedContentService.set(field, lang, safeJson);
      }
    } catch (_) {
      // Keep canonical text only if translation fails.
    }
  }
  return field;
}

/**
 * Regenerate deferred dimension narratives on a loaded user document.
 *
 * @param {import('mongoose').Document} user
 * @param {string[]} dimensionKeys
 * @param {{ language?: string, sourceLanguage?: string }} [options]
 */
async function refreshDeferredDimensionNarrativesOnUser(user, dimensionKeys = [], options = {}) {
  if (!user?.profile || !Array.isArray(dimensionKeys) || dimensionKeys.length === 0) return;

  const targetLang = normalizeLangCode(options.language, 'en');
  const sourceLang = normalizeLangCode(options.sourceLanguage, 'en');
  const structured = user.profile.structuredUserInfo || {};

  for (const key of dimensionKeys) {
    const meta = STRUCTURED_DIMENSIONS.find((d) => d.key === key);
    if (!meta) continue;

    const dim = structured[key];
    let rawItems = readDimensionRawItems(dim);
    if (key === 'domains') {
      rawItems = filterIndustryDomainRawItems(rawItems);
    }
    if (rawItems.length === 0) continue;

    const existingSummary = readDimensionSummaryText(dim, sourceLang);
    if (existingSummary && meetsDimensionSummaryQuality(existingSummary, rawItems)) {
      const needsTranslation = SUPPORTED_NARRATIVE_LANGS.some(
        (lang) => dimensionSummaryNeedsLanguage(dim?.summary_text, lang)
      );
      if (needsTranslation) {
        const summaryField = await ensureBilingualSummaryField(
          dim?.summary_text,
          existingSummary,
          sourceLang,
          {}
        );
        if (!structured[key] || typeof structured[key] !== 'object') {
          structured[key] = { raw_items: rawItems };
        }
        structured[key].raw_items = rawItems;
        structured[key].summary_text = summaryField;
        user.markModified(`profile.structuredUserInfo.${key}`);
      }
      continue;
    }

    try {
      const generated = await generateDimensionSummary(
        { dimension: meta.label, rawItems },
        { lang: targetLang, sourceLang, returnBundle: true }
      );
      const {
        summaryText,
        canonicalLanguage,
        localized,
      } = unwrapDimensionSummaryGenerated(generated);
      const canonicalLang = normalizeLangCode(canonicalLanguage || sourceLang, sourceLang);
      const summaryField = await ensureBilingualSummaryField(
        dim?.summary_text,
        summaryText,
        canonicalLang,
        localized
      );
      if (!structured[key] || typeof structured[key] !== 'object') {
        structured[key] = { raw_items: rawItems };
      }
      structured[key].raw_items = rawItems;
      structured[key].summary_text = summaryField;
      user.markModified(`profile.structuredUserInfo.${key}`);
    } catch (err) {
      console.warn(`[deferredProfileNarrative] dimension ${key} failed:`, err?.message || err);
    }
  }
}

function parseWhoAreYouNarratives(summaryText = '') {
  const fallback = Array(5).fill(WHO_ARE_YOU_PLACEHOLDER);
  const raw = String(summaryText || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 5) return fallback;
    return parsed.map((value) => String(value || '').trim() || WHO_ARE_YOU_PLACEHOLDER);
  } catch (_) {
    return fallback;
  }
}

/**
 * @param {import('mongoose').Document} user
 * @param {{ language?: string, sourceLanguage?: string }} [options]
 */
async function refreshDeferredWhoAreYouOnUser(user, options = {}) {
  if (!user?.profile) return;

  const targetLang = normalizeLangCode(options.language, 'en');
  const sourceLang = normalizeLangCode(options.sourceLanguage, 'en');
  const who = { ...(user.profile.who_are_you || {}) };
  let rawAnswers = Array.isArray(who.raw_answers)
    ? who.raw_answers.map((v) => String(v || '').trim())
    : [];
  if (!rawAnswers.some(Boolean)) {
    rawAnswers = buildWhoAreYouRawAnswersFromIdentity(
      getEffectiveIdentityAnswersForNarratives(user.profile || {}, sourceLang)
    );
  }
  if (!rawAnswers.some(Boolean)) return;
  who.raw_answers = rawAnswers;

  const summaryRaw = String(localizedContentService.get(who.summary_text, sourceLang) || '').trim();
  const parsed = parseWhoAreYouNarratives(summaryRaw);
  const indicesNeedingRegen = [];
  for (let idx = 0; idx < 5; idx += 1) {
    if (!String(rawAnswers[idx] || '').trim()) continue;
    if (!meetsWhoAreYouLineQuality(parsed[idx], rawAnswers[idx])) {
      indicesNeedingRegen.push(idx);
    }
  }
  const needsNarratives = indicesNeedingRegen.length > 0;
  const needsIdentity = !String(who.identity_embedding_text || '').trim()
    || who.identity_embedding_text === WHO_ARE_YOU_IDENTITY_PLACEHOLDER;
  const needsTranslation = SUPPORTED_NARRATIVE_LANGS.some(
    (lang) => whoAreYouSummaryMissingLanguage(who.summary_text, lang, rawAnswers)
  );

  if (!needsNarratives && !needsIdentity) {
    if (needsTranslation && summaryRaw) {
      try {
        who.summary_text = await ensureBilingualWhoAreYouSummaryField(
          who.summary_text,
          summaryRaw,
          sourceLang,
          {},
          rawAnswers
        );
        user.profile.who_are_you = who;
        user.markModified('profile.who_are_you');
      } catch (err) {
        console.warn('[deferredProfileNarrative] who_are_you translation failed:', err?.message || err);
      }
    }
    return;
  }

  try {
    if (needsNarratives) {
      const generated = await generateWhoAreYouNarratives(rawAnswers, {
        lang: targetLang,
        sourceLang,
        returnBundle: true,
      });
      const {
        narratives,
        canonicalLanguage,
        localized,
      } = unwrapWhoAreYouGenerated(generated);
      const generatedCanonical = Array.isArray(narratives) && narratives.length === 5
        ? narratives.map((value) => String(value || '').trim() || WHO_ARE_YOU_PLACEHOLDER)
        : Array(5).fill(WHO_ARE_YOU_PLACEHOLDER);

      // Only replace slots that actually need regeneration; keep other sub-section summaries.
      const mergedCanonical = parseWhoAreYouNarratives(summaryRaw);
      while (mergedCanonical.length < 5) mergedCanonical.push(WHO_ARE_YOU_PLACEHOLDER);
      for (const idx of indicesNeedingRegen) {
        mergedCanonical[idx] = generatedCanonical[idx];
      }
      const summaryJson = JSON.stringify(mergedCanonical);

      const localizedMap = {};
      for (const [lang, arr] of Object.entries(localized || {})) {
        if (!Array.isArray(arr) || arr.length !== 5) continue;
        const existingLangRaw = String(localizedContentService.get(who.summary_text, lang) || '').trim();
        const mergedLocalized = existingLangRaw
          ? parseWhoAreYouNarratives(existingLangRaw)
          : [...mergedCanonical];
        while (mergedLocalized.length < 5) mergedLocalized.push(WHO_ARE_YOU_PLACEHOLDER);
        for (const idx of indicesNeedingRegen) {
          mergedLocalized[idx] = String(arr[idx] || '').trim() || WHO_ARE_YOU_PLACEHOLDER;
        }
        localizedMap[lang] = JSON.stringify(mergedLocalized);
      }

      const canonicalLang = normalizeLangCode(canonicalLanguage || sourceLang, sourceLang);
      who.summary_text = await ensureBilingualWhoAreYouSummaryField(
        who.summary_text,
        summaryJson,
        canonicalLang,
        localizedMap,
        rawAnswers
      );
    }
    if (needsIdentity) {
      who.identity_embedding_text = await generateWhoAreYouIdentityEmbeddingText(rawAnswers);
    }
    user.profile.who_are_you = who;
    user.markModified('profile.who_are_you');
  } catch (err) {
    console.warn('[deferredProfileNarrative] who_are_you failed:', err?.message || err);
  }
}

/**
 * @param {string} userId
 * @param {{ dimensionKeys?: string[], deferWhoAreYou?: boolean, language?: string, sourceLanguage?: string }} [options]
 */
const deferredNarrativeInflightByUserId = new Map();
const DEFERRED_NARRATIVE_INFLIGHT_MAX_MS = 5 * 60 * 1000;

function scheduleDeferredProfileNarrativesForUser(userId, options = {}) {
  if (!userId) return;
  const dimensionKeys = Array.isArray(options.dimensionKeys) ? options.dimensionKeys : [];
  const deferWhoAreYou = Boolean(options.deferWhoAreYou);
  if (dimensionKeys.length === 0 && !deferWhoAreYou) return;

  const inflightKey = String(userId);
  const inflight = deferredNarrativeInflightByUserId.get(inflightKey);
  if (inflight?.startedAt && Date.now() - inflight.startedAt < DEFERRED_NARRATIVE_INFLIGHT_MAX_MS) {
    return;
  }

  const job = (async () => {
    try {
      const user = await User.findById(userId);
      if (!user) return;
      if (dimensionKeys.length > 0) {
        await refreshDeferredDimensionNarrativesOnUser(user, dimensionKeys, options);
      }
      if (deferWhoAreYou) {
        await refreshDeferredWhoAreYouOnUser(user, options);
      }
      await user.save();
      const { evictProfileResponseCacheForUser } = require('../profileGetResponseCache');
      evictProfileResponseCacheForUser(userId);
      const { scheduleRefreshUserIdentityEmbeddingForUser } = require('../embedding/userIdentityEmbeddingTextService');
      scheduleRefreshUserIdentityEmbeddingForUser(userId);
    } catch (e) {
      console.warn('scheduleDeferredProfileNarrativesForUser failed (non-fatal):', e?.message || e);
    } finally {
      deferredNarrativeInflightByUserId.delete(inflightKey);
    }
  })();

  deferredNarrativeInflightByUserId.set(inflightKey, { startedAt: Date.now(), job });
  void job;
}

module.exports = {
  scheduleDeferredProfileNarrativesForUser,
  refreshDeferredDimensionNarrativesOnUser,
  refreshDeferredWhoAreYouOnUser,
  isPlaceholderSummary,
};
