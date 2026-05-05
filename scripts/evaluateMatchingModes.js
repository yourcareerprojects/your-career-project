#!/usr/bin/env node
/**
 * evaluateMatchingModes.js
 *
 * Demonstrates scoreNextRole vs scoreOutOfTheBox for a sample role.
 * Validates determinism and shows score comparison.
 *
 * Usage:
 *   node scripts/evaluateMatchingModes.js [--limit=N]
 *
 * Prerequisites: buildRoleIdentityTexts and buildRoleVectors must be run first.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const CareerPath = require('../src/server/models/CareerPath');
const {
  scoreNextRole,
  scoreOutOfTheBox,
  scoreOutOfTheBoxBatch,
} = require('../src/server/services/embedding/roleMatchingScorer');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 20;
  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { limit };
}

const SAMPLE_USER_PROFILE = {
  userSkills: ['JavaScript', 'React', 'TypeScript', 'Project management', 'Leadership'],
  userWorkExperience: [
    { title: 'Senior Software Developer', description: 'Led frontend team' },
    { title: 'Software Engineer', description: 'Built web applications' },
  ],
  userEducation: { highestDegree: 'Bachelor' },
  userCareerPreferences: { domains: ['Technology', 'Software', 'Digital'] },
  userInterests: ['Innovation', 'Mentoring', 'Architecture'],
  careerGoal: 'Technical Lead',
};

async function main() {
  const { limit } = parseArgs();

  console.log('=== Matching Modes Evaluation ===');
  console.log('  User profile: Senior Software Developer, JS/React/TS, career goal: Technical Lead');
  console.log('');

  await mongoose.connect(MONGODB_URI);

  const roles = await CareerPath.find({
    'roleVectors.hybrid_vector': { $exists: true, $ne: [] },
    'roleVectors.structured_vector_domains': { $exists: true, $ne: [] },
    'roleVectors.identity_vector': { $exists: true, $ne: [] },
  })
    .limit(Math.max(limit, 60))
    .lean();

  if (roles.length === 0) {
    console.error('ERROR: No roles with roleVectors found. Run buildRoleIdentityTexts and buildRoleVectors first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const sample = roles.slice(0, limit);

  console.log('--- Score Comparison (one sample role) ---\n');

  const firstRole = sample[0];
  const nextResult = await scoreNextRole(SAMPLE_USER_PROFILE, firstRole);
  const exploreResult = await scoreOutOfTheBox(SAMPLE_USER_PROFILE, firstRole);

  console.log(`Role: ${firstRole.title}`);
  console.log(`  Seniority: ${firstRole.seniority?.seniority_level ?? '?'}`);
  console.log('');
  console.log('  NEXT_ROLE (conservative, skill-adjacent):');
  if (nextResult) {
    console.log(`    cosine:     ${nextResult.cosine.toFixed(4)}`);
    console.log(`    levelDiff: ${nextResult.levelDiff}`);
    console.log(`    penalty:   -${nextResult.penalty.toFixed(4)}`);
    console.log(`    score:     ${nextResult.score.toFixed(4)}`);
  } else {
    console.log('    (null - missing vectors)');
  }
  console.log('');
  console.log('  OUT_OF_THE_BOX (explorative, identity-adjacent):');
  if (exploreResult) {
    console.log(`    cosine:     ${exploreResult.cosine.toFixed(4)}`);
    console.log(`    levelDiff: ${exploreResult.levelDiff}`);
    console.log(`    penalty:   -${exploreResult.penalty.toFixed(4)}`);
    console.log(`    score:     ${exploreResult.score.toFixed(4)}`);
  } else {
    console.log('    (null - missing vectors)');
  }

  console.log('');
  console.log('--- Determinism Check (run twice, same inputs) ---');
  const r1 = await scoreNextRole(SAMPLE_USER_PROFILE, firstRole);
  const r2 = await scoreNextRole(SAMPLE_USER_PROFILE, firstRole);
  const batch1 = await scoreOutOfTheBoxBatch(SAMPLE_USER_PROFILE, sample);
  const batch2 = await scoreOutOfTheBoxBatch(SAMPLE_USER_PROFILE, sample);
  const nextDeterministic = r1 && r2 && Math.abs(r1.score - r2.score) < 1e-10;
  const exploreDeterministic =
    batch1.length === batch2.length &&
    batch1.every((x, i) => Math.abs(x.result.score - batch2[i].result.score) < 1e-10);
  console.log(`  NEXT_ROLE deterministic: ${nextDeterministic ? 'YES' : 'NO'}`);
  console.log(`  OUT_OF_THE_BOX deterministic: ${exploreDeterministic ? 'YES' : 'NO'}`);

  console.log('');
  console.log(`--- OUT_OF_THE_BOX: Top ${Math.min(20, sample.length)} by final score ---`);
  const batchScored = await scoreOutOfTheBoxBatch(SAMPLE_USER_PROFILE, sample);

  const ranked = batchScored
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, 20)
    .map((x, i) => ({ rank: i + 1, ...x }));

  console.log('  Rank | Score | Cosine | Role');
  console.log('  -----+-------+--------+-------------------------');
  for (const r of ranked) {
    const title = (r.role.title || '').padEnd(23).slice(0, 23);
    console.log(
      `  ${String(r.rank).padStart(4)} | ${r.result.score.toFixed(4).padStart(5)} | ${r.result.cosine.toFixed(4).padStart(6)} | ${title}`
    );
  }

  console.log('');
  console.log('--- Top 3 by NEXT_ROLE vs OUT_OF_THE_BOX ---');
  const withNext = (
    await Promise.all(
      sample.map(async (role) => {
        const result = await scoreNextRole(SAMPLE_USER_PROFILE, role);
        return { role, result };
      })
    )
  )
    .filter((x) => x.result != null)
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, 3);
  const withExplore = batchScored.sort((a, b) => b.result.score - a.result.score).slice(0, 3);

  console.log('  NEXT_ROLE top 3:');
  for (const { role: r, result } of withNext) {
    console.log(`    - ${r.title} (score: ${result.score.toFixed(4)})`);
  }
  console.log('  OUT_OF_THE_BOX top 3:');
  for (const { role: r, result } of withExplore) {
    console.log(`    - ${r.title} (score: ${result.score.toFixed(4)})`);
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
