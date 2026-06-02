const logger = require('../utils/logger');
const { getRateLimitService } = require('../services/rateLimit/RateLimitService');
const RateLimitError = require('../services/rateLimit/RateLimitError');
const {
  computeUploadContentHashFromPath,
  findActiveDuplicateUpload,
} = require('../services/rateLimit/uploadDedupService');
const { serializeEmbeddedDocumentForClient } = require('../services/documents/serializeEmbeddedDocument');
const { unlinkCvUploadTempFile } = require('../config/cvUploadTempStorage');

async function discardCvUploadTemp(req) {
  const tempPath = req.cvUploadTempPath || req.file?.path;
  if (!tempPath || req.cvUploadTempConsumed) return;
  await unlinkCvUploadTempFile(tempPath).catch(() => {});
  req.cvUploadTempConsumed = true;
}

/**
 * Ingress protection: rate limits, concurrency, dedupe (content hash from temp file path).
 * Must run after `auth` + `upload.single()` and before `persistValidatedDocumentUpload`.
 */
async function enforceDocumentUploadLimits(req, res, next) {
  const userId = req.user?.userId;
  if (!userId) {
    await discardCvUploadTemp(req);
    return res.status(401).json({ error: 'No authentication token, access denied' });
  }

  const rateLimitService = getRateLimitService();

  try {
    await rateLimitService.assertUploadLimitsOnly(userId);

    const filePath = req.file?.path;
    if (filePath) {
      const contentHash = await computeUploadContentHashFromPath(filePath);
      req.uploadContentHash = contentHash;

      const duplicate = await findActiveDuplicateUpload(userId, contentHash);
      if (duplicate) {
        await discardCvUploadTemp(req);
        const serialized = serializeEmbeddedDocumentForClient({
          ...duplicate.document,
          _id: duplicate.document._id,
        });
        return res.status(200).json({
          message: 'Document already being processed',
          documentId: duplicate.documentId,
          jobId: duplicate.jobId,
          deduplicated: true,
          extractionStatus: duplicate.document.extractionStatus === 'processing'
            ? 'processing'
            : 'queued',
          document: {
            ...serialized,
            id: duplicate.documentId,
          },
          extractedProfileData: null,
          extractionMessage: null,
          extractionMessageKey: null,
          cvExtractLocalization: null,
          semanticInterpretation: null,
          semanticInterpretationLanguage: null,
          localizationStatus: null,
        });
      }
    }

    await rateLimitService.recordUploadAttempt(userId);
    return next();
  } catch (err) {
    await discardCvUploadTemp(req);
    if (err instanceof RateLimitError) {
      rateLimitService.logRateLimitHit({
        type: 'RATE_LIMIT_HIT',
        userId,
        limitType: err.limitType,
      });
      return res.status(err.statusCode).json(err.toJSON());
    }
    logger.error('document_upload_rate_limit_middleware_error', {
      userId: String(userId),
      message: String(err?.message || err),
    });
    return res.status(500).json({ message: 'Upload could not be processed' });
  }
}

module.exports = {
  enforceDocumentUploadLimits,
};
