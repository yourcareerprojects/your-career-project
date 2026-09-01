/**
 * Unit tests for Career Puzzle seed mappings, spine tip, and path ordering.
 * Pure logic — no MongoDB.
 */

const {
  mapHighestDegreeToPieceKey,
  mapExperienceToPieceKey,
  DEFAULT_EDUCATION_PIECE_KEY,
  DEFAULT_EXPERIENCE_PIECE_KEY,
} = require('../../constants/puzzleSeedMappings');

const {
  getPathTip,
  orderSpineNodes,
  reorderPathNodesByLockedEndDate,
  lockedEndDateSortKey,
} = require('../services/careerPuzzle/puzzleSeedService');

const {
  countUserAddedSteps,
  isAtUserStepLimit,
  MAX_USER_PATH_STEPS,
} = require('../services/careerPuzzle/puzzleGraphService');

const { SEED_PIECES, SEED_EDGES } = require('../services/careerPuzzle/dachSeedData');
const { PUZZLE_CATEGORIES, isPuzzleCategory } = require('../../constants/puzzleCategories');

describe('puzzleSeedMappings', () => {
  it('maps realschulabschluss to education piece key', () => {
    expect(mapHighestDegreeToPieceKey('realschulabschluss')).toBe(
      'edu.realschulabschluss'
    );
  });

  it('maps empty experience to exp.none', () => {
    expect(mapExperienceToPieceKey('')).toBe('exp.none');
    expect(mapExperienceToPieceKey(undefined)).toBe(DEFAULT_EXPERIENCE_PIECE_KEY);
  });

  it('falls back for unknown degree', () => {
    expect(mapHighestDegreeToPieceKey('unknown_degree')).toBe(
      DEFAULT_EDUCATION_PIECE_KEY
    );
  });
});

