/**
 * LLM semantic JSON → profile shape, signal detection, and good-at sanitization.
 */

const {
  sanitizeCurrentEmploymentStatus,
  inferCurrentEmploymentStatusFromText,
} = require('../../../constants/currentEmploymentStatus');
const { inferHighestDegreeFromText } = require('../../../constants/highestDegree');
const { inferMostSeniorRoleFromText } = require('../../../constants/senioritySelectOptions');
const { filterHeuristicSkillObjects } = require('../documents/documentProfileEnrichment');
const {
  normalizeString,
  bulletsToText,
} = require('./cvExtractionTextUtils');
const { normalizeGermanCvResponsibilityList } = require('../../../constants/normalizeGermanCvResponsibilities');

function profileHasAnyExtractable(profile) {
  const sui = profile?.structuredUserInfo || {};
  const ui = profile?.userIdentity || {};
  const sen = profile?.seniority || {};
  return (
    (Array.isArray(sui.skillDomains) && sui.skillDomains.length > 0) ||
    (Array.isArray(sui.skills) && sui.skills.length > 0) ||
    (Array.isArray(sui.domains) && sui.domains.length > 0) ||
    (Array.isArray(sui.keyResponsibilities) && sui.keyResponsibilities.length > 0) ||
    (Array.isArray(sui.skillsInDevelopment) && sui.skillsInDevelopment.length > 0) ||
    Object.values(ui || {}).some((v) => String(v || '').trim()) ||
    Object.values(sen || {}).some((v) => v !== '' && v !== null && v !== undefined)
  );
}

function structuredSeniorityHasSignals(structuredSemantic) {
  const n = structuredSemantic?.seniority;
  if (!n || typeof n !== 'object') return false;
  return ['currentStatus', 'yearsOfExperience', 'highestDegree', 'mostSeniorRole'].some((key) => {
    const node = n[key];
    if (node && typeof node === 'object' && node !== null && 'value' in node) {
      return String(node.value ?? '').trim().length > 0;
    }
    return false;
  });
}

/** True when structured AI returned interpreted good-at beyond skills alone. */
function structuredSemanticHasProfileSignals(structuredSemantic) {
  const sp = structuredSemantic?.structuredProfile;
  if (!sp || typeof sp !== 'object') return false;
  return ['skillDomains', 'domains', 'responsibilities', 'learningGoals'].some(
    (key) => Array.isArray(sp[key]) && sp[key].length > 0
  );
}

function looksLikeSkillsCvDump(skillsList) {
  const raw = (Array.isArray(skillsList) ? skillsList : [])
    .map((item) => (typeof item === 'string' ? item : item?.name || ''))
    .map((name) => normalizeString(name, 80))
    .filter(Boolean);
  if (raw.length === 0) return false;
  const filtered = filterHeuristicSkillObjects(raw);
  if (filtered.length === 0) return true;
  if (raw.length >= 10 && filtered.length < Math.ceil(raw.length * 0.6)) return true;
  return raw.length >= 15;
}

function isSkillsOnlyStructuredGoodAt(structuredUserInfo = {}) {
  const hasOther = ['skillDomains', 'domains', 'keyResponsibilities', 'skillsInDevelopment'].some(
    (key) => Array.isArray(structuredUserInfo[key]) && structuredUserInfo[key].length > 0
  );
  if (hasOther) return false;
  return Array.isArray(structuredUserInfo.skills) && structuredUserInfo.skills.length > 0;
}

function withoutHeuristicGoodAtFields(structuredUserInfo = {}) {
  return {
    ...structuredUserInfo,
    skillDomains: [],
    domains: [],
    keyResponsibilities: [],
    skills: [],
    skillsInDevelopment: [],
  };
}

function stripGoodAtFromProfile(profile = {}) {
  return {
    ...profile,
    structuredUserInfo: withoutHeuristicGoodAtFields(profile.structuredUserInfo),
  };
}

function sanitizeMappedGoodAtProfile(profile = {}) {
  const sui = profile.structuredUserInfo && typeof profile.structuredUserInfo === 'object'
    ? profile.structuredUserInfo
    : {};
  const filteredSkills = filterHeuristicSkillObjects(sui.skills);
  const nextSui = { ...sui, skills: filteredSkills };
  if (looksLikeSkillsCvDump(sui.skills) || isSkillsOnlyStructuredGoodAt(nextSui)) {
    return { ...profile, structuredUserInfo: withoutHeuristicGoodAtFields(nextSui) };
  }
  return { ...profile, structuredUserInfo: nextSui };
}

/** CV interpreter may return `{ value }`, a plain string/number, or (legacy) empty object. */
function readSemanticSeniorityScalar(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
  if (typeof node === 'object' && !Array.isArray(node) && node !== null && 'value' in node) {
    const v = node.value;
    if (v === undefined || v === null) return '';
    if (typeof v === 'string' && !v.trim()) return '';
    return String(v).trim();
  }
  return '';
}

function identitySemanticHasSignals(identitySemantic) {
  return Boolean(identitySemantic?.userIdentity);
}

