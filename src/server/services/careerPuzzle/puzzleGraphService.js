const crypto = require('crypto');
const PuzzlePiece = require('../../models/PuzzlePiece');
const PuzzleEdge = require('../../models/PuzzleEdge');
const {
  PUZZLE_CATEGORIES,
  normalizePuzzleCategory,
} = require('../../../constants/puzzleCategories');

/** Max next steps shown per category in the Career Puzzle picker. */
const NEXT_STEPS_PER_CATEGORY = 3;

/** Max candidates fetched before per-category merge (categories × per-category cap). */
const NEXT_STEPS_FETCH_CEILING = PUZZLE_CATEGORIES.length * NEXT_STEPS_PER_CATEGORY;

/** @deprecated Use NEXT_STEPS_FETCH_CEILING — kept for callers that still import the old name. */
const NEXT_STEPS_HARD_CAP = NEXT_STEPS_FETCH_CEILING;

/** Max user-added (non-locked) pieces per path — plan 3 steps ahead. */
const MAX_USER_PATH_STEPS = 3;

/** Max locked profile / "from your profile" pieces per path. */
const MAX_LOCKED_PROFILE_STEPS = 5;

/** Minimum locked profile pieces that must remain on a path. */
const MIN_LOCKED_PROFILE_STEPS = 2;

/**
 * Count unlocked pieces the user added (excludes profile seed locks).
 * @param {{ nodes?: Array<{ locked?: boolean }> }} path
 */
function countUserAddedSteps(path) {
  return (path?.nodes || []).filter((n) => !n.locked).length;
}

/**
 * Count locked profile pieces on a path.
 * @param {{ nodes?: Array<{ locked?: boolean }> }} path
 */
function countLockedProfileSteps(path) {
  return (path?.nodes || []).filter((n) => n.locked).length;
}

/**
 * @param {{ nodes?: Array<{ locked?: boolean }> }} path
 */
function isAtUserStepLimit(path, limit = MAX_USER_PATH_STEPS) {
  return countUserAddedSteps(path) >= limit;
}

/**
 * @param {{ nodes?: Array<{ locked?: boolean }> }} path
 */
function isAtLockedProfileStepLimit(path, limit = MAX_LOCKED_PROFILE_STEPS) {
  return countLockedProfileSteps(path) >= limit;
}

/**
 * True when a locked profile step may be removed (more than the minimum remain).
 * @param {{ nodes?: Array<{ locked?: boolean }> }} path
 */
function canRemoveLockedProfileStep(path, min = MIN_LOCKED_PROFILE_STEPS) {
  return countLockedProfileSteps(path) > min;
}

/**
 * Edge is curated unless explicitly tagged as rule-generated.
 * @param {object} edge
 * @returns {'curated'|'rule'}
 */
function edgeSource(edge) {
  const raw = edge?.metadata?.source;
  return raw === 'rule' ? 'rule' : 'curated';
}

/**
 * @param {import('mongoose').Types.ObjectId|string} fromPieceId
 * @param {{
 *   excludePieceIds?: Array<string|import('mongoose').Types.ObjectId>,
 *   limit?: number,
 *   source?: 'curated'|'rule'|'any',
 * }} [options]
 */
async function getSuccessors(fromPieceId, options = {}) {
  const { excludePieceIds = [], limit = 50, source = 'any' } = options;
  if (!fromPieceId) return [];

  const query = {
    fromPieceId,
    status: 'active',
  };
  if (source === 'curated') {
    query.$or = [
      { 'metadata.source': { $exists: false } },
      { 'metadata.source': null },
      { 'metadata.source': 'curated' },
    ];
  } else if (source === 'rule') {
    query['metadata.source'] = 'rule';
  }

  const edges = await PuzzleEdge.find(query)
    .sort({ weight: -1 })
    .limit(Math.max(1, Math.min(limit, 100)))
    .lean();

  if (!edges.length) return [];

  const excludeSet = new Set(excludePieceIds.map((id) => String(id)));
  const toIds = edges
    .map((e) => e.toPieceId)
    .filter((id) => !excludeSet.has(String(id)));

  if (!toIds.length) return [];

  const pieces = await PuzzlePiece.find({
    _id: { $in: toIds },
    status: 'active',
  }).lean();

  const pieceById = new Map(pieces.map((p) => [String(p._id), p]));

  return edges
    .map((edge) => {
      const piece = pieceById.get(String(edge.toPieceId));
      if (!piece) return null;
      if (excludeSet.has(String(piece._id))) return null;
      const src = edgeSource(edge);
      return {
        piece: serializePiece(piece),
        edge: {
          id: String(edge._id),
          relationType: edge.relationType,
          weight: edge.weight,
          metadata: edge.metadata || {},
        },
        source: src,
        ruleId: src === 'rule' ? edge.metadata?.ruleId || null : null,
      };
    })
    .filter(Boolean);
}

