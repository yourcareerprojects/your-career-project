/**
 * Skill Domain Extractor Service
 *
 * Derives structured Skill Domains from a job role by calling an LLM provider
 * with the extractSkillDomains prompt template, or by using a deterministic
 * heuristic that clusters skills and responsibilities without an LLM.
 *
 * Provider-agnostic: works with any function that accepts chat messages and
 * returns a string (the raw LLM response).  Ships with the same OpenAI-
 * compatible provider used by the responsibility extractor.
 *
 * @module services/jobAnalysis/skillDomainExtractor
 */
// ENGLISH_ONLY_PIPELINE: Domain taxonomy keyword matching operates on canonical English text.

const { buildMessages } = require('../../prompts/extractSkillDomains');
const logger = require('../../utils/logger');
const {
  TIMEOUT_MS_LLM,
  normalizeExternalApiError,
  combineSignals,
} = require('../../utils/httpTimeouts');

// ---------------------------------------------------------------------------
// OpenAI-compatible provider (shared pattern with responsibilityExtractor)
// ---------------------------------------------------------------------------

/**
 * Minimal OpenAI-compatible chat completion caller.
 * Uses the native `fetch` available in Node 18+.
 *
 * @param {{ role: string, content: string }[]} messages
 * @param {object} [opts]
 * @param {string} [opts.apiKey]      – Defaults to process.env.OPENAI_API_KEY
 * @param {string} [opts.baseUrl]     – Defaults to https://api.openai.com/v1
 * @param {string} [opts.model]       – Defaults to "gpt-4o-mini"
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
  const timeoutMs = Number.isFinite(opts.timeoutMs)
    ? opts.timeoutMs
    : TIMEOUT_MS_LLM;
  const maxRetries = Number.isFinite(opts.maxRetries)
    ? opts.maxRetries
    : Number.parseInt(process.env.OPENAI_MAX_RETRIES || '', 10) || 3;
  const retryBaseMs = Number.isFinite(opts.retryBaseMs)
    ? opts.retryBaseMs
    : Number.parseInt(process.env.OPENAI_RETRY_BASE_MS || '', 10) || 1000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const shouldRetry = (statusCode, errMessage) => {
    if (statusCode === 408 || statusCode === 409 || statusCode === 429) return true;
    if (statusCode >= 500) return true;
    const m = String(errMessage || '').toLowerCase();
    return m.includes('timeout') || m.includes('timed out') || m.includes('network');
  };

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`OpenAI API error ${res.status}: ${body}`);
        if (attempt < maxRetries && shouldRetry(res.status, err.message)) {
          const waitMs = retryBaseMs * (2 ** attempt);
          await sleep(waitMs);
          continue;
        }
        throw err;
      }

      const data = await res.json();
      const content =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        '';

      if (!content) {
        throw new Error('Empty response from OpenAI API');
      }

      return content;
    } catch (err) {
      lastError = err;
      logger.warn(
        'skillDomainExtractor OpenAI attempt failed',
        normalizeExternalApiError(err, { attempt, durationMs: Date.now() - started })
      );
      const isAbort = err && (err.name === 'AbortError' || String(err.message || '').includes('aborted'));
      if (attempt < maxRetries && (isAbort || shouldRetry(0, err?.message))) {
        const waitMs = retryBaseMs * (2 ** attempt);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('OpenAI API request failed after retries');
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

const VALID_IMPORTANCE = new Set(['core', 'important', 'supporting']);

/**
 * Normalize a domain label to embedded i18n shape required by CareerPath schema.
 *
 * @param {string|{ en?: string, de?: string|null }} domain
 * @returns {{ en: string, de: string|null }|null}
 */
function normalizeDomainLabel(domain) {
  if (domain && typeof domain === 'object' && !Array.isArray(domain)) {
    const en = typeof domain.en === 'string' ? domain.en.trim() : '';
    if (!en) return null;
    const de = domain.de == null || domain.de === '' ? null : String(domain.de).trim();
    return { en, de };
  }
  const label = typeof domain === 'string' ? domain.trim() : '';
  return label ? { en: label, de: null } : null;
}

