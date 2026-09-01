/**
 * Unit tests for Delta Job Matching.
 */

const {
  matchJobsByIdentityDelta,
  filterAndSortByDelta,
  buildIdentityVectorFromPieces,
  scoreRoleAgainstIdentityVector,
  extractIdentityPieces,
  blendIdentityAndProfileFit,
  DELTA_JOB_MATCHING_THRESHOLDS,
} = require('../services/careerIdentity/deltaJobMatchingService');
const { createSnapshot } = require('../services/careerIdentity/snapshotService');

function piece(traitId, confidence, extras = {}) {
  return { traitId, confidence, ...extras };
}

function role(id, scoresByTraitSet) {
  return { id, title: id, _scores: scoresByTraitSet };
}

describe('deltaJobMatchingService', () => {
  it('extractIdentityPieces accepts snapshots, traits, and nodes', () => {
    const snapshot = createSnapshot([piece('leadership', 0.7, { category: 'leadership' })]);
    expect(extractIdentityPieces(snapshot)[0].traitId).toBe('leadership');
    expect(extractIdentityPieces({ traits: [piece('teamwork', 0.5)] })[0].traitId).toBe('teamwork');
    expect(extractIdentityPieces({ nodes: [{ id: 'empathy', confidence: 0.4 }] })[0].traitId).toBe(
      'empathy'
    );
  });

  it('returns oldScore, newScore, and delta for each job', async () => {
    const previous = [piece('teamwork', 0.5, { category: 'social_orientation' })];
    const current = [
      piece('teamwork', 0.5, { category: 'social_orientation' }),
      piece('leadership', 0.8, { category: 'leadership', layer: 'confirmed' }),
    ];

    const roles = [
      role('manager', { previous: 0.4, current: 0.7 }),
      role('nurse', { previous: 0.55, current: 0.56 }),
      role('analyst', { previous: 0.5, current: 0.35 }),
    ];

    const matches = await matchJobsByIdentityDelta({
      previousIdentity: previous,
      currentIdentity: current,
      roles,
      scoreRole: (pieces, job) => {
        const isPrevious = pieces.every((p) => p.traitId !== 'leadership');
        return isPrevious ? job._scores.previous : job._scores.current;
      },
      thresholds: {
        MIN_ABS_DELTA: 0.03,
        REQUIRE_POSITIVE_DELTA: true,
        MIN_NEW_SCORE: 0.2,
        MAX_RESULTS: 50,
      },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].role.id).toBe('manager');
    expect(matches[0].oldScore).toBe(0.4);
    expect(matches[0].newScore).toBe(0.7);
    expect(matches[0].delta).toBe(0.3);
  });

  it('sorts by delta descending, not by absolute newScore', async () => {
    const previous = [piece('teamwork', 0.5)];
    const current = [piece('leadership', 0.8)];

    const roles = [
      role('highScoreSmallDelta', { previous: 0.8, current: 0.84 }),
      role('lowerScoreBigDelta', { previous: 0.3, current: 0.65 }),
      role('midDelta', { previous: 0.4, current: 0.55 }),
    ];

    const matches = await matchJobsByIdentityDelta({
      previousIdentity: previous,
      currentIdentity: current,
      roles,
      scoreRole: (pieces, job) => {
        const isPrevious = pieces.some((p) => p.traitId === 'teamwork');
        return isPrevious ? job._scores.previous : job._scores.current;
      },
      thresholds: {
        MIN_ABS_DELTA: 0.03,
        REQUIRE_POSITIVE_DELTA: true,
        MIN_NEW_SCORE: 0.2,
      },
    });

    expect(matches.map((m) => m.role.id)).toEqual([
      'lowerScoreBigDelta',
      'midDelta',
      'highScoreSmallDelta',
    ]);
    expect(matches[0].delta).toBeGreaterThan(matches[1].delta);
  });

  it('ignores jobs whose score barely changed', async () => {
    const filtered = filterAndSortByDelta(
      [
        { role: { id: 'a' }, oldScore: 0.5, newScore: 0.52, delta: 0.02 },
        { role: { id: 'b' }, oldScore: 0.4, newScore: 0.5, delta: 0.1 },
      ],
      { MIN_ABS_DELTA: 0.03, REQUIRE_POSITIVE_DELTA: true, MIN_NEW_SCORE: 0 }
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].role.id).toBe('b');
  });

  it('respects configurable MIN_ABS_DELTA threshold', async () => {
    const scored = await matchJobsByIdentityDelta({
      previousIdentity: [piece('teamwork', 0.5)],
      currentIdentity: [piece('leadership', 0.8)],
      roles: [role('x', { previous: 0.4, current: 0.45 })],
      scoreRole: (pieces, job) =>
        pieces[0]?.traitId === 'teamwork' ? job._scores.previous : job._scores.current,
      thresholds: { MIN_ABS_DELTA: 0.1, REQUIRE_POSITIVE_DELTA: true, MIN_NEW_SCORE: 0 },
    });

    expect(scored).toHaveLength(0);
  });

  it('can include negative deltas when REQUIRE_POSITIVE_DELTA is false', () => {
    const filtered = filterAndSortByDelta(
      [{ role: { id: 'drop' }, oldScore: 0.7, newScore: 0.4, delta: -0.3 }],
      {
        MIN_ABS_DELTA: 0.03,
        REQUIRE_POSITIVE_DELTA: false,
        MIN_NEW_SCORE: 0,
      }
    );
    expect(filtered).toHaveLength(1);
  });

  it('buildIdentityVectorFromPieces uses injected embeddings', () => {
    const dims = 4;
    const embeddings = {
      leadership: new Float32Array([1, 0, 0, 0]),
      teamwork: new Float32Array([0, 1, 0, 0]),
    };

    const vector = buildIdentityVectorFromPieces(
      [
        piece('leadership', 0.8, { layer: 'confirmed' }),
        piece('teamwork', 0.4, { layer: 'emerging' }),
      ],
      { MIN_PIECE_CONFIDENCE: 0.3 },
      { getEmbedding: (id) => embeddings[id] || null }
    );

    expect(vector).toBeTruthy();
    expect(vector.length).toBe(dims);
    // Leadership should dominate → first component largest
    expect(vector[0]).toBeGreaterThan(vector[1]);
  });

  it('scoreRoleAgainstIdentityVector returns cosine fit', () => {
    const identity = new Float32Array([1, 0, 0, 0]);
    const aligned = {
      roleVectors: { identity_vector: [1, 0, 0, 0] },
    };
    const orthogonal = {
      roleVectors: { identity_vector: [0, 1, 0, 0] },
    };

    expect(scoreRoleAgainstIdentityVector(identity, aligned)).toBeCloseTo(1, 5);
    expect(scoreRoleAgainstIdentityVector(identity, orthogonal)).toBeCloseTo(0, 5);
  });

  it('blends profile fit into absolute scores and filters weak profile matches', async () => {
    const previous = [piece('teamwork', 0.5)];
    const current = [piece('leadership', 0.8)];

    const roles = [
      role('aligned', { previous: 0.4, current: 0.7 }),
      role('unrelated', { previous: 0.35, current: 0.65 }),
    ];

    const profileFits = {
      aligned: 0.6,
      unrelated: 0.05,
    };

    const matches = await matchJobsByIdentityDelta({
      previousIdentity: previous,
      currentIdentity: current,
      roles,
      scoreRole: (pieces, job) => {
        const isPrevious = pieces.some((p) => p.traitId === 'teamwork');
        return isPrevious ? job._scores.previous : job._scores.current;
      },
      scoreProfileFit: (job) => profileFits[job.id],
      thresholds: {
        MIN_ABS_DELTA: 0.03,
        REQUIRE_POSITIVE_DELTA: true,
        MIN_NEW_SCORE: 0.2,
        USE_PROFILE_GROUNDING: true,
        PROFILE_BLEND_WEIGHT: 0.4,
        MIN_PROFILE_FIT: 0.22,
      },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].role.id).toBe('aligned');
    expect(matches[0].identityFit).toBe(0.7);
    expect(matches[0].profileFit).toBe(0.6);
    // (1-0.4)*0.7 + 0.4*0.6 = 0.42 + 0.24 = 0.66
    expect(matches[0].newScore).toBeCloseTo(0.66, 4);
    // identity delta 0.3; blended delta = 0.6 * 0.3 = 0.18
    expect(matches[0].delta).toBeCloseTo(0.18, 4);
  });

  it('limits expensive profile scoring to the top identity candidates', async () => {
    const previous = [piece('teamwork', 0.5)];
    const current = [piece('leadership', 0.8)];
    const roles = Array.from({ length: 12 }, (_, i) =>
      role(`r${i}`, { previous: 0.2 + i * 0.01, current: 0.5 + i * 0.02 })
    );

    let profileCalls = 0;
    const matches = await matchJobsByIdentityDelta({
      previousIdentity: previous,
      currentIdentity: current,
      roles,
      scoreRole: (pieces, job) => {
        const isPrevious = pieces.some((p) => p.traitId === 'teamwork');
        return isPrevious ? job._scores.previous : job._scores.current;
      },
      scoreProfileFit: async () => {
        profileCalls += 1;
        return 0.5;
      },
      thresholds: {
        MIN_ABS_DELTA: 0.03,
        REQUIRE_POSITIVE_DELTA: true,
        MIN_NEW_SCORE: 0.2,
        USE_PROFILE_GROUNDING: true,
        PROFILE_BLEND_WEIGHT: 0.4,
        MIN_PROFILE_FIT: 0.22,
        PROFILE_CANDIDATE_LIMIT: 4,
        MAX_RESULTS: 4,
      },
    });

    expect(profileCalls).toBe(4);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(4);
  });

  it('falls back to absolute fit from the same scored pool without requiring delta', async () => {
    const previous = [piece('teamwork', 0.5)];
    const current = [piece('leadership', 0.8)];
    // Tiny identity movement → delta filter empty; absolute fit still strong.
    const roles = [role('stableStrong', { previous: 0.7, current: 0.71 })];

    const result = await matchJobsByIdentityDelta({
      previousIdentity: previous,
      currentIdentity: current,
      roles,
      scoreRole: (pieces, job) => {
        const isPrevious = pieces.some((p) => p.traitId === 'teamwork');
        return isPrevious ? job._scores.previous : job._scores.current;
      },
      thresholds: {
        MIN_ABS_DELTA: 0.03,
        REQUIRE_POSITIVE_DELTA: true,
        MIN_NEW_SCORE: 0.2,
        USE_PROFILE_GROUNDING: false,
      },
      fallbackToInitialFit: true,
      returnMeta: true,
    });

    expect(result.matchSource).toBe('initial_fit_fallback');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].role.id).toBe('stableStrong');
    expect(result.matches[0].newScore).toBeCloseTo(0.71, 4);
  });

  it('blendIdentityAndProfileFit leaves identity-only scores when profile missing', () => {
    expect(
      blendIdentityAndProfileFit(0.5, null, {
        USE_PROFILE_GROUNDING: true,
        PROFILE_BLEND_WEIGHT: 0.4,
      })
    ).toBe(0.5);
  });

  it('exports default thresholds for tuning', () => {
    expect(DELTA_JOB_MATCHING_THRESHOLDS.MIN_ABS_DELTA).toBeGreaterThan(0);
    expect(DELTA_JOB_MATCHING_THRESHOLDS.REQUIRE_POSITIVE_DELTA).toBe(true);
    expect(DELTA_JOB_MATCHING_THRESHOLDS.USE_PROFILE_GROUNDING).toBe(true);
    expect(DELTA_JOB_MATCHING_THRESHOLDS.PROFILE_BLEND_WEIGHT).toBeGreaterThan(0);
  });
});
