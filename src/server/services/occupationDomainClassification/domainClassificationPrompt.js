/**
 * Prompt builders for occupation → industry domain classification.
 * @module services/occupationDomainClassification/domainClassificationPrompt
 */

const { INDUSTRY_CANONICAL_LABELS } = require('../../../constants/industries');
const { getLocalizedFieldLenient } = require('../../utils/i18nFields');
const { resolveIscoToLabels, formatLabelForDisplay } = require('../embedding/iscoMapping');

const MAX_LIST_ITEMS = 20;
const MAX_DESCRIPTION_CHARS = 2500;

/**
 * @param {unknown} value
 * @returns {string}
 */
function asEnglishText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    return String(getLocalizedFieldLenient(value, 'en') || '').trim();
  }
  return String(value).trim();
}

/**
 * @param {unknown} items
 * @param {number} [limit]
 * @returns {string[]}
 */
function asStringList(items, limit = MAX_LIST_ITEMS) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items) {
    const text = asEnglishText(item);
    if (!text) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Build a compact occupation snapshot for the classifier prompt.
 * @param {object} occupation – CareerPath lean doc
 */
function buildOccupationClassificationInput(occupation = {}) {
  const title = asEnglishText(occupation.title);
  const description = asEnglishText(occupation.description).slice(0, MAX_DESCRIPTION_CHARS);
  const altTitles = asStringList(occupation.altTitles);

  const responsibilities = asStringList(
    occupation.keyResponsibilities?.responsibilities
  );

  const requiredSkills = asStringList(
    occupation.skillModel?.core_skills?.length
      ? occupation.skillModel.core_skills
      : occupation.requiredSkills
  );

  const optionalSkills = asStringList(occupation.skillModel?.optional_skills);

  const skillDomainLabels = asStringList(
    (occupation.skillDomains?.skill_domains || []).map((sd) => sd?.domain)
  );

  const iscoGroup = occupation.iscoGroup ? String(occupation.iscoGroup).trim() : '';
  const iscoLabels = resolveIscoToLabels(iscoGroup).map(formatLabelForDisplay);

  return {
    escoId: occupation.escoId || null,
    title: title || null,
    alternativeTitles: altTitles,
    description: description || null,
    responsibilities,
    requiredSkills,
    optionalSkills,
    iscoGroup: iscoGroup || null,
    iscoGroupLabels: iscoLabels,
    skillDomains: skillDomainLabels,
  };
}

/**
 * @returns {string}
 */
function buildAllowedDomainsBlock() {
  return INDUSTRY_CANONICAL_LABELS.map((label) => `- ${label}`).join('\n');
}

/**
 * @param {object} occupationInput – from buildOccupationClassificationInput
 * @returns {{ system: string, user: string }}
 */
function buildClassificationMessages(occupationInput) {
  const system = [
    'You classify ESCO occupations into exactly one industry / economic-sector domain.',
    'Select the domain that best matches the PRIMARY WORK CONTEXT of the occupation',
    '(what the role does), not the sector of a possible employer.',
    '',
    'Example: a software developer who might work in a hospital → Software (not Healthcare).',
    'Example: a veterinarian or animal keeper → Animals and Veterinary (not Healthcare, not Agriculture).',
    '',
    'Rules:',
    '- Choose exactly ONE domain from the allowed list.',
    '- Never invent a new domain name.',
    '- Prefer the occupation\'s core craft over incidental workplace setting.',
    '- Return valid JSON only with keys: domain, confidence, reason.',
    '- confidence must be a number between 0 and 1.',
    '',
    'Allowed domains:',
    buildAllowedDomainsBlock(),
  ].join('\n');

  const user = [
    'Classify this occupation into exactly one allowed domain.',
    '',
    'Occupation data (JSON):',
    JSON.stringify(occupationInput, null, 2),
    '',
    'Respond with JSON only, for example:',
    JSON.stringify(
      {
        domain: 'Software',
        confidence: 0.97,
        reason: 'The occupation primarily develops software systems.',
      },
      null,
      2
    ),
  ].join('\n');

  return { system, user };
}

/**
 * @param {object} occupation – CareerPath lean doc
 * @returns {{ role: string, content: string }[]}
 */
function buildClassificationChatMessages(occupation) {
  const input = buildOccupationClassificationInput(occupation);
  const { system, user } = buildClassificationMessages(input);
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Follow-up when the model returned a domain outside the allowed list.
 * @param {string} invalidDomain
 * @returns {{ role: string, content: string }}
 */
function buildDomainCorrectionMessage(invalidDomain) {
  return {
    role: 'user',
    content: [
      `Your previous answer used domain "${invalidDomain}", which is NOT in the allowed list.`,
      'Choose again. The "domain" value MUST be copied exactly from the allowed list above.',
      'Do not invent synonyms, broader categories, or niche labels.',
      'Return JSON only with keys: domain, confidence, reason.',
    ].join('\n'),
  };
}

module.exports = {
  buildOccupationClassificationInput,
  buildClassificationMessages,
  buildClassificationChatMessages,
  buildDomainCorrectionMessage,
  buildAllowedDomainsBlock,
  asEnglishText,
  asStringList,
  INDUSTRY_CANONICAL_LABELS,
};
