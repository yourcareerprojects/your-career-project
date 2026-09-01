const CareerPuzzle = require('../../models/CareerPuzzle');
const PuzzlePiece = require('../../models/PuzzlePiece');
const PuzzleEdge = require('../../models/PuzzleEdge');
const { SEED_PIECES, SEED_EDGES, CATALOG_VERSION } = require('./dachSeedData');
const {
  LEGACY_PUZZLE_CATEGORY_MAP,
  normalizePuzzleCategory,
  isPuzzleCategory,
} = require('../../../constants/puzzleCategories');

const LEGACY_CATEGORY_VALUES = Object.keys(LEGACY_PUZZLE_CATEGORY_MAP).filter(
  (key) => LEGACY_PUZZLE_CATEGORY_MAP[key] !== key
);

/**
 * Remap legacy category slugs on catalog pieces and user path snapshots.
 */
async function migrateLegacyPuzzleCategories() {
  for (const legacy of LEGACY_CATEGORY_VALUES) {
    const canonical = LEGACY_PUZZLE_CATEGORY_MAP[legacy];
    if (!canonical || !isPuzzleCategory(canonical)) continue;
    await PuzzlePiece.updateMany(
      { category: legacy },
      { $set: { category: canonical } }
    );
  }

  const puzzles = await CareerPuzzle.find({
    'paths.nodes.snapshot.category': { $in: LEGACY_CATEGORY_VALUES },
  }).select('_id paths');

  for (const puzzle of puzzles) {
    let dirty = false;
    for (const path of puzzle.paths || []) {
      for (const node of path.nodes || []) {
        const current = node.snapshot?.category;
        const normalized = normalizePuzzleCategory(current);
        if (normalized && normalized !== current) {
          node.snapshot.category = normalized;
          dirty = true;
        }
      }
    }
    if (dirty) {
      puzzle.markModified('paths');
      await puzzle.save();
    }
  }
}

/**
 * Upsert curated DACH puzzle pieces and edges.
 * Safe to run on every app boot / explicitly via script.
 * @returns {Promise<{ piecesUpserted: number, edgesUpserted: number, keyToId: Map<string, import('mongoose').Types.ObjectId> }>}
 */
async function ensurePuzzleCatalogSeeded() {
  await migrateLegacyPuzzleCategories();

  const keyToId = new Map();
  let piecesUpserted = 0;

  for (const seed of SEED_PIECES) {
    const doc = await PuzzlePiece.findOneAndUpdate(
      { key: seed.key },
      {
        $set: {
          key: seed.key,
          category: seed.category,
          title: seed.title,
          shortDescription: seed.shortDescription || { en: '', de: null },
          localeScope: seed.localeScope || ['de'],
          tags: seed.tags || [],
          visual: seed.visual || {},
          status: 'active',
          version: CATALOG_VERSION,
          metadata: seed.metadata || {},
          ...(seed.escoId != null ? { escoId: seed.escoId } : {}),
          ...(seed.careerPathId != null ? { careerPathId: seed.careerPathId } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    keyToId.set(seed.key, doc._id);
    piecesUpserted += 1;
  }

  let edgesUpserted = 0;
  for (const edge of SEED_EDGES) {
    const fromPieceId = keyToId.get(edge.fromKey);
    const toPieceId = keyToId.get(edge.toKey);
    if (!fromPieceId || !toPieceId) {
      console.warn(
        `[careerPuzzle] Skipping edge ${edge.fromKey} → ${edge.toKey}: missing piece`
      );
      continue;
    }
    await PuzzleEdge.findOneAndUpdate(
      {
        fromPieceId,
        toPieceId,
        relationType: edge.relationType || 'progresses_to',
      },
      {
        $set: {
          fromPieceId,
          toPieceId,
          relationType: edge.relationType || 'progresses_to',
          weight: edge.weight ?? 0,
          status: 'active',
          conditions: edge.conditions || { minDegreeKeys: [], minExperienceKeys: [] },
          metadata: {
            ...(edge.metadata || {}),
            source: 'curated',
            ruleId: null,
          },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    edgesUpserted += 1;
  }

  return { piecesUpserted, edgesUpserted, keyToId };
}

/** @type {Promise<ReturnType<typeof ensurePuzzleCatalogSeeded>> | null} */
let seedPromise = null;

/**
 * Ensure catalog is seeded at most once per process (concurrent-safe).
 */
function ensurePuzzleCatalogSeededOnce() {
  if (!seedPromise) {
    seedPromise = ensurePuzzleCatalogSeeded().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

module.exports = {
  ensurePuzzleCatalogSeeded,
  ensurePuzzleCatalogSeededOnce,
};
