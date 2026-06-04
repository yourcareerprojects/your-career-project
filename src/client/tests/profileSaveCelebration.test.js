const {
  markProfileSaveCelebration,
  shouldCelebrateProfileSave,
} = require('../utils/profileSaveCelebration');

describe('profileSaveCelebration', () => {
  beforeEach(() => {
    const store = {};
    global.sessionStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    };
  });

  it('celebrates from router state and clears session marker', () => {
    markProfileSaveCelebration();
    expect(shouldCelebrateProfileSave({ celebrateProfileSaved: true })).toBe(true);
    expect(sessionStorage.getItem('profileSaveCelebration')).toBeNull();
  });

  it('celebrates from session marker when router state is missing', () => {
    markProfileSaveCelebration();
    expect(shouldCelebrateProfileSave(null)).toBe(true);
    expect(shouldCelebrateProfileSave(null)).toBe(false);
  });
});
