/**
 * Unit tests for identity trait user votes ("Passt das zu dir?").
 */

const {
  calculateTraitConfidence,
} = require('../services/careerIdentity/traitConfidenceCalculator');

const {
  assembleTraits,
  serializeProfile,
} = require('../services/careerIdentity/identityEngine');

const {
  normalizeTraitVote,
  buildTraitVoteEvidence,
  applyTraitVotesToEvidence,
  upsertTraitVoteList,
  getTraitVoteFromList,
  wouldRejectRemoveTrait,
  wouldVoteRemoveTrait,
  buildVoteWouldRemoveMap,
  evidenceMapFromCachedTraits,
  isUserVoteEvidence,
} = require('../services/careerIdentity/traitVoteEvidence');

const baseSupportingEvidence = [
  {
    evidenceId: 'e1',
    sourceType: 'reflection',
    sourceId: 'identity:workEnjoyMost',
    weight: 0.75,
    matchStrength: 0.7,
    timestamp: new Date(),
    explanation: { en: 'From reflection', de: 'Aus Reflexion' },
    label: { en: 'Reflection', de: 'Reflexion' },
  },
  {
    evidenceId: 'e2',
    sourceType: 'career',
    sourceId: 'saved:s1',
    weight: 0.8,
    matchStrength: 0.72,
    timestamp: new Date(),
    explanation: { en: 'From a saved role', de: 'Aus einer gespeicherten Rolle' },
    label: { en: 'Saved career', de: 'Gespeicherte Karriere' },
  },
  {
    evidenceId: 'e3',
    sourceType: 'simulation',
    sourceId: 'sim:1',
    weight: 0.78,
    matchStrength: 0.68,
    timestamp: new Date(),
    explanation: { en: 'From simulation', de: 'Aus Simulation' },
    label: { en: 'Simulation', de: 'Simulation' },
  },
];

describe('traitVoteEvidence helpers', () => {
  it('normalizes vote values', () => {
    expect(normalizeTraitVote('confirm')).toBe('confirm');
    expect(normalizeTraitVote('REJECT')).toBe('reject');
    expect(normalizeTraitVote('unsure')).toBe('unsure');
    expect(normalizeTraitVote(null)).toBeNull();
    expect(normalizeTraitVote('keep')).toBeNull();
  });

  it('builds confirm and reject assessment evidence', () => {
    const confirm = buildTraitVoteEvidence('helping_others', 'confirm', 'user1');
    expect(confirm.sourceType).toBe('assessment');
    expect(confirm.polarity).toBe('positive');
    expect(confirm.weight).toBeGreaterThan(0.4);
    expect(confirm.weight).toBeLessThan(0.7);

    const reject = buildTraitVoteEvidence('helping_others', 'reject', 'user1');
    expect(reject.polarity).toBe('negative');
    expect(reject.explanation.de).toMatch(/nicht wirklich/i);

    expect(buildTraitVoteEvidence('helping_others', 'unsure', 'user1')).toBeNull();
  });

  it('upserts and clears votes in the list', () => {
    let votes = upsertTraitVoteList([], 'helping_others', 'confirm');
    expect(votes).toEqual([
      expect.objectContaining({ traitId: 'helping_others', vote: 'confirm' }),
    ]);

    votes = upsertTraitVoteList(votes, 'helping_others', 'reject');
    expect(votes).toHaveLength(1);
    expect(votes[0].vote).toBe('reject');

    votes = upsertTraitVoteList(votes, 'helping_others', null);
    expect(votes).toHaveLength(0);
  });

  it('reads a stored vote for a trait', () => {
    const votes = [{ traitId: 'teamwork', vote: 'unsure', updatedAt: new Date() }];
    expect(getTraitVoteFromList(votes, 'teamwork')).toBe('unsure');
    expect(getTraitVoteFromList(votes, 'helping_others')).toBeNull();
  });

  it('rebuilds an evidence map from cached traits without prior user votes', () => {
    const map = evidenceMapFromCachedTraits([
      {
        traitId: 'helping_others',
        evidence: [
          {
            evidenceId: 'e1',
            sourceType: 'reflection',
            sourceId: 'identity:workEnjoyMost',
            weight: 0.7,
            matchStrength: 0.6,
            polarity: 'positive',
            timestamp: new Date('2024-01-01'),
            explanation: { en: 'Reflection', de: 'Reflexion' },
            label: { en: 'Reflection', de: 'Reflexion' },
          },
          buildTraitVoteEvidence('helping_others', 'confirm', 'user1'),
        ],
      },
    ]);

    expect(map.get('helping_others')).toHaveLength(1);
    expect(isUserVoteEvidence(map.get('helping_others')[0])).toBe(false);

    applyTraitVotesToEvidence(
      map,
      [{ traitId: 'helping_others', vote: 'reject', updatedAt: new Date() }],
      'user1'
    );
    expect(map.get('helping_others')).toHaveLength(2);
    expect(map.get('helping_others').some((e) => e.polarity === 'negative')).toBe(true);
  });
});

