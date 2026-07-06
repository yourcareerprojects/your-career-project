#!/usr/bin/env node
/**
 * Backfill career path requiredSkills so URI-only rows become human-readable titles.
 * Uses MongoDB EscoSkill (and ESCO API for any remaining misses).
 */

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/database');
const { normalizeCareerPathRequiredSkills } = require('../src/server/services/escoService');

async function main() {
  await connectDB();
  const result = await normalizeCareerPathRequiredSkills();
  console.log(`Scanned ${result.scanned} career paths, updated ${result.updated}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
