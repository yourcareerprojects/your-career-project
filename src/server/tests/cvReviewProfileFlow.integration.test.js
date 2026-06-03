const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../services/jobAnalysis/dimensionSummaryGenerator', () => ({
  EMPTY_PLACEHOLDER: 'No information available yet',
  generateDimensionSummary: jest.fn(async ({ dimension, rawItems }, options = {}) => {
    const items = Array.isArray(rawItems) ? rawItems : [];
    const text = items.length === 0 ? 'No information available yet' : `[${dimension}] ${items.join(' | ')}`;
    if (options.returnBundle) {
      const sourceLang = String(options.sourceLang || options.lang || 'en').toLowerCase();
      const altLang = sourceLang === 'de' ? 'en' : 'de';
      return {
        canonical: `${sourceLang.toUpperCase()} ${text}`,
        canonicalLanguage: sourceLang,
        localized: {
          [altLang]: `${altLang.toUpperCase()} ${text}`,
        },
      };
    }
    return text;
  }),
}));

jest.mock('../services/jobAnalysis/whoAreYouNarrativeGenerator', () => ({
  PLACEHOLDER: 'No personal profile information available yet.',
  generateWhoAreYouNarratives: jest.fn(async (rawAnswers = [], options = {}) => {
    const base = Array.isArray(rawAnswers) ? rawAnswers : [];
    const canonical = [0, 1, 2, 3, 4].map((idx) => {
      const text = String(base[idx] || '').trim();
      return text ? `[who_are_you_${idx}] ${text}` : 'No personal profile information available yet.';
    });
    if (options.returnBundle) {
      const sourceLang = String(options.sourceLang || options.lang || 'en').toLowerCase();
      const altLang = sourceLang === 'de' ? 'en' : 'de';
      return {
        canonical: canonical.map((line) => `${sourceLang.toUpperCase()} ${line}`),
        canonicalLanguage: sourceLang,
        localized: {
          [altLang]: canonical.map((line) => `${altLang.toUpperCase()} ${line}`),
        },
      };
    }
    return canonical;
  }),
}));

jest.mock('../services/jobAnalysis/whoAreYouIdentityEmbeddingTextGenerator', () => ({
  PLACEHOLDER: 'I have not provided enough identity information yet to create a meaningful semantic profile.',
  generateWhoAreYouIdentityEmbeddingText: jest.fn(async (rawAnswers = []) => {
    const text = (Array.isArray(rawAnswers) ? rawAnswers : []).map((v) => String(v || '').trim()).filter(Boolean).join(' | ');
    return text ? `I focus on ${text}.` : 'I have not provided enough identity information yet to create a meaningful semantic profile.';
  }),
}));

jest.mock('../services/embedding/userIdentityEmbeddingTextService', () => {
  const actual = jest.requireActual('../services/embedding/userIdentityEmbeddingTextService');
  return {
    ...actual,
    refreshUserIdentityEmbeddingOnUserDocument: jest.fn(async () => undefined),
    scheduleRefreshUserIdentityEmbeddingForUser: jest.fn(),
    ensureUserIdentityEmbeddingCachedByUserId: jest.fn(async () => null),
  };
});

jest.mock('../services/profile/deferredProfileNarrativeService', () => ({
  scheduleDeferredProfileNarrativesForUser: jest.fn(),
}));

jest.mock('../services/profile/extractionNarrativeEnrichmentService', () => {
  const actual = jest.requireActual('../services/profile/extractionNarrativeEnrichmentService');
  return {
    ...actual,
    scheduleExtractionNarrativeEnrichment: jest.fn((userId, documentId, options) => {
      void actual.generateAndPersistExtractionNarratives(userId, documentId, options);
    }),
  };
});

jest.mock('../services/embedding/userOccupationInference', () => ({
  inferIscoFromDomains: jest.fn(async () => ({ inferred: [], methodUsed: 'rule_based' })),
}));

jest.mock('../services/ai/translationCache', () => ({
  cachedTranslate: jest.fn(async (_text, _lang, fn) => fn()),
}));

jest.mock('../services/ai/translateStructured', () => ({
  translateStructured: jest.fn(async (text) => text),
}));

jest.mock('../services/ai/translateText', () => ({
  translateText: jest.fn(async ({ text }) => text),
}));

const User = require('../models/User');
const documentRoutes = require('../routes/documents');
const profileRoutes = require('../routes/profile');
const languageResolutionMiddleware = require('../middleware/languageResolution');
const { normalizeInterpretationShape } = require('../services/documents/semanticCvInterpreter');
const { mapSemanticExtractionToProfile } = require('../services/cv/cvSemanticMap');
const { applyCvExtractionSuccessToUser } = require('../services/documents/cvExtractionPersistence');
const { generateAndPersistExtractionNarratives } = require('../services/profile/extractionNarrativeEnrichmentService');
const { clearProfileResponseCache } = require('../services/profileGetResponseCache');
const { validateSeniorityPayload, seniorityPayloadsMatch } = require('../../client/utils/validateSeniorityPayload');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', languageResolutionMiddleware);
  app.use('/api/documents', documentRoutes);
  app.use('/api/profile', profileRoutes);
  return app;
}

function createTokenForUser(user) {
  return jwt.sign(
    { userId: user._id.toString(), tokenVersion: user.tokenVersion || 0 },
    process.env.JWT_SECRET
  );
}

function getRawItems(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.raw_items)) return value.raw_items;
  return [];
}

function buildSampleSemanticExtraction() {
  return normalizeInterpretationShape({
    userIdentity: {
      workEnjoyment: { bullets: ['Solving customer problems'], confidence: 0.9, evidence: ['customer interviews'] },
      interests: { bullets: ['SaaS', 'Healthcare'], confidence: 0.8, evidence: ['project domain'] },
      strengths: { bullets: ['Communication', 'Prioritization'], confidence: 0.85, evidence: ['led planning'] },
      workStyle: { bullets: ['Collaborative and structured'], confidence: 0.78, evidence: ['cross-functional team'] },
      careerGoals: { bullets: ['Move into head of product roles'], confidence: 0.66, evidence: ['promotion history'] },
    },
    structuredProfile: {
      skillDomains: [{ name: 'Stakeholder Management', confidence: 0.88, evidence: ['executive alignment'] }],
      domains: [{ name: 'Healthcare', confidence: 0.92, evidence: ['hospital clients'] }],
      responsibilities: [{
        description: 'Planning and prioritizing product roadmaps across multiple stakeholder groups',
        confidence: 0.9,
        evidence: ['owned roadmap'],
      }],
      skills: [{ name: 'Stakeholder Management', level: 'advanced', confidence: 0.9, evidence: ['executive alignment'] }],
      learningGoals: [{ name: 'AI Product Discovery', confidence: 0.55, evidence: ['recent coursework'] }],
    },
    seniority: {
      currentStatus: { value: 'employed', confidence: 0.95, evidence: ['current role'] },
      yearsOfExperience: { value: '8 years', confidence: 0.9, evidence: ['timeline'] },
      highestDegree: { value: 'Master of Science', confidence: 0.85, evidence: ['education'] },
      mostSeniorRole: { value: 'Director of Product', confidence: 0.8, evidence: ['leadership scope'] },
    },
  });
}

function buildMappedExtractionBundle() {
  const semantic = buildSampleSemanticExtraction();
  const mapped = mapSemanticExtractionToProfile(semantic);
  return {
    status: mapped.status,
    profile: mapped.profile,
    message: mapped.message,
    messageKey: mapped.messageKey,
    cvExtractLocalization: { documentLanguage: 'en' },
  };
}