/**
 * Merge curated then rule steps; hard-cap total length.
 * @param {Array} curatedSteps
 * @param {Array} ruleSteps
 * @param {number} [cap]
 */
function mergeNextSteps(curatedSteps, ruleSteps, cap = NEXT_STEPS_FETCH_CEILING) {
  const seen = new Set();
  const out = [];
  for (const step of [...(curatedSteps || []), ...(ruleSteps || [])]) {
    const id = String(step?.piece?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      ...step,
      source: step.source || edgeSource(step.edge),
      ruleId: step.ruleId ?? (step.source === 'rule' ? step.edge?.metadata?.ruleId : null) ?? null,
    });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Merge curated then rule steps, keeping at most `perCategoryCap` per category.
 * Preserves curated-before-rule order within each category via global iteration order.
 * @param {Array} curatedSteps
 * @param {Array} ruleSteps
 * @param {number} [perCategoryCap]
 */
function mergeNextStepsByCategory(
  curatedSteps,
  ruleSteps,
  perCategoryCap = NEXT_STEPS_PER_CATEGORY
) {
  const seen = new Set();
  const counts = Object.create(null);
  const out = [];
  const cap = Math.max(0, perCategoryCap);

  for (const step of [...(curatedSteps || []), ...(ruleSteps || [])]) {
    const id = String(step?.piece?.id || '');
    if (!id || seen.has(id)) continue;

    const category =
      normalizePuzzleCategory(step?.piece?.category) ||
      String(step?.piece?.category || '').trim();
    if (!category) continue;

    const used = counts[category] || 0;
    if (used >= cap) continue;

    seen.add(id);
    counts[category] = used + 1;
    out.push({
      ...step,
      piece: {
        ...step.piece,
        category,
      },
      source: step.source || edgeSource(step.edge),
      ruleId:
        step.ruleId ??
        (step.source === 'rule' ? step.edge?.metadata?.ruleId : null) ??
        null,
    });
  }

  return out;
}

/**
 * @param {import('mongoose').Types.ObjectId|string} fromPieceId
 * @param {import('mongoose').Types.ObjectId|string} toPieceId
 */
async function hasActiveEdge(fromPieceId, toPieceId) {
  if (!fromPieceId || !toPieceId) return false;
  const edge = await PuzzleEdge.findOne({
    fromPieceId,
    toPieceId,
    status: 'active',
  })
    .select('_id')
    .lean();
  return Boolean(edge);
}

/**
 * Count outgoing active edges (used to decide education fallback for exp.* tips).
 */
async function countOutgoingEdges(fromPieceId) {
  if (!fromPieceId) return 0;
  return PuzzleEdge.countDocuments({ fromPieceId, status: 'active' });
}

function serializePiece(piece) {
  if (!piece) return null;
  return {
    id: String(piece._id),
    key: piece.key,
    category: normalizePuzzleCategory(piece.category) || piece.category,
    title: piece.title,
    shortDescription: piece.shortDescription,
    localeScope: piece.localeScope,
    careerPathId: piece.careerPathId ? String(piece.careerPathId) : null,
    escoId: piece.escoId || null,
    tags: piece.tags || [],
    visual: piece.visual || {},
    status: piece.status,
    metadata: piece.metadata || {},
  };
}

function newId() {
  return crypto.randomUUID();
}

module.exports = {
  NEXT_STEPS_PER_CATEGORY,
  NEXT_STEPS_FETCH_CEILING,
  NEXT_STEPS_HARD_CAP,
  MAX_USER_PATH_STEPS,
  MAX_LOCKED_PROFILE_STEPS,
  MIN_LOCKED_PROFILE_STEPS,
  countUserAddedSteps,
  countLockedProfileSteps,
  isAtUserStepLimit,
  isAtLockedProfileStepLimit,
  canRemoveLockedProfileStep,
  edgeSource,
  getSuccessors,
  mergeNextSteps,
  mergeNextStepsByCategory,
  hasActiveEdge,
  countOutgoingEdges,
  serializePiece,
  newId,
};
