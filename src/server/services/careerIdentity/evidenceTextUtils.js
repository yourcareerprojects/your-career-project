/**
 * Shared text helpers for identity evidence extraction.
 */

const crypto = require('crypto');

const CONTACT_OR_META_KEYS = new Set([
  'personalinfo',
  'email',
  'phonenumber',
  'phone',
  'address',
  'linkedin',
  'website',
  'url',
  'path',
  'mimetype',
  'filename',
  '_id',
  'id',
  'userid',
  'uploaddate',
  'createdat',
  'updatedat',
]);

function stableId(...parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24);
}

function localized(en, de) {
  return { en: en || '', de: de != null ? de : en || '' };
}

function textBlob(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value.en || value.de) {
      return [value.en, value.de].filter(Boolean).join(' ');
    }
    if (value.original || value.translations) {
      const translations = value.translations || {};
      return [
        value.original,
        translations.en,
        translations.de,
        typeof value.summary_text === 'string' ? value.summary_text : '',
      ]
        .filter(Boolean)
        .join(' ');
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

/**
 * Pick a single-language display string from a localized title/description value.
 * Avoids concatenating en+de (e.g. "digital media designer Digital Media Designer*in").
 *
 * @param {*} value
 * @param {string} [lang]
 * @returns {string}
 */
function pickLocalizedString(value, lang = 'en') {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  if (typeof value !== 'object') return String(value).trim();

  const code = String(lang || 'en').toLowerCase().split('-')[0];
  const candidates = [];
  if (value[code] != null) candidates.push(value[code]);
  if (code !== 'en' && value.en != null) candidates.push(value.en);
  if (code !== 'de' && value.de != null) candidates.push(value.de);
  if (value.original != null) candidates.push(value.original);
  const translations = value.translations || {};
  if (translations[code] != null) candidates.push(translations[code]);
  if (translations.en != null) candidates.push(translations.en);
  if (translations.de != null) candidates.push(translations.de);

  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (text) return text;
  }
  return '';
}

/**
 * @param {*} value
 * @param {{ en?: string, de?: string }} [fallback]
 * @returns {{ en: string, de: string }}
 */
function localizedTitles(value, fallback = {}) {
  const en = pickLocalizedString(value, 'en') || pickLocalizedString(value, 'de') || fallback.en || 'Career';
  const de = pickLocalizedString(value, 'de') || pickLocalizedString(value, 'en') || fallback.de || en;
  return { en, de };
}

function narrativeText(dimension) {
  if (!dimension || typeof dimension !== 'object') return '';
  const raw = Array.isArray(dimension.raw_items) ? dimension.raw_items.join(' ') : '';
  return `${raw} ${textBlob(dimension.summary_text)}`.trim();
}

/**
 * Prefer discrete profile items for matching (avoids blending unrelated bullets).
 * @param {object} dimension
 * @returns {string[]}
 */
function narrativeItems(dimension) {
  if (!dimension || typeof dimension !== 'object') return [];
  const items = [];
  if (Array.isArray(dimension.raw_items)) {
    for (const item of dimension.raw_items) {
      const text = String(item || '').trim();
      if (text) items.push(text);
    }
  }
  if (items.length > 0) return items;

  const summary = textBlob(dimension.summary_text).trim();
  return summary ? [summary] : [];
}

/**
 * Split multi-topic answers into atomic chunks before semantic matching.
 * Handles newlines/bullets and German title-cased phrases joined without separators.
 * @param {string} text
 * @returns {string[]}
 */
function splitEvidenceChunks(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  let parts = raw
    .split(/\r?\n+|[•;]+|(?:^|\s)[-–]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 1) {
    // Profile answers often concatenate Title-Case phrases without newlines.
    // Split after verb-like endings so German nouns (also capitalized) stay intact.
    parts = raw
      .split(/(?<=(?:ieren|eln|ern|[^aeiouäöü]en|nd))\s+(?=[A-ZÄÖÜ])/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (parts.length <= 1) return [raw];

  const filtered = parts.filter((part) => part.length >= 8);
  return filtered.length > 0 ? filtered : [raw];
}

function looksLikeJsonBlob(text) {
  const trimmed = String(text || '').trim();
  return (
    (trimmed.startsWith('{') && trimmed.includes('"')) ||
    (trimmed.startsWith('[') && trimmed.includes('{'))
  );
}

function isJunkEvidenceText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.length < 8) return true;
  if (looksLikeJsonBlob(trimmed)) return true;
  if (/^[\w.+-]+@[\w.-]+\.\w{2,}$/i.test(trimmed)) return true;
  if (/^\+?\d[\d\s()/.-]{6,}$/.test(trimmed)) return true;
  return false;
}

