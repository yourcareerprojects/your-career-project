const { EXTRACTION_ERROR_KEYS } = require('../../../constants/cvExtractionErrors');
const { RATE_LIMIT_MESSAGES } = require('../../config/rateLimitConfig');

class RateLimitError extends Error {
  /**
   * @param {string} limitType
   * @param {string} [message]
   */
  constructor(limitType, message) {
    const msg = message || RATE_LIMIT_MESSAGES[limitType] || RATE_LIMIT_MESSAGES.uploads_per_hour;
    super(msg);
    this.name = 'RateLimitError';
    this.limitType = limitType;
    this.errorKey = EXTRACTION_ERROR_KEYS.RATE_LIMITED;
    this.statusCode = 429;
  }

  toJSON() {
    return {
      errorKey: this.errorKey,
      message: this.message,
    };
  }
}

module.exports = RateLimitError;
