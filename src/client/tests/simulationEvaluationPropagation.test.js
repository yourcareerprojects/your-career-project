const { applyUserEvaluationToResultsSnapshot } = require('../utils/simulationEvaluationPropagation');

describe('applyUserEvaluationToResultsSnapshot', () => {
  it('propagates updated evaluation across results and ranking structures', () => {
    const base = {
      nextSteps: [
        { stepId: 'target-step', title: 'Target Role', userEvaluation: 'keep' },
        { stepId: 'other-step', title: 'Other Role', userEvaluation: 'skip' },
      ],
      outsideTheBox: [{ stepId: 'outside-step', title: 'Outside Role', userEvaluation: 'dislike' }],
      evaluationFlow: {
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
    expect(patched.nextSteps[0].userEvaluation).toBe('dislike');
    expect(patched.evaluationFlow.nextSteps[0].userEvaluation).toBe('dislike');
    expect(patched.evaluationFlow.ranked.nextSteps[0].userEvaluation).toBe('dislike');
    expect(patched.evaluationFlow.ranked.nextSteps[0].step.userEvaluation).toBe('dislike');

    // Unrelated role stays untouched.
    expect(patched.nextSteps[1].userEvaluation).toBe('skip');
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

