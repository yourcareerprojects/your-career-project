const CareerPuzzle = require('../../models/CareerPuzzle');
const PuzzlePiece = require('../../models/PuzzlePiece');
const {
  getOrCreateWorkspace,
  getPathTip,
  resolveGraphFromNode,
  resolveStageCategoryForPath,
  serializeWorkspace,
  buildSeedNodes,
  reorderPathNodesByLockedEndDate,
} = require('./puzzleSeedService');
const {
  getSuccessors,
  mergeNextStepsByCategory,
  hasActiveEdge,
  serializePiece,
  newId,
  NEXT_STEPS_FETCH_CEILING,
  NEXT_STEPS_PER_CATEGORY,
  MAX_USER_PATH_STEPS,
  MAX_LOCKED_PROFILE_STEPS,
  MIN_LOCKED_PROFILE_STEPS,
  countUserAddedSteps,
  isAtUserStepLimit,
  isAtLockedProfileStepLimit,
  canRemoveLockedProfileStep,
} = require('./puzzleGraphService');
const { ensurePuzzleCatalogSeededOnce } = require('./puzzleCatalogService');
const { generateRuleSteps } = require('./puzzleRuleEngine');
const {
  generateSimulationCoolOccupationSteps,
} = require('./simulationCoolOccupationSteps');
const {
  isPuzzleCategory,
  normalizePuzzleCategory,
  getNodeDisplayCategory,
  getAllowedNextCategories,
  filterStepsByAllowedCategories,
} = require('../../../constants/puzzleCategories');
const User = require('../../models/User');

const CUSTOM_PROFILE_PIECE_KEY = 'profile.custom';

async function getCustomProfilePiece() {
  await ensurePuzzleCatalogSeededOnce();
  let piece = await PuzzlePiece.findOne({
    key: CUSTOM_PROFILE_PIECE_KEY,
    status: 'active',
  }).lean();
  if (!piece) {
    const { ensurePuzzleCatalogSeeded } = require('./puzzleCatalogService');
    await ensurePuzzleCatalogSeeded();
    piece = await PuzzlePiece.findOne({
      key: CUSTOM_PROFILE_PIECE_KEY,
      status: 'active',
    }).lean();
  }
  if (!piece) {
    const err = new Error('Custom profile puzzle piece is not available');
    err.status = 500;
    throw err;
  }
  return piece;
}

function normalizeLocalizedText(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const en = typeof value.en === 'string' ? value.en.trim() : '';
    const deRaw = value.de;
    const de =
      deRaw === null || deRaw === undefined
        ? null
        : typeof deRaw === 'string'
          ? deRaw.trim()
          : '';
    return { en, de };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return { en: trimmed, de: trimmed || null };
  }
  return {
    en: typeof fallback.en === 'string' ? fallback.en : '',
    de:
      fallback.de === null || fallback.de === undefined
        ? null
        : typeof fallback.de === 'string'
          ? fallback.de
          : null,
  };
}

function normalizeEndDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    const err = new Error('endDate must be an object with month and year, or null');
    err.status = 400;
    throw err;
  }

  const hasMonth = value.month !== null && value.month !== undefined && value.month !== '';
  const hasYear = value.year !== null && value.year !== undefined && value.year !== '';
  if (!hasMonth && !hasYear) return null;
  if (!hasMonth || !hasYear) {
    const err = new Error('endDate requires both month and year, or neither');
    err.status = 400;
    throw err;
  }

  const month = Number(value.month);
  const year = Number(value.year);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    const err = new Error('endDate.month must be an integer between 1 and 12');
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    const err = new Error('endDate.year must be an integer between 1900 and 2100');
    err.status = 400;
    throw err;
  }
  return { month, year };
}

function cloneSnapshot(snapshot) {
  if (!snapshot) return {};
  const cloned = {
    category:
      normalizePuzzleCategory(snapshot.category) || snapshot.category || '',
  };
  if (snapshot.title) {
    cloned.title = {
      en: snapshot.title.en || '',
      de: snapshot.title.de ?? null,
    };
  }
  if (snapshot.shortDescription) {
    cloned.shortDescription = {
      en: snapshot.shortDescription.en || '',
      de: snapshot.shortDescription.de ?? null,
    };
  }
  if (snapshot.endDate && (snapshot.endDate.month || snapshot.endDate.year)) {
    cloned.endDate = {
      month: snapshot.endDate.month ?? null,
      year: snapshot.endDate.year ?? null,
    };
  } else {
    cloned.endDate = null;
  }
  return cloned;
}

