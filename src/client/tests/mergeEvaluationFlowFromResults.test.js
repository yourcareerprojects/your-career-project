const {
  mergeEvaluationFlowFromResults,
  createInitialEvaluationFlow,
  ensureEvaluationFlow,
} = require('../utils/simulationRoleRanking');

function makeFlow(overrides = {}) {
  return {
    simulationId: 'sim-1',
    nextSteps: [
      {
        id: 'role-1',
        stepId: 'role-1',
        escoId: 'e1',
        title: 'Engineer',
        description: 'EN desc',
        userEvaluation: 'keep',
        matchScore: 0.8,
        hybridScoreNextRole: 0.8,
        category: 'nextSteps',
        listCategory: 'nextCareerRoles',
      },
      {
        id: 'exploration-s1-e2',
        stepId: 'exploration-s1-e2',
        escoId: 'e2',
        title: 'Explorer Role',
        userEvaluation: 'skip',
        matchScore: 0.5,
        explorationSessionId: 's1',
        category: 'nextSteps',
        listCategory: 'nextCareerRoles',
      },
    ],
    outsideTheBox: [],
    hasStarted: { nextSteps: true, outsideTheBox: false },
    phases: { nextSteps: 'ranked', outsideTheBox: 'eval' },
    ranked: {
      nextSteps: [
        {
          id: 'role-1',
          title: 'Engineer',
          matchScore: 0.8,
          category: 'next',
          userEvaluation: 'keep',
          finalRank: 1,
          step: {
            id: 'role-1',
            escoId: 'e1',
            title: 'Engineer',
            userEvaluation: 'keep',
          },
        },
        {
          id: 'exploration-s1-e2',
          title: 'Explorer Role',
          matchScore: 0.5,
          category: 'next',
          userEvaluation: 'skip',
          finalRank: 2,
          step: {
            id: 'exploration-s1-e2',
            escoId: 'e2',
            title: 'Explorer Role',
            userEvaluation: 'skip',
            explorationSessionId: 's1',
          },
        },
      ],
      outsideTheBox: null,
    },
    hasSeenRanking: { nextSteps: true, outsideTheBox: false },
    mergedExplorationSessionIds: ['s1'],
    wizardPaused: false,
    ...overrides,
  };
}

