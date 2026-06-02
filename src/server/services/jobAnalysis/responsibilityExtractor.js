/**
 * Responsibility Extractor Service
 *
 * Extracts key responsibilities from a job role description by calling an
 * LLM provider with the extractKeyResponsibilities prompt template.
 *
 * Provider-agnostic: works with any function that accepts chat messages and
 * returns a string (the raw LLM response).  Ships with a built-in OpenAI-
 * compatible provider that uses the `OPENAI_API_KEY` env var.
 *
 * Also includes a deterministic heuristic extractor that can run without an
 * LLM, useful as a fallback or for environments without API access.
 *
 * @module services/jobAnalysis/responsibilityExtractor
 */
// ENGLISH_ONLY_PIPELINE: Heuristic verb/sentence extraction assumes canonical English input text.

const { buildMessages } = require('../../prompts/extractKeyResponsibilities');
const logger = require('../../utils/logger');
const {
  TIMEOUT_MS_LLM,
  normalizeExternalApiError,
  combineSignals,
} = require('../../utils/httpTimeouts');

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/**
 * Validate and normalise the raw LLM output into the expected schema.
 *
 * @param {string} raw – Raw text returned by the LLM (should be JSON)
 * @returns {{ key_responsibilities: string[], extraction_confidence: number }}
 * @throws {Error} If the output cannot be parsed or fails validation
 */
function validateExtraction(raw) {
  // Strip markdown fences that some models wrap around JSON
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

  // key_responsibilities
  if (!Array.isArray(parsed.key_responsibilities)) {
    throw new Error('Missing or invalid "key_responsibilities" array');
  }

  const responsibilities = parsed.key_responsibilities
    .map((r) => (typeof r === 'string' ? r.trim() : ''))
    .filter(Boolean);

  if (responsibilities.length < 1) {
    throw new Error('No valid responsibilities extracted');
  }
  if (responsibilities.length > 10) {
    // Allow a bit more than the 3–6 guidance, but cap for safety
    responsibilities.length = 10;
  }

  // extraction_confidence
  let confidence = Number(parsed.extraction_confidence);
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    confidence = 0;
  }

  return {
    key_responsibilities: responsibilities,
    extraction_confidence: Math.round(confidence * 100) / 100, // 2 decimal places
  };
}

// ---------------------------------------------------------------------------
// Built-in OpenAI-compatible provider (optional, requires OPENAI_API_KEY)
// ---------------------------------------------------------------------------

/**
 * Minimal OpenAI-compatible chat completion caller.
 * Uses the native `fetch` available in Node 18+.
 *
 * @param {{ role: string, content: string }[]} messages
 * @param {object} [opts]
 * @param {string} [opts.apiKey]    – Defaults to process.env.OPENAI_API_KEY
 * @param {string} [opts.baseUrl]   – Defaults to https://api.openai.com/v1
 * @param {string} [opts.model]     – Defaults to "gpt-4o-mini"
 * @param {number} [opts.temperature] – Defaults to 0.2
 * @returns {Promise<string>} The assistant message content
 */
