/**
 * Unit tests for Career Identity catalog, confidence, evidence matching, and assembly.
 * Pure logic — no MongoDB.
 */

const {
  IDENTITY_CATEGORIES,
  isIdentityCategory,
} = require('../../constants/identityCategories');

const {
  IDENTITY_TRAIT_CATALOG,
  getTraitDefinition,
  listTraitDefinitions,
  assertCatalogIntegrity,
} = require('../../constants/identityTraitCatalog');

const {
  calculateTraitConfidence,
  calculateConnectionStrength,
  confidenceToRadialDistance,
} = require('../services/careerIdentity/traitConfidenceCalculator');

const {
  processUserEvidence,
  computeSourceFingerprint,
} = require('../services/careerIdentity/evidenceProcessor');

const {
  assembleTraits,
  buildConnections,
  assignGraphLayout,
  serializeProfile,
  localize,
} = require('../services/careerIdentity/identityEngine');

const {
  IDENTITY_PUZZLE_THRESHOLDS,
  IDENTITY_PUZZLE_LIMITS,
  classifyIdentityLayer,
  selectPuzzleTraits,
} = require('../../constants/identityPuzzleThresholds');

describe('identityCategories', () => {
  it('includes core flexible categories', () => {
    expect(IDENTITY_CATEGORIES).toContain('values');
    expect(IDENTITY_CATEGORIES).toContain('thinking_style');
    expect(isIdentityCategory('work_style')).toBe(true);
    expect(isIdentityCategory('career')).toBe(false);
  });
});

describe('identityTraitCatalog', () => {
  it('passes integrity checks', () => {
    expect(() => assertCatalogIntegrity()).not.toThrow();
  });

  it('has unique trait ids and known categories', () => {
    const ids = listTraitDefinitions().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const trait of IDENTITY_TRAIT_CATALOG) {
      expect(isIdentityCategory(trait.category)).toBe(true);
    }
  });

  it('resolves trait definitions by id', () => {
    const helping = getTraitDefinition('helping_others');
    expect(helping).toBeTruthy();
    expect(helping.name.en).toMatch(/Helping/i);
    expect(getTraitDefinition('not_a_trait')).toBeNull();
  });

  it('never treats careers as trait nodes', () => {
    const careerLike = IDENTITY_TRAIT_CATALOG.filter((t) =>
      /nurse|firefighter|architect|engineer|doctor/i.test(t.id)
    );
    expect(careerLike).toHaveLength(0);
  });
});

describe('traitConfidenceCalculator', () => {
  it('returns 0 for empty evidence', () => {
    expect(calculateTraitConfidence([])).toBe(0);
  });

  it('grows with evidence but never reaches 100%', () => {
    const weak = calculateTraitConfidence([
      { sourceType: 'reflection', weight: 0.4, matchStrength: 0.4 },
    ]);
    const strong = calculateTraitConfidence([
      { sourceType: 'reflection', weight: 0.9, matchStrength: 0.9 },
      { sourceType: 'career', weight: 0.8, matchStrength: 0.85 },
      { sourceType: 'simulation', weight: 0.7, matchStrength: 0.8 },
    ]);
    expect(weak).toBeGreaterThan(0);
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeLessThan(1);
    expect(strong).toBeLessThanOrEqual(0.94);
  });

  it('maps high confidence toward the center', () => {
    expect(confidenceToRadialDistance(0.9)).toBeLessThan(confidenceToRadialDistance(0.2));
  });

  it('strengthens connections as both traits grow', () => {
    const weak = calculateConnectionStrength(0.2, 0.2);
    const strong = calculateConnectionStrength(0.8, 0.8);
    expect(strong).toBeGreaterThan(weak);
  });
});

