const { getEnglishField } = require('../../utils/i18nFields');
const { mmrSelect, embedTextSafe, embedTextBatchSafe, buildCareerStepEmbeddingText, cosineSimilarity, EMBEDDING_DIMS } = require('../embedding/embeddingService');
const { getEmbeddingForMatching, getHybridVectorForMode, getStructuredVectorForMode } = require('../embedding/roleVectorService');
const {
  passesExplorationCriteria,
  EXPLORATION_IDENTITY_THRESHOLD,
  EXPLORATION_STRUCTURE_UPPER_BOUND,
  EXPLORATION_STRUCTURE_LOWER_BOUND,
} = require('../embedding/roleMatchingScorer');
const { logMemory } = require('./simulationMemoryProfiler');
const { hydrateScoredPathsWithMeta } = require('./phase2ScoredPath');

/** Top-N roles by HybridFinalNEXT before NEXT_ROLE MMR (diversity pass). */
const DEFAULT_NEXT_MMR_CANDIDATE_POOL_SIZE = 150;

/** Top-N roles by HybridFinalOOTB before OUT_OF_THE_BOX MMR (diversity pass). */
const DEFAULT_OUTSIDE_MMR_CANDIDATE_POOL_SIZE = 150;

/** Cap how much novelty-vs-next we require (lower max threshold = easier pass). Previous 0.35 still emptied pools. */
const MAX_OUTSIDE_NOVELTY_THRESHOLD_VS_NEXT = 0.22;

/** Skip `title.includes(careerGoal)` when goal is short — common tokens remove nearly the entire pool. */
const MIN_CAREER_GOAL_CHARS_FOR_TITLE_SUBSTRING_FILTER = 14;

const DEFAULT_EXPLORATION_IDENTITY_PASS_RATE = 0.60;

/** Structured-vector hydrate batch size for exploration novelty (mirror scoring chunk pattern). */
const DEFAULT_EXPLORATION_HYDRATE_CHUNK_SIZE = 32;

/** Stop scanning once this many unique novel candidates are found (buffer before title dedupe / MMR). */
const EXPLORATION_NOVEL_TARGET_POOL_MULTIPLIER = 2;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Release embedding blobs from a step once precomputed Float32Array maps exist. */
function dropStepVectors(step) {
  if (!step || typeof step !== 'object') return;
  delete step.roleVectors;
  delete step.hybrid_vector;
}

