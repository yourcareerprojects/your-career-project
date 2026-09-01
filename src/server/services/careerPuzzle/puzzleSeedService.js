const CareerPuzzle = require('../../models/CareerPuzzle');
const PuzzlePiece = require('../../models/PuzzlePiece');
const User = require('../../models/User');
const {
  mapHighestDegreeToPieceKey,
  mapExperienceToPieceKey,
} = require('../../../constants/puzzleSeedMappings');
const {
  normalizePuzzleCategory,
  getNodeDisplayCategory,
  STAGE_GRAPH_PROXY_KEYS,
} = require('../../../constants/puzzleCategories');
const { ensurePuzzleCatalogSeededOnce } = require('./puzzleCatalogService');
const {
  serializePiece,
  newId,
  countOutgoingEdges,
  MAX_USER_PATH_STEPS,
  MAX_LOCKED_PROFILE_STEPS,
  MIN_LOCKED_PROFILE_STEPS,
  countUserAddedSteps,
  countLockedProfileSteps,
  canRemoveLockedProfileStep,
} = require('./puzzleGraphService');

/**
 * Build locked seed nodes from profile seniority.
 * @param {{ highestDegree?: string, mostSeniorWorkExperience?: string }} seniority
 * @param {'en'|'de'} language
 */
async function buildSeedNodes(seniority = {}, language = 'de') {
  await ensurePuzzleCatalogSeededOnce();

  const educationKey = mapHighestDegreeToPieceKey(seniority.highestDegree);
  const experienceKey = mapExperienceToPieceKey(seniority.mostSeniorWorkExperience);

  const pieces = await PuzzlePiece.find({
    key: { $in: [educationKey, experienceKey] },
    status: 'active',
  }).lean();

  const byKey = new Map(pieces.map((p) => [p.key, p]));
  const education = byKey.get(educationKey);
  const experience = byKey.get(experienceKey);

  if (!education) {
    throw new Error(`Missing puzzle seed piece for education key: ${educationKey}`);
  }
  if (!experience) {
    throw new Error(`Missing puzzle seed piece for experience key: ${experienceKey}`);
  }

  const educationInstanceId = newId();
  const experienceInstanceId = newId();

  return [
    {
      instanceId: educationInstanceId,
      pieceId: education._id,
      pieceKey: education.key,
      parentInstanceId: null,
      locked: true,
      source: 'profile',
      addedAt: new Date(),
      snapshot: {
        title: education.title,
        shortDescription: education.shortDescription,
        category: education.category,
      },
    },
    {
      instanceId: experienceInstanceId,
      pieceId: experience._id,
      pieceKey: experience.key,
      parentInstanceId: educationInstanceId,
      locked: true,
      source: 'profile',
      addedAt: new Date(),
      snapshot: {
        title: experience.title,
        shortDescription: experience.shortDescription,
        category: experience.category,
      },
    },
  ];
}

/**
 * Get or create the user's career puzzle workspace with locked profile seeds.
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ language?: 'en'|'de' }} [options]
 */
async function getOrCreateWorkspace(userId, options = {}) {
  await ensurePuzzleCatalogSeededOnce();

  let puzzle = await CareerPuzzle.findOne({ userId });
  if (puzzle) {
    return puzzle;
  }

  const user = await User.findById(userId).select('profile.seniority').lean();
  const seniority = user?.profile?.seniority || {};
  const language = options.language === 'en' ? 'en' : 'de';
  const seedNodes = await buildSeedNodes(seniority, language);
  const pathId = newId();

  puzzle = await CareerPuzzle.create({
    userId,
    market: 'dach',
    language,
    activePathId: pathId,
    paths: [
      {
        pathId,
        title: null,
        isFavorite: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        nodes: seedNodes,
      },
    ],
    comparisonPathIds: [],
    uiMode: 'spine',
  });

  return puzzle;
}

