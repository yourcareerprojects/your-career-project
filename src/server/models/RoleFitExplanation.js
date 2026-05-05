const mongoose = require('mongoose');

const roleFitExplanationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    roleId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 512,
      index: true,
    },
    language: {
      type: String,
      enum: ['en', 'de'],
      required: true,
      index: true,
    },
    traitsHash: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
    roleContextHash: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
    simulationScopeKey: {
      type: String,
      default: '',
      trim: true,
      maxlength: 512,
      index: true,
    },
    text: {
      type: String,
      required: true,
      maxlength: 12000,
    },
    source: {
      type: String,
      enum: ['llm', 'fallback'],
      required: true,
    },
  },
  { timestamps: true }
);

roleFitExplanationSchema.index(
  {
    userId: 1,
    roleId: 1,
    language: 1,
    traitsHash: 1,
    roleContextHash: 1,
    simulationScopeKey: 1,
  },
  { unique: true }
);

module.exports = mongoose.model('RoleFitExplanation', roleFitExplanationSchema);
