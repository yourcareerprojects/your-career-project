const mongoose = require('mongoose');

/** Embedded UI copy: English required; German optional (null if not translated). */
const LocalizedStringSchema = new mongoose.Schema({
  en: { type: String, required: true },
  de: { type: String, default: null },
}, { _id: false });

const SkillModelSchema = new mongoose.Schema({
  // Skills essential to perform this role (all ESCO essential skills)
  core_skills: [{ type: String }],
  // Skills that are beneficial but not strictly required
  optional_skills: [{ type: String }],
  // Relevance weight (0.1–1.0) for every skill in core + optional
  skill_weights: { type: Map, of: Number, default: {} },
  // Confidence that the extracted model accurately represents the role (0.0–1.0)
  extraction_confidence: { type: Number, default: 0 },
  // When this skill model was last built
  built_at: { type: Date },
  // Method used: "esco_csv" | "llm" | "manual"
  built_with: { type: String, default: 'esco_csv' }
}, { _id: false });

const SenioritySchema = new mongoose.Schema({
  // Integer 0–6 (see seniority scale)
  seniority_level: { type: Number, min: 0, max: 6 },
  // Human-readable label (e.g. "Mid-level", "Senior")
  seniority_label: { type: String },
  // 1–2 sentence explanation of the classification
  seniority_reasoning: { type: String },
  // Confidence that the inferred level is accurate (0.0–1.0)
  extraction_confidence: { type: Number, default: 0 },
  // When this seniority was last inferred
  built_at: { type: Date },
  // Method used: "heuristic" | "llm" | "manual"
  built_with: { type: String, default: 'heuristic' }
}, { _id: false });

const KeyResponsibilitiesSchema = new mongoose.Schema({
  // Extracted verb-led responsibility statements (3–6 items)
  responsibilities: [{ type: String }],
  // Confidence that the extraction accurately represents the role (0.0–1.0)
  extraction_confidence: { type: Number, default: 0 },
  // When this extraction was last performed
  built_at: { type: Date },
  // Method used: "llm" | "heuristic" | "manual"
  built_with: { type: String, default: 'llm' }
}, { _id: false });

const SkillDomainItemSchema = new mongoose.Schema({
  // High-level competency cluster name (e.g. "Data Analysis", "Stakeholder Communication")
  domain: { type: LocalizedStringSchema, required: true },
  // How important this domain is for the role: "core" | "important" | "supporting"
  importance: { type: String, enum: ['core', 'important', 'supporting'], required: true },
  // Skills and/or responsibilities that map into this domain
  mapped_items: [{ type: String }]
}, { _id: false });

const SkillDomainsSchema = new mongoose.Schema({
  // Array of 4–12 skill domain clusters
  skill_domains: [SkillDomainItemSchema],
  // Confidence that the extraction accurately represents the role (0.0–1.0)
  extraction_confidence: { type: Number, default: 0 },
  // When this extraction was last performed
  built_at: { type: Date },
  // Method used: "llm" | "heuristic" | "manual"
  built_with: { type: String, default: 'llm' }
}, { _id: false });

const RoleIdentitySchema = new mongoose.Schema({
  // Structured text representation optimised for embedding into a dense vector
  // This field is intentionally English-only (canonical for embeddings).
  role_identity_text: { type: String, required: true },
  // Optional: representative narrative for display (e.g. after role deduplication merge)
  human_readable_identity: { type: String },
  // SHA-256 hash (16 hex chars) of the input fields — enables change detection
  input_hash: { type: String },
  // Confidence that the generated text accurately represents the role (0.0–1.0)
  extraction_confidence: { type: Number, default: 0 },
  // When this identity text was last generated
  built_at: { type: Date },
  // Method used: "deterministic" | "llm"
  built_with: { type: String, default: 'deterministic' }
}, { _id: false });