/**
 * Linear spine tip = the unique leaf (node with no children).
 * @param {{ nodes?: Array<{ instanceId: string, parentInstanceId?: string|null }> }} path
 */
function getPathTip(path) {
  const nodes = path?.nodes || [];
  if (!nodes.length) return null;
  const childParents = new Set(
    nodes.map((n) => n.parentInstanceId).filter(Boolean)
  );
  const leaves = nodes.filter((n) => !childParents.has(n.instanceId));
  // Prefer a single leaf; if multiple (future branches), pick the most recently added
  if (leaves.length === 1) return leaves[0];
  if (!leaves.length) return nodes[nodes.length - 1];
  return leaves.sort(
    (a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0)
  )[0];
}

/**
 * Career stage for next-step chips/options from the displayed path tip.
 * For narrative `exp.none` tips, prefer the prior locked education-like step
 * (by spine order), including custom locked nodes whose snapshot category was edited.
 * @param {{ nodes?: Array }} path
 * @param {{ instanceId?: string, pieceKey?: string, snapshot?: object }|null|undefined} tip
 * @returns {string}
 */
function resolveStageCategoryForPath(path, tip) {
  if (!tip) return '';
  const tipCategory = getNodeDisplayCategory(tip);
  const tipKey = String(tip.pieceKey || '');
  const tipIsNarrativeNoExperience =
    tipKey === 'exp.none' && tipCategory === 'occupation';

  if (!tipIsNarrativeNoExperience) {
    return tipCategory;
  }

  const orderedLocked = orderSpineNodes(path).filter((n) => n.locked);
  const tipIdx = orderedLocked.findIndex((n) => n.instanceId === tip.instanceId);
  for (let i = tipIdx - 1; i >= 0; i -= 1) {
    const cat = getNodeDisplayCategory(orderedLocked[i]);
    if (cat && cat !== 'occupation') return cat;
  }

  const educationNode = (path.nodes || []).find(
    (n) => n.locked && String(n.pieceKey || '').startsWith('edu.')
  );
  if (educationNode) {
    return getNodeDisplayCategory(educationNode) || tipCategory;
  }

  return tipCategory;
}

/**
 * Graph query root for next-steps / append validation.
 * Experience seed tips often have no edges — fall back to locked education seed
 * until the user has placed a non-locked piece.
 *
 * When the tip's display category drifted from its catalog piece (locked edit),
 * use a stage-aligned proxy seed so options match the displayed path stage
 * (e.g. Realschule snapshot on edu.bachelors → school proxy, not Master).
 *
 * @param {{ nodes?: Array }} path
 * @param {{ instanceId: string, pieceId: *, pieceKey: string, locked?: boolean, snapshot?: object }} tip
 * @param {string} [stageCategory]
 */
