/**
 * Semantic embeddings for diversity/serendipity via OpenAI text-embedding-3-large.
 *
 * Replaces the previous hash-based bag-of-words implementation with true semantic
 * embeddings. Cosine similarity, MMR, and weighting logic remain unchanged.
 */
// ENGLISH_ONLY_PIPELINE: Embedding inputs must be canonical English.

const OpenAI = require('openai').default;
const logger = require('../../utils/logger');
const { TIMEOUT_MS_LLM } = require('../../utils/httpTimeouts');
const { getEnglishField } = require('../../utils/i18nFields');
const { normalizeForEmbedding, containsGerman } = require('../ai/normalizeForEmbedding');

/**
 * Lazily construct the client so CLI scripts can load dotenv before the first require
 * of this module (static init would otherwise freeze an empty API key).
 */
let openaiClient = null;

function getOpenAI() {
  if (!openaiClient) {
    const apiKey = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
    const embeddingTimeoutMs =
      Number.parseInt(process.env.OPENAI_EMBEDDING_TIMEOUT_MS || '', 10) || TIMEOUT_MS_LLM;
    openaiClient = new OpenAI({
      apiKey,
      timeout: embeddingTimeoutMs,
    });
  }
  return openaiClient;
}

/** ~8191 token budget for text-embedding-3-*; use a conservative char cap */
const MAX_EMBEDDING_INPUT_CHARS = 28000;

/**
 * Ensure embedding inputs are valid strings for JSON and the API: strip C0 controls
 * (except tab/newline), cap length, avoid empty payload.
 *
 * @param {unknown} text
 * @returns {string}
 */
function sanitizeEmbeddingInput(text) {
  if (text == null) return ' ';
  let s = String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  if (s.length > MAX_EMBEDDING_INPUT_CHARS) {
    s = s.slice(0, MAX_EMBEDDING_INPUT_CHARS);
  }
  s = s.trim();
  return s.length === 0 ? ' ' : s;
}

/** In-memory cache for repeated identical text inputs during one request */
const embedCache = new Map();
const CACHE_MAX_SIZE = 500;

/**
 * L2-normalize a vector. Mutates in place. Returns the same array reference.
 * Works with Float32Array or regular array.
 */
