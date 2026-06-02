const { CURRENT_EMPLOYMENT_STATUS_ALLOWED } = require('../../constants/currentEmploymentStatus');
const { HIGHEST_DEGREE_ALLOWED } = require('../../constants/highestDegree');
const { MOST_SENIOR_ALLOWED } = require('../../constants/senioritySelectOptions');

/**
 * Normalize review/profile seniority payload before save.
 * @param {object} raw
 * @returns {{ currentStatus: string, yearsOfExperience: number|null, highestDegree: string, mostSeniorWorkExperience: string }}
 */
function normalizeSeniorityPayload(raw = {}) {
  const seniority = raw && typeof raw === 'object' ? raw : {};
  let yearsOfExperience = null;
  const yearsRaw = seniority.yearsOfExperience;
  if (yearsRaw !== null && yearsRaw !== undefined && yearsRaw !== '') {
    const parsed = typeof yearsRaw === 'number' ? yearsRaw : Number.parseInt(String(yearsRaw), 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 50) {
      yearsOfExperience = parsed;
    }
  }
  return {
    currentStatus: String(seniority.currentStatus || '').trim(),
    yearsOfExperience,
    highestDegree: String(seniority.highestDegree || '').trim(),
    mostSeniorWorkExperience: String(seniority.mostSeniorWorkExperience || '').trim(),
  };
}

/**
 * Validate seniority fields (aligned with SeniorityForm + PUT /api/profile/seniority).
 * @param {object} raw
 * @returns {{ ok: true, value: ReturnType<typeof normalizeSeniorityPayload> } | { ok: false, field: string }}
 */
function validateSeniorityPayload(raw = {}) {
  const value = normalizeSeniorityPayload(raw);
  if (!value.currentStatus) {
    return { ok: false, field: 'currentStatus' };
  }
  if (!CURRENT_EMPLOYMENT_STATUS_ALLOWED.includes(value.currentStatus)) {
    return { ok: false, field: 'currentStatus' };
  }
  if (!value.highestDegree) {
    return { ok: false, field: 'highestDegree' };
  }
  if (!HIGHEST_DEGREE_ALLOWED.includes(value.highestDegree)) {
    return { ok: false, field: 'highestDegree' };
  }
  if (!value.mostSeniorWorkExperience) {
    return { ok: false, field: 'mostSeniorWorkExperience' };
  }
  if (!MOST_SENIOR_ALLOWED.includes(value.mostSeniorWorkExperience)) {
    return { ok: false, field: 'mostSeniorWorkExperience' };
  }
  return { ok: true, value };
}

/**
 * Compare normalized seniority payloads (for post-save verification).
 * @param {object} expected
 * @param {object} actual
 */
function seniorityPayloadsMatch(expected, actual) {
  const a = normalizeSeniorityPayload(expected);
  const b = normalizeSeniorityPayload(actual);
  return (
    a.currentStatus === b.currentStatus
    && a.yearsOfExperience === b.yearsOfExperience
    && a.highestDegree === b.highestDegree
    && a.mostSeniorWorkExperience === b.mostSeniorWorkExperience
  );
}

module.exports = {
  normalizeSeniorityPayload,
  validateSeniorityPayload,
  seniorityPayloadsMatch,
};
