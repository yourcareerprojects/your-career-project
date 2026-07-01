const express = require('express');
const { body } = require('express-validator');
const multer = require('multer');
const path = require('path');
const { CURRENT_EMPLOYMENT_STATUS_ALLOWED } = require('../../constants/currentEmploymentStatus');
const { HIGHEST_DEGREE_ALLOWED } = require('../../constants/highestDegree');
const profileController = require('../controllers/profileController');
const auth = require('../middleware/auth');
const requireVerifiedEmail = require('../middleware/requireVerifiedEmail');
const requireCompletedProfile = require('../middleware/requireCompletedProfile');

const requireVerifiedProfile = [requireVerifiedEmail];
const requireSimulationAccess = [requireVerifiedEmail, requireCompletedProfile];

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../uploads');
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});

// Validation middleware
const profileNameValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters')
];

const userIdentityFieldRequired = (field, max = 2000) =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage('This field is required')
    .isLength({ max })
    .withMessage(`Must be at most ${max} characters`);

const userIdentityValidation = [
  userIdentityFieldRequired('workEnjoyMost'),
  userIdentityFieldRequired('topicsIndustriesInterest'),
  userIdentityFieldRequired('naturallyGoodAt'),
  userIdentityFieldRequired('workEnvironmentFit'),
  userIdentityFieldRequired('workingLifeAchievement'),
];

const seniorityValidation = [
  body('currentStatus')
    .notEmpty()
    .withMessage('Current employment status is required')
    .isIn(CURRENT_EMPLOYMENT_STATUS_ALLOWED)
    .withMessage('Invalid current employment status'),
  body('yearsOfExperience')
    .optional()
    .isInt({ min: 0, max: 50 })
    .withMessage('Years of experience must be between 0 and 50'),
  body('highestDegree')
    .notEmpty()
    .withMessage('Highest educational degree is required')
    .isIn(HIGHEST_DEGREE_ALLOWED)
    .withMessage('Invalid highest degree'),
  body('mostSeniorWorkExperience')
    .notEmpty()
    .withMessage('Most senior work experience is required')
    .isIn(['intern', 'entry_level', 'mid_level', 'senior', 'lead', 'manager', 'director', 'vp', 'c_suite'])
    .withMessage('Invalid most senior work experience')
];

const preferencesValidation = [
  body('notifications.email')
    .optional()
    .isBoolean()
    .withMessage('Email notification preference must be a boolean'),
  body('notifications.inApp')
    .optional()
    .isBoolean()
    .withMessage('In-app notification preference must be a boolean'),
  body('privacy.profileVisibility')
    .optional()
    .isIn(['public', 'private', 'connections-only'])
    .withMessage('Invalid profile visibility setting'),
  body('privacy.dataSharing')
    .optional()
    .isBoolean()
    .withMessage('Data sharing preference must be a boolean')
];

const validateStructuredDimension = (field, maxLength, label) => [
  body(field)
    .optional()
    .custom((value) => {
      if (Array.isArray(value)) return true;
      if (value && typeof value === 'object' && Array.isArray(value.raw_items)) return true;
      throw new Error(`${label} must be an array or an object with raw_items`);
    }),
  body(`${field}.raw_items`)
    .optional()
    .isArray()
    .withMessage(`${label} raw_items must be an array`),
  body(`${field}.raw_items.*`)
    .optional()
    .trim()
    .isLength({ min: 1, max: maxLength })
    .withMessage(`${label} item must be 1-${maxLength} characters`),
  body(`${field}.*`)
    .optional()
    .trim()
    .isLength({ min: 1, max: maxLength })
    .withMessage(`${label} item must be 1-${maxLength} characters`)
];

const structuredUserInfoValidation = [
  ...validateStructuredDimension('skillDomains', 120, 'Skill domains'),
  ...validateStructuredDimension('skills', 100, 'Skills'),
  ...validateStructuredDimension('skillsInDevelopment', 100, 'Skills in development'),
  ...validateStructuredDimension('keyResponsibilities', 300, 'Key responsibilities'),
  ...validateStructuredDimension('domains', 120, 'Domains'),
];

const reviewSaveUserIdentityValidation = [
  userIdentityFieldRequired('userIdentity.workEnjoyMost'),
  userIdentityFieldRequired('userIdentity.topicsIndustriesInterest'),
  userIdentityFieldRequired('userIdentity.naturallyGoodAt'),
  userIdentityFieldRequired('userIdentity.workEnvironmentFit'),
  userIdentityFieldRequired('userIdentity.workingLifeAchievement'),
];

