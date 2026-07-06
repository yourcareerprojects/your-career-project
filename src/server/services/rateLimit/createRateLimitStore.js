const logger = require('../../utils/logger');
const MemoryRateLimitStore = require('./MemoryRateLimitStore');

let storeSingleton = null;

function createRateLimitStore() {
  if (storeSingleton) return storeSingleton;

  const redisUrl = process.env.REDIS_URL && String(process.env.REDIS_URL).trim();
  if (redisUrl) {
    try {
      const Redis = require('ioredis');
      const RedisRateLimitStore = require('./RedisRateLimitStore');
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
      });
      client.on('error', (err) => {
        logger.error('upload_rate_limit_redis_error', { message: String(err?.message || err) });
      });
      storeSingleton = new RedisRateLimitStore(client);
      logger.info('upload_rate_limit_store_ready', { backend: 'redis' });
      return storeSingleton;
    } catch (err) {
      logger.warn('upload_rate_limit_redis_unavailable', {
        message: String(err?.message || err),
        hint: 'Install ioredis or unset REDIS_URL to use in-memory rate limits',
      });
    }
  } else {
    logger.info('upload_rate_limit_store_ready', {
      backend: 'memory',
      warning: 'In-memory limits are not shared across server instances',
    });
  }

  storeSingleton = new MemoryRateLimitStore();
  return storeSingleton;
}

function resetRateLimitStoreForTests() {
  if (storeSingleton && typeof storeSingleton.reset === 'function') {
    storeSingleton.reset();
  }
  storeSingleton = null;
}

module.exports = {
  createRateLimitStore,
  resetRateLimitStoreForTests,
};
