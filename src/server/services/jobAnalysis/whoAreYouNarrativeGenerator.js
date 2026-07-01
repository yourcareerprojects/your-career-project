const { buildMessages, normalizeAnswers } = require('../../prompts/generateWhoAreYouNarratives');
const { openaiProvider } = require('./roleIdentityComposer');
const { generateAI } = require('../ai/generateAI');
const SUPPORTED_LANGS = ['en', 'de'];

const PLACEHOLDER = 'No personal profile information available yet.';

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

function parseAnswersJson(raw) {
  let cleaned = String(raw || '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const parsed = JSON.parse(cleaned);
  const answers = Array.isArray(parsed?.answers) ? parsed.answers : [];
  if (answers.length !== 5) throw new Error('Missing five narrative answers');
  return answers.map((value) => String(value || '').trim());
}

function generateDeterministicFallback(rawAnswers = []) {
  const answers = normalizeAnswers(rawAnswers);
  if (answers.every((value) => !value)) {
    return Array(5).fill(PLACEHOLDER);
  }
  return answers.map((value) => {
    if (!value) return PLACEHOLDER;
    if (value.length < 30) return `You describe yourself as ${value.replace(/[.?!]+$/, '')}.`;
    return value;
  });
}

async function generateWhoAreYouNarratives(rawAnswers = [], options = {}) {
  const answers = normalizeAnswers(rawAnswers);
  const lang = String(options.lang || 'en').toLowerCase().split('-')[0] || 'en';
  const sourceLang = String(options.sourceLang || lang || 'en').toLowerCase().split('-')[0] || 'en';
  if (answers.every((value) => !value)) {
    return bundleIfRequested(Array(5).fill(PLACEHOLDER), { ...options, lang, sourceLang });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return bundleIfRequested(generateDeterministicFallback(answers), { ...options, lang, sourceLang });
  }

  try {
    const provider = options.llmProvider || openaiProvider;
    const aiResult = await generateAI({
      task: 'who_are_you',
      input: answers,
      lang,
      sourceLang,
      additionalLangs: SUPPORTED_LANGS,
      runner: async ({ input, lang: targetLang, tone }) => {
        const raw = await provider(buildMessages(input, targetLang, tone), {
          temperature: 0.3,
          ...(options.providerOpts || {}),
          user: `lang:${targetLang}`,
        });
        return parseAnswersJson(raw);
      },
    });
    if (options.returnBundle) {
      return aiResult;
    }
    return aiResult.localized[lang] || aiResult.canonical;
  } catch (err) {
    console.warn('[whoAreYouNarrativeGenerator] Falling back to deterministic narratives:', err.message);
    return bundleIfRequested(generateDeterministicFallback(answers), { ...options, lang, sourceLang });
  }
}

module.exports = {
  PLACEHOLDER,
  generateWhoAreYouNarratives,
  generateDeterministicFallback,
  parseAnswersJson,
};
