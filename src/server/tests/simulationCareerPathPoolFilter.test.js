const {
  SIMULATION_POOL_ELIGIBLE_FILTER,
  mergeSimulationPoolFilter,
} = require('../services/simulation/simulationCareerPathPoolFilter');

describe('simulationCareerPathPoolFilter', () => {
  test('SIMULATION_POOL_ELIGIBLE_FILTER treats missing field as eligible', () => {
    expect(SIMULATION_POOL_ELIGIBLE_FILTER).toEqual({
      simulationExcluded: { $ne: true },
    });
  });

  test('mergeSimulationPoolFilter preserves caller constraints', () => {
    expect(
      mergeSimulationPoolFilter({ 'seniority.seniority_level': { $in: [0, 1] } })
    ).toEqual({
      'seniority.seniority_level': { $in: [0, 1] },
      simulationExcluded: { $ne: true },
    });
  });

  test('mergeSimulationPoolFilter handles empty filter', () => {
    expect(mergeSimulationPoolFilter()).toEqual({
      simulationExcluded: { $ne: true },
    });
  });
});
