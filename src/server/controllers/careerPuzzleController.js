const puzzlePathService = require('../services/careerPuzzle/puzzlePathService');

function getUserId(req) {
  return req.user && req.user.userId;
}

function getLanguage(req) {
  const lang = String(req.query.lang || req.language || '').toLowerCase();
  return lang === 'en' ? 'en' : 'de';
}

function handleError(res, err, fallbackMessage) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('[careerPuzzle]', err);
  }
  return res.status(status).json({
    message: err.message || fallbackMessage,
  });
}

/**
 * GET /api/career-puzzle
 */
async function getCareerPuzzle(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const workspace = await puzzlePathService.getWorkspace(userId, {
      language: getLanguage(req),
    });
    return res.json({ puzzle: workspace });
  } catch (err) {
    return handleError(res, err, 'Failed to load career puzzle');
  }
}

/**
 * GET /api/career-puzzle/next-steps
 */
async function getNextSteps(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const result = await puzzlePathService.getNextSteps(userId, {
      pathId: req.query.pathId || undefined,
    });
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Failed to load next steps');
  }
}

/**
 * POST /api/career-puzzle/pieces
 * body: { pieceId, pathId? }
 */
async function appendPiece(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const puzzle = await puzzlePathService.appendPiece(userId, {
      pieceId: req.body?.pieceId,
      pathId: req.body?.pathId,
    });
    return res.json({ puzzle });
  } catch (err) {
    return handleError(res, err, 'Failed to append puzzle piece');
  }
}

/**
 * DELETE /api/career-puzzle/pieces/tip
 */
async function undoTip(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const puzzle = await puzzlePathService.undoTip(userId, {
      pathId: req.query.pathId || req.body?.pathId,
    });
    return res.json({ puzzle });
  } catch (err) {
    return handleError(res, err, 'Failed to undo tip');
  }
}

/**
 * POST /api/career-puzzle/paths/save
 * body: { pathId?, title }
 * Saves the path, then starts a fresh path with locked profile seeds only.
 */
async function savePathAndReset(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const puzzle = await puzzlePathService.savePathAndReset(userId, {
      pathId: req.body?.pathId,
      title: req.body?.title,
    });
    return res.json({ puzzle });
  } catch (err) {
    return handleError(res, err, 'Failed to save career path');
  }
}

/**
 * POST /api/career-puzzle/paths/ensure-draft
 * Ensures active path is a non-favorite draft workspace.
 */
async function ensureDraftPath(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const puzzle = await puzzlePathService.ensureDraftPath(userId);
    return res.json({ puzzle });
  } catch (err) {
    return handleError(res, err, 'Failed to ensure draft path');
  }
}

/**
 * PATCH /api/career-puzzle/paths/:pathId
 */
async function updatePath(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const puzzle = await puzzlePathService.updatePath(
      userId,
      req.params.pathId,
      {
        title: req.body?.title,
        isFavorite: req.body?.isFavorite,
        setActive: req.body?.setActive,
      }
    );
    return res.json({ puzzle });
  } catch (err) {
    return handleError(res, err, 'Failed to update path');
  }
}

/**
 * PATCH /api/career-puzzle/paths/:pathId/nodes/:instanceId
 * body: { category?, title?, shortDescription?, endDate? }
 */
async function updatePathNode(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const puzzle = await puzzlePathService.updatePathNode(
      userId,
      req.params.pathId,
      req.params.instanceId,
      {
        category: req.body?.category,
        title: req.body?.title,
        shortDescription: req.body?.shortDescription,
        endDate: req.body?.endDate,
      }
    );
    return res.json({ puzzle });
  } catch (err) {
    return handleError(res, err, 'Failed to update path node');
  }
}

/**
 * DELETE /api/career-puzzle/paths/:pathId/nodes/:instanceId
 * Removes a locked profile step (when above the minimum) or an unlocked future step.
 */
async function deleteLockedProfileNode(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const puzzle = await puzzlePathService.deleteLockedProfileNode(
      userId,
      req.params.pathId,
      req.params.instanceId
    );
    return res.json({ puzzle });
  } catch (err) {
    return handleError(res, err, 'Failed to delete path step');
  }
}

/**
 * POST /api/career-puzzle/paths/:pathId/nodes/locked
 * body: { category, title, shortDescription?, endDate? }
 */
async function appendLockedProfileNode(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const puzzle = await puzzlePathService.appendLockedProfileNode(
      userId,
      req.params.pathId,
      {
        category: req.body?.category,
        title: req.body?.title,
        shortDescription: req.body?.shortDescription,
        endDate: req.body?.endDate,
      }
    );
    return res.json({ puzzle });
  } catch (err) {
    return handleError(res, err, 'Failed to add profile step');
  }
}

/**
 * GET /api/career-puzzle/pieces/:pieceId
 */
async function getPieceDetail(req, res) {
  try {
    const detail = await puzzlePathService.getPieceDetail(req.params.pieceId);
    return res.json(detail);
  } catch (err) {
    return handleError(res, err, 'Failed to load piece detail');
  }
}

module.exports = {
  getCareerPuzzle,
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
