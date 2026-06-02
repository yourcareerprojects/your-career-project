/**
 * CV extraction pipeline: heuristics, semantic LLM interpretation, localization.
 * Used by the CV extraction worker (not HTTP controllers).
 */

const logger = require('../../utils/logger');
const { sanitizeCurrentEmploymentStatus } = require('../../../constants/currentEmploymentStatus');
const {
  extractFromTextHeuristics,
  parseDocumentToText,
} = require('../documents/documentProfileEnrichment');
const { interpretCvText } = require('../documents/semanticCvInterpreter');
const { detectCvDocumentLanguage } = require('../documents/detectCvDocumentLanguage');
const {
  localizeCvExtractedProfile,
  fallbackCvProfileWithoutLocalization,
} = require('../documents/cvExtractLocalization');
const { normalizeExternalApiError, isTimeoutLikeError } = require('../../utils/httpTimeouts');
const {
  runStageIfCvPipeline,
  runSyncStageIfCvPipeline,
  logCvEvent,
  getCvPipeline,
  serializeErrorSafe,
} = require('../../utils/metricsLogger');

function normalizeString(value, maxLen = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function safeDegreeFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/\bph\.?d\b|doctorate|doctoral/.test(t)) return 'phd';
  if (/\bmaster\b|msc|m\.?sc|mba/.test(t)) return 'masters';
  if (/\bbachelor\b|bsc|b\.?sc|ba\b/.test(t)) return 'bachelors';
  if (/associate/.test(t)) return 'associate';
  if (/staatsexamen|state examination/.test(t)) return 'staatsexamen';
  if (/fachabitur|fachhochschulreife/.test(t)) return 'fachabitur';
  if (/\bausbildung\b|berufsausbildung|\blehre\b/.test(t)) return 'ausbildung';
  if (/realschulabschluss|mittlere reife|realschule/.test(t)) return 'realschulabschluss';
  if (/hauptschulabschluss|hauptschule/.test(t)) return 'hauptschulabschluss';
  if (/high school|secondary/.test(t)) return 'high_school';
  return '';
}

function safeMostSeniorRoleFromTitle(title) {
  const t = String(title || '').toLowerCase();
  if (!t) return '';
  if (/\bchief\b|\bcxo\b|\bceo\b|\bcto\b|\bcfo\b/.test(t)) return 'c_suite';
  if (/\bvp\b|vice president/.test(t)) return 'vp';
  if (/\bdirector\b/.test(t)) return 'director';
  if (/\bmanager\b|head of/.test(t)) return 'manager';
  if (/\blead\b|principal/.test(t)) return 'lead';
  if (/\bsenior\b|sr\b/.test(t)) return 'senior';
  if (/\bjunior\b|jr\b|entry/.test(t)) return 'entry_level';
  if (/\bintern\b|internship/.test(t)) return 'intern';
  return 'mid_level';
}

function inferYearsOfExperienceFromText(text, workExperienceCount) {
  const t = String(text || '');
  const explicitYears = t.match(/(\d{1,2})\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience/i);
  if (explicitYears) {
    const parsed = Number.parseInt(explicitYears[1], 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 50) return parsed;
  }
  if (workExperienceCount >= 5) return 10;
  if (workExperienceCount >= 3) return 6;
  if (workExperienceCount >= 2) return 4;
  if (workExperienceCount >= 1) return 2;
  return null;
}

function inferDomainsFromText(text) {
  const t = String(text || '').toLowerCase();
  const rules = [
    { name: 'Healthcare', pattern: /\bhospital\b|\bclinic\b|\bmedical\b|\bpatient\b|\bhealthcare\b/ },
    { name: 'MedTech', pattern: /\bmedtech\b|\bmedical device\b|\bdigital health\b/ },
    { name: 'Finance', pattern: /\bfintech\b|\bbanking\b|\bfinance\b|\bfinancial services\b|\binsurance\b/ },
    { name: 'Education', pattern: /\bedtech\b|\beducation\b|\buniversity\b|\bteaching\b/ },
    { name: 'E-commerce', pattern: /\be-commerce\b|\becommerce\b|\bonline retail\b|\bmarketplace\b/ },
    { name: 'Artificial Intelligence', pattern: /\bartificial intelligence\b|\bmachine learning\b|\bai\b/ },
    { name: 'Sustainability', pattern: /\bsustainability\b|\bclimate\b|\brenewable\b|\besg\b/ },
    { name: 'Sports', pattern: /\bsports\b|\bathlete\b|\bfitness\b/ },
    { name: 'Architecture', pattern: /\barchitecture\b|\burban planning\b|\bconstruction design\b/ },
    { name: 'Mobility', pattern: /\bmobility\b|\btransport\b|\bautomotive\b|\blogistics\b/ }
  ];
  const out = [];
  for (const rule of rules) {
    if (rule.pattern.test(t)) out.push(rule.name);
    if (out.length >= 6) break;
  }
  return out;
}