function findActivePath(puzzle, pathId) {
  const id = pathId || puzzle.activePathId;
  const path = (puzzle.paths || []).find((p) => p.pathId === id);
  if (!path) {
    const err = new Error('Path not found');
    err.status = 404;
    throw err;
  }
  return path;
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ language?: 'en'|'de', pathId?: string }} [options]
 */
async function getWorkspace(userId, options = {}) {
  const puzzle = await getOrCreateWorkspace(userId, options);
  let dirty = false;
  for (const path of puzzle.paths || []) {
    if (reorderPathNodesByLockedEndDate(path)) dirty = true;
  }
  if (dirty) {
    await puzzle.save();
  }
  return serializeWorkspace(puzzle);
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ pathId?: string }} [options]
 */
async function getNextSteps(userId, options = {}) {
  await ensurePuzzleCatalogSeededOnce();
  const puzzle = await getOrCreateWorkspace(userId);
  const path = findActivePath(puzzle, options.pathId);
  const tip = getPathTip(path);
  if (!tip) {
    return {
      tip: null,
      graphFrom: null,
      stageCategory: '',
      allowedCategories: getAllowedNextCategories(''),
      steps: [],
      atStepLimit: false,
      userStepCount: 0,
      maxUserSteps: MAX_USER_PATH_STEPS,
    };
  }

  const userStepCount = countUserAddedSteps(path);
  if (isAtUserStepLimit(path)) {
    const stageCategory = resolveStageCategoryForPath(path, tip);
    return {
      tip: {
        instanceId: tip.instanceId,
        pieceId: String(tip.pieceId),
        pieceKey: tip.pieceKey,
        locked: Boolean(tip.locked),
      },
      graphFrom: null,
      stageCategory,
      allowedCategories: getAllowedNextCategories(stageCategory),
      steps: [],
      atStepLimit: true,
      userStepCount,
      maxUserSteps: MAX_USER_PATH_STEPS,
    };
  }

  const stageCategory = resolveStageCategoryForPath(path, tip);
  const graphFrom = await resolveGraphFromNode(path, tip, stageCategory);
  const allowedCategories = getAllowedNextCategories(stageCategory);
  const occupationAllowed = allowedCategories.includes('occupation');

  const excludePieceIds = (path.nodes || []).map((n) => n.pieceId);

  const excludeEscoIds = [];
  const pathPieceDocs = await PuzzlePiece.find({
    _id: { $in: excludePieceIds },
  })
    .select('escoId')
    .lean();
  for (const doc of pathPieceDocs) {
    if (doc.escoId) excludeEscoIds.push(doc.escoId);
  }

  // Cool simulation roles only when occupation is an allowed next category.
  const coolSteps = occupationAllowed
    ? await generateSimulationCoolOccupationSteps(userId, graphFrom.pieceId, {
        excludePieceIds,
        excludeEscoIds,
        limit: NEXT_STEPS_PER_CATEGORY,
      })
    : [];
  for (const step of coolSteps) {
    if (step?.piece?.id) excludePieceIds.push(step.piece.id);
    if (step?.piece?.escoId) excludeEscoIds.push(step.piece.escoId);
  }

  const curatedSteps = await getSuccessors(graphFrom.pieceId, {
    excludePieceIds,
    limit: NEXT_STEPS_FETCH_CEILING,
    source: 'curated',
  });

  let ruleSteps = [];
  const slotsRemaining =
    NEXT_STEPS_FETCH_CEILING - coolSteps.length - curatedSteps.length;
  if (slotsRemaining > 0) {
    const fromPiece =
      (await PuzzlePiece.findById(graphFrom.pieceId).lean()) || {
        _id: graphFrom.pieceId,
        id: String(graphFrom.pieceId),
        key: graphFrom.pieceKey,
      };

    if (!fromPiece.key) fromPiece.key = graphFrom.pieceKey;

    // Prefer path-stage / snapshot category so locked edits retarget rules.
    const ruleCategory =
      stageCategory ||
      getNodeDisplayCategory(graphFrom) ||
      normalizePuzzleCategory(fromPiece.category) ||
      fromPiece.category;
    fromPiece.category = ruleCategory;

    ruleSteps = await generateRuleSteps(fromPiece, {
      excludePieceIds,
      excludeEscoIds,
      slotsRemaining,
    });
  }

  // Cool simulation roles first so they fill occupation slots preferentially.
  const merged = mergeNextStepsByCategory(
    [...coolSteps, ...curatedSteps],
    ruleSteps,
    NEXT_STEPS_PER_CATEGORY
  );
  const steps = filterStepsByAllowedCategories(merged, allowedCategories);

  return {
    tip: {
      instanceId: tip.instanceId,
      pieceId: String(tip.pieceId),
      pieceKey: tip.pieceKey,
      locked: Boolean(tip.locked),
    },
    graphFrom: {
      instanceId: graphFrom.instanceId,
      pieceId: String(graphFrom.pieceId),
      pieceKey: graphFrom.pieceKey,
    },
    stageCategory,
    allowedCategories,
    steps,
    atStepLimit: false,
    userStepCount,
    maxUserSteps: MAX_USER_PATH_STEPS,
  };
}

