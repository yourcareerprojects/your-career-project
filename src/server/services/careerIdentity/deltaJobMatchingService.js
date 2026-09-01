/**
 * Delta Job Matching
 * ==================
 *
 * Recommends jobs that became a **better identity fit** after the user's
 * Career Identity evolved — not merely the globally highest-matching jobs.
 *
 * Pipeline
 * --------
 *   previous identity snapshot  →  oldIdentityFit (per job)
 *   current identity            →  newIdentityFit (per job)
 *   optional profile hybrid fit → profileFit (simulation OOTB-style)
 *   absolute scores blend identity + profile when grounding is enabled
 *   delta = newScore − oldScore
 *   filter barely-changed / weak / profile-implausible fits
 *   sort by delta (descending)
 *
 * Default scoring
 * ---------------
 * Builds a confidence-weighted centroid of trait embeddings for each identity
 * state, then scores each role as cosine(identityVector, role.identity_vector).
 * When a profile fit scorer is provided, absolute scores also incorporate the
 * user's skills / experience / preferences so suggestions stay profile-grounded.
 *
 * Callers may inject `scoreRole(identityPieces, role)` to reuse hybrid scorers
 * or supply precomputed scores — the delta / filter / sort pipeline stays the same.
 *
 * @module services/careerIdentity/deltaJobMatchingService
 */

const {
  DELTA_JOB_MATCHING_THRESHOLDS,
  DELTA_JOB_MATCHING_WEIGHTS,
} = require('../../../constants/deltaJobMatchingThresholds');
const { getTraitEmbedding } = require('./traitEmbeddingsStore');
const { cosineSimilarity } = require('../embedding/embeddingService');
const { getSnapshotPieces } = require('./snapshotService');
const { normalizePieces } = require('./identityEvolutionService');

/**
 * @typedef {Object} DeltaJobMatch
 * @property {object} role
 * @property {number} oldScore  // blended absolute fit before evolution
 * @property {number} newScore  // blended absolute fit after evolution
 * @property {number} delta     // newScore − oldScore
 * @property {number} [identityFit] // current puzzle identity cosine
 * @property {number} [oldIdentityFit]
 * @property {number} [newIdentityFit]
 * @property {number|null} [profileFit] // simulation OOTB hybrid fit when available
 */

/**
 * @typedef {Object} DeltaJobMatchingOptions
 * @property {unknown} previousIdentity - snapshot | pieces | { traits } | { nodes }
 * @property {unknown} currentIdentity  - snapshot | pieces | { traits } | { nodes }
 * @property {object[]} roles
 * @property {Partial<typeof DELTA_JOB_MATCHING_THRESHOLDS>} [thresholds]
 * @property {Partial<typeof DELTA_JOB_MATCHING_WEIGHTS>} [weights]
 * @property {(pieces: object[], role: object) => number|null|Promise<number|null>} [scoreRole]
 * @property {(role: object) => number|null|Promise<number|null>} [scoreProfileFit]
 */

function resolveThresholds(override) {
  if (!override || typeof override !== 'object') return DELTA_JOB_MATCHING_THRESHOLDS;
  return { ...DELTA_JOB_MATCHING_THRESHOLDS, ...override };
}

function resolveWeights(override) {
  if (!override || typeof override !== 'object') return DELTA_JOB_MATCHING_WEIGHTS;
  return { ...DELTA_JOB_MATCHING_WEIGHTS, ...override };
}

/**
 * Extract lightweight puzzle pieces from any supported identity shape.
 * @param {unknown} identity
 * @returns {Array<{ traitId: string, category: string, confidence: number, layer?: string }>}
 */
