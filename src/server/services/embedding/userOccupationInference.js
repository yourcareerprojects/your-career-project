/**
 * User occupation inference from free-form domains.
 *
 * This module is intentionally swappable:
 * - rule_based: deterministic keyword lookup
 * - llm_or_rule: tries LLM classification first, then falls back to rules
 */
// ENGLISH_ONLY_PIPELINE: ISCO classification must run on English-normalized domains.
const OpenAI = require('openai').default;
const { normalizeForProcessing } = require('../ai/normalizeForProcessing');
const { translateText } = require('../ai/translateText');

const ISCO_CODE_PATTERN = /^\d{1,4}$/;

// Lightweight seed taxonomy for rule-based fallback.
const DOMAIN_TO_ISCO_RULES = [
  { keywords: ['software', 'engineering', 'developer', 'programming', 'ai', 'machine learning', 'data science'], codes: { '251': 0.5, '252': 0.3, '212': 0.2 } },
  { keywords: ['marketing', 'brand', 'seo', 'content', 'growth'], codes: { '243': 0.7, '122': 0.2, '333': 0.1 } },
  { keywords: ['health', 'healthcare', 'medical', 'nursing', 'clinical'], codes: { '22': 0.7, '32': 0.3 } },
  { keywords: ['finance', 'accounting', 'audit', 'controller', 'banking'], codes: { '241': 0.7, '331': 0.3 } },
  { keywords: ['education', 'teaching', 'learning', 'trainer'], codes: { '23': 0.8, '235': 0.2 } },
  { keywords: ['sales', 'retail', 'business development'], codes: { '52': 0.5, '332': 0.3, '243': 0.2 } },
];

function normalizeScoreMap(scoreMap) {
  const entries = Object.entries(scoreMap).filter(([code, score]) => ISCO_CODE_PATTERN.test(code) && Number.isFinite(score) && score > 0);
  const sum = entries.reduce((acc, [, score]) => acc + score, 0);
  if (sum <= 0) return [];
  return entries
    .map(([code, score]) => ({ code, score: score / sum }))
    .sort((a, b) => b.score - a.score);
}

function sanitizeDomains(domains) {
  const arr = Array.isArray(domains) ? domains : [];
  return arr
    .map((d) => String(d || '').trim())
    .filter(Boolean);
}

function inferIscoRuleBased(domains) {
  const normalizedDomains = sanitizeDomains(domains);
  const scoreMap = {};
  const haystack = normalizedDomains.join(' | ').toLowerCase();
  for (const rule of DOMAIN_TO_ISCO_RULES) {
    const matched = rule.keywords.some((k) => haystack.includes(k));
    if (!matched) continue;
    for (const [code, weight] of Object.entries(rule.codes)) {
      scoreMap[code] = (scoreMap[code] || 0) + weight;
    }
  }
  return normalizeScoreMap(scoreMap);
}

let openaiClient = null;
function getOpenAI() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
  }
  return openaiClient;
}

async function inferIscoLlm(domains) {
  const normalizedDomains = sanitizeDomains(domains);
  if (normalizedDomains.length === 0) return [];
  const apiKey = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
  if (!apiKey) return [];

  const prompt = [
    'Infer likely ISCO-08 occupation group codes from free-form user domains.',
    'Return ONLY JSON with shape: {"inferred":[{"code":"<1-4 digit code>","score":<number>}]}.',
    'Scores can be unnormalized; they will be normalized downstream.',
    `Domains: ${JSON.stringify(normalizedDomains)}`
  ].join('\n');

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an ISCO occupation classifier.' },
        { role: 'user', content: prompt }
      ]
    });
    const raw = response?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    const inferred = Array.isArray(parsed?.inferred) ? parsed.inferred : [];
    const scoreMap = {};
    for (const row of inferred) {
      const code = String(row?.code || '').trim();
      const score = Number(row?.score);
      if (!ISCO_CODE_PATTERN.test(code) || !Number.isFinite(score) || score <= 0) continue;
      scoreMap[code] = (scoreMap[code] || 0) + score;
    }
    return normalizeScoreMap(scoreMap);
  } catch (_) {
    return [];
  }
}

async function inferIscoFromDomains(domains, { method = 'llm_or_rule', lang = 'en' } = {}) {
  // ENGLISH_ONLY_PIPELINE: ISCO inference must run on English-normalized domain text.
  const language = String(lang || 'en').toLowerCase().split('-')[0] || 'en';
  const rawDomains = sanitizeDomains(domains);
  const normalizedDomains = [];
  for (const domain of rawDomains) {
    const normalizedDomain = await normalizeForProcessing(domain, language, translateText);
    normalizedDomains.push(String(normalizedDomain || '').trim());
  }
  const safeDomains = sanitizeDomains(normalizedDomains);
  if (safeDomains.length === 0) {
    return { methodUsed: 'none', inferred: [] };
  }

  if (method === 'rule_based') {
    return { methodUsed: 'rule_based', inferred: inferIscoRuleBased(safeDomains) };
  }

  const llm = await inferIscoLlm(safeDomains);
  if (llm.length > 0) {
    return { methodUsed: 'llm', inferred: llm };
  }
  return { methodUsed: 'rule_based', inferred: inferIscoRuleBased(safeDomains) };
}

module.exports = {
  inferIscoFromDomains,
  inferIscoRuleBased,
  sanitizeDomains,
  ISCO_CODE_PATTERN,
};
