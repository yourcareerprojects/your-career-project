/**
 * Career Knowledge Enrichment
 *
 * Extends structured career context with factual labour-market knowledge.
 * Does NOT coach users, write motivation, or generate roadmaps.
 *
 * Flow: CareerContextBuilder → CareerKnowledgeEnrichment → Career Coach
 *
 * Caching: persisted on CareerPath.careerKnowledgeEnrichment[lang]
 * so enrichment runs once per profession + language.
 *
 * Providers are ordered by priority. Existing structured data is never overwritten.
 */

const CareerPath = require('../../../models/CareerPath');
const { callOpenAI } = require('../../ai/callOpenAI');
const {
  buildEnrichmentSystemPrompt,
  buildEnrichmentUserPrompt,
} = require('../../../prompts/careerKnowledgeEnrichmentPrompts');

const ENRICHMENT_SOURCE_VERSION = 'v1';

const ENRICHMENT_LIST_FIELDS = [
  'schoolSubjects',
  'recommendedExperience',
  'commonEmployers',
  'workingEnvironments',
  'furtherEducation',
  'studyOptions',
  'certifications',
  'careerProgression',
  'specializationOptions',
  'industryInsights',
  'softSkills',
  'firstCareerSteps',
  'alternativePathways',
];

const ENRICHMENT_STRING_FIELDS = [
  'applicationTimeline',
  'apprenticeshipDuration',
];

/** @type {Map<string, Promise<object>>} */
const inflightByKey = new Map();

/**
 * Extensible knowledge providers.
 * Future sources (official education DBs, salary APIs, regional data, …)
 * can be registered here without changing the Career Coach.
 *
 * Each provider returns a partial enrichment object.
 * Higher-priority providers run first; later providers only fill gaps.
 *
 * @typedef {{
 *   id: string,
 *   priority: number,
 *   enrich: (ctx: {
 *     careerContext: object,
 *     lang: string,
 *     llm: Function,
 *     missingFields: string[],
 *   }) => Promise<object|null>,
 * }} KnowledgeProvider
 */

/**
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
function normalizeText(value, max = 600) {
  return String(value || '').trim().slice(0, max);
}

/**
 * @param {unknown} items
 * @param {number} [max]
 * @returns {string[]}
 */
function normalizeStringList(items, max = 10) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => normalizeText(item, 240))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * @param {string} lang
 * @returns {'de'|'en'}
 */
function normalizeLang(lang) {
  return String(lang || 'de').toLowerCase().startsWith('en') ? 'en' : 'de';
}

/**
 * @param {object|null|undefined} payload
 * @returns {boolean}
 */
function hasUsefulEnrichment(payload) {
  if (!payload || typeof payload !== 'object') return false;
  for (const field of ENRICHMENT_STRING_FIELDS) {
    if (normalizeText(payload[field])) return true;
  }
  for (const field of ENRICHMENT_LIST_FIELDS) {
    if (normalizeStringList(payload[field], 1).length > 0) return true;
  }
  return false;
}

/**
 * @param {object|null|undefined} payload
 * @param {string} lang
 * @returns {boolean}
 */
function isCachedEnrichmentFresh(payload, lang) {
  if (!hasUsefulEnrichment(payload)) return false;
  if (payload.sourceVersion && payload.sourceVersion !== ENRICHMENT_SOURCE_VERSION) {
    return false;
  }
  if (payload.lang && normalizeLang(payload.lang) !== normalizeLang(lang)) {
    return false;
  }
  return true;
}

/**
 * Normalize LLM / provider enrichment into a stable shape.
 * @param {object} raw
 * @param {{ lang?: string, builtWith?: string, sources?: string[] }} [meta]
 * @returns {object}
 */
function normalizeEnrichmentPayload(raw = {}, meta = {}) {
  const lang = normalizeLang(meta.lang || raw.lang);
  const payload = {
    applicationTimeline: normalizeText(raw.applicationTimeline),
    apprenticeshipDuration: normalizeText(raw.apprenticeshipDuration),
    schoolSubjects: normalizeStringList(raw.schoolSubjects),
    recommendedExperience: normalizeStringList(raw.recommendedExperience),
    commonEmployers: normalizeStringList(raw.commonEmployers),
    workingEnvironments: normalizeStringList(raw.workingEnvironments),
    furtherEducation: normalizeStringList(raw.furtherEducation),
    studyOptions: normalizeStringList(raw.studyOptions),
    certifications: normalizeStringList(raw.certifications),
    careerProgression: normalizeStringList(raw.careerProgression),
    specializationOptions: normalizeStringList(raw.specializationOptions),
    industryInsights: normalizeStringList(raw.industryInsights),
    softSkills: normalizeStringList(raw.softSkills),
    firstCareerSteps: normalizeStringList(raw.firstCareerSteps),
    alternativePathways: normalizeStringList(raw.alternativePathways),
    extraction_confidence: Number.isFinite(Number(raw.extraction_confidence))
      ? Number(raw.extraction_confidence)
      : 0.6,
    built_at: raw.built_at ? new Date(raw.built_at) : new Date(),
    built_with: meta.builtWith || raw.built_with || 'llm',
    sourceVersion: ENRICHMENT_SOURCE_VERSION,
    lang,
    sources: normalizeStringList(meta.sources || raw.sources || ['llm_enrichment'], 8),
  };
  return payload;
}

/**
 * @param {string} text
 * @returns {object|null}
 */
function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const tryParse = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  let parsed = tryParse(raw);
  if (parsed) return parsed;
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) parsed = tryParse(match[0]);
  return parsed;
}

/**
 * @param {string} text
 * @param {{ lang?: string }} [options]
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
function parseEnrichmentResponse(text, options = {}) {
  const parsed = extractJsonObject(text);
  if (!parsed) return { ok: false, error: 'Response is not valid JSON' };
  const data = normalizeEnrichmentPayload(parsed, {
    lang: options.lang,
    builtWith: 'llm',
    sources: ['llm_enrichment'],
  });
  if (!hasUsefulEnrichment(data)) {
    return { ok: false, error: 'Enrichment JSON contained no useful factual fields' };
  }
  return { ok: true, data };
}

/**
 * Determine which enrichment fields are still missing from the base context.
 * @param {object} careerContext
 * @returns {string[]}
 */
function assessMissingFields(careerContext = {}) {
  const missing = [];
  const career = careerContext.career || {};
  const enrichment = careerContext.enrichment || {};

  const fieldPresent = (field) => {
    if (ENRICHMENT_STRING_FIELDS.includes(field)) {
      return Boolean(normalizeText(enrichment[field]));
    }
    return normalizeStringList(enrichment[field], 1).length > 0;
  };

  for (const field of [...ENRICHMENT_STRING_FIELDS, ...ENRICHMENT_LIST_FIELDS]) {
    if (!fieldPresent(field)) missing.push(field);
  }

  // Helpful signals for the model even when lists are empty elsewhere
  if (!career.workEnvironment?.length && !fieldPresent('workingEnvironments')) {
    if (!missing.includes('workingEnvironments')) missing.push('workingEnvironments');
  }
  if (!careerContext.careerProgression?.length && !fieldPresent('careerProgression')) {
    if (!missing.includes('careerProgression')) missing.push('careerProgression');
  }
  if (!careerContext.alternativePaths?.length && !fieldPresent('alternativePathways')) {
    if (!missing.includes('alternativePathways')) missing.push('alternativePathways');
  }

  return missing;
}

/**
 * Merge enrichment into career context without overwriting existing structured data.
 * @param {object} careerContext
 * @param {object|null} enrichment
 * @returns {object}
 */
function mergeEnrichmentIntoContext(careerContext, enrichment) {
  if (!careerContext || typeof careerContext !== 'object') return careerContext;
  if (!hasUsefulEnrichment(enrichment)) {
    return {
      ...careerContext,
      enrichment: careerContext.enrichment || null,
    };
  }

  const base = careerContext;
  const career = { ...(base.career || {}) };
  const sources = [...(base.meta?.sources || [])];
  if (!sources.includes('llm_enrichment') && !sources.includes('career_knowledge_enrichment')) {
    sources.push('career_knowledge_enrichment');
  }

  const workEnvironment = career.workEnvironment?.length
    ? career.workEnvironment
    : normalizeStringList(enrichment.workingEnvironments, 10);

  const careerProgression = base.careerProgression?.length
    ? base.careerProgression
    : normalizeStringList(enrichment.careerProgression, 8);

  const alternativePaths = base.alternativePaths?.length
    ? base.alternativePaths
    : normalizeStringList(enrichment.alternativePathways, 4);

  return {
    ...base,
    career: {
      ...career,
      workEnvironment,
    },
    educationRoutes: Array.isArray(base.educationRoutes) ? base.educationRoutes : [],
    careerProgression,
    alternativePaths,
    enrichment: {
      applicationTimeline: normalizeText(enrichment.applicationTimeline),
      apprenticeshipDuration: normalizeText(enrichment.apprenticeshipDuration),
      schoolSubjects: normalizeStringList(enrichment.schoolSubjects),
      recommendedExperience: normalizeStringList(enrichment.recommendedExperience),
      commonEmployers: normalizeStringList(enrichment.commonEmployers),
      workingEnvironments: normalizeStringList(enrichment.workingEnvironments),
      furtherEducation: normalizeStringList(enrichment.furtherEducation),
      studyOptions: normalizeStringList(enrichment.studyOptions),
      certifications: normalizeStringList(enrichment.certifications),
      careerProgression: normalizeStringList(enrichment.careerProgression),
      specializationOptions: normalizeStringList(enrichment.specializationOptions),
      industryInsights: normalizeStringList(enrichment.industryInsights),
      softSkills: normalizeStringList(enrichment.softSkills),
      firstCareerSteps: normalizeStringList(enrichment.firstCareerSteps),
      alternativePathways: normalizeStringList(enrichment.alternativePathways),
      sourceVersion: enrichment.sourceVersion || ENRICHMENT_SOURCE_VERSION,
      built_with: enrichment.built_with || 'llm',
      lang: enrichment.lang,
    },
    meta: {
      ...(base.meta || {}),
      sources,
      enrichmentCached: Boolean(enrichment.fromCache),
      enrichmentBuiltWith: enrichment.built_with || 'llm',
    },
  };
}

