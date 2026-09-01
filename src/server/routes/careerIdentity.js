const express = require('express');
const { body, param, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const requireVerifiedEmail = require('../middleware/requireVerifiedEmail');
const careerIdentityController = require('../controllers/careerIdentityController');

const router = express.Router();
const requireVerifiedProfile = [auth, requireVerifiedEmail];
const requireVerifiedProfileSse = [
  auth.attachAccessTokenFromQuery,
  auth,
  requireVerifiedEmail,
];

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

const traitIdParam = param('traitId')
  .isString()
  .trim()
  .isLength({ min: 1, max: 64 })
  .withMessage('traitId is required');

const sessionIdParam = param('sessionId')
  .isMongoId()
  .withMessage('sessionId must be a valid id');

router.get('/', requireVerifiedProfile, careerIdentityController.getCareerIdentity);

router.post('/refresh', requireVerifiedProfile, careerIdentityController.refreshCareerIdentity);

router.post(
  '/exploration/run',
  requireVerifiedProfile,
  careerIdentityController.runCareerExploration
);

router.get(
  '/exploration/events',
  requireVerifiedProfileSse,
  careerIdentityController.streamCareerExplorationEvents
);

router.get(
  '/exploration/latest',
  requireVerifiedProfile,
  careerIdentityController.getLatestCareerExploration
);

router.post(
  '/exploration/:sessionId/seen',
  requireVerifiedProfile,
  [sessionIdParam],
  rejectValidationErrors,
  careerIdentityController.markCareerExplorationSeen
);

router.put(
  '/exploration/:sessionId/ranking',
  requireVerifiedProfile,
  [
    sessionIdParam,
    body('rankingProgress')
      .isObject()
      .withMessage('rankingProgress must be an object'),
  ],
  rejectValidationErrors,
  careerIdentityController.updateCareerExplorationRanking
);

router.get(
  '/exploration/:sessionId',
  requireVerifiedProfile,
  [sessionIdParam],
  rejectValidationErrors,
  careerIdentityController.getCareerExplorationById
);

router.get(
  '/traits/:traitId',
  requireVerifiedProfile,
  [traitIdParam],
  rejectValidationErrors,
  careerIdentityController.getTraitDetail
);

router.put(
  '/traits/:traitId/vote',
  requireVerifiedProfile,
  [
    traitIdParam,
    body('vote')
      .custom((value) => value === null || value === undefined || ['confirm', 'unsure', 'reject'].includes(value))
      .withMessage('vote must be confirm, unsure, reject, or null'),
  ],
  rejectValidationErrors,
  careerIdentityController.voteOnTrait
);

module.exports = router;
