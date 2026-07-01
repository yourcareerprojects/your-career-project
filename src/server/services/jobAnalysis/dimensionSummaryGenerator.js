const { buildMessages } = require('../../prompts/generateDimensionSummary');
const { openaiProvider } = require('./roleIdentityComposer');
const { generateAI } = require('../ai/generateAI');
const SUPPORTED_LANGS = ['en', 'de'];

const EMPTY_PLACEHOLDER = 'No information available yet';

function bundleIfRequested(result, options = {}) {
  if (!options.returnBundle) return result;
  const lang = String(options.lang || 'en').toLowerCase().split('-')[0] || 'en';
  const sourceLang = String(options.sourceLang || lang || 'en').toLowerCase().split('-')[0] || 'en';
  return {
    canonical: result,
    canonicalLanguage: sourceLang,
    localized: {},
  };
}

function normalizeStringArray(arr = []) {
  return Array.isArray(arr)
    ? arr.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
    : [];
}

function parseSummaryJson(raw) {
  let cleaned = String(raw || '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const parsed = JSON.parse(cleaned);
  const summary = String(parsed?.summary_text || '').trim();
  if (!summary) throw new Error('Missing summary_text');
  return summary;
}

function buildDeterministicFallback(rawItems = []) {
  const items = normalizeStringArray(rawItems);
  if (items.length === 0) return EMPTY_PLACEHOLDER;
  if (items.length === 1) return `You bring focused experience in ${items[0]}.`;
  if (items.length === 2) return `You combine experience in ${items[0]} and ${items[1]} to deliver practical, consistent outcomes.`;
  const head = items.slice(0, 3).join(', ');
  return `You bring a strong blend of experience across ${head}, and you apply these strengths in a cohesive, results-oriented way.`;
}

async function generateDimensionSummary({ dimension, rawItems }, options = {}) {
  const normalizedItems = normalizeStringArray(rawItems);
  const lang = String(options.lang || 'en').toLowerCase().split('-')[0] || 'en';
  const sourceLang = String(options.sourceLang || lang || 'en').toLowerCase().split('-')[0] || 'en';
  if (normalizedItems.length === 0) {
    return bundleIfRequested(EMPTY_PLACEHOLDER, { ...options, lang, sourceLang });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return bundleIfRequested(buildDeterministicFallback(normalizedItems), { ...options, lang, sourceLang });
  }

  try {
    const provider = options.llmProvider || openaiProvider;
    const aiResult = await generateAI({
      task: 'dimension_summary',
      input: { dimension, rawItems: normalizedItems },
      lang,
      sourceLang,
      additionalLangs: SUPPORTED_LANGS,
      runner: async ({ input, lang: targetLang, tone }) => {
        const raw = await provider(
          buildMessages({
            dimension: input.dimension,
            rawItems: input.rawItems,
            lang: targetLang,
            tone,
          }),
          { temperature: 0.2, ...(options.providerOpts || {}) }
        );
        return parseSummaryJson(raw);
      },
    });
    if (options.returnBundle) return aiResult;
    return aiResult.localized[lang] || aiResult.canonical;
  } catch (err) {
    console.warn('[dimensionSummaryGenerator] Falling back to deterministic summary:', err.message);
    return bundleIfRequested(buildDeterministicFallback(normalizedItems), { ...options, lang, sourceLang });
  }
}

module.exports = {
  EMPTY_PLACEHOLDER,
  generateDimensionSummary,
  buildDeterministicFallback,
  normalizeStringArray,
};
