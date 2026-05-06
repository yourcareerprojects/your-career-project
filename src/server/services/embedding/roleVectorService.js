/**
 * Role Vector Service
 *
 * Builds role vectors for matching:
 *   - structured_vector_*: five category sub-vectors (stored, no seniority); fusion order is
 *     skill_domains → occupation_group → responsibilities → required_skills → optional_skills
 *   - identity_vector: embedding of role identity text
 *   - hybrid_vector: 0.6 * (NEXT_ROLE fusion of sub-vectors) + 0.4 * identity (legacy getEmbeddingForMatching)
 *   - finalVectors: precomputed L2-normalized role vectors per mode for runtime dot-product scoring
 *
 * finalVectors are precomputed and stored during build. Runtime scoring should use these directly.
 *
 * Fully deterministic. No external calls.
 *
 * @module services/embedding/roleVectorService
 */
// ENGLISH_ONLY_PIPELINE: Stored role vectors are built from canonical English role content.

const { embedTextSafe, weightedFusion, weightedFusionMulti, l2Normalize } = require('./embeddingService');
const {
  buildStructuredCategoryTexts,
  WEIGHTS_NEXT_ROLE,
  WEIGHTS_OUT_OF_THE_BOX,
} = require('./structuredTextBuilder');

const STRUCTURED_WEIGHT = 0.6;
const IDENTITY_WEIGHT = 0.4;
const { EMBEDDING_DIMS } = require('./embeddingService');
const MODE_TO_FINAL_VECTOR_KEY = {
  DEFAULT: 'default',
  NEXT_ROLE: 'nextRole',
  OUT_OF_THE_BOX: 'outOfTheBox',
};

/** Fusion / embed order: skill domains, occupation group, key responsibilities, required skills, optional skills */
const CATEGORY_ORDER = ['skill_domains', 'occupation_group', 'responsibilities', 'required_skills', 'optional_skills'];

const STRUCTURED_VECTOR_FIELD_BY_CATEGORY = {
  occupation_group: 'structured_vector_occupation_group',
  skill_domains: 'structured_vector_skill_domains',
  responsibilities: 'structured_vector_responsibilities',
  required_skills: 'structured_vector_required_skills',
  optional_skills: 'structured_vector_optional_skills',
};

function structuredSubVectorKeysInOrder() {
  return CATEGORY_ORDER.map((k) => STRUCTURED_VECTOR_FIELD_BY_CATEGORY[k]);
}

const warnedMissingFinalVectors = new Set();

function warnMissingPrecomputedFinalVectors(roleLike, mode) {
  const id = String(roleLike?._id || roleLike?.escoId || roleLike?.title?.en || roleLike?.title || 'unknown');
  const key = `${id}:${mode}`;
  if (warnedMissingFinalVectors.has(key)) return;
  warnedMissingFinalVectors.add(key);
  console.warn(`Missing precomputed finalVectors (${mode})`);
}

/**
 * Build category sub-vectors and fuse with given weights.
 * Each sub-vector is L2-normalized before fusion; result is L2-normalized.
 *
 * @param {object} doc – CareerPath document
 * @param {object} weights – category weights matching CATEGORY_ORDER keys
 * @returns {Promise<Float32Array>}
 */
async function buildStructuredVectorFromCategories(doc, weights) {
  const texts = buildStructuredCategoryTexts(doc);
  const vectors = [];
  const weightArr = [];

  for (const key of CATEGORY_ORDER) {
    const text = texts[key];
    const vec = await embedTextSafe(text || ' ');
    if (vec) l2Normalize(vec);
    vectors.push(vec);
    weightArr.push(weights[key] || 0);
  }

  return weightedFusionMulti(vectors, weightArr);
}

/**
 * Build all role vectors for a CareerPath document.
 *
 * Requires roleIdentity.role_identity_text to exist.
 * Run buildRoleIdentityTexts before buildRoleVectors.
 *
 * @param {object} doc – CareerPath document (or lean object)
 * @returns {Promise<{
 *   structured_vector_occupation_group: number[],
 *   structured_vector_skill_domains: number[],
 *   structured_vector_responsibilities: number[],
 *   structured_vector_required_skills: number[],
 *   structured_vector_optional_skills: number[],
 *   structured_vector_seniority: null,
 *   identity_vector: number[],
 *   hybrid_vector: number[],
 *   finalVectors: {
 *     default: number[],
 *     nextRole: number[],
 *     outOfTheBox: number[],
 *   },
 *   built_at: Date,
 *   dims: number
 * } | null>} null if identity text is missing
 */
