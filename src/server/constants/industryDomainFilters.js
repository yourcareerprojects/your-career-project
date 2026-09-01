/**
 * Labels that belong in skillDomains / skills / responsibilities — not in `domains`
 * (industry / economic sectors only — see `src/constants/industries.js`).
 */
const BLOCKED_NON_INDUSTRY_DOMAIN_PHRASES = new Set([
  'project management',
  'social media',
  'branding',
  'public relations',
  'corporate communications',
  'internal communications',
  'business development',
  'biz dev',
  'account management',
  'account executive',
  'customer success',
  'customer support',
  'human resources',
  'hr',
  'recruiting',
  'talent acquisition',
  'people operations',
  'people ops',
  'operations',
  'finance operations',
  'data analysis',
  'analytics',
  'business analysis',
  'business intelligence',
  'software engineering',
  'software development',
  'web development',
  'product management',
  'product owner',
  'program management',
  'project delivery',
  'design',
  'ux design',
  'ui design',
  'graphic design',
  'copywriting',
  'seo',
  'sem',
  'paid search',
  'event management',
  'office management',
  'administration',
  'quality assurance',
  'qa',
]);

function normalizeDomainKey(phrase) {
  return String(phrase || '')
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlockedNonIndustryDomain(raw) {
  return BLOCKED_NON_INDUSTRY_DOMAIN_PHRASES.has(normalizeDomainKey(raw));
}

/** Strip function-like labels from stored domain raw_items (API normalize / save). */
function filterIndustryDomainRawItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .filter((s) => !isBlockedNonIndustryDomain(s));
}

module.exports = {
  BLOCKED_NON_INDUSTRY_DOMAIN_PHRASES,
  filterIndustryDomainRawItems,
  isBlockedNonIndustryDomain,
  normalizeDomainKey,
};
