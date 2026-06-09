#!/usr/bin/env node
'use strict';

/**
 * Archive or restore a career path for simulation candidate pools.
 *
 * Usage:
 *   node scripts/setCareerPathSimulationExcluded.js --esco-id <uri> --exclude --reason "Low quality"
 *   node scripts/setCareerPathSimulationExcluded.js --title "Bingo-Caller" --exclude
 *   node scripts/setCareerPathSimulationExcluded.js --id <mongoId> --include
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CareerPath = require('../src/server/models/CareerPath');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    id: null,
    escoId: null,
    title: null,
    exclude: false,
    include: false,
    reason: '',
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--id') out.id = args[++i];
    else if (a === '--esco-id') out.escoId = args[++i];
    else if (a === '--title') out.title = args[++i];
    else if (a === '--exclude') out.exclude = true;
    else if (a === '--include') out.include = true;
    else if (a === '--reason') out.reason = args[++i] || '';
  }
  if (!out.exclude && !out.include) out.exclude = true;
  if (!out.id && !out.escoId && !out.title) {
    console.error(
      'Usage: node scripts/setCareerPathSimulationExcluded.js (--id <id> | --esco-id <uri> | --title <substring>) [--exclude|--include] [--reason text]'
    );
    process.exit(1);
  }
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  const opts = parseArgs();
  await mongoose.connect(uri);

  let filter = {};
  if (opts.id) filter._id = opts.id;
  else if (opts.escoId) filter.escoId = opts.escoId;
  else {
    const rx = new RegExp(String(opts.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter = { $or: [{ 'title.en': rx }, { 'title.de': rx }] };
  }

  const matches = await CareerPath.find(filter, {
    escoId: 1,
    'title.en': 1,
    simulationExcluded: 1,
  }).lean();

  if (matches.length === 0) {
    console.error('No career paths matched.', filter);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }
  if (matches.length > 1) {
    console.error('Multiple matches; refine selector:', matches);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const doc = matches[0];
  const $set = opts.include
    ? {
        simulationExcluded: false,
        simulationExcludedReason: '',
        simulationExcludedAt: null,
      }
    : {
        simulationExcluded: true,
        simulationExcludedReason: opts.reason || 'Archived manually',
        simulationExcludedAt: new Date(),
      };

  await CareerPath.updateOne({ _id: doc._id }, { $set });
  console.log(
    JSON.stringify(
      {
        _id: String(doc._id),
        escoId: doc.escoId,
        title: doc.title?.en,
        action: opts.include ? 'restored' : 'archived',
        ...$set,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  return mongoose.disconnect().catch(() => {});
});