describe('puzzleCategories', () => {
  it('includes the five umbrella categories', () => {
    expect(PUZZLE_CATEGORIES).toEqual([
      'school',
      'apprenticeship',
      'university',
      'further_education',
      'occupation',
    ]);
    expect(isPuzzleCategory('university')).toBe(true);
    expect(isPuzzleCategory('promotion')).toBe(false);
    expect(isPuzzleCategory('not-a-category')).toBe(false);
  });

  it('normalizes legacy category slugs', () => {
    const { normalizePuzzleCategory } = require('../../constants/puzzleCategories');
    expect(normalizePuzzleCategory('vocational_school')).toBe('school');
    expect(normalizePuzzleCategory('high_school')).toBe('school');
    expect(normalizePuzzleCategory('technical_college')).toBe('school');
    expect(normalizePuzzleCategory('certification')).toBe('further_education');
    expect(normalizePuzzleCategory('promotion')).toBe('occupation');
    expect(normalizePuzzleCategory('career_change')).toBe('occupation');
    expect(normalizePuzzleCategory('specialization')).toBe('occupation');
    expect(normalizePuzzleCategory('apprenticeship')).toBe('apprenticeship');
  });

  it('maps tip stage to allowed next-step categories', () => {
    const { getAllowedNextCategories } = require('../../constants/puzzleCategories');
    expect(getAllowedNextCategories('school')).toEqual([
      'school',
      'apprenticeship',
      'university',
    ]);
    expect(getAllowedNextCategories('university')).toEqual([
      'university',
      'occupation',
      'further_education',
    ]);
    expect(getAllowedNextCategories('apprenticeship')).toEqual([
      'apprenticeship',
      'occupation',
      'further_education',
      'university',
    ]);
    expect(getAllowedNextCategories('occupation')).toEqual([
      'occupation',
      'further_education',
      'university',
    ]);
    expect(getAllowedNextCategories('further_education')).toEqual([
      'further_education',
      'occupation',
      'university',
    ]);
  });

  it('falls back to all categories for unknown tip stages', () => {
    const {
      getAllowedNextCategories,
      PUZZLE_CATEGORIES,
    } = require('../../constants/puzzleCategories');
    expect(getAllowedNextCategories('')).toEqual([...PUZZLE_CATEGORIES]);
    expect(getAllowedNextCategories('not-a-stage')).toEqual([...PUZZLE_CATEGORIES]);
    expect(getAllowedNextCategories('promotion')).toEqual([
      'occupation',
      'further_education',
      'university',
    ]);
  });

  it('resolves display category from snapshot over piece', () => {
    const { getNodeDisplayCategory } = require('../../constants/puzzleCategories');
    expect(
      getNodeDisplayCategory({
        snapshot: { category: 'university' },
        piece: { category: 'school' },
      })
    ).toBe('university');
    expect(
      getNodeDisplayCategory({
        snapshot: { category: 'certification' },
        piece: { category: 'school' },
      })
    ).toBe('further_education');
    expect(getNodeDisplayCategory({ piece: { category: 'apprenticeship' } })).toBe(
      'apprenticeship'
    );
  });

  it('uses education stage for narrative exp.none tips until the tip category is edited', () => {
    const {
      resolveNextStepStageCategory,
    } = require('../../constants/puzzleCategories');
    const tip = {
      instanceId: 'exp',
      pieceKey: 'exp.none',
      snapshot: { category: 'occupation' },
    };
    const education = {
      instanceId: 'edu',
      pieceKey: 'edu.abitur',
      snapshot: { category: 'school' },
    };
    expect(resolveNextStepStageCategory(tip, education)).toBe('school');

    // Editing the locked education snapshot adapts the stage
    expect(
      resolveNextStepStageCategory(tip, {
        ...education,
        snapshot: { category: 'university' },
      })
    ).toBe('university');

    // Editing the tip category away from occupation uses the tip
    expect(
      resolveNextStepStageCategory(
        { ...tip, snapshot: { category: 'apprenticeship' } },
        education
      )
    ).toBe('apprenticeship');

    // Real experience tips keep occupation even when graphFrom is education
    expect(
      resolveNextStepStageCategory(
        {
          instanceId: 'exp',
          pieceKey: 'exp.entry_level',
          snapshot: { category: 'occupation' },
        },
        education
      )
    ).toBe('occupation');
  });

  it('resolves path stage from tip display category (edited locked Realschule)', () => {
    const {
      resolveStageCategoryForPath,
    } = require('../services/careerPuzzle/puzzleSeedService');
    const { getAllowedNextCategories } = require('../../constants/puzzleCategories');
    const path = {
      nodes: [
        {
          instanceId: 'job',
          parentInstanceId: null,
          pieceKey: 'exp.intern',
          locked: true,
          snapshot: { category: 'occupation', endDate: { month: 2, year: 2026 } },
        },
        {
          instanceId: 'school',
          parentInstanceId: 'job',
          pieceKey: 'edu.bachelors',
          locked: true,
          snapshot: { category: 'school', endDate: { month: 6, year: 2027 } },
        },
      ],
    };
    const tip = path.nodes[1];
    expect(resolveStageCategoryForPath(path, tip)).toBe('school');
    expect(getAllowedNextCategories('school')).toEqual([
      'school',
      'apprenticeship',
      'university',
    ]);
  });

  it('filters next-step options to categories allowed for the stage', () => {
    const {
      filterStepsByAllowedCategories,
      getAllowedNextCategories,
    } = require('../../constants/puzzleCategories');
    const steps = [
      { piece: { id: '1', category: 'school' } },
      { piece: { id: '2', category: 'apprenticeship' } },
      { piece: { id: '3', category: 'occupation' } },
      { piece: { id: '4', category: 'university' } },
    ];
    const allowed = getAllowedNextCategories('school');
    expect(
      filterStepsByAllowedCategories(steps, allowed).map((s) => s.piece.id)
    ).toEqual(['1', '2', '4']);
  });

  it('preselects the most suitable forward category for a tip stage', () => {
    const { getPreferredNextCategory } = require('../../constants/puzzleCategories');
    expect(
      getPreferredNextCategory('school', ['school', 'apprenticeship', 'university'])
    ).toBe('apprenticeship');
    expect(
      getPreferredNextCategory('university', [
        'university',
        'occupation',
        'further_education',
      ])
    ).toBe('occupation');
    expect(
      getPreferredNextCategory('apprenticeship', [
        'apprenticeship',
        'occupation',
        'further_education',
      ])
    ).toBe('occupation');
    expect(
      getPreferredNextCategory('occupation', [
        'occupation',
        'further_education',
        'university',
      ])
    ).toBe('occupation');
    expect(getPreferredNextCategory('school', ['school'])).toBe('school');
    expect(getPreferredNextCategory('school', [])).toBe(null);
  });
});

