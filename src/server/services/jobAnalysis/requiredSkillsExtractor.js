/**
 * Required Skills Extractor Service
 *
 * Extracts core and optional skills from a job role using an LLM, grounded in
 * the occupation description and key responsibilities.
 *
 * @module services/jobAnalysis/requiredSkillsExtractor
 */

const { buildMessages } = require('../../prompts/extractRequiredSkills');
const { getLocalizedFieldLenient } = require('../../utils/i18nFields');
const logger = require('../../utils/logger');
const {
  TIMEOUT_MS_LLM,
  normalizeExternalApiError,
  combineSignals,
} = require('../../utils/httpTimeouts');

const MIN_CORE = 3;
const MAX_CORE = 15;
const MAX_OPTIONAL = 10;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function normalizeSkillLabel(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ');
}

function dedupeSkills(skills) {
  const seen = new Set();
  const out = [];
  for (const raw of skills) {
    const label = normalizeSkillLabel(raw);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/**
 * @param {string} raw
 * @returns {{ core_skills: string[], optional_skills: string[], extraction_confidence: number }}
 */
function validateExtraction(raw) {
  let cleaned = String(raw).trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`LLM output is not valid JSON: ${err.message}`);
  }

  if (!Array.isArray(parsed.core_skills)) {
    throw new Error('Missing or invalid "core_skills" array');
  }

  const core_skills = dedupeSkills(parsed.core_skills).slice(0, MAX_CORE);
  if (core_skills.length < MIN_CORE) {
    throw new Error(`Expected at least ${MIN_CORE} core skills, got ${core_skills.length}`);
  }

  const optionalRaw = Array.isArray(parsed.optional_skills) ? parsed.optional_skills : [];
  const coreKeys = new Set(core_skills.map((s) => s.toLowerCase()));
  const optional_skills = dedupeSkills(optionalRaw)
    .filter((s) => !coreKeys.has(s.toLowerCase()))
    .slice(0, MAX_OPTIONAL);

  let confidence = Number(parsed.extraction_confidence);
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    confidence = 0;
  }

  return {
    core_skills,
    optional_skills,
    extraction_confidence: Math.round(confidence * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Skill model builder
// ---------------------------------------------------------------------------

/**
 * Build a CareerPath.skillModel object from extracted skills.
 *
 * @param {{ core_skills: string[], optional_skills: string[], extraction_confidence: number }} extraction
 * @returns {object}
 */
function buildSkillModelFromExtraction(extraction) {
  const { core_skills, optional_skills, extraction_confidence } = extraction;
  const skill_weights = {};

  core_skills.forEach((skill, index) => {
    const positionalBoost = core_skills.length > 1
      ? 0.15 * (1 - index / (core_skills.length - 1))
      : 0.1;
    skill_weights[skill] = Math.min(1.0, Math.round((0.85 + positionalBoost) * 100) / 100);
  });

  optional_skills.forEach((skill, index) => {
    const positionalBoost = optional_skills.length > 1
      ? 0.15 * (1 - index / (optional_skills.length - 1))
      : 0.05;
    skill_weights[skill] = Math.min(0.5, Math.round((0.25 + positionalBoost) * 100) / 100);
  });

  return {
    core_skills,
    optional_skills,
    skill_weights,
    extraction_confidence,
    built_at: new Date(),
    built_with: 'llm',
  };
}

// ---------------------------------------------------------------------------
// LLM provider
// ---------------------------------------------------------------------------

async function openaiProvider(messages, opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Configure it in .env or pass a custom llmProvider.'
    );
  }

  const baseUrl = (opts.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = opts.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.2;
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs)
      ? opts.timeoutMs
      : TIMEOUT_MS_LLM;

  const started = Date.now();
  try {
    const signal = combineSignals(opts.signal, timeoutMs);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages,
        response_format: { type: 'json_object' },
      }),
      signal,
    });

    const durationMs = Date.now() - started;

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error('requiredSkillsExtractor OpenAI HTTP error', {
        status: res.status,
        durationMs,
        bodyPreview: body.slice(0, 400),
      });
      throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const content =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      '';

    if (!content) {
      logger.error('requiredSkillsExtractor OpenAI empty content', { durationMs });
      throw new Error('Empty response from OpenAI API');
    }

    return content;
  } catch (err) {
    logger.error(
      'requiredSkillsExtractor OpenAI failed',
      normalizeExternalApiError(err, { durationMs: Date.now() - started })
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {string} input.title
 * @param {string} input.description
 * @param {string} [input.key_responsibilities]
 * @param {string} [input.current_skills]
 * @param {object} [options]
 * @returns {Promise<{ core_skills: string[], optional_skills: string[], extraction_confidence: number }>}
 */
async function extractRequiredSkills(input, options = {}) {
  const { title, description } = input || {};

  if (!title && !description) {
    throw new Error('At least one of "title" or "description" must be provided');
  }

  const messages = buildMessages(input);
  const provider = options.llmProvider || openaiProvider;
  const raw = await provider(messages, options.providerOpts || {});

  return validateExtraction(raw);
}

/**
 * Extract skills from a CareerPath document and return DB-ready payloads.
 *
 * @param {object} doc
 * @param {object} [options]
 * @returns {Promise<{
 *   requiredSkills: string[],
 *   requiredSkillKeys: string[],
 *   skillModel: object,
 *   extraction_confidence: number
 * }>}
 */
async function extractFromCareerPath(doc, options = {}) {
  const title = getLocalizedFieldLenient(doc.title);
  const description = getLocalizedFieldLenient(doc.description);
  const responsibilities = doc.keyResponsibilities?.responsibilities || [];
  const currentSkills = doc.skillModel?.core_skills || doc.requiredSkills || [];

  const extraction = await extractRequiredSkills(
    {
      title,
      description,
      key_responsibilities: responsibilities.length > 0
        ? responsibilities.join('\n')
        : undefined,
      current_skills: currentSkills.length > 0
        ? currentSkills.join(', ')
        : undefined,
    },
    {
      llmProvider: options.llmProvider,
      providerOpts: options.providerOpts,
    }
  );

  const skillModel = buildSkillModelFromExtraction(extraction);
  const { normalizeSkillKey } = require('../careerPathSkillService');

  return {
    requiredSkills: skillModel.core_skills,
    requiredSkillKeys: skillModel.core_skills.map((s) => normalizeSkillKey(s)).filter(Boolean),
    skillModel,
    extraction_confidence: extraction.extraction_confidence,
  };
}

module.exports = {
  extractRequiredSkills,
  extractFromCareerPath,
  validateExtraction,
  buildSkillModelFromExtraction,
  openaiProvider,
  MIN_CORE,
  MAX_CORE,
  MAX_OPTIONAL,
};
