const {
  normalizeEvaluationFlow,
  getEvalQueue,
  getRankedBoard,
  getRankedColumns,
  groupRolesByEvaluation,
  setFlowRoleEvaluation,
  reorderFlowCategory,
  toPersistedEvaluationFlow,
  stripDerivedEvaluationViews,
} = require('../utils/evaluationFlowModel');
const {
  createInitialEvaluationFlow,
  promoteCategoryToRanked,
  mergeEvaluationFlowFromResults,
} = require('../utils/simulationRoleRanking');
const {
  mergeExplorationRolesIntoSimulationResults,
} = require('../utils/explorationRoleEvaluation');

describe('evaluationFlowModel roles[]', () => {
  it('flattens legacy dual lists into roles[] and derives views', () => {
    const legacy = {
      simulationId: 'sim-1',
      nextSteps: [
        { id: 'a', escoId: 'e1', title: 'A', userEvaluation: 'keep', matchScore: 0.9 },
      ],
      outsideTheBox: [
        { id: 'b', escoId: 'e2', title: 'B', userEvaluation: null, matchScore: 0.4 },
      ],
      phases: { nextSteps: 'eval', outsideTheBox: 'eval' },
      ranked: { nextSteps: null, outsideTheBox: null },
      hasStarted: { nextSteps: false, outsideTheBox: false },
    };

    const normalized = normalizeEvaluationFlow(legacy);
    expect(normalized.roles).toHaveLength(2);
    expect(normalized.roles[0].key).toBe('esco:e1');
    expect(getEvalQueue(normalized, 'nextSteps')).toHaveLength(1);
    expect(getRankedBoard(normalized, 'nextSteps')).toBeNull();
  });

  it('promotes via roles[] order and ranked board selectors', () => {
    const flow = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [
        { stepId: 'a', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 },
        { stepId: 'b', escoId: 'e2', title: 'B', hybridScoreNextRole: 0.5 },
      ],
      outsideTheBox: [],
    });
    let next = setFlowRoleEvaluation(flow, flow.nextSteps[0].id, 'keep', 'nextSteps');
    next = setFlowRoleEvaluation(next, flow.nextSteps[1].id, 'skip', 'nextSteps');
    next = {
      ...next,
      hasStarted: { ...next.hasStarted, nextSteps: true },
    };
    next = promoteCategoryToRanked(next, 'nextSteps');
    expect(next.phases.nextSteps).toBe('ranked');
    expect(next.roles.every((r) => r.category !== 'nextSteps' || typeof r.order === 'number')).toBe(true);
    const board = getRankedBoard(next, 'nextSteps');
    expect(board).toHaveLength(2);
    expect(board[0].userEvaluation).toBe('keep');
  });

  it('invariant: ranked columns equal roles[] grouped by userEvaluation', () => {
    let flow = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [
        { stepId: 'a', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 },
        { stepId: 'b', escoId: 'e2', title: 'B', hybridScoreNextRole: 0.5 },
        { stepId: 'c', escoId: 'e3', title: 'C', hybridScoreNextRole: 0.3 },
      ],
      outsideTheBox: [],
    });
    flow = setFlowRoleEvaluation(flow, flow.nextSteps[0].id, 'keep', 'nextSteps');
    flow = setFlowRoleEvaluation(flow, flow.nextSteps[1].id, 'skip', 'nextSteps');
    flow = setFlowRoleEvaluation(flow, flow.nextSteps[2].id, 'dislike', 'nextSteps');
    flow = promoteCategoryToRanked(flow, 'nextSteps');

    const columns = getRankedColumns(flow, 'nextSteps');
    const fromRoles = groupRolesByEvaluation(flow.roles, { category: 'nextSteps' });
    expect(columns.keep.map((r) => r.id)).toEqual(fromRoles.keep.map((r) => r.id));
    expect(columns.skip.map((r) => r.id)).toEqual(fromRoles.skip.map((r) => r.id));
    expect(columns.dislike.map((r) => r.id)).toEqual(fromRoles.dislike.map((r) => r.id));

    const board = getRankedBoard(flow, 'nextSteps');
    for (const key of ['keep', 'skip', 'dislike']) {
      expect(board.filter((row) => row.userEvaluation === key).map((r) => r.id)).toEqual(
        columns[key].map((r) => r.id)
      );
    }
    expect(board.every((row) => row.userEvaluation === row.step.userEvaluation)).toBe(true);
  });

  it('upserts exploration role into roles[] and keeps it across localize merge', () => {
    let flow = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [
        { stepId: 'a', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.8 },
      ],
      outsideTheBox: [],
    });
    flow = setFlowRoleEvaluation(flow, flow.nextSteps[0].id, 'keep', 'nextSteps');
    flow = promoteCategoryToRanked(flow, 'nextSteps');

    const merged = mergeExplorationRolesIntoSimulationResults(
      { simulationId: 'sim-1', evaluationFlow: flow },
      [
        {
          id: 'exploration-s1-e9',
          escoId: 'e9',
          title: 'New Explore',
          userEvaluation: 'keep',
          matchScore: 0.7,
          preferredCategory: 'nextSteps',
        },
      ],
      { sessionId: 's1' }
    );

    expect(merged.evaluationFlow.roles.some((r) => r.escoId === 'e9')).toBe(true);
    expect(getRankedBoard(merged.evaluationFlow, 'nextSteps').some((r) => r.step?.escoId === 'e9' || r.id.includes('e9'))).toBe(true);

    const afterLocalize = mergeEvaluationFlowFromResults(
      {
        simulationId: 'sim-1',
        nextSteps: [{ stepId: 'a', escoId: 'e1', title: 'A DE', hybridScoreNextRole: 0.8 }],
        outsideTheBox: [],
      },
      merged.evaluationFlow
    );

    expect(afterLocalize.roles.some((r) => r.escoId === 'e9')).toBe(true);
    expect(afterLocalize.nextSteps.find((r) => r.escoId === 'e1').title).toBe('A DE');
  });

  it('reorders ranked category via roles[].order', () => {
    let flow = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [
        { stepId: 'a', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 },
        { stepId: 'b', escoId: 'e2', title: 'B', hybridScoreNextRole: 0.5 },
      ],
      outsideTheBox: [],
    });
    const idA = flow.nextSteps[0].id;
    const idB = flow.nextSteps[1].id;
    flow = setFlowRoleEvaluation(flow, idA, 'keep', 'nextSteps');
    flow = setFlowRoleEvaluation(flow, idB, 'keep', 'nextSteps');
    flow = promoteCategoryToRanked(flow, 'nextSteps');
    flow = reorderFlowCategory(flow, 'nextSteps', [idB, idA]);
    expect(getRankedBoard(flow, 'nextSteps').map((r) => r.id)).toEqual([idB, idA]);
  });

  it('persists roles[] only and rematerializes derived views on normalize', () => {
    let flow = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [
        { stepId: 'a', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 },
        { stepId: 'b', escoId: 'e2', title: 'B', hybridScoreNextRole: 0.4 },
      ],
      outsideTheBox: [],
    });
    flow = setFlowRoleEvaluation(flow, flow.nextSteps[0].id, 'keep', 'nextSteps');
    flow = setFlowRoleEvaluation(flow, flow.nextSteps[1].id, 'skip', 'nextSteps');
    flow = promoteCategoryToRanked(flow, 'nextSteps');

    const persisted = toPersistedEvaluationFlow(flow);
    expect(persisted.roles).toHaveLength(2);
    expect(persisted.nextSteps).toBeUndefined();
    expect(persisted.outsideTheBox).toBeUndefined();
    expect(persisted.ranked).toBeUndefined();
    expect(persisted.phases.nextSteps).toBe('ranked');

    const strippedOnly = stripDerivedEvaluationViews(flow);
    expect(strippedOnly.nextSteps).toBeUndefined();

    const rematerialized = normalizeEvaluationFlow(persisted);
    expect(getEvalQueue(rematerialized, 'nextSteps')).toHaveLength(2);
    expect(getRankedBoard(rematerialized, 'nextSteps')).toHaveLength(2);
    expect(rematerialized.nextSteps[0].userEvaluation).toBe('keep');
  });
});
