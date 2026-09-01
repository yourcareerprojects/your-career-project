jest.mock('../utils/simulationPersistence', () => ({
  loadSimulationFromStorage: jest.fn(),
  saveSimulationToStorage: jest.fn(),
}));

jest.mock('../utils/persistLastSimulationProgress', () => ({
  schedulePersistLastSimulationProgress: jest.fn(),
  flushPersistLastSimulationProgress: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../hooks/useProfileQueries', () => ({
  invalidateLastSimulationQuery: jest.fn(),
}));

const {
  loadSimulationFromStorage,
  saveSimulationToStorage,
} = require('../utils/simulationPersistence');
const {
  schedulePersistLastSimulationProgress,
  flushPersistLastSimulationProgress,
} = require('../utils/persistLastSimulationProgress');
const { invalidateLastSimulationQuery } = require('../hooks/useProfileQueries');
const {
  applyExplorationRankingToLastSimulation,
} = require('../utils/applyExplorationRankingToLastSimulation');

function baseResults(overrides = {}) {
  return {
    simulationId: 'sim-1',
    nextSteps: [],
    outsideTheBox: [],
    evaluationFlow: {
      simulationId: 'sim-1',
      nextSteps: [
        {
          id: 'role-1',
          stepId: 'role-1',
          escoId: 'e-existing',
          title: 'Existing Role',
          userEvaluation: 'keep',
          matchScore: 0.8,
          category: 'nextSteps',
        },
      ],
      outsideTheBox: [],
      hasStarted: { nextSteps: true, outsideTheBox: false },
      phases: { nextSteps: 'ranked', outsideTheBox: 'eval' },
      ranked: {
        nextSteps: [
          {
            id: 'role-1',
            title: 'Existing Role',
            matchScore: 0.8,
            category: 'next',
            userEvaluation: 'keep',
            finalRank: 1,
            step: {
              id: 'role-1',
              escoId: 'e-existing',
              title: 'Existing Role',
              userEvaluation: 'keep',
            },
          },
        ],
        outsideTheBox: null,
      },
      hasSeenRanking: { nextSteps: true, outsideTheBox: false },
      wizardPaused: true,
      mergedExplorationSessionIds: [],
      ...overrides.evaluationFlow,
    },
    ...overrides,
  };
}

