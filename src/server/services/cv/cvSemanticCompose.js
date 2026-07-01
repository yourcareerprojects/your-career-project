/**
 * Identity-first composition: merge semantic + heuristic profiles, structured LLM resolution.
 */

const { PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY } = require('../../../constants/profileReviewFieldLimits');
const { normalizeGermanCvResponsibilityList } = require('../../../constants/normalizeGermanCvResponsibilities');
const { filterHeuristicSkillObjects } = require('../documents/documentProfileEnrichment');
const { interpretCvStructuredText } = require('../documents/semanticCvInterpreter');
const { normalizeString } = require('./cvExtractionTextUtils');
const {
  profileHasAnyExtractable,
  structuredSemanticHasProfileSignals,
  structuredSeniorityHasSignals,
  identitySemanticHasSignals,
  stripGoodAtFromProfile,
  withoutHeuristicGoodAtFields,
  mapSemanticExtractionToProfile,
  buildSemanticInterpretationBlob,
  buildSemanticInterpretationBlobFromFull,
} = require('./cvSemanticMap');

/** Identity fields come from LLM only (no heuristic backfill). */
function mergeUserIdentityFields(semanticUi) {
  const keys = [
    'workEnjoyMost',
    'topicsIndustriesInterest',
    'naturallyGoodAt',
    'workEnvironmentFit',
    'workingLifeAchievement'
  ];
  const out = {};
  for (const k of keys) {
    out[k] = String(semanticUi?.[k] ?? '').trim();
  }
  return out;
}

function mergeUniqueStringLists(semanticList, heuristicList, maxLen = PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY) {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const value = normalizeString(raw, 220);
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };
  for (const item of Array.isArray(semanticList) ? semanticList : []) add(item);
  for (const item of Array.isArray(heuristicList) ? heuristicList : []) add(item);
  return out.slice(0, maxLen);
}

function mergeUniqueSkillLists(semanticList, heuristicList, maxLen = PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY) {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const name = normalizeString(typeof raw === 'string' ? raw : raw?.name, 80);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name });
  };
  for (const item of Array.isArray(semanticList) ? semanticList : []) add(item);
  for (const item of Array.isArray(heuristicList) ? heuristicList : []) add(item);
  return out.slice(0, maxLen);
}

function mergeKeyResponsibilityLists(semanticList, heuristicList, maxLen = PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY) {
  const semantic = (Array.isArray(semanticList) ? semanticList : [])
    .map((item) => normalizeString(item, 220))
    .filter(Boolean);
  const heuristic = (Array.isArray(heuristicList) ? heuristicList : [])
    .map((item) => normalizeString(item, 220))
    .filter(Boolean);

  if (semantic.length >= 3) {
    return semantic.slice(0, maxLen);
  }

  const out = [];
  const seen = new Set();
  const add = (raw, maxItemLen = 220) => {
    const value = normalizeString(raw, maxItemLen);
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };

  for (const item of semantic) add(item);
  for (const item of heuristic) {
    if (semantic.length > 0 && String(item).trim().length > 120) continue;
    add(item);
    if (out.length >= maxLen) break;
  }
  return out.slice(0, maxLen);
}

/**
 * Semantic interpretation omits literal CV rows (jobs, degrees, certs, contact).
 * Prefer AI-interpreted "good at" lists; only fall back to heuristics when semantic is empty.
 * Skills merge literally parsed CV skills with semantic skills (both can be valuable).
 */
function mergeHeuristicStructuredBaseline(semanticProfile, heuristicProfile, options = {}) {
  const skipHeuristicGoodAt = Boolean(options.skipHeuristicGoodAtFallback);
  const h = heuristicProfile || {};
  const s = semanticProfile || {};
  const hsui = h.structuredUserInfo || {};
  const ssui = s.structuredUserInfo || {};

  const preferArr = (primary, fallback) =>
    Array.isArray(primary) && primary.length > 0 ? primary : (Array.isArray(fallback) ? fallback : []);

  const pickGoodAt = (semanticList, heuristicList) => {
    if (Array.isArray(semanticList) && semanticList.length > 0) return semanticList;
    if (skipHeuristicGoodAt) return [];
    return preferArr(semanticList, heuristicList);
  };

  const pickSkills = () => {
    if (Array.isArray(ssui.skills) && ssui.skills.length > 0) return ssui.skills;
    if (skipHeuristicGoodAt) return [];
    return filterHeuristicSkillObjects(hsui.skills);
  };

  return {
    ...s,
    name: s.name || h.name,
    personalInfo: {
      ...(typeof h.personalInfo === 'object' && h.personalInfo ? h.personalInfo : {}),
      ...(typeof s.personalInfo === 'object' && s.personalInfo ? s.personalInfo : {})
    },
    structuredUserInfo: {
      ...ssui,
      skillDomains: pickGoodAt(ssui.skillDomains, hsui.skillDomains),
      domains: pickGoodAt(ssui.domains, hsui.domains),
      keyResponsibilities: pickGoodAt(ssui.keyResponsibilities, hsui.keyResponsibilities),
      skills: pickSkills(),
      skillsInDevelopment: pickGoodAt(ssui.skillsInDevelopment, hsui.skillsInDevelopment),
      workExperience: preferArr(ssui.workExperience, hsui.workExperience),
      education: preferArr(ssui.education, hsui.education),
      certifications: preferArr(ssui.certifications, hsui.certifications)
    },
    userIdentity: mergeUserIdentityFields(s.userIdentity)
  };
}

