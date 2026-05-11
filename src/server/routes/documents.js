const express = require('express');
const { body } = require('express-validator');
const multer = require('multer');
const documentController = require('../controllers/documentController');
const auth = require('../middleware/auth');
const { persistValidatedDocumentUpload } = require('../middleware/persistValidatedDocumentUpload');

const router = express.Router();

// Memory storage: reject invalid types/size before anything hits disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/jpeg',
      'image/png',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          'Invalid file type. Only PDF, DOCX, DOC, TXT, JPG, JPEG, and PNG files are allowed.'
        )
      );
    }
  },
});

// Validation middleware
const documentUploadValidation = [
  body('documentType')
    .trim()
    .isIn(['resume', 'certificate', 'transcript', 'portfolio', 'other'])
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
  persistValidatedDocumentUpload,
  documentUploadValidation,
  documentController.uploadDocument
);

router.get('/',
  auth,
  documentController.getUserDocuments
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