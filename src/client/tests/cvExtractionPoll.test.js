const { watchCvExtractionUntilTerminal, getPollPhase } = require('../utils/cvExtractionPoll');
const { EXTRACTION_SLOW_WARNING_MS } = require('../../constants/cvExtractionTiming');

describe('watchCvExtractionUntilTerminal', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  async function flushPollMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
  }

  test('returns timedOut after maxDurationMs without further polls', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'processing',
        stage: 'ocr',
        progress: 10,
        message: 'Working',
        estimatedState: 'normal',
      }),
    });

    const onUpdate = jest.fn();
    const promise = watchCvExtractionUntilTerminal({
      documentId: 'doc-1',
      token: 'token',
      maxDurationMs: 5000,
      onUpdate,
    });

    await flushPollMicrotasks();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    jest.setSystemTime(6000);
    await jest.runAllTimersAsync();
    const outcome = await promise;

    expect(outcome.kind).toBe('timedOut');
    expect(outcome.elapsedMs).toBe(5000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  test('returns completed when terminal status arrives before max duration', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'processing', stage: 'ocr', progress: 20 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed', stage: null, progress: 100 }),
      });

    const promise = watchCvExtractionUntilTerminal({
      documentId: 'doc-2',
      token: 'token',
      maxDurationMs: 60_000,
    });

    await flushPollMicrotasks();
    jest.setSystemTime(3000);
    await jest.runAllTimersAsync();
    const outcome = await promise;

    expect(outcome.kind).toBe('completed');
    expect(outcome.data.status).toBe('completed');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('returns aborted when signal is aborted', async () => {
    global.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({ status: 'processing', progress: 0 }),
              }),
            1000
          );
        })
    );

    const controller = new AbortController();
    const promise = watchCvExtractionUntilTerminal({
      documentId: 'doc-3',
      token: 'token',
      maxDurationMs: 60_000,
      signal: controller.signal,
    });

    await flushPollMicrotasks();
    controller.abort();
    await jest.runAllTimersAsync();
    const outcome = await promise;

    expect(outcome.kind).toBe('aborted');
  });

  test('preserves backoff on errors until max duration', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 503 });

    const onPollError = jest.fn();
    const promise = watchCvExtractionUntilTerminal({
      documentId: 'doc-4',
      token: 'token',
      maxDurationMs: 4000,
      onPollError,
    });

    await flushPollMicrotasks();
    expect(onPollError).toHaveBeenCalledWith(1);

    jest.setSystemTime(5000);
    await jest.runAllTimersAsync();
    const outcome = await promise;

    expect(outcome.kind).toBe('timedOut');
    expect(onPollError.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test('getPollPhase degrades to slow then degraded', () => {
    expect(getPollPhase(1000, 15 * 60 * 1000)).toBe('fast');
    expect(getPollPhase(EXTRACTION_SLOW_WARNING_MS + 1, 15 * 60 * 1000)).toBe('slow');
    expect(getPollPhase(15 * 60 * 1000, 15 * 60 * 1000)).toBe('degraded');
  });

  test('includes zombie snapshot fields on update', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'processing',
        stage: 'ocr',
        progress: 10,
        elapsedMs: 4 * 60 * 1000,
        isSlow: true,
        isStuck: false,
        estimatedDelayReason: 'slow',
        workerHealthSignal: 'healthy',
        retryRecommended: false,
      }),
    });

    const onUpdate = jest.fn();
    const promise = watchCvExtractionUntilTerminal({
      documentId: 'doc-5',
      token: 'token',
      maxDurationMs: 5000,
      onUpdate,
    });

    await flushPollMicrotasks();
    await flushPollMicrotasks();
    expect(onUpdate.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        isSlow: true,
        pollPhase: 'fast',
      })
    );

    jest.setSystemTime(6000);
    await jest.runAllTimersAsync();
    const outcome = await promise;
    expect(outcome.kind).toBe('timedOut');
    expect(outcome.snapshot?.isSlow).toBe(true);
  });
});
