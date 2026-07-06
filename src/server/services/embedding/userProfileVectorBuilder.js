/**
 * User Profile Vector Builder
 *
 * Builds structured and identity vectors from userProfile for role matching.
 * Structured categories: deterministic. Identity text: resolved via cached LLM output + embeddings API.
 *
 * userProfile: { userSkills, userWorkExperience, userEducation, userCareerPreferences,
 *   userInterests, careerGoal (computed for scoring), bio, userIdentityAnswers, dateOfBirth, currentStatus, yearsOfExperience,
 *   highestDegree, mostSeniorWorkExperience }
 * - userCareerPreferences.domains: free-form domains embedded for occupation_group matching
 *
 * Seniority is not embedded in structured vectors; matching uses inferUserSeniorityLevel
 * only in roleMatchingScorer for the cosine seniority penalty.
 *
 * Structured embed / fusion order (same as roles): skill_domains, occupation_group,
 * responsibilities, required_skills, optional_skills.
 *
 * occupation_group: user domains (embedded) → matches role's occupation_group sub-vector (from ESCO iscoGroup).
 * skill_domains: taken from explicit user domains (CV interpretation or manual entry)
 *   → matches role's structured_vector_skill_domains.
 * responsibilities: key responsibilities from work experience → matches role's key responsibilities vector.
 * required_skills / optional_skills: aligned with role core and optional skill vectors.
 *
 * @module services/embedding/userProfileVectorBuilder
 */
// ENGLISH_ONLY_PIPELINE: User vectors operate on canonical English processing text.

const {
  embedTextSafe,
  embedTextBatchSafe,
  weightedFusionMulti,
  l2Normalize,
  EMBEDDING_DIMS,
} = require('./embeddingService');
const { normalizeForEmbedding } = require('../ai/normalizeForEmbedding');
const {
  resolveUserIdentityEmbeddingText,
  FALLBACK_IDENTITY_TEXT,
  buildUserIdentityTextLegacy,
  answersFromFlatUserProfile,
} = require('./userIdentityEmbeddingTextService');
const {
  WEIGHTS_NEXT_ROLE,
  WEIGHTS_OUT_OF_THE_BOX,
  canonicalize,
} = require('./structuredTextBuilder');
const { logMemory } = require('../simulation/simulationMemoryProfiler');
const CATEGORY_ORDER = ['skill_domains', 'occupation_group', 'responsibilities', 'required_skills', 'optional_skills'];

function sanitizeDomains(domains) {
  const arr = Array.isArray(domains) ? domains : [];
  return arr
    .map((d) => String(d || '').trim())
    .filter(Boolean);
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

const OCCUPATION_GROUP_VECTOR_PROMISE = Symbol('occupationGroupVectorPromise');
const STRUCTURED_VECTOR_PROMISES = Symbol('structuredVectorPromises');
const IDENTITY_VECTOR_PROMISE = Symbol('identityVectorPromise');
const HYBRID_VECTOR_PROMISES = Symbol('hybridVectorPromises');
const USER_EMBEDDING_CATEGORY_TEXTS_PROMISE = Symbol('userEmbeddingCategoryTextsPromise');

function ensurePromiseCacheStore(userProfile, symbolKey) {
  if (!userProfile || typeof userProfile !== 'object') {
    return null;
  }
  if (!userProfile[symbolKey]) {
    userProfile[symbolKey] = new Map();
  }
  return userProfile[symbolKey];
}

function normalizePreferenceObject(userProfile) {
  return userProfile.userCareerPreferences && typeof userProfile.userCareerPreferences === 'object'
    ? userProfile.userCareerPreferences
    : {};
}

function splitIscoAndDomainsFromPreferences(prefs) {
  const sanitized = sanitizeDomains(safeArray(prefs.domains));
  const domains = Array.isArray(sanitized) ? sanitized : [];
  return { domains };
}

function getUserSkillDomains(userProfile, prefs) {
  const explicitSanitized = sanitizeDomains(safeArray(userProfile?.userSkillDomains));
  const explicit = Array.isArray(explicitSanitized) ? explicitSanitized : [];
  if (explicit.length > 0) return explicit;
  const fallbackSanitized = sanitizeDomains(safeArray(prefs?.skillDomains));
  return Array.isArray(fallbackSanitized) ? fallbackSanitized : [];
}

async function buildOccupationGroupUserVector(userProfile) {
  if (userProfile && typeof userProfile === 'object' && userProfile[OCCUPATION_GROUP_VECTOR_PROMISE]) {
    return userProfile[OCCUPATION_GROUP_VECTOR_PROMISE];
  }

  const promise = (async () => {
    const prefs = normalizePreferenceObject(userProfile);
    const { domains } = splitIscoAndDomainsFromPreferences(prefs);

    logMemory('before_occupation_group_domain_embed', {
      domainCount: domains.length,
    });

    const domainText = domains.length > 0 ? String(await normalizeForEmbedding(domains) || '').trim() : '';
    logMemory('after_occupation_group_domain_normalization', {
      domainCount: domains.length,
      domainTextLength: domainText.length,
    });

    if (!domainText) {
      logMemory('after_buildOccupationGroupUserVector', {
        domainCount: domains.length,
        vectorDims: EMBEDDING_DIMS,
        zeroVector: true,
      });
      return new Float32Array(EMBEDDING_DIMS);
    }

    const domainVector = await embedTextSafe(domainText);
    if (!domainVector) {
      logMemory('after_buildOccupationGroupUserVector', {
        domainCount: domains.length,
        vectorDims: EMBEDDING_DIMS,
        zeroVector: true,
        embedFailed: true,
      });
      return new Float32Array(EMBEDDING_DIMS);
    }
    const normalized = l2Normalize(domainVector);
    logMemory('after_buildOccupationGroupUserVector', {
      domainCount: domains.length,
      vectorDims: normalized?.length ?? EMBEDDING_DIMS,
      zeroVector: false,
    });
    return normalized;
  })();

  if (userProfile && typeof userProfile === 'object') {
    userProfile[OCCUPATION_GROUP_VECTOR_PROMISE] = promise;
  }

  return promise;
}

/**
 * Raw structured lines per category (before canonicalization / embedding normalization).
 *
 * @param {object} userProfile
 * @returns {Record<string, string[]>}
 */
function extractUserStructuredEmbeddingRawLines(userProfile) {
  const skills = safeArray(userProfile?.userSkills);
  const workExp = safeArray(userProfile?.userWorkExperience);
  const prefs = normalizePreferenceObject(userProfile);

  const rawResponsibilities = workExp.flatMap((e) =>
    Array.isArray(e?.keyResponsibilities)
      ? e.keyResponsibilities.map((r) => String(r || '').trim()).filter(Boolean)
      : []
  );

  const { domains } = splitIscoAndDomainsFromPreferences(prefs);
  const skillDomains = getUserSkillDomains(userProfile, prefs);

  const skillNames = skills
    .map((s) => (typeof s === 'string' ? s : s?.name || ''))
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  const seenResp = new Set();
  const responsibilities = rawResponsibilities.filter((r) => {
    const k = r.toLowerCase();
    if (seenResp.has(k)) return false;
    seenResp.add(k);
    return true;
  });

  const skillsInDev = safeArray(userProfile?.userSkillsInDevelopment).map((s) => String(s || '').trim()).filter(Boolean);
  const optionalSkillSet = new Set();
  for (const s of [...skillNames, ...skillsInDev]) {
    const k = s.toLowerCase();
    if (k && !optionalSkillSet.has(k)) optionalSkillSet.add(k);
  }
  const optionalSkillsList = [...optionalSkillSet];

  return {
    skill_domains: skillDomains,
    occupation_group: domains,
    required_skills: skillNames,
    responsibilities,
    optional_skills: optionalSkillsList,
  };
}

/**
 * Build category texts from userProfile (mirrors role structure for cosine comparison).
 * Legacy deterministic/canonical shape for introspection & tests — embedding uses {@link resolveUserEmbeddingCategoryTexts}.
 */
function buildUserCategoryTexts(userProfile) {
  const raw = extractUserStructuredEmbeddingRawLines(userProfile);
  return {
    skill_domains: raw.skill_domains.map(canonicalize).filter(Boolean).join('\n'),
    occupation_group: raw.occupation_group.map(canonicalize).filter(Boolean).join('\n'),
    required_skills: raw.required_skills.map(canonicalize).filter(Boolean).join('\n'),
    responsibilities: raw.responsibilities.map(canonicalize).filter(Boolean).join('\n'),
    optional_skills: raw.optional_skills.map(canonicalize).filter(Boolean).join('\n'),
  };
}

/**
 * English-normalized category texts for embeddings (new/updated profile computation paths).
 *
 * @param {object} userProfile
 * @returns {Promise<Record<string, string>>}
 */
async function buildUserEmbeddingCategoryTexts(userProfile) {
  const raw = extractUserStructuredEmbeddingRawLines(userProfile);
  const keys = ['skill_domains', 'occupation_group', 'required_skills', 'responsibilities', 'optional_skills'];
  const out = {};
  for (const key of keys) {
    out[key] = await normalizeForEmbedding(raw[key]);
  }
  return out;
}

/**
 * Cached per userProfile object for one request lifecycle.
 *
 * @param {object} userProfile
 * @returns {Promise<Record<string, string>>}
 */
async function resolveUserEmbeddingCategoryTexts(userProfile) {
  if (!userProfile || typeof userProfile !== 'object') {
    return buildUserEmbeddingCategoryTexts(userProfile);
  }
  if (!userProfile[USER_EMBEDDING_CATEGORY_TEXTS_PROMISE]) {
    userProfile[USER_EMBEDDING_CATEGORY_TEXTS_PROMISE] = buildUserEmbeddingCategoryTexts(userProfile);
  }
  return userProfile[USER_EMBEDDING_CATEGORY_TEXTS_PROMISE];
}

/**
 * Map mostSeniorWorkExperience enum to seniority level (0–6).
 */
const MOST_SENIOR_TO_LEVEL = {
  intern: 0,
  entry_level: 1,
  mid_level: 3,
  senior: 4,
  lead: 5,
  manager: 5,
  director: 6,
  vp: 6,
  c_suite: 6,
};

/**
 * Map highestDegree enum to seniority influence (0–6).
 * Education supports but does not override experience.
 */
const DEGREE_TO_LEVEL = {
  '': null,
  none: 0,
  high_school: 1,
  hauptschulabschluss: 1,
  realschulabschluss: 2,
  ausbildung: 2,
  fachabitur: 3,
  associate: 2,
  bachelors: 3,
  masters: 4,
  phd: 5,
  staatsexamen: 5,
  professional: 5,
};

/**
 * Infer user seniority level (0–6) from multiple profile signals.
 *
 * Uses: currentStatus, yearsOfExperience, highestDegree,
 * mostSeniorWorkExperience. Falls back to work experience title analysis when
 * seniority fields are sparse.
 *
 * @param {object} userProfile – { currentStatus, yearsOfExperience,
 *   highestDegree, mostSeniorWorkExperience, userWorkExperience }
 * @returns {number} Seniority level 0–6
 */
function inferUserSeniorityLevel(userProfile) {
  const signals = [];

  // 1. mostSeniorWorkExperience – strongest signal (direct user input)
  const mostSenior = userProfile.mostSeniorWorkExperience && String(userProfile.mostSeniorWorkExperience).trim();
  if (mostSenior && MOST_SENIOR_TO_LEVEL[mostSenior] !== undefined) {
    signals.push({ level: MOST_SENIOR_TO_LEVEL[mostSenior], weight: 8, source: 'mostSeniorWorkExperience' });
  }

  // 2. yearsOfExperience – strong signal
  const years = userProfile.yearsOfExperience;
  if (typeof years === 'number' && years >= 0 && years <= 50) {
    let level;
    if (years <= 1) level = 0;
    else if (years <= 3) level = 1;
    else if (years <= 5) level = 2;
    else if (years <= 8) level = 3;
    else if (years <= 12) level = 4;
    else if (years <= 18) level = 5;
    else level = 6;
    signals.push({ level, weight: 6, source: 'yearsOfExperience' });
  }

  // 3. highestDegree – supporting signal
  const degree = userProfile.highestDegree && String(userProfile.highestDegree).trim();
  if (degree && DEGREE_TO_LEVEL[degree] !== undefined && DEGREE_TO_LEVEL[degree] !== null) {
    signals.push({ level: DEGREE_TO_LEVEL[degree], weight: 3, source: 'highestDegree' });
  }

  // 4. currentStatus – weak signal (early-career / education-heavy statuses → lower)
  const status = userProfile.currentStatus && String(userProfile.currentStatus).trim();
  if (status === 'pupil' || status === 'student' || status === 'intern') {
    signals.push({ level: 0, weight: 1, source: 'currentStatus' });
  }

  // 5. Fallback: work experience titles (when seniority fields sparse)
  if (signals.length === 0) {
    const { analyzeTitleKeywords } = require('../seniorityService');
    const workExp = safeArray(userProfile.userWorkExperience);
    const titles = workExp.map((e) => (e && e.title ? String(e.title) : '')).filter(Boolean);
    let bestLevel = 3;
    let bestWeight = 0;
    for (const title of titles) {
      const match = analyzeTitleKeywords(title);
      if (match && match.weight > bestWeight) {
        bestWeight = match.weight;
        bestLevel = match.level;
      }
    }
    return Math.max(0, Math.min(6, bestLevel));
  }

  // Aggregate: weighted average, rounded
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const weightedSum = signals.reduce((sum, s) => sum + s.level * s.weight, 0);
  let finalLevel = Math.round(weightedSum / totalWeight);
  finalLevel = Math.max(0, Math.min(6, finalLevel));
  return finalLevel;
}

const IDENTITY_TEXT_PROMISE = Symbol('identityEmbeddingTextPromise');

/**
 * Resolve user identity text for embedding (cached LLM composition + Mongo fingerprint).
 * Reuses one promise per userProfile object per request to avoid duplicate LLM calls.
 *
 * @param {object} userProfile
 * @returns {Promise<string>}
 */
async function resolveIdentityTextOnce(userProfile) {
  if (!userProfile || typeof userProfile !== 'object') {
    return FALLBACK_IDENTITY_TEXT;
  }
  if (!userProfile[IDENTITY_TEXT_PROMISE]) {
    userProfile[IDENTITY_TEXT_PROMISE] = resolveUserIdentityEmbeddingText(userProfile);
  }
  return userProfile[IDENTITY_TEXT_PROMISE];
}

/**
 * Deterministic fallback string (legacy concatenation). For embedding, use {@link resolveIdentityTextOnce}.
 *
 * @param {object} userProfile – flat matching shape (userIdentityAnswers and/or legacy bio, userInterests, careerGoal)
 * @returns {string}
 */
function buildUserIdentityText(userProfile) {
  return buildUserIdentityTextLegacy(answersFromFlatUserProfile(userProfile));
}

/**
 * Build mode-specific structured vector from userProfile.
 *
 * @param {object} userProfile
 * @param {'NEXT_ROLE'|'OUT_OF_THE_BOX'} mode
 * @returns {Promise<Float32Array>}
 */
async function buildUserStructuredVector(userProfile, mode) {
  const cache = ensurePromiseCacheStore(userProfile, STRUCTURED_VECTOR_PROMISES);
  if (cache && cache.has(mode)) {
    return cache.get(mode);
  }

  const promise = (async () => {
    logMemory('before_user_structured_vector_build', { mode });
    const texts = await resolveUserEmbeddingCategoryTexts(userProfile);
    const categoryTextLengths = {};
    for (const key of CATEGORY_ORDER) {
      categoryTextLengths[key] = String(texts[key] || '').length;
    }
    logMemory('after_user_embedding_category_texts', {
      mode,
      categoryTextLengths,
    });

    const weights = mode === 'OUT_OF_THE_BOX' ? WEIGHTS_OUT_OF_THE_BOX : WEIGHTS_NEXT_ROLE;
    const occupationVec = await buildOccupationGroupUserVector(userProfile);
    logMemory('after_occupation_group_user_vector_in_structured_build', {
      mode,
      occupationVectorDims: occupationVec?.length ?? 0,
    });

    const otherKeys = CATEGORY_ORDER.filter((k) => k !== 'occupation_group');
    const otherTexts = otherKeys.map((key) => texts[key] || ' ');
    logMemory('before_user_structured_batch_embed', {
      mode,
      batchTextCount: otherTexts.length,
      batchTextCharTotal: otherTexts.reduce((sum, t) => sum + String(t || '').length, 0),
    });
    const otherVectors = await embedTextBatchSafe(otherTexts);
    logMemory('after_user_structured_batch_embed', {
      mode,
      vectorCount: otherVectors.length,
      nonNullVectorCount: otherVectors.filter(Boolean).length,
    });
    for (let i = 0; i < otherVectors.length; i++) {
      if (otherVectors[i]) l2Normalize(otherVectors[i]);
    }
    const byKey = { occupation_group: occupationVec };
    otherKeys.forEach((key, idx) => { byKey[key] = otherVectors[idx] || new Float32Array(EMBEDDING_DIMS); });
    const vectors = CATEGORY_ORDER.map((key) => byKey[key] || new Float32Array(EMBEDDING_DIMS));
    const weightArr = CATEGORY_ORDER.map((key) => weights[key] || 0);
    const fused = weightedFusionMulti(vectors, weightArr, EMBEDDING_DIMS);
    logMemory('after_user_structured_vector_build', {
      mode,
      fusedVectorDims: fused?.length ?? 0,
      structuredCategoryCount: CATEGORY_ORDER.length,
    });
    return fused;
  })();

  if (cache) {
    cache.set(mode, promise);
  }

  return promise;
}

/**
 * Build user identity vector.
 *
 * @param {object} userProfile
 * @returns {Promise<Float32Array>}
 */
async function buildUserIdentityVector(userProfile) {
  if (userProfile && typeof userProfile === 'object' && userProfile[IDENTITY_VECTOR_PROMISE]) {
    return userProfile[IDENTITY_VECTOR_PROMISE];
  }

  const promise = (async () => {
    logMemory('before_user_identity_vector_build', {});
    const text = await resolveIdentityTextOnce(userProfile);
    logMemory('after_user_identity_text_resolved', {
      identityTextLength: String(text || '').length,
    });
    const vec = await embedTextSafe(text);
    const normalized = vec ? l2Normalize(vec) : vec;
    logMemory('after_user_identity_vector_build', {
      vectorDims: normalized?.length ?? 0,
      embedFailed: !vec,
    });
    return normalized;
  })();

  if (userProfile && typeof userProfile === 'object') {
    userProfile[IDENTITY_VECTOR_PROMISE] = promise;
  }

  return promise;
}

/**
 * Build mode-specific hybrid vector for user.
 *
 * NEXT_ROLE: 0.75 * structured + 0.25 * identity
 * OUT_OF_THE_BOX: 0.45 * structured + 0.55 * identity
 *
 * @param {object} userProfile
 * @param {'NEXT_ROLE'|'OUT_OF_THE_BOX'} mode
 * @returns {Promise<Float32Array>}
 */
async function buildUserHybridVector(userProfile, mode) {
  const cache = ensurePromiseCacheStore(userProfile, HYBRID_VECTOR_PROMISES);
  if (cache && cache.has(mode)) {
    return cache.get(mode);
  }

  const promise = (async () => {
    logMemory('before_user_hybrid_vector_build', { mode });
    const [structured, identityVec] = await Promise.all([
      buildUserStructuredVector(userProfile, mode),
      buildUserIdentityVector(userProfile),
    ]);

    const wStructured = mode === 'NEXT_ROLE' ? 0.75 : 0.45;
    const wIdentity = mode === 'NEXT_ROLE' ? 0.25 : 0.55;

    const dims = structured?.length ?? identityVec?.length ?? 0;
    const out = new Float32Array(dims);
    for (let i = 0; i < dims; i++) {
      out[i] = wStructured * (structured?.[i] ?? 0) + wIdentity * (identityVec?.[i] ?? 0);
    }
    const normalized = l2Normalize(out);
    logMemory('after_user_hybrid_vector_build', {
      mode,
      hybridVectorDims: normalized?.length ?? 0,
    });
    return normalized;
  })();

  if (cache) {
    cache.set(mode, promise);
  }

  return promise;
}

module.exports = {
  buildUserCategoryTexts,
  buildOccupationGroupUserVector,
  buildUserIdentityText,
  resolveIdentityTextOnce,
  buildUserStructuredVector,
  buildUserIdentityVector,
  buildUserHybridVector,
  inferUserSeniorityLevel,
  CATEGORY_ORDER,
};
