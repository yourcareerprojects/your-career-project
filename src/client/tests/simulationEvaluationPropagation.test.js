const { applyUserEvaluationToResultsSnapshot } = require('../utils/simulationEvaluationPropagation');

describe('applyUserEvaluationToResultsSnapshot', () => {
  it('patches evaluationFlow.roles[] and rematerializes derived views', () => {
    const base = {
      nextSteps: [
        { stepId: 'target-step', title: 'Target Role', userEvaluation: 'keep' },
        { stepId: 'other-step', title: 'Other Role', userEvaluation: 'skip' },
      ],
      outsideTheBox: [{ stepId: 'outside-step', title: 'Outside Role', userEvaluation: 'dislike' }],
      evaluationFlow: {
        phases: { nextSteps: 'ranked', outsideTheBox: 'eval' },
        nextSteps: [
          { stepId: 'target-step', title: 'Target Role', userEvaluation: 'keep' },
          { stepId: 'other-step', title: 'Other Role', userEvaluation: 'skip' },
        ],
        outsideTheBox: [{ stepId: 'outside-step', title: 'Outside Role', userEvaluation: 'dislike' }],
        ranked: {
          nextSteps: [
            {
              id: 'rank-1',
              userEvaluation: 'keep',
              step: { stepId: 'target-step', title: 'Target Role', userEvaluation: 'keep' },
            },
          ],
          outsideTheBox: [],
        },
      },
    };

    const patched = applyUserEvaluationToResultsSnapshot(
      base,
      'dislike',
      (role) => role?.stepId === 'target-step'
    );

    expect(patched).not.toBe(base);
    // Top-level engine lists are not ranking SoT — left unchanged.
    expect(patched.nextSteps[0].userEvaluation).toBe('keep');
    expect(patched.evaluationFlow.roles.find((r) => r.stepId === 'target-step').userEvaluation).toBe(
      'dislike'
    );
    expect(patched.evaluationFlow.nextSteps[0].userEvaluation).toBe('dislike');

    // Unrelated role stays untouched.
    expect(patched.evaluationFlow.roles.find((r) => r.stepId === 'other-step').userEvaluation).toBe(
      'skip'
    );
  });

  it('patches roles[] when present as the source of truth', () => {
    const base = {
      nextSteps: [{ stepId: 'target-step', userEvaluation: 'keep' }],
      outsideTheBox: [],
      evaluationFlow: {
        phases: { nextSteps: 'eval', outsideTheBox: 'eval' },
        roles: [
          {
            key: 'id:target-step',
            id: 'target-step',
            stepId: 'target-step',
            category: 'nextSteps',
            userEvaluation: 'keep',
            order: 0,
          },
        ],
      },
    };

    const patched = applyUserEvaluationToResultsSnapshot(
      base,
      'skip',
      (role) => role?.stepId === 'target-step'
    );

    expect(patched.evaluationFlow.roles[0].userEvaluation).toBe('skip');
    expect(patched.evaluationFlow.nextSteps[0].userEvaluation).toBe('skip');
    // Top-level list unchanged.
    expect(patched.nextSteps[0].userEvaluation).toBe('keep');
  });

  it('returns original snapshot when no role matches', () => {
    const base = {
      nextSteps: [{ stepId: 'other-step', userEvaluation: 'keep' }],
      outsideTheBox: [],
      evaluationFlow: { nextSteps: [], outsideTheBox: [], ranked: { nextSteps: [], outsideTheBox: [] } },
    };

    const patched = applyUserEvaluationToResultsSnapshot(
      base,
      'dislike',
      (role) => role?.stepId === 'missing-step'
    );

    expect(patched).toBe(base);
  });
});
