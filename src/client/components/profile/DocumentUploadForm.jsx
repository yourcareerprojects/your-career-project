import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
  FormControlLabel,
  Divider
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Description as DescriptionIcon,
  Verified as VerifiedIcon,
  Pending as PendingIcon,
  Error as ErrorIcon,
  CloudUpload as CloudUploadIcon,
  Edit as EditIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { USER_IDENTITY_FIELDS } from '../../constants/userIdentityFields';
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

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

/** Max rows per list in “What are you good at?” (review + save). */
const MAX_GOOD_AT_PER_CATEGORY = 25;

const GOOD_AT_STEP3_META = [
  { arrayKey: 'skillDomains', titleKey: 'documentUpload.review.goodAtCategories.skillDomains', minRows: 3 },
  { arrayKey: 'domains', titleKey: 'documentUpload.review.goodAtCategories.domains', minRows: 3 },
  { arrayKey: 'keyResponsibilities', titleKey: 'documentUpload.review.goodAtCategories.keyResponsibilities', minRows: 4 },
  { arrayKey: 'skills', titleKey: 'documentUpload.review.goodAtCategories.skills', minRows: 3 },
  { arrayKey: 'skillsInDevelopment', titleKey: 'documentUpload.review.goodAtCategories.skillsInDevelopment', minRows: 3 }
];

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

/** True if this category has at least one non-empty row (trim), regardless of checkbox. */
function categoryHasAnyNonEmptyContent(structuredUserInfo, arrayKey) {
  const arr = structuredUserInfo?.[arrayKey];
  if (!Array.isArray(arr) || arr.length === 0) return false;
  if (arrayKey === 'skills') {
    return arr.some((s) => {
      const raw = typeof s === 'string' ? s : s?.name;
      return String(raw ?? '').trim().length > 0;
    });
  }
  return arr.some((v) => String(v ?? '').trim().length > 0);
}

function goodAtMultilineValue(structuredUserInfo, arrayKey) {
  const arr = structuredUserInfo?.[arrayKey];
  if (!Array.isArray(arr)) return '';
  if (arrayKey === 'skills') {
    return arr.map((s) => (typeof s === 'string' ? s : String(s?.name ?? ''))).join('\n');
  }
  return arr.map((v) => String(v ?? '')).join('\n');
}

/** Only checked rows with non-empty trimmed values; unchecked rows omitted. Capped at MAX_GOOD_AT_PER_CATEGORY. */
function buildStructuredGoodAtForSave(reviewProfile, acceptedFields) {
  const structuredUserInfo = reviewProfile?.structuredUserInfo || {};

  const pickStrings = (key) => {
    const items = structuredUserInfo[key] || [];
    const out = [];
    for (let i = 0; i < items.length && out.length < MAX_GOOD_AT_PER_CATEGORY; i += 1) {
      if (acceptedFields[`structuredUserInfo.${key}.${i}`] === false) continue;
      const v = String(items[i] ?? '').trim();
      if (v) out.push(v);
    }
    return out;
  };

  const items = structuredUserInfo.skills || [];
  const skillsOut = [];
  for (let i = 0; i < items.length && skillsOut.length < MAX_GOOD_AT_PER_CATEGORY; i += 1) {
    if (acceptedFields[`structuredUserInfo.skills.${i}`] === false) continue;
    const s = items[i];
    const raw = typeof s === 'string' ? s : s?.name;
    const v = String(raw ?? '').trim();
    if (v) skillsOut.push({ name: v });
  }

  return {
    skillDomains: pickStrings('skillDomains'),
    domains: pickStrings('domains'),
    keyResponsibilities: pickStrings('keyResponsibilities'),
    skillsInDevelopment: pickStrings('skillsInDevelopment'),
    skills: skillsOut
  };
}

