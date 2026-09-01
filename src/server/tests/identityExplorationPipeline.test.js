/**
 * Integration tests for the identity exploration pipeline (mocked role pool / scoring).
 */

const mongoose = require('mongoose');
const CareerIdentityProfile = require('../models/CareerIdentityProfile');
const IdentityExplorationSession = require('../models/IdentityExplorationSession');
const {
  runIdentityExplorationPipeline,
  shouldPersistExplorationBaseline,
} = require('../services/careerIdentity/pipeline/identityExplorationPipeline');
const { saveSnapshot, createSnapshot } = require('../services/careerIdentity/snapshotService');
const {
  removeAllIdentityEventListeners,
} = require('../services/careerIdentity/pipeline/identityEventBus');

function piece(traitId, confidence, category, layer = 'emerging') {
  return { traitId, confidence, category, layer };
}

function role(id, identityDomains = []) {
  // Tiny fake identity vectors — delta matching uses injected scoreRole via roles
  // that still need identity_vector length match OR we pass scoreRole through pipeline.
  // Pipeline calls matchJobsByIdentityDelta without scoreRole, so provide matching dims
  // via mocking matchJobsByIdentityDelta instead.
  return {
    _id: new mongoose.Types.ObjectId(),
    escoId: id,
    title: { en: id, de: id },
    domain: 'Engineering',
    identityDomains,
    roleVectors: {
      identity_vector: Array.from({ length: 8 }, (_, i) => (i === 0 ? 1 : 0)),
    },
  };
}

