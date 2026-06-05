'use strict';

/**
 * Career simulation execution (controller-free entry for workers).
 * Depends on injected domain helpers via profileController snapshot (lazy) — no SimulationJob writes here.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../../models/User');
const CareerPath = require('../../models/CareerPath');
const { getSimulationRoleVectorCache } = require('./simulationVectorCache');
const {
  ensureDocumentEnrichmentRefreshJobQueued,
} = require('../simulationJobService');
const { getEnrichedSimulationInputs } = require('../documents/profileEnrichmentService');
const {
  ensureUserIdentityEmbeddingCachedByUserId,
  normalizeUserIdentityAnswers,
  topicsStringToInterestTokens,
} = require('../embedding/userIdentityEmbeddingTextService');
const { generateCareerSlogan } = require('../jobAnalysis/careerSloganGenerator');
const localizedContentService = require('../localization/localizedContentService');
const { enrichCareerPathWithHybridScores } = require('../scoring/careerPathScorer');
const { buildUserProfileForHybrid } = require('../scoring/hybridUserProfileForMatching');
const { generatePrioritizedListsPhase2 } = require('./prioritizedListGenerator');
const { EMBEDDING_DIMS } = require('../embedding/embeddingService');
const { logMemory } = require('./simulationMemoryProfiler');

function logStructured(component, payload) {
  const line = { ts: new Date().toISOString(), component, ...payload };
  try {
    console.log(JSON.stringify(line));
  } catch (_) {
    console.log(component, payload);
  }
}

function resolveDeps(overrideDeps) {
  if (overrideDeps) return overrideDeps;
  const pc = require('../../controllers/profileController');
  const d = pc.__careerSimulationDepsForEngine;
  if (!d) {
    throw new Error('[simulation-engine] profileController.__careerSimulationDepsForEngine not initialized');
  }
  return d;
}

/**
 * Runs the same logic as POST /profile/simulation. resLike must mimic Express (status/json).
 */
async function executeCareerSimulation(reqLike, resLike, options = {}) {
  const jobId = options.jobId ?? null;
  const ctx = options.context || 'worker';
  const isForkChild = ctx === 'fork-child';
  const deps = resolveDeps(options.deps);
  logStructured('[simulation-engine]', { jobId, event: 'simulation_start', context: ctx });
  logMemory('simulation_start', { jobId, context: ctx });
  try {
    await runCareerSimulationImpl(reqLike, resLike, deps, {
      isForkChild,
      abortSignal: options.abortSignal || null,
    });
    logStructured('[simulation-engine]', { jobId, event: 'simulation_invoke_completed', context: ctx });
  } catch (err) {
    logStructured('[simulation-engine]', {
      jobId,
      event: 'simulation_error_boundary',
      context: ctx,
      error: err?.message || String(err),
    });
    throw err;
  }
}