/**
 * @param {Array<{ domain: unknown, importance: string, mapped_items: string[] }>} skillDomains
 * @returns {Array<{ domain: { en: string, de: string|null }, importance: string, mapped_items: string[] }>}
 */
function normalizeSkillDomainItems(skillDomains) {
  return skillDomains
    .map((item) => {
      const domain = normalizeDomainLabel(item.domain);
      if (!domain) return null;
      return {
        domain,
        importance: item.importance,
        mapped_items: item.mapped_items,
      };
    })
    .filter(Boolean);
}

/**
 * Validate and normalise the raw LLM output into the expected schema.
 *
 * @param {string} raw – Raw text returned by the LLM (should be JSON)
 * @returns {{ skill_domains: Array<{ domain: { en: string, de: string|null }, importance: string, mapped_items: string[] }>, extraction_confidence: number }}
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

  // skill_domains
  if (!Array.isArray(parsed.skill_domains)) {
    throw new Error('Missing or invalid "skill_domains" array');
  }

  const skillDomains = [];

  for (const item of parsed.skill_domains) {
    if (!item || typeof item !== 'object') continue;

    const domain = normalizeDomainLabel(item.domain);
    if (!domain) continue;

    const importance = typeof item.importance === 'string'
      ? item.importance.trim().toLowerCase()
      : '';
    if (!VALID_IMPORTANCE.has(importance)) continue;

    const mappedItems = Array.isArray(item.mapped_items)
      ? item.mapped_items
          .map((m) => (typeof m === 'string' ? m.trim() : ''))
          .filter(Boolean)
      : [];

    if (mappedItems.length === 0) continue;

    skillDomains.push({ domain, importance, mapped_items: mappedItems });
  }

  if (skillDomains.length < 2) {
    throw new Error(`Too few valid skill domains extracted (${skillDomains.length})`);
  }

  // Cap at 12
  if (skillDomains.length > 12) {
    skillDomains.length = 12;
  }

  // extraction_confidence
  let confidence = Number(parsed.extraction_confidence);
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    confidence = 0;
  }

  return {
    skill_domains: normalizeSkillDomainItems(skillDomains),
    extraction_confidence: Math.round(confidence * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Heuristic extractor (no LLM required)
// ---------------------------------------------------------------------------

/**
 * Canonical domain taxonomy used by the heuristic to classify skills
 * and responsibilities into stable, comparable categories.
 *
 * Each entry: { domain, keywords[] }
 * Keywords are matched against lowercased skill/responsibility text.
 */