/**
 * Append a catalog piece to the active tip (linear spine).
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ pieceId: string, pathId?: string }} body
 */
async function appendPiece(userId, body = {}) {
  await ensurePuzzleCatalogSeededOnce();
  const pieceId = body.pieceId;
  if (!pieceId) {
    const err = new Error('pieceId is required');
    err.status = 400;
    throw err;
  }

  const puzzle = await getOrCreateWorkspace(userId);
  const path = findActivePath(puzzle, body.pathId);

  if (isAtUserStepLimit(path)) {
    const err = new Error(
      `You can plan up to ${MAX_USER_PATH_STEPS} steps ahead on this path`
    );
    err.status = 400;
    throw err;
  }

  const tip = getPathTip(path);
  if (!tip) {
    const err = new Error('Path has no tip');
    err.status = 400;
    throw err;
  }

  // V1 linear: tip must be the unique leaf (already true via getPathTip)
  const stageCategory = resolveStageCategoryForPath(path, tip);
  const graphFrom = await resolveGraphFromNode(path, tip, stageCategory);
  const allowed = await hasActiveEdge(graphFrom.pieceId, pieceId);
  if (!allowed) {
    const err = new Error('Selected piece is not a valid next step from the current tip');
    err.status = 400;
    throw err;
  }

  const selectedPiece = await PuzzlePiece.findOne({
    _id: pieceId,
    status: 'active',
  }).lean();
  if (!selectedPiece) {
    const err = new Error('Puzzle piece not found');
    err.status = 404;
    throw err;
  }

  const allowedCategories = getAllowedNextCategories(stageCategory);
  const selectedCategory =
    normalizePuzzleCategory(selectedPiece.category) || selectedPiece.category;
  if (
    allowedCategories.length &&
    selectedCategory &&
    !allowedCategories.includes(selectedCategory)
  ) {
    const err = new Error(
      'Selected piece is not a valid next-step category from the current path stage'
    );
    err.status = 400;
    throw err;
  }

  const alreadyOnPath = (path.nodes || []).some(
    (n) => String(n.pieceId) === String(pieceId)
  );
  if (alreadyOnPath) {
    const err = new Error('Piece is already on this path');
    err.status = 400;
    throw err;
  }

  const piece = selectedPiece;

  const node = {
    instanceId: newId(),
    pieceId: piece._id,
    pieceKey: piece.key,
    parentInstanceId: tip.instanceId,
    locked: false,
    source: 'user',
    addedAt: new Date(),
    snapshot: {
      title: piece.title,
      shortDescription: piece.shortDescription,
      category: piece.category,
    },
  };

  path.nodes.push(node);
  path.updatedAt = new Date();
  puzzle.activePathId = path.pathId;
  await puzzle.save();

  return serializeWorkspace(puzzle);
}

