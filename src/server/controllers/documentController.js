const fs = require('fs').promises;
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const User = require('../models/User');
const {
  normalizeDocumentType,
  isCvDocumentType,
} = require('../../constants/documentTypes');
const { validationResult } = require('express-validator');
const {
  createExtractionJob,
  findLatestCvExtractionJobForUserDocument,
  retryCvExtractionForDocument,
} = require('../services/documents/cvExtractionJobService');
const { buildCvExtractionStatusResponse } = require('../services/documents/cvExtractionStatus');
const { getPublicWorkerHealthForExtractionStatus } = require('../services/documents/cvExtractionZombieSignals');
const { resolveJobSnapshotLanguage } = require('../services/documents/cvExtractionJobLanguage');
const {
  hrtimeDiffMs,
  THRESHOLD_UPLOAD_TOTAL_MS,
  warnSlowOperation,
  serializeErrorSafe,
} = require('../utils/metricsLogger');
const { serializeEmbeddedDocumentForClient } = require('../services/documents/serializeEmbeddedDocument');
const {
  storeDocumentFromPath,
  sendStoredDocumentDownload,
  deleteStoredDocumentBlob,
} = require('../services/documents/documentBlobStorage');

// Helper function to validate file type (must stay aligned with routes/documents.js)
const isValidFileType = (file) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/jpeg',
    'image/png',
  ];
  return allowedTypes.includes(file.mimetype);
};