/** Mirrors DocumentUploadForm.handleReviewSave → ProfileCreation review-save body. */
function buildReviewSavePayloadFromExtraction(
  extractedProfile,
  { mode = 'merge', name, cvExtractLocalization, documentId, acceptedFields } = {}
) {
  const structured = extractedProfile?.structuredUserInfo || {};
  const seniorityCheck = validateSeniorityPayload(extractedProfile?.seniority || {});
  if (!seniorityCheck.ok) {
    throw new Error(`Invalid seniority in extraction fixture: ${seniorityCheck.field}`);
  }

  const skills = Array.isArray(structured.skills)
    ? structured.skills.map((skill) => (typeof skill === 'string' ? skill : skill?.name)).filter(Boolean)
    : [];

  return {
    mode,
    ...(name ? { name } : {}),
    seniority: seniorityCheck.value,
    userIdentity: {
      workEnjoyMost: extractedProfile?.userIdentity?.workEnjoyMost || '',
      topicsIndustriesInterest: extractedProfile?.userIdentity?.topicsIndustriesInterest || '',
      naturallyGoodAt: extractedProfile?.userIdentity?.naturallyGoodAt || '',
      workEnvironmentFit: extractedProfile?.userIdentity?.workEnvironmentFit || '',
      workingLifeAchievement: extractedProfile?.userIdentity?.workingLifeAchievement || '',
    },
    structuredUserInfo: {
      skillDomains: Array.isArray(structured.skillDomains) ? structured.skillDomains.filter(Boolean) : [],
      skills,
      domains: Array.isArray(structured.domains) ? structured.domains.filter(Boolean) : [],
      keyResponsibilities: Array.isArray(structured.keyResponsibilities)
        ? structured.keyResponsibilities.filter(Boolean)
        : [],
      skillsInDevelopment: Array.isArray(structured.skillsInDevelopment)
        ? structured.skillsInDevelopment.filter(Boolean)
        : [],
    },
    ...(cvExtractLocalization ? { cvExtractLocalization } : {}),
    ...(documentId ? { documentId: String(documentId) } : {}),
    ...(acceptedFields ? { acceptedFields } : {}),
  };
}

async function uploadCv(app, token) {
  return request(app)
    .post('/api/documents/upload?lang=en')
    .set('Authorization', `Bearer ${token}`)
    .field('documentType', 'resume')
    .attach(
      'document',
      Buffer.from('Jane Doe\nSoftware Engineer\nSkills: JavaScript, Node.js, Stakeholder Management'),
      'cv.txt'
    );
}

