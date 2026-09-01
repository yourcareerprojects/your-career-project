const {
  createInitialEvaluationFlow,
  promoteCategoryToRanked,
  getRankedBoard,
} = require('../utils/simulationRoleRanking');
const {
  commitEvaluationFlowRole,
  promoteEvaluationFlowCategory,
  reorderEvaluationFlowRanked,
  reorderEvaluationFlowCombined,
  skipEvaluationFlowOutsideTheBox,
} = require('../utils/evaluationFlowWrites');

function makeFlow() {
  return createInitialEvaluationFlow({
    simulationId: 'sim-1',
    nextSteps: [
      { stepId: 'a', escoId: 'e1', title: 'A', hybridScoreNextRole: 0.9 },
      { stepId: 'b', escoId: 'e2', title: 'B', hybridScoreNextRole: 0.5 },
    ],
    outsideTheBox: [
      { stepId: 'c', escoId: 'e3', title: 'C', hybridScoreOutOfTheBox: 0.7 },
    ],
  });
}

describe('evaluationFlowWrites', () => {
  it('commitEvaluationFlowRole sets rating, hasStarted, and can auto-reveal', () => {
    let flow = makeFlow();
    flow = commitEvaluationFlowRole(flow, 'nextSteps', 'a', 'keep');
    flow = commitEvaluationFlowRole(flow, 'nextSteps', 'b', 'skip');
    expect(flow.hasStarted.nextSteps).toBe(true);
    expect(flow.nextSteps.find((r) => r.id === 'a' || r.stepId === 'a').userEvaluation).toBe('keep');

    flow = commitEvaluationFlowRole(flow, 'outsideTheBox', 'c', 'keep');
    expect(flow.phases.nextSteps).toBe('ranked');
    expect(flow.phases.outsideTheBox).toBe('ranked');
  });

  it('promoteEvaluationFlowCategory builds ranked board', () => {
    let flow = makeFlow();
    flow = commitEvaluationFlowRole(flow, 'nextSteps', 'a', 'keep');
    flow = commitEvaluationFlowRole(flow, 'nextSteps', 'b', 'dislike');
    flow = promoteEvaluationFlowCategory(flow, 'nextSteps');
    expect(flow.phases.nextSteps).toBe('ranked');
    expect(getRankedBoard(flow, 'nextSteps').map((r) => r.id)).toEqual(
      expect.arrayContaining(['a', 'b'])
    );
  });

  it('reorderEvaluationFlowRanked updates order and evaluation overlay', () => {
    let flow = makeFlow();
    flow = commitEvaluationFlowRole(flow, 'nextSteps', 'a', 'keep');
    flow = commitEvaluationFlowRole(flow, 'nextSteps', 'b', 'keep');
    flow = promoteCategoryToRanked(flow, 'nextSteps');
    const board = getRankedBoard(flow, 'nextSteps');
    const reversed = [...board].reverse().map((row) => ({
      ...row,
      userEvaluation: row.id === 'a' ? 'skip' : row.userEvaluation,
    }));
    flow = reorderEvaluationFlowRanked(flow, 'nextSteps', reversed);
    expect(getRankedBoard(flow, 'nextSteps').map((r) => String(r.id))).toEqual(
      reversed.map((r) => String(r.id))
    );
    expect(flow.roles.find((r) => String(r.id) === 'a').userEvaluation).toBe('skip');
  });

  it('reorderEvaluationFlowCombined and skip OOTB are no-ops on empty input / already skipped', () => {
    const flow = makeFlow();
    expect(reorderEvaluationFlowCombined(flow, [])).toBe(flow);
    const skipped = skipEvaluationFlowOutsideTheBox(flow);
    expect(skipped.outsideTheBoxDeferred).toBe(true);
    expect(skipEvaluationFlowOutsideTheBox(skipped)).toBe(skipped);
  });
});
