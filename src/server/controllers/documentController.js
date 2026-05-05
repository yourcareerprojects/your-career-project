const fs = require('fs').promises;
const logger = require('../utils/logger');
const User = require('../models/User');
const { sanitizeCurrentEmploymentStatus } = require('../../constants/currentEmploymentStatus');
const { validationResult } = require('express-validator');
const { parseDocumentToText, extractFromTextHeuristics } = require('../services/documents/documentProfileEnrichment');
const { interpretCvText } = require('../services/documents/semanticCvInterpreter');
const { detectCvDocumentLanguage } = require('../services/documents/detectCvDocumentLanguage');
const { localizeCvExtractedProfile } = require('../services/documents/cvExtractLocalization');

// Helper function to validate file type (must stay aligned with routes/documents.js)
const isValidFileType = (file) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ];
  return allowedTypes.includes(file.mimetype);
};

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
    message: hasAny
      ? 'Interpreted profile signals from CV using semantic analysis.'
      : 'No profile signals could be interpreted from document.',
    messageKey: hasAny
      ? 'documentUpload.extraction.semanticInterpretationSuccess'
      : 'documentUpload.extraction.semanticInterpretationNone',
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
      message: 'No readable text could be extracted from this PDF (including OCR). Try exporting the CV again as a PDF with selectable text, or use DOCX.',
      messageKey: 'documentUpload.extraction.noPdfTextLayer',
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
async function finalizeCvExtractionPayload(payload, { cvLang, uiLang, semantic }) {
  const docLang = cvLang === 'de' ? 'de' : 'en';
  const uiLanguage = String(uiLang || 'en').toLowerCase().split('-')[0] || 'en';
  const base = {
    ...payload,
    semanticInterpretation: semantic ?? null,
    semanticInterpretationLanguage: docLang,
  };
  if (!profileHasAnyExtractable(base.profile)) {
    return { ...base, cvExtractLocalization: null };
  }
  const { profile, cvI18n } = await localizeCvExtractedProfile(base.profile, docLang, uiLanguage);
  return { ...base, profile, cvExtractLocalization: cvI18n };
}

/**
 * @param {string} text parsed CV plain text
 * @param {{ uiLanguage?: CvUiLang, language?: CvUiLang, documentLanguage?: CvUiLang }} [options]
 *        `language` is accepted as legacy alias for `uiLanguage`.
 */
async function extractProfileDataFromDocumentText(text, options = {}) {
  const uiLanguage = options.uiLanguage ?? options.language ?? 'en';
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
    const h = extractProfileDataFromDocumentTextHeuristic(text);
    return finalizeCvExtractionPayload(h, { cvLang, uiLang: uiLanguage, semantic: null });
  }

  const cvLang = resolveCvLang();
  const heuristicResult = extractProfileDataFromDocumentTextHeuristic(text);
  try {
    const semantic = await interpretCvText(text, { documentLanguage: cvLang });
    if (semantic) {
      const mapped = mapSemanticExtractionToProfile(semantic);
      if (!profileHasAnyExtractable(mapped.profile)) {
        return finalizeCvExtractionPayload(heuristicResult, { cvLang, uiLang: uiLanguage, semantic: null });
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
        { cvLang, uiLang: uiLanguage, semantic }
      );
    }
  } catch (error) {
    console.warn('Semantic CV interpretation failed, falling back to heuristics:', error.message);
  }
  return finalizeCvExtractionPayload(heuristicResult, { cvLang, uiLang: uiLanguage, semantic: null });
}

