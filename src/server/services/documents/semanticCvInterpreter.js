const crypto = require('crypto');
const { LRUCache } = require('lru-cache');
const { buildMessages: buildIdentityMessages } = require('../../prompts/interpretCvIdentity');
const { buildMessages: buildStructuredMessages } = require('../../prompts/interpretCvStructured');
const { openaiProvider } = require('../jobAnalysis/roleIdentityComposer');
const { redactCvContactPii } = require('../cv/redactCvContactPii');
const { runStageIfCvPipeline, logCvEvent, getCvPipeline } = require('../../utils/metricsLogger');

const CACHE_TTL_MS = 15 * 60 * 1000;
const SEMANTIC_CV_CACHE_MIN_ENTRIES = 500;
const SEMANTIC_CV_CACHE_MAX_ENTRIES = 2000;
const SEMANTIC_CV_CACHE_DEFAULT_ENTRIES = 1000;

function readSemanticCvCacheMaxEntries() {
  const raw = process.env.SEMANTIC_CV_CACHE_MAX_ENTRIES;
  if (raw == null || raw === '') return SEMANTIC_CV_CACHE_DEFAULT_ENTRIES;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return SEMANTIC_CV_CACHE_DEFAULT_ENTRIES;
  return Math.min(SEMANTIC_CV_CACHE_MAX_ENTRIES, Math.max(SEMANTIC_CV_CACHE_MIN_ENTRIES, n));
}

/** Bounded LRU + TTL — prevents unbounded growth from diverse CV fingerprints. */
const RESULT_CACHE = new LRUCache({
  max: readSemanticCvCacheMaxEntries(),
  ttl: CACHE_TTL_MS,
  updateAgeOnGet: true,
  ttlAutopurge: true,
  perf: {
    now: () => Date.now(),
  },
});
const INFLIGHT = new Map();

function stripFences(raw) {
  let cleaned = String(raw || '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  return cleaned;
}

function toConfidence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function safeString(v) {
  return String(v || '').trim();
}

/** Accept LLM output as `{ value }` or a plain string/number. */
function seniorityScalar(input) {
  if (input == null) return '';
  if (typeof input === 'string' || typeof input === 'number') return safeString(input);
  return safeString(input?.value);
}

function safeStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => safeString(x)).filter(Boolean);
}

function safeEvidence(v) {
  return safeStringArray(v).slice(0, 5);
}

function normalizeIdentityBullets(v, fallbackValue) {
  const directBullets = safeStringArray(v);
  if (directBullets.length > 0) {
    return directBullets.slice(0, 10).map((b) => b.split(/\s+/).slice(0, 10).join(' '));
  }
  const fallback = safeString(fallbackValue);
  if (!fallback) return [];
  return [fallback.split(/\s+/).slice(0, 10).join(' ')];
}

function normalizeItem(item, withLevel = false) {
  const name = safeString(item?.name);
  if (!name) return null;
  const out = {
    name,
    confidence: toConfidence(item?.confidence),
    evidence: safeEvidence(item?.evidence)
  };
  if (withLevel) {
    const level = safeString(item?.level).toLowerCase();
    out.level = ['beginner', 'intermediate', 'advanced'].includes(level) ? level : 'intermediate';
  }
  return out;
}

function normalizeResponsibilityItem(item) {
  const description = safeString(item?.description || item?.name);
  if (!description) return null;
  return {
    description,
    confidence: toConfidence(item?.confidence),
    evidence: safeEvidence(item?.evidence)
  };
}

const { normalizeIndustryLabel } = require('../../../constants/industries');

function normalizeDomainName(raw) {
  return normalizeIndustryLabel(raw, { keepUnknown: true }) || '';
}

function normalizeDomains(items) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizeItem(item);
    if (!normalized) continue;
    const name = normalizeDomainName(normalized.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...normalized,
      name
    });
    if (out.length >= 6) break;
  }
  return out;
}

