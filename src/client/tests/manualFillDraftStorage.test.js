const {
  saveManualFillDraft,
  loadManualFillDraft,
  clearManualFillDraft,
  clearAllManualFillDrafts,
} = require('../utils/manualFillDraftStorage');

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

describe('manualFillDraftStorage', () => {
  let localStorageMock;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    global.window = { localStorage: localStorageMock };
  });

  it('saves and loads a draft for a user', () => {
    saveManualFillDraft('user-1', { reviewStep: 5, reviewDialogOpen: true });
    const draft = loadManualFillDraft('user-1');
    expect(draft.reviewStep).toBe(5);
    expect(draft.savedAt).toEqual(expect.any(Number));
  });

  it('clears a single user draft', () => {
    saveManualFillDraft('user-1', { reviewStep: 6 });
    clearManualFillDraft('user-1');
    expect(loadManualFillDraft('user-1')).toBeNull();
  });

  it('clearAllManualFillDrafts removes every manual fill draft key', () => {
    saveManualFillDraft('user-1', { reviewStep: 5 });
    saveManualFillDraft('user-2', { reviewStep: 6 });
    localStorageMock.setItem('unrelated:key', 'keep');

    clearAllManualFillDrafts();

    expect(loadManualFillDraft('user-1')).toBeNull();
    expect(loadManualFillDraft('user-2')).toBeNull();
    expect(localStorageMock.getItem('unrelated:key')).toBe('keep');
  });
});
