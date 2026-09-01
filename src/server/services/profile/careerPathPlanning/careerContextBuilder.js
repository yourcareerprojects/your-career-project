/**
 * CareerContextBuilder — collects structured career facts for the AI career coach.
 * Prefers existing application / ESCO data. Does not invent education pathways.
 */

const mongoose = require('mongoose');
const CareerPath = require('../../../models/CareerPath');
const { applyLocalizedFieldsToCareerPathPayload } = require('../../../utils/localizedResponse');
const { getOccupationSkillEntries, canonicalEscoUri } = require('../../escoSkillLookupService');
const { isApprenticeshipRole } = require('../../seniorityService');

const MAX_SKILLS = 16;
const MAX_TASKS = 10;
const MAX_DOMAINS = 10;
const MAX_DESCRIPTION = 1500;

/**
 * @param {unknown} items
 * @param {number} [max]
 * @returns {string[]}
 */
function normalizeStringList(items, max = 12) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        return String(item.title || item.name || item.domain || '').trim();
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, max);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asText(value, max = MAX_DESCRIPTION) {
  return String(value || '').trim().slice(0, max);
}

/**
 * @param {object} role
 * @returns {Promise<object|null>}
 */
async function lookupCareerPathDoc(role = {}) {
  const careerPathId = role.careerPathId || role._id || null;
  const escoId = role.escoId ? String(role.escoId).trim() : '';
  const title = asText(role.title || role.name, 200);

  let doc = null;

  if (careerPathId && mongoose.isValidObjectId(String(careerPathId))) {
    doc = await CareerPath.findById(String(careerPathId)).lean();
  }

  if (!doc && escoId) {
    const canonical = canonicalEscoUri(escoId) || escoId;
    doc = await CareerPath.findOne({ escoId: canonical }).lean();
    if (!doc && canonical !== escoId) {
      doc = await CareerPath.findOne({ escoId }).lean();
    }
    if (!doc) {
      doc = await CareerPath.findOne({ mergedFromEscoIds: canonical }).lean()
        || await CareerPath.findOne({ mergedFromEscoIds: escoId }).lean();
    }
  }

  if (!doc && title) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titleRx = new RegExp(`^${escaped}$`, 'i');
    doc = await CareerPath.findOne({
      $or: [
        { 'title.en': titleRx },
        { 'title.de': titleRx },
      ],
    }).lean();
  }

  return doc;
}

/**
 * @param {object|null} doc
 * @param {object} role
 * @param {'de'|'en'} lang
 * @returns {Promise<string[]>}
 */
