const { buildMessages, normalizeAnswers } = require('../../prompts/generateWhoAreYouIdentityEmbeddingText');
const { openaiProvider } = require('./roleIdentityComposer');
const { normalizeForEmbedding } = require('../ai/normalizeForEmbedding');

const PLACEHOLDER = 'I have not provided enough identity information yet to create a meaningful semantic profile.';

function parseIdentityJson(raw) {
  let cleaned = String(raw || '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const parsed = JSON.parse(cleaned);
  const text = String(parsed?.identity_embedding_text || '').trim();
  if (!text) throw new Error('Missing identity_embedding_text');
  return text;
}

async function generateDeterministicFallback(rawAnswers = []) {
  const answers = normalizeAnswers(rawAnswers);
  const filled = answers.filter(Boolean);
  if (filled.length === 0) return PLACEHOLDER;
  const normalized = (await normalizeForEmbedding(filled)).trim();
  return `I am motivated by ${normalized}.`.slice(0, 650);
}

async function generateWhoAreYouIdentityEmbeddingText(rawAnswers = [], options = {}) {
  const answers = normalizeAnswers(rawAnswers);
  if (answers.every((value) => !value)) return PLACEHOLDER;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    if (process.env.EMBEDDING_NORMALIZE_DEBUG === '1') {
      console.debug('[whoAreYouIdentityEmbeddingTextGenerator] fallback: no API key');
    }
    return generateDeterministicFallback(answers);
  }

  try {
    const provider = options.llmProvider || openaiProvider;
    const raw = await provider(buildMessages(answers), {
      temperature: 0.3,
      ...(options.providerOpts || {}),
    });
    const text = parseIdentityJson(raw);
    const normalized = await normalizeForEmbedding(text);
    return normalized.trim() || PLACEHOLDER;
  } catch (err) {
    console.warn('[whoAreYouIdentityEmbeddingTextGenerator] Falling back to deterministic identity text:', err.message);
    return generateDeterministicFallback(answers);
  }
}

module.exports = {
  PLACEHOLDER,
  parseIdentityJson,
  generateDeterministicFallback,
  generateWhoAreYouIdentityEmbeddingText,
};
