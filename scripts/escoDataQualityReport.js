// escoDataQualityReport.js
// Quick data-quality report for the ESCO-backed CareerPath dataset.
//
// Usage (PowerShell):
//   cmd /c node scripts/escoDataQualityReport.js
//
// Requires: MONGODB_URI in .env (or defaults to local mongo)

const mongoose = require('mongoose');
require('dotenv').config();

const CareerPath = require('../src/server/models/CareerPath');

async function main() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  const [
    total,
    missingDescription,
    withRequiredSkillUris,
    withRequiredSkillKeys,
    withIscoGroup,
  ] = await Promise.all([
    CareerPath.countDocuments({}),
    CareerPath.countDocuments({ $or: [{ description: { $exists: false } }, { description: '' }, { description: null }] }),
    CareerPath.countDocuments({ 'requiredSkillUris.0': { $exists: true } }),
    CareerPath.countDocuments({ 'requiredSkillKeys.0': { $exists: true } }),
    CareerPath.countDocuments({ iscoGroup: { $exists: true, $ne: '' } }),
  ]);

  console.log('--- ESCO CareerPath data quality ---');
  console.log(`Total occupations:                 ${total}`);
  console.log(`Missing/empty description:         ${missingDescription} (${pct(missingDescription, total)})`);
  console.log(`Has requiredSkillUris:             ${withRequiredSkillUris} (${pct(withRequiredSkillUris, total)})`);
  console.log(`Has requiredSkillKeys:             ${withRequiredSkillKeys} (${pct(withRequiredSkillKeys, total)})`);
  console.log(`Has iscoGroup:                     ${withIscoGroup} (${pct(withIscoGroup, total)})`);

  // Title duplicate hotspots (case-insensitive)
  const duplicates = await CareerPath.aggregate([
    { $project: { titleLower: { $toLower: '$title' }, title: 1, escoId: 1 } },
    { $group: { _id: '$titleLower', count: { $sum: 1 }, examples: { $addToSet: '$title' } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);

  if (duplicates.length) {
    console.log('\nTop duplicate titles (case-insensitive, top 20):');
    for (const d of duplicates) {
      const example = Array.isArray(d.examples) && d.examples.length ? d.examples[0] : d._id;
      console.log(`- ${d.count}x  ${example}`);
    }
  } else {
    console.log('\nNo duplicate titles detected (case-insensitive).');
  }

  await mongoose.disconnect();
  process.exit(0);
}

function pct(part, whole) {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

main().catch(async (err) => {
  console.error('Report failed:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});