describe('evidenceProcessor', () => {
  it('extracts reflection evidence with explanations', async () => {
    const user = {
      _id: 'user1',
      updatedAt: new Date('2026-01-10'),
      profile: {
        userIdentityAnswers: {
          workEnjoyMost: 'I enjoy helping patients and teamwork in healthcare',
          topicsIndustriesInterest: '',
          naturallyGoodAt: '',
          workEnvironmentFit: '',
          workingLifeAchievement: 'I want to make an impact on society',
        },
      },
      lastSimulationResult: {
        _id: 'sim1',
        evaluationFlow: {
          kept: [{ id: 'r1', title: { en: 'Firefighter' }, description: { en: 'Helping others under pressure in a team' } }],
        },
      },
    };

    const { evidenceByTrait } = await processUserEvidence(user, {
      discoverTraitsFromText: async (text) => {
        const scores = new Map();
        const lower = text.toLowerCase();
        if (lower.includes('help')) scores.set('helping_others', 0.85);
        if (lower.includes('team')) scores.set('teamwork', 0.75);
        if (lower.includes('impact')) scores.set('making_impact', 0.7);
        return scores;
      },
    });
    expect(evidenceByTrait.size).toBeGreaterThan(0);

    const helping = evidenceByTrait.get('helping_others') || [];
    expect(helping.length).toBeGreaterThan(0);
    expect(helping[0].explanation.en).toMatch(/fittingly:|"|help/i);
    expect(helping[0].explanation.en.toLowerCase()).toContain('help');
    expect(helping[0].sourceType).toMatch(/reflection|simulation/);

    // Careers appear as evidence sources, not trait ids
    expect(evidenceByTrait.has('firefighter')).toBe(false);

    const simulationEvidence = helping.filter((e) => e.sourceType === 'simulation');
    expect(simulationEvidence.length).toBeGreaterThan(0);
  });

  it('does not duplicate identity narrative content already present in reflections', async () => {
    const { collectReflectionEvidence } = require('../services/careerIdentity/evidenceSources');

    const user = {
      updatedAt: new Date('2026-01-10'),
      profile: {
        userIdentityAnswers: {
          workEnvironmentFit: 'Herausforderungen meistern und komplexe Probleme lösen',
        },
        who_are_you: {
          raw_answers: ['', '', '', 'Herausforderungen meistern und komplexe Probleme lösen', ''],
          summary_text: {
            en: JSON.stringify(['', '', '', 'Herausforderungen meistern und komplexe Probleme lösen', '']),
            de: JSON.stringify(['', '', '', 'Herausforderungen meistern und komplexe Probleme lösen', '']),
          },
          identity_embedding_text: 'Someone who thrives on Herausforderungen in complex settings',
        },
      },
    };

    const items = collectReflectionEvidence(user);
    const texts = items.map((item) => item.text.toLowerCase());

    // Reflection answer is kept
    expect(texts.some((t) => t.includes('herausforderungen meistern'))).toBe(true);
    // Exact narrative copy / fragment is not added again under the same question
    const whoItems = items.filter((item) =>
      String(item.toEvidence('complex_problem_solving', 0.8).sourceId || '').startsWith(
        'identity:who_are_you'
      )
    );
    expect(whoItems.every((item) => !/^herausforderungen$/i.test(item.text.trim()))).toBe(true);
    expect(
      whoItems.every((item) => !/herausforderungen meistern und komplexe probleme lösen/i.test(item.text))
    ).toBe(true);
  });

  it('uses profile page titles for reflection and structured evidence labels', async () => {
    const {
      collectReflectionEvidence,
      collectStructuredProfileEvidence,
    } = require('../services/careerIdentity/evidenceSources');

    const reflectionItems = collectReflectionEvidence({
      updatedAt: new Date('2026-01-10'),
      profile: {
        userIdentityAnswers: {
          workEnjoyMost: 'Lösungen im Team entwickeln',
        },
      },
    });
    const reflectionLabel = reflectionItems[0].toEvidence('teamwork', 0.8).label;
    expect(reflectionLabel.de).toBe('Welche Arbeitstätigkeiten führst du am liebsten aus?');
    expect(reflectionLabel.en).toBe('What kind of work do you enjoy doing most?');

    const profileItems = collectStructuredProfileEvidence({
      updatedAt: new Date('2026-01-10'),
      profile: {
        structuredUserInfo: {
          skillsInDevelopment: { raw_items: ['UX prototyping'] },
        },
      },
    });
    const profileLabel = profileItems[0].toEvidence('creativity', 0.8).label;
    expect(profileLabel.de).toBe('Deine Lernziele');
    expect(profileLabel.en).toBe('Your learning goals');
  });

  it('changes fingerprint when profile answers change', () => {
    const base = {
      profile: {
        userIdentityAnswers: { workEnjoyMost: 'a' },
        documents: [],
      },
    };
    const changed = {
      ...base,
      profile: {
        ...base.profile,
        userIdentityAnswers: { workEnjoyMost: 'b' },
      },
    };
    expect(computeSourceFingerprint(base)).not.toBe(computeSourceFingerprint(changed));
  });
});

describe('identity engine cache invalidation', () => {
  const {
    shouldReuseCachedIdentity,
    computeIdentityEngineFingerprint,
  } = require('../services/careerIdentity/identityEngineFingerprint');

  it('does not reuse a profile when engine fingerprint is missing (pre-deploy cache)', () => {
    const engineFp = computeIdentityEngineFingerprint();
    const legacyProfile = {
      sourceFingerprint: 'same-user-sources',
      engineFingerprint: '',
      traits: [{ traitId: 'helping_others' }],
    };
    expect(shouldReuseCachedIdentity(legacyProfile, 'same-user-sources', engineFp)).toBe(
      false
    );
  });
});

describe('identity puzzle layers', () => {
  it('classifies confidence 0.6 as confirmed', () => {
    expect(classifyIdentityLayer(0.6)).toBe('confirmed');
    expect(classifyIdentityLayer(IDENTITY_PUZZLE_THRESHOLDS.confirmed)).toBe('confirmed');
  });

  it('classifies confidence 0.3 as emerging', () => {
    expect(classifyIdentityLayer(0.3)).toBe('emerging');
    expect(classifyIdentityLayer(IDENTITY_PUZZLE_THRESHOLDS.emerging)).toBe('emerging');
  });

  it('excludes confidence 0.1 from the puzzle', () => {
    expect(classifyIdentityLayer(0.1)).toBeNull();
  });

  it('moves a piece from emerging to confirmed as evidence grows', () => {
    const emergingEvidence = [
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

    const emergingTraits = assembleTraits(new Map([['helping_others', emergingEvidence]]));
    expect(emergingTraits).toHaveLength(1);
    expect(emergingTraits[0].layer).toBe('emerging');
    expect(emergingTraits[0].confidence).toBeGreaterThanOrEqual(
      IDENTITY_PUZZLE_THRESHOLDS.emerging
    );
    expect(emergingTraits[0].confidence).toBeLessThan(IDENTITY_PUZZLE_THRESHOLDS.confirmed);

    const confirmedEvidence = [
      ...emergingEvidence,
      {
        evidenceId: 'e4',
        sourceType: 'cv',
        sourceId: 'doc:1',
        weight: 0.85,
        matchStrength: 0.9,
        timestamp: new Date(),
        explanation: { en: 'From your CV', de: 'Aus deinem Lebenslauf' },
        label: { en: 'CV', de: 'Lebenslauf' },
      },
      {
        evidenceId: 'e5',
        sourceType: 'profile',
        sourceId: 'skills:1',
        weight: 0.85,
        matchStrength: 0.9,
        timestamp: new Date(),
        explanation: { en: 'From your profile', de: 'Aus deinem Profil' },
        label: { en: 'Profile', de: 'Profil' },
      },
    ];

    const confirmedTraits = assembleTraits(new Map([['helping_others', confirmedEvidence]]));
    expect(confirmedTraits).toHaveLength(1);
    expect(confirmedTraits[0].layer).toBe('confirmed');
    expect(confirmedTraits[0].confidence).toBeGreaterThanOrEqual(
      IDENTITY_PUZZLE_THRESHOLDS.confirmed
    );
  });

  it('keeps layer classification when serializing a cached CareerIdentityProfile', () => {
    const cachedProfile = {
      _id: 'profile1',
      userId: 'user1',
      lastRefreshedAt: new Date('2026-07-01'),
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
              timestamp: new Date('2026-07-01'),
              explanation: { en: 'You enjoy helping', de: 'Du hilfst gern' },
              label: { en: 'Reflection', de: 'Reflexion' },
            },
          ],
          lastUpdated: new Date('2026-07-01'),
        },
        {
          traitId: 'teamwork',
          category: 'social_orientation',
          confidence: 0.45,
          layer: 'emerging',
          evidenceCount: 1,
          evidence: [
            {
              evidenceId: 'e2',
              sourceType: 'career',
              sourceId: 'saved:s1',
              weight: 0.7,
              timestamp: new Date('2026-07-01'),
              explanation: { en: 'Team-oriented role', de: 'Teamorientierte Rolle' },
              label: { en: 'Saved career', de: 'Gespeicherte Karriere' },
            },
          ],
          lastUpdated: new Date('2026-07-01'),
        },
        {
          traitId: 'creativity',
          category: 'thinking_style',
          confidence: 0.1,
          layer: 'emerging',
          evidenceCount: 1,
          evidence: [
            {
              evidenceId: 'e3',
              sourceType: 'reflection',
              sourceId: 'identity:topics',
              weight: 0.3,
              timestamp: new Date('2026-07-01'),
              explanation: { en: 'Weak signal', de: 'Schwaches Signal' },
              label: { en: 'Reflection', de: 'Reflexion' },
            },
          ],
          lastUpdated: new Date('2026-07-01'),
        },
      ],
      connections: [
        { fromTraitId: 'helping_others', toTraitId: 'teamwork', strength: 0.4 },
        { fromTraitId: 'helping_others', toTraitId: 'creativity', strength: 0.2 },
      ],
    };

    const serialized = serializeProfile(cachedProfile, 'en');
    const byId = Object.fromEntries(serialized.nodes.map((n) => [n.id, n]));

    expect(byId.helping_others.layer).toBe('confirmed');
    expect(byId.helping_others.statusMessage).toMatch(/clear part of your career identity/i);
    expect(byId.teamwork.layer).toBe('emerging');
    expect(byId.teamwork.statusMessage).toMatch(/starting to appear/i);
    expect(byId.creativity).toBeUndefined();

    expect(serialized.connections.every((c) => c.fromTraitId !== 'creativity' && c.toTraitId !== 'creativity')).toBe(
      true
    );
    expect(serialized.nodes.every((n) => n.evidence.length > 0)).toBe(true);
  });

  it('excludes low-confidence traits from assembleTraits', () => {
    const traits = assembleTraits(
      new Map([
        [
          'helping_others',
          [
            {
              evidenceId: 'weak',
              sourceType: 'reflection',
              sourceId: 'identity:workEnjoyMost',
              weight: 0.4,
              matchStrength: 0.35,
              timestamp: new Date(),
              explanation: { en: 'Weak', de: 'Schwach' },
              label: { en: 'Reflection', de: 'Reflexion' },
            },
          ],
        ],
      ])
    );
    expect(traits).toHaveLength(0);
  });

  it('caps confirmed and emerging layers, then total by confidence', () => {
    const { maxPerLayer, maxTotal } = IDENTITY_PUZZLE_LIMITS;
    const many = [];
    for (let i = 0; i < 20; i += 1) {
      many.push({
        traitId: `confirmed_${i}`,
        layer: 'confirmed',
        confidence: 0.95 - i * 0.01,
      });
      many.push({
        traitId: `emerging_${i}`,
        layer: 'emerging',
        confidence: 0.55 - i * 0.01,
      });
    }

    const selected = selectPuzzleTraits(many);
    const confirmedCount = selected.filter((t) => t.layer === 'confirmed').length;
    const emergingCount = selected.filter((t) => t.layer === 'emerging').length;
    const ids = new Set(selected.map((t) => t.traitId));

    expect(confirmedCount).toBeLessThanOrEqual(maxPerLayer);
    expect(emergingCount).toBeLessThanOrEqual(maxPerLayer);
    expect(selected.length).toBe(maxTotal);
    expect(confirmedCount).toBe(maxPerLayer);
    expect(emergingCount).toBe(maxTotal - maxPerLayer);

    expect(ids.has('confirmed_0')).toBe(true);
    expect(ids.has('confirmed_14')).toBe(true);
    expect(ids.has('confirmed_15')).toBe(false);
    expect(ids.has('emerging_0')).toBe(true);
    expect(ids.has('emerging_9')).toBe(true);
    expect(ids.has('emerging_10')).toBe(false);
    expect(ids.has('emerging_19')).toBe(false);
  });
});

describe('identityEngine assembly', () => {
  it('assembles traits with derived confidence, layer, and connections', () => {
    const evidenceByTrait = new Map([
      [
        'helping_others',
        [
          {
            evidenceId: 'e1',
            sourceType: 'reflection',
            sourceId: 'identity:workEnjoyMost',
            weight: 0.75,
            matchStrength: 0.7,
            timestamp: new Date(),
            explanation: { en: 'Because you said so', de: 'Weil du es gesagt hast' },
            label: { en: 'Reflection', de: 'Reflexion' },
          },
          {
            evidenceId: 'e1b',
            sourceType: 'career',
            sourceId: 'saved:s1',
            weight: 0.8,
            matchStrength: 0.72,
            timestamp: new Date(),
            explanation: { en: 'From exploring a helping role', de: 'Aus einer helfenden Rolle' },
            label: { en: 'Saved career', de: 'Gespeicherte Karriere' },
          },
          {
            evidenceId: 'e1c',
            sourceType: 'simulation',
            sourceId: 'sim:1',
            weight: 0.78,
            matchStrength: 0.68,
            timestamp: new Date(),
            explanation: { en: 'From simulation', de: 'Aus Simulation' },
            label: { en: 'Simulation', de: 'Simulation' },
          },
        ],
      ],
      [
        'teamwork',
        [
          {
            evidenceId: 'e2',
            sourceType: 'career',
            sourceId: 'saved:s1',
            weight: 0.8,
            matchStrength: 0.72,
            timestamp: new Date(),
            explanation: { en: 'From exploring a team role', de: 'Aus einer Teamrolle' },
            label: { en: 'Saved career', de: 'Gespeicherte Karriere' },
          },
          {
            evidenceId: 'e2b',
            sourceType: 'reflection',
            sourceId: 'identity:workEnjoyMost',
            weight: 0.75,
            matchStrength: 0.7,
            timestamp: new Date(),
            explanation: { en: 'You enjoy teamwork', de: 'Du magst Teamarbeit' },
            label: { en: 'Reflection', de: 'Reflexion' },
          },
          {
            evidenceId: 'e2c',
            sourceType: 'cv',
            sourceId: 'doc:1',
            weight: 0.75,
            matchStrength: 0.7,
            timestamp: new Date(),
            explanation: { en: 'From your CV', de: 'Aus deinem Lebenslauf' },
            label: { en: 'CV', de: 'Lebenslauf' },
          },
        ],
      ],
    ]);

    const traits = assembleTraits(evidenceByTrait);
    expect(traits.length).toBe(2);
    expect(traits[0].confidence).toBeGreaterThan(0);
    expect(traits[0].evidenceCount).toBeGreaterThan(0);
    expect(['confirmed', 'emerging']).toContain(traits[0].layer);
    expect(['confirmed', 'emerging']).toContain(traits[1].layer);

    const connections = buildConnections(traits);
    expect(connections.some((c) => c.fromTraitId === 'helping_others' || c.toTraitId === 'helping_others')).toBe(
      true
    );

    const laidOut = assignGraphLayout(traits);
    expect(laidOut[0].position).toBeTruthy();
    expect(typeof laidOut[0].position.x).toBe('number');

    const crowded = Array.from({ length: 12 }, (_, i) => ({
      traitId: `trait_${i}`,
      layer: i % 2 === 0 ? 'confirmed' : 'emerging',
      confidence: 0.5 + (i % 3) * 0.1,
    }));
    const crowdedLayout = assignGraphLayout(crowded);
    for (let i = 0; i < crowdedLayout.length; i += 1) {
      for (let j = i + 1; j < crowdedLayout.length; j += 1) {
        const a = crowdedLayout[i].position;
        const b = crowdedLayout[j].position;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        expect(dist).toBeGreaterThan(0.2);
      }
    }
  });

  it('localizes bilingual strings', () => {
    expect(localize({ en: 'Hello', de: 'Hallo' }, 'de')).toBe('Hallo');
    expect(localize({ en: 'Hello', de: 'Hallo' }, 'en')).toBe('Hello');
  });
});