async function pollExtractionUntilCompleted(app, token, documentId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const res = await request(app)
      .get(`/api/documents/${documentId}/extraction-status?lang=en`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    if (res.body.status === 'completed') return res.body;
    if (res.body.status === 'failed') {
      throw new Error(`Extraction failed: ${res.body.errorKey || 'unknown'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for extraction completion');
}

async function createVerifiedUser(overrides = {}) {
  return User.create({
    name: 'CV Flow Tester',
    email: `cv-flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Test123!@#',
    emailVerified: true,
    accountStatus: {
      isVerified: true,
      isActive: true,
    },
    profile: {
      personalInfo: {},
      structuredUserInfo: {},
      careerSimulationInputs: { structuredUserInfo: {} },
      documents: [],
      ...overrides.profile,
    },
    ...overrides,
  });
}

describe('CV review → profile flow (integration)', () => {
  beforeEach(() => {
    clearProfileResponseCache();
  });

  test('upload → extraction complete → review-save → profile has seniority, identity, and structured data', async () => {
    const app = buildTestApp();
    const user = await createVerifiedUser();
    const token = createTokenForUser(user);

    const uploadRes = await uploadCv(app, token);
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.extractionStatus).toBe('queued');
    const documentId = String(uploadRes.body.documentId);
    expect(documentId).toBeTruthy();

    const bundle = buildMappedExtractionBundle();
    await applyCvExtractionSuccessToUser(user._id, documentId, bundle);
    await generateAndPersistExtractionNarratives(user._id, documentId, { language: 'en', sourceLanguage: 'en' });

    const statusPayload = await pollExtractionUntilCompleted(app, token, documentId);
    expect(statusPayload.status).toBe('completed');
    expect(statusPayload.hasResult).toBe(true);

    const docRes = await request(app)
      .get(`/api/documents/${documentId}?lang=en`)
      .set('Authorization', `Bearer ${token}`);
    expect(docRes.status).toBe(200);
    expect(docRes.body.document.extractedProfileData).toBeTruthy();
    expect(docRes.body.document.extractionStatus).toBe('completed');

    const extractedProfile = docRes.body.document.extractedProfileData;
    const reviewPayload = buildReviewSavePayloadFromExtraction(extractedProfile, {
      mode: 'replace',
      name: 'Jane Doe',
      documentId,
      cvExtractLocalization: docRes.body.document.cvExtractLocalization || { documentLanguage: 'en' },
    });

    const saveRes = await request(app)
      .put('/api/profile/review-save?lang=en')
      .set('Authorization', `Bearer ${token}`)
      .send(reviewPayload);
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.success).toBe(true);
    expect(seniorityPayloadsMatch(reviewPayload.seniority, saveRes.body.seniority)).toBe(true);
    expect(saveRes.body.userIdentity.workEnjoyMost).toBe(reviewPayload.userIdentity.workEnjoyMost);

    const profileRes = await request(app)
      .get('/api/profile?lang=en')
      .set('Authorization', `Bearer ${token}`);
    expect(profileRes.status).toBe(200);
    expect(profileRes.body.success).toBe(true);

    const profile = profileRes.body.profile || {};
    expect(profile.seniority).toMatchObject(reviewPayload.seniority);
    expect(profile.userIdentity.workEnjoyMost).toBe(reviewPayload.userIdentity.workEnjoyMost);
    expect(profile.userIdentity.topicsIndustriesInterest).toBe(reviewPayload.userIdentity.topicsIndustriesInterest);
    expect(profile.userIdentity.naturallyGoodAt).toBe(reviewPayload.userIdentity.naturallyGoodAt);
    expect(profile.userIdentity.workEnvironmentFit).toBe(reviewPayload.userIdentity.workEnvironmentFit);
    expect(profile.userIdentity.workingLifeAchievement).toBe(reviewPayload.userIdentity.workingLifeAchievement);

    expect(getRawItems(profile.structuredUserInfo?.skills)).toEqual(
      expect.arrayContaining(['Stakeholder Management'])
    );
    expect(getRawItems(profile.structuredUserInfo?.domains)).toEqual(
      expect.arrayContaining(['Healthcare'])
    );
    expect(getRawItems(profile.structuredUserInfo?.keyResponsibilities).length).toBeGreaterThan(0);
    expect(profileRes.body.name).toBe('Jane Doe');

    const persisted = await User.findById(user._id).lean();
    expect(persisted.profile.seniority).toMatchObject(reviewPayload.seniority);
    expect(persisted.profile.userIdentityAnswers.workEnjoyMost).toBe(reviewPayload.userIdentity.workEnjoyMost);
    expect(persisted.profile.structuredUserInfo.skills.raw_items).toEqual(
      expect.arrayContaining(['Stakeholder Management'])
    );
  });

  test('merge mode keeps existing structured lists when CV review adds new items', async () => {
    const app = buildTestApp();
    const user = await createVerifiedUser({
      profile: {
        personalInfo: {},
        structuredUserInfo: {
          skills: { raw_items: ['Legacy SQL'], summary_text: { en: 'Legacy SQL' } },
          domains: { raw_items: ['Finance'], summary_text: { en: 'Finance' } },
        },
        careerSimulationInputs: { structuredUserInfo: {} },
        documents: [],
      },
    });
    const token = createTokenForUser(user);

    const uploadRes = await uploadCv(app, token);
    expect(uploadRes.status).toBe(201);
    const documentId = String(uploadRes.body.documentId);

    const bundle = buildMappedExtractionBundle();
    await applyCvExtractionSuccessToUser(user._id, documentId, bundle);
    await generateAndPersistExtractionNarratives(user._id, documentId, { language: 'en', sourceLanguage: 'en' });
    await pollExtractionUntilCompleted(app, token, documentId);

    const docRes = await request(app)
      .get(`/api/documents/${documentId}?lang=en`)
      .set('Authorization', `Bearer ${token}`);
    const reviewPayload = buildReviewSavePayloadFromExtraction(docRes.body.document.extractedProfileData, {
      mode: 'merge',
    });

    const saveRes = await request(app)
      .put('/api/profile/review-save?lang=en')
      .set('Authorization', `Bearer ${token}`)
      .send(reviewPayload);
    expect(saveRes.status).toBe(200);

    const profileRes = await request(app)
      .get('/api/profile?lang=en')
      .set('Authorization', `Bearer ${token}`);
    expect(profileRes.status).toBe(200);

    const skills = getRawItems(profileRes.body.profile?.structuredUserInfo?.skills);
    const domains = getRawItems(profileRes.body.profile?.structuredUserInfo?.domains);
    expect(skills).toEqual(expect.arrayContaining(['Legacy SQL', 'Stakeholder Management']));
    expect(domains).toEqual(expect.arrayContaining(['Finance', 'Healthcare']));
  });
});
