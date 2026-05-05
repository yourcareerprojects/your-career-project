const crypto = require('crypto');

function clean(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Stable hash for selected trait IDs (order-independent).
 * @param {string[]} traitIds
 */
function hashTraitSet(traitIds) {
  const ids = Array.isArray(traitIds)
    ? [...new Set(traitIds.map((id) => clean(id)).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      )
    : [];
  return sha256Hex(ids.join('|'));
}

/**
 * Stable hash for role context strings shown to the LLM.
 * @param {{ title?: string, coreChallenge?: string, typicalFailure?: string, realWork?: string }} ctx
 */
function hashRoleContext(ctx) {
  const o = {
    title: clean(ctx?.title),
    coreChallenge: clean(ctx?.coreChallenge),
    typicalFailure: clean(ctx?.typicalFailure),
    realWork: clean(ctx?.realWork),
  };
  return sha256Hex(JSON.stringify(o));
}

module.exports = {
  hashTraitSet,
  hashRoleContext,
  clean,
  sha256Hex,
};
