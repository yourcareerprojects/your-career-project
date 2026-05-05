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
  });

  if (!res.ok) {
    return text;
  }
  const data = await res.json().catch(() => null);
  return data?.choices?.[0]?.message?.content?.trim() || text;
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
  });

  if (!res.ok) {
    return text;
  }
  const data = await res.json().catch(() => null);
  return data?.choices?.[0]?.message?.content?.trim() || text;
}

module.exports = {
  translateText,
  translateBetweenLocales,
  __testables: {
    buildGermanStyleInstruction,
    buildTranslatorSystemPrompt,
  },
};
