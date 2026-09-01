/**
 * Fire-and-forget activity logging for the History timeline.
 */

const User = require('../../models/User');
const UserActivityEvent = require('../../models/UserActivityEvent');
const logger = require('../../utils/logger');
const { ACTIVITY_TYPES } = require('../../../constants/userHistoryActivity');

/** Keep in sync with profileController MIN_SIMULATION_PROFILE_COMPLETION_PCT / client MIN_PROFILE_COMPLETION_REQUIRED. */
const PROFILE_FILLED_THRESHOLD = 85;

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{
 *   type: string,
 *   summaryKey?: string,
 *   meta?: object,
 *   occurredAt?: Date,
 * }} payload
 */
function logUserActivity(userId, payload) {
  if (!userId || !payload?.type) return;

  const occurredAt = payload.occurredAt instanceof Date ? payload.occurredAt : new Date();
  const summaryKey = payload.summaryKey || payload.type;
  const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : undefined;

  setImmediate(() => {
    UserActivityEvent.create({
      userId,
      type: payload.type,
      summaryKey,
      meta,
      occurredAt,
    }).catch((err) => {
      logger.warn('user_history.activity_log_failed', {
        userId: String(userId),
        type: payload.type,
        error: err?.message || String(err),
      });
    });
  });
}

/**
 * Record profile_filled once when overall completion first reaches the simulation gate.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {number} overallCompletion
 * @returns {Promise<boolean>} true if newly recorded
 */
async function maybeRecordProfileFilled(userId, overallCompletion) {
  if (!userId) return false;
  const overall = Number(overallCompletion);
  if (!Number.isFinite(overall) || overall < PROFILE_FILLED_THRESHOLD) return false;

  try {
    const now = new Date();
    const updated = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { 'profile.historyMilestones.filledAt': { $exists: false } },
          { 'profile.historyMilestones.filledAt': null },
        ],
      },
      { $set: { 'profile.historyMilestones.filledAt': now } },
      { new: true }
    ).select({ _id: 1 }).lean();

    if (!updated) return false;

    logUserActivity(userId, {
      type: ACTIVITY_TYPES.PROFILE_FILLED,
      summaryKey: ACTIVITY_TYPES.PROFILE_FILLED,
      occurredAt: now,
      meta: { overall },
    });
    return true;
  } catch (err) {
    logger.warn('user_history.profile_filled_record_failed', {
      userId: String(userId),
      error: err?.message || String(err),
    });
    return false;
  }
}

/**
 * Record first_simulation once when the user completes their first simulation run.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ occurredAt?: Date, meta?: object }} [options]
 * @returns {Promise<boolean>}
 */
async function maybeRecordFirstSimulation(userId, options = {}) {
  if (!userId) return false;

  try {
    const occurredAt = options.occurredAt instanceof Date ? options.occurredAt : new Date();
    const updated = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { 'profile.historyMilestones.firstSimulationAt': { $exists: false } },
          { 'profile.historyMilestones.firstSimulationAt': null },
        ],
      },
      { $set: { 'profile.historyMilestones.firstSimulationAt': occurredAt } },
      { new: true }
    ).select({ _id: 1 }).lean();

    if (!updated) return false;

    logUserActivity(userId, {
      type: ACTIVITY_TYPES.FIRST_SIMULATION,
      summaryKey: ACTIVITY_TYPES.FIRST_SIMULATION,
      occurredAt,
      meta: options.meta,
    });
    return true;
  } catch (err) {
    logger.warn('user_history.first_simulation_record_failed', {
      userId: String(userId),
      error: err?.message || String(err),
    });
    return false;
  }
}

module.exports = {
  logUserActivity,
  maybeRecordProfileFilled,
  maybeRecordFirstSimulation,
  ACTIVITY_TYPES,
  PROFILE_FILLED_THRESHOLD,
};
