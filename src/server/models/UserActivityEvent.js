const mongoose = require('mongoose');

/**
 * Append-only user activity log for the History timeline.
 * Written fire-and-forget from controllers; never blocks user-facing writes.
 */

const ACTIVITY_TYPES = [
  'profile_section_updated',
  'document_uploaded',
  'simulation_completed',
  'simulation_saved',
  'career_step_saved',
  'career_step_evaluated',
  'trait_voted',
  'roles_unlocked',
  'profile_filled',
  'first_simulation',
];

const userActivityEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: true,
      index: true,
    },
    occurredAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    /** Stable code for client i18n (usually same as type, or section-specific). */
    summaryKey: {
      type: String,
      required: true,
      maxlength: 120,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  { timestamps: true }
);

userActivityEventSchema.index({ userId: 1, occurredAt: -1 });
userActivityEventSchema.index({ userId: 1, type: 1, occurredAt: -1 });

module.exports = mongoose.model('UserActivityEvent', userActivityEventSchema);
module.exports.ACTIVITY_TYPES = ACTIVITY_TYPES;