describe('identityExplorationPipeline', () => {
  let userId;

  beforeEach(async () => {
    userId = new mongoose.Types.ObjectId();
    await CareerIdentityProfile.deleteMany({ userId });
    await IdentityExplorationSession.deleteMany({ userId });
    removeAllIdentityEventListeners();
  });

  afterEach(async () => {
    await CareerIdentityProfile.deleteMany({ userId });
    await IdentityExplorationSession.deleteMany({ userId });
    removeAllIdentityEventListeners();
  });

  it('seeds baseline when identity is not ready for first exploration', async () => {
    await CareerIdentityProfile.create({ userId, traits: [] });

    const currentIdentity = {
      nodes: [],
    };

    const result = await runIdentityExplorationPipeline({
      userId,
      currentIdentity,
      language: 'en',
      triggerSource: 'test',
      roles: [],
    });

    expect(result.explorationMode).toBe('first');
    expect(result.status).toBe('seeded_baseline');
    expect(result.explorationJobs).toEqual([]);

    const profile = await CareerIdentityProfile.findOne({ userId }).lean();
    expect(profile.lastIdentitySnapshot).toBeTruthy();
    expect(profile.lastIdentitySnapshot.pieces.length).toBe(0);
    expect(profile.lastExplorationSessionId).toBeTruthy();

    const session = await IdentityExplorationSession.findById(profile.lastExplorationSessionId).lean();
    expect(session.status).toBe('seeded_baseline');
    expect(session.seenAt).toBeTruthy();
  });

  it('seeds baseline on first meaningful identity without delivering Discover jobs', async () => {
    await CareerIdentityProfile.create({ userId, traits: [] });

    const deltaService = require('../services/careerIdentity/deltaJobMatchingService');
    const explorationService = require('../services/careerIdentity/careerExplorationService');

    const initialMatchSpy = jest.spyOn(deltaService, 'matchJobsByInitialIdentityFit');
    const deltaMatchSpy = jest.spyOn(deltaService, 'matchJobsByIdentityDelta');
    const exploreSpy = jest.spyOn(explorationService, 'generateCareerExploration');

    const currentIdentity = {
      nodes: [
        { id: 'leadership', category: 'leadership', confidence: 0.7, layer: 'confirmed' },
        { id: 'teamwork', category: 'social_orientation', confidence: 0.4, layer: 'emerging' },
      ],
    };

    const result = await runIdentityExplorationPipeline({
      userId,
      currentIdentity,
      language: 'en',
      triggerSource: 'test',
      roles: [role('unused')],
    });

    expect(result.explorationMode).toBe('first');
    expect(initialMatchSpy).not.toHaveBeenCalled();
    expect(deltaMatchSpy).not.toHaveBeenCalled();
    expect(exploreSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('seeded_baseline');
    expect(result.explorationJobs).toEqual([]);

    const profile = await CareerIdentityProfile.findOne({ userId }).lean();
    expect(profile.lastIdentitySnapshot.pieces.length).toBe(2);
    expect(profile.lastExplorationSessionId).toBeTruthy();
    expect(profile.explorationAccumulationUnlockedAt).toBeFalsy();

    const session = await IdentityExplorationSession.findById(profile.lastExplorationSessionId).lean();
    expect(session.status).toBe('seeded_baseline');
    expect(session.explorationJobs).toEqual([]);
    expect(session.seenAt).toBeTruthy();

    initialMatchSpy.mockRestore();
    deltaMatchSpy.mockRestore();
    exploreSpy.mockRestore();
  });

  it('reseeds baseline while simulation rankings are incomplete (does not deliver)', async () => {
    await CareerIdentityProfile.create({ userId, traits: [] });
    await saveSnapshot(userId, [
      piece('leadership', 0.5, 'leadership', 'confirmed'),
    ]);

    const deltaService = require('../services/careerIdentity/deltaJobMatchingService');
    const matchSpy = jest.spyOn(deltaService, 'matchJobsByIdentityDelta');

    const currentIdentity = {
      nodes: [
        { id: 'leadership', category: 'leadership', confidence: 0.9, layer: 'confirmed' },
        { id: 'teamwork', category: 'social_orientation', confidence: 0.7, layer: 'confirmed' },
        { id: 'analytical_thinking', category: 'thinking_style', confidence: 0.8, layer: 'confirmed' },
      ],
    };

    const result = await runIdentityExplorationPipeline({
      userId,
      currentIdentity,
      language: 'en',
      triggerSource: 'test',
      roles: [role('unused')],
      signals: {
        interactionCount: 4,
        averageConfidence: 0.4,
        stability: 0.2,
        traitOverlap: 0.2,
        historicalCalmness: 0.5,
        recentExplorationSessions: 0,
        recentExplorationJobs: 0,
        hoursSinceLastExploration: null,
      },
    });

    expect(result.status).toBe('seeded_baseline');
    expect(result.shouldExplore).toBe(false);
    expect(result.explorationJobs).toEqual([]);
    expect(matchSpy).not.toHaveBeenCalled();

    const profile = await CareerIdentityProfile.findOne({ userId }).lean();
    expect(profile.lastIdentitySnapshot.pieces.length).toBe(3);

    matchSpy.mockRestore();
  });

  it('stops below threshold without advancing the exploration baseline', async () => {
    await CareerIdentityProfile.create({
      userId,
      traits: [],
      explorationAccumulationUnlockedAt: new Date(),
    });

    const baseline = createSnapshot([
      piece('leadership', 0.7, 'leadership', 'confirmed'),
      piece('teamwork', 0.45, 'social_orientation', 'emerging'),
    ]);
    await saveSnapshot(userId, baseline);

    const currentIdentity = {
      nodes: [
        { id: 'leadership', category: 'leadership', confidence: 0.71, layer: 'confirmed' },
        { id: 'teamwork', category: 'social_orientation', confidence: 0.46, layer: 'emerging' },
      ],
    };

    const result = await runIdentityExplorationPipeline({
      userId,
      currentIdentity,
      language: 'en',
      triggerSource: 'test',
      roles: [role('x')],
      bypassSimulationUnlockGate: true,
      // Force a high adaptive bar so tiny confidence wobble does not explore.
      signals: {
        interactionCount: 60,
        averageConfidence: 0.85,
        stability: 0.95,
        traitOverlap: 0.95,
        historicalCalmness: 0.9,
        recentExplorationSessions: 3,
        recentExplorationJobs: 30,
        hoursSinceLastExploration: 6,
      },
    });

    expect(result.status).toBe('skipped_below_threshold');
    expect(result.shouldExplore).toBe(false);
    expect(result.explanation).toEqual(
      expect.objectContaining({
        trigger: false,
        changeScore: expect.any(Number),
        threshold: expect.any(Number),
        explorationSize: 0,
      })
    );
    expect(result.changeScore).toBeLessThan(result.explanation.threshold);

    const profile = await CareerIdentityProfile.findOne({ userId }).lean();
    expect(profile.lastIdentitySnapshot.pieces[0].confidence).toBeCloseTo(0.7, 2);
    expect(profile.lastExplorationSessionId).toBeTruthy();
    const skipped = await IdentityExplorationSession.findById(profile.lastExplorationSessionId).lean();
    expect(skipped.status).toBe('skipped_below_threshold');
    expect(skipped.seenAt).toBeTruthy();
  });

  it('keeps accumulating against the last suggested baseline until exploration completes', async () => {
    await CareerIdentityProfile.create({ userId, traits: [] });

    const baseline = createSnapshot([
      piece('leadership', 0.7, 'leadership', 'confirmed'),
      piece('teamwork', 0.45, 'social_orientation', 'emerging'),
    ]);
    await saveSnapshot(userId, baseline);

    const firstSmallChange = {
      nodes: [
        { id: 'leadership', category: 'leadership', confidence: 0.76, layer: 'confirmed' },
        { id: 'teamwork', category: 'social_orientation', confidence: 0.45, layer: 'emerging' },
      ],
    };

    const highBarSignals = {
      interactionCount: 60,
      averageConfidence: 0.85,
      stability: 0.95,
      traitOverlap: 0.95,
      historicalCalmness: 0.9,
      recentExplorationSessions: 3,
      recentExplorationJobs: 30,
      hoursSinceLastExploration: 6,
    };

    const firstResult = await runIdentityExplorationPipeline({
      userId,
      currentIdentity: firstSmallChange,
      language: 'en',
      triggerSource: 'test',
      roles: [role('x')],
      bypassSimulationUnlockGate: true,
      signals: highBarSignals,
    });

    expect(firstResult.status).toBe('skipped_below_threshold');

    const deltaService = require('../services/careerIdentity/deltaJobMatchingService');
    const explorationService = require('../services/careerIdentity/careerExplorationService');

    const matchSpy = jest
      .spyOn(deltaService, 'matchJobsByIdentityDelta')
      .mockResolvedValue([
        {
          role: role('manager', ['leadership']),
          oldScore: 0.3,
          newScore: 0.72,
          delta: 0.42,
        },
      ]);

    const exploreSpy = jest
      .spyOn(explorationService, 'generateCareerExploration')
      .mockResolvedValue({
        triggerLevel: 'mild',
        explanation: 'Small changes stacked into a meaningful shift.',
        explorationJobs: [
          {
            role: role('manager', ['leadership']),
            oldScore: 0.3,
            newScore: 0.72,
            delta: 0.42,
            source: 'highest_delta',
          },
        ],
      });

    const secondSmallChange = {
      nodes: [
        { id: 'leadership', category: 'leadership', confidence: 0.76, layer: 'confirmed' },
        { id: 'teamwork', category: 'social_orientation', confidence: 0.52, layer: 'emerging' },
      ],
    };

    const secondResult = await runIdentityExplorationPipeline({
      userId,
      currentIdentity: secondSmallChange,
      language: 'en',
      triggerSource: 'test',
      roles: [role('unused')],
      bypassSimulationUnlockGate: true,
      signals: {
        interactionCount: 2,
        averageConfidence: 0.45,
        stability: 0.15,
        traitOverlap: 0.15,
        historicalCalmness: 0.5,
        recentExplorationSessions: 0,
        recentExplorationJobs: 0,
        hoursSinceLastExploration: null,
      },
    });

    expect(secondResult.status).toBe('completed');

    // Completed delivery must not advance the accumulation baseline — that waits for consume.
    const profile = await CareerIdentityProfile.findOne({ userId }).lean();
    expect(profile.lastIdentitySnapshot.pieces[0].confidence).toBeCloseTo(0.7, 2);
    expect(
      profile.lastIdentitySnapshot.pieces.find((entry) => entry.traitId === 'teamwork')?.confidence
    ).toBeCloseTo(0.45, 2);

    matchSpy.mockRestore();
    exploreSpy.mockRestore();
  });

  it('runs delta matching + exploration when change is significant', async () => {
    await CareerIdentityProfile.create({ userId, traits: [] });

    const baseline = createSnapshot([
      piece('teamwork', 0.4, 'social_orientation', 'emerging'),
    ]);
    await saveSnapshot(userId, baseline);

    // Mock delta + exploration internals via jest.spyOn
    const deltaService = require('../services/careerIdentity/deltaJobMatchingService');
    const explorationService = require('../services/careerIdentity/careerExplorationService');

    const matchSpy = jest
      .spyOn(deltaService, 'matchJobsByIdentityDelta')
      .mockResolvedValue([
        {
          role: role('manager', ['leadership']),
          oldScore: 0.3,
          newScore: 0.7,
          delta: 0.4,
        },
        {
          role: role('coach', ['leadership']),
          oldScore: 0.25,
          newScore: 0.55,
          delta: 0.3,
        },
        {
          role: role('analyst', ['thinking_style']),
          oldScore: 0.2,
          newScore: 0.5,
          delta: 0.3,
        },
        {
          role: role('nurse', ['social_orientation']),
          oldScore: 0.35,
          newScore: 0.45,
          delta: 0.1,
        },
        {
          role: role('designer', ['interests']),
          oldScore: 0.2,
          newScore: 0.4,
          delta: 0.2,
        },
        {
          role: role('ops', ['work_style']),
          oldScore: 0.22,
          newScore: 0.42,
          delta: 0.2,
        },
        {
          role: role('sales', ['communication']),
          oldScore: 0.18,
          newScore: 0.38,
          delta: 0.2,
        },
        {
          role: role('research', ['learning']),
          oldScore: 0.15,
          newScore: 0.4,
          delta: 0.25,
        },
      ]);

    const exploreSpy = jest
      .spyOn(explorationService, 'generateCareerExploration')
      .mockResolvedValue({
        triggerLevel: 'moderate',
        explanation:
          'Your identity has recently shifted toward analytical strengths and leadership-related strengths.',
        explorationJobs: [
          {
            role: role('manager', ['leadership']),
            oldScore: 0.3,
            newScore: 0.7,
            delta: 0.4,
            source: 'highest_delta',
          },
          {
            role: role('coach', ['leadership']),
            oldScore: 0.25,
            newScore: 0.55,
            delta: 0.3,
            source: 'new_domain',
          },
          {
            role: role('analyst', ['thinking_style']),
            oldScore: 0.2,
            newScore: 0.5,
            delta: 0.3,
            source: 'new_domain',
          },
          {
            role: role('designer', ['interests']),
            oldScore: 0.2,
            newScore: 0.4,
            delta: 0.2,
            source: 'unexpected',
          },
          {
            role: role('research', ['learning']),
            oldScore: 0.15,
            newScore: 0.4,
            delta: 0.25,
            source: 'wildcard',
          },
        ],
      });

    const currentIdentity = {
      nodes: [
        { id: 'leadership', category: 'leadership', confidence: 0.8, layer: 'confirmed' },
        { id: 'analytical_thinking', category: 'thinking_style', confidence: 0.75, layer: 'confirmed' },
        { id: 'teamwork', category: 'social_orientation', confidence: 0.4, layer: 'emerging' },
      ],
    };

    const result = await runIdentityExplorationPipeline({
      userId,
      currentIdentity,
      language: 'en',
      triggerSource: 'test',
      roles: [role('unused')],
      recentlyRatedJobIds: [],
      acceptedJobIds: [],
      bypassSimulationUnlockGate: true,
      // Easy adaptive bar so the large identity shift definitely triggers.
      signals: {
        interactionCount: 4,
        averageConfidence: 0.4,
        stability: 0.2,
        traitOverlap: 0.2,
        historicalCalmness: 0.5,
        recentExplorationSessions: 0,
        recentExplorationJobs: 0,
        hoursSinceLastExploration: null,
      },
    });

    expect(matchSpy).toHaveBeenCalled();
    expect(exploreSpy).toHaveBeenCalled();
    expect(result.status).toBe('completed');
    expect(result.shouldExplore).toBe(true);
    expect(result.explorationMode).toBe('subsequent');
    expect(result.explorationJobs.length).toBe(5);
    expect(result.explanation).toEqual(
      expect.objectContaining({
        trigger: true,
        threshold: expect.any(Number),
        changeScore: expect.any(Number),
        explorationSize: expect.any(Number),
      })
    );
    expect(result.narrativeExplanation).toMatch(/shifted toward/i);

    const profile = await CareerIdentityProfile.findOne({ userId }).lean();
    expect(profile.lastExplorationSessionId).toBeTruthy();
    // Baseline stays on pre-delivery snapshot until the user consumes the roles.
    expect(profile.lastIdentitySnapshot.pieces).toHaveLength(1);
    expect(profile.lastIdentitySnapshot.pieces[0].traitId).toBe('teamwork');

    const session = await IdentityExplorationSession.findById(profile.lastExplorationSessionId).lean();
    expect(session.status).toBe('completed');
    expect(session.explorationJobs).toHaveLength(5);
    expect(session.explorationJobs[0].source).toBe('highest_delta');
    expect(session.seenAt).toBeNull();

    const {
      getExplorationNotification,
      markExplorationSessionSeen,
    } = require('../services/careerIdentity/pipeline/explorationSessionService');
    const {
      resetExplorationProgressBaseline,
    } = require('../services/careerIdentity/explorationProgressService');

    const unread = await getExplorationNotification(userId);
    expect(unread).toEqual(
      expect.objectContaining({
        hasUnreadExploration: true,
        sessionId: String(session._id),
        jobCount: 5,
        status: 'completed',
      })
    );

    const marked = await markExplorationSessionSeen(userId, session._id);
    expect(marked.seenAt).toBeTruthy();
    await resetExplorationProgressBaseline(userId, currentIdentity);

    const afterConsume = await CareerIdentityProfile.findOne({ userId }).lean();
    expect(afterConsume.lastIdentitySnapshot.pieces.some((p) => p.traitId === 'leadership')).toBe(
      true
    );

    const afterSeen = await getExplorationNotification(userId);
    expect(afterSeen.hasUnreadExploration).toBe(false);
    expect(afterSeen.sessionId).toBeNull();
    expect(afterSeen.jobCount).toBe(0);

    matchSpy.mockRestore();
    exploreSpy.mockRestore();
  });

  it('falls back to initial identity fit when delta matching returns no roles', async () => {
    await CareerIdentityProfile.create({ userId, traits: [] });

    const baseline = createSnapshot([
      piece('teamwork', 0.4, 'social_orientation', 'emerging'),
    ]);
    await saveSnapshot(userId, baseline);

    const deltaService = require('../services/careerIdentity/deltaJobMatchingService');
    const explorationService = require('../services/careerIdentity/careerExplorationService');

    const deltaMatchSpy = jest
      .spyOn(deltaService, 'matchJobsByIdentityDelta')
      .mockImplementation(async (options = {}) => {
        const matches = [
          {
            role: role('manager', ['leadership']),
            oldScore: 0,
            newScore: 0.72,
            delta: 0.72,
          },
        ];
        // Empty delta pool → in-memory absolute-fit fallback (no second OOTB pass).
        if (options.fallbackToInitialFit) {
          if (options.returnMeta) {
            return { matches, matchSource: 'initial_fit_fallback' };
          }
          return matches;
        }
        if (options.returnMeta) {
          return { matches: [], matchSource: 'identity_delta' };
        }
        return [];
      });

    const initialFitSpy = jest
      .spyOn(deltaService, 'matchJobsByInitialIdentityFit')
      .mockResolvedValue([
        {
          role: role('manager', ['leadership']),
          oldScore: 0,
          newScore: 0.72,
          delta: 0.72,
        },
      ]);

    const exploreSpy = jest
      .spyOn(explorationService, 'generateCareerExploration')
      .mockResolvedValue({
        triggerLevel: 'mild',
        explanation: 'Fallback roles from absolute identity fit.',
        explorationJobs: [
          {
            role: role('manager', ['leadership']),
            oldScore: 0,
            newScore: 0.72,
            delta: 0.72,
            source: 'highest_delta',
          },
        ],
      });

    const currentIdentity = {
      nodes: [
        { id: 'leadership', category: 'leadership', confidence: 0.8, layer: 'confirmed' },
        { id: 'teamwork', category: 'social_orientation', confidence: 0.4, layer: 'emerging' },
      ],
    };

    const result = await runIdentityExplorationPipeline({
      userId,
      currentIdentity,
      language: 'en',
      triggerSource: 'test',
      roles: [role('unused')],
      bypassSimulationUnlockGate: true,
      signals: {
        interactionCount: 4,
        averageConfidence: 0.4,
        stability: 0.2,
        traitOverlap: 0.2,
        historicalCalmness: 0.5,
        recentExplorationSessions: 1,
        recentExplorationJobs: 3,
        hoursSinceLastExploration: 1.5,
      },
    });

    expect(deltaMatchSpy).toHaveBeenCalled();
    expect(deltaMatchSpy.mock.calls.some((call) => call[0]?.fallbackToInitialFit === true)).toBe(true);
    expect(initialFitSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
    expect(result.explorationJobs).toHaveLength(1);

    const profile = await CareerIdentityProfile.findOne({ userId }).lean();
    const session = await IdentityExplorationSession.findById(profile.lastExplorationSessionId).lean();
    expect(session.status).toBe('completed');
    expect(session.seenAt).toBeNull();
    expect(session.gate?.presentation?.notify).toBe(true);

    deltaMatchSpy.mockRestore();
    initialFitSpy.mockRestore();
    exploreSpy.mockRestore();
  });

  it('reseeds baseline while locked only when identity actually moved', () => {
    expect(
      shouldPersistExplorationBaseline({
        previousSnapshot: { pieces: [piece('teamwork', 0.4, 'social_orientation')] },
        reseedWhileLocked: true,
        changeScore: 3,
      })
    ).toBe(true);
    expect(
      shouldPersistExplorationBaseline({
        previousSnapshot: { pieces: [piece('teamwork', 0.4, 'social_orientation')] },
        reseedWhileLocked: true,
        changeScore: 0,
      })
    ).toBe(false);
  });

  it('does not advance the exploration baseline after an empty-pool search', async () => {
    expect(
      shouldPersistExplorationBaseline({
        previousSnapshot: { pieces: [piece('teamwork', 0.4, 'social_orientation')] },
        sessionStatus: 'skipped_empty_pool',
        shouldExplore: true,
      })
    ).toBe(false);

    await CareerIdentityProfile.create({ userId, traits: [] });
    const baseline = createSnapshot([
      piece('teamwork', 0.4, 'social_orientation', 'emerging'),
    ]);
    await saveSnapshot(userId, baseline);

    const deltaService = require('../services/careerIdentity/deltaJobMatchingService');
    const matchSpy = jest
      .spyOn(deltaService, 'matchJobsByIdentityDelta')
      .mockResolvedValue({ matches: [], matchSource: 'identity_delta' });
    const initialFitSpy = jest
      .spyOn(deltaService, 'matchJobsByInitialIdentityFit')
      .mockResolvedValue([]);

    const currentIdentity = {
      nodes: [
        { id: 'leadership', category: 'leadership', confidence: 0.85, layer: 'confirmed' },
        { id: 'teamwork', category: 'social_orientation', confidence: 0.4, layer: 'emerging' },
      ],
    };

    const result = await runIdentityExplorationPipeline({
      userId,
      currentIdentity,
      language: 'en',
      triggerSource: 'test',
      roles: [role('unused')],
      bypassSimulationUnlockGate: true,
      signals: {
        interactionCount: 4,
        averageConfidence: 0.4,
        stability: 0.2,
        traitOverlap: 0.2,
        historicalCalmness: 0.5,
        recentExplorationSessions: 0,
        recentExplorationJobs: 0,
        hoursSinceLastExploration: 72,
      },
    });

    expect(result.status).toBe('skipped_empty_pool');
    expect(result.shouldExplore).toBe(true);

    const profile = await CareerIdentityProfile.findOne({ userId }).lean();
    expect(profile.lastIdentitySnapshot.pieces).toHaveLength(1);
    expect(profile.lastIdentitySnapshot.pieces[0].traitId).toBe('teamwork');

    matchSpy.mockRestore();
    initialFitSpy.mockRestore();
  });
});
