/**
 * Shared i18n label resolution for career-path questionnaire questions/options.
 * Kept in one place so the questionnaire and the answers editor render identical
 * labels for the same audience + question + option value.
 */

export function booleanOptionKey(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'maybe';
}

/**
 * Resolve the localized question text.
 * @param {(key: string, opts?: object) => string} t
 * @param {string} audience
 * @param {string} questionId
 */
export function resolveQuestionText(t, audience, questionId) {
  const audienceKey = audience || 'career';
  return t(
    `careerPathPlanning.questionnaire.audiences.${audienceKey}.questions.${questionId}.question`
  );
}

/**
 * Resolve the short keyword title for a question (used above the answer dropdowns).
 * @param {(key: string, opts?: object) => string} t
 * @param {string} audience
 * @param {string} questionId
 */
export function resolveQuestionKeyword(t, audience, questionId) {
  const audienceKey = audience || 'career';
  return t(
    `careerPathPlanning.questionnaire.audiences.${audienceKey}.questions.${questionId}.short`
  );
}

/**
 * Resolve the localized label for a single option value.
 * @param {(key: string, opts?: object) => string} t
 * @param {string} audience
 * @param {string} questionId
 * @param {string | boolean} value
 */
export function resolveOptionLabel(t, audience, questionId, value) {
  const audienceKey = audience || 'career';
  if (value === true || value === false || value === 'unsure') {
    return t(
      `careerPathPlanning.questionnaire.audiences.${audienceKey}.questions.${questionId}.options.${booleanOptionKey(value)}`,
      {
        defaultValue: t(
          `careerPathPlanning.questionnaire.shared.boolean.${booleanOptionKey(value)}`
        ),
      }
    );
  }
  return t(
    `careerPathPlanning.questionnaire.audiences.${audienceKey}.questions.${questionId}.options.${value}`
  );
}

/**
 * Encode an option value (which may be a boolean) into a stable string key so it
 * can be used safely as a MUI <Select> / <MenuItem> value.
 */
export function encodeOptionValue(value) {
  if (value === true) return 'bool:true';
  if (value === false) return 'bool:false';
  return `val:${value}`;
}

/** Decode a string key produced by {@link encodeOptionValue} back to its value. */
export function decodeOptionValue(encoded) {
  if (encoded === 'bool:true') return true;
  if (encoded === 'bool:false') return false;
  if (typeof encoded === 'string' && encoded.startsWith('val:')) return encoded.slice(4);
  return encoded;
}