describe('applyExplorationRankingToLastSimulation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    flushPersistLastSimulationProgress.mockResolvedValue(null);
  });

  it('returns no-roles without persisting', async () => {
    const outcome = await applyExplorationRankingToLastSimulation({
      sessionId: 's1',
      roles: [],
      rankedRows: [],
      results: baseResults(),
    });
    expect(outcome).toEqual({ ok: false, reason: 'no-roles' });
    expect(saveSimulationToStorage).not.toHaveBeenCalled();
    expect(schedulePersistLastSimulationProgress).not.toHaveBeenCalled();
    expect(invalidateLastSimulationQuery).not.toHaveBeenCalled();
  });

  it('prefers rated roles over rankedRows', async () => {
    const results = baseResults();
    const outcome = await applyExplorationRankingToLastSimulation({
      sessionId: 's1',
      roles: [
        {
          id: 'exploration-s1-new',
          escoId: 'e-new',
          title: 'New Role',
          userEvaluation: 'keep',
          matchScore: 0.7,
          preferredCategory: 'nextSteps',
        },
      ],
      rankedRows: [
        {
          id: 'exploration-s1-ignored',
          escoId: 'e-ignored',
          title: 'Ignored',
          userEvaluation: 'dislike',
        },
      ],
      results,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.unchanged).toBe(false);
    const flow = outcome.results.evaluationFlow;
    const keys = (flow.nextSteps || []).map((r) => r.escoId);
    expect(keys).toContain('e-new');
    expect(keys).not.toContain('e-ignored');
  });

  it('updates overlapping esco rating without duplicating', async () => {
    const results = baseResults();
    const outcome = await applyExplorationRankingToLastSimulation({
      sessionId: 's1',
      roles: [
        {
          id: 'exploration-s1-existing',
          escoId: 'e-existing',
          title: 'Existing Role',
          userEvaluation: 'dislike',
          matchScore: 0.5,
        },
      ],
      results,
    });
    expect(outcome.ok).toBe(true);
    const nextSteps = outcome.results.evaluationFlow.nextSteps;
    const matches = nextSteps.filter((r) => r.escoId === 'e-existing');
    expect(matches).toHaveLength(1);
    expect(matches[0].userEvaluation).toBe('dislike');
  });

  it('schedules then flushes persist before invalidate', async () => {
    const callOrder = [];
    schedulePersistLastSimulationProgress.mockImplementation(() => {
      callOrder.push('schedule');
    });
    flushPersistLastSimulationProgress.mockImplementation(() => {
      callOrder.push('flush');
      return Promise.resolve(null);
    });
    invalidateLastSimulationQuery.mockImplementation(() => {
      callOrder.push('invalidate');
    });

    await applyExplorationRankingToLastSimulation({
      sessionId: 's1',
      roles: [
        {
          id: 'exploration-s1-new',
          escoId: 'e-new',
          title: 'New Role',
          userEvaluation: 'keep',
          matchScore: 0.6,
          preferredCategory: 'nextSteps',
        },
      ],
      results: baseResults(),
    });

    expect(callOrder).toEqual(['schedule', 'flush', 'invalidate']);
    expect(saveSimulationToStorage).toHaveBeenCalled();
  });

  it('is idempotent for an already-merged session with integrated roles', async () => {
    const first = await applyExplorationRankingToLastSimulation({
      sessionId: 's1',
      roles: [
        {
          id: 'exploration-s1-new',
          escoId: 'e-new',
          title: 'New Role',
          userEvaluation: 'keep',
          matchScore: 0.6,
          preferredCategory: 'nextSteps',
        },
      ],
      results: baseResults(),
    });
    expect(first.ok).toBe(true);
    expect(first.unchanged).toBe(false);

    jest.clearAllMocks();
    flushPersistLastSimulationProgress.mockResolvedValue(null);

    const second = await applyExplorationRankingToLastSimulation({
      sessionId: 's1',
      roles: [
        {
          id: 'exploration-s1-new',
          escoId: 'e-new',
          title: 'New Role',
          userEvaluation: 'keep',
          matchScore: 0.6,
          preferredCategory: 'nextSteps',
        },
      ],
      results: first.results,
    });

    expect(second.ok).toBe(true);
    expect(second.unchanged).toBe(true);
    expect(saveSimulationToStorage).not.toHaveBeenCalled();
    expect(schedulePersistLastSimulationProgress).not.toHaveBeenCalled();
  });

  it('clears wizardPaused on successful merge', async () => {
    const outcome = await applyExplorationRankingToLastSimulation({
      sessionId: 's1',
      roles: [
        {
          id: 'exploration-s1-new',
          escoId: 'e-new',
          title: 'New Role',
          userEvaluation: 'skip',
          matchScore: 0.4,
          preferredCategory: 'nextSteps',
        },
      ],
      results: baseResults(),
    });
    expect(outcome.results.evaluationFlow.wizardPaused).toBe(false);
  });

  it('loads from session when results are not provided', async () => {
    loadSimulationFromStorage.mockReturnValue({
      results: baseResults(),
      metadata: { simulationDate: '2026-01-01', profileCompletion: 80 },
    });

    const outcome = await applyExplorationRankingToLastSimulation({
      sessionId: 's1',
      roles: [
        {
          id: 'exploration-s1-new',
          escoId: 'e-new',
          title: 'New Role',
          userEvaluation: 'keep',
          matchScore: 0.55,
          preferredCategory: 'nextSteps',
        },
      ],
    });

    expect(outcome.ok).toBe(true);
    expect(loadSimulationFromStorage).toHaveBeenCalled();
    expect(saveSimulationToStorage).toHaveBeenCalled();
  });

  it('skips server persist when persistToServer is false', async () => {
    await applyExplorationRankingToLastSimulation({
      sessionId: 's1',
      roles: [
        {
          id: 'exploration-s1-new',
          escoId: 'e-new',
          title: 'New Role',
          userEvaluation: 'keep',
          matchScore: 0.55,
          preferredCategory: 'nextSteps',
        },
      ],
      results: baseResults(),
      persistToServer: false,
    });
    expect(schedulePersistLastSimulationProgress).not.toHaveBeenCalled();
    expect(flushPersistLastSimulationProgress).not.toHaveBeenCalled();
    expect(invalidateLastSimulationQuery).toHaveBeenCalled();
  });
});
