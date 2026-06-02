const {
  __testables: cacheTestables,
} = require('../services/documents/semanticCvInterpreter');

describe('semanticCvInterpreter result cache', () => {
  beforeEach(() => {
    cacheTestables.resetResultCache();
  });

  test('readSemanticCvCacheMaxEntries clamps to 500–2000', () => {
    const prev = process.env.SEMANTIC_CV_CACHE_MAX_ENTRIES;
    process.env.SEMANTIC_CV_CACHE_MAX_ENTRIES = '100';
    expect(cacheTestables.readSemanticCvCacheMaxEntries()).toBe(500);
    process.env.SEMANTIC_CV_CACHE_MAX_ENTRIES = '99999';
    expect(cacheTestables.readSemanticCvCacheMaxEntries()).toBe(2000);
    process.env.SEMANTIC_CV_CACHE_MAX_ENTRIES = '750';
    expect(cacheTestables.readSemanticCvCacheMaxEntries()).toBe(750);
    if (prev === undefined) delete process.env.SEMANTIC_CV_CACHE_MAX_ENTRIES;
    else process.env.SEMANTIC_CV_CACHE_MAX_ENTRIES = prev;
  });

  test('evicts least recently used entries when over max size', () => {
    const max = cacheTestables.readSemanticCvCacheMaxEntries();
    const value = { cached: true };
    for (let i = 0; i < max + 50; i += 1) {
      cacheTestables.setResultCacheEntry(`fp-${i}`, value);
    }
    expect(cacheTestables.getResultCacheSize()).toBeLessThanOrEqual(max);
    expect(cacheTestables.getResultCacheEntry('fp-0')).toBeUndefined();
    expect(cacheTestables.getResultCacheEntry(`fp-${max + 49}`)).toEqual(value);
  });

  test('expires entries after TTL', () => {
    const start = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => start);
    cacheTestables.setResultCacheEntry('ttl-key', { ok: 1 });

    Date.now.mockImplementation(() => start + cacheTestables.CACHE_TTL_MS + 1);
    expect(cacheTestables.getResultCacheEntry('ttl-key')).toBeUndefined();
    Date.now.mockRestore();
  });
});
