const { inferHighestDegreeFromText } = require('../../../constants/highestDegree');
const {
  inferMostSeniorRoleFromText,
  inferMostSeniorFromJobTitles,
} = require('../../../constants/senioritySelectOptions');

function normalizeString(value, maxLen = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/** Map education / LLM text to highestDegree slug (passes through canonical slugs). */
function safeDegreeFromText(text) {
  return inferHighestDegreeFromText(text);
}

function mapMostSeniorRole(raw) {
  return inferMostSeniorRoleFromText(raw);
}

function bulletsToText(field, maxLen = 500) {
  const bullets = Array.isArray(field?.bullets)
    ? field.bullets.map((b) => normalizeString(b, 140)).filter(Boolean)
    : [];
  return normalizeString(bullets.join('\n'), maxLen);
}

module.exports = {
  normalizeString,
  safeDegreeFromText,
  mapMostSeniorRole,
  inferMostSeniorFromJobTitles,
  bulletsToText,
};