async function resolveGraphFromNode(path, tip, stageCategory = '') {
  if (!tip) return null;

  const stage =
    normalizePuzzleCategory(stageCategory) ||
    resolveStageCategoryForPath(path, tip) ||
    getNodeDisplayCategory(tip);

  const tipPiece = tip.pieceId
    ? await PuzzlePiece.findById(tip.pieceId).select('category key').lean()
    : null;
  const tipPieceCategory = normalizePuzzleCategory(tipPiece?.category);
  const tipAligned =
    Boolean(stage) && tipPieceCategory === stage && tipPieceCategory !== '';
  const isCustomTip = String(tip.pieceKey || '').startsWith('profile.');

  if (tipAligned && !isCustomTip) {
    const outgoing = await countOutgoingEdges(tip.pieceId);
    if (outgoing > 0) {
      return tip;
    }
  }

  const hasUserPieces = (path.nodes || []).some((n) => !n.locked);
  if (hasUserPieces && tipAligned && !isCustomTip) {
    return tip;
  }

  // Prefer another locked node whose catalog category still matches the stage.
  if (stage) {
    for (const node of path.nodes || []) {
      if (!node.locked) continue;
      if (String(node.instanceId) === String(tip.instanceId)) continue;
      if (getNodeDisplayCategory(node) !== stage) continue;
      if (String(node.pieceKey || '').startsWith('profile.')) continue;
      const piece = node.pieceId
        ? await PuzzlePiece.findById(node.pieceId).select('category key').lean()
        : null;
      if (normalizePuzzleCategory(piece?.category) !== stage) continue;
      const outgoing = await countOutgoingEdges(node.pieceId);
      if (outgoing > 0) {
        return node;
      }
    }

    const proxyKey = STAGE_GRAPH_PROXY_KEYS[stage];
    if (proxyKey) {
      const proxy = await PuzzlePiece.findOne({
        key: proxyKey,
        status: 'active',
      })
        .select('_id key category')
        .lean();
      if (proxy) {
        return {
          instanceId: tip.instanceId,
          pieceId: proxy._id,
          pieceKey: proxy.key,
          locked: tip.locked,
          snapshot: {
            ...(tip.snapshot || {}),
            category: stage,
          },
          _graphProxy: true,
        };
      }
    }
  }

  // Legacy fallback: education seed when tip is edge-less experience
  if (!hasUserPieces) {
    const educationNode = (path.nodes || []).find(
      (n) => n.locked && String(n.pieceKey || '').startsWith('edu.')
    );
    if (educationNode) {
      const eduPiece = educationNode.pieceId
        ? await PuzzlePiece.findById(educationNode.pieceId)
            .select('category')
            .lean()
        : null;
      const eduCatalogCat = normalizePuzzleCategory(eduPiece?.category);
      const eduDisplay = getNodeDisplayCategory(educationNode);
      // Only use education seed when it still matches the stage (or stage unknown)
      if (!stage || eduDisplay === stage || eduCatalogCat === stage) {
        const outgoing = await countOutgoingEdges(educationNode.pieceId);
        if (outgoing > 0) return educationNode;
      }
    }
  }

  if (!hasUserPieces) {
    const outgoing = await countOutgoingEdges(tip.pieceId);
    if (outgoing > 0) return tip;
  }

  return tip;
}

/**
 * Ordered linear spine for V1 (root → … → tip) via parent links.
 */
function orderSpineNodes(path) {
  const nodes = path?.nodes || [];
  if (!nodes.length) return [];
  const byId = new Map(nodes.map((n) => [n.instanceId, n]));
  const roots = nodes.filter((n) => !n.parentInstanceId);
  const ordered = [];
  let current = roots[0] || nodes[0];
  const seen = new Set();
  while (current && !seen.has(current.instanceId)) {
    ordered.push(current);
    seen.add(current.instanceId);
    current = nodes.find((n) => n.parentInstanceId === current.instanceId);
  }
  // Append any orphans (should not happen in V1)
  for (const n of nodes) {
    if (!seen.has(n.instanceId)) ordered.push(n);
  }
  return ordered;
}

/**
 * Sort key for locked profile end dates (year-month). Missing dates sort last.
 * @param {{ snapshot?: { endDate?: { month?: number|null, year?: number|null }|null } }} node
 * @returns {number}
 */
function lockedEndDateSortKey(node) {
  const endDate = node?.snapshot?.endDate;
  const month = Number(endDate?.month);
  const year = Number(endDate?.year);
  if (
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    year < 1900 ||
    year > 2100
  ) {
    return Number.POSITIVE_INFINITY;
  }
  return year * 12 + month;
}

/**
 * Re-wire parent links so locked steps are chronological by end date.
 * Undated locked steps come last among locked steps, then unlocked future steps.
 * @param {{ nodes?: Array }} path
 * @returns {boolean} whether any parent link changed
 */
