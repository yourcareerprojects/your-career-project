/**
 * OpenAI client wrapper for occupation domain classification (with retries).
 * @module services/occupationDomainClassification/domainClassificationLlmClient
 */

const { callOpenAI } = require('../ai/callOpenAI');
const logger = require('../../utils/logger');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MIN_DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err) {
  const message = String(err?.message || err || '');
  if (/OpenAI API error (429|500|502|503|504)/i.test(message)) return true;
  if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed|network/i.test(message)) return true;
  if (/Empty response from OpenAI/i.test(message)) return true;
  return false;
}

/**
 * @param {{
 *   messages: { role: string, content: string }[],
 *   model?: string,
 *   temperature?: number,
 *   maxRetries?: number,
 *   minDelayMs?: number,
 * }} options
 * @returns {Promise<{ text: string, model: string }>}
 */
async function classifyWithOpenAI({
  messages,
  model = DEFAULT_MODEL,
  temperature = 0,
  maxRetries = DEFAULT_MAX_RETRIES,
  minDelayMs = DEFAULT_MIN_DELAY_MS,
} = {}) {
  const resolvedModel = model || DEFAULT_MODEL;
  let delay = minDelayMs;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const { text } = await callOpenAI({
        model: resolvedModel,
        temperature,
        messages,
        responseFormat: { type: 'json_object' },
      });
      return { text, model: resolvedModel };
    } catch (err) {
      lastError = err;
      const retryable = isRetryableError(err);
      logger.error('occupation domain classification OpenAI error', {
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        retryable,
        model: resolvedModel,
        errorName: err?.name,
        message: err?.message,
      });
      if (!retryable || attempt >= maxRetries) break;
      await sleep(delay);
      delay *= 2;
    }
  }

  throw lastError || new Error('OpenAI classification failed');
}

module.exports = {
  classifyWithOpenAI,
  DEFAULT_MODEL,
  isRetryableError,
};
