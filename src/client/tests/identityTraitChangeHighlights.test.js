const {
  acknowledgeTraitHighlightsVisit,
  clearAllSeenIdentityPieces,
  clearStickyTraitHighlights,
  diffChangedTraitIds,
  saveSeenIdentityPieces,
  scheduleEndTraitHighlightsVisit,
  serializeSeenPieces,
  syncTraitChangeHighlights,
} = require('../utils/identityTraitChangeHighlights');

function createLocalStorageMock() {
  const store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    key: (index) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

describe('identityTraitChangeHighlights', () => {
  beforeEach(() => {
    clearStickyTraitHighlights();
    global.window = { localStorage: createLocalStorageMock() };
  });

  afterEach(() => {
    clearStickyTraitHighlights();
  });

  it('serializes confidence and layer for each trait', () => {
    expect(
      serializeSeenPieces([
        { id: 'a', confidence: 0.72, layer: 'confirmed' },
        { id: 'b', confidencePercent: 40, layer: 'emerging' },
      ])
    ).toEqual({
      a: { confidence: 0.72, layer: 'confirmed' },
      b: { confidence: 0.4, layer: 'emerging' },
    });
  });

  it('diffs new pieces, layer moves, and confidence shifts', () => {
    const baseline = {
      keep: { confidence: 0.5, layer: 'confirmed' },
      promote: { confidence: 0.55, layer: 'emerging' },
      wobble: { confidence: 0.5, layer: 'confirmed' },
      shift: { confidence: 0.4, layer: 'confirmed' },
    };
    const nodes = [
      { id: 'keep', confidence: 0.5, layer: 'confirmed' },
      { id: 'promote', confidence: 0.55, layer: 'confirmed' },
      { id: 'wobble', confidence: 0.53, layer: 'confirmed' },
      { id: 'shift', confidence: 0.5, layer: 'confirmed' },
      { id: 'fresh', confidence: 0.6, layer: 'emerging' },
    ];
    expect(diffChangedTraitIds(nodes, baseline).sort()).toEqual([
      'fresh',
      'promote',
      'shift',
    ]);
  });

  it('does not glow on first-ever visit; glows after changes; clears after acknowledge', () => {
    const userId = 'user-1';
    const initial = [
      { id: 'a', confidence: 0.5, layer: 'confirmed' },
      { id: 'b', confidence: 0.4, layer: 'emerging' },
    ];

    expect(syncTraitChangeHighlights(userId, initial)).toEqual([]);
    acknowledgeTraitHighlightsVisit(userId);

    const stale = initial;
    const updated = [
      { id: 'a', confidence: 0.7, layer: 'confirmed' },
      { id: 'b', confidence: 0.4, layer: 'emerging' },
      { id: 'c', confidence: 0.45, layer: 'emerging' },
    ];

    // Stale cache on navigate: no glow yet
    expect(syncTraitChangeHighlights(userId, stale)).toEqual([]);
    // Fresh identity arrives without leaving the page: glow appears
    expect(syncTraitChangeHighlights(userId, updated).sort()).toEqual(['a', 'c']);

    acknowledgeTraitHighlightsVisit(userId);
    expect(syncTraitChangeHighlights(userId, updated)).toEqual([]);
  });

  it('keeps the frozen baseline across a deferred visit end (Strict Mode)', () => {
    jest.useFakeTimers();
    const userId = 'user-2';
    saveSeenIdentityPieces(userId, [
      { id: 'a', confidence: 0.4, layer: 'emerging' },
    ]);

    const nodes = [{ id: 'a', confidence: 0.7, layer: 'confirmed' }];
    expect(syncTraitChangeHighlights(userId, nodes)).toEqual(['a']);

    scheduleEndTraitHighlightsVisit(userId);
    // Remount before timer: cancel end and keep visit baseline
    expect(syncTraitChangeHighlights(userId, nodes)).toEqual(['a']);

    jest.runAllTimers();
    // Visit still active because sync cancelled the end
    expect(syncTraitChangeHighlights(userId, nodes)).toEqual(['a']);

    scheduleEndTraitHighlightsVisit(userId);
    jest.runAllTimers();
    expect(syncTraitChangeHighlights(userId, nodes)).toEqual([]);

    jest.useRealTimers();
  });

  it('clearAllSeenIdentityPieces removes baselines', () => {
    saveSeenIdentityPieces('u1', [{ id: 'a', confidence: 0.5, layer: 'confirmed' }]);
    clearAllSeenIdentityPieces();
    expect(window.localStorage.getItem('careerIdentity:seenPieces:u1')).toBeNull();
  });
});