function mapSemanticExtractionToProfile(semantic, options = {}) {
  const documentLanguage = options.documentLanguage === 'de' ? 'de' : 'en';
  const s = semantic?.structuredProfile || {};
  const u = semantic?.userIdentity || {};
  const n = semantic?.seniority || {};

  const rawKeyResponsibilities = (Array.isArray(s?.responsibilities) ? s.responsibilities : [])
    .map((item) => normalizeString(item?.description || item?.name || '', 220))
    .filter(Boolean);
  const keyResponsibilities = documentLanguage === 'de'
    ? normalizeGermanCvResponsibilityList(rawKeyResponsibilities, { force: true })
    : rawKeyResponsibilities;

  const profile = {
    personalInfo: {},
    seniority: {
      currentStatus: (() => {
        const raw = readSemanticSeniorityScalar(n?.currentStatus);
        return (
          sanitizeCurrentEmploymentStatus(raw)
          || inferCurrentEmploymentStatusFromText(raw)
        );
      })(),
      yearsOfExperience: (() => {
        const raw = readSemanticSeniorityScalar(n?.yearsOfExperience);
        const value = raw.match(/\d{1,2}/);
        if (!value) return null;
        const parsed = Number.parseInt(value[0], 10);
        return Number.isFinite(parsed) ? parsed : null;
      })(),
      highestDegree: inferHighestDegreeFromText(readSemanticSeniorityScalar(n?.highestDegree)),
      mostSeniorWorkExperience: inferMostSeniorRoleFromText(
        readSemanticSeniorityScalar(n?.mostSeniorRole) || readSemanticSeniorityScalar(n?.mostSeniorWorkExperience)
      ),
    },
    structuredUserInfo: {
      skillDomains: (Array.isArray(s?.skillDomains) ? s.skillDomains : [])
        .map((item) => normalizeString(item?.name || '', 100))
        .filter(Boolean),
      workExperience: [],
      education: [],
      skills: filterHeuristicSkillObjects(
        (Array.isArray(s?.skills) ? s.skills : []).map((item) =>
          typeof item === 'string' ? item : item?.name || ''
        )
      ),
      skillsInDevelopment: (Array.isArray(s?.learningGoals) ? s.learningGoals : [])
        .map((item) => normalizeString(item?.name || '', 100))
        .filter(Boolean),
      certifications: [],
      keyResponsibilities,
      domains: (Array.isArray(s?.domains) ? s.domains : [])
        .map((item) => normalizeString(item?.name || '', 100))
        .filter(Boolean)
    },
    userIdentity: {
      workEnjoyMost: bulletsToText(u?.workEnjoyment, 500),
      topicsIndustriesInterest: bulletsToText(u?.interests, 500),
      naturallyGoodAt: bulletsToText(u?.strengths, 500),
      workEnvironmentFit: bulletsToText(u?.workStyle, 500),
      workingLifeAchievement: bulletsToText(u?.careerGoals, 500)
    }
  };

  const sanitizedProfile = sanitizeMappedGoodAtProfile(profile);
  const hasAny = profileHasAnyExtractable(sanitizedProfile);

  return {
    profile: sanitizedProfile,
    status: hasAny ? 'success' : 'failed',
    message: hasAny ? '' : 'No profile signals could be interpreted from document.',
    messageKey: hasAny ? null : 'documentUpload.extraction.semanticInterpretationNone',
    extractedFields: hasAny ? ['semanticInterpretation'] : []
  };
}

function buildSemanticInterpretationBlobFromFull(semantic) {
  if (!semantic || typeof semantic !== 'object') return null;
  const blob = {};
  if (semantic.userIdentity) blob.userIdentity = semantic.userIdentity;
  if (semantic.structuredProfile) blob.structuredProfile = semantic.structuredProfile;
  if (semantic.seniority) blob.seniority = semantic.seniority;
  return Object.keys(blob).length > 0 ? blob : null;
}

function buildSemanticInterpretationBlob(identitySemantic, structuredSemantic) {
  return buildSemanticInterpretationBlobFromFull({
    userIdentity: identitySemantic?.userIdentity,
    structuredProfile: structuredSemantic?.structuredProfile,
    seniority: structuredSemantic?.seniority,
  });
}

function buildEmptyAiExtractionResult(messageKey = 'documentUpload.extraction.semanticInterpretationNone') {
  return {
    profile: {
      personalInfo: {},
      seniority: {
        currentStatus: '',
        yearsOfExperience: null,
        highestDegree: '',
        mostSeniorWorkExperience: '',
      },
      structuredUserInfo: {
        skillDomains: [],
        workExperience: [],
        education: [],
        skills: [],
        skillsInDevelopment: [],
        certifications: [],
        keyResponsibilities: [],
        domains: [],
      },
      userIdentity: {
        workEnjoyMost: '',
        topicsIndustriesInterest: '',
        naturallyGoodAt: '',
        workEnvironmentFit: '',
        workingLifeAchievement: '',
      },
    },
    status: 'failed',
    message: 'No profile signals could be interpreted from document.',
    messageKey,
    extractedFields: [],
  };
}

module.exports = {
  profileHasAnyExtractable,
  structuredSemanticHasProfileSignals,
  structuredSeniorityHasSignals,
  identitySemanticHasSignals,
  stripGoodAtFromProfile,
  withoutHeuristicGoodAtFields,
  mapSemanticExtractionToProfile,
  buildSemanticInterpretationBlobFromFull,
  buildSemanticInterpretationBlob,
  buildEmptyAiExtractionResult,
  readSemanticSeniorityScalar,
};
