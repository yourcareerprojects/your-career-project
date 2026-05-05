const mongoose = require('mongoose');

/**
 * Stores prioritized list items for a simulation in an indexed form so we can
 * efficiently fetch the next item by (simulationId, category, position).
 */
const SimulationPrioritizedItemSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
    ref: 'User'
  },
  simulationId: {
    type: String,
    required: true,
    index: true
  },
  // prioritized list category key: 'nextCareerRoles' | 'outsideTheBoxRoles'
  category: {
    type: String,
    required: true,
    index: true
  },
  // 0-based index in prioritized list (matches currentPositions semantics)
  position: {
    type: Number,
    required: true,
    index: true
  },
  // Deterministic ID for endpoints and deletes
  stepId: {
    type: String,
    required: true,
    index: true
  },
  // Full payload stored for responses (title/description/score/metadata/etc.)
  item: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  }
}, {
  timestamps: true
});

// Fast "next item" fetch: user+simulation+category+position
SimulationPrioritizedItemSchema.index(
  { userId: 1, simulationId: 1, category: 1, position: 1 },
  { unique: true, name: 'simulation_category_position_unique' }
);

// Fast lookup by stepId (for debugging / optional validations)
SimulationPrioritizedItemSchema.index(
  { userId: 1, simulationId: 1, category: 1, stepId: 1 },
  { unique: true, name: 'simulation_category_stepId_unique' }
);

// Also useful for aggregate queries
SimulationPrioritizedItemSchema.index(
  { simulationId: 1, category: 1, position: 1 },
  { name: 'simulation_category_position' }
);

module.exports = mongoose.model('SimulationPrioritizedItem', SimulationPrioritizedItemSchema);

