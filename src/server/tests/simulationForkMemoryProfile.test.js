'use strict';

const {
  resolveForkMaxOldSpaceMb,
  resolveHeapLimitMb,
  resolveHeapCheckIntervalMs,
  resolveForkPathLimits,
  resolveForkScoringLimits,
  resolveForkExplorationVectorCap,
  resolveForkVectorCacheSize,
  parseMaxOldSpaceMbFromNodeOptions,
} = require('../services/simulation/simulationForkMemoryProfile');

describe('simulationForkMemoryProfile', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  test('defaults fork child heap limit below max-old-space-size', () => {
    process.env = {
      ...envBackup,
      SIMULATION_RUNNER_SUBPROCESS: '1',
      NODE_OPTIONS: '--max-old-space-size=384',
    };
    delete process.env.SIMULATION_HEAP_LIMIT_MB;
    expect(resolveHeapLimitMb()).toBe(299);
    expect(resolveHeapCheckIntervalMs()).toBe(2000);
  });

  test('resolveForkMaxOldSpaceMb uses env override', () => {
    process.env.SIMULATION_FORK_MAX_OLD_SPACE_MB = '512';
    expect(resolveForkMaxOldSpaceMb()).toBe(512);
  });

  test('resolveForkMaxOldSpaceMb falls back when unset', () => {
    delete process.env.SIMULATION_FORK_MAX_OLD_SPACE_MB;
    expect(resolveForkMaxOldSpaceMb()).toBe(384);
  });

  test('subprocess path limits are smaller than worker defaults', () => {
    delete process.env.SIMULATION_TARGETED_PATH_LIMIT;
    delete process.env.SIMULATION_FALLBACK_PATH_LIMIT;
    delete process.env.SIMULATION_MIN_CANDIDATE_POOL;

    process.env.SIMULATION_RUNNER_SUBPROCESS = '1';
    const forkLimits = resolveForkPathLimits();
    delete process.env.SIMULATION_RUNNER_SUBPROCESS;
    const workerLimits = resolveForkPathLimits();

    expect(forkLimits.targetedPathLimit).toBeLessThan(workerLimits.targetedPathLimit);
    expect(forkLimits.fallbackPathLimit).toBeLessThan(workerLimits.fallbackPathLimit);
  });

  test('subprocess scoring uses smaller chunks and concurrency 1', () => {
    delete process.env.SIMULATION_SCORE_CHUNK_SIZE;
    delete process.env.SIMULATION_SCORE_CONCURRENCY;
    process.env.SIMULATION_RUNNER_SUBPROCESS = '1';
    expect(resolveForkScoringLimits()).toEqual({ scoreChunkSize: 16, scoreConcurrency: 1 });
  });

  test('parseMaxOldSpaceMbFromNodeOptions reads NODE_OPTIONS', () => {
    expect(parseMaxOldSpaceMbFromNodeOptions('--inspect --max-old-space-size=448')).toBe(448);
    expect(parseMaxOldSpaceMbFromNodeOptions('--inspect')).toBeNull();
  });

  test('subprocess exploration cap defaults lower than worker', () => {
    delete process.env.SIMULATION_EXPLORATION_VECTOR_CAP;
    process.env.SIMULATION_RUNNER_SUBPROCESS = '1';
    expect(resolveForkExplorationVectorCap()).toBe(250);
    delete process.env.SIMULATION_RUNNER_SUBPROCESS;
    expect(resolveForkExplorationVectorCap()).toBe(500);
  });

  test('subprocess vector cache is smaller', () => {
    delete process.env.SIMULATION_VECTOR_CACHE_SIZE;
    process.env.SIMULATION_RUNNER_SUBPROCESS = '1';
    expect(resolveForkVectorCacheSize()).toBe(64);
    delete process.env.SIMULATION_RUNNER_SUBPROCESS;
    expect(resolveForkVectorCacheSize()).toBe(256);
  });
});