function normalizeInterpretationShape(parsed) {
  const ui = parsed?.userIdentity || {};
  const sp = parsed?.structuredProfile || {};
  const se = parsed?.seniority || {};

  return {
    userIdentity: {
      workEnjoyment: {
        bullets: normalizeIdentityBullets(ui?.workEnjoyment?.bullets, ui?.workEnjoyment?.value),
        confidence: toConfidence(ui?.workEnjoyment?.confidence),
        evidence: safeEvidence(ui?.workEnjoyment?.evidence)
      },
      interests: {
        bullets: normalizeIdentityBullets(ui?.interests?.bullets, Array.isArray(ui?.interests?.value) ? ui.interests.value.join(', ') : ui?.interests?.value),
        confidence: toConfidence(ui?.interests?.confidence),
        evidence: safeEvidence(ui?.interests?.evidence)
      },
      strengths: {
        bullets: normalizeIdentityBullets(ui?.strengths?.bullets, Array.isArray(ui?.strengths?.value) ? ui.strengths.value.join(', ') : ui?.strengths?.value),
        confidence: toConfidence(ui?.strengths?.confidence),
        evidence: safeEvidence(ui?.strengths?.evidence)
      },
      workStyle: {
        bullets: normalizeIdentityBullets(ui?.workStyle?.bullets, ui?.workStyle?.value),
        confidence: toConfidence(ui?.workStyle?.confidence),
        evidence: safeEvidence(ui?.workStyle?.evidence)
      },
      careerGoals: {
        bullets: normalizeIdentityBullets(ui?.careerGoals?.bullets, ui?.careerGoals?.value),
        confidence: toConfidence(ui?.careerGoals?.confidence),
        evidence: safeEvidence(ui?.careerGoals?.evidence)
      }
    },
    structuredProfile: {
      skillDomains: (Array.isArray(sp?.skillDomains) ? sp.skillDomains : []).map((x) => normalizeItem(x)).filter(Boolean),
      domains: normalizeDomains(sp?.domains),
      responsibilities: (Array.isArray(sp?.responsibilities) ? sp.responsibilities : []).map((x) => normalizeResponsibilityItem(x)).filter(Boolean),
      skills: (Array.isArray(sp?.skills) ? sp.skills : []).map((x) => normalizeItem(x, true)).filter(Boolean),
      learningGoals: (Array.isArray(sp?.learningGoals) ? sp.learningGoals : []).map((x) => normalizeItem(x)).filter(Boolean)
    },
    seniority: {
      currentStatus: {
        value: seniorityScalar(se?.currentStatus),
        confidence: toConfidence(
          typeof se?.currentStatus === 'object' && se?.currentStatus != null ? se.currentStatus.confidence : undefined
        ),
        evidence: safeEvidence(
          typeof se?.currentStatus === 'object' && se?.currentStatus != null ? se.currentStatus.evidence : undefined
        )
      },
      yearsOfExperience: {
        value: seniorityScalar(se?.yearsOfExperience),
        confidence: toConfidence(
          typeof se?.yearsOfExperience === 'object' && se?.yearsOfExperience != null ? se.yearsOfExperience.confidence : undefined
        ),
        evidence: safeEvidence(
          typeof se?.yearsOfExperience === 'object' && se?.yearsOfExperience != null ? se.yearsOfExperience.evidence : undefined
        )
      },
      highestDegree: {
        value: seniorityScalar(se?.highestDegree),
        confidence: toConfidence(
          typeof se?.highestDegree === 'object' && se?.highestDegree != null ? se.highestDegree.confidence : undefined
        ),
        evidence: safeEvidence(
          typeof se?.highestDegree === 'object' && se?.highestDegree != null ? se.highestDegree.evidence : undefined
        )
      },
      mostSeniorRole: {
        value: seniorityScalar(se?.mostSeniorRole),
        confidence: toConfidence(
          typeof se?.mostSeniorRole === 'object' && se?.mostSeniorRole != null ? se.mostSeniorRole.confidence : undefined
        ),
        evidence: safeEvidence(
          typeof se?.mostSeniorRole === 'object' && se?.mostSeniorRole != null ? se.mostSeniorRole.evidence : undefined
        )
      }
    }
  };
}

