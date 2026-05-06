#!/usr/bin/env node
require('dotenv').config();

const path = require('path');
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
require('dotenv').config({ path: path.resolve(__dirname, '..', envFile) });

const connectDB = require('../config/database');
const mongoose = require('mongoose');
const { processOneSimulationJob } = require('../src/server/controllers/profileController');
const SimulationJob = require('../src/server/models/SimulationJob');

const POLL_INTERVAL_MS = Number(process.env.SIMULATION_JOB_POLL_INTERVAL_MS || 2000);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoop() {
  await connectDB();
  console.log('[simulation-worker] connected, polling for jobs...');
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
  const mongoHost = mongoUri ? mongoUri.replace(/(mongodb(?:\+srv)?:\/\/)([^@]+@)?/, '$1***@') : '(not set)';
  console.log(`[simulation-worker] mongo uri: ${mongoHost}`);

  let idleTicks = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const job = await processOneSimulationJob();
      if (job) {
        idleTicks = 0;
        console.log(`[simulation-worker] processed job ${String(job._id)} => ${job.status}`);
        continue;
      }
      idleTicks += 1;
      if (idleTicks % 15 === 0) {
        const queuedCount = await SimulationJob.countDocuments({ status: { $in: ['queued', 'pending'] } });
        console.log(`[simulation-worker] idle poll (${idleTicks}), visible queued jobs: ${queuedCount}`);
      }
    } catch (err) {
      console.error('[simulation-worker] loop error:', err?.message || err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

runLoop().catch(async (err) => {
  console.error('[simulation-worker] fatal:', err);
  try {
    await mongoose.connection.close();
  } catch (_) {}
  process.exit(1);
});
