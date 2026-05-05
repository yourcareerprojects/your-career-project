const mongoose = require('mongoose');

/**
 * Persists per-simulation trait combination caps for role-fit explanations (server-side).
 * scopeStates[scopeKey] = { combinationCounts: { [comboKey]: number }, roleCombinationSelection: { [roleKey]: comboKey } }
 */
const simulationTraitUsageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    simulationScopeKey: {
      type: String,
      required: true,
      default: '',
      trim: true,
      maxlength: 512,
      index: true,
    },
    scopeStates: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

simulationTraitUsageSchema.index({ userId: 1, simulationScopeKey: 1 }, { unique: true });

module.exports = mongoose.model('SimulationTraitUsage', simulationTraitUsageSchema);