async function interpretCvLayer(cvText, options, layer) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return null;
  }
  const normalizedText = redactCvContactPii(String(cvText || '').trim());
  const documentLang =
    String(options.documentLanguage ?? options.language ?? 'en')
      .toLowerCase()
      .split('-')[0] || 'en';

  const fingerprint = crypto
    .createHash('sha256')
    .update(`${layer.cacheSuffix}|${documentLang}|${normalizedText}`, 'utf8')
    .digest('hex');
  const cached = RESULT_CACHE.get(fingerprint);
  if (cached !== undefined) {
    if (getCvPipeline()) {
      logCvEvent('cv_semantic_cache_hit', { layer: layer.cacheHitLayer });
    }
    return cached;
  }
  if (INFLIGHT.has(fingerprint)) {
    return INFLIGHT.get(fingerprint);
  }

  const task = (async () => {
    return runStageIfCvPipeline(layer.stageTotal, { memory: true }, async () => {
      const messages = layer.buildMessages(normalizedText, documentLang);
      const raw = await runStageIfCvPipeline(layer.stageOpenAi, {}, async () =>
        openaiProvider(messages, { temperature: 0.1 })
      );
      const normalized = await runStageIfCvPipeline(layer.stageNormalize, {}, async () => {
        const parsed = JSON.parse(stripFences(raw));
        return layer.normalize(parsed);
      });
      RESULT_CACHE.set(fingerprint, normalized);
      return normalized;
    });
  })().finally(() => {
    INFLIGHT.delete(fingerprint);
  });

  INFLIGHT.set(fingerprint, task);
  return task;
}

async function interpretCvIdentityText(cvText, options = {}) {
  return interpretCvLayer(cvText, options, {
    cacheSuffix: 'identity',
    cacheHitLayer: 'interpret_cv_identity',
    stageTotal: 'interpret_cv_identity_total',
    stageOpenAi: 'openai_interpret_cv_identity',
    stageNormalize: 'interpret_cv_identity_normalize',
    buildMessages: buildIdentityMessages,
    normalize: (parsed) => ({
      userIdentity: normalizeInterpretationShape({ userIdentity: parsed?.userIdentity }).userIdentity,
    }),
  });
}

async function interpretCvStructuredText(cvText, options = {}) {
  return interpretCvLayer(cvText, options, {
    cacheSuffix: 'structured',
    cacheHitLayer: 'interpret_cv_structured',
    stageTotal: 'interpret_cv_structured_total',
    stageOpenAi: 'openai_interpret_cv_structured',
    stageNormalize: 'interpret_cv_structured_normalize',
    buildMessages: buildStructuredMessages,
    normalize: (parsed) => {
      const normalized = normalizeInterpretationShape({
        structuredProfile: parsed?.structuredProfile,
        seniority: parsed?.seniority,
      });
      return {
        structuredProfile: normalized.structuredProfile,
        seniority: normalized.seniority,
      };
    },
  });
}

module.exports = {
  interpretCvIdentityText,
  interpretCvStructuredText,
  normalizeInterpretationShape,
  __testables: {
    CACHE_TTL_MS,
    readSemanticCvCacheMaxEntries,
    getResultCacheSize: () => RESULT_CACHE.size,
    getResultCacheEntry: (key) => RESULT_CACHE.get(key),
    setResultCacheEntry: (key, value) => RESULT_CACHE.set(key, value),
    resetResultCache: () => {
      RESULT_CACHE.clear();
      INFLIGHT.clear();
    },
  },
};