function l2Normalize(vec) {
  if (!vec || vec.length === 0) return vec;
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/**
 * Embed text using OpenAI text-embedding-3-large.
 * Returns L2-normalized Float32Array (3072 dimensions).
 *
 * @param {string} text
 * @returns {Promise<Float32Array|null>}
 */
async function embedText(text) {
  if (!text || !text.trim()) {
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error(
      'OPENAI_API_KEY is not set. Add it to your .env file to use semantic embeddings for career matching.'
    );
  }

  const key = sanitizeEmbeddingInput(text);
  if (embedCache.has(key)) {
    return embedCache.get(key);
  }

  let response;
  try {
    // encoding_format: float — explicit for compatibility with OpenAI-compatible proxies
    // and gateways that mishandle the SDK default of base64 (can surface as 400 / parse errors).
    response = await getOpenAI().embeddings.create({
      model: 'text-embedding-3-large',
      input: key,
      encoding_format: 'float',
    });
  } catch (err) {
    logger.error('OpenAI embeddings API request failed', err);
    const msg = err.message || String(err);
    if (msg.includes('Incorrect API key') || msg.includes('invalid_api_key')) {
      throw new Error('OpenAI API key is invalid. Check OPENAI_API_KEY in your .env file.');
    }
    if (msg.includes('rate limit') || msg.includes('Rate limit')) {
      throw new Error('OpenAI API rate limit exceeded. Please try again in a moment.');
    }
    if (msg.includes('timed out') || msg.includes('timeout')) {
      throw new Error('Embedding API request timed out. Check your network connection and OpenAI API status. Role vectors are precomputed; user profile embedding runs per simulation.');
    }
    throw new Error(`Embedding API error: ${msg}`);
  }

  const embedding = response.data[0].embedding;
  const vec = new Float32Array(Array.isArray(embedding) ? embedding : Array.from(embedding));
  const normalized = l2Normalize(vec);

  // Simple cache eviction: FIFO when over limit
  if (embedCache.size >= CACHE_MAX_SIZE) {
    const firstKey = embedCache.keys().next().value;
    if (firstKey !== undefined) embedCache.delete(firstKey);
  }
  embedCache.set(key, normalized);

  return normalized;
}

/**
 * Embed after canonical English normalization (translations/heuristics live in normalizeForEmbedding).
 *
 * @param {unknown} input
 * @param {object} [options]
 * @param {object} [options.normalizeOptions] – forwarded to normalizeForEmbedding
 * @returns {Promise<Float32Array|null>}
 */
async function embedTextSafe(input, options = {}) {
  const normalized = await normalizeForEmbedding(input, options.normalizeOptions || {});
  const trimmed = String(normalized || '').trim();
  if (!trimmed) {
    return null;
  }
  if (containsGerman(trimmed)) {
    console.warn('[embedTextSafe] Non-English markers remain after normalization');
  }
  return embedText(trimmed);
}

/**
 * Batch embed with per-row normalization (parallel normalize, then existing batch embed).
 *
 * @param {unknown[]} texts
 * @param {object} [options]
 * @returns {Promise<(Float32Array|null)[]>}
 */
async function embedTextBatchSafe(texts, options = {}) {
  const normOpts = options.normalizeOptions || {};
  const normalized = await Promise.all((texts || []).map((t) => normalizeForEmbedding(t, normOpts)));
  for (let i = 0; i < normalized.length; i += 1) {
    const row = String(normalized[i] || '').trim();
    if (row && containsGerman(row)) {
      console.warn('[embedTextBatchSafe] Non-English markers remain after normalization');
    }
  }
  return embedTextBatch(normalized);
}

/** Max texts per batch (OpenAI limit is 2048) */
const BATCH_SIZE = 100;

/**
 * Embed multiple texts in batched API calls. Much faster than sequential embedText.
 * Deduplicates and uses cache. Returns array aligned with input (null for empty inputs).
 *
 * @param {string[]} texts
 * @returns {Promise<(Float32Array|null)[]>}
 */
async function embedTextBatch(texts) {
  if (!texts || texts.length === 0) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error(
      'OPENAI_API_KEY is not set. Add it to your .env file to use semantic embeddings for career matching.'
    );
  }

  const results = new Array(texts.length).fill(null);
  const toFetch = [];
  const indices = [];

  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    if (!t || !String(t).trim()) continue;
    const key = sanitizeEmbeddingInput(String(t));
    if (embedCache.has(key)) {
      results[i] = embedCache.get(key);
    } else {
      toFetch.push(key);
      indices.push(i);
    }
  }

  if (toFetch.length === 0) return results;

  for (let start = 0; start < toFetch.length; start += BATCH_SIZE) {
    const chunk = toFetch.slice(start, start + BATCH_SIZE);
    const idxChunk = indices.slice(start, start + BATCH_SIZE);

    let response;
    try {
      response = await getOpenAI().embeddings.create({
        model: 'text-embedding-3-large',
        input: chunk,
        encoding_format: 'float',
      });
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('Incorrect API key') || msg.includes('invalid_api_key')) {
        throw new Error('OpenAI API key is invalid. Check OPENAI_API_KEY in your .env file.');
      }
      if (msg.includes('rate limit') || msg.includes('Rate limit')) {
        throw new Error('OpenAI API rate limit exceeded. Please try again in a moment.');
      }
      if (msg.includes('timed out') || msg.includes('timeout')) {
        throw new Error('Embedding API request timed out. Check your network connection and OpenAI API status. Role vectors are precomputed; user profile embedding runs per simulation.');
      }
      throw new Error(`Embedding API error: ${msg}`);
    }

    const data = response.data || [];
    for (let j = 0; j < data.length && j < idxChunk.length; j++) {
      const emb = data[j].embedding;
      const vec = new Float32Array(Array.isArray(emb) ? emb : Array.from(emb));
      const normalized = l2Normalize(vec);
      const origIdx = idxChunk[j];
      results[origIdx] = normalized;
      const key = chunk[j];
      if (embedCache.size < CACHE_MAX_SIZE) embedCache.set(key, normalized);
    }
  }

  return results;
}

