import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
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
  CloudUpload as CloudUploadIcon,
  Edit as EditIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { USER_IDENTITY_FIELDS } from '../../constants/userIdentityFields';
import { validateSeniorityPayload } from '../../utils/validateSeniorityPayload';
import {
  ProfileReviewSaveError,
  translateReviewFieldErrors,
} from '../../utils/profileReviewSaveFlow';
import {
  validateReviewProfileInDialog,
  validateReviewIdentityStep,
  buildStructuredGoodAtFromReview,
  PROFILE_REVIEW_USER_IDENTITY_MAX,
  PROFILE_REVIEW_STRUCTURED_MAX,
} from '../../utils/validateReviewProfilePayload';
import { PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY } from '../../../constants/profileReviewFieldLimits';
import {
  saveCvReviewDraft,
  loadCvReviewDraft,
  clearCvReviewDraft,
} from '../../utils/cvReviewDraftStorage';
import { useAuth } from '../../contexts/AuthContext';
import {
  CURRENT_EMPLOYMENT_STATUS_OPTIONS,
  currentEmploymentStatusLabel,
  sanitizeCurrentEmploymentStatus
} from '../../../constants/currentEmploymentStatus';
import { HIGHEST_DEGREE_OPTIONS, HIGHEST_DEGREE_ALLOWED, highestDegreeLabel, inferHighestDegreeFromText } from '../../../constants/highestDegree';
import {
  MOST_SENIOR_OPTIONS,
  MOST_SENIOR_ALLOWED,
  YEARS_OPTIONS,
  inferMostSeniorRoleFromText
} from '../../../constants/senioritySelectOptions';
import {
  DOCUMENT_TYPE_UPLOAD_OPTIONS,
  isCvDocumentType,
  documentTypeDisplaySlug,
} from '../../../constants/documentTypes';
import {
  watchCvExtractionUntilTerminal,
  fetchCvExtractionStatus,
  isActiveCvExtractionDocument,
  mapExtractionStatusToUiPhase,
} from '../../utils/cvExtractionPoll';
import { getExtractionErrorMessage } from '../../utils/cvExtractionErrors';
import {
  mapZombieSignalsToUxPhase,
  getDelayReasonI18nKey,
} from '../../utils/cvExtractionZombie';
import ProfileCreationProgress from './ProfileCreationProgress';
import ProfileReviewStepTitle from './ProfileReviewStepTitle';
import {
  buildReviewFieldScrollQueue,
  firstEmptyFollowUpFieldKey,
  reviewFieldAnchorProps,
  scheduleReviewFieldScroll,
  scrollToFirstReviewField,
  seniorityReviewFieldKey,
} from '../../utils/reviewFieldScroll';

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

const normalizeDocuments = (docs) =>
  docs.map((doc) => ({
    ...doc,
    id: doc.id || doc._id,
  }));

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

const MAX_GOOD_AT_PER_CATEGORY = PROFILE_REVIEW_MAX_GOOD_AT_PER_CATEGORY;

/** Legacy success banner — no longer shown on profile creation review steps. */
const LEGACY_SEMANTIC_INTERPRETATION_SUCCESS_KEY =
  'documentUpload.extraction.semanticInterpretationSuccess';

function shouldShowExtractionStatusBanner(messageKey, message) {
  if (messageKey === LEGACY_SEMANTIC_INTERPRETATION_SUCCESS_KEY) return false;
  return Boolean(messageKey || message);
}

