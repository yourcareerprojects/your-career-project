'use strict';

/**
 * Clear simulation-related data for specific users (keeps profile and auth).
 *
 * Usage:
 *   node scripts/clearSimulationDataForUsers.js
 *   MONGODB_URI_STAGING=... node scripts/clearSimulationDataForUsers.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

function swapDatabaseName(uri, dbName) {
  if (!uri || typeof uri !== 'string') return null;
  const q = uri.indexOf('?');
  const base = q >= 0 ? uri.slice(0, q) : uri;
  const query = q >= 0 ? uri.slice(q) : '';
  const slash = base.lastIndexOf('/');
  if (slash < 0 || slash === base.length - 1) {
    return `${base.replace(/\/?$/, '/')}${dbName}${query}`;
  }
  return `${base.slice(0, slash + 1)}${dbName}${query}`;
}

const TARGETS = [
  {
    userId: '6a21aa1cde8e840bf64f0b8e',
    email: 'nicolareinhard@arcor.de',
    name: 'Nicola',
  },
  {
    userId: '6a21abe7de8e840bf64f0b9e',
    email: 'test2@gmail.com',
    name: 'Falko',
  },
  {
    userId: '6a22e17fe38e53d40161c455',
    email: 'your.career.projects@gmail.com',
    name: 'Katrin',
  },
];

async function clearSimulationDataForUser(models, target) {
  const oid = new mongoose.Types.ObjectId(target.userId);
  const { User, SimulationTraitUsage, RoleFitExplanation, SimulationPrioritizedItem, SimulationJob } =
    models;

  const user = await User.findById(oid).lean();
  if (!user) {
    return { ...target, status: 'not_found' };
  }

  const dbEmail = String(user.email || '').toLowerCase();
  if (dbEmail !== target.email.toLowerCase()) {
    return {
      ...target,
      status: 'email_mismatch',
      dbEmail: user.email,
    };
  }

  const [traitDel, explainDel, priorDel, jobDel] = await Promise.all([
    SimulationTraitUsage.deleteMany({ userId: oid }),
    RoleFitExplanation.deleteMany({ userId: oid }),
    SimulationPrioritizedItem.deleteMany({ userId: oid }),
    SimulationJob.deleteMany({ userId: oid }),
  ]);

  const simCountBefore = Array.isArray(user.simulationResults) ? user.simulationResults.length : 0;
  const savedStepsBefore = Array.isArray(user.savedCareerSteps) ? user.savedCareerSteps.length : 0;

  const res = await User.updateOne(
    { _id: oid },
    {
      $set: {
        simulationResults: [],
        savedCareerSteps: [],
        lastSimulationResult: {
          results: null,
          selectedGoal: { en: null, de: null },
          date: null,
        },
        updatedAt: new Date(),
      },
    }
  );

  return {
    ...target,
    status: 'cleared',
    matchedCount: res.matchedCount,
    modifiedCount: res.modifiedCount,
    simulationResultsBefore: simCountBefore,
    savedCareerStepsBefore: savedStepsBefore,
    deletedSimulationTraitUsage: traitDel.deletedCount,
    deletedRoleFitExplanation: explainDel.deletedCount,
    deletedSimulationPrioritizedItem: priorDel.deletedCount,
    deletedSimulationJob: jobDel.deletedCount,
  };
}

async function main() {
  const uri =
    process.env.MONGODB_URI_STAGING ||
    swapDatabaseName(process.env.MONGODB_URI, 'career-path-explorer-dev');

  if (!uri) {
    throw new Error('No MongoDB URI configured (MONGODB_URI_STAGING or MONGODB_URI)');
  }

  await mongoose.connect(uri);
  const dbName = mongoose.connection.db.databaseName;
  console.log(`Connected to database: ${dbName}`);

  const models = {
    User: require('../src/server/models/User'),
    SimulationTraitUsage: require('../src/server/models/SimulationTraitUsage'),
    RoleFitExplanation: require('../src/server/models/RoleFitExplanation'),
    SimulationPrioritizedItem: require('../src/server/models/SimulationPrioritizedItem'),
    SimulationJob: require('../src/server/models/SimulationJob'),
  };

  const results = [];
  for (const target of TARGETS) {
    results.push(await clearSimulationDataForUser(models, target));
  }

  console.log(JSON.stringify(results, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  return mongoose.disconnect().catch(() => {});
});
