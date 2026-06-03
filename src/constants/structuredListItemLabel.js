/**
 * Normalize structured profile list entries (skills, domains, etc.) to a display string.
 * Handles plain strings, `{ name }`, bilingual `{ en, de }`, and `{ name: { en, de } }`.
 */

function pickLocalizedPair(pair, lang = 'en') {
  if (!pair || typeof pair !== 'object') return '';
  const code = String(lang || 'en').toLowerCase().split('-')[0] || 'en';
  const en = String(pair.en ?? '').trim();
  const de = String(pair.de ?? '').trim();
  if (code === 'de') return de || en;
  return en || de;
}

function normalizeStructuredListItemLabel(item, lang = 'en') {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item !== 'object') return String(item).trim();

  if ('en' in item || 'de' in item) {
    const picked = pickLocalizedPair(item, lang);
    if (picked) return picked;
  }

  const candidate =
    item.name ??
    item.label ??
    item.title ??
    item.preferredLabel ??
    item.value ??
    item.description ??
    item.key;

  if (typeof candidate === 'string') return candidate.trim();
  if (candidate && typeof candidate === 'object') {
    return pickLocalizedPair(candidate, lang);
  }
  return '';
}

function normalizeStructuredListItemLabels(arr = [], lang = 'en') {
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => normalizeStructuredListItemLabel(item, lang)).filter(Boolean);
}

module.exports = {
  pickLocalizedPair,
  normalizeStructuredListItemLabel,
  normalizeStructuredListItemLabels,
};
