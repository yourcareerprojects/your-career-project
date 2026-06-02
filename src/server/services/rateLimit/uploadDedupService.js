const crypto = require('crypto');
const fs = require('fs');
const mongoose = require('mongoose');
const logger = require('../../utils/logger');
const UploadContentFingerprint = require('../../models/UploadContentFingerprint');
const CvExtractionJob = require('../../models/CvExtractionJob');
const User = require('../../models/User');
const { DEDUPE_WINDOW_MS } = require('../../config/rateLimitConfig');
const { ACTIVE_JOB_STATUSES } = require('./RateLimitService');

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(String(value));
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
function computeUploadContentHash(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return '';
  }
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * SHA-256 of file contents via stream (no full-file buffer).
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function computeUploadContentHashFromPath(filePath) {
  const p = String(filePath || '').trim();
  if (!p) return Promise.resolve('');

  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(p);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} contentHash
 * @returns {Promise<{ documentId: string, jobId: string|null, document: object }|null>}
 */
async function findActiveDuplicateUpload(userId, contentHash) {
  const hash = String(contentHash || '').trim();
  if (!hash) return null;

  const uid = toObjectId(userId);
  const now = new Date();
  const fingerprint = await UploadContentFingerprint.findOne({
    userId: uid,
    contentHash: hash,
    isActive: true,
    expiresAt: { $gt: now },
  }).lean();

  if (!fingerprint) return null;

  const documentId = String(fingerprint.documentId);
  const jobId = fingerprint.jobId ? String(fingerprint.jobId) : null;

  if (jobId) {
    const job = await CvExtractionJob.findOne({ jobId }).select({ status: 1 }).lean();
    if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) {
      await UploadContentFingerprint.updateOne(
        { _id: fingerprint._id },
        { $set: { isActive: false } }
      );
      return null;
    }
  }

  const user = await User.findById(uid).select({ 'profile.documents': 1 }).lean();
  const doc = user?.profile?.documents?.find((d) => String(d._id) === documentId);
  if (!doc) {
    return null;
  }

  logger.warn({
    type: 'UPLOAD_DEDUPE_HIT',
    userId: String(uid),
    contentHash: hash.slice(0, 12),
    documentId,
    jobId,
  });

  return {
    documentId,
    jobId,
    document: doc,
  };
}

/**
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.userId
 * @param {string} params.contentHash
 * @param {string|import('mongoose').Types.ObjectId} params.documentId
 * @param {string|null} [params.jobId]
 */
async function registerUploadFingerprint({ userId, contentHash, documentId, jobId = null }) {
  const hash = String(contentHash || '').trim();
  if (!hash) return;

  const expiresAt = new Date(Date.now() + DEDUPE_WINDOW_MS);
  await UploadContentFingerprint.findOneAndUpdate(
    { userId: toObjectId(userId), contentHash: hash },
    {
      $set: {
        documentId: toObjectId(documentId),
        jobId: jobId ? String(jobId) : null,
        isActive: true,
        expiresAt,
      },
    },
    { upsert: true, new: true }
  );
}

/**
 * @param {string} jobId
 */
async function deactivateFingerprintByJobId(jobId) {
  if (!jobId) return;
  await UploadContentFingerprint.updateMany(
    { jobId: String(jobId) },
    { $set: { isActive: false } }
  );
}

module.exports = {
  computeUploadContentHash,
  computeUploadContentHashFromPath,
  findActiveDuplicateUpload,
  registerUploadFingerprint,
  deactivateFingerprintByJobId,
};
