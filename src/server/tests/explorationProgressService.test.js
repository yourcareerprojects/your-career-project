const mongoose = require('mongoose');
const CareerIdentityProfile = require('../models/CareerIdentityProfile');
const IdentityExplorationSession = require('../models/IdentityExplorationSession');
const { saveSnapshot } = require('../services/careerIdentity/snapshotService');
const {
  getIdentityExplorationProgress,
  resolveExplorationProgressPhase,
} = require('../services/careerIdentity/explorationProgressService');

function piece(traitId, confidence, category, layer = 'emerging') {
  return { traitId, confidence, category, layer };
}

describe('explorationProgressService', () => {
  let userId;

  beforeEach(async () => {
    userId = new mongoose.Types.ObjectId();
    await CareerIdentityProfile.deleteMany({ userId });
    await IdentityExplorationSession.deleteMany({ userId });
  });

  afterEach(async () => {
    await CareerIdentityProfile.deleteMany({ userId });
    await IdentityExplorationSession.deleteMany({ userId });
  });

  it('returns an empty progress state when no baseline exists', async () => {
    const progress = await getIdentityExplorationProgress(userId, { nodes: [] }, { language: 'en' });

    expect(progress).toEqual({
      hasBaseline: false,
      phase: 'accumulating',
      changeScore: 0,
      cappedChangeScore: 0,
      threshold: 5,
      progressPercent: 0,
      remainingScore: 5,
      isReady: false,
      reasons: [],
      baselineCapturedAt: null,
      latestSessionStatus: null,
    });
  });

  it('measures capped progress from the saved exploration baseline', async () => {
    await saveSnapshot(userId, [
      piece('leadership', 0.7, 'leadership', 'confirmed'),
      piece('teamwork', 0.45, 'social_orientation', 'emerging'),
    ]);

    const progress = await getIdentityExplorationProgress(
      userId,
      {
        nodes: [
          { id: 'leadership', category: 'leadership', confidence: 0.76, layer: 'confirmed' },
          { id: 'teamwork', category: 'social_orientation', confidence: 0.52, layer: 'emerging' },
        ],
      },
      { language: 'en' }
    );

    expect(progress.hasBaseline).toBe(true);
    expect(progress.phase).toBe('ready');
    expect(progress.isReady).toBe(true);
    expect(progress.threshold).toBe(5);
    expect(progress.changeScore).toBeGreaterThanOrEqual(5);
    expect(progress.cappedChangeScore).toBe(5);
    expect(progress.progressPercent).toBe(100);
    expect(progress.remainingScore).toBe(0);
    expect(progress.reasons.length).toBeGreaterThan(0);
    expect(progress.baselineCapturedAt).toBeTruthy();
  });

  it('caps display progress even when raw change score exceeds the threshold', async () => {
    await saveSnapshot(userId, [
      piece('leadership', 0.5, 'leadership', 'confirmed'),
    ]);

    const progress = await getIdentityExplorationProgress(
      userId,
      {
        nodes: [
          { id: 'leadership', category: 'leadership', confidence: 0.95, layer: 'confirmed' },
          { id: 'analytical_thinking', category: 'thinking_style', confidence: 0.82, layer: 'confirmed' },
          { id: 'teamwork', category: 'social_orientation', confidence: 0.7, layer: 'confirmed' },
        ],
      },
      { language: 'en' }
    );

    expect(progress.changeScore).toBeGreaterThan(5);
    expect(progress.cappedChangeScore).toBe(5);
    expect(progress.progressPercent).toBe(100);
    expect(progress.remainingScore).toBe(0);
    expect(progress.phase).toBe('ready');
  });

  it('uses delivered phase when unread exploration is available', () => {
    expect(
      resolveExplorationProgressPhase({
        changeScore: 12,
        threshold: 5,
        hasUnreadExploration: true,
        latestSession: { status: 'completed', createdAt: new Date() },
        baselineCapturedAt: new Date(Date.now() - 60_000),
      })
    ).toBe('delivered');
  });

  it('stays in preparing at threshold after an empty-pool search (does not imply 0%)', () => {
    expect(
      resolveExplorationProgressPhase({
        changeScore: 8,
        threshold: 5,
        hasUnreadExploration: false,
        latestSession: {
          status: 'skipped_empty_pool',
          createdAt: new Date(),
        },
        baselineCapturedAt: new Date(Date.now() - 60_000),
      })
    ).toBe('preparing');
  });
});
