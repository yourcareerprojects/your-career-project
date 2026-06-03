const express = require('express');
const { body } = require('express-validator');
const documentController = require('../controllers/documentController');
const auth = require('../middleware/auth');
const { persistValidatedDocumentUpload } = require('../middleware/persistValidatedDocumentUpload');
const { DOCUMENT_TYPE_UPLOAD_API_VALUES } = require('../../constants/documentTypes');
const { enforceDocumentUploadLimits } = require('../middleware/documentUploadRateLimit');
const { createDocumentUploadMulter } = require('../config/cvUploadTempStorage');
const { attachCvUploadTempCleanup } = require('../middleware/cvUploadTempCleanup');

const router = express.Router();

const upload = createDocumentUploadMulter();

// Validation middleware
const documentUploadValidation = [
  body('documentType')
    .trim()
    .isIn(DOCUMENT_TYPE_UPLOAD_API_VALUES)
    .withMessage('Invalid document type'),
  body('description')
    .optional()
    .trim()
    .isLength({ min: 3, max: 500 })
    .withMessage('Description must be between 3 and 500 characters')
];

const documentStatusValidation = [
  body('status')
    .trim()
    .isIn(['pending', 'verified', 'rejected'])
    .withMessage('Invalid document status'),
  body('verificationNotes')
    .optional()
    .trim()
    .isLength({ min: 3, max: 1000 })
    .withMessage('Verification notes must be between 3 and 1000 characters')
];

// Routes
router.post('/upload',
  auth,
  upload.single('document'),
  attachCvUploadTempCleanup,
  enforceDocumentUploadLimits,
  persistValidatedDocumentUpload,
  documentUploadValidation,
  documentController.uploadDocument
);

router.get('/',
  auth,
  documentController.getUserDocuments
);

router.get('/:documentId/extraction-status',
  auth,
  documentController.getDocumentExtractionStatus
);

router.post('/:documentId/ensure-semantic-enrichment',
  auth,
  documentController.ensureDocumentCvStructuredSemantic
);

router.post('/:documentId/ensure-localization',
  auth,
  documentController.ensureDocumentCvExtractLocalization
);

router.get('/:documentId/narrative-cache-status',
  auth,
  documentController.getDocumentNarrativeCacheStatus
);

router.post('/:documentId/narrative-cache-status',
  auth,
  documentController.getDocumentNarrativeCacheStatus
);

router.post('/:documentId/retry-extraction',
  auth,
  documentController.retryDocumentExtraction
);

router.get('/:documentId',
  auth,
  documentController.getDocument
);

router.get('/:documentId/download',
  auth,
  documentController.downloadDocument
);

router.delete('/:documentId',
  auth,
  documentController.deleteDocument
);

router.patch('/:documentId/status',
  auth,
  documentStatusValidation,
  documentController.updateDocumentStatus
);

router.patch('/:documentId/rename',
  auth,
  documentController.renameDocument
);

module.exports = router;
module.exports.documentUploadValidation = documentUploadValidation; 