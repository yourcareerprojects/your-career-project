/**
 * Embedding-optimized user identity text: LLM generation, fingerprint cache, MongoDB persistence.
 *
 * Regenerates when the five canonical identity answers change (see fingerprint).
 * Legacy: personal bio only, or flat evaluation payloads (bio / careerGoal / userInterests), map into the five-field shape.
 *
 * @module services/embedding/userIdentityEmbeddingTextService
 */

const crypto = require('crypto');
const { buildMessages } = require('../../prompts/generateUserIdentityEmbeddingText');
const { openaiProvider } = require('../jobAnalysis/roleIdentityComposer');
const { normalizeForEmbedding } = require('../ai/normalizeForEmbedding');

/** @type {Map<string, Promise<string>>} */
const llmInflightByFingerprint = new Map();

const FALLBACK_IDENTITY_TEXT =
  'Limited profile; working style, motivations, and environment preferences not yet specified.';

const USER_IDENTITY_ANSWER_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

const LEGACY_ANSWER_LABELS = {
  workEnjoyMost: 'Work I enjoy most',
  topicsIndustriesInterest: 'Topics or industries of interest',
  naturallyGoodAt: 'Naturally good at or confident doing',
  workEnvironmentFit: 'Work environment or way of working',
  workingLifeAchievement: 'Working-life goals',
};

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Normalize interests for stable fingerprinting (legacy).
 * @param {unknown[]} interests
 * @returns {string[]}
 */
function normalizeInterestsList(interests) {
  const raw = safeArray(interests)
    .map((i) => String(i || '').trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const x of raw) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return out;
}

/**
 * @param {object} [obj]
 * @returns {Record<string, string>}
 */
function normalizeUserIdentityAnswers(obj = {}) {
  const out = {};
  for (const k of USER_IDENTITY_ANSWER_KEYS) {
    out[k] = obj[k] != null ? String(obj[k]).trim() : '';
  }
  return out;
}

function isUserIdentityAnswersEmpty(ans) {
  const n = normalizeUserIdentityAnswers(ans);
  return USER_IDENTITY_ANSWER_KEYS.every((k) => !n[k]);
}

/**
 * Map legacy bio / career goal / interest chips into the five-field shape (sparse fields allowed).
 */
function coalesceLegacyUserIdentityToAnswers(bio, careerGoal, interests) {
  const ints = normalizeInterestsList(interests);
  return normalizeUserIdentityAnswers({
    workEnjoyMost: bio || '',
    topicsIndustriesInterest: ints.join(', '),
    naturallyGoodAt: '',
    workEnvironmentFit: '',
    workingLifeAchievement: careerGoal || '',
  });
}

/**
 * Merge CSI userIdentity and persisted userIdentityAnswers; then legacy fallback from profile roots.
 *
 * @param {object} profile – user.profile
 * @returns {Record<string, string>}
 */
function mergeProfileIdentityAnswers(profile) {
  if (!profile || typeof profile !== 'object') {
    return normalizeUserIdentityAnswers({});
  }
  const csi = profile.careerSimulationInputs?.userIdentity;
  const stored = profile.userIdentityAnswers;
  const a = normalizeUserIdentityAnswers(csi && typeof csi === 'object' ? csi : {});
  const b = normalizeUserIdentityAnswers(stored && typeof stored === 'object' ? stored : {});
  const merged = {};
  for (const k of USER_IDENTITY_ANSWER_KEYS) {
    merged[k] = a[k] || b[k] || '';
  }
  if (!isUserIdentityAnswersEmpty(merged)) {
    return merged;
  }
  return coalesceLegacyUserIdentityToAnswers(
    profile.personalInfo?.bio ? String(profile.personalInfo.bio).trim() : '',
    '',
    []
  );
}

/**
 * Canonical identity answers for fingerprinting / Mongo cache.
 * Matches simulation resolution: merged CSI + userIdentityAnswers, else legacy mapping.
 *
 * @param {object} profile – user.profile
 * @returns {Record<string, string>}
 */
function getCanonicalIdentitySources(profile) {
  return mergeProfileIdentityAnswers(profile);
}

/**
 * Stable fingerprint for the five identity answers (normalized).
 *
 * @param {Record<string, string>} answers
 * @returns {string} hex sha256
 */
