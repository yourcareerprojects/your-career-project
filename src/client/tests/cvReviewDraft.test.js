const {
  CV_REVIEW_STEP_COUNT,
  buildCvReviewDraftPayload,
  cvReviewProgressStep,
  hasMeaningfulCvReviewDraft,
} = require('../utils/cvReviewDraft');

describe('cvReviewDraft', () => {
  it('detects meaningful drafts with a pending document id', () => {
    expect(hasMeaningfulCvReviewDraft({ pendingUploadedDocId: 'doc-1' })).toBe(true);
    expect(hasMeaningfulCvReviewDraft({ reviewStep: 2 })).toBe(false);
    expect(hasMeaningfulCvReviewDraft(null)).toBe(false);
  });

  it('builds a draft payload with review dialog closed', () => {
    const payload = buildCvReviewDraftPayload({
      pendingUploadedDocId: 'doc-1',
      reviewStep: 3,
      reviewDialogOpen: false,
    });
    expect(payload.pendingUploadedDocId).toBe('doc-1');
    expect(payload.reviewStep).toBe(3);
    expect(payload.reviewDialogOpen).toBe(false);
  });

  it('clamps progress step for display', () => {
    expect(CV_REVIEW_STEP_COUNT).toBe(5);
    expect(cvReviewProgressStep({ reviewStep: 3 })).toBe(3);
    expect(cvReviewProgressStep({ reviewStep: 99 })).toBe(5);
    expect(cvReviewProgressStep(null)).toBe(1);
  });
});
