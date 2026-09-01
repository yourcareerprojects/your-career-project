/**
 * Unit tests for Cool-ranked simulation → occupation next-step helpers.
 */

const {
  isKeepEvaluation,
  extractEscoId,
  extractCareerPathId,
  collectKeepRolesFromFlow,
  getEvaluationFlow,
  collectCoolOccupationRefsFromUser,
} = require('../services/careerPuzzle/simulationCoolOccupationSteps');

describe('simulationCoolOccupationSteps helpers', () => {
  it('treats keep and cool as positive evaluations', () => {
    expect(isKeepEvaluation('keep')).toBe(true);
    expect(isKeepEvaluation('Cool')).toBe(true);
    expect(isKeepEvaluation('skip')).toBe(false);
    expect(isKeepEvaluation('dislike')).toBe(false);
  });

  it('extracts esco and careerPath ids from nested ranked rows', () => {
    expect(
      extractEscoId({
        step: { escoId: 'http://data.europa.eu/esco/occupation/abc' },
      })
    ).toBe('http://data.europa.eu/esco/occupation/abc');
    expect(extractCareerPathId({ careerPathId: '507f1f77bcf86cd799439011' })).toBe(
      '507f1f77bcf86cd799439011'
    );
  });

  it('prefers roles[] keep order over legacy ranked boards', () => {
    const flow = {
      roles: [
        {
          category: 'nextSteps',
          order: 1,
          userEvaluation: 'keep',
          escoId: 'esco:second',
        },
        {
          category: 'nextSteps',
          order: 0,
          userEvaluation: 'keep',
          escoId: 'esco:first',
        },
        {
          category: 'outsideTheBox',
          order: 0,
          userEvaluation: 'skip',
          escoId: 'esco:skip',
        },
        {
          category: 'outsideTheBox',
          order: 0,
          userEvaluation: 'keep',
          escoId: 'esco:ootb',
        },
      ],
      ranked: {
        nextSteps: [
          {
            userEvaluation: 'keep',
            step: { escoId: 'esco:legacy' },
          },
        ],
      },
    };
    expect(collectKeepRolesFromFlow(flow).map((r) => r.escoId)).toEqual([
      'esco:first',
      'esco:second',
      'esco:ootb',
    ]);
  });

  it('prefers ranked keep roles in finalRank order', () => {
    const flow = {
      ranked: {
        nextSteps: [
          {
            userEvaluation: 'dislike',
            step: { escoId: 'esco:no', title: 'Nope' },
          },
          {
            userEvaluation: 'keep',
            finalRank: 1,
            step: { escoId: 'esco:nurse', title: 'Nurse' },
          },
        ],
        outsideTheBox: [
          {
            userEvaluation: 'keep',
            finalRank: 1,
            step: { escoId: 'esco:dev', title: 'Developer' },
          },
        ],
      },
      nextSteps: [{ userEvaluation: 'keep', escoId: 'esco:ignored' }],
    };

    const roles = collectKeepRolesFromFlow(flow);
    expect(roles.map((r) => r.escoId)).toEqual(['esco:nurse', 'esco:dev']);
  });

  it('falls back to list evaluations when ranked is empty', () => {
    const flow = {
      nextSteps: [
        { userEvaluation: 'keep', escoId: 'esco:a' },
        { userEvaluation: 'skip', escoId: 'esco:b' },
      ],
      outsideTheBox: [{ userEvaluation: 'cool', escoId: 'esco:c' }],
    };
    expect(collectKeepRolesFromFlow(flow).map((r) => r.escoId)).toEqual([
      'esco:a',
      'esco:c',
    ]);
  });

  it('reads evaluationFlow from lastSimulationResult.results', () => {
    const flow = getEvaluationFlow({
      results: { evaluationFlow: { nextSteps: [] } },
    });
    expect(flow).toEqual({ nextSteps: [] });
  });

  it('collects cool refs from the latest simulation sources with dedupe', () => {
    const user = {
      lastSimulationResult: {
        results: {
          evaluationFlow: {
            ranked: {
              nextSteps: [
                {
                  userEvaluation: 'keep',
                  step: {
                    escoId: 'esco:shared',
                    careerPathId: '507f1f77bcf86cd799439011',
                  },
                },
              ],
              outsideTheBox: [],
            },
          },
        },
      },
      simulationResults: [
        {
          status: 'active',
          timestamp: new Date('2026-01-02'),
          results: {
            evaluationFlow: {
              ranked: {
                nextSteps: [
                  {
                    userEvaluation: 'keep',
                    step: { escoId: 'esco:shared' },
                  },
                  {
                    userEvaluation: 'keep',
                    step: { escoId: 'esco:other' },
                  },
                ],
                outsideTheBox: [],
              },
            },
          },
        },
      ],
    };

    const refs = collectCoolOccupationRefsFromUser(user);
    expect(refs).toEqual([
      {
        escoId: 'esco:shared',
        careerPathId: '507f1f77bcf86cd799439011',
      },
      { escoId: 'esco:other', careerPathId: '' },
    ]);
  });
});