describe('trait vote confidence effects', () => {
  it('upgrades confidence when the user confirms a trait', () => {
    const withoutVote = calculateTraitConfidence(baseSupportingEvidence);
    const withConfirm = calculateTraitConfidence([
      ...baseSupportingEvidence,
      buildTraitVoteEvidence('helping_others', 'confirm', 'user1'),
    ]);

    expect(withConfirm).toBeGreaterThan(withoutVote);
    // One confirmation should nudge, not leap toward the ceiling.
    expect(withConfirm - withoutVote).toBeLessThan(0.18);
  });

  it('downgrades confidence when the user rejects a trait', () => {
    const withoutVote = calculateTraitConfidence(baseSupportingEvidence);
    const withReject = calculateTraitConfidence([
      ...baseSupportingEvidence,
      buildTraitVoteEvidence('helping_others', 'reject', 'user1'),
    ]);

    expect(withReject).toBeLessThan(withoutVote);
    // One rejection should nudge down, not wipe out supporting evidence.
    expect(withoutVote - withReject).toBeLessThan(0.18);
  });

  it('does not invent a trait from reject-only evidence', () => {
    expect(
      calculateTraitConfidence([buildTraitVoteEvidence('helping_others', 'reject', 'user1')])
    ).toBe(0);
  });

  it('leaves confidence unchanged for unsure (no scoring evidence)', () => {
    const bucket = new Map([['helping_others', [...baseSupportingEvidence]]]);
    applyTraitVotesToEvidence(
      bucket,
      [{ traitId: 'helping_others', vote: 'unsure', updatedAt: new Date() }],
      'user1'
    );
    expect(bucket.get('helping_others')).toHaveLength(baseSupportingEvidence.length);
  });

  it('gently raises an emerging trait via confirm vote without requiring a layer jump', () => {
    const before = assembleTraits(new Map([['helping_others', baseSupportingEvidence]]));
    expect(before[0].layer).toBe('emerging');

    const bucket = new Map([['helping_others', [...baseSupportingEvidence]]]);
    applyTraitVotesToEvidence(
      bucket,
      [{ traitId: 'helping_others', vote: 'confirm', updatedAt: new Date() }],
      'user1'
    );
    const after = assembleTraits(bucket);
    expect(after).toHaveLength(1);
    expect(after[0].confidence).toBeGreaterThan(before[0].confidence);
    expect(after[0].confidence - before[0].confidence).toBeLessThan(0.18);
  });

  it('gently lowers an emerging trait via reject without removing it by default', () => {
    const before = assembleTraits(new Map([['helping_others', baseSupportingEvidence]]));
    expect(before).toHaveLength(1);
    expect(before[0].layer).toBe('emerging');

    const bucket = new Map([['helping_others', [...baseSupportingEvidence]]]);
    applyTraitVotesToEvidence(
      bucket,
      [{ traitId: 'helping_others', vote: 'reject', updatedAt: new Date() }],
      'user1'
    );
    const after = assembleTraits(bucket);
    expect(after).toHaveLength(1);
    expect(after[0].confidence).toBeLessThan(before[0].confidence);
    expect(before[0].confidence - after[0].confidence).toBeLessThan(0.18);
  });

  it('flags when a reject vote would drop a near-threshold trait from the puzzle', () => {
    const borderlineEvidence = [
      {
        evidenceId: 'b1',
        sourceType: 'reflection',
        sourceId: 'identity:workEnjoyMost',
        weight: 0.75,
        matchStrength: 0.7,
        timestamp: new Date(),
        explanation: { en: 'Borderline', de: 'Grenzfall' },
        label: { en: 'Reflection', de: 'Reflexion' },
      },
      {
        evidenceId: 'b2',
        sourceType: 'career',
        sourceId: 'saved:s1',
        weight: 0.75,
        matchStrength: 0.7,
        timestamp: new Date(),
        explanation: { en: 'Borderline career', de: 'Grenzfall Karriere' },
        label: { en: 'Saved career', de: 'Gespeicherte Karriere' },
      },
    ];

    const before = assembleTraits(new Map([['helping_others', borderlineEvidence]]));
    expect(before).toHaveLength(1);
    expect(wouldRejectRemoveTrait(borderlineEvidence, 'helping_others', 'user1')).toBe(true);
    expect(wouldRejectRemoveTrait(baseSupportingEvidence, 'helping_others', 'user1')).toBe(false);
  });

  it('flags when clearing or changing a confirm vote would drop a confirm-propped trait', () => {
    const weakBase = [
      {
        evidenceId: 'w1',
        sourceType: 'reflection',
        sourceId: 'identity:workEnjoyMost',
        weight: 0.85,
        matchStrength: 0.8,
        timestamp: new Date(),
        explanation: { en: 'Weak', de: 'Schwach' },
        label: { en: 'Reflection', de: 'Reflexion' },
      },
    ];

    const withConfirm = [
      ...weakBase,
      buildTraitVoteEvidence('helping_others', 'confirm', 'user1'),
    ];

    // Confirm is what keeps this piece on the puzzle.
    expect(assembleTraits(new Map([['helping_others', weakBase]]))).toHaveLength(0);
    expect(assembleTraits(new Map([['helping_others', withConfirm]]))).toHaveLength(1);

    expect(wouldVoteRemoveTrait(withConfirm, 'helping_others', 'user1', 'unsure')).toBe(true);
    expect(wouldVoteRemoveTrait(withConfirm, 'helping_others', 'user1', null)).toBe(true);
    expect(wouldVoteRemoveTrait(withConfirm, 'helping_others', 'user1', 'reject')).toBe(true);
    expect(wouldVoteRemoveTrait(withConfirm, 'helping_others', 'user1', 'confirm')).toBe(false);

    const map = buildVoteWouldRemoveMap(withConfirm, 'helping_others', 'user1');
    expect(map).toEqual({
      confirm: false,
      unsure: true,
      reject: true,
      clear: true,
    });
  });
});

