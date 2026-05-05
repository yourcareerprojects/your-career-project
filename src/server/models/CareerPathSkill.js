const mongoose = require('mongoose');

const CareerPathSkillSchema = new mongoose.Schema(
  {
    careerPathId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CareerPath',
      required: true,
      index: true,
    },
    skillId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Skill',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['required', 'optional'],
    },
    order_index: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

CareerPathSkillSchema.index({ careerPathId: 1, skillId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('CareerPathSkill', CareerPathSkillSchema);