function extractIdentityPieces(identity) {
  if (identity == null) return [];

  if (
    identity
    && typeof identity === 'object'
    && Array.isArray(identity.pieces)
    && (identity.version != null || identity.capturedAt != null)
  ) {
    return getSnapshotPieces(identity);
  }

  if (Array.isArray(identity)) return normalizePieces(identity);
  if (Array.isArray(identity.traits)) return normalizePieces(identity.traits);
  if (Array.isArray(identity.nodes)) return normalizePieces(identity.nodes);
  if (Array.isArray(identity.pieces)) return normalizePieces(identity.pieces);
  return [];
}

/**
 * Piece weight for the identity centroid.
 * @param {{ confidence?: number, layer?: string }} piece
 * @param {typeof DELTA_JOB_MATCHING_WEIGHTS} weights
 * @returns {number}
 */
function pieceWeight(piece, weights) {
  const confidence = Math.max(0, Number(piece.confidence) || 0);
  if (confidence < weights.MIN_PIECE_CONFIDENCE) return 0;

  const raised = weights.CONFIDENCE_WEIGHT_EXPONENT === 1
    ? confidence
    : confidence ** weights.CONFIDENCE_WEIGHT_EXPONENT;

  const layerMultiplier =
    piece.layer === 'confirmed'
      ? weights.CONFIRMED_LAYER_MULTIPLIER
      : piece.layer === 'emerging'
        ? weights.EMERGING_LAYER_MULTIPLIER
        : weights.EMERGING_LAYER_MULTIPLIER;

  return raised * layerMultiplier;
}

/**
 * @param {Float32Array} vector
 * @returns {Float32Array|null}
 */
function l2Normalize(vector) {
  if (!vector || typeof vector.length !== 'number' || vector.length === 0) return null;
  let sumSq = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const v = vector[i];
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (!(norm > 0)) return null;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    out[i] = vector[i] / norm;
  }
  return out;
}

/**
 * Confidence-weighted centroid of trait embeddings for an identity state.
 *
 * @param {Array<{ traitId: string, confidence?: number, layer?: string }>} pieces
 * @param {Partial<typeof DELTA_JOB_MATCHING_WEIGHTS>} [weightsOverride]
 * @param {{ getEmbedding?: (traitId: string) => Float32Array|null }} [deps]
 * @returns {Float32Array|null}
 */
function buildIdentityVectorFromPieces(pieces, weightsOverride, deps = {}) {
  const weights = resolveWeights(weightsOverride);
  const getEmbedding = deps.getEmbedding || getTraitEmbedding;
  const list = Array.isArray(pieces) ? pieces : [];

  /** @type {Float32Array|null} */
  let accum = null;
  let weightSum = 0;

  for (const piece of list) {
    const w = pieceWeight(piece, weights);
    if (w <= 0) continue;
    const emb = getEmbedding(piece.traitId);
    if (!emb || typeof emb.length !== 'number' || emb.length === 0) continue;

    if (!accum) {
      accum = new Float32Array(emb.length);
    } else if (accum.length !== emb.length) {
      continue;
    }

    for (let i = 0; i < emb.length; i += 1) {
      accum[i] += emb[i] * w;
    }
    weightSum += w;
  }

  if (!accum || weightSum <= 0) return null;
  return l2Normalize(accum);
}

/**
 * @param {object} role
 * @returns {Float32Array|null}
 */
function getRoleIdentityVector(role) {
  if (!role || typeof role !== 'object') return null;

  // Cache parsed vectors on the role for repeated passes (delta + fallback).
  if (role.__identityVec instanceof Float32Array) {
    return role.__identityVec.length > 0 ? role.__identityVec : null;
  }
  if (role.__identityVec === null) return null;

  const rv = role.roleVectors || role;
  const raw = rv.identity_vector;
  if (!raw) {
    role.__identityVec = null;
    return null;
  }

  if (raw instanceof Float32Array) {
    role.__identityVec = raw.length > 0 ? raw : null;
    return role.__identityVec;
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    role.__identityVec = null;
    return null;
  }

  const vec = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    const n = Number(raw[i]);
    if (!Number.isFinite(n)) {
      role.__identityVec = null;
      return null;
    }
    vec[i] = n;
  }
  role.__identityVec = vec;
  return vec;
}

