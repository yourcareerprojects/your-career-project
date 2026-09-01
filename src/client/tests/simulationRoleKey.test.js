const { getSimulationRoleKey } = require('../utils/simulationRoleKey');
const { takeEvaluationSourceRoles } = require('../utils/simulationRoleRanking');

describe('getSimulationRoleKey', () => {
  it('prefers esco over id', () => {
    expect(
      getSimulationRoleKey({
        escoId: 'esco-1',
        id: 'exploration-session-x',
        careerPathId: 'cp-1',
      })
    ).toBe('esco:esco-1');
  });

  it('uses career path when esco is missing', () => {
    expect(getSimulationRoleKey({ careerPathId: 'cp-99', id: 'other' })).toBe('cp:cp-99');
  });

  it('matches simulation and exploration rows that share esco', () => {
    const sim = { stepId: 'step-1', escoId: 'ABC', title: 'Dev' };
    const exploration = {
      id: 'exploration-sess-ABC',
      escoId: 'ABC',
      title: 'Developer',
      explorationSessionId: 'sess',
    };
    expect(getSimulationRoleKey(sim)).toBe(getSimulationRoleKey(exploration));
  });

  it('falls back to title', () => {
    expect(getSimulationRoleKey({ title: 'Product Manager' })).toBe('title:product manager');
  });
});

describe('takeEvaluationSourceRoles key alignment', () => {
  it('dedupes primary and pool rows that share esco', () => {
    const results = {
      nextSteps: [{ stepId: 'a', escoId: 'e1', title: 'One' }],
      prioritizedLists: {
        nextCareerRoles: [
          { stepId: 'b', escoId: 'e1', title: 'One again' },
          { stepId: 'c', escoId: 'e2', title: 'Two' },
        ],
      },
    };
    const roles = takeEvaluationSourceRoles(results, 'nextSteps');
    expect(roles).toHaveLength(2);
    expect(roles.map((r) => r.escoId)).toEqual(['e1', 'e2']);
  });
});