function mapMostSeniorRole(raw) {
  const t = String(raw || '').toLowerCase();
  if (!t) return '';
  if (/\bchief\b|\bcxo\b|\bceo\b|\bcto\b|\bcfo\b/.test(t)) return 'c_suite';
  if (/\bvp\b|vice president/.test(t)) return 'vp';
  if (/\bdirector\b/.test(t)) return 'director';
  if (/\bmanager\b|head of/.test(t)) return 'manager';
  if (/\blead\b|principal/.test(t)) return 'lead';
  if (/\bsenior\b|sr\b/.test(t)) return 'senior';
  if (/\bjunior\b|jr\b|entry/.test(t)) return 'entry_level';
  if (/\bintern\b|internship/.test(t)) return 'intern';
  return 'mid_level';
}

function bulletsToText(field, maxLen = 500) {
  const bullets = Array.isArray(field?.bullets)
    ? field.bullets.map((b) => normalizeString(b, 140)).filter(Boolean)
    : [];
  return normalizeString(bullets.join('\n'), maxLen);
}

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

/** Prefer semantic strings when non-empty; otherwise keep heuristic prefills (summary, skills line, etc.). */
function mergeUserIdentityFields(semanticUi, heuristicUi) {
  const keys = [
    'workEnjoyMost',
    'topicsIndustriesInterest',
    'naturallyGoodAt',
    'workEnvironmentFit',
    'workingLifeAchievement'
  ];
  const out = {};
  for (const k of keys) {
    const sv = String(semanticUi?.[k] ?? '').trim();
    const hv = String(heuristicUi?.[k] ?? '').trim();
    out[k] = sv || hv;
  }
  return out;
}

/**
 * Semantic interpretation omits literal CV rows (jobs, degrees, certs, contact).
 * When those arrays/objects are empty on the semantic profile, carry forward heuristics.
 */
