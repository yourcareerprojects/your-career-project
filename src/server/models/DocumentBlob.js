const mongoose = require('mongoose');

const documentBlobSchema = new mongoose.Schema(
  {
    storageKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    originalName: { type: String, default: '' },
    mimeType: { type: String, default: 'application/octet-stream' },
    extension: { type: String, default: '' },
    size: { type: Number, default: 0 },
    data: { type: Buffer, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DocumentBlob', documentBlobSchema);