function mergeSeniorityFromHeuristic(semanticProfile, heuristicProfile) {
  const s = semanticProfile?.seniority && typeof semanticProfile.seniority === 'object' ? semanticProfile.seniority : {};
  const h = heuristicProfile?.seniority && typeof heuristicProfile.seniority === 'object' ? heuristicProfile.seniority : {};
  const emptyStr = (v) => {
    if (v === undefined || v === null || v === '') return true;
    if (typeof v === 'string') return !v.trim();
    return false;
  };
  const pickStr = (semVal, heuVal) => (!emptyStr(semVal) ? String(semVal).trim() : String(heuVal || '').trim());
  return {
    currentStatus: pickStr(s.currentStatus, h.currentStatus),
    yearsOfExperience: s.yearsOfExperience !== null && s.yearsOfExperience !== undefined
      ? s.yearsOfExperience
      : h.yearsOfExperience ?? null,
    highestDegree: pickStr(s.highestDegree, h.highestDegree),
    mostSeniorWorkExperience: pickStr(s.mostSeniorWorkExperience, h.mostSeniorWorkExperience)
  };
}

async function resolveStructuredSemanticInterpretation(text, cvLang) {
  const structured = await interpretCvStructuredText(text, { documentLanguage: cvLang });
  if (structuredSemanticHasProfileSignals(structured) || structuredSeniorityHasSignals(structured)) {
    return structured;
  }
  return structured || null;
}

function buildProfileFromIdentityAndHeuristic(identitySemantic, heuristicResult) {
  const identityMapped = mapSemanticExtractionToProfile({
    userIdentity: identitySemantic?.userIdentity || {},
  });
  const heuristicProfile = heuristicResult?.profile || {};
  const profile = {
    ...heuristicProfile,
    structuredUserInfo: withoutHeuristicGoodAtFields(heuristicProfile.structuredUserInfo),
    userIdentity: identityMapped.profile?.userIdentity || {},
  };

  const extractedFields = [...new Set([
    ...(identityMapped.extractedFields || []),
    ...(heuristicResult.extractedFields || []).filter((field) => field !== 'skills' && field !== 'skillDomains'),
  ])];

  const hasIdentity = Object.values(profile.userIdentity || {}).some((v) => String(v || '').trim());
  const hasAny = profileHasAnyExtractable(profile);

  return {
    profile,
    status: hasAny ? (hasIdentity ? 'success' : 'partial') : heuristicResult.status || 'failed',
    message: heuristicResult.message || '',
    messageKey: heuristicResult.messageKey || null,
    extractedFields,
  };
}

function polishGermanKeyResponsibilities(profile, documentLanguage) {
  if (documentLanguage !== 'de') return profile;
  const sui = profile?.structuredUserInfo;
  if (!sui || !Array.isArray(sui.keyResponsibilities) || sui.keyResponsibilities.length === 0) {
    return profile;
  }
  return {
    ...profile,
    structuredUserInfo: {
      ...sui,
      keyResponsibilities: normalizeGermanCvResponsibilityList(sui.keyResponsibilities, { force: true }),
    },
  };
}

function mergeStructuredSemanticIntoProfile(existingProfile, structuredSemantic, heuristicResult, options = {}) {
  const documentLanguage = options.documentLanguage === 'de' ? 'de' : 'en';
  const mapped = mapSemanticExtractionToProfile({
    structuredProfile: structuredSemantic?.structuredProfile,
    seniority: structuredSemantic?.seniority,
  }, { documentLanguage });
  const mergedSeniority = mergeSeniorityFromHeuristic(mapped.profile, heuristicResult.profile);
  const withBaseline = mergeHeuristicStructuredBaseline(mapped.profile, heuristicResult.profile, {
    skipHeuristicGoodAtFallback: true,
  });
  const merged = {
    ...withBaseline,
    userIdentity: { ...(existingProfile?.userIdentity || {}) },
    name: existingProfile?.name || withBaseline.name,
    personalInfo: {
      ...(withBaseline.personalInfo || {}),
      ...(existingProfile?.personalInfo || {}),
    },
    seniority: {
      currentStatus: mergedSeniority.currentStatus ?? '',
      yearsOfExperience: mergedSeniority.yearsOfExperience ?? null,
      highestDegree: mergedSeniority.highestDegree ?? '',
      mostSeniorWorkExperience: mergedSeniority.mostSeniorWorkExperience ?? ''
    }
  };
  return polishGermanKeyResponsibilities(merged, documentLanguage);
}

