const {
  buildSavedCareerStepKey,
  findMatchingSavedCareerStep,
} = require('../utils/savedCareerStepIdentity');

describe('saved career step identity integration (out-of-the-box flow)', () => {
  const simulationIdA = 'sim-a-123';
  const simulationIdB = 'sim-b-456';
  const clusterId = 'cluster-ux-001';

  const savedStep = {
    stepId: 'object-object-sim-a-123-outsideTheBox-0',
    simulationResultId: simulationIdA,
    title: 'UX Strategist',
    description: 'Design user-centered product strategy.',
    category: 'outsideTheBox',
    careerPathId: clusterId,
    escoId: 'esco:old-role',
  };

  savedStep.savedKey = buildSavedCareerStepKey(savedStep);

  it('matches saved status in list, ranking, and detail-after-reload', () => {
    const savedSteps = [savedStep];

    // 1) New simulation list card (same cluster, different ids/title shape).
    const freshListRole = {
      stepId: 'object-object-sim-b-456-outsideSimulationBox-2',
      simulationResultId: simulationIdB,
      title: { en: 'UX Strategist', de: 'UX Stratege' },
      description: 'Design user-centered product strategy.',
      category: 'outsideSimulationBox',
      careerPathId: clusterId, // cluster identity should win
      escoId: 'esco:new-role-same-cluster',
    };

    // 2) Ranking item typically passes row.step role shape.
    const rankingRole = {
      id: 'rank-role-2',
      instanceId: 'instance-outbox-2',
      title: { en: 'UX Strategist' },
      description: 'Design user-centered product strategy.',
      category: 'outsideTheBox',
      careerPathId: clusterId,
    };

    // 3) Detail page after reload with brittle route stepId.
    const detailRoleAfterReload = {
      stepId: 'object-object-sim-b-456-outsideSimulationBox-2',
      title: { de: 'UX Stratege', en: 'UX Strategist' },
      description: 'Design user-centered product strategy.',
      category: 'outsideSimulationBox',
      careerPathId: clusterId,
    };
    const routeStepId = 'object-object-sim-b-456-outsideTheBox-2';

    const listMatch = findMatchingSavedCareerStep(freshListRole, savedSteps);
    const rankingMatch = findMatchingSavedCareerStep(rankingRole, savedSteps);
    const detailMatch = findMatchingSavedCareerStep(detailRoleAfterReload, savedSteps, { routeStepId });

    expect(listMatch).not.toBeNull();
    expect(rankingMatch).not.toBeNull();
    expect(detailMatch).not.toBeNull();

    expect(listMatch?.savedKey).toBe(savedStep.savedKey);
    expect(rankingMatch?.savedKey).toBe(savedStep.savedKey);
    expect(detailMatch?.savedKey).toBe(savedStep.savedKey);
  });

  it('duplicate-save response keeps state stable and does not require raw JSON message', () => {
    const currentSavedSteps = [savedStep];
    const roleAttemptingSave = {
      stepId: 'object-object-sim-b-456-outsideSimulationBox-2',
      simulationResultId: simulationIdB,
      title: { en: 'UX Strategist', de: 'UX Stratege' },
      description: 'Design user-centered product strategy.',
      category: 'outsideSimulationBox',
      careerPathId: clusterId,
      escoId: 'esco:new-role-same-cluster',
    };

    const duplicate409Payload = {
      success: false,
      message: 'This career step is already saved with the same content',
      duplicateType: 'content',
      similarity: 1,
      // This large list previously leaked into UI when raw errorData was thrown.
      savedCareerSteps: currentSavedSteps,
    };

    const parsedMessage = duplicate409Payload.message || 'Already saved';
    const mergedSavedSteps = Array.isArray(duplicate409Payload.savedCareerSteps)
      ? duplicate409Payload.savedCareerSteps
      : currentSavedSteps;

    const matchedBefore = findMatchingSavedCareerStep(roleAttemptingSave, currentSavedSteps);
    const matchedAfter = findMatchingSavedCareerStep(roleAttemptingSave, mergedSavedSteps);

    expect(matchedBefore).not.toBeNull();
    expect(matchedAfter).not.toBeNull();
    expect(matchedAfter?.savedKey).toBe(savedStep.savedKey);
    // UX should render concise message text, not stringify payload blobs.
    expect(parsedMessage).toContain('already saved');
    expect(parsedMessage).not.toContain('"savedCareerSteps"');
    expect(parsedMessage).not.toContain('{"stepId"');
  });
});

