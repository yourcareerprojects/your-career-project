#!/usr/bin/env node

require('dotenv').config();

const path = require('path');
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
require('dotenv').config({ path: path.resolve(__dirname, '..', envFile) });

const mongoose = require('mongoose');
const connectDB = require('../config/database');
const { getSimulationJobReadOnly } = require('../src/server/services/simulationJobService');
const { executeCareerSimulation } = require('../src/server/services/simulation/simulationEngine');

function childLog(event, payload) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: 'simulation-runner-child',
      event,
      ...payload,
    })
  );
}

/**
 * Cooperative memory guard for the child process (where simulation heap grows).
 * Aborts the in-flight run before V8 SIGABRT on small instances.
 */
function startSimulationHeapWatchdog(abortController) {
  const limitMb = Number(process.env.SIMULATION_HEAP_LIMIT_MB || '450');
  const intervalMs = Number(process.env.SIMULATION_HEAP_CHECK_INTERVAL_MS || '10000');
  if (!Number.isFinite(limitMb) || limitMb <= 0) {
    return () => {};
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 250) {
    return () => {};
  }

  const iv = setInterval(() => {
    const heapMb = process.memoryUsage().heapUsed / (1024 * 1024);
    if (heapMb <= limitMb) return;
    childLog('memory_watchdog_triggered', {
      heapUsedMb: Math.round(heapMb * 100) / 100,
      heapLimitConfiguredMb: limitMb,
      checkIntervalMs: intervalMs,
    });
    console.warn(
      `[simulation-runner-child] MEMORY_LIMIT exceeded heapUsedMb=${Math.round(heapMb * 100) / 100} limitMb=${limitMb}`
    );
    try {
      abortController.abort();
    } catch (_) {
      /* noop */
    }
    clearInterval(iv);
  }, intervalMs);

  return () => {
    clearInterval(iv);
  };
}

function cloneForIpc(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Wait for IPC to flush before exiting. Exiting immediately after process.send() often drops
 * the message on the floor (parent sees code 0 + "exited without result").
 */
async function sendExit(payload, exitCode) {
  let toSend = payload;
  try {
    toSend = cloneForIpc(payload);
  } catch (e) {
    toSend = {
      type: 'error',
      error: `IPC serialization failed: ${e?.message || e}`,
      ...(typeof e?.stack === 'string' ? { stack: e.stack } : {}),
    };
    exitCode = 1;
  }

  if (typeof process.send === 'function') {
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(undefined);
      };
      const watchdog = setTimeout(() => {
        console.error('[simulation-runner] IPC send watchdog — proceeding to exit');
        finish();
      }, 8000);

      try {
        const ok = process.send(toSend, (err) => {
          clearTimeout(watchdog);
          if (err) {
            console.error('[simulation-runner] process.send callback error', err?.message || err);
          }
          finish();
        });
        if (ok === false) {
          clearTimeout(watchdog);
          console.error('[simulation-runner] process.send returned false (channel full or closed)');
          finish();
        }
      } catch (e) {
        clearTimeout(watchdog);
        console.error('[simulation-runner] process.send threw', e?.message || e);
        finish();
      }
    });
  }

  try {
    await mongoose.connection.close();
  } catch (_) {
    /* noop */
  }
  process.exit(exitCode);
}

async function main() {
  const jobId = process.argv[2];

  if (!jobId) {
    await sendExit({ type: 'error', error: 'Missing job ID' }, 1);
    return;
  }

  await connectDB();

  try {
    const job = await getSimulationJobReadOnly(jobId);

    if (!job) {
      await sendExit({ type: 'error', error: 'Simulation job not found' }, 1);
      return;
    }

    const jobType = job.payload?.jobType || 'simulation_run';

    if (jobType !== 'simulation_run') {
      await sendExit(
        {
          type: 'error',
          error: `Wrong job type for simulation runner (expected simulation_run): ${jobType}`,
        },
        1
      );
      return;
    }

    childLog('simulation_start', {
      jobId: String(jobId),
      jobType,
      userId: String(job.userId),
      pid: process.pid,
    });

    const payloadObj = job.payload && typeof job.payload === 'object' ? { ...job.payload } : {};

    const reqLike = {
      user: { id: String(job.userId), userId: String(job.userId) },
      body: payloadObj,
      language: job.language || 'en',
    };

    const heapAc = new AbortController();
    const stopHeapWatchdog = startSimulationHeapWatchdog(heapAc);

    let result;
    try {
      result = await new Promise((resolve, reject) => {
        let settled = false;
        const resLike = {
          statusCode: 200,
          setTimeout() {
            /* child has no Express server timeout semantics */
          },
          status(code) {
            this.statusCode = Number(code) || 500;
            return this;
          },
          json(obj) {
            if (settled) return this;
            settled = true;
            resolve({
              statusCode: this.statusCode || 200,
              payload: obj,
            });
            return this;
          },
        };

        executeCareerSimulation(reqLike, resLike, {
          jobId: String(jobId),
          context: 'fork-child',
          abortSignal: heapAc.signal,
        }).catch((err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      });
    } finally {
      stopHeapWatchdog();
    }

    childLog('simulation_end', { jobId: String(jobId), statusCode: result.statusCode });

    await sendExit(
      {
        type: 'success',
        result: {
          statusCode: result.statusCode,
          payload: result.payload,
        },
      },
      0
    );
  } catch (err) {
    const message = err?.message || String(err);
    childLog('simulation_error_boundary', {
      jobId: String(jobId),
      error: message,
    });
    await sendExit(
      {
        type: 'error',
        error: message,
        ...(typeof err?.stack === 'string' ? { stack: err.stack } : {}),
      },
      1
    );
  }
}

main().catch(async (err) => {
  await sendExit(
    {
      type: 'error',
      error: err?.message || String(err),
      ...(typeof err?.stack === 'string' ? { stack: err.stack } : {}),
    },
    1
  );
});