function mergeHeuristicStructuredBaseline(semanticProfile, heuristicProfile) {
  const h = heuristicProfile || {};
  const s = semanticProfile || {};
  const hsui = h.structuredUserInfo || {};
  const ssui = s.structuredUserInfo || {};

  const preferArr = (primary, fallback) =>
    Array.isArray(primary) && primary.length > 0 ? primary : (Array.isArray(fallback) ? fallback : []);

  return {
    ...s,
    name: s.name || h.name,
    personalInfo: {
      ...(typeof h.personalInfo === 'object' && h.personalInfo ? h.personalInfo : {}),
      ...(typeof s.personalInfo === 'object' && s.personalInfo ? s.personalInfo : {})
    },
    structuredUserInfo: {
      ...ssui,
      skillDomains: preferArr(ssui.skillDomains, hsui.skillDomains),
      domains: preferArr(ssui.domains, hsui.domains),
      keyResponsibilities: preferArr(ssui.keyResponsibilities, hsui.keyResponsibilities),
      skills: preferArr(ssui.skills, hsui.skills),
      skillsInDevelopment: preferArr(ssui.skillsInDevelopment, hsui.skillsInDevelopment),
      workExperience: preferArr(ssui.workExperience, hsui.workExperience),
      education: preferArr(ssui.education, hsui.education),
      certifications: preferArr(ssui.certifications, hsui.certifications)
    },
    userIdentity: mergeUserIdentityFields(s.userIdentity, h.userIdentity)
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

function mapSemanticExtractionToProfile(semantic) {
  const s = semantic?.structuredProfile || {};
  const u = semantic?.userIdentity || {};
  const n = semantic?.seniority || {};

  const profile = {
    personalInfo: {},
    seniority: {
      currentStatus: sanitizeCurrentEmploymentStatus(readSemanticSeniorityScalar(n?.currentStatus)),
      yearsOfExperience: (() => {
        const raw = readSemanticSeniorityScalar(n?.yearsOfExperience);
        const value = raw.match(/\d{1,2}/);
        if (!value) return null;
        const parsed = Number.parseInt(value[0], 10);
        return Number.isFinite(parsed) ? parsed : null;
      })(),
      highestDegree: safeDegreeFromText(readSemanticSeniorityScalar(n?.highestDegree)),
      mostSeniorWorkExperience: mapMostSeniorRole(
        readSemanticSeniorityScalar(n?.mostSeniorRole) || readSemanticSeniorityScalar(n?.mostSeniorWorkExperience)
      )
    },
    structuredUserInfo: {
      skillDomains: (Array.isArray(s?.skillDomains) ? s.skillDomains : [])
        .map((item) => normalizeString(item?.name || '', 100))
        .filter(Boolean),
      workExperience: [],
      education: [],
      skills: (Array.isArray(s?.skills) ? s.skills : [])
        .map((item) => ({ name: normalizeString(item?.name || '', 80) }))
        .filter((item) => item.name),
      skillsInDevelopment: (Array.isArray(s?.learningGoals) ? s.learningGoals : [])
        .map((item) => normalizeString(item?.name || '', 100))
        .filter(Boolean),
      certifications: [],
      keyResponsibilities: (Array.isArray(s?.responsibilities) ? s.responsibilities : [])
        .map((item) => normalizeString(item?.description || item?.name || '', 220))
        .filter(Boolean),
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

  const hasAny = profileHasAnyExtractable(profile);

  return {
    profile,
    status: hasAny ? 'success' : 'failed',
    message: hasAny ? '' : 'No profile signals could be interpreted from document.',
    messageKey: hasAny ? null : 'documentUpload.extraction.semanticInterpretationNone',
    extractedFields: hasAny ? ['semanticInterpretation'] : []
  };
}

// Helper: Extract profile data from document text (regex + heuristic extraction)
function extractProfileDataFromDocumentTextHeuristic(text) {
  const profile = {
    personalInfo: {},
    seniority: {},
    structuredUserInfo: {
      skillDomains: [],
      workExperience: [],
      education: [],
      skills: [],
      skillsInDevelopment: [],
      certifications: [],
      keyResponsibilities: []
    },
    userIdentity: {}
  };
  let extractedFields = [];
  
  if (!text || text.trim().length === 0) {
    return {
      profile,
      status: 'failed',
      message: 'No readable text could be extracted from this document (including OCR). Try exporting the CV again as a PDF with selectable text, uploading DOCX, or using a clearer JPG/PNG image.',
      messageKey: 'documentUpload.extraction.noDocumentText',
    };
  }

  try {
    // Name extraction
    const namePatterns = [
      /Name\s*[:\-]\s*([A-Za-z\s]+)/i,
      /^([A-Z][a-z]+\s+[A-Z][a-z]+)/m,
      /([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[\n\r]/m
    ];
    for (const pattern of namePatterns) {
      const nameMatch = text.match(pattern);
      if (nameMatch) {
        const nameParts = normalizeString(nameMatch[1], 120).split(/\s+/);
        if (nameParts.length >= 2) {
          profile.name = nameParts.join(' ');
          extractedFields.push('name');
          break;
        }
      }
    }

    // Email extraction
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      profile.personalInfo.email = emailMatch[0];
      extractedFields.push('email');
    }

    // Phone extraction
    const phonePatterns = [
      /(\+?\d{1,3}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{1,4}[\s\-]?\d{1,9})/,
      /(\+?\d[\d\s\-()]{7,}\d)/
    ];
    
    for (const pattern of phonePatterns) {
      const phoneMatch = text.match(pattern);
      if (phoneMatch && phoneMatch[0].replace(/\D/g, '').length >= 7) {
        profile.personalInfo.phoneNumber = normalizeString(phoneMatch[0], 40);
        extractedFields.push('phone');
        break;
      }
    }

    // Use shared extraction heuristics as base for skills/experience/education/certifications.
    const { extracted: heuristicsExtracted } = extractFromTextHeuristics(text);
    if (Array.isArray(heuristicsExtracted.skills) && heuristicsExtracted.skills.length) {
      profile.structuredUserInfo.skills = heuristicsExtracted.skills.map((skill) => ({ name: normalizeString(skill, 80) }));
      extractedFields.push('skills');
    }
    if (profile.structuredUserInfo.skillDomains.length === 0 && profile.structuredUserInfo.skills.length > 0) {
      const baseDomains = profile.structuredUserInfo.skills
        .map((s) => String(s.name || '').toLowerCase())
        .filter(Boolean);
      const inferredSkillDomains = [];
      if (baseDomains.some((s) => /lead|manage|stakeholder|mentor/.test(s))) inferredSkillDomains.push('Leadership');
      if (baseDomains.some((s) => /communicat|present|negotiat|collaborat/.test(s))) inferredSkillDomains.push('Communication');
      if (baseDomains.some((s) => /analys|data|research|insight/.test(s))) inferredSkillDomains.push('Analysis');
      if (baseDomains.some((s) => /strategy|roadmap|planning/.test(s))) inferredSkillDomains.push('Strategy');
      if (baseDomains.some((s) => /design|ux|ui|creative/.test(s))) inferredSkillDomains.push('Design');
      if (baseDomains.some((s) => /build|implement|execute|delivery/.test(s))) inferredSkillDomains.push('Execution');
      profile.structuredUserInfo.skillDomains = inferredSkillDomains.slice(0, 6);
      if (profile.structuredUserInfo.skillDomains.length > 0) extractedFields.push('skillDomains');
    }
    if (Array.isArray(heuristicsExtracted.workExperience) && heuristicsExtracted.workExperience.length) {
      profile.structuredUserInfo.workExperience = heuristicsExtracted.workExperience.map((job) => ({
        title: normalizeString(job.title, 120),
        company: normalizeString(job.company, 120),
        description: normalizeString(job.description, 800)
      }));
      extractedFields.push('workExperience');
    }
    if (Array.isArray(heuristicsExtracted.education) && heuristicsExtracted.education.length) {
      profile.structuredUserInfo.education = heuristicsExtracted.education.map((edu) => ({
        institution: normalizeString(edu.institution, 160),
        degree: normalizeString(edu.degree, 120),
        field: normalizeString(edu.field || edu.fieldOfStudy, 120)
      }));
      extractedFields.push('education');
    }
    if (Array.isArray(heuristicsExtracted.certifications) && heuristicsExtracted.certifications.length) {
      profile.structuredUserInfo.certifications = heuristicsExtracted.certifications.map((cert) => ({
        name: normalizeString(cert, 140),
        issuer: '',
        date: '',
        expiryDate: ''
      }));
      extractedFields.push('certifications');
    }

    // Education fallback
    if (profile.structuredUserInfo.education.length === 0) {
      const educationSection = text.match(/Education[\s\S]{0,500}(?=\n\s*(?:Experience|Skills|Work|Projects|$))/i);
      const eduText = educationSection ? educationSection[0] : '';
      const institutions = eduText.match(/([A-Z][a-zA-Z\s&]+(?:University|College|Institute|School|Academy))/g);
      if (institutions) {
        const uniqueInstitutions = [...new Set(institutions)];
        profile.structuredUserInfo.education = uniqueInstitutions.slice(0, 5).map(inst => ({
          institution: normalizeString(inst, 160),
          degree: '',
          field: ''
        }));
        extractedFields.push('education');
      }
    }

    // Work experience fallback
    if (profile.structuredUserInfo.workExperience.length === 0) {
      const experienceSection = text.match(/(?:Work\s+)?Experience[\s\S]{0,1000}(?=\n\s*(?:Education|Skills|Projects|$))/i);
      if (experienceSection) {
        const expText = experienceSection[0];
        const fallbackExp = expText.replace(/(?:Work\s+)?Experience\s*/i, '').split(/\n/).filter(line => line.trim().length > 15).slice(0, 4);
        if (fallbackExp.length > 0) {
          profile.structuredUserInfo.workExperience = fallbackExp.map(exp => ({
            title: '',
            company: '',
            description: normalizeString(exp, 800)
          }));
          extractedFields.push('workExperience');
        }
      }
    }

    // Responsibilities summary for simulation-oriented field
    const keyResponsibilities = profile.structuredUserInfo.workExperience
      .map((exp) => normalizeString(exp.description, 300))
      .filter(Boolean)
      .slice(0, 8);
    profile.structuredUserInfo.keyResponsibilities = keyResponsibilities;
    if (keyResponsibilities.length) {
      extractedFields.push('keyResponsibilities');
    }

    const inferredDomains = inferDomainsFromText(text);
    profile.structuredUserInfo.domains = inferredDomains;
    if (inferredDomains.length > 0) {
      extractedFields.push('domains');
    }

    // Seniority inference
    const topExperience = profile.structuredUserInfo.workExperience[0] || {};
    profile.seniority.currentStatus = profile.structuredUserInfo.workExperience.length > 0 ? 'employed' : '';
    profile.seniority.yearsOfExperience = inferYearsOfExperienceFromText(text, profile.structuredUserInfo.workExperience.length);
    profile.seniority.highestDegree = safeDegreeFromText(text);
    profile.seniority.mostSeniorWorkExperience = safeMostSeniorRoleFromTitle(topExperience.title);
    if (profile.seniority.currentStatus || profile.seniority.yearsOfExperience !== null || profile.seniority.highestDegree || profile.seniority.mostSeniorWorkExperience) {
      extractedFields.push('seniority');
    }

    // Keep identity prompts prefilled when possible to minimize manual effort.
    const summaryMatch = text.match(/(?:Summary|Profile|Objective)\s*[:\-\n]([\s\S]{0,600}?)(?=\n\s*(?:Experience|Education|Skills|Projects|Certifications|Languages|$))/i);
    const summary = normalizeString(summaryMatch ? summaryMatch[1] : '', 400);
    const interestSection = text.match(/(?:Interests?|Areas of Interest|Industr(?:y|ies))\s*[:\-\n]([\s\S]{0,300}?)(?=\n\s*(?:Experience|Education|Skills|Projects|Certifications|Languages|$))/i);
    const interests = normalizeString(interestSection ? interestSection[1] : '', 300);
    const topSkills = profile.structuredUserInfo.skills.map((s) => normalizeString(s.name, 40)).filter(Boolean).slice(0, 5);
    const topRole = normalizeString(topExperience.title, 120);

    profile.userIdentity = {
      workEnjoyMost: summary || (topRole ? `Applying my skills as ${topRole}.` : ''),
      topicsIndustriesInterest: interests || '',
      naturallyGoodAt: topSkills.length ? `Skills include: ${topSkills.join(', ')}.` : '',
      workEnvironmentFit: '',
      workingLifeAchievement: topRole ? `Grow in roles similar to ${topRole}.` : ''
    };
    if (Object.values(profile.userIdentity).some((v) => String(v || '').trim())) {
      extractedFields.push('userIdentity');
    }

    // Determine extraction status
    let status = 'failed';
    let message = '';
    
    if (extractedFields.length === 0) {
      status = 'failed';
      message = 'No data could be extracted from the PDF. Please enter your information manually.';
    } else if (extractedFields.length < 3) {
      status = 'partial';
      message = `Partially extracted data (${extractedFields.join(', ')}). Please review and complete missing information.`;
    } else {
      status = 'success';
      message = `Successfully extracted ${extractedFields.length} data fields. Please review and confirm.`;
    }

    return {
      profile,
      status,
      message,
      extractedFields: [...new Set(extractedFields)]
    };
  } catch (error) {
    logger.error('Document PDF text extraction failed', error);
    return { 
      profile, 
      status: 'failed', 
      message: 'An error occurred during extraction. Please enter your information manually.',
      error: error.message 
    };
  }
}

/**
 * @typedef {'en'|'de'} CvUiLang
 */

/**
 * Completes extraction payload: attaches semantic blob metadata, bilingual bundles (`cvExtractLocalization`),
 * and flattens profile strings for the active UI locale (`uiLang`).
 */
async function finalizeCvExtractionPayload(payload, options = {}) {
  const skipLocalization = Boolean(options.skipLocalization);
  return runStageIfCvPipeline('extraction_finalize', { memory: true }, async () => {
    const semantic = options.semantic ?? null;
    const semanticAiTimedOut = Boolean(options.semanticAiTimedOut);
    const cvLang = options.cvLang;
    const uiLang = options.uiLang;

    const docLang = cvLang === 'de' ? 'de' : 'en';
    const uiLanguage = String(uiLang || 'en').toLowerCase().split('-')[0] || 'en';
    const base = {
      ...payload,
      semanticInterpretation: semantic ?? null,
      semanticInterpretationLanguage: docLang,
    };

    const applyAiTimeoutSemantics = (result) => {
      if (!semanticAiTimedOut) return result;
      if (!profileHasAnyExtractable(result.profile)) return result;
      return {
        ...result,
        status: 'partial',
        message: 'AI extraction timed out. Basic fields from your CV are still shown.',
        messageKey: 'documentUpload.extraction.aiTimeout',
      };
    };

    if (!profileHasAnyExtractable(base.profile)) {
      return applyAiTimeoutSemantics({
        ...base,
        cvExtractLocalization: null,
        localizationStatus: 'skipped',
      });
    }

    if (skipLocalization) {
      return applyAiTimeoutSemantics({
        ...base,
        cvExtractLocalization: null,
        localizationStatus: 'pending',
      });
    }

    try {
      const localized = await runStageIfCvPipeline(
        'localize_cv_extracted_profile',
        { memory: true },
        async () => localizeCvExtractedProfile(base.profile, docLang, uiLanguage)
      );
      return applyAiTimeoutSemantics({
        ...base,
        profile: localized.profile,
        cvExtractLocalization: localized.cvI18n,
        localizationStatus: localized.localizationStatus || 'complete',
      });
    } catch (err) {
      logger.error('CV extraction localization failed; using raw extracted profile', {
        ...(getCvPipeline() ? { requestId: getCvPipeline().requestId } : {}),
        ...normalizeExternalApiError(err),
        ...(err instanceof Error ? { stack: err.stack } : {}),
      });
      const flat = fallbackCvProfileWithoutLocalization(base.profile, uiLanguage);
      return applyAiTimeoutSemantics({
        ...base,
        profile: flat,
        cvExtractLocalization: null,
        localizationStatus: 'skipped',
      });
    }
  });
}

/**
 * @param {string} text parsed CV plain text
 * @param {{ uiLanguage?: CvUiLang, language?: CvUiLang, documentLanguage?: CvUiLang, skipLocalization?: boolean }} [options]
 *        `language` is accepted as legacy alias for `uiLanguage`.
 *        When `skipLocalization` is true, bilingual localization is omitted (caller runs `localizeCvExtractedProfile`).
 */
async function extractProfileDataFromDocumentText(text, options = {}) {
  const uiLanguage = options.uiLanguage ?? options.language ?? 'en';
  const skipLocalization = Boolean(options.skipLocalization);
  const fin = (extra) => ({ ...extra, skipLocalization });
  let docLangOpt = options.documentLanguage
    ? String(options.documentLanguage).toLowerCase().split('-')[0]
    : null;
  if (docLangOpt && docLangOpt !== 'en' && docLangOpt !== 'de') {
    docLangOpt = null;
  }

  const resolveCvLang = () => {
    if (docLangOpt === 'en' || docLangOpt === 'de') return docLangOpt;
    if (!text || !String(text).trim()) return 'en';
    return detectCvDocumentLanguage(text);
  };

  if (!text || !String(text).trim()) {
    const cvLang = resolveCvLang();
    const h = runSyncStageIfCvPipeline('profile_heuristic_extract', () =>
      extractProfileDataFromDocumentTextHeuristic(text)
    );
    return finalizeCvExtractionPayload(h, fin({
      cvLang,
      uiLang: uiLanguage,
      semantic: null,
      semanticAiTimedOut: false,
    }));
  }

  const cvLang = resolveCvLang();
  const heuristicResult = runSyncStageIfCvPipeline('profile_heuristic_extract', () =>
    extractProfileDataFromDocumentTextHeuristic(text)
  );
  let semanticAiTimedOut = false;
  try {
    const semantic = await interpretCvText(text, { documentLanguage: cvLang });
    if (semantic) {
      const mapped = mapSemanticExtractionToProfile(semantic);
      if (!profileHasAnyExtractable(mapped.profile)) {
        return finalizeCvExtractionPayload(heuristicResult, fin({
          cvLang,
          uiLang: uiLanguage,
          semantic: null,
          semanticAiTimedOut: false,
        }));
      }
      const mergedSeniority = mergeSeniorityFromHeuristic(mapped.profile, heuristicResult.profile);
      const withBaseline = mergeHeuristicStructuredBaseline(mapped.profile, heuristicResult.profile);
      const mergedProfile = {
        ...withBaseline,
        seniority: {
          currentStatus: mergedSeniority.currentStatus ?? '',
          yearsOfExperience: mergedSeniority.yearsOfExperience ?? null,
          highestDegree: mergedSeniority.highestDegree ?? '',
          mostSeniorWorkExperience: mergedSeniority.mostSeniorWorkExperience ?? ''
        }
      };
      let extractedFields = [...(mapped.extractedFields || [])];
      const semSen = mapped.profile.seniority || {};
      const merSen = mergedProfile.seniority || {};
      const emptyStr = (v) => {
        if (v === undefined || v === null || v === '') return true;
        if (typeof v === 'string') return !v.trim();
        return false;
      };
      const seniorityFilledFromHeuristic = (
        (emptyStr(semSen.currentStatus) && !emptyStr(merSen.currentStatus)) ||
        ((semSen.yearsOfExperience === null || semSen.yearsOfExperience === undefined) && merSen.yearsOfExperience !== null && merSen.yearsOfExperience !== undefined) ||
        (emptyStr(semSen.highestDegree) && !emptyStr(merSen.highestDegree)) ||
        (emptyStr(semSen.mostSeniorWorkExperience) && !emptyStr(merSen.mostSeniorWorkExperience))
      );
      if (seniorityFilledFromHeuristic && !extractedFields.includes('seniority')) {
        extractedFields.push('seniority');
      }
      const heuFields = heuristicResult.extractedFields || [];
      for (const f of heuFields) {
        if (!extractedFields.includes(f)) extractedFields.push(f);
      }
      return finalizeCvExtractionPayload(
        {
          profile: mergedProfile,
          status: mapped.status,
          message: mapped.message,
          messageKey: mapped.messageKey,
          extractedFields: [...new Set(extractedFields)],
        },
        fin({ cvLang, uiLang: uiLanguage, semantic, semanticAiTimedOut: false })
      );
    }
  } catch (error) {
    const norm = normalizeExternalApiError(error);
    logger.warn('Semantic CV interpretation failed; falling back to heuristics', {
      ...(getCvPipeline() ? { requestId: getCvPipeline().requestId } : {}),
      ...norm,
    });
    if (getCvPipeline()) {
      logCvEvent('interpret_cv_text_outer_failed', {
        ok: false,
        ...serializeErrorSafe(error),
      });
    }
    if (isTimeoutLikeError(error)) {
      semanticAiTimedOut = true;
    }
  }
  return finalizeCvExtractionPayload(heuristicResult, fin({
    cvLang,
    uiLang: uiLanguage,
    semantic: null,
    semanticAiTimedOut,
  }));
}

/**
 * Full CV pipeline for a file on disk: OCR → heuristic/semantic extraction → localization.
 * @param {string} filePath
 * @param {{ uiLanguage?: 'en'|'de', onStage?: (stage: 'ocr'|'extraction'|'localization', meta?: object) => Promise<void>|void }} [options]
 */
async function processCvExtractionFromFilePath(filePath, options = {}) {
  const uiLanguage = options.uiLanguage ?? 'en';
  const onStage = options.onStage;

  if (onStage) await onStage('ocr');
  let rawText = await parseDocumentToText(filePath);
  const ocrTextLength = rawText ? String(rawText).length : 0;

  if (onStage) await onStage('extraction', { ocrTextLength });
  let extraction = await extractProfileDataFromDocumentText(rawText, {
    uiLanguage,
    skipLocalization: true,
  });
  rawText = null;

  if (onStage) await onStage('localization', { extractionStatus: extraction?.status ?? null });
  const docLang = extraction.semanticInterpretationLanguage === 'de' ? 'de' : 'en';
  try {
    const localized = await localizeCvExtractedProfile(extraction.profile, docLang, uiLanguage);
    return {
      ...extraction,
      profile: localized.profile,
      cvExtractLocalization: localized.cvI18n,
      localizationStatus: localized.localizationStatus || 'complete',
    };
  } catch (locErr) {
    logger.error('cv_extraction_localization_failed', {
      ...normalizeExternalApiError(locErr),
      ...(locErr instanceof Error ? { errorName: locErr.name } : {}),
    });
    const flat = fallbackCvProfileWithoutLocalization(extraction.profile, uiLanguage);
    return {
      ...extraction,
      profile: flat,
      cvExtractLocalization: null,
      localizationStatus: 'skipped',
    };
  }
}

module.exports = {
  extractProfileDataFromDocumentText,
  extractProfileDataFromDocumentTextHeuristic,
  mapSemanticExtractionToProfile,
  processCvExtractionFromFilePath,
  __testables: {
    mapSemanticExtractionToProfile,
    profileHasAnyExtractable,
    mergeHeuristicStructuredBaseline,
    mergeSeniorityFromHeuristic,
  },
};
