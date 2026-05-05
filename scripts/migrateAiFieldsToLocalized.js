#!/usr/bin/env node
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/database');

const USER_COLLECTION = 'users';

const USER_AI_FIELDS = [
  'profile.who_are_you.summary_text',
  'profile.structuredUserInfo.skillDomains.summary_text',
  'profile.structuredUserInfo.skills.summary_text',
  'profile.structuredUserInfo.skillsInDevelopment.summary_text',
  'profile.structuredUserInfo.keyResponsibilities.summary_text',
  'profile.structuredUserInfo.domains.summary_text',
  'profile.careerSimulationInputs.structuredUserInfo.skillDomains.summary_text',
  'profile.careerSimulationInputs.structuredUserInfo.skills.summary_text',
  'profile.careerSimulationInputs.structuredUserInfo.skillsInDevelopment.summary_text',
  'profile.careerSimulationInputs.structuredUserInfo.keyResponsibilities.summary_text',
  'profile.careerSimulationInputs.structuredUserInfo.domains.summary_text',
  'lastSimulationResult.selectedGoal',
];

async function migrateField(collection, fieldPath) {
  const filter = { [fieldPath]: { $type: 'string' } };
  const update = [
    {
      $set: {
        [fieldPath]: {
          en: `$${fieldPath}`,
          de: null,
        },
      },
    },
  ];

  const result = await collection.updateMany(filter, update);
  return result.modifiedCount || 0;
}

async function run() {
  await connectDB();
  const users = mongoose.connection.db.collection(USER_COLLECTION);

  let total = 0;
  for (const fieldPath of USER_AI_FIELDS) {
    const modified = await migrateField(users, fieldPath);
    total += modified;
    console.log(`[migrateAiFieldsToLocalized] ${fieldPath}: ${modified} documents updated`);
  }

  const simulationCareerGoalFilter = { 'simulationResults.careerGoal': { $type: 'string' } };
  const simulationCareerGoalUpdate = [
    {
      $set: {
        simulationResults: {
          $map: {
            input: '$simulationResults',
            as: 'sim',
            in: {
              $mergeObjects: [
                '$$sim',
                {
                  careerGoal: {
                    $cond: [
                      { $eq: [{ $type: '$$sim.careerGoal' }, 'string'] },
                      { en: '$$sim.careerGoal', de: null },
                      '$$sim.careerGoal',
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
  ];
  const simulationCareerGoalResult = await users.updateMany(
    simulationCareerGoalFilter,
    simulationCareerGoalUpdate
  );
  total += simulationCareerGoalResult.modifiedCount || 0;
  console.log(
    `[migrateAiFieldsToLocalized] simulationResults.careerGoal: ${
      simulationCareerGoalResult.modifiedCount || 0
    } documents updated`
  );

  console.log(`[migrateAiFieldsToLocalized] done. total field updates: ${total}`);
}

run()
  .catch((err) => {
    console.error('[migrateAiFieldsToLocalized] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.connection.close();
    } catch (_) {
      // noop
    }
  });
