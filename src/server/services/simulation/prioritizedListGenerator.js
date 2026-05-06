const { getEnglishField } = require('../../utils/i18nFields');
const { mmrSelect, embedTextSafe, embedTextBatchSafe, buildCareerStepEmbeddingText, cosineSimilarity, EMBEDDING_DIMS } = require('../embedding/embeddingService');
const { getEmbeddingForMatching, getHybridVectorForMode, getStructuredVectorForMode } = require('../embedding/roleVectorService');
const {
  passesExplorationCriteria,
  EXPLORATION_IDENTITY_THRESHOLD,
  EXPLORATION_STRUCTURE_UPPER_BOUND,
  EXPLORATION_STRUCTURE_LOWER_BOUND,
} = require('../embedding/roleMatchingScorer');

/** Top-N roles by HybridFinalNEXT before NEXT_ROLE MMR (diversity pass). */
const DEFAULT_NEXT_MMR_CANDIDATE_POOL_SIZE = 150;

/** Top-N roles by HybridFinalOOTB before OUT_OF_THE_BOX MMR (diversity pass). */
const DEFAULT_OUTSIDE_MMR_CANDIDATE_POOL_SIZE = 150;

/** Cap how much novelty-vs-next we require (lower max threshold = easier pass). Previous 0.35 still emptied pools. */
const MAX_OUTSIDE_NOVELTY_THRESHOLD_VS_NEXT = 0.22;

/** Skip `title.includes(careerGoal)` when goal is short — common tokens remove nearly the entire pool. */
const MIN_CAREER_GOAL_CHARS_FOR_TITLE_SUBSTRING_FILTER = 14;

const DEFAULT_EXPLORATION_IDENTITY_PASS_RATE = 0.60;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
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

  // Optional: present only when paths were scored with legacy careerPathScorerLegacy (evaluation / tooling)
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
  const careerGoal = userProfile && userProfile.careerGoal ? String(userProfile.careerGoal) : '';
  const careerGoalLower = careerGoal.toLowerCase();

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

  const vectorLoader =
    typeof options.vectorLoader === 'function' ? options.vectorLoader : null;
  if (vectorLoader && nextPoolRaw.length > 0) {
    const needIds = nextPoolRaw.map((p) => p._id).filter(Boolean);
    const loaded = await vectorLoader(needIds);
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

  const nextTitleSet = new Set(nextDiverse.map((s) => stepPoolExclusionKey(s)).filter(Boolean));

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

  const explorationCapped = explorationSorted.slice(0, explorationVectorCap);

  if (vectorLoader && explorationCapped.length > 0) {
    const needIds = explorationCapped.map(({ role }) => role._id).filter(Boolean);
    const loaded = await vectorLoader(needIds);
    for (const { role } of explorationCapped) {
      const k = String(role._id || '');
      if (loaded.has(k)) {
        const rv = loaded.get(k);
        if (rv !== undefined) role.roleVectors = rv;
      }
    }
  }

  let explorationCandidates = explorationCapped.map(({ role, result }) => {
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
    });

  // Build structured-only embedding cache for OOTB novelty-vs-next (batch for performance)
  const allForEmbed = [...nextDiverse];
  for (const s of explorationCandidates) {
    if (!allForEmbed.includes(s)) allForEmbed.push(s);
  }
  const embedMap = await precomputeStructuredStepEmbeddings(allForEmbed, 'OUT_OF_THE_BOX');

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

  for (const s of explorationCandidates) {
    const maxSim = await computeMaxSimilarityToSet(s, nextDiverse, embedMap);
    s.maxSimilarityToNextRoles = maxSim;
    s.noveltyScore = 1 - maxSim;
  }

  const outsideNovelVsNext = [];
  for (const s of explorationCandidates) {
    const maxSim = s.maxSimilarityToNextRoles ?? await computeMaxSimilarityToSet(s, nextDiverse, embedMap);
    const noveltyVsNext = 1 - maxSim;
    s.noveltyVsNextThreshold = noveltyThresholdVsNext;
    s.noveltyVsNext = noveltyVsNext;
    if (noveltyVsNext >= noveltyThresholdVsNext) outsideNovelVsNext.push(s);
  }

  let ootbNovelPool = outsideNovelVsNext;
  if (ootbNovelPool.length === 0 && explorationCandidates.length > 0) {
    ootbNovelPool = [...explorationCandidates];
  }

  const sortedByHybridOotb = [...ootbNovelPool].sort(
    (a, b) => (getHybridFinalOotbScore(b) ?? -Infinity) - (getHybridFinalOotbScore(a) ?? -Infinity)
  );
  const outsideMmrPool = filterUniqueByTitle(sortedByHybridOotb).slice(0, outsidePoolSize);

  // OOTB MMR novelty must use structured cosine similarity only.
  const outsidePrecomputed = await precomputeStructuredStepEmbeddings(outsideMmrPool, 'OUT_OF_THE_BOX');
  const outsideDiverse = await mmrSelect(outsideMmrPool, {
    k: options.outsideK || 25,
    lambda: options.outsideLambda ?? 0.65,
    minNovelty: options.outsideMinNovelty ?? 0.06,
    normalizationMode: 'global',
    embedFn: (it) => Promise.resolve(outsidePrecomputed.get(it) ?? embedMap.get(it)),
    scoreFn: (it) => {
      const h = getHybridFinalOotbScore(it);
      return h != null ? h : 0;
    },
    precomputedEmbedMap: outsidePrecomputed,
  });

  const outsideFinal = outsideDiverse;

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

