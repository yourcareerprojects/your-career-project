/**
 * Audience-aware questionnaire definitions for career path planning.
 * Question IDs and option values are owned here; UI labels live in client i18n.
 */

const {
  resolvePathPlanningAudience,
} = require('../../../prompts/careerPathCoachingPrompts');

/** @typedef {'pupil' | 'student' | 'career' | 'senior'} PathPlanningAudience */

const PATH_PLANNING_AUDIENCES = Object.freeze(['pupil', 'student', 'career', 'senior']);

/**
 * Ordered preference fields required per audience.
 * @type {Record<PathPlanningAudience, string[]>}
 */
const QUESTION_FIELDS_BY_AUDIENCE = Object.freeze({
  pupil: ['educationPreference', 'apprenticeship', 'university'],
  student: ['studyPace', 'extraQualification'],
  career: ['timeline', 'gapClosing', 'moveType'],
  senior: ['scope', 'changePace', 'constraints'],
});

/**
 * Allowed option values per preference field (excluding boolean-style fields).
 */
const ENUM_OPTION_VALUES = Object.freeze({
  educationPreference: ['work', 'school', 'unsure'],
  studyPace: ['finish_first', 'start_sooner', 'unsure'],
  timeline: ['asap', 'one_to_two_years', 'exploring'],
  gapClosing: ['on_the_job', 'courses', 'further_degree', 'unsure'],
  moveType: ['deepen', 'pivot', 'leadership'],
  scope: ['ic', 'leadership', 'hybrid'],
  changePace: ['gradual', 'decisive', 'exploring'],
  constraints: ['flexible', 'geography', 'industry', 'both'],
});

const BOOLEAN_PREFERENCE_FIELDS = new Set(['apprenticeship', 'university', 'extraQualification']);

/**
 * @param {PathPlanningAudience | string} audience
 * @returns {PathPlanningAudience}
 */
function normalizePathPlanningAudience(audience) {
  const value = String(audience || '').trim();
  if (PATH_PLANNING_AUDIENCES.includes(value)) return value;
  return 'career';
}

/**
 * @param {PathPlanningAudience | string} [audience]
 * @returns {string[]}
 */
function getPreferenceFieldsForAudience(audience) {
  const key = normalizePathPlanningAudience(audience);
  return [...QUESTION_FIELDS_BY_AUDIENCE[key]];
}

/**
 * Build the questionnaire payload returned to the client.
 * Labels are resolved client-side from i18n using audience + question id + option value.
 * @param {PathPlanningAudience | string} audience
 * @returns {{
 *   audience: PathPlanningAudience,
 *   questionIds: string[],
 *   questions: Array<{ id: string, type: 'enum' | 'boolean', options: Array<string | boolean> }>
 * }}
 */
function buildQuestionnairePayload(audience) {
  const normalized = normalizePathPlanningAudience(audience);
  const questionIds = getPreferenceFieldsForAudience(normalized);

  const questions = questionIds.map((id) => {
    if (BOOLEAN_PREFERENCE_FIELDS.has(id)) {
      return {
        id,
        type: 'boolean',
        options: [true, 'unsure', false],
      };
    }
    return {
      id,
      type: 'enum',
      options: [...(ENUM_OPTION_VALUES[id] || [])],
    };
  });

  return {
    audience: normalized,
    questionIds,
    questions,
  };
}

module.exports = {
  PATH_PLANNING_AUDIENCES,
  QUESTION_FIELDS_BY_AUDIENCE,
  ENUM_OPTION_VALUES,
  BOOLEAN_PREFERENCE_FIELDS,
  resolvePathPlanningAudience,
  normalizePathPlanningAudience,
  getPreferenceFieldsForAudience,
  buildQuestionnairePayload,
};