/**
 * Run an async mapper over items with a fixed worker pool.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : [];
  const n = list.length;
  /** @type {R[]} */
  const results = new Array(n);
  if (n === 0) return results;

  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, n));
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= n) return;
      results[index] = await mapper(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/**
 * Rank identity-only rows before spending profile-fit budget.
 * @param {{ oldIdentityFit: number, newIdentityFit: number }} row
 * @param {boolean} zeroOldIdentity
 * @returns {number}
 */
function identityRankKey(row, zeroOldIdentity) {
  if (zeroOldIdentity) return row.newIdentityFit;
  return row.newIdentityFit - row.oldIdentityFit;
}

/**
 * Default identity-fit score: cosine(user identity centroid, role identity_vector).
 *
 * @param {Float32Array|null} identityVector
 * @param {object} role
 * @returns {number|null}
 */
function scoreRoleAgainstIdentityVector(identityVector, role) {
  if (!identityVector) return null;
  const roleVector = getRoleIdentityVector(role);
  if (!roleVector || roleVector.length !== identityVector.length) return null;
  const score = cosineSimilarity(identityVector, roleVector);
  if (!Number.isFinite(score)) return null;
  return score;
}

/**
 * @param {number} value
 * @param {number} precision
 * @returns {number}
 */
function roundScore(value, precision) {
  const factor = 10 ** Math.max(0, precision);
  return Math.round(Number(value) * factor) / factor;
}

/**
 * Blend puzzle identity fit with profile hybrid fit.
 * When profileFit is missing, returns identityFit unchanged.
 *
 * @param {number} identityFit
 * @param {number|null|undefined} profileFit
 * @param {typeof DELTA_JOB_MATCHING_THRESHOLDS} thresholds
 * @returns {number}
 */
function blendIdentityAndProfileFit(identityFit, profileFit, thresholds) {
  if (
    !thresholds.USE_PROFILE_GROUNDING
    || !Number.isFinite(profileFit)
  ) {
    return identityFit;
  }
  const weight = Math.min(1, Math.max(0, Number(thresholds.PROFILE_BLEND_WEIGHT) || 0));
  return (1 - weight) * identityFit + weight * Number(profileFit);
}

/**
 * Apply barely-changed / weak-fit / profile filters and sort by delta descending.
 *
 * @param {DeltaJobMatch[]} matches
 * @param {Partial<typeof DELTA_JOB_MATCHING_THRESHOLDS>} [thresholdsOverride]
 * @returns {DeltaJobMatch[]}
 */
function filterAndSortByDelta(matches, thresholdsOverride) {
  const thresholds = resolveThresholds(thresholdsOverride);
  const list = Array.isArray(matches) ? matches : [];

  const filtered = list.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const { oldScore, newScore, delta, profileFit } = entry;
    if (![oldScore, newScore, delta].every((n) => Number.isFinite(n))) return false;

    // Gate change magnitude on puzzle identity movement when available, so
    // profile blend weight does not silently raise/lower MIN_ABS_DELTA.
    const identityDelta =
      Number.isFinite(entry.newIdentityFit) && Number.isFinite(entry.oldIdentityFit)
        ? entry.newIdentityFit - entry.oldIdentityFit
        : delta;

    if (Math.abs(identityDelta) < thresholds.MIN_ABS_DELTA) return false;
    if (thresholds.REQUIRE_POSITIVE_DELTA && identityDelta <= 0) return false;
    if (newScore < thresholds.MIN_NEW_SCORE) return false;
    if (oldScore < thresholds.MIN_OLD_SCORE_FOR_COMPARISON) return false;
    if (
      thresholds.USE_PROFILE_GROUNDING
      && Number.isFinite(thresholds.MIN_PROFILE_FIT)
      && Number.isFinite(profileFit)
      && profileFit < thresholds.MIN_PROFILE_FIT
    ) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const aIdentityDelta =
      Number.isFinite(a.newIdentityFit) && Number.isFinite(a.oldIdentityFit)
        ? a.newIdentityFit - a.oldIdentityFit
        : a.delta;
    const bIdentityDelta =
      Number.isFinite(b.newIdentityFit) && Number.isFinite(b.oldIdentityFit)
        ? b.newIdentityFit - b.oldIdentityFit
        : b.delta;
    const deltaDiff = bIdentityDelta - aIdentityDelta;
    if (deltaDiff !== 0) return deltaDiff;
    const newDiff = b.newScore - a.newScore;
    if (newDiff !== 0) return newDiff;
    const profileA = Number.isFinite(a.profileFit) ? a.profileFit : -1;
    const profileB = Number.isFinite(b.profileFit) ? b.profileFit : -1;
    return profileB - profileA;
  });

  if (thresholds.MAX_RESULTS > 0 && filtered.length > thresholds.MAX_RESULTS) {
    return filtered.slice(0, thresholds.MAX_RESULTS);
  }
  return filtered;
}

