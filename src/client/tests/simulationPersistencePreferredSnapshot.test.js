const store = new Map();

global.sessionStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => {
    store.set(String(key), String(value));
  },
  removeItem: (key) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
};

const {
  saveSimulationToStorage,
  loadSimulationFromStorage,
  loadPreferredSimulationSnapshot,
  clearSimulationFromStorage,
  hasActiveCareerSimulationSession,
  updateLatestSimulationSnapshot,
  saveSimulationDetailContext,
  loadSimulationDetailContext,
  clearSimulationDetailContext,
} = require('../utils/simulationPersistence');

describe('loadPreferredSimulationSnapshot', () => {
  beforeEach(() => {
    store.clear();
  });

  it('prefers the primary modified session snapshot', () => {
    const sessionResults = {
      simulationId: 'sim-1',
      nextSteps: [],
      outsideTheBox: [],
      evaluationFlow: {
        simulationId: 'sim-1',
        roles: [
          {
            id: 'role-1',
            escoId: 'e1',
            title: 'Original',
            category: 'nextSteps',
            userEvaluation: 'keep',
            matchScore: 0.8,
          },
          {
            id: 'exploration-s1-e9',
            escoId: 'e9',
            title: 'Explored',
            category: 'nextSteps',
            userEvaluation: 'keep',
            matchScore: 0.7,
            source: 'exploration',
            explorationSessionId: 's1',
          },
        ],
        phases: { nextSteps: 'ranked', outsideTheBox: 'ranked' },
        hasSeenRanking: { nextSteps: true, outsideTheBox: true },
        mergedExplorationSessionIds: ['s1'],
      },
    };

    saveSimulationToStorage(
      {
        results: sessionResults,
        simulationDate: new Date('2026-01-02T00:00:00.000Z'),
        profileCompletion: 80,
      },
      'modified'
    );

    const preferred = loadPreferredSimulationSnapshot();
    expect(preferred.source).toBe('session');
    expect(preferred.state).toBe('modified');
    expect(preferred.results.evaluationFlow.roles.some((r) => r.escoId === 'e9')).toBe(true);
  });

  it('updateLatestSimulationSnapshot persists detail-page edits through the primary snapshot', () => {
    saveSimulationToStorage(
      {
        results: {
          simulationId: 'sim-1',
          nextSteps: [],
          outsideTheBox: [],
          evaluationFlow: {
            simulationId: 'sim-1',
            roles: [
              {
                id: 'role-1',
                escoId: 'e1',
                category: 'nextSteps',
                userEvaluation: 'keep',
              },
            ],
            phases: { nextSteps: 'ranked', outsideTheBox: 'eval' },
          },
        },
        simulationDate: '2026-01-03T00:00:00.000Z',
        profileCompletion: 70,
      },
      'modified'
    );

    const updated = updateLatestSimulationSnapshot((results) => ({
      ...results,
      evaluationFlow: {
        ...results.evaluationFlow,
        roles: results.evaluationFlow.roles.map((role) =>
          role.id === 'role-1' ? { ...role, userEvaluation: 'dislike' } : role
        ),
      },
    }));

    expect(updated.state).toBe('modified');
    expect(updated.results.evaluationFlow.roles[0].userEvaluation).toBe('dislike');

    const loaded = loadSimulationFromStorage();
    expect(loaded.results.evaluationFlow.roles[0].userEvaluation).toBe('dislike');
  });

  it('updateLatestSimulationSnapshot keeps merged exploration roles in the primary snapshot', () => {
    saveSimulationToStorage(
      {
        results: {
          simulationId: 'sim-1',
          nextSteps: [],
          outsideTheBox: [],
          evaluationFlow: {
            simulationId: 'sim-1',
            roles: [
              {
                id: 'exploration-s1-e9',
                escoId: 'e9',
                title: 'Explored',
                category: 'nextSteps',
                userEvaluation: 'keep',
                source: 'exploration',
                explorationSessionId: 's1',
              },
            ],
            phases: { nextSteps: 'ranked', outsideTheBox: 'eval' },
            mergedExplorationSessionIds: ['s1'],
          },
        },
        simulationDate: '2026-01-03T00:00:00.000Z',
        profileCompletion: 70,
      },
      'modified'
    );

    const updated = updateLatestSimulationSnapshot((results) => ({
      ...results,
      localeEcho: 'en',
    }));

    expect(updated.results.evaluationFlow.roles.some((role) => role.escoId === 'e9')).toBe(true);
    expect(updated.results.evaluationFlow.mergedExplorationSessionIds).toEqual(['s1']);
  });

  it('loadSimulationFromStorage rematerializes exploration roles from persisted roles[]', () => {
    saveSimulationToStorage(
      {
        results: {
          simulationId: 'sim-1',
          evaluationFlow: {
            simulationId: 'sim-1',
            roles: [
              {
                id: 'exploration-s1-e9',
                escoId: 'e9',
                title: 'Explored',
                category: 'nextSteps',
                userEvaluation: 'keep',
                matchScore: 0.7,
                order: 0,
                source: 'exploration',
                explorationSessionId: 's1',
              },
            ],
            phases: { nextSteps: 'ranked', outsideTheBox: 'ranked' },
            hasSeenRanking: { nextSteps: true, outsideTheBox: true },
            mergedExplorationSessionIds: ['s1'],
          },
        },
        simulationDate: new Date(),
        profileCompletion: 80,
      },
      'modified'
    );

    const loaded = loadSimulationFromStorage();
    expect(loaded.state).toBe('modified');
    expect(loaded.results.evaluationFlow.roles.some((r) => r.escoId === 'e9')).toBe(true);
    expect(loaded.results.evaluationFlow.nextSteps.some((r) => r.escoId === 'e9')).toBe(true);
    expect(loaded.results.evaluationFlow.ranked.nextSteps.some((r) => r.id === 'exploration-s1-e9')).toBe(
      true
    );
  });

  it('preserves a saved-state sentinel without treating it as corrupted storage', () => {
    saveSimulationToStorage(
      {
        results: null,
        simulationDate: '2026-01-04T00:00:00.000Z',
        profileCompletion: 80,
      },
      'saved'
    );

    const loaded = loadSimulationFromStorage();
    expect(loaded).toEqual({
      results: null,
      metadata: {
        simulationDate: '2026-01-04T00:00:00.000Z',
        profileCompletion: 80,
        timestamp: expect.any(String),
      },
      state: 'saved',
    });
  });

  it('falls back to currentSimResults when the main snapshot is missing', () => {
    sessionStorage.setItem(
      'currentSimResults',
      JSON.stringify({
        simulationId: 'sim-legacy',
        nextSteps: [],
        outsideTheBox: [],
        evaluationFlow: {
          simulationId: 'sim-legacy',
          roles: [{ id: 'role-1', escoId: 'e1', category: 'nextSteps', userEvaluation: 'keep' }],
          phases: { nextSteps: 'ranked', outsideTheBox: 'eval' },
        },
      })
    );
    sessionStorage.setItem('currentSimulationState', 'modified');

    const preferred = loadPreferredSimulationSnapshot();
    expect(preferred.source).toBe('legacy-current');
    expect(preferred.state).toBe('modified');
    expect(preferred.results.evaluationFlow.roles).toHaveLength(1);
    expect(hasActiveCareerSimulationSession()).toBe(true);
  });

  it('clearSimulationFromStorage also removes currentSimResults', () => {
    sessionStorage.setItem('currentSimResults', JSON.stringify({ simulationId: 'sim-1' }));
    expect(hasActiveCareerSimulationSession()).toBe(true);

    clearSimulationFromStorage();

    expect(sessionStorage.getItem('currentSimResults')).toBeNull();
    expect(hasActiveCareerSimulationSession()).toBe(false);
  });

  it('stores lightweight detail context separately from the latest-run snapshot', () => {
    expect(saveSimulationDetailContext({ savedSimulationId: 'saved-123' })).toBe(true);
    expect(loadSimulationDetailContext()).toEqual({ savedSimulationId: 'saved-123' });

    expect(clearSimulationDetailContext()).toBe(true);
    expect(loadSimulationDetailContext()).toEqual({ savedSimulationId: null });
  });
});