const documentController = {
  // Upload a new document
  async uploadDocument(req, res) {
    const uploadHrStart = process.hrtime.bigint();
    let storedBlobMeta = null;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const { documentType: rawDocumentType, description } = req.body;
      const normalizedType = normalizeDocumentType(rawDocumentType);
      const file = req.file;

      if (!isValidFileType(file)) {
        // Delete the uploaded file if it's not valid
        await fs.unlink(file.path);
        return res.status(400).json({ message: 'Invalid file type' });
      }

      const user = await User.findById(req.user.userId);
      if (!user) {
        await fs.unlink(file.path);
        return res.status(404).json({ message: 'User not found' });
      }

      storedBlobMeta = await storeDocumentFromPath(file, {
        originalName: file.originalname,
        mimeType: file.mimetype,
      });

      const document = {
        type: normalizedType,
        name: file.originalname,
        path: file.path,
        storageProvider: storedBlobMeta?.storageProvider || null,
        storageKey: storedBlobMeta?.storageKey || null,
        mimeType: storedBlobMeta?.mimeType || file.mimetype || null,
        uploadDate: new Date(),
        isArchived: false,
        version: 1,
        description,
        status: 'pending' // pending, verified, rejected
      };

      // Add document to user's documents array
      user.profile.documents.push(document);
      await user.save();

      const savedDoc = user.profile.documents[user.profile.documents.length - 1];
      logger.info('document uploaded', {
        requestId: req.requestId,
        documentId: String(savedDoc._id),
        storedType: normalizedType,
        userId: String(user._id),
      });

      const isCvUpload = isCvDocumentType(rawDocumentType);
      let extractionJob = null;

      if (isCvUpload) {
        try {
          const { getRateLimitService } = require('../services/rateLimit/RateLimitService');
          const { registerUploadFingerprint } = require('../services/rateLimit/uploadDedupService');
          await getRateLimitService().assertJobCreationAllowed(user._id);
          const jobLanguage = resolveJobSnapshotLanguage({
            requestLang: req.query.lang,
            userLanguage: user.language,
          });
          extractionJob = await createExtractionJob(savedDoc._id, user._id, jobLanguage);
          logger.info({
            event: 'EXTRACTION_JOB_CREATED',
            requestId: req.requestId,
            jobId: extractionJob.jobId,
            documentId: String(savedDoc._id),
            userId: String(user._id),
            language: extractionJob.language,
            source: 'snapshot',
          });
          if (req.uploadContentHash) {
            await registerUploadFingerprint({
              userId: user._id,
              contentHash: req.uploadContentHash,
              documentId: savedDoc._id,
              jobId: extractionJob.jobId,
            });
          }
          const embedded = user.profile.documents.id(savedDoc._id);
          if (embedded) {
            embedded.extractionStatus = 'queued';
          }
          await user.save();
          logger.info('extraction job queued', {
            requestId: req.requestId,
            jobId: extractionJob.jobId,
            documentId: String(savedDoc._id),
            userId: String(user._id),
          });
        } catch (jobErr) {
          const RateLimitError = require('../services/rateLimit/RateLimitError');
          const { getRateLimitService: getRl } = require('../services/rateLimit/RateLimitService');
          if (jobErr instanceof RateLimitError) {
            user.profile.documents.pull(savedDoc._id);
            await user.save();
            try {
              await fs.unlink(file.path);
            } catch (unlinkErr) {
              logger.error('Document upload rollback unlink failed', unlinkErr);
            }
            if (storedBlobMeta) {
              await deleteStoredDocumentBlob(document).catch(() => {});
            }
            getRl().logRateLimitHit({
              type: 'RATE_LIMIT_HIT',
              userId: String(user._id),
              limitType: jobErr.limitType,
            });
            return res.status(jobErr.statusCode).json(jobErr.toJSON());
          }
          logger.error('cv_extraction_job_create_failed', {
            requestId: req.requestId,
            documentId: String(savedDoc._id),
            userId: String(user._id),
            ...serializeErrorSafe(jobErr),
            ...(jobErr instanceof Error ? { stack: jobErr.stack } : {}),
          });
          user.profile.documents.pull(savedDoc._id);
          await user.save();
          try {
            await fs.unlink(file.path);
          } catch (unlinkAfterJobFail) {
            logger.error('Document upload rollback unlink failed', unlinkAfterJobFail);
          }
          if (storedBlobMeta) {
            await deleteStoredDocumentBlob(document).catch(() => {});
          }
          return res.status(500).json({ message: 'Could not queue CV processing' });
        }
      }

      const totalUploadMs = hrtimeDiffMs(uploadHrStart);
      if (totalUploadMs > THRESHOLD_UPLOAD_TOTAL_MS) {
        warnSlowOperation('cv_upload_handler_total', totalUploadMs, THRESHOLD_UPLOAD_TOTAL_MS);
      }

      logger.info('upload completed', {
        requestId: req.requestId,
        documentId: String(savedDoc._id),
        documentType: rawDocumentType,
        storedType: normalizedType,
        asyncProcessing: isCvUpload ? 'cv_extraction_queued' : 'none',
        queuedCvExtraction: Boolean(extractionJob),
      });

      logger.info('cv_upload_request_summary', {
        requestId: req.requestId,
        documentType: rawDocumentType,
        storedType: normalizedType,
        mimeType: file.mimetype,
        fileSize: typeof file.size === 'number' ? file.size : null,
        totalDurationMs: Math.round(totalUploadMs * 1000) / 1000,
        success: true,
        ocrUsed: false,
        extractionStatus: isCvUpload ? 'queued' : null,
        jobId: extractionJob?.jobId ?? null,
        localizationStatus: null,
        translationCalls: null,
        translationTotalMs: null,
        openaiCalls: null,
        openaiTotalMs: null,
      });

      const responseExtractionStatus = isCvUpload ? 'queued' : null;

      res.status(201).json({
        message: 'Document uploaded successfully',
        documentId: savedDoc._id,
        jobId: extractionJob?.jobId ?? null,
        extractionStatus: responseExtractionStatus,
        document: {
          id: savedDoc._id,
          type: savedDoc.type,
          name: savedDoc.name,
          path: savedDoc.path,
          storageProvider: savedDoc.storageProvider ?? null,
          storageKey: savedDoc.storageKey ?? null,
          mimeType: savedDoc.mimeType ?? null,
          uploadDate: savedDoc.uploadDate,
          isArchived: savedDoc.isArchived,
          version: savedDoc.version,
          description: savedDoc.description,
          status: savedDoc.status,
          extractionStatus: isCvUpload ? 'queued' : null,
        },
        extractedProfileData: null,
        extractionMessage: null,
        extractionMessageKey: null,
        cvExtractLocalization: null,
        semanticInterpretation: null,
        semanticInterpretationLanguage: null,
        localizationStatus: null,
      });
    } catch (error) {
      const totalUploadMs = hrtimeDiffMs(uploadHrStart);
      logger.error('Document upload handler failed', {
        requestId: req.requestId,
        totalDurationMs: Math.round(totalUploadMs * 1000) / 1000,
        ...serializeErrorSafe(error),
        ...(error instanceof Error ? { stack: error.stack } : {}),
      });
      if (totalUploadMs > THRESHOLD_UPLOAD_TOTAL_MS) {
        warnSlowOperation('cv_upload_handler_total_failed', totalUploadMs, THRESHOLD_UPLOAD_TOTAL_MS);
      }
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          logger.error('Document upload rollback unlink failed', unlinkError);
        }
      }
      if (storedBlobMeta) {
        await deleteStoredDocumentBlob(storedBlobMeta).catch(() => {});
      }
      res.status(500).json({ message: 'Error uploading document' });
    }
  },

  // Get all documents for a user
  async getUserDocuments(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const documents = user.profile.documents.map((doc) => serializeEmbeddedDocumentForClient(doc));

      res.json({ documents });
    } catch (error) {
      console.error('Get documents error:', error);
      res.status(500).json({ message: 'Error retrieving documents' });
    }
  },

  // Get a specific document
  async getDocument(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const document = user.profile.documents.id(req.params.documentId);
      if (!document) {
        return res.status(404).json({ message: 'Document not found' });
      }

      res.json({
        document: serializeEmbeddedDocumentForClient(document),
      });
    } catch (error) {
      console.error('Get document error:', error);
      res.status(500).json({ message: 'Error retrieving document' });
    }
  },

  async getDocumentExtractionStatus(req, res) {
    const documentIdParam = req.params.documentId;
    try {
      if (!mongoose.Types.ObjectId.isValid(documentIdParam)) {
        return res.status(400).json({ message: 'Invalid document id' });
      }

      const documentObjectId = new mongoose.Types.ObjectId(documentIdParam);
      // Positional projection ($) returns only the matching embedded document from
      // profile.documents, avoiding loading the full array on frequent status polls.
      const user = await User.findOne(
        { _id: req.user.userId, 'profile.documents._id': documentObjectId },
        { 'profile.documents.$': 1 }
      ).lean();
      if (!user) {
        const userExists = await User.exists({ _id: req.user.userId });
        if (!userExists) {
          return res.status(404).json({ message: 'User not found' });
        }
        return res.status(404).json({ message: 'Document not found' });
      }

      const doc = user.profile?.documents?.[0];
      if (!doc) {
        return res.status(404).json({ message: 'Document not found' });
      }

      const job = await findLatestCvExtractionJobForUserDocument(req.user.userId, documentIdParam);
      const { workerHealthSignal } = await getPublicWorkerHealthForExtractionStatus();
      const payload = buildCvExtractionStatusResponse({
        documentId: documentIdParam,
        doc,
        job,
        workerHealthSignal,
      });

      return res.json(payload);
    } catch (err) {
      logger.error('get_document_extraction_status_failed', {
        documentId: String(documentIdParam || ''),
        ...serializeErrorSafe(err),
      });
      return res.status(500).json({ message: 'Error retrieving extraction status' });
    }
  },

  async retryDocumentExtraction(req, res) {
    const documentIdParam = req.params.documentId;
    try {
      if (!mongoose.Types.ObjectId.isValid(documentIdParam)) {
        return res.status(400).json({ message: 'Invalid document id' });
      }

      const documentObjectId = new mongoose.Types.ObjectId(documentIdParam);
      const user = await User.findOne(
        { _id: req.user.userId, 'profile.documents._id': documentObjectId },
        { 'profile.documents.$': 1, language: 1 }
      );
      if (!user) {
        const userExists = await User.exists({ _id: req.user.userId });
        if (!userExists) {
          return res.status(404).json({ message: 'User not found' });
        }
        return res.status(404).json({ message: 'Document not found' });
      }

      const doc = user.profile?.documents?.[0];
      if (!doc) {
        return res.status(404).json({ message: 'Document not found' });
      }

      const jobLanguage = resolveJobSnapshotLanguage({
        requestLang: req.query.lang,
        userLanguage: user.language,
      });

      const result = await retryCvExtractionForDocument({
        userId: req.user.userId,
        documentId: documentIdParam,
        doc: doc.toObject ? doc.toObject() : doc,
        language: jobLanguage,
      });

      if (!result.ok) {
        const statusByCode = {
          NOT_CV: 400,
          NOT_FOUND: 404,
          ALREADY_COMPLETED: 409,
          MAX_RETRIES: 422,
        };
        return res.status(statusByCode[result.code] || 400).json({
          message: result.message,
          code: result.code,
        });
      }

      return res.json({
        action: result.action,
        jobId: result.job?.jobId ?? null,
        extractionStatus: result.statusPayload,
        ...(result.retryRecommended !== undefined
          ? { retryRecommended: result.retryRecommended }
          : {}),
      });
    } catch (err) {
      const RateLimitError = require('../services/rateLimit/RateLimitError');
      if (err instanceof RateLimitError) {
        return res.status(err.statusCode).json(err.toJSON());
      }
      logger.error('retry_document_extraction_failed', {
        documentId: String(documentIdParam || ''),
        ...serializeErrorSafe(err),
      });
      return res.status(500).json({ message: 'Could not retry extraction' });
    }
  },

  // Download a document
  async downloadDocument(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const document = user.profile.documents.id(req.params.documentId);
      if (!document) {
        return res.status(404).json({ message: 'Document not found' });
      }

      const sentFromStorage = await sendStoredDocumentDownload(res, document);
      if (sentFromStorage) return;

      // Check if file exists
      try {
        await fs.access(document.path);
      } catch (error) {
        return res.status(404).json({ message: 'Document file not found' });
      }

      res.download(document.path, document.name || document.originalName || 'document.pdf');
    } catch (error) {
      console.error('Download document error:', error);
      res.status(500).json({ message: 'Error downloading document' });
    }
  },

  // Delete a document
  async deleteDocument(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const docToDelete = user.profile.documents.id(req.params.documentId);
      if (!docToDelete) {
        return res.status(404).json({ message: 'Document not found' });
      }

      // Delete file from filesystem
      try {
        await fs.unlink(docToDelete.path);
      } catch (error) {
        console.error('Error deleting file:', error);
      }
      await deleteStoredDocumentBlob(docToDelete).catch(() => {});

      // Remove document from user's documents array
      user.profile.documents.pull(req.params.documentId);
      await user.save();

      res.json({ message: 'Document deleted successfully' });
    } catch (error) {
      console.error('Delete document error:', error);
      res.status(500).json({ message: 'Error deleting document' });
    }
  },

  // Update document status (for admin/verification purposes)
  async updateDocumentStatus(req, res) {
    try {
      const { status, verificationNotes } = req.body;
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const docToUpdate = user.profile.documents.id(req.params.documentId);
      if (!docToUpdate) {
        return res.status(404).json({ message: 'Document not found' });
      }

      docToUpdate.status = status;
      if (verificationNotes) {
        docToUpdate.verificationNotes = verificationNotes;
      }
      docToUpdate.verifiedAt = new Date();

      await user.save();

      res.json({
        message: 'Document status updated successfully',
        document: {
          id: docToUpdate._id,
          status: docToUpdate.status,
          verificationNotes: docToUpdate.verificationNotes,
          verifiedAt: docToUpdate.verifiedAt
        }
      });
    } catch (error) {
      console.error('Update document status error:', error);
      res.status(500).json({ message: 'Error updating document status' });
    }
  },

  // Rename (update description) of a document
  async renameDocument(req, res) {
    try {
      const { description } = req.body;
      if (!description || typeof description !== 'string' || description.trim().length < 1) {
        return res.status(400).json({ message: 'Description is required.' });
      }
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      const docToRename = user.profile.documents.id(req.params.documentId);
      if (!docToRename) {
        return res.status(404).json({ message: 'Document not found' });
      }
      docToRename.description = description.trim();
      await user.save();
      res.json({
        message: 'Document description updated successfully',
        document: {
          id: docToRename._id,
          description: docToRename.description
        }
      });
    } catch (error) {
      console.error('Rename document error:', error);
      res.status(500).json({ message: 'Error renaming document' });
    }
  }
};

module.exports = documentController;