/** Merge Step 3 follow-up answers into the review profile before save (append text / push list rows). */
function applyStep3FollowUpAnswersToReviewProfile(profile, followUps, answers) {
  if (!profile || typeof profile !== 'object' || !Array.isArray(followUps) || followUps.length === 0) {
    return profile;
  }
  const uid = { ...(profile.userIdentity || {}) };
  const keyResponsibilities = [...(profile.structuredUserInfo?.keyResponsibilities || [])];
  const skillsInDevelopment = [...(profile.structuredUserInfo?.skillsInDevelopment || [])];

  for (const row of followUps) {
    const f = row.field;
    const ans = String((answers && answers[f]) || '').trim();
    if (!ans) continue;
    if (f.startsWith('userIdentity.')) {
      const key = f.slice('userIdentity.'.length);
      const prev = String(uid[key] || '').trim();
      uid[key] = prev ? `${prev}\n\n${ans}` : ans;
    } else if (f === 'structuredUserInfo.keyResponsibilities') {
      if (keyResponsibilities.length < MAX_GOOD_AT_PER_CATEGORY) {
        keyResponsibilities.push(ans);
      }
    } else if (f === 'structuredUserInfo.skillsInDevelopment') {
      if (skillsInDevelopment.length < MAX_GOOD_AT_PER_CATEGORY) {
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

function capGoodAtList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, MAX_GOOD_AT_PER_CATEGORY);
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
  /** Matches Profile.jsx / UserIdentityTextForm subcategory question labels. */
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

function mergeReviewProfileWithDraft(normalized, draftProfile) {
  const base = ensureReviewProfileShape(normalized);
  const draft = ensureReviewProfileShape(draftProfile);
  return ensureReviewProfileShape({
    ...base,
    ...draft,
    userIdentity: { ...base.userIdentity, ...draft.userIdentity },
    structuredUserInfo: { ...base.structuredUserInfo, ...draft.structuredUserInfo },
    seniority: { ...base.seniority, ...draft.seniority },
  });
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
  } = setters;
  if (typeof draft.reviewStep === 'number') {
    let step = draft.reviewStep;
    // Legacy drafts used step 3 for context follow-ups; new flow uses step 5.
    const hasContextFollowUps =
      Array.isArray(draft.step3FollowUps) && draft.step3FollowUps.length > 0;
    if (step === 3 && hasContextFollowUps) {
      step = 5;
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
}

const DocumentUploadForm = ({
  documents = [],
  onDocumentsUpdate,
  loading,
  onExtractedProfileReview,
  enableExtractionReview = true,
  defaultDocumentType = '',
  rollbackOnReviewCancel = false,
  showSectionTitle = true,
  reviewSaveMode = 'merge',
  showUploadControls = true,
  parentSavingReview = false,
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
  const [uploadDialog, setUploadDialog] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [documentType, setDocumentType] = useState(defaultDocumentType || '');
  const [extractedProfileData, setExtractedProfileData] = useState(null);
  /** Bilingual payloads from CV pipeline; forwarded on review save for profile merge. */
  const [cvExtractLocalization, setCvExtractLocalization] = useState(null);
  const [extractionStatus, setExtractionStatus] = useState(null);
  const [extractionMessage, setExtractionMessage] = useState(null);
  const [extractionMessageKey, setExtractionMessageKey] = useState(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewProfile, setReviewProfile] = useState({});
  const [reviewStep, setReviewStep] = useState(2);
  const [step3FollowUps, setStep3FollowUps] = useState([]);
  const [step3FollowUpAnswers, setStep3FollowUpAnswers] = useState({});
  const [inputQualityDiagnosisError, setInputQualityDiagnosisError] = useState(null);
  const [inputQualityDiagnosisLoading, setInputQualityDiagnosisLoading] = useState(false);
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
  /** Validation/save errors shown inside the review dialog (not hidden behind the modal). */
  const [reviewDialogError, setReviewDialogError] = useState('');
  /** Per-field errors keyed by review path (e.g. userIdentity.workEnjoyMost). */
  const [reviewFieldErrors, setReviewFieldErrors] = useState({});

  const documentsRef = useRef(documents);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    if (reviewDialogOpen) {
      setReviewDialogError('');
      setReviewFieldErrors({});
      pendingReviewScrollRef.current = null;
    }
  }, [reviewDialogOpen]);

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
    setReviewStep(result.focusStep || 2);
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

  /** Restore in-progress review draft after refresh / long session (sessionStorage, 24h TTL). */
  useEffect(() => {
    if (!reviewUserId || reviewDraftRestoredRef.current) return undefined;
    const draft = loadCvReviewDraft(reviewUserId);
    if (!draft?.pendingUploadedDocId) return undefined;
    reviewDraftRestoredRef.current = true;
    setPendingUploadedDocId(String(draft.pendingUploadedDocId));
    if (draft.reviewProfile && typeof draft.reviewProfile === 'object') {
      setReviewProfile(ensureReviewProfileShape(draft.reviewProfile));
    }
    restoreReviewDraftUiState(draft, {
      setReviewStep,
      setStep3FollowUps,
      setStep3FollowUpAnswers,
      setAcceptedFields,
      setCvExtractLocalization,
      setReviewDialogOpen,
    });
    return undefined;
  }, [reviewUserId]);

  /** Persist review answers while the dialog is open (survives tab refresh / long editing). */
  useEffect(() => {
    if (!reviewUserId || !pendingUploadedDocId) return undefined;
    if (!reviewDialogOpen && !extractedProfileData) return undefined;
    const timer = setTimeout(() => {
      saveCvReviewDraft(reviewUserId, {
        pendingUploadedDocId,
        reviewProfile,
        reviewStep,
        step3FollowUps,
        step3FollowUpAnswers,
        acceptedFields,
        cvExtractLocalization,
        reviewDialogOpen,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [
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
  ]);

  /** Step 5: all follow-up prompts returned from quality diagnosis must have non-empty answers before save. */
  const step3FollowUpsAnsweredFully = useMemo(() => {
    if (reviewStep !== 5) return true;
    if (!step3FollowUps.length) return true;
    return step3FollowUps.every((d) => String(step3FollowUpAnswers[d.field] || '').trim().length > 0);
  }, [reviewStep, step3FollowUps, step3FollowUpAnswers]);

  const step3SeniorityComplete = useMemo(() => {
    if (reviewStep !== 5) return true;
    return validateSeniorityPayload(reviewProfile?.seniority || {}).ok;
  }, [reviewStep, reviewProfile?.seniority]);

  const seniorityFieldErrorKey = (field) => {
    const keys = {
      currentStatus: 'profilePage.seniorityForm.errors.currentStatusRequired',
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
    let currentStatus = sanitizeCurrentEmploymentStatus(seniority.currentStatus || '');
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
    const derivedResponsibilities = Array.isArray(structuredUserInfo.workExperience)
      ? structuredUserInfo.workExperience
        .map((item) => String(item?.description || '').trim())
        .filter(Boolean)
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
          : []),
        skills: capGoodAtList(normalizedSkills),
        skillsInDevelopment: capGoodAtList(Array.isArray(structuredUserInfo.skillsInDevelopment)
          ? structuredUserInfo.skillsInDevelopment
          : []),
        certifications: Array.isArray(structuredUserInfo.certifications)
          ? structuredUserInfo.certifications
          : [],
        keyResponsibilities: capGoodAtList(Array.isArray(structuredUserInfo.keyResponsibilities)
          ? structuredUserInfo.keyResponsibilities
          : derivedResponsibilities),
        domains: capGoodAtList(Array.isArray(structuredUserInfo.domains)
          ? structuredUserInfo.domains
          : [])
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
    let appended = false;
    let newIdx = 0;
    setReviewProfile((prev) => {
      const sui = prev.structuredUserInfo || {};
      const prevList = sui[arrayKey] || [];
      if (prevList.length >= MAX_GOOD_AT_PER_CATEGORY) return prev;
      appended = true;
      newIdx = prevList.length;
      return { ...prev, structuredUserInfo: { ...sui, [arrayKey]: [...prevList, ''] } };
    });
    if (appended) {
      setAcceptedFields((af) => ({ ...af, [`structuredUserInfo.${arrayKey}.${newIdx}`]: true }));
    }
  };

  const appendSkillRow = () => {
    let appended = false;
    let newIdx = 0;
    setReviewProfile((prev) => {
      const sui = prev.structuredUserInfo || {};
      const prevList = sui.skills || [];
      if (prevList.length >= MAX_GOOD_AT_PER_CATEGORY) return prev;
      appended = true;
      newIdx = prevList.length;
      return { ...prev, structuredUserInfo: { ...sui, skills: [...prevList, { name: '' }] } };
    });
    if (appended) {
      setAcceptedFields((af) => ({ ...af, [`structuredUserInfo.skills.${newIdx}`]: true }));
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
    const count = (reviewProfile.structuredUserInfo?.[arrayKey] || []).length;
    if (count < MAX_GOOD_AT_PER_CATEGORY) return null;
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 0.5 }}>
        {t('documentUpload.review.goodAtLimit', { max: MAX_GOOD_AT_PER_CATEGORY })}
      </Typography>
    );
  };

  const queueFileForUpload = useCallback((file) => {
    if (!file) return;
    setUploadError('');
    setSelectedFile(file);
    setUploadDialog(true);
    setAutoStartUpload(true);
  }, []);

  const onDrop = useCallback((acceptedFiles) => {
    const file = acceptedFiles?.[0];
    if (!file) return;
    queueFileForUpload(file);
  }, [queueFileForUpload]);

  const onDropRejected = useCallback((fileRejections) => {
    if (!Array.isArray(fileRejections) || fileRejections.length === 0) {
      setUploadError(t('documentUpload.errors.filesRejected'));
      return;
    }

    const hasSizeError = fileRejections.some((rejection) =>
      rejection?.errors?.some((error) => error.code === 'file-too-large')
    );
    const hasTypeError = fileRejections.some((rejection) =>
      rejection?.errors?.some((error) => error.code === 'file-invalid-type')
    );

    if (hasSizeError) {
      setUploadError(t('documentUpload.errors.fileTooLarge'));
      return;
    }

    if (hasTypeError) {
      setUploadError(t('documentUpload.errors.invalidType'));
      return;
    }

    const firstError = fileRejections[0]?.errors?.[0]?.message;
    setUploadError(firstError || t('documentUpload.errors.filesRejected'));
  }, [t]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    onDropRejected,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    maxSize: MAX_UPLOAD_SIZE_BYTES,
  });

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
        throw new Error(errorData.message || 'Upload failed');
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
        setExtractionStatus(data.extractionStatus || null);
        setExtractionMessage(data.extractionMessage || null);
        setExtractionMessageKey(data.extractionMessageKey || null);

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
      setUploadDialog(false);
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
  ]);

  const hydrateFromDocument = useCallback(async (docId) => {
    const res = await fetch(`/api/documents/${docId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    if (!res.ok) throw new Error('document refresh failed');
    const data = await res.json();
    const document = data.document;
    if (!document) return false;
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
      setCvExtractLocalization(
        document.cvExtractLocalization && typeof document.cvExtractLocalization === 'object'
          ? document.cvExtractLocalization
          : null
      );
      const normalizedData = normalizeExtractedProfileData(extractedPayload);
      setExtractedProfileData(normalizedData);
      loadReviewProfileFromExtraction(normalizedData, docId);
      setAcceptedFields(buildAcceptedDefaults(normalizedData));
      setStep3FollowUps([]);
      setStep3FollowUpAnswers({});
      setInputQualityDiagnosisError(null);
      setInputQualityDiagnosisLoading(false);
      setReviewStep(2);
      const reviewStatus =
        outcome === 'success' || outcome === 'partial' || outcome === 'failed'
          ? outcome
          : extractedPayload
            ? 'success'
            : 'partial';
      setExtractionStatus(reviewStatus);
      setExtractionMessage(document.extractionMessage || null);
      setExtractionMessageKey(document.extractionMessageKey || null);
      if (reviewStatus === 'success' || reviewStatus === 'partial') {
        setReviewDialogOpen(true);
      }
      return true;
    }
    return false;
  }, [enableExtractionReview, onDocumentsUpdate, loadReviewProfileFromExtraction]);

  const applyExtractionPollSnapshot = useCallback((snapshot, pollActive) => {
    if (!snapshot) return;
    setCvZombieSnapshot(snapshot);
    setCvRecoveryUxPhase(mapZombieSignalsToUxPhase(snapshot, pollActive));
    setExtractionEstimatedState(snapshot.estimatedState);
    setCvPipelinePhase(mapExtractionStatusToUiPhase(snapshot.status, snapshot.stage));
  }, []);

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
      const snapshot = {
        status: data.status,
        stage: data.stage ?? null,
        progress: Number(data.progress ?? 0),
        message: data.message || data.progressLabel || '',
        estimatedState: data.estimatedState ?? null,
        errorKey: data.errorKey ?? null,
        elapsedMs: Number(data.elapsedMs ?? 0),
        isSlow: Boolean(data.isSlow),
        isStuck: Boolean(data.isStuck),
        estimatedDelayReason: data.estimatedDelayReason ?? null,
        workerHealthSignal: data.workerHealthSignal ?? null,
        retryRecommended: Boolean(data.retryRecommended),
        pollPhase: 'degraded',
      };
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
          {
            status: statusPayload.status,
            stage: statusPayload.stage ?? null,
            progress: Number(statusPayload.progress ?? 0),
            message: statusPayload.message || '',
            estimatedState: statusPayload.estimatedState ?? null,
            errorKey: null,
            elapsedMs: Number(statusPayload.elapsedMs ?? 0),
            isSlow: Boolean(statusPayload.isSlow),
            isStuck: Boolean(statusPayload.isStuck),
            estimatedDelayReason: statusPayload.estimatedDelayReason ?? null,
            workerHealthSignal: statusPayload.workerHealthSignal ?? null,
            retryRecommended: Boolean(statusPayload.retryRecommended),
            pollPhase: 'fast',
          },
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
        setPollReconnecting(false);
        applyExtractionPollSnapshot(snapshot, true);
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
        if (outcome.kind === 'completed') {
          try {
            const openedReview = await hydrateFromDocument(docId);
            if (enableExtractionReview && !openedReview && outcome?.data?.hasResult) {
              // Keep UX moving when status says "completed with result" but hydration lags.
              setReviewStep(2);
              setReviewDialogOpen(true);
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
  }, [cvPollTarget, hydrateFromDocument, t, applyExtractionPollSnapshot, enableExtractionReview]);

  useEffect(() => {
    if (cvPollTarget?.documentId) return;
    const activeDoc = (documents || []).find((d) => isActiveCvExtractionDocument(d));
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
  }, [documents, cvPollTarget, cvPollTimedOutDocId, cvPollFailedDocId, cvPipelinePhase]);

  useEffect(() => {
    const effectiveDocumentType = documentType || defaultDocumentType;
    if (!autoStartUpload || uploading || !uploadDialog || !selectedFile || !effectiveDocumentType) {
      return;
    }
    setAutoStartUpload(false);
    handleUpload();
  }, [autoStartUpload, uploading, uploadDialog, selectedFile, documentType, defaultDocumentType, handleUpload]);

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
      const profileForSave = applyStep3FollowUpAnswersToReviewProfile(
        reviewProfile,
        step3FollowUps,
        step3FollowUpAnswers
      );
      const emptyFollowUpField = firstEmptyFollowUpFieldKey(step3FollowUps, step3FollowUpAnswers);
      if (emptyFollowUpField) {
        setReviewDialogError(t('documentUpload.review.errors.fixHighlightedFields'));
        setReviewStep(5);
        queueReviewFieldScroll(emptyFollowUpField);
        return;
      }

      const seniorityCheck = validateSeniorityPayload(profileForSave.seniority || {});
      if (!seniorityCheck.ok) {
        setReviewDialogError(t(seniorityFieldErrorKey(seniorityCheck.field)));
        setReviewStep(4);
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
      if (reviewUserId) clearCvReviewDraft(reviewUserId);
      setReviewDialogOpen(false);
      setExtractedProfileData(null);
      setCvExtractLocalization(null);
      setExtractionStatus(null);
      setExtractionMessage(null);
      setExtractionMessageKey(null);
      setReviewProfile({});
      setAcceptedFields({});
      setStep3FollowUps([]);
      setStep3FollowUpAnswers({});
      setInputQualityDiagnosisError(null);
      setInputQualityDiagnosisLoading(false);
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

  const handleGoToNeedContextStep = async () => {
    setReviewDialogError('');
    const seniorityCheck = validateSeniorityPayload(reviewProfile?.seniority || {});
    if (!seniorityCheck.ok) {
      setReviewDialogError(t(seniorityFieldErrorKey(seniorityCheck.field)));
      queueReviewFieldScroll(seniorityReviewFieldKey(seniorityCheck.field));
      return;
    }
    if (!applyReviewValidationToUi(validateReviewIdentityStep(reviewProfile))) {
      return;
    }
    if (!applyReviewValidationToUi(
      validateReviewProfileInDialog(reviewProfile, acceptedFields, { requireGoodAt: true })
    )) {
      return;
    }

    const sui = reviewProfile.structuredUserInfo || {};
    setInputQualityDiagnosisLoading(true);
    setInputQualityDiagnosisError(null);
    try {
      const res = await fetch(`/api/profile/input-quality-diagnosis?lang=${encodeURIComponent(uiLangCode)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          lang: uiLangCode,
          userIdentity: reviewProfile.userIdentity || {},
          structuredUserInfo: sui
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || data?.details || `Quality analysis failed (${res.status})`);
      }
      setStep3FollowUps(Array.isArray(data.followUps) ? data.followUps : []);
      setStep3FollowUpAnswers({});
    } catch (e) {
      setInputQualityDiagnosisError(e.message || t('documentUpload.errors.qualityAnalysisFailed'));
      setStep3FollowUps([]);
      setStep3FollowUpAnswers({});
    } finally {
      setInputQualityDiagnosisLoading(false);
    }
    setReviewStep(5);
  };

  const handleReviewBack = () => {
    setReviewDialogError('');
    if (reviewStep === 5) {
      setStep3FollowUps([]);
      setStep3FollowUpAnswers({});
      setInputQualityDiagnosisError(null);
      setInputQualityDiagnosisLoading(false);
      setReviewStep(4);
      return;
    }
    if (reviewStep > 2) {
      setReviewStep(reviewStep - 1);
    }
  };

  const handleReviewContinue = async () => {
    setReviewDialogError('');
    if (reviewStep === 2) {
      if (!applyReviewValidationToUi(validateReviewIdentityStep(reviewProfile))) {
        return;
      }
      setReviewStep(3);
      return;
    }
    if (reviewStep === 3) {
      if (!applyReviewValidationToUi(
        validateReviewProfileInDialog(reviewProfile, acceptedFields, { requireGoodAt: true })
      )) {
        return;
      }
      setReviewStep(4);
      return;
    }
    if (reviewStep === 4) {
      await handleGoToNeedContextStep();
    }
  };

  // Handler for canceling review (after explicit confirmation in the UI)
  const handleReviewCancel = async () => {
    setReviewCancelConfirmOpen(false);
    setReviewDialogError('');
    if (reviewUserId) clearCvReviewDraft(reviewUserId);
    if (rollbackOnReviewCancel && pendingUploadedDocId) {
      try {
        await fetch(`/api/documents/${pendingUploadedDocId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        onDocumentsUpdate(normalizeDocuments(documents.filter((doc) => doc.id !== pendingUploadedDocId)));
      } catch (error) {
        console.warn('Failed to rollback uploaded document on review cancel:', error);
      }
    }
    setReviewDialogOpen(false);
    setExtractedProfileData(null);
    setCvExtractLocalization(null);
    setExtractionStatus(null);
    setExtractionMessage(null);
    setExtractionMessageKey(null);
    setReviewProfile({});
    setAcceptedFields({});
    setStep3FollowUps([]);
    setStep3FollowUpAnswers({});
    setInputQualityDiagnosisError(null);
    setInputQualityDiagnosisLoading(false);
    setReviewStep(2);
    setPendingUploadedDocId(null);
  };

  // Handler for editing extracted skills list items.
  const handleReviewSkillChange = (idx, value) => {
    clearGoodAtCategoryErrors('skills', idx);
    setReviewProfile(prev => ({
      ...prev,
      structuredUserInfo: {
        ...(prev.structuredUserInfo || {}),
        skills: (prev.structuredUserInfo?.skills || []).map((item, i) =>
          i === idx ? { ...item, name: value } : item
        )
      }
    }));
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

      {uploading && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t('documentUpload.async.uploading')}
          </Typography>
          <LinearProgress />
        </Alert>
      )}

      {!uploading && uploadSucceeded && cvPollTarget && (
        <Alert severity="success" sx={{ mb: 2 }}>
          <Typography variant="body2">
            {t('documentUpload.async.uploadComplete')}
          </Typography>
        </Alert>
      )}

      {!uploading && (cvPollTarget || cvPipelinePhase === 'failed' || cvPipelinePhase === 'timedOut' || cvRecoveryUxPhase === 'recovery' || cvRecoveryUxPhase === 'stuck' || cvRecoveryUxPhase === 'slow') && (
        <Alert
          severity={
            cvPipelinePhase === 'failed'
              ? 'error'
              : cvRecoveryUxPhase === 'stuck' || cvPipelinePhase === 'timedOut' || cvRecoveryUxPhase === 'recovery'
                ? 'warning'
                : 'info'
          }
          sx={{ mb: 2 }}
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
              if (pollReconnecting) return t('documentUpload.async.pollReconnecting');
              if (cvZombieSnapshot) {
                return t(getDelayReasonI18nKey(
                  cvZombieSnapshot.estimatedDelayReason,
                  cvZombieSnapshot.workerHealthSignal
                ));
              }
              if (extractionEstimatedState === 'retrying') {
                return t('documentUpload.async.retrying');
              }
              if (extractionEstimatedState === 'delayed') {
                return t('documentUpload.async.takingLonger');
              }
              if (cvPollTarget && extractionEstimatedState === 'normal') {
                return t('documentUpload.async.stillProcessing');
              }
              const map = {
                queued: 'documentUpload.async.extractionQueued',
                ocr: 'documentUpload.async.ocr',
                extraction: 'documentUpload.async.extraction',
                localization: 'documentUpload.async.localization',
                completed: 'documentUpload.async.completed',
              };
              return t(map[cvPipelinePhase] || 'documentUpload.async.extractionQueued');
            })()}
          </Typography>
          {cvPollTarget && cvPipelinePhase !== 'failed' && cvPipelinePhase !== 'completed' && cvPipelinePhase !== 'timedOut' && (
            <LinearProgress sx={{ mb: cvRecoveryUxPhase === 'stuck' ? 1 : 0 }} />
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
                  if (showUploadControls) open();
                }}
              >
                {t('documentUpload.async.recovery.uploadAgain')}
              </Button>
            </Box>
          )}
        </Alert>
      )}

      {showUploadControls && (
        <Paper
          {...getRootProps()}
          sx={{
            p: 3,
            mb: 3,
            textAlign: 'center',
            cursor: 'pointer',
            bgcolor: isDragActive ? 'action.hover' : 'background.paper',
            border: '2px dashed',
            borderColor: isDragActive ? 'primary.main' : 'grey.300'
          }}
        >
          <input {...getInputProps()} />
          <CloudUploadIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            {isDragActive
              ? t('documentUpload.dropzone.dragActive')
              : t('documentUpload.dropzone.idle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('documentUpload.dropzone.supportedFormats')}
          </Typography>
          <Button
            variant="outlined"
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
            startIcon={<UploadIcon />}
          >
            {t('documentUpload.dropzone.cta')}
          </Button>
        </Paper>
      )}

      {/* Document list */}
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

      {/* Delete Confirmation Dialog */}
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

      {showUploadControls && (
        <Dialog open={uploadDialog} onClose={() => { setUploadDialog(false); setAutoStartUpload(false); }}>
          <DialogTitle>{t('documentUpload.uploadDialog.title')}</DialogTitle>
          <DialogContent>
            <Box sx={{ pt: 1 }}>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                id="file-input"
              />
              <label htmlFor="file-input">
                <Button
                  variant="outlined"
                  component="span"
                  fullWidth
                  sx={{ mb: 2 }}
                  startIcon={<UploadIcon />}
                >
                  {selectedFile ? selectedFile.name : t('documentUpload.uploadDialog.selectFileCta')}
                </Button>
              </label>
              {!defaultDocumentType && (
                <TextField
                  select
                  fullWidth
                  label={t('documentUpload.uploadDialog.documentTypeLabel')}
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                  SelectProps={{
                    native: true
                  }}
                  sx={{ mb: 2 }}
                >
                  <option value="">{t('documentUpload.uploadDialog.documentTypePlaceholder')}</option>
                  {DOCUMENT_TYPE_UPLOAD_OPTIONS.map(({ value }) => (
                    <option key={value} value={value}>
                      {t(`documentUpload.uploadDialog.documentTypes.${value}`)}
                    </option>
                  ))}
                </TextField>
              )}
              {defaultDocumentType && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  {t('documentUpload.uploadDialog.defaultTypeInfo')}
                </Alert>
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setUploadDialog(false); setAutoStartUpload(false); }}>{t('documentUpload.common.cancel')}</Button>
            <Button
              onClick={handleUpload}
              variant="contained"
              disabled={!(documentType || defaultDocumentType) || uploading}
            >
              {uploading ? <CircularProgress size={24} /> : t('documentUpload.uploadDialog.uploadCta')}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Review extracted profile data dialog */}
      <Dialog
        open={reviewDialogOpen}
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
            <ProfileCreationProgress currentStep={reviewStep} sx={{ mb: 1.5 }} />
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
          {shouldShowExtractionStatusBanner(extractionMessageKey, extractionMessage) && (
            <Alert 
              severity={extractionStatus === 'success' ? 'success' : extractionStatus === 'partial' ? 'warning' : extractionStatus === 'failed' ? 'error' : 'info'}
              sx={{ mb: 2 }}
            >
              {extractionMessageKey ? t(extractionMessageKey) : extractionMessage}
            </Alert>
          )}
          {reviewDialogError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setReviewDialogError('')}>
              {reviewDialogError}
            </Alert>
          )}
          {extractedProfileData ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              {reviewStep === 2 && (
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
                        value={identityValue}
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
                </>
              )}
              {reviewStep === 3 && (
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
                  {(reviewProfile.structuredUserInfo?.skillDomains || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.skillDomains')}
                    </Typography>
                  )}
                  {sortStructuredIndices('structuredUserInfo.skillDomains', (reviewProfile.structuredUserInfo?.skillDomains || []).length).map((idx) => {
                    const domain = (reviewProfile.structuredUserInfo?.skillDomains || [])[idx];
                    return (
                      <Box
                        key={idx}
                        {...reviewFieldAnchorProps(`structuredUserInfo.skillDomains.${idx}`)}
                        sx={REVIEW.rowEntry}
                      >
                        {renderReviewEntryCheckbox(
                          `structuredUserInfo.skillDomains.${idx}`,
                          t('documentUpload.review.labels.skillDomain', { index: idx + 1 })
                        )}
                        <TextField
                          value={domain || ''}
                          onChange={(e) => {
                            clearGoodAtCategoryErrors('skillDomains', idx);
                            setReviewProfile((prev) => ({
                              ...prev,
                              structuredUserInfo: {
                                ...(prev.structuredUserInfo || {}),
                                skillDomains: (prev.structuredUserInfo?.skillDomains || []).map((item, i) => (
                                  i === idx ? e.target.value : item
                                ))
                              }
                            }));
                          }}
                          sx={REVIEW.field}
                          fullWidth
                          disabled={!isAccepted(`structuredUserInfo.skillDomains.${idx}`)}
                          hiddenLabel
                          error={Boolean(reviewFieldErrors[`structuredUserInfo.skillDomains.${idx}`])}
                          helperText={reviewFieldErrors[`structuredUserInfo.skillDomains.${idx}`]}
                          inputProps={{ maxLength: PROFILE_REVIEW_STRUCTURED_MAX.skillDomains }}
                        />
                      </Box>
                    );
                  })}
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => appendStructuredStringList('skillDomains')}
                    disabled={(reviewProfile.structuredUserInfo?.skillDomains || []).length >= MAX_GOOD_AT_PER_CATEGORY}
                    title={(reviewProfile.structuredUserInfo?.skillDomains || []).length >= MAX_GOOD_AT_PER_CATEGORY ? t('documentUpload.review.maxEntriesTitle', { max: MAX_GOOD_AT_PER_CATEGORY }) : undefined}
                    sx={{ alignSelf: 'flex-start', mt: 0.5, mb: 1 }}
                  >
                    {t('documentUpload.review.actions.addSkillDomain')}
                  </Button>
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
                  {(reviewProfile.structuredUserInfo?.domains || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.domains')}
                    </Typography>
                  )}
                  {sortStructuredIndices('structuredUserInfo.domains', (reviewProfile.structuredUserInfo?.domains || []).length).map((idx) => {
                    const domain = (reviewProfile.structuredUserInfo?.domains || [])[idx];
                    return (
                      <Box
                        key={idx}
                        {...reviewFieldAnchorProps(`structuredUserInfo.domains.${idx}`)}
                        sx={REVIEW.rowEntry}
                      >
                        {renderReviewEntryCheckbox(
                          `structuredUserInfo.domains.${idx}`,
                          t('documentUpload.review.labels.domain', { index: idx + 1 })
                        )}
                        <TextField
                          value={domain || ''}
                          onChange={(e) => {
                            clearGoodAtCategoryErrors('domains', idx);
                            setReviewProfile((prev) => ({
                              ...prev,
                              structuredUserInfo: {
                                ...(prev.structuredUserInfo || {}),
                                domains: (prev.structuredUserInfo?.domains || []).map((item, i) => (
                                  i === idx ? e.target.value : item
                                ))
                              }
                            }));
                          }}
                          sx={REVIEW.field}
                          fullWidth
                          disabled={!isAccepted(`structuredUserInfo.domains.${idx}`)}
                          hiddenLabel
                          error={Boolean(reviewFieldErrors[`structuredUserInfo.domains.${idx}`])}
                          helperText={reviewFieldErrors[`structuredUserInfo.domains.${idx}`]}
                          inputProps={{ maxLength: PROFILE_REVIEW_STRUCTURED_MAX.domains }}
                        />
                      </Box>
                    );
                  })}
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => appendStructuredStringList('domains')}
                    disabled={(reviewProfile.structuredUserInfo?.domains || []).length >= MAX_GOOD_AT_PER_CATEGORY}
                    title={(reviewProfile.structuredUserInfo?.domains || []).length >= MAX_GOOD_AT_PER_CATEGORY ? t('documentUpload.review.maxEntriesTitle', { max: MAX_GOOD_AT_PER_CATEGORY }) : undefined}
                    sx={{ alignSelf: 'flex-start', mt: 0.5, mb: 1 }}
                  >
                    {t('documentUpload.review.actions.addDomain')}
                  </Button>
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
                          sx={REVIEW.field}
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
                    disabled={(reviewProfile.structuredUserInfo?.keyResponsibilities || []).length >= MAX_GOOD_AT_PER_CATEGORY}
                    title={(reviewProfile.structuredUserInfo?.keyResponsibilities || []).length >= MAX_GOOD_AT_PER_CATEGORY ? t('documentUpload.review.maxEntriesTitle', { max: MAX_GOOD_AT_PER_CATEGORY }) : undefined}
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
                  {(reviewProfile.structuredUserInfo?.skills || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.skills')}
                    </Typography>
                  )}
                  {sortStructuredIndices('structuredUserInfo.skills', (reviewProfile.structuredUserInfo?.skills || []).length).map((idx) => {
                    const skill = (reviewProfile.structuredUserInfo?.skills || [])[idx];
                    return (
                      <Box
                        key={idx}
                        {...reviewFieldAnchorProps(`structuredUserInfo.skills.${idx}`)}
                        sx={REVIEW.rowEntry}
                      >
                        {renderReviewEntryCheckbox(
                          `structuredUserInfo.skills.${idx}`,
                          t('documentUpload.review.labels.skill', { index: idx + 1 })
                        )}
                        <TextField
                          value={skill.name || ''}
                          onChange={(e) => handleReviewSkillChange(idx, e.target.value)}
                          sx={REVIEW.field}
                          fullWidth
                          disabled={!isAccepted(`structuredUserInfo.skills.${idx}`)}
                          hiddenLabel
                          error={Boolean(reviewFieldErrors[`structuredUserInfo.skills.${idx}`])}
                          helperText={reviewFieldErrors[`structuredUserInfo.skills.${idx}`]}
                          inputProps={{ maxLength: PROFILE_REVIEW_STRUCTURED_MAX.skills }}
                        />
                      </Box>
                    );
                  })}
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={appendSkillRow}
                    disabled={(reviewProfile.structuredUserInfo?.skills || []).length >= MAX_GOOD_AT_PER_CATEGORY}
                    title={(reviewProfile.structuredUserInfo?.skills || []).length >= MAX_GOOD_AT_PER_CATEGORY ? t('documentUpload.review.maxEntriesTitle', { max: MAX_GOOD_AT_PER_CATEGORY }) : undefined}
                    sx={{ alignSelf: 'flex-start', mt: 0.5, mb: 1 }}
                  >
                    {t('documentUpload.review.actions.addSkill')}
                  </Button>
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
                  {(reviewProfile.structuredUserInfo?.skillsInDevelopment || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.skillsInDevelopment')}
                    </Typography>
                  )}
                  {sortStructuredIndices('structuredUserInfo.skillsInDevelopment', (reviewProfile.structuredUserInfo?.skillsInDevelopment || []).length).map((idx) => {
                    const skill = (reviewProfile.structuredUserInfo?.skillsInDevelopment || [])[idx];
                    return (
                      <Box
                        key={idx}
                        {...reviewFieldAnchorProps(`structuredUserInfo.skillsInDevelopment.${idx}`)}
                        sx={REVIEW.rowEntry}
                      >
                        {renderReviewEntryCheckbox(
                          `structuredUserInfo.skillsInDevelopment.${idx}`,
                          t('documentUpload.review.labels.learningGoal', { index: idx + 1 })
                        )}
                        <TextField
                          value={skill || ''}
                          onChange={(e) => {
                            clearGoodAtCategoryErrors('skillsInDevelopment', idx);
                            setReviewProfile((prev) => ({
                              ...prev,
                              structuredUserInfo: {
                                ...(prev.structuredUserInfo || {}),
                                skillsInDevelopment: (prev.structuredUserInfo?.skillsInDevelopment || []).map((item, i) => (
                                  i === idx ? e.target.value : item
                                ))
                              }
                            }));
                          }}
                          sx={REVIEW.field}
                          fullWidth
                          disabled={!isAccepted(`structuredUserInfo.skillsInDevelopment.${idx}`)}
                          hiddenLabel
                          error={Boolean(reviewFieldErrors[`structuredUserInfo.skillsInDevelopment.${idx}`])}
                          helperText={reviewFieldErrors[`structuredUserInfo.skillsInDevelopment.${idx}`]}
                          inputProps={{ maxLength: PROFILE_REVIEW_STRUCTURED_MAX.skillsInDevelopment }}
                        />
                      </Box>
                    );
                  })}
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => appendStructuredStringList('skillsInDevelopment')}
                    disabled={(reviewProfile.structuredUserInfo?.skillsInDevelopment || []).length >= MAX_GOOD_AT_PER_CATEGORY}
                    title={(reviewProfile.structuredUserInfo?.skillsInDevelopment || []).length >= MAX_GOOD_AT_PER_CATEGORY ? t('documentUpload.review.maxEntriesTitle', { max: MAX_GOOD_AT_PER_CATEGORY }) : undefined}
                    sx={{ alignSelf: 'flex-start', mt: 0.5, mb: 1 }}
                  >
                    {t('documentUpload.review.actions.addLearningGoal')}
                  </Button>
                  {renderGoodAtCategoryLimitNotice('skillsInDevelopment')}
                  </Box>
                </>
              )}
              {reviewStep === 4 && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('documentUpload.review.step4Intro')}
                  </Typography>
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
                        <option value="">{t('documentUpload.review.experience.notSpecified')}</option>
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
              {reviewStep === 5 && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('documentUpload.review.step5Intro')}
                  </Typography>
                  {inputQualityDiagnosisError && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      {t('documentUpload.review.step3QualityErrorPrefix')} {inputQualityDiagnosisError}
                    </Alert>
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
            </Box>
          ) : (
            <Typography>{t('documentUpload.review.noExtractedData')}</Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ flexShrink: 0 }}>
          <Button onClick={() => setReviewCancelConfirmOpen(true)} disabled={savingReviewActive}>
            {t('documentUpload.common.cancel')}
          </Button>
          {reviewStep > 2 && (
            <Button onClick={handleReviewBack} disabled={savingReviewActive}>
              {t('documentUpload.common.back')}
            </Button>
          )}
          {reviewStep >= 2 && reviewStep <= 4 ? (
            <Button
              onClick={() => void handleReviewContinue()}
              variant="contained"
              disabled={savingReviewActive || (reviewStep === 4 && inputQualityDiagnosisLoading)}
              startIcon={reviewStep === 4 && inputQualityDiagnosisLoading ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {reviewStep === 4 && inputQualityDiagnosisLoading
                ? t('documentUpload.review.analyzing')
                : t('documentUpload.common.continue')}
            </Button>
          ) : (
            <Button
              onClick={handleReviewSave}
              variant="contained"
              disabled={savingReviewActive || !step3SeniorityComplete}
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
          {t('documentUpload.review.cancelConfirm.title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="review-cancel-confirm-description">
            {t('documentUpload.review.cancelConfirm.description')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewCancelConfirmOpen(false)} variant="outlined">
            {t('documentUpload.review.cancelConfirm.stayCta')}
          </Button>
          <Button onClick={() => void handleReviewCancel()} variant="contained" color="error" disabled={savingReviewActive}>
            {t('documentUpload.review.cancelConfirm.discardCta')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DocumentUploadForm; 