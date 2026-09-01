const mongoose = require('mongoose');

/**
 * Per-user Career Identity state.
 * Traits are identity facets; careers and other interactions appear only as evidence.
 * Confidence is recomputed by the Identity Engine — never hand-edited via API.
 */

const IdentityEvidenceSchema = new mongoose.Schema(
  {
    evidenceId: { type: String, required: true },
    sourceType: {
      type: String,
      enum: [
        'career',
        'reflection',
        'conversation',
        'cv',
        'assessment',
        'experience',
        'education',
        'simulation',
        'profile',
      ],
      required: true,
    },
    sourceId: { type: String, required: true },
    weight: { type: Number, default: 1, min: 0, max: 1 },
    /** Semantic match strength 0–1; used for confidence scoring, not exposed via API. */
    matchStrength: { type: Number, default: null, min: 0, max: 1 },
    /**
     * Supporting vs against-evidence. User rejects use "negative" so confidence is downgraded.
     */
    polarity: {
      type: String,
      enum: ['positive', 'negative'],
      default: 'positive',
    },
    timestamp: { type: Date, default: Date.now },
    explanation: {
      en: { type: String, default: '' },
      de: { type: String, default: null },
    },
    label: {
      en: { type: String, default: '' },
      de: { type: String, default: null },
    },
  },
  { _id: false }
);

const IdentityTraitVoteSchema = new mongoose.Schema(
  {
    traitId: { type: String, required: true, trim: true },
    /** confirm = fits well; unsure = keep collecting; reject = does not fit */
    vote: {
      type: String,
      enum: ['confirm', 'unsure', 'reject'],
      required: true,
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const IdentityTraitSnapshotSchema = new mongoose.Schema(
  {
    traitId: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    /** Derived 0–1 confidence; refreshed by the engine. */
    confidence: { type: Number, default: 0, min: 0, max: 1 },
    /**
     * Puzzle layer derived from confidence thresholds.
     * "confirmed" = established identity; "emerging" = developing pattern.
     * Traits below the emerging threshold are not stored as puzzle pieces.
     */
    layer: {
      type: String,
      enum: ['confirmed', 'emerging'],
      default: undefined,
    },
    evidenceCount: { type: Number, default: 0, min: 0 },
    evidence: { type: [IdentityEvidenceSchema], default: [] },
    lastUpdated: { type: Date, default: Date.now },
  },
  { _id: false }
);

const IdentityConnectionSchema = new mongoose.Schema(
  {
    fromTraitId: { type: String, required: true },
    toTraitId: { type: String, required: true },
    /** 0–1 strength; grows as both traits gain confidence. */
    strength: { type: Number, default: 0.2, min: 0, max: 1 },
  },
  { _id: false }
);

/**
 * Lightweight Identity Evolution snapshot piece.
 * Intentionally omits evidence / labels — comparison only needs identity deltas.
 * See snapshotService.js for format versioning.
 */
const LightweightIdentityPieceSchema = new mongoose.Schema(
  {
    traitId: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    /** 0–1 confidence at capture time. */
    confidence: { type: Number, required: true, min: 0, max: 1 },
    layer: {
      type: String,
      enum: ['confirmed', 'emerging'],
      default: undefined,
    },
  },
  { _id: false }
);

/**
 * Per-domain summary derived from pieces at capture time.
 * Stored explicitly so domain diffs do not require rescanning pieces.
 */
const IdentityDomainSnapshotSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, trim: true },
    pieceCount: { type: Number, default: 0, min: 0 },
    maxConfidence: { type: Number, default: 0, min: 0, max: 1 },
  },
  { _id: false }
);

/**
 * Prior identity state for evolution / exploration gating.
 * Not written automatically yet — callers use snapshotService.saveSnapshot().
 */
const LastIdentitySnapshotSchema = new mongoose.Schema(
  {
    /**
     * Snapshot format version. Bump when the shape changes;
     * snapshotService.migrateSnapshot() upgrades older documents on read.
     */
    version: { type: Number, required: true, default: 1, min: 1 },
    capturedAt: { type: Date, required: true },
    pieces: { type: [LightweightIdentityPieceSchema], default: [] },
    domains: { type: [IdentityDomainSnapshotSchema], default: [] },
  },
  { _id: false }
);

const CareerIdentityProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    traits: { type: [IdentityTraitSnapshotSchema], default: [] },
    connections: { type: [IdentityConnectionSchema], default: [] },
    /**
     * Explicit user feedback on puzzle pieces ("Passt das zu dir?").
     * Injected as assessment evidence on refresh — never written to confidence directly.
     */
    traitVotes: { type: [IdentityTraitVoteSchema], default: [] },
    /**
     * Last identity snapshot used as the exploration accumulation baseline.
     * Lightweight: pieces + confidence + domains + timestamp only.
     * Seeded on the first run and advanced only after fresh role suggestions.
     */
    lastIdentitySnapshot: { type: LastIdentitySnapshotSchema, default: undefined },
    /**
     * Set once the user finishes both rankings on their first simulation.
     * Until then, exploration only reseeds the baseline and never delivers roles.
     */
    explorationAccumulationUnlockedAt: { type: Date, default: null },
    /**
     * Most recent exploration session produced by the identity pipeline.
     * Full payload lives in IdentityExplorationSession.
     */
    lastExplorationSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'IdentityExplorationSession',
      default: undefined,
    },
    lastRefreshedAt: { type: Date, default: null },
    /** Hash of user source fields; drift triggers recompute. */
    sourceFingerprint: { type: String, default: '' },
    /**
     * Hash of catalog / thresholds / embeddings / matching constants.
     * Drift triggers recompute even when user data is unchanged (e.g. after deploy).
     */
    engineFingerprint: { type: String, default: '' },
    language: {
      type: String,
      enum: ['en', 'de'],
      default: 'de',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CareerIdentityProfile', CareerIdentityProfileSchema);