async function resolveRequiredSkills(doc, role, lang) {
  const fromRole = normalizeStringList(role.requiredSkills, MAX_SKILLS);
  if (fromRole.length) return fromRole;

  if (doc) {
    const fromDoc = normalizeStringList(doc.requiredSkills, MAX_SKILLS);
    if (fromDoc.length) return fromDoc;

    const core = normalizeStringList(doc.skillModel?.core_skills, MAX_SKILLS)
      .filter((s) => !/^https?:\/\//i.test(s) && !s.includes('esco/skill'));
    if (core.length) return core;
  }

  const escoId = doc?.escoId || role.escoId;
  if (!escoId) return [];

  try {
    const { essential } = await getOccupationSkillEntries(escoId);
    return normalizeStringList(
      essential.map((entry) => entry.title).filter(Boolean),
      MAX_SKILLS
    );
  } catch {
    return [];
  }
}

/**
 * @param {object|null} localizedDoc
 * @param {object} role
 * @param {'de'|'en'} lang
 * @returns {string[]}
 */
function resolveTypicalTasks(localizedDoc, role, lang) {
  const fromRole = normalizeStringList(role.keyResponsibilities, MAX_TASKS);
  if (fromRole.length) return fromRole;

  const responsibilities = localizedDoc?.keyResponsibilities?.responsibilities;
  return normalizeStringList(responsibilities, MAX_TASKS);
}

/**
 * @param {object|null} localizedDoc
 * @param {object} role
 * @returns {string[]}
 */
function resolveWorkEnvironment(localizedDoc, role) {
  const domains = localizedDoc?.skillDomains?.skill_domains
    || role.skillDomains?.skill_domains
    || [];
  return normalizeStringList(
    domains.map((d) => {
      if (!d) return '';
      if (typeof d.domain === 'string') return d.domain;
      if (d.domain && typeof d.domain === 'object') {
        return String(d.domain.en || d.domain.de || '').trim();
      }
      return String(d.domain || d || '').trim();
    }),
    MAX_DOMAINS
  );
}

/**
 * Derive education-route *hints* only from known facts (no invented pathways).
 * @param {object|null} doc
 * @returns {object[]}
 */
function buildEducationRouteHints(doc) {
  if (!doc) return [];

  const routes = [];
  const escoId = doc.escoId || '';
  const apprenticeship = isApprenticeshipRole({
    escoId,
    sourceVersion: doc.sourceVersion,
  });

  if (apprenticeship) {
    routes.push({
      type: 'dual apprenticeship',
      source: 'application',
      notes: 'Occupation is tagged as a German apprenticeship (Ausbildung) track in application data.',
    });
  }

  const isco = String(doc.iscoGroup || '').trim();
  if (isco) {
    const major = parseInt(isco.charAt(0), 10);
    let typicalQualification = null;
    if (major === 2) typicalQualification = 'Often associated with professional / higher-education pathways (ISCO major group 2).';
    else if (major === 3) typicalQualification = 'Often associated with technician / associate professional pathways (ISCO major group 3).';
    else if (major === 7) typicalQualification = 'Often associated with craft / trade pathways (ISCO major group 7).';
    else if (major === 5) typicalQualification = 'Often associated with service and sales occupations (ISCO major group 5).';

    if (typicalQualification) {
      routes.push({
        type: 'isco_signal',
        source: 'esco',
        iscoGroup: isco,
        notes: typicalQualification,
      });
    }
  }

  return routes;
}

/**
 * @param {{
 *   role?: object,
 *   lang?: string,
 *   lookupDoc?: (role: object) => Promise<object|null>,
 * }} input
 * @returns {Promise<object>}
 */
async function buildCareerContext(input = {}) {
  const lang = String(input.lang || 'de').toLowerCase().startsWith('en') ? 'en' : 'de';
  const role = input.role && typeof input.role === 'object' ? input.role : {};
  const lookup = typeof input.lookupDoc === 'function' ? input.lookupDoc : lookupCareerPathDoc;

  const doc = await lookup(role);
  const localizedDoc = doc
    ? applyLocalizedFieldsToCareerPathPayload(doc, lang, { includeSkillDomains: true })
    : null;

  const title = asText(
    localizedDoc?.title || role.title || role.name,
    200
  ) || (lang === 'de' ? 'Unbekannter Beruf' : 'Unknown career');

  const description = asText(localizedDoc?.description || role.description);
  const requiredSkills = await resolveRequiredSkills(doc, role, lang);
  const typicalTasks = resolveTypicalTasks(localizedDoc, role, lang);
  const workEnvironment = resolveWorkEnvironment(localizedDoc, role);
  const educationRoutes = buildEducationRouteHints(doc);

  const seniority = localizedDoc?.seniority || role.seniority || null;
  const educationLevel = seniority?.seniority_label
    || (seniority?.seniority_level != null ? String(seniority.seniority_level) : '')
    || '';

  const careerProgression = normalizeStringList(
    role.progressionNotes || localizedDoc?.progressionNotes,
    8
  );

  const alternativePaths = normalizeStringList(role.alternativePaths, 4);

  const sources = [];
  if (doc) sources.push('application');
  if (doc?.source === 'ESCO' || doc?.escoId) sources.push('esco');
  if (!doc && (role.description || requiredSkills.length)) sources.push('simulation_role');

  // Surface already-cached enrichment without calling the LLM here.
  // CareerKnowledgeEnrichment may still run later if cache is empty/stale.
  const cachedEnrichment = doc?.careerKnowledgeEnrichment?.[lang] || null;
  const enrichment = cachedEnrichment && typeof cachedEnrichment === 'object'
    ? {
      applicationTimeline: asText(cachedEnrichment.applicationTimeline, 600),
      apprenticeshipDuration: asText(cachedEnrichment.apprenticeshipDuration, 200),
      schoolSubjects: normalizeStringList(cachedEnrichment.schoolSubjects, 10),
      recommendedExperience: normalizeStringList(cachedEnrichment.recommendedExperience, 10),
      commonEmployers: normalizeStringList(cachedEnrichment.commonEmployers, 10),
      workingEnvironments: normalizeStringList(cachedEnrichment.workingEnvironments, 10),
      furtherEducation: normalizeStringList(cachedEnrichment.furtherEducation, 10),
      studyOptions: normalizeStringList(cachedEnrichment.studyOptions, 10),
      certifications: normalizeStringList(cachedEnrichment.certifications, 10),
      careerProgression: normalizeStringList(cachedEnrichment.careerProgression, 10),
      specializationOptions: normalizeStringList(cachedEnrichment.specializationOptions, 10),
      industryInsights: normalizeStringList(cachedEnrichment.industryInsights, 10),
      softSkills: normalizeStringList(cachedEnrichment.softSkills, 10),
      firstCareerSteps: normalizeStringList(cachedEnrichment.firstCareerSteps, 10),
      alternativePathways: normalizeStringList(cachedEnrichment.alternativePathways, 10),
      sourceVersion: cachedEnrichment.sourceVersion || null,
      built_with: cachedEnrichment.built_with || null,
      lang: cachedEnrichment.lang || lang,
    }
    : null;

  if (enrichment) sources.push('career_knowledge_enrichment');

  const workEnvironmentFromCache = !workEnvironment.length && enrichment?.workingEnvironments?.length
    ? enrichment.workingEnvironments
    : workEnvironment;

  const progressionFromCache = !careerProgression.length && enrichment?.careerProgression?.length
    ? enrichment.careerProgression
    : careerProgression;

  const alternativesFromCache = !alternativePaths.length && enrichment?.alternativePathways?.length
    ? enrichment.alternativePathways
    : alternativePaths;

  return {
    career: {
      title,
      description,
      typicalTasks,
      requiredSkills,
      workEnvironment: workEnvironmentFromCache,
      salary: {},
      educationLevel,
      isco: asText(doc?.iscoGroup || role.iscoGroup, 32),
      esco: asText(doc?.escoId || role.escoId, 200),
      onet: asText(role.onet || role.onetCode, 64),
      matchScore: role.matchScore ?? role.score ?? null,
      seniority: seniority
        ? {
          level: seniority.seniority_level ?? null,
          label: seniority.seniority_label || '',
        }
        : null,
      altTitles: normalizeStringList(localizedDoc?.altTitles || role.altTitles, 8),
    },
    educationRoutes,
    careerProgression: progressionFromCache,
    alternativePaths: alternativesFromCache,
    enrichment,
    meta: {
      lang,
      sources,
      foundInDatabase: Boolean(doc),
      careerPathId: doc?._id ? String(doc._id) : (role.careerPathId ? String(role.careerPathId) : null),
      enrichmentCached: Boolean(enrichment),
    },
  };
}

/**
 * Format structured context for LLM prompts.
 * @param {object} context
 * @param {'de'|'en'} [lang]
 * @returns {string}
 */
function formatCareerContextForPrompt(context, lang = 'de') {
  const isDe = lang === 'de';
  const career = context?.career || {};
  const lines = [];

  lines.push(isDe ? '=== Strukturierte Berufsinformationen ===' : '=== Structured career information ===');
  lines.push(`${isDe ? 'Beruf' : 'Career'}: ${career.title || ''}`);

  if (career.description) {
    lines.push(`${isDe ? 'Beschreibung' : 'Description'}: ${career.description}`);
  }
  if (career.typicalTasks?.length) {
    lines.push(`${isDe ? 'Typische Aufgaben' : 'Typical tasks'}: ${career.typicalTasks.join('; ')}`);
  }
  if (career.requiredSkills?.length) {
    lines.push(`${isDe ? 'Wichtige Skills' : 'Required skills'}: ${career.requiredSkills.join(', ')}`);
  }
  if (career.workEnvironment?.length) {
    lines.push(`${isDe ? 'Kompetenzfelder / Arbeitsumfeld' : 'Skill domains / work focus'}: ${career.workEnvironment.join(', ')}`);
  }
  if (career.educationLevel) {
    lines.push(`${isDe ? 'Senioritäts-/Einstiegsniveau' : 'Seniority / entry level'}: ${career.educationLevel}`);
  }
  if (career.isco) lines.push(`ISCO: ${career.isco}`);
  if (career.esco) lines.push(`ESCO: ${career.esco}`);
  if (career.onet) lines.push(`O*NET: ${career.onet}`);
  if (career.altTitles?.length) {
    lines.push(`${isDe ? 'Weitere Bezeichnungen' : 'Also known as'}: ${career.altTitles.join(', ')}`);
  }
  if (career.matchScore != null && Number.isFinite(Number(career.matchScore))) {
    lines.push(isDe
      ? `Passungs-Score: ${Math.round(Number(career.matchScore))}%`
      : `Fit score: ${Math.round(Number(career.matchScore))}%`);
  }

  const routes = Array.isArray(context?.educationRoutes) ? context.educationRoutes : [];
  if (routes.length) {
    lines.push(isDe ? 'Bildungsweg-Hinweise (nur aus App-Daten):' : 'Education pathway hints (from app data only):');
    for (const route of routes) {
      const bits = [route.type, route.notes].filter(Boolean);
      lines.push(`- ${bits.join(' — ')}`);
    }
  } else {
    lines.push(isDe
      ? 'Bildungsweg-Katalog: keine strukturierten Routen in den App-Daten hinterlegt.'
      : 'Education pathway catalog: no structured routes stored in application data.');
  }

  if (context?.careerProgression?.length) {
    lines.push(isDe
      ? `Karrierefortschritt: ${context.careerProgression.join('; ')}`
      : `Career progression: ${context.careerProgression.join('; ')}`);
  }

  if (context?.alternativePaths?.length) {
    const numbered = context.alternativePaths
      .map((path, idx) => `${idx + 1}. ${path}`)
      .join('\n');
    lines.push(isDe
      ? `Alternative Wege (je einer als eigene Alternative ausarbeiten, nicht zusammenfassen):\n${numbered}`
      : `Alternative paths (develop each as its own alternative — do not merge):\n${numbered}`);
  }

  const enrichment = context?.enrichment && typeof context.enrichment === 'object'
    ? context.enrichment
    : null;

  if (enrichment) {
    lines.push(isDe ? '=== Angereichertes Berufswissen ===' : '=== Enriched career knowledge ===');
    if (enrichment.applicationTimeline) {
      lines.push(`${isDe ? 'Bewerbungs-/Einstiegszeitraum' : 'Application timeline'}: ${enrichment.applicationTimeline}`);
    }
    if (enrichment.apprenticeshipDuration) {
      lines.push(`${isDe ? 'Typische Ausbildungsdauer' : 'Typical apprenticeship duration'}: ${enrichment.apprenticeshipDuration}`);
    }
    const enrichmentLists = [
      [enrichment.schoolSubjects, isDe ? 'Nützliche Schulfächer' : 'Useful school subjects'],
      [enrichment.recommendedExperience, isDe ? 'Sinnvolle Praxiserfahrung' : 'Recommended practical experience'],
      [enrichment.commonEmployers, isDe ? 'Typische Arbeitgeber' : 'Common employers'],
      [enrichment.workingEnvironments, isDe ? 'Arbeitsumfelder' : 'Working environments'],
      [enrichment.furtherEducation, isDe ? 'Weiterbildung' : 'Further education'],
      [enrichment.studyOptions, isDe ? 'Studien-/Brückenoptionen' : 'Study / bridge options'],
      [enrichment.certifications, isDe ? 'Zertifikate' : 'Certifications'],
      [enrichment.specializationOptions, isDe ? 'Spezialisierungen' : 'Specialization options'],
      [enrichment.industryInsights, isDe ? 'Branchenhinweise' : 'Industry insights'],
      [enrichment.softSkills, isDe ? 'Wichtige Soft Skills' : 'Important soft skills'],
      [enrichment.firstCareerSteps, isDe ? 'Häufige erste Schritte' : 'Common first career steps'],
      [enrichment.alternativePathways, isDe ? 'Alternative Einstiege' : 'Alternative pathways'],
    ];
    for (const [items, label] of enrichmentLists) {
      if (Array.isArray(items) && items.length) {
        lines.push(`${label}: ${items.join('; ')}`);
      }
    }
  }

  const sources = context?.meta?.sources || [];
  if (sources.length) {
    lines.push(isDe
      ? `Datenquellen: ${sources.join(', ')}`
      : `Data sources: ${sources.join(', ')}`);
  }

  return lines.join('\n');
}

module.exports = {
  buildCareerContext,
  formatCareerContextForPrompt,
  lookupCareerPathDoc,
  normalizeStringList,
};
