const logger = require('../../utils/logger');
const {
  TIMEOUT_MS_TRANSLATION,
  normalizeExternalApiError,
  combineSignals,
} = require('../../utils/httpTimeouts');
const {
  recordTranslationDuration,
  hrtimeDiffMs,
  getCvPipeline,
} = require('../../utils/metricsLogger');

function buildGermanStyleInstruction(targetLang) {
  const lang = String(targetLang || 'en').toLowerCase().split('-')[0] || 'en';
  if (lang !== 'de') return '';
  return [
    'German style rules:',
    '- Use gender-inclusive wording; when role/person nouns are needed, use forms like "*in" (e.g., "Nutzer*innen").',
    '- Do not use formal/polite address ("Sie", "Ihnen", "Ihr").',
    '- Use plain and easy German (Einfache Sprache, about A2-B1 level) with short, clear sentences.',
    '- Prefer neutral infinitive constructions or direct, clear wording.',
  ].join('\n');
}

function buildTranslatorSystemPrompt(targetLang, styleHint = '') {
  const base =
    'You are a precise translator. Translate faithfully while preserving meaning, tone, lists, and line breaks. Reply with translated text only.';
  const germanStyle = buildGermanStyleInstruction(targetLang);
  const custom = String(styleHint || '').trim();
  return [base, germanStyle, custom].filter(Boolean).join('\n\n');
}

async function translateText({ text, targetLang, styleHint }) {
  const lang = String(targetLang || 'en').toLowerCase().split('-')[0] || 'en';
  if (!text || lang === 'en') return text;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) return text;

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const hrStart = process.hrtime.bigint();
  try {
    const signal = combineSignals(undefined, TIMEOUT_MS_TRANSLATION);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: buildTranslatorSystemPrompt(lang, styleHint),
          },
          {
            role: 'user',
            content: `Translate the following text to ${lang}:\n\n${String(text)}`,
          },
        ],
        temperature: 0.2,
      }),
      signal,
    });

    if (!res.ok) {
      const preview = await res.text().catch(() => '');
      logger.warn('translateText upstream HTTP error', {
        status: res.status,
        bodyPreview: preview.slice(0, 400),
      });
      if (getCvPipeline()) {
        recordTranslationDuration(hrtimeDiffMs(hrStart));
      }
      return text;
    }
    const data = await res.json().catch(() => null);
    if (getCvPipeline()) {
      recordTranslationDuration(hrtimeDiffMs(hrStart));
    }
    return data?.choices?.[0]?.message?.content?.trim() || text;
  } catch (err) {
    if (getCvPipeline()) {
      recordTranslationDuration(hrtimeDiffMs(hrStart));
    }
    logger.warn('translateText failed; returning source text', normalizeExternalApiError(err));
    return text;
  }
}

/**
 * Bidirectional locale translation (used for CV extraction originals vs UI locales).
 * Unlike translateText(), this runs when target is English too.
 *
 * @param {string} text
 * @param {string} sourceLang ISO-ish code e.g. en, de
 * @param {string} targetLang
 * @returns {Promise<string>}
 */
async function translateBetweenLocales(text, sourceLang, targetLang, options = {}) {
  const src = String(sourceLang || 'en').toLowerCase().split('-')[0] || 'en';
  const tgt = String(targetLang || 'en').toLowerCase().split('-')[0] || 'en';
  const raw = String(text || '').trim();
  if (!raw || src === tgt) return text;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) return text;

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const hrStart = process.hrtime.bigint();
  try {
    const signal = combineSignals(options.signal, TIMEOUT_MS_TRANSLATION);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: buildTranslatorSystemPrompt(tgt, options.styleHint),
          },
          {
            role: 'user',
            content: `Translate from ${src} to ${tgt}:\n\n${raw}`,
          },
        ],
        temperature: 0.2,
      }),
      signal,
    });

    if (!res.ok) {
      const preview = await res.text().catch(() => '');
      logger.warn('translateBetweenLocales upstream HTTP error', {
        status: res.status,
        src,
        tgt,
        bodyPreview: preview.slice(0, 400),
      });
      if (getCvPipeline()) {
        recordTranslationDuration(hrtimeDiffMs(hrStart));
      }
      return text;
    }
    const data = await res.json().catch(() => null);
    if (getCvPipeline()) {
      recordTranslationDuration(hrtimeDiffMs(hrStart));
    }
    return data?.choices?.[0]?.message?.content?.trim() || text;
  } catch (err) {
    if (getCvPipeline()) {
      recordTranslationDuration(hrtimeDiffMs(hrStart));
    }
    logger.warn('translateBetweenLocales failed; returning source text', normalizeExternalApiError(err, { src, tgt }));
    return text;
  }
}

