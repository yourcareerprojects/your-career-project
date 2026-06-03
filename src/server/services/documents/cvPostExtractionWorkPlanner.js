const { CV_POST_EXTRACTION_HEURISTIC_RETRY_MESSAGE_KEYS } = require('../../../constants/cvPostExtractionWork');

/** @typedef {'structuredSemantic'|'narrative'} PostExtractionTask */

/**
 * @typedef {object} PostExtractionPlanInput
 * @property {string|null|undefined} semanticEnrichmentStatus
 * @property {string|null|undefined} localizationStatus
 * @property {string|null|undefined} messageKey
 * @property {string|null|undefined} narrativeEnrichmentStatus
 */

/**
 * @typedef {object} PostExtractionPlanItem
 * @property {PostExtractionTask} task
 * @property {string} reason
 */

/**
 * @param {unknown} value
 */
function str(value) {
  return value != null ? String(value).trim() : '';
}

/**
 * @param {PostExtractionPlanInput} input
 */
function isSemanticPending(input) {
  return str(input.semanticEnrichmentStatus) === 'pending';
}

/**
 * @param {PostExtractionPlanInput} input
 */
function needsDeferredStructuredSemantic(input) {
  const status = str(input.semanticEnrichmentStatus);
  const messageKey = str(input.messageKey);
  if (status === 'pending') return true;
  if (status === 'skipped' && CV_POST_EXTRACTION_HEURISTIC_RETRY_MESSAGE_KEYS.has(messageKey)) {
    return true;
  }
  return false;
}

/**
 * Narrative only after structured work is settled (not pending, no heuristic retry).
 * @param {PostExtractionPlanInput} input
 */
function structuredSettledForNarrative(input) {
  return !isSemanticPending(input) && !needsDeferredStructuredSemantic(input);
}

/**
 * @param {PostExtractionPlanInput} input
 */
function needsNarrativeEnrichment(input) {
  const status = str(input.narrativeEnrichmentStatus);
  if (status === 'complete' || status === 'skipped') return false;
  return true;
}

/**
 * Ordered rules — narrative waits for structured; both can still be scheduled from deferred structured completion.
 * @type {Array<{ task: PostExtractionTask, reason: string, when: (input: PostExtractionPlanInput) => boolean }>}
 */
const POST_EXTRACTION_WORK_RULES = [
  {
    task: 'structuredSemantic',
    reason: 'semantic_pending_or_heuristic_retry',
    when: needsDeferredStructuredSemantic,
  },
  {
    task: 'narrative',
    reason: 'structured_settled',
    when: (input) => structuredSettledForNarrative(input) && needsNarrativeEnrichment(input),
  },
];

/**
 * Pure plan: which background tasks to schedule. No I/O.
 * @param {PostExtractionPlanInput} input
 * @returns {PostExtractionPlanItem[]}
 */
function planPostExtractionWork(input) {
  const normalized = {
    semanticEnrichmentStatus: str(input.semanticEnrichmentStatus) || null,
    localizationStatus: str(input.localizationStatus) || null,
    messageKey: str(input.messageKey) || null,
    narrativeEnrichmentStatus: str(input.narrativeEnrichmentStatus) || null,
  };
  return POST_EXTRACTION_WORK_RULES.filter((rule) => rule.when(normalized)).map((rule) => ({
    task: rule.task,
    reason: rule.reason,
  }));
}

/**
 * @param {Record<string, unknown>} bundle — worker persistence payload
 * @returns {PostExtractionPlanInput}
 */
function postExtractionPlanInputFromBundle(bundle) {
  return {
    semanticEnrichmentStatus: bundle.semanticEnrichmentStatus ?? null,
    localizationStatus: bundle.localizationStatus ?? null,
    messageKey: bundle.messageKey ?? null,
    narrativeEnrichmentStatus: bundle.narrativeEnrichmentStatus ?? null,
  };
}

/**
 * @param {object} doc — embedded profile document after save
 * @returns {PostExtractionPlanInput}
 */
function postExtractionPlanInputFromDoc(doc) {
  return {
    semanticEnrichmentStatus: doc?.semanticEnrichmentStatus ?? null,
    localizationStatus: doc?.localizationStatus ?? null,
    messageKey: doc?.extractionMessageKey ?? null,
    narrativeEnrichmentStatus: doc?.narrativeEnrichmentStatus ?? null,
  };
}

module.exports = {
  POST_EXTRACTION_WORK_RULES,
  planPostExtractionWork,
  postExtractionPlanInputFromBundle,
  postExtractionPlanInputFromDoc,
  needsDeferredStructuredSemantic,
  needsNarrativeEnrichment,
  structuredSettledForNarrative,
  isSemanticPending,
};
