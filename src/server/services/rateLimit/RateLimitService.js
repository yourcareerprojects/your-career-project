const mongoose = require('mongoose');
const logger = require('../../utils/logger');
const CvExtractionJob = require('../../models/CvExtractionJob');
const {
  UPLOADS_PER_MINUTE,
  UPLOADS_PER_HOUR,
  MAX_CONCURRENT_JOBS_PER_USER,
  MAX_GLOBAL_QUEUED_JOBS,
  UPLOAD_WINDOW_MS,
} = require('../../config/rateLimitConfig');
const RateLimitError = require('./RateLimitError');
const { createRateLimitStore } = require('./createRateLimitStore');

const ACTIVE_JOB_STATUSES = ['queued', 'processing'];

function toObjectId(userId) {
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  return new mongoose.Types.ObjectId(String(userId));
}

class RateLimitService {
  constructor(store = null) {
    this.store = store || createRateLimitStore();
  }

  /**
   * @param {string|import('mongoose').Types.ObjectId} userId
   */
  async countActiveExtractionJobs(userId) {
    return CvExtractionJob.countDocuments({
      userId: toObjectId(userId),
      status: { $in: ACTIVE_JOB_STATUSES },
    });
  }

  /**
   * @param {string|import('mongoose').Types.ObjectId} userId
   */
  async countGlobalQueuedJobs() {
    return CvExtractionJob.countDocuments({ status: 'queued' });
  }

  /**
   * Read-only checks (no counter increment).
   * @param {string|import('mongoose').Types.ObjectId} userId
   */
  async checkUploadRateLimit(userId) {
    const uid = String(userId);
    return this.store.withUserLock(uid, async () => {
      const minuteCount = await this.store.countEvents(uid, UPLOAD_WINDOW_MS.minute);
      if (minuteCount >= UPLOADS_PER_MINUTE) {
        throw new RateLimitError('uploads_per_minute');
      }
      const hourCount = await this.store.countEvents(uid, UPLOAD_WINDOW_MS.hour);
      if (hourCount >= UPLOADS_PER_HOUR) {
        throw new RateLimitError('uploads_per_hour');
      }
    });
  }

  /**
   * @param {string|import('mongoose').Types.ObjectId} userId
   */
  async checkConcurrentJobs(userId) {
    const active = await this.countActiveExtractionJobs(userId);
    if (active >= MAX_CONCURRENT_JOBS_PER_USER) {
      throw new RateLimitError('concurrent_jobs');
    }
    return active;
  }

  /**
   * @returns {Promise<number|null>} global queued count if checked
   */
  async checkGlobalQueuePressure() {
    if (!MAX_GLOBAL_QUEUED_JOBS || MAX_GLOBAL_QUEUED_JOBS <= 0) {
      return null;
    }
    const queued = await this.countGlobalQueuedJobs();
    if (queued >= MAX_GLOBAL_QUEUED_JOBS) {
      throw new RateLimitError('global_queue');
    }
    return queued;
  }

  /**
   * Read-only ingress gate (rate windows + concurrency + optional global queue).
   * @param {string|import('mongoose').Types.ObjectId} userId
   */
  async assertUploadLimitsOnly(userId) {
    const uid = String(userId);
    await this.checkUploadRateLimit(uid);
    await this.checkConcurrentJobs(uid);
    await this.checkGlobalQueuePressure();
  }

  /**
   * Record a successful upload attempt against minute/hour windows.
   * @param {string|import('mongoose').Types.ObjectId} userId
   */
  async recordUploadAttempt(userId) {
    const uid = String(userId);
    await this.store.withUserLock(uid, async () => {
      await this.store.recordEvent(uid);
    });
  }

  /**
   * Re-check immediately before creating an extraction job (closes small races).
   * @param {string|import('mongoose').Types.ObjectId} userId
   */
  async assertJobCreationAllowed(userId) {
    await this.checkConcurrentJobs(userId);
    await this.checkGlobalQueuePressure();
  }

  /**
   * @param {object} params
   * @param {string} params.type
   * @param {string} params.userId
   * @param {string} params.limitType
   * @param {number} [params.currentCount]
   */
  logRateLimitHit({ type, userId, limitType, currentCount }) {
    logger.warn({
      type: type || 'RATE_LIMIT_HIT',
      userId: String(userId),
      limitType,
      currentCount,
    });
  }
}

let serviceSingleton = null;

function getRateLimitService() {
  if (!serviceSingleton) {
    serviceSingleton = new RateLimitService();
  }
  return serviceSingleton;
}

function resetRateLimitServiceForTests() {
  serviceSingleton = null;
}

module.exports = {
  RateLimitService,
  getRateLimitService,
  resetRateLimitServiceForTests,
  ACTIVE_JOB_STATUSES,
};
