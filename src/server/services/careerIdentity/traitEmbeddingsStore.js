/**
 * Precomputed identity trait embeddings — loaded from disk, never generated at runtime.
 *
 * Regenerate after catalog changes:
 *   npm run build:identity-trait-embeddings
 *
 * See scripts/buildIdentityTraitEmbeddings.js for full documentation.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EMBEDDING_DIMS } = require('../embedding/embeddingService');
const { listTraitDefinitions } = require('../../../constants/identityTraitCatalog');

const EMBEDDINGS_FILE = path.join(
  __dirname,
  '../../../constants/identityTraitEmbeddings.json'
);

const EMBEDDING_MODEL = 'text-embedding-3-large';
const STORE_VERSION = 1;

/** @type {string} */
let embeddingsFilePath = EMBEDDINGS_FILE;

/** @type {Map<string, Float32Array> | null} */
let vectorByTraitId = null;

/** @type {{ traitIds: string[], vectors: Float32Array[] } | null} */
let embeddingIndex = null;

/** @type {object | null} */
let metadata = null;

/**
 * @typedef {{ traitIds: string[], vectors: Float32Array[] }} TraitEmbeddingIndex
 */

/**
 * Test hook — point the loader at a temporary embeddings file.
 * @param {string|null|undefined} filePath
 */
function __setEmbeddingsFileForTests(filePath) {
  embeddingsFilePath = filePath || EMBEDDINGS_FILE;
  resetTraitEmbeddingsCache();
  try {
    // Clear engine fingerprint memo so tests that swap embedding files stay consistent.
    const { resetIdentityEngineFingerprintCache } = require('./identityEngineFingerprint');
    resetIdentityEngineFingerprintCache();
  } catch {
    // Fingerprint module may be unavailable in partial test setups.
  }
}

function getActiveEmbeddingsFilePath() {
  return embeddingsFilePath;
}

function fileExists() {
  try {
    return fs.existsSync(embeddingsFilePath);
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {Float32Array|null}
 */
function toFloat32Vector(value) {
  if (!Array.isArray(value) || value.length !== EMBEDDING_DIMS) {
    return null;
  }
  const vec = new Float32Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const n = Number(value[i]);
    if (!Number.isFinite(n)) return null;
    vec[i] = n;
  }
  return vec;
}

function buildEmbeddingIndex(vectorMap) {
  const traitIds = [];
  const vectors = [];
  for (const [traitId, vector] of vectorMap.entries()) {
    traitIds.push(traitId);
    vectors.push(vector);
  }
  return { traitIds, vectors };
}

/**
 * Stable signature of embedding text hashes (not the vectors themselves).
 * Changes when catalog embedding text changes or traits are added/removed.
 * @param {Record<string, { textHash?: string }>} traits
 * @returns {string|null}
 */
function computeEmbeddingsContentSignature(traits) {
  if (!traits || typeof traits !== 'object') return null;
  const hash = crypto.createHash('sha256');
  const traitIds = Object.keys(traits).sort();
  if (traitIds.length === 0) return null;
  for (const traitId of traitIds) {
    hash.update(traitId);
    hash.update('\0');
    hash.update(String(traits[traitId]?.textHash || ''));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function loadFromDisk() {
  if (vectorByTraitId) {
    return { vectors: vectorByTraitId, meta: metadata };
  }

  vectorByTraitId = new Map();
  embeddingIndex = null;
  metadata = {
    available: false,
    model: EMBEDDING_MODEL,
    dims: EMBEDDING_DIMS,
    version: STORE_VERSION,
    builtAt: null,
    catalogTraitCount: listTraitDefinitions().length,
    embeddedTraitCount: 0,
    contentSignature: null,
    filePath: embeddingsFilePath,
  };

  if (!fileExists()) {
    return { vectors: vectorByTraitId, meta: metadata };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(embeddingsFilePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse identity trait embeddings at ${embeddingsFilePath}: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.traits || typeof parsed.traits !== 'object') {
    throw new Error(`Invalid identity trait embeddings file at ${embeddingsFilePath}`);
  }

  metadata = {
    available: true,
    model: parsed.model || EMBEDDING_MODEL,
    dims: parsed.dims || EMBEDDING_DIMS,
    version: parsed.version || STORE_VERSION,
    builtAt: parsed.builtAt || null,
    catalogTraitCount: parsed.catalogTraitCount || listTraitDefinitions().length,
    embeddedTraitCount: 0,
    contentSignature: computeEmbeddingsContentSignature(parsed.traits),
    filePath: embeddingsFilePath,
  };

  if (metadata.dims !== EMBEDDING_DIMS) {
    throw new Error(
      `Identity trait embeddings dims mismatch: expected ${EMBEDDING_DIMS}, got ${metadata.dims}`
    );
  }

  for (const [traitId, entry] of Object.entries(parsed.traits)) {
    const vec = toFloat32Vector(entry?.embedding);
    if (!vec) continue;
    vectorByTraitId.set(traitId, vec);
  }

  metadata.embeddedTraitCount = vectorByTraitId.size;
  embeddingIndex = buildEmbeddingIndex(vectorByTraitId);
  return { vectors: vectorByTraitId, meta: metadata };
}

/**
 * Eager-load trait embeddings into memory (call once at process startup).
 * @returns {boolean} true when embeddings are available
 */
function warmTraitEmbeddingsCache() {
  const { meta } = loadFromDisk();
  return Boolean(meta.available && meta.embeddedTraitCount > 0);
}

/**
 * Reset in-memory cache (for tests).
 */
function resetTraitEmbeddingsCache() {
  vectorByTraitId = null;
  embeddingIndex = null;
  metadata = null;
}

function isTraitEmbeddingsAvailable() {
  const { meta } = loadFromDisk();
  return Boolean(meta.available && meta.embeddedTraitCount > 0);
}

function getTraitEmbeddingsMetadata() {
  return { ...loadFromDisk().meta };
}

/**
 * Array-backed index for fast repeated similarity scans (no Map copies).
 * @returns {TraitEmbeddingIndex}
 */
function getTraitEmbeddingIndex() {
  loadFromDisk();
  if (!embeddingIndex) {
    embeddingIndex = buildEmbeddingIndex(vectorByTraitId || new Map());
  }
  return embeddingIndex;
}

/**
 * @param {string} traitId
 * @returns {Float32Array|null}
 */
function getTraitEmbedding(traitId) {
  const id = String(traitId || '').trim();
  if (!id) return null;
  const { vectors } = loadFromDisk();
  return vectors.get(id) || null;
}

/**
 * Cached trait vectors (read-only — do not mutate).
 * @returns {Map<string, Float32Array>}
 */
function getAllTraitEmbeddings() {
  return loadFromDisk().vectors;
}

function getTraitEmbeddingsFilePath() {
  return embeddingsFilePath;
}

module.exports = {
  EMBEDDINGS_FILE,
  EMBEDDING_MODEL,
  STORE_VERSION,
  computeEmbeddingsContentSignature,
  __setEmbeddingsFileForTests,
  resetTraitEmbeddingsCache,
  warmTraitEmbeddingsCache,
  isTraitEmbeddingsAvailable,
  getTraitEmbeddingsMetadata,
  getTraitEmbeddingIndex,
  getTraitEmbedding,
  getAllTraitEmbeddings,
  getTraitEmbeddingsFilePath,
  getActiveEmbeddingsFilePath,
};
