#!/usr/bin/env node
require('../config/loadEnv').loadEnv();

const connectDB = require('../config/database');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { processOneSimulationJob } = require('../src/server/controllers/profileController');
const SimulationJob = require('../src/server/models/SimulationJob');
const { createConcurrencyGate } = require('../src/server/services/simulation/simulationWorkerConcurrency');

/** Bumps when worker logging/diagnostics change — confirm Render shows this after deploy. */
const WORKER_BUILD_TAG = 'simulation-worker 2026-05-06c';

const POLL_INTERVAL_MS = Number(process.env.SIMULATION_JOB_POLL_INTERVAL_MS || 2000);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoop() {
  await connectDB();
  const concurrencyGate = createConcurrencyGate();
  const workerInstance = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(process.pid);
  console.log(`[simulation-worker] ${WORKER_BUILD_TAG} instance=${workerInstance} pid=${process.pid}`);
  console.log(
    `[simulation-worker] concurrency maxConcurrent=${concurrencyGate.maxConcurrent} env=SIMULATION_MAX_CONCURRENT_JOBS`
  );
  console.log('[simulation-worker] connected, polling for jobs...');
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
  const mongoHost = mongoUri ? mongoUri.replace(/(mongodb(?:\+srv)?:\/\/)([^@]+@)?/, '$1***@') : '(not set)';
  console.log(`[simulation-worker] mongo uri: ${mongoHost}`);
  const dbName = mongoose.connection?.db?.databaseName;
  console.log(`[simulation-worker] MongoDB database name: ${dbName || '(not available yet)'}`);

  let idleTicks = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const job = await concurrencyGate.runWithConcurrencyLimit(() => processOneSimulationJob());
      if (job) {
        idleTicks = 0;
        console.log(`[simulation-worker] processed job ${String(job._id)} => ${job.status}`);
        continue;
      }
      idleTicks += 1;
      if (idleTicks % 15 === 0) {
        const [queued, pending, running] = await Promise.all([
          SimulationJob.countDocuments({ status: 'queued' }),
          SimulationJob.countDocuments({ status: 'pending' }),
          SimulationJob.countDocuments({ status: 'running' }),
        ]);
        const claimable = queued + pending;
        console.log(
          `[simulation-worker] idle poll (${idleTicks}), claimable=${claimable} (queued=${queued}, pending=${pending}), running=${running}`
        );
        if (running > 0 && claimable === 0) {
          console.warn(
            '[simulation-worker] Jobs exist in "running" but none in "queued". ' +
              'This worker will stay idle until those finish or are requeued (stale running → see SIMULATION_JOB_STALE_RUNNING_MS). ' +
              'If you never see [simulation-job] claimed ... from this service, MONGODB_URI may not match the API (wrong DB), or another dyno holds the job.'
          );
        }
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
