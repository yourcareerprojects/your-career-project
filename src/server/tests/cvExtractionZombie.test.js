const {
  computeZombieJobSignals,
  computeNoProgressMs,
  EXTRACTION_SLOW_MS,
  EXTRACTION_STUCK_MS,
  EXTRACTION_NO_PROGRESS_MS,
  EXTRACTION_DELAY_REASONS,
  WORKER_HEALTH_SIGNALS,
} = require('../../constants/cvExtractionZombie');
const {
  EXTRACTION_EXPECTED_MS,
  POLL_BACKOFF_MAX_AFTER_MS,
  EXTRACTION_SLOW_WARNING_MS,
} = require('../../constants/cvExtractionTiming');

describe('cvExtractionZombie', () => {
  test('thresholds align with shared timing constants', () => {
    expect(EXTRACTION_SLOW_MS).toBe(EXTRACTION_EXPECTED_MS);
    expect(EXTRACTION_STUCK_MS).toBe(POLL_BACKOFF_MAX_AFTER_MS);
    expect(EXTRACTION_NO_PROGRESS_MS).toBe(Math.floor(EXTRACTION_SLOW_WARNING_MS / 2));
  });

  test('normal in-flight job is not slow or stuck', () => {
    const signals = computeZombieJobSignals({
      status: 'processing',
      elapsedMs: 60_000,
      noProgressMs: 30_000,
      workerHealthSignal: WORKER_HEALTH_SIGNALS.HEALTHY,
    });
    expect(signals.isSlow).toBe(false);
    expect(signals.isStuck).toBe(false);
    expect(signals.estimatedDelayReason).toBe(EXTRACTION_DELAY_REASONS.NORMAL);
    expect(signals.retryRecommended).toBe(false);
  });

  test('slow after expected duration', () => {
    const signals = computeZombieJobSignals({
      status: 'processing',
      elapsedMs: EXTRACTION_SLOW_MS + 1000,
      noProgressMs: 60_000,
      workerHealthSignal: WORKER_HEALTH_SIGNALS.HEALTHY,
    });
    expect(signals.isSlow).toBe(true);
    expect(signals.isStuck).toBe(false);
    expect(signals.estimatedDelayReason).toBe(EXTRACTION_DELAY_REASONS.SLOW);
  });

  test('stuck after stuck threshold', () => {
    const signals = computeZombieJobSignals({
      status: 'processing',
      elapsedMs: EXTRACTION_STUCK_MS + 1000,
      noProgressMs: 60_000,
      workerHealthSignal: WORKER_HEALTH_SIGNALS.HEALTHY,
    });
    expect(signals.isStuck).toBe(true);
    expect(signals.retryRecommended).toBe(true);
    expect(signals.estimatedDelayReason).toBe(EXTRACTION_DELAY_REASONS.SYSTEM_LOAD);
  });

  test('worker unavailable with elapsed time marks stuck and recommends retry', () => {
    const signals = computeZombieJobSignals({
      status: 'queued',
      elapsedMs: EXTRACTION_SLOW_MS + 1000,
      noProgressMs: 0,
      workerHealthSignal: WORKER_HEALTH_SIGNALS.UNAVAILABLE,
    });
    expect(signals.isStuck).toBe(true);
    expect(signals.estimatedDelayReason).toBe(EXTRACTION_DELAY_REASONS.WORKER_UNAVAILABLE);
    expect(signals.retryRecommended).toBe(true);
  });

  test('no progress without full elapsed stuck threshold', () => {
    const signals = computeZombieJobSignals({
      status: 'processing',
      elapsedMs: EXTRACTION_SLOW_MS + 1000,
      noProgressMs: EXTRACTION_NO_PROGRESS_MS + 1000,
      workerHealthSignal: WORKER_HEALTH_SIGNALS.HEALTHY,
    });
    expect(signals.isStuck).toBe(true);
    expect(signals.estimatedDelayReason).toBe(EXTRACTION_DELAY_REASONS.NO_PROGRESS);
  });

  test('terminal failed recommends retry', () => {
    const signals = computeZombieJobSignals({
      status: 'failed',
      elapsedMs: 999_999,
    });
    expect(signals.retryRecommended).toBe(true);
    expect(signals.estimatedDelayReason).toBeNull();
  });

  test('computeNoProgressMs from updatedAt', () => {
    const now = new Date('2026-05-17T12:10:00.000Z');
    const updatedAt = new Date('2026-05-17T12:00:00.000Z');
    expect(computeNoProgressMs(updatedAt, now)).toBe(10 * 60 * 1000);
  });
});
