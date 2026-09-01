const mongoose = require('mongoose');

const RELATION_TYPES = [
  'progresses_to',
  'qualifies_for',
  'specializes_in',
  'pivots_to',
];

const PuzzleEdgeSchema = new mongoose.Schema(
  {
    fromPieceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PuzzlePiece',
      required: true,
      index: true,
    },
    toPieceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PuzzlePiece',
      required: true,
      index: true,
    },
    relationType: {
      type: String,
      enum: RELATION_TYPES,
      default: 'progresses_to',
    },
    weight: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['active', 'disabled'],
      default: 'active',
      index: true,
    },
    conditions: {
      minDegreeKeys: { type: [String], default: [] },
      minExperienceKeys: { type: [String], default: [] },
    },
    metadata: {
      durationMonths: { type: Number, default: null },
      note: { type: String, default: null },
      // 'curated' = DACH seed; 'rule' = ESCO hybrid materialization
      source: {
        type: String,
        enum: ['curated', 'rule'],
        default: 'curated',
      },
      ruleId: { type: String, default: null },
    },
  },
  { timestamps: true }
);

PuzzleEdgeSchema.index({ fromPieceId: 1, status: 1, weight: -1 });
PuzzleEdgeSchema.index(
  { fromPieceId: 1, toPieceId: 1, relationType: 1 },
  { unique: true }
);

module.exports = mongoose.model('PuzzleEdge', PuzzleEdgeSchema);
module.exports.RELATION_TYPES = RELATION_TYPES;
