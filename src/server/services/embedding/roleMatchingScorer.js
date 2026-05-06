/**
 * Role Matching Scorer
 *
 * Two distinct scoring functions for career matching:
 *   - scoreNextRole: conservative, skill-adjacent (NEXT_ROLE)
 *   - scoreOutOfTheBox: explorative, identity-adjacent (OUT_OF_THE_BOX)
 *
 * Each applies mode-specific precomputed hybrid vectors, dot-product similarity, and seniority penalty.
 * Deterministic scoring; user/role embedding API calls occur inside vector builders.
 *
 * EXPLORATION CONCEPT (OUT_OF_THE_BOX):
 *   Exploration = identity-aligned structural shift. High identity similarity + lower
 *   (but not zero) structural similarity. Filter: identity ≥ IDENTITY_THRESHOLD,
 *   structuredSimilarity ∈ [STRUCTURE_LOWER_BOUND, STRUCTURE_UPPER_BOUND].
 *   Phase 2 ranks the OOTB MMR pool by HybridFinalOOTB (hybrid cosine × seniority).
 *
 * @module services/embedding/roleMatchingScorer
 */
// ENGLISH_ONLY_PIPELINE: Classification/scoring vectors are computed from canonical English text only.

const { cosineSimilarity, weightedFusion, EMBEDDING_DIMS } = require('./embeddingService');
const { getEnglishField } = require('../../utils/i18nFields');
const { getStructuredVectorForMode, getPrecomputedFinalVector, warnMissingPrecomputedFinalVectors } = require('./roleVectorService');
const {
  buildUserHybridVector,
  buildUserStructuredVector,
  buildUserIdentityVector,
  inferUserSeniorityLevel,
} = require('./userProfileVectorBuilder');

/** Hybrid weights: NEXT_ROLE */
const HYBRID_NEXT_ROLE = { wStructured: 0.75, wIdentity: 0.25 };

/** Hybrid weights: OUT_OF_THE_BOX */
const HYBRID_OUT_OF_THE_BOX = { wStructured: 0.45, wIdentity: 0.55 };

/** Penalty cap to prevent extreme score collapse */
const SENIORITY_PENALTY_CAP = 0.6;

/** Promotion guardrail: min penalty for unrealistic jumps (NEXT_ROLE: diff>3, OUT_OF_THE_BOX: diff>3) */
const PROMOTION_GUARDRAIL_PENALTY = 0.55;

// -----------------------------------------------------------------------------
// EXPLORATION CRITERIA (OUT_OF_THE_BOX = identity-aligned structural shift)
// -----------------------------------------------------------------------------
// Exploration = high identity similarity + lower (but not zero) structural similarity.
// Identity-aligned but structurally different roles offer meaningful career exploration.
//
// IDENTITY_THRESHOLD: Min identity similarity (cosine user↔role identity vectors).
//   Roles below this are not identity-aligned enough for exploration.
// STRUCTURE_UPPER_BOUND: Max structural similarity. Above = too similar to current path.
// STRUCTURE_LOWER_BOUND: Min structural similarity. Below = too unrelated (random).
/** @type {number} Min identity similarity for exploration (default 0.50) */
const EXPLORATION_IDENTITY_THRESHOLD = 0.50;
/** @type {number} Max structural similarity for exploration (default 0.75) */
const EXPLORATION_STRUCTURE_UPPER_BOUND = 0.75;
/** @type {number} Min structural similarity for exploration (default 0.40) */
const EXPLORATION_STRUCTURE_LOWER_BOUND = 0.40;