const DOMAIN_TAXONOMY = [
  {
    domain: 'Data Analysis & Interpretation',
    keywords: ['data', 'analy', 'statistic', 'metric', 'quantitative', 'dataset', 'insight', 'interpret', 'forecast', 'predict', 'mining', 'visuali', 'dashboard', 'report', 'kpi'],
  },
  {
    domain: 'Software Development & Engineering',
    keywords: ['software', 'programming', 'coding', 'develop', 'engineer', 'algorithm', 'debug', 'deploy', 'devops', 'version control', 'ci/cd', 'api', 'backend', 'frontend', 'full-stack', 'microservice', 'code review'],
  },
  {
    domain: 'Project & Process Management',
    keywords: ['project manag', 'process', 'plan', 'schedul', 'milestone', 'timeline', 'agile', 'scrum', 'kanban', 'workflow', 'deliverable', 'resource alloc', 'risk manag', 'budget', 'stakeholder manag'],
  },
  {
    domain: 'Communication & Stakeholder Engagement',
    keywords: ['communicat', 'stakeholder', 'present', 'negotiat', 'collaborat', 'liaison', 'client relat', 'customer relat', 'report to', 'advise', 'consult', 'facilitate', 'mediat'],
  },
  {
    domain: 'Leadership & Team Management',
    keywords: ['lead', 'manage team', 'supervis', 'mentor', 'coach', 'delegate', 'team build', 'direct report', 'hire', 'recruit', 'performance review', 'motivat', 'coordinat team', 'oversee staff'],
  },
  {
    domain: 'Strategic Planning & Business Development',
    keywords: ['strateg', 'business develop', 'market analysis', 'competitive', 'growth', 'vision', 'long-term', 'roadmap', 'business plan', 'revenue', 'expansion', 'innovation', 'transform'],
  },
  {
    domain: 'Financial Management & Accounting',
    keywords: ['financ', 'account', 'budget', 'audit', 'tax', 'revenue', 'profit', 'cost', 'invoice', 'payroll', 'fiscal', 'ledger', 'bookkeep', 'treasury', 'investment'],
  },
  {
    domain: 'Research & Knowledge Development',
    keywords: ['research', 'scientif', 'experiment', 'hypothes', 'literature', 'peer review', 'publish', 'academ', 'investigat', 'knowledge', 'methodology', 'theoret', 'evidence-based'],
  },
  {
    domain: 'Design & Creative Production',
    keywords: ['design', 'creative', 'visual', 'graphic', 'ux', 'ui', 'user experience', 'user interface', 'prototype', 'wireframe', 'aesthetic', 'brand', 'layout', 'illustrat', 'typograph', 'motion', 'animation'],
  },
  {
    domain: 'Technical Operations & Infrastructure',
    keywords: ['infrastructure', 'network', 'system admin', 'server', 'cloud', 'database admin', 'monitor', 'incident', 'troubleshoot', 'configur', 'hardware', 'install', 'maintain', 'technical support', 'it support'],
  },
  {
    domain: 'Quality Assurance & Compliance',
    keywords: ['quality', 'compliance', 'regulat', 'standard', 'audit', 'inspect', 'certif', 'accredit', 'test', 'validat', 'safety', 'iso', 'procedure', 'policy', 'governance'],
  },
  {
    domain: 'Sales & Marketing',
    keywords: ['sales', 'marketing', 'advertis', 'promotion', 'campaign', 'brand', 'customer acqui', 'lead generat', 'conversion', 'market research', 'seo', 'content market', 'social media', 'digital market'],
  },
  {
    domain: 'Education & Training',
    keywords: ['teach', 'train', 'educat', 'instruct', 'curriculum', 'lesson', 'learn', 'workshop', 'seminar', 'pedagog', 'assessment', 'tutor', 'mentor', 'skill develop', 'onboard'],
  },
  {
    domain: 'Healthcare & Patient Care',
    keywords: ['patient', 'clinical', 'medical', 'health', 'diagnos', 'treatment', 'therap', 'pharma', 'nurs', 'surgery', 'rehab', 'care plan', 'wellbeing', 'mental health'],
  },
  {
    domain: 'Legal & Regulatory Affairs',
    keywords: ['legal', 'law', 'regulat', 'contract', 'litigation', 'intellectual property', 'patent', 'compliance', 'licens', 'dispute', 'judicial', 'legislat'],
  },
  {
    domain: 'Supply Chain & Logistics',
    keywords: ['supply chain', 'logistic', 'procurement', 'inventory', 'warehouse', 'distribution', 'shipping', 'transport', 'vendor', 'sourcing', 'supply manag', 'freight'],
  },
  {
    domain: 'Customer Service & Support',
    keywords: ['customer service', 'customer support', 'help desk', 'complaint', 'issue resolution', 'service delivery', 'client support', 'ticket', 'escalat', 'satisfaction'],
  },
  {
    domain: 'Information Security & Risk Management',
    keywords: ['security', 'cyber', 'risk', 'threat', 'vulnerab', 'encryption', 'access control', 'incident response', 'penetration', 'firewall', 'data protect', 'privacy', 'gdpr'],
  },
  {
    domain: 'Environmental & Sustainability Management',
    keywords: ['environment', 'sustainab', 'green', 'carbon', 'waste', 'recycl', 'energy efficien', 'emission', 'ecology', 'conservat', 'renewable'],
  },
  {
    domain: 'Human Resources & Talent Management',
    keywords: ['human resource', 'hr', 'talent', 'recruit', 'onboard', 'employee relat', 'compensation', 'benefit', 'workforce', 'retention', 'diversity', 'inclusion', 'performance manag'],
  },
  {
    domain: 'Manufacturing & Production',
    keywords: ['manufactur', 'production', 'assembly', 'fabricat', 'machining', 'lean', 'six sigma', 'quality control', 'industrial', 'plant', 'factory', 'tooling'],
  },
  {
    domain: 'Architecture & Construction',
    keywords: ['architect', 'construct', 'building', 'structural', 'civil engineer', 'blueprint', 'zoning', 'site', 'renovation', 'cad', 'bim'],
  },
  {
    domain: 'Media & Content Production',
    keywords: ['media', 'content', 'editorial', 'journalism', 'publish', 'broadcast', 'video', 'audio', 'podcast', 'copywriting', 'storytell'],
  },
  {
    domain: 'Mathematical & Statistical Modeling',
    keywords: ['mathematic', 'model', 'simulation', 'optimis', 'optimiz', 'linear programming', 'stochastic', 'numerical', 'computation'],
  },
];