const reviewSaveSeniorityValidation = [
  body('seniority.currentStatus')
    .notEmpty()
    .withMessage('Current employment status is required')
    .isIn(CURRENT_EMPLOYMENT_STATUS_ALLOWED)
    .withMessage('Invalid current employment status'),
  body('seniority.yearsOfExperience')
    .optional()
    .isInt({ min: 0, max: 50 })
    .withMessage('Years of experience must be between 0 and 50'),
  body('seniority.highestDegree')
    .notEmpty()
    .withMessage('Highest educational degree is required')
    .isIn(HIGHEST_DEGREE_ALLOWED)
    .withMessage('Invalid highest degree'),
  body('seniority.mostSeniorWorkExperience')
    .notEmpty()
    .withMessage('Most senior work experience is required')
    .isIn(['intern', 'entry_level', 'mid_level', 'senior', 'lead', 'manager', 'director', 'vp', 'c_suite'])
    .withMessage('Invalid most senior work experience'),
];

const STRUCTURED_GOOD_AT_KEYS = [
  'skillDomains',
  'skills',
  'skillsInDevelopment',
  'keyResponsibilities',
  'domains',
];

const STRUCTURED_GOOD_AT_LABELS = {
  skillDomains: 'Skill domains',
  skills: 'Skills',
  skillsInDevelopment: 'Skills in development',
  keyResponsibilities: 'Key responsibilities',
  domains: 'Domains',
};

const countStructuredCategoryItems = (items, key) => {
  if (!Array.isArray(items)) return 0;
  let count = 0;
  for (const item of items) {
    const raw = key === 'skills'
      ? (typeof item === 'string' ? item : item?.name)
      : item;
    if (String(raw ?? '').trim()) count += 1;
  }
  return count;
};

const reviewSaveStructuredCategoryRequired = (key) => body(`structuredUserInfo.${key}`)
  .custom((items) => {
    const label = STRUCTURED_GOOD_AT_LABELS[key] || key;
    if (countStructuredCategoryItems(items, key) === 0) {
      throw new Error(`${label} requires at least one entry`);
    }
    return true;
  });

const reviewSaveStructuredValidation = [
  ...STRUCTURED_GOOD_AT_KEYS.map((key) => reviewSaveStructuredCategoryRequired(key)),
  ...validateStructuredDimension('structuredUserInfo.skillDomains', 120, 'Skill domains'),
  ...validateStructuredDimension('structuredUserInfo.skills', 100, 'Skills'),
  ...validateStructuredDimension('structuredUserInfo.skillsInDevelopment', 100, 'Skills in development'),
  ...validateStructuredDimension('structuredUserInfo.keyResponsibilities', 300, 'Key responsibilities'),
  ...validateStructuredDimension('structuredUserInfo.domains', 120, 'Domains'),
];

const reviewSaveValidation = [
  body('mode')
    .optional()
    .isIn(['merge', 'replace'])
    .withMessage('Mode must be merge or replace'),
  body('name')
    .optional({ values: 'null' })
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  ...reviewSaveSeniorityValidation,
  ...reviewSaveUserIdentityValidation,
  ...reviewSaveStructuredValidation,
  body('documentId')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 128 })
    .withMessage('documentId must be a string'),
  body('acceptedFields')
    .optional()
    .isObject()
    .withMessage('acceptedFields must be an object'),
];

// Routes
router.get('/', auth, profileController.getProfile);
router.get('/completion', auth, profileController.getProfileCompletion);

router.post('/input-quality-diagnosis', auth, ...requireVerifiedProfile, profileController.diagnoseProfileInputQuality);
router.post('/work-enjoy-coaching', auth, ...requireVerifiedProfile, profileController.postWorkEnjoyCoaching);
router.post('/topics-industries-coaching', auth, ...requireVerifiedProfile, profileController.postTopicsIndustriesCoaching);
router.post('/naturally-good-at-coaching', auth, ...requireVerifiedProfile, profileController.postNaturallyGoodAtCoaching);
router.post('/work-environment-coaching', auth, ...requireVerifiedProfile, profileController.postWorkEnvironmentCoaching);
router.post('/working-life-achievement-coaching', auth, ...requireVerifiedProfile, profileController.postWorkingLifeAchievementCoaching);
router.get('/role-skills', auth, ...requireVerifiedProfile, profileController.getRoleSkillsForSelection);
router.post('/role-skills/search', auth, ...requireVerifiedProfile, profileController.searchRoleSkillsForSelection);
router.post('/role-skills/resolve', auth, ...requireVerifiedProfile, profileController.resolveRoleSkillsForSelection);
router.get('/role-skill-domains', auth, ...requireVerifiedProfile, profileController.getRoleSkillDomainsForSelection);
router.post('/role-skill-domains/search', auth, ...requireVerifiedProfile, profileController.searchRoleSkillDomainsForSelection);
router.post('/role-fit-explanation', auth, ...requireSimulationAccess, profileController.postRoleFitExplanation);

router.put('/name',
  auth,
  ...requireVerifiedProfile,
  profileNameValidation,
  profileController.updateProfileName
);

router.put('/user-identity',
  auth,
  ...requireVerifiedProfile,
  userIdentityValidation,
  profileController.updateUserIdentity
);