/** Release embedding blobs from lean scored-path rows (shared refs with steps). */
function dropRoleVectors(raw) {
  if (!raw || typeof raw !== 'object') return;
  delete raw.roleVectors;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function resolveExplorationHydrateChunkSize() {
  return toPositiveInt(process.env.SIMULATION_EXPLORATION_HYDRATE_CHUNK_SIZE, DEFAULT_EXPLORATION_HYDRATE_CHUNK_SIZE);
}

/** Lean step for exploration novelty — meta hydrated later for MMR survivors only. */
function buildExplorationNoveltyStep(role, result) {
  const step = buildStepObject(role, { category: 'outsideTheBoxRoles' });
  step.structuredSimilarity = result.structuredSimilarity;
  step.identitySimilarity = result.identitySimilarity;
  if (typeof result.hybridScoreFinal === 'number' && Number.isFinite(result.hybridScoreFinal)) {
    step.hybridScoreOutOfTheBox = result.hybridScoreFinal;
  }
  if (typeof result.hybridCosine === 'number' && Number.isFinite(result.hybridCosine)) {
    step.hybridCosineOutOfTheBox = result.hybridCosine;
  }
  return step;
}

/** Drop embedMap entries not needed for the remaining pipeline stage. */
function pruneEmbedMap(embedMap, keepSteps) {
  const keep = new Set(keepSteps);
  for (const step of embedMap.keys()) {
    if (!keep.has(step)) embedMap.delete(step);
  }
}

/**
 * Fuse structured embeddings into embedMap; batch text-embed only for missing vectors.
 * When metaLoader is provided, hydrates enrichment fields for text-fallback steps first
 * (matches pre-chunked behavior where meta preceded embedding).
 */
async function mergeStructuredStepEmbeddings(steps, embedMap, mode, { metaLoader } = {}) {
  const needEmbed = [];
  for (const step of steps) {
    const structured = getStructuredVectorForMode(step, mode);
    if (structured) {
      embedMap.set(step, structured);
    } else {
      needEmbed.push(step);
    }
  }
  if (needEmbed.length === 0) return;
  if (metaLoader) {
    await hydrateScoredPathsWithMeta(needEmbed, metaLoader);
  }
  const texts = needEmbed.map((s) => buildCareerStepEmbeddingText(s, { category: s.category }));
  const vectors = await embedTextBatchSafe(texts);
  let missCount = 0;
  for (let i = 0; i < needEmbed.length; i += 1) {
    const v = vectors[i];
    if (v) {
      embedMap.set(needEmbed[i], v);
    } else {
      missCount += 1;
    }
  }
  if (missCount > 0) {
    logMemory('structured_embed_miss', { missCount, stepCount: needEmbed.length, mode });
  }
}

function quantile(sortedAsc, q) {
  if (!Array.isArray(sortedAsc) || sortedAsc.length === 0) return null;
  const qq = Math.min(1, Math.max(0, q));
  const pos = qq * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const w = pos - lo;
  return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

/** NEXT_ROLE hybrid final score: cosine × (1 − seniority penalty) from `scoreNextRole`. */
function getHybridFinalNextScore(step) {
  const h = typeof step.hybridScoreNextRole === 'number' ? step.hybridScoreNextRole : null;
  return h != null && Number.isFinite(h) ? h : null;
}

/** OUT_OF_THE_BOX hybrid final: cosine × (1 − seniority penalty) from `scoreOutOfTheBox`. */
function getHybridFinalOotbScore(step) {
  const h = typeof step.hybridScoreOutOfTheBox === 'number' ? step.hybridScoreOutOfTheBox : null;
  return h != null && Number.isFinite(h) ? h : null;
}

function buildStepObject(scoredPath, { category }) {
  const requiredSkills = safeArray(scoredPath.requiredSkills);
  const canonicalCareerPathId = scoredPath?._id || scoredPath?.careerPathId || null;

  // Build client-safe seniority (strip extraction_confidence / built_with)
  let seniority = null;
  if (scoredPath.seniority && scoredPath.seniority.seniority_label) {
    seniority = {
      seniority_level: scoredPath.seniority.seniority_level,
      seniority_label: scoredPath.seniority.seniority_label,
      seniority_reasoning: scoredPath.seniority.seniority_reasoning || ''
    };
  }

  // Build client-safe keyResponsibilities (strip metadata)
  let keyResponsibilities = null;
  const rawResp = scoredPath.keyResponsibilities;
  if (rawResp && Array.isArray(rawResp.responsibilities) && rawResp.responsibilities.length > 0) {
    keyResponsibilities = { responsibilities: rawResp.responsibilities };
  }

  // Build client-safe skillDomains (strip metadata)
  let skillDomains = null;
  const rawDomains = scoredPath.skillDomains;
  if (rawDomains && Array.isArray(rawDomains.skill_domains) && rawDomains.skill_domains.length > 0) {
    skillDomains = {
      skill_domains: rawDomains.skill_domains.map(d => ({
        domain: d.domain,
        importance: d.importance,
        mapped_items: safeArray(d.mapped_items)
      }))
    };
  }

  // Build client-safe skillModel (core + optional skills only, no weights)
  let skillModel = null;
  const rawModel = scoredPath.skillModel;
  if (rawModel && (safeArray(rawModel.core_skills).length > 0 || safeArray(rawModel.optional_skills).length > 0)) {
    skillModel = {
      core_skills: safeArray(rawModel.core_skills),
      optional_skills: safeArray(rawModel.optional_skills)
    };
  }

  const step = {
    _id: canonicalCareerPathId || undefined,
    careerPathId: canonicalCareerPathId || undefined,
    title: scoredPath.title,
    description: scoredPath.description,
    hybridScoreNextRole: scoredPath.hybridScoreNextRole,
    hybridCosineNextRole: scoredPath.hybridCosineNextRole,
    hybridScoreOutOfTheBox: scoredPath.hybridScoreOutOfTheBox,
    hybridCosineOutOfTheBox: scoredPath.hybridCosineOutOfTheBox,
    matchedSkills: safeArray(scoredPath.matchedSkills),
    matchedInputs: safeArray(scoredPath.matchedInputs),
    skillGaps: safeArray(scoredPath.skillGaps),
    recommendedActions: safeArray(scoredPath.recommendedActions),
    progressionNotes: safeArray(scoredPath.progressionNotes),
    escoId: scoredPath.escoId,
    requiredSkills,
    altTitles: safeArray(scoredPath.altTitles),
    hiddenTitles: safeArray(scoredPath.hiddenTitles),
    category,
    // Enrichment fields (client-safe subsets)
    seniority,
    keyResponsibilities,
    skillDomains,
    skillModel
  };

  // Optional: present when paths include multi-dimensional legacy score fields on stored data
  if (scoredPath.score != null && Number.isFinite(scoredPath.score)) step.score = scoredPath.score;
  if (scoredPath.scoreBreakdown != null) step.scoreBreakdown = scoredPath.scoreBreakdown;
  if (scoredPath.scoringDebug != null) step.scoringDebug = scoredPath.scoringDebug;
  if (scoredPath.weights != null && typeof scoredPath.weights === 'object') step.scoringWeights = scoredPath.weights;
  if (scoredPath.educationMatch != null) step.educationMatch = scoredPath.educationMatch;
  if (scoredPath.experienceAlignment != null) step.experienceAlignment = scoredPath.experienceAlignment;

  // Preserve full roleVectors for mode-specific hybrid computation (MMR, diversity)
  const rv = scoredPath.roleVectors;
  if (rv && typeof rv === 'object') {
    step.roleVectors = rv;
    if (rv.hybrid_vector && Array.isArray(rv.hybrid_vector) && rv.hybrid_vector.length > 0) {
      step.hybrid_vector = rv.hybrid_vector;
    }
  }

  return step;
}

async function defaultEmbeddingForStep(step) {
  return getEmbeddingForMatching(step, async (s) => {
    const txt = buildCareerStepEmbeddingText(s, { category: s.category });
    return embedTextSafe(txt);
  });
}

/** Mode-specific hybrid vector for MMR; falls back to OpenAI embedding when vectors missing */
async function getEmbeddingForStepWithMode(step, mode) {
  return getHybridVectorForMode(step, mode, async (s) => {
    const txt = buildCareerStepEmbeddingText(s, { category: s.category });
    return embedTextSafe(txt);
  });
}

/**
 * Precompute embeddings for steps in batch. Uses stored vectors when available (3072-dim),
 * otherwise batch-embeds via API. Returns Map<step, Float32Array>.
 */
async function precomputeStepEmbeddings(steps, mode) {
  const map = new Map();
  const needEmbed = [];

  for (const step of steps) {
    const vec = await getEmbeddingForStepWithMode(step, mode);
    if (vec) {
      map.set(step, vec);
    } else {
      const hybrid = step.roleVectors?.hybrid_vector || step.hybrid_vector;
      if (hybrid && Array.isArray(hybrid) && hybrid.length === EMBEDDING_DIMS) {
        map.set(step, new Float32Array(hybrid));
      } else {
        needEmbed.push(step);
      }
    }
  }

  if (needEmbed.length > 0) {
    const texts = needEmbed.map((s) => buildCareerStepEmbeddingText(s, { category: s.category }));
    const vectors = await embedTextBatchSafe(texts);
    for (let i = 0; i < needEmbed.length; i++) {
      const v = vectors[i];
      if (v) map.set(needEmbed[i], v);
    }
  }

  return map;
}

/**
 * Precompute structured-only embeddings for novelty calculations.
 * For OOTB novelty we intentionally avoid hybrid vectors and use structure-only similarity.
 */
async function precomputeStructuredStepEmbeddings(steps, mode) {
  const map = new Map();
  const needEmbed = [];

  for (const step of steps) {
    const structured = getStructuredVectorForMode(step, mode);
    if (structured) {
      map.set(step, structured);
    } else {
      needEmbed.push(step);
    }
  }

  // Fallback for legacy/missing vectors: keep behavior deterministic via text embedding.
  if (needEmbed.length > 0) {
    const texts = needEmbed.map((s) => buildCareerStepEmbeddingText(s, { category: s.category }));
    const vectors = await embedTextBatchSafe(texts);
    for (let i = 0; i < needEmbed.length; i++) {
      const v = vectors[i];
      if (v) map.set(needEmbed[i], v);
    }
  }

  return map;
}

async function rerankWithDiversity(steps, { k, lambda, minNovelty, normalizationMode, mode = 'NEXT_ROLE' } = {}) {
  const precomputedEmbedMap = await precomputeStepEmbeddings(steps, mode);
  const embedFn = (it) => getEmbeddingForStepWithMode(it, mode);
  const scoreFn = mode === 'OUT_OF_THE_BOX'
    ? (it) => {
      const h = getHybridFinalOotbScore(it);
      return h != null ? h : 0;
    }
    : (it) => {
      const h = getHybridFinalNextScore(it);
      return h != null ? h : 0;
    };
  return mmrSelect(steps, {
    k,
    lambda,
    minNovelty,
    normalizationMode,
    embedFn,
    scoreFn,
    precomputedEmbedMap,
  });
}

function stepTitleLower(p) {
  if (p?.title == null) return '';
  return String(getEnglishField(p.title)).toLowerCase();
}

/** Dedup / exclusion key: English title when present, else stable id (i18n-only titles were blank and dropped the whole OOTB pool). */
function stepPoolExclusionKey(p) {
  const t = stepTitleLower(p).trim();
  if (t) return t;
  if (p?.escoId) return `esco:${String(p.escoId).trim().toLowerCase()}`;
  if (p?._id) return `id:${String(p._id)}`;
  return '';
}

function filterUniqueByTitle(steps) {
  const seen = new Set();
  const out = [];
  for (const s of safeArray(steps)) {
    const key = stepTitleLower(s).trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

async function computeMaxSimilarityToSet(step, setSteps, embedMap) {
  if (!setSteps || setSteps.length === 0) return 0;
  const emb = embedMap.get(step) || await defaultEmbeddingForStep(step);
  let max = 0;
  for (const s of setSteps) {
    const e = embedMap.get(s) || await defaultEmbeddingForStep(s);
    const sim = cosineSimilarity(emb, e);
    if (sim > max) max = sim;
  }
  return max;
}

async function computePairwiseSimilarityPercentile(steps, embedMap, percentile) {
  const arr = safeArray(steps);
  if (arr.length < 2) return null;
  const sims = [];
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    const ea = embedMap.get(a) || await defaultEmbeddingForStep(a);
    for (let j = i + 1; j < arr.length; j++) {
      const b = arr[j];
      const eb = embedMap.get(b) || await defaultEmbeddingForStep(b);
      sims.push(cosineSimilarity(ea, eb));
    }
  }
  if (sims.length === 0) return null;
  sims.sort((x, y) => x - y);
  return quantile(sims, percentile);
}

/**
 * Phase 2 prioritized list generator:
 * - NEXT_ROLE: rank by HybridFinalNEXT (hybrid cosine after seniority penalty), top-N pool,
 *   then MMR for diversity using that score as base relevance (not 6-dim + hybrid).
 * - OUT_OF_THE_BOX: exploration criteria (identity ≥ threshold, structure in bounds),
 *   novelty vs next; rank by HybridFinalOOTB, top-N pool, MMR with that score as base relevance
 */
async function generatePrioritizedListsPhase2(scoredPaths, userProfile, options = {}) {
  logMemory('before_prioritized_lists_phase2', {
    scoredPathsCount: safeArray(scoredPaths).length,
  });
  const careerGoal = userProfile && userProfile.careerGoal ? String(userProfile.careerGoal) : '';
  const careerGoalLower = careerGoal.toLowerCase();
  const excludeTitleMatchingCareerGoal =
    typeof careerGoalLower === 'string' &&
    careerGoalLower.trim().length >= MIN_CAREER_GOAL_CHARS_FOR_TITLE_SUBSTRING_FILTER;

  const poolSize =
    typeof options.nextMmrCandidatePoolSize === 'number' && options.nextMmrCandidatePoolSize > 0
      ? options.nextMmrCandidatePoolSize
      : DEFAULT_NEXT_MMR_CANDIDATE_POOL_SIZE;

  const outsidePoolSize =
    typeof options.outsideMmrCandidatePoolSize === 'number' && options.outsideMmrCandidatePoolSize > 0
      ? options.outsideMmrCandidatePoolSize
      : DEFAULT_OUTSIDE_MMR_CANDIDATE_POOL_SIZE;

  // Next candidates: HybridFinalNEXT only. Sort/dedupe on lean path objects first, then build steps
  // with roleVectors only for the top-N pool — avoids holding ~1k× full embedding blobs in memory.
  const nextEligibleRaw = safeArray(scoredPaths).filter((p) => {
    const title = stepTitleLower(p);
    const hybridFinal = getHybridFinalNextScore(p);
    if (hybridFinal == null || hybridFinal <= 0) return false;
    if (excludeTitleMatchingCareerGoal && title.includes(careerGoalLower)) return false;
    return true;
  });

  const sortedByHybridNext = [...nextEligibleRaw].sort(
    (a, b) => (b.hybridScoreNextRole ?? -Infinity) - (a.hybridScoreNextRole ?? -Infinity)
  );
  const nextPoolRaw = filterUniqueByTitle(sortedByHybridNext).slice(0, poolSize);

  const nextVectorLoader =
    typeof options.nextVectorLoader === 'function'
      ? options.nextVectorLoader
      : (typeof options.vectorLoader === 'function' ? options.vectorLoader : null);
  const outsideVectorLoader =
    typeof options.outsideVectorLoader === 'function'
      ? options.outsideVectorLoader
      : (typeof options.vectorLoader === 'function' ? options.vectorLoader : null);
  const metaLoader =
    typeof options.metaLoader === 'function' ? options.metaLoader : null;

  if (metaLoader && nextPoolRaw.length > 0) {
    await hydrateScoredPathsWithMeta(nextPoolRaw, metaLoader);
    logMemory('after_next_pool_meta_hydrate', { nextPoolSize: nextPoolRaw.length });
  }
  if (nextVectorLoader && nextPoolRaw.length > 0) {
    const needIds = nextPoolRaw.map((p) => p._id).filter(Boolean);
    const loaded = await nextVectorLoader(needIds);
    for (const p of nextPoolRaw) {
      const k = String(p._id || '');
      if (loaded.has(k)) {
        const rv = loaded.get(k);
        if (rv !== undefined) p.roleVectors = rv;
      }
    }
  }

  const nextMmrPool = nextPoolRaw.map((p) => buildStepObject(p, { category: 'nextCareerRoles' }));

  // Next roles: MMR on top-N HybridFinalNEXT pool (base relevance = hybrid final, not 6-dim blend)
  const nextDiverse = await rerankWithDiversity(nextMmrPool, {
    k: options.nextK || 25,
    lambda: options.nextLambda || 0.85,
    minNovelty: options.nextMinNovelty || 0.05,
    normalizationMode: 'global',
    mode: 'NEXT_ROLE'
  });

  // NEXT MMR only needs precomputed Float32Arrays — drop blobs from rejected pool rows.
  // Keep vectors on nextDiverse until novelty embedMap is built (structured hydrate follows).
  const nextDiverseSet = new Set(nextDiverse);
  for (const step of nextMmrPool) {
    if (!nextDiverseSet.has(step)) dropStepVectors(step);
  }
  for (const p of nextPoolRaw) dropRoleVectors(p);
  logMemory('after_next_mmr_vector_cleanup', {
    nextMmrPoolSize: nextMmrPool.length,
    nextDiverseCount: nextDiverse.length,
  });

  const nextTitleSet = new Set(nextDiverse.map((s) => stepPoolExclusionKey(s)).filter(Boolean));

  // NEXT slim hydrate keeps finalVectors.nextRole only; novelty-vs-next needs structured sub-vectors (~25 roles).
  if (outsideVectorLoader && nextDiverse.length > 0) {
    const needIds = nextDiverse.map((s) => s._id).filter(Boolean);
    const loaded = await outsideVectorLoader(needIds);
    for (const s of nextDiverse) {
      const k = String(s._id || '');
      if (!loaded.has(k)) continue;
      const structuredRv = loaded.get(k);
      if (structuredRv === undefined) continue;
      s.roleVectors = s.roleVectors && typeof s.roleVectors === 'object'
        ? { ...s.roleVectors, ...structuredRv }
        : structuredRv;
    }
  }

  // Outside-the-box pool: exploration criteria (identity-aligned structural shift).
  // No 6dim score band filter. Filter by: identity >= threshold, structure in [lower, upper].
  const structureUpper = options.explorationStructureUpperBound ?? EXPLORATION_STRUCTURE_UPPER_BOUND;
  const structureLower = options.explorationStructureLowerBound ?? EXPLORATION_STRUCTURE_LOWER_BOUND;

  const outsidePoolRaw = safeArray(scoredPaths).filter((p) => {
    const key = stepPoolExclusionKey(p);
    if (!key) return false;
    if (nextTitleSet.has(key)) return false;
    if (excludeTitleMatchingCareerGoal && key.includes(careerGoalLower)) return false;
    return true;
  });

  const batchScored = outsidePoolRaw
    .map((role) => ({
      role,
      result: {
        identitySimilarity: role.identitySimilarityOutOfTheBox,
        structuredSimilarity: role.structuredSimilarityOutOfTheBox,
        hybridScoreFinal: role.hybridScoreOutOfTheBox,
        hybridCosine: role.hybridCosineOutOfTheBox,
      },
    }))
    .filter(({ result }) =>
      Number.isFinite(result.identitySimilarity) &&
      Number.isFinite(result.structuredSimilarity) &&
      Number.isFinite(result.hybridScoreFinal)
    );

  // Relative cutoff by default: choose c so that roughly target pass-rate satisfy identitySimilarity >= c.
  // Allows per-user calibration while preserving optional absolute override.
  const identityThreshold = (() => {
    if (typeof options.explorationIdentityThreshold === 'number') {
      return options.explorationIdentityThreshold;
    }
    const passRate = (
      typeof options.explorationIdentityPassRate === 'number' &&
      Number.isFinite(options.explorationIdentityPassRate)
    )
      ? Math.min(1, Math.max(0, options.explorationIdentityPassRate))
      : DEFAULT_EXPLORATION_IDENTITY_PASS_RATE;
    const idScores = batchScored
      .map(({ result }) => result?.identitySimilarity)
      .filter((v) => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (idScores.length === 0) return EXPLORATION_IDENTITY_THRESHOLD;
    const q = 1 - passRate;
    const cutoff = quantile(idScores, q);
    return typeof cutoff === 'number' && Number.isFinite(cutoff)
      ? cutoff
      : EXPLORATION_IDENTITY_THRESHOLD;
  })();

  const explorationOpts = { identityThreshold, structureUpperBound: structureUpper, structureLowerBound: structureLower };

  /** Strict exploration often yields zero passes (structured cosine > legacy upper bound). Cascade until we have a pool. */
  let explorationPassing = batchScored.filter(({ result }) =>
    passesExplorationCriteria(result.identitySimilarity, result.structuredSimilarity, explorationOpts)
  );

  if (explorationPassing.length === 0 && batchScored.length > 0) {
    const relaxedStructural = {
      ...explorationOpts,
      structureUpperBound: Math.min(0.97, Math.max(explorationOpts.structureUpperBound, EXPLORATION_STRUCTURE_UPPER_BOUND + 0.05)),
      structureLowerBound: Math.max(0.12, explorationOpts.structureLowerBound - 0.2),
    };
    explorationPassing = batchScored.filter(({ result }) =>
      passesExplorationCriteria(result.identitySimilarity, result.structuredSimilarity, relaxedStructural)
    );
  }

  if (explorationPassing.length === 0 && batchScored.length > 0) {
    const loweredIdFloor = Math.max(0.4, explorationOpts.identityThreshold - 0.09);
    explorationPassing = batchScored.filter(
      ({ result }) =>
        Number.isFinite(result.identitySimilarity) &&
        result.identitySimilarity >= loweredIdFloor &&
        Number.isFinite(result.hybridScoreFinal) &&
        result.hybridScoreFinal > 0
    );
  }

  if (explorationPassing.length === 0 && batchScored.length > 0) {
    explorationPassing = [...batchScored].sort(
      (a, b) => (b.result.hybridScoreFinal ?? -Infinity) - (a.result.hybridScoreFinal ?? -Infinity)
    );
  }

  const explorationVectorCapRaw = Number(process.env.SIMULATION_EXPLORATION_VECTOR_CAP || '500');
  const explorationVectorCap = Number.isFinite(explorationVectorCapRaw)
    ? Math.max(outsidePoolSize * 4, Math.min(2000, explorationVectorCapRaw))
    : Math.max(outsidePoolSize * 4, 500);

  const explorationSorted = [...explorationPassing].sort(
    (a, b) =>
      ((b.result.hybridScoreFinal ?? -Infinity) - (a.result.hybridScoreFinal ?? -Infinity))
  );

  const explorationScanLimit = Math.min(explorationSorted.length, explorationVectorCap);
  const explorationHydrateChunkSize = resolveExplorationHydrateChunkSize();
  const novelTargetCount = outsidePoolSize * EXPLORATION_NOVEL_TARGET_POOL_MULTIPLIER;

  logMemory('before_exploration_chunked_hydrate', {
    explorationPassingCount: explorationPassing.length,
    explorationScanLimit,
    explorationHydrateChunkSize,
    novelTargetCount,
    outsidePoolSize,
  });

  // NEXT embeddings only — exploration vectors are hydrated per chunk below.
  const embedMap = await precomputeStructuredStepEmbeddings(nextDiverse, 'OUT_OF_THE_BOX');

  // Relative novelty threshold:
  // similarity threshold = 75th percentile of pairwise NEXT↔NEXT similarities
  // novelty threshold = 1 - similarity threshold
  const nextSimilarityP75 = await computePairwiseSimilarityPercentile(nextDiverse, embedMap, 0.75);
  const defaultSimilarityThreshold = typeof nextSimilarityP75 === 'number' && Number.isFinite(nextSimilarityP75)
    ? nextSimilarityP75
    : 0.80;
  const noveltyThresholdVsNext = (() => {
    if (typeof options.outsideNoveltyVsNextThreshold === 'number' && Number.isFinite(options.outsideNoveltyVsNextThreshold)) {
      return Math.min(1, Math.max(0, options.outsideNoveltyVsNextThreshold));
    }
    const computed = Math.min(1, Math.max(0, 1 - defaultSimilarityThreshold));
    return Math.min(computed, MAX_OUTSIDE_NOVELTY_THRESHOLD_VS_NEXT);
  })();

  const explorationCandidatesAll = [];
  const outsideNovelVsNext = [];
  const totalExplorationChunks = Math.ceil(explorationScanLimit / explorationHydrateChunkSize) || 0;
  let explorationChunksProcessed = 0;
  let explorationScannedCount = 0;

  for (let ci = 0; ci < explorationScanLimit; ci += explorationHydrateChunkSize) {
    const chunk = explorationSorted.slice(ci, Math.min(ci + explorationHydrateChunkSize, explorationScanLimit));
    explorationChunksProcessed += 1;
    explorationScannedCount += chunk.length;
    const chunkIndex = Math.floor(ci / explorationHydrateChunkSize);

    if (outsideVectorLoader && chunk.length > 0) {
      const needIds = chunk.map(({ role }) => role._id).filter(Boolean);
      const loaded = await outsideVectorLoader(needIds);
      for (const { role } of chunk) {
        const k = String(role._id || '');
        if (loaded.has(k)) {
          const rv = loaded.get(k);
          if (rv !== undefined) role.roleVectors = rv;
        }
      }
    }

    const chunkSteps = chunk.map(({ role, result }) => buildExplorationNoveltyStep(role, result));
    await mergeStructuredStepEmbeddings(chunkSteps, embedMap, 'OUT_OF_THE_BOX', { metaLoader });

    for (let si = 0; si < chunk.length; si += 1) {
      const { role } = chunk[si];
      const step = chunkSteps[si];
      if (!embedMap.has(step)) {
        logMemory('exploration_embed_missing_before_novelty', {
          chunkIndex,
          stepId: String(step._id || ''),
        });
        dropRoleVectors(role);
        dropStepVectors(step);
        continue;
      }
      const maxSim = await computeMaxSimilarityToSet(step, nextDiverse, embedMap);
      const noveltyVsNext = 1 - maxSim;
      step.maxSimilarityToNextRoles = maxSim;
      step.noveltyScore = noveltyVsNext;
      step.noveltyVsNextThreshold = noveltyThresholdVsNext;
      step.noveltyVsNext = noveltyVsNext;
      explorationCandidatesAll.push(step);
      dropRoleVectors(role);
      dropStepVectors(step);
      if (noveltyVsNext >= noveltyThresholdVsNext) outsideNovelVsNext.push(step);
    }

    const uniqueNovelCount = filterUniqueByTitle(outsideNovelVsNext).length;
    logMemory('after_exploration_chunk', {
      chunkIndex,
      totalExplorationChunks,
      chunkSize: chunk.length,
      explorationScannedCount,
      explorationCandidatesCount: explorationCandidatesAll.length,
      outsideNovelVsNextCount: outsideNovelVsNext.length,
      uniqueNovelCount,
    });

    if (uniqueNovelCount >= novelTargetCount) break;
  }

  // Novelty-vs-next uses embedMap only — nextDiverse blobs no longer needed.
  for (const s of nextDiverse) dropStepVectors(s);

  let ootbNovelPool = outsideNovelVsNext;
  if (ootbNovelPool.length === 0 && explorationCandidatesAll.length > 0) {
    ootbNovelPool = [...explorationCandidatesAll];
  }

  const sortedByHybridOotb = [...ootbNovelPool].sort(
    (a, b) => (getHybridFinalOotbScore(b) ?? -Infinity) - (getHybridFinalOotbScore(a) ?? -Infinity)
  );
  const outsideMmrPool = filterUniqueByTitle(sortedByHybridOotb).slice(0, outsidePoolSize);

  if (metaLoader && outsideMmrPool.length > 0) {
    const poolNeedMeta = outsideMmrPool.filter((s) => {
      const desc = s.description != null ? getEnglishField(s.description) : '';
      return !String(desc).trim();
    });
    if (poolNeedMeta.length > 0) {
      await hydrateScoredPathsWithMeta(poolNeedMeta, metaLoader);
    }
    logMemory('after_exploration_meta_hydrate', {
      outsideMmrPoolSize: outsideMmrPool.length,
      poolNeedMetaCount: poolNeedMeta.length,
    });
  }

  // OOTB MMR novelty must use structured cosine similarity only — reuse novelty embedMap when present.
  const outsidePrecomputed = new Map();
  const outsideMmrNeedEmbed = [];
  for (const s of outsideMmrPool) {
    const emb = embedMap.get(s);
    if (emb) {
      outsidePrecomputed.set(s, emb);
    } else {
      outsideMmrNeedEmbed.push(s);
    }
  }
  if (outsideMmrNeedEmbed.length > 0) {
    logMemory('outside_mmr_embed_fallback', { count: outsideMmrNeedEmbed.length });
    const extra = await precomputeStructuredStepEmbeddings(outsideMmrNeedEmbed, 'OUT_OF_THE_BOX');
    for (const [step, emb] of extra) {
      embedMap.set(step, emb);
      outsidePrecomputed.set(step, emb);
    }
  }

  // MMR only needs pool embeddings — release scanned-but-rejected entries.
  pruneEmbedMap(embedMap, outsideMmrPool);

  logMemory('after_exploration_vector_cleanup', {
    explorationCandidatesCount: explorationCandidatesAll.length,
    explorationScannedCount,
    explorationChunksProcessed,
    outsideMmrPoolSize: outsideMmrPool.length,
    outsideMmrNeedEmbedCount: outsideMmrNeedEmbed.length,
    embedMapSize: embedMap.size,
  });
  const outsideDiverse = await mmrSelect(outsideMmrPool, {
    k: options.outsideK || 25,
    lambda: options.outsideLambda ?? 0.65,
    minNovelty: options.outsideMinNovelty ?? 0.06,
    normalizationMode: 'global',
    embedFn: (it) => Promise.resolve(outsidePrecomputed.get(it)),
    scoreFn: (it) => {
      const h = getHybridFinalOotbScore(it);
      return h != null ? h : 0;
    },
    precomputedEmbedMap: outsidePrecomputed,
  });

  const outsideFinal = outsideDiverse;

  logMemory('after_prioritized_lists_phase2', {
    scoredPathsCount: safeArray(scoredPaths).length,
    nextEligibleCount: nextEligibleRaw.length,
    nextPoolSize: nextPoolRaw.length,
    nextMmrPoolSize: nextMmrPool.length,
    nextDiverseCount: nextDiverse.length,
    outsidePoolRawCount: outsidePoolRaw.length,
    outsideFinalCount: outsideFinal.length,
  });

  return {
    nextCareerRoles: nextDiverse.map((s) => ({
      ...s,
      noveltyScore: s.diversity ? s.diversity.noveltyScore : undefined,
      maxSimilarityToSelected: s.diversity ? s.diversity.maxSimilarityToSelected : undefined,
      mmrScore: s.diversity ? s.diversity.mmrScore : undefined
    })),
    outsideTheBoxRoles: outsideFinal.map((s) => ({
      ...s,
      noveltyScore: s.diversity ? s.diversity.noveltyScore : undefined,
      maxSimilarityToSelected: s.diversity ? s.diversity.maxSimilarityToSelected : undefined,
      mmrScore: s.diversity ? s.diversity.mmrScore : undefined
    }))
  };
}

module.exports = {
  generatePrioritizedListsPhase2,
  rerankWithDiversity,
  precomputeStepEmbeddings,
  precomputeStructuredStepEmbeddings,
  computeMaxSimilarityToSet,
  computePairwiseSimilarityPercentile,
  filterUniqueByTitle,
  DEFAULT_NEXT_MMR_CANDIDATE_POOL_SIZE,
  DEFAULT_OUTSIDE_MMR_CANDIDATE_POOL_SIZE,
};

