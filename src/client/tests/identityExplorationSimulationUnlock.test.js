const {
  createInitialEvaluationFlow,
  promoteCategoryToRanked,
  setFlowRoleEvaluation,
  skipOutsideTheBoxForNow,
} = require('../utils/simulationRoleRanking');
const {
  isIdentityExplorationUnlockedBySimulation,
} = require('../utils/identityExplorationSimulationUnlock');

function rateAll(flow, category) {
  const list = category === 'nextSteps' ? flow.nextSteps : flow.outsideTheBox;
  return list.reduce(
    (next, role, index) => setFlowRoleEvaluation(
      next,
      role.id,
      index === 0 ? 'keep' : 'skip',
      category
    ),
    flow
  );
}

describe('isIdentityExplorationUnlockedBySimulation', () => {
  it('stays locked while next-role ranking is incomplete', () => {
    let flow = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [
        { stepId: 'a', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 },
        { stepId: 'b', escoId: 'e2', title: 'B', hybridScoreNextRole: 0.5 },
      ],
      outsideTheBox: [
        { stepId: 'c', escoId: 'e3', title: 'C', hybridScoreOutOfTheBox: 0.4 },
      ],
    });
    flow = setFlowRoleEvaluation(flow, flow.nextSteps[0].id, 'keep', 'nextSteps');
    expect(
      isIdentityExplorationUnlockedBySimulation(
        { results: { evaluationFlow: flow } },
        { loadSessionSnapshot: () => null }
      )
    ).toBe(false);
  });

  it('stays locked when next roles are ranked but outside-the-box is skipped', () => {
    let flow = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [
        { stepId: 'a', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 },
        { stepId: 'b', escoId: 'e2', title: 'B', hybridScoreNextRole: 0.5 },
      ],
      outsideTheBox: [
        { stepId: 'c', escoId: 'e3', title: 'C', hybridScoreOutOfTheBox: 0.4 },
      ],
    });
    flow = rateAll(flow, 'nextSteps');
    flow = promoteCategoryToRanked(flow, 'nextSteps');
    flow = skipOutsideTheBoxForNow(flow);
    expect(
      isIdentityExplorationUnlockedBySimulation(
        { results: { evaluationFlow: flow } },
        { loadSessionSnapshot: () => null }
      )
    ).toBe(false);
  });

  it('unlocks when both ranking boards are complete', () => {
    let flow = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [
        { stepId: 'a', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 },
        { stepId: 'b', escoId: 'e2', title: 'B', hybridScoreNextRole: 0.5 },
      ],
      outsideTheBox: [
        { stepId: 'c', escoId: 'e3', title: 'C', hybridScoreOutOfTheBox: 0.4 },
      ],
    });
    flow = rateAll(flow, 'nextSteps');
    flow = rateAll(flow, 'outsideTheBox');
    flow = promoteCategoryToRanked(flow, 'nextSteps');
    flow = promoteCategoryToRanked(flow, 'outsideTheBox');
    expect(
      isIdentityExplorationUnlockedBySimulation(
        { results: { evaluationFlow: flow } },
        { loadSessionSnapshot: () => null }
      )
    ).toBe(true);
  });

  it('falls back to the session snapshot when the last-sim query is stale', () => {
    let flow = createInitialEvaluationFlow({
      simulationId: 'sim-1',
      nextSteps: [
        { stepId: 'a', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 },
      ],
      outsideTheBox: [
        { stepId: 'c', escoId: 'e3', title: 'C', hybridScoreOutOfTheBox: 0.4 },
      ],
    });
    flow = rateAll(flow, 'nextSteps');
    flow = rateAll(flow, 'outsideTheBox');
    flow = promoteCategoryToRanked(flow, 'nextSteps');
    flow = promoteCategoryToRanked(flow, 'outsideTheBox');
    expect(
      isIdentityExplorationUnlockedBySimulation(
        { results: { evaluationFlow: null } },
        { loadSessionSnapshot: () => ({ results: { evaluationFlow: flow } }) }
      )
    ).toBe(true);
  });
});
