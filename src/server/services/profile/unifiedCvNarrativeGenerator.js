/**
 * Single-call bilingual CV narrative generation (dimensions + who-are-you + embedding text).
 */

const {
  buildMessages,
  STRUCTURED_DIMENSION_SPECS,
  EMPTY_DIMENSION_PLACEHOLDER,
  EMPTY_WHO_PLACEHOLDER,
} = require('../../prompts/generateUnifiedCvNarrative');
const { openaiProvider } = require('../jobAnalysis/roleIdentityComposer');
const { normalizeForEmbedding } = require('../ai/normalizeForEmbedding');
const { buildDeterministicFallback } = require('../jobAnalysis/dimensionSummaryGenerator');
const { normalizeAnswers } = require('../../prompts/generateWhoAreYouNarratives');
const { generateDeterministicFallback: whoDeterministicFallback } = require('../jobAnalysis/whoAreYouNarrativeGenerator');
const { generateDeterministicFallback: embeddingDeterministicFallback } = require('../jobAnalysis/whoAreYouIdentityEmbeddingTextGenerator');
const { filterIndustryDomainRawItems } = require('../../constants/industryDomainFilters');
const {
  USER_IDENTITY_ANSWER_KEYS,
  normalizeUserIdentityAnswers,
} = require('../embedding/userIdentityEmbeddingTextService');
const { buildStructuredBaselineFromExtraction } = require('./profileReviewSaveService');

const STRUCTURED_DIMENSION_KEYS = STRUCTURED_DIMENSION_SPECS.map((d) => d.key);

function buildWhoAreYouRawAnswersFromIdentity(identityAnswers = {}) {
  const normalized = normalizeUserIdentityAnswers(identityAnswers || {});
  return USER_IDENTITY_ANSWER_KEYS.map((key) => String(normalized[key] || '').trim());
}

function parseUnifiedNarrativeJson(raw) {
  let cleaned = String(raw || '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object') throw new Error('Unified narrative response is not an object');
  return parsed;
}

function readBilingualPair(dimensionsRoot, key) {
  const node = dimensionsRoot?.[key];
  if (!node || typeof node !== 'object') return { de: '', en: '' };
  return {
    de: String(node.de || '').trim(),
    en: String(node.en || '').trim(),
  };
}

function readWhoAnswers(whoRoot) {
  const answers = whoRoot?.answers;
  if (!answers || typeof answers !== 'object') {
    return { de: Array(5).fill(EMPTY_WHO_PLACEHOLDER), en: Array(5).fill(EMPTY_WHO_PLACEHOLDER) };
  }
  const normalizeLang = (lang) => {
    const arr = Array.isArray(answers[lang]) ? answers[lang] : [];
    return [0, 1, 2, 3, 4].map((i) => String(arr[i] || '').trim() || EMPTY_WHO_PLACEHOLDER);
  };
  return { de: normalizeLang('de'), en: normalizeLang('en') };
}

function buildDimensionInputs(lists = {}, onlyDimensionKeys = null) {
  const keys = Array.isArray(onlyDimensionKeys)
    ? onlyDimensionKeys.filter((k) => STRUCTURED_DIMENSION_KEYS.includes(k))
    : STRUCTURED_DIMENSION_KEYS;
  const dimensionInputs = {};
  const promptDimensions = {};

  for (const { key, label } of STRUCTURED_DIMENSION_SPECS) {
    if (!keys.includes(key)) continue;
    let rawItems = Array.isArray(lists[key]) ? lists[key].map((v) => String(v || '').trim()).filter(Boolean) : [];
    if (key === 'domains') rawItems = filterIndustryDomainRawItems(rawItems);
    dimensionInputs[key] = { label, rawItems };
    promptDimensions[key] = { label, raw_items: rawItems };
  }

  return { dimensionInputs, promptDimensions };
}

async function resolveEmbeddingText(parsedText, rawAnswers, includeEmbedding) {
  if (!includeEmbedding) return '';
  const answers = normalizeAnswers(rawAnswers);
  if (!answers.some(Boolean)) return '';
  const raw = String(parsedText || '').trim();
  if (raw) {
    try {
      const normalized = await normalizeForEmbedding(raw);
      return normalized.trim() || '';
    } catch (_) {
      return raw.slice(0, 650);
    }
  }
  return embeddingDeterministicFallback(answers);
}

async function normalizeUnifiedPayload(parsed, context) {
  const dimensions = {};
  for (const { key } of STRUCTURED_DIMENSION_SPECS) {
    if (!context.dimensionInputs[key]) continue;
    const rawItems = context.dimensionInputs[key].rawItems || [];
    const pair = readBilingualPair(parsed.dimensions, key);
    if (rawItems.length === 0) {
      dimensions[key] = { de: EMPTY_DIMENSION_PLACEHOLDER, en: EMPTY_DIMENSION_PLACEHOLDER };
    } else {
      const fallback = buildDeterministicFallback(rawItems);
      dimensions[key] = { de: pair.de || fallback, en: pair.en || fallback };
    }
  }

  const rawAnswers = normalizeAnswers(context.rawAnswers);
  let whoAreYou = {
    de: Array(5).fill(EMPTY_WHO_PLACEHOLDER),
    en: Array(5).fill(EMPTY_WHO_PLACEHOLDER),
  };
  if (context.includeWhoAreYou) {
    if (!rawAnswers.some(Boolean)) {
      whoAreYou = {
        de: Array(5).fill(EMPTY_WHO_PLACEHOLDER),
        en: Array(5).fill(EMPTY_WHO_PLACEHOLDER),
      };
    } else {
      const whoParsed = readWhoAnswers(parsed.whoAreYou);
      const det = whoDeterministicFallback(rawAnswers);
      whoAreYou = {
        de: whoParsed.de.some((v) => v && v !== EMPTY_WHO_PLACEHOLDER) ? whoParsed.de : det,
        en: whoParsed.en.some((v) => v && v !== EMPTY_WHO_PLACEHOLDER) ? whoParsed.en : det,
      };
    }
  }

  const embeddingText = await resolveEmbeddingText(
    parsed.embeddingText,
    rawAnswers,
    context.includeEmbedding
  );

  return { dimensions, whoAreYou, embeddingText };
}

