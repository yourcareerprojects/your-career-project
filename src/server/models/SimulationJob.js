const mongoose = require('mongoose');

const simulationJobSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    language: {
      type: String,
      default: 'en',
      trim: true,
      maxlength: 16,
    },
    status: {
      type: String,
      enum: ['queued', 'pending', 'running', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Optional lightweight progress metadata for UI diagnostics.
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    error: {
      type: String,
      default: '',
      maxlength: 4000,
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

simulationJobSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('SimulationJob', simulationJobSchema);
