/**
 * Unit / integration tests for the Identity Snapshot service.
 */

const mongoose = require('mongoose');
const CareerIdentityProfile = require('../models/CareerIdentityProfile');
const {
  IDENTITY_SNAPSHOT_VERSION,
  createSnapshot,
  loadLatestSnapshot,
  saveSnapshot,
  migrateSnapshot,
  getSnapshotPieces,
  getSnapshotDomainIds,
} = require('../services/careerIdentity/snapshotService');

function piece(traitId, confidence, extras = {}) {
  return { traitId, confidence, ...extras };
}

describe('snapshotService.createSnapshot', () => {
  it('builds a lightweight versioned snapshot with pieces, domains, and timestamp', () => {
    const capturedAt = new Date('2026-07-27T12:00:00.000Z');
    const snapshot = createSnapshot(
      [
        piece('leadership', 0.72, {
          category: 'leadership',
          layer: 'confirmed',
          evidence: [{ evidenceId: 'x' }],
          evidenceCount: 4,
        }),
        piece('teamwork', 0.4, { category: 'social_orientation', layer: 'emerging' }),
        piece('empathy', 0.55, { category: 'social_orientation', layer: 'emerging' }),
      ],
      { capturedAt }
    );

    expect(snapshot.version).toBe(IDENTITY_SNAPSHOT_VERSION);
    expect(snapshot.capturedAt.toISOString()).toBe(capturedAt.toISOString());
    expect(snapshot.pieces).toHaveLength(3);
    expect(snapshot.pieces[0]).toEqual({
      traitId: 'leadership',
      category: 'leadership',
      confidence: 0.72,
      layer: 'confirmed',
    });
    // Evidence must not leak into the lightweight format.
    expect(snapshot.pieces[0].evidence).toBeUndefined();
    expect(snapshot.domains).toEqual([
      { category: 'leadership', pieceCount: 1, maxConfidence: 0.72 },
      { category: 'social_orientation', pieceCount: 2, maxConfidence: 0.55 },
    ]);
  });

  it('accepts profile.traits and serializeProfile nodes shapes', () => {
    const fromTraits = createSnapshot({
      traits: [piece('leadership', 0.6, { category: 'leadership' })],
    });
    const fromNodes = createSnapshot({
      nodes: [{ id: 'leadership', confidence: 0.6, category: 'leadership' }],
    });

    expect(fromTraits.pieces[0].traitId).toBe('leadership');
    expect(fromNodes.pieces[0].traitId).toBe('leadership');
    expect(fromNodes.pieces[0].confidence).toBe(0.6);
  });

  it('derives layer from confidence when missing', () => {
    const snapshot = createSnapshot([piece('leadership', 0.65, { category: 'leadership' })]);
    expect(snapshot.pieces[0].layer).toBe('confirmed');
  });

  it('fills category from the trait catalog when omitted', () => {
    const snapshot = createSnapshot([piece('leadership', 0.5)]);
    expect(snapshot.pieces[0].category).toBe('leadership');
  });
});

describe('snapshotService.migrateSnapshot', () => {
  it('returns null for empty input', () => {
    expect(migrateSnapshot(null)).toBeNull();
    expect(migrateSnapshot(undefined)).toBeNull();
  });

  it('normalizes legacy snapshots missing version / domains', () => {
    const migrated = migrateSnapshot({
      capturedAt: '2026-01-01T00:00:00.000Z',
      pieces: [{ traitId: 'teamwork', confidence: 0.5, category: 'social_orientation' }],
    });

    expect(migrated.version).toBe(IDENTITY_SNAPSHOT_VERSION);
    expect(migrated.domains).toEqual([
      { category: 'social_orientation', pieceCount: 1, maxConfidence: 0.5 },
    ]);
  });
});

describe('snapshotService helpers', () => {
  it('exposes pieces and domain ids for evolution comparison', () => {
    const snapshot = createSnapshot([
      piece('leadership', 0.7, { category: 'leadership' }),
      piece('teamwork', 0.4, { category: 'social_orientation' }),
    ]);

    expect(getSnapshotPieces(snapshot)).toHaveLength(2);
    expect(getSnapshotDomainIds(snapshot)).toEqual(['leadership', 'social_orientation']);
  });
});

describe('snapshotService persistence', () => {
  let userId;

  beforeEach(async () => {
    userId = new mongoose.Types.ObjectId();
    await CareerIdentityProfile.deleteMany({ userId });
  });

  afterEach(async () => {
    await CareerIdentityProfile.deleteMany({ userId });
  });

  it('saveSnapshot + loadLatestSnapshot round-trip lastIdentitySnapshot', async () => {
    const source = [
      piece('leadership', 0.7, { category: 'leadership', layer: 'confirmed' }),
      piece('teamwork', 0.45, { category: 'social_orientation', layer: 'emerging' }),
    ];

    const saved = await saveSnapshot(userId, source, {
      capturedAt: new Date('2026-07-27T10:00:00.000Z'),
    });

    expect(saved.version).toBe(IDENTITY_SNAPSHOT_VERSION);
    expect(saved.pieces).toHaveLength(2);

    const loaded = await loadLatestSnapshot(userId);
    expect(loaded).not.toBeNull();
    expect(loaded.capturedAt.toISOString()).toBe('2026-07-27T10:00:00.000Z');
    expect(loaded.pieces.map((p) => p.traitId).sort()).toEqual(['leadership', 'teamwork']);
    expect(loaded.domains.map((d) => d.category).sort()).toEqual([
      'leadership',
      'social_orientation',
    ]);

    const profile = await CareerIdentityProfile.findOne({ userId }).lean();
    expect(profile.lastIdentitySnapshot).toBeTruthy();
    expect(profile.lastIdentitySnapshot.pieces).toHaveLength(2);
  });

  it('loadLatestSnapshot returns null when no snapshot exists', async () => {
    await CareerIdentityProfile.create({ userId, traits: [] });
    expect(await loadLatestSnapshot(userId)).toBeNull();
  });

  it('saveSnapshot accepts a pre-built snapshot object', async () => {
    const snapshot = createSnapshot([piece('empathy', 0.5, { category: 'social_orientation' })]);
    await saveSnapshot(userId, snapshot);
    const loaded = await loadLatestSnapshot(userId);
    expect(loaded.pieces[0].traitId).toBe('empathy');
  });

  it('overwrites the previous lastIdentitySnapshot', async () => {
    await saveSnapshot(userId, [piece('teamwork', 0.4, { category: 'social_orientation' })]);
    await saveSnapshot(userId, [piece('leadership', 0.8, { category: 'leadership' })]);

    const loaded = await loadLatestSnapshot(userId);
    expect(loaded.pieces).toHaveLength(1);
    expect(loaded.pieces[0].traitId).toBe('leadership');
  });
});
