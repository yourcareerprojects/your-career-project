/**
 * Runs post-extraction plan items (structured semantic, narrative).
 * Used after persistence, after deferred structured completes, and by ensure-* routes.
 */

const User = require('../../models/User');
const {
  planPostExtractionWork,
  postExtractionPlanInputFromDoc,
} = require('./cvPostExtractionWorkPlanner');
const {
  runCvStructuredSemanticOnce,
  scheduleCvStructuredSemanticEnrichment,
  shouldRunStructuredSemanticEnrichment,
} = require('./deferredCvSemanticEnrichmentService');
const {
  runExtractionNarrativesOnce,
  scheduleExtractionNarrativeEnrichment,
  isExtractionNarrativeInFlight,
} = require('../profile/extractionNarrativeEnrichmentService');

/** @typedef {'structuredSemantic'|'narrative'} PostExtractionTask */

/**
 * @param {import('./cvPostExtractionWorkPlanner').PostExtractionPlanInput} input
 * @param {PostExtractionTask} task
 */
function planIncludesTask(input, task) {
  return planPostExtractionWork(input).some((item) => item.task === task);
}

/**
 * @param {object} doc
 * @param {PostExtractionTask} task
 */
function documentPlanIncludesTask(doc, task) {
  return planIncludesTask(postExtractionPlanInputFromDoc(doc), task);
}

/**
 * Whether an ensure-* call should run this task (plan gate + structured doc predicate).
 * @param {object} doc
 * @param {PostExtractionTask} task
 */
function shouldEnsurePostExtractionTask(doc, task) {
  if (documentPlanIncludesTask(doc, task)) return true;
  if (task === 'structuredSemantic') {
    return shouldRunStructuredSemanticEnrichment(doc);
  }
  return false;
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} documentId
 * @param {PostExtractionTask} task
 * @param {{ uiLanguage?: 'en'|'de', sourceLanguage?: string|null, awaitCompletion?: boolean }} [options]
 */
async function executePostExtractionTask(userId, documentId, task, options = {}) {
  const uiLanguage = options.uiLanguage === 'de' ? 'de' : 'en';
  const sourceLanguage = options.sourceLanguage ?? null;
  const awaitCompletion = options.awaitCompletion !== false;

  switch (task) {
    case 'structuredSemantic':
      if (awaitCompletion) {
        return runCvStructuredSemanticOnce(userId, documentId, { uiLanguage });
      }
      scheduleCvStructuredSemanticEnrichment(userId, documentId, { uiLanguage });
      return { skipped: false };
    case 'narrative': {
      const narrativeOptions = { sourceLanguage, language: sourceLanguage };
      if (awaitCompletion) {
        return runExtractionNarrativesOnce(userId, documentId, narrativeOptions);
      }
      scheduleExtractionNarrativeEnrichment(userId, documentId, narrativeOptions);
      return { skipped: false };
    }
    default:
      return { skipped: true, reason: 'unknown_task' };
  }
}

/**
 * Fire-and-forget each planned task (post-persistence / post-structured reschedule).
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} documentId
 * @param {import('./cvPostExtractionWorkPlanner').PostExtractionPlanInput} input
 * @param {{ uiLanguage?: 'en'|'de', sourceLanguage?: string|null }} [options]
 */
function schedulePostExtractionWork(userId, documentId, input, options = {}) {
  const plan = planPostExtractionWork(input);
  const sourceLanguage = options.sourceLanguage ?? null;
  const uiLanguage = options.uiLanguage === 'de' ? 'de' : 'en';

  for (const item of plan) {
    void executePostExtractionTask(userId, documentId, item.task, {
      uiLanguage,
      sourceLanguage,
      awaitCompletion: false,
    });
  }

  return plan;
}

/**
 * Ensure-* route entry: run a single task when the planner (or structured predicate) says it is needed.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} documentId
 * @param {PostExtractionTask} task
 * @param {{ uiLanguage?: 'en'|'de', awaitCompletion?: boolean }} [options]
 */
async function ensurePostExtractionTask(userId, documentId, task, options = {}) {
  const user = await User.findById(userId);
  if (!user) {
    return { skipped: true, reason: 'user_not_found' };
  }
  const doc = user.profile?.documents?.id(documentId);
  if (!doc) {
    return { skipped: true, reason: 'document_not_found' };
  }

  if (!shouldEnsurePostExtractionTask(doc, task)) {
    return { skipped: true, reason: 'not_in_plan' };
  }

  const sourceLanguage =
    doc.semanticInterpretationLanguage ||
    user.profile?.cvExtractLocalization?.documentLanguage ||
    null;

  return executePostExtractionTask(userId, documentId, task, {
    uiLanguage: options.uiLanguage,
    sourceLanguage,
    awaitCompletion: options.awaitCompletion !== false,
  });
}

/** @type {Map<string, number>} */
const reconcileThrottleMs = new Map();
const RECONCILE_MIN_INTERVAL_MS = 15_000;

/**
 * Re-schedule pending post-extraction tasks (throttled). Used by extraction-status polls
 * to recover when an earlier schedule failed (e.g. circular require during worker boot).
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} documentId
 * @param {object} doc
 */
function maybeSchedulePendingPostExtractionWork(userId, documentId, doc) {
  if (!userId || !documentId || !doc) return;
  if (isExtractionNarrativeInFlight(userId, documentId)) {
    return;
  }
  const key = `${String(userId)}:${String(documentId)}`;
  const now = Date.now();
  const last = reconcileThrottleMs.get(key) || 0;
  if (now - last < RECONCILE_MIN_INTERVAL_MS) return;

  const input = postExtractionPlanInputFromDoc(doc);
  const plan = planPostExtractionWork(input);
  if (plan.length === 0) return;

  reconcileThrottleMs.set(key, now);
  const uiLanguage = doc.semanticInterpretationLanguage === 'de' ? 'de' : 'en';
  const sourceLanguage =
    doc.semanticInterpretationLanguage ||
    doc.cvExtractLocalization?.documentLanguage ||
    null;
  schedulePostExtractionWork(userId, documentId, input, { uiLanguage, sourceLanguage });
}

module.exports = {
  executePostExtractionTask,
  schedulePostExtractionWork,
  ensurePostExtractionTask,
  maybeSchedulePendingPostExtractionWork,
  planIncludesTask,
  documentPlanIncludesTask,
  shouldEnsurePostExtractionTask,
};
