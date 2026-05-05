const { sha256Hex, clean } = require('./roleFitExplanationHashes');

/**
 * Stable role identifier for cache keys (user-scoped rows still include userId).
 * @param {object} role
 */
function canonicalRoleId(role) {
  const esco = clean(role?.escoId).toLowerCase();
  if (esco) return `esco:${esco}`;
  const title = clean(role?.title).toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
  if (title) return `title:${title}`;
  const desc = clean(role?.description).slice(0, 120);
  const h = sha256Hex(desc || 'unknown-role').slice(0, 24);
  return `digest:${h}`;
}

module.exports = { canonicalRoleId };