router.put('/seniority',
  auth,
  ...requireVerifiedProfile,
  seniorityValidation,
  profileController.updateSeniority
);

router.put('/preferences',
  auth,
  ...requireVerifiedProfile,
  preferencesValidation,
  profileController.updatePreferences
);

router.put('/structured-user-info',
  auth,
  ...requireVerifiedProfile,
  structuredUserInfoValidation,
  profileController.updateStructuredUserInfo
);

router.put('/review-save',
  auth,
  ...requireVerifiedProfile,
  reviewSaveValidation,
  profileController.saveProfileReview
);

router.put('/review-narrative-cache',
  auth,
  ...requireVerifiedProfile,
  body('documentId')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('documentId is required'),
  body('acceptedFields')
    .optional()
    .isObject()
    .withMessage('acceptedFields must be an object'),
  profileController.warmReviewNarrativeCache
);

router.get('/narratives-status',
  auth,
  ...requireVerifiedProfile,
  profileController.getProfileNarrativesStatus
);

router.put('/profile-picture',
  auth,
  ...requireVerifiedProfile,
  upload.single('profilePicture'),
  profileController.updateProfilePicture
);

router.delete('/profile-picture',
  auth,
  ...requireVerifiedProfile,
  profileController.deleteProfilePicture
);

// Simulation endpoint (async job start)
router.post('/simulation', auth, ...requireSimulationAccess, profileController.startSimulation);
router.post('/simulation/start', auth, ...requireSimulationAccess, profileController.startSimulation);
router.get('/simulation/jobs/:jobId/status', auth, ...requireSimulationAccess, profileController.getSimulationJobStatus);
router.get(
  '/simulation/jobs/:jobId/events',
  auth.attachAccessTokenFromQuery,
  auth,
  ...requireSimulationAccess,
  profileController.streamSimulationJobEvents
);
router.get('/simulation/jobs/:jobId/result', auth, ...requireSimulationAccess, profileController.getSimulationJobResult);
// Get last simulation result endpoint
router.get('/simulation/last', auth, ...requireSimulationAccess, profileController.getLastSimulationResult);

// Migration endpoint (should be protected by admin auth in production)
router.post('/migrate-career-inputs', profileController.recalculateAllCareerSimulationInputs);

// New: Update career simulation inputs (manual edit)
router.put('/career-simulation-inputs', auth, ...requireVerifiedProfile, profileController.updateCareerSimulationInputs);

// ===== SIMULATION RESULTS MANAGEMENT ROUTES =====

// Save current simulation results
router.post('/simulation/save', auth, ...requireSimulationAccess, profileController.saveSimulationResult);

// Get list of saved simulations
router.get('/simulation/saved', auth, ...requireSimulationAccess, profileController.getSavedSimulations);

// Get specific saved simulation
router.get('/simulation/saved/:id', auth, ...requireSimulationAccess, profileController.getSavedSimulation);

// Update simulation metadata (name)
router.put('/simulation/saved/:id', auth, ...requireSimulationAccess, profileController.updateSavedSimulation);

// Delete saved simulation
router.delete('/simulation/saved/:id', auth, ...requireSimulationAccess, profileController.deleteSimulationResult);

// Archive simulation
router.put('/simulation/saved/:id/archive', auth, ...requireSimulationAccess, profileController.archiveSavedSimulation);

// === SAVE CAREER STEP ROUTES ===
router.post('/saved-career-steps', auth, ...requireSimulationAccess, profileController.saveCareerStep);
router.patch('/saved-career-steps/:stepId', auth, ...requireSimulationAccess, profileController.patchSavedCareerStep);
router.post('/saved-career-steps/bulk-delete', auth, ...requireSimulationAccess, profileController.bulkDeleteSavedCareerSteps);
router.delete('/saved-career-steps/:stepId', auth, ...requireSimulationAccess, profileController.removeCareerStep);
router.get('/saved-career-steps', auth, ...requireSimulationAccess, profileController.getSavedCareerSteps);
router.get('/saved-career-steps/:stepId', auth, ...requireSimulationAccess, profileController.getSavedCareerStep);

// === REMOVE CAREER STEP FROM SIMULATION RESULTS ===
router.delete('/simulation-results/:simulationId/career-steps/:stepId', auth, ...requireSimulationAccess, profileController.removeCareerStepFromSimulation);

// === REPLACE CAREER STEP WITH NEXT BEST ALTERNATIVE ===
router.post('/simulation/:simulationId/replace-career-step/:stepId', auth, ...requireSimulationAccess, profileController.replaceCareerStep);

// === UPDATE EXISTING SIMULATION RESULTS ===
// Update existing simulation with changes (save changes functionality)
router.put('/simulation-results/:simulationId', auth, ...requireSimulationAccess, profileController.updateSimulationResult);

// Debug route to catch unmatched requests
router.all('/simulation-results/*', (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

module.exports = router; 