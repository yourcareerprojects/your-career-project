const { resolveZombieSignalsFromStatus, getDelayReasonI18nKey } = require('../utils/cvExtractionZombie');

describe('cvExtractionZombie client', () => {
  test('prefers server-computed zombie fields', () => {
    const signals = resolveZombieSignalsFromStatus({
      status: 'processing',
      elapsedMs: 600_000,
      isSlow: true,
      isStuck: true,
      estimatedDelayReason: 'system_load',
      workerHealthSignal: 'healthy',
      retryRecommended: true,
    });
    expect(signals.isSlow).toBe(true);
    expect(signals.isStuck).toBe(true);
    expect(signals.retryRecommended).toBe(true);
  });

  test('getDelayReasonI18nKey maps worker unavailable', () => {
    expect(getDelayReasonI18nKey('normal', 'unavailable')).toBe(
      'documentUpload.async.recovery.workerUnavailable'
    );
  });
});
