const { createWorker } = require('tesseract.js');
const {
  __testables,
  withTesseractWorker,
  shutdownTesseractWorkerPool,
  getTesseractWorkerPool,
} = require('../services/documents/tesseractWorkerPool');

jest.mock('tesseract.js', () => ({
  createWorker: jest.fn(),
}));

const { TesseractWorkerPool, readPoolSize } = __testables;

function makeMockWorker(id) {
  return {
    id,
    recognize: jest.fn(async () => ({ data: { text: `text-${id}` } })),
    terminate: jest.fn(async () => {}),
  };
}

describe('tesseractWorkerPool', () => {
  const originalConcurrency = process.env.CV_WORKER_CONCURRENCY;

  beforeEach(() => {
    createWorker.mockReset();
    delete process.env.OCR_WORKER_POOL_SIZE;
  });

  afterEach(async () => {
    await shutdownTesseractWorkerPool();
    if (originalConcurrency === undefined) delete process.env.CV_WORKER_CONCURRENCY;
    else process.env.CV_WORKER_CONCURRENCY = originalConcurrency;
  });

  test('readPoolSize respects CV_WORKER_CONCURRENCY with cap at 3', () => {
    process.env.CV_WORKER_CONCURRENCY = '2';
    expect(readPoolSize()).toBe(2);
    process.env.CV_WORKER_CONCURRENCY = '9';
    expect(readPoolSize()).toBe(3);
    delete process.env.CV_WORKER_CONCURRENCY;
    expect(readPoolSize()).toBe(1);
  });

  test('initializes workers once per pool size', async () => {
    process.env.CV_WORKER_CONCURRENCY = '2';
    const w1 = makeMockWorker(1);
    const w2 = makeMockWorker(2);
    createWorker.mockResolvedValueOnce(w1).mockResolvedValueOnce(w2);

    const pool = new TesseractWorkerPool(2);
    await pool.withWorker(async (a) => {
      expect(a).toBe(w1);
    });
    await pool.withWorker(async (b) => {
      expect(b).toBe(w2);
    });
    await pool.withWorker(async (c) => {
      expect([w1, w2]).toContain(c);
    });

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(w1.terminate).not.toHaveBeenCalled();
    expect(w2.terminate).not.toHaveBeenCalled();

    await pool.shutdown();
    expect(w1.terminate).toHaveBeenCalledTimes(1);
    expect(w2.terminate).toHaveBeenCalledTimes(1);
  });

  test('withTesseractWorker reuses singleton pool across calls', async () => {
    process.env.CV_WORKER_CONCURRENCY = '1';
    const worker = makeMockWorker('shared');
    createWorker.mockResolvedValue(worker);

    await withTesseractWorker(async (w1) => {
      expect(w1).toBe(worker);
    });
    await withTesseractWorker(async (w2) => {
      expect(w2).toBe(worker);
    });

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  test('serializes jobs when pool size is 1', async () => {
    process.env.CV_WORKER_CONCURRENCY = '1';
    const worker = makeMockWorker('only');
    createWorker.mockResolvedValue(worker);

    let active = 0;
    let maxActive = 0;

    const job = async () =>
      withTesseractWorker(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
      });

    await Promise.all([job(), job(), job()]);

    expect(maxActive).toBe(1);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  test('shutdown clears singleton so next use can re-init', async () => {
    process.env.CV_WORKER_CONCURRENCY = '1';
    const w1 = makeMockWorker('a');
    const w2 = makeMockWorker('b');
    createWorker.mockResolvedValueOnce(w1).mockResolvedValueOnce(w2);

    await withTesseractWorker(async () => {});
    await shutdownTesseractWorkerPool();
    expect(w1.terminate).toHaveBeenCalledTimes(1);

    await withTesseractWorker(async (w) => {
      expect(w).toBe(w2);
    });
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(getTesseractWorkerPool()).toBeTruthy();
  });
});
