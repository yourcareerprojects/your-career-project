const mongoose = require('mongoose');

const LocalizedLabelSchema = new mongoose.Schema({
  en: { type: String, required: true },
  de: { type: String, default: null },
}, { _id: false });

const EscoSkillSchema = new mongoose.Schema(
  {
    uri: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    label: { type: LocalizedLabelSchema, required: true },
    skillType: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('EscoSkill', EscoSkillSchema);
