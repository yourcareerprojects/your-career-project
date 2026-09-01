/**
 * Unit tests for unified evidence aggregation pipeline.
 */

const { aggregateSemanticEvidence, applyCandidateTraits } = require('../services/careerIdentity/evidenceAggregation');
const {
  weightReflection,
  weightSimulation,
} = require('../services/careerIdentity/evidenceWeighting');

describe('evidenceWeighting', () => {
  it('preserves original reflection weight formula', () => {
    expect(weightReflection(0.5)).toBeCloseTo(Math.min(0.85, 0.45 + 0.5 * 0.4), 5);
  });
  it('preserves simulation weight formula', () => {
    expect(weightSimulation(0.5)).toBeCloseTo(Math.min(0.85, 0.4 + 0.5 * 0.35), 5);
  });
});

describe('evidenceAggregation', () => {
  it('routes all sources through the same semantic matcher', async () => {
    const discoverCalls = [];

    const user = {
      updatedAt: new Date('2026-01-10'),
      profile: {
        userIdentityAnswers: { workEnjoyMost: 'helping patients' },
        structuredUserInfo: {
          skills: { raw_items: ['teamwork'], summary_text: 'collaboration' },
        },
        documents: [
          {
            _id: 'doc1',
            name: 'CV',
            extractedProfileData: 'nursing care',
          },
        ],
      },
      lastSimulationResult: {
        _id: 'sim1',
        evaluationFlow: {
          kept: [{ id: 'r1', title: { en: 'Caregiver' }, description: { en: 'helping others' } }],
        },
      },
    };

    const { evidenceByTrait } = await aggregateSemanticEvidence(user, {
      discoverTraitsFromText: async (text) => {
        discoverCalls.push(text);
        const scores = new Map();
        if (text.toLowerCase().includes('help')) scores.set('helping_others', 0.8);
        if (text.toLowerCase().includes('team')) scores.set('teamwork', 0.7);
        if (text.toLowerCase().includes('nurs') || text.toLowerCase().includes('care')) {
          scores.set('helping_others', 0.75);
        }
        return scores;
      },
    });

    expect(discoverCalls.length).toBeGreaterThanOrEqual(4);
    expect(evidenceByTrait.size).toBeGreaterThan(0);

    const reflection = (evidenceByTrait.get('helping_others') || []).find(
      (e) => e.sourceType === 'reflection'
    );
    const profile = (evidenceByTrait.get('teamwork') || []).find((e) => e.sourceType === 'profile');
    const cv = (evidenceByTrait.get('helping_others') || []).find((e) => e.sourceType === 'cv');
    const simulation = (evidenceByTrait.get('helping_others') || []).find(
      (e) => e.sourceType === 'simulation'
    );

    expect(reflection).toBeTruthy();
    expect(profile).toBeTruthy();
    expect(cv).toBeTruthy();
    expect(simulation).toBeTruthy();
    expect(reflection.weight).toBe(weightReflection(0.8));
    expect(simulation.weight).toBe(weightSimulation(0.75));
  });

  it('applyCandidateTraits uses item-specific weight builders', () => {
    const bucket = new Map();
    applyCandidateTraits(
      bucket,
      {
        text: 'sample',
        sourceType: 'reflection',
        toEvidence(traitId, strength) {
          return {
            evidenceId: `e-${traitId}`,
            sourceType: 'reflection',
            sourceId: 'identity:test',
            weight: weightReflection(strength),
            timestamp: new Date(),
            explanation: { en: 'x', de: 'x' },
            label: { en: 'x', de: 'x' },
          };
        },
      },
      new Map([['helping_others', 0.6]])
    );

    // 'sample' has no lexical overlap and strength is below the strong threshold
    expect(bucket.has('helping_others')).toBe(false);

    applyCandidateTraits(
      bucket,
      {
        text: 'I love helping people',
        sourceType: 'reflection',
        toEvidence(traitId, strength) {
          return {
            evidenceId: `e2-${traitId}`,
            sourceType: 'reflection',
            sourceId: 'identity:test',
            weight: weightReflection(strength),
            timestamp: new Date(),
            explanation: { en: 'x', de: 'x' },
            label: { en: 'x', de: 'x' },
          };
        },
      },
      new Map([['helping_others', 0.6]])
    );

    expect(bucket.get('helping_others')).toHaveLength(1);
    expect(bucket.get('helping_others')[0].weight).toBe(weightReflection(0.6));
  });
});