/**
 * Fill only empty fields on `target` from `source`.
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
function fillMissingEnrichmentFields(target, source) {
  const out = { ...(target || {}) };
  for (const field of ENRICHMENT_STRING_FIELDS) {
    if (!normalizeText(out[field]) && normalizeText(source?.[field])) {
      out[field] = normalizeText(source[field]);
    }
  }
  for (const field of ENRICHMENT_LIST_FIELDS) {
    if (!normalizeStringList(out[field], 1).length && normalizeStringList(source?.[field], 1).length) {
      out[field] = normalizeStringList(source[field]);
    }
  }
  return out;
}

/**
 * Read cached enrichment from a CareerPath-shaped document.
 * @param {object|null} doc
 * @param {string} lang
 * @returns {object|null}
 */
function readCachedEnrichmentFromDoc(doc, lang) {
  const normalizedLang = normalizeLang(lang);
  const payload = doc?.careerKnowledgeEnrichment?.[normalizedLang] || null;
  if (!isCachedEnrichmentFresh(payload, normalizedLang)) return null;
  return normalizeEnrichmentPayload(payload, {
    lang: normalizedLang,
    builtWith: payload.built_with || 'llm',
    sources: payload.sources || ['llm_enrichment'],
  });
}

/**
 * Persist enrichment onto CareerPath for reuse by all future users.
 * @param {string|null} careerPathId
 * @param {string} lang
 * @param {object} enrichment
 * @returns {Promise<object|null>}
 */
async function persistEnrichmentToCareerPath(careerPathId, lang, enrichment) {
  if (!careerPathId) return null;
  const normalizedLang = normalizeLang(lang);
  const payload = normalizeEnrichmentPayload(enrichment, {
    lang: normalizedLang,
    builtWith: enrichment.built_with || 'llm',
    sources: enrichment.sources || ['llm_enrichment'],
  });

  const updated = await CareerPath.findByIdAndUpdate(
    String(careerPathId),
    {
      $set: {
        [`careerKnowledgeEnrichment.${normalizedLang}`]: payload,
        lastUpdated: new Date(),
      },
    },
    { new: true }
  ).lean();

  return updated;
}

/**
 * LLM labour-market enrichment provider.
 * @type {KnowledgeProvider}
 */
