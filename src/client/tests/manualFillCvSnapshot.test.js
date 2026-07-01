const {
  buildManualFillCvSnapshot,
  buildCoachingCvContextFromSnapshot,
  applyManualFillCvExtraction,
  mergeStructuredFromCvSnapshot,
  buildCvSkillSelectionCandidates,
  buildCvSkillsToLearnCandidates,
  hasManualFillCvSnapshot,
} = require('../utils/manualFillCvSnapshot');
const { buildManualFillDraftPayload, hasMeaningfulManualFillDraft } = require('../utils/manualFillDraft');

describe('manualFillCvSnapshot', () => {
  const extractedProfile = {
    seniority: {
      currentStatus: 'employed',
      yearsOfExperience: 5,
      highestDegree: 'bachelors',
      mostSeniorWorkExperience: 'mid_level',
    },
    userIdentity: {
      workEnjoyMost: 'CV work enjoy hint',
      topicsIndustriesInterest: 'CV topics hint',
    },
    structuredUserInfo: {
      keyResponsibilities: ['Lead projects'],
      domains: ['Technology'],
      skillDomains: ['Software Development'],
      skills: [{ name: 'JavaScript' }],
    },
  };

  it('builds snapshot with identity hints separate from review profile merge', () => {
    const snapshot = buildManualFillCvSnapshot(extractedProfile, { pendingUploadedDocId: '42' });
    expect(snapshot.pendingUploadedDocId).toBe('42');
    expect(snapshot.identityHints.workEnjoyMost).toBe('CV work enjoy hint');
    expect(snapshot.structuredUserInfo.keyResponsibilities).toEqual(['Lead projects']);
    expect(hasManualFillCvSnapshot(snapshot)).toBe(true);
  });

  it('applies seniority only without copying identity into review profile', () => {
    const reviewProfile = {
      seniority: {},
      userIdentity: {},
      structuredUserInfo: {},
    };
    const applied = applyManualFillCvExtraction(reviewProfile, extractedProfile, {
      pendingUploadedDocId: '42',
    });
    expect(applied.reviewProfile.seniority.currentStatus).toBe('employed');
    expect(applied.reviewProfile.userIdentity.workEnjoyMost).toBeUndefined();
    expect(applied.reviewProfile.userIdentity.topicsIndustriesInterest).toBeUndefined();
    expect(applied.snapshot.identityHints.workEnjoyMost).toBe('CV work enjoy hint');
  });

  it('builds coaching cvContext from snapshot', () => {
    const snapshot = buildManualFillCvSnapshot(extractedProfile, { pendingUploadedDocId: '42' });
    const ctx = buildCoachingCvContextFromSnapshot(snapshot);
    expect(ctx.documentId).toBe('42');
    expect(ctx.identityHints.workEnjoyMost).toBe('CV work enjoy hint');
    expect(ctx.structuredUserInfo.domains).toEqual(['Technology']);
  });

  it('merges structured fields only when categories are empty', () => {
    const snapshot = buildManualFillCvSnapshot(extractedProfile);
    const merged = mergeStructuredFromCvSnapshot(
      { structuredUserInfo: { skills: [{ name: 'Existing' }] } },
      snapshot,
      { topicsIndustriesUserEdited: false, naturallyGoodAtUserEdited: false }
    );
    expect(merged.structuredUserInfo.skills).toEqual([{ name: 'Existing' }]);
    expect(merged.structuredUserInfo.keyResponsibilities).toEqual(['Lead projects']);
    expect(merged.structuredUserInfo.domains).toEqual(['Technology']);
  });

  it('respects coaching userEdited flags when merging structured fields', () => {
    const snapshot = buildManualFillCvSnapshot(extractedProfile);
    const merged = mergeStructuredFromCvSnapshot(
      { structuredUserInfo: {} },
      snapshot,
      { topicsIndustriesUserEdited: true, naturallyGoodAtUserEdited: true }
    );
    expect(merged.structuredUserInfo.domains).toBeUndefined();
    expect(merged.structuredUserInfo.skillDomains).toEqual([]);
    expect(merged.structuredUserInfo.keyResponsibilities).toEqual(['Lead projects']);
  });

  it('defers skillsInDevelopment merge until the learning-goals step resolves against catalog', () => {
    const snapshot = buildManualFillCvSnapshot({
      structuredUserInfo: {
        skills: [{ name: 'JavaScript' }],
        skillsInDevelopment: ['Regulatory affairs'],
      },
    });
    const merged = mergeStructuredFromCvSnapshot({ structuredUserInfo: {} }, snapshot, {});
    expect(merged.structuredUserInfo.skills).toEqual([{ name: 'JavaScript' }]);
    expect(merged.structuredUserInfo.skillsInDevelopment).toBeUndefined();
  });

  it('builds learning-goal candidates from CV skills minus selected skills', () => {
    const snapshot = buildManualFillCvSnapshot({
      structuredUserInfo: {
        skills: [{ name: 'JavaScript' }, { name: 'Python' }],
        skillsInDevelopment: ['Regulatory affairs'],
      },
    });
    expect(buildCvSkillSelectionCandidates(snapshot)).toEqual(['JavaScript', 'Python']);
    expect(buildCvSkillsToLearnCandidates(snapshot, ['JavaScript'])).toEqual([
      'Python',
      'Regulatory affairs',
    ]);
  });

  it('includes snapshot in manual fill draft payload and meaningful draft detection', () => {
    const snapshot = buildManualFillCvSnapshot(extractedProfile, { pendingUploadedDocId: '42' });
    const payload = buildManualFillDraftPayload({
      reviewProfile: {},
      reviewStep: 1,
      acceptedFields: {},
      manualFillCvSnapshot: snapshot,
      optionalCvSkipped: false,
      pendingUploadedDocId: '42',
      cvExtractLocalization: null,
      manualWorkEnjoyComplete: false,
      manualTopicsComplete: false,
      manualStrengthsComplete: false,
      manualWorkEnvironmentComplete: false,
      manualWorkingLifeAchievementComplete: false,
      workEnjoyMostUserEdited: false,
      topicsIndustriesUserEdited: false,
      naturallyGoodAtUserEdited: false,
      workEnvironmentFitUserEdited: false,
      workingLifeAchievementUserEdited: false,
      coachingDraft: {},
    });
    expect(payload.manualFillCvSnapshot).toEqual(snapshot);
    expect(hasMeaningfulManualFillDraft(payload)).toBe(true);
  });
});
