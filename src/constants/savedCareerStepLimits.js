/**
 * Max characters per locale (en / de) for saved career step descriptions.
 * Long LLM-generated occupation narratives can exceed typical UI limits; this stays
 * bounded for BSON and validation while allowing full career-path text.
 */
const MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH = 100000;

module.exports = {
  MAX_SAVED_CAREER_STEP_DESCRIPTION_LENGTH,
};
