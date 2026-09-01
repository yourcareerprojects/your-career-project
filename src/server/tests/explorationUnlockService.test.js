const mongoose = require('mongoose');
const User = require('../models/User');
const CareerIdentityProfile = require('../models/CareerIdentityProfile');
const IdentityExplorationSession = require('../models/IdentityExplorationSession');
const { saveSnapshot } = require('../services/careerIdentity/snapshotService');
const {
  userHasCompletedFirstSimulationRankings,
  ensureExplorationAccumulationUnlocked,
  canDeliverExplorationRoles,
} = require('../services/careerIdentity/explorationUnlockService');
const { getIdentityExplorationProgress } = require('../services/careerIdentity/explorationProgressService');
const { areBothSimulationRankingsComplete } = require('../utils/evaluationFlowRoles');

function piece(traitId, confidence, category, layer = 'emerging') {
  return { traitId, confidence, category, layer };
}

function completedEvaluationFlowLegacyRanked() {
  return {
    phases: { nextSteps: 'ranked', outsideTheBox: 'ranked' },
    ranked: {
      nextSteps: [{ step: { id: 'a' }, userEvaluation: 'keep' }],
      outsideTheBox: [{ step: { id: 'b' }, userEvaluation: 'skip' }],
    },
  };
}

/** Canonical client shape: phases + roles[] (no ranked.* boards). */
function completedEvaluationFlowRolesOnly() {
  return {
    phases: { nextSteps: 'ranked', outsideTheBox: 'ranked' },
    roles: [
      { id: 'n1', category: 'nextSteps', userEvaluation: 'keep', order: 0 },
      { id: 'n2', category: 'nextSteps', userEvaluation: 'skip', order: 1 },
      { id: 'o1', category: 'outsideTheBox', userEvaluation: 'dislike', order: 0 },
    ],
  };
}

describe('explorationUnlockService', () => {
  let userId;

  beforeEach(async () => {
    userId = new mongoose.Types.ObjectId();
    await User.deleteMany({ _id: userId });
    await CareerIdentityProfile.deleteMany({ userId });
    await IdentityExplorationSession.deleteMany({ userId });
  });

  afterEach(async () => {
    await User.deleteMany({ _id: userId });
    await CareerIdentityProfile.deleteMany({ userId });
    await IdentityExplorationSession.deleteMany({ userId });
  });

  it('detects completed rankings from canonical roles[] (not only ranked boards)', () => {
    expect(areBothSimulationRankingsComplete(completedEvaluationFlowRolesOnly())).toBe(true);
    expect(areBothSimulationRankingsComplete(completedEvaluationFlowLegacyRanked())).toBe(true);
    expect(
      areBothSimulationRankingsComplete({
        phases: { nextSteps: 'ranked', outsideTheBox: 'ranked' },
        roles: [{ id: 'n1', category: 'nextSteps', userEvaluation: 'keep' }],
      })
    ).toBe(false);

    expect(
      userHasCompletedFirstSimulationRankings({
        lastSimulationResult: {
          results: { evaluationFlow: completedEvaluationFlowRolesOnly() },
        },
      })
    ).toBe(true);
  });

  it('heals false Discover + inflated progress even before rankings unlock stamp', async () => {
    await User.create({
      _id: userId,
      email: `heal-${userId}@example.com`,
      password: 'hashedpassword',
    });
    await CareerIdentityProfile.create({ userId, traits: [] });
    await saveSnapshot(userId, [piece('leadership', 0.3, 'leadership', 'confirmed')]);

    await IdentityExplorationSession.create({
      userId,
      pipelineId: 'test_pipe',
      status: 'completed',
      changeScore: 8,
      explorationJobs: [
        {
          careerPathId: String(new mongoose.Types.ObjectId()),
          oldScore: 0.1,
          newScore: 0.7,
          delta: 0.6,
          source: 'highest_delta',
        },
      ],
      seenAt: null,
    });

    const currentIdentity = {
      nodes: [
        { id: 'leadership', category: 'leadership', confidence: 0.85, layer: 'confirmed' },
        { id: 'teamwork', category: 'social_orientation', confidence: 0.55, layer: 'emerging' },
      ],
    };

    const result = await ensureExplorationAccumulationUnlocked(userId, currentIdentity);
    expect(result.unlocked).toBe(false);
    expect(result.didUnlock).toBe(false);
    expect(result.healedOnboarding).toBe(true);

    const unread = await IdentityExplorationSession.findOne({
      userId,
      status: 'completed',
      seenAt: null,
    }).lean();
    expect(unread).toBeNull();

    const progress = await getIdentityExplorationProgress(userId, currentIdentity, {
      language: 'en',
    });
    expect(progress.progressPercent).toBe(0);
    expect(progress.phase).toBe('accumulating');
    expect(await canDeliverExplorationRoles(userId)).toBe(false);
  });

  it('unlocks once: resets baseline, clears unread Discover, stamps profile', async () => {
    await User.create({
      _id: userId,
      email: `unlock-${userId}@example.com`,
      password: 'hashedpassword',
      lastSimulationResult: {
        results: { evaluationFlow: completedEvaluationFlowRolesOnly() },
        date: new Date(),
      },
    });

    await CareerIdentityProfile.create({ userId, traits: [] });
    await saveSnapshot(userId, [piece('leadership', 0.4, 'leadership', 'confirmed')]);

    await IdentityExplorationSession.create({
      userId,
      pipelineId: 'test_pipe',
      status: 'completed',
      changeScore: 8,
      explorationJobs: [
        {
          careerPathId: String(new mongoose.Types.ObjectId()),
          oldScore: 0.1,
          newScore: 0.7,
          delta: 0.6,
          source: 'highest_delta',
        },
      ],
      seenAt: null,
    });

    const currentIdentity = {
      nodes: [
        { id: 'leadership', category: 'leadership', confidence: 0.8, layer: 'confirmed' },
        { id: 'teamwork', category: 'social_orientation', confidence: 0.5, layer: 'emerging' },
      ],
    };

    const first = await ensureExplorationAccumulationUnlocked(userId, currentIdentity);
    expect(first.unlocked).toBe(true);
    expect(first.didUnlock).toBe(true);
    expect(first.healedOnboarding).toBe(true);

    const progress = await getIdentityExplorationProgress(userId, currentIdentity, {
      language: 'en',
    });
    expect(progress.hasBaseline).toBe(true);
    expect(progress.progressPercent).toBe(0);
    expect(progress.phase).toBe('accumulating');

    const unread = await IdentityExplorationSession.findOne({
      userId,
      status: 'completed',
      seenAt: null,
    }).lean();
    expect(unread).toBeNull();

    const profile = await CareerIdentityProfile.findOne({ userId }).lean();
    expect(profile.explorationAccumulationUnlockedAt).toBeTruthy();

    expect(await canDeliverExplorationRoles(userId)).toBe(true);

    const second = await ensureExplorationAccumulationUnlocked(userId, currentIdentity);
    expect(second.didUnlock).toBe(false);
    expect(second.unlocked).toBe(true);
    expect(second.healedOnboarding).toBe(false);
  });
});
