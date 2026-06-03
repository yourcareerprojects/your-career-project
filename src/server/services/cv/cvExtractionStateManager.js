/**
 * Central CV extraction layer state (per job). Updated asynchronously by fan-out workers.
 */

const { EventEmitter } = require('events');
const CvExtractionJob = require('../../models/CvExtractionJob');
const {
  CV_HEURISTICS_COMPLETED,
  CV_IDENTITY_COMPLETED,
  CV_STRUCTURED_COMPLETED,
  CV_NARRATIVE_COMPLETED,
} = require('../../../constants/cvExtractionEvents');

/** @typedef {'pending'|'done'|'failed'|'skipped'} CvLayerStatus */

/**
 * @typedef {object} CVExtractionState
 * @property {string} jobId
 * @property {import('mongoose').Types.ObjectId|string|null} userId
 * @property {import('mongoose').Types.ObjectId|string|null} documentId
 * @property {unknown|null} heuristics
 * @property {unknown|null} identity
 * @property {unknown|null} structured
 * @property {unknown|null} narrative
 * @property {{ heuristics: CvLayerStatus, identity: CvLayerStatus, structured: CvLayerStatus, narrative: CvLayerStatus }} status
 * @property {number} [heuristicsCompletedAt]
 */

const bus = new EventEmitter();
bus.setMaxListeners(50);

/** @type {Map<string, CVExtractionState>} */
const memoryByJobId = new Map();

function defaultLayerStatus() {
  return {
    heuristics: /** @type {CvLayerStatus} */ ('pending'),
    identity: /** @type {CvLayerStatus} */ ('pending'),
    structured: /** @type {CvLayerStatus} */ ('pending'),
    narrative: /** @type {CvLayerStatus} */ ('pending'),
  };
}

/**
 * @param {string} jobId
 * @param {{ userId?: string, documentId?: string }} [seed]
 * @returns {CVExtractionState}
 */
function createCvExtractionState(jobId, seed = {}) {
  const state = {
    jobId: String(jobId),
    userId: seed.userId ?? null,
    documentId: seed.documentId ?? null,
    heuristics: null,
    identity: null,
    structured: null,
    narrative: null,
    status: defaultLayerStatus(),
    heuristicsCompletedAt: undefined,
  };
  memoryByJobId.set(state.jobId, state);
  return state;
}

/**
 * @param {string} jobId
 * @returns {CVExtractionState|undefined}
 */
function getCvExtractionState(jobId) {
  return memoryByJobId.get(String(jobId));
}

/**
 * @param {CVExtractionState} state
 */
function emitStateEvent(eventName, state) {
  bus.emit(eventName, { ...state, status: { ...state.status } });
}

/**
 * Persist layer status snapshot on the job row (atomic, idempotent per transition).
 * @param {string} jobId
 * @param {Partial<CVExtractionState['status']>} statusPatch
 */
async function persistJobLayerStatus(jobId, statusPatch) {
  const setFields = {};
  for (const [layer, value] of Object.entries(statusPatch)) {
    if (value != null) {
      setFields[`extractionLayers.${layer}`] = value;
    }
  }
  if (statusPatch.heuristics === 'done') {
    setFields.heuristicsCompletedAt = new Date();
  }
  if (Object.keys(setFields).length === 0) return;
  await CvExtractionJob.updateOne({ jobId: String(jobId) }, { $set: setFields });
}

/**
 * @param {string} jobId
 * @param {'heuristics'|'identity'|'structured'|'narrative'} layer
 * @param {CvLayerStatus} nextStatus
 * @param {unknown} [payload]
 */
async function markLayer(jobId, layer, nextStatus, payload = undefined) {
  const state = getCvExtractionState(jobId) || createCvExtractionState(jobId);
  const prev = state.status[layer];
  if (prev === 'done' || prev === 'failed' || prev === 'skipped') {
    return state;
  }
  state.status[layer] = nextStatus;
  if (payload !== undefined) {
    state[layer] = payload;
  }
  if (layer === 'heuristics' && nextStatus === 'done') {
    state.heuristicsCompletedAt = Date.now();
  }
  memoryByJobId.set(state.jobId, state);
  await persistJobLayerStatus(jobId, { [layer]: nextStatus });

  if (layer === 'heuristics' && nextStatus === 'done') {
    emitStateEvent(CV_HEURISTICS_COMPLETED, state);
  } else if (layer === 'identity' && nextStatus === 'done') {
    emitStateEvent(CV_IDENTITY_COMPLETED, state);
  } else if (layer === 'structured' && nextStatus === 'done') {
    emitStateEvent(CV_STRUCTURED_COMPLETED, state);
  } else if (layer === 'narrative' && (nextStatus === 'done' || nextStatus === 'skipped')) {
    emitStateEvent(CV_NARRATIVE_COMPLETED, state);
  }
  return state;
}

/**
 * @param {string} jobId
 * @param {unknown} heuristicResult
 */
async function completeHeuristics(jobId, heuristicResult) {
  const state = getCvExtractionState(jobId) || createCvExtractionState(jobId);
  state.heuristics = heuristicResult;
  await markLayer(jobId, 'heuristics', 'done', heuristicResult);
  return state;
}

/**
 * @param {string} eventName
 * @param {(state: CVExtractionState) => void} handler
 */
function onCvExtractionEvent(eventName, handler) {
  bus.on(eventName, handler);
  return () => bus.off(eventName, handler);
}

/**
 * @param {object|null|undefined} job
 * @returns {CVExtractionState['status']}
 */
function layerStatusFromJob(job) {
  const layers = job?.extractionLayers;
  const base = defaultLayerStatus();
  if (!layers || typeof layers !== 'object') return base;
  for (const key of Object.keys(base)) {
    const raw = String(layers[key] ?? '').trim().toLowerCase();
    if (raw === 'done' || raw === 'failed' || raw === 'skipped' || raw === 'pending') {
      base[key] = raw;
    }
  }
  return base;
}

function resetCvExtractionStateForTests() {
  memoryByJobId.clear();
  bus.removeAllListeners();
}

module.exports = {
  createCvExtractionState,
  getCvExtractionState,
  completeHeuristics,
  markLayer,
  onCvExtractionEvent,
  layerStatusFromJob,
  resetCvExtractionStateForTests,
  CV_HEURISTICS_COMPLETED,
  CV_IDENTITY_COMPLETED,
  CV_STRUCTURED_COMPLETED,
  CV_NARRATIVE_COMPLETED,
};
