const { readCvWorkerStructuredMode } = require('../../constants/cvExtractionPipeline');

describe('cvExtractionPipeline config', () => {
  const keys = ['CV_WORKER_STRUCTURED'];
  const snapshot = {};

  beforeEach(() => {
    for (const k of keys) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  test('defaults to deferred structured in worker', () => {
    expect(readCvWorkerStructuredMode()).toBe('defer');
  });

  test('honors explicit env overrides', () => {
    process.env.CV_WORKER_STRUCTURED = 'always';
    expect(readCvWorkerStructuredMode()).toBe('always');
    process.env.CV_WORKER_STRUCTURED = 'auto';
    expect(readCvWorkerStructuredMode()).toBe('auto');
  });
});
