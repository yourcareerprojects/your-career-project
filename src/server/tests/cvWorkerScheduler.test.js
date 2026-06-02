const {
  createCvWorkerScheduler,
  DEFAULT_IDLE_BACKOFF_INITIAL_MS,
  DEFAULT_IDLE_BACKOFF_MAX_MS,
} = require('../services/cv/cvWorkerScheduler');

describe('cvWorkerScheduler', () => {
  test('returns zero delay when jobs are claimed (full batch)', () => {
    const scheduler = createCvWorkerScheduler({
      idleBackoffInitialMs: 500,
      idleBackoffMaxMs: 5000,
      busyPollDelayMs: 0,
    });
    const result = scheduler.nextDelayAfterTick({
      claimedCount: 2,
      requeuedCount: 0,
      batchSize: 2,
      concurrency: 2,
    });
    expect(result.delayMs).toBe(0);
    expect(result.reason).toBe('jobs_found_immediate');
  });

  test('returns zero delay when jobs are requeued but none claimed yet', () => {
    const scheduler = createCvWorkerScheduler({
      idleBackoffInitialMs: 500,
      idleBackoffMaxMs: 5000,
    });
    const result = scheduler.nextDelayAfterTick({
      claimedCount: 0,
      requeuedCount: 1,
      batchSize: 2,
      concurrency: 2,
    });
    expect(result.delayMs).toBe(0);
    expect(result.reason).toBe('jobs_found_immediate');
  });

  test('exponential idle backoff when no work is found', () => {
    const scheduler = createCvWorkerScheduler({
      idleBackoffInitialMs: 500,
      idleBackoffMaxMs: 5000,
    });

    const first = scheduler.nextDelayAfterTick({
      claimedCount: 0,
      requeuedCount: 0,
      batchSize: 2,
      concurrency: 2,
    });
    expect(first.delayMs).toBe(500);
    expect(first.reason).toBe('idle_backoff');

    const second = scheduler.nextDelayAfterTick({
      claimedCount: 0,
      requeuedCount: 0,
      batchSize: 2,
      concurrency: 2,
    });
    expect(second.delayMs).toBe(1000);

    const third = scheduler.nextDelayAfterTick({
      claimedCount: 0,
      requeuedCount: 0,
      batchSize: 2,
      concurrency: 2,
    });
    expect(third.delayMs).toBe(2000);

    for (let i = 0; i < 5; i += 1) {
      scheduler.nextDelayAfterTick({
        claimedCount: 0,
        requeuedCount: 0,
        batchSize: 2,
        concurrency: 2,
      });
    }
    const capped = scheduler.nextDelayAfterTick({
      claimedCount: 0,
      requeuedCount: 0,
      batchSize: 2,
      concurrency: 2,
    });
    expect(capped.delayMs).toBe(5000);
  });

  test('resets idle backoff after work is found', () => {
    const scheduler = createCvWorkerScheduler({
      idleBackoffInitialMs: 500,
      idleBackoffMaxMs: 5000,
    });

    scheduler.nextDelayAfterTick({ claimedCount: 0, requeuedCount: 0, batchSize: 2, concurrency: 1 });
    scheduler.nextDelayAfterTick({ claimedCount: 0, requeuedCount: 0, batchSize: 2, concurrency: 1 });

    scheduler.nextDelayAfterTick({ claimedCount: 1, requeuedCount: 0, batchSize: 2, concurrency: 1 });

    const afterIdle = scheduler.nextDelayAfterTick({
      claimedCount: 0,
      requeuedCount: 0,
      batchSize: 2,
      concurrency: 1,
    });
    expect(afterIdle.delayMs).toBe(500);
  });

  test('defaults match 500ms initial and 5s max backoff', () => {
    expect(DEFAULT_IDLE_BACKOFF_INITIAL_MS).toBe(500);
    expect(DEFAULT_IDLE_BACKOFF_MAX_MS).toBe(5000);
  });
});