function reorderPathNodesByLockedEndDate(path) {
  const nodes = path?.nodes || [];
  if (nodes.length < 2) return false;

  const ordered = orderSpineNodes(path);
  const locked = ordered.filter((n) => n.locked);
  const unlocked = ordered.filter((n) => !n.locked);
  if (!locked.length) return false;

  locked.sort((a, b) => {
    const keyA = lockedEndDateSortKey(a);
    const keyB = lockedEndDateSortKey(b);
    if (keyA !== keyB) return keyA - keyB;
    const timeA = new Date(a.addedAt || 0).getTime();
    const timeB = new Date(b.addedAt || 0).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return String(a.instanceId || '').localeCompare(String(b.instanceId || ''));
  });

  const newOrder = locked.concat(unlocked);
  let changed = false;
  for (let i = 0; i < newOrder.length; i += 1) {
    const desiredParent = i === 0 ? null : newOrder[i - 1].instanceId;
    if (newOrder[i].parentInstanceId !== desiredParent) {
      newOrder[i].parentInstanceId = desiredParent;
      changed = true;
    }
  }
  return changed;
}

/**
 * @param {import('mongoose').Document} puzzle
 */
async function serializeWorkspace(puzzle) {
  const obj = puzzle.toObject ? puzzle.toObject() : puzzle;
  const pieceIds = new Set();
  for (const path of obj.paths || []) {
    for (const node of path.nodes || []) {
      if (node.pieceId) pieceIds.add(String(node.pieceId));
    }
  }

  const pieces = await PuzzlePiece.find({
    _id: { $in: [...pieceIds] },
  }).lean();
  const pieceById = new Map(pieces.map((p) => [String(p._id), serializePiece(p)]));

  const paths = (obj.paths || []).map((path) => {
    const tip = getPathTip(path);
    const userStepCount = countUserAddedSteps(path);
    const lockedStepCount = countLockedProfileSteps(path);
    return {
      pathId: path.pathId,
      title: path.title,
      isFavorite: Boolean(path.isFavorite),
      createdAt: path.createdAt,
      updatedAt: path.updatedAt,
      tipInstanceId: tip?.instanceId || null,
      userStepCount,
      maxUserSteps: MAX_USER_PATH_STEPS,
      atStepLimit: userStepCount >= MAX_USER_PATH_STEPS,
      lockedStepCount,
      maxLockedSteps: MAX_LOCKED_PROFILE_STEPS,
      minLockedSteps: MIN_LOCKED_PROFILE_STEPS,
      atLockedStepLimit: lockedStepCount >= MAX_LOCKED_PROFILE_STEPS,
      canDeleteLockedStep: canRemoveLockedProfileStep(path),
      nodes: orderSpineNodes(path).map((node) => ({
        instanceId: node.instanceId,
        pieceId: String(node.pieceId),
        pieceKey: node.pieceKey,
        parentInstanceId: node.parentInstanceId,
        locked: Boolean(node.locked),
        source: node.source,
        addedAt: node.addedAt,
        snapshot: (() => {
          const snapshot = node.snapshot || {};
          const category =
            normalizePuzzleCategory(snapshot.category) || snapshot.category || '';
          return { ...snapshot, category };
        })(),
        piece: pieceById.get(String(node.pieceId)) || null,
      })),
    };
  });

  const activePath =
    paths.find((p) => p.pathId === obj.activePathId) || paths[0] || null;

  return {
    id: String(obj._id),
    userId: String(obj.userId),
    market: obj.market,
    language: obj.language,
    activePathId: obj.activePathId,
    uiMode: obj.uiMode,
    comparisonPathIds: obj.comparisonPathIds || [],
    paths,
    activePath,
  };
}

module.exports = {
  buildSeedNodes,
  getOrCreateWorkspace,
  getPathTip,
  resolveGraphFromNode,
  resolveStageCategoryForPath,
  orderSpineNodes,
  lockedEndDateSortKey,
  reorderPathNodesByLockedEndDate,
  serializeWorkspace,
};
