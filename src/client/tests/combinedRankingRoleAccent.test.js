const {
  acknowledgeCombinedRankingRoleIds,
  buildCombinedRankingSeenRolesKey,
  clearCombinedRankingStickyVisits,
  flushCombinedRankingVisitAcknowledgements,
  getCombinedRankingRowId,
  getCombinedRankingVisitBaseline,
  loadSeenCombinedRoleIds,
  resolveCombinedRankingAccentCategoryKey,
  saveSeenCombinedRoleIds,
  trackCombinedRankingRolesForVisit,
} = require('../utils/combinedRankingRoleAccent');

describe('combinedRankingRoleAccent', () => {
  let store;

  beforeEach(() => {
    store = {};
    global.localStorage = {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setItem: (key, value) => {
        store[key] = String(value);
      },
      removeItem: (key) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
    clearCombinedRankingStickyVisits();
  });

  it('builds a stable storage key per simulation', () => {
    expect(
      buildCombinedRankingSeenRolesKey({
        isViewingSavedSimulation: false,
        simulationIdForCards: 'sim-1',
      })
    ).toBe('simulation:combinedRankingSeenRoles:live:sim-1');
    expect(
      buildCombinedRankingSeenRolesKey({
        isViewingSavedSimulation: true,
        savedSimulationId: 'saved-9',
      })
    ).toBe('simulation:combinedRankingSeenRoles:saved:saved-9');
  });

  it('treats all roles as existing on first open (no baseline)', () => {
    expect(resolveCombinedRankingAccentCategoryKey({ id: 'a' }, null)).toBe('nextSteps');
    expect(resolveCombinedRankingAccentCategoryKey({ id: 'b' }, null)).toBe('nextSteps');
  });

  it('marks unseen roles as new (red / outsideTheBox accent)', () => {
    const seen = new Set(['next-1']);
    expect(resolveCombinedRankingAccentCategoryKey({ id: 'next-1' }, seen)).toBe('nextSteps');
    expect(resolveCombinedRankingAccentCategoryKey({ id: 'ootb-2' }, seen)).toBe('outsideTheBox');
  });

  it('keeps new roles red across remounts until flush+reload baseline', () => {
    const key = buildCombinedRankingSeenRolesKey({ simulationIdForCards: 'sim-nav' });

    // First sight: NEXT-only board bootstraps baseline.
    trackCombinedRankingRolesForVisit(key, ['next-1']);
    expect(getCombinedRankingVisitBaseline(key)).toEqual(new Set(['next-1']));
    expect(
      resolveCombinedRankingAccentCategoryKey({ id: 'ootb-2' }, getCombinedRankingVisitBaseline(key))
    ).toBe('outsideTheBox');

    // Combined board tracks OOTB without expanding the frozen baseline.
    trackCombinedRankingRolesForVisit(key, ['next-1', 'ootb-2']);
    expect(getCombinedRankingVisitBaseline(key)).toEqual(new Set(['next-1']));
    expect(
      resolveCombinedRankingAccentCategoryKey({ id: 'ootb-2' }, getCombinedRankingVisitBaseline(key))
    ).toBe('outsideTheBox');

    // SPA remount must not re-read localStorage into a new baseline yet.
    expect(loadSeenCombinedRoleIds(key)).toBeNull();
    flushCombinedRankingVisitAcknowledgements();
    expect([...loadSeenCombinedRoleIds(key)].sort()).toEqual(['next-1', 'ootb-2']);

    // Sticky baseline still frozen for this tab session.
    expect(
      resolveCombinedRankingAccentCategoryKey({ id: 'ootb-2' }, getCombinedRankingVisitBaseline(key))
    ).toBe('outsideTheBox');

    // Full reload: clear sticky, load persisted ids → green.
    clearCombinedRankingStickyVisits();
    const afterReload = loadSeenCombinedRoleIds(key);
    expect(resolveCombinedRankingAccentCategoryKey({ id: 'ootb-2' }, afterReload)).toBe('nextSteps');
  });

  it('persists acknowledgements so a reload treats roles as existing', () => {
    const key = buildCombinedRankingSeenRolesKey({ simulationIdForCards: 'sim-reload' });
    expect(loadSeenCombinedRoleIds(key)).toBeNull();

    acknowledgeCombinedRankingRoleIds(key, ['next-1']);
    expect([...loadSeenCombinedRoleIds(key)].sort()).toEqual(['next-1']);

    acknowledgeCombinedRankingRoleIds(key, ['ootb-2']);
    const seen = loadSeenCombinedRoleIds(key);
    expect(resolveCombinedRankingAccentCategoryKey({ id: 'next-1' }, seen)).toBe('nextSteps');
    expect(resolveCombinedRankingAccentCategoryKey({ id: 'ootb-2' }, seen)).toBe('nextSteps');
    expect(resolveCombinedRankingAccentCategoryKey({ id: 'explore-3' }, seen)).toBe(
      'outsideTheBox'
    );
  });

  it('round-trips ids through save/load', () => {
    const key = buildCombinedRankingSeenRolesKey({ simulationIdForCards: 'sim-x' });
    saveSeenCombinedRoleIds(key, new Set(['a', 'b']));
    expect([...loadSeenCombinedRoleIds(key)].sort()).toEqual(['a', 'b']);
  });

  it('reads row id from step fallbacks', () => {
    expect(getCombinedRankingRowId({ id: 'r1' })).toBe('r1');
    expect(getCombinedRankingRowId({ step: { id: 's1' } })).toBe('s1');
    expect(getCombinedRankingRowId({ step: { stepId: 't1' } })).toBe('t1');
  });
});
