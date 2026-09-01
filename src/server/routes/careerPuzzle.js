const express = require('express');
const { body, param, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const requireVerifiedEmail = require('../middleware/requireVerifiedEmail');
const careerPuzzleController = require('../controllers/careerPuzzleController');

const router = express.Router();
const requireVerifiedProfile = [auth, requireVerifiedEmail];

function rejectValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: errors.array()[0]?.msg || 'Validation failed',
      errors: errors.array(),
    });
  }
  return next();
}

router.get('/', requireVerifiedProfile, careerPuzzleController.getCareerPuzzle);

router.get(
  '/next-steps',
  requireVerifiedProfile,
  careerPuzzleController.getNextSteps
);

router.post(
  '/pieces',
  requireVerifiedProfile,
  [
    body('pieceId')
      .notEmpty()
      .withMessage('pieceId is required')
      .isMongoId()
      .withMessage('pieceId must be a valid id'),
    body('pathId').optional().isString().isLength({ max: 64 }),
  ],
  rejectValidationErrors,
  careerPuzzleController.appendPiece
);

router.delete(
  '/pieces/tip',
  requireVerifiedProfile,
  careerPuzzleController.undoTip
);

router.post(
  '/paths/save',
  requireVerifiedProfile,
  [
    body('pathId').optional().isString().isLength({ max: 64 }),
    body('title')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('title is required')
      .isLength({ max: 120 })
      .withMessage('title must be at most 120 characters'),
  ],
  rejectValidationErrors,
  careerPuzzleController.savePathAndReset
);

router.post(
  '/paths/ensure-draft',
  requireVerifiedProfile,
  careerPuzzleController.ensureDraftPath
);

router.patch(
  '/paths/:pathId',
  requireVerifiedProfile,
  [
    param('pathId').isString().isLength({ min: 1, max: 64 }),
    body('title').optional().isString().isLength({ max: 120 }),
    body('isFavorite').optional().isBoolean(),
    body('setActive').optional().isBoolean(),
  ],
  rejectValidationErrors,
  careerPuzzleController.updatePath
);

router.patch(
  '/paths/:pathId/nodes/:instanceId',
  requireVerifiedProfile,
  [
    param('pathId').isString().isLength({ min: 1, max: 64 }),
    param('instanceId').isString().isLength({ min: 1, max: 64 }),
    body('category').optional().isString().isLength({ min: 1, max: 64 }),
    body('title').optional(),
    body('shortDescription').optional(),
    body('endDate').optional({ nullable: true }),
  ],
  rejectValidationErrors,
  careerPuzzleController.updatePathNode
);

router.delete(
  '/paths/:pathId/nodes/:instanceId',
  requireVerifiedProfile,
  [
    param('pathId').isString().isLength({ min: 1, max: 64 }),
    param('instanceId').isString().isLength({ min: 1, max: 64 }),
  ],
  rejectValidationErrors,
  careerPuzzleController.deleteLockedProfileNode
);

router.post(
  '/paths/:pathId/nodes/locked',
  requireVerifiedProfile,
  [
    param('pathId').isString().isLength({ min: 1, max: 64 }),
    body('category')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('category is required')
      .isLength({ max: 64 }),
    body('title').notEmpty().withMessage('title is required'),
    body('shortDescription').optional(),
    body('endDate').optional({ nullable: true }),
  ],
  rejectValidationErrors,
  careerPuzzleController.appendLockedProfileNode
);

router.get(
  '/pieces/:pieceId',
  requireVerifiedProfile,
  [param('pieceId').isMongoId().withMessage('pieceId must be a valid id')],
  rejectValidationErrors,
  careerPuzzleController.getPieceDetail
);

module.exports = router;
