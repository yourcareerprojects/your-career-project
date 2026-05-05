/**
 * Legacy multi-dimensional career path scorer (weighted dimensions + calibration + hybrid sidecars).
 *
 * Not used by live simulation — production uses hybrid-only `services/scoring/careerPathScorer`.
 * Kept for unit tests and offline tooling.
 */

const { scoreNextRole, scoreOutOfTheBox } = require('../../embedding/roleMatchingScorer');
const {
  DEGREE_LEVEL_MAP,
  DEGREE_ALIASES,
  EDUCATION_DISTANCE_PENALTY,
} = require('../../../config/degreeConfig');
const { calibrateScore, getCalibrationMode, analyzeScoreDistribution } = require('../scoreCalibration');
const { safeArray, buildUserProfileForHybrid } = require('../hybridUserProfileForMatching');

function normalizeSkillKey(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function extractRequiredSkillTitles(careerPath, { skillUriToName } = {}) {
  const uriToName = skillUriToName || {};
  const rawRequiredSkills = Array.isArray(careerPath.requiredSkills) ? careerPath.requiredSkills : [];
  const requiredSkillTitles = rawRequiredSkills
    .map((s) => {
      if (!s) return '';
      if (typeof s === 'string') return s;
      if (typeof s === 'object' && typeof s.title === 'string') return s.title;
      return '';
    })
    .filter(Boolean);

  const mappedRequiredSkillTitles = requiredSkillTitles
    .map((t) => {
      if (typeof t !== 'string') return '';
      const trimmed = t.trim();
      if (!trimmed) return '';
      if (/^https?:\/\//i.test(trimmed) && uriToName[trimmed]) {
        return uriToName[trimmed];
      }
      return trimmed;
    })
    .filter(Boolean);

  const rawRequiredSkillUris = Array.isArray(careerPath.requiredSkillUris) ? careerPath.requiredSkillUris : [];
  const mappedFromUris = rawRequiredSkillUris
    .map((uri) => (typeof uri === 'string' && uriToName[uri] ? uriToName[uri] : ''))
    .filter(Boolean);

  return [...mappedRequiredSkillTitles, ...mappedFromUris];
}

function normalizeTextForMatch(value) {
  if (!value) return '';
  return String(value).toLowerCase();
}

function mapUserDegreeToLevel(userDegree) {
  if (userDegree == null || userDegree === '') return null;
  const normalized = String(userDegree).toLowerCase().trim();
  const canonical = DEGREE_ALIASES[normalized] ?? DEGREE_ALIASES[normalized.replace(/\s+/g, ' ')];
  if (canonical == null) return null;
  const level = DEGREE_LEVEL_MAP[canonical];
  return typeof level === 'number' ? level : null;
}

function inferRoleDegreeLevel(role) {
  if (role.requiredEducation != null && typeof role.requiredEducation.level === 'number') {
    return role.requiredEducation.level;
  }
  const t = normalizeTextForMatch(role.title || '');
  const d = normalizeTextForMatch(role.description || '');
  const text = `${t} ${d}`;
  if (/\bno\s+degree\b|\bdegree\s+not\s+required\b|\bno\s+formal\s+education\b/.test(text)) return null;
  if (/\bphd\b|\bph\.d\.?\b|\bdoctorate\b/.test(text)) return 5;
  if (/\bmaster\b|\bmsc?\b|\bma\b|\bmba\b|\bms\b/.test(text)) return 4;
  if (/\bbachelor\b|\bbs\b|\bba\b|\bdegree\s+required\b|\bdegree\s+preferred\b|\bdegree\s+or\s+equivalent\b/.test(text)) {
    return 3;
  }
  return null;
}

const EDUCATION_MATCH_CATEGORY = {
  NO_REQUIREMENT: 'no_requirement',
  EXACT_MATCH: 'exact_match',
  OVERQUALIFIED: 'overqualified',
  SLIGHTLY_BELOW: 'slightly_below',
  CLEARLY_BELOW: 'clearly_below',
};

function calculateEducationModifier(userEducation, role) {
  const roleDegreeLevel = inferRoleDegreeLevel(role);
  if (roleDegreeLevel == null) {
    return { modifier: 1.0, category: EDUCATION_MATCH_CATEGORY.NO_REQUIREMENT };
  }

  const userDegreeLevel = mapUserDegreeToLevel(userEducation?.highestDegree);
  const effectiveUserLevel = userDegreeLevel != null ? userDegreeLevel : 0;
  const diff = effectiveUserLevel - roleDegreeLevel;

  if (diff >= 0) {
    if (diff > 0) {
      return { modifier: 1.02, category: EDUCATION_MATCH_CATEGORY.OVERQUALIFIED };
    }
    return { modifier: 1.0, category: EDUCATION_MATCH_CATEGORY.EXACT_MATCH };
  }
  if (diff === -1) {
    return { modifier: 0.95, category: EDUCATION_MATCH_CATEGORY.SLIGHTLY_BELOW };
  }
  return { modifier: 0.85, category: EDUCATION_MATCH_CATEGORY.CLEARLY_BELOW };
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

const DEFAULT_WEIGHTS = {
  skillsMatch: 0.4,
  experienceAlignment: 0.15,
  industryPreference: 0.1,
  careerGrowthPotential: 0.15,
  interestsFit: 0.1,
};

const CORE_WEIGHTS_SUM = 0.9;

function normalizeWeights(weights) {
  const raw = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  delete raw.educationMatch;
  const w = { ...raw };
  const sum = Object.values(w).reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
  if (!sum) return { ...DEFAULT_WEIGHTS };
  const out = {};
  for (const [k, v] of Object.entries(w)) {
    out[k] = (Number.isFinite(v) ? v : 0) / sum;
  }
  return out;
}

function computeSkillMatchDimension({ userSkills, requiredSkillTitles, title, description }) {
  const userSkillKeys = new Set(safeArray(userSkills).map(normalizeSkillKey).filter(Boolean));
  const requiredKeys = safeArray(requiredSkillTitles).map(normalizeSkillKey).filter(Boolean);
  const requiredKeySet = new Set(requiredKeys);

  const matchedSkills = [];
  const matchedInputs = [];
  let directMatches = 0;
  let partialMatches = 0;
  let textMatches = 0;

  const combinedText = `${title} ${description}`;

  for (const skillName of safeArray(userSkills)) {
    const skillNameLower = normalizeTextForMatch(skillName);
    const userKey = normalizeSkillKey(skillNameLower);
    if (!userKey) continue;

    if (requiredKeySet.has(userKey)) {
      directMatches++;
      matchedSkills.push(skillName);
      matchedInputs.push(`${skillName} (required skill)`);
      continue;
    }

    let wasPartial = false;
    for (const reqKey of requiredKeySet) {
      if (reqKey && (reqKey.includes(userKey) || userKey.includes(reqKey))) {
        partialMatches++;
        matchedSkills.push(skillName);
        matchedInputs.push(`${skillName} (related required skill)`);
        wasPartial = true;
        break;
      }
    }
    if (wasPartial) continue;

    if (combinedText.includes(skillNameLower)) {
      textMatches++;
      matchedSkills.push(skillName);
      matchedInputs.push(skillName);
    }
  }

  const requiredCount = requiredKeys.length || 0;
  const directRatio = requiredCount ? directMatches / requiredCount : 0;
  const partialRatio = requiredCount ? partialMatches / requiredCount : 0;

  const raw = clamp01(directRatio * 1.0 + partialRatio * 0.5 + (textMatches ? 0.05 : 0));

  const matchedKeySet = new Set(matchedSkills.map(normalizeSkillKey).filter(Boolean));
  const skillGaps = safeArray(requiredSkillTitles).filter((t) => {
    const k = normalizeSkillKey(t);
    return k && !matchedKeySet.has(k);
  });

  return {
    raw,
    evidence: {
      directMatches,
      partialMatches,
      textMatches,
      requiredCount,
    },
    matchedSkills,
    matchedInputs,
    skillGaps,
  };
}

function computeWeightedSkillMatchDimension({ userSkills, skillModel, title, description }) {
  const coreSkills = safeArray(skillModel.core_skills);
  const optionalSkills = safeArray(skillModel.optional_skills);
  const weights = skillModel.skill_weights || {};

  const getWeight = (skillName) => {
    if (weights instanceof Map) return weights.get(skillName) || 0;
    if (typeof weights.get === 'function') return weights.get(skillName) || 0;
    return weights[skillName] || 0;
  };

  const allRoleSkills = [...coreSkills, ...optionalSkills];
  const roleKeyToSkill = new Map();
  for (const s of allRoleSkills) {
    roleKeyToSkill.set(normalizeSkillKey(s), s);
  }

  const coreKeySet = new Set(coreSkills.map(normalizeSkillKey).filter(Boolean));

  const matchedSkills = [];
  const matchedInputs = [];
  let weightedScore = 0;
  let maxPossibleWeight = 0;
  let directMatches = 0;
  let partialMatches = 0;
  let textMatches = 0;

  const matchedRoleKeys = new Set();
  const combinedText = `${title} ${description}`;

  for (const skillName of safeArray(userSkills)) {
    const userKey = normalizeSkillKey(skillName);
    if (!userKey) continue;

    if (roleKeyToSkill.has(userKey)) {
      const roleSkill = roleKeyToSkill.get(userKey);
      const w = getWeight(roleSkill);
      weightedScore += w;
      matchedRoleKeys.add(userKey);
      directMatches++;
      matchedSkills.push(skillName);
      const label = coreKeySet.has(userKey) ? 'core skill' : 'optional skill';
      matchedInputs.push(`${skillName} (${label}, weight=${w})`);
      continue;
    }

    let wasPartial = false;
    for (const [reqKey, roleSkill] of roleKeyToSkill) {
      if (matchedRoleKeys.has(reqKey)) continue;
      if (reqKey && (reqKey.includes(userKey) || userKey.includes(reqKey))) {
        const w = getWeight(roleSkill) * 0.5;
        weightedScore += w;
        matchedRoleKeys.add(reqKey);
        partialMatches++;
        matchedSkills.push(skillName);
        const label = coreKeySet.has(reqKey) ? 'related core skill' : 'related optional skill';
        matchedInputs.push(`${skillName} (${label}, weight=${w.toFixed(2)})`);
        wasPartial = true;
        break;
      }
    }
    if (wasPartial) continue;

    if (combinedText.includes(normalizeTextForMatch(skillName))) {
      textMatches++;
      matchedSkills.push(skillName);
      matchedInputs.push(skillName);
      weightedScore += 0.05;
    }
  }

  for (const s of allRoleSkills) {
    maxPossibleWeight += getWeight(s);
  }

  const raw = maxPossibleWeight > 0 ? clamp01(weightedScore / maxPossibleWeight) : 0;

  const coreGaps = coreSkills.filter((s) => {
    const k = normalizeSkillKey(s);
    return k && !matchedRoleKeys.has(k);
  });
  const optionalGaps = optionalSkills.filter((s) => {
    const k = normalizeSkillKey(s);
    return k && !matchedRoleKeys.has(k);
  });
  const skillGaps = [...coreGaps, ...optionalGaps];

  return {
    raw,
    evidence: {
      directMatches,
      partialMatches,
      textMatches,
      requiredCount: allRoleSkills.length,
      coreCount: coreSkills.length,
      optionalCount: optionalSkills.length,
      coreMatched: coreSkills.length - coreGaps.length,
      weightedScore: Math.round(weightedScore * 100) / 100,
      maxPossibleWeight: Math.round(maxPossibleWeight * 100) / 100,
      usedSkillModel: true,
    },
    matchedSkills,
    matchedInputs,
    skillGaps,
    coreGaps,
    optionalGaps,
  };
}

function computeExperienceAlignmentDimension({ userWorkExperience, title, description, seniority }) {
  const matchedTitles = [];
  const t = normalizeTextForMatch(title);
  const d = normalizeTextForMatch(description);

  for (const exp of safeArray(userWorkExperience)) {
    const expTitle = normalizeTextForMatch(exp && exp.title ? exp.title : '');
    if (!expTitle) continue;
    if (t.includes(expTitle) || d.includes(expTitle)) {
      matchedTitles.push(exp.title);
    }
  }

  const raw = clamp01(1 - Math.exp(-matchedTitles.length / 2));

  let hasLevelSignal;
  let seniorityLevel = null;
  let seniorityLabel = null;

  if (seniority && typeof seniority.seniority_level === 'number') {
    seniorityLevel = seniority.seniority_level;
    seniorityLabel = seniority.seniority_label;
    hasLevelSignal = seniorityLevel !== 3;
  } else {
    const levelKeywords = ['intern', 'junior', 'mid', 'senior', 'lead', 'manager', 'director', 'principal', 'head', 'chief'];
    hasLevelSignal = levelKeywords.some((k) => t.includes(k));
  }

  return {
    raw,
    evidence: {
      matchedCount: matchedTitles.length,
      matchedTitles,
      hasLevelSignal,
      seniorityLevel,
      seniorityLabel,
    },
  };
}

function computeEducationMatchDimension({ userEducation, role, distancePenalty }) {
  const penalty = typeof distancePenalty === 'number' ? distancePenalty : EDUCATION_DISTANCE_PENALTY;
  const userDegreeStr = userEducation?.highestDegree;
  const userDegreeLevel = mapUserDegreeToLevel(userDegreeStr);
  const effectiveUserLevel = userDegreeLevel != null ? userDegreeLevel : 0;
  const roleDegreeLevel = inferRoleDegreeLevel(role);

  if (roleDegreeLevel == null) {
    return {
      raw: 0.5,
      evidence: {
        userDegreeLevel: effectiveUserLevel,
        roleDegreeLevel: null,
        reason: 'no_explicit_requirement',
      },
    };
  }

  const diff = effectiveUserLevel - roleDegreeLevel;
  let raw;
  if (diff >= 0) {
    raw = 1;
  } else {
    raw = Math.max(0, 1 - Math.abs(diff) * penalty);
  }

  return {
    raw: clamp01(raw),
    evidence: {
      userDegreeLevel: effectiveUserLevel,
      roleDegreeLevel,
      diff,
      matchedDegree: userDegreeStr || null,
    },
  };
}

function computeIndustryPreferenceDimension({ userCareerPreferences, title, description, iscoGroup }) {
  const domains = safeArray(userCareerPreferences && userCareerPreferences.domains);
  const iscoCodes = domains
    .map((i) => String(i || '').trim())
    .filter((c) => /^\d{1,4}$/.test(c));
  if (iscoCodes.length === 0) {
    return { raw: 0.5, evidence: { reason: 'no_industry_preferences' } };
  }
  const stepCode = (iscoGroup && String(iscoGroup).trim()) || '';
  if (!stepCode) {
    return { raw: 0.5, evidence: { reason: 'no_isco_group_on_path' } };
  }
  let matches = 0;
  const matchedIndustries = [];
  for (const userCode of iscoCodes) {
    if (stepCode.startsWith(userCode)) {
      matches++;
      matchedIndustries.push(userCode);
    }
  }
  const raw = clamp01(matches / Math.max(iscoCodes.length, 1));
  return { raw, evidence: { matches, matchedIndustries, totalPreferences: iscoCodes.length } };
}

function computeInterestsFitDimension({ userInterests, title, description }) {
  const interests = safeArray(userInterests);
  if (interests.length === 0) {
    return { raw: 0.5, evidence: { reason: 'no_interests' } };
  }
  const text = `${normalizeTextForMatch(title)} ${normalizeTextForMatch(description)}`;
  let matches = 0;
  const matchedInterests = [];
  for (const interest of interests) {
    const key = normalizeTextForMatch(interest);
    if (!key) continue;
    if (text.includes(key)) {
      matches++;
      matchedInterests.push(interest);
    }
  }
  const raw = clamp01(matches / Math.max(interests.length, 1));
  return { raw, evidence: { matches, matchedInterests, totalInterests: interests.length } };
}

function computeCareerGrowthPotentialDimension({ title, skillMatchRaw, experienceRaw, seniority }) {
  let hasProgression;
  let seniorityLevel = null;

  if (seniority && typeof seniority.seniority_level === 'number') {
    seniorityLevel = seniority.seniority_level;
    hasProgression = seniorityLevel >= 4;
  } else {
    const t = normalizeTextForMatch(title);
    const progressionKeywords = ['senior', 'lead', 'manager', 'director', 'principal', 'head', 'chief'];
    hasProgression = progressionKeywords.some((k) => t.includes(k));
  }

  const base = hasProgression ? 0.75 : 0.55;
  const alignment = clamp01(skillMatchRaw * 0.6 + experienceRaw * 0.4);
  const raw = clamp01(base * 0.7 + alignment * 0.3);

  return {
    raw,
    evidence: { hasProgression, seniorityLevel },
  };
}

function buildRecommendedActions(skillGaps) {
  const gaps = safeArray(skillGaps).slice(0, 5);
  return gaps.map((gap) => ({
    type: 'skill_gap',
    action: `Develop skill: ${gap}`,
    skill: gap,
  }));
}

function buildProgressionNotes({ title, experienceEvidence, seniority }) {
  const notes = [];

  if (seniority && typeof seniority.seniority_level === 'number') {
    const level = seniority.seniority_level;
    const label = seniority.seniority_label || '';
    if (level >= 4 && level <= 5) {
      notes.push(`Role is classified as ${label} — a senior/lead progression step.`);
    } else if (level >= 6) {
      notes.push(`Role is classified as ${label} — a strategic leadership position.`);
    }
  } else {
    const t = normalizeTextForMatch(title);
    if (/(senior|lead|principal|head|chief)/.test(t)) {
      notes.push('Role appears to be a senior/lead progression step.');
    }
    if (/(manager|director)/.test(t)) {
      notes.push('Role suggests people/process leadership responsibilities.');
    }
  }

  if (experienceEvidence && Array.isArray(experienceEvidence.matchedTitles) && experienceEvidence.matchedTitles.length > 0) {
    notes.push(`Aligned with your experience: ${experienceEvidence.matchedTitles.slice(0, 3).join(', ')}`);
  }
  return notes;
}

async function scoreCareerPath(userProfile, careerPath, options = {}) {
  const userSkills = safeArray(userProfile.userSkills);
  const userWorkExperience = safeArray(userProfile.userWorkExperience);
  const userEducation = userProfile.userEducation && typeof userProfile.userEducation === 'object' ? userProfile.userEducation : {};
  const userCareerPreferences =
    userProfile.userCareerPreferences && typeof userProfile.userCareerPreferences === 'object'
      ? userProfile.userCareerPreferences
      : {};
  const userInterests = safeArray(userProfile.userInterests);

  const title = normalizeTextForMatch(careerPath.title || '');
  const description = normalizeTextForMatch(careerPath.description || '');

  const requiredSkillTitles = extractRequiredSkillTitles(careerPath, options);
  const weights = normalizeWeights(options.weights);

  const hasSkillModel =
    careerPath.skillModel &&
    Array.isArray(careerPath.skillModel.core_skills) &&
    careerPath.skillModel.core_skills.length > 0;

  const seniority = careerPath.seniority || null;

  const skillsDim = hasSkillModel
    ? computeWeightedSkillMatchDimension({ userSkills, skillModel: careerPath.skillModel, title, description })
    : computeSkillMatchDimension({ userSkills, requiredSkillTitles, title, description });
  const expDim = computeExperienceAlignmentDimension({ userWorkExperience, title, description, seniority });
  const industryDim = computeIndustryPreferenceDimension({
    userCareerPreferences,
    title,
    description,
    iscoGroup: careerPath.iscoGroup,
  });
  const interestsDim = computeInterestsFitDimension({ userInterests, title, description });
  const growthDim = computeCareerGrowthPotentialDimension({
    title,
    skillMatchRaw: skillsDim.raw,
    experienceRaw: expDim.raw,
    seniority,
  });

  const breakdown = {
    skillsMatch: {
      raw: skillsDim.raw,
      weight: weights.skillsMatch,
      weighted: skillsDim.raw * weights.skillsMatch,
      evidence: skillsDim.evidence,
    },
    experienceAlignment: {
      raw: expDim.raw,
      weight: weights.experienceAlignment,
      weighted: expDim.raw * weights.experienceAlignment,
      evidence: expDim.evidence,
    },
    industryPreference: {
      raw: industryDim.raw,
      weight: weights.industryPreference,
      weighted: industryDim.raw * weights.industryPreference,
      evidence: industryDim.evidence,
    },
    careerGrowthPotential: {
      raw: growthDim.raw,
      weight: weights.careerGrowthPotential,
      weighted: growthDim.raw * weights.careerGrowthPotential,
      evidence: growthDim.evidence,
    },
    interestsFit: {
      raw: interestsDim.raw,
      weight: weights.interestsFit,
      weighted: interestsDim.raw * weights.interestsFit,
      evidence: interestsDim.evidence,
    },
  };

  const { modifier: educationModifier, category: educationMatchCategory } = calculateEducationModifier(
    userEducation,
    careerPath
  );

  const baseScoreRaw = Object.values(breakdown).reduce((acc, d) => acc + d.weighted, 0);
  const baseScore = Number((baseScoreRaw * 10).toFixed(3));
  const rawScore = baseScore * educationModifier;
  const rawScoreNorm = rawScore / 10;
  const calibrationOptions = { calibrationMode: options.calibrationMode };
  const calibratedScore = calibrateScore(rawScoreNorm, calibrationOptions);
  const clampedCalibrated = Math.min(1, Math.max(0, calibratedScore));
  const score = Number((clampedCalibrated * 10).toFixed(3));

  breakdown.educationModifier = {
    modifier: educationModifier,
    category: educationMatchCategory,
    appliedAs: 'multiplicative',
  };

  const userProfileForHybrid = buildUserProfileForHybrid(userProfile);
  let hybridScoreNextRole = null;
  let hybridCosineNextRole = null;
  let hybridScoreOutOfTheBox = null;
  let hybridCosineOutOfTheBox = null;
  const [nextResult, outResult] = await Promise.all([
    scoreNextRole(userProfileForHybrid, careerPath),
    scoreOutOfTheBox(userProfileForHybrid, careerPath),
  ]);
  if (nextResult != null) {
    hybridScoreNextRole = nextResult.score;
    hybridCosineNextRole = nextResult.cosine;
  }
  if (outResult != null) {
    hybridScoreOutOfTheBox = outResult.score;
    hybridCosineOutOfTheBox = outResult.cosine;
  }

  const recommendedActions = buildRecommendedActions(skillsDim.skillGaps);
  const progressionNotes = buildProgressionNotes({
    title: careerPath.title || '',
    experienceEvidence: expDim.evidence,
    seniority,
  });

  const educationMatch = {
    matched: educationModifier >= 1,
    matchedDegree: userEducation?.highestDegree || null,
  };

  const experienceAlignment = {
    matchedTitles: expDim.evidence.matchedTitles || [],
    matchedCount: expDim.evidence.matchedCount || 0,
  };

  const calibrationMode = getCalibrationMode({ calibrationMode: options.calibrationMode });
  const scoringDebug = {
    baseScore,
    educationModifier,
    rawScore: Number(rawScore.toFixed(3)),
    calibratedScore: Number(clampedCalibrated.toFixed(3)),
    calibrationMode,
    finalScore: score,
    educationMatchCategory,
  };
  if (options.logScoring) {
    console.debug('[careerPathScorerLegacy]', JSON.stringify(scoringDebug));
  }

  return {
    score,
    scoreBreakdown: breakdown,
    scoringDebug,
    hybridScoreNextRole,
    hybridCosineNextRole,
    hybridScoreOutOfTheBox,
    hybridCosineOutOfTheBox,
    weights,
    matchedSkills: skillsDim.matchedSkills,
    matchedInputs: skillsDim.matchedInputs,
    educationMatch,
    experienceAlignment,
    skillGaps: skillsDim.skillGaps,
    recommendedActions,
    progressionNotes,
    seniority: seniority
      ? {
          level: seniority.seniority_level,
          label: seniority.seniority_label,
        }
      : null,
  };
}

async function scoreCareerPaths(userProfile, careerPaths, options = {}) {
  const cps = Array.isArray(careerPaths) ? careerPaths : [];
  const scored = await Promise.all(
    cps.map(async (cp) => {
      const result = await scoreCareerPath(userProfile, cp, options);
      return {
        ...cp,
        ...result,
      };
    })
  );

  if (options.analyzeDistribution && scored.length > 0) {
    const rawScores = scored.map((s) => (s.scoringDebug?.rawScore ?? s.score) / 10);
    const calibratedScores = scored.map((s) => s.scoringDebug?.calibratedScore ?? s.score / 10);
    const rawDist = analyzeScoreDistribution(rawScores);
    const calDist = analyzeScoreDistribution(calibratedScores);
    console.debug('[careerPathScorerLegacy] Raw score distribution:', rawDist);
    console.debug('[careerPathScorerLegacy] Calibrated score distribution:', calDist);
  }

  return scored;
}

module.exports = {
  scoreCareerPath,
  scoreCareerPaths,
  normalizeSkillKey,
  extractRequiredSkillTitles,
  normalizeWeights,
  DEFAULT_WEIGHTS,
  analyzeScoreDistribution,
  computeWeightedSkillMatchDimension,
  computeSkillMatchDimension,
  mapUserDegreeToLevel,
  inferRoleDegreeLevel,
  computeEducationMatchDimension,
  calculateEducationModifier,
  EDUCATION_MATCH_CATEGORY,
  CORE_WEIGHTS_SUM,
};