async function runCareerSimulationImpl(reqLike, resLike, deps, runtimeOpts = {}) {
  const {
    computeProfileCompletion,
    MIN_SIMULATION_PROFILE_COMPLETION_PCT,
    readDimensionRawItems,
    resolveDomainsFromStructuredInfo,
    calculateCareerSimulationInputs,
    toPositiveIntEnv,
    attachDeterministicStepIdsToPrioritizedLists,
    buildCareerPathDocMapsForSteps,
    localizeOneCareerPathShapedStep,
    logControllerError,
    ALGORITHM_VERSION,
    SCORING_VERSION,
  } = deps;
  console.time('TOTAL');
  let step1Started = false;
  let step2Started = false;
  let step3Started = false;
  let step4Started = false;
  try {
    const startedAt = Date.now();

    const userId = reqLike.user && (reqLike.user.id || reqLike.user.userId);
    if (!userId) {
      return resLike.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Fetch user profile
    console.time('STEP_1_load');
    step1Started = true;
    const user = await User.findById(userId).lean();
    if (!user) {
      console.timeEnd('STEP_1_load');
      step1Started = false;
      return resLike.status(404).json({ success: false, message: 'User not found' });
    }

    const completionBreakdown = computeProfileCompletion(user.profile);
    if (completionBreakdown.overall < MIN_SIMULATION_PROFILE_COMPLETION_PCT) {
      console.timeEnd('STEP_1_load');
      step1Started = false;
      return resLike.status(403).json({
        success: false,
        message: `Your profile is ${completionBreakdown.overall}% complete. Complete at least ${MIN_SIMULATION_PROFILE_COMPLETION_PCT}% of your profile to run a simulation.`,
        profileCompletion: completionBreakdown.overall,
        completion: completionBreakdown,
        minRequired: MIN_SIMULATION_PROFILE_COMPLETION_PCT,
      });
    }
    const completion = completionBreakdown.overall;

    const profile = user.profile || {};
    // Deterministic IDs require a stable simulationId generated server-side.
    const simulationId = crypto.randomUUID();

    // Use career simulation inputs as primary source for matching
    const careerInputs = profile.careerSimulationInputs || {};

    // If inputs are missing/empty (common when profile was edited but inputs not recalculated),
    // compute them on the fly so we can actually match against the user's profile.
    const csiSkillCount = readDimensionRawItems(careerInputs.structuredUserInfo?.skills).length;
    const profileSkillCount = readDimensionRawItems(profile.structuredUserInfo?.skills).length;
    const hasAnyCareerInputs =
      csiSkillCount > 0 ||
      readDimensionRawItems(careerInputs.structuredUserInfo?.keyResponsibilities).length > 0 ||
      resolveDomainsFromStructuredInfo(careerInputs.structuredUserInfo || {}).length > 0;
    const skillsMissingFromCsi = profileSkillCount > 0 && csiSkillCount === 0;

    const computedInputs = (
      !careerInputs.isManuallyEdited && (!hasAnyCareerInputs || skillsMissingFromCsi)
    )
      ? await calculateCareerSimulationInputs(profile)
      : null;

    const activeInputs = computedInputs || careerInputs;

    // Phase 3: Enrich simulation inputs from uploaded documents (CV/resume/LinkedIn PDF).
    // This is additive: it merges signals into activeInputs and caches extraction on the user.
    let enrichment = null;
    let enrichedInputs = activeInputs;
    try {
      const enrichmentResult = await getEnrichedSimulationInputs({
        userId,
        baseInputs: activeInputs,
        force: false,
        cacheOnly: true,
      });
      enrichedInputs = enrichmentResult.inputs || activeInputs;
      enrichment = enrichmentResult.enrichment || null;
      logMemory('after_enrichment', {
        userId: String(userId),
        cacheMiss: Boolean(enrichmentResult.cacheMiss),
        hasEnrichmentPayload: Boolean(enrichment),
      });
      if (enrichmentResult.cacheMiss) {
        ensureDocumentEnrichmentRefreshJobQueued({ userId, language: reqLike.language || 'en' }).catch((err) => {
          console.warn('Failed to queue document enrichment refresh job:', err?.message || err);
        });
      }
    } catch (e) {
      console.warn('Document enrichment failed (non-fatal):', e.message);
    }

    // Opportunistically persist computed inputs for future runs (but don't override manual edits)
    if (computedInputs) {
      try {
        await User.findByIdAndUpdate(userId, {
          $set: {
            'profile.careerSimulationInputs': {
              ...computedInputs,
              isManuallyEdited: false
            }
          }
        });
      } catch (e) {
        // Non-fatal: simulation can continue even if we can't persist.
        console.warn('Failed to persist computed careerSimulationInputs:', e.message);
      }
    }

    try {
      const identityCache = await ensureUserIdentityEmbeddingCachedByUserId(userId);
      if (identityCache && enrichedInputs && typeof enrichedInputs === 'object') {
        enrichedInputs.embeddingOptimizedUserIdentityText = identityCache.text;
        enrichedInputs.embeddingUserIdentitySourceFingerprint = identityCache.fingerprint;
      }
    } catch (e) {
      console.warn('User identity embedding cache failed (non-fatal):', e.message);
    }
    console.timeEnd('STEP_1_load');
    step1Started = false;
    logMemory('after_profile_load', {
      userId: String(userId),
      profileCompletionPct: completionBreakdown.overall,
      usedComputedInputs: Boolean(computedInputs),
      hasCareerSimulationInputs: Boolean(careerInputs && Object.keys(careerInputs).length > 0),
    });

    const userSkills = readDimensionRawItems(enrichedInputs.structuredUserInfo?.skills);
    const userSkillsInDevelopment = readDimensionRawItems(enrichedInputs.structuredUserInfo?.skillsInDevelopment);
    const userSkillNames = userSkills.map(s => s.toLowerCase());

    // Also include other relevant data from career simulation inputs
    const userWorkExperience = readDimensionRawItems(enrichedInputs.structuredUserInfo?.keyResponsibilities).length > 0
      ? [{ title: 'What are you good at?', keyResponsibilities: readDimensionRawItems(enrichedInputs.structuredUserInfo?.keyResponsibilities) }]
      : [];
    const userEducation = {};
    const userSkillDomains = readDimensionRawItems(enrichedInputs.structuredUserInfo?.skillDomains);
    const rawDomains = readDimensionRawItems(enrichedInputs.structuredUserInfo?.domains);
    const userCareerPreferences = {
      domains: rawDomains,
    };
    const mergedIdentityAnswers = normalizeUserIdentityAnswers({
      ...(profile.userIdentityAnswers && typeof profile.userIdentityAnswers === 'object' ? profile.userIdentityAnswers : {}),
      ...(enrichedInputs.userIdentity && typeof enrichedInputs.userIdentity === 'object' ? enrichedInputs.userIdentity : {}),
    });
    const userInterests = topicsStringToInterestTokens(mergedIdentityAnswers.topicsIndustriesInterest);

    // Identity and seniority: prefer merged simulation identity answers, optional request body goal for this run
    const bio =
      mergedIdentityAnswers.workEnjoyMost ||
      (profile.personalInfo?.bio ? String(profile.personalInfo.bio).trim() : '');
    const rawCareerGoal =
      mergedIdentityAnswers.workingLifeAchievement ||
      (reqLike.body?.careerGoal ? String(reqLike.body.careerGoal).trim() : null) ||
      null;
    const careerGoalResult = await generateCareerSlogan(rawCareerGoal || '', {
      lang: reqLike.language,
      returnBundle: true,
    });
    const careerGoal = careerGoalResult.canonical;
    const localizedCareerGoal = careerGoalResult.localized?.[reqLike.language] || '';
    logMemory('after_career_goal_generation', {
      userId: String(userId),
      userSkillCount: userSkills.length,
      userSkillKeyCount: userSkillNames.length,
      domainCount: rawDomains.length,
      skillDomainCount: userSkillDomains.length,
    });
    const seniorityInputs = enrichedInputs.seniority && typeof enrichedInputs.seniority === 'object' ? enrichedInputs.seniority : {};
    const currentStatus = seniorityInputs.currentStatus ?? profile.seniority?.currentStatus ?? '';
    const yearsOfExperience = seniorityInputs.yearsOfExperience != null ? seniorityInputs.yearsOfExperience : profile.seniority?.yearsOfExperience;
    const highestDegree = seniorityInputs.highestDegree ?? profile.seniority?.highestDegree ?? '';
    const mostSeniorWorkExperience = seniorityInputs.mostSeniorWorkExperience ?? profile.seniority?.mostSeniorWorkExperience ?? '';
    const dateOfBirth = profile.personalInfo?.dateOfBirth ?? enrichedInputs.dateOfBirth ?? null;

    const normalizeSkillKey = (value) => {
      if (!value) return '';
      return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    };

    // Fetch cached career paths.
    // Data quality + relevance: first try a targeted pull using normalized requiredSkillKeys.
    const escoService = require('../escoService');
    const targetedDefault = runtimeOpts.isForkChild ? 350 : 900;
    const fallbackDefault = runtimeOpts.isForkChild ? 500 : 1200;
    const minPoolDefault = runtimeOpts.isForkChild ? 240 : 350;
    const TARGETED_PATH_LIMIT = toPositiveIntEnv(process.env.SIMULATION_TARGETED_PATH_LIMIT, targetedDefault);
    const FALLBACK_PATH_LIMIT = toPositiveIntEnv(process.env.SIMULATION_FALLBACK_PATH_LIMIT, fallbackDefault);
    const MIN_CANDIDATE_POOL = toPositiveIntEnv(process.env.SIMULATION_MIN_CANDIDATE_POOL, minPoolDefault);

    const userSkillKeys = userSkills.map(normalizeSkillKey).filter(Boolean);
    const picked = [];
    const seen = new Set();

    const simulationCareerPathMetaProjection = {
      _id: 1,
      escoId: 1,
      title: 1,
      description: 1,
      requiredSkills: 1,
      requiredSkillKeys: 1,
      altTitles: 1,
      hiddenTitles: 1,
      seniority: 1,
      keyResponsibilities: 1,
      skillDomains: 1,
      skillModel: 1,
      roleIdentity: 1,
    };

    const simulationCareerPathVectorProjection = {
      ...simulationCareerPathMetaProjection,
      roleVectors: 1,
    };

    if (userSkillKeys.length > 0) {
      const skillMatched = await escoService.getCachedCareerPaths(
        { requiredSkillKeys: { $in: userSkillKeys } },
        { limit: TARGETED_PATH_LIMIT, projection: simulationCareerPathMetaProjection }
      );
      for (const cp of skillMatched) {
        const id = cp.escoId || cp._id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        picked.push(cp);
      }
      logMemory('after_skill_matched_career_paths', {
        userId: String(userId),
        skillMatchedCount: skillMatched.length,
        pickedCount: picked.length,
        targetedPathLimit: TARGETED_PATH_LIMIT,
        userSkillKeyCount: userSkillKeys.length,
      });
    }

    // Fallback/coverage: add more occupations so the sim still works for sparse profiles.
    if (picked.length < MIN_CANDIDATE_POOL) {
      const extra = await escoService.getCachedCareerPaths(
        {},
        { limit: FALLBACK_PATH_LIMIT, projection: simulationCareerPathMetaProjection }
      );
      for (const cp of extra) {
        const id = cp.escoId || cp._id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        picked.push(cp);
        if (picked.length >= FALLBACK_PATH_LIMIT) break;
      }
      logMemory('after_fallback_career_path_expansion', {
        userId: String(userId),
        extraFetchedCount: extra.length,
        pickedCount: picked.length,
        fallbackPathLimit: FALLBACK_PATH_LIMIT,
        minCandidatePool: MIN_CANDIDATE_POOL,
      });
    }

    logMemory('after_candidate_pool', {
      userId: String(userId),
      candidatePoolSize: picked.length,
      seenIdCount: seen.size,
      targetedPathLimit: TARGETED_PATH_LIMIT,
      fallbackPathLimit: FALLBACK_PATH_LIMIT,
    });

    // Fail fast with actionable errors when production data wasn't seeded/migrated.
    // Without stored role vectors, `scoreNextRole` / `scoreOutOfTheBox` return null for every role,
    // which cascades into empty `nextSteps` / `outsideTheBox`.
    const hasRoleIdentityText = (cp) => {
      const text = cp?.roleIdentity?.role_identity_text;
      return typeof text === 'string' && text.trim().length > 0;
    };
    const hasRequiredRoleVectors = (cp) => {
      const rv = cp?.roleVectors;
      if (!rv) return false;

      // `getStructuredVectorForMode` checks `dims !== EMBEDDING_DIMS` and returns null.
      const dims = (typeof rv.dims === 'number' ? rv.dims : EMBEDDING_DIMS);
      if (dims !== EMBEDDING_DIMS) return false;

      const idOk = Array.isArray(rv.identity_vector) && rv.identity_vector.length === EMBEDDING_DIMS;
      if (!idOk) return false;

      const structuredKeys = [
        'structured_vector_occupation_group',
        'structured_vector_skill_domains',
        'structured_vector_responsibilities',
        'structured_vector_required_skills',
        'structured_vector_optional_skills',
      ];
      const structuredOk = structuredKeys.every(
        (k) => Array.isArray(rv[k]) && rv[k].length === EMBEDDING_DIMS
      );
      return structuredOk;
    };

    const careerPathCount = picked.length;
    const roleIdentityReadyCount = picked.filter(hasRoleIdentityText).length;
    let roleVectorsProbe = null;
    if (picked.length > 0) {
      const probeIdSample = picked
        .slice(0, Math.min(picked.length, 96))
        .map((p) => p._id)
        .filter(Boolean);
      roleVectorsProbe = await CareerPath.findOne({
        _id: { $in: probeIdSample },
        roleVectors: { $exists: true, $ne: null },
      })
        .select({ roleVectors: 1 })
        .lean();
    }
    const roleVectorsReadyCount = roleVectorsProbe && hasRequiredRoleVectors(roleVectorsProbe) ? careerPathCount : 0;
    logMemory('after_role_vectors_probe', {
      userId: String(userId),
      careerPathCount,
      roleIdentityReadyCount,
      roleVectorsReadyCount,
      probeSampleSize: picked.length > 0 ? Math.min(picked.length, 96) : 0,
      hasRoleVectorsProbe: Boolean(roleVectorsProbe),
    });

    if (careerPathCount === 0) {
      return resLike.status(503).json({
        success: false,
        message: 'Simulation has no `CareerPath` data to score in this environment.',
        hint:
          'Run an ESCO sync to populate the DB first. Example: `node scripts/syncEscoOccupations.js --limit 5000 --pageSize 200 --enrich`.',
        diagnostics: { careerPathCount },
      });
    }

    if (roleVectorsReadyCount === 0) {
      return resLike.status(503).json({
        success: false,
        message: 'Simulation cannot generate career recommendations because `CareerPath` role embeddings are missing.',
        hint: [
          '1) Build role identity texts (required by embedding scripts): `node scripts/buildRoleIdentityTexts.js --changed-only`.',
          '2) Rebuild role vectors: `npm run rebuild:role-embeddings`.',
          'If you recently deployed and changed embedding dimensions, run the scripts with --force.',
        ].join(' '),
        diagnostics: {
          careerPathCount,
          roleIdentityReadyCount,
          roleVectorsReadyCount,
          expectedEmbeddingDims: EMBEDDING_DIMS,
        },
      });
    }

    const userProfileForScoring = {
      userSkills,
      userSkillDomains,
      userSkillsInDevelopment,
      userWorkExperience,
      userEducation,
      userCareerPreferences,
      userInterests,
      careerGoal,
      bio,
      userIdentityAnswers: mergedIdentityAnswers,
      dateOfBirth,
      currentStatus,
      yearsOfExperience,
      highestDegree,
      mostSeniorWorkExperience,
      embeddingOptimizedUserIdentityText: enrichedInputs.embeddingOptimizedUserIdentityText,
      embeddingUserIdentitySourceFingerprint: enrichedInputs.embeddingUserIdentitySourceFingerprint,
      identityEmbeddingText: String(profile?.who_are_you?.identity_embedding_text || '').trim(),
    };
    logMemory('after_user_profile_for_scoring', {
      userId: String(userId),
      userSkillCount: userSkills.length,
      domainCount: rawDomains.length,
      workExperienceBlockCount: userWorkExperience.length,
    });

    console.time('STEP_2_enrichment');
    step2Started = true;
    const userProfileForHybrid = buildUserProfileForHybrid(userProfileForScoring);
    console.timeEnd('STEP_2_enrichment');
    step2Started = false;
    logMemory('after_hybrid_profile_enrichment', {
      userId: String(userId),
      candidatePoolSize: picked.length,
    });

    console.time('STEP_3_scoring');
    step3Started = true;
    const scoreChunkDefault = runtimeOpts.isForkChild ? 24 : 200;
    const SCORE_CHUNK_SIZE = toPositiveIntEnv(process.env.SIMULATION_SCORE_CHUNK_SIZE, scoreChunkDefault);
    const scoreConcDefault = runtimeOpts.isForkChild ? 1 : 12;
    const SCORE_CONCURRENCY = Math.max(
      1,
      toPositiveIntEnv(process.env.SIMULATION_SCORE_CONCURRENCY, scoreConcDefault)
    );

    const abortSignal = runtimeOpts.abortSignal || null;
    function assertNotAborted() {
      if (abortSignal && abortSignal.aborted) {
        const e = new Error('memory_limit_exceeded');
        e.code = 'MEMORY_LIMIT_EXCEEDED';
        throw e;
      }
    }

    /** Subset of CareerPath fields needed after scoring (no roleVectors / hybrid_vector). */
    const LEAN_SCORED_CP_KEYS = [
      '_id',
      'escoId',
      'title',
      'description',
      'requiredSkills',
      'requiredSkillKeys',
      'altTitles',
      'hiddenTitles',
      'seniority',
      'keyResponsibilities',
      'skillDomains',
      'skillModel',
      'roleIdentity',
    ];

    function buildLeanScoredCareerPath(cpDoc, scored) {
      const lean = {};
      for (let ki = 0; ki < LEAN_SCORED_CP_KEYS.length; ki += 1) {
        const k = LEAN_SCORED_CP_KEYS[ki];
        if (Object.prototype.hasOwnProperty.call(cpDoc, k)) {
          lean[k] = cpDoc[k];
        }
      }
      if (scored && typeof scored === 'object') {
        for (const [k, v] of Object.entries(scored)) {
          if (k === 'roleVectors' || k === 'hybrid_vector') continue;
          lean[k] = v;
        }
      }
      delete lean.roleVectors;
      delete lean.hybrid_vector;
      return lean;
    }

    const vectorCache = getSimulationRoleVectorCache();
    /** Per-run embeddings + vector dedup across phase2 hydrate calls */
    const vectorRunDedup = new Map();
    const metaById = new Map(picked.map((p) => [String(p._id), p]));
    const pathIds = picked.map((p) => p._id).filter(Boolean);

    logMemory('before_scoring', {
      userId: String(userId),
      candidatePoolSize: picked.length,
      pathIdCount: pathIds.length,
      scoreChunkSize: SCORE_CHUNK_SIZE,
      scoreConcurrency: SCORE_CONCURRENCY,
      isForkChild: Boolean(runtimeOpts.isForkChild),
    });

    async function fetchRoleVectorsMapForIds(rawIds) {
      const unique = [...new Set(rawIds.map((id) => String(id)).filter(Boolean))];
      const out = new Map();
      const needQuery = [];

      for (let ui = 0; ui < unique.length; ui += 1) {
        const sid = unique[ui];
        if (vectorRunDedup.has(sid)) {
          out.set(sid, vectorRunDedup.get(sid));
          continue;
        }
        const cached = vectorCache.get(sid);
        if (cached !== undefined) {
          vectorRunDedup.set(sid, cached);
          out.set(sid, cached);
          continue;
        }
        needQuery.push(sid);
      }

      if (needQuery.length > 0) {
        const objectIds = [];
        for (let ni = 0; ni < needQuery.length; ni += 1) {
          try {
            objectIds.push(new mongoose.Types.ObjectId(needQuery[ni]));
          } catch {
            /* invalid id — leave off out until merge */
          }
        }
        if (objectIds.length > 0) {
          const docs = await CareerPath.find({ _id: { $in: objectIds } })
            .select({ _id: 1, roleVectors: 1 })
            .lean();
          const foundDoc = new Map(docs.map((d) => [String(d._id), d]));
          for (let qi = 0; qi < needQuery.length; qi += 1) {
            const sid = needQuery[qi];
            const d = foundDoc.get(sid);
            const rv = d ? d.roleVectors : undefined;
            if (rv !== undefined && rv !== null) {
              vectorCache.set(sid, rv);
            }
            vectorRunDedup.set(sid, rv);
            out.set(sid, rv);
          }
        } else {
          for (let qi = 0; qi < needQuery.length; qi += 1) {
            const sid = needQuery[qi];
            vectorRunDedup.set(sid, undefined);
            out.set(sid, undefined);
          }
        }
      }

      logMemory('after_role_vectors_fetch', {
        requestedIdCount: unique.length,
        cacheHitCount: unique.length - needQuery.length,
        mongoQueryCount: needQuery.length,
        vectorRunDedupSize: vectorRunDedup.size,
        resultMapSize: out.size,
      });

      return out;
    }

    async function phase2RoleVectorLoader(ids) {
      return fetchRoleVectorsMapForIds(ids);
    }

    const scoredPaths = [];
    const totalChunks = Math.ceil(pathIds.length / SCORE_CHUNK_SIZE);
    for (let i = 0; i < pathIds.length; i += SCORE_CHUNK_SIZE) {
      assertNotAborted();
      const chunkIndex = Math.floor(i / SCORE_CHUNK_SIZE);
      const sliceIds = pathIds.slice(i, i + SCORE_CHUNK_SIZE);
      logMemory('before_score_chunk', {
        chunkIndex,
        totalChunks,
        sliceIdCount: sliceIds.length,
        scoredPathsSoFar: scoredPaths.length,
        vectorRunDedupSize: vectorRunDedup.size,
      });
      const vMap = await fetchRoleVectorsMapForIds(sliceIds);

      const chunkRows = [];
      for (let si = 0; si < sliceIds.length; si += 1) {
        const id = sliceIds[si];
        const sid = String(id);
        const meta = metaById.get(sid);
        if (!meta) continue;
        if (!vMap.has(sid)) {
          chunkRows.push({ ...meta });
        } else {
          chunkRows.push({ ...meta, roleVectors: vMap.get(sid) });
        }
      }
      logMemory('after_score_chunk_rows_built', {
        chunkIndex,
        chunkRowCount: chunkRows.length,
        roleVectorsAttachedCount: chunkRows.filter((row) => row.roleVectors != null).length,
        vectorRunDedupSize: vectorRunDedup.size,
      });

      assertNotAborted();
      const scoredChunk = [];
      for (let bi = 0; bi < chunkRows.length; bi += SCORE_CONCURRENCY) {
        assertNotAborted();
        const batch = chunkRows.slice(bi, bi + SCORE_CONCURRENCY);
        /* eslint-disable no-await-in-loop */
        const partial = await Promise.all(
          batch.map((cp) => enrichCareerPathWithHybridScores(userProfileForHybrid, cp))
        );
        /* eslint-enable no-await-in-loop */
        for (let pi = 0; pi < partial.length; pi += 1) scoredChunk.push(partial[pi]);
      }

      for (let j = 0; j < chunkRows.length; j += 1) {
        const cp = chunkRows[j];
        const scored = scoredChunk[j];
        const sid = cp && cp._id != null ? String(cp._id) : '';
        if (sid && cp && cp.roleVectors != null) {
          vectorCache.set(sid, cp.roleVectors);
        }
        scoredPaths.push(buildLeanScoredCareerPath(cp, scored));
        if (sid) vectorRunDedup.delete(sid);
      }
      logMemory('after_score_chunk', {
        chunkIndex,
        totalChunks,
        scoredPathsCount: scoredPaths.length,
        vectorRunDedupSize: vectorRunDedup.size,
      });
    }

    assertNotAborted();
    logMemory('after_all_paths_scored', {
      userId: String(userId),
      scoredPathsCount: scoredPaths.length,
      candidatePoolSize: picked.length,
      vectorRunDedupSize: vectorRunDedup.size,
    });

    let prioritizedListsRaw;
    try {
      prioritizedListsRaw = await generatePrioritizedListsPhase2(scoredPaths, {
        userSkills,
        userSkillDomains,
        userSkillsInDevelopment,
        userWorkExperience,
        userEducation,
        userCareerPreferences,
        userInterests,
        careerGoal,
        bio,
        userIdentityAnswers: mergedIdentityAnswers,
        dateOfBirth,
        currentStatus,
        yearsOfExperience,
        highestDegree,
        mostSeniorWorkExperience,
        embeddingOptimizedUserIdentityText: enrichedInputs.embeddingOptimizedUserIdentityText,
        embeddingUserIdentitySourceFingerprint: enrichedInputs.embeddingUserIdentitySourceFingerprint,
        identityEmbeddingText: String(profile?.who_are_you?.identity_embedding_text || '').trim(),
      }, {
        nextK: 25,
        outsideK: 25,
        vectorLoader: phase2RoleVectorLoader,
      });
    } catch (phase2Err) {
      logControllerError('Phase 2 prioritized lists error', phase2Err);
      throw phase2Err;
    } finally {
      vectorRunDedup.clear();
    }
    logMemory('after_scoring_complete', {
      userId: String(userId),
      scoredPathsCount: scoredPaths.length,
      nextCareerRolesCount: prioritizedListsRaw?.nextCareerRoles?.length ?? null,
      outsideTheBoxRolesCount: prioritizedListsRaw?.outsideTheBoxRoles?.length ?? null,
    });
    console.timeEnd('STEP_3_scoring');
    step3Started = false;

    console.time('STEP_4_response');
    step4Started = true;
    // Attach deterministic server-generated step IDs (stable across saves/removals)
    const prioritizedLists = attachDeterministicStepIdsToPrioritizedLists(prioritizedListsRaw, simulationId);

    // Strip roleVectors and hybrid_vector from steps before response (client doesn't need them; avoids buffer/size issues)
    const stripVectors = (step) => {
      const { roleVectors, hybrid_vector, ...rest } = step;
      return rest;
    };
    const nextRolesRaw = prioritizedLists.nextCareerRoles.map(stripVectors);
    const outsideRolesRaw = prioritizedLists.outsideTheBoxRoles.map(stripVectors);
    const responseLanguage = reqLike.language;
    const careerPathMaps = await buildCareerPathDocMapsForSteps([...nextRolesRaw, ...outsideRolesRaw]);
    const nextRolesForResponse = await Promise.all(
      nextRolesRaw.map((s) => localizeOneCareerPathShapedStep(s, responseLanguage, careerPathMaps))
    );
    const outsideRolesForResponse = await Promise.all(
      outsideRolesRaw.map((s) => localizeOneCareerPathShapedStep(s, responseLanguage, careerPathMaps))
    );

    // Initial display: top 10 per category (client handles evaluation UX; lists stay full for ranking context)
    const nextSteps = nextRolesForResponse.slice(0, 10).map((item) => ({
      ...item,
      listCategory: 'nextCareerRoles',
      category: 'nextSteps'
    }));

    const outsideTheBox = outsideRolesForResponse.slice(0, 10).map((item) => ({
      ...item,
      listCategory: 'outsideTheBoxRoles',
      category: 'outsideTheBox'
    }));

    const results = {
      simulationId,
      algorithmVersion: ALGORITHM_VERSION,
      scoringVersion: SCORING_VERSION,
      profileEnrichment: enrichment || undefined,
      embeddingProvider: 'openai',
      embeddingVersion: '1',
      nextSteps,
      outsideTheBox,
      furtherAdvice: [
        { 
          id: `advice-${simulationId}-0`,
          title: 'Career Development Advice',
          advice: 'Keep learning and updating your skills to stay relevant.' 
        }
      ],
      // Store the complete prioritized lists for future use (without roleVectors to avoid size/buffer issues)
      prioritizedLists: {
        nextCareerRoles: nextRolesForResponse,
        outsideTheBoxRoles: outsideRolesForResponse
      },
      prioritizedListTotals: {
        nextCareerRoles: nextRolesForResponse.length,
        outsideTheBoxRoles: outsideRolesForResponse.length
      },
      // Track current positions in each list (legacy remove/replace endpoints; aligned with 10 visible roles)
      currentPositions: {
        nextCareerRoles: 10,
        outsideTheBoxRoles: 10
      }
    };

    // Save simulation results to user
    await User.findByIdAndUpdate(userId, {
      $set: {
        lastSimulationResult: {
          results,
          selectedGoal: (() => {
            let field = localizedContentService.set(null, 'en', careerGoal || '');
            if (localizedCareerGoal && reqLike.language !== 'en') {
              field = localizedContentService.set(field, reqLike.language, localizedCareerGoal);
            }
            return field;
          })(),
          date: new Date()
        }
      }
    });

    const totalMs = Date.now() - startedAt;
    console.log('[simulation-engine] simulation_completed', {
      userId: String(userId),
      totalMs,
      candidatePoolSize: picked.length,
      scoreChunkSize: SCORE_CHUNK_SIZE,
      scoreConcurrency: SCORE_CONCURRENCY,
      targetedLimit: TARGETED_PATH_LIMIT,
      fallbackLimit: FALLBACK_PATH_LIMIT,
    });
    console.timeEnd('STEP_4_response');
    step4Started = false;

    return resLike.json({
      success: true,
      results,
      careerGoal: localizedCareerGoal || careerGoal || '',
      profileCompletion: completion,
    });
  } catch (err) {
    if (step4Started) {
      console.timeEnd('STEP_4_response');
      step4Started = false;
    }
    if (step3Started) {
      console.timeEnd('STEP_3_scoring');
      step3Started = false;
    }
    if (step2Started) {
      console.timeEnd('STEP_2_enrichment');
      step2Started = false;
    }
    if (step1Started) {
      console.timeEnd('STEP_1_load');
      step1Started = false;
    }
    logControllerError('Simulation error', err);
    const message = err.message || 'Simulation failed.';
    const isDev = process.env.NODE_ENV !== 'production';
    return resLike.status(500).json({
      success: false,
      message: 'Simulation failed.',
      error: message,
      ...(isDev && { stack: err.stack }),
    });
  } finally {
    console.timeEnd('TOTAL');
  }
};

module.exports = {
  executeCareerSimulation,
};
