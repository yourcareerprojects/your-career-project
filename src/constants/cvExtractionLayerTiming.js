/**
 * UX timing — Step 2 may open on identity done OR this fallback after heuristics (poll only).
 * Worker persistence always awaits full identity LLM completion.
 */
const CV_IDENTITY_REVIEW_FALLBACK_MS = 2500;

module.exports = {
  CV_IDENTITY_REVIEW_FALLBACK_MS,
};