const llmKnowledgeProvider = {
  id: 'llm_labour_market',
  priority: 100,
  async enrich({ careerContext, lang, llm, missingFields }) {
    if (!missingFields.length) return null;

    const system = buildEnrichmentSystemPrompt({ lang, careerContext, missingFields });
    const user = buildEnrichmentUserPrompt({ lang });

    let lastError = 'Unknown enrichment parse error';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { text } = await llm({
        model: process.env.OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const parsed = parseEnrichmentResponse(text, { lang });
      if (parsed.ok) return parsed.data;
      lastError = parsed.error;
    }
    throw new Error(`Career knowledge enrichment failed: ${lastError}`);
  },
};

/** @type {KnowledgeProvider[]} */
const DEFAULT_PROVIDERS = [llmKnowledgeProvider];

/**
 * Run providers in priority order; each only fills missing fields.
 * @param {{
 *   careerContext: object,
 *   lang: string,
 *   llm: Function,
 *   providers?: KnowledgeProvider[],
 * }} params
 * @returns {Promise<object|null>}
 */
async function collectEnrichmentFromProviders({
  careerContext,
  lang,
  llm,
  providers = DEFAULT_PROVIDERS,
}) {
  const ordered = [...providers].sort((a, b) => a.priority - b.priority);
  let combined = null;
  let remaining = assessMissingFields(careerContext);

  for (const provider of ordered) {
    if (!remaining.length) break;
    const partial = await provider.enrich({
      careerContext,
      lang,
      llm,
      missingFields: remaining,
    });
    if (!hasUsefulEnrichment(partial)) continue;

    combined = combined
      ? fillMissingEnrichmentFields(combined, partial)
      : normalizeEnrichmentPayload(partial, {
        lang,
        builtWith: partial.built_with || provider.id,
        sources: [provider.id],
      });

    // Recompute remaining against merged enrichment attached to a temp context
    const tempContext = mergeEnrichmentIntoContext(careerContext, combined);
    remaining = assessMissingFields(tempContext);
  }

  return combined;
}

/**
 * Enrich a career context with factual labour-market knowledge.
 * Uses CareerPath cache when available; otherwise generates once and persists.
 *
 * @param {{
 *   careerContext: object,
 *   lang?: string,
 *   llm?: Function,
 *   providers?: KnowledgeProvider[],
 *   readCache?: (careerPathId: string|null, lang: string) => Promise<object|null>,
 *   writeCache?: (careerPathId: string|null, lang: string, enrichment: object) => Promise<unknown>,
 *   skipLlm?: boolean,
 * }} input
 * @returns {Promise<object>} complete career context for the coach
 */
async function enrichCareerContext(input = {}) {
  const careerContext = input.careerContext;
  if (!careerContext || typeof careerContext !== 'object') {
    throw new Error('careerContext is required');
  }

  const lang = normalizeLang(input.lang || careerContext.meta?.lang || 'de');
  const llm = typeof input.llm === 'function' ? input.llm : callOpenAI;
  const careerPathId = careerContext.meta?.careerPathId || null;
  const cacheKey = `${careerPathId || careerContext.career?.esco || careerContext.career?.title || 'unknown'}:${lang}:${ENRICHMENT_SOURCE_VERSION}`;

  const readCache = typeof input.readCache === 'function'
    ? input.readCache
    : async (id, cacheLang) => {
      if (!id) return null;
      const doc = await CareerPath.findById(String(id))
        .select('careerKnowledgeEnrichment')
        .lean();
      const cached = readCachedEnrichmentFromDoc(doc, cacheLang);
      return cached ? { ...cached, fromCache: true } : null;
    };

  const writeCache = typeof input.writeCache === 'function'
    ? input.writeCache
    : persistEnrichmentToCareerPath;

  // Prefer enrichment already attached by the context builder (loaded from doc)
  if (hasUsefulEnrichment(careerContext.enrichment)) {
    return mergeEnrichmentIntoContext(careerContext, {
      ...careerContext.enrichment,
      fromCache: true,
    });
  }

  const cached = await readCache(careerPathId, lang);
  if (hasUsefulEnrichment(cached)) {
    return mergeEnrichmentIntoContext(careerContext, { ...cached, fromCache: true });
  }

  if (input.skipLlm) {
    return mergeEnrichmentIntoContext(careerContext, null);
  }

  if (inflightByKey.has(cacheKey)) {
    const enrichment = await inflightByKey.get(cacheKey);
    return mergeEnrichmentIntoContext(careerContext, enrichment);
  }

  const pending = (async () => {
    try {
      let enrichment = null;
      try {
        enrichment = await collectEnrichmentFromProviders({
          careerContext,
          lang,
          llm,
          providers: input.providers || DEFAULT_PROVIDERS,
        });
      } catch (err) {
        console.warn('[careerKnowledgeEnrichment] provider enrichment failed:', err?.message || err);
        return null;
      }

      if (hasUsefulEnrichment(enrichment) && careerPathId) {
        try {
          await writeCache(careerPathId, lang, enrichment);
        } catch (err) {
          // Cache write failures must not block coaching.
          console.warn('[careerKnowledgeEnrichment] cache write failed:', err?.message || err);
        }
      }

      return enrichment;
    } finally {
      inflightByKey.delete(cacheKey);
    }
  })();

  inflightByKey.set(cacheKey, pending);
  const enrichment = await pending;
  return mergeEnrichmentIntoContext(careerContext, enrichment);
}

/**
 * Register an additional knowledge provider (for future data sources).
 * @param {KnowledgeProvider} provider
 */
function registerKnowledgeProvider(provider) {
  if (!provider || typeof provider.enrich !== 'function' || !provider.id) {
    throw new Error('Invalid knowledge provider');
  }
  DEFAULT_PROVIDERS.push(provider);
  DEFAULT_PROVIDERS.sort((a, b) => a.priority - b.priority);
}

module.exports = {
  ENRICHMENT_SOURCE_VERSION,
  ENRICHMENT_LIST_FIELDS,
  ENRICHMENT_STRING_FIELDS,
  assessMissingFields,
  parseEnrichmentResponse,
  normalizeEnrichmentPayload,
  mergeEnrichmentIntoContext,
  fillMissingEnrichmentFields,
  readCachedEnrichmentFromDoc,
  isCachedEnrichmentFresh,
  persistEnrichmentToCareerPath,
  collectEnrichmentFromProviders,
  enrichCareerContext,
  registerKnowledgeProvider,
  llmKnowledgeProvider,
  // test helpers
  _inflightByKey: inflightByKey,
};
