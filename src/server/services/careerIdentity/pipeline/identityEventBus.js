/**
 * In-process event bus for Career Identity exploration pipeline.
 * Mirrors the CV extraction EventEmitter pattern (no external broker).
 */

const { EventEmitter } = require('events');
const { IDENTITY_PIPELINE_EVENTS } = require('../../../../constants/identityPipelineEvents');
const logger = require('../../../utils/logger');

const bus = new EventEmitter();
bus.setMaxListeners(50);

let handlersRegistered = false;

/**
 * @param {string} eventName
 * @param {object} payload
 */
function emitIdentityEvent(eventName, payload = {}) {
  logger.info('identity.pipeline.event_emitted', {
    eventName,
    userId: payload.userId ? String(payload.userId) : undefined,
    pipelineId: payload.pipelineId,
    triggerSource: payload.triggerSource,
  });
  bus.emit(eventName, payload);
}

/**
 * @param {string} eventName
 * @param {(payload: object) => void|Promise<void>} handler
 */
function onIdentityEvent(eventName, handler) {
  bus.on(eventName, (payload) => {
    Promise.resolve()
      .then(() => handler(payload))
      .catch((err) => {
        logger.error('identity.pipeline.handler_failed', {
          eventName,
          userId: payload?.userId ? String(payload.userId) : undefined,
          error: err,
        });
      });
  });
}

/**
 * Synchronous subscribe (no fire-and-forget wrapper). Use for SSE bridges that need removeListener.
 * @param {string} eventName
 * @param {(payload: object) => void} handler
 * @returns {() => void} unsubscribe
 */
function subscribeIdentityEvent(eventName, handler) {
  bus.on(eventName, handler);
  return () => bus.off(eventName, handler);
}

function removeAllIdentityEventListeners() {
  bus.removeAllListeners();
  handlersRegistered = false;
}

function markHandlersRegistered() {
  handlersRegistered = true;
}

function areHandlersRegistered() {
  return handlersRegistered;
}

module.exports = {
  IDENTITY_PIPELINE_EVENTS,
  emitIdentityEvent,
  onIdentityEvent,
  subscribeIdentityEvent,
  removeAllIdentityEventListeners,
  markHandlersRegistered,
  areHandlersRegistered,
  /** @private test helper */
  __bus: bus,
};
