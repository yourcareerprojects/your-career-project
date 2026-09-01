const {
  getEvaluationFlow,
  listEvaluationFlowRoles,
  resolveEvaluationFlowRoles,
} = require('../utils/evaluationFlowRoles');
const {
  collectRatedRolesFromFlow,
} = require('../services/careerIdentity/pipeline/collectors/ratedJobsCollector');

describe('evaluationFlowRoles', () => {
  it('reads nested results.evaluationFlow', () => {
    expect(
      getEvaluationFlow({ results: { evaluationFlow: { roles: [] } } })
    ).toEqual({ roles: [] });
  });

  it('lists roles[] sorted by category then order', () => {
    const roles = listEvaluationFlowRoles({
      roles: [
        { id: 'b', category: 'nextSteps', order: 1, userEvaluation: 'keep' },
        { id: 'c', category: 'outsideTheBox', order: 0, userEvaluation: 'skip' },
        { id: 'a', category: 'nextSteps', order: 0, userEvaluation: 'dislike' },
      ],
    });
    expect(roles.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to dual lists when ranked is empty', () => {
    const roles = listEvaluationFlowRoles({
      nextSteps: [{ id: 'n1', userEvaluation: 'keep' }],
      outsideTheBox: [{ id: 'o1', userEvaluation: 'skip' }],
    });
    expect(roles.map((r) => r.id)).toEqual(['n1', 'o1']);
  });

  it('resolveEvaluationFlowRoles prefers stored roles[] without resorting for localize', () => {
    const roles = resolveEvaluationFlowRoles({
      roles: [
        { id: 'b', category: 'nextSteps', order: 1 },
        { id: 'a', category: 'nextSteps', order: 0 },
      ],
    });
    expect(roles.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('resolveEvaluationFlowRoles flattens legacy ranked boards into roles', () => {
    const roles = resolveEvaluationFlowRoles({
      ranked: {
        nextSteps: [
          {
            userEvaluation: 'keep',
            step: { id: 'n1', escoId: 'esco:n1', title: 'Nurse' },
          },
        ],
        outsideTheBox: [],
      },
      nextSteps: [{ id: 'ignored', userEvaluation: 'keep' }],
    });
    expect(roles.map((r) => r.escoId || r.id)).toEqual(['esco:n1']);
  });
});

describe('collectRatedRolesFromFlow', () => {
  it('collects rated ids from roles[] without needing ranked boards', () => {
    const ratedIds = new Set();
    collectRatedRolesFromFlow(
      {
        roles: [
          { escoId: 'esco:keep', userEvaluation: 'keep' },
          { escoId: 'esco:null', userEvaluation: null },
          { escoId: 'esco:skip', careerPathId: 'cp1', userEvaluation: 'skip' },
        ],
      },
      ratedIds
    );
    expect([...ratedIds].sort()).toEqual(['cp1', 'esco:keep', 'esco:skip']);
  });
});