/**
 * Clear the embedding cache (e.g. between requests if needed).
 * Exported for testing.
 */
function clearEmbedCache() {
  embedCache.clear();
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  if (dot > 1) return 1;
  if (dot < -1) return -1;
  return dot;
}

/**
 * Weighted fusion of two vectors: w1 * a + w2 * b, then L2-normalized.
 * Returns a new Float32Array.
 */
function weightedFusion(a, b, { w1 = 0.6, w2 = 0.4 } = {}) {
  if (!a || !b || a.length !== b.length) return null;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = w1 * a[i] + w2 * b[i];
  }
  return l2Normalize(out);
}

/**
 * Weighted fusion of N vectors: sum(weights[i] * vectors[i]), then L2-normalized.
 * Each vector must be L2-normalized before calling.
 * Dimension inferred from first vector.
 *
 * @param {Float32Array[]} vectors
 * @param {number[]} weights
 * @param {number} [dims] - optional, inferred from vectors[0].length if omitted
 * @returns {Float32Array}
 */
function weightedFusionMulti(vectors, weights, dims) {
  const inferredDims = dims ?? vectors[0]?.length ?? 0;
  if (!vectors || vectors.length === 0 || !weights || weights.length !== vectors.length) {
    return new Float32Array(inferredDims);
  }
  const out = new Float32Array(inferredDims);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    const w = weights[i];
    if (!v || v.length !== inferredDims || typeof w !== 'number') continue;
    for (let j = 0; j < inferredDims; j++) {
      out[j] += w * v[j];
    }
  }
  return l2Normalize(out);
}

function buildCareerStepEmbeddingText(step, { category } = {}) {
  const title = step?.title != null ? getEnglishField(step.title) : '';
  const desc = step?.description != null ? getEnglishField(step.description) : '';
  const skills = Array.isArray(step && step.requiredSkills) ? step.requiredSkills.join(' ') : '';
  const cat = category || step.category || '';
  return `${title}\n${desc}\n${skills}\n${cat}`.trim();
}

/** OpenAI embedding dimension (text-embedding-3-large) */
const EMBEDDING_DIMS = 3072;

/**
 * Greedy MMR reranking for diversity.
 * scoreFn returns base relevance (higher better).
 * embedFn may be async; mmrSelect awaits it.
 * If precomputedEmbedMap is provided, uses it instead of calling embedFn (avoids API calls).
 *
 * Each greedy step min–max normalizes base and novelty across **eligible** pool items (those passing
 * minNovelty) to [0, 1], then mixes: λ × baseNorm + (1 − λ) × noveltyNorm. Raw base/novelty are
 * still returned on `diversity` for explainability. When spans are zero, a normalized arm is 1.
 *
 * @param {Array<object>} items
 * @param {object} options { k, lambda, minNovelty, embedFn, scoreFn, precomputedEmbedMap }
 * @returns {Promise<Array<object>>} selected items, each annotated with diversity metadata
 */
