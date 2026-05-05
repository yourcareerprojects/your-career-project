const { translateText } = require('./translateText');

async function translateStructured(input, targetLang, seen = new WeakSet()) {
  const lang = String(targetLang || 'en').toLowerCase().split('-')[0] || 'en';
  if (!input || lang === 'en') return input;

  if (typeof input === 'string') {
    return translateText({ text: input, targetLang: lang });
  }

  if (Array.isArray(input)) {
    const results = [];
    for (const item of input) {
      results.push(await translateStructured(item, lang, seen));
    }
    return results;
  }

  if (typeof input === 'object') {
    if (seen.has(input)) return input;
    seen.add(input);

    const output = {};
    for (const [key, value] of Object.entries(input)) {
      const keyLower = String(key || '').toLowerCase();
      const isTranslatableField =
        typeof value === 'string' &&
        !keyLower.includes('id') &&
        !keyLower.includes('code');

      if (isTranslatableField) {
        output[key] = await translateText({ text: value, targetLang: lang });
      } else {
        output[key] = await translateStructured(value, lang, seen);
      }
    }
    return output;
  }

  return input;
}

module.exports = {
  translateStructured,
};