const RoleVectorsSchema = new mongoose.Schema({
  // Category sub-vectors for mode-specific fusion at scoring time (each L2-normalized).
  // Field order matches fusion / embed order; mode weights applied at scoring.
  structured_vector_occupation_group: { type: [Number], default: null },
  structured_vector_skill_domains: { type: [Number], default: null },
  structured_vector_responsibilities: { type: [Number], default: null },
  structured_vector_required_skills: { type: [Number], default: null },
  structured_vector_optional_skills: { type: [Number], default: null },
  structured_vector_seniority: { type: [Number], default: null },
  // Embedding of role identity text (semantic representation)
  identity_vector: { type: [Number], default: null },
  // Weighted fusion: 0.6 * structured + 0.4 * identity, L2-normalized (legacy; mode-specific fusion at scoring)
  hybrid_vector: { type: [Number], default: null },
  // When these vectors were last built
  built_at: { type: Date },
  // Embedding dimension (3072 for text-embedding-3-large)
  dims: { type: Number, default: 3072 }
}, { _id: false });

const CareerPathSchema = new mongoose.Schema({
  escoId: { type: String, required: true, unique: true }, // ESCO occupation URI or code
  // ESCO occupation metadata (from CSV)
  code: { type: String }, // ESCO "code" column (if present)
  iscoGroup: { type: String }, // ESCO iscoGroup code (e.g. "2654")
  title: { type: LocalizedStringSchema, required: true },
  altTitles: [{ type: String }], // ESCO altLabels split into array
  hiddenTitles: [{ type: String }], // ESCO hiddenLabels split into array
  altTitlesDe: [{ type: String }], // German localized alternative titles
  hiddenTitlesDe: [{ type: String }], // German localized hidden titles
  description: { type: LocalizedStringSchema, default: undefined },
  // Store skill TITLES for display/UI and text matching
  requiredSkills: [{ type: String }],
  // Store skill URIs for traceability/enrichment/backfilling titles
  requiredSkillUris: [{ type: String }],
  // Normalized keys for matching/filtering (lowercased, punctuation-stripped)
  requiredSkillKeys: [{ type: String }],
  // --- Structured skill model for matching algorithm ---
  skillModel: { type: SkillModelSchema, default: null },
  // --- Seniority classification for filtering/matching ---
  seniority: { type: SenioritySchema, default: null },
  // --- Extracted key responsibilities for semantic matching ---
  keyResponsibilities: { type: KeyResponsibilitiesSchema, default: null },
  // German localized key responsibilities (mirrors keyResponsibilities.responsibilities order)
  keyResponsibilitiesDe: [{ type: String }],
  // --- Derived skill domains for role-to-user matching and explainability ---
  skillDomains: { type: SkillDomainsSchema, default: null },
  // --- Structured identity text for semantic embedding ---
  roleIdentity: { type: RoleIdentitySchema, default: null },
  // --- Hybrid role vectors for matching (structured + identity fusion) ---
  roleVectors: { type: RoleVectorsSchema, default: null },
  // Provenance (helps data quality / audits)
  source: { type: String, default: 'ESCO' },
  sourceVersion: { type: String, default: 'v1.2.0' },
  importedFrom: { type: String }, // "csv" | "api"
  lastUpdated: { type: Date, default: Date.now },
  // Non-canonical ESCO URIs merged into this document (deduplication traceability)
  mergedFromEscoIds: [{ type: String }]
});

// Add indexes for better query performance
CareerPathSchema.index({ 'title.en': 1 });
CareerPathSchema.index({ requiredSkills: 1 });
CareerPathSchema.index({ requiredSkillUris: 1 });
CareerPathSchema.index({ requiredSkillKeys: 1 });
CareerPathSchema.index({ iscoGroup: 1 });
CareerPathSchema.index({ 'skillModel.core_skills': 1 });
CareerPathSchema.index({ 'seniority.seniority_level': 1 });
CareerPathSchema.index({ 'skillDomains.skill_domains.domain.en': 1 });
CareerPathSchema.index({ 'skillDomains.skill_domains.importance': 1 });
CareerPathSchema.index({ 'roleIdentity.input_hash': 1 });

module.exports = mongoose.model('CareerPath', CareerPathSchema); 