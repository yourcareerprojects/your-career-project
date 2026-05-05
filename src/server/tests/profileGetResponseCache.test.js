const {
  getCachedProfileResponse,
  setCachedProfileResponse,
  clearProfileResponseCache,
} = require('../services/profileGetResponseCache');

describe('profileGetResponseCache', () => {
  const userId = '507f1f77bcf86cd799439011';
  const updatedAt = new Date('2024-06-01T12:00:00.000Z');

  beforeEach(() => {
    clearProfileResponseCache();
  });

  test('cache keys are scoped by language so EN and DE responses do not clobber each other', () => {
    setCachedProfileResponse(userId, updatedAt, { lang: 'de', x: 1 }, 'de');
    setCachedProfileResponse(userId, updatedAt, { lang: 'en', x: 2 }, 'en');
    expect(getCachedProfileResponse(userId, updatedAt, 'de')).toEqual({ lang: 'de', x: 1 });
    expect(getCachedProfileResponse(userId, updatedAt, 'en')).toEqual({ lang: 'en', x: 2 });
  });

  test('evicts prior updatedAt snapshots for the same user while keeping sibling locales', () => {
    const oldAt = new Date('2024-01-01T00:00:00.000Z');
    setCachedProfileResponse(userId, oldAt, { v: 'old-en' }, 'en');
    setCachedProfileResponse(userId, oldAt, { v: 'old-de' }, 'de');

    const newAt = new Date('2024-06-01T12:00:00.000Z');
    setCachedProfileResponse(userId, newAt, { v: 'new-en' }, 'en');

    expect(getCachedProfileResponse(userId, oldAt, 'en')).toBeUndefined();
    expect(getCachedProfileResponse(userId, oldAt, 'de')).toBeUndefined();
    expect(getCachedProfileResponse(userId, newAt, 'en')).toEqual({ v: 'new-en' });
  });
});
