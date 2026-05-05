const express = require('express');
const { body } = require('express-validator');
const multer = require('multer');
const path = require('path');
const { CURRENT_EMPLOYMENT_STATUS_ALLOWED } = require('../../constants/currentEmploymentStatus');
const { HIGHEST_DEGREE_ALLOWED } = require('../../constants/highestDegree');
const profileController = require('../controllers/profileController');
const auth = require('../middleware/auth');
const requireVerifiedEmail = require('../middleware/requireVerifiedEmail');

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
  body('excludedDerivedInferredIscoCodes')
    .optional()
    .isArray()
    .withMessage('Excluded inferred ISCO codes must be an array'),
  body('excludedDerivedInferredIscoCodes.*')
    .optional()
    .trim()
    .matches(/^\d{1,4}$/)
    .withMessage('Excluded inferred ISCO code must be 1-4 digits')
];

// Routes
router.get('/', auth, profileController.getProfile);
router.get('/completion', auth, profileController.getProfileCompletion);

router.post('/input-quality-diagnosis', auth, profileController.diagnoseProfileInputQuality);
router.post('/role-fit-explanation', auth, profileController.postRoleFitExplanation);

router.put('/name',
  auth,
  profileNameValidation,
  profileController.updateProfileName
);

router.put('/user-identity',
  auth,
  userIdentityValidation,
  profileController.updateUserIdentity
);

router.put('/seniority',
  auth,
  seniorityValidation,
  profileController.updateSeniority
);

router.put('/preferences',
  auth,
  preferencesValidation,
  profileController.updatePreferences
);

router.put('/structured-user-info',
  auth,
  structuredUserInfoValidation,
  profileController.updateStructuredUserInfo
);

router.put('/profile-picture',
  auth,
  upload.single('profilePicture'),
  profileController.updateProfilePicture
);

router.delete('/profile-picture',
  auth,
  profileController.deleteProfilePicture
);

// Simulation endpoint
router.post('/simulation', auth, profileController.runSimulation);
// Get last simulation result endpoint
router.get('/simulation/last', auth, profileController.getLastSimulationResult);

// Migration endpoint (should be protected by admin auth in production)
router.post('/migrate-career-inputs', profileController.recalculateAllCareerSimulationInputs);

// New: Update career simulation inputs (manual edit)
router.put('/career-simulation-inputs', auth, profileController.updateCareerSimulationInputs);

// New: Recalculate career simulation inputs from profile
router.post('/career-simulation-inputs/recalculate', auth, profileController.recalculateCareerSimulationInputs);

// ===== SIMULATION RESULTS MANAGEMENT ROUTES =====

// Save current simulation results
router.post('/simulation/save', auth, requireVerifiedEmail, profileController.saveSimulationResult);

// Get list of saved simulations
router.get('/simulation/saved', auth, profileController.getSavedSimulations);

// Get specific saved simulation
router.get('/simulation/saved/:id', auth, profileController.getSavedSimulation);

// Update simulation metadata (name)
router.put('/simulation/saved/:id', auth, profileController.updateSavedSimulation);

// Delete saved simulation
router.delete('/simulation/saved/:id', auth, profileController.deleteSimulationResult);

// Archive simulation
router.put('/simulation/saved/:id/archive', auth, profileController.archiveSavedSimulation);

// === SAVE CAREER STEP ROUTES ===
router.post('/saved-career-steps', auth, requireVerifiedEmail, profileController.saveCareerStep);
router.patch('/saved-career-steps/:stepId', auth, requireVerifiedEmail, profileController.patchSavedCareerStep);
router.post('/saved-career-steps/bulk-delete', auth, requireVerifiedEmail, profileController.bulkDeleteSavedCareerSteps);
router.delete('/saved-career-steps/:stepId', auth, requireVerifiedEmail, profileController.removeCareerStep);
router.get('/saved-career-steps', auth, profileController.getSavedCareerSteps);
router.get('/saved-career-steps/:stepId', auth, profileController.getSavedCareerStep);

// === REMOVE CAREER STEP FROM SIMULATION RESULTS ===
router.delete('/simulation-results/:simulationId/career-steps/:stepId', auth, profileController.removeCareerStepFromSimulation);

// === REPLACE CAREER STEP WITH NEXT BEST ALTERNATIVE ===
router.post('/simulation/:simulationId/replace-career-step/:stepId', auth, profileController.replaceCareerStep);

// === UPDATE EXISTING SIMULATION RESULTS ===
// Update existing simulation with changes (save changes functionality)
router.put('/simulation-results/:simulationId', auth, requireVerifiedEmail, profileController.updateSimulationResult);

// Debug route to catch unmatched requests
router.all('/simulation-results/*', (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

module.exports = router; 