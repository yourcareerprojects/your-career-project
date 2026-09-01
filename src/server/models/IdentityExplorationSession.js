const mongoose = require('mongoose');

/**
 * Persisted career exploration run after a significant identity evolution.
 * Stores lean job refs only (no embedding vectors).
 */

const ExplorationJobSchema = new mongoose.Schema(
  {
    careerPathId: { type: String, default: null },
    escoId: { type: String, default: null },
    title: { type: mongoose.Schema.Types.Mixed, default: null },
    domain: { type: String, default: null },
    oldScore: { type: Number, required: true },
    newScore: { type: Number, required: true },
    delta: { type: Number, required: true },
    /** Puzzle identity cosine (current snapshot), when available. */
    identityFit: { type: Number, default: null },
    /** Simulation-style OOTB hybrid profile fit, when available. */
    profileFit: { type: Number, default: null },
    source: {
      type: String,
      enum: ['highest_delta', 'new_domain', 'unexpected', 'wildcard'],
      required: true,
    },
  },
  { _id: false }
);

const IdentityExplorationSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Correlates logs across pipeline steps. */
    pipelineId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: [
        'completed',
        'skipped_below_threshold',
        'seeded_baseline',
        'skipped_empty_pool',
        /** A prior unread delivery is still waiting — do not stack another. */
        'skipped_pending_delivery',
        'failed',
      ],
      required: true,
      index: true,
    },
    changeScore: { type: Number, default: 0 },
    reasons: { type: [String], default: [] },
    triggerLevel: {
      type: String,
      enum: ['none', 'mild', 'moderate', 'strong'],
      default: 'none',
    },
    explanation: { type: String, default: '' },
    /**
     * Adaptive gate decision:
     * { trigger, triggerReason, threshold, changeScore, explorationSize, ... }
     */
    gate: { type: mongoose.Schema.Types.Mixed, default: undefined },
    explorationJobs: { type: [ExplorationJobSchema], default: [] },
    deltaMatchCount: { type: Number, default: 0 },
    rolePoolSize: { type: Number, default: 0 },
    language: { type: String, enum: ['en', 'de'], default: 'de' },
    /** What kicked off this run (event name or 'api'). */
    triggerSource: { type: String, default: 'identity:puzzle_updated' },
    errorMessage: { type: String, default: null },
    /**
     * When the user has been notified (or the session is non-notifiable).
     * null = unread discovery waiting for frontend feedback.
     */
    seenAt: { type: Date, default: null },
    /**
     * In-progress Keep/Skip/Dislike ranking for Discover (pause/resume).
     * Cleared when the session is marked seen after Done.
     * Shape: { phase, wizardPaused, evaluations, rankedOrder, evaluatedCount, totalCount, updatedAt }
     */
    rankingProgress: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

IdentityExplorationSessionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model(
  'IdentityExplorationSession',
  IdentityExplorationSessionSchema
);
