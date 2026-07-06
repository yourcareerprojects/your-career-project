import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Button,
  CircularProgress,
  Alert,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  MenuItem,
  Checkbox,
  Divider,
  LinearProgress,
  Tooltip
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Description as DescriptionIcon,
  Edit as EditIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { USER_IDENTITY_FIELDS } from '../../constants/userIdentityFields';
import { validateSeniorityPayload } from '../../utils/validateSeniorityPayload';
import {
  ProfileReviewSaveError,
  translateReviewFieldErrors,
  warmReviewNarrativeCacheForStep,
  fetchDocumentNarrativeCacheStatus,
  computeNarrativeWarmProgressEstimate,
  WIZARD_NARRATIVE_WARM_SLOW_WARNING_MS,
} from '../../utils/profileReviewSaveFlow';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import { prefetchRoleSkillRecommendations } from '../../utils/roleSkillSearchApi';
import {
  validateReviewProfileInDialog,
  validateReviewIdentityStep,
  buildStructuredGoodAtFromReview,
  PROFILE_REVIEW_USER_IDENTITY_MAX,
  PROFILE_REVIEW_STRUCTURED_MAX,
} from '../../utils/validateReviewProfilePayload';
import {
  getProfileStructuredListMaxItems,
} from '../../../constants/profileReviewFieldLimits';
import {
  saveCvReviewDraft,
  loadCvReviewDraft,
  clearCvReviewDraft,
} from '../../utils/cvReviewDraftStorage';
import { useAuth } from '../../contexts/AuthContext';
import {
  CURRENT_EMPLOYMENT_STATUS_OPTIONS,
  currentEmploymentStatusLabel,
  sanitizeCurrentEmploymentStatus,
  inferCurrentEmploymentStatusFromText,
} from '../../../constants/currentEmploymentStatus';
import { HIGHEST_DEGREE_OPTIONS, HIGHEST_DEGREE_ALLOWED, highestDegreeLabel, inferHighestDegreeFromText } from '../../../constants/highestDegree';
import {
  MOST_SENIOR_OPTIONS,
  MOST_SENIOR_ALLOWED,
  YEARS_OPTIONS,
  inferMostSeniorRoleFromText
} from '../../../constants/senioritySelectOptions';
import {
  isCvDocumentType,
  documentTypeDisplaySlug,
} from '../../../constants/documentTypes';
import {
  watchCvExtractionUntilTerminal,
  fetchCvExtractionStatus,
  isActiveCvExtractionDocument,
  mapExtractionStatusToUiPhase,
  isCvExtractionUiPhaseInProgress,
  documentNeedsFullReviewQuality,
  documentNeedsCvLocalization,
  buildPollSnapshot,
  resolveExtractionProgressMessageKey,
} from '../../utils/cvExtractionPoll';
import { getExtractionErrorMessage } from '../../utils/cvExtractionErrors';
import {
  mapZombieSignalsToUxPhase,
  getDelayReasonI18nKey,
} from '../../utils/cvExtractionZombie';
import ProfileCreationProgress from './ProfileCreationProgress';
import ProfileReviewStepTitle from './ProfileReviewStepTitle';
import HomeGetStartedButton from '../home/HomeGetStartedButton';
import WorkEnjoyMostCoaching, {
  parseActivitiesFromText,
} from './WorkEnjoyMostCoaching';
import TopicsIndustriesCoaching, {
  formatInterestTopicsAsText,
  parseInterestTopicsFromText,
} from './TopicsIndustriesCoaching';
import NaturallyGoodAtCoaching, {
  formatNaturallyGoodAtAsText,
  parseNaturallyGoodAtFromText,
} from './NaturallyGoodAtCoaching';
import WorkEnvironmentCoaching, {
  parseWorkEnvironmentFromText,
} from './WorkEnvironmentCoaching';
import WorkingLifeAchievementCoaching, {
  parseWorkingLifeAchievementFromText,
} from './WorkingLifeAchievementCoaching';
import SkillSelectionStep from './SkillSelectionStep';
import SkillPicker from './SkillPicker';
import TasksResponsibilitiesStep from './TasksResponsibilitiesStep';
import SkillDomainPicker from './SkillDomainPicker';
import IndustrySectorPicker from './IndustrySectorPicker';
import { normalizeIndustryDomains } from '../../../constants/industries';
import {
  qualityDiagnosisFingerprint,
  qualityDiagnosisInputFromProfile,
  inputQualityDiagnosisPrefetchDebounceMs,
  diagnosisCacheMapToDraft,
  diagnosisCacheMapFromDraft,
  trimDiagnosisCacheMap,
} from '../../utils/inputQualityDiagnosisCache';
import {
  buildReviewFieldScrollQueue,
  firstEmptyFollowUpFieldKey,
  reviewFieldAnchorProps,
  scheduleReviewFieldScroll,
  scrollToFirstReviewField,
  seniorityReviewFieldKey,
} from '../../utils/reviewFieldScroll';
import {
  isManualFillFirstStep,
  isManualFillLastStep,
  MANUAL_FILL_STEP_COUNT,
  MANUAL_FILL_STEP_ORDER,
  MANUAL_FILL_REVIEW_STEPS,
  manualFillProgressIndex,
  nextManualFillStep,
  prevManualFillStep,
} from '../../utils/manualFillStepOrder';
import {
  saveManualFillDraft,
  loadManualFillDraft,
  clearManualFillDraft,
} from '../../utils/manualFillDraftStorage';
import {
  buildManualFillDraftPayload,
  hasMeaningfulManualFillDraft,
} from '../../utils/manualFillDraft';
import {
  buildCoachingCvContextFromSnapshot,
  hasManualFillCvSnapshot,
  applyManualFillCvExtraction,
  mergeStructuredFromCvSnapshot,
  buildCvSkillSelectionCandidates,
  buildCvSkillsToLearnCandidates,
} from '../../utils/manualFillCvSnapshot';
import { resolveRoleSkillLabels } from '../../utils/resolveRoleSkillLabels';
import { normalizeGermanCvResponsibilityList } from '../../../constants/normalizeGermanCvResponsibilities';
import {
  buildCvReviewDraftPayload,
  hasMeaningfulCvReviewDraft,
} from '../../utils/cvReviewDraft';

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

const normalizeDocuments = (docs) =>
  docs.map((doc) => ({
    ...doc,
    id: doc.id || doc._id,
  }));