/**
 * Score a text item against a domain's keyword list.
 * Returns 0 if no match, or a positive score reflecting match strength.
 */
function scoreDomainMatch(textLower, keywords) {
  let score = 0;
  for (const kw of keywords) {
    if (textLower.includes(kw)) {
      // Longer keyword matches are more specific → higher score
      score += 1 + (kw.length / 20);
    }
  }
  return score;
}

/**
 * Deterministic heuristic that derives skill domains by keyword-matching
 * skills and responsibilities against a canonical domain taxonomy.
 *
 * @param {object} input
 * @param {string[]} [input.skills]             – Array of skill names
 * @param {string[]} [input.key_responsibilities] – Array of responsibility statements
 * @returns {{ skill_domains: Array<{ domain: string, importance: string, mapped_items: string[] }>, extraction_confidence: number }}
 */
function extractHeuristic({ skills, key_responsibilities }) {
  const allItems = [];

  // Collect all classifiable items
  if (Array.isArray(skills)) {
    for (const s of skills) {
      if (typeof s === 'string' && s.trim()) allItems.push(s.trim());
    }
  }
  if (Array.isArray(key_responsibilities)) {
    for (const r of key_responsibilities) {
      if (typeof r === 'string' && r.trim()) allItems.push(r.trim());
    }
  }

  if (allItems.length === 0) {
    return { skill_domains: [], extraction_confidence: 0 };
  }

  // For each item, find the best-matching domain
  // domainName → { items: string[], totalScore: number }
  const domainMap = new Map();

  for (const item of allItems) {
    const itemLower = item.toLowerCase();
    let bestDomain = null;
    let bestScore = 0;

    for (const entry of DOMAIN_TAXONOMY) {
      const score = scoreDomainMatch(itemLower, entry.keywords);
      if (score > bestScore) {
        bestScore = score;
        bestDomain = entry.domain;
      }
    }

    // Also check title/description context to break ties or boost weak matches
    if (bestDomain && bestScore > 0) {
      if (!domainMap.has(bestDomain)) {
        domainMap.set(bestDomain, { items: [], totalScore: 0 });
      }
      const entry = domainMap.get(bestDomain);
      entry.items.push(item);
      entry.totalScore += bestScore;
    }
  }

  if (domainMap.size === 0) {
    return { skill_domains: [], extraction_confidence: 0 };
  }

  // Sort domains by total score (highest first) to assign importance
  const sorted = [...domainMap.entries()]
    .sort((a, b) => b[1].totalScore - a[1].totalScore);

  // Assign importance based on relative ranking and item count
  const totalItems = allItems.length;
  const skillDomains = sorted.map(([domain, { items, totalScore }], index) => {
    const itemRatio = items.length / totalItems;

    let importance;
    if (index === 0 || itemRatio >= 0.25) {
      importance = 'core';
    } else if (index <= 2 || itemRatio >= 0.10) {
      importance = 'important';
    } else {
      importance = 'supporting';
    }

    return {
      domain,
      importance,
      mapped_items: [...new Set(items)], // deduplicate
    };
  });

  // Cap at 12
  const result = skillDomains.slice(0, 12);

  // Confidence based on coverage and domain count
  const classifiedCount = result.reduce((acc, d) => acc + d.mapped_items.length, 0);
  const coverageRatio = classifiedCount / allItems.length;
  let confidence = 0.2;
  if (result.length >= 4 && coverageRatio >= 0.5) confidence = 0.5;
  if (result.length >= 4 && coverageRatio >= 0.7) confidence = 0.6;
  if (result.length >= 5 && coverageRatio >= 0.8) confidence = 0.65;

  return {
    skill_domains: normalizeSkillDomainItems(result),
    extraction_confidence: confidence,
  };
}

