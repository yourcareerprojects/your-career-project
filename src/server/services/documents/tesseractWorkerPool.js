/**
 * Process-wide Tesseract worker pool. Workers are created once and reused across OCR jobs.
 * Pool size follows CV_WORKER_CONCURRENCY (1–3) so concurrent CV jobs do not share one worker.
 */

const { createWorker } = require('tesseract.js');
const logger = require('../../utils/logger');

const DEFAULT_LANGS = 'deu+eng';
const DEFAULT_OEM = 1;
const MAX_POOL_SIZE = 3;

function readWorkerLangs() {
  const raw = String(process.env.OCR_WORKER_LANGS || '').trim();
  if (!raw) return DEFAULT_LANGS;
  return raw;
}

/**
 * @returns {number}
 */
function readPoolSize() {
  const raw = process.env.CV_WORKER_CONCURRENCY ?? process.env.OCR_WORKER_POOL_SIZE ?? '1';
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_POOL_SIZE);
}

class TesseractWorkerPool {
  /**
   * @param {number} size
   * @param {{ langs?: string, oem?: number }} [options]
   */
  constructor(size, options = {}) {
    this.size = Math.max(1, size);
    this.langs = options.langs || readWorkerLangs();
    this.oem = options.oem ?? DEFAULT_OEM;
    /** @type {import('tesseract.js').Worker[]} */
    this.available = [];
    /** @type {Array<(worker: import('tesseract.js').Worker) => void>} */
    this.waitQueue = [];
    /** @type {Promise<void>|null} */
    this.initPromise = null;
    /** @type {Set<import('tesseract.js').Worker>} */
    this.liveWorkers = new Set();
    this.closed = false;
  }

  async createWorkerWithFallback() {
    try {
      return await createWorker(this.langs, this.oem, { logger: () => {} });
    } catch (err) {
      if (this.langs !== 'eng') {
        logger.warn('Tesseract worker init failed; retrying with eng only', {
          message: err?.message || String(err),
          langs: this.langs,
        });
        return createWorker('eng', this.oem, { logger: () => {} });
      }
      throw err;
    }
  }

  async init() {
    if (this.closed) throw new Error('TesseractWorkerPool is closed');
    if (this.liveWorkers.size >= this.size) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const toCreate = this.size - this.liveWorkers.size;
      const created = [];
      try {
        for (let i = 0; i < toCreate; i += 1) {
          const worker = await this.createWorkerWithFallback();
          created.push(worker);
          this.liveWorkers.add(worker);
          this.available.push(worker);
        }
      } catch (err) {
        await Promise.all(created.map((w) => w.terminate().catch(() => {})));
        for (const w of created) this.liveWorkers.delete(w);
        logger.warn('TesseractWorkerPool init failed', { message: err.message });
        throw err;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * @returns {Promise<import('tesseract.js').Worker>}
   */
  async acquire() {
    await this.init();
    if (this.closed) throw new Error('TesseractWorkerPool is closed');

    const worker = this.available.shift();
    if (worker) return worker;

    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * @param {import('tesseract.js').Worker} worker
   */
  release(worker) {
    if (!worker) return;

    if (this.closed || !this.liveWorkers.has(worker)) {
      worker.terminate().catch(() => {});
      return;
    }

    const waiter = this.waitQueue.shift();
    if (waiter) waiter(worker);
    else this.available.push(worker);
  }

  /**
   * @template T
   * @param {(worker: import('tesseract.js').Worker) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async withWorker(fn) {
    const worker = await this.acquire();
    try {
      return await fn(worker);
    } finally {
      this.release(worker);
    }
  }

  async shutdown() {
    this.closed = true;
    this.waitQueue.length = 0;
    const workers = [...this.liveWorkers];
    this.available = [];
    this.liveWorkers.clear();
    await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
  }
}

/** @type {TesseractWorkerPool|null} */
let singleton = null;

function getTesseractWorkerPool() {
  if (!singleton) {
    singleton = new TesseractWorkerPool(readPoolSize());
  }
  return singleton;
}

/**
 * Run OCR with a pooled worker (lazy pool init on first use).
 * @template T
 * @param {(worker: import('tesseract.js').Worker) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTesseractWorker(fn) {
  return getTesseractWorkerPool().withWorker(fn);
}

async function shutdownTesseractWorkerPool() {
  if (singleton) {
    const pool = singleton;
    singleton = null;
    await pool.shutdown();
  }
}

async function warmUpTesseractWorkerPool() {
  return getTesseractWorkerPool().init();
}

module.exports = {
  withTesseractWorker,
  shutdownTesseractWorkerPool,
  warmUpTesseractWorkerPool,
  getTesseractWorkerPool,
  __testables: {
    TesseractWorkerPool,
    readPoolSize,
    MAX_POOL_SIZE,
  },
};
