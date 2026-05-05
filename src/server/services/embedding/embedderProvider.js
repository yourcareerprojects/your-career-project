const { embedTextSafe } = require('./embeddingService');

/**
 * Phase 3: ML-ready embedding provider interface.
 *
 * Design goal:
 * - MMR logic stays unchanged.
 * - Callers can precompute embeddings asynchronously (neural providers) and
 *   then pass an async `embedFn` that reads from a cache.
 *
 * This module provides a canonical provider id + version for payloads.
 */

function getDefaultEmbeddingMetadata() {
  return {
    embeddingProvider: 'openai',
    embeddingVersion: 'text-embedding-3-large'
  };
}

function getOpenAIEmbedder() {
  return {
    ...getDefaultEmbeddingMetadata(),
    embedText: (text) => embedTextSafe(text)
  };
}

/** @deprecated Use getOpenAIEmbedder. Kept for backward compatibility. */
function getHashEmbedder() {
  return getOpenAIEmbedder();
}

module.exports = {
  getDefaultEmbeddingMetadata,
  getOpenAIEmbedder,
  getHashEmbedder
};

