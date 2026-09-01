/**
 * Semantic trait matching — ranks precomputed trait vectors by cosine similarity.
 * Production discovery is orchestrated via traitDiscovery.js.
 */

const { getTraitDefinition } = require('../../../constants/identityTraitCatalog');
const {
  getAllTraitEmbeddings,
  isTraitEmbeddingsAvailable,
  getTraitEmbeddingsMetadata,
  EMBEDDING_MODEL,
} = require('./traitEmbeddingsStore');
const { embedText, cosineSimilarity, EMBEDDING_DIMS } = require('../embedding/embeddingService');

const DEFAULT_TOP_K = 10;

/**
 * @typedef {Object} SemanticTraitMatch
 * @property {string} traitId
 * @property {number} similarity
 * @property {string} category
 * @property {{ en: string, de: string }} name
 * @property {{ en: string, de: string }} description
 */

/**
 * @typedef {Object} TraitScore
 * @property {string} traitId
 * @property {number} similarity
 */

function sortTraitScores(scored) {
  scored.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return a.traitId.localeCompare(b.traitId);
  });
  return scored;
}

function enrichTraitMatch(score) {
  const def = getTraitDefinition(score.traitId);
  return {
    traitId: score.traitId,
    similarity: score.similarity,
    category: def?.category || 'unknown',
    name: def?.name || { en: score.traitId, de: score.traitId },
    description: def?.description || { en: '', de: '' },
  };
}

/**
 * Lightweight trait scoring — no catalog lookups (used by identity discovery).
 *
 * @param {Float32Array} queryVector
 * @param {{ traitIds: string[], vectors: Float32Array[] }} traitIndex
 * @param {object} [options]
 * @returns {TraitScore[]}
 */
function rankTraitScores(queryVector, traitIndex, options = {}) {
  const topK = Number.isFinite(options.topK) ? options.topK : DEFAULT_TOP_K;
  const minSimilarity = Number.isFinite(options.minSimilarity) ? options.minSimilarity : 0;

  if (!queryVector || queryVector.length !== EMBEDDING_DIMS) {
    throw new Error(`Query vector must be a Float32Array of length ${EMBEDDING_DIMS}`);
  }
  if (!traitIndex?.traitIds?.length || !traitIndex?.vectors?.length) {
    throw new Error('No trait embeddings available. Run npm run build:identity-trait-embeddings first.');
  }

  const scored = [];
  for (let i = 0; i < traitIndex.traitIds.length; i += 1) {
    const similarity = cosineSimilarity(queryVector, traitIndex.vectors[i]);
    if (similarity < minSimilarity) continue;
    scored.push({ traitId: traitIndex.traitIds[i], similarity });
  }

  return sortTraitScores(scored).slice(0, Math.max(1, topK));
}

/**
 * Rank every trait embedding against a query vector (playground / enriched output).
 *
 * @param {Float32Array} queryVector
 * @param {Map<string, Float32Array>} traitEmbeddings
 * @param {object} [options]
 * @returns {SemanticTraitMatch[]}
 */
function rankTraitsByVector(queryVector, traitEmbeddings, options = {}) {
  if (!queryVector || queryVector.length !== EMBEDDING_DIMS) {
    throw new Error(`Query vector must be a Float32Array of length ${EMBEDDING_DIMS}`);
  }
  if (!traitEmbeddings || traitEmbeddings.size === 0) {
    throw new Error('No trait embeddings available. Run npm run build:identity-trait-embeddings first.');
  }

  const topK = Number.isFinite(options.topK) ? options.topK : DEFAULT_TOP_K;
  const minSimilarity = Number.isFinite(options.minSimilarity) ? options.minSimilarity : 0;
  const scored = [];

  for (const [traitId, traitVector] of traitEmbeddings.entries()) {
    const similarity = cosineSimilarity(queryVector, traitVector);
    if (similarity < minSimilarity) continue;
    scored.push({ traitId, similarity });
  }

  return sortTraitScores(scored)
    .slice(0, Math.max(1, topK))
    .map(enrichTraitMatch);
}

/**
 * Embed input text and return the top matching identity traits.
 *
 * @param {string} text
 * @param {object} [options]
 * @returns {Promise<SemanticTraitMatch[]>}
 */
async function matchTraitsSemantically(text, options = {}) {
  if (!isTraitEmbeddingsAvailable()) {
    const meta = getTraitEmbeddingsMetadata();
    throw new Error(
      `Trait embeddings are not available (${meta.embeddedTraitCount} loaded). ` +
        'Run: npm run build:identity-trait-embeddings'
    );
  }

  const traitEmbeddings = options.traitEmbeddings || getAllTraitEmbeddings();
  let queryVector = options.queryVector || null;

  if (!queryVector) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return [];
    }
    queryVector = await embedText(trimmed);
    if (!queryVector) {
      return [];
    }
  }

  return rankTraitsByVector(queryVector, traitEmbeddings, options);
}

function getSemanticMatcherMetadata() {
  return {
    embeddingModel: EMBEDDING_MODEL,
    dims: EMBEDDING_DIMS,
    traitEmbeddings: getTraitEmbeddingsMetadata(),
  };
}

module.exports = {
  DEFAULT_TOP_K,
  rankTraitScores,
  rankTraitsByVector,
  matchTraitsSemantically,
  getSemanticMatcherMetadata,
};
