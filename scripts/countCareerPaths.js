#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const total = await CareerPath.countDocuments({});
  const mergedCanonical = await CareerPath.countDocuments({
    mergedFromEscoIds: { $exists: true, $not: { $size: 0 } },
  });
  console.log(
    JSON.stringify({
      totalCareerPaths: total,
      clustersWithMergeTrace: mergedCanonical,
    }),
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
