const crypto = require('crypto');
const { buildMessages } = require('../../prompts/interpretCvToProfile');
const { openaiProvider } = require('../jobAnalysis/roleIdentityComposer');

const CACHE_TTL_MS = 15 * 60 * 1000;
const RESULT_CACHE = new Map();
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

const { isBlockedNonIndustryDomain } = require('../../constants/industryDomainFilters');

const DOMAIN_SYNONYMS = new Map([
  ['financial services', 'Finance'],
  ['fintech', 'Finance'],
  ['health tech', 'Healthcare'],
  ['healthcare technology', 'Healthcare'],
  ['life sciences', 'Life Sciences'],
  ['biotech', 'Life Sciences'],
  ['biotechnology', 'Life Sciences'],
  ['pharma', 'Pharmaceuticals'],
  ['pharmaceutical', 'Pharmaceuticals'],
  ['medtech', 'MedTech'],
  ['med tech', 'MedTech'],
  ['e commerce', 'E-commerce'],
  ['ecommerce', 'E-commerce'],
  ['manufacturing', 'Manufacturing'],
  ['education', 'Education'],
  ['edtech', 'Education'],
  ['ai', 'Artificial Intelligence'],
  ['artificial intelligence', 'Artificial Intelligence']
]);

function toTitleCase(raw) {
  const s = safeString(raw).toLowerCase();
  if (!s) return '';
  return s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function normalizeDomainName(raw) {
  const key = safeString(raw).toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!key) return '';
  if (isBlockedNonIndustryDomain(raw)) return '';
  if (DOMAIN_SYNONYMS.has(key)) return DOMAIN_SYNONYMS.get(key);
  return toTitleCase(raw);
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

async function interpretCvText(cvText, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return null;
  }
  const normalizedText = String(cvText || '').trim();
  const documentLang =
    String(options.documentLanguage ?? options.language ?? 'en')
      .toLowerCase()
      .split('-')[0] || 'en';

  const fingerprint = crypto
    .createHash('sha256')
    .update(`${documentLang}|${normalizedText}`, 'utf8')
    .digest('hex');
  const now = Date.now();
  const cached = RESULT_CACHE.get(fingerprint);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  if (INFLIGHT.has(fingerprint)) {
    return INFLIGHT.get(fingerprint);
  }

  const task = (async () => {
    const messages = buildMessages(normalizedText, documentLang);
    const raw = await openaiProvider(messages, { temperature: 0.1 });
    const parsed = JSON.parse(stripFences(raw));
    const normalized = normalizeInterpretationShape(parsed);
    RESULT_CACHE.set(fingerprint, {
      value: normalized,
      expiresAt: Date.now() + CACHE_TTL_MS
    });
    return normalized;
  })().finally(() => {
    INFLIGHT.delete(fingerprint);
  });

  INFLIGHT.set(fingerprint, task);
  return task;
}

module.exports = {
  interpretCvText,
  normalizeInterpretationShape
};

