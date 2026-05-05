#!/usr/bin/env node
/** Whole-word match in CareerPath.title (case-insensitive). */
require('dotenv').config();
const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');

const word = process.argv[2];
if (!word) {
  console.error('Usage: node scripts/findRolesTitleWord.js <word>');
  process.exit(1);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const docs = await CareerPath.find(
    { title: { $regex: `\\b${escaped}\\b`, $options: 'i' } },
    { escoId: 1, title: 1, _id: 0 },
  )
    .sort({ title: 1 })
    .lean();
  console.log(JSON.stringify({ word, count: docs.length, roles: docs }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
