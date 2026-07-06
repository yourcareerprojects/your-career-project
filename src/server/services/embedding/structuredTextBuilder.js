/**
 * Builds canonicalized structured text blocks for deterministic embedding.
 *
 * No prose. No filler words. No narrative.
 * Just canonicalized tokens grouped by category.
 *
 * Supports category-weighted fusion: build separate texts per category,
 * embed each, then fuse with mode-specific weights.
 *
 * @module services/embedding/structuredTextBuilder
 */

const { getEnglishField } = require('../../utils/i18nFields');

/**
 * Canonicalize a token: lowercase, strip non-alphanumeric, collapse whitespace.
 */
function canonicalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build text for SKILL_DOMAINS category (abstract competency clusters).
 */
function buildSkillDomainsText(doc) {
  const domains = doc.skillDomains?.skill_domains || [];
  const names = domains
    .map((d) => (d?.domain != null ? getEnglishField(d.domain) : ''))
    .filter(Boolean);
  if (names.length === 0) return '';
  return names.map(canonicalize).join('\n');
}

/**
 * Build text for OCCUPATION_GROUP category (ISCO sector/industry).
 * Uses doc.iscoGroup (e.g. "2654") → labels via resolveIscoToLabels.
 * Matches user profile's occupation_group (from domains + inferred ISCO).
 */
function buildOccupationGroupText(doc) {
  const { buildOccupationGroupText: buildIscoText } = require('./iscoMapping');
  const raw = buildIscoText(doc);
  if (!raw) return '';
  return raw
    .split('\n')
    .map((s) => canonicalize(s))
    .filter(Boolean)
    .join('\n');
}

/**
 * Build text for REQUIRED SKILLS category only.
 */
function buildRequiredSkillsText(doc) {
  const skills = doc.skillModel?.core_skills || doc.requiredSkills || [];
  if (skills.length === 0) return '';
  return skills.map(canonicalize).join('\n');
}

/**
 * Build text for RESPONSIBILITIES category only.
 */
function buildResponsibilitiesText(doc) {
  const responsibilities = doc.keyResponsibilities?.responsibilities || [];
  if (responsibilities.length === 0) return '';
  return responsibilities.map(canonicalize).join('\n');
}

/**
 * Build text for OPTIONAL SKILLS category only.
 */
function buildOptionalSkillsText(doc) {
  const skills = doc.skillModel?.optional_skills || [];
  if (skills.length === 0) return '';
  return skills.map(canonicalize).join('\n');
}

/**
 * Build all structured category texts (no seniority — seniority is handled via similarity penalty only).
 *
 * Canonical structured fusion order (shared by user/role vector builders):
 * 1) skill_domains
 * 2) occupation_group
 * 3) responsibilities
 * 4) required_skills
 * 5) optional_skills
 */
function buildStructuredCategoryTexts(doc) {
  return {
    skill_domains: buildSkillDomainsText(doc),
    occupation_group: buildOccupationGroupText(doc),
    required_skills: buildRequiredSkillsText(doc),
    responsibilities: buildResponsibilitiesText(doc),
    optional_skills: buildOptionalSkillsText(doc),
  };
}

/**
 * Build the full structured text block (legacy single-block format).
 *
 * @param {object} doc – CareerPath document (or lean object)
 * @returns {string}
 */
function buildStructuredText(doc) {
  const parts = [];
  const cats = buildStructuredCategoryTexts(doc);

  if (cats.occupation_group) {
    parts.push('OCCUPATION_GROUP:');
    parts.push(cats.occupation_group);
    parts.push('');
  }
  if (cats.skill_domains) {
    parts.push('SKILL_DOMAINS:');
    parts.push(cats.skill_domains);
    parts.push('');
  }
  if (cats.responsibilities) {
    parts.push('RESPONSIBILITIES:');
    parts.push(cats.responsibilities);
    parts.push('');
  }
  if (cats.required_skills) {
    parts.push('REQUIRED SKILLS:');
    parts.push(cats.required_skills);
    parts.push('');
  }
  if (cats.optional_skills) {
    parts.push('OPTIONAL SKILLS:');
    parts.push(cats.optional_skills);
    parts.push('');
  }

  return parts.join('\n').trim();
}

/** Weights for NEXT_ROLE (conservative, skill-adjacent). Sum = 1. */
const WEIGHTS_NEXT_ROLE = {
  skill_domains: 0.3,
  occupation_group: 0.15,
  required_skills: 0.3,
  responsibilities: 0.2,
  optional_skills: 0.05,
};

/** Weights for OUT_OF_THE_BOX (explorative, identity-adjacent). Sum = 1. */
const WEIGHTS_OUT_OF_THE_BOX = {
  skill_domains: 0.25,
  occupation_group: 0.2,
  required_skills: 0.15,
  responsibilities: 0.25,
  optional_skills: 0.15,
};

module.exports = {
  buildStructuredText,
  buildStructuredCategoryTexts,
  buildSkillDomainsText,
  buildOccupationGroupText,
  buildRequiredSkillsText,
  buildResponsibilitiesText,
  buildOptionalSkillsText,
  canonicalize,
  WEIGHTS_NEXT_ROLE,
  WEIGHTS_OUT_OF_THE_BOX,
};