/**
 * Finalize blended absolute scores for an identity-scored row.
 *
 * @param {{
 *   role: object,
 *   oldIdentityFit: number,
 *   newIdentityFit: number,
 *   profileFit?: number|null,
 * }} row
 * @param {typeof DELTA_JOB_MATCHING_THRESHOLDS} thresholds
 * @param {number} precision
 * @param {boolean} zeroOldIdentity
 * @returns {DeltaJobMatch}
 */
function finalizeDeltaMatch(row, thresholds, precision, zeroOldIdentity) {
  const profileFit = Number.isFinite(row.profileFit)
    ? roundScore(row.profileFit, precision)
    : null;
  const oldScore = roundScore(
    blendIdentityAndProfileFit(row.oldIdentityFit, profileFit, thresholds),
    precision
  );
  const newScore = roundScore(
    blendIdentityAndProfileFit(row.newIdentityFit, profileFit, thresholds),
    precision
  );
  const delta = roundScore(
    zeroOldIdentity ? newScore : newScore - oldScore,
    precision
  );

  return {
    role: row.role,
    oldScore: zeroOldIdentity ? 0 : oldScore,
    newScore,
    delta: zeroOldIdentity ? newScore : delta,
    identityFit: row.newIdentityFit,
    oldIdentityFit: zeroOldIdentity ? 0 : row.oldIdentityFit,
    newIdentityFit: row.newIdentityFit,
    profileFit,
  };
}

/**
 * Compute raw deltas for every scorable role (no filter / sort).
 *
 * Fast path:
 * 1. Score identity fit for the full pool (typically sync cosine).
 * 2. When profile grounding is on, score OOTB profile fit only for the top
 *    identity candidates — in parallel — instead of every role serially.
 *
 * @param {object[]} roles
 * @param {(role: object) => number|null|Promise<number|null>} scoreOld
 * @param {(role: object) => number|null|Promise<number|null>} scoreNew
 * @param {number} [precision]
 * @param {{
 *   scoreProfileFit?: (role: object) => number|null|Promise<number|null>,
 *   thresholds?: typeof DELTA_JOB_MATCHING_THRESHOLDS,
 *   zeroOldIdentity?: boolean,
 * }} [options]
 * @returns {Promise<DeltaJobMatch[]>}
 */