/**
 * Remove the last non-locked tip piece (undo).
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ pathId?: string }} [options]
 */
async function undoTip(userId, options = {}) {
  const puzzle = await getOrCreateWorkspace(userId);
  const path = findActivePath(puzzle, options.pathId);
  const tip = getPathTip(path);
  if (!tip) {
    const err = new Error('Nothing to undo');
    err.status = 400;
    throw err;
  }
  if (tip.locked) {
    const err = new Error('Cannot remove locked profile seed pieces');
    err.status = 400;
    throw err;
  }

  path.nodes = (path.nodes || []).filter((n) => n.instanceId !== tip.instanceId);
  path.updatedAt = new Date();
  await puzzle.save();

  return serializeWorkspace(puzzle);
}

/**
 * Clone locked profile seed nodes into a fresh spine with new instance ids.
 * @param {Array} nodes
 */
function cloneLockedSeedNodes(nodes = []) {
  const locked = nodes.filter((n) => n.locked);
  const instanceIdMap = new Map();

  const cloned = locked.map((node) => {
    const instanceId = newId();
    instanceIdMap.set(node.instanceId, instanceId);
    return {
      instanceId,
      pieceId: node.pieceId,
      pieceKey: node.pieceKey,
      parentInstanceId: null,
      locked: true,
      source: node.source || 'profile',
      addedAt: new Date(),
      snapshot: cloneSnapshot(node.snapshot),
    };
  });

  locked.forEach((original, index) => {
    if (original.parentInstanceId) {
      cloned[index].parentInstanceId =
        instanceIdMap.get(original.parentInstanceId) || null;
    }
  });

  reorderPathNodesByLockedEndDate({ nodes: cloned });
  return cloned;
}

/**
 * Save the current path (name + favorite), then start a fresh path with only locked seeds.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ pathId?: string, title: string }} body
 */
async function savePathAndReset(userId, body = {}) {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '';
  if (!title) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }

  const puzzle = await getOrCreateWorkspace(userId);
  const path = findActivePath(puzzle, body.pathId);

  path.title = title;
  path.isFavorite = true;
  path.updatedAt = new Date();

  let freshNodes = cloneLockedSeedNodes(path.nodes || []);
  if (!freshNodes.length) {
    const user = await User.findById(userId).select('profile.seniority').lean();
    freshNodes = await buildSeedNodes(user?.profile?.seniority || {}, puzzle.language);
  }

  const newPathId = newId();
  puzzle.paths.push({
    pathId: newPathId,
    title: null,
    isFavorite: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    nodes: freshNodes,
  });
  puzzle.activePathId = newPathId;
  await puzzle.save();

  return serializeWorkspace(puzzle);
}

/**
 * Ensure the active path is a non-favorite draft. If active is saved, switch to an
 * existing draft or create a fresh locked-seed path.
 * @param {string|import('mongoose').Types.ObjectId} userId
 */
async function ensureDraftPath(userId) {
  const puzzle = await getOrCreateWorkspace(userId);
  const active = findActivePath(puzzle, puzzle.activePathId);

  if (!active.isFavorite) {
    return serializeWorkspace(puzzle);
  }

  const existingDraft = (puzzle.paths || []).find((p) => !p.isFavorite);
  if (existingDraft) {
    puzzle.activePathId = existingDraft.pathId;
    await puzzle.save();
    return serializeWorkspace(puzzle);
  }

  let freshNodes = cloneLockedSeedNodes(active.nodes || []);
  if (!freshNodes.length) {
    const user = await User.findById(userId).select('profile.seniority').lean();
    freshNodes = await buildSeedNodes(user?.profile?.seniority || {}, puzzle.language);
  }

  const newPathId = newId();
  puzzle.paths.push({
    pathId: newPathId,
    title: null,
    isFavorite: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    nodes: freshNodes,
  });
  puzzle.activePathId = newPathId;
  await puzzle.save();

  return serializeWorkspace(puzzle);
}

/**
 * Rename / favorite a path.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} pathId
 * @param {{ title?: string, isFavorite?: boolean, setActive?: boolean }} patch
 */
