/**
 * Build deterministic embedding input text from identity trait catalog entries.
 * Used offline by scripts/buildIdentityTraitEmbeddings.js — not at request time.
 */

const crypto = require('crypto');
const { listTraitDefinitions } = require('../../../constants/identityTraitCatalog');

/**
 * Compose a rich, bilingual text blob from all catalog fields available for a trait.
 *
 * @param {import('../../../constants/identityTraitCatalog').IdentityTraitDefinition} trait
 * @returns {string}
 */
function buildTraitEmbeddingText(trait) {
  if (!trait || !trait.id) return '';

  const keywords = Array.isArray(trait.keywords)
    ? trait.keywords.map((k) => String(k).trim()).filter(Boolean)
    : [];

  const lines = [
    `Trait: ${trait.id}`,
    `Category: ${trait.category || ''}`,
    `Name (English): ${trait.name?.en || ''}`,
    `Name (German): ${trait.name?.de || ''}`,
    `Description (English): ${trait.description?.en || ''}`,
    `Description (German): ${trait.description?.de || ''}`,
  ];

  if (keywords.length > 0) {
    lines.push(`Keywords: ${keywords.join(', ')}`);
  }

  return lines.join('\n').trim();
}

/**
 * Stable hash of the embedding text — used to skip unchanged traits when regenerating.
 *
 * @param {string} text
 * @returns {string}
 */
function hashTraitEmbeddingText(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

/**
 * Map of traitId → { text, textHash } for every catalog trait.
 *
 * @returns {Map<string, { text: string, textHash: string }>}
 */
function buildTraitEmbeddingTextMap() {
  const map = new Map();
  for (const trait of listTraitDefinitions()) {
    const text = buildTraitEmbeddingText(trait);
    map.set(trait.id, {
      text,
      textHash: hashTraitEmbeddingText(text),
    });
  }
  return map;
}

module.exports = {
  buildTraitEmbeddingText,
  hashTraitEmbeddingText,
  buildTraitEmbeddingTextMap,
};
