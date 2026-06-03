/**
 * Incremental CV extraction persistence while the worker job is still in-flight.
 * Enables identity-first review UX before the job row reaches `completed`.
 */

const mongoose = require('mongoose');
const User = require('../../models/User');
const logger = require('../../utils/logger');
const {
  buildProfileFromIdentityAndHeuristic,
  buildCombinedSemanticExtraction,
} = require('../cv/cvSemanticCompose');
const { buildSemanticInterpretationBlob, stripGoodAtFromProfile } = require('../cv/cvSemanticMap');

const REVIEW_USER_IDENTITY_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(String(value));
}

/**
 * @param {object|null|undefined} profile
 */
function extractedProfileIdentityIsEmpty(profile) {
  const ui = profile?.userIdentity;
  if (!ui || typeof ui !== 'object') return true;
  return !REVIEW_USER_IDENTITY_KEYS.some((key) => String(ui[key] ?? '').trim());
}

/**
 * @param {object} heuristicResult
 * @param {object|null} identitySemantic
 */
function buildIdentityBaselineProfile(heuristicResult, identitySemantic) {
  if (identitySemantic) {
    const built = buildProfileFromIdentityAndHeuristic(identitySemantic, heuristicResult);
    return {
      ...built,
      profile: stripGoodAtFromProfile(built.profile),
    };
  }
  const combined = buildCombinedSemanticExtraction(heuristicResult, null, null);
  if (combined) {
    return { ...combined, profile: stripGoodAtFromProfile(combined.profile) };
  }
  return {
    profile: stripGoodAtFromProfile(heuristicResult?.profile || {}),
    status: 'partial',
  };
}

/**
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string|mongoose.Types.ObjectId} documentId
 * @param {object} heuristicResult
 * @param {object|null} identitySemantic
 */
async function persistIdentityReviewBaseline(userId, documentId, heuristicResult, identitySemantic) {
  const uid = toObjectId(userId);
  const did = toObjectId(documentId);

  const user = await User.findById(uid);
  if (!user) return { skipped: true, reason: 'user_not_found' };
  const doc = user.profile.documents.id(did);
  if (!doc) return { skipped: true, reason: 'document_not_found' };

  const profilePayload = buildIdentityBaselineProfile(heuristicResult, identitySemantic);
  const mergingIntoCompleted =
    doc.extractionStatus === 'completed'
    && extractedProfileIdentityIsEmpty(doc.extractedProfileData);

  if (doc.extractionStatus === 'completed' && !mergingIntoCompleted) {
    return { skipped: true, reason: 'document_already_completed' };
  }

  if (!identitySemantic && !mergingIntoCompleted) {
    doc.extractedProfileData = profilePayload.profile;
    doc.extractionStatus = 'processing';
    doc.extractionOutcomeStatus = profilePayload.status === 'success' ? 'success' : 'partial';
    doc.identityEnrichmentStatus = 'pending';
    doc.semanticEnrichmentStatus = doc.semanticEnrichmentStatus || 'pending';
    doc.semanticInterpretation = buildSemanticInterpretationBlob(null, null);
    doc.reviewReady = true;
  } else if (identitySemantic) {
    doc.extractedProfileData = {
      ...(doc.extractedProfileData && typeof doc.extractedProfileData === 'object'
        ? doc.extractedProfileData
        : {}),
      ...profilePayload.profile,
      userIdentity: {
        ...(doc.extractedProfileData?.userIdentity || {}),
        ...(profilePayload.profile?.userIdentity || {}),
      },
    };
    doc.identityEnrichmentStatus = 'complete';
    doc.reviewReady = true;
    doc.semanticInterpretation = mergeSemanticInterpretation(
      doc.semanticInterpretation,
      buildSemanticInterpretationBlob(identitySemantic, null)
    );
    if (!mergingIntoCompleted) {
      doc.extractionStatus = 'processing';
      doc.extractionOutcomeStatus = profilePayload.status === 'success' ? 'success' : 'partial';
      doc.semanticEnrichmentStatus = doc.semanticEnrichmentStatus || 'pending';
    }
    user.markModified('profile.documents');
  }

  try {
    await user.save();
    return { skipped: false, reviewReady: true, mergedIntoCompleted: mergingIntoCompleted };
  } catch (err) {
    logger.warn('cv_identity_baseline_persist_failed', {
      userId: String(uid),
      documentId: String(did),
      message: err?.message || String(err),
    });
    return { skipped: true, reason: 'save_failed' };
  }
}

function mergeSemanticInterpretation(existing, patch) {
  if (!patch || typeof patch !== 'object') return existing ?? null;
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  if (patch.userIdentity) base.userIdentity = patch.userIdentity;
  return Object.keys(base).length > 0 ? base : null;
}

module.exports = {
  persistIdentityReviewBaseline,
  extractedProfileIdentityIsEmpty,
  REVIEW_USER_IDENTITY_KEYS,
};