describe('locked profile step limits', () => {
  const {
    MAX_LOCKED_PROFILE_STEPS,
    MIN_LOCKED_PROFILE_STEPS,
    countLockedProfileSteps,
    isAtLockedProfileStepLimit,
    canRemoveLockedProfileStep,
  } = require('../services/careerPuzzle/puzzleGraphService');

  it('caps locked profile steps at five', () => {
    expect(MAX_LOCKED_PROFILE_STEPS).toBe(5);
    const path = {
      nodes: [
        { locked: true },
        { locked: true },
        { locked: true },
        { locked: true },
        { locked: true },
        { locked: false },
      ],
    };
    expect(countLockedProfileSteps(path)).toBe(5);
    expect(isAtLockedProfileStepLimit(path)).toBe(true);
  });

  it('allows deleting locked steps only above the minimum of two', () => {
    expect(MIN_LOCKED_PROFILE_STEPS).toBe(2);
    expect(
      canRemoveLockedProfileStep({
        nodes: [{ locked: true }, { locked: true }],
      })
    ).toBe(false);
    expect(
      canRemoveLockedProfileStep({
        nodes: [{ locked: true }, { locked: true }, { locked: true }],
      })
    ).toBe(true);
  });
});

describe('dachSeedData integrity', () => {
  it('has unique piece keys', () => {
    const keys = SEED_PIECES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('edges reference existing piece keys', () => {
    const keySet = new Set(SEED_PIECES.map((p) => p.key));
    for (const edge of SEED_EDGES) {
      expect(keySet.has(edge.fromKey)).toBe(true);
      expect(keySet.has(edge.toKey)).toBe(true);
    }
  });

  it('every seed piece uses a registered category', () => {
    for (const piece of SEED_PIECES) {
      expect(isPuzzleCategory(piece.category)).toBe(true);
    }
  });
});

describe('getPathTip / orderSpineNodes', () => {
  const path = {
    nodes: [
      {
        instanceId: 'a',
        parentInstanceId: null,
        pieceKey: 'edu.realschulabschluss',
        locked: true,
        addedAt: new Date('2026-01-01'),
      },
      {
        instanceId: 'b',
        parentInstanceId: 'a',
        pieceKey: 'exp.none',
        locked: true,
        addedAt: new Date('2026-01-02'),
      },
      {
        instanceId: 'c',
        parentInstanceId: 'b',
        pieceKey: 'appr.electrician',
        locked: false,
        addedAt: new Date('2026-01-03'),
      },
    ],
  };

  it('returns the leaf as tip', () => {
    expect(getPathTip(path).instanceId).toBe('c');
  });

  it('orders spine from root to tip', () => {
    expect(orderSpineNodes(path).map((n) => n.instanceId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('reorderPathNodesByLockedEndDate', () => {
  it('orders locked steps by end date and puts undated locked steps last before future steps', () => {
    const path = {
      nodes: [
        {
          instanceId: 'edu',
          parentInstanceId: null,
          locked: true,
          addedAt: new Date('2026-01-01'),
          snapshot: { endDate: null },
        },
        {
          instanceId: 'exp',
          parentInstanceId: 'edu',
          locked: true,
          addedAt: new Date('2026-01-02'),
          snapshot: { endDate: null },
        },
        {
          instanceId: 'job-late',
          parentInstanceId: 'exp',
          locked: true,
          addedAt: new Date('2026-01-04'),
          snapshot: { endDate: { month: 6, year: 2024 } },
        },
        {
          instanceId: 'job-early',
          parentInstanceId: 'job-late',
          locked: true,
          addedAt: new Date('2026-01-05'),
          snapshot: { endDate: { month: 3, year: 2022 } },
        },
        {
          instanceId: 'future',
          parentInstanceId: 'job-early',
          locked: false,
          addedAt: new Date('2026-01-06'),
          snapshot: {},
        },
      ],
    };

    expect(reorderPathNodesByLockedEndDate(path)).toBe(true);
    expect(orderSpineNodes(path).map((n) => n.instanceId)).toEqual([
      'job-early',
      'job-late',
      'edu',
      'exp',
      'future',
    ]);
    expect(lockedEndDateSortKey({ snapshot: { endDate: { month: 3, year: 2022 } } })).toBe(
      2022 * 12 + 3
    );
    expect(lockedEndDateSortKey({ snapshot: { endDate: null } })).toBe(
      Number.POSITIVE_INFINITY
    );
  });
});

describe('user step limit', () => {
  it('counts only unlocked user-added steps', () => {
    const path = {
      nodes: [
        { locked: true },
        { locked: true },
        { locked: false },
        { locked: false },
      ],
    };
    expect(countUserAddedSteps(path)).toBe(2);
    expect(isAtUserStepLimit(path)).toBe(false);
  });

  it(`is at limit when ${MAX_USER_PATH_STEPS} user steps are present`, () => {
    const path = {
      nodes: [
        { locked: true },
        { locked: true },
        { locked: false },
        { locked: false },
        { locked: false },
      ],
    };
    expect(countUserAddedSteps(path)).toBe(MAX_USER_PATH_STEPS);
    expect(isAtUserStepLimit(path)).toBe(true);
  });
});
