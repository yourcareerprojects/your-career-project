const logger = require('../../utils/logger');
const { getCvQueueMetricsLogIntervalMs } = require('../../../constants/cvExtractionQueueMetrics');
const {
  getCvExtractionQueueActiveMetrics,
  deriveQueueSignals,
} = require('./cvExtractionQueueMetricsService');

/**
 * Periodic structured queue-state logs (worker or server process).
 * Tracks queued depth between samples to surface backlog growth.
 * @param {{ intervalMs?: number, source?: string }} [config]
 * @returns {{ start: () => void, stop: () => void, tick: () => Promise<void> }}
 */
function createCvQueueMetricsLogLoop(config = {}) {
  const intervalMs = config.intervalMs ?? getCvQueueMetricsLogIntervalMs();
  const source = config.source || 'cv-extraction-worker';
  let timer = null;
  let stopped = false;
  let previousQueued = null;

  async function tick() {
    if (stopped) return;
    try {
      const active = await getCvExtractionQueueActiveMetrics();
      const signals = deriveQueueSignals(
        {
          counts: {
            ...active.counts,
            completed: 0,
            failed: 0,
          },
          ages: active.ages,
          meta: active.meta,
        },
        { previousQueued }
      );

      logger.info('cv_extraction_queue_metrics', {
        source,
        counts: active.counts,
        ages: active.ages,
        signals,
        sampledAt: active.meta.sampledAt,
      });

      previousQueued = active.counts.queued;
    } catch (err) {
      logger.warn('cv_extraction_queue_metrics_failed', {
        source,
        message: err?.message || String(err),
      });
    }
  }

  function start() {
    if (timer) return;
    void tick().catch(() => {});
    timer = setInterval(() => {
      void tick().catch(() => {});
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tick };
}

module.exports = {
  createCvQueueMetricsLogLoop,
};