async function computeJobDeltas(
  roles,
  scoreOld,
  scoreNew,
  precision = DELTA_JOB_MATCHING_THRESHOLDS.SCORE_PRECISION,
  options = {}
) {
  const arr = Array.isArray(roles) ? roles : [];
  const thresholds = resolveThresholds(options.thresholds);
  const scoreProfileFit =
    typeof options.scoreProfileFit === 'function' ? options.scoreProfileFit : null;
  const zeroOldIdentity = Boolean(options.zeroOldIdentity);
  const useProfile =
    Boolean(scoreProfileFit) && Boolean(thresholds.USE_PROFILE_GROUNDING);

  /** @type {Array<{ role: object, oldIdentityFit: number, newIdentityFit: number }>} */
  const identityRows = [];

  // Phase 1: identity scores for the full pool (await in batches — usually sync).
  const identityScored = await mapWithConcurrency(
    arr,
    Math.max(64, Number(thresholds.PROFILE_FIT_CONCURRENCY) || 32),
    async (role) => {
      const [oldIdentityRaw, newIdentityRaw] = await Promise.all([
        zeroOldIdentity ? Promise.resolve(0) : scoreOld(role),
        scoreNew(role),
      ]);
      if (!Number.isFinite(oldIdentityRaw) || !Number.isFinite(newIdentityRaw)) {
        return null;
      }
      return {
        role,
        oldIdentityFit: roundScore(oldIdentityRaw, precision),
        newIdentityFit: roundScore(newIdentityRaw, precision),
      };
    }
  );

  for (const row of identityScored) {
    if (row) identityRows.push(row);
  }

  if (!useProfile) {
    return identityRows.map((row) =>
      finalizeDeltaMatch({ ...row, profileFit: null }, thresholds, precision, zeroOldIdentity)
    );
  }

  // Phase 2: profile-fit only the strongest identity movers / fits.
  const candidateLimit = Math.max(
    Number(thresholds.MAX_RESULTS) || 0,
    Number(thresholds.PROFILE_CANDIDATE_LIMIT) || 96
  );
  const ranked = identityRows
    .slice()
    .sort((a, b) => {
      const deltaDiff =
        identityRankKey(b, zeroOldIdentity) - identityRankKey(a, zeroOldIdentity);
      if (deltaDiff !== 0) return deltaDiff;
      return b.newIdentityFit - a.newIdentityFit;
    });
  const candidates = ranked.slice(0, Math.min(candidateLimit, ranked.length));
  const concurrency = Math.max(1, Number(thresholds.PROFILE_FIT_CONCURRENCY) || 32);

  await mapWithConcurrency(candidates, concurrency, async (row) => {
    let profileRaw = null;
    try {
      profileRaw = await scoreProfileFit(row.role);
    } catch {
      profileRaw = null;
    }
    row.profileFit = Number.isFinite(profileRaw) ? Number(profileRaw) : null;
    return row;
  });

  return candidates.map((row) =>
    finalizeDeltaMatch(row, thresholds, precision, zeroOldIdentity)
  );
}

/**
 * Rank jobs by how much their identity fit improved after evolution.
 *
 * @param {DeltaJobMatchingOptions & {
 *   fallbackToInitialFit?: boolean,
 *   returnMeta?: boolean,
 * }} options
 * @returns {Promise<DeltaJobMatch[]|{ matches: DeltaJobMatch[], matchSource: string }>}
 */
