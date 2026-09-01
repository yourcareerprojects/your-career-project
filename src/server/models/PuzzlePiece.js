const mongoose = require('mongoose');
const { PUZZLE_CATEGORIES } = require('../../constants/puzzleCategories');

const LocalizedStringSchema = new mongoose.Schema(
  {
    en: { type: String, required: true, trim: true },
    de: { type: String, default: null, trim: true },
  },
  { _id: false }
);

const EstimatedSalarySchema = new mongoose.Schema(
  {
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    currency: { type: String, default: 'EUR' },
  },
  { _id: false }
);

const PuzzlePieceSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
    category: {
      type: String,
      required: true,
      enum: PUZZLE_CATEGORIES,
      index: true,
    },
    title: { type: LocalizedStringSchema, required: true },
    shortDescription: {
      type: LocalizedStringSchema,
      default: () => ({ en: '', de: null }),
    },
    localeScope: {
      type: [String],
      default: ['de'],
    },
    careerPathId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CareerPath',
      default: null,
    },
    escoId: {
      type: String,
      default: null,
      trim: true,
      maxlength: 512,
      index: true,
      sparse: true,
    },
    tags: { type: [String], default: [] },
    visual: {
      icon: { type: String, default: null },
      colorToken: { type: String, default: null },
    },
    status: {
      type: String,
      enum: ['active', 'deprecated'],
      default: 'active',
      index: true,
    },
    version: { type: Number, default: 1 },
    metadata: {
      estimatedDurationMonths: { type: Number, default: null },
      estimatedSalary: { type: EstimatedSalarySchema, default: null },
      requiredSkills: { type: [String], default: [] },
    },
  },
  { timestamps: true }
);

PuzzlePieceSchema.index({ category: 1, status: 1 });

module.exports = mongoose.model('PuzzlePiece', PuzzlePieceSchema);