async function mmrSelect(items, options = {}) {
  const k = typeof options.k === 'number' ? options.k : 25;
  const lambda = typeof options.lambda === 'number' ? options.lambda : 0.75;
  const minNovelty = typeof options.minNovelty === 'number' ? options.minNovelty : 0;
  const normalizationMode = options.normalizationMode === 'global' ? 'global' : 'per_step';

  const precomputedEmbedMap = options.precomputedEmbedMap;
  const embedFn = options.embedFn || ((it) => embedTextSafe(buildCareerStepEmbeddingText(it)));
  const scoreFn = options.scoreFn || ((it) => (typeof it.score === 'number' ? it.score : 0));

  const pool = Array.isArray(items) ? items.slice() : [];
  if (pool.length === 0) return [];

  const embeddings = new Map(precomputedEmbedMap || []);
  const getEmb = async (it) => {
    if (embeddings.has(it)) return embeddings.get(it);
    const e = await embedFn(it);
    embeddings.set(it, e);
    return e;
  };

  const selected = [];
  const NORM_EPS = 1e-9;
  let globalBaseMin = Infinity;
  let globalBaseMax = -Infinity;
  const globalNovMin = minNovelty;
  const globalNovMax = 1;

  if (normalizationMode === 'global') {
    for (const candidate of pool) {
      const base = await Promise.resolve(scoreFn(candidate));
      if (base < globalBaseMin) globalBaseMin = base;
      if (base > globalBaseMax) globalBaseMax = base;
    }
    if (!Number.isFinite(globalBaseMin) || !Number.isFinite(globalBaseMax)) {
      globalBaseMin = 0;
      globalBaseMax = 0;
    }
  }

  while (selected.length < k && pool.length > 0) {
    const eligible = [];
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      const base = await Promise.resolve(scoreFn(candidate));
      let maxSim = 0;
      if (selected.length > 0) {
        const candEmb = await getEmb(candidate);
        for (const s of selected) {
          const sim = cosineSimilarity(candEmb, await getEmb(s));
          if (sim > maxSim) maxSim = sim;
        }
      }
      const novelty = 1 - maxSim;
      if (novelty < minNovelty) continue;
      eligible.push({ poolIndex: i, candidate, base, novelty, maxSim });
    }

    if (eligible.length === 0) {
      const picked = pool.splice(0, 1)[0];
      const pickedScore = await Promise.resolve(scoreFn(picked));
      selected.push({
        ...picked,
        diversity: {
          baseScore: pickedScore,
          maxSimilarityToSelected: 0,
          noveltyScore: 1,
          mmrScore: pickedScore,
        },
      });
      continue;
    }

    let minBase = Infinity;
    let maxBase = -Infinity;
    let minNov = Infinity;
    let maxNov = -Infinity;
    if (normalizationMode === 'per_step') {
      for (const r of eligible) {
        if (r.base < minBase) minBase = r.base;
        if (r.base > maxBase) maxBase = r.base;
        if (r.novelty < minNov) minNov = r.novelty;
        if (r.novelty > maxNov) maxNov = r.novelty;
      }
    } else {
      minBase = globalBaseMin;
      maxBase = globalBaseMax;
      minNov = globalNovMin;
      maxNov = globalNovMax;
    }
    const baseSpan = maxBase - minBase;
    const novSpan = maxNov - minNov;

    let bestPoolIndex = eligible[0].poolIndex;
    let bestValue = -Infinity;
    let bestMeta = null;

    for (const r of eligible) {
      const baseNormRaw = baseSpan < NORM_EPS ? 1 : (r.base - minBase) / baseSpan;
      const novNormRaw = novSpan < NORM_EPS ? 1 : (r.novelty - minNov) / novSpan;
      const baseNorm = Math.max(0, Math.min(1, baseNormRaw));
      const novNorm = Math.max(0, Math.min(1, novNormRaw));
      const value = (lambda * baseNorm) + ((1 - lambda) * novNorm);
      if (value > bestValue) {
        bestValue = value;
        bestPoolIndex = r.poolIndex;
        bestMeta = {
          baseScore: r.base,
          maxSimilarityToSelected: r.maxSim,
          noveltyScore: r.novelty,
          mmrScore: value,
          baseScoreNormalized: baseNorm,
          noveltyScoreNormalized: novNorm,
        };
      }
    }

    const picked = pool.splice(bestPoolIndex, 1)[0];
    const pickedScore = await Promise.resolve(scoreFn(picked));
    selected.push({
      ...picked,
      diversity: bestMeta || {
        baseScore: pickedScore,
        maxSimilarityToSelected: 0,
        noveltyScore: 1,
        mmrScore: pickedScore,
      },
    });
  }

  return selected;
}

module.exports = {
  embedText,
  embedTextSafe,
  embedTextBatchSafe,
  embedTextBatch,
  sanitizeEmbeddingInput,
  cosineSimilarity,
  l2Normalize,
  weightedFusion,
  weightedFusionMulti,
  buildCareerStepEmbeddingText,
  mmrSelect,
  clearEmbedCache,
  EMBEDDING_DIMS,
};