async function buildRoleVectors(doc) {
  const dims = EMBEDDING_DIMS;

  // Identity text (must exist)
  const identityText = doc.roleIdentity?.role_identity_text;
  if (!identityText || typeof identityText !== 'string') {
    return null;
  }

  const texts = buildStructuredCategoryTexts(doc);
  const hasAnyStructured = Object.values(texts).some((t) => t && t.trim());

  if (!hasAnyStructured) {
    const idVec = await embedTextSafe(identityText);
    if (!idVec) return null;
    const idArr = Array.from(idVec);
    return {
      structured_vector_occupation_group: null,
      structured_vector_skill_domains: null,
      structured_vector_responsibilities: null,
      structured_vector_required_skills: null,
      structured_vector_optional_skills: null,
      structured_vector_seniority: null,
      identity_vector: idArr,
      hybrid_vector: idArr,
      finalVectors: {
        default: idArr,
        nextRole: idArr,
        outOfTheBox: idArr,
      },
      built_at: new Date(),
      dims,
    };
  }

  // Build five category sub-vectors (each L2-normalized by embedTextSafe + explicit normalize)
  const subVectors = [];
  const zeroVec = new Float32Array(dims);
  for (const key of CATEGORY_ORDER) {
    const text = texts[key];
    const vec = await embedTextSafe(text || ' ');
    if (vec) {
      l2Normalize(vec);
      subVectors.push(vec);
    } else {
      subVectors.push(zeroVec);
    }
  }

  const weightArr = CATEGORY_ORDER.map((k) => WEIGHTS_NEXT_ROLE[k] || 0);
  const structuredVec = weightedFusionMulti(subVectors, weightArr);

  const identityVec = await embedTextSafe(identityText);
  if (!identityVec) return null;
  l2Normalize(identityVec);

  const hybridVec = weightedFusion(structuredVec, identityVec, {
    w1: STRUCTURED_WEIGHT,
    w2: IDENTITY_WEIGHT,
  });
  const nextRoleVec = weightedFusion(structuredVec, identityVec, { w1: 0.75, w2: 0.25 });
  const outOfTheBoxVec = weightedFusion(structuredVec, identityVec, { w1: 0.45, w2: 0.55 });
  if (!hybridVec || !nextRoleVec || !outOfTheBoxVec) return null;

  const out = {
    structured_vector_seniority: null,
    identity_vector: Array.from(identityVec),
    hybrid_vector: Array.from(hybridVec),
    finalVectors: {
      default: Array.from(hybridVec),
      nextRole: Array.from(nextRoleVec),
      outOfTheBox: Array.from(outOfTheBoxVec),
    },
    built_at: new Date(),
    dims,
  };
  CATEGORY_ORDER.forEach((key, i) => {
    out[STRUCTURED_VECTOR_FIELD_BY_CATEGORY[key]] = Array.from(subVectors[i]);
  });
  return out;
}

/**
 * Get embedding for a step/career path for similarity matching.
 * Prefers hybrid_vector when available; otherwise falls back to text-based embedding.
 *
 * @param {object} step – Step or CareerPath with optional hybrid_vector
 * @param {Function} fallbackEmbedFn – (step) => Promise<Float32Array> when no hybrid_vector
 * @returns {Promise<Float32Array>}
 */
async function getEmbeddingForMatching(step, fallbackEmbedFn) {
  const hybrid = step.roleVectors?.hybrid_vector || step.hybrid_vector;
  if (hybrid && Array.isArray(hybrid) && hybrid.length > 0) {
    return new Float32Array(hybrid);
  }
  return fallbackEmbedFn(step);
}

/**
 * Get mode-specific hybrid vector for a step/role.
 * Uses structured sub-vectors + identity_vector when available; otherwise falls back.
 *
 * @param {object} step – Step or CareerPath with optional roleVectors
 * @param {'NEXT_ROLE'|'OUT_OF_THE_BOX'} mode
 * @param {Function} fallbackEmbedFn – (step) => Promise<Float32Array> when vectors missing
 * @returns {Promise<Float32Array>}
 */
