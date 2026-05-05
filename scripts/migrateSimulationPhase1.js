/**
 * Migration Script (Phase 1):
 * - Backfill deterministic stepIds into saved simulation results
 * - Backfill algorithmVersion/scoringVersion fields
 * - Populate indexed prioritized list collection (SimulationPrioritizedItem)
 *
 * Run:
 *   node scripts/migrateSimulationPhase1.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/server/models/User');
const SimulationPrioritizedItem = require('../src/server/models/SimulationPrioritizedItem');
const { generateStepId, mapPrioritizedListCategoryToStepCategory } = require('../src/server/utils/stepId');

const ALGORITHM_VERSION = '1';
const SCORING_VERSION = '1';

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB:', uri);
};

const attachStepIds = (prioritizedLists, simulationId) => {
  if (!prioritizedLists || typeof prioritizedLists !== 'object') return prioritizedLists;
  for (const [listCategory, items] of Object.entries(prioritizedLists)) {
    if (!Array.isArray(items)) continue;
    const stepCategory = mapPrioritizedListCategoryToStepCategory(listCategory);
    for (let i = 0; i < items.length; i++) {
      const item = items[i] || {};
      const stepId = item.stepId || item.id || generateStepId(item.title, simulationId, stepCategory, i);
      items[i] = {
        ...item,
        stepId,
        id: stepId,
        position: i,
        rank: i + 1
      };
    }
  }
  return prioritizedLists;
};

const upsertPrioritizedItems = async ({ userId, simulationId, prioritizedLists }) => {
  if (!userId || !simulationId || !prioritizedLists) return;
  const ops = [];
  for (const [category, items] of Object.entries(prioritizedLists)) {
    if (!Array.isArray(items)) continue;
    for (let position = 0; position < items.length; position++) {
      const item = items[position];
      if (!item || !item.stepId) continue;
      ops.push({
        replaceOne: {
          filter: { userId, simulationId, category, position },
          replacement: { userId, simulationId, category, position, stepId: item.stepId, item },
          upsert: true
        }
      });
    }
  }
  if (ops.length) {
    await SimulationPrioritizedItem.bulkWrite(ops, { ordered: false });
  }
};

const migrate = async () => {
  await connectDB();

  const users = await User.find({ 'simulationResults.0': { $exists: true } });
  console.log('Users with simulationResults:', users.length);

  let simulationsUpdated = 0;
  let prioritizedItemsUpserted = 0;

  for (const user of users) {
    let userDirty = false;

    for (const sim of (user.simulationResults || [])) {
      if (!sim || sim.status === 'deleted') continue;
      const simulationId = sim.id;
      if (!simulationId) continue;

      sim.algorithmVersion = sim.algorithmVersion || ALGORITHM_VERSION;
      sim.scoringVersion = sim.scoringVersion || SCORING_VERSION;

      if (sim.results && typeof sim.results === 'object') {
        sim.results.simulationId = sim.results.simulationId || simulationId;
        sim.results.algorithmVersion = sim.results.algorithmVersion || sim.algorithmVersion;
        sim.results.scoringVersion = sim.results.scoringVersion || sim.scoringVersion;

        if (sim.results.prioritizedLists) {
          sim.results.prioritizedLists = attachStepIds(sim.results.prioritizedLists, simulationId);
          sim.results.prioritizedListTotals = sim.results.prioritizedListTotals || {
            nextCareerRoles: Array.isArray(sim.results.prioritizedLists.nextCareerRoles) ? sim.results.prioritizedLists.nextCareerRoles.length : 0,
            outsideTheBoxRoles: Array.isArray(sim.results.prioritizedLists.outsideTheBoxRoles) ? sim.results.prioritizedLists.outsideTheBoxRoles.length : 0
          };

          await upsertPrioritizedItems({
            userId: user._id,
            simulationId,
            prioritizedLists: sim.results.prioritizedLists
          });

          prioritizedItemsUpserted +=
            (sim.results.prioritizedLists.nextCareerRoles?.length || 0) +
            (sim.results.prioritizedLists.outsideTheBoxRoles?.length || 0);
        }

        // Backfill stepIds for currently displayed steps using their current order
        if (Array.isArray(sim.results.nextSteps)) {
          sim.results.nextSteps = sim.results.nextSteps.map((step, idx) => {
            const stepId = step.stepId || step.id || generateStepId(step.title, simulationId, 'nextSteps', idx);
            return { ...step, stepId, id: stepId };
          });
        }

        if (Array.isArray(sim.results.outsideTheBox)) {
          sim.results.outsideTheBox = sim.results.outsideTheBox.map((step, idx) => {
            const stepId = step.stepId || step.id || generateStepId(step.title, simulationId, 'outsideTheBox', idx);
            return { ...step, stepId, id: stepId };
          });
        }
      }

      userDirty = true;
      simulationsUpdated++;
    }

    if (userDirty) {
      await user.save();
    }
  }

  console.log('=== Migration summary ===');
  console.log('Simulations updated:', simulationsUpdated);
  console.log('Prioritized items upserted (approx):', prioritizedItemsUpserted);

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
};

if (require.main === module) {
  migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };

