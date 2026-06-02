const {
  EXTRACTION_EXPECTED_MS,
  EXTRACTION_SLOW_WARNING_MS,
  EXTRACTION_POLL_MAX_DURATION_MS_DEFAULT,
  getAdaptivePollDelayMs,
  getExtractionPollMaxDurationMs,
  computeEstimatedState,
} = require('../../constants/cvExtractionTiming');

describe('cvExtractionTiming', () => {
  test('slow warning is after expected duration', () => {
    expect(EXTRACTION_SLOW_WARNING_MS).toBeGreaterThan(EXTRACTION_EXPECTED_MS);
  });

  test('getAdaptivePollDelayMs increases with elapsed time', () => {
    const fast = getAdaptivePollDelayMs(30 * 1000);
    const mid = getAdaptivePollDelayMs(EXTRACTION_EXPECTED_MS + 1000);
    const slow = getAdaptivePollDelayMs(EXTRACTION_SLOW_WARNING_MS + 1000);
    const max = getAdaptivePollDelayMs(EXTRACTION_SLOW_WARNING_MS * 3);
    expect(fast).toBeLessThanOrEqual(3000);
    expect(mid).toBe(5000);
    expect(slow).toBe(10000);
    expect(max).toBe(20000);
  });

  test('computeEstimatedState never returns failed', () => {
    expect(computeEstimatedState(60 * 60 * 1000)).toBe('delayed');
    expect(computeEstimatedState(1000, { isRequeued: true })).toBe('retrying');
    expect(computeEstimatedState(1000)).toBe('normal');
  });

  test('poll max duration defaults to 15 minutes', () => {
    expect(EXTRACTION_POLL_MAX_DURATION_MS_DEFAULT).toBe(15 * 60 * 1000);
    expect(getExtractionPollMaxDurationMs()).toBe(EXTRACTION_POLL_MAX_DURATION_MS_DEFAULT);
  });
});
