const {
  createInitialEvaluationFlow,
  promoteCategoryToRanked,
  setFlowRoleEvaluation,
  getRankedBoard,
  areBothSimulationRankingsComplete,
  buildCombinedRankedRows,
  buildRankedRows,
} = require('../utils/simulationRoleRanking');
const {
  mergeExplorationRolesIntoSimulationResults,
  resolveExplorationRolesForMerge,
  pickExplorationMergeCategory,
  resolveExplorationTargetCategory,
} = require('../utils/explorationRoleEvaluation');

describe('exploration merge visibility on ranked boards', () => {
  function fullyRankedFlow() {
    let flow = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [
        { stepId: 'a', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 },
        { stepId: 'b', escoId: 'e2', title: 'B', hybridScoreNextRole: 0.5 },
      ],
      outsideTheBox: [
        { stepId: 'c', escoId: 'e3', title: 'C', hybridScoreOutOfTheBox: 0.4 },
        { stepId: 'd', escoId: 'e4', title: 'D', hybridScoreOutOfTheBox: 0.3 },
      ],
    });
    flow = setFlowRoleEvaluation(flow, flow.nextSteps[0].id, 'keep', 'nextSteps');
    flow = setFlowRoleEvaluation(flow, flow.nextSteps[1].id, 'skip', 'nextSteps');
    flow = setFlowRoleEvaluation(flow, flow.outsideTheBox[0].id, 'keep', 'outsideTheBox');
    flow = setFlowRoleEvaluation(flow, flow.outsideTheBox[1].id, 'dislike', 'outsideTheBox');
    flow = promoteCategoryToRanked(flow, 'nextSteps');
    flow = promoteCategoryToRanked(flow, 'outsideTheBox');
    return flow;
  }

  it('pickExplorationMergeCategory prefers natural bucket when ranked, else visible other', () => {
    const bothRanked = {
      phases: { nextSteps: 'ranked', outsideTheBox: 'ranked' },
    };
    expect(
      pickExplorationMergeCategory({ source: 'highest_delta' }, bothRanked)
    ).toBe('nextSteps');
    expect(
      pickExplorationMergeCategory({ source: 'unexpected' }, bothRanked)
    ).toBe('outsideTheBox');

    const nextOnly = { phases: { nextSteps: 'ranked', outsideTheBox: 'eval' } };
    expect(
      pickExplorationMergeCategory({ source: 'unexpected' }, nextOnly)
    ).toBe('nextSteps');
    expect(resolveExplorationTargetCategory({ source: 'unexpected' })).toBe('outsideTheBox');

    const neither = { phases: { nextSteps: 'eval', outsideTheBox: 'eval' } };
    expect(
      pickExplorationMergeCategory({ source: 'unexpected' }, neither)
    ).toBe('outsideTheBox');
  });

  it('adds exploration keep role onto combined ranked board when both categories are ranked', () => {
    const flow = fullyRankedFlow();
    expect(areBothSimulationRankingsComplete(flow)).toBe(true);

    const merged = mergeExplorationRolesIntoSimulationResults(
      { simulationId: 'sim-1', evaluationFlow: flow },
      [
        {
          id: 'exploration-s1-e9',
          escoId: 'e9',
          title: 'New Explore',
          userEvaluation: 'keep',
          matchScore: 0.75,
          source: 'highest_delta',
        },
      ],
      { sessionId: 's1' }
    );

    const nextFlow = merged.evaluationFlow;
    expect(nextFlow.roles.some((r) => r.escoId === 'e9')).toBe(true);
    const nextBoard = getRankedBoard(nextFlow, 'nextSteps');
    expect(nextBoard.some((r) => r.id === 'exploration-s1-e9' || r.step?.escoId === 'e9')).toBe(true);
    expect(nextFlow.ranked.nextSteps.some((r) => r.id === 'exploration-s1-e9')).toBe(true);

    const combined = buildCombinedRankedRows(nextFlow);
    expect(combined.some((r) => r.id === 'exploration-s1-e9')).toBe(true);
  });

  it('lands unexpected exploration role on OOTB ranked board', () => {
    const flow = fullyRankedFlow();
    const merged = mergeExplorationRolesIntoSimulationResults(
      { simulationId: 'sim-1', evaluationFlow: flow },
      [
        {
          id: 'exploration-s1-e8',
          escoId: 'e8',
          title: 'Wildcard',
          userEvaluation: 'skip',
          matchScore: 0.4,
          source: 'unexpected',
        },
      ],
      { sessionId: 's2' }
    );
    const board = getRankedBoard(merged.evaluationFlow, 'outsideTheBox');
    expect(board.some((r) => r.id === 'exploration-s1-e8')).toBe(true);
  });

  it('unwraps rankedRows.step so unexpected source still lands on OOTB', () => {
    const flow = fullyRankedFlow();
    const rankedRows = buildRankedRows(
      [
        {
          id: 'exploration-s1-e7',
          escoId: 'e7',
          title: 'From Ranked',
          userEvaluation: 'keep',
          matchScore: 0.8,
          source: 'unexpected',
        },
      ],
      'next'
    );
    const resolved = resolveExplorationRolesForMerge([], rankedRows);
    expect(resolved[0].source).toBe('unexpected');
    expect(resolved[0].escoId).toBe('e7');
    expect(resolved[0].step).toBeUndefined();

    const merged = mergeExplorationRolesIntoSimulationResults(
      { simulationId: 'sim-1', evaluationFlow: flow },
      resolved,
      { sessionId: 's3' }
    );
    const board = getRankedBoard(merged.evaluationFlow, 'outsideTheBox');
    expect(board.some((r) => r.id === 'exploration-s1-e7')).toBe(true);
    const combined = buildCombinedRankedRows(merged.evaluationFlow);
    expect(combined.some((r) => r.id === 'exploration-s1-e7')).toBe(true);
  });
});