describe('mergeEvaluationFlowFromResults (A2 patch-in-place)', () => {
  it('preserves exploration roles and ratings across localize refresh', () => {
    const currentFlow = makeFlow();
    const results = {
      simulationId: 'sim-1',
      nextSteps: [
        {
          stepId: 'role-1',
          escoId: 'e1',
          title: 'Ingenieur',
          description: 'DE desc',
          hybridScoreNextRole: 0.82,
        },
      ],
      outsideTheBox: [],
      prioritizedLists: { nextCareerRoles: [], outsideTheBoxRoles: [] },
      // Stale server flow without exploration insert
      evaluationFlow: {
        simulationId: 'sim-1',
        nextSteps: [
          {
            id: 'role-1',
            escoId: 'e1',
            title: 'Ingenieur',
            description: 'DE desc',
            userEvaluation: 'keep',
            hybridScoreNextRole: 0.82,
          },
        ],
        outsideTheBox: [],
        phases: { nextSteps: 'ranked', outsideTheBox: 'eval' },
        ranked: { nextSteps: [], outsideTheBox: null },
      },
    };

    const merged = mergeEvaluationFlowFromResults(results, currentFlow);

    expect(merged.nextSteps).toHaveLength(2);
    expect(merged.nextSteps[0].title).toBe('Ingenieur');
    expect(merged.nextSteps[0].description).toBe('DE desc');
    expect(merged.nextSteps[0].userEvaluation).toBe('keep');
    expect(merged.nextSteps[1].id).toBe('exploration-s1-e2');
    expect(merged.nextSteps[1].userEvaluation).toBe('skip');
    expect(merged.nextSteps[1].explorationSessionId).toBe('s1');
    expect(merged.mergedExplorationSessionIds).toEqual(['s1']);

    expect(merged.ranked.nextSteps).toHaveLength(2);
    expect(merged.ranked.nextSteps[0].title).toBe('Ingenieur');
    expect(merged.ranked.nextSteps[1].id).toBe('exploration-s1-e2');
    expect(merged.ranked.nextSteps.map((r) => r.id)).toEqual([
      'role-1',
      'exploration-s1-e2',
    ]);
  });

  it('does not reorder ranked boards when patching', () => {
    const currentFlow = makeFlow({
      ranked: {
        nextSteps: [
          {
            id: 'exploration-s1-e2',
            title: 'Explorer Role',
            matchScore: 0.5,
            category: 'next',
            userEvaluation: 'skip',
            finalRank: 1,
            step: {
              id: 'exploration-s1-e2',
              escoId: 'e2',
              title: 'Explorer Role',
              userEvaluation: 'skip',
              explorationSessionId: 's1',
            },
          },
          {
            id: 'role-1',
            title: 'Engineer',
            matchScore: 0.8,
            category: 'next',
            userEvaluation: 'keep',
            finalRank: 2,
            step: {
              id: 'role-1',
              escoId: 'e1',
              title: 'Engineer',
              userEvaluation: 'keep',
            },
          },
        ],
        outsideTheBox: null,
      },
    });

    const merged = mergeEvaluationFlowFromResults(
      {
        simulationId: 'sim-1',
        nextSteps: [{ stepId: 'role-1', escoId: 'e1', title: 'Engineer DE', hybridScoreNextRole: 0.8 }],
        outsideTheBox: [],
      },
      currentFlow
    );

    expect(merged.ranked.nextSteps.map((r) => r.id)).toEqual([
      'exploration-s1-e2',
      'role-1',
    ]);
  });

  it('materializes a fresh flow when simulation id changes', () => {
    const currentFlow = makeFlow();
    const results = {
      simulationId: 'sim-2',
      nextSteps: [
        { stepId: 'new-1', escoId: 'n1', title: 'New Role', hybridScoreNextRole: 0.9 },
      ],
      outsideTheBox: [],
      prioritizedLists: { nextCareerRoles: [], outsideTheBoxRoles: [] },
    };

    const merged = mergeEvaluationFlowFromResults(results, currentFlow);
    expect(merged.simulationId).toBe('sim-2');
    expect(merged.nextSteps).toHaveLength(1);
    expect(merged.nextSteps[0].escoId).toBe('n1');
    expect(merged.nextSteps[0].userEvaluation).toBeNull();
    expect(merged.phases.nextSteps).toBe('eval');
  });

  it('treats local simulationId as same run and upgrades id', () => {
    const currentFlow = makeFlow({ simulationId: 'local' });
    const merged = mergeEvaluationFlowFromResults(
      {
        simulationId: 'sim-1',
        nextSteps: [{ stepId: 'role-1', escoId: 'e1', title: 'Localized', hybridScoreNextRole: 0.8 }],
        outsideTheBox: [],
      },
      currentFlow
    );
    expect(merged.simulationId).toBe('sim-1');
    expect(merged.nextSteps).toHaveLength(2);
    expect(merged.nextSteps[0].title).toBe('Localized');
  });

  it('preserves exploration when results envelope omits simulationId', () => {
    const currentFlow = makeFlow();
    const merged = mergeEvaluationFlowFromResults(
      {
        // No top-level simulationId — remount/ensure path used to wipe roles[].
        nextSteps: [{ stepId: 'role-1', escoId: 'e1', title: 'Engineer', hybridScoreNextRole: 0.8 }],
        outsideTheBox: [],
        evaluationFlow: currentFlow,
      },
      currentFlow
    );

    expect(merged.simulationId).toBe('sim-1');
    expect(merged.nextSteps.map((r) => r.id)).toEqual(['role-1', 'exploration-s1-e2']);
    expect(merged.nextSteps[1].userEvaluation).toBe('skip');
  });

  it('preserves exploration when results.simulationId is local but flow has real id', () => {
    const currentFlow = makeFlow();
    const merged = ensureEvaluationFlow({
      simulationId: 'local',
      nextSteps: [{ stepId: 'role-1', escoId: 'e1', title: 'Engineer', hybridScoreNextRole: 0.8 }],
      outsideTheBox: [],
      evaluationFlow: currentFlow,
    });

    expect(merged.simulationId).toBe('sim-1');
    expect(merged.nextSteps.some((r) => r.id === 'exploration-s1-e2')).toBe(true);
  });
});

describe('createInitialEvaluationFlow', () => {
  it('builds eval lists from pools', () => {
    const flow = createInitialEvaluationFlow({
      simulationId: 'sim-9',
      nextSteps: [{ stepId: 'n1', escoId: 'e', title: 'N', hybridScoreNextRole: 0.7 }],
      outsideTheBox: [],
    });
    expect(flow.nextSteps).toHaveLength(1);
    expect(flow.phases.nextSteps).toBe('eval');
    expect(flow.ranked.nextSteps).toBeNull();
  });
});
