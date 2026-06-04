#!/usr/bin/env node
/**
 * Report role identity + finalVectors coverage for multiple MongoDB databases.
 * Usage: node scripts/checkEmbeddingCoverageAll.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');

const EMBEDDING_DIMS = 3072;

function swapDatabaseName(uri, dbName) {
  if (!uri || typeof uri !== 'string') return null;
  const q = uri.indexOf('?');
  const base = q >= 0 ? uri.slice(0, q) : uri;
  const query = q >= 0 ? uri.slice(q) : '';
  const slash = base.lastIndexOf('/');
  if (slash < 0 || slash === base.length - 1) {
    return `${base.replace(/\/?$/, '/')}${dbName}${query}`;
  }
  return `${base.slice(0, slash + 1)}${dbName}${query}`;
}

function maskUri(uri) {
  if (!uri) return '(not set)';
  return uri.replace(/(mongodb(?:\+srv)?:\/\/)([^@]+@)?/, '$1***@');
}

const TARGETS = [
  {
    label: 'local',
    uri: process.env.MONGODB_URI_LOCAL || 'mongodb://localhost:27017/career-path-explorer',
  },
  {
    label: 'staging',
    uri:
      process.env.MONGODB_URI_STAGING ||
      swapDatabaseName(process.env.MONGODB_URI, 'career-path-explorer-dev'),
  },
  {
    label: 'production',
    uri: process.env.MONGODB_URI_PRODUCTION || process.env.MONGODB_URI,
  },
];

async function auditDatabase(label, uri) {
  if (!uri) {
    return { label, error: 'No URI configured' };
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    const dbName = mongoose.connection.db.databaseName;

    const total = await CareerPath.countDocuments({});
    const withIdentityText = await CareerPath.countDocuments({
      'roleIdentity.role_identity_text': { $exists: true, $ne: '' },
    });
    const completeFinalVectors = await CareerPath.countDocuments({
      'roleVectors.dims': EMBEDDING_DIMS,
      'roleVectors.finalVectors.default.0': { $exists: true },
      'roleVectors.finalVectors.nextRole.0': { $exists: true },
      'roleVectors.finalVectors.outOfTheBox.0': { $exists: true },
    });
    const needsRebuild = await CareerPath.countDocuments({
      'roleIdentity.role_identity_text': { $exists: true, $ne: '' },
      $or: [
        { roleVectors: null },
        { 'roleVectors.dims': { $ne: EMBEDDING_DIMS } },
        { 'roleVectors.finalVectors.default': { $exists: false } },
        { 'roleVectors.finalVectors.default': { $size: 0 } },
        { 'roleVectors.finalVectors.nextRole': { $exists: false } },
        { 'roleVectors.finalVectors.nextRole': { $size: 0 } },
        { 'roleVectors.finalVectors.outOfTheBox': { $exists: false } },
        { 'roleVectors.finalVectors.outOfTheBox': { $size: 0 } },
      ],
    });
    const missingIdentity = total - withIdentityText;

    const identityComplete = total > 0 && withIdentityText === total;
    const vectorsComplete = total > 0 && completeFinalVectors === total;
    const simulationDataReady =
      total > 0 && withIdentityText > 0 && needsRebuild === 0 && completeFinalVectors >= withIdentityText;

    let status;
    if (total === 0) status = 'empty_db';
    else if (!identityComplete) status = 'missing_role_identity_text';
    else if (needsRebuild > 0) status = 'incomplete_final_vectors';
    else if (vectorsComplete) status = 'complete';
    else status = 'partial_vectors';

    await mongoose.disconnect();

    return {
      label,
      database: dbName,
      uri: maskUri(uri),
      totalCareerPaths: total,
      withRoleIdentityText: withIdentityText,
      missingRoleIdentityText: missingIdentity,
      completeFinalVectors3072: completeFinalVectors,
      stillNeedRebuild: needsRebuild,
      identityTextsComplete: identityComplete,
      finalVectorsComplete: vectorsComplete,
      simulationReady: simulationDataReady,
      status,
    };
  } catch (err) {
    try {
      await mongoose.disconnect();
    } catch (_) {
      /* noop */
    }
    return {
      label,
      uri: maskUri(uri),
      error: err.message || String(err),
      status: 'connection_failed',
    };
  }
}

async function main() {
  const results = [];
  for (const t of TARGETS) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await auditDatabase(t.label, t.uri));
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