/** Align review rows: fixed category column, shared input width (matches “What are you good at?”). */
const REVIEW = {
  rowStart: {
    display: 'flex',
    flexDirection: { xs: 'column', sm: 'row' },
    gap: 2,
    alignItems: { sm: 'flex-start' }
  },
  rowCenterSm: {
    display: 'flex',
    flexDirection: { xs: 'column', sm: 'row' },
    gap: 2,
    alignItems: { sm: 'center' }
  },
  categoryText: {
    flex: { xs: '1 1 auto', sm: '0 0 240px' },
    width: { xs: '100%', sm: '240px' },
    maxWidth: { sm: '240px' },
    minWidth: 0,
    fontWeight: 600,
    lineHeight: 1.35,
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    pr: { sm: 1 },
    pt: { sm: 0.5 }
  },
  categoryControl: {
    m: 0,
    flex: { xs: '1 1 auto', sm: '0 0 240px' },
    width: { xs: '100%', sm: '240px' },
    maxWidth: { sm: '240px' },
    minWidth: 0,
    alignItems: 'flex-start',
    '& .MuiFormControlLabel-label': {
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      lineHeight: 1.35,
      fontWeight: 600
    }
  },
  categoryControlCenterSm: {
    m: 0,
    flex: { xs: '1 1 auto', sm: '0 0 240px' },
    width: { xs: '100%', sm: '240px' },
    maxWidth: { sm: '240px' },
    minWidth: 0,
    alignItems: { xs: 'flex-start', sm: 'center' },
    '& .MuiFormControlLabel-label': {
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      lineHeight: 1.35,
      fontWeight: 600
    }
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
  showUploadControls = true
}) => {
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
  const [goodAtCategoriesForStep3, setGoodAtCategoriesForStep3] = useState([]);
  const [step3FollowUps, setStep3FollowUps] = useState([]);
  const [step3FollowUpAnswers, setStep3FollowUpAnswers] = useState({});
  const [inputQualityDiagnosisError, setInputQualityDiagnosisError] = useState(null);
  const [inputQualityDiagnosisLoading, setInputQualityDiagnosisLoading] = useState(false);
  const [acceptedFields, setAcceptedFields] = useState({});
  const [savingReview, setSavingReview] = useState(false);
  const [editingDocId, setEditingDocId] = useState(null);
  const [editingDescription, setEditingDescription] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState(null);
  const [pendingUploadedDocId, setPendingUploadedDocId] = useState(null);
  const [autoStartUpload, setAutoStartUpload] = useState(false);
  const [reviewCancelConfirmOpen, setReviewCancelConfirmOpen] = useState(false);

  /** Step 3: all follow-up prompts returned from quality diagnosis must have non-empty answers before save. */
  const step3FollowUpsAnsweredFully = useMemo(() => {
    if (reviewStep !== 3) return true;
    if (!step3FollowUps.length) return true;
    return step3FollowUps.every((d) => String(step3FollowUpAnswers[d.field] || '').trim().length > 0);
  }, [reviewStep, step3FollowUps, step3FollowUpAnswers]);

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

  const applyGoodAtFromMultiline = (arrayKey, text) => {
    const lines = String(text).split('\n').slice(0, MAX_GOOD_AT_PER_CATEGORY);
    setReviewProfile((prev) => {
      const sui = prev.structuredUserInfo || {};
      if (arrayKey === 'skills') {
        const skills = lines.map((line) => ({ name: line }));
        return { ...prev, structuredUserInfo: { ...sui, skills } };
      }
      return { ...prev, structuredUserInfo: { ...sui, [arrayKey]: lines } };
    });
    const prefix = `structuredUserInfo.${arrayKey}.`;
    setAcceptedFields((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (k.startsWith(prefix)) delete next[k];
      });
      lines.forEach((_, i) => {
        next[`${prefix}${i}`] = true;
      });
      return next;
    });
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
        throw new Error(errorData.message || 'Upload failed');
      }

      const data = await response.json();
      onDocumentsUpdate(normalizeDocuments([...documents, data.document]));
      setPendingUploadedDocId(data?.document?.id || data?.document?._id || null);
      
      // Handle extraction result if present
      if (enableExtractionReview && (data.extractedProfileData || data.extractionStatus)) {
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
          setReviewProfile(ensureReviewProfileShape(normalizedData));
          setAcceptedFields(buildAcceptedDefaults(normalizedData));
          setGoodAtCategoriesForStep3([]);
          setStep3FollowUps([]);
          setStep3FollowUpAnswers({});
          setInputQualityDiagnosisError(null);
          setInputQualityDiagnosisLoading(false);
          setReviewStep(2);
          
          // Only show review dialog if extraction was successful or partial
          if (data.extractionStatus === 'success' || data.extractionStatus === 'partial') {
            setReviewDialogOpen(true);
          }
        } else {
          setCvExtractLocalization(null);
        }
        
        // Show extraction status message even if no data extracted
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
    uiLangCode
  ]);

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
    try {
      const profileForSave = applyStep3FollowUpAnswersToReviewProfile(
        reviewProfile,
        step3FollowUps,
        step3FollowUpAnswers
      );
      const structuredGoodAt = buildStructuredGoodAtForSave(profileForSave, acceptedFields);
      const payload = {
        structuredUserInfo: {
          skillDomains: structuredGoodAt.skillDomains,
          skills: structuredGoodAt.skills,
          domains: structuredGoodAt.domains,
          keyResponsibilities: structuredGoodAt.keyResponsibilities,
          skillsInDevelopment: structuredGoodAt.skillsInDevelopment
        },
        userIdentity: profileForSave.userIdentity || {},
        seniority: profileForSave.seniority || {},
        __reviewOptions: { mode: reviewSaveMode },
        ...(cvExtractLocalization && typeof cvExtractLocalization === 'object'
          ? { __cvExtractLocalization: cvExtractLocalization }
          : {})
      };

      await onExtractedProfileReview(payload);
      setReviewDialogOpen(false);
      setExtractedProfileData(null);
      setCvExtractLocalization(null);
      setExtractionStatus(null);
      setExtractionMessage(null);
      setExtractionMessageKey(null);
      setReviewProfile({});
      setAcceptedFields({});
      setGoodAtCategoriesForStep3([]);
      setStep3FollowUps([]);
      setStep3FollowUpAnswers({});
      setInputQualityDiagnosisError(null);
      setInputQualityDiagnosisLoading(false);
      setPendingUploadedDocId(null);
      // Clear any previous errors
      setUploadError('');
    } catch (error) {
      console.error('Error saving reviewed profile data:', error);
      setUploadError(error.message || t('documentUpload.errors.saveProfileFailed'));
    } finally {
      setSavingReview(false);
    }
  };

  const handleGoToNeedContextStep = async () => {
    const sui = reviewProfile.structuredUserInfo || {};
    const keys = GOOD_AT_STEP3_META
      .map((f) => f.arrayKey)
      .filter((k) => !categoryHasAnyNonEmptyContent(sui, k));
    setGoodAtCategoriesForStep3(keys);

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
    setReviewStep(3);
  };

  // Handler for canceling review (after explicit confirmation in the UI)
  const handleReviewCancel = async () => {
    setReviewCancelConfirmOpen(false);
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
    setGoodAtCategoriesForStep3([]);
    setStep3FollowUps([]);
    setStep3FollowUpAnswers({});
    setInputQualityDiagnosisError(null);
    setInputQualityDiagnosisLoading(false);
    setReviewStep(2);
    setPendingUploadedDocId(null);
  };

  // Handler for editing extracted skills list items.
  const handleReviewSkillChange = (idx, value) => {
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

  const getStatusIcon = (status) => {
    switch (status) {
      case 'verified':
        return <VerifiedIcon color="success" />;
      case 'pending':
        return <PendingIcon color="warning" />;
      case 'rejected':
        return <ErrorIcon color="error" />;
      default:
        return null;
    }
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

  // Helper to normalize document IDs
  const normalizeDocuments = (docs) =>
    docs.map(doc => ({
      ...doc,
      id: doc.id || doc._id
    }));

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
                    <IconButton size="small" onClick={() => { setEditingDocId(doc.id); setEditingDescription(doc.description || ''); }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Box>
                )
              }
              secondary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <Chip
                    size="small"
                    label={doc.documentType || doc.type}
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
            <ListItemSecondaryAction>
              {getStatusIcon(doc.status)}
              <IconButton
                edge="end"
                onClick={() => handleDownload(doc.id, doc.originalName)}
                sx={{ ml: 1 }}
              >
                <DownloadIcon />
              </IconButton>
              <IconButton
                edge="end"
                onClick={() => { setDocToDelete(doc); setDeleteDialogOpen(true); }}
                sx={{ ml: 1 }}
                disabled={uploading}
              >
                <DeleteIcon />
              </IconButton>
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
                accept=".pdf,.doc,.docx"
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
                  <option value="resume">{t('documentUpload.uploadDialog.documentTypes.resume')}</option>
                  <option value="certificate">{t('documentUpload.uploadDialog.documentTypes.certificate')}</option>
                  <option value="transcript">{t('documentUpload.uploadDialog.documentTypes.transcript')}</option>
                  <option value="portfolio">{t('documentUpload.uploadDialog.documentTypes.portfolio')}</option>
                  <option value="other">{t('documentUpload.uploadDialog.documentTypes.other')}</option>
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
        disableScrollLock
        disableEnforceFocus
        scroll="paper"
      >
        <DialogTitle>
          {reviewStep === 2 ? t('documentUpload.review.step2Title') : t('documentUpload.review.step3Title')}
          {extractionStatus && (
            <Chip 
              label={extractionStatus === 'success' ? t('documentUpload.review.status.success') : extractionStatus === 'partial' ? t('documentUpload.review.status.partial') : t('documentUpload.review.status.failed')}
              color={extractionStatus === 'success' ? 'success' : extractionStatus === 'partial' ? 'warning' : 'error'}
              size="small"
              sx={{ ml: 2 }}
            />
          )}
        </DialogTitle>
        <DialogContent>
          {(extractionMessageKey || extractionMessage) && (
            <Alert 
              severity={extractionStatus === 'success' ? 'success' : extractionStatus === 'partial' ? 'warning' : 'info'}
              sx={{ mb: 2 }}
            >
              {extractionMessageKey ? t(extractionMessageKey) : extractionMessage}
            </Alert>
          )}
          {extractedProfileData ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              {reviewStep === 2 ? (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('documentUpload.review.step2Intro')}
                  </Typography>
                  <Divider sx={{ mb: 2 }} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>{t('documentUpload.review.sections.identity')}</Typography>
                  {USER_IDENTITY_FIELDS.map(({ key, questionKey }) => (
                    <Box key={key} sx={{ ...REVIEW.rowStart, mb: 2 }}>
                      <Typography variant="body2" sx={REVIEW.categoryText}>
                        {t(questionKey)}
                      </Typography>
                      <TextField
                        value={reviewProfile.userIdentity?.[key] || ''}
                        onChange={(e) => setReviewProfile((prev) => ({
                          ...prev,
                          userIdentity: {
                            ...(prev.userIdentity || {}),
                            [key]: e.target.value
                          }
                        }))}
                        sx={REVIEW.field}
                        fullWidth
                        multiline
                        minRows={4}
                        hiddenLabel
                      />
                    </Box>
                  ))}
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>{t('documentUpload.review.sections.goodAt')}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    {t('documentUpload.review.goodAtLimit', { max: MAX_GOOD_AT_PER_CATEGORY })}
                  </Typography>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mt: 1 }}>{t('documentUpload.review.goodAtCategories.skillDomains')}</Typography>
                  {(reviewProfile.structuredUserInfo?.skillDomains || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.skillDomains')}
                    </Typography>
                  )}
                  {sortStructuredIndices('structuredUserInfo.skillDomains', (reviewProfile.structuredUserInfo?.skillDomains || []).length).map((idx) => {
                    const domain = (reviewProfile.structuredUserInfo?.skillDomains || [])[idx];
                    return (
                      <Box key={idx} sx={{ ...REVIEW.rowCenterSm, mb: 1.5 }}>
                        <FormControlLabel
                          sx={REVIEW.categoryControlCenterSm}
                          control={<Checkbox checked={isAccepted(`structuredUserInfo.skillDomains.${idx}`)} onChange={() => toggleAccepted(`structuredUserInfo.skillDomains.${idx}`)} />}
                          label={t('documentUpload.review.labels.skillDomain', { index: idx + 1 })}
                        />
                        <TextField
                          value={domain || ''}
                          onChange={e => setReviewProfile(prev => ({
                            ...prev,
                            structuredUserInfo: {
                              ...(prev.structuredUserInfo || {}),
                              skillDomains: (prev.structuredUserInfo?.skillDomains || []).map((item, i) => (i === idx ? e.target.value : item))
                            }
                          }))}
                          sx={REVIEW.field}
                          fullWidth
                          disabled={!isAccepted(`structuredUserInfo.skillDomains.${idx}`)}
                          hiddenLabel
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
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mt: 1 }}>{t('documentUpload.review.goodAtCategories.domains')}</Typography>
                  {(reviewProfile.structuredUserInfo?.domains || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.domains')}
                    </Typography>
                  )}
                  {sortStructuredIndices('structuredUserInfo.domains', (reviewProfile.structuredUserInfo?.domains || []).length).map((idx) => {
                    const domain = (reviewProfile.structuredUserInfo?.domains || [])[idx];
                    return (
                      <Box key={idx} sx={{ ...REVIEW.rowCenterSm, mb: 1.5 }}>
                        <FormControlLabel
                          sx={REVIEW.categoryControlCenterSm}
                          control={<Checkbox checked={isAccepted(`structuredUserInfo.domains.${idx}`)} onChange={() => toggleAccepted(`structuredUserInfo.domains.${idx}`)} />}
                          label={t('documentUpload.review.labels.domain', { index: idx + 1 })}
                        />
                        <TextField
                          value={domain || ''}
                          onChange={e => setReviewProfile(prev => ({
                            ...prev,
                            structuredUserInfo: {
                              ...(prev.structuredUserInfo || {}),
                              domains: (prev.structuredUserInfo?.domains || []).map((item, i) => (i === idx ? e.target.value : item))
                            }
                          }))}
                          sx={REVIEW.field}
                          fullWidth
                          disabled={!isAccepted(`structuredUserInfo.domains.${idx}`)}
                          hiddenLabel
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
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mt: 2 }}>{t('documentUpload.review.goodAtCategories.keyResponsibilities')}</Typography>
                  {(reviewProfile.structuredUserInfo?.keyResponsibilities || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.keyResponsibilities')}
                    </Typography>
                  )}
                  {sortStructuredIndices('structuredUserInfo.keyResponsibilities', (reviewProfile.structuredUserInfo?.keyResponsibilities || []).length).map((idx) => {
                    const resp = (reviewProfile.structuredUserInfo?.keyResponsibilities || [])[idx];
                    return (
                      <Box key={idx} sx={{ ...REVIEW.rowStart, mb: 1.5 }}>
                        <FormControlLabel
                          sx={{ ...REVIEW.categoryControl, pt: { sm: 1 } }}
                          control={<Checkbox checked={isAccepted(`structuredUserInfo.keyResponsibilities.${idx}`)} onChange={() => toggleAccepted(`structuredUserInfo.keyResponsibilities.${idx}`)} />}
                          label={t('documentUpload.review.labels.responsibility', { index: idx + 1 })}
                        />
                        <TextField
                          value={resp || ''}
                          onChange={e => setReviewProfile(prev => ({
                            ...prev,
                            structuredUserInfo: {
                              ...(prev.structuredUserInfo || {}),
                              keyResponsibilities: (prev.structuredUserInfo?.keyResponsibilities || []).map((item, i) => (i === idx ? e.target.value : item))
                            }
                          }))}
                          sx={REVIEW.field}
                          fullWidth
                          multiline
                          minRows={3}
                          disabled={!isAccepted(`structuredUserInfo.keyResponsibilities.${idx}`)}
                          hiddenLabel
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
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mt: 2 }}>{t('documentUpload.review.goodAtCategories.skills')}</Typography>
                  {(reviewProfile.structuredUserInfo?.skills || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.skills')}
                    </Typography>
                  )}
                  {sortStructuredIndices('structuredUserInfo.skills', (reviewProfile.structuredUserInfo?.skills || []).length).map((idx) => {
                    const skill = (reviewProfile.structuredUserInfo?.skills || [])[idx];
                    return (
                      <Box key={idx} sx={{ ...REVIEW.rowCenterSm, mb: 1.5 }}>
                        <FormControlLabel
                          sx={REVIEW.categoryControlCenterSm}
                          control={<Checkbox checked={isAccepted(`structuredUserInfo.skills.${idx}`)} onChange={() => toggleAccepted(`structuredUserInfo.skills.${idx}`)} />}
                          label={t('documentUpload.review.labels.skill', { index: idx + 1 })}
                        />
                        <TextField
                          value={skill.name || ''}
                          onChange={e => handleReviewSkillChange(idx, e.target.value)}
                          sx={REVIEW.field}
                          fullWidth
                          disabled={!isAccepted(`structuredUserInfo.skills.${idx}`)}
                          hiddenLabel
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
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mt: 2 }}>{t('documentUpload.review.goodAtCategories.skillsInDevelopment')}</Typography>
                  {(reviewProfile.structuredUserInfo?.skillsInDevelopment || []).length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                      {t('documentUpload.review.emptyMessages.skillsInDevelopment')}
                    </Typography>
                  )}
                  {sortStructuredIndices('structuredUserInfo.skillsInDevelopment', (reviewProfile.structuredUserInfo?.skillsInDevelopment || []).length).map((idx) => {
                    const skill = (reviewProfile.structuredUserInfo?.skillsInDevelopment || [])[idx];
                    return (
                      <Box key={idx} sx={{ ...REVIEW.rowCenterSm, mb: 1.5 }}>
                        <FormControlLabel
                          sx={REVIEW.categoryControlCenterSm}
                          control={<Checkbox checked={isAccepted(`structuredUserInfo.skillsInDevelopment.${idx}`)} onChange={() => toggleAccepted(`structuredUserInfo.skillsInDevelopment.${idx}`)} />}
                          label={t('documentUpload.review.labels.learningGoal', { index: idx + 1 })}
                        />
                        <TextField
                          value={skill || ''}
                          onChange={e => setReviewProfile(prev => ({
                            ...prev,
                            structuredUserInfo: {
                              ...(prev.structuredUserInfo || {}),
                              skillsInDevelopment: (prev.structuredUserInfo?.skillsInDevelopment || []).map((item, i) => (i === idx ? e.target.value : item))
                            }
                          }))}
                          sx={REVIEW.field}
                          fullWidth
                          disabled={!isAccepted(`structuredUserInfo.skillsInDevelopment.${idx}`)}
                          hiddenLabel
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
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 2 }}>{t('documentUpload.review.sections.experience')}</Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Box sx={REVIEW.rowCenterSm}>
                      <Typography variant="body2" sx={REVIEW.categoryText}>
                        {t('documentUpload.review.experience.currentEmploymentStatus')}
                      </Typography>
                      <TextField
                        select
                        fullWidth
                        hiddenLabel
                        sx={REVIEW.field}
                        value={reviewProfile.seniority?.currentStatus || ''}
                        onChange={(e) => setReviewProfile((prev) => ({
                          ...prev,
                          seniority: { ...(prev.seniority || {}), currentStatus: e.target.value }
                        }))}
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
                    <Box sx={REVIEW.rowCenterSm}>
                      <Typography variant="body2" sx={REVIEW.categoryText}>
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
                    <Box sx={REVIEW.rowCenterSm}>
                      <Typography variant="body2" sx={REVIEW.categoryText}>
                        {t('documentUpload.review.experience.highestEducationalDegree')}
                      </Typography>
                      <TextField
                        select
                        fullWidth
                        hiddenLabel
                        sx={REVIEW.field}
                        value={reviewProfile.seniority?.highestDegree || ''}
                        onChange={(e) => setReviewProfile((prev) => ({
                          ...prev,
                          seniority: { ...(prev.seniority || {}), highestDegree: e.target.value }
                        }))}
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
                    <Box sx={REVIEW.rowCenterSm}>
                      <Typography variant="body2" sx={REVIEW.categoryText}>
                        {t('documentUpload.review.experience.mostSeniorWorkExperience')}
                      </Typography>
                      <TextField
                        select
                        fullWidth
                        hiddenLabel
                        sx={REVIEW.field}
                        value={reviewProfile.seniority?.mostSeniorWorkExperience || ''}
                        onChange={(e) => setReviewProfile((prev) => ({
                          ...prev,
                          seniority: { ...(prev.seniority || {}), mostSeniorWorkExperience: e.target.value }
                        }))}
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
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('documentUpload.review.step3Intro')}
                  </Typography>
                  {inputQualityDiagnosisError && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      {t('documentUpload.review.step3QualityErrorPrefix')} {inputQualityDiagnosisError}
                    </Alert>
                  )}
                  {step3FollowUps.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                      {step3FollowUps.map((d) => (
                        <Box key={d.field} sx={{ mb: 2.5 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
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
                            onChange={(e) =>
                              setStep3FollowUpAnswers((prev) => ({
                                ...prev,
                                [d.field]: e.target.value
                              }))
                            }
                            inputProps={{ 'aria-required': true }}
                          />
                        </Box>
                      ))}
                    </Box>
                  )}
                  {goodAtCategoriesForStep3.length > 0 && (
                    <>
                      <Divider sx={{ my: 2 }} />
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                        {t('documentUpload.review.strengthsTitle')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {t('documentUpload.review.strengthsDescription', { max: MAX_GOOD_AT_PER_CATEGORY })}
                      </Typography>
                      {goodAtCategoriesForStep3.map((arrayKey) => {
                        const meta = GOOD_AT_STEP3_META.find((f) => f.arrayKey === arrayKey);
                        if (!meta) return null;
                        return (
                          <Box key={arrayKey} sx={{ mb: 2 }}>
                            <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                              <Chip label={t('documentUpload.review.emptyCategoryChip')} color="default" size="small" sx={{ fontWeight: 600 }} />
                            </Box>
                            <Box sx={REVIEW.rowStart}>
                              <Typography variant="body2" sx={REVIEW.categoryText}>
                                {t(meta.titleKey)}
                              </Typography>
                              <TextField
                                value={goodAtMultilineValue(reviewProfile.structuredUserInfo || {}, arrayKey)}
                                onChange={(e) => applyGoodAtFromMultiline(arrayKey, e.target.value)}
                                sx={REVIEW.field}
                                fullWidth
                                multiline
                                minRows={meta.minRows}
                                hiddenLabel
                                placeholder={t('documentUpload.review.goodAtPlaceholder', { max: MAX_GOOD_AT_PER_CATEGORY })}
                              />
                            </Box>
                          </Box>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </Box>
          ) : (
            <Typography>{t('documentUpload.review.noExtractedData')}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewCancelConfirmOpen(true)} disabled={savingReview}>
            {t('documentUpload.common.cancel')}
          </Button>
          {reviewStep === 3 && (
            <Button
              onClick={() => {
                setGoodAtCategoriesForStep3([]);
                setStep3FollowUps([]);
                setStep3FollowUpAnswers({});
                setInputQualityDiagnosisError(null);
                setInputQualityDiagnosisLoading(false);
                setReviewStep(2);
              }}
              disabled={savingReview}
            >
              {t('documentUpload.common.back')}
            </Button>
          )}
          {reviewStep === 2 ? (
            <Button
              onClick={handleGoToNeedContextStep}
              variant="contained"
              disabled={savingReview || inputQualityDiagnosisLoading}
              startIcon={inputQualityDiagnosisLoading ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {inputQualityDiagnosisLoading ? t('documentUpload.review.analyzing') : t('documentUpload.common.continue')}
            </Button>
          ) : (
            <Button
              onClick={handleReviewSave}
              variant="contained"
              disabled={savingReview || !step3FollowUpsAnsweredFully}
              startIcon={savingReview ? <CircularProgress size={16} /> : null}
            >
              {savingReview ? t('documentUpload.review.saving') : t('documentUpload.review.saveToProfileCta')}
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
          <Button onClick={() => void handleReviewCancel()} variant="contained" color="error" disabled={savingReview}>
            {t('documentUpload.review.cancelConfirm.discardCta')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DocumentUploadForm; 