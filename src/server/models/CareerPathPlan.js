const mongoose = require('mongoose');

/**
 * A user's generated career path plan for a specific role, per language.
 * Keyed by userId + escoId + language so a role has one persisted plan per language,
 * recognized across every entry point (role details, simulation results, ranking).
 */
const careerPathPlanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Normalized ESCO occupation id (lowercased/trimmed) — the canonical role key.
    escoId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 512,
      index: true,
    },
    // Language the plan text was generated in ('de' plans use informal du-form).
    language: {
      type: String,
      enum: ['en', 'de'],
      default: 'en',
      index: true,
    },
    // Localized role title snapshot for display when re-opening the overview.
    roleTitle: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Generated structured roadmap shown in CareerPathOverview.
    pathPlan: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    // Questionnaire answers used to generate the plan (enables resume/restart).
    answers: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Resolved questionnaire audience ('pupil' | 'student' | 'career' | 'senior').
    audience: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

careerPathPlanSchema.index({ userId: 1, escoId: 1, language: 1 }, { unique: true });

module.exports = mongoose.model('CareerPathPlan', careerPathPlanSchema);