async function updatePath(userId, pathId, patch = {}) {
  const puzzle = await getOrCreateWorkspace(userId);
  const path = findActivePath(puzzle, pathId);

  if (typeof patch.title === 'string') {
    path.title = patch.title.trim().slice(0, 120) || null;
  }
  if (typeof patch.isFavorite === 'boolean') {
    path.isFavorite = patch.isFavorite;
  }
  if (patch.setActive === true) {
    puzzle.activePathId = path.pathId;
  }
  path.updatedAt = new Date();
  await puzzle.save();

  return serializeWorkspace(puzzle);
}

/**
 * Update display fields on a path node snapshot (e.g. locked profile seeds).
 * Does not change pieceId/pieceKey so next-step graph edges stay valid.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} pathId
 * @param {string} instanceId
 * @param {{
 *   category?: string,
 *   title?: string|{en?: string, de?: string|null},
 *   shortDescription?: string|{en?: string, de?: string|null},
 *   endDate?: {month?: number|null, year?: number|null}|null,
 * }} patch
 */
async function updatePathNode(userId, pathId, instanceId, patch = {}) {
  const puzzle = await getOrCreateWorkspace(userId);
  const path = findActivePath(puzzle, pathId);
  const node = (path.nodes || []).find((n) => n.instanceId === instanceId);
  if (!node) {
    const err = new Error('Path node not found');
    err.status = 404;
    throw err;
  }

  if (!node.snapshot) {
    node.snapshot = {};
  }

  if (patch.category !== undefined) {
    const category = String(patch.category || '').trim();
    if (!isPuzzleCategory(category)) {
      const err = new Error('Invalid puzzle category');
      err.status = 400;
      throw err;
    }
    node.snapshot.category = category;
  }

  if (patch.title !== undefined) {
    const title = normalizeLocalizedText(patch.title, node.snapshot.title);
    if (!title.en && !title.de) {
      const err = new Error('title is required');
      err.status = 400;
      throw err;
    }
    if ((title.en && title.en.length > 200) || (title.de && title.de.length > 200)) {
      const err = new Error('title must be at most 200 characters');
      err.status = 400;
      throw err;
    }
    node.snapshot.title = title;
  }

  if (patch.shortDescription !== undefined) {
    const shortDescription = normalizeLocalizedText(
      patch.shortDescription,
      node.snapshot.shortDescription
    );
    if (
      (shortDescription.en && shortDescription.en.length > 1000) ||
      (shortDescription.de && shortDescription.de.length > 1000)
    ) {
      const err = new Error('description must be at most 1000 characters');
      err.status = 400;
      throw err;
    }
    node.snapshot.shortDescription = shortDescription;
  }

  if (patch.endDate !== undefined) {
    node.snapshot.endDate = normalizeEndDate(patch.endDate);
  }

  if (node.locked) {
    reorderPathNodesByLockedEndDate(path);
  }

  path.updatedAt = new Date();
  await puzzle.save();

  return serializeWorkspace(puzzle);
}

/**
 * Remove a path node.
 * - Locked profile steps: only when more than {@link MIN_LOCKED_PROFILE_STEPS} remain.
 * - Unlocked future steps: always removable.
 * Rewires children to the deleted node's parent; reorders locked steps by end date when needed.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} pathId
 * @param {string} instanceId
 */
async function deleteLockedProfileNode(userId, pathId, instanceId) {
  const puzzle = await getOrCreateWorkspace(userId);
  const path = findActivePath(puzzle, pathId);
  const node = (path.nodes || []).find((n) => n.instanceId === instanceId);
  if (!node) {
    const err = new Error('Path node not found');
    err.status = 404;
    throw err;
  }
  if (node.locked && !canRemoveLockedProfileStep(path)) {
    const err = new Error(
      `Keep at least ${MIN_LOCKED_PROFILE_STEPS} profile steps on this path`
    );
    err.status = 400;
    throw err;
  }

  const parentInstanceId = node.parentInstanceId || null;
  path.nodes = (path.nodes || []).filter((n) => n.instanceId !== instanceId);
  for (const remaining of path.nodes) {
    if (remaining.parentInstanceId === instanceId) {
      remaining.parentInstanceId = parentInstanceId;
    }
  }

  if (node.locked) {
    reorderPathNodesByLockedEndDate(path);
  }
  path.updatedAt = new Date();
  puzzle.markModified('paths');
  await puzzle.save();

  return serializeWorkspace(puzzle);
}

