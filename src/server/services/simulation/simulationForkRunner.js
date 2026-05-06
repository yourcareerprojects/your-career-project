const { fork } = require('child_process');
const path = require('path');
const { getSimulationJobExecutionLimitMs } = require('./simulationJobExecutionLimits');

function getRunnerScriptPath() {
  return path.join(__dirname, '..', '..', '..', '..', 'scripts', 'simulationRunner.js');
}

function forkParentLog(payload) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: 'simulation-fork-runner',
      ...payload,
    })
  );
}

function buildChildEnv() {
  const env = { ...process.env, SIMULATION_RUNNER_SUBPROCESS: '1' };
  const mbRaw = env.SIMULATION_FORK_MAX_OLD_SPACE_MB;
  if (mbRaw != null && String(mbRaw).trim() !== '') {
    const megabytes = Number(mbRaw);
    if (Number.isFinite(megabytes) && megabytes > 0) {
      const chunk = `--max-old-space-size=${Math.floor(megabytes)}`;
      const prev = String(env.NODE_OPTIONS || '').trim();
      env.NODE_OPTIONS = prev ? `${prev} ${chunk}` : chunk;
    }
  }
  return env;
}

/**
 * Run the simulation-only entry in a subprocess. Does not mutate the job document.
 * Wall-clock limit matches {@link getSimulationJobExecutionLimitMs} unless overridden.
 * Lifecycle (Mongo) is updated only by the parent worker when this promise settles.
 */
function runSimulationInChildProcess(jobId, options = {}) {
  const id = String(jobId);
  const wallClockMs = options.wallClockLimitMs ?? getSimulationJobExecutionLimitMs();

  return new Promise((resolve, reject) => {
    let settled = false;
    const runnerPath = getRunnerScriptPath();

    const child = fork(runnerPath, [id], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: buildChildEnv(),
    });

    const killTimer = setTimeout(() => {
      if (settled) return;
      forkParentLog({
        event: 'child_exec_timeout_triggered',
        jobId: id,
        wallClockMs,
        note: 'Sending SIGKILL — parent will mark job lifecycle from rejection',
      });
      try {
        child.kill('SIGKILL');
      } catch (_) {
        /* noop */
      }
    }, wallClockMs);

    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (err) reject(err);
      else resolve(value);
    }

    if (child.stdout) {
      child.stdout.on('data', (buf) => {
        process.stdout.write(buf);
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (buf) => {
        process.stderr.write(buf);
      });
    }

    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'success') {
        finish(null, msg.result);
      } else if (msg.type === 'error') {
        const err = new Error(msg.error || 'Child simulation error');
        if (msg.stack) err.stack = msg.stack;
        finish(err);
      }
    });

    child.on('error', (err) => {
      finish(err);
    });

    child.on('close', (code, signal) => {
      if (settled) return;

      if (signal === 'SIGKILL') {
        finish(new Error('Simulation timeout - child process killed'));
        return;
      }

      if (signal) {
        const hint =
          signal === 'SIGABRT'
            ? ' (often Node heap OOM on small hosts; try a larger Render plan, set SIMULATION_FORK_MAX_OLD_SPACE_MB, lower SIMULATION_VECTOR_CACHE_SIZE, set SIMULATION_SCORE_CONCURRENCY=1, or reduce SIMULATION_*_PATH_LIMIT / SIMULATION_EXPLORATION_VECTOR_CAP)'
            : '';
        finish(new Error(`Child process exited with signal ${signal}${hint}`));
        return;
      }

      if (code !== 0 && code != null) {
        finish(new Error(`Child process exited with code ${code}`));
        return;
      }

      setTimeout(() => {
        if (!settled) {
          finish(new Error('Child process exited without result'));
        }
      }, 4000);
    });
  });
}

module.exports = {
  runSimulationInChildProcess,
};