async function matchJobsByIdentityDelta(options = {}) {
  const {
    previousIdentity,
    currentIdentity,
    roles,
    thresholds: thresholdsOverride,
    weights: weightsOverride,
    scoreRole,
    scoreProfileFit,
    fallbackToInitialFit = false,
    returnMeta = false,
  } = options;

  const thresholds = resolveThresholds(thresholdsOverride);
  const weights = resolveWeights(weightsOverride);
  const previousPieces = extractIdentityPieces(previousIdentity);
  const currentPieces = extractIdentityPieces(currentIdentity);

  /** @type {(pieces: object[], role: object) => Promise<number|null>|number|null} */
  let scoreWithPieces;

  if (typeof scoreRole === 'function') {
    scoreWithPieces = async (pieces, role) => {
      const value = await scoreRole(pieces, role);
      return Number.isFinite(value) ? Number(value) : null;
    };
  } else {
    const previousVector = buildIdentityVectorFromPieces(previousPieces, weights);
    const currentVector = buildIdentityVectorFromPieces(currentPieces, weights);

    scoreWithPieces = (pieces, role) => {
      const identityVector = pieces === previousPieces ? previousVector : currentVector;
      return scoreRoleAgainstIdentityVector(identityVector, role);
    };
  }

  const raw = await computeJobDeltas(
    roles,
    (role) => scoreWithPieces(previousPieces, role),
    (role) => scoreWithPieces(currentPieces, role),
    thresholds.SCORE_PRECISION,
    { scoreProfileFit, thresholds }
  );

  let matches = filterAndSortByDelta(raw, thresholds);
  let matchSource = 'identity_delta';

  if (matches.length === 0 && fallbackToInitialFit) {
    // Reuse the already-scored pool instead of a second full OOTB pass.
    const asInitial = raw.map((entry) => ({
      ...entry,
      oldScore: 0,
      oldIdentityFit: 0,
      delta: entry.newScore,
    }));
    const initialThresholds = {
      ...thresholds,
      MIN_ABS_DELTA: Math.min(thresholds.MIN_ABS_DELTA, thresholds.MIN_NEW_SCORE),
      MIN_OLD_SCORE_FOR_COMPARISON: 0,
      REQUIRE_POSITIVE_DELTA: true,
    };
    matches = filterAndSortByDelta(asInitial, initialThresholds);
    if (matches.length > 0) matchSource = 'initial_fit_fallback';
  }

  if (returnMeta) return { matches, matchSource };
  return matches;
}

/**
 * Rank jobs by absolute identity (+ optional profile) fit for a user's first exploration
 * (no prior snapshot — oldScore is always 0, delta equals newScore).
 *
 * @param {Omit<DeltaJobMatchingOptions, 'previousIdentity'> & { currentIdentity: unknown }} options
 * @returns {Promise<DeltaJobMatch[]>}
 */
async function matchJobsByInitialIdentityFit(options = {}) {
  const {
    currentIdentity,
    roles,
    thresholds: thresholdsOverride,
    weights: weightsOverride,
    scoreRole,
    scoreProfileFit,
  } = options;

  const thresholds = resolveThresholds(thresholdsOverride);
  const weights = resolveWeights(weightsOverride);
  const currentPieces = extractIdentityPieces(currentIdentity);

  /** @type {(pieces: object[], role: object) => Promise<number|null>} */
  let scoreCurrent;

  if (typeof scoreRole === 'function') {
    scoreCurrent = async (_pieces, role) => {
      const value = await scoreRole(currentPieces, role);
      return Number.isFinite(value) ? Number(value) : null;
    };
  } else {
    const currentVector = buildIdentityVectorFromPieces(currentPieces, weights);
    scoreCurrent = async (_pieces, role) =>
      scoreRoleAgainstIdentityVector(currentVector, role);
  }

  const raw = await computeJobDeltas(
    roles,
    async () => 0,
    (role) => scoreCurrent(currentPieces, role),
    thresholds.SCORE_PRECISION,
    { scoreProfileFit, thresholds, zeroOldIdentity: true }
  );

  const initialThresholds = {
    ...thresholds,
    MIN_ABS_DELTA: Math.min(thresholds.MIN_ABS_DELTA, thresholds.MIN_NEW_SCORE),
    MIN_OLD_SCORE_FOR_COMPARISON: 0,
    REQUIRE_POSITIVE_DELTA: true,
  };

  return filterAndSortByDelta(raw, initialThresholds);
}

module.exports = {
  matchJobsByIdentityDelta,
  matchJobsByInitialIdentityFit,
  filterAndSortByDelta,
  computeJobDeltas,
  blendIdentityAndProfileFit,
  buildIdentityVectorFromPieces,
  scoreRoleAgainstIdentityVector,
  getRoleIdentityVector,
  extractIdentityPieces,
  pieceWeight,
  mapWithConcurrency,
  DELTA_JOB_MATCHING_THRESHOLDS,
  DELTA_JOB_MATCHING_WEIGHTS,
};
