/**
 * Maps batched unified narrative output to existing document enrichment / profile shapes.
 */

const localizedContentService = require('../localization/localizedContentService');
const { EMPTY_PLACEHOLDER } = require('../jobAnalysis/dimensionSummaryGenerator');
const {
  PLACEHOLDER: WHO_ARE_YOU_PLACEHOLDER,
} = require('../jobAnalysis/whoAreYouNarrativeGenerator');
const {
  PLACEHOLDER: WHO_ARE_YOU_IDENTITY_PLACEHOLDER,
} = require('../jobAnalysis/whoAreYouIdentityEmbeddingTextGenerator');
const { filterIndustryDomainRawItems } = require('../../constants/industryDomainFilters');
const { STRUCTURED_DIMENSION_SPECS } = require('../../prompts/generateUnifiedCvNarrative');

const SUPPORTED_NARRATIVE_LANGS = ['en', 'de'];

function normalizeLangCode(value, fallback = 'en') {
  const code = String(value || fallback).toLowerCase().split('-')[0] || fallback;
  return SUPPORTED_NARRATIVE_LANGS.includes(code) ? code : fallback;
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

/**
 * Build localized summary_text from bilingual pair (no extra translation calls).
 *
 * @param {{ de?: string, en?: string }} pair
 * @param {string} sourceLanguage
 */
function bilingualPairToSummaryField(pair = {}, sourceLanguage = 'en') {
  const sourceLang = normalizeLangCode(sourceLanguage, 'en');
  const de = String(pair.de || '').trim();
  const en = String(pair.en || '').trim();
  const canonical = sourceLang === 'de' ? (de || en) : (en || de);
  const canonicalLang = de && !en ? 'de' : en && !de ? 'en' : sourceLang;
  const localizedMap = {};
  if (de) localizedMap.de = de;
  if (en) localizedMap.en = en;
  return hydrateLocalizedSummaryField(null, canonical || EMPTY_PLACEHOLDER, canonicalLang, localizedMap);
}

/**
 * @param {{ de?: string[], en?: string[], answers?: { de?: string[], en?: string[] } }} whoRoot
 * @param {string} sourceLanguage
 */
function whoAnswersToSummaryField(whoRoot = {}, sourceLanguage = 'en') {
  const whoAnswers = whoRoot?.answers && typeof whoRoot.answers === 'object'
    ? whoRoot.answers
    : whoRoot;
  const sourceLang = normalizeLangCode(sourceLanguage, 'en');
  const de = Array.isArray(whoAnswers.de) ? whoAnswers.de : [];
  const en = Array.isArray(whoAnswers.en) ? whoAnswers.en : [];
  const pick = (arr) => JSON.stringify(
    [0, 1, 2, 3, 4].map((i) => String(arr[i] || '').trim() || WHO_ARE_YOU_PLACEHOLDER)
  );
  const deJson = pick(de);
  const enJson = pick(en);
  const canonical = sourceLang === 'de' ? deJson : enJson;
  const canonicalLang = de.length && !en.length ? 'de' : en.length && !de.length ? 'en' : sourceLang;
  const localizedMap = {};
  if (de.length) localizedMap.de = deJson;
  if (en.length) localizedMap.en = enJson;
  return hydrateLocalizedSummaryField(null, canonical, canonicalLang, localizedMap);
}

/**
 * @param {{
 *   dimensions: Record<string, { de?: string, en?: string }>,
 *   whoAreYou: { de?: string[], en?: string[] },
 *   embeddingText?: string,
 * }} unified
 * @param {{
 *   lists: Record<string, string[]>,
 *   rawAnswers: string[],
 *   language?: string,
 *   sourceLanguage?: string,
 *   onlyDimensionKeys?: string[]|null,
 *   includeWhoAreYou?: boolean,
 *   deferIdentityEmbedding?: boolean,
 * }} context
 */
function mapUnifiedNarrativeToEnrichmentParts(unified, context = {}) {
  const sourceLanguage = normalizeLangCode(context.sourceLanguage || context.language, 'en');
  const onlyKeys = Array.isArray(context.onlyDimensionKeys) && context.onlyDimensionKeys.length > 0
    ? new Set(context.onlyDimensionKeys)
    : null;
  const lists = context.lists || {};
  const structuredUserInfo = {};

  for (const { key } of STRUCTURED_DIMENSION_SPECS) {
    if (onlyKeys && !onlyKeys.has(key)) continue;
    let rawItems = Array.isArray(lists[key]) ? lists[key].map((v) => String(v || '').trim()).filter(Boolean) : [];
    if (key === 'domains') rawItems = filterIndustryDomainRawItems(rawItems);
    const pair = unified.dimensions?.[key] || {};
    structuredUserInfo[key] = {
      raw_items: rawItems,
      summary_text: bilingualPairToSummaryField(pair, sourceLanguage),
    };
  }

  let who_are_you;
  if (context.includeWhoAreYou === false) {
    who_are_you = undefined;
  } else {
    const raw_answers = Array.isArray(context.rawAnswers)
      ? context.rawAnswers.map((v) => String(v || '').trim())
      : [];
    const whoAnswers = unified.whoAreYou || { answers: { de: [], en: [] } };
    const embeddingText = String(unified.embeddingText || '').trim();
    who_are_you = {
      raw_answers,
      summary_text: whoAnswersToSummaryField(whoAnswers, sourceLanguage),
      ...(context.deferIdentityEmbedding
        ? {}
        : {
            identity_embedding_text: embeddingText || WHO_ARE_YOU_IDENTITY_PLACEHOLDER,
          }),
    };
  }

  return { structuredUserInfo, who_are_you };
}

module.exports = {
  mapUnifiedNarrativeToEnrichmentParts,
  bilingualPairToSummaryField,
  whoAnswersToSummaryField,
};
