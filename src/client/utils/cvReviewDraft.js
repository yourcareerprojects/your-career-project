const CV_REVIEW_STEP_COUNT = 5;

/**
 * @param {object|null|undefined} draft
 */
function hasMeaningfulCvReviewDraft(draft) {
  if (!draft || typeof draft !== 'object') return false;
  return Boolean(draft.pendingUploadedDocId);
}

/**
 * @param {object} state
 */
function buildCvReviewDraftPayload(state) {
  return {
    pendingUploadedDocId: state.pendingUploadedDocId,
    reviewProfile: state.reviewProfile,
    reviewStep: state.reviewStep,
    step3FollowUps: state.step3FollowUps,
    step3FollowUpAnswers: state.step3FollowUpAnswers,
    acceptedFields: state.acceptedFields,
    cvExtractLocalization: state.cvExtractLocalization,
    reviewDialogOpen: Boolean(state.reviewDialogOpen),
    inputQualityDiagnosisCache: state.inputQualityDiagnosisCache,
    inputQualityDiagnosisAppliedFingerprint: state.inputQualityDiagnosisAppliedFingerprint,
  };
}

/**
 * @param {object|null|undefined} draft
 */
function cvReviewProgressStep(draft) {
  const step = typeof draft?.reviewStep === 'number' ? draft.reviewStep : 1;
  return Math.min(Math.max(step, 1), CV_REVIEW_STEP_COUNT);
}

module.exports = {
  CV_REVIEW_STEP_COUNT,
  buildCvReviewDraftPayload,
  cvReviewProgressStep,
  hasMeaningfulCvReviewDraft,
};