async function getHybridVectorForMode(step, mode, fallbackEmbedFn) {
  const precomputed = getPrecomputedFinalVector(step, mode);
  if (precomputed) {
    return precomputed;
  }
  warnMissingPrecomputedFinalVectors(step, mode);
  return fallbackEmbedFn(step);
}

function getPrecomputedFinalVector(role, mode = 'DEFAULT') {
  const rv = role?.roleVectors || role;
  if (!rv || typeof rv !== 'object') return null;

  const dims = rv.dims || EMBEDDING_DIMS;
  if (dims !== EMBEDDING_DIMS) return null;

  const finalKey = MODE_TO_FINAL_VECTOR_KEY[mode] || MODE_TO_FINAL_VECTOR_KEY.DEFAULT;
  const vec = rv.finalVectors?.[finalKey];
  if (Array.isArray(vec) && vec.length === dims) {
    return new Float32Array(vec);
  }
  return null;
}

/**
 * Get mode-specific structured vector from stored sub-vectors.
 * Computed at runtime; not stored. Returns null if sub-vectors are missing.
 * Supports backward compatibility: legacy six-pack (incl. seniority sub-vector, ignored) and
 * old schema (structured_vector_domains) maps to skill_domains.
 *
 * @param {object} role – Role with roleVectors
 * @param {'NEXT_ROLE'|'OUT_OF_THE_BOX'} mode
 * @returns {Float32Array|null}
 */
function getStructuredVectorForMode(role, mode) {
  const rv = role.roleVectors || role;
  const dims = rv.dims || EMBEDDING_DIMS;
  // Only use stored vectors if they match current embedding dimension (post-migration)
  if (dims !== EMBEDDING_DIMS) return null;

  const weights = mode === 'OUT_OF_THE_BOX' ? WEIGHTS_OUT_OF_THE_BOX : WEIGHTS_NEXT_ROLE;

  const weightArr = CATEGORY_ORDER.map((k) => weights[k] || 0);

  const subKeysFive = structuredSubVectorKeysInOrder();

  const hasFivePack = subKeysFive.every((k) => rv[k] && Array.isArray(rv[k]) && rv[k].length === dims);
  if (hasFivePack) {
    const vectors = subKeysFive.map((k) => new Float32Array(rv[k]));
    return weightedFusionMulti(vectors, weightArr, dims);
  }

  // Legacy stored roleVectors with seniority sub-vector — fuse five categories only (same key order)
  const subKeysSix = [...subKeysFive, 'structured_vector_seniority'];
  const hasLegacySixPack = subKeysSix.every((k) => rv[k] && Array.isArray(rv[k]) && rv[k].length === dims);
  if (hasLegacySixPack) {
    const vectors = subKeysFive.map((k) => new Float32Array(rv[k]));
    return weightedFusionMulti(vectors, weightArr, dims);
  }

  // Old schema: structured_vector_domains (no occupation_group); seniority sub-vector ignored if present
  const oldBaseKeys = [
    'structured_vector_domains',
    'structured_vector_required_skills',
    'structured_vector_responsibilities',
    'structured_vector_optional_skills',
  ];
  const hasOldDomains = oldBaseKeys.every((k) => rv[k] && Array.isArray(rv[k]) && rv[k].length === dims);
  if (hasOldDomains) {
    // structured_vector_domains = skill_domains; no occupation_group in old schema
    const vectors = [
      new Float32Array(dims), // occupation_group
      new Float32Array(rv.structured_vector_domains), // skill_domains
      new Float32Array(rv.structured_vector_responsibilities),
      new Float32Array(rv.structured_vector_required_skills),
      new Float32Array(rv.structured_vector_optional_skills),
    ];
    return weightedFusionMulti(vectors, weightArr, dims);
  }

  return null;
}

module.exports = {
  buildRoleVectors,
  buildStructuredVectorFromCategories,
  getEmbeddingForMatching,
  getHybridVectorForMode,
  getPrecomputedFinalVector,
  warnMissingPrecomputedFinalVectors,
  getStructuredVectorForMode,
  STRUCTURED_WEIGHT,
  IDENTITY_WEIGHT,
  CATEGORY_ORDER,
};
