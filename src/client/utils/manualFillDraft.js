const { MANUAL_FILL_STEP_ORDER } = require('./manualFillStepOrder');
const { hasManualFillCvSnapshot } = require('./manualFillCvSnapshot');

function hasNonEmptyString(value) {
  return String(value || '').trim().length > 0;
}

function hasSeniorityProgress(seniority) {
  if (!seniority || typeof seniority !== 'object') return false;
  return Boolean(
    hasNonEmptyString(seniority.currentStatus)
    || (seniority.yearsOfExperience !== null && seniority.yearsOfExperience !== undefined)
    || hasNonEmptyString(seniority.highestDegree)
    || hasNonEmptyString(seniority.mostSeniorWorkExperience)
  );
}

function hasIdentityProgress(userIdentity) {
  if (!userIdentity || typeof userIdentity !== 'object') return false;
  return Object.values(userIdentity).some((value) => hasNonEmptyString(value));
}

function hasStructuredProgress(structuredUserInfo) {
  if (!structuredUserInfo || typeof structuredUserInfo !== 'object') return false;
  return ['skills', 'domains', 'skillDomains', 'keyResponsibilities', 'skillsInDevelopment'].some(
    (key) => Array.isArray(structuredUserInfo[key]) && structuredUserInfo[key].length > 0
  );
}

function hasCoachingDraftProgress(coachingDraft) {
  if (!coachingDraft || typeof coachingDraft !== 'object') return false;
  return Object.values(coachingDraft).some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (Array.isArray(entry.messages) && entry.messages.length > 0) return true;
    if (entry.phase === 'summary') return true;
    return false;
  });
}

/**
 * @param {object|null|undefined} draft
 */
function hasMeaningfulManualFillDraft(draft) {
  if (!draft || typeof draft !== 'object') return false;
  if (hasManualFillCvSnapshot(draft.manualFillCvSnapshot)) return true;
  if (typeof draft.reviewStep === 'number' && draft.reviewStep >= MANUAL_FILL_STEP_ORDER[0]) {
    return true;
  }
  const profile = draft.reviewProfile;
  if (profile && typeof profile === 'object') {
    if (hasSeniorityProgress(profile.seniority)) return true;
    if (hasIdentityProgress(profile.userIdentity)) return true;
    if (hasStructuredProgress(profile.structuredUserInfo)) return true;
  }
  return hasCoachingDraftProgress(draft.coachingDraft);
}

/**
 * @param {object} state
 */
function buildManualFillDraftPayload(state) {
  return {
    reviewProfile: state.reviewProfile,
    reviewStep: state.reviewStep,
    acceptedFields: state.acceptedFields,
    manualFillCvSnapshot: state.manualFillCvSnapshot || null,
    optionalCvSkipped: Boolean(state.optionalCvSkipped),
    pendingUploadedDocId: state.pendingUploadedDocId || null,
    cvExtractLocalization: state.cvExtractLocalization || null,
    manualWorkEnjoyComplete: Boolean(state.manualWorkEnjoyComplete),
    manualTopicsComplete: Boolean(state.manualTopicsComplete),
    manualStrengthsComplete: Boolean(state.manualStrengthsComplete),
    manualWorkEnvironmentComplete: Boolean(state.manualWorkEnvironmentComplete),
    manualWorkingLifeAchievementComplete: Boolean(state.manualWorkingLifeAchievementComplete),
    workEnjoyMostUserEdited: Boolean(state.workEnjoyMostUserEdited),
    topicsIndustriesUserEdited: Boolean(state.topicsIndustriesUserEdited),
    naturallyGoodAtUserEdited: Boolean(state.naturallyGoodAtUserEdited),
    workEnvironmentFitUserEdited: Boolean(state.workEnvironmentFitUserEdited),
    workingLifeAchievementUserEdited: Boolean(state.workingLifeAchievementUserEdited),
    coachingDraft: state.coachingDraft && typeof state.coachingDraft === 'object'
      ? state.coachingDraft
      : {},
  };
}

module.exports = {
  buildManualFillDraftPayload,
  hasMeaningfulManualFillDraft,
};