/**
 * Recursively collect human-readable strings from CV/profile objects.
 * Skips contact/meta fields so emails and phones never become evidence.
 * @param {*} value
 * @param {object} [options]
 * @returns {string[]}
 */
function collectReadableStrings(value, options = {}) {
  const depth = options.depth || 0;
  const key = String(options.key || '').toLowerCase();
  const out = [];

  if (value == null || depth > 8) return out;
  if (CONTACT_OR_META_KEYS.has(key)) return out;

  if (typeof value === 'string') {
    const text = value.trim();
    if (text && !isJunkEvidenceText(text)) out.push(text);
    return out;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return out;

  if (Array.isArray(value)) {
    for (const item of value) {
      out.push(...collectReadableStrings(item, { depth: depth + 1, key }));
    }
    return out;
  }

  if (typeof value === 'object') {
    if (value.en || value.de) {
      const localizedText = [value.en, value.de].filter(Boolean).join(' ').trim();
      if (localizedText && !isJunkEvidenceText(localizedText)) out.push(localizedText);
      return out;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      out.push(...collectReadableStrings(childValue, { depth: depth + 1, key: childKey }));
    }
  }

  return out;
}

/**
 * Prefer narrative CV fields; never dump raw JSON/contact blobs into matching.
 * @param {object} doc
 * @returns {string[]}
 */
function extractCvEvidenceTexts(doc) {
  if (!doc || typeof doc !== 'object') return [];

  const preferred = [
    ...collectReadableStrings(doc.narrativeEnrichment),
    ...collectReadableStrings(doc.semanticInterpretation),
  ];

  const extracted = doc.extractedProfileData;
  if (extracted && typeof extracted === 'object') {
    preferred.push(
      ...collectReadableStrings(extracted.userIdentity),
      ...collectReadableStrings(extracted.structuredUserInfo),
      ...collectReadableStrings(extracted.seniority)
    );
  } else if (typeof extracted === 'string' && !isJunkEvidenceText(extracted)) {
    preferred.push(extracted.trim());
  }

  const unique = [];
  const seen = new Set();
  for (const text of preferred) {
    const chunks = splitEvidenceChunks(text);
    for (const chunk of chunks) {
      const key = chunk.toLowerCase();
      if (seen.has(key) || isJunkEvidenceText(chunk)) continue;
      seen.add(key);
      unique.push(chunk);
    }
  }
  return unique;
}

function pushEvidence(bucket, traitId, evidence) {
  if (!traitId || !evidence) return;
  if (!bucket.has(traitId)) bucket.set(traitId, []);
  bucket.get(traitId).push(evidence);
}

/** Canonical key for evidence text used in embedding cache lookups. */
function normalizeEvidenceText(text) {
  return String(text || '').trim();
}

/** Lowercased, collapsed text for overlap / duplicate detection. */
function normalizeOverlapKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when `chunk` is the same as, or already contained in, an existing evidence text.
 * Prevents identity-narrative reuse of reflection answers from becoming duplicate proof.
 *
 * @param {string} chunk
 * @param {Iterable<string>} existingTexts
 * @returns {boolean}
 */
function isTextCoveredByExisting(chunk, existingTexts) {
  const norm = normalizeOverlapKey(chunk);
  if (!norm || norm.length < 4) return true;

  for (const existing of existingTexts || []) {
    const other = normalizeOverlapKey(existing);
    if (!other) continue;
    if (other === norm) return true;
    // Short narrative fragments that already appear inside a reflection answer
    if (norm.length >= 6 && other.includes(norm)) return true;
    // Nearly identical longer strings (minor punctuation/polish differences)
    if (other.length >= 24 && norm.includes(other) && other.length / norm.length >= 0.7) {
      return true;
    }
  }
  return false;
}

module.exports = {
  stableId,
  localized,
  textBlob,
  pickLocalizedString,
  localizedTitles,
  narrativeText,
  narrativeItems,
  splitEvidenceChunks,
  isJunkEvidenceText,
  collectReadableStrings,
  extractCvEvidenceTexts,
  pushEvidence,
  normalizeEvidenceText,
  normalizeOverlapKey,
  isTextCoveredByExisting,
};
