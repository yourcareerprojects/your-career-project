#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');

const needle = process.argv[2] || 'distribution manager';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const docs = await CareerPath.find({ title: rx }, { escoId: 1, title: 1, _id: 0 })
    .sort({ title: 1 })
    .lean();
  console.log(JSON.stringify({ needle, count: docs.length, roles: docs }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
