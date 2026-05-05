// removeLowQualityOccupationFields.js
// One-time cleanup: remove low-quality job-detail fields from MongoDB.
//
// This strips fields we no longer trust from:
// - CareerPath documents (ESCO occupations)
// - User.simulationResults / User.lastSimulationResult nested career-step objects
//
// Usage (PowerShell):
//   cmd /c node scripts/removeLowQualityOccupationFields.js
//
// Optional env:
//   MONGODB_URI / MONGODB_TEST_URI

const mongoose = require('mongoose');
require('dotenv').config();

const CareerPath = require('../src/server/models/CareerPath');
const User = require('../src/server/models/User');

async function main() {
  const MONGODB_URI =
    process.env.MONGODB_URI ||
    process.env.MONGODB_TEST_URI ||
    'mongodb://localhost:27017/career-path-explorer';

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  const careerPathUnset = {
    education: '',
    experience: '',
    location: '',
    salary: '',
    salaryRange: '',
    salaryMin: '',
    salaryMax: '',
    trends: '',
    industryGrowth: '',
    remoteWork: '',
    careerProgression: '',
  };

  const stepUnset = {
    // Common low-quality fields we want removed from step payloads
    salary: '',
    salaryRange: '',
    salaryMin: '',
    salaryMax: '',
    education: '',
    experience: '',
    location: '',
    trends: '',
    industryGrowth: '',
    remoteWork: '',
    careerProgression: '',
  };

  console.log('Cleaning CareerPath documents...');
  const cpRes = await CareerPath.updateMany({}, { $unset: careerPathUnset });
  console.log('CareerPath cleaned:', summarizeMongoResult(cpRes));

  console.log('Cleaning User documents (simulation results + lastSimulationResult)...');
  const userRes = await User.updateMany(
    {},
    {
      $unset: {
        // lastSimulationResult (unsaved simulation snapshot)
        ...prefixUnset('lastSimulationResult.results.nextSteps.$[]', stepUnset),
        ...prefixUnset('lastSimulationResult.results.outsideTheBox.$[]', stepUnset),
        ...prefixUnset('lastSimulationResult.results.furtherAdvice.$[]', stepUnset),
        ...prefixUnset('lastSimulationResult.results.prioritizedLists.nextCareerRoles.$[]', stepUnset),
        ...prefixUnset('lastSimulationResult.results.prioritizedLists.outsideTheBoxRoles.$[]', stepUnset),

        // saved simulations
        ...prefixUnset('simulationResults.$[].results.nextSteps.$[]', stepUnset),
        ...prefixUnset('simulationResults.$[].results.outsideTheBox.$[]', stepUnset),
        ...prefixUnset('simulationResults.$[].results.furtherAdvice.$[]', stepUnset),
        ...prefixUnset('simulationResults.$[].results.prioritizedLists.nextCareerRoles.$[]', stepUnset),
        ...prefixUnset('simulationResults.$[].results.prioritizedLists.outsideTheBoxRoles.$[]', stepUnset),

        // legacy replacement pools (older data)
        ...prefixUnset('simulationResults.$[].replacementPools.nextSteps.$[]', stepUnset),
        ...prefixUnset('simulationResults.$[].replacementPools.outsideTheBox.$[]', stepUnset),
        ...prefixUnset('simulationResults.$[].replacementPools.furtherAdvice.$[]', stepUnset),
      },
    }
  );
  console.log('Users cleaned:', summarizeMongoResult(userRes));

  await mongoose.disconnect();
  process.exit(0);
}

function prefixUnset(prefix, unsetShape) {
  const out = {};
  for (const key of Object.keys(unsetShape)) {
    out[`${prefix}.${key}`] = '';
  }
  return out;
}

function summarizeMongoResult(res) {
  if (!res) return res;
  // Mongoose returns different result shapes depending on version
  return {
    matchedCount: res.matchedCount ?? res.n ?? undefined,
    modifiedCount: res.modifiedCount ?? res.nModified ?? undefined,
  };
}

main().catch(async (err) => {
  console.error('Cleanup failed:', err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});