function dot(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Legacy fallback: build mode-specific hybrid vector for a role at scoring time.
 * Used only when precomputed finalVectors are unavailable.
 *
 * @param {object} role – Role with roleVectors (sub-vectors, identity_vector)
 * @param {'NEXT_ROLE'|'OUT_OF_THE_BOX'} mode
 * @returns {Float32Array|null}
 */
function buildRoleHybridForModeLegacy(role, mode) {
  const rv = role.roleVectors || role;
  const dims = rv.dims || EMBEDDING_DIMS;

  const structuredVec = getStructuredVectorForMode(role, mode);
  const identityVec = rv.identity_vector;
  if (!structuredVec || !identityVec || !Array.isArray(identityVec) || identityVec.length !== dims) {
    return null;
  }

  const identity = new Float32Array(identityVec);
  const { wStructured, wIdentity } = mode === 'OUT_OF_THE_BOX' ? HYBRID_OUT_OF_THE_BOX : HYBRID_NEXT_ROLE;

  const fused = weightedFusion(structuredVec, identity, { w1: wStructured, w2: wIdentity });
  return fused;
}

function getRoleScoreVector(role, mode) {
  const precomputed = getPrecomputedFinalVector(role, mode);
  if (precomputed) return precomputed;
  warnMissingPrecomputedFinalVectors(role, mode);
  return buildRoleHybridForModeLegacy(role, mode);
}

/**
 * Apply hard constraints (if available).
 * Returns null if role fails constraints; otherwise returns the role.
 * Extensible: add location, salary, etc. checks here.
 *
 * @param {object} userProfile
 * @param {object} role
 * @returns {object|null}
 */
function applyHardConstraints(userProfile, role) {
  // Placeholder: no hard constraints by default.
  // Add e.g. location filter, min salary, etc. when needed.
  return role;
}

/**
 * Infer role seniority level from title when seniority data is missing.
 * Lightweight keyword-based mapping. Returns null if no keyword matches.
 *
 * @param {string} title – Role title (e.g. "Senior Software Engineer")
 * @returns {number|null} 0–6 or null
 */
function inferRoleLevelFromTitle(title) {
  if (typeof title !== 'string' || !title.trim()) return null;
  const t = title.toLowerCase();
  if (/\bintern\b/.test(t)) return 0;
  if (/\bassistant\b/.test(t)) return 1;
  if (/\bjunior\b/.test(t)) return 2;
  if (/\bspecialist\b|\banalyst\b/.test(t)) return 3;
  if (/\bsenior\b/.test(t)) return 4;
  if (/\blead\b|\bmanager\b/.test(t)) return 5;
  if (/\bdirector\b|\bvp\b|\bvice\s+president\b|\bhead\b|\bchief\b/.test(t)) return 6;
  return null;
}

/**
 * Get role seniority level (0–6).
 * Uses role.seniority.seniority_level if present; otherwise infers from title; fallback 3.
 */
function getRoleSeniorityLevel(role) {
  const level = role.seniority?.seniority_level;
  if (typeof level === 'number' && level >= 0 && level <= 6) return level;
  const inferred = inferRoleLevelFromTitle(
    role?.title != null ? getEnglishField(role.title) : role.escoId || '',
  );
  return inferred != null ? inferred : 3;
}

/**
 * Compute asymmetric seniority penalty.
 * diff = roleLevel - userLevel: positive = promotion, negative = downgrade.
 * Downgrades are penalized more strongly than promotions.
 *
 * @param {number} diff – roleLevel - userLevel
 * @param {'NEXT_ROLE'|'OUT_OF_THE_BOX'} mode
 * @returns {number} penalty in [0, SENIORITY_PENALTY_CAP]
 */
function computeSeniorityPenalty(diff, mode) {
  let penalty;
  if (mode === 'NEXT_ROLE') {
    if (diff >= 0) {
      penalty = 0.05 * (diff * diff);
    } else {
      penalty = 0.12 * Math.abs(diff);
    }
    if (diff > 3) penalty = Math.max(penalty, PROMOTION_GUARDRAIL_PENALTY);
  } else {
    if (diff >= 0) {
      penalty = 0.04 * (diff * diff);
    } else {
      penalty = 0.10 * Math.abs(diff);
    }
    if (diff > 3) penalty = Math.max(penalty, PROMOTION_GUARDRAIL_PENALTY);
  }
  return Math.min(SENIORITY_PENALTY_CAP, penalty);
}

/**
 * Score a role for NEXT_ROLE mode (conservative, skill-adjacent).
 *
 * Flow:
 *   1. Apply hard constraints
 *   2. Build user mode vector and load precomputed role final vector
 *   3. Compute dot-product similarity (both vectors are normalized)
 *   4. Apply seniority penalty: score = cosine * (1 - 0.12 * level_diff)
 *
 * @param {object} userProfile – { userSkills, userWorkExperience, userEducation, userCareerPreferences, userInterests, careerGoal }
 * @param {object} role – CareerPath with roleVectors
 * @returns {Promise<{ score: number, cosine: number, levelDiff: number, penalty: number } | null>}
 */
async function scoreNextRole(userProfile, role) {
  const constrained = applyHardConstraints(userProfile, role);
  if (!constrained) return null;

  const userHybrid = await buildUserHybridVector(userProfile, 'NEXT_ROLE');
  const roleHybrid = getRoleScoreVector(role, 'NEXT_ROLE');
  if (!roleHybrid) return null;

  const hybridCosine = dot(userHybrid, roleHybrid);

  const userLevel = inferUserSeniorityLevel(userProfile);
  const roleLevel = getRoleSeniorityLevel(role);
  const diff = roleLevel - userLevel;
  const penalty = computeSeniorityPenalty(diff, 'NEXT_ROLE');
  const hybridScoreFinal = hybridCosine * Math.max(0, 1 - penalty);

  return {
    score: hybridScoreFinal,
    cosine: hybridCosine,
    levelDiff: Math.abs(diff),
    penalty,
    userLevel,
    roleLevel,
    diff,
    hybridCosine,
    hybridScoreFinal,
  };
}

/**
 * Score a role for OUT_OF_THE_BOX mode (explorative, identity-adjacent).
 *
 * Flow:
 *   1. Apply hard constraints
 *   2. Build user mode vector and load precomputed role final vector
 *   3. Compute dot-product similarity (both vectors are normalized)
 *   4. Apply seniority penalty: score = cosine * (1 - penalty)
 *
 * Also computes structuredSimilarity and identitySimilarity when vectors exist (exploration filters / analytics).
 *
 * @param {object} userProfile
 * @param {object} role
 * @returns {Promise<{ score: number, cosine: number, levelDiff: number, penalty: number } | null>}
 */
async function scoreOutOfTheBox(userProfile, role) {
  const constrained = applyHardConstraints(userProfile, role);
  if (!constrained) return null;

  const userHybrid = await buildUserHybridVector(userProfile, 'OUT_OF_THE_BOX');
  const roleHybrid = getRoleScoreVector(role, 'OUT_OF_THE_BOX');
  if (!roleHybrid) return null;

  const hybridCosine = dot(userHybrid, roleHybrid);

  const userLevel = inferUserSeniorityLevel(userProfile);
  const roleLevel = getRoleSeniorityLevel(role);
  const diff = roleLevel - userLevel;
  const penalty = computeSeniorityPenalty(diff, 'OUT_OF_THE_BOX');
  const hybridScoreFinal = hybridCosine * Math.max(0, 1 - penalty);
  const score = hybridScoreFinal;

  const [userStructured, userIdentity] = await Promise.all([
    buildUserStructuredVector(userProfile, 'OUT_OF_THE_BOX'),
    buildUserIdentityVector(userProfile),
  ]);
  const roleStructured = getStructuredVectorForMode(role, 'OUT_OF_THE_BOX');
  const rv = role.roleVectors || role;
  const roleIdentity = rv.identity_vector;

  // Exploration filter needs identity + structured cosines. Roles without fused structured sub-vectors
  // still have a valid OOTB hybrid score (finalVectors / legacy fusion); omitting similarities dropped
  // them from Phase 2 and yielded empty outside-the-box lists.
  let structuredSimilarity = null;
  let identitySimilarity = null;
  const hasIdentityLength =
    roleIdentity &&
    Array.isArray(roleIdentity) &&
    roleIdentity.length === EMBEDDING_DIMS &&
    userIdentity &&
    typeof userIdentity.length === 'number' &&
    userIdentity.length === EMBEDDING_DIMS;

  const userStructuredOk =
    userStructured &&
    typeof userStructured.length === 'number' &&
    userStructured.length === EMBEDDING_DIMS;

  if (roleStructured && hasIdentityLength && userStructuredOk) {
    structuredSimilarity = cosineSimilarity(userStructured, roleStructured);
    identitySimilarity = cosineSimilarity(userIdentity, new Float32Array(roleIdentity));
  } else if (hasIdentityLength && userStructuredOk) {
    identitySimilarity = cosineSimilarity(userIdentity, new Float32Array(roleIdentity));
    structuredSimilarity = (EXPLORATION_STRUCTURE_LOWER_BOUND + EXPLORATION_STRUCTURE_UPPER_BOUND) / 2;
  }

  const result = {
    score,
    cosine: hybridCosine,
    levelDiff: Math.abs(diff),
    penalty,
    userLevel,
    roleLevel,
    diff,
    hybridCosine,
    hybridScoreFinal,
  };
  if (structuredSimilarity != null) result.structuredSimilarity = structuredSimilarity;
  if (identitySimilarity != null) result.identitySimilarity = identitySimilarity;
  return result;
}

/**
 * Check if a role passes exploration criteria (identity-aligned structural shift).
 * Exploration = high identity similarity + lower (but not zero) structural similarity.
 *
 * @param {number} identitySimilarity – cosine(user identity, role identity)
 * @param {number} structuredSimilarity – cosine(user structured, role structured)
 * @param {object} [options]
 * @param {number} [options.identityThreshold] – override IDENTITY_THRESHOLD
 * @param {number} [options.structureUpperBound] – override STRUCTURE_UPPER_BOUND
 * @param {number} [options.structureLowerBound] – override STRUCTURE_LOWER_BOUND
 * @returns {boolean}
 */
function passesExplorationCriteria(identitySimilarity, structuredSimilarity, options = {}) {
  const idThresh = options.identityThreshold ?? EXPLORATION_IDENTITY_THRESHOLD;
  const structUpper = options.structureUpperBound ?? EXPLORATION_STRUCTURE_UPPER_BOUND;
  const structLower = options.structureLowerBound ?? EXPLORATION_STRUCTURE_LOWER_BOUND;
  if (identitySimilarity == null || structuredSimilarity == null || !Number.isFinite(identitySimilarity) || !Number.isFinite(structuredSimilarity)) {
    return false;
  }
  return (
    identitySimilarity >= idThresh &&
    structuredSimilarity <= structUpper &&
    structuredSimilarity >= structLower
  );
}

/**
 * Score multiple roles for OUT_OF_THE_BOX mode (same formula as scoreOutOfTheBox per role).
 *
 * @param {object} userProfile
 * @param {object[]} roles
 * @returns {Promise<Array<{ role: object, result: object }>>}
 */
async function scoreOutOfTheBoxBatch(userProfile, roles) {
  const arr = Array.isArray(roles) ? roles : [];
  const results = await Promise.all(
    arr.map((role) => scoreOutOfTheBox(userProfile, role).then((result) => ({ role, result })))
  );
  return results.filter((x) => x.result != null);
}

module.exports = {
  scoreNextRole,
  scoreOutOfTheBox,
  scoreOutOfTheBoxBatch,
  computeSeniorityPenalty,
  passesExplorationCriteria,
  buildRoleHybridForMode: buildRoleHybridForModeLegacy,
  applyHardConstraints,
  getRoleSeniorityLevel,
  HYBRID_NEXT_ROLE,
  HYBRID_OUT_OF_THE_BOX,
  EXPLORATION_IDENTITY_THRESHOLD,
  EXPLORATION_STRUCTURE_UPPER_BOUND,
  EXPLORATION_STRUCTURE_LOWER_BOUND,
};
