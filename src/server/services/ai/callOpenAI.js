/**
 * Chat Completions API may return `message.content` as a string or as an array of
 * `{ type: 'text', text: string }` / refusal parts (newer gateway models).
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeChatCompletionContent(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (!Array.isArray(raw)) return '';
  const chunks = [];
  for (const part of raw) {
    if (typeof part === 'string') {
      chunks.push(part);
      continue;
    }
    if (part && typeof part === 'object') {
      if (typeof part.text === 'string') chunks.push(part.text);
      else if (typeof part.refusal === 'string') chunks.push(part.refusal);
    }
  }
  return chunks.join('');
}

const logger = require('../../utils/logger');
const {
  TIMEOUT_MS_LLM,
  normalizeExternalApiError,
  combineSignals,
} = require('../../utils/httpTimeouts');

/**
 * Thin OpenAI-compatible chat completions wrapper (plain text; no JSON mode).
 * @param {{ model: string, temperature?: number, messages: { role: string, content: string }[] }} params
 * @returns {Promise<{ text: string }>}
 */
async function callOpenAI({ model, temperature, messages }) {
  const apiKey = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Configure it in .env.');
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const body = {
    model: model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: Array.isArray(messages) ? messages : [],
  };
  if (typeof temperature === 'number') {
    body.temperature = temperature;
  }

  const started = Date.now();
  let res;
  try {
    const signal = combineSignals(undefined, TIMEOUT_MS_LLM);
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    logger.error(
      'OpenAI chat completions request failed (network)',
      normalizeExternalApiError(err, { durationMs: Date.now() - started })
    );
    throw err;
  }

  const durationMs = Date.now() - started;

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    logger.error('OpenAI chat completions HTTP error', {
      status: res.status,
      durationMs,
      bodyPreview: errBody.slice(0, 400),
    });
    throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const rawContent =
    data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
  const text = normalizeChatCompletionContent(rawContent);

  if (!text.trim()) {
    throw new Error('Empty response from OpenAI API');
  }

  return { text };
}

module.exports = {
  callOpenAI,
};