const documentController = {
  // Upload a new document
  async uploadDocument(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const { documentType, description } = req.body;
      const file = req.file;

      if (!isValidFileType(file)) {
        // Delete the uploaded file if it's not valid
        await fs.unlink(file.path);
        return res.status(400).json({ message: 'Invalid file type' });
      }

      const user = await User.findById(req.user.userId);
      if (!user) {
        await fs.unlink(file.path);
        return res.status(404).json({ message: 'User not found' });
      }

      const document = {
        type: documentType === 'resume' ? 'cv' : documentType, // map 'resume' to 'cv' for schema compatibility
        name: file.originalname,
        path: file.path,
        uploadDate: new Date(),
        isArchived: false,
        version: 1,
        description,
        status: 'pending' // pending, verified, rejected
      };

      // Add document to user's documents array
      user.profile.documents.push(document);
      await user.save();

      // If CV/resume, attempt to extract data (but DO NOT save to profile automatically)
      let extractionResult = null;
      if (documentType === 'resume' || documentType === 'cv') {
        try {
          const parsedText = await parseDocumentToText(file.path);
          extractionResult = await extractProfileDataFromDocumentText(parsedText, {
            uiLanguage: req.language,
          });
          
          // Log extraction result for monitoring
          if (extractionResult.status === 'failed') {
            console.warn(`PDF extraction failed for user ${req.user.userId}: ${extractionResult.message}`);
          } else {
            console.log(`PDF extraction ${extractionResult.status} for user ${req.user.userId}: ${extractionResult.extractedFields?.join(', ') || 'unknown fields'}`);
          }
        } catch (err) {
          logger.error('Document extraction pipeline failed', err);
          extractionResult = {
            profile: {
              personalInfo: {},
              seniority: {},
              structuredUserInfo: { workExperience: [], education: [], skills: [], skillsInDevelopment: [], certifications: [], keyResponsibilities: [] },
              userIdentity: {}
            },
            status: 'failed',
            message: 'Unable to extract data from document. The file may be corrupted or in an unsupported format. You can manually enter your information.',
            error: err.message
          };
        }
      }

      // Get the last inserted document (with _id)
      const savedDoc = user.profile.documents[user.profile.documents.length - 1];

      res.status(201).json({
        message: 'Document uploaded successfully',
        document: {
          id: savedDoc._id,
          type: savedDoc.type,
          name: savedDoc.name,
          path: savedDoc.path,
          uploadDate: savedDoc.uploadDate,
          isArchived: savedDoc.isArchived,
          version: savedDoc.version,
          description: savedDoc.description,
          status: savedDoc.status
        },
        // Send extraction result if available (includes status, message, and profile data)
        extractedProfileData: extractionResult ? extractionResult.profile : null,
        extractionStatus: extractionResult ? extractionResult.status : null,
        extractionMessage: extractionResult ? extractionResult.message : null,
        extractionMessageKey: extractionResult ? extractionResult.messageKey || null : null,
        cvExtractLocalization: extractionResult ? extractionResult.cvExtractLocalization ?? null : null,
        semanticInterpretation: extractionResult ? extractionResult.semanticInterpretation ?? null : null,
        semanticInterpretationLanguage: extractionResult ? extractionResult.semanticInterpretationLanguage ?? null : null
      });
    } catch (error) {
      logger.error('Document upload handler failed', error);
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          logger.error('Document upload rollback unlink failed', unlinkError);
        }
      }
      res.status(500).json({ message: 'Error uploading document' });
    }
  },

  // Get all documents for a user
  async getUserDocuments(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const documents = user.profile.documents.map(doc => ({
        id: doc._id,
        type: doc.type || doc.documentType,
        name: doc.name || doc.originalName,
        path: doc.path,
        uploadDate: doc.uploadDate,
        isArchived: doc.isArchived,
        version: doc.version,
        description: doc.description,
        status: doc.status
      }));

      res.json({ documents });
    } catch (error) {
      console.error('Get documents error:', error);
      res.status(500).json({ message: 'Error retrieving documents' });
    }
  },

  // Get a specific document
  async getDocument(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const document = user.profile.documents.id(req.params.documentId);
      if (!document) {
        return res.status(404).json({ message: 'Document not found' });
      }

      res.json({
        document: {
          id: document._id,
          type: document.type || document.documentType,
          name: document.name || document.originalName,
          path: document.path,
          uploadDate: document.uploadDate,
          isArchived: document.isArchived,
          version: document.version,
          description: document.description,
          status: document.status
        }
      });
    } catch (error) {
      console.error('Get document error:', error);
      res.status(500).json({ message: 'Error retrieving document' });
    }
  },

  // Download a document
  async downloadDocument(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const document = user.profile.documents.id(req.params.documentId);
      if (!document) {
        return res.status(404).json({ message: 'Document not found' });
      }

      // Check if file exists
      try {
        await fs.access(document.path);
      } catch (error) {
        return res.status(404).json({ message: 'Document file not found' });
      }

      res.download(document.path, document.name || document.originalName || 'document.pdf');
    } catch (error) {
      console.error('Download document error:', error);
      res.status(500).json({ message: 'Error downloading document' });
    }
  },

  // Delete a document
  async deleteDocument(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const docToDelete = user.profile.documents.id(req.params.documentId);
      if (!docToDelete) {
        return res.status(404).json({ message: 'Document not found' });
      }

      // Delete file from filesystem
      try {
        await fs.unlink(docToDelete.path);
      } catch (error) {
        console.error('Error deleting file:', error);
      }

      // Remove document from user's documents array
      user.profile.documents.pull(req.params.documentId);
      await user.save();

      res.json({ message: 'Document deleted successfully' });
    } catch (error) {
      console.error('Delete document error:', error);
      res.status(500).json({ message: 'Error deleting document' });
    }
  },

  // Update document status (for admin/verification purposes)
  async updateDocumentStatus(req, res) {
    try {
      const { status, verificationNotes } = req.body;
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const docToUpdate = user.profile.documents.id(req.params.documentId);
      if (!docToUpdate) {
        return res.status(404).json({ message: 'Document not found' });
      }

      docToUpdate.status = status;
      if (verificationNotes) {
        docToUpdate.verificationNotes = verificationNotes;
      }
      docToUpdate.verifiedAt = new Date();

      await user.save();

      res.json({
        message: 'Document status updated successfully',
        document: {
          id: docToUpdate._id,
          status: docToUpdate.status,
          verificationNotes: docToUpdate.verificationNotes,
          verifiedAt: docToUpdate.verifiedAt
        }
      });
    } catch (error) {
      console.error('Update document status error:', error);
      res.status(500).json({ message: 'Error updating document status' });
    }
  },

  // Rename (update description) of a document
  async renameDocument(req, res) {
    try {
      const { description } = req.body;
      if (!description || typeof description !== 'string' || description.trim().length < 1) {
        return res.status(400).json({ message: 'Description is required.' });
      }
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      const docToRename = user.profile.documents.id(req.params.documentId);
      if (!docToRename) {
        return res.status(404).json({ message: 'Document not found' });
      }
      docToRename.description = description.trim();
      await user.save();
      res.json({
        message: 'Document description updated successfully',
        document: {
          id: docToRename._id,
          description: docToRename.description
        }
      });
    } catch (error) {
      console.error('Rename document error:', error);
      res.status(500).json({ message: 'Error renaming document' });
    }
  }
};

documentController.__testables = {
  mapSemanticExtractionToProfile
};

module.exports = documentController; 