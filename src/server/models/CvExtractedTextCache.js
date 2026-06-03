const mongoose = require('mongoose');

const cvExtractedTextCacheSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
      maxlength: 262144,
    },
    textLength: {
      type: Number,
      required: true,
      min: 0,
    },
    source: {
      type: String,
      default: 'unknown',
      maxlength: 32,
    },
    parserVersion: {
      type: String,
      default: '1',
      maxlength: 16,
    },
    jobId: {
      type: String,
      default: null,
      maxlength: 64,
    },
    storageKey: {
      type: String,
      default: null,
      maxlength: 128,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

cvExtractedTextCacheSchema.index({ userId: 1, documentId: 1 }, { unique: true });
cvExtractedTextCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('CvExtractedTextCache', cvExtractedTextCacheSchema);
