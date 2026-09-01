/**
 * Validate / normalize LLM responses for occupation domain classification.
 * @module services/occupationDomainClassification/domainClassificationValidation
 */

const {
  INDUSTRY_CANONICAL_LABELS,
  normalizeOccupationDomain,
  UNASSIGNED_ROLE_DOMAIN,
  isValidOccupationDomain,
} = require('../../../constants/industries');
const logger = require('../../utils/logger');

const MANUAL_REVIEW_CONFIDENCE_THRESHOLD = 0.75;

const ALLOWED_DOMAIN_SET = new Set(INDUSTRY_CANONICAL_LABELS);

/**
 * Extract a JSON object from model text (handles fenced code blocks).
 * @param {string} raw
 * @returns {object}
 */
function parseJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    throw new Error('Empty model response');
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Response JSON must be an object');
    }
    return parsed;
  } catch (firstErr) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      const parsed = JSON.parse(fenced[1].trim());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Response JSON must be an object');
      }
      return parsed;
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Response JSON must be an object');
      }
      return parsed;
    }
    throw firstErr;
  }
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeConfidence(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid confidence: ${value}`);
  }
  if (n < 0 || n > 1) {
    throw new Error(`Confidence out of range [0,1]: ${n}`);
  }
  return n;
}

/**
 * @param {unknown} rawDomain
 * @returns {string}
 */
function resolveAllowedDomain(rawDomain) {
  const normalized = normalizeOccupationDomain(rawDomain, { allowUnassigned: false });
  if (!normalized || normalized === UNASSIGNED_ROLE_DOMAIN) {
    throw new Error(`Domain not in allowed list: ${rawDomain}`);
  }
  if (!ALLOWED_DOMAIN_SET.has(normalized)) {
    throw new Error(`Domain not in allowed list: ${rawDomain}`);
  }
  // Defense: never accept UNASSIGNED as a classification result
  if (!isValidOccupationDomain(normalized) || normalized === UNASSIGNED_ROLE_DOMAIN) {
    throw new Error(`Domain not in allowed list: ${rawDomain}`);
  }
  return normalized;
}

/**
 * Validate raw LLM text into a classification result ready for persistence.
 *
 * @param {string} rawText
 * @param {{ model?: string, escoId?: string }} [meta]
 * @returns {{
 *   domain: string,
 *   confidence: number,
 *   reason: string,
 *   needsManualReview: boolean,
 *   model: string,
 * }}
 */
function validateClassificationResponse(rawText, { model = '', escoId = '' } = {}) {
  let parsed;
  try {
    parsed = parseJsonObject(rawText);
  } catch (err) {
    logger.error('occupation domain classification invalid JSON', {
      escoId: escoId || undefined,
      message: err?.message,
      preview: String(rawText || '').slice(0, 400),
    });
    throw new Error(`Invalid JSON: ${err.message}`);
  }

  let domain;
  let confidence;
  try {
    domain = resolveAllowedDomain(parsed.domain);
    confidence = normalizeConfidence(parsed.confidence);
  } catch (err) {
    logger.error('occupation domain classification validation error', {
      escoId: escoId || undefined,
      message: err?.message,
      domain: parsed?.domain,
      confidence: parsed?.confidence,
    });
    throw err;
  }

  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
  const needsManualReview = confidence < MANUAL_REVIEW_CONFIDENCE_THRESHOLD;

  return {
    domain,
    confidence,
    reason,
    needsManualReview,
    model: model || '',
  };
}

module.exports = {
  MANUAL_REVIEW_CONFIDENCE_THRESHOLD,
  parseJsonObject,
  normalizeConfidence,
  resolveAllowedDomain,
  validateClassificationResponse,
  ALLOWED_DOMAIN_SET,
};
