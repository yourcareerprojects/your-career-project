const mongoose = require('mongoose');

const uploadContentFingerprintSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    contentHash: {
      type: String,
      required: true,
      maxlength: 64,
      index: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    jobId: {
      type: String,
      default: null,
      maxlength: 64,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

uploadContentFingerprintSchema.index({ userId: 1, contentHash: 1 }, { unique: true });
uploadContentFingerprintSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('UploadContentFingerprint', uploadContentFingerprintSchema);