function buildCombinedSemanticExtraction(heuristicResult, identitySemantic, structuredSemantic, options = {}) {
  const hasIdentity = identitySemanticHasSignals(identitySemantic);
  const hasStructuredProfile = structuredSemanticHasProfileSignals(structuredSemantic);
  const hasStructuredSeniority = structuredSeniorityHasSignals(structuredSemantic);

  if (!hasIdentity && !hasStructuredProfile && !hasStructuredSeniority) {
    return null;
  }

  let profile;
  let extractedFields = [...(heuristicResult?.extractedFields || [])];

  if (hasIdentity) {
    const phase1 = buildProfileFromIdentityAndHeuristic(identitySemantic, heuristicResult);
    profile = phase1.profile;
    extractedFields = [...new Set([...extractedFields, ...(phase1.extractedFields || [])])];
  } else {
    profile = {
      ...(heuristicResult?.profile || {}),
      structuredUserInfo: withoutHeuristicGoodAtFields(heuristicResult?.profile?.structuredUserInfo),
    };
  }

  if (hasStructuredProfile || hasStructuredSeniority) {
    profile = mergeStructuredSemanticIntoProfile(profile, structuredSemantic, heuristicResult, options);
    extractedFields.push('semanticInterpretation');
  }

  const hasAny = profileHasAnyExtractable(profile);
  const semanticEnrichmentStatus =
    hasStructuredProfile ? 'complete' : (hasIdentity ? 'pending' : 'skipped');

  return {
    profile,
    status: hasAny ? 'success' : heuristicResult?.status || 'failed',
    message: heuristicResult?.message || '',
    messageKey: heuristicResult?.messageKey || null,
    extractedFields: [...new Set(extractedFields)],
    semanticInterpretation: buildSemanticInterpretationBlob(identitySemantic, structuredSemantic),
    semanticEnrichmentStatus,
  };
}

function mergeSemanticInterpretationIntoProfile(existingProfile, semantic) {
  const mapped = mapSemanticExtractionToProfile(semantic);
  const existingIdentity = existingProfile?.userIdentity || {};
  const hasExistingIdentity = Object.values(existingIdentity).some((v) => String(v || '').trim());
  const hasStructuredGoodAt = structuredSemanticHasProfileSignals(semantic);
  const mergedProfile = {
    ...mapped.profile,
    userIdentity: hasExistingIdentity ? existingIdentity : mapped.profile.userIdentity,
    name: existingProfile?.name || mapped.profile.name,
    personalInfo: {
      ...(mapped.profile.personalInfo || {}),
      ...(existingProfile?.personalInfo || {}),
    },
  };

  if (!hasStructuredGoodAt) {
    return stripGoodAtFromProfile({
      ...existingProfile,
      ...mergedProfile,
    });
  }

  return mergedProfile;
}

function mergeHeuristicFallbackIntoProfile(existingProfile, heuristicProfile) {
  const existingIdentity = existingProfile?.userIdentity || {};
  const hasExistingIdentity = Object.values(existingIdentity).some((v) => String(v || '').trim());
  return {
    ...heuristicProfile,
    userIdentity: hasExistingIdentity ? existingIdentity : (heuristicProfile?.userIdentity || {}),
    name: existingProfile?.name || heuristicProfile?.name,
    personalInfo: {
      ...(heuristicProfile?.personalInfo || {}),
      ...(existingProfile?.personalInfo || {}),
    },
  };
}

module.exports = {
  mergeStructuredSemanticIntoProfile,
  mergeSemanticInterpretationIntoProfile,
  mergeHeuristicFallbackIntoProfile,
  buildProfileFromIdentityAndHeuristic,
  resolveStructuredSemanticInterpretation,
  buildCombinedSemanticExtraction,
  __testables: {
    mergeHeuristicStructuredBaseline,
    mergeUniqueStringLists,
    mergeUniqueSkillLists,
    mergeKeyResponsibilityLists,
    mergeSeniorityFromHeuristic,
    mergeStructuredSemanticIntoProfile,
    buildProfileFromIdentityAndHeuristic,
    buildCombinedSemanticExtraction,
    mergeUserIdentityFields,
  },
};
