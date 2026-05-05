/**
 * Canonical English normalization for embedding inputs only (UI data unchanged elsewhere).
 *
 * @module services/ai/normalizeForEmbedding
 */

const crypto = require('crypto');
const { translateBetweenLocales } = require('./translateText');

/** Typical embedding-friendly cap (avoid huge payloads; stays under model limits). */
const DEFAULT_MAX_CHARS = 1600;

/** Simple LRU-ish bound */
const TRANSLATION_CACHE_MAX = 400;
const translationCache = new Map();

function translationCacheKey(source) {
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

function touchTranslationCache(key, value) {
  if (translationCache.has(key)) translationCache.delete(key);
  translationCache.set(key, value);
  while (translationCache.size > TRANSLATION_CACHE_MAX) {
    const first = translationCache.keys().next().value;
    if (first === undefined) break;
    translationCache.delete(first);
  }
}

/**
 * @param {unknown} input
 * @returns {string[]}
 */
function flattenToLines(input) {
  if (input == null) return [];

  const pushTrimmed = (out, s) => {
    const t = String(s || '').trim();
    if (t) out.push(t);
  };

  if (typeof input === 'string') {
    return input.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  if (Array.isArray(input)) {
    const out = [];
    for (const item of input) {
      if (item == null) continue;
      if (typeof item === 'string') {
        for (const line of item.split('\n')) pushTrimmed(out, line);
      } else if (typeof item === 'object' && item && item.name != null) {
        pushTrimmed(out, item.name);
      } else {
        const t = String(item).trim();
        if (t && t !== '[object Object]') out.push(t);
      }
    }
    return out;
  }

  if (typeof input === 'object' && input !== null) {
    if (input.name != null) {
      const out = [];
      pushTrimmed(out, input.name);
      return out;
    }
    const t = String(input).trim();
    return t && t !== '[object Object]' ? [t] : [];
  }

  const single = [];
  pushTrimmed(single, input);
  return single;
}

/**
 * Lightweight language hint for German → English translation gate.
 * @param {string} text
 * @returns {'de'|'en'}
 */
function detectGermanHint(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'en';
  if (/[äöüÄÖÜß]/.test(raw)) return 'de';

  const lower = raw.toLowerCase();
  const deHits = (lower.match(/\b(und|oder|der|die|das|nicht|mit|für|von|zu|bei|nach|über|als|auch|noch|nur|wie|wird)\b/g) || []).length;
  const enHits = (lower.match(/\b(the|and|or|with|for|from|not|this|that|will|was|were)\b/g) || []).length;
  if (deHits >= 2 && deHits >= enHits + 1) return 'de';

  if (
    /\b(ich bin|nicht nur|und auch|für die|von der|zu der|mit dem|auf die)\b/i.test(lower)
    && enHits === 0
  ) {
    return 'de';
  }

  return 'en';
}

/**
 * Best-effort German detector after normalization (for debug guards).
 * Avoid treating isolated English homographs as German when English hints exist.
 *
 * @param {string} text
 * @returns {boolean}
 */
function containsGerman(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/[äöüÄÖÜß]/.test(raw)) return true;
  const lower = raw.toLowerCase();
  const enHits = (lower.match(/\b(the|and|with|for|from|this|that)\b/g) || []).length;
  if (enHits >= 2) return false;
  return /\b(ich bin|und auch|nicht nur|mit dem|von der|zu der|für die)\b/i.test(lower);
}

/**
 * Dedupe lines case-insensitively; preserve first-seen casing.
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function dedupeLines(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const k = line.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(line);
  }
  return out;
}

function clampEmbeddingLength(text, maxChars) {
  let s = String(text || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim();
  if (s.length > maxChars) {
    s = s.slice(0, maxChars).trim();
  }
  return s;
}

/**
 * Normalize arbitrary embedding-bound input into deterministic canonical English text.
 *
 * @param {unknown} input – string | array of strings/objects | newline-separated semantics
 * @param {object} [options]
 * @param {boolean} [options.lowercase=false] – lowercase lines after dedupe (optional determinism tradeoff)
 * @param {number} [options.maxChars] – hard max chars (default DEFAULT_MAX_CHARS)
 * @returns {Promise<string>}
 */
async function normalizeForEmbedding(input, options = {}) {
  const maxChars = typeof options.maxChars === 'number' && options.maxChars > 0 ? options.maxChars : DEFAULT_MAX_CHARS;
  const lowercase = options.lowercase === true;

  let lines = flattenToLines(input);
  lines = dedupeLines(lines);
  if (lowercase) lines = lines.map((l) => l.toLowerCase());

  let flat = lines.join('\n').trim();
  if (!flat) return '';

  const hinted = detectGermanHint(flat);
  if (hinted === 'de') {
    const cacheKey = translationCacheKey(`de|${flat}`);
    const hit = translationCache.get(cacheKey);
    if (hit != null) {
      flat = hit;
    } else {
      const translated = await translateBetweenLocales(flat, 'de', 'en', {
        styleHint:
          'Technical role titles and proper nouns preserved. Preserve newline separators between items. Output English only.',
      });
      const t = translated != null && String(translated).trim() ? String(translated).trim() : '';
      const outLang = t && t !== flat ? t : flat.trim();
      touchTranslationCache(cacheKey, outLang);
      flat = outLang;
      if (process.env.EMBEDDING_NORMALIZE_DEBUG === '1') {
        console.debug('[normalizeForEmbedding] translated de→en', { approxChars: flat.length });
      }
    }
  }

  flat = clampEmbeddingLength(String(flat || ''), maxChars);
  return String(flat || '').trim();
}

function clearEmbeddingNormalizationCache() {
  translationCache.clear();
}

module.exports = {
  normalizeForEmbedding,
  containsGerman,
  detectGermanHint,
  clearEmbeddingNormalizationCache,
  DEFAULT_MAX_CHARS,
};