function computeUserIdentitySourceFingerprint(answers) {
  const normalized = normalizeUserIdentityAnswers(answers);
  const payload = JSON.stringify(
    USER_IDENTITY_ANSWER_KEYS.reduce((acc, k) => {
      acc[k] = normalized[k] || '';
      return acc;
    }, {})
  );
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Legacy deterministic text (no LLM). Used only as last-resort fallback.
 *
 * @param {Record<string, string>} answers
 */
function buildUserIdentityTextLegacy(answers) {
  const n = normalizeUserIdentityAnswers(answers);
  const parts = [];
  for (const k of USER_IDENTITY_ANSWER_KEYS) {
    if (n[k]) parts.push(`${LEGACY_ANSWER_LABELS[k]}: ${n[k]}`);
  }
  return parts.join('. ').trim() || FALLBACK_IDENTITY_TEXT;
}

function parseLlmJson(content) {
  let cleaned = String(content || '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed.user_identity_text !== 'string') {
    throw new Error('Missing user_identity_text string');
  }
  const text = parsed.user_identity_text.trim();
  if (text.length < 20) throw new Error('user_identity_text too short');
  return text;
}

/**
 * Call LLM to produce User Identity Text.
 *
 * @param {Record<string, string>} answers – normalized five fields
 * @returns {Promise<string>}
 */
async function generateUserIdentityEmbeddingTextLlm(answers) {
  const n = normalizeUserIdentityAnswers(answers);
  if (isUserIdentityAnswersEmpty(n)) {
    return FALLBACK_IDENTITY_TEXT;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return buildUserIdentityTextLegacy(n);
  }

  const messages = buildMessages(n);

  const raw = await openaiProvider(messages, {
    temperature: 0.2,
  });
  const text = parseLlmJson(raw);
  const normalized = await normalizeForEmbedding(text);
  return normalized.trim() || FALLBACK_IDENTITY_TEXT;
}

/**
 * Dedupe concurrent LLM calls for the same fingerprint.
 *
 * @param {Record<string, string>} answers
 * @param {string} fingerprint
 * @returns {Promise<string>}
 */
async function generateWithDedupe(answers, fingerprint) {
  if (llmInflightByFingerprint.has(fingerprint)) {
    return llmInflightByFingerprint.get(fingerprint);
  }
  const promise = generateUserIdentityEmbeddingTextLlm(answers)
    .catch((err) => {
      console.warn('[userIdentityEmbeddingText] LLM failed, using legacy fallback:', err.message);
      return buildUserIdentityTextLegacy(answers);
    })
    .finally(() => {
      llmInflightByFingerprint.delete(fingerprint);
    });
  llmInflightByFingerprint.set(fingerprint, promise);
  return promise;
}

/**
 * Flat userProfile (matching / evaluation) → normalized five answers.
 *
 * @param {object} userProfile
 * @returns {Record<string, string>}
 */
function answersFromFlatUserProfile(userProfile) {
  if (!userProfile || typeof userProfile !== 'object') {
    return normalizeUserIdentityAnswers({});
  }
  const direct = normalizeUserIdentityAnswers(userProfile.userIdentityAnswers || {});
  if (!isUserIdentityAnswersEmpty(direct)) {
    return direct;
  }
  return coalesceLegacyUserIdentityToAnswers(
    userProfile.bio != null ? String(userProfile.bio).trim() : '',
    userProfile.careerGoal != null ? String(userProfile.careerGoal).trim() : '',
    userProfile.userInterests
  );
}

/**
 * Resolve text for embedding from userProfile (flat shape used by matching) or nested cache fields.
 *
 * userProfile may include:
 * - userIdentityAnswers (five strings) or legacy flat bio / careerGoal / userInterests (e.g. evaluation fixtures)
 * - embeddingOptimizedUserIdentityText, embeddingUserIdentitySourceFingerprint
 *
 * @param {object} userProfile
 * @returns {Promise<string>}
 */
async function resolveUserIdentityEmbeddingText(userProfile) {
  if (!userProfile || typeof userProfile !== 'object') {
    return FALLBACK_IDENTITY_TEXT;
  }

  const explicitWhoAreYouIdentityText = String(userProfile.identityEmbeddingText || '').trim();
  if (explicitWhoAreYouIdentityText) {
    return explicitWhoAreYouIdentityText;
  }

  const answers = answersFromFlatUserProfile(userProfile);
  const fp = computeUserIdentitySourceFingerprint(answers);
  const cachedText = userProfile.embeddingOptimizedUserIdentityText;
  const cachedFp = userProfile.embeddingUserIdentitySourceFingerprint;

  if (
    typeof cachedText === 'string' &&
    cachedText.trim() &&
    typeof cachedFp === 'string' &&
    cachedFp === fp
  ) {
    return cachedText.trim();
  }

  if (isUserIdentityAnswersEmpty(answers)) {
    return FALLBACK_IDENTITY_TEXT;
  }

  return generateWithDedupe(answers, fp);
}

/**
 * Refresh stored embedding text on a Mongoose user document when fingerprint changes or cache missing.
 *
 * @param {{ profile?: object, save?: () => Promise<unknown> }} user
 * @param {{ forceRegenerate?: boolean, reuseWhoAreYouText?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function refreshUserIdentityEmbeddingOnUserDocument(user, options = {}) {
  if (!user?.profile) return;
  const { forceRegenerate = false, reuseWhoAreYouText = true } = options;

  const answers = getCanonicalIdentitySources(user.profile);
  const fp = computeUserIdentitySourceFingerprint(answers);

  if (!user.profile.careerSimulationInputs || typeof user.profile.careerSimulationInputs !== 'object') {
    user.profile.careerSimulationInputs = {};
  }
  const csi = user.profile.careerSimulationInputs;

  if (
    !forceRegenerate &&
    csi.embeddingUserIdentitySourceFingerprint === fp &&
    typeof csi.embeddingOptimizedUserIdentityText === 'string' &&
    csi.embeddingOptimizedUserIdentityText.trim()
  ) {
    return;
  }

  let text;
  const explicitWhoAreYouIdentityText = String(user.profile?.who_are_you?.identity_embedding_text || '').trim();
  if (reuseWhoAreYouText && explicitWhoAreYouIdentityText) {
    text = explicitWhoAreYouIdentityText;
  } else if (isUserIdentityAnswersEmpty(answers)) {
    text = FALLBACK_IDENTITY_TEXT;
  } else {
    text = await generateWithDedupe(answers, fp);
  }

  csi.embeddingOptimizedUserIdentityText = text;
  csi.embeddingUserIdentitySourceFingerprint = fp;
  await user.save();
}

/**
 * Load user by id and refresh identity embedding cache if needed.
 *
 * @param {string} userId
 * @returns {Promise<{ text: string, fingerprint: string } | null>}
 */
async function ensureUserIdentityEmbeddingCachedByUserId(userId) {
  if (!userId) return null;
  const User = require('../../models/User');
  const user = await User.findById(userId);
  if (!user) return null;

  await refreshUserIdentityEmbeddingOnUserDocument(user);

  const csi = user.profile.careerSimulationInputs || {};
  return {
    text: csi.embeddingOptimizedUserIdentityText || FALLBACK_IDENTITY_TEXT,
    fingerprint: csi.embeddingUserIdentitySourceFingerprint || '',
  };
}

/**
 * Split topics/industries string into tokens for structured scoring heuristics.
 * @param {string} s
 * @returns {string[]}
 */
function topicsStringToInterestTokens(s) {
  return String(s || '')
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

module.exports = {
  USER_IDENTITY_ANSWER_KEYS,
  normalizeUserIdentityAnswers,
  getCanonicalIdentitySources,
  computeUserIdentitySourceFingerprint,
  buildUserIdentityTextLegacy,
  resolveUserIdentityEmbeddingText,
  refreshUserIdentityEmbeddingOnUserDocument,
  ensureUserIdentityEmbeddingCachedByUserId,
  generateUserIdentityEmbeddingTextLlm,
  coalesceLegacyUserIdentityToAnswers,
  mergeProfileIdentityAnswers,
  answersFromFlatUserProfile,
  topicsStringToInterestTokens,
  FALLBACK_IDENTITY_TEXT,
};
