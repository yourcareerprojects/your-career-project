const cache = new Map();

function toCacheKey(input) {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch (_) {
    return String(input);
  }
}

async function cachedTranslate(text, lang, fn) {
  const key = `${lang}:${toCacheKey(text)}`;
  if (cache.has(key)) return cache.get(key);

  const result = await fn();
  cache.set(key, result);
  return result;
}

module.exports = {
  cachedTranslate,
};