function getDocumentTimestampMs(doc) {
  const rawValue = doc?.updatedAt || doc?.uploadDate || doc?.createdAt || doc?.date || null;
  if (!rawValue) return 0;
  const parsed = Date.parse(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickPreferredActiveCvDocument(docs, options = {}) {
  const preferredDocumentId = options.preferredDocumentId ? String(options.preferredDocumentId) : null;
  const activeDocs = (docs || []).filter((doc) => isActiveCvExtractionDocument(doc));
  if (!activeDocs.length) return null;
  if (preferredDocumentId) {
    const preferredDoc = activeDocs.find(
      (doc) => String(doc.id || doc._id || '') === preferredDocumentId
    );
    if (preferredDoc) return preferredDoc;
  }
  return activeDocs.reduce((latest, doc) => (
    getDocumentTimestampMs(doc) >= getDocumentTimestampMs(latest) ? doc : latest
  ));
}

function documentTypeChipLabel(doc, t) {
  const slug = doc.documentTypeDisplay || documentTypeDisplaySlug(doc.documentType || doc.type);
  if (slug) {
    const key = `documentUpload.uploadDialog.documentTypes.${slug}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return doc.documentType || doc.type || '';
}

function devCvExtractionLog(event, meta = {}) {
  if (typeof process === 'undefined' || process.env.NODE_ENV !== 'development') return;
  console.info(`[cv-extraction] ${event}`, meta);
}

function mergeFollowUpAnswersForQuestions(previousAnswers = {}, followUps = [], preserveExisting = false) {
  const prev = previousAnswers && typeof previousAnswers === 'object' ? previousAnswers : {};
  const out = {};
  for (const row of (Array.isArray(followUps) ? followUps : [])) {
    const key = String(row?.field || '').trim();
    if (!key) continue;
    out[key] = preserveExisting ? String(prev[key] || '') : '';
  }
  return out;
}

function buildProtectedIdentityFollowUpFields(
  workEnjoyMostUserEdited,
  topicsIndustriesUserEdited,
  naturallyGoodAtUserEdited,
  workEnvironmentFitUserEdited,
  workingLifeAchievementUserEdited
) {
  const fields = [];
  if (workEnjoyMostUserEdited) fields.push('userIdentity.workEnjoyMost');
  if (topicsIndustriesUserEdited) {
    fields.push('userIdentity.topicsIndustriesInterest');
    fields.push('structuredUserInfo.domains');
  }
  if (naturallyGoodAtUserEdited) {
    fields.push('userIdentity.naturallyGoodAt');
    fields.push('structuredUserInfo.skillDomains');
  }
  if (workEnvironmentFitUserEdited) fields.push('userIdentity.workEnvironmentFit');
  if (workingLifeAchievementUserEdited) fields.push('userIdentity.workingLifeAchievement');
  return fields;
}

function filterProtectedIdentityFollowUps(
  followUps,
  workEnjoyMostUserEdited,
  topicsIndustriesUserEdited,
  naturallyGoodAtUserEdited,
  workEnvironmentFitUserEdited,
  workingLifeAchievementUserEdited
) {
  const blocked = new Set(buildProtectedIdentityFollowUpFields(
    workEnjoyMostUserEdited,
    topicsIndustriesUserEdited,
    naturallyGoodAtUserEdited,
    workEnvironmentFitUserEdited,
    workingLifeAchievementUserEdited
  ));
  return (Array.isArray(followUps) ? followUps : []).filter((row) => {
    const field = String(row?.field || '').trim();
    if (blocked.has(field)) return false;
    if (topicsIndustriesUserEdited && field.startsWith('structuredUserInfo.domains.')) return false;
    if (naturallyGoodAtUserEdited && field.startsWith('structuredUserInfo.skillDomains.')) return false;
    return true;
  });
}

function buildAcceptedDomainFields(domains = []) {
  const accepted = {};
  (Array.isArray(domains) ? domains : []).forEach((_, idx) => {
    accepted[`structuredUserInfo.domains.${idx}`] = true;
  });
  return accepted;
}

function buildAcceptedSkillDomainFields(skillDomains = []) {
  const accepted = {};
  (Array.isArray(skillDomains) ? skillDomains : []).forEach((_, idx) => {
    accepted[`structuredUserInfo.skillDomains.${idx}`] = true;
  });
  return accepted;
}

function buildAcceptedSkillFields(skills = []) {
  const accepted = {};
  (Array.isArray(skills) ? skills : []).forEach((_, idx) => {
    accepted[`structuredUserInfo.skills.${idx}`] = true;
  });
  return accepted;
}

function buildAcceptedSkillsInDevelopmentFields(skillsInDevelopment = []) {
  const accepted = {};
  (Array.isArray(skillsInDevelopment) ? skillsInDevelopment : []).forEach((_, idx) => {
    accepted[`structuredUserInfo.skillsInDevelopment.${idx}`] = true;
  });
  return accepted;
}

function reviewProfileHasSelectedSkill(reviewProfile = {}) {
  const skills = reviewProfile?.structuredUserInfo?.skills || [];
  return skills.some((item) => {
    const name = typeof item === 'string' ? item : item?.name;
    return String(name || '').trim();
  });
}

function reviewProfileHasSkillsInDevelopment(reviewProfile = {}) {
  const skills = reviewProfile?.structuredUserInfo?.skillsInDevelopment || [];
  return skills.some((item) => {
    const name = typeof item === 'string' ? item : item?.name;
    return String(name || '').trim();
  });
}

function skillLabelsFromProfile(skills = []) {
  return (Array.isArray(skills) ? skills : [])
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      return String(item?.name || '').trim();
    })
    .filter(Boolean);
}

/** Map validation field keys to a manual-fill step (CV-only steps 2–4 are not used). */
function mapManualFillReviewStepFromField(firstField, fallbackStep) {
  const field = String(firstField || '').trim();
  if (field.startsWith('structuredUserInfo.skillsInDevelopment')) {
    return MANUAL_FILL_REVIEW_STEPS.SKILLS_TO_LEARN;
  }
  if (field.startsWith('structuredUserInfo.skills')) {
    return MANUAL_FILL_REVIEW_STEPS.SKILLS_SELECTION;
  }
  if (field.startsWith('structuredUserInfo.keyResponsibilities')) {
    return MANUAL_FILL_REVIEW_STEPS.TASKS_RESPONSIBILITIES;
  }
  if (field.startsWith('structuredUserInfo.skillDomains')) {
    return MANUAL_FILL_REVIEW_STEPS.STRENGTHS_COACHING;
  }
  if (field.startsWith('structuredUserInfo.domains')) {
    return MANUAL_FILL_REVIEW_STEPS.TOPICS_COACHING;
  }
  if (field === 'userIdentity.workEnjoyMost') {
    return MANUAL_FILL_REVIEW_STEPS.WORK_ENJOY_COACHING;
  }
  if (field === 'userIdentity.topicsIndustriesInterest') {
    return MANUAL_FILL_REVIEW_STEPS.TOPICS_COACHING;
  }
  if (field === 'userIdentity.naturallyGoodAt') {
    return MANUAL_FILL_REVIEW_STEPS.STRENGTHS_COACHING;
  }
  if (field === 'userIdentity.workEnvironmentFit') {
    return MANUAL_FILL_REVIEW_STEPS.WORK_ENVIRONMENT_COACHING;
  }
  if (field === 'userIdentity.workingLifeAchievement') {
    return MANUAL_FILL_REVIEW_STEPS.WORKING_LIFE_ACHIEVEMENT_COACHING;
  }
  if (field.startsWith('seniority.')) {
    return MANUAL_FILL_REVIEW_STEPS.SENIORITY;
  }
  if (fallbackStep === 2 || fallbackStep === 3 || fallbackStep === 4) {
    return MANUAL_FILL_REVIEW_STEPS.SKILLS_TO_LEARN;
  }
  if (MANUAL_FILL_STEP_ORDER.includes(fallbackStep)) return fallbackStep;
  return MANUAL_FILL_REVIEW_STEPS.SENIORITY;
}

function buildAcceptedKeyResponsibilityFields(keyResponsibilities = []) {
  const accepted = {};
  (Array.isArray(keyResponsibilities) ? keyResponsibilities : []).forEach((item, idx) => {
    if (String(item || '').trim()) {
      accepted[`structuredUserInfo.keyResponsibilities.${idx}`] = true;
    }
  });
  return accepted;
}

function reviewProfileHasKeyResponsibilities(reviewProfile = {}) {
  const items = reviewProfile?.structuredUserInfo?.keyResponsibilities || [];
  return items.some((item) => String(item || '').trim());
}

function capGoodAtList(arr, arrayKey) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, getProfileStructuredListMaxItems(arrayKey));
}

/** Merge Step 3 follow-up answers into the review profile before save (append text / push list rows). */
function applyStep3FollowUpAnswersToReviewProfile(profile, followUps, answers, protectedFields = []) {
  if (!profile || typeof profile !== 'object' || !Array.isArray(followUps) || followUps.length === 0) {
    return profile;
  }
  const protectedSet = new Set(
    (Array.isArray(protectedFields) ? protectedFields : []).map((field) => String(field || '').trim()).filter(Boolean)
  );
  const uid = { ...(profile.userIdentity || {}) };
  const keyResponsibilities = [...(profile.structuredUserInfo?.keyResponsibilities || [])];
  const skillsInDevelopment = [...(profile.structuredUserInfo?.skillsInDevelopment || [])];

  for (const row of followUps) {
    const f = row.field;
    if (protectedSet.has(String(f || '').trim())) continue;
    const ans = String((answers && answers[f]) || '').trim();
    if (!ans) continue;
    if (f.startsWith('userIdentity.')) {
      const key = f.slice('userIdentity.'.length);
      const prev = String(uid[key] || '').trim();
      uid[key] = prev ? `${prev}\n\n${ans}` : ans;
    } else if (f === 'structuredUserInfo.keyResponsibilities') {
      if (keyResponsibilities.length < getProfileStructuredListMaxItems('keyResponsibilities')) {
        keyResponsibilities.push(ans);
      }
    } else if (f === 'structuredUserInfo.skillsInDevelopment') {
      if (skillsInDevelopment.length < getProfileStructuredListMaxItems('skillsInDevelopment')) {
        skillsInDevelopment.push(ans);
      }
    }
  }

  return {
    ...profile,
    userIdentity: uid,
    structuredUserInfo: {
      ...(profile.structuredUserInfo || {}),
      keyResponsibilities,
      skillsInDevelopment
    }
  };
}

/** Align review rows: fixed category column, shared input width (matches “What are you good at?”). */
const REVIEW = {
  rowEntry: {
    display: 'flex',
    flexDirection: { xs: 'column', sm: 'row' },
    gap: { xs: 1, sm: 2 },
    alignItems: { xs: 'stretch', sm: 'center' },
    mb: 1.5,
  },
  rowEntryMultiline: {
    display: 'flex',
    flexDirection: { xs: 'column', sm: 'row' },
    gap: { xs: 1, sm: 2 },
    alignItems: { xs: 'stretch', sm: 'flex-start' },
    mb: 1.5,
  },
  /** Label + control rows (e.g. seniority selects). */
  rowLabeledField: {
    display: 'flex',
    flexDirection: { xs: 'column', sm: 'row' },
    gap: { xs: 1, sm: 2 },
    alignItems: { xs: 'stretch', sm: 'center' },
  },
  checkboxLabelRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0.5,
    flexShrink: 0,
    width: { xs: '100%', sm: 240 },
    maxWidth: { sm: 240 },
    minWidth: 0,
  },
  checkbox: {
    p: 0.75,
    mt: 0,
    flexShrink: 0,
  },
  checkboxLabelText: {
    fontWeight: 600,
    lineHeight: 1.35,
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    flex: 1,
    minWidth: 0,
  },
  /** Matches Profile.jsx identity editor subcategory question labels. */
  subcategoryTitle: {
    color: '#950202',
    fontWeight: 600,
    mb: 1.5,
  },
  categoryText: {
    flex: { xs: '1 1 auto', sm: '0 0 240px' },
    width: { xs: '100%', sm: '240px' },
    maxWidth: { sm: '240px' },
    minWidth: 0,
    color: '#950202',
    fontWeight: 600,
    lineHeight: 1.35,
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    pr: { sm: 1 },
    pt: { sm: 0.5 },
  },
  field: {
    flex: 1,
    minWidth: { xs: '100%', sm: 200 },
    maxWidth: '100%',
    alignSelf: 'stretch'
  }
};

function ensureReviewProfileShape(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  return {
    ...p,
    seniority: {
      currentStatus: '',
      yearsOfExperience: null,
      highestDegree: '',
      mostSeniorWorkExperience: '',
      ...(p.seniority && typeof p.seniority === 'object' ? p.seniority : {})
    },
    structuredUserInfo: p.structuredUserInfo && typeof p.structuredUserInfo === 'object'
      ? p.structuredUserInfo
      : {},
    userIdentity: p.userIdentity && typeof p.userIdentity === 'object' ? p.userIdentity : {}
  };
}

const GOOD_AT_STRUCTURED_KEYS = [
  'skillDomains',
  'skills',
  'domains',
  'keyResponsibilities',
  'skillsInDevelopment',
];

function reviewProfileHasStructuredGoodAt(profile) {
  const sui = profile?.structuredUserInfo || {};
  return GOOD_AT_STRUCTURED_KEYS.some((key) => Array.isArray(sui[key]) && sui[key].length > 0);
}

function mergeReviewProfileWithDraft(normalized, draftProfile) {
  const base = ensureReviewProfileShape(normalized);
  const draft = ensureReviewProfileShape(draftProfile);
  const baseSui = base.structuredUserInfo || {};
  const draftSui = draft.structuredUserInfo || {};
  const structuredUserInfo = {
    ...draftSui,
    ...baseSui,
    ...Object.fromEntries(
      GOOD_AT_STRUCTURED_KEYS.map((key) => [key, Array.isArray(baseSui[key]) ? baseSui[key] : []])
    ),
  };
  return ensureReviewProfileShape({
    ...base,
    ...draft,
    userIdentity: { ...base.userIdentity, ...draft.userIdentity },
    structuredUserInfo,
    seniority: { ...base.seniority, ...draft.seniority },
  });
}

function isSkillsOnlyIncompleteGoodAt(structuredUserInfo = {}) {
  const hasOther = ['skillDomains', 'domains', 'keyResponsibilities', 'skillsInDevelopment'].some(
    (key) => Array.isArray(structuredUserInfo[key]) && structuredUserInfo[key].length > 0
  );
  if (hasOther) return false;
  const skills = Array.isArray(structuredUserInfo.skills) ? structuredUserInfo.skills : [];
  return skills.some((item) => String(typeof item === 'string' ? item : item?.name || '').trim());
}

/** Step 3 lists must come from AI interpretation, not regex/heuristic fallback. */
function stripHeuristicGoodAtFromProfileData(profileData, documentMeta = {}) {
  const sui = profileData?.structuredUserInfo && typeof profileData.structuredUserInfo === 'object'
    ? profileData.structuredUserInfo
    : {};
  const needsAiGoodAt =
    documentNeedsFullReviewQuality(documentMeta)
    || isSkillsOnlyIncompleteGoodAt(sui);
  if (!needsAiGoodAt || !profileData || typeof profileData !== 'object') {
    return profileData;
  }
  return {
    ...profileData,
    structuredUserInfo: {
      ...sui,
      ...Object.fromEntries(GOOD_AT_STRUCTURED_KEYS.map((key) => [key, []])),
    },
  };
}

function applyStoredReviewDraft(userId, documentId, normalizedData, draft) {
  if (!draft || String(draft.pendingUploadedDocId || '') !== String(documentId || '')) {
    return normalizedData;
  }
  if (!draft.reviewProfile || typeof draft.reviewProfile !== 'object') {
    return normalizedData;
  }
  return mergeReviewProfileWithDraft(normalizedData, draft.reviewProfile);
}

function restoreReviewDraftUiState(draft, setters) {
  if (!draft || typeof draft !== 'object') return;
  const {
    setReviewStep,
    setStep3FollowUps,
    setStep3FollowUpAnswers,
    setAcceptedFields,
    setCvExtractLocalization,
    setReviewDialogOpen,
    inputQualityDiagnosisCacheRef,
    inputQualityDiagnosisAppliedFingerprintRef,
  } = setters;
  if (typeof draft.reviewStep === 'number') {
    let step = draft.reviewStep;
    // Step order: 4 = context follow-ups, 5 = seniority. Migrate legacy drafts (4=seniority, 5=context).
    const hasContextFollowUps =
      Array.isArray(draft.step3FollowUps) && draft.step3FollowUps.length > 0;
    if (step === 3 && hasContextFollowUps) {
      step = 4;
    } else if (step === 5) {
      step = 4;
    } else if (step === 4 && !hasContextFollowUps) {
      const seniority = draft.reviewProfile?.seniority;
      step = seniority && validateSeniorityPayload(seniority).ok ? 5 : 4;
    }
    setReviewStep(step);
  }
  if (Array.isArray(draft.step3FollowUps)) setStep3FollowUps(draft.step3FollowUps);
  if (draft.step3FollowUpAnswers && typeof draft.step3FollowUpAnswers === 'object') {
    setStep3FollowUpAnswers(draft.step3FollowUpAnswers);
  }
  if (draft.acceptedFields && typeof draft.acceptedFields === 'object') {
    setAcceptedFields(draft.acceptedFields);
  }
  if (draft.cvExtractLocalization && typeof draft.cvExtractLocalization === 'object') {
    setCvExtractLocalization(draft.cvExtractLocalization);
  }
  if (draft.reviewDialogOpen) setReviewDialogOpen(true);
  if (inputQualityDiagnosisCacheRef && draft.inputQualityDiagnosisCache) {
    inputQualityDiagnosisCacheRef.current = diagnosisCacheMapFromDraft(draft.inputQualityDiagnosisCache);
  }
  if (
    inputQualityDiagnosisAppliedFingerprintRef
    && typeof draft.inputQualityDiagnosisAppliedFingerprint === 'string'
  ) {
    inputQualityDiagnosisAppliedFingerprintRef.current = draft.inputQualityDiagnosisAppliedFingerprint;
  }
}

function restoreManualFillDraftUiState(draft, setters) {
  if (!draft || typeof draft !== 'object') return;
  const {
    setReviewProfile,
    setReviewStep,
    setAcceptedFields,
    setManualWorkEnjoyComplete,
    setManualTopicsComplete,
    setManualStrengthsComplete,
    setManualWorkEnvironmentComplete,
    setManualWorkingLifeAchievementComplete,
    setWorkEnjoyMostUserEdited,
    setTopicsIndustriesUserEdited,
    setNaturallyGoodAtUserEdited,
    setWorkEnvironmentFitUserEdited,
    setWorkingLifeAchievementUserEdited,
    setManualFillCoachingDraft,
    setManualFillCvSnapshot,
    setOptionalCvSkipped,
    setPendingUploadedDocId,
    setCvExtractLocalization,
    ensureReviewProfileShape,
    normalizeExtractedProfileData,
    setExtractedProfileData,
  } = setters;

  const emptyProfile = normalizeExtractedProfileData({});
  setExtractedProfileData(emptyProfile);
  if (draft.reviewProfile && typeof draft.reviewProfile === 'object') {
    setReviewProfile(ensureReviewProfileShape(draft.reviewProfile));
  } else {
    setReviewProfile(ensureReviewProfileShape(emptyProfile));
  }
  if (typeof draft.reviewStep === 'number') {
    let step = draft.reviewStep;
    // Manual fill does not use CV-only identity (2), good-at overview (3), or context follow-up (4).
    if (step === 2 || step === 3 || step === 4) {
      step = MANUAL_FILL_REVIEW_STEPS.SKILLS_TO_LEARN;
    } else if (!MANUAL_FILL_STEP_ORDER.includes(step)) {
      step = MANUAL_FILL_STEP_ORDER[0];
    }
    setReviewStep(step);
  }
  if (draft.acceptedFields && typeof draft.acceptedFields === 'object') {
    setAcceptedFields(draft.acceptedFields);
  }
  setManualWorkEnjoyComplete(Boolean(draft.manualWorkEnjoyComplete));
  setManualTopicsComplete(Boolean(draft.manualTopicsComplete));
  setManualStrengthsComplete(Boolean(draft.manualStrengthsComplete));
  setManualWorkEnvironmentComplete(Boolean(draft.manualWorkEnvironmentComplete));
  setManualWorkingLifeAchievementComplete(Boolean(draft.manualWorkingLifeAchievementComplete));
  setWorkEnjoyMostUserEdited(Boolean(draft.workEnjoyMostUserEdited));
  setTopicsIndustriesUserEdited(Boolean(draft.topicsIndustriesUserEdited));
  setNaturallyGoodAtUserEdited(Boolean(draft.naturallyGoodAtUserEdited));
  setWorkEnvironmentFitUserEdited(Boolean(draft.workEnvironmentFitUserEdited));
  setWorkingLifeAchievementUserEdited(Boolean(draft.workingLifeAchievementUserEdited));
  setManualFillCoachingDraft(
    draft.coachingDraft && typeof draft.coachingDraft === 'object' ? draft.coachingDraft : {}
  );
  if (setManualFillCvSnapshot) {
    setManualFillCvSnapshot(
      draft.manualFillCvSnapshot && typeof draft.manualFillCvSnapshot === 'object'
        ? draft.manualFillCvSnapshot
        : null
    );
  }
  if (setOptionalCvSkipped) setOptionalCvSkipped(Boolean(draft.optionalCvSkipped));
  if (setPendingUploadedDocId && draft.pendingUploadedDocId) {
    setPendingUploadedDocId(String(draft.pendingUploadedDocId));
  }
  if (setCvExtractLocalization && draft.cvExtractLocalization) {
    setCvExtractLocalization(draft.cvExtractLocalization);
  }
  const {
    skillsUserEditedRef,
    skillsToLearnUserEditedRef,
    cvSkillsSelectionResolvedRef,
    cvSkillsToLearnResolvedRef,
  } = setters;
  const draftSkills = draft.reviewProfile?.structuredUserInfo?.skills || [];
  const draftStep = draft.reviewStep;
  if (
    skillsUserEditedRef
    && typeof draftStep === 'number'
    && draftStep > MANUAL_FILL_REVIEW_STEPS.SKILLS_SELECTION
    && reviewProfileHasSelectedSkill({ structuredUserInfo: { skills: draftSkills } })
  ) {
    skillsUserEditedRef.current = true;
    if (cvSkillsSelectionResolvedRef) cvSkillsSelectionResolvedRef.current = true;
  }
  const draftSkillsInDevelopment = draft.reviewProfile?.structuredUserInfo?.skillsInDevelopment || [];
  if (
    skillsToLearnUserEditedRef
    && reviewProfileHasSkillsInDevelopment({
      structuredUserInfo: { skillsInDevelopment: draftSkillsInDevelopment },
    })
  ) {
    skillsToLearnUserEditedRef.current = true;
    if (cvSkillsToLearnResolvedRef) cvSkillsToLearnResolvedRef.current = true;
  }
}

function resolveCoachingInitialMessages(coachingDraft, stepKey) {
  const entry = coachingDraft?.[stepKey];
  if (!entry || entry.phase !== 'chat' || !Array.isArray(entry.messages)) return [];
  return entry.messages;
}

function resolveWorkEnjoyInitialActivities(reviewProfile, coachingDraft, manualFillCvSnapshot) {
  const fromProfile = parseActivitiesFromText(reviewProfile?.userIdentity?.workEnjoyMost);
  if (fromProfile.length > 0 && !hasManualFillCvSnapshot(manualFillCvSnapshot)) return fromProfile;
  const entry = coachingDraft?.workEnjoy;
  if (entry?.phase === 'summary' && Array.isArray(entry.activities)) {
    return entry.activities.filter((item) => String(item || '').trim());
  }
  return [];
}

function resolveTopicsInitialInterest(reviewProfile, coachingDraft, manualFillCvSnapshot) {
  const fromProfile = parseInterestTopicsFromText(reviewProfile?.userIdentity?.topicsIndustriesInterest);
  if (fromProfile.length > 0 && !hasManualFillCvSnapshot(manualFillCvSnapshot)) return fromProfile;
  const entry = coachingDraft?.topics;
  if (entry?.phase === 'summary' && Array.isArray(entry.interestTopics)) {
    return entry.interestTopics.filter((item) => String(item || '').trim());
  }
  return [];
}

function resolveTopicsInitialIndustries(reviewProfile, coachingDraft, manualFillCvSnapshot) {
  const fromProfile = (reviewProfile?.structuredUserInfo?.domains || [])
    .map((item) => (typeof item === 'string' ? item : item?.name || ''))
    .filter((item) => String(item || '').trim());
  if (fromProfile.length > 0 && !hasManualFillCvSnapshot(manualFillCvSnapshot)) return fromProfile;
  const entry = coachingDraft?.topics;
  if (entry?.phase === 'summary' && Array.isArray(entry.industries)) {
    return entry.industries.filter((item) => String(item || '').trim());
  }
  return [];
}

function resolveStrengthsInitialStrengths(reviewProfile, coachingDraft, manualFillCvSnapshot) {
  const parsed = parseNaturallyGoodAtFromText(reviewProfile?.userIdentity?.naturallyGoodAt);
  if (parsed.strengths.length > 0 && !hasManualFillCvSnapshot(manualFillCvSnapshot)) {
    return parsed.strengths;
  }
  const entry = coachingDraft?.strengths;
  if (entry?.phase === 'summary' && Array.isArray(entry.strengths)) {
    return entry.strengths.filter((item) => String(item || '').trim());
  }
  return [];
}

function resolveStrengthsInitialSkillDomains(reviewProfile, coachingDraft, manualFillCvSnapshot) {
  const fromProfile = (reviewProfile?.structuredUserInfo?.skillDomains || [])
    .map((item) => (typeof item === 'string' ? item : item?.name || ''))
    .filter((item) => String(item || '').trim());
  if (fromProfile.length > 0 && !hasManualFillCvSnapshot(manualFillCvSnapshot)) return fromProfile;
  const entry = coachingDraft?.strengths;
  if (entry?.phase === 'summary' && Array.isArray(entry.skillDomains)) {
    return entry.skillDomains.filter((item) => String(item || '').trim());
  }
  return [];
}

function appendCoachingContextTexts(texts, coachingDraft, stepKey) {
  const entry = coachingDraft?.[stepKey];
  if (!entry) return;
  if (Array.isArray(entry.messages)) {
    entry.messages
      .filter((msg) => msg?.role === 'user')
      .forEach((msg) => texts.push(String(msg.content || '').trim()));
  }
  if (entry.phase !== 'summary') return;
  if (stepKey === 'workEnjoy' && Array.isArray(entry.activities)) {
    entry.activities.forEach((item) => texts.push(String(item || '').trim()));
  }
  if (stepKey === 'topics') {
    if (Array.isArray(entry.interestTopics)) {
      entry.interestTopics.forEach((item) => texts.push(String(item || '').trim()));
    }
    if (Array.isArray(entry.industries)) {
      entry.industries.forEach((item) => texts.push(String(item || '').trim()));
    }
  }
}

function buildSkillDomainRecommendationContext(reviewProfile, coachingDraft) {
  const texts = [];
  const seniority = reviewProfile?.seniority || {};
  Object.values(seniority).forEach((value) => {
    if (value == null || value === '') return;
    texts.push(String(value).trim());
  });
  const workEnjoy = reviewProfile?.userIdentity?.workEnjoyMost;
  if (workEnjoy) texts.push(String(workEnjoy).trim());
  const topics = reviewProfile?.userIdentity?.topicsIndustriesInterest;
  if (topics) texts.push(String(topics).trim());
  (reviewProfile?.structuredUserInfo?.domains || []).forEach((item) => {
    texts.push(typeof item === 'string' ? item : String(item?.name || '').trim());
  });
  appendCoachingContextTexts(texts, coachingDraft, 'workEnjoy');
  appendCoachingContextTexts(texts, coachingDraft, 'topics');
  appendCoachingContextTexts(texts, coachingDraft, 'strengths');
  return texts.map((item) => String(item || '').trim()).filter(Boolean);
}

function buildSkillSelectionRecommendationContext(reviewProfile, coachingDraft) {
  const texts = [...buildSkillDomainRecommendationContext(reviewProfile, coachingDraft)];
  const naturallyGoodAt = reviewProfile?.userIdentity?.naturallyGoodAt;
  if (naturallyGoodAt) texts.push(String(naturallyGoodAt).trim());
  const workEnvironment = reviewProfile?.userIdentity?.workEnvironmentFit;
  if (workEnvironment) texts.push(String(workEnvironment).trim());
  const workingLifeAchievement = reviewProfile?.userIdentity?.workingLifeAchievement;
  if (workingLifeAchievement) texts.push(String(workingLifeAchievement).trim());
  (reviewProfile?.structuredUserInfo?.skillDomains || []).forEach((item) => {
    texts.push(String(item || '').trim());
  });
  (reviewProfile?.structuredUserInfo?.keyResponsibilities || []).forEach((item) => {
    texts.push(String(item || '').trim());
  });
  appendCoachingContextTexts(texts, coachingDraft, 'workEnvironment');
  appendCoachingContextTexts(texts, coachingDraft, 'workingLifeAchievement');
  const seen = new Set();
  return texts
    .map((item) => String(item || '').trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function resolveWorkEnvironmentInitial(reviewProfile, coachingDraft, manualFillCvSnapshot) {
  const parsed = parseWorkEnvironmentFromText(reviewProfile?.userIdentity?.workEnvironmentFit);
  if ((parsed.workStyles.length > 0 || parsed.workEnvironments.length > 0)
    && !hasManualFillCvSnapshot(manualFillCvSnapshot)) {
    return parsed;
  }
  const entry = coachingDraft?.workEnvironment;
  if (entry?.phase === 'summary') {
    return {
      workStyles: Array.isArray(entry.workStyles) ? entry.workStyles : [],
      workEnvironments: Array.isArray(entry.workEnvironments) ? entry.workEnvironments : [],
    };
  }
  return { workStyles: [], workEnvironments: [] };
}

function resolveWorkingLifeAchievementInitial(reviewProfile, coachingDraft, manualFillCvSnapshot) {
  const parsed = parseWorkingLifeAchievementFromText(reviewProfile?.userIdentity?.workingLifeAchievement);
  if ((parsed.careerGoals.length > 0 || parsed.priorities.length > 0)
    && !hasManualFillCvSnapshot(manualFillCvSnapshot)) {
    return parsed;
  }
  const entry = coachingDraft?.workingLifeAchievement;
  if (entry?.phase === 'summary') {
    return {
      careerGoals: Array.isArray(entry.careerGoals) ? entry.careerGoals : [],
      priorities: Array.isArray(entry.priorities) ? entry.priorities : [],
    };
  }
  return { careerGoals: [], priorities: [] };
}

const DocumentUploadForm = ({
  documents = [],
  onDocumentsUpdate,
  loading,
  onExtractedProfileReview,
  enableExtractionReview = true,
  defaultDocumentType = '',
  showSectionTitle = true,
  reviewSaveMode = 'merge',
  parentSavingReview = false,
  hideDocumentList = false,
  openReviewForDocumentId = null,
  restrictAutoResumeToDocumentId = null,
  onReviewSessionEnd = null,
  showManualFillOption = false,
  manualFillOnly = false,
}) => {
  const { user } = useAuth();
  const reviewUserId = String(user?.id || user?._id || '').trim() || null;
  const reviewDraftRestoredRef = useRef(false);
  const reviewDialogContentRef = useRef(null);
  /** Field keys to scroll to after validation errors render (see useEffect below). */
  const pendingReviewScrollRef = useRef(null);
  const [reviewScrollTick, setReviewScrollTick] = useState(0);
  const { t, i18n } = useTranslation('onboarding');
  const uiLangCode = useMemo(
    () => String(i18n.resolvedLanguage || i18n.language || 'en').toLowerCase().split('-')[0] || 'en',
    [i18n.resolvedLanguage, i18n.language]
  );
  const currentEmploymentStatusLabelLocalized = (value) =>
    t(`profilePage.seniorityForm.options.currentStatus.${value}`, {
      defaultValue: currentEmploymentStatusLabel(value),
    });
  const highestDegreeLabelLocalized = (value) =>
    t(`profilePage.seniorityForm.options.highestDegree.${value}`, {
      defaultValue: highestDegreeLabel(value),
    });
  const mostSeniorLabelLocalized = (value) =>
    t(`profilePage.seniorityForm.options.mostSenior.${value}`, {
      defaultValue: String(value || ''),
    });
  const [uploadError, setUploadError] = useState('');
  const [extractionError, setExtractionError] = useState('');
  const [uploadSucceeded, setUploadSucceeded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedCvDisplayName, setUploadedCvDisplayName] = useState('');
  const [documentType, setDocumentType] = useState(defaultDocumentType || '');
  const [extractedProfileData, setExtractedProfileData] = useState(null);
  /** Bilingual payloads from CV pipeline; forwarded on review save for profile merge. */
  const [cvExtractLocalization, setCvExtractLocalization] = useState(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewProfile, setReviewProfile] = useState({});
  const [reviewStep, setReviewStep] = useState(1);
  const reviewStep1FileInputRef = useRef(null);
  const advancingToIdentityStepRef = useRef(false);
  /** CV document ids the user dismissed via wizard cancel — blocks auto-resume polling. */
  const dismissedCvWizardDocIdsRef = useRef(new Set());
  /** True after explicit wizard cancel until the user starts a new CV upload. */
  const cvWizardUserCanceledRef = useRef(false);
  const [reviewStep1Advancing, setReviewStep1Advancing] = useState(false);

  const isWizardCvDocDismissed = useCallback((docId) => {
    if (!docId) return false;
    return dismissedCvWizardDocIdsRef.current.has(String(docId));
  }, []);

  const clearCvExtractionUiState = useCallback(() => {
    cvPollAbortRef.current?.abort();
    cvPollAbortRef.current = null;
    setCvPollTarget(null);
    setCvPipelinePhase('idle');
    setUploadSucceeded(false);
    setUploadedCvDisplayName('');
    setCvPollTimedOutDocId(null);
    setCvPollFailedDocId(null);
    setCvZombieSnapshot(null);
    setCvRecoveryUxPhase('normal');
    setCvRecoveryBusy(false);
    setExtractionEstimatedState(null);
    setPollReconnecting(false);
    setReviewStep1Advancing(false);
    advancingToIdentityStepRef.current = false;
    cvPollSnapshotRef.current = null;
  }, []);
  const [step3FollowUps, setStep3FollowUps] = useState([]);
  const [step3FollowUpAnswers, setStep3FollowUpAnswers] = useState({});
  const [inputQualityDiagnosisError, setInputQualityDiagnosisError] = useState(null);
  const [inputQualityDiagnosisLoading, setInputQualityDiagnosisLoading] = useState(false);
  const inputQualityDiagnosisAbortRef = useRef(null);
  const inputQualityDiagnosisCacheRef = useRef(new Map());
  const inputQualityDiagnosisInflightFingerprintRef = useRef('');
  const inputQualityDiagnosisInflightPromiseRef = useRef(null);
  const inputQualityDiagnosisAppliedFingerprintRef = useRef('');
  /** idle | warming | ready | failed — gates Save on step 5 until warm completes or times out. */
  const [step5NarrativeWarmStatus, setStep5NarrativeWarmStatus] = useState('idle');
  const [step5NarrativeWarmProgress, setStep5NarrativeWarmProgress] = useState(0);
  const [step5NarrativeWarmSlow, setStep5NarrativeWarmSlow] = useState(false);
  const [acceptedFields, setAcceptedFields] = useState({});
  const [savingReview, setSavingReview] = useState(false);
  const savingReviewActive = savingReview || parentSavingReview;
  const [editingDocId, setEditingDocId] = useState(null);
  const [editingDescription, setEditingDescription] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState(null);
  const [pendingUploadedDocId, setPendingUploadedDocId] = useState(null);
  const [autoStartUpload, setAutoStartUpload] = useState(false);
  const [reviewCancelConfirmOpen, setReviewCancelConfirmOpen] = useState(false);
  const [manualFillStartConfirmOpen, setManualFillStartConfirmOpen] = useState(false);
  const [manualFillDiscardConfirmOpen, setManualFillDiscardConfirmOpen] = useState(false);
  const [manualFillMode, setManualFillMode] = useState(false);
  const [manualFillCvSnapshot, setManualFillCvSnapshot] = useState(null);
  const [optionalCvSkipped, setOptionalCvSkipped] = useState(false);
  const [manualFillCoachingDraft, setManualFillCoachingDraft] = useState({});
  const [hasSavedManualFillDraft, setHasSavedManualFillDraft] = useState(false);
  const [manualWorkEnjoyComplete, setManualWorkEnjoyComplete] = useState(false);
  const [manualTopicsComplete, setManualTopicsComplete] = useState(false);
  const [manualStrengthsComplete, setManualStrengthsComplete] = useState(false);
  const [manualWorkEnvironmentComplete, setManualWorkEnvironmentComplete] = useState(false);
  const [manualWorkingLifeAchievementComplete, setManualWorkingLifeAchievementComplete] = useState(false);
  const [workEnjoyMostUserEdited, setWorkEnjoyMostUserEdited] = useState(false);
  const [topicsIndustriesUserEdited, setTopicsIndustriesUserEdited] = useState(false);
  const [naturallyGoodAtUserEdited, setNaturallyGoodAtUserEdited] = useState(false);
  const [workEnvironmentFitUserEdited, setWorkEnvironmentFitUserEdited] = useState(false);
  const [workingLifeAchievementUserEdited, setWorkingLifeAchievementUserEdited] = useState(false);
  const [workEnjoySummaryFooter, setWorkEnjoySummaryFooter] = useState({
    canConfirm: false,
    isEditing: false,
    hasActivities: false,
  });
  const [topicsSummaryFooter, setTopicsSummaryFooter] = useState({
    canConfirm: false,
    isEditing: false,
    hasSummary: false,
  });
  const [strengthsSummaryFooter, setStrengthsSummaryFooter] = useState({
    canConfirm: false,
    isEditing: false,
    hasSummary: false,
  });
  const [workEnvironmentSummaryFooter, setWorkEnvironmentSummaryFooter] = useState({
    canConfirm: false,
    isEditing: false,
    hasSummary: false,
  });
  const [workingLifeAchievementSummaryFooter, setWorkingLifeAchievementSummaryFooter] = useState({
    canConfirm: false,
    isEditing: false,
    hasSummary: false,
  });
  const workEnjoyConfirmRef = useRef(() => {});
  const topicsConfirmRef = useRef(() => {});
  const strengthsConfirmRef = useRef(() => {});
  const workEnvironmentConfirmRef = useRef(() => {});
  const workingLifeAchievementConfirmRef = useRef(() => {});
  const structuredCvMergeAppliedRef = useRef(false);
  const cvSkillsSelectionResolvedRef = useRef(false);
  const cvSkillsToLearnResolvedRef = useRef(false);
  const cvPreResolvedSkillsRef = useRef(null);
  const cvPreResolveSkillsPromiseRef = useRef(null);
  const skillsUserEditedRef = useRef(false);
  const skillsToLearnUserEditedRef = useRef(false);
  const manualFillCvSnapshotApplyRef = useRef(null);
  const manualFillModeRef = useRef(false);
  /** Validation/save errors shown inside the review dialog (not hidden behind the modal). */
  const [reviewDialogError, setReviewDialogError] = useState('');
  /** True while context-step continue awaits diagnosis or narrative cache warm. */
  const [reviewContinueBusy, setReviewContinueBusy] = useState(false);
  /** Step 3 waiting for parallel structured enrichment after Step 2 continue. */
  const [structuredReviewLoading, setStructuredReviewLoading] = useState(false);
  const cvPollSnapshotRef = useRef(null);
  /** Per-field errors keyed by review path (e.g. userIdentity.workEnjoyMost). */
  const [reviewFieldErrors, setReviewFieldErrors] = useState({});

  const documentsRef = useRef(documents);
  const openReviewBootstrappedRef = useRef(null);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const notifyReviewSessionEnd = useCallback(() => {
    if (typeof onReviewSessionEnd === 'function') {
      onReviewSessionEnd();
    }
  }, [onReviewSessionEnd]);

  const refreshSavedManualFillDraftFlag = useCallback(() => {
    if (!reviewUserId) {
      setHasSavedManualFillDraft(false);
      return;
    }
    const draft = loadManualFillDraft(reviewUserId);
    setHasSavedManualFillDraft(hasMeaningfulManualFillDraft(draft));
  }, [reviewUserId]);

  const strengthsSkillDomainRecommendationContext = useMemo(
    () => buildSkillDomainRecommendationContext(reviewProfile, manualFillCoachingDraft),
    [reviewProfile, manualFillCoachingDraft]
  );

  const skillSelectionRecommendationContext = useMemo(
    () => buildSkillSelectionRecommendationContext(reviewProfile, manualFillCoachingDraft),
    [reviewProfile, manualFillCoachingDraft]
  );

  useEffect(() => {
    if (!showManualFillOption) return undefined;
    refreshSavedManualFillDraftFlag();
    return undefined;
  }, [showManualFillOption, reviewUserId, refreshSavedManualFillDraftFlag]);

  const buildCurrentManualFillDraft = useCallback(() => buildManualFillDraftPayload({
    reviewProfile,
    reviewStep,
    acceptedFields,
    manualFillCvSnapshot,
    optionalCvSkipped,
    pendingUploadedDocId,
    cvExtractLocalization,
    manualWorkEnjoyComplete,
    manualTopicsComplete,
    manualStrengthsComplete,
    manualWorkEnvironmentComplete,
    manualWorkingLifeAchievementComplete,
    workEnjoyMostUserEdited,
    topicsIndustriesUserEdited,
    naturallyGoodAtUserEdited,
    workEnvironmentFitUserEdited,
    workingLifeAchievementUserEdited,
    coachingDraft: manualFillCoachingDraft,
  }), [
    reviewProfile,
    reviewStep,
    acceptedFields,
    manualFillCvSnapshot,
    optionalCvSkipped,
    pendingUploadedDocId,
    cvExtractLocalization,
    manualWorkEnjoyComplete,
    manualTopicsComplete,
    manualStrengthsComplete,
    manualWorkEnvironmentComplete,
    manualWorkingLifeAchievementComplete,
    workEnjoyMostUserEdited,
    topicsIndustriesUserEdited,
    naturallyGoodAtUserEdited,
    workEnvironmentFitUserEdited,
    workingLifeAchievementUserEdited,
    manualFillCoachingDraft,
  ]);

  const persistManualFillDraft = useCallback((draftOverride = null) => {
    if (!reviewUserId) return;
    const payload = draftOverride || buildCurrentManualFillDraft();
    if (!hasMeaningfulManualFillDraft(payload)) return;
    saveManualFillDraft(reviewUserId, payload);
    setHasSavedManualFillDraft(true);
  }, [reviewUserId, buildCurrentManualFillDraft]);

  const buildCurrentCvReviewDraft = useCallback(() => buildCvReviewDraftPayload({
    pendingUploadedDocId,
    reviewProfile,
    reviewStep,
    step3FollowUps,
    step3FollowUpAnswers,
    acceptedFields,
    cvExtractLocalization,
    reviewDialogOpen: true,
    inputQualityDiagnosisCache: diagnosisCacheMapToDraft(inputQualityDiagnosisCacheRef.current),
    inputQualityDiagnosisAppliedFingerprint: inputQualityDiagnosisAppliedFingerprintRef.current,
  }), [
    pendingUploadedDocId,
    reviewProfile,
    reviewStep,
    step3FollowUps,
    step3FollowUpAnswers,
    acceptedFields,
    cvExtractLocalization,
  ]);

  const persistCvReviewDraft = useCallback((draftOverride = null) => {
    if (!reviewUserId) return;
    const payload = draftOverride || buildCurrentCvReviewDraft();
    if (!hasMeaningfulCvReviewDraft(payload)) return;
    saveCvReviewDraft(reviewUserId, payload);
  }, [reviewUserId, buildCurrentCvReviewDraft]);

  const handleManualFillCoachingPersist = useCallback((stepKey, snapshot) => {
    setManualFillCoachingDraft((prev) => ({
      ...prev,
      [stepKey]: snapshot,
    }));
  }, []);

  const resetManualFillUiState = useCallback(() => {
    setManualFillMode(false);
    setManualFillCvSnapshot(null);
    setOptionalCvSkipped(false);
    setManualFillCoachingDraft({});
    setManualWorkEnjoyComplete(false);
    setManualTopicsComplete(false);
    setManualStrengthsComplete(false);
    setManualWorkEnvironmentComplete(false);
    setManualWorkingLifeAchievementComplete(false);
    setWorkEnjoyMostUserEdited(false);
    setTopicsIndustriesUserEdited(false);
    setNaturallyGoodAtUserEdited(false);
    setWorkEnvironmentFitUserEdited(false);
    setWorkingLifeAchievementUserEdited(false);
    setWorkEnjoySummaryFooter({ canConfirm: false, isEditing: false, hasActivities: false });
    setTopicsSummaryFooter({ canConfirm: false, isEditing: false, hasSummary: false });
    setStrengthsSummaryFooter({ canConfirm: false, isEditing: false, hasSummary: false });
    setWorkEnvironmentSummaryFooter({ canConfirm: false, isEditing: false, hasSummary: false });
    setWorkingLifeAchievementSummaryFooter({ canConfirm: false, isEditing: false, hasSummary: false });
    workEnjoyConfirmRef.current = () => {};
    topicsConfirmRef.current = () => {};
    strengthsConfirmRef.current = () => {};
    workEnvironmentConfirmRef.current = () => {};
    workingLifeAchievementConfirmRef.current = () => {};
    structuredCvMergeAppliedRef.current = false;
    cvSkillsSelectionResolvedRef.current = false;
    cvSkillsToLearnResolvedRef.current = false;
    skillsUserEditedRef.current = false;
    skillsToLearnUserEditedRef.current = false;
  }, []);

  useEffect(() => {
    if (reviewDialogOpen) {
      setReviewDialogError('');
      setReviewFieldErrors({});
      pendingReviewScrollRef.current = null;
      return undefined;
    }
    inputQualityDiagnosisAbortRef.current?.abort();
    inputQualityDiagnosisAbortRef.current = null;
    inputQualityDiagnosisInflightFingerprintRef.current = '';
    inputQualityDiagnosisInflightPromiseRef.current = null;
    inputQualityDiagnosisAppliedFingerprintRef.current = '';
    setInputQualityDiagnosisLoading(false);
    return undefined;
  }, [reviewDialogOpen]);

  useEffect(() => () => {
    inputQualityDiagnosisAbortRef.current?.abort();
  }, []);

  /** After intentional step changes, start at the top of the new step content. */
  useEffect(() => {
    if (!reviewDialogOpen) return undefined;
    if (pendingReviewScrollRef.current?.length) return undefined;
    scheduleReviewFieldScroll(() => {
      reviewDialogContentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
    return undefined;
  }, [reviewDialogOpen, reviewStep]);

  useEffect(() => {
    const keys = pendingReviewScrollRef.current;
    if (!reviewDialogOpen || !keys?.length) return undefined;
    pendingReviewScrollRef.current = null;
    scheduleReviewFieldScroll(() => {
      scrollToFirstReviewField(keys, reviewDialogContentRef.current);
    });
    return undefined;
  }, [reviewDialogOpen, reviewStep, reviewFieldErrors, reviewScrollTick]);

  const clearReviewFieldError = (fieldKey) => {
    setReviewDialogError('');
    if (!fieldKey) return;
    setReviewFieldErrors((prev) => {
      if (!prev[fieldKey]) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  };

  const clearGoodAtCategoryErrors = (arrayKey, rowIndex) => {
    clearReviewFieldError(`structuredUserInfo.${arrayKey}`);
    if (rowIndex != null) clearReviewFieldError(`structuredUserInfo.${arrayKey}.${rowIndex}`);
  };

  const queueReviewFieldScroll = (fieldKeys) => {
    const list = (Array.isArray(fieldKeys) ? fieldKeys : [fieldKeys]).filter(Boolean);
    if (!list.length) return;
    pendingReviewScrollRef.current = list;
    setReviewScrollTick((n) => n + 1);
  };

  const applyReviewValidationToUi = (result) => {
    if (result.ok) {
      setReviewFieldErrors({});
      setReviewDialogError('');
      return true;
    }
    setReviewFieldErrors(translateReviewFieldErrors(result.fieldErrors, t));
    setReviewDialogError(t('documentUpload.review.errors.fixHighlightedFields'));
    const focusStep = manualFillMode
      ? mapManualFillReviewStepFromField(result.firstField, result.focusStep || 2)
      : (result.focusStep || 2);
    setReviewStep(focusStep);
    queueReviewFieldScroll(
      buildReviewFieldScrollQueue(result.firstField, result.fieldErrors)
    );
    return false;
  };

  /** Active CV extraction poll target (async pipeline after upload). */
  const [cvPollTarget, setCvPollTarget] = useState(null);
  const [cvPipelinePhase, setCvPipelinePhase] = useState('idle');
  const [extractionEstimatedState, setExtractionEstimatedState] = useState(null);
  const [pollReconnecting, setPollReconnecting] = useState(false);
  /** Document id for which client polling hit max duration (prevents immediate auto-resume). */
  const [cvPollTimedOutDocId, setCvPollTimedOutDocId] = useState(null);
  /** Document id for which polling ended in failure (prevents stale-doc resume loop). */
  const [cvPollFailedDocId, setCvPollFailedDocId] = useState(null);
  /** Latest zombie/recovery signals from status API or poll snapshot. */
  const [cvZombieSnapshot, setCvZombieSnapshot] = useState(null);
  /** 'normal' | 'slow' | 'stuck' | 'recovery' — drives recovery messaging. */
  const [cvRecoveryUxPhase, setCvRecoveryUxPhase] = useState('normal');
  const [cvRecoveryBusy, setCvRecoveryBusy] = useState(false);
  const cvPollAbortRef = useRef(null);

  /** Persist review answers while the dialog is open (survives tab refresh / long editing). */
  useEffect(() => {
    if (!enableExtractionReview || !reviewUserId || !pendingUploadedDocId) return undefined;
    if (!reviewDialogOpen && !extractedProfileData) return undefined;
    const timer = setTimeout(() => {
      persistCvReviewDraft();
    }, 400);
    return () => clearTimeout(timer);
  }, [
    enableExtractionReview,
    reviewUserId,
    pendingUploadedDocId,
    reviewProfile,
    reviewStep,
    step3FollowUps,
    step3FollowUpAnswers,
    acceptedFields,
    cvExtractLocalization,
    reviewDialogOpen,
    extractedProfileData,
    persistCvReviewDraft,
    buildCurrentCvReviewDraft,
  ]);

  /** Persist manual-fill answers while the dialog is open and on cancel. */
  useEffect(() => {
    if (!manualFillMode || !reviewUserId || !reviewDialogOpen) return undefined;
    const timer = setTimeout(() => {
      persistManualFillDraft();
    }, 400);
    return () => clearTimeout(timer);
  }, [
    manualFillMode,
    reviewUserId,
    reviewDialogOpen,
    persistManualFillDraft,
    buildCurrentManualFillDraft,
  ]);

  /** Merge CV structured suggestions when entering tasks step (coaching edits take precedence). */
  useEffect(() => {
    if (!manualFillMode || reviewStep !== MANUAL_FILL_REVIEW_STEPS.TASKS_RESPONSIBILITIES) {
      if (reviewStep !== MANUAL_FILL_REVIEW_STEPS.TASKS_RESPONSIBILITIES) {
        structuredCvMergeAppliedRef.current = false;
      }
      return undefined;
    }
    if (structuredCvMergeAppliedRef.current || !hasManualFillCvSnapshot(manualFillCvSnapshot)) {
      return undefined;
    }
    structuredCvMergeAppliedRef.current = true;
    const merged = mergeStructuredFromCvSnapshot(reviewProfile, manualFillCvSnapshot, {
      topicsIndustriesUserEdited,
      naturallyGoodAtUserEdited,
      uiLanguage: uiLangCode,
    });
    setReviewProfile(merged);
    prefetchRoleSkillRecommendations({
      contextTexts: buildSkillSelectionRecommendationContext(merged, manualFillCoachingDraft),
    });
    return undefined;
  }, [
    manualFillMode,
    reviewStep,
    reviewProfile,
    manualFillCvSnapshot,
    manualFillCoachingDraft,
    topicsIndustriesUserEdited,
    naturallyGoodAtUserEdited,
    uiLangCode,
  ]);

  /** Pre-resolve CV skill labels in the background so the skills step can apply them immediately. */
  useEffect(() => {
    if (!manualFillMode || !hasManualFillCvSnapshot(manualFillCvSnapshot)) {
      cvPreResolvedSkillsRef.current = null;
      cvPreResolveSkillsPromiseRef.current = null;
      return undefined;
    }
    const candidates = buildCvSkillSelectionCandidates(manualFillCvSnapshot);
    if (candidates.length === 0) {
      cvPreResolvedSkillsRef.current = [];
      cvPreResolveSkillsPromiseRef.current = Promise.resolve([]);
      return undefined;
    }
    const token = localStorage.getItem('token');
    const resolvePromise = resolveRoleSkillLabels({
      labels: candidates,
      token,
      langQuery: getProfileApiLangQuery(),
    })
      .then((matched) => {
        cvPreResolvedSkillsRef.current = matched;
        return matched;
      })
      .catch(() => {
        cvPreResolvedSkillsRef.current = null;
        return [];
      });
    cvPreResolveSkillsPromiseRef.current = resolvePromise;
    return undefined;
  }, [manualFillMode, manualFillCvSnapshot]);

  /** Match CV-extracted skill names to the role-skill catalog when entering skills selection. */
  useEffect(() => {
    if (!manualFillMode || reviewStep !== MANUAL_FILL_REVIEW_STEPS.SKILLS_SELECTION) {
      if (reviewStep !== MANUAL_FILL_REVIEW_STEPS.SKILLS_SELECTION) {
        cvSkillsSelectionResolvedRef.current = false;
      }
      return undefined;
    }
    if (
      cvSkillsSelectionResolvedRef.current
      || skillsUserEditedRef.current
      || !hasManualFillCvSnapshot(manualFillCvSnapshot)
    ) {
      return undefined;
    }
    const candidates = buildCvSkillSelectionCandidates(manualFillCvSnapshot);
    if (candidates.length === 0) {
      cvSkillsSelectionResolvedRef.current = true;
      return undefined;
    }

    const applyMatchedSkills = (matched) => {
      if (!matched || matched.length === 0) return;
      cvSkillsSelectionResolvedRef.current = true;
      const nextSkills = capGoodAtList(matched.map((name) => ({ name })), 'skills');
      setReviewProfile((prev) => ({
        ...prev,
        structuredUserInfo: {
          ...(prev.structuredUserInfo || {}),
          skills: nextSkills,
        },
      }));
      setAcceptedFields((prev) => ({
        ...prev,
        ...buildAcceptedSkillFields(nextSkills),
      }));
    };

    const preResolved = cvPreResolvedSkillsRef.current;
    if (Array.isArray(preResolved)) {
      applyMatchedSkills(preResolved);
      return undefined;
    }

    let cancelled = false;
    const resolvePromise = cvPreResolveSkillsPromiseRef.current
      || resolveRoleSkillLabels({
        labels: candidates,
        token: localStorage.getItem('token'),
        langQuery: getProfileApiLangQuery(),
      });
    resolvePromise
      .then((matched) => {
        if (cancelled) return;
        applyMatchedSkills(matched);
      })
      .catch(() => {
        if (!cancelled) cvSkillsSelectionResolvedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [manualFillMode, reviewStep, manualFillCvSnapshot]);

  /** Match remaining CV skills to catalog for learning goals (exclude step-9 selections). */
  useEffect(() => {
    if (!manualFillMode || reviewStep !== MANUAL_FILL_REVIEW_STEPS.SKILLS_TO_LEARN) {
      if (reviewStep !== MANUAL_FILL_REVIEW_STEPS.SKILLS_TO_LEARN) {
        cvSkillsToLearnResolvedRef.current = false;
      }
      return undefined;
    }
    if (
      cvSkillsToLearnResolvedRef.current
      || skillsToLearnUserEditedRef.current
      || !hasManualFillCvSnapshot(manualFillCvSnapshot)
    ) {
      return undefined;
    }
    const excludeLabels = skillLabelsFromProfile(reviewProfile.structuredUserInfo?.skills || []);
    const candidates = buildCvSkillsToLearnCandidates(manualFillCvSnapshot, excludeLabels);
    if (candidates.length === 0) {
      cvSkillsToLearnResolvedRef.current = true;
      return undefined;
    }
    let cancelled = false;
    const token = localStorage.getItem('token');
    resolveRoleSkillLabels({
      labels: candidates,
      token,
      langQuery: getProfileApiLangQuery(),
    })
      .then((matched) => {
        if (cancelled || matched.length === 0) return;
        cvSkillsToLearnResolvedRef.current = true;
        const nextSkills = capGoodAtList(matched.map((name) => ({ name })), 'skillsInDevelopment');
        setReviewProfile((prev) => ({
          ...prev,
          structuredUserInfo: {
            ...(prev.structuredUserInfo || {}),
            skillsInDevelopment: nextSkills,
          },
        }));
        setAcceptedFields((prev) => ({
          ...prev,
          ...buildAcceptedSkillsInDevelopmentFields(nextSkills),
        }));
      })
      .catch(() => {
        if (!cancelled) cvSkillsToLearnResolvedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [
    manualFillMode,
    reviewStep,
    manualFillCvSnapshot,
    reviewProfile.structuredUserInfo?.skills,
  ]);

  /** Polish German CV responsibility bullets when entering tasks step (also fixes legacy extractions). */
  useEffect(() => {
    if (!manualFillMode || reviewStep !== MANUAL_FILL_REVIEW_STEPS.TASKS_RESPONSIBILITIES) return undefined;
    if (uiLangCode !== 'de') return undefined;
    setReviewProfile((prev) => {
      const items = prev.structuredUserInfo?.keyResponsibilities || [];
      if (items.length === 0) return prev;
      const normalized = normalizeGermanCvResponsibilityList(items, { force: true });
      if (normalized.join('\u0001') === items.join('\u0001')) return prev;
      return {
        ...prev,
        structuredUserInfo: {
          ...(prev.structuredUserInfo || {}),
          keyResponsibilities: normalized,
        },
      };
    });
    return undefined;
  }, [manualFillMode, reviewStep, uiLangCode]);

  useEffect(() => {
    manualFillModeRef.current = manualFillMode;
  }, [manualFillMode]);

  /** Recover from CV-wizard steps if manual fill was routed there by extraction. */
  useEffect(() => {
    if (!manualFillMode || !reviewDialogOpen) return undefined;
    if (reviewStep !== 2 && reviewStep !== 3 && reviewStep !== 4) return undefined;
    setReviewStep(optionalCvSkipped
      ? MANUAL_FILL_REVIEW_STEPS.SENIORITY
      : MANUAL_FILL_REVIEW_STEPS.OPTIONAL_CV);
    return undefined;
  }, [manualFillMode, reviewDialogOpen, reviewStep, optionalCvSkipped]);

  /** Step 4 (context): follow-up prompts must be answered before continuing to seniority. */
  const step3FollowUpsAnsweredFully = useMemo(() => {
    if (reviewStep !== 4) return true;
    if (!step3FollowUps.length) return true;
    return step3FollowUps.every((d) => String(step3FollowUpAnswers[d.field] || '').trim().length > 0);
  }, [reviewStep, step3FollowUps, step3FollowUpAnswers]);

  const step3SeniorityComplete = useMemo(() => {
    if (reviewStep !== 5) return true;
    return validateSeniorityPayload(reviewProfile?.seniority || {}).ok;
  }, [reviewStep, reviewProfile?.seniority]);

  const mergeFollowUpAnswersIntoProfile = useCallback((profile, followUps, answers) => (
    applyStep3FollowUpAnswersToReviewProfile(
      profile,
      followUps,
      answers,
      buildProtectedIdentityFollowUpFields(
        workEnjoyMostUserEdited,
        topicsIndustriesUserEdited,
        naturallyGoodAtUserEdited,
        workEnvironmentFitUserEdited,
        workingLifeAchievementUserEdited
      )
    )
  ), [workEnjoyMostUserEdited, topicsIndustriesUserEdited, naturallyGoodAtUserEdited, workEnvironmentFitUserEdited, workingLifeAchievementUserEdited]);

  useEffect(() => {
    if (!workEnjoyMostUserEdited && !topicsIndustriesUserEdited && !naturallyGoodAtUserEdited && !workEnvironmentFitUserEdited && !workingLifeAchievementUserEdited) {
      return undefined;
    }
    setStep3FollowUps((prev) => filterProtectedIdentityFollowUps(
      prev,
      workEnjoyMostUserEdited,
      topicsIndustriesUserEdited,
      naturallyGoodAtUserEdited,
      workEnvironmentFitUserEdited,
      workingLifeAchievementUserEdited
    ));
    return undefined;
  }, [workEnjoyMostUserEdited, topicsIndustriesUserEdited, naturallyGoodAtUserEdited, workEnvironmentFitUserEdited, workingLifeAchievementUserEdited]);

  const coachingCvContext = useMemo(
    () => buildCoachingCvContextFromSnapshot(manualFillCvSnapshot),
    [manualFillCvSnapshot]
  );

  const inManualOptionalCv = manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.OPTIONAL_CV;
  const optionalCvDisplayName = useMemo(() => {
    if (uploadedCvDisplayName) return uploadedCvDisplayName;
    if (selectedFile?.name) return selectedFile.name;
    if (!pendingUploadedDocId) return '';
    const doc = (documents || []).find(
      (d) => String(d.id || d._id) === String(pendingUploadedDocId)
    );
    return String(doc?.originalName || doc?.name || doc?.description || '').trim();
  }, [uploadedCvDisplayName, selectedFile, pendingUploadedDocId, documents]);
  const optionalCvHasUpload = Boolean(
    pendingUploadedDocId || uploadSucceeded || uploading
  );
  const optionalCvExtractionComplete = cvPipelinePhase === 'completed';
  const optionalCvShowUploadedFile = Boolean(
    optionalCvDisplayName && optionalCvExtractionComplete
  );
  const optionalCvShowExtractionProgress = !optionalCvExtractionComplete && (
    Boolean(cvPollTarget)
    || cvPipelinePhase === 'failed'
    || cvPipelinePhase === 'timedOut'
    || cvRecoveryUxPhase === 'recovery'
    || cvRecoveryUxPhase === 'stuck'
    || cvRecoveryUxPhase === 'slow'
  );
  const optionalCvShowDropzone = !uploading && !uploadSucceeded && !pendingUploadedDocId && !selectedFile;
  const manualOptionalCvCanContinue = Boolean(pendingUploadedDocId) && (
    cvPipelinePhase === 'completed'
    || cvPipelinePhase === 'failed'
    || Boolean(cvPollFailedDocId)
    || Boolean(cvPollTimedOutDocId)
  );
  const inManualWorkEnjoyCoaching = manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.WORK_ENJOY_COACHING;
  const inManualTopicsCoaching = manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.TOPICS_COACHING;
  const inManualStrengthsCoaching = manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.STRENGTHS_COACHING;
  const inManualWorkEnvironmentCoaching = manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.WORK_ENVIRONMENT_COACHING;
  const inManualWorkingLifeAchievementCoaching = manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.WORKING_LIFE_ACHIEVEMENT_COACHING;
  const inManualTasksResponsibilities = manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.TASKS_RESPONSIBILITIES;
  const inManualSkillsSelection = manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.SKILLS_SELECTION;
  const inManualSkillsToLearn = manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.SKILLS_TO_LEARN;
  /** CV extraction review only — manual fill reuses reviewStep 5 for seniority mid-flow. */
  const isCvReviewFinalSeniorityStep = reviewStep === 5 && !manualFillMode;

  const isReviewContinueStep = manualFillMode
    ? (inManualOptionalCv
      ? false
      : MANUAL_FILL_STEP_ORDER.includes(reviewStep) && !isManualFillLastStep(reviewStep))
    : reviewStep >= 2 && reviewStep <= 4;

  const hideReviewPrimaryAction = (inManualWorkEnjoyCoaching && !workEnjoySummaryFooter.canConfirm)
    || (inManualTopicsCoaching && !topicsSummaryFooter.canConfirm)
    || (inManualStrengthsCoaching && !strengthsSummaryFooter.canConfirm)
    || (inManualWorkEnvironmentCoaching && !workEnvironmentSummaryFooter.canConfirm)
    || (inManualWorkingLifeAchievementCoaching && !workingLifeAchievementSummaryFooter.canConfirm);

  const showWorkEnjoySummaryConfirm = inManualWorkEnjoyCoaching && workEnjoySummaryFooter.canConfirm;
  const showTopicsSummaryConfirm = inManualTopicsCoaching && topicsSummaryFooter.canConfirm;
  const showStrengthsSummaryConfirm = inManualStrengthsCoaching && strengthsSummaryFooter.canConfirm;
  const showWorkEnvironmentSummaryConfirm = inManualWorkEnvironmentCoaching && workEnvironmentSummaryFooter.canConfirm;
  const showWorkingLifeAchievementSummaryConfirm = inManualWorkingLifeAchievementCoaching && workingLifeAchievementSummaryFooter.canConfirm;

  const handleBindWorkEnjoyConfirm = useCallback((confirm) => {
    workEnjoyConfirmRef.current = typeof confirm === 'function' ? confirm : () => {};
  }, []);

  const handleBindTopicsConfirm = useCallback((confirm) => {
    topicsConfirmRef.current = typeof confirm === 'function' ? confirm : () => {};
  }, []);

  const handleBindStrengthsConfirm = useCallback((confirm) => {
    strengthsConfirmRef.current = typeof confirm === 'function' ? confirm : () => {};
  }, []);

  const handleBindWorkEnvironmentConfirm = useCallback((confirm) => {
    workEnvironmentConfirmRef.current = typeof confirm === 'function' ? confirm : () => {};
  }, []);

  const handleBindWorkingLifeAchievementConfirm = useCallback((confirm) => {
    workingLifeAchievementConfirmRef.current = typeof confirm === 'function' ? confirm : () => {};
  }, []);

  const handleSelectedSkillsChange = useCallback((skills) => {
    skillsUserEditedRef.current = true;
    const capped = capGoodAtList(
      (Array.isArray(skills) ? skills : [])
        .map((item) => {
          const name = typeof item === 'string' ? item : item?.name;
          return { name: String(name || '').trim() };
        })
        .filter((item) => item.name),
      'skills'
    );
    setReviewProfile((prev) => ({
      ...prev,
      structuredUserInfo: {
        ...(prev.structuredUserInfo || {}),
        skills: capped,
      },
    }));
    setAcceptedFields((prev) => ({
      ...prev,
      ...buildAcceptedSkillFields(capped),
    }));
    clearReviewFieldError('structuredUserInfo.skills');
  }, [clearReviewFieldError]);

  const handleSkillsToLearnChange = useCallback((skills) => {
    skillsToLearnUserEditedRef.current = true;
    const capped = capGoodAtList(
      (Array.isArray(skills) ? skills : [])
        .map((item) => {
          const name = typeof item === 'string' ? item : item?.name;
          return String(name || '').trim();
        })
        .filter(Boolean),
      'skillsInDevelopment'
    );
    setReviewProfile((prev) => ({
      ...prev,
      structuredUserInfo: {
        ...(prev.structuredUserInfo || {}),
        skillsInDevelopment: capped,
      },
    }));
    setAcceptedFields((prev) => ({
      ...prev,
      ...buildAcceptedSkillsInDevelopmentFields(capped),
    }));
    clearReviewFieldError('structuredUserInfo.skillsInDevelopment');
  }, [clearReviewFieldError]);

  const excludedSkillLabelsForLearning = useMemo(
    () => skillLabelsFromProfile(reviewProfile.structuredUserInfo?.skills || []),
    [reviewProfile.structuredUserInfo?.skills]
  );

  const skillSelectionContextKey = useMemo(
    () => JSON.stringify(skillSelectionRecommendationContext),
    [skillSelectionRecommendationContext]
  );

  const prefetchSkillSelectionRecommendations = useCallback((profile = reviewProfile) => {
    prefetchRoleSkillRecommendations({
      contextTexts: buildSkillSelectionRecommendationContext(profile, manualFillCoachingDraft),
    });
  }, [reviewProfile, manualFillCoachingDraft]);

  useEffect(() => {
    if (!manualFillMode) return undefined;
    // Warm the server-side skill catalog cache early in the flow.
    prefetchRoleSkillRecommendations({ contextTexts: [] });
    return undefined;
  }, [manualFillMode]);

  useEffect(() => {
    if (!manualFillMode) return undefined;
    const shouldPrefetch = [
      MANUAL_FILL_REVIEW_STEPS.STRENGTHS_COACHING,
      MANUAL_FILL_REVIEW_STEPS.WORK_ENVIRONMENT_COACHING,
      MANUAL_FILL_REVIEW_STEPS.WORKING_LIFE_ACHIEVEMENT_COACHING,
      MANUAL_FILL_REVIEW_STEPS.TASKS_RESPONSIBILITIES,
      MANUAL_FILL_REVIEW_STEPS.SKILLS_SELECTION,
      MANUAL_FILL_REVIEW_STEPS.SKILLS_TO_LEARN,
    ].includes(reviewStep);
    if (!shouldPrefetch) return undefined;
    prefetchSkillSelectionRecommendations();
    return undefined;
  }, [
    manualFillMode,
    reviewStep,
    skillSelectionContextKey,
    prefetchSkillSelectionRecommendations,
  ]);

  const handleTasksResponsibilitiesChange = useCallback((items) => {
    const capped = capGoodAtList(
      (Array.isArray(items) ? items : []).map((item) => String(item || '')),
      'keyResponsibilities'
    );
    setReviewProfile((prev) => ({
      ...prev,
      structuredUserInfo: {
        ...(prev.structuredUserInfo || {}),
        keyResponsibilities: capped,
      },
    }));
    setAcceptedFields((prev) => ({
      ...prev,
      ...buildAcceptedKeyResponsibilityFields(capped),
    }));
    clearReviewFieldError('structuredUserInfo.keyResponsibilities');
  }, [clearReviewFieldError]);

  const handleSkillDomainsChange = useCallback((skillDomains) => {
    const capped = capGoodAtList(
      (Array.isArray(skillDomains) ? skillDomains : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
      'skillDomains'
    );
    setReviewProfile((prev) => ({
      ...prev,
      structuredUserInfo: {
        ...(prev.structuredUserInfo || {}),
        skillDomains: capped,
      },
    }));
    setAcceptedFields((prev) => ({
      ...prev,
      ...buildAcceptedSkillDomainFields(capped),
    }));
    clearReviewFieldError('structuredUserInfo.skillDomains');
  }, [clearReviewFieldError]);

  const reviewSkillDomainValues = useMemo(
    () => (reviewProfile.structuredUserInfo?.skillDomains || [])
      .map((item) => (typeof item === 'string' ? item : String(item?.name || '')).trim())
      .filter(Boolean),
    [reviewProfile.structuredUserInfo?.skillDomains]
  );

  const handleIndustryDomainsChange = useCallback((domains) => {
    const capped = capGoodAtList(
      normalizeIndustryDomains(domains, { keepUnknown: true }),
      'domains'
    );
    setReviewProfile((prev) => ({
      ...prev,
      structuredUserInfo: {
        ...(prev.structuredUserInfo || {}),
        domains: capped,
      },
    }));
    setAcceptedFields((prev) => ({
      ...prev,
      ...buildAcceptedDomainFields(capped),
    }));
    clearReviewFieldError('structuredUserInfo.domains');
  }, [clearReviewFieldError]);

  const reviewIndustryDomainValues = useMemo(
    () => normalizeIndustryDomains(reviewProfile.structuredUserInfo?.domains || [], { keepUnknown: true }),
    [reviewProfile.structuredUserInfo?.domains]
  );

  const reviewSkillValues = useMemo(
    () => skillLabelsFromProfile(reviewProfile.structuredUserInfo?.skills || []),
    [reviewProfile.structuredUserInfo?.skills]
  );

  const reviewLearningGoalValues = useMemo(
    () => skillLabelsFromProfile(reviewProfile.structuredUserInfo?.skillsInDevelopment || []),
    [reviewProfile.structuredUserInfo?.skillsInDevelopment]
  );

  const handleWorkEnjoySummaryFooterStateChange = useCallback((state) => {
    setWorkEnjoySummaryFooter(state);
  }, []);

  const handleTopicsSummaryFooterStateChange = useCallback((state) => {
    setTopicsSummaryFooter(state);
  }, []);

  const handleStrengthsSummaryFooterStateChange = useCallback((state) => {
    setStrengthsSummaryFooter(state);
  }, []);

  const handleWorkEnvironmentSummaryFooterStateChange = useCallback((state) => {
    setWorkEnvironmentSummaryFooter(state);
  }, []);

  const handleWorkingLifeAchievementSummaryFooterStateChange = useCallback((state) => {
    setWorkingLifeAchievementSummaryFooter(state);
  }, []);

  const showReviewBackButton = manualFillMode
    ? !isManualFillFirstStep(reviewStep)
    : reviewStep > 2;

  const seniorityFieldErrorKey = (field) => {
    const keys = {
      currentStatus: 'profilePage.seniorityForm.errors.currentStatusRequired',
      yearsOfExperience: 'profilePage.seniorityForm.errors.yearsRequired',
      highestDegree: 'profilePage.seniorityForm.errors.highestDegreeRequired',
      mostSeniorWorkExperience: 'profilePage.seniorityForm.errors.mostSeniorRequired',
    };
    return keys[field] || 'documentUpload.errors.saveProfileFailed';
  };

  const loadReviewProfileFromExtraction = useCallback((normalizedData, documentId) => {
    const draft = reviewUserId ? loadCvReviewDraft(reviewUserId) : null;
    const merged = applyStoredReviewDraft(reviewUserId, documentId, normalizedData, draft);
    setReviewProfile(ensureReviewProfileShape(merged));
    if (draft && String(draft.pendingUploadedDocId) === String(documentId)) {
      restoreReviewDraftUiState(draft, {
        setReviewStep,
        setStep3FollowUps,
        setStep3FollowUpAnswers,
        setAcceptedFields,
        setCvExtractLocalization,
        setReviewDialogOpen,
      });
    } else {
      setReviewStep(2);
      setStep3FollowUps([]);
      setStep3FollowUpAnswers({});
      inputQualityDiagnosisAppliedFingerprintRef.current = '';
    }
  }, [reviewUserId]);

  const normalizeExtractedProfileData = (data = {}) => {
    const structuredUserInfo = data?.structuredUserInfo || {};
    const userIdentity = data?.userIdentity || {};
    const seniority = data?.seniority || {};
    const yearsRaw = seniority.yearsOfExperience;
    let yearsOfExperience = null;
    if (yearsRaw !== null && yearsRaw !== undefined && yearsRaw !== '') {
      if (typeof yearsRaw === 'number' && Number.isFinite(yearsRaw)) {
        yearsOfExperience = yearsRaw >= 0 && yearsRaw <= 50 ? yearsRaw : null;
      } else {
        const m = String(yearsRaw).match(/\d{1,2}/);
        const parsed = m ? Number.parseInt(m[0], 10) : NaN;
        yearsOfExperience = Number.isFinite(parsed) && parsed >= 0 && parsed <= 50 ? parsed : null;
      }
    }
    let currentStatus = sanitizeCurrentEmploymentStatus(seniority.currentStatus || '')
      || inferCurrentEmploymentStatusFromText(seniority.currentStatus || '');
    let highestDegree = String(seniority.highestDegree || '').trim();
    if (highestDegree && !HIGHEST_DEGREE_ALLOWED.includes(highestDegree)) {
      highestDegree = inferHighestDegreeFromText(highestDegree);
    }
    let mostSeniorWorkExperience = String(seniority.mostSeniorWorkExperience || '').trim();
    if (mostSeniorWorkExperience && !MOST_SENIOR_ALLOWED.includes(mostSeniorWorkExperience)) {
      mostSeniorWorkExperience = inferMostSeniorRoleFromText(mostSeniorWorkExperience);
    }
    const normalizedSkills = Array.isArray(structuredUserInfo.skills)
      ? structuredUserInfo.skills
        .map((skill) => (typeof skill === 'string' ? { name: skill } : { name: skill?.name || '' }))
        .filter((skill) => skill.name.trim())
      : [];
    return {
      ...data,
      seniority: {
        currentStatus,
        yearsOfExperience,
        highestDegree,
        mostSeniorWorkExperience
      },
      userIdentity: {
        workEnjoyMost: userIdentity.workEnjoyMost || '',
        topicsIndustriesInterest: userIdentity.topicsIndustriesInterest || '',
        naturallyGoodAt: userIdentity.naturallyGoodAt || '',
        workEnvironmentFit: userIdentity.workEnvironmentFit || '',
        workingLifeAchievement: userIdentity.workingLifeAchievement || ''
      },
      structuredUserInfo: {
        skillDomains: capGoodAtList(Array.isArray(structuredUserInfo.skillDomains)
          ? structuredUserInfo.skillDomains
          : [], 'skillDomains'),
        skills: capGoodAtList(normalizedSkills, 'skills'),
        skillsInDevelopment: capGoodAtList(Array.isArray(structuredUserInfo.skillsInDevelopment)
          ? structuredUserInfo.skillsInDevelopment
          : [], 'skillsInDevelopment'),
        certifications: Array.isArray(structuredUserInfo.certifications)
          ? structuredUserInfo.certifications
          : [],
        keyResponsibilities: capGoodAtList(Array.isArray(structuredUserInfo.keyResponsibilities)
          ? structuredUserInfo.keyResponsibilities
          : [], 'keyResponsibilities'),
        domains: capGoodAtList(Array.isArray(structuredUserInfo.domains)
          ? structuredUserInfo.domains
          : [], 'domains')
      }
    };
  };

  const buildAcceptedDefaults = (profileData = {}) => {
    const defaults = {};
    const skills = profileData?.structuredUserInfo?.skills || [];
    const domains = profileData?.structuredUserInfo?.domains || [];
    const skillDomains = profileData?.structuredUserInfo?.skillDomains || [];
    const keyResponsibilities = profileData?.structuredUserInfo?.keyResponsibilities || [];
    const skillsInDevelopment = profileData?.structuredUserInfo?.skillsInDevelopment || [];

    skillDomains.forEach((_, idx) => { defaults[`structuredUserInfo.skillDomains.${idx}`] = true; });
    skills.forEach((_, idx) => { defaults[`structuredUserInfo.skills.${idx}`] = true; });
    domains.forEach((_, idx) => { defaults[`structuredUserInfo.domains.${idx}`] = true; });
    keyResponsibilities.forEach((_, idx) => { defaults[`structuredUserInfo.keyResponsibilities.${idx}`] = true; });
    skillsInDevelopment.forEach((_, idx) => { defaults[`structuredUserInfo.skillsInDevelopment.${idx}`] = true; });

    return defaults;
  };

  const isAccepted = (fieldKey) => acceptedFields[fieldKey] !== false;
  const toggleAccepted = (fieldKey) => {
    setAcceptedFields((prev) => ({ ...prev, [fieldKey]: !isAccepted(fieldKey) }));
  };

  /** Selected (checked) rows first, deselected rows at the bottom — prefix e.g. `structuredUserInfo.skillDomains`. */
  const sortStructuredIndices = (prefix, length) => {
    if (!length) return [];
    const indices = Array.from({ length }, (_, i) => i);
    return [
      ...indices.filter((i) => isAccepted(`${prefix}.${i}`)),
      ...indices.filter((i) => !isAccepted(`${prefix}.${i}`))
    ];
  };

  const appendStructuredStringList = (arrayKey) => {
    const maxItems = getProfileStructuredListMaxItems(arrayKey);
    let appended = false;
    let newIdx = 0;
    setReviewProfile((prev) => {
      const sui = prev.structuredUserInfo || {};
      const prevList = sui[arrayKey] || [];
      if (prevList.length >= maxItems) return prev;
      appended = true;
      newIdx = prevList.length;
      return { ...prev, structuredUserInfo: { ...sui, [arrayKey]: [...prevList, ''] } };
    });
    if (appended) {
      setAcceptedFields((af) => ({ ...af, [`structuredUserInfo.${arrayKey}.${newIdx}`]: true }));
    }
  };

  const renderReviewEntryCheckbox = (fieldKey, label) => (
    <Box sx={REVIEW.checkboxLabelRow}>
      <Checkbox
        checked={isAccepted(fieldKey)}
        onChange={() => toggleAccepted(fieldKey)}
        size="small"
        sx={REVIEW.checkbox}
      />
      <Typography component="span" variant="body2" sx={REVIEW.checkboxLabelText}>
        {label}
      </Typography>
    </Box>
  );

  const renderGoodAtCategoryLimitNotice = (arrayKey) => {
    const maxItems = getProfileStructuredListMaxItems(arrayKey);
    const count = (reviewProfile.structuredUserInfo?.[arrayKey] || []).length;
    if (count < maxItems) return null;
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 0.5 }}>
        {t('documentUpload.review.goodAtLimit', { max: maxItems })}
      </Typography>
    );
  };

  const openManualFillDialog = useCallback((draft = null) => {
    setUploadError('');
    setExtractionError('');
    setReviewDialogError('');
    cvWizardUserCanceledRef.current = false;
    clearCvExtractionUiState();
    setPendingUploadedDocId(null);
    setSelectedFile(null);
    setUploading(false);
    setAutoStartUpload(false);
    setCvExtractLocalization(null);
    setStep3FollowUps([]);
    setStep3FollowUpAnswers({});
    if (draft) {
      restoreManualFillDraftUiState(draft, {
        setReviewProfile,
        setReviewStep,
        setAcceptedFields,
        setManualWorkEnjoyComplete,
        setManualTopicsComplete,
        setManualStrengthsComplete,
        setManualWorkEnvironmentComplete,
        setManualWorkingLifeAchievementComplete,
        setWorkEnjoyMostUserEdited,
        setTopicsIndustriesUserEdited,
        setNaturallyGoodAtUserEdited,
        setWorkEnvironmentFitUserEdited,
        setWorkingLifeAchievementUserEdited,
        setManualFillCoachingDraft,
        setManualFillCvSnapshot,
        setOptionalCvSkipped,
        setPendingUploadedDocId,
        setCvExtractLocalization,
        ensureReviewProfileShape,
        normalizeExtractedProfileData,
        setExtractedProfileData,
        skillsUserEditedRef,
        skillsToLearnUserEditedRef,
        cvSkillsSelectionResolvedRef,
        cvSkillsToLearnResolvedRef,
      });
      setManualFillMode(true);
    } else {
      const emptyProfile = normalizeExtractedProfileData({});
      setExtractedProfileData(emptyProfile);
      setReviewProfile(ensureReviewProfileShape(emptyProfile));
      setAcceptedFields({});
      setManualFillCoachingDraft({});
      resetManualFillUiState();
      setManualFillMode(true);
      setManualFillCvSnapshot(null);
      setOptionalCvSkipped(false);
      setReviewStep(MANUAL_FILL_REVIEW_STEPS.OPTIONAL_CV);
    }
    setReviewDialogOpen(true);
  }, [clearCvExtractionUiState, resetManualFillUiState]);

  const startManualFillFresh = useCallback(() => {
    if (reviewUserId) clearManualFillDraft(reviewUserId);
    setHasSavedManualFillDraft(false);
    openManualFillDialog(null);
  }, [reviewUserId, openManualFillDialog]);

  const handleStartManualFillClick = useCallback(() => {
    if (hasSavedManualFillDraft) {
      setManualFillStartConfirmOpen(true);
      return;
    }
    startManualFillFresh();
  }, [hasSavedManualFillDraft, startManualFillFresh]);

  const resumeManualFill = useCallback(() => {
    if (!reviewUserId) return;
    const draft = loadManualFillDraft(reviewUserId);
    if (!hasMeaningfulManualFillDraft(draft)) {
      refreshSavedManualFillDraftFlag();
      return;
    }
    openManualFillDialog(draft);
  }, [reviewUserId, openManualFillDialog, refreshSavedManualFillDraftFlag]);

  const discardSavedManualFillDraft = useCallback(() => {
    if (reviewUserId) clearManualFillDraft(reviewUserId);
    setHasSavedManualFillDraft(false);
  }, [reviewUserId]);

  const queueFileForUpload = useCallback((file) => {
    if (!file) return;
    setUploadError('');
    setExtractionError('');
    setUploading(false);
    setSelectedFile(file);
    if (enableExtractionReview) {
      cvWizardUserCanceledRef.current = false;
      clearCvExtractionUiState();
      setPendingUploadedDocId(null);
      setAutoStartUpload(true);
      setReviewDialogOpen(true);
      setReviewStep(1);
    }
  }, [enableExtractionReview, clearCvExtractionUiState]);

  const handleDelete = async (documentId) => {
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Delete failed');
      }

      onDocumentsUpdate(normalizeDocuments(documents.filter(doc => doc.id !== documentId)));
    } catch (error) {
      setUploadError(t('documentUpload.errors.deleteFailed'));
      console.error('Delete error:', error);
    }
  };

  const handleDownload = async (documentId, originalName) => {
    try {
      const response = await axios.get(`/api/documents/${documentId}/download`, {
        responseType: 'blob'
      });
      // Get the content type from the response headers
      const contentType = response.headers['content-type'] || 'application/octet-stream';
      const url = window.URL.createObjectURL(new Blob([response.data], { type: contentType }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', originalName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url); // Clean up
    } catch (err) {
      setUploadError(err.response?.data?.message || t('documentUpload.errors.downloadFailed'));
    }
  };

  const handleUpload = useCallback(async () => {
    const effectiveDocumentType = documentType || defaultDocumentType;
    if (!selectedFile || !effectiveDocumentType) {
      setUploadError(t('documentUpload.errors.selectFileAndType'));
      return;
    }

    // Check file size (10MB = 10 * 1024 * 1024 bytes)
    const maxSize = 10 * 1024 * 1024;
    if (selectedFile.size > maxSize) {
      setUploadError(t('documentUpload.errors.fileSizeLimit'));
      return;
    }

    setUploadError('');
    setExtractionError('');
    setUploadSucceeded(false);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('document', selectedFile);
      formData.append('documentType', effectiveDocumentType);

      const response = await fetch(`/api/documents/upload?lang=${encodeURIComponent(uiLangCode)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.errorKey) {
          throw new Error(getExtractionErrorMessage(errorData.errorKey, t));
        }
        throw new Error(
          errorData.message
            || errorData.error
            || t('documentUpload.errors.uploadFailed')
        );
      }

      const data = await response.json();
      const incomingDoc = data.document;
      const incomingId = String(data?.documentId || incomingDoc?.id || incomingDoc?._id || '');
      const alreadyListed = incomingId && documents.some((d) => String(d.id) === incomingId);
      if (incomingDoc && !data.deduplicated && !alreadyListed) {
        onDocumentsUpdate(normalizeDocuments([...documents, incomingDoc]));
      } else if (incomingDoc && data.deduplicated && !alreadyListed) {
        onDocumentsUpdate(normalizeDocuments([...documents, incomingDoc]));
      }
      const uploadedDocId = String(data?.documentId || data?.document?.id || data?.document?._id || '');
      setPendingUploadedDocId(uploadedDocId || null);

      const isCvUpload =
        isCvDocumentType(data?.document?.type) ||
        isCvDocumentType(effectiveDocumentType) ||
        isCvDocumentType(defaultDocumentType);

      if (isCvUpload && uploadedDocId) {
        setUploadedCvDisplayName(selectedFile.name);
        if (enableExtractionReview) {
          setReviewDialogOpen(true);
          setReviewStep(1);
        }
        setUploadSucceeded(true);
        setCvPipelinePhase('queued');
        setExtractionEstimatedState('normal');
        setPollReconnecting(false);
        setCvPollTimedOutDocId(null);
        setCvPollFailedDocId(null);
        setCvZombieSnapshot(null);
        setCvRecoveryUxPhase('normal');
        setCvPollTarget({
          documentId: uploadedDocId,
          jobId: data.jobId ? String(data.jobId) : null,
        });
      } else if (enableExtractionReview && (data.extractedProfileData || (data.extractionStatus && data.extractionStatus !== 'queued'))) {
        if (data.extractedProfileData) {
          setCvExtractLocalization(
            data.cvExtractLocalization && typeof data.cvExtractLocalization === 'object'
              ? data.cvExtractLocalization
              : null
          );
          const normalizedData = normalizeExtractedProfileData(data.extractedProfileData);
          setExtractedProfileData(normalizedData);
          loadReviewProfileFromExtraction(normalizedData, uploadedDocId || pendingUploadedDocId);
          setAcceptedFields(buildAcceptedDefaults(normalizedData));
          setInputQualityDiagnosisError(null);
          setInputQualityDiagnosisLoading(false);

          if (data.extractionStatus === 'success' || data.extractionStatus === 'partial') {
            setReviewDialogOpen(true);
          }
        } else {
          setCvExtractLocalization(null);
        }

        if (data.extractionStatus === 'failed' && (data.extractionMessage || data.extractionMessageKey)) {
          const extractionDetail = data.extractionMessageKey
            ? t(data.extractionMessageKey)
            : data.extractionMessage;
          setUploadError(`${t('documentUpload.uploadSuccessPrefix')} ${extractionDetail}`);
          setTimeout(() => setUploadError(''), 5000);
        }
      }
      // Reset form
      setSelectedFile(null);
      setDocumentType(defaultDocumentType || '');
    } catch (error) {
      setUploadError(error.message || t('documentUpload.errors.uploadFailed'));
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
    }
  }, [
    documentType,
    defaultDocumentType,
    selectedFile,
    documents,
    onDocumentsUpdate,
    enableExtractionReview,
    uiLangCode,
    t,
    loadReviewProfileFromExtraction,
    pendingUploadedDocId,
    enableExtractionReview,
  ]);

  const ensureStructuredSemanticForReview = useCallback(async (docId) => {
    const token = localStorage.getItem('token') || '';
    const langQuery = `lang=${encodeURIComponent(uiLangCode)}`;
    const res = await fetch(
      `/api/documents/${encodeURIComponent(String(docId))}/ensure-semantic-enrichment?${langQuery}`,
      {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      }
    );
    if (!res.ok) throw new Error('structured semantic enrichment failed');
    return res.json();
  }, [uiLangCode]);

  const mergeStructuredFieldsFromDocument = useCallback((document) => {
    if (!document?.extractedProfileData) return;
    const normalized = normalizeExtractedProfileData(
      stripHeuristicGoodAtFromProfileData(document.extractedProfileData, document)
    );
    setExtractedProfileData(normalized);
    setReviewProfile((prev) => ({
      ...prev,
      userIdentity: prev.userIdentity || normalized.userIdentity,
      structuredUserInfo: normalized.structuredUserInfo,
      seniority: normalized.seniority,
      name: prev.name || normalized.name,
      personalInfo: { ...(normalized.personalInfo || {}), ...(prev.personalInfo || {}) },
    }));
    setAcceptedFields((prev) => ({
      ...buildAcceptedDefaults(normalized),
      ...Object.fromEntries(
        Object.entries(prev || {}).filter(([key]) => key.startsWith('userIdentity.'))
      ),
    }));
    const mergedList = (documentsRef.current || []).map((d) =>
      String(d.id) === String(document.id) ? { ...d, ...document, id: document.id || d.id } : d
    );
    onDocumentsUpdate(normalizeDocuments(mergedList));
  }, [onDocumentsUpdate]);

  const hydrateFromDocument = useCallback(async (docId) => {
    const token = localStorage.getItem('token') || '';
    const langQuery = `lang=${encodeURIComponent(uiLangCode)}`;
    const res = await fetch(`/api/documents/${docId}?${langQuery}`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' },
    });
    if (!res.ok) throw new Error('document refresh failed');
    let data = await res.json();
    let document = data.document;
    if (!document) return false;

    if (documentNeedsCvLocalization(document, uiLangCode)) {
      const ensureRes = await fetch(
        `/api/documents/${encodeURIComponent(String(docId))}/ensure-localization?${langQuery}`,
        {
          method: 'POST',
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      if (ensureRes.ok) {
        data = await ensureRes.json();
        document = data.document || document;
      }
    }

    if (documentNeedsFullReviewQuality(document)) {
      try {
        const semanticData = await ensureStructuredSemanticForReview(String(docId));
        if (semanticData?.document) {
          document = semanticData.document;
        }
      } catch {
        // Step 2→3 will retry structured enrichment.
      }
    }

    const mergedList = (documentsRef.current || []).map((d) =>
      String(d.id) === String(docId) ? { ...d, ...document, id: document.id || d.id } : d
    );
    onDocumentsUpdate(normalizeDocuments(mergedList));

    // Be tolerant to slight API shape differences while rollout is in progress.
    const extractedPayload =
      document.extractedProfileData
      || document?.result?.profile
      || null;
    const outcome = document.extractionOutcomeStatus || document?.result?.status || null;

    if (enableExtractionReview && extractedPayload) {
      const localization = document.cvExtractLocalization && typeof document.cvExtractLocalization === 'object'
        ? document.cvExtractLocalization
        : null;

      if (manualFillModeRef.current) {
        const normalizedData = normalizeExtractedProfileData(extractedPayload);
        setCvExtractLocalization(localization);
        setPendingUploadedDocId(String(docId));
        let applied = null;
        setReviewProfile((prev) => {
          applied = applyManualFillCvExtraction(ensureReviewProfileShape(prev), normalizedData, {
            pendingUploadedDocId: docId,
            cvExtractLocalization: localization,
          });
          return applied.reviewProfile;
        });
        if (applied) {
          setManualFillCvSnapshot(applied.snapshot);
          setCvExtractLocalization(applied.cvExtractLocalization);
          setOptionalCvSkipped(false);
        }
        setReviewDialogOpen(true);
        setReviewStep((prev) => (
          prev === MANUAL_FILL_REVIEW_STEPS.OPTIONAL_CV
            ? prev
            : MANUAL_FILL_REVIEW_STEPS.OPTIONAL_CV
        ));
        return true;
      }

      const normalizedData = normalizeExtractedProfileData(
        stripHeuristicGoodAtFromProfileData(extractedPayload, document)
      );
      setCvExtractLocalization(localization);
      setExtractedProfileData(normalizedData);
      loadReviewProfileFromExtraction(normalizedData, docId);
      setAcceptedFields(buildAcceptedDefaults(normalizedData));
      setStep3FollowUps([]);
      setStep3FollowUpAnswers({});
      setInputQualityDiagnosisError(null);
      setInputQualityDiagnosisLoading(false);
      inputQualityDiagnosisAppliedFingerprintRef.current = '';
      setReviewStep((prev) => (prev > 2 ? prev : 2));
      const reviewStatus =
        outcome === 'success' || outcome === 'partial' || outcome === 'failed'
          ? outcome
          : extractedPayload
            ? 'success'
            : 'partial';
      if (reviewStatus === 'success' || reviewStatus === 'partial') {
        setReviewDialogOpen(true);
        if (enableExtractionReview) {
          setReviewStep((prev) => (prev < 2 ? 2 : prev));
        }
      }
      return true;
    }
    return false;
  }, [
    enableExtractionReview,
    onDocumentsUpdate,
    loadReviewProfileFromExtraction,
    uiLangCode,
    ensureStructuredSemanticForReview,
  ]);

  const applyManualFillCvFromDocument = useCallback(async (docId) => {
    const token = localStorage.getItem('token') || '';
    const langQuery = `lang=${encodeURIComponent(uiLangCode)}`;
    const res = await fetch(`/api/documents/${docId}?${langQuery}`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' },
    });
    if (!res.ok) throw new Error('document refresh failed');
    let data = await res.json();
    let document = data.document;
    if (!document) return false;

    if (documentNeedsCvLocalization(document, uiLangCode)) {
      const ensureRes = await fetch(
        `/api/documents/${encodeURIComponent(String(docId))}/ensure-localization?${langQuery}`,
        {
          method: 'POST',
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      if (ensureRes.ok) {
        data = await ensureRes.json();
        document = data.document || document;
      }
    }

    if (documentNeedsFullReviewQuality(document)) {
      try {
        const semanticData = await ensureStructuredSemanticForReview(String(docId));
        if (semanticData?.document) {
          document = semanticData.document;
        }
      } catch {
        // Coaching can proceed with partial CV context.
      }
    }

    const extractedPayload =
      document.extractedProfileData
      || document?.result?.profile
      || null;
    if (!extractedPayload) return false;

    const localization = document.cvExtractLocalization && typeof document.cvExtractLocalization === 'object'
      ? document.cvExtractLocalization
      : null;
    // Keep structured CV fields for coaching context — do not strip heuristic lists here.
    const normalizedData = normalizeExtractedProfileData(extractedPayload);
    let applied = null;
    setReviewProfile((prev) => {
      applied = applyManualFillCvExtraction(ensureReviewProfileShape(prev), normalizedData, {
        pendingUploadedDocId: docId,
        cvExtractLocalization: localization,
      });
      return applied.reviewProfile;
    });
    if (applied) {
      setManualFillCvSnapshot(applied.snapshot);
      setPendingUploadedDocId(applied.pendingUploadedDocId);
      setCvExtractLocalization(applied.cvExtractLocalization);
      setOptionalCvSkipped(false);
    }
    const mergedList = (documentsRef.current || []).map((d) =>
      String(d.id) === String(docId) ? { ...d, ...document, id: document.id || d.id } : d
    );
    onDocumentsUpdate(normalizeDocuments(mergedList));
    return Boolean(applied);
  }, [uiLangCode, ensureStructuredSemanticForReview, onDocumentsUpdate]);

  const handleManualFillOptionalCvSkip = useCallback(() => {
    setReviewDialogError('');
    setOptionalCvSkipped(true);
    setManualFillCvSnapshot(null);
    setPendingUploadedDocId(null);
    setCvExtractLocalization(null);
    setSelectedFile(null);
    clearCvExtractionUiState();
    setReviewStep(MANUAL_FILL_REVIEW_STEPS.SENIORITY);
  }, [clearCvExtractionUiState]);

  const handleManualFillOptionalCvContinue = useCallback(async () => {
    setReviewDialogError('');
    if (pendingUploadedDocId) {
      try {
        await applyManualFillCvFromDocument(String(pendingUploadedDocId));
      } catch {
        setReviewDialogError(t('documentUpload.errors.refreshAfterExtractionFailed'));
        return;
      }
    }
    setReviewStep(MANUAL_FILL_REVIEW_STEPS.SENIORITY);
  }, [
    pendingUploadedDocId,
    applyManualFillCvFromDocument,
    t,
  ]);

  /** Pre-build CV snapshot when extraction completes on optional CV step (draft persistence). */
  useEffect(() => {
    if (!manualFillMode || reviewStep !== MANUAL_FILL_REVIEW_STEPS.OPTIONAL_CV) return undefined;
    if (!pendingUploadedDocId || manualFillCvSnapshot) return undefined;
    if (cvPipelinePhase !== 'completed') return undefined;
    if (manualFillCvSnapshotApplyRef.current === String(pendingUploadedDocId)) return undefined;
    manualFillCvSnapshotApplyRef.current = String(pendingUploadedDocId);
    void applyManualFillCvFromDocument(String(pendingUploadedDocId)).catch(() => {
      manualFillCvSnapshotApplyRef.current = null;
    });
    return undefined;
  }, [
    manualFillMode,
    reviewStep,
    pendingUploadedDocId,
    manualFillCvSnapshot,
    cvPipelinePhase,
    applyManualFillCvFromDocument,
  ]);

  const renderCvExtractionProgressAlert = () => (
    <Alert
      severity={
        cvPipelinePhase === 'failed'
          ? 'error'
          : cvRecoveryUxPhase === 'stuck' || cvPipelinePhase === 'timedOut' || cvRecoveryUxPhase === 'recovery'
            ? 'warning'
            : 'info'
      }
      sx={{ mb: 0 }}
    >
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {t('documentUpload.async.extractionHeader')}
      </Typography>
      <Typography variant="body2" sx={{ mb: (cvPollTarget || cvRecoveryUxPhase === 'recovery' || cvRecoveryUxPhase === 'stuck') ? 1 : 0 }}>
        {(() => {
          if (cvPipelinePhase === 'failed') {
            return t('documentUpload.async.recovery.failed');
          }
          if (cvPipelinePhase === 'timedOut' || cvRecoveryUxPhase === 'recovery') {
            return t('documentUpload.async.recovery.pollStopped');
          }
          return t(resolveExtractionProgressMessageKey(cvZombieSnapshot, {
            pollReconnecting,
            extractionEstimatedState,
            hasActivePoll: Boolean(cvPollTarget),
            getZombieMessageKey: cvZombieSnapshot
              ? () => getDelayReasonI18nKey(
                cvZombieSnapshot.estimatedDelayReason,
                cvZombieSnapshot.workerHealthSignal
              )
              : null,
          }));
        })()}
      </Typography>
      {cvPollTarget && isCvExtractionUiPhaseInProgress(cvPipelinePhase) && (
        <LinearProgress
          variant={
            cvZombieSnapshot?.progress != null && Number.isFinite(Number(cvZombieSnapshot.progress))
              ? 'determinate'
              : 'indeterminate'
          }
          value={Math.min(100, Math.max(0, Number(cvZombieSnapshot?.progress ?? 0)))}
          sx={{ mb: cvRecoveryUxPhase === 'stuck' ? 1 : 0 }}
        />
      )}
      {(cvRecoveryUxPhase === 'stuck' || cvRecoveryUxPhase === 'recovery' || cvPipelinePhase === 'timedOut') && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          <Button
            size="small"
            variant="outlined"
            disabled={cvRecoveryBusy}
            onClick={handleContinueWaiting}
          >
            {t('documentUpload.async.recovery.continueWaiting')}
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={cvRecoveryBusy}
            onClick={() => void handleRefreshExtractionStatus()}
          >
            {t('documentUpload.async.recovery.refreshStatus')}
          </Button>
          {(cvZombieSnapshot?.retryRecommended || cvPipelinePhase === 'timedOut' || cvRecoveryUxPhase === 'recovery') && (
            <Button
              size="small"
              variant="contained"
              disabled={cvRecoveryBusy}
              onClick={() => void handleRetryExtraction()}
            >
              {t('documentUpload.async.recovery.retryExtraction')}
            </Button>
          )}
        </Box>
      )}
      {cvPipelinePhase === 'failed' && (
        <Box sx={{ mt: 1 }}>
          <Button
            size="small"
            variant="contained"
            disabled={cvRecoveryBusy || uploading}
            onClick={() => {
              setCvPollFailedDocId(null);
              setCvRecoveryUxPhase('normal');
              setCvZombieSnapshot(null);
              setExtractionError('');
              setCvPipelinePhase('idle');
              setUploadSucceeded(false);
              setSelectedFile(null);
              reviewStep1FileInputRef.current?.click();
            }}
          >
            {t('documentUpload.async.recovery.uploadAgain')}
          </Button>
        </Box>
      )}
    </Alert>
  );

  const applyExtractionPollSnapshot = useCallback((snapshot, pollActive) => {
    if (!snapshot) return;
    cvPollSnapshotRef.current = snapshot;
    setCvZombieSnapshot(snapshot);
    setCvRecoveryUxPhase(mapZombieSignalsToUxPhase(snapshot, pollActive));
    setExtractionEstimatedState(snapshot.estimatedState);
    setCvPipelinePhase(mapExtractionStatusToUiPhase(snapshot.status, snapshot.stage, {
      isBackgroundEnriching: snapshot.isBackgroundEnriching,
      displayStage: snapshot.displayStage,
      phase: snapshot.phase,
      blockingTask: snapshot.blockingTask,
    }));
  }, []);

  const reviewProfileRef = useRef(reviewProfile);
  const reviewStepRef = useRef(reviewStep);
  useEffect(() => {
    reviewProfileRef.current = reviewProfile;
  }, [reviewProfile]);
  useEffect(() => {
    reviewStepRef.current = reviewStep;
  }, [reviewStep]);

  const structuredExtractionReady = useMemo(() => {
    if (!pendingUploadedDocId || !enableExtractionReview) return true;
    const doc = (documents || []).find((d) => String(d.id) === String(pendingUploadedDocId));
    if (doc?.semanticEnrichmentStatus === 'complete') return true;
    if (cvZombieSnapshot?.structuredReviewReady) return true;
    return reviewProfileHasStructuredGoodAt(reviewProfile);
  }, [
    documents,
    pendingUploadedDocId,
    enableExtractionReview,
    cvZombieSnapshot,
    reviewProfile,
  ]);

  const reviewProfileIdentityIsEmpty = useCallback((profile) => (
    USER_IDENTITY_FIELDS.every(
      ({ key }) => !String(profile?.userIdentity?.[key] || '').trim()
    )
  ), []);

  const tryOpenIdentityReviewFromPoll = useCallback(async (snapshot, docId) => {
    if (manualFillModeRef.current) return;
    if (!enableExtractionReview || !snapshot?.identityReviewReady) {
      return;
    }
    if (cvWizardUserCanceledRef.current) return;
    const targetId = docId || cvPollTarget?.documentId || pendingUploadedDocId;
    if (!targetId) return;
    if (reviewDialogOpen && reviewStepRef.current === 1) {
      return;
    }
    const layers = snapshot?.extractionLayers;
    const identityDone = layers?.identity === 'done';
    if (
      reviewDialogOpen
      && !identityDone
      && !reviewProfileIdentityIsEmpty(reviewProfileRef.current)
    ) {
      return;
    }
    if (reviewDialogOpen && identityDone && reviewProfileIdentityIsEmpty(reviewProfileRef.current)) {
      try {
        const token = localStorage.getItem('token') || '';
        const res = await fetch(
          `/api/documents/${encodeURIComponent(String(targetId))}?lang=${encodeURIComponent(uiLangCode)}`,
          { headers: { Authorization: token ? `Bearer ${token}` : '' } }
        );
        if (!res.ok) return;
        const data = await res.json();
        const document = data.document;
        if (!document?.extractedProfileData) return;
        const normalized = normalizeExtractedProfileData(
          stripHeuristicGoodAtFromProfileData(document.extractedProfileData, document)
        );
        setExtractedProfileData(normalized);
        setReviewProfile((prev) => ({
          ...prev,
          userIdentity: {
            ...(prev.userIdentity || {}),
            ...(normalized.userIdentity || {}),
          },
        }));
        setAcceptedFields((prev) => ({
          ...buildAcceptedDefaults(normalized),
          ...Object.fromEntries(
            Object.entries(prev || {}).filter(([key]) => key.startsWith('userIdentity.'))
          ),
        }));
      } catch {
        // Fall through to full hydrate below.
      }
      return;
    }
    if (reviewDialogOpen) return;
    setReviewDialogOpen(true);
    setReviewStep(2);
    try {
      await hydrateFromDocument(String(targetId));
    } catch {
      // Completed poll will retry hydration.
    }
  }, [
    enableExtractionReview,
    reviewDialogOpen,
    cvPollTarget,
    pendingUploadedDocId,
    hydrateFromDocument,
    reviewProfileIdentityIsEmpty,
    uiLangCode,
    manualFillMode,
  ]);

  /** Step 1 → 2: load identity extraction into the review dialog once ready (CV wizard only). */
  useEffect(() => {
    if (!enableExtractionReview || cvWizardUserCanceledRef.current || manualFillMode) return undefined;
    if (!reviewDialogOpen || reviewStep !== 1 || !pendingUploadedDocId) {
      return undefined;
    }
    const identityReady = Boolean(cvZombieSnapshot?.identityReviewReady);
    const extractionDone = cvPipelinePhase === 'completed';
    if (!identityReady && !extractionDone) return undefined;
    if (advancingToIdentityStepRef.current) return undefined;
    advancingToIdentityStepRef.current = true;
    setReviewStep1Advancing(true);
    let cancelled = false;
    (async () => {
      try {
        await hydrateFromDocument(String(pendingUploadedDocId));
        if (!cancelled) setReviewStep(2);
      } catch {
        if (!cancelled) {
          setReviewDialogError(t('documentUpload.errors.refreshAfterExtractionFailed'));
        }
      } finally {
        advancingToIdentityStepRef.current = false;
        if (!cancelled) setReviewStep1Advancing(false);
      }
    })();
    return () => {
      cancelled = true;
      setReviewStep1Advancing(false);
      advancingToIdentityStepRef.current = false;
    };
  }, [
    enableExtractionReview,
    reviewDialogOpen,
    reviewStep,
    pendingUploadedDocId,
    cvZombieSnapshot?.identityReviewReady,
    cvPipelinePhase,
    hydrateFromDocument,
    t,
  ]);

  /** Open review (or resume extraction polling) for a specific document — profile page overlay. */
  useEffect(() => {
    if (!enableExtractionReview || !openReviewForDocumentId) return undefined;
    const docId = String(openReviewForDocumentId);
    if (openReviewBootstrappedRef.current === docId) return undefined;
    const doc = (documents || []).find((d) => String(d.id || d._id) === docId);
    if (!doc) return undefined;
    openReviewBootstrappedRef.current = docId;
    cvWizardUserCanceledRef.current = false;
    setPendingUploadedDocId(docId);

    if (isActiveCvExtractionDocument(doc)) {
      setUploadSucceeded(true);
      setExtractionError('');
      setCvPipelinePhase(doc.extractionStatus === 'processing' ? 'ocr' : 'queued');
      setCvPollTarget({ documentId: docId, jobId: null });
      setReviewDialogOpen(true);
      setReviewStep(1);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        await hydrateFromDocument(docId);
      } catch {
        if (!cancelled) {
          setUploadError(t('documentUpload.errors.refreshAfterExtractionFailed'));
          notifyReviewSessionEnd();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    enableExtractionReview,
    openReviewForDocumentId,
    documents,
    hydrateFromDocument,
    t,
    notifyReviewSessionEnd,
  ]);

  /** Resume in-flight extraction inside the wizard after navigation or refresh. */
  useEffect(() => {
    if (!enableExtractionReview || reviewDialogOpen) return undefined;
    if (cvWizardUserCanceledRef.current) return undefined;
    if (reviewDraftRestoredRef.current) return undefined;
    const resumeDocId = cvPollTarget?.documentId || pendingUploadedDocId;
    if (!resumeDocId || isWizardCvDocDismissed(resumeDocId)) return undefined;
    if (extractedProfileData && reviewStepRef.current >= 2) return undefined;
    setReviewDialogOpen(true);
    setReviewStep(1);
    return undefined;
  }, [
    enableExtractionReview,
    cvPollTarget,
    pendingUploadedDocId,
    extractedProfileData,
    reviewDialogOpen,
    isWizardCvDocDismissed,
  ]);

  const handleContinueWaiting = useCallback(() => {
    const docId = cvPollTimedOutDocId || cvPollTarget?.documentId || pendingUploadedDocId;
    if (!docId) return;
    setCvPollTimedOutDocId(null);
    setCvRecoveryUxPhase('normal');
    setExtractionError('');
    setPollReconnecting(false);
    setExtractionEstimatedState('normal');
    setCvPollTarget({ documentId: String(docId), jobId: cvPollTarget?.jobId ?? null });
    devCvExtractionLog('recovery_continue_waiting', { documentId: docId });
  }, [cvPollTimedOutDocId, cvPollTarget, pendingUploadedDocId]);

  const handleRefreshExtractionStatus = useCallback(async () => {
    const docId = cvPollTimedOutDocId || cvPollTarget?.documentId || pendingUploadedDocId;
    if (!docId) return;
    setCvRecoveryBusy(true);
    setPollReconnecting(true);
    try {
      const token = localStorage.getItem('token') || '';
      const result = await fetchCvExtractionStatus(String(docId), token);
      if (!result.ok) {
        setExtractionError(t('documentUpload.async.recovery.refreshFailed'));
        return;
      }
      const data = result.data;
      const snapshot = buildPollSnapshot(data, Number(data.elapsedMs ?? 0), 'degraded');
      applyExtractionPollSnapshot(snapshot, false);
      setPollReconnecting(false);

      if (data.status === 'completed') {
        await hydrateFromDocument(String(docId));
        setCvPollTarget(null);
        setCvPollTimedOutDocId(null);
        setCvPipelinePhase('completed');
        setCvRecoveryUxPhase('normal');
        setCvZombieSnapshot(null);
        return;
      }
      if (data.status === 'failed') {
        setExtractionError(getExtractionErrorMessage(data.errorKey, t));
        setCvPipelinePhase('failed');
        setCvPollFailedDocId(String(docId));
        setCvPollTarget(null);
        setCvPollTimedOutDocId(null);
        setCvRecoveryUxPhase('recovery');
        return;
      }
      if (snapshot.isStuck || snapshot.retryRecommended) {
        setCvRecoveryUxPhase('recovery');
      }
    } catch {
      setExtractionError(t('documentUpload.async.recovery.refreshFailed'));
    } finally {
      setCvRecoveryBusy(false);
      setPollReconnecting(false);
    }
  }, [
    cvPollTimedOutDocId,
    cvPollTarget,
    pendingUploadedDocId,
    applyExtractionPollSnapshot,
    hydrateFromDocument,
    t,
  ]);

  const handleRetryExtraction = useCallback(async () => {
    const docId = cvPollTimedOutDocId || cvPollTarget?.documentId || pendingUploadedDocId;
    if (!docId) return;
    setCvRecoveryBusy(true);
    setExtractionError('');
    try {
      const res = await fetch(
        `/api/documents/${encodeURIComponent(String(docId))}/retry-extraction?lang=${encodeURIComponent(uiLangCode)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.errorKey) {
          setExtractionError(getExtractionErrorMessage(data.errorKey, t));
        } else if (data.code === 'MAX_RETRIES') {
          setExtractionError(t('documentUpload.async.recovery.maxRetries'));
          setCvPipelinePhase('failed');
          setCvPollFailedDocId(String(docId));
        } else {
          setExtractionError(data.message || t('documentUpload.async.recovery.retryFailed'));
        }
        return;
      }
      const statusPayload = data.extractionStatus || {};
      devCvExtractionLog('recovery_retry', { documentId: docId, action: data.action });
      setCvPollTimedOutDocId(null);
      setCvPollFailedDocId(null);
      setCvRecoveryUxPhase('normal');
      setCvPipelinePhase('queued');
      setCvPollTarget({
        documentId: String(docId),
        jobId: data.jobId ? String(data.jobId) : null,
      });
      if (statusPayload.status) {
        applyExtractionPollSnapshot(
          buildPollSnapshot(statusPayload, Number(statusPayload.elapsedMs ?? 0), 'fast'),
          true
        );
      }
    } catch {
      setExtractionError(t('documentUpload.async.recovery.retryFailed'));
    } finally {
      setCvRecoveryBusy(false);
    }
  }, [
    cvPollTimedOutDocId,
    cvPollTarget,
    pendingUploadedDocId,
    uiLangCode,
    applyExtractionPollSnapshot,
    t,
  ]);

  useEffect(() => {
    if (!cvPollTarget?.documentId) {
      return undefined;
    }
    const docId = cvPollTarget.documentId;
    const token = localStorage.getItem('token') || '';
    const controller = new AbortController();
    cvPollAbortRef.current = controller;

    devCvExtractionLog('polling_started', { documentId: docId, jobId: cvPollTarget.jobId });

    watchCvExtractionUntilTerminal({
      documentId: docId,
      token,
      signal: controller.signal,
      onUpdate: (snapshot) => {
        if (enableExtractionReview && cvWizardUserCanceledRef.current) return;
        setPollReconnecting(false);
        applyExtractionPollSnapshot(snapshot, true);
        void tryOpenIdentityReviewFromPoll(snapshot, docId);
      },
      onPollError: () => {
        setPollReconnecting(true);
      },
    })
      .then(async (outcome) => {
        if (outcome.kind === 'aborted') {
          devCvExtractionLog('polling_stopped', { reason: 'unmount_or_retarget', documentId: docId });
          return;
        }
        if (enableExtractionReview && cvWizardUserCanceledRef.current) {
          return;
        }
        if (outcome.kind === 'completed') {
          try {
            const openedReview = await hydrateFromDocument(docId);
            if (
              enableExtractionReview
              && !manualFillModeRef.current
              && !openedReview
              && outcome?.data?.hasResult
            ) {
              // Keep UX moving when status says "completed with result" but hydration lags.
              setReviewDialogOpen(true);
              setReviewStep((prev) => (prev < 2 ? 2 : prev));
            }
          } catch {
            setExtractionError(t('documentUpload.errors.refreshAfterExtractionFailed'));
          }
          devCvExtractionLog('polling_stopped', { reason: 'completed', documentId: docId });
          setCvPollTarget(null);
          setCvPipelinePhase('completed');
          setExtractionEstimatedState(null);
          setCvRecoveryUxPhase('normal');
          setCvZombieSnapshot(null);
          setPollReconnecting(false);
          return;
        }
        if (outcome.kind === 'failed') {
          const errorKey = outcome.data?.errorKey ?? null;
          setExtractionError(getExtractionErrorMessage(errorKey, t));
          setCvPipelinePhase('failed');
          setCvRecoveryUxPhase('recovery');
          setCvPollFailedDocId(docId);
          const mergedList = (documentsRef.current || []).map((d) =>
            String(d.id) === String(docId)
              ? {
                  ...d,
                  extractionStatus: 'failed',
                  extractionOutcomeStatus: 'failed',
                  extractionMessageKey: errorKey,
                }
              : d
          );
          onDocumentsUpdate(normalizeDocuments(mergedList));
          devCvExtractionLog('polling_stopped', { reason: 'failed', documentId: docId });
          setCvPollTarget(null);
          setExtractionEstimatedState(null);
          setPollReconnecting(false);
          return;
        }
        if (outcome.kind === 'timedOut') {
          devCvExtractionLog('polling_stopped', {
            reason: 'timed_out',
            documentId: docId,
            elapsedMs: outcome.elapsedMs,
          });
          if (outcome.snapshot) {
            applyExtractionPollSnapshot(outcome.snapshot, false);
          }
          setCvPollTimedOutDocId(docId);
          setCvPollTarget(null);
          setCvPipelinePhase('timedOut');
          setCvRecoveryUxPhase('recovery');
          setExtractionEstimatedState(null);
          setPollReconnecting(false);
        }
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          console.error('CV extraction poll error:', err);
        }
      });

    return () => {
      controller.abort();
      cvPollAbortRef.current = null;
    };
  }, [
    cvPollTarget,
    hydrateFromDocument,
    t,
    applyExtractionPollSnapshot,
    enableExtractionReview,
    tryOpenIdentityReviewFromPoll,
  ]);

  useEffect(() => {
    if (enableExtractionReview && cvWizardUserCanceledRef.current) return;
    if (cvPollTarget?.documentId) return;
    const savedDraft = reviewUserId ? loadCvReviewDraft(reviewUserId) : null;
    const preferredDocumentId = (
      restrictAutoResumeToDocumentId
      || pendingUploadedDocId
      || savedDraft?.pendingUploadedDocId
      || null
    );
    const activeDoc = pickPreferredActiveCvDocument((documents || []).filter((d) => {
      const id = String(d.id || d._id || '');
      if (!id || isWizardCvDocDismissed(id)) return false;
      if (
        restrictAutoResumeToDocumentId
        && id !== String(restrictAutoResumeToDocumentId)
      ) {
        return false;
      }
      return true;
    }), { preferredDocumentId });
    if (!activeDoc) return;
    const docId = String(activeDoc.id || activeDoc._id || '');
    if (!docId) return;
    if (cvPollTimedOutDocId === docId) return;
    if (cvPollFailedDocId === docId) return;
    if (cvPipelinePhase === 'failed') return;
    setUploadSucceeded(true);
    setExtractionError('');
    setPollReconnecting(false);
    setExtractionEstimatedState('normal');
    setCvPipelinePhase(
      activeDoc.extractionStatus === 'processing' ? 'ocr' : 'queued'
    );
    setCvPollTarget({ documentId: docId, jobId: null });
    devCvExtractionLog('polling_resumed_after_hydrate', { documentId: docId });
  }, [
    enableExtractionReview,
    documents,
    cvPollTarget,
    cvPollTimedOutDocId,
    cvPollFailedDocId,
    cvPipelinePhase,
    isWizardCvDocDismissed,
    restrictAutoResumeToDocumentId,
    pendingUploadedDocId,
    reviewUserId,
  ]);

  useEffect(() => {
    const effectiveDocumentType = documentType || defaultDocumentType;
    if (!autoStartUpload || uploading || !selectedFile || !effectiveDocumentType) {
      return;
    }
    setAutoStartUpload(false);
    handleUpload();
  }, [
    autoStartUpload,
    uploading,
    selectedFile,
    documentType,
    defaultDocumentType,
    handleUpload,
  ]);

  // Handler for saving reviewed profile data
  const handleReviewSave = async () => {
    if (!onExtractedProfileReview) {
      console.warn('onExtractedProfileReview callback not provided');
      setReviewDialogOpen(false);
      return;
    }

    setSavingReview(true);
    setReviewDialogError('');
    try {
      const profileForSave = manualFillMode
        ? reviewProfile
        : mergeFollowUpAnswersIntoProfile(
          reviewProfile,
          step3FollowUps,
          step3FollowUpAnswers
        );
      if (!manualFillMode) {
        const emptyFollowUpField = firstEmptyFollowUpFieldKey(step3FollowUps, step3FollowUpAnswers);
        if (emptyFollowUpField) {
          setReviewDialogError(t('documentUpload.review.errors.fixHighlightedFields'));
          setReviewStep(4);
          queueReviewFieldScroll(emptyFollowUpField);
          return;
        }
      }

      const seniorityCheck = validateSeniorityPayload(profileForSave.seniority || {});
      if (!seniorityCheck.ok) {
        setReviewDialogError(t(seniorityFieldErrorKey(seniorityCheck.field)));
        setReviewStep(5);
        queueReviewFieldScroll(seniorityReviewFieldKey(seniorityCheck.field));
        return;
      }
      if (!applyReviewValidationToUi(validateReviewIdentityStep(profileForSave))) {
        return;
      }
      if (
        !applyReviewValidationToUi(
          validateReviewProfileInDialog(profileForSave, acceptedFields, { requireGoodAt: true })
        )
      ) {
        return;
      }
      const structuredGoodAt = buildStructuredGoodAtFromReview(profileForSave, acceptedFields);
      const payload = {
        structuredUserInfo: {
          skillDomains: structuredGoodAt.skillDomains,
          skills: structuredGoodAt.skills,
          domains: structuredGoodAt.domains,
          keyResponsibilities: structuredGoodAt.keyResponsibilities,
          skillsInDevelopment: structuredGoodAt.skillsInDevelopment
        },
        userIdentity: profileForSave.userIdentity || {},
        seniority: seniorityCheck.value,
        __reviewOptions: { mode: reviewSaveMode },
        ...(pendingUploadedDocId ? { documentId: String(pendingUploadedDocId) } : {}),
        ...(acceptedFields && typeof acceptedFields === 'object' ? { acceptedFields } : {}),
        ...(cvExtractLocalization && typeof cvExtractLocalization === 'object'
          ? { __cvExtractLocalization: cvExtractLocalization }
          : {})
      };

      if (reviewUserId) {
        saveCvReviewDraft(reviewUserId, {
          pendingUploadedDocId,
          reviewProfile: profileForSave,
          reviewStep,
          step3FollowUps,
          step3FollowUpAnswers,
          acceptedFields,
          cvExtractLocalization,
          reviewDialogOpen: true,
        });
      }

      await onExtractedProfileReview(payload);
      if (reviewUserId) {
        clearCvReviewDraft(reviewUserId);
        if (manualFillMode) {
          clearManualFillDraft(reviewUserId);
          setHasSavedManualFillDraft(false);
        }
      }
      setReviewDialogOpen(false);
      resetManualFillUiState();
      notifyReviewSessionEnd();
      setExtractedProfileData(null);
      setCvExtractLocalization(null);
      setReviewProfile({});
      setAcceptedFields({});
      setStep3FollowUps([]);
      setStep3FollowUpAnswers([]);
      setInputQualityDiagnosisError(null);
      setInputQualityDiagnosisLoading(false);
      inputQualityDiagnosisAbortRef.current?.abort();
      inputQualityDiagnosisAbortRef.current = null;
      inputQualityDiagnosisInflightFingerprintRef.current = '';
      inputQualityDiagnosisInflightPromiseRef.current = null;
      inputQualityDiagnosisAppliedFingerprintRef.current = '';
      setPendingUploadedDocId(null);
      setCvPollTarget(null);
      setCvPollTimedOutDocId(null);
      setCvPipelinePhase('idle');
      setExtractionEstimatedState(null);
      setPollReconnecting(false);
      setUploadSucceeded(false);
      cvPollAbortRef.current?.abort();
      setUploadError('');
      setExtractionError('');
      setReviewDialogError('');
      setReviewFieldErrors({});
    } catch (error) {
      console.error('Error saving reviewed profile data:', error);
      if (error instanceof ProfileReviewSaveError && error.fieldErrors && Object.keys(error.fieldErrors).length > 0) {
        const errorKeys = Object.keys(error.fieldErrors);
        setReviewFieldErrors(error.fieldErrors);
        setReviewDialogError(error.userMessage || t('documentUpload.review.errors.fixHighlightedFields'));
        if (error.focusStep) setReviewStep(error.focusStep);
        queueReviewFieldScroll(buildReviewFieldScrollQueue(errorKeys[0], error.fieldErrors));
        return;
      }
      setReviewFieldErrors({});
      const message =
        error instanceof ProfileReviewSaveError
          ? error.userMessage
          : (error?.message || t('documentUpload.errors.saveProfileFailed'));
      setReviewDialogError(message);
    } finally {
      setSavingReview(false);
    }
  };

  const startInputQualityDiagnosis = useCallback(async (profileSnapshot, { force = false } = {}) => {
    const fingerprint = qualityDiagnosisFingerprint(profileSnapshot, uiLangCode);
    const preserveExistingAnswers = inputQualityDiagnosisAppliedFingerprintRef.current === fingerprint;
    const cached = !force ? inputQualityDiagnosisCacheRef.current.get(fingerprint) : null;
    if (cached) {
      const followUps = filterProtectedIdentityFollowUps(
        cached.followUps,
        workEnjoyMostUserEdited,
        topicsIndustriesUserEdited,
        naturallyGoodAtUserEdited,
        workEnvironmentFitUserEdited,
        workingLifeAchievementUserEdited
      );
      setStep3FollowUps(followUps);
      setStep3FollowUpAnswers((prev) =>
        mergeFollowUpAnswersForQuestions(prev, followUps, preserveExistingAnswers)
      );
      setInputQualityDiagnosisError(null);
      setInputQualityDiagnosisLoading(false);
      inputQualityDiagnosisAppliedFingerprintRef.current = fingerprint;
      return { followUps, fromCache: true };
    }

    if (
      !force
      && inputQualityDiagnosisInflightFingerprintRef.current === fingerprint
      && inputQualityDiagnosisInflightPromiseRef.current
    ) {
      return inputQualityDiagnosisInflightPromiseRef.current;
    }

    const supersededFingerprint = inputQualityDiagnosisInflightFingerprintRef.current;
    if (supersededFingerprint && supersededFingerprint !== fingerprint) {
      inputQualityDiagnosisAbortRef.current?.abort();
    }
    const controller = new AbortController();
    inputQualityDiagnosisAbortRef.current = controller;
    inputQualityDiagnosisInflightFingerprintRef.current = fingerprint;

    const run = async () => {
      setInputQualityDiagnosisLoading(true);
      setInputQualityDiagnosisError(null);
      try {
        const payload = qualityDiagnosisInputFromProfile(profileSnapshot);
        const res = await fetch(`/api/profile/input-quality-diagnosis?lang=${encodeURIComponent(uiLangCode)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          signal: controller.signal,
          body: JSON.stringify({
            lang: uiLangCode,
            userIdentity: payload.userIdentity,
            structuredUserInfo: payload.structuredUserInfo
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || data?.details || `Quality analysis failed (${res.status})}`);
        }
        const followUps = filterProtectedIdentityFollowUps(
          Array.isArray(data.followUps) ? data.followUps : [],
          workEnjoyMostUserEdited,
          topicsIndustriesUserEdited,
          naturallyGoodAtUserEdited,
          workEnvironmentFitUserEdited,
          workingLifeAchievementUserEdited
        );
      inputQualityDiagnosisCacheRef.current.set(fingerprint, { followUps });
      trimDiagnosisCacheMap(inputQualityDiagnosisCacheRef.current);
      if (inputQualityDiagnosisInflightFingerprintRef.current === fingerprint) {
          setStep3FollowUps(followUps);
          setStep3FollowUpAnswers((prev) =>
            mergeFollowUpAnswersForQuestions(prev, followUps, preserveExistingAnswers)
          );
          inputQualityDiagnosisAppliedFingerprintRef.current = fingerprint;
        }
        return { followUps, fromCache: false };
      } catch (e) {
        if (e?.name === 'AbortError') return { followUps: [], aborted: true };
        if (inputQualityDiagnosisInflightFingerprintRef.current === fingerprint) {
          setInputQualityDiagnosisError(e?.message || t('documentUpload.errors.qualityAnalysisFailed'));
        }
        return { followUps: [], error: e };
      } finally {
        if (inputQualityDiagnosisInflightFingerprintRef.current === fingerprint) {
          setInputQualityDiagnosisLoading(false);
        }
      }
    };

    const promise = run();
    inputQualityDiagnosisInflightPromiseRef.current = promise;
    promise.finally(() => {
      if (inputQualityDiagnosisInflightPromiseRef.current === promise) {
        inputQualityDiagnosisInflightPromiseRef.current = null;
      }
    });
    return promise;
  }, [t, uiLangCode, workEnjoyMostUserEdited, topicsIndustriesUserEdited, naturallyGoodAtUserEdited, workEnvironmentFitUserEdited, workingLifeAchievementUserEdited]);

  const diagnosisPrefetchKey = useMemo(
    () => qualityDiagnosisFingerprint(reviewProfile, uiLangCode),
    [reviewProfile, uiLangCode]
  );

  useEffect(() => {
    if (!reviewDialogOpen) return undefined;
    if (manualFillMode) return undefined;
    if (reviewStep !== 3 && reviewStep !== 4) return undefined;
    if (diagnosisPrefetchKey === inputQualityDiagnosisAppliedFingerprintRef.current) {
      return undefined;
    }
    if (
      diagnosisPrefetchKey === inputQualityDiagnosisInflightFingerprintRef.current
      && inputQualityDiagnosisInflightPromiseRef.current
    ) {
      return undefined;
    }
    const debounceMs = inputQualityDiagnosisPrefetchDebounceMs(reviewStep);
    const timer = setTimeout(() => {
      void startInputQualityDiagnosis(reviewProfile);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [reviewDialogOpen, reviewStep, manualFillMode, diagnosisPrefetchKey, startInputQualityDiagnosis, reviewProfile]);

  const followUpNarrativeWarmKey = useMemo(() => {
    if (reviewStep !== 4) return '';
    const profileForWarm = mergeFollowUpAnswersIntoProfile(
      reviewProfile,
      step3FollowUps,
      step3FollowUpAnswers
    );
    return JSON.stringify({
      userIdentity: profileForWarm.userIdentity || {},
      structured: buildStructuredGoodAtFromReview(profileForWarm, acceptedFields),
    });
  }, [reviewStep, reviewProfile, step3FollowUps, step3FollowUpAnswers, acceptedFields, mergeFollowUpAnswersIntoProfile]);

  useEffect(() => {
    if (!reviewDialogOpen || reviewStep !== 4 || !pendingUploadedDocId || !followUpNarrativeWarmKey) {
      return undefined;
    }
    const timer = setTimeout(() => {
      const profileForWarm = mergeFollowUpAnswersIntoProfile(
        reviewProfile,
        step3FollowUps,
        step3FollowUpAnswers
      );
      void warmReviewNarrativeCacheForStep({
        documentId: pendingUploadedDocId,
        reviewProfile: profileForWarm,
        acceptedFields,
        step: 4,
        langQuery: getProfileApiLangQuery(),
        translate: t,
        awaitReady: false,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [
    reviewDialogOpen,
    reviewStep,
    pendingUploadedDocId,
    followUpNarrativeWarmKey,
    reviewProfile,
    step3FollowUps,
    step3FollowUpAnswers,
    acceptedFields,
    t,
  ]);

  const step5NarrativeBlocksSave = isCvReviewFinalSeniorityStep
    && pendingUploadedDocId
    && step5NarrativeWarmStatus === 'warming';

  useEffect(() => {
    if (!isCvReviewFinalSeniorityStep) {
      setStep5NarrativeWarmStatus('idle');
      setStep5NarrativeWarmProgress(0);
      setStep5NarrativeWarmSlow(false);
    }
  }, [isCvReviewFinalSeniorityStep]);

  const seniorityNarrativeWarmKey = useMemo(() => {
    if (!isCvReviewFinalSeniorityStep) return '';
    const profileForWarm = mergeFollowUpAnswersIntoProfile(
      reviewProfile,
      step3FollowUps,
      step3FollowUpAnswers
    );
    return JSON.stringify({
      userIdentity: profileForWarm.userIdentity || {},
      structured: buildStructuredGoodAtFromReview(profileForWarm, acceptedFields),
    });
  }, [isCvReviewFinalSeniorityStep, reviewProfile, step3FollowUps, step3FollowUpAnswers, acceptedFields, mergeFollowUpAnswersIntoProfile]);

  useEffect(() => {
    if (!reviewDialogOpen || !isCvReviewFinalSeniorityStep || !pendingUploadedDocId || !seniorityNarrativeWarmKey) {
      return undefined;
    }

    let cancelled = false;
    let progressTimer;
    let slowWarningTimer;
    const warmStartedAt = Date.now();

    const profileForWarm = mergeFollowUpAnswersIntoProfile(
      reviewProfile,
      step3FollowUps,
      step3FollowUpAnswers
    );
    const structuredUserInfo = buildStructuredGoodAtFromReview(profileForWarm, acceptedFields);
    const langQuery = getProfileApiLangQuery();
    const cacheStatusParams = {
      documentId: pendingUploadedDocId,
      userIdentity: profileForWarm.userIdentity || {},
      structuredUserInfo,
      acceptedFields,
      langQuery,
      translate: t,
    };

    setStep5NarrativeWarmStatus('warming');
    setStep5NarrativeWarmProgress(8);
    setStep5NarrativeWarmSlow(false);

    const markReadyIfStatusMatches = (status) => {
      if (status?.ready === true && status?.fingerprintMatches === true) {
        setStep5NarrativeWarmProgress(100);
        setStep5NarrativeWarmStatus('ready');
        return true;
      }
      return false;
    };

    const scheduleProgressTick = () => {
      progressTimer = setTimeout(async () => {
        if (cancelled) return;
        try {
          const status = await fetchDocumentNarrativeCacheStatus(cacheStatusParams);
          if (!cancelled) {
            const elapsedMs = Date.now() - warmStartedAt;
            const nextProgress = computeNarrativeWarmProgressEstimate(status, elapsedMs);
            setStep5NarrativeWarmProgress((prev) => Math.max(prev, nextProgress));
            if (markReadyIfStatusMatches(status)) return;
          }
        } catch {
          // Warm may still complete server-side.
        }
        if (!cancelled) scheduleProgressTick();
      }, 400);
    };

    scheduleProgressTick();

    slowWarningTimer = setTimeout(() => {
      if (!cancelled) setStep5NarrativeWarmSlow(true);
    }, WIZARD_NARRATIVE_WARM_SLOW_WARNING_MS);

    void (async () => {
      try {
        await warmReviewNarrativeCacheForStep({
          documentId: pendingUploadedDocId,
          reviewProfile: profileForWarm,
          acceptedFields,
          step: 4,
          langQuery,
          translate: t,
          awaitReady: true,
        });
      } catch {
        // Non-fatal; save will poll or warm once more.
      }
      if (cancelled) return;
      try {
        const status = await fetchDocumentNarrativeCacheStatus(cacheStatusParams);
        if (markReadyIfStatusMatches(status)) return;
      } catch {
        // Fall through to failed state.
      }
      if (!cancelled) {
        setStep5NarrativeWarmStatus((prev) => (prev === 'warming' ? 'failed' : prev));
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(progressTimer);
      clearTimeout(slowWarningTimer);
    };
    // seniorityNarrativeWarmKey captures identity + structured inputs only; seniority edits must not restart warm.
  }, [
    reviewDialogOpen,
    isCvReviewFinalSeniorityStep,
    pendingUploadedDocId,
    seniorityNarrativeWarmKey,
    t,
  ]);

  const handleContinueFromContextStep = async () => {
    setReviewDialogError('');

    if (step3FollowUps.length > 0) {
      const emptyFollowUpField = firstEmptyFollowUpFieldKey(step3FollowUps, step3FollowUpAnswers);
      if (emptyFollowUpField) {
        setReviewDialogError(t('documentUpload.review.errors.fixHighlightedFields'));
        queueReviewFieldScroll(emptyFollowUpField);
        return;
      }
    }

    const fingerprint = qualityDiagnosisFingerprint(reviewProfile, uiLangCode);
    const diagnosisReady = inputQualityDiagnosisAppliedFingerprintRef.current === fingerprint;

    if (!diagnosisReady) {
      setReviewContinueBusy(true);
      try {
        let diagnosisResult;
        if (
          inputQualityDiagnosisInflightFingerprintRef.current === fingerprint
          && inputQualityDiagnosisInflightPromiseRef.current
        ) {
          diagnosisResult = await inputQualityDiagnosisInflightPromiseRef.current;
        } else {
          diagnosisResult = await startInputQualityDiagnosis(reviewProfile);
          if (
            diagnosisResult?.aborted
            && inputQualityDiagnosisInflightPromiseRef.current
            && inputQualityDiagnosisInflightFingerprintRef.current === fingerprint
          ) {
            diagnosisResult = await inputQualityDiagnosisInflightPromiseRef.current;
          }
        }
        if (diagnosisResult?.error && !Array.isArray(diagnosisResult?.followUps)) {
          setReviewDialogError(
            diagnosisResult.error?.message
              || inputQualityDiagnosisError
              || t('documentUpload.errors.qualityAnalysisFailed')
          );
          return;
        }
      } finally {
        setReviewContinueBusy(false);
      }
    }

    const profileForWarm = mergeFollowUpAnswersIntoProfile(
      reviewProfile,
      step3FollowUps,
      step3FollowUpAnswers
    );
    void warmReviewNarrativeCacheForStep({
      documentId: pendingUploadedDocId,
      reviewProfile: profileForWarm,
      acceptedFields,
      step: 4,
      langQuery: getProfileApiLangQuery(),
      translate: t,
      awaitReady: true,
    });
    setReviewStep(5);
  };

  const handleReviewBack = () => {
    setReviewDialogError('');
    if (manualFillMode) {
      const prev = prevManualFillStep(reviewStep);
      if (prev === MANUAL_FILL_REVIEW_STEPS.SENIORITY && reviewStep === MANUAL_FILL_REVIEW_STEPS.WORK_ENJOY_COACHING) {
        setManualWorkEnjoyComplete(false);
      }
      if (prev === MANUAL_FILL_REVIEW_STEPS.WORK_ENJOY_COACHING && reviewStep === MANUAL_FILL_REVIEW_STEPS.TOPICS_COACHING) {
        setManualTopicsComplete(false);
      }
      if (prev === MANUAL_FILL_REVIEW_STEPS.TOPICS_COACHING && reviewStep === MANUAL_FILL_REVIEW_STEPS.STRENGTHS_COACHING) {
        setManualStrengthsComplete(false);
      }
      if (prev === MANUAL_FILL_REVIEW_STEPS.STRENGTHS_COACHING && reviewStep === MANUAL_FILL_REVIEW_STEPS.WORK_ENVIRONMENT_COACHING) {
        setManualWorkEnvironmentComplete(false);
      }
      if (prev === MANUAL_FILL_REVIEW_STEPS.WORK_ENVIRONMENT_COACHING && reviewStep === MANUAL_FILL_REVIEW_STEPS.WORKING_LIFE_ACHIEVEMENT_COACHING) {
        setManualWorkingLifeAchievementComplete(false);
      }
      if (prev != null) setReviewStep(prev);
      return;
    }
    if (reviewStep === 5) {
      setInputQualityDiagnosisError(null);
      setReviewStep(4);
      return;
    }
    if (reviewStep > 2) {
      setReviewStep(reviewStep - 1);
    }
  };

  const handleReviewContinue = async () => {
    setReviewDialogError('');
    if (manualFillMode && reviewStep === 5) {
      const seniorityCheck = validateSeniorityPayload(reviewProfile.seniority || {});
      if (!seniorityCheck.ok) {
        setReviewDialogError(t(seniorityFieldErrorKey(seniorityCheck.field)));
        queueReviewFieldScroll(seniorityReviewFieldKey(seniorityCheck.field));
        return;
      }
      const next = nextManualFillStep(reviewStep);
      if (next != null) setReviewStep(next);
      return;
    }
    if (manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.WORK_ENJOY_COACHING) {
      if (!manualWorkEnjoyComplete) {
        if (workEnjoySummaryFooter.canConfirm) {
          workEnjoyConfirmRef.current();
          return;
        }
        setReviewDialogError(t('workEnjoyCoaching.errors.completeCoachingFirst'));
        return;
      }
      const next = nextManualFillStep(reviewStep);
      if (next != null) setReviewStep(next);
      return;
    }
    if (manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.TOPICS_COACHING) {
      if (!manualTopicsComplete) {
        if (topicsSummaryFooter.canConfirm) {
          topicsConfirmRef.current();
          return;
        }
        setReviewDialogError(t('topicsIndustriesCoaching.errors.completeCoachingFirst'));
        return;
      }
      const next = nextManualFillStep(reviewStep);
      if (next != null) setReviewStep(next);
      return;
    }
    if (manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.STRENGTHS_COACHING) {
      if (!manualStrengthsComplete) {
        if (strengthsSummaryFooter.canConfirm) {
          strengthsConfirmRef.current();
          return;
        }
        setReviewDialogError(t('naturallyGoodAtCoaching.errors.completeCoachingFirst'));
        return;
      }
      const next = nextManualFillStep(reviewStep);
      if (next != null) setReviewStep(next);
      return;
    }
    if (manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.WORK_ENVIRONMENT_COACHING) {
      if (!manualWorkEnvironmentComplete) {
        if (workEnvironmentSummaryFooter.canConfirm) {
          workEnvironmentConfirmRef.current();
          return;
        }
        setReviewDialogError(t('workEnvironmentCoaching.errors.completeCoachingFirst'));
        return;
      }
      const next = nextManualFillStep(reviewStep);
      if (next != null) setReviewStep(next);
      return;
    }
    if (manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.WORKING_LIFE_ACHIEVEMENT_COACHING) {
      if (!manualWorkingLifeAchievementComplete) {
        if (workingLifeAchievementSummaryFooter.canConfirm) {
          workingLifeAchievementConfirmRef.current();
          return;
        }
        setReviewDialogError(t('workingLifeAchievementCoaching.errors.completeCoachingFirst'));
        return;
      }
      const next = nextManualFillStep(reviewStep);
      if (next != null) setReviewStep(next);
      return;
    }
    if (manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.TASKS_RESPONSIBILITIES) {
      if (!reviewProfileHasKeyResponsibilities(reviewProfile)) {
        setReviewDialogError(t('tasksResponsibilitiesStep.errors.addAtLeastOne'));
        queueReviewFieldScroll('structuredUserInfo.keyResponsibilities');
        return;
      }
      const trimmed = capGoodAtList(
        (reviewProfile.structuredUserInfo?.keyResponsibilities || [])
          .map((item) => String(item || '').trim())
          .filter(Boolean),
        'keyResponsibilities'
      );
      setReviewProfile((prev) => ({
        ...prev,
        structuredUserInfo: {
          ...(prev.structuredUserInfo || {}),
          keyResponsibilities: trimmed,
        },
      }));
      setAcceptedFields((prev) => ({
        ...prev,
        ...buildAcceptedKeyResponsibilityFields(trimmed),
      }));
      const profileForSkills = {
        ...reviewProfile,
        structuredUserInfo: {
          ...(reviewProfile.structuredUserInfo || {}),
          keyResponsibilities: trimmed,
        },
      };
      prefetchRoleSkillRecommendations({
        contextTexts: buildSkillSelectionRecommendationContext(profileForSkills, manualFillCoachingDraft),
      });
      const next = nextManualFillStep(reviewStep);
      if (next != null) setReviewStep(next);
      return;
    }
    if (manualFillMode && reviewStep === MANUAL_FILL_REVIEW_STEPS.SKILLS_SELECTION) {
      if (!reviewProfileHasSelectedSkill(reviewProfile)) {
        setReviewDialogError(t('skillSelection.errors.selectAtLeastOne'));
        queueReviewFieldScroll('structuredUserInfo.skills');
        return;
      }
      const next = nextManualFillStep(reviewStep);
      if (next != null) setReviewStep(next);
      return;
    }
    if (reviewStep === 2) {
      if (!applyReviewValidationToUi(validateReviewIdentityStep(reviewProfile))) {
        return;
      }
      const docId = pendingUploadedDocId;
      let structuredReady = structuredExtractionReady;

      if (docId && enableExtractionReview && !structuredReady) {
        setStructuredReviewLoading(true);
        try {
          const data = await ensureStructuredSemanticForReview(docId);
          if (data?.document) {
            mergeStructuredFieldsFromDocument(data.document);
            structuredReady = data.document.semanticEnrichmentStatus === 'complete'
              || reviewProfileHasStructuredGoodAt(
                normalizeExtractedProfileData(
                  stripHeuristicGoodAtFromProfileData(data.document.extractedProfileData, data.document)
                )
              );
          }
        } catch {
          setReviewDialogError(t('documentUpload.errors.refreshAfterExtractionFailed'));
          return;
        } finally {
          setStructuredReviewLoading(false);
        }
      } else if (docId && enableExtractionReview && structuredReady) {
        const doc = (documentsRef.current || []).find((d) => String(d.id) === String(docId));
        if (doc?.extractedProfileData) {
          mergeStructuredFieldsFromDocument(doc);
        }
      }

      if (docId && enableExtractionReview && !structuredReady) {
        return;
      }

      setReviewStep(3);
      void warmReviewNarrativeCacheForStep({
        documentId: pendingUploadedDocId,
        reviewProfile,
        acceptedFields,
        step: 3,
        langQuery: getProfileApiLangQuery(),
        translate: t,
      });
      return;
    }
    if (reviewStep === 3) {
      if (!applyReviewValidationToUi(
        validateReviewProfileInDialog(reviewProfile, acceptedFields, { requireGoodAt: true })
      )) {
        return;
      }
      setReviewStep(4);
      void warmReviewNarrativeCacheForStep({
        documentId: pendingUploadedDocId,
        reviewProfile,
        acceptedFields,
        step: 4,
        langQuery: getProfileApiLangQuery(),
        translate: t,
      });
      void startInputQualityDiagnosis(reviewProfile);
      return;
    }
    if (reviewStep === 4) {
      void handleContinueFromContextStep();
    }
  };

  // Handler for canceling review (after explicit confirmation in the UI)
  const handleReviewCancel = async () => {
    setReviewCancelConfirmOpen(false);
    setReviewDialogError('');

    if (manualFillMode) {
      persistManualFillDraft();
      setReviewDialogOpen(false);
      setExtractedProfileData(null);
      setCvExtractLocalization(null);
      setReviewProfile({});
      setAcceptedFields({});
      setStep3FollowUps([]);
      setStep3FollowUpAnswers({});
      setReviewStep(MANUAL_FILL_REVIEW_STEPS.SENIORITY);
      setPendingUploadedDocId(null);
      setSelectedFile(null);
      resetManualFillUiState();
      notifyReviewSessionEnd();
      return;
    }

    const docIdForDraft = pendingUploadedDocId
      ? String(pendingUploadedDocId)
      : cvPollTarget?.documentId
        ? String(cvPollTarget.documentId)
        : null;
    cvWizardUserCanceledRef.current = true;
    setUploading(false);
    setAutoStartUpload(false);
    if (reviewUserId && docIdForDraft) {
      persistCvReviewDraft(buildCvReviewDraftPayload({
        pendingUploadedDocId: docIdForDraft,
        reviewProfile,
        reviewStep,
        step3FollowUps,
        step3FollowUpAnswers,
        acceptedFields,
        cvExtractLocalization,
        reviewDialogOpen: false,
        inputQualityDiagnosisCache: diagnosisCacheMapToDraft(inputQualityDiagnosisCacheRef.current),
        inputQualityDiagnosisAppliedFingerprint: inputQualityDiagnosisAppliedFingerprintRef.current,
      }));
    }
    clearCvExtractionUiState();
    setReviewDialogOpen(false);
    setExtractedProfileData(null);
    setCvExtractLocalization(null);
    setReviewProfile({});
    setAcceptedFields({});
    setStep3FollowUps([]);
    setStep3FollowUpAnswers({});
    setInputQualityDiagnosisError(null);
    setInputQualityDiagnosisLoading(false);
    inputQualityDiagnosisAppliedFingerprintRef.current = '';
    inputQualityDiagnosisAbortRef.current?.abort();
    inputQualityDiagnosisAbortRef.current = null;
    inputQualityDiagnosisInflightFingerprintRef.current = '';
    inputQualityDiagnosisInflightPromiseRef.current = null;
    setReviewStep(1);
    setPendingUploadedDocId(null);
    setSelectedFile(null);
    resetManualFillUiState();
    setExtractionError('');
    notifyReviewSessionEnd();
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        setUploadError(t('documentUpload.errors.fileSizeLimit'));
        return;
      }
      queueFileForUpload(file);
    }
    event.target.value = '';
  };

  const handleRename = async (documentId) => {
    setRenameLoading(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/rename`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ description: editingDescription })
      });
      if (!response.ok) {
        throw new Error('Rename failed');
      }
      const data = await response.json();
      onDocumentsUpdate(normalizeDocuments(documents.map(doc => doc.id === documentId ? { ...doc, description: data.document.description } : doc)));
      setEditingDocId(null);
      setEditingDescription('');
    } catch (error) {
      setUploadError(t('documentUpload.errors.renameFailed'));
      console.error('Rename error:', error);
    } finally {
      setRenameLoading(false);
    }
  };

  return (
    <Box>
      {showSectionTitle && (
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
          {t('documentUpload.sectionTitle')}
        </Typography>
      )}

      {uploadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {uploadError}
        </Alert>
      )}

      {extractionError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {extractionError}
        </Alert>
      )}

      {showManualFillOption && !reviewDialogOpen && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            mb: 3,
            width: '100%',
          }}
        >
          {hasSavedManualFillDraft ? (
            <>
              <Alert severity="info" sx={{ width: '100%', textAlign: 'left' }}>
                <Typography variant="body2">
                  {t('profileCreation.manualFill.resumeDescription', {
                    step: manualFillProgressIndex(loadManualFillDraft(reviewUserId)?.reviewStep || MANUAL_FILL_REVIEW_STEPS.SENIORITY),
                    total: MANUAL_FILL_STEP_COUNT,
                  })}
                </Typography>
              </Alert>
              <Box
                sx={{
                  mt: 2,
                  display: 'flex',
                  gap: 2,
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  flexDirection: { xs: 'column', sm: 'row' },
                  alignItems: 'stretch',
                  width: '100%',
                }}
              >
                <HomeGetStartedButton onClick={resumeManualFill}>
                  {t('profileCreation.manualFill.resumeCta')}
                </HomeGetStartedButton>
                <Button
                  variant="outlined"
                  size="medium"
                  onClick={() => setManualFillDiscardConfirmOpen(true)}
                  sx={{
                    fontWeight: 600,
                    px: 3,
                    py: 1.5,
                    fontSize: '1rem',
                    width: { xs: '100%', sm: 'auto' },
                    maxWidth: '100%',
                  }}
                >
                  {t('profileCreation.manualFill.discardSavedCta')}
                </Button>
              </Box>
            </>
          ) : (
            <HomeGetStartedButton onClick={handleStartManualFillClick}>
              {t('profileCreation.manualFill.cta')}
            </HomeGetStartedButton>
          )}
        </Box>
      )}

      {/* Document list */}
      {!hideDocumentList && !manualFillOnly && (
      <List>
        {documents.map((doc) => (
          <ListItem
            key={doc.id}
            sx={{
              mb: 1,
              bgcolor: 'background.paper',
              borderRadius: 1,
              '&:hover': {
                bgcolor: 'action.hover'
              }
            }}
          >
            <DescriptionIcon sx={{ mr: 2, color: 'primary.main' }} />
            <ListItemText
              secondaryTypographyProps={{ component: 'div' }}
              primary={
                editingDocId === doc.id ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TextField
                      value={editingDescription}
                      onChange={e => setEditingDescription(e.target.value)}
                      size="small"
                      autoFocus
                      disabled={renameLoading}
                      sx={{ minWidth: 180 }}
                    />
                    <Button
                      onClick={() => handleRename(doc.id)}
                      disabled={renameLoading || !editingDescription.trim()}
                      size="small"
                      variant="contained"
                    >
                      {t('documentUpload.documents.rename.saveCta')}
                    </Button>
                    <Button
                      onClick={() => { setEditingDocId(null); setEditingDescription(''); }}
                      disabled={renameLoading}
                      size="small"
                    >
                      {t('documentUpload.common.cancel')}
                    </Button>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body1">{doc.description || doc.name || doc.originalName || t('documentUpload.documents.noTitle')}</Typography>
                    <Tooltip title={t('documentUpload.documents.tooltips.edit')} placement="bottom">
                      <Box component="span" sx={{ display: 'inline-flex' }}>
                        <IconButton
                          size="small"
                          onClick={() => { setEditingDocId(doc.id); setEditingDescription(doc.description || ''); }}
                          aria-label={t('documentUpload.documents.tooltips.edit')}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Tooltip>
                  </Box>
                )
              }
              secondary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <Chip
                    size="small"
                    label={documentTypeChipLabel(doc, t)}
                    color="primary"
                    variant="outlined"
                  />
                  {doc.uploadDate && (
                    <Typography variant="caption" color="text.secondary">
                      {t('documentUpload.documents.uploadedOn', { date: new Date(doc.uploadDate).toLocaleDateString() })}
                    </Typography>
                  )}
                  {doc.description && editingDocId !== doc.id && (
                    <Typography variant="body2" color="text.secondary">
                      {doc.description}
                    </Typography>
                  )}
                </Box>
              }
            />
            <ListItemSecondaryAction sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Tooltip title={t('documentUpload.documents.tooltips.download')} placement="bottom">
                <Box component="span" sx={{ display: 'inline-flex' }}>
                  <IconButton
                    onClick={() => handleDownload(doc.id, doc.originalName)}
                    aria-label={t('documentUpload.documents.tooltips.download')}
                  >
                    <DownloadIcon />
                  </IconButton>
                </Box>
              </Tooltip>
              <Tooltip title={t('documentUpload.documents.tooltips.delete')} placement="bottom">
                <Box component="span" sx={{ display: 'inline-flex' }}>
                  <IconButton
                    onClick={() => { setDocToDelete(doc); setDeleteDialogOpen(true); }}
                    disabled={uploading}
                    aria-label={t('documentUpload.documents.tooltips.delete')}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Box>
              </Tooltip>
            </ListItemSecondaryAction>
          </ListItem>
        ))}
      </List>
      )}

      {/* Delete Confirmation Dialog */}
      {!hideDocumentList && !manualFillOnly && (
      <Dialog 
        open={deleteDialogOpen} 
        onClose={() => setDeleteDialogOpen(false)}
        aria-labelledby="delete-document-dialog-title"
        aria-describedby="delete-document-dialog-description"
      >
        <DialogTitle id="delete-document-dialog-title">
          {t('documentUpload.deleteDialog.title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-document-dialog-description">
            {t('documentUpload.deleteDialog.confirmation')}
          </DialogContentText>
          {docToDelete && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('documentUpload.deleteDialog.detailsTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <strong>{t('documentUpload.deleteDialog.nameLabel')}</strong> {docToDelete.description || docToDelete.name || docToDelete.originalName || t('documentUpload.deleteDialog.notSpecified')}
              </Typography>
              {docToDelete.type && (
                <Typography variant="body2" color="text.secondary">
                  <strong>{t('documentUpload.deleteDialog.typeLabel')}</strong> {docToDelete.type}
                </Typography>
              )}
            </Box>
          )}
          <Typography variant="body2" color="error" sx={{ mt: 2, fontWeight: 'bold' }}>
            {t('documentUpload.deleteDialog.warning')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => setDeleteDialogOpen(false)}
            variant="outlined"
            color="primary"
            autoFocus
          >
            {t('documentUpload.common.cancel')}
          </Button>
          <Button
            onClick={async () => {
              if (docToDelete) {
                await handleDelete(docToDelete.id);
              }
              setDeleteDialogOpen(false);
              setDocToDelete(null);
            }}
            variant="contained"
            color="error"
          >
            {t('documentUpload.deleteDialog.deleteCta')}
          </Button>
        </DialogActions>
      </Dialog>
      )}

      {/* Review extracted profile data dialog */}
      <Dialog
        open={reviewDialogOpen}
        keepMounted={false}
        onClose={(event, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
            return;
          }
        }}
        maxWidth="md"
        fullWidth
        scroll="paper"
        sx={{
          '& .MuiDialog-paper': {
            display: 'flex',
            flexDirection: 'column',
            maxHeight: { xs: '92dvh', sm: 'calc(100% - 64px)' },
            m: { xs: 1, sm: 2 },
          },
        }}
      >
        <DialogTitle sx={{ pb: 1, flexShrink: 0 }}>
          {enableExtractionReview && (
            <ProfileCreationProgress
              currentStep={manualFillMode ? manualFillProgressIndex(reviewStep) : reviewStep}
              totalSteps={manualFillMode ? MANUAL_FILL_STEP_COUNT : undefined}
              sx={{ mb: 1.5 }}
            />
          )}
          <ProfileReviewStepTitle step={reviewStep} t={t} />
        </DialogTitle>
        <DialogContent
          ref={reviewDialogContentRef}
          sx={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
          }}
        >
          {reviewDialogError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setReviewDialogError('')}>
              {reviewDialogError}
            </Alert>
          )}
          {reviewStep === 1 && enableExtractionReview && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {manualFillMode
                  ? t(reviewSaveMode === 'replace'
                    ? 'profileCreation.manualFill.optionalCv.introFullUpdate'
                    : 'profileCreation.manualFill.optionalCv.intro')
                  : t('documentUpload.review.step1Intro')}
              </Typography>
              <input
                ref={reviewStep1FileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              {uploading && (
                <Alert severity="info">
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    {t('documentUpload.async.uploading')}
                  </Typography>
                  <LinearProgress />
                </Alert>
              )}
              {!uploading && uploadSucceeded && (
                <Alert severity="success">
                  <Typography variant="body2">
                    {t('documentUpload.async.uploadComplete')}
                  </Typography>
                </Alert>
              )}
              {!uploading && optionalCvShowExtractionProgress && (
                renderCvExtractionProgressAlert()
              )}
              {!uploading && optionalCvExtractionComplete && optionalCvHasUpload && (
                <Alert severity="success">
                  <Typography variant="body2">
                    {t('documentUpload.async.completed')}
                  </Typography>
                </Alert>
              )}
              {!uploading && optionalCvShowUploadedFile && (
                <Alert severity="success">
                  <Typography variant="body2">
                    {t('profileCreation.manualFill.optionalCv.uploadedFile', {
                      fileName: optionalCvDisplayName,
                    })}
                  </Typography>
                </Alert>
              )}
              {optionalCvShowDropzone && (
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('documentUpload.dropzone.supportedFormats')}
                  </Typography>
                  <Button
                    variant="outlined"
                    startIcon={<UploadIcon />}
                    onClick={() => reviewStep1FileInputRef.current?.click()}
                  >
                    {t('documentUpload.dropzone.cta')}
                  </Button>
                </Box>
              )}
              {reviewStep1Advancing && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
                  <CircularProgress size={20} />
                  <Typography variant="body2" color="text.secondary">
                    {t('documentUpload.review.step1Advancing')}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
          {(extractedProfileData || manualFillMode) ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              {reviewStep === MANUAL_FILL_REVIEW_STEPS.WORK_ENJOY_COACHING && manualFillMode && (
                <>
                  {!workEnjoySummaryFooter.canConfirm && (
                    <>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: { xs: 0.5, sm: 1 }, fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}
                      >
                        {t('workEnjoyCoaching.chat.intro')}
                      </Typography>
                      <Divider sx={{ mb: { xs: 1, sm: 2 }, display: { xs: 'none', sm: 'block' } }} />
                    </>
                  )}
                  <Box {...reviewFieldAnchorProps('userIdentity.workEnjoyMost')} sx={{ mb: 2.5 }}>
                    <WorkEnjoyMostCoaching
                      seniority={reviewProfile.seniority || {}}
                      cvContext={coachingCvContext}
                      confirmInFooter
                      initialActivities={resolveWorkEnjoyInitialActivities(reviewProfile, manualFillCoachingDraft, manualFillCvSnapshot)}
                      initialMessages={resolveCoachingInitialMessages(manualFillCoachingDraft, 'workEnjoy')}
                      onChatPersist={(snapshot) => handleManualFillCoachingPersist('workEnjoy', snapshot)}
                      onSummaryFooterStateChange={handleWorkEnjoySummaryFooterStateChange}
                      onBindConfirm={handleBindWorkEnjoyConfirm}
                      onComplete={(_activities, workEnjoyMostText, meta = {}) => {
                        clearReviewFieldError('userIdentity.workEnjoyMost');
                        setReviewProfile((prev) => ({
                          ...prev,
                          userIdentity: {
                            ...(prev.userIdentity || {}),
                            workEnjoyMost: workEnjoyMostText,
                          },
                        }));
                        setWorkEnjoyMostUserEdited(Boolean(meta.userEdited));
                        setManualWorkEnjoyComplete(true);
                        setWorkEnjoySummaryFooter({ canConfirm: false, isEditing: false, hasActivities: false });
                        setReviewDialogError('');
                        const next = nextManualFillStep(MANUAL_FILL_REVIEW_STEPS.WORK_ENJOY_COACHING);
                        if (next != null) setReviewStep(next);
                      }}
                    />
                  </Box>
                </>
              )}
              {reviewStep === MANUAL_FILL_REVIEW_STEPS.TOPICS_COACHING && manualFillMode && (
                <>
                  {!topicsSummaryFooter.canConfirm && (
                    <>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: { xs: 0.5, sm: 1 }, fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}
                      >
                        {t('topicsIndustriesCoaching.chat.intro')}
                      </Typography>
                      <Divider sx={{ mb: { xs: 1, sm: 2 }, display: { xs: 'none', sm: 'block' } }} />
                    </>
                  )}
                  <Box {...reviewFieldAnchorProps('userIdentity.topicsIndustriesInterest')} sx={{ mb: 2.5 }}>
                    <TopicsIndustriesCoaching
                      seniority={reviewProfile.seniority || {}}
                      cvContext={coachingCvContext}
                      confirmInFooter
                      initialInterestTopics={resolveTopicsInitialInterest(reviewProfile, manualFillCoachingDraft, manualFillCvSnapshot)}
                      initialIndustries={resolveTopicsInitialIndustries(reviewProfile, manualFillCoachingDraft, manualFillCvSnapshot)}
                      initialMessages={resolveCoachingInitialMessages(manualFillCoachingDraft, 'topics')}
                      onChatPersist={(snapshot) => handleManualFillCoachingPersist('topics', snapshot)}
                      onSummaryFooterStateChange={handleTopicsSummaryFooterStateChange}
                      onBindConfirm={handleBindTopicsConfirm}
                      onComplete={(summary, meta = {}) => {
                        clearReviewFieldError('userIdentity.topicsIndustriesInterest');
                        const interestTopics = (summary?.interestTopics || [])
                          .map((item) => String(item || '').trim())
                          .filter(Boolean);
                        const industries = capGoodAtList((summary?.industries || [])
                          .map((item) => String(item || '').trim())
                          .filter(Boolean), 'domains');
                        setReviewProfile((prev) => ({
                          ...prev,
                          userIdentity: {
                            ...(prev.userIdentity || {}),
                            topicsIndustriesInterest: formatInterestTopicsAsText(interestTopics),
                          },
                          structuredUserInfo: {
                            ...(prev.structuredUserInfo || {}),
                            domains: industries,
                          },
                        }));
                        setAcceptedFields((prev) => ({
                          ...prev,
                          ...buildAcceptedDomainFields(industries),
                        }));
                        setTopicsIndustriesUserEdited(Boolean(meta.userEdited));
                        setManualTopicsComplete(true);
                        setTopicsSummaryFooter({ canConfirm: false, isEditing: false, hasSummary: false });
                        setReviewDialogError('');
                        const next = nextManualFillStep(MANUAL_FILL_REVIEW_STEPS.TOPICS_COACHING);
                        if (next != null) setReviewStep(next);
                      }}
                    />
                  </Box>
                </>
              )}
              {reviewStep === MANUAL_FILL_REVIEW_STEPS.STRENGTHS_COACHING && manualFillMode && (
                <>
                  {!strengthsSummaryFooter.canConfirm && (
                    <>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: { xs: 0.5, sm: 1 }, fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}
                      >
                        {t('naturallyGoodAtCoaching.chat.intro')}
                      </Typography>
                      <Divider sx={{ mb: { xs: 1, sm: 2 }, display: { xs: 'none', sm: 'block' } }} />
                    </>
                  )}
                  <Box {...reviewFieldAnchorProps('userIdentity.naturallyGoodAt')} sx={{ mb: 2.5 }}>
                    <NaturallyGoodAtCoaching
                      seniority={reviewProfile.seniority || {}}
                      cvContext={coachingCvContext}
                      confirmInFooter
                      recommendationContextTexts={strengthsSkillDomainRecommendationContext}
                      initialStrengths={resolveStrengthsInitialStrengths(reviewProfile, manualFillCoachingDraft, manualFillCvSnapshot)}
                      initialSkillDomains={resolveStrengthsInitialSkillDomains(reviewProfile, manualFillCoachingDraft, manualFillCvSnapshot)}
                      initialMessages={resolveCoachingInitialMessages(manualFillCoachingDraft, 'strengths')}
                      onChatPersist={(snapshot) => handleManualFillCoachingPersist('strengths', snapshot)}
                      onSummaryFooterStateChange={handleStrengthsSummaryFooterStateChange}
                      onBindConfirm={handleBindStrengthsConfirm}
                      onComplete={(summary, naturallyGoodAtText, meta = {}) => {
                        clearReviewFieldError('userIdentity.naturallyGoodAt');
                        const strengths = (summary?.strengths || [])
                          .map((item) => String(item || '').trim())
                          .filter(Boolean);
                        const skillDomains = capGoodAtList((summary?.skillDomains || [])
                          .map((item) => String(item || '').trim())
                          .filter(Boolean), 'skillDomains');
                        setReviewProfile((prev) => ({
                          ...prev,
                          userIdentity: {
                            ...(prev.userIdentity || {}),
                            naturallyGoodAt: naturallyGoodAtText || formatNaturallyGoodAtAsText({ strengths }),
                          },
                          structuredUserInfo: {
                            ...(prev.structuredUserInfo || {}),
                            skillDomains,
                          },
                        }));
                        setAcceptedFields((prev) => ({
                          ...prev,
                          ...buildAcceptedSkillDomainFields(skillDomains),
                        }));
                        setNaturallyGoodAtUserEdited(Boolean(meta.userEdited));
                        setManualStrengthsComplete(true);
                        setStrengthsSummaryFooter({ canConfirm: false, isEditing: false, hasSummary: false });
                        setReviewDialogError('');
                        const next = nextManualFillStep(MANUAL_FILL_REVIEW_STEPS.STRENGTHS_COACHING);
                        if (next != null) setReviewStep(next);
                      }}
                    />
                  </Box>
                </>
              )}
              {reviewStep === MANUAL_FILL_REVIEW_STEPS.WORK_ENVIRONMENT_COACHING && manualFillMode && (
                <>
                  {!workEnvironmentSummaryFooter.canConfirm && (
                    <>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: { xs: 0.5, sm: 1 }, fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}
                      >
                        {t('workEnvironmentCoaching.chat.intro')}
                      </Typography>
                      <Divider sx={{ mb: { xs: 1, sm: 2 }, display: { xs: 'none', sm: 'block' } }} />
                    </>
                  )}
                  <Box {...reviewFieldAnchorProps('userIdentity.workEnvironmentFit')} sx={{ mb: 2.5 }}>
                    <WorkEnvironmentCoaching
                      seniority={reviewProfile.seniority || {}}
                      cvContext={coachingCvContext}
                      confirmInFooter
                      initialWorkStyles={resolveWorkEnvironmentInitial(reviewProfile, manualFillCoachingDraft, manualFillCvSnapshot).workStyles}
                      initialWorkEnvironments={resolveWorkEnvironmentInitial(reviewProfile, manualFillCoachingDraft, manualFillCvSnapshot).workEnvironments}
                      initialMessages={resolveCoachingInitialMessages(manualFillCoachingDraft, 'workEnvironment')}
                      onChatPersist={(snapshot) => handleManualFillCoachingPersist('workEnvironment', snapshot)}
                      onSummaryFooterStateChange={handleWorkEnvironmentSummaryFooterStateChange}
                      onBindConfirm={handleBindWorkEnvironmentConfirm}
                      onComplete={(_summary, workEnvironmentFitText, meta = {}) => {
                        clearReviewFieldError('userIdentity.workEnvironmentFit');
                        setReviewProfile((prev) => ({
                          ...prev,
                          userIdentity: {
                            ...(prev.userIdentity || {}),
                            workEnvironmentFit: workEnvironmentFitText,
                          },
                        }));
                        setWorkEnvironmentFitUserEdited(Boolean(meta.userEdited));
                        setManualWorkEnvironmentComplete(true);
                        setWorkEnvironmentSummaryFooter({ canConfirm: false, isEditing: false, hasSummary: false });
                        setReviewDialogError('');
                        const next = nextManualFillStep(MANUAL_FILL_REVIEW_STEPS.WORK_ENVIRONMENT_COACHING);
                        if (next != null) setReviewStep(next);
                      }}
                    />
                  </Box>
                </>
              )}
              {reviewStep === MANUAL_FILL_REVIEW_STEPS.WORKING_LIFE_ACHIEVEMENT_COACHING && manualFillMode && (
                <>
                  {!workingLifeAchievementSummaryFooter.canConfirm && (
                    <>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: { xs: 0.5, sm: 1 }, fontSize: { xs: '0.8125rem', sm: '0.875rem' } }}
                      >
                        {t('workingLifeAchievementCoaching.chat.intro')}
                      </Typography>
                      <Divider sx={{ mb: { xs: 1, sm: 2 }, display: { xs: 'none', sm: 'block' } }} />
                    </>
                  )}
                  <Box {...reviewFieldAnchorProps('userIdentity.workingLifeAchievement')} sx={{ mb: 2.5 }}>
                    <WorkingLifeAchievementCoaching
                      seniority={reviewProfile.seniority || {}}
                      cvContext={coachingCvContext}
                      confirmInFooter
                      initialCareerGoals={resolveWorkingLifeAchievementInitial(reviewProfile, manualFillCoachingDraft, manualFillCvSnapshot).careerGoals}
                      initialPriorities={resolveWorkingLifeAchievementInitial(reviewProfile, manualFillCoachingDraft, manualFillCvSnapshot).priorities}
                      initialMessages={resolveCoachingInitialMessages(manualFillCoachingDraft, 'workingLifeAchievement')}
                      onChatPersist={(snapshot) => handleManualFillCoachingPersist('workingLifeAchievement', snapshot)}
                      onSummaryFooterStateChange={handleWorkingLifeAchievementSummaryFooterStateChange}
                      onBindConfirm={handleBindWorkingLifeAchievementConfirm}
                      onComplete={(_summary, workingLifeAchievementText, meta = {}) => {
                        clearReviewFieldError('userIdentity.workingLifeAchievement');
                        setReviewProfile((prev) => ({
                          ...prev,
                          userIdentity: {
                            ...(prev.userIdentity || {}),
                            workingLifeAchievement: workingLifeAchievementText,
                          },
                        }));
                        setWorkingLifeAchievementUserEdited(Boolean(meta.userEdited));
                        setManualWorkingLifeAchievementComplete(true);
                        setWorkingLifeAchievementSummaryFooter({ canConfirm: false, isEditing: false, hasSummary: false });
                        setReviewDialogError('');
                        const next = nextManualFillStep(MANUAL_FILL_REVIEW_STEPS.WORKING_LIFE_ACHIEVEMENT_COACHING);
                        if (next != null) setReviewStep(next);
                      }}
                    />
                  </Box>
                </>
              )}
              {inManualTasksResponsibilities && (
                <Box {...reviewFieldAnchorProps('structuredUserInfo.keyResponsibilities')} sx={{ mb: 2.5 }}>
                  <TasksResponsibilitiesStep
                    responsibilities={reviewProfile.structuredUserInfo?.keyResponsibilities || []}
                    onResponsibilitiesChange={handleTasksResponsibilitiesChange}
                    maxItems={getProfileStructuredListMaxItems('keyResponsibilities')}
                    fieldErrors={reviewFieldErrors}
                  />
                </Box>
              )}
              {inManualSkillsSelection && (
                <Box {...reviewFieldAnchorProps('structuredUserInfo.skills')} sx={{ mb: 2.5 }}>
                  <SkillSelectionStep
                    selectedSkills={reviewProfile.structuredUserInfo?.skills || []}
                    onSelectedSkillsChange={handleSelectedSkillsChange}
                    maxSelected={getProfileStructuredListMaxItems('skills')}
                    recommendationContextTexts={skillSelectionRecommendationContext}
                  />
                  {reviewFieldErrors['structuredUserInfo.skills'] && (
                    <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                      {reviewFieldErrors['structuredUserInfo.skills']}
                    </Typography>
                  )}
                </Box>
              )}
              {inManualSkillsToLearn && (
                <Box {...reviewFieldAnchorProps('structuredUserInfo.skillsInDevelopment')} sx={{ mb: 2.5 }}>
                  <SkillSelectionStep
                    selectedSkills={reviewProfile.structuredUserInfo?.skillsInDevelopment || []}
                    onSelectedSkillsChange={handleSkillsToLearnChange}
                    maxSelected={getProfileStructuredListMaxItems('skillsInDevelopment')}
                    recommendationContextTexts={skillSelectionRecommendationContext}
                    excludeLabels={excludedSkillLabelsForLearning}
                    translationKeyPrefix="skillsToLearnSelection"
                  />
                  {reviewFieldErrors['structuredUserInfo.skillsInDevelopment'] && (
                    <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                      {reviewFieldErrors['structuredUserInfo.skillsInDevelopment']}
                    </Typography>
                  )}
                </Box>
              )}
              {reviewStep === 2 && !manualFillMode && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('documentUpload.review.step2Intro')}
                  </Typography>
                  <Divider sx={{ mb: 2 }} />
                  {USER_IDENTITY_FIELDS.map(({ key, questionKey }) => {
                    const identityFieldKey = `userIdentity.${key}`;
                    const identityValue = reviewProfile.userIdentity?.[key] || '';
                    return (
                    <Box key={key} {...reviewFieldAnchorProps(identityFieldKey)} sx={{ mb: 2.5 }}>
                      <Typography variant="body1" sx={REVIEW.subcategoryTitle}>
                        {t(questionKey)}
                      </Typography>
                      <TextField
                        value={
                          key === 'topicsIndustriesInterest'
                            ? formatInterestTopicsAsText(parseInterestTopicsFromText(identityValue))
                            : identityValue
                        }
                        onChange={(e) => {
                          clearReviewFieldError(identityFieldKey);
                          setReviewProfile((prev) => ({
                            ...prev,
                            userIdentity: {
                              ...(prev.userIdentity || {}),
                              [key]: e.target.value
                            }
                          }));
                        }}
                        sx={REVIEW.field}
                        fullWidth
                        multiline
                        minRows={4}
                        hiddenLabel
                        error={Boolean(reviewFieldErrors[identityFieldKey])}
                        helperText={
                          reviewFieldErrors[identityFieldKey]
                          || `${identityValue.length}/${PROFILE_REVIEW_USER_IDENTITY_MAX}`
                        }
                        inputProps={{ maxLength: PROFILE_REVIEW_USER_IDENTITY_MAX }}
                      />
                    </Box>
                    );
                  })}
                  {(structuredReviewLoading || !structuredExtractionReady) && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
                      <CircularProgress size={20} />
                      <Typography variant="body2" color="text.secondary">
                        {t('documentUpload.review.structuredLoading')}
                      </Typography>
                    </Box>
                  )}
                </>
              )}
              {reviewStep === 3 && !manualFillMode && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('documentUpload.review.step3Intro')}
                  </Typography>
                  <Divider sx={{ mb: 2 }} />
                  <Box {...reviewFieldAnchorProps('structuredUserInfo.skillDomains')}>
                  <Typography variant="body1" sx={{ ...REVIEW.subcategoryTitle, mt: 1 }}>
                    {t('documentUpload.review.goodAtCategories.skillDomains')}
                  </Typography>
                  {reviewFieldErrors['structuredUserInfo.skillDomains'] && (
                    <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>
                      {reviewFieldErrors['structuredUserInfo.skillDomains']}
                    </Typography>
                  )}
                  {reviewSkillDomainValues.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.skillDomains')}
                    </Typography>
                  )}
                  <SkillDomainPicker
                    value={reviewSkillDomainValues}
                    onChange={handleSkillDomainsChange}
                    maxItems={getProfileStructuredListMaxItems('skillDomains')}
                    recommendationContextTexts={strengthsSkillDomainRecommendationContext}
                  />
                  {renderGoodAtCategoryLimitNotice('skillDomains')}
                  </Box>
                  <Box {...reviewFieldAnchorProps('structuredUserInfo.domains')}>
                  <Typography variant="body1" sx={{ ...REVIEW.subcategoryTitle, mt: 1 }}>
                    {t('documentUpload.review.goodAtCategories.domains')}
                  </Typography>
                  {reviewFieldErrors['structuredUserInfo.domains'] && (
                    <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>
                      {reviewFieldErrors['structuredUserInfo.domains']}
                    </Typography>
                  )}
                  {reviewIndustryDomainValues.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.domains')}
                    </Typography>
                  )}
                  <IndustrySectorPicker
                    value={reviewIndustryDomainValues}
                    onChange={handleIndustryDomainsChange}
                    lang={uiLangCode}
                    maxItems={getProfileStructuredListMaxItems('domains')}
                  />
                  {renderGoodAtCategoryLimitNotice('domains')}
                  </Box>
                  <Box {...reviewFieldAnchorProps('structuredUserInfo.keyResponsibilities')}>
                  <Typography variant="body1" sx={{ ...REVIEW.subcategoryTitle, mt: 2 }}>
                    {t('documentUpload.review.goodAtCategories.keyResponsibilities')}
                  </Typography>
                  {reviewFieldErrors['structuredUserInfo.keyResponsibilities'] && (
                    <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>
                      {reviewFieldErrors['structuredUserInfo.keyResponsibilities']}
                    </Typography>
                  )}
                  {(reviewProfile.structuredUserInfo?.keyResponsibilities || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.keyResponsibilities')}
                    </Typography>
                  )}
                  {sortStructuredIndices('structuredUserInfo.keyResponsibilities', (reviewProfile.structuredUserInfo?.keyResponsibilities || []).length).map((idx) => {
                    const resp = (reviewProfile.structuredUserInfo?.keyResponsibilities || [])[idx];
                    return (
                      <Box
                        key={idx}
                        {...reviewFieldAnchorProps(`structuredUserInfo.keyResponsibilities.${idx}`)}
                        sx={REVIEW.rowEntryMultiline}
                      >
                        {renderReviewEntryCheckbox(
                          `structuredUserInfo.keyResponsibilities.${idx}`,
                          t('documentUpload.review.labels.responsibility', { index: idx + 1 })
                        )}
                        <TextField
                          value={resp || ''}
                          onChange={(e) => {
                            clearGoodAtCategoryErrors('keyResponsibilities', idx);
                            setReviewProfile((prev) => ({
                              ...prev,
                              structuredUserInfo: {
                                ...(prev.structuredUserInfo || {}),
                                keyResponsibilities: (prev.structuredUserInfo?.keyResponsibilities || []).map((item, i) => (
                                  i === idx ? e.target.value : item
                                ))
                              }
                            }));
                          }}
                          sx={{
                            ...REVIEW.field,
                            '& .MuiInputBase-inputMultiline': {
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                              wordBreak: 'break-word',
                            },
                            '& .MuiFormHelperText-root': {
                              overflowWrap: 'anywhere',
                              wordBreak: 'break-word',
                            },
                          }}
                          fullWidth
                          multiline
                          minRows={3}
                          disabled={!isAccepted(`structuredUserInfo.keyResponsibilities.${idx}`)}
                          hiddenLabel
                          error={Boolean(reviewFieldErrors[`structuredUserInfo.keyResponsibilities.${idx}`])}
                          helperText={reviewFieldErrors[`structuredUserInfo.keyResponsibilities.${idx}`]}
                          inputProps={{ maxLength: PROFILE_REVIEW_STRUCTURED_MAX.keyResponsibilities }}
                        />
                      </Box>
                    );
                  })}
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => appendStructuredStringList('keyResponsibilities')}
                    disabled={(reviewProfile.structuredUserInfo?.keyResponsibilities || []).length >= getProfileStructuredListMaxItems('keyResponsibilities')}
                    title={(reviewProfile.structuredUserInfo?.keyResponsibilities || []).length >= getProfileStructuredListMaxItems('keyResponsibilities') ? t('documentUpload.review.maxEntriesTitle', { max: getProfileStructuredListMaxItems('keyResponsibilities') }) : undefined}
                    sx={{ alignSelf: 'flex-start', mt: 0.5, mb: 1 }}
                  >
                    {t('documentUpload.review.actions.addResponsibility')}
                  </Button>
                  {renderGoodAtCategoryLimitNotice('keyResponsibilities')}
                  </Box>
                  <Box {...reviewFieldAnchorProps('structuredUserInfo.skills')}>
                  <Typography variant="body1" sx={{ ...REVIEW.subcategoryTitle, mt: 2 }}>
                    {t('documentUpload.review.goodAtCategories.skills')}
                  </Typography>
                  {reviewFieldErrors['structuredUserInfo.skills'] && (
                    <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>
                      {reviewFieldErrors['structuredUserInfo.skills']}
                    </Typography>
                  )}
                  {reviewSkillValues.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.skills')}
                    </Typography>
                  )}
                  <SkillPicker
                    value={reviewSkillValues}
                    onChange={handleSelectedSkillsChange}
                    maxItems={getProfileStructuredListMaxItems('skills')}
                    recommendationContextTexts={skillSelectionRecommendationContext}
                  />
                  {renderGoodAtCategoryLimitNotice('skills')}
                  </Box>
                  <Box {...reviewFieldAnchorProps('structuredUserInfo.skillsInDevelopment')}>
                  <Typography variant="body1" sx={{ ...REVIEW.subcategoryTitle, mt: 2 }}>
                    {t('documentUpload.review.goodAtCategories.skillsInDevelopment')}
                  </Typography>
                  {reviewFieldErrors['structuredUserInfo.skillsInDevelopment'] && (
                    <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>
                      {reviewFieldErrors['structuredUserInfo.skillsInDevelopment']}
                    </Typography>
                  )}
                  {reviewLearningGoalValues.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.skillsInDevelopment')}
                    </Typography>
                  )}
                  <SkillPicker
                    value={reviewLearningGoalValues}
                    onChange={handleSkillsToLearnChange}
                    maxItems={getProfileStructuredListMaxItems('skillsInDevelopment')}
                    recommendationContextTexts={skillSelectionRecommendationContext}
                    excludeLabels={excludedSkillLabelsForLearning}
                    translationKeyPrefix="skillsToLearnSelection"
                  />
                  {renderGoodAtCategoryLimitNotice('skillsInDevelopment')}
                  </Box>
                </>
              )}
              {reviewStep === 4 && !manualFillMode && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('documentUpload.review.step4Intro')}
                  </Typography>
                  {inputQualityDiagnosisLoading && step3FollowUps.length === 0 && (
                    <Box sx={{ mb: 2 }}>
                      <LinearProgress />
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        {t('documentUpload.review.analyzing')}
                      </Typography>
                    </Box>
                  )}
                  {inputQualityDiagnosisError && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      {t('documentUpload.review.step3QualityErrorPrefix')} {inputQualityDiagnosisError}
                    </Alert>
                  )}
                  {step3FollowUps.length === 0 && !inputQualityDiagnosisLoading && !inputQualityDiagnosisError && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {t('documentUpload.review.step4NoFollowUps')}
                    </Typography>
                  )}
                  {step3FollowUps.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                      {step3FollowUps.map((d) => (
                        <Box key={d.field} {...reviewFieldAnchorProps(d.field)} sx={{ mb: 2.5 }}>
                          <Typography variant="body1" sx={REVIEW.subcategoryTitle}>
                            {d.follow_up_question}
                          </Typography>
                          <TextField
                            fullWidth
                            multiline
                            minRows={3}
                            hiddenLabel
                            required
                            placeholder={t('documentUpload.review.followUpPlaceholder')}
                            value={step3FollowUpAnswers[d.field] || ''}
                            onChange={(e) => {
                              clearReviewFieldError(d.field);
                              setStep3FollowUpAnswers((prev) => ({
                                ...prev,
                                [d.field]: e.target.value
                              }));
                            }}
                            error={Boolean(reviewFieldErrors[d.field])}
                            helperText={reviewFieldErrors[d.field]}
                            inputProps={{
                              'aria-required': true,
                              ...(d.field.startsWith('userIdentity.')
                                ? { maxLength: PROFILE_REVIEW_USER_IDENTITY_MAX }
                                : {}),
                            }}
                          />
                        </Box>
                      ))}
                    </Box>
                  )}
                </>
              )}
              {reviewStep === 5 && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {manualFillMode
                      ? t('documentUpload.review.step5IntroManual')
                      : t('documentUpload.review.step5Intro')}
                  </Typography>
                  {isCvReviewFinalSeniorityStep && step5NarrativeWarmStatus === 'warming' && (
                    <Box sx={{ mb: 2 }}>
                      <Alert severity="info">
                        {t('documentUpload.review.step5PreparingProfile')}
                      </Alert>
                      {step5NarrativeWarmSlow && (
                        <Alert severity="warning" sx={{ mt: 1.5 }}>
                          {t('documentUpload.review.step5PrepareSlow')}
                        </Alert>
                      )}
                      <LinearProgress
                        variant="determinate"
                        value={step5NarrativeWarmProgress}
                        sx={{
                          mt: 1.5,
                          height: 4,
                          borderRadius: 1,
                          '& .MuiLinearProgress-bar': {
                            transition: 'transform 0.35s linear',
                          },
                        }}
                      />
                    </Box>
                  )}
                  {isCvReviewFinalSeniorityStep && step5NarrativeWarmStatus === 'failed' && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      {t('documentUpload.review.step5PrepareSlow')}
                    </Alert>
                  )}
                  <Divider sx={{ mb: 2 }} />
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Box sx={REVIEW.rowLabeledField} {...reviewFieldAnchorProps('seniority.currentStatus')}>
                      <Typography variant="body1" sx={REVIEW.categoryText}>
                        {t('documentUpload.review.experience.currentEmploymentStatus')}
                      </Typography>
                      <TextField
                        select
                        fullWidth
                        hiddenLabel
                        sx={REVIEW.field}
                        value={reviewProfile.seniority?.currentStatus || ''}
                        onChange={(e) => {
                          setReviewDialogError('');
                          setReviewProfile((prev) => ({
                            ...prev,
                            seniority: { ...(prev.seniority || {}), currentStatus: e.target.value }
                          }));
                        }}
                        SelectProps={{ native: true }}
                      >
                        <option value="">{t('documentUpload.review.selectPlaceholder')}</option>
                        {(() => {
                          const v = reviewProfile.seniority?.currentStatus || '';
                          const inList = CURRENT_EMPLOYMENT_STATUS_OPTIONS.some((o) => o.value === v);
                          return (
                            <>
                              {v && !inList && (
                                <option value={v}>{currentEmploymentStatusLabelLocalized(v)}</option>
                              )}
                              {CURRENT_EMPLOYMENT_STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{currentEmploymentStatusLabelLocalized(opt.value)}</option>
                              ))}
                            </>
                          );
                        })()}
                      </TextField>
                    </Box>
                    <Box sx={REVIEW.rowLabeledField} {...reviewFieldAnchorProps('seniority.yearsOfExperience')}>
                      <Typography variant="body1" sx={REVIEW.categoryText}>
                        {t('documentUpload.review.experience.yearsOfWorkExperience')}
                      </Typography>
                      <TextField
                        select
                        fullWidth
                        hiddenLabel
                        sx={REVIEW.field}
                        value={(() => {
                          const y = reviewProfile.seniority?.yearsOfExperience;
                          if (y === null || y === undefined || y === '') return '';
                          const n = Number(y);
                          return Number.isFinite(n) && n >= 0 && n <= 50 ? String(n) : String(y);
                        })()}
                        onChange={(e) => {
                          setReviewDialogError('');
                          const raw = e.target.value;
                          setReviewProfile((prev) => ({
                            ...prev,
                            seniority: {
                              ...(prev.seniority || {}),
                              yearsOfExperience: raw === '' ? null : Number(raw)
                            }
                          }));
                        }}
                        SelectProps={{ native: true }}
                      >
                        <option value="">{t('documentUpload.review.selectPlaceholder')}</option>
                        {(() => {
                          const y = reviewProfile.seniority?.yearsOfExperience;
                          const n = y === null || y === undefined || y === '' ? null : Number(y);
                          const outOfRange = n !== null && Number.isFinite(n) && (n < 0 || n > 50);
                          return (
                            <>
                              {outOfRange && (
                                <option value={String(n)}>{String(n)}</option>
                              )}
                              {YEARS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={String(opt.value)}>{opt.label}</option>
                              ))}
                            </>
                          );
                        })()}
                      </TextField>
                    </Box>
                    <Box sx={REVIEW.rowLabeledField} {...reviewFieldAnchorProps('seniority.highestDegree')}>
                      <Typography variant="body1" sx={REVIEW.categoryText}>
                        {t('documentUpload.review.experience.highestEducationalDegree')}
                      </Typography>
                      <TextField
                        select
                        fullWidth
                        hiddenLabel
                        sx={REVIEW.field}
                        value={reviewProfile.seniority?.highestDegree || ''}
                        onChange={(e) => {
                          setReviewDialogError('');
                          setReviewProfile((prev) => ({
                            ...prev,
                            seniority: { ...(prev.seniority || {}), highestDegree: e.target.value }
                          }));
                        }}
                        SelectProps={{ native: true }}
                      >
                        <option value="">{t('documentUpload.review.selectPlaceholder')}</option>
                        {(() => {
                          const v = reviewProfile.seniority?.highestDegree || '';
                          const inList = HIGHEST_DEGREE_OPTIONS.some((o) => o.value === v);
                          return (
                            <>
                              {v && !inList && (
                                <option value={v}>{highestDegreeLabelLocalized(v)}</option>
                              )}
                              {HIGHEST_DEGREE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{highestDegreeLabelLocalized(opt.value)}</option>
                              ))}
                            </>
                          );
                        })()}
                      </TextField>
                    </Box>
                    <Box sx={REVIEW.rowLabeledField} {...reviewFieldAnchorProps('seniority.mostSeniorWorkExperience')}>
                      <Typography variant="body1" sx={REVIEW.categoryText}>
                        {t('documentUpload.review.experience.mostSeniorWorkExperience')}
                      </Typography>
                      <TextField
                        select
                        fullWidth
                        hiddenLabel
                        sx={REVIEW.field}
                        value={reviewProfile.seniority?.mostSeniorWorkExperience || ''}
                        onChange={(e) => {
                          setReviewDialogError('');
                          setReviewProfile((prev) => ({
                            ...prev,
                            seniority: { ...(prev.seniority || {}), mostSeniorWorkExperience: e.target.value }
                          }));
                        }}
                        SelectProps={{ native: true }}
                      >
                        <option value="">{t('documentUpload.review.selectPlaceholder')}</option>
                        {(() => {
                          const v = reviewProfile.seniority?.mostSeniorWorkExperience || '';
                          const inList = MOST_SENIOR_OPTIONS.some((o) => o.value === v);
                          return (
                            <>
                              {v && !inList && (
                                <option value={v}>{mostSeniorLabelLocalized(v)}</option>
                              )}
                              {MOST_SENIOR_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{mostSeniorLabelLocalized(opt.value)}</option>
                              ))}
                            </>
                          );
                        })()}
                      </TextField>
                    </Box>
                  </Box>
                </>
              )}
            </Box>
          ) : reviewStep !== 1 ? (
            <Typography>{t('documentUpload.review.noExtractedData')}</Typography>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ flexShrink: 0 }}>
          <Button onClick={() => setReviewCancelConfirmOpen(true)} disabled={savingReviewActive}>
            {t('documentUpload.common.cancel')}
          </Button>
          {showReviewBackButton && (
            <Button onClick={handleReviewBack} disabled={savingReviewActive}>
              {t('documentUpload.common.back')}
            </Button>
          )}
          {inManualOptionalCv && (
            <>
              {!optionalCvExtractionComplete && (
                <Button onClick={handleManualFillOptionalCvSkip} disabled={savingReviewActive || uploading}>
                  {t('profileCreation.manualFill.optionalCv.skipCta')}
                </Button>
              )}
              <Button
                onClick={() => void handleManualFillOptionalCvContinue()}
                variant="contained"
                disabled={savingReviewActive || uploading || !manualOptionalCvCanContinue}
              >
                {(cvPipelinePhase === 'failed' || cvPollFailedDocId || cvPollTimedOutDocId)
                  ? t('profileCreation.manualFill.optionalCv.continueWithoutCvCta')
                  : t('profileCreation.manualFill.optionalCv.continueCta')}
              </Button>
            </>
          )}
          {reviewStep === 1 && enableExtractionReview ? null : hideReviewPrimaryAction ? null : isReviewContinueStep ? (
            <Button
              onClick={handleReviewContinue}
              variant="contained"
              disabled={
                savingReviewActive
                || reviewContinueBusy
                || (reviewStep === 2 && !manualFillMode && (structuredReviewLoading || !structuredExtractionReady))
                || (reviewStep === 4 && !step3FollowUpsAnsweredFully)
                || (manualFillMode && reviewStep === 5 && !step3SeniorityComplete)
                || (showWorkEnjoySummaryConfirm && (
                  workEnjoySummaryFooter.isEditing || !workEnjoySummaryFooter.hasActivities
                ))
                || (showTopicsSummaryConfirm && (
                  topicsSummaryFooter.isEditing || !topicsSummaryFooter.hasSummary
                ))
                || (showStrengthsSummaryConfirm && (
                  strengthsSummaryFooter.isEditing || !strengthsSummaryFooter.hasSummary
                ))
                || (showWorkEnvironmentSummaryConfirm && (
                  workEnvironmentSummaryFooter.isEditing || !workEnvironmentSummaryFooter.hasSummary
                ))
                || (showWorkingLifeAchievementSummaryConfirm && (
                  workingLifeAchievementSummaryFooter.isEditing || !workingLifeAchievementSummaryFooter.hasSummary
                ))
                || (inManualTasksResponsibilities && !reviewProfileHasKeyResponsibilities(reviewProfile))
                || (inManualSkillsSelection && !reviewProfileHasSelectedSkill(reviewProfile))
                || (inManualSkillsToLearn && !reviewProfileHasSkillsInDevelopment(reviewProfile))
              }
              startIcon={
                (reviewContinueBusy || (reviewStep === 2 && !manualFillMode && structuredReviewLoading))
                  ? <CircularProgress size={16} color="inherit" />
                  : null
              }
            >
              {reviewContinueBusy
                ? t('documentUpload.review.analyzing')
                : showWorkEnjoySummaryConfirm
                  ? t('workEnjoyCoaching.summary.confirmCta')
                  : showTopicsSummaryConfirm
                    ? t('topicsIndustriesCoaching.summary.confirmCta')
                    : showStrengthsSummaryConfirm
                      ? t('naturallyGoodAtCoaching.summary.confirmCta')
                      : showWorkEnvironmentSummaryConfirm
                        ? t('workEnvironmentCoaching.summary.confirmCta')
                      : showWorkingLifeAchievementSummaryConfirm
                        ? t('workingLifeAchievementCoaching.summary.confirmCta')
                      : reviewStep === 2 && !manualFillMode && (structuredReviewLoading || !structuredExtractionReady)
                      ? t('documentUpload.review.structuredLoading')
                      : t('documentUpload.common.continue')}
            </Button>
          ) : (
            <Button
              onClick={handleReviewSave}
              variant="contained"
              disabled={
                savingReviewActive
                || !step3SeniorityComplete
                || step5NarrativeBlocksSave
                || (manualFillMode && inManualSkillsToLearn && !reviewProfileHasSkillsInDevelopment(reviewProfile))
              }
              startIcon={savingReviewActive ? <CircularProgress size={16} /> : null}
            >
              {savingReviewActive ? t('documentUpload.review.saving') : t('documentUpload.review.saveToProfileCta')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog
        open={reviewCancelConfirmOpen}
        onClose={() => setReviewCancelConfirmOpen(false)}
        aria-labelledby="review-cancel-confirm-title"
        aria-describedby="review-cancel-confirm-description"
      >
        <DialogTitle id="review-cancel-confirm-title">
          {(manualFillMode || enableExtractionReview)
            ? t('documentUpload.review.cancelConfirm.manualFillTitle')
            : t('documentUpload.review.cancelConfirm.title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="review-cancel-confirm-description">
            {(manualFillMode || enableExtractionReview)
              ? t('documentUpload.review.cancelConfirm.manualFillDescription')
              : t('documentUpload.review.cancelConfirm.description')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewCancelConfirmOpen(false)} variant="outlined">
            {t('documentUpload.review.cancelConfirm.stayCta')}
          </Button>
          <Button onClick={() => void handleReviewCancel()} variant="contained" color="error" disabled={savingReviewActive}>
            {(manualFillMode || enableExtractionReview)
              ? t('documentUpload.review.cancelConfirm.manualFillLeaveCta')
              : t('documentUpload.review.cancelConfirm.discardCta')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={manualFillStartConfirmOpen}
        onClose={() => setManualFillStartConfirmOpen(false)}
        aria-labelledby="manual-fill-start-confirm-title"
        aria-describedby="manual-fill-start-confirm-description"
      >
        <DialogTitle id="manual-fill-start-confirm-title">
          {t('profileCreation.manualFill.startOverConfirm.title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="manual-fill-start-confirm-description">
            {t('profileCreation.manualFill.startOverConfirm.description')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualFillStartConfirmOpen(false)} variant="outlined">
            {t('profileCreation.manualFill.startOverConfirm.keepSavedCta')}
          </Button>
          <Button
            onClick={() => {
              setManualFillStartConfirmOpen(false);
              startManualFillFresh();
            }}
            variant="contained"
            color="error"
          >
            {t('profileCreation.manualFill.startOverConfirm.startFreshCta')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={manualFillDiscardConfirmOpen}
        onClose={() => setManualFillDiscardConfirmOpen(false)}
        aria-labelledby="manual-fill-discard-confirm-title"
        aria-describedby="manual-fill-discard-confirm-description"
      >
        <DialogTitle id="manual-fill-discard-confirm-title">
          {t('profileCreation.manualFill.discardConfirm.title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="manual-fill-discard-confirm-description">
            {t('profileCreation.manualFill.discardConfirm.description')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualFillDiscardConfirmOpen(false)} variant="outlined">
            {t('profileCreation.manualFill.discardConfirm.keepSavedCta')}
          </Button>
          <Button
            onClick={() => {
              setManualFillDiscardConfirmOpen(false);
              discardSavedManualFillDraft();
            }}
            variant="contained"
            color="error"
          >
            {t('profileCreation.manualFill.discardConfirm.confirmCta')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DocumentUploadForm; 