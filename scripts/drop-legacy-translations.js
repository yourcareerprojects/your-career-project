#!/usr/bin/env node
/**
 * Drops legacy translation collections (irreversible). Requires --confirm.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/database');

const COLLECTIONS = ['careerpathtranslations', 'skilltranslations', 'skilldomaintranslations'];

async function run() {
  if (!process.argv.includes('--confirm')) {
    console.error('[drop-legacy-translations] Refusing to run without --confirm');
    process.exit(1);
  }
  await connectDB();
  const db = mongoose.connection.db;
  for (const name of COLLECTIONS) {
    const n = await db.collection(name).countDocuments();
    console.log(`[drop-legacy-translations] ${name}: ${n} documents`);
  }
  for (const name of COLLECTIONS) {
    await db.collection(name).drop().catch((err) => {
      if (String(err.message).includes('ns not found')) {
        console.log(`[drop-legacy-translations] ${name}: already absent`);
        return;
      }
      throw err;
    });
    console.log(`[drop-legacy-translations] dropped ${name}`);
  }
  await mongoose.connection.close();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[drop-legacy-translations]', err);
      mongoose.connection.close().catch(() => {}).then(() => process.exit(1));
    });
}

module.exports = { run, COLLECTIONS };