/**
 * Translate many CV-extracted strings in one structured LLM request.
 * @param {{ id: string, text: string }[]} items non-empty text rows with stable ids
 * @param {'en'|'de'} documentLanguage source locale of extracted strings
 * @returns {Promise<Map<string, string>>} id -> translated text in target locale
 */
async function translateCvExtractBatch(items, documentLanguage, options = {}) {
  const docLang = documentLanguage === 'de' ? 'de' : 'en';
  const targetLang = docLang === 'en' ? 'de' : 'en';

  const rows = (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: String(item?.id || '').trim(),
      text: String(item?.text || '').trim(),
    }))
    .filter((item) => item.id && item.text);

  if (rows.length === 0) return new Map();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) return new Map();

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const payload = {
    sourceLanguage: docLang,
    targetLanguage: targetLang,
    items: rows,
  };

  const hrStart = process.hrtime.bigint();
  try {
    const signal = combineSignals(options.signal, TIMEOUT_MS_TRANSLATION);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You are a precise translator for CV profile extraction.',
              `Translate every item from ${docLang} to ${targetLang}.`,
              'Preserve meaning, tone, lists, and line breaks within each string.',
              'Return JSON only with this exact shape: {"translations":{"<id>":"<translated text>",...}}.',
              'Include every input id exactly once; do not add or omit ids.',
              buildGermanStyleInstruction(targetLang),
            ]
              .filter(Boolean)
              .join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify(payload),
          },
        ],
      }),
      signal,
    });

    if (!res.ok) {
      const preview = await res.text().catch(() => '');
      logger.warn('translateCvExtractBatch upstream HTTP error', {
        status: res.status,
        itemCount: rows.length,
        bodyPreview: preview.slice(0, 400),
      });
      if (getCvPipeline()) {
        recordTranslationDuration(hrtimeDiffMs(hrStart));
      }
      throw new Error(`translateCvExtractBatch HTTP ${res.status}`);
    }

    const data = await res.json().catch(() => null);
    if (getCvPipeline()) {
      recordTranslationDuration(hrtimeDiffMs(hrStart));
    }

    const content = data?.choices?.[0]?.message?.content?.trim() || '';
    if (!content) throw new Error('translateCvExtractBatch empty response');

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      throw new Error(`translateCvExtractBatch invalid JSON: ${parseErr.message}`);
    }

    const rawMap =
      parsed?.translations && typeof parsed.translations === 'object' ? parsed.translations : parsed;
    if (!rawMap || typeof rawMap !== 'object') {
      throw new Error('translateCvExtractBatch missing translations object');
    }

    const out = new Map();
    for (const row of rows) {
      const translated = rawMap[row.id];
      if (translated == null) continue;
      const text = String(translated).trim();
      if (text) out.set(row.id, text);
    }
    return out;
  } catch (err) {
    if (getCvPipeline()) {
      recordTranslationDuration(hrtimeDiffMs(hrStart));
    }
    logger.warn('translateCvExtractBatch failed', normalizeExternalApiError(err, { itemCount: rows.length }));
    throw err;
  }
}

module.exports = {
  translateText,
  translateBetweenLocales,
  translateCvExtractBatch,
  __testables: {
    buildGermanStyleInstruction,
    buildTranslatorSystemPrompt,
  },
};
