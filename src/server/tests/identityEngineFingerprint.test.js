/**
 * Unit tests for Career Identity engine fingerprint / cache invalidation.
 */

const {
  IDENTITY_ENGINE_LOGIC_VERSION,
  buildIdentityEngineFingerprintPayload,
  computeIdentityEngineFingerprint,
  resetIdentityEngineFingerprintCache,
  shouldReuseCachedIdentity,
} = require('../services/careerIdentity/identityEngineFingerprint');

const {
  computeEmbeddingsContentSignature,
  getTraitEmbeddingsMetadata,
  warmTraitEmbeddingsCache,
} = require('../services/careerIdentity/traitEmbeddingsStore');

describe('identityEngineFingerprint', () => {
  beforeEach(() => {
    resetIdentityEngineFingerprintCache();
  });

  afterEach(() => {
    resetIdentityEngineFingerprintCache();
  });

  it('exposes a logic version for manual bumps', () => {
    expect(IDENTITY_ENGINE_LOGIC_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('returns a stable fingerprint for the same engine config', () => {
    const a = computeIdentityEngineFingerprint();
    resetIdentityEngineFingerprintCache();
    const b = computeIdentityEngineFingerprint();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
  });

  it('changes when puzzle thresholds change', () => {
    const base = computeIdentityEngineFingerprint();
    const changed = computeIdentityEngineFingerprint({
      puzzle: {
        thresholds: { confirmed: 0.99, emerging: 0.01 },
        limits: { maxPerLayer: 1, maxTotal: 1 },
      },
    });
    expect(changed).not.toBe(base);
  });

  it('changes when logic version changes', () => {
    const base = computeIdentityEngineFingerprint();
    const changed = computeIdentityEngineFingerprint({
      logicVersion: IDENTITY_ENGINE_LOGIC_VERSION + 1,
    });
    expect(changed).not.toBe(base);
  });

  it('includes catalog, thresholds, embeddings, and scoring constants', () => {
    const payload = buildIdentityEngineFingerprintPayload();
    expect(payload.catalog.length).toBeGreaterThan(0);
    expect(payload.puzzle.thresholds).toBeDefined();
    expect(payload.confidence.MAX_EFFECTIVE_WEIGHT).toBeDefined();
    expect(payload.discovery.DEFAULT_MIN_SIMILARITY).toBeDefined();
    expect(payload.votes.VOTE_EVIDENCE_WEIGHT).toBeDefined();
    expect(payload.embeddings).toBeDefined();
  });

  it('reuses cache only when source and engine fingerprints match', () => {
    const profile = {
      sourceFingerprint: 'src-a',
      engineFingerprint: 'eng-a',
      traits: [{ traitId: 'helping_others' }],
    };
    expect(shouldReuseCachedIdentity(profile, 'src-a', 'eng-a')).toBe(true);
    expect(shouldReuseCachedIdentity(profile, 'src-b', 'eng-a')).toBe(false);
    expect(shouldReuseCachedIdentity(profile, 'src-a', 'eng-b')).toBe(false);
    expect(
      shouldReuseCachedIdentity(
        { ...profile, engineFingerprint: '' },
        'src-a',
        'eng-a'
      )
    ).toBe(false);
    // Empty traits with matching fingerprints = computed-empty, still reusable.
    expect(shouldReuseCachedIdentity({ ...profile, traits: [] }, 'src-a', 'eng-a')).toBe(
      true
    );
    expect(
      shouldReuseCachedIdentity(
        { sourceFingerprint: 'src-a', engineFingerprint: 'eng-a' },
        'src-a',
        'eng-a'
      )
    ).toBe(false);
  });
});

describe('embeddings content signature', () => {
  it('changes when a trait textHash changes', () => {
    const a = computeEmbeddingsContentSignature({
      helping_others: { textHash: 'aaa' },
      empathy: { textHash: 'bbb' },
    });
    const b = computeEmbeddingsContentSignature({
      helping_others: { textHash: 'aaa' },
      empathy: { textHash: 'ccc' },
    });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
  });

  it('is exposed on production embeddings metadata when available', () => {
    warmTraitEmbeddingsCache();
    const meta = getTraitEmbeddingsMetadata();
    if (meta.available) {
      expect(meta.contentSignature).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
