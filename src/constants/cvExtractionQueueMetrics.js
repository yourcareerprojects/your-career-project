/**
 * CV extraction queue observability thresholds.
 */

/** Default interval for structured queue-state logs (worker process). */
const CV_QUEUE_METRICS_LOG_INTERVAL_MS_DEFAULT = 60_000;

function readPositiveIntEnv(name, fallback) {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getCvQueueMetricsLogIntervalMs() {
  return readPositiveIntEnv(
    'CV_QUEUE_METRICS_LOG_INTERVAL_MS',
    CV_QUEUE_METRICS_LOG_INTERVAL_MS_DEFAULT
  );
}

module.exports = {
  CV_QUEUE_METRICS_LOG_INTERVAL_MS_DEFAULT,
  getCvQueueMetricsLogIntervalMs,
};