/**
 * Append a user-authored locked profile step (max {@link MAX_LOCKED_PROFILE_STEPS}).
 * Inserts after the last locked node and before any unlocked future steps.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} pathId
 * @param {{
 *   category: string,
 *   title: string|{en?: string, de?: string|null},
 *   shortDescription?: string|{en?: string, de?: string|null},
 *   endDate?: {month?: number|null, year?: number|null}|null,
 * }} body
 */
async function appendLockedProfileNode(userId, pathId, body = {}) {
  const puzzle = await getOrCreateWorkspace(userId);
  const path = findActivePath(puzzle, pathId);

  if (isAtLockedProfileStepLimit(path)) {
    const err = new Error(
      `You can have at most ${MAX_LOCKED_PROFILE_STEPS} profile steps on this path`
    );
    err.status = 400;
    throw err;
  }

  const category = String(body.category || '').trim();
  if (!isPuzzleCategory(category)) {
    const err = new Error('Invalid puzzle category');
    err.status = 400;
    throw err;
  }

  const title = normalizeLocalizedText(body.title);
  if (!title.en && !title.de) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }
  if ((title.en && title.en.length > 200) || (title.de && title.de.length > 200)) {
    const err = new Error('title must be at most 200 characters');
    err.status = 400;
    throw err;
  }

  const shortDescription = normalizeLocalizedText(body.shortDescription || '');
  if (
    (shortDescription.en && shortDescription.en.length > 1000) ||
    (shortDescription.de && shortDescription.de.length > 1000)
  ) {
    const err = new Error('description must be at most 1000 characters');
    err.status = 400;
    throw err;
  }

  const endDate = normalizeEndDate(
    body.endDate === undefined ? null : body.endDate
  );

  const customPiece = await getCustomProfilePiece();
  const instanceId = newId();
  const newNode = {
    instanceId,
    pieceId: customPiece._id,
    pieceKey: customPiece.key,
    parentInstanceId: null,
    locked: true,
    source: 'profile',
    addedAt: new Date(),
    snapshot: {
      title,
      shortDescription,
      category,
      endDate,
    },
  };

  path.nodes.push(newNode);
  reorderPathNodesByLockedEndDate(path);
  path.updatedAt = new Date();
  await puzzle.save();

  return serializeWorkspace(puzzle);
}

/**
 * Piece detail with optional CareerPath / ESCO enrichment.
 * @param {string} pieceId
 */
async function getPieceDetail(pieceId) {
  await ensurePuzzleCatalogSeededOnce();
  const piece = await PuzzlePiece.findById(pieceId).lean();
  if (!piece || piece.status === 'deprecated') {
    const err = new Error('Puzzle piece not found');
    err.status = 404;
    throw err;
  }

  const result = {
    piece: serializePiece(piece),
    careerPath: null,
  };

  if (piece.careerPathId || piece.escoId) {
    try {
      const CareerPath = require('../../models/CareerPath');
      let careerPath = null;
      if (piece.careerPathId) {
        careerPath = await CareerPath.findById(piece.careerPathId)
          .select('title description escoId skillModel seniority')
          .lean();
      }
      if (!careerPath && piece.escoId) {
        careerPath = await CareerPath.findOne({ escoId: piece.escoId })
          .select('title description escoId skillModel seniority')
          .lean();
      }
      if (careerPath) {
        result.careerPath = {
          id: String(careerPath._id),
          escoId: careerPath.escoId,
          title: careerPath.title || null,
          description: careerPath.description || null,
          skillModel: careerPath.skillModel || null,
          seniority: careerPath.seniority || null,
        };
      }
    } catch (err) {
      console.warn('[careerPuzzle] CareerPath enrichment skipped:', err.message);
    }
  }

  return result;
}

module.exports = {
  getWorkspace,
  getNextSteps,
  appendPiece,
  undoTip,
  savePathAndReset,
  ensureDraftPath,
  updatePath,
  updatePathNode,
  deleteLockedProfileNode,
  appendLockedProfileNode,
  getPieceDetail,
};
