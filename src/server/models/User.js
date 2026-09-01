const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { CURRENT_EMPLOYMENT_STATUS_ENUM_WITH_EMPTY } = require('../../constants/currentEmploymentStatus');
const { HIGHEST_DEGREE_ENUM_WITH_EMPTY } = require('../../constants/highestDegree');
const { DOCUMENT_TYPE_SCHEMA_ENUM } = require('../../constants/documentTypes');

const securityEventSchema = new mongoose.Schema({
  type: { type: String, required: true },
  status: { type: String, enum: ['success', 'failure'], default: 'success' },
  ip: String,
  userAgent: String,
  metadata: mongoose.Schema.Types.Mixed,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const localizedAiContentSchema = new mongoose.Schema({
  en: { type: String, default: null },
  de: { type: String, default: null },
}, { _id: false });

const narrativeDimensionSchema = new mongoose.Schema({
  raw_items: {
    type: [String],
    default: []
  },
  summary_text: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({ original_language: 'en', original: null, translations: {} }),
  }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: false,
    trim: true,
    maxlength: 100,
    default: ''
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email address!`
    }
  },
  password: {
    type: String,
    required: true,
    minlength: 8
  },
  language: {
    type: String,
    enum: ['en', 'de'],
    default: 'en'
  },
  profile: {
    personalInfo: {
      profilePicture: String,
      bio: String
    },
    seniority: {
      currentStatus: {
        type: String,
        enum: CURRENT_EMPLOYMENT_STATUS_ENUM_WITH_EMPTY,
        default: ''
      },
      yearsOfExperience: { type: Number, default: null },
      highestDegree: {
        type: String,
        enum: HIGHEST_DEGREE_ENUM_WITH_EMPTY,
        default: ''
      },
      mostSeniorWorkExperience: {
        type: String,
        enum: ['', 'intern', 'entry_level', 'mid_level', 'senior', 'lead', 'manager', 'director', 'vp', 'c_suite'],
        default: ''
      }
    },
    careerPreferences: {
      domains: [String],
      workEnvironment: [String],
      locationPreferences: [String],
      workLifeBalance: {
        type: String,
        enum: ['flexible', 'balanced', 'intensive']
      }
    },
    structuredUserInfo: {
      skillDomains: { type: narrativeDimensionSchema, default: () => ({}) },
      skills: { type: narrativeDimensionSchema, default: () => ({}) },
      skillsInDevelopment: { type: narrativeDimensionSchema, default: () => ({}) },
      keyResponsibilities: { type: narrativeDimensionSchema, default: () => ({}) },
      domains: { type: narrativeDimensionSchema, default: () => ({}) },
    },
    /**
     * Bilingual payloads from CV extraction / review merge (documentLanguage + en/de pairs).
     * Display layer prefers these in GET profile when resolving userIdentity for req.language.
     */
    cvExtractLocalization: mongoose.Schema.Types.Mixed,
    /** Canonical answers for user identity embedding (Who are you?) */
    userIdentityAnswers: {
      workEnjoyMost: { type: String, default: '' },
      topicsIndustriesInterest: { type: String, default: '' },
      naturallyGoodAt: { type: String, default: '' },
      workEnvironmentFit: { type: String, default: '' },
      workingLifeAchievement: { type: String, default: '' },
    },
    who_are_you: {
      raw_answers: { type: [String], default: [] },
      summary_text: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({ original_language: 'en', original: null, translations: {} })
      },
      // This field is intentionally English-only (canonical for embeddings).
      identity_embedding_text: { type: String, default: '' },
    },
    documents: [{
      type: {
        type: String,
        enum: DOCUMENT_TYPE_SCHEMA_ENUM
      },
      name: String,
      path: String,
      storageProvider: { type: String, default: null },
      storageKey: { type: String, default: null },
      mimeType: { type: String, default: null },
      uploadDate: Date,
      isArchived: Boolean,
      version: Number,
      description: String,
      status: { type: String, default: 'pending' },
      /** Async CV extraction pipeline (see CvExtractionJob). */
      extractionStatus: { type: String, default: null },
      extractedProfileData: { type: mongoose.Schema.Types.Mixed, default: null },
      /** Pre-generated dimension + who_are_you narratives for review-save (see extractionNarrativeEnrichmentService). */
      narrativeEnrichment: { type: mongoose.Schema.Types.Mixed, default: null },
      cvExtractLocalization: { type: mongoose.Schema.Types.Mixed, default: null },
      extractionMessage: { type: String, default: '' },
      extractionMessageKey: { type: String, default: null },
      localizationStatus: { type: String, default: null },
      semanticInterpretation: { type: mongoose.Schema.Types.Mixed, default: null },
      semanticInterpretationLanguage: { type: String, default: null },
      /** pending | complete | skipped — five-field identity LLM enrichment. */
      identityEnrichmentStatus: { type: String, default: null },
      /** True when Step 2 identity review may open (baseline on document). */
      reviewReady: { type: Boolean, default: false },
      /** pending | complete | skipped — structured semantic LLM enrichment after identity-first extract. */
      semanticEnrichmentStatus: { type: String, default: null },
      /** pending | complete | skipped — dimension/identity narrative cache for review-save. */
      narrativeEnrichmentStatus: { type: String, default: null },
      /** success | partial | failed — outcome of CV extraction (distinct from extractionStatus pipeline). */
      extractionOutcomeStatus: { type: String, default: null },
    }],
    /**
     * One-shot History timeline milestones (set when first achieved).
     * Used to avoid duplicate profile_filled / first_simulation events.
     */
    historyMilestones: {
      filledAt: { type: Date, default: null },
      firstSimulationAt: { type: Date, default: null },
    },
    socialMedia: {
      linkedin: {
        profileId: String,
        lastSync: Date,
        isConnected: Boolean
      }
    },
    // Career Simulation Inputs: fields ordered by vector/sub-vector construction.
    // Structured sub-vector embed order: skill_domains, occupation_group, responsibilities, required_skills, optional_skills (seniority → penalty only)
    // Identity: five self-assessment prompts (see userIdentityAnswers).
    careerSimulationInputs: {
      structuredUserInfo: {
        skillDomains: { type: narrativeDimensionSchema, default: () => ({}) },
        skills: { type: narrativeDimensionSchema, default: () => ({}) },
        skillsInDevelopment: { type: narrativeDimensionSchema, default: () => ({}) },
        keyResponsibilities: { type: narrativeDimensionSchema, default: () => ({}) },
        domains: { type: narrativeDimensionSchema, default: () => ({}) },
      },
      userIdentity: {
        workEnjoyMost: { type: String, default: '' },
        topicsIndustriesInterest: { type: String, default: '' },
        naturallyGoodAt: { type: String, default: '' },
        workEnvironmentFit: { type: String, default: '' },
        workingLifeAchievement: { type: String, default: '' },
      },
      seniority: {
        currentStatus: { type: String, default: '' },
        yearsOfExperience: { type: Number, default: null },
        highestDegree: { type: String, default: '' },
        mostSeniorWorkExperience: { type: String, default: '' }
      },
      /** LLM-composed identity text for embedding; regenerated when userIdentity changes.
       * This field is intentionally English-only (canonical for embeddings).
       */
      embeddingOptimizedUserIdentityText: { type: String, default: '' },
      /** sha256 fingerprint of canonical user identity answers (five fields) */
      embeddingUserIdentitySourceFingerprint: { type: String, default: '' },
      // Document-based enrichment cache (does not overwrite manual edits)
      documentEnrichment: {
        status: { type: String, enum: ['none', 'partial', 'success', 'failed'], default: 'none' },
        message: { type: String, default: '' },
        extractedSkills: { type: [String], default: [] },
        extractedWorkExperience: {
          type: [{
            title: String,
            company: String,
            description: String
          }],
          default: []
        },
        extractedEducation: {
          type: [{
            institution: String,
            degree: String,
            fieldOfStudy: String
          }],
          default: []
        },
        extractedCertifications: { type: [String], default: [] },
        extractedProjects: {
          type: [{
            name: String,
            description: String,
            skills: [String]
          }],
          default: []
        },
        sourceDocumentIds: { type: [String], default: [] },
        lastParsedAt: { type: Date, default: null }
      },
      lastCalculated: Date,
      isManuallyEdited: { type: Boolean, default: false },
      lastManualEdit: Date,
      editHistory: [
        {
          editedAt: Date,
          editor: String, // userId or 'system'
          changes: Object
        }
      ]
    }
  },
  preferences: {
    notifications: {
      email: Boolean,
      inApp: Boolean
    },
    privacy: {
      profileVisibility: {
        type: String,
        enum: ['public', 'private', 'connections-only']
      },
      dataSharing: Boolean
    }
  },
  tokenVersion: {
    type: Number,
    default: 0
  },
  // Canonical email-verification fields. New verification logic should use these.
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: {
    type: String,
    default: null
  },
  emailVerificationExpiresAt: {
    type: Date,
    default: null
  },
  accountStatus: {
    // Deprecated compatibility mirror of `emailVerified`.
    isVerified: {
      type: Boolean,
      default: false
    },
    isActive: {
      type: Boolean,
      default: true
    },
    // Deprecated compatibility mirror of `emailVerificationToken`.
    verificationToken: String,
    // Compatibility archive used by verification idempotency/history behavior.
    verificationTokenHistory: {
      type: [String],
      default: []
    },
    // Deprecated compatibility mirror of `emailVerificationExpiresAt`.
    tokenExpiry: Date,
    // Legacy field retained for backward compatibility with older verification flows.
    verificationAttempts: {
      type: Number,
      default: 0
    },
    lastLogin: Date,
    emailHistory: [{
      email: String,
      changedAt: Date,
      verified: Boolean
    }],
    pendingEmailChange: {
      newEmail: String,
      codeHash: String,
      expiresAt: Date,
      requestedAt: Date,
      lastSentAt: Date,
      attemptsRemaining: Number,
      maxAttempts: Number,
      reauthExpiresAt: Date
    },
    resetPasswordToken: String,
    resetPasswordExpires: Date
  },
  security: {
    lastPasswordChangeAt: {
      type: Date,
      default: Date.now
    },
    lastEmailChangeAt: {
      type: Date,
      default: Date.now
    },
    events: {
      type: [securityEventSchema],
      default: []
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastSimulationResult: {
    results: {
      type: Object,
      default: null
    },
    selectedGoal: {
      type: localizedAiContentSchema,
      default: () => ({ en: null, de: null }),
    },
    date: {
      type: Date,
      default: null
    }
  },
  simulationResults: [{
    id: {
      type: String,
      required: true
    },
    // Versioning for simulation behavior
    algorithmVersion: {
      type: String,
      default: '1'
    },
    scoringVersion: {
      type: String,
      default: '1'
    },
    // Phase 3: embedding provider metadata (optional)
    embeddingProvider: {
      type: String,
      default: 'openai'
    },
    embeddingVersion: {
      type: String,
      default: '1'
    },
    name: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    careerGoal: {
      type: localizedAiContentSchema,
      default: () => ({ en: null, de: null }),
    },
    profileCompletion: {
      type: Number,
      required: true
    },
    profileSnapshot: {
      type: Object,
      required: true
    },
    results: {
      // Echo the simulationId in the results payload for clients
      simulationId: { type: String },
      algorithmVersion: { type: String, default: '1' },
      scoringVersion: { type: String, default: '1' },
      nextSteps: [Object],
      outsideTheBox: [Object],
      furtherAdvice: [Object],
      // New: Prioritized lists for sequential replacement
      prioritizedLists: {
        nextCareerRoles: [Object],
        outsideTheBoxRoles: [Object]
      },
      // Optional: totals for each prioritized list (avoid counting on every request)
      prioritizedListTotals: {
        nextCareerRoles: { type: Number, default: 0 },
        outsideTheBoxRoles: { type: Number, default: 0 }
      },
      // New: Track current positions in each list
      currentPositions: {
        nextCareerRoles: { type: Number, default: 3 },
        outsideTheBoxRoles: { type: Number, default: 3 }
      },
      // New: Track displayed steps per category for limit enforcement
      categoryDisplayCounts: {
        nextSteps: { type: Number, default: 3 },
        outsideTheBox: { type: Number, default: 3 }
      },
      // New: Per-category display limits
      categoryLimits: {
        nextSteps: { type: Number, default: 10 },
        outsideTheBox: { type: Number, default: 10 }
      },
      // Client evaluation + ranking (Keep/Skip/Dislike, ranked rows); Mixed so nested shape can evolve
      evaluationFlow: mongoose.Schema.Types.Mixed
    },
    resultsCount: {
      nextSteps: { type: Number, default: 0 },
      outsideTheBox: { type: Number, default: 0 },
      furtherAdvice: { type: Number, default: 0 }
    },
    replacementPools: {
      nextSteps: [Object],
      outsideTheBox: [Object],
      furtherAdvice: [Object]
    },
    removedSteps: {
      nextSteps: [{
        title: String,
        removedAt: { type: Date, default: Date.now }
      }],
      outsideTheBox: [{
        title: String,
        removedAt: { type: Date, default: Date.now }
      }],
      furtherAdvice: [{
        title: String,
        removedAt: { type: Date, default: Date.now }
      }]
    },
    status: {
      type: String,
      enum: ['active', 'archived', 'deleted'],
      default: 'active'
    }
  }]
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    if (!candidatePassword) {
      return false;
    }
    if (!this.password) {
      console.error('comparePassword: user password is missing for user:', this.email || this._id);
      return false;
    }
    // Ensure password is a string
    if (typeof this.password !== 'string') {
      console.error('comparePassword: password is not a string, type:', typeof this.password, 'for user:', this.email || this._id);
      return false;
    }
    // Try bcrypt comparison - it will handle invalid hash formats gracefully
    const result = await bcrypt.compare(candidatePassword, this.password);
    return result;
  } catch (error) {
    // Log the error but don't expose details to prevent information leakage
    console.error('Password comparison error for user:', this.email || this._id, 'Error type:', error.name);
    return false;
  }
};

// Update email method
userSchema.methods.updateEmail = async function(newEmail) {
  // Add current email to history
  this.accountStatus.emailHistory.push({
    email: this.email,
    changedAt: new Date(),
    verified: this.emailVerified || this.accountStatus.isVerified
  });

  // Update canonical verification fields and keep deprecated mirrors aligned.
  this.email = newEmail;
  this.emailVerified = false;
  this.emailVerificationToken = null;
  this.emailVerificationExpiresAt = null;
  this.accountStatus.isVerified = false;
  this.accountStatus.verificationToken = undefined;
  this.accountStatus.tokenExpiry = undefined;
  this.accountStatus.verificationAttempts = 0;

  return this.save();
};

// Legacy helper kept for backward compatibility with older callers.
userSchema.methods.isVerificationTokenExpired = function() {
  const legacyExpiry = this.accountStatus.tokenExpiry;
  const expiry = this.emailVerificationExpiresAt || legacyExpiry;
  return expiry && expiry < new Date();
};

// Legacy helper kept for backward compatibility with older callers.
userSchema.methods.hasExceededVerificationAttempts = function() {
  return this.accountStatus.verificationAttempts >= 3;
};

// Legacy helper kept for backward compatibility with older callers.
userSchema.methods.resetVerificationAttempts = function() {
  this.accountStatus.verificationAttempts = 0;
  return this.save();
};

// Method to update profile
userSchema.methods.updateProfile = async function(updates) {
  Object.assign(this.profile, updates);
  this.updatedAt = new Date();
  return this.save();
};

// Method to add document
userSchema.methods.addDocument = async function(document) {
  this.profile.documents.push({
    ...document,
    uploadDate: new Date(),
    isArchived: false,
    version: 1
  });
  return this.save();
};

// Method to archive document
userSchema.methods.archiveDocument = async function(documentId) {
  const document = this.profile.documents.id(documentId);
  if (document) {
    document.isArchived = true;
    return this.save();
  }
  throw new Error('Document not found');
};

// Method to update LinkedIn data
userSchema.methods.updateLinkedInData = async function(linkedInData) {
  this.profile.socialMedia.linkedin = {
    ...this.profile.socialMedia.linkedin,
    ...linkedInData,
    lastSync: new Date()
  };
  return this.save();
};

const User = mongoose.model('User', userSchema);

module.exports = User; 