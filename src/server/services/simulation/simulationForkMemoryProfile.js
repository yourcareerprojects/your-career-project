'use strict';

/** Render starter / small worker dynos are typically 512 MB RAM total. */
const DEFAULT_FORK_MAX_OLD_SPACE_MB = 384;
const DEFAULT_FORK_HEAP_LIMIT_MB = 300;
const HEAP_LIMIT_RATIO = 0.78;

function isSimulationSubprocess() {
  return process.env.SIMULATION_RUNNER_SUBPROCESS === '1';
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parseMaxOldSpaceMbFromNodeOptions(nodeOptions) {
  const raw = String(nodeOptions || '');
  const match = raw.match(/--max-old-space-size=(\d+)/);
  if (!match) return null;
  return parsePositiveInt(match[1], null);
}

function resolveForkMaxOldSpaceMb() {
  const raw = process.env.SIMULATION_FORK_MAX_OLD_SPACE_MB;
  if (raw != null && String(raw).trim() !== '') {
    return parsePositiveInt(raw, DEFAULT_FORK_MAX_OLD_SPACE_MB);
  }
  return DEFAULT_FORK_MAX_OLD_SPACE_MB;
}

function resolveHeapLimitMb() {
  const explicit = process.env.SIMULATION_HEAP_LIMIT_MB;
  if (explicit != null && String(explicit).trim() !== '') {
    return parsePositiveInt(explicit, DEFAULT_FORK_HEAP_LIMIT_MB);
  }
  const fromNode = parseMaxOldSpaceMbFromNodeOptions(process.env.NODE_OPTIONS);
  if (fromNode) {
    return Math.max(128, Math.floor(fromNode * HEAP_LIMIT_RATIO));
  }
  return isSimulationSubprocess() ? DEFAULT_FORK_HEAP_LIMIT_MB : 450;
}

function resolveHeapCheckIntervalMs() {
  const raw = process.env.SIMULATION_HEAP_CHECK_INTERVAL_MS;
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 250) return n;
  }
  return isSimulationSubprocess() ? 2000 : 10000;
}

function resolveForkPathLimits() {
  if (!isSimulationSubprocess()) {
    return {
      targetedPathLimit: parsePositiveInt(process.env.SIMULATION_TARGETED_PATH_LIMIT, 900),
      fallbackPathLimit: parsePositiveInt(process.env.SIMULATION_FALLBACK_PATH_LIMIT, 1200),
      minCandidatePool: parsePositiveInt(process.env.SIMULATION_MIN_CANDIDATE_POOL, 350),
    };
  }
  return {
    targetedPathLimit: parsePositiveInt(process.env.SIMULATION_TARGETED_PATH_LIMIT, 350),
    fallbackPathLimit: parsePositiveInt(process.env.SIMULATION_FALLBACK_PATH_LIMIT, 500),
    minCandidatePool: parsePositiveInt(process.env.SIMULATION_MIN_CANDIDATE_POOL, 240),
  };
}

function resolveForkScoringLimits() {
  if (!isSimulationSubprocess()) {
    return {
      scoreChunkSize: parsePositiveInt(process.env.SIMULATION_SCORE_CHUNK_SIZE, 200),
      scoreConcurrency: Math.max(1, parsePositiveInt(process.env.SIMULATION_SCORE_CONCURRENCY, 12)),
    };
  }
  return {
    scoreChunkSize: parsePositiveInt(process.env.SIMULATION_SCORE_CHUNK_SIZE, 24),
    scoreConcurrency: Math.max(1, parsePositiveInt(process.env.SIMULATION_SCORE_CONCURRENCY, 2)),
  };
}

function resolveForkExplorationVectorCap() {
  return parsePositiveInt(process.env.SIMULATION_EXPLORATION_VECTOR_CAP, 500);
}

function resolveForkVectorCacheSize() {
  const raw = process.env.SIMULATION_VECTOR_CACHE_SIZE;
  if (raw != null && raw !== '') {
    return parsePositiveInt(raw, 64);
  }
  return isSimulationSubprocess() ? 96 : 256;
}

module.exports = {
  DEFAULT_FORK_MAX_OLD_SPACE_MB,
  DEFAULT_FORK_HEAP_LIMIT_MB,
  HEAP_LIMIT_RATIO,
  isSimulationSubprocess,
  parseMaxOldSpaceMbFromNodeOptions,
  resolveForkMaxOldSpaceMb,
  resolveHeapLimitMb,
  resolveHeapCheckIntervalMs,
  resolveForkPathLimits,
  resolveForkScoringLimits,
  resolveForkExplorationVectorCap,
  resolveForkVectorCacheSize,
};
