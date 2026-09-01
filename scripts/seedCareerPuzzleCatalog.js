#!/usr/bin/env node
/**
 * Seed / refresh the curated DACH Career Puzzle catalog.
 * Usage: node scripts/seedCareerPuzzleCatalog.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const {
  ensurePuzzleCatalogSeeded,
} = require('../src/server/services/careerPuzzle/puzzleCatalogService');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer';
  await mongoose.connect(uri);
  const result = await ensurePuzzleCatalogSeeded();
  console.log(
    `Seeded Career Puzzle catalog: ${result.piecesUpserted} pieces, ${result.edgesUpserted} edges`
  );
  await mongoose.connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
