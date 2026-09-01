/**
 * Evidence quality gates — keep only trait matches that are strong or lexically grounded.
 */

const { getTraitDefinition } = require('../../../constants/identityTraitCatalog');

/** Match strength above this can pass without keyword overlap (clear semantic hit). */
const STRONG_MATCH_STRENGTH = 0.62;

function hasLexicalTraitSupport(text, traitId) {
  const def = getTraitDefinition(traitId);
  if (!def) return false;

  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return false;

  for (const keyword of def.keywords || []) {
    const needle = String(keyword).toLowerCase().trim();
    if (needle.length >= 3 && lower.includes(needle)) return true;
  }

  for (const name of [def.name?.en, def.name?.de]) {
    const words = String(name || '')
      .toLowerCase()
      .split(/[^a-zäöüß0-9]+/i)
      .filter((word) => word.length >= 4);
    for (const word of words) {
      if (lower.includes(word)) return true;
    }
  }

  return false;
}

/**
 * Accept a semantic candidate when it is clearly strong, or when the source text
 * also mentions the trait lexically (reduces random near-threshold hits).
 *
 * @param {string} text
 * @param {string} traitId
 * @param {number} strength
 * @returns {boolean}
 */
function shouldAcceptTraitMatch(text, traitId, strength) {
  const score = Number(strength) || 0;
  if (score <= 0) return false;
  if (score >= STRONG_MATCH_STRENGTH) return true;
  return hasLexicalTraitSupport(text, traitId);
}

module.exports = {
  STRONG_MATCH_STRENGTH,
  hasLexicalTraitSupport,
  shouldAcceptTraitMatch,
};
