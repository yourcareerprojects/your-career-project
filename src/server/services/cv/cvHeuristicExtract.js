/**
 * Heuristic CV extraction from plain text (regex + shared document heuristics).
 */

const logger = require('../../utils/logger');
const {
  extractFromTextHeuristics,
  extractEducationInstitutionsFromText,
  extractWorkExperienceDescriptionLinesFromText,
} = require('../documents/documentProfileEnrichment');
const { inferCurrentEmploymentStatusFromText } = require('../../../constants/currentEmploymentStatus');
const { inferIndustriesFromText } = require('../../../constants/industries');
const { normalizeGermanCvResponsibilityList } = require('../../../constants/normalizeGermanCvResponsibilities');
const { detectCvDocumentLanguage } = require('../documents/detectCvDocumentLanguage');
const {
  normalizeString,
  safeDegreeFromText,
  inferMostSeniorFromJobTitles,
} = require('./cvExtractionTextUtils');

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
  return inferIndustriesFromText(text, { maxItems: 6 });
}

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
      /Name\s*[:-]\s*([A-Za-z\s]+)/i,
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
      /(\+?\d{1,3}[\s-]?\(?\d{1,4}\)?[\s-]?\d{1,4}[\s-]?\d{1,9})/,
      /(\+?\d[\d\s()-]{7,}\d)/
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
    if (
      profile.structuredUserInfo.skillDomains.length === 0
      && profile.structuredUserInfo.skills.length > 0
      && profile.structuredUserInfo.skills.length <= 12
    ) {
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

    // Education fallback (shared section parser; CV profile adds degree/field slots)
    if (profile.structuredUserInfo.education.length === 0) {
      const institutions = extractEducationInstitutionsFromText(text, {
        maxEntries: 5,
        maxSectionLen: 500,
      });
      if (institutions.length > 0) {
        profile.structuredUserInfo.education = institutions.map((edu) => ({
          institution: normalizeString(edu.institution, 160),
          degree: '',
          field: '',
        }));
        extractedFields.push('education');
      }
    }

    // Work experience fallback: description lines when title/company patterns miss
    if (profile.structuredUserInfo.workExperience.length === 0) {
      const fallbackExp = extractWorkExperienceDescriptionLinesFromText(text, {
        maxLines: 4,
        maxSectionLen: 1000,
      });
      if (fallbackExp.length > 0) {
        profile.structuredUserInfo.workExperience = fallbackExp.map((exp) => ({
          title: '',
          company: '',
          description: normalizeString(exp, 800),
        }));
        extractedFields.push('workExperience');
      }
    }

    // Responsibilities summary for simulation-oriented field
    const keyResponsibilities = profile.structuredUserInfo.workExperience
      .map((exp) => normalizeString(exp.description, 300))
      .filter(Boolean)
      .slice(0, 8);
    profile.structuredUserInfo.keyResponsibilities = detectCvDocumentLanguage(text) === 'de'
      ? normalizeGermanCvResponsibilityList(keyResponsibilities, { force: true })
      : keyResponsibilities;
    if (keyResponsibilities.length) {
      extractedFields.push('keyResponsibilities');
    }

    const inferredDomains = inferDomainsFromText(text);
    profile.structuredUserInfo.domains = inferredDomains;
    if (inferredDomains.length > 0) {
      extractedFields.push('domains');
    }

    // Seniority inference
    const workExp = profile.structuredUserInfo.workExperience;
    const hasWork = workExp.length > 0;
    const topExperience = workExp[0] || {};
    profile.seniority.currentStatus = inferCurrentEmploymentStatusFromText(text, { hasWorkExperience: hasWork });
    profile.seniority.yearsOfExperience = inferYearsOfExperienceFromText(text, workExp.length);
    profile.seniority.highestDegree = safeDegreeFromText(text);
    profile.seniority.mostSeniorWorkExperience = inferMostSeniorFromJobTitles(
      workExp.map((job) => job.title).filter(Boolean)
    );
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

module.exports = {
  extractProfileDataFromDocumentTextHeuristic,
};
