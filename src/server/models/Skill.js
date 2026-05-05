const mongoose = require('mongoose');

const LocalizedLabelSchema = new mongoose.Schema({
  en: { type: String, required: true },
  de: { type: String, default: null },
}, { _id: false });

const SkillSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9_]+$/,
      index: true,
    },
    label: { type: LocalizedLabelSchema, required: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('Skill', SkillSchema);
