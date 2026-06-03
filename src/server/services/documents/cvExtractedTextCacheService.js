/**
 * Short-lived cache of parsed CV plain text (worker → deferred enrichment reuse).
 * Never expose cached text to clients.
 */

const mongoose = require('mongoose');
const CvExtractedTextCache = require('../../models/CvExtractedTextCache');
const { parseDocumentToTextWithMeta } = require('./documentProfileEnrichment');
const logger = require('../../utils/logger');
const {
  CV_EXTRACTED_TEXT_PARSER_VERSION,
  CV_EXTRACTED_TEXT_MAX_BYTES,
  CV_EXTRACTED_TEXT_SOURCES,
  readCvExtractedTextCacheTtlHours,
  readCvReuseExtractedTextEnabled,
} = require('../../../constants/cvExtractedTextCache');

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(String(value));
}

function normalizeSource(value) {
  const s = String(value || 'unknown').trim().slice(0, 32);
  return CV_EXTRACTED_TEXT_SOURCES.includes(s) ? s : 'unknown';
}

function cacheExpiresAt() {
  const hours = readCvExtractedTextCacheTtlHours();
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * @param {string} raw
 * @returns {{ text: string, truncated: boolean, textLength: number }}
 */
function capPlainText(raw) {
  const text = String(raw || '');
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= CV_EXTRACTED_TEXT_MAX_BYTES) {
    return { text, truncated: false, textLength: text.length };
  }
  const capped = buf.subarray(0, CV_EXTRACTED_TEXT_MAX_BYTES).toString('utf8');
  return { text: capped, truncated: true, textLength: capped.length };
}

/**
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @param {string|mongoose.Types.ObjectId} params.documentId
 * @param {string} params.text
 * @param {string} [params.source]
 * @param {string} [params.jobId]
 * @param {string|null} [params.storageKey]
 */
async function upsertCvExtractedTextCache(params) {
  const userId = toObjectId(params.userId);
  const documentId = toObjectId(params.documentId);
  const { text, truncated, textLength } = capPlainText(params.text);
  if (!text.trim()) {
    return { upserted: false, reason: 'empty_text' };
  }

  if (truncated) {
    logger.warn('cv_extracted_text_cache_truncated', {
      userId: String(userId),
      documentId: String(documentId),
      originalBytes: Buffer.byteLength(String(params.text || ''), 'utf8'),
      maxBytes: CV_EXTRACTED_TEXT_MAX_BYTES,
    });
  }

  await CvExtractedTextCache.findOneAndUpdate(
    { userId, documentId },
    {
      $set: {
        text,
        textLength,
        source: normalizeSource(params.source),
        parserVersion: CV_EXTRACTED_TEXT_PARSER_VERSION,
        jobId: params.jobId != null ? String(params.jobId).slice(0, 64) : null,
        storageKey: params.storageKey != null ? String(params.storageKey).slice(0, 128) : null,
        expiresAt: cacheExpiresAt(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { upserted: true, textLength, truncated };
}

/**
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} documentId
 */
async function getCachedCvExtractedText(userId, documentId) {
  if (!readCvReuseExtractedTextEnabled()) return null;

  const row = await CvExtractedTextCache.findOne({
    userId: toObjectId(userId),
    documentId: toObjectId(documentId),
    expiresAt: { $gt: new Date() },
    parserVersion: CV_EXTRACTED_TEXT_PARSER_VERSION,
  })
    .select({ text: 1, source: 1, textLength: 1 })
    .lean();

  if (!row?.text || !String(row.text).trim()) return null;
  return {
    text: String(row.text),
    source: row.source || 'unknown',
    textLength: row.textLength ?? String(row.text).length,
  };
}

/**
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} documentId
 */
async function deleteCvExtractedTextCacheForDocument(userId, documentId) {
  const res = await CvExtractedTextCache.deleteOne({
    userId: toObjectId(userId),
    documentId: toObjectId(documentId),
  });
  return { deleted: (res.deletedCount ?? 0) > 0 };
}

/**
 * Resolve plain CV text: cache hit, or parse file and optionally repopulate cache.
 *
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @param {string|mongoose.Types.ObjectId} params.documentId
 * @param {string} params.filePath
 * @param {{ repopulateCache?: boolean, jobId?: string, storageKey?: string|null }} [options]
 * @returns {Promise<{ text: string, fromCache: boolean, source: string }>}
 */
async function resolveCvDocumentPlainText(params, options = {}) {
  const userId = params.userId;
  const documentId = params.documentId;
  const filePath = params.filePath;

  const cached = await getCachedCvExtractedText(userId, documentId);
  if (cached) {
    return {
      text: cached.text,
      fromCache: true,
      source: cached.source,
    };
  }

  const parsed = await parseDocumentToTextWithMeta(filePath);
  const safeText = String(parsed.text || '');

  if (options.repopulateCache && safeText.trim()) {
    try {
      await upsertCvExtractedTextCache({
        userId,
        documentId,
        text: safeText,
        source: parsed.source,
        jobId: options.jobId,
        storageKey: options.storageKey,
      });
    } catch (err) {
      logger.warn('cv_extracted_text_cache_repopulate_failed', {
        userId: String(userId),
        documentId: String(documentId),
        message: err?.message || String(err),
      });
    }
  }

  return {
    text: safeText,
    fromCache: false,
    source: parsed.source,
  };
}

module.exports = {
  upsertCvExtractedTextCache,
  getCachedCvExtractedText,
  deleteCvExtractedTextCacheForDocument,
  resolveCvDocumentPlainText,
  capPlainText,
  cacheExpiresAt,
};
