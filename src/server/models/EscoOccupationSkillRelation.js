const mongoose = require('mongoose');

const EscoOccupationSkillRelationSchema = new mongoose.Schema(
  {
    occupationUri: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    skillUri: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    relationType: {
      type: String,
      required: true,
      enum: ['essential', 'optional'],
    },
    skillType: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

EscoOccupationSkillRelationSchema.index(
  { occupationUri: 1, skillUri: 1 },
  { unique: true }
);
EscoOccupationSkillRelationSchema.index({ occupationUri: 1, relationType: 1 });

module.exports = mongoose.model('EscoOccupationSkillRelation', EscoOccupationSkillRelationSchema);
