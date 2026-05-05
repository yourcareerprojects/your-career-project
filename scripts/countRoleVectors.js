#!/usr/bin/env node
const mongoose = require('mongoose');
require('dotenv').config();
const CareerPath = require('../src/server/models/CareerPath');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/career-path-explorer');
  const total = await CareerPath.countDocuments({});
  const withRoleIdentity = await CareerPath.countDocuments({ 'roleIdentity.role_identity_text': { $exists: true, $ne: '' } });
  const withSubVectors = await CareerPath.countDocuments({ 'roleVectors.structured_vector_domains': { $exists: true, $ne: [] } });
  console.log('Total CareerPath documents:', total);
  console.log('With roleIdentity (prerequisite):', withRoleIdentity);
  console.log('With sub-vectors:', withSubVectors);
  await mongoose.disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
