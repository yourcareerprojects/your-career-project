const mongoose = require('mongoose');

const SnapshotEndDateSchema = new mongoose.Schema(
  {
    month: { type: Number, min: 1, max: 12, default: null },
    year: { type: Number, min: 1900, max: 2100, default: null },
  },
  { _id: false }
);

const SnapshotSchema = new mongoose.Schema(
  {
    title: {
      en: { type: String, default: '' },
      de: { type: String, default: null },
    },
    shortDescription: {
      en: { type: String, default: '' },
      de: { type: String, default: null },
    },
    category: { type: String, default: '' },
    endDate: { type: SnapshotEndDateSchema, default: null },
  },
  { _id: false }
);

const PuzzleNodeSchema = new mongoose.Schema(
  {
    instanceId: { type: String, required: true },
    pieceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PuzzlePiece',
      required: true,
    },
    pieceKey: { type: String, required: true, trim: true },
    parentInstanceId: { type: String, default: null },
    locked: { type: Boolean, default: false },
    source: {
      type: String,
      enum: ['profile', 'user', 'ai_suggestion'],
      default: 'user',
    },
    addedAt: { type: Date, default: Date.now },
    snapshot: { type: SnapshotSchema, default: () => ({}) },
  },
  { _id: false }
);

const PuzzlePathSchema = new mongoose.Schema(
  {
    pathId: { type: String, required: true },
    title: { type: String, default: null },
    isFavorite: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    nodes: { type: [PuzzleNodeSchema], default: [] },
  },
  { _id: false }
);

const CareerPuzzleSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    market: {
      type: String,
      default: 'dach',
    },
    language: {
      type: String,
      enum: ['en', 'de'],
      default: 'de',
    },
    activePathId: {
      type: String,
      required: true,
    },
    paths: {
      type: [PuzzlePathSchema],
      default: [],
    },
    comparisonPathIds: {
      type: [String],
      default: [],
    },
    uiMode: {
      type: String,
      enum: ['spine', 'timeline', 'graph'],
      default: 'spine',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CareerPuzzle', CareerPuzzleSchema);