function buildDeterministicUnifiedPayload(dimensionInputs, rawAnswers, { includeWhoAreYou, includeEmbedding }) {
  const dimensions = {};
  for (const [key, meta] of Object.entries(dimensionInputs)) {
    const rawItems = meta.rawItems || [];
    if (rawItems.length === 0) {
      dimensions[key] = { de: EMPTY_DIMENSION_PLACEHOLDER, en: EMPTY_DIMENSION_PLACEHOLDER };
    } else {
      const text = buildDeterministicFallback(rawItems);
      dimensions[key] = { de: text, en: text };
    }
  }
  const answers = normalizeAnswers(rawAnswers);
  let whoAreYou = {
    de: Array(5).fill(EMPTY_WHO_PLACEHOLDER),
    en: Array(5).fill(EMPTY_WHO_PLACEHOLDER),
  };
  if (includeWhoAreYou && answers.some(Boolean)) {
    const det = whoDeterministicFallback(answers);
    whoAreYou = { de: det, en: det };
  }
  return {
    dimensions,
    whoAreYou,
    embeddingText: '',
    _needsEmbeddingFallback: includeEmbedding && answers.some(Boolean),
    _rawAnswers: answers,
  };
}

/**
 * @param {object} profileData
 * @param {Record<string, string>|null} [identity]
 * @param {object} [options]
 */
async function generateUnifiedCvNarrative(profileData = {}, identity = null, options = {}) {
  const acceptedFields = options.acceptedFields && typeof options.acceptedFields === 'object'
    ? options.acceptedFields
    : {};
  const baseline = buildStructuredBaselineFromExtraction(profileData, acceptedFields);
  const userIdentity = identity && typeof identity === 'object' ? identity : baseline.userIdentity;
  const rawAnswers = buildWhoAreYouRawAnswersFromIdentity(userIdentity);
  const includeWhoAreYou = options.includeWhoAreYou !== false;
  const includeEmbedding = options.includeEmbedding !== false;
  const sourceLanguage = String(options.sourceLanguage || options.language || 'en').toLowerCase().split('-')[0] || 'en';

  const { dimensionInputs, promptDimensions } = buildDimensionInputs(
    baseline.lists,
    options.onlyDimensionKeys
  );

  const hasDimensionWork = Object.values(dimensionInputs).some((d) => d.rawItems.length > 0);
  const hasWhoWork = includeWhoAreYou && rawAnswers.some(Boolean);
  const needsLlm = hasDimensionWork || hasWhoWork || includeEmbedding;

  if (!needsLlm) {
    const empty = await normalizeUnifiedPayload(
      { dimensions: {}, whoAreYou: {}, embeddingText: '' },
      { dimensionInputs, rawAnswers, includeWhoAreYou, includeEmbedding }
    );
    return { ...empty, openAiCallCount: 0 };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    const fallback = buildDeterministicUnifiedPayload(dimensionInputs, rawAnswers, {
      includeWhoAreYou,
      includeEmbedding,
    });
    if (fallback._needsEmbeddingFallback) {
      fallback.embeddingText = await embeddingDeterministicFallback(fallback._rawAnswers);
    }
    delete fallback._needsEmbeddingFallback;
    delete fallback._rawAnswers;
    return { dimensions: fallback.dimensions, whoAreYou: fallback.whoAreYou, embeddingText: fallback.embeddingText, openAiCallCount: 0 };
  }

  const provider = options.llmProvider || openaiProvider;
  const messages = buildMessages({
    dimensions: promptDimensions,
    rawAnswers: includeWhoAreYou ? rawAnswers : [],
    sourceLanguage,
    includeWhoAreYou,
  });

  try {
    const raw = await provider(messages, {
      temperature: 0.2,
      max_tokens: 8192,
      ...(options.providerOpts || {}),
    });
    const parsed = parseUnifiedNarrativeJson(raw);
    const normalized = await normalizeUnifiedPayload(parsed, {
      dimensionInputs,
      rawAnswers,
      includeWhoAreYou,
      includeEmbedding,
    });
    return { ...normalized, openAiCallCount: 1 };
  } catch (err) {
    console.warn('[unifiedCvNarrativeGenerator] LLM failed, using deterministic fallback:', err?.message || err);
    const fallback = buildDeterministicUnifiedPayload(dimensionInputs, rawAnswers, {
      includeWhoAreYou,
      includeEmbedding,
    });
    if (fallback._needsEmbeddingFallback) {
      fallback.embeddingText = await embeddingDeterministicFallback(fallback._rawAnswers);
    }
    delete fallback._needsEmbeddingFallback;
    delete fallback._rawAnswers;
    return { dimensions: fallback.dimensions, whoAreYou: fallback.whoAreYou, embeddingText: fallback.embeddingText, openAiCallCount: 0 };
  }
}

module.exports = {
  generateUnifiedCvNarrative,
  parseUnifiedNarrativeJson,
  STRUCTURED_DIMENSION_KEYS,
  buildDimensionInputs,
  buildWhoAreYouRawAnswersFromIdentity,
};
