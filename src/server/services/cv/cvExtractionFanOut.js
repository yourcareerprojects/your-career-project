/**
 * Event-driven fan-out after heuristics: identity and structured start in parallel.
 */

const logger = require('../../utils/logger');
const { interpretCvIdentityText } = require('../documents/semanticCvInterpreter');
const { resolveStructuredSemanticInterpretation } = require('./cvSemanticCompose');
const {
  createCvExtractionState,
  completeHeuristics,
  markLayer,
  onCvExtractionEvent,
  CV_HEURISTICS_COMPLETED,
} = require('./cvExtractionStateManager');
const { persistIdentityReviewBaseline } = require('../documents/cvExtractionProgressPersist');
const { CV_IDENTITY_REVIEW_FALLBACK_MS } = require('../../../constants/cvExtractionLayerTiming');
const { normalizeExternalApiError, isTimeoutLikeError } = require('../../utils/httpTimeouts');
const { getCvPipeline, logCvEvent, serializeErrorSafe } = require('../../utils/metricsLogger');

/** @type {Map<string, { identity: Promise<unknown>, structured: Promise<unknown> }>} */
const fanOutByJobId = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} layer
 * @param {() => Promise<unknown>} fn
 * @param {{ semanticAiTimedOutRef: { value: boolean } }} ctx
 */
async function runSemanticLayer(layer, fn, ctx) {
  try {
    return await fn();
  } catch (error) {
    const norm = normalizeExternalApiError(error);
    logger.warn('Semantic CV interpretation failed', {
      layer,
      ...(getCvPipeline() ? { requestId: getCvPipeline().requestId } : {}),
      ...norm,
    });
    if (getCvPipeline()) {
      logCvEvent(`interpret_cv_${layer}_outer_failed`, {
        ok: false,
        ...serializeErrorSafe(error),
      });
    }
    if (isTimeoutLikeError(error)) {
      ctx.semanticAiTimedOutRef.value = true;
    }
    return null;
  }
}

/**
 * @param {string} text
 * @param {object} options
 * @param {string} options.jobId
 * @param {string} [options.userId]
 * @param {string} [options.documentId]
 * @param {import('./cvExtractionOrchestrator').CvUiLang} [options.uiLanguage]
 * @param {string} options.cvLang
 * @param {object} options.heuristicResult
 * @param {{ semanticAiTimedOutRef: { value: boolean } }} options.ctx
 */
async function emitHeuristicsCompletedAndFanOut(text, options) {
  const { jobId, userId, documentId, cvLang, heuristicResult, ctx } = options;

  createCvExtractionState(jobId, { userId, documentId });
  await completeHeuristics(jobId, heuristicResult);

  if (fanOutByJobId.has(jobId)) {
    return fanOutByJobId.get(jobId);
  }

  const identityPromise = runSemanticLayer(
    'identity',
    () => interpretCvIdentityText(text, { documentLanguage: cvLang }),
    ctx
  ).then(async (result) => {
    await markLayer(jobId, 'identity', result ? 'done' : 'failed', result);
    if (userId && documentId) {
      await persistIdentityReviewBaseline(userId, documentId, heuristicResult, result);
    }
    return result;
  });

  const structuredPromise = runSemanticLayer(
    'structured',
    () => resolveStructuredSemanticInterpretation(text, cvLang),
    ctx
  ).then(async (result) => {
    await markLayer(jobId, 'structured', result ? 'done' : 'failed', result);
    return result;
  });

  const handles = { identity: identityPromise, structured: structuredPromise };
  fanOutByJobId.set(jobId, handles);

  Promise.allSettled([identityPromise, structuredPromise]).finally(() => {
    fanOutByJobId.delete(jobId);
  });

  return handles;
}

/**
 * Wait for identity LLM to finish (no UX timeout). Used for the worker's final persistence bundle.
 * @param {string} jobId
 */
async function awaitIdentityCompletion(jobId) {
  const handles = fanOutByJobId.get(jobId);
  if (!handles) return null;
  return handles.identity.catch(() => null);
}

/**
 * Wait for identity with UX fallback timeout — poll/readiness only, not worker persistence.
 * @param {string} jobId
 * @param {{ fallbackMs?: number }} [options]
 */
async function awaitIdentityForInitialBundle(jobId, options = {}) {
  const handles = fanOutByJobId.get(jobId);
  if (!handles) return null;
  const fallbackMs = options.fallbackMs ?? CV_IDENTITY_REVIEW_FALLBACK_MS;
  return Promise.race([
    handles.identity.catch(() => null),
    delay(fallbackMs).then(() => null),
  ]);
}

/**
 * @param {string} jobId
 * @returns {Promise<unknown|null>}
 */
function getStructuredResultIfSettled(jobId) {
  const handles = fanOutByJobId.get(jobId);
  if (!handles) return Promise.resolve(null);
  return handles.structured.catch(() => null);
}

function resetCvExtractionFanOutForTests() {
  fanOutByJobId.clear();
}

/**
 * Inline fan-out (no job state / incremental persist) — sync extraction and unit tests.
 * @param {string} text
 * @param {object} options — same shape as emitHeuristicsCompletedAndFanOut minus jobId requirement
 */
async function runInlineSemanticFanOut(text, options) {
  const { cvLang, heuristicResult, ctx } = options;
  const identityPromise = runSemanticLayer(
    'identity',
    () => interpretCvIdentityText(text, { documentLanguage: cvLang }),
    ctx
  );
  const structuredPromise = runSemanticLayer(
    'structured',
    () => resolveStructuredSemanticInterpretation(text, cvLang),
    ctx
  );
  const identitySemantic = await identityPromise.catch(() => null);
  void structuredPromise.catch(() => {});
  return { identitySemantic, structuredPromise };
}

module.exports = {
  emitHeuristicsCompletedAndFanOut,
  awaitIdentityCompletion,
  awaitIdentityForInitialBundle,
  getStructuredResultIfSettled,
  runInlineSemanticFanOut,
  onCvExtractionEvent,
  CV_HEURISTICS_COMPLETED,
  resetCvExtractionFanOutForTests,
};
