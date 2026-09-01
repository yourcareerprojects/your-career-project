/**
 * Semantic trait discovery — maps evidence text to trait match strengths.
 * Used by evidenceProcessor via evidenceAggregation.js.
 */

const { embedTextBatch } = require('../embedding/embeddingService');
const { rankTraitScores } = require('./semanticTraitMatcher');
const {
  getTraitEmbeddingIndex,
  isTraitEmbeddingsAvailable,
} = require('./traitEmbeddingsStore');
const { normalizeEvidenceText } = require('./evidenceTextUtils');

const DEFAULT_MIN_SIMILARITY = 0.38;
const DEFAULT_TOP_K_DISCOVERY = 5;
/** Keep only matches within this cosine distance of the best hit for a text. */
const DEFAULT_RELATIVE_GAP = 0.06;

function parseEnvFloat(name, fallback) {
  const parsed = parseFloat(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvInt(name, fallback) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveDiscoveryConfig(options = {}) {
  return {
    minSimilarity:
      Number.isFinite(options.minSimilarity)
        ? options.minSimilarity
        : parseEnvFloat('IDENTITY_TRAIT_MIN_SIMILARITY', DEFAULT_MIN_SIMILARITY),
    topK:
      Number.isFinite(options.topK)
        ? options.topK
        : parseEnvInt('IDENTITY_TRAIT_TOP_K', DEFAULT_TOP_K_DISCOVERY),
    relativeGap:
      Number.isFinite(options.relativeGap)
        ? options.relativeGap
        : parseEnvFloat('IDENTITY_TRAIT_RELATIVE_GAP', DEFAULT_RELATIVE_GAP),
  };
}

/**
 * Map cosine similarity to the 0–1 strength scale consumed by evidence weights.
 *
 * @param {number} similarity
 * @param {number} minSimilarity
 * @returns {number}
 */
function similarityToStrength(similarity, minSimilarity) {
  if (!Number.isFinite(similarity) || similarity < minSimilarity) return 0;
  const span = 1 - minSimilarity;
  if (span <= 0) return 1;
  const normalized = (similarity - minSimilarity) / span;
  return Math.min(1, 0.35 + normalized * 0.65);
}

/**
 * @param {import('./semanticTraitMatcher').TraitScore[]} matches
 * @param {number} minSimilarity
 * @returns {Map<string, number>}
 */
function matchesToStrengthMap(matches, minSimilarity) {
  const scores = new Map();
  for (const match of matches || []) {
    const strength = similarityToStrength(match.similarity, minSimilarity);
    if (strength > 0) {
      scores.set(match.traitId, strength);
    }
  }
  return scores;
}

function semanticMatchesToStrengthMap(matches, config) {
  const filtered = filterMatchesByRelativeGap(matches, config.relativeGap);
  return matchesToStrengthMap(filtered, config.minSimilarity);
}

/**
 * Drop trailing near-threshold hits that are far weaker than the best match.
 * @param {import('./semanticTraitMatcher').TraitScore[]} matches
 * @param {number} relativeGap
 * @returns {import('./semanticTraitMatcher').TraitScore[]}
 */
function filterMatchesByRelativeGap(matches, relativeGap) {
  if (!Array.isArray(matches) || matches.length === 0) return [];
  const gap = Number.isFinite(relativeGap) ? Math.max(0, relativeGap) : DEFAULT_RELATIVE_GAP;
  const best = matches[0]?.similarity;
  if (!Number.isFinite(best)) return matches;
  const floor = best - gap;
  return matches.filter((match) => Number(match.similarity) >= floor);
}

/**
 * Create a trait discovery helper for one evidence processing run.
 * Loads the trait embedding index once and reuses it for every text in the batch.
 *
 * @param {object} [options]
 * @returns {{ config: object, discoverTraitsForTexts: (texts: string[]) => Promise<Map<string, Map<string, number>>> }}
 */
function createTraitDiscovery(options = {}) {
  const config = resolveDiscoveryConfig(options);
  const customDiscover = options.discoverTraitsFromText || null;
  const traitIndex = customDiscover ? null : getTraitEmbeddingIndex();

  async function discoverTraitsForTexts(texts) {
    const result = new Map();
    const normalizedInputs = (texts || []).map((text) => normalizeEvidenceText(text));
    if (normalizedInputs.every((text) => !text)) {
      return result;
    }

    if (customDiscover) {
      const unique = [...new Set(normalizedInputs.filter(Boolean))];
      for (const text of unique) {
        result.set(text, await customDiscover(text, config));
      }
      return result;
    }

    if (!isTraitEmbeddingsAvailable()) {
      throw new Error(
        'Identity trait embeddings are not available. Run: npm run build:identity-trait-embeddings'
      );
    }

    const unique = [...new Set(normalizedInputs.filter(Boolean))];
    const vectors = await embedTextBatch(unique);

    for (let i = 0; i < unique.length; i += 1) {
      const text = unique[i];
      const queryVector = vectors[i];
      if (!queryVector) {
        result.set(text, new Map());
        continue;
      }

      const matches = rankTraitScores(queryVector, traitIndex, {
        topK: config.topK,
        minSimilarity: config.minSimilarity,
      });
      result.set(text, semanticMatchesToStrengthMap(matches, config));
    }

    return result;
  }

  async function discoverTraitsFromText(text) {
    const normalized = normalizeEvidenceText(text);
    if (!normalized) return new Map();

    const matches = await discoverTraitsForTexts([normalized]);
    return matches.get(normalized) || new Map();
  }

  return {
    config,
    discoverTraitsForTexts,
    discoverTraitsFromText,
  };
}

module.exports = {
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_TOP_K_DISCOVERY,
  DEFAULT_RELATIVE_GAP,
  resolveDiscoveryConfig,
  similarityToStrength,
  semanticMatchesToStrengthMap,
  filterMatchesByRelativeGap,
  createTraitDiscovery,
};
