/**
 * Fingerprint of Career Identity engine inputs that should invalidate cached profiles
 * even when user source data is unchanged (catalog, thresholds, embeddings, scoring).
 *
 * Bump IDENTITY_ENGINE_LOGIC_VERSION when matching/scoring *code* changes in a way
 * that is not already reflected by the hashed constants below.
 */

const crypto = require('crypto');
const { listTraitDefinitions } = require('../../../constants/identityTraitCatalog');
const {
  IDENTITY_PUZZLE_THRESHOLDS,
  IDENTITY_PUZZLE_LIMITS,
} = require('../../../constants/identityPuzzleThresholds');
const {
  MAX_CONFIDENCE,
  MAX_EFFECTIVE_WEIGHT,
  WITHIN_SOURCE_DIMINISHING,
  CROSS_SOURCE_DIMINISHING,
  SOURCE_CONFIRMATION_BONUS,
} = require('./traitConfidenceCalculator');
const {
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_TOP_K_DISCOVERY,
  DEFAULT_RELATIVE_GAP,
} = require('./traitDiscovery');
const { VOTE_EVIDENCE_WEIGHT, VOTE_EVIDENCE_STRENGTH } = require('./traitVoteEvidence');
const { getTraitEmbeddingsMetadata } = require('./traitEmbeddingsStore');

/**
 * Bump when identity matching/scoring code changes without touching the constants
 * hashed in {@link buildIdentityEngineFingerprintPayload}.
 */
const IDENTITY_ENGINE_LOGIC_VERSION = 1;

/** @type {string|null} */
let cachedFingerprint = null;

/**
 * Stable payload describing the current identity engine configuration.
 * @param {object} [overrides]
 * @returns {object}
 */
function buildIdentityEngineFingerprintPayload(overrides = {}) {
  const catalog = listTraitDefinitions()
    .map((trait) => ({
      id: trait.id,
      category: trait.category,
      name: trait.name,
      description: trait.description,
      keywords: [...(trait.keywords || [])].sort(),
      relatedTraitIds: [...(trait.relatedTraitIds || [])].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const embeddings = getTraitEmbeddingsMetadata();

  return {
    logicVersion: IDENTITY_ENGINE_LOGIC_VERSION,
    catalog,
    puzzle: {
      thresholds: { ...IDENTITY_PUZZLE_THRESHOLDS },
      limits: { ...IDENTITY_PUZZLE_LIMITS },
    },
    confidence: {
      MAX_CONFIDENCE,
      MAX_EFFECTIVE_WEIGHT,
      WITHIN_SOURCE_DIMINISHING,
      CROSS_SOURCE_DIMINISHING,
      SOURCE_CONFIRMATION_BONUS,
    },
    discovery: {
      DEFAULT_MIN_SIMILARITY,
      DEFAULT_TOP_K_DISCOVERY,
      DEFAULT_RELATIVE_GAP,
    },
    votes: {
      VOTE_EVIDENCE_WEIGHT,
      VOTE_EVIDENCE_STRENGTH,
    },
    embeddings: {
      available: Boolean(embeddings.available),
      model: embeddings.model || null,
      dims: embeddings.dims || null,
      version: embeddings.version || null,
      builtAt: embeddings.builtAt || null,
      catalogTraitCount: embeddings.catalogTraitCount || 0,
      embeddedTraitCount: embeddings.embeddedTraitCount || 0,
      contentSignature: embeddings.contentSignature || null,
    },
    ...overrides,
  };
}

/**
 * @param {object} payload
 * @returns {string}
 */
function hashFingerprintPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * SHA-256 of the current engine configuration (catalog, thresholds, embeddings, …).
 * Memoized for the process lifetime; call {@link resetIdentityEngineFingerprintCache}
 * after swapping embeddings in tests.
 * @param {object} [overrides] when provided, bypasses the cache (for tests)
 * @returns {string}
 */
function computeIdentityEngineFingerprint(overrides) {
  if (overrides && Object.keys(overrides).length > 0) {
    return hashFingerprintPayload(buildIdentityEngineFingerprintPayload(overrides));
  }
  if (cachedFingerprint) return cachedFingerprint;
  cachedFingerprint = hashFingerprintPayload(buildIdentityEngineFingerprintPayload());
  return cachedFingerprint;
}

function resetIdentityEngineFingerprintCache() {
  cachedFingerprint = null;
}

/**
 * Whether a stored profile can be returned without re-running the evidence pipeline.
 * Empty `traits` is a valid computed state (fingerprints present) — must be reusable,
 * otherwise GET /career-identity keeps recomputing → emitting puzzle_updated → pipeline
 * → SSE invalidate → GET, in a tight loop for users with no puzzle pieces yet.
 *
 * @param {{ sourceFingerprint?: string, engineFingerprint?: string, traits?: unknown[] }|null|undefined} profile
 * @param {string} sourceFingerprint
 * @param {string} engineFingerprint
 * @returns {boolean}
 */
function shouldReuseCachedIdentity(profile, sourceFingerprint, engineFingerprint) {
  return Boolean(
    profile &&
      profile.sourceFingerprint === sourceFingerprint &&
      profile.engineFingerprint === engineFingerprint &&
      Array.isArray(profile.traits)
  );
}

module.exports = {
  IDENTITY_ENGINE_LOGIC_VERSION,
  buildIdentityEngineFingerprintPayload,
  hashFingerprintPayload,
  computeIdentityEngineFingerprint,
  resetIdentityEngineFingerprintCache,
  shouldReuseCachedIdentity,
};
