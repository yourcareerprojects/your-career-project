const {
  saveCvReviewDraft,
  loadCvReviewDraft,
  clearCvReviewDraft,
  clearAllCvReviewDrafts,
} = require('../utils/cvReviewDraftStorage');

function createSessionStorageMock() {
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

describe('cvReviewDraftStorage', () => {
  let sessionStorageMock;

  beforeEach(() => {
    sessionStorageMock = createSessionStorageMock();
    global.window = { sessionStorage: sessionStorageMock };
  });

  it('saves and loads a draft for a user', () => {
    saveCvReviewDraft('user-1', { pendingUploadedDocId: 'doc-1', reviewDialogOpen: true });
    const draft = loadCvReviewDraft('user-1');
    expect(draft.pendingUploadedDocId).toBe('doc-1');
    expect(draft.reviewDialogOpen).toBe(true);
    expect(draft.savedAt).toEqual(expect.any(Number));
  });

  it('clears a single user draft', () => {
    saveCvReviewDraft('user-1', { pendingUploadedDocId: 'doc-1' });
    clearCvReviewDraft('user-1');
    expect(loadCvReviewDraft('user-1')).toBeNull();
  });

  it('clearAllCvReviewDrafts removes every cv review draft key', () => {
    saveCvReviewDraft('user-1', { pendingUploadedDocId: 'doc-1' });
    saveCvReviewDraft('user-2', { pendingUploadedDocId: 'doc-2' });
    sessionStorageMock.setItem('unrelated:key', 'keep');

    clearAllCvReviewDrafts();

    expect(loadCvReviewDraft('user-1')).toBeNull();
    expect(loadCvReviewDraft('user-2')).toBeNull();
    expect(sessionStorageMock.getItem('unrelated:key')).toBe('keep');
  });
});
