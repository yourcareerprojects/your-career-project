async function normalizeForProcessing(text, lang, translateFn) {
  if (!text) return text;

  const code = String(lang || 'en').toLowerCase().split('-')[0] || 'en';
  if (code === 'en') return text;

  return translateFn({
    text,
    targetLang: 'en',
  });
}

module.exports = { normalizeForProcessing };
