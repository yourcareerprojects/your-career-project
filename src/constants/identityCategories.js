/**
 * Extensible registry of Career Identity trait categories.
 * Categories are configuration-driven — add entries here without schema migrations.
 */
const IDENTITY_CATEGORIES = [
  'values',
  'interests',
  'strengths',
  'work_style',
  'thinking_style',
  'motivation',
  'environment',
  'communication',
  'leadership',
  'problem_solving',
  'learning',
  'social_orientation',
];

const IDENTITY_CATEGORY_SET = new Set(IDENTITY_CATEGORIES);

function isIdentityCategory(value) {
  return IDENTITY_CATEGORY_SET.has(String(value || '').trim());
}

module.exports = {
  IDENTITY_CATEGORIES,
  IDENTITY_CATEGORY_SET,
  isIdentityCategory,
};