describe('serializeProfile with trait votes', () => {
  it('includes userVote and evidence polarity on nodes', () => {
    const serialized = serializeProfile(
      {
        _id: 'profile1',
        userId: 'user1',
        lastRefreshedAt: new Date('2026-07-01'),
        traitVotes: [{ traitId: 'helping_others', vote: 'confirm', updatedAt: new Date() }],
        traits: [
          {
            traitId: 'helping_others',
            category: 'values',
            confidence: 0.75,
            layer: 'confirmed',
            evidenceCount: 2,
            evidence: [
              {
                evidenceId: 'e1',
                sourceType: 'reflection',
                sourceId: 'identity:workEnjoyMost',
                weight: 0.8,
                polarity: 'positive',
                timestamp: new Date('2026-07-01'),
                explanation: { en: 'You enjoy helping', de: 'Du hilfst gern' },
                label: { en: 'Reflection', de: 'Reflexion' },
              },
              {
                evidenceId: 'vote1',
                sourceType: 'assessment',
                sourceId: 'user_vote:helping_others',
                weight: 0.95,
                polarity: 'positive',
                timestamp: new Date('2026-07-01'),
                explanation: {
                  en: 'You confirmed that this fits you well.',
                  de: 'Du hast bestätigt, dass das sehr gut zu dir passt.',
                },
                label: { en: 'Your feedback', de: 'Dein Feedback' },
              },
            ],
            lastUpdated: new Date('2026-07-01'),
          },
        ],
        connections: [],
      },
      'de'
    );

    expect(serialized.nodes[0].userVote).toBe('confirm');
    expect(typeof serialized.nodes[0].rejectWouldRemove).toBe('boolean');
    expect(serialized.nodes[0].voteWouldRemove).toEqual({
      confirm: expect.any(Boolean),
      unsure: expect.any(Boolean),
      reject: expect.any(Boolean),
      clear: expect.any(Boolean),
    });
    expect(serialized.nodes[0].rejectWouldRemove).toBe(
      serialized.nodes[0].voteWouldRemove.reject
    );
    expect(serialized.nodes[0].evidence.some((e) => e.polarity === 'positive')).toBe(true);
    expect(serialized.nodes[0].evidence.some((e) => e.sourceType === 'assessment')).toBe(true);
  });
});
