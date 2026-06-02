/**
 * In-process sliding-window upload counters (per user).
 * Not shared across server instances — use Redis store when REDIS_URL is set.
 */
class MemoryRateLimitStore {
  constructor() {
    /** @type {Map<string, number[]>} */
    this.eventsByUser = new Map();
    /** @type {Map<string, Promise<void>>} */
    this.locks = new Map();
  }

  async withUserLock(userId, fn) {
    const key = String(userId);
    const prev = this.locks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    this.locks.set(key, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === next) {
        this.locks.delete(key);
      }
    }
  }

  _prune(timestamps, windowMs, now) {
    const cutoff = now - windowMs;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
    return timestamps;
  }

  /**
   * @param {string} userId
   * @param {number} windowMs
   * @returns {Promise<number>}
   */
  async countEvents(userId, windowMs) {
    const now = Date.now();
    const list = this.eventsByUser.get(String(userId)) || [];
    const pruned = this._prune(list, windowMs, now);
    this.eventsByUser.set(String(userId), pruned);
    return pruned.length;
  }

  /**
   * @param {string} userId
   * @param {number} [_windowMs] - ignored; one timestamp counts toward all windows
   * @returns {Promise<void>}
   */
  async recordEvent(userId, _windowMs) {
    const key = String(userId);
    const now = Date.now();
    const list = this.eventsByUser.get(key) || [];
    list.push(now);
    this.eventsByUser.set(key, list);
  }

  reset() {
    this.eventsByUser.clear();
    this.locks.clear();
  }
}

module.exports = MemoryRateLimitStore;
