/**
 * Redis-backed sliding windows (shared across app instances).
 * Requires `ioredis` and REDIS_URL. Falls back to memory if unavailable.
 */
class RedisRateLimitStore {
  /**
   * @param {import('ioredis').Redis} redis
   */
  constructor(redis) {
    this.redis = redis;
  }

  _key(userId, windowName) {
    return `upload_rl:${windowName}:${userId}`;
  }

  async countEvents(userId, windowMs) {
    const windowName = windowMs <= 60_000 ? 'minute' : 'hour';
    const key = this._key(userId, windowName);
    const now = Date.now();
    const minScore = now - windowMs;
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(key, 0, minScore);
    pipeline.zcard(key);
    const results = await pipeline.exec();
    const count = results?.[1]?.[1];
    return typeof count === 'number' ? count : 0;
  }

  async recordEvent(userId) {
    const now = Date.now();
    const minuteKey = this._key(userId, 'minute');
    const hourKey = this._key(userId, 'hour');
    const member = `${now}:${Math.random()}`;
    const pipeline = this.redis.pipeline();
    pipeline.zadd(minuteKey, now, member);
    pipeline.expire(minuteKey, 65);
    pipeline.zadd(hourKey, now, member);
    pipeline.expire(hourKey, 3605);
    await pipeline.exec();
  }

  async withUserLock(userId, fn) {
    const lockKey = `upload_rl:lock:${userId}`;
    const token = `${Date.now()}:${Math.random()}`;
    const maxWaitMs = 5000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const ok = await this.redis.set(lockKey, token, 'PX', 3000, 'NX');
      if (ok === 'OK') {
        try {
          return await fn();
        } finally {
          const current = await this.redis.get(lockKey);
          if (current === token) {
            await this.redis.del(lockKey);
          }
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return fn();
  }

  async reset() {
    const keys = await this.redis.keys('upload_rl:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}

module.exports = RedisRateLimitStore;
