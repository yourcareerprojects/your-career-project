/**
 * Central thresholds for document upload + CV extraction abuse prevention.
 * Override via environment variables in production.
 */
function readPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const UPLOADS_PER_MINUTE = readPositiveInt('UPLOAD_RATE_PER_MINUTE', 3);
const UPLOADS_PER_HOUR = readPositiveInt('UPLOAD_RATE_PER_HOUR', 20);
const MAX_CONCURRENT_JOBS_PER_USER = readPositiveInt('UPLOAD_MAX_CONCURRENT_JOBS_PER_USER', 2);

/** How long identical file bytes map to an active in-flight job for the same user. */
const DEDUPE_WINDOW_MS = readPositiveInt('UPLOAD_DEDUPE_WINDOW_MS', 30 * 60 * 1000);

/**
 * Global backpressure: max `queued` extraction jobs system-wide.
 * Set UPLOAD_MAX_GLOBAL_QUEUED_JOBS=0 to disable (no limit).
 */
function readGlobalQueuedJobsLimit() {
  const raw = process.env.UPLOAD_MAX_GLOBAL_QUEUED_JOBS;
  if (raw == null || raw === '') return 100;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return 100;
  return n;
}

const MAX_GLOBAL_QUEUED_JOBS = readGlobalQueuedJobsLimit();

const UPLOAD_WINDOW_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
};

const RATE_LIMIT_MESSAGES = {
  uploads_per_minute: 'Too many uploads. Please try again in a minute.',
  uploads_per_hour: 'Too many uploads. Please try again later.',
  concurrent_jobs: 'You already have CVs being processed. Please wait for them to finish.',
  global_queue: 'System busy, please try again shortly',
};

module.exports = {
  UPLOADS_PER_MINUTE,
  UPLOADS_PER_HOUR,
  MAX_CONCURRENT_JOBS_PER_USER,
  DEDUPE_WINDOW_MS,
  MAX_GLOBAL_QUEUED_JOBS,
  UPLOAD_WINDOW_MS,
  RATE_LIMIT_MESSAGES,
};