async function openaiProvider(messages, opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set.  Configure it in .env or pass a custom llmProvider.'
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
      logger.error('responsibilityExtractor OpenAI HTTP error', {
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
      logger.error('responsibilityExtractor OpenAI empty content', { durationMs });
      throw new Error('Empty response from OpenAI API');
    }

    return content;
  } catch (err) {
    logger.error(
      'responsibilityExtractor OpenAI failed',
      normalizeExternalApiError(err, { durationMs: Date.now() - started })
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Heuristic extractor (no LLM required)
// ---------------------------------------------------------------------------

/**
 * Deterministic heuristic that extracts responsibility-like sentences from an
 * ESCO occupation description.  No LLM call required.
 *
 * Strategy:
 *   1. Split the description into sentences.
 *   2. Normalise pronoun-led sentences ("They develop..." → "Develop...").
 *   3. Keep only sentences that start with a verb (simple POS heuristic).
 *   4. Deduplicate and cap at 6.
 *
 * @param {object} input
 * @param {string} input.title
 * @param {string} input.description
 * @param {string[]} [input.requiredSkills]
 * @returns {{ key_responsibilities: string[], extraction_confidence: number }}
 */
function extractHeuristic({ title, description, requiredSkills }) {
  if (!description) {
    return { key_responsibilities: [], extraction_confidence: 0 };
  }

  // Split into sentences (handle abbreviations like "e.g." gracefully)
  const raw = String(description)
    .replace(/\s+/g, ' ')
    .trim();

  // Simple sentence splitter: split on ". " followed by uppercase, or end of string
  const sentences = raw
    .split(/\.(?:\s+)(?=[A-Z])/)
    .map((s) => s.replace(/\.$/, '').trim())
    .filter((s) => s.length > 15); // skip very short fragments

  // Normalise pronoun-led starts into verb-led
  const titleLower = (title || '').toLowerCase();
  const titleWords = titleLower.split(/\s+/);
  // Common ESCO pronoun patterns: "They ...", "<Title>s ..."
  const pronounRx = /^(they|he\/she|she\/he|these professionals|these workers)\s+/i;

  const normalised = sentences.map((s) => {
    // "They develop..." → "Develop..."
    let out = s.replace(pronounRx, '');

    // "<occupation title>s coordinate..." → "Coordinate..."
    // Match plural or singular title at sentence start
    for (const word of titleWords) {
      if (word.length < 3) continue;
      const rx = new RegExp(`^${word}s?\\s+`, 'i');
      out = out.replace(rx, '');
    }
    // Also try full title: "Technical directors realise..." → "Realise..."
    if (titleLower.length > 3) {
      const fullRx = new RegExp(`^${titleLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\s+`, 'i');
      out = out.replace(fullRx, '');
    }

    // Capitalise first letter
    if (out.length > 0) {
      out = out.charAt(0).toUpperCase() + out.slice(1);
    }

    return out;
  });

  // Keep sentences that look like responsibilities (start with a verb-like word)
  // Simple heuristic: first word ends in common verb suffixes or is a known verb stem
  const verbStarters = /^(manage|develop|design|create|build|implement|maintain|coordinate|conduct|analyze|analyse|evaluate|plan|lead|support|ensure|monitor|prepare|review|perform|operate|provide|advise|administer|collaborate|communicate|deliver|establish|handle|identify|inspect|install|investigate|negotiate|organise|organize|oversee|process|produce|protect|record|report|research|resolve|schedule|supervise|test|train|verify|adapt|assess|assist|authorise|authorize|calculate|check|classify|compile|configure|control|define|demonstrate|determine|direct|document|draft|drive|edit|enforce|engage|examine|execute|exercise|facilitate|forecast|formulate|generate|guide|hire|inform|initiate|integrate|interpret|inventory|issue|liaise|locate|log|measure|mediate|modify|obtain|optimise|optimize|order|outline|participate|promote|propose|recommend|recruit|regulate|rehabilitate|repair|represent|restore|select|set|source|specify|standardise|standardize|submit|supply|update|upgrade|validate|write|realise|realize)\b/i;

  const responsibilities = normalised
    .filter((s) => verbStarters.test(s))
    .filter((s) => s.length >= 20 && s.length <= 200);

  // Deduplicate (case-insensitive)
  const seen = new Set();
  const deduped = [];
  for (const r of responsibilities) {
    const key = r.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  // Cap at 6
  const result = deduped.slice(0, 6);

  // Confidence based on how many we found vs. expected 3–6
  let confidence = 0;
  if (result.length >= 3) confidence = 0.5;
  else if (result.length >= 1) confidence = 0.3;
  // Bonus if we have skills to cross-reference (description + skills = higher quality)
  if (result.length >= 3 && Array.isArray(requiredSkills) && requiredSkills.length >= 3) {
    confidence = 0.6;
  }

  return {
    key_responsibilities: result,
    extraction_confidence: confidence,
  };
}

// ---------------------------------------------------------------------------
// Main extraction functions
// ---------------------------------------------------------------------------

/**
 * Extract key responsibilities from a job role description using an LLM.
 *
 * @param {object} input
 * @param {string} input.title            – Job role title
 * @param {string} input.description      – Free-text role description
 * @param {string} [input.required_skills] – Required skills (comma/newline separated)
 * @param {string} [input.optional_skills] – Optional skills (comma/newline separated)
 * @param {object} [options]
 * @param {Function} [options.llmProvider] – async (messages) => string.
 *   Defaults to the built-in OpenAI-compatible provider.
 * @param {object} [options.providerOpts]  – Extra options forwarded to the provider.
 * @returns {Promise<{ key_responsibilities: string[], extraction_confidence: number }>}
 */
async function extractKeyResponsibilities(input, options = {}) {
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
 * Extract key responsibilities from a CareerPath document.
 *
 * Maps CareerPath fields to the prompt input format and returns a result
 * object ready to be stored in CareerPath.keyResponsibilities.
 *
 * @param {object} doc – A CareerPath document (or lean object)
 * @param {string} doc.title
 * @param {string} doc.description
 * @param {string[]} [doc.requiredSkills]
 * @param {object}   [doc.skillModel]
 * @param {object} [options]
 * @param {'llm'|'heuristic'} [options.method='llm'] – Extraction method
 * @param {Function} [options.llmProvider]   – Custom LLM provider function
 * @param {object}   [options.providerOpts]  – Options forwarded to the LLM provider
 * @returns {Promise<{
 *   responsibilities: string[],
 *   extraction_confidence: number,
 *   built_at: Date,
 *   built_with: string
 * }>}
 */
async function extractFromCareerPath(doc, options = {}) {
  const method = options.method || 'llm';
  const title = doc.title || '';
  const description = doc.description || '';

  // Build required_skills string from available data
  const coreSkills = doc.skillModel?.core_skills || doc.requiredSkills || [];
  const optionalSkills = doc.skillModel?.optional_skills || [];
  const requiredSkillsStr = coreSkills.length > 0 ? coreSkills.join(', ') : undefined;
  const optionalSkillsStr = optionalSkills.length > 0 ? optionalSkills.join(', ') : undefined;

  let result;

  if (method === 'heuristic') {
    result = extractHeuristic({
      title,
      description,
      requiredSkills: coreSkills,
    });
  } else {
    // LLM-based extraction
    result = await extractKeyResponsibilities(
      {
        title,
        description,
        required_skills: requiredSkillsStr,
        optional_skills: optionalSkillsStr,
      },
      {
        llmProvider: options.llmProvider,
        providerOpts: options.providerOpts,
      }
    );
  }

  return {
    responsibilities: result.key_responsibilities,
    extraction_confidence: result.extraction_confidence,
    built_at: new Date(),
    built_with: method,
  };
}

module.exports = {
  extractKeyResponsibilities,
  extractFromCareerPath,
  extractHeuristic,
  validateExtraction,
  openaiProvider,
};
