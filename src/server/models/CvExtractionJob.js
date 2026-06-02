const mongoose = require('mongoose');

const { CV_JOB_LANGUAGES } = require('../services/documents/cvExtractionJobLanguage');

const JOB_STATUSES = ['queued', 'processing', 'completed', 'failed'];
const JOB_STAGES = ['upload', 'ocr', 'extraction', 'localization'];

const cvExtractionJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      maxlength: 64,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Snapshot UI locale at job creation — worker must not read live user.language. */
    language: {
      type: String,
      enum: CV_JOB_LANGUAGES,
      required: true,
      default: 'en',
    },
    status: {
      type: String,
      enum: JOB_STATUSES,
      default: 'queued',
      index: true,
    },
    stage: {
      type: String,
      enum: JOB_STAGES,
      default: 'upload',
    },
    /** @deprecated Legacy plain-text error — do not expose to clients; use errorKey + internalError. */
    error: {
      type: String,
      default: '',
      maxlength: 8000,
    },
    errorKey: {
      type: String,
      default: null,
      maxlength: 64,
    },
    internalError: {
      message: { type: String, maxlength: 2000 },
      stack: { type: String, maxlength: 8000 },
      code: { type: String, maxlength: 120 },
      provider: { type: String, maxlength: 64 },
      httpStatus: { type: Number },
      name: { type: String, maxlength: 120 },
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    /** Set when status becomes `processing` (for stale-job reclaim). */
    processingStartedAt: {
      type: Date,
      default: null,
    },
    /** Incremented each time a worker claims this job (legacy rows: treat as 0). */
    attemptCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

cvExtractionJobSchema.index({ documentId: 1, createdAt: -1 });
cvExtractionJobSchema.index({ documentId: 1, status: 1 });
cvExtractionJobSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('CvExtractionJob', cvExtractionJobSchema);
module.exports.JOB_STATUSES = JOB_STATUSES;
module.exports.JOB_STAGES = JOB_STAGES;