// ---------------------------------------------------------------------------
// Main extraction functions
// ---------------------------------------------------------------------------

/**
 * Extract skill domains from a job role description using an LLM.
 *
 * @param {object} input
 * @param {string} [input.required_skills]       – Required skills (comma/newline separated)
 * @param {string} [input.optional_skills]       – Optional skills (comma/newline separated)
 * @param {string} [input.key_responsibilities]  – Responsibilities (newline separated)
 * @param {object} [options]
 * @param {Function} [options.llmProvider]        – async (messages) => string
 * @param {object}   [options.providerOpts]       – Extra options forwarded to the provider
 * @returns {Promise<{ skill_domains: Array, extraction_confidence: number }>}
 */
async function extractSkillDomains(input, options = {}) {
  const { required_skills, optional_skills, key_responsibilities } = input || {};

  if (!required_skills && !optional_skills && !key_responsibilities) {
    throw new Error(
      'At least one extraction field is required: required_skills, optional_skills, or key_responsibilities'
    );
  }

  const messages = buildMessages(input);
  const provider = options.llmProvider || openaiProvider;
  const raw = await provider(messages, options.providerOpts || {});

  return validateExtraction(raw);
}

/**
 * Extract skill domains from a CareerPath document.
 *
 * Maps CareerPath fields to the prompt input format and returns a result
 * object ready to be stored in CareerPath.skillDomains.
 *
 * @param {object} doc – A CareerPath document (or lean object)
 * @param {string[]}  [doc.requiredSkills]
 * @param {object}    [doc.skillModel]
 * @param {object}    [doc.keyResponsibilities]
 * @param {object} [options]
 * @param {'llm'|'heuristic'} [options.method='llm'] – Extraction method
 * @param {Function} [options.llmProvider]   – Custom LLM provider function
 * @param {object}   [options.providerOpts]  – Options forwarded to the LLM provider
 * @returns {Promise<{
 *   skill_domains: Array<{ domain: string, importance: string, mapped_items: string[] }>,
 *   extraction_confidence: number,
 *   built_at: Date,
 *   built_with: string
 * }>}
 */
async function extractFromCareerPath(doc, options = {}) {
  const method = options.method || 'llm';
  // Gather skills from the best available source
  const coreSkills = doc.skillModel?.core_skills || doc.requiredSkills || [];
  const optionalSkills = doc.skillModel?.optional_skills || [];
  const requiredSkillsStr = coreSkills.length > 0 ? coreSkills.join(', ') : undefined;
  const optionalSkillsStr = optionalSkills.length > 0 ? optionalSkills.join(', ') : undefined;
  const allSkills = [...coreSkills, ...optionalSkills];

  // Gather key responsibilities
  const responsibilities = doc.keyResponsibilities?.responsibilities || [];
  const responsibilitiesStr = responsibilities.length > 0
    ? responsibilities.join('\n')
    : undefined;

  let result;

  if (method === 'heuristic') {
    result = extractHeuristic({
      skills: allSkills,
      key_responsibilities: responsibilities,
    });
  } else {
    // LLM-based extraction
    result = await extractSkillDomains(
      {
        required_skills: requiredSkillsStr,
        optional_skills: optionalSkillsStr,
        key_responsibilities: responsibilitiesStr,
      },
      {
        llmProvider: options.llmProvider,
        providerOpts: options.providerOpts,
      }
    );
  }

  return {
    skill_domains: result.skill_domains,
    extraction_confidence: result.extraction_confidence,
    built_at: new Date(),
    built_with: method,
  };
}

module.exports = {
  extractSkillDomains,
  extractFromCareerPath,
  extractHeuristic,
  validateExtraction,
  normalizeDomainLabel,
  normalizeSkillDomainItems,
  openaiProvider,
  // Exported for testing
  DOMAIN_TAXONOMY,
  scoreDomainMatch,
};
