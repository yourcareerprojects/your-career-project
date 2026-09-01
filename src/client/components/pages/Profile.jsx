import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, Suspense, lazy } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Paper,
  Button,
  IconButton,
  CircularProgress,
  Alert,
  Avatar,
  Grid,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  MenuItem,
  Select,
  Divider,
} from '@mui/material';
import {
  ProfileCompletionTooltipContent,
  getCompletionChipColor,
} from '../profile/ProfileCompletion';
import LoginSecuritySection from '../profile/LoginSecuritySection';
import PersonIcon from '@mui/icons-material/Person';
import PsychologyIcon from '@mui/icons-material/Psychology';
import WorkHistoryIcon from '@mui/icons-material/WorkHistory';
import DescriptionIcon from '@mui/icons-material/Description';
import EditIcon from '@mui/icons-material/Edit';
import LockIcon from '@mui/icons-material/Lock';
import PuzzlePieceIcon from '@mui/icons-material/Extension';
import AssessmentIcon from '@mui/icons-material/Assessment';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SeniorityForm from '../profile/SeniorityForm';
import ProfileIdentityFieldEditor from '../profile/ProfileIdentityFieldEditor';
import ProfileIdentityCoachingEditor from '../profile/ProfileIdentityCoachingEditor';
import ProfilePictureEditor from '../profile/ProfilePictureEditor';
import ProfileDocumentList from '../profile/ProfileDocumentList';
import ProfilePageActionBar from '../profile/ProfilePageActionBar';
import ProfileSnapTarget from '../profile/ProfileSnapTarget';
import { PAGE_TITLE_SX } from '../common/PageHeader';
import {
  buildReviewSaveUserMessage,
  saveExtractedProfileReview,
  fetchProfileNarrativesStatus,
  PROFILE_NARRATIVE_POLL_MAX_ATTEMPTS,
} from '../../utils/profileReviewSaveFlow';
import { resolveNarrativePendingFromProfileResponse } from '../../utils/profileNarrativePolling';
import { clearCvReviewDraft } from '../../utils/cvReviewDraftStorage';

const DocumentUploadForm = lazy(() => import('../profile/DocumentUploadForm'));
import { useAuth } from '../../contexts/AuthContext';
import { USER_IDENTITY_FIELDS } from '../../constants/userIdentityFields';
import { normalizeStructuredListItemLabel } from '../../../constants/structuredListItemLabel';
import { MIN_PROFILE_COMPLETION_REQUIRED } from '../../constants/profileCompletion';
import { hasActiveCareerSimulationSession } from '../../utils/simulationPersistence';
import { resolveCareerSimulationPath } from '../../hooks/useAppNavigation';
import { queryClient } from '../../queryClient';
import {
  seedProfileCompletionQueryData,
  profileCompletionQueryKey,
  fetchProfileCompletion,
  getProfileFullQueryKeyFull,
  readFullProfileCacheEntry,
  getProfilePageStateFromCache,
  isReviewSaveProfileSeed,
  fetchFullProfile,
  refetchFullProfileIntoCache,
  refreshSeededFullProfileInBackground,
  baseUILanguage,
  PROFILE_QUERY_STALE_TIME_MS,
  PROFILE_QUERY_CACHE_TIME_MS,
  useLastSimulationQuery,
  invalidateFullProfileQuery,
  invalidateProfileCompletionQuery
} from '../../hooks/useProfileQueries';
import { invalidateCareerIdentityQueries } from '../../hooks/useCareerIdentityQueries';
import { CURRENT_EMPLOYMENT_STATUS_OPTIONS } from '../../../constants/currentEmploymentStatus';
import { getProfileStructuredListMaxItems } from '../../../constants/profileReviewFieldLimits';
import { normalizeIndustryDomains } from '../../../constants/industries';
import { PROFILE_REVIEW_USER_IDENTITY_MAX } from '../../utils/validateReviewProfilePayload';
import IndustrySectorPicker from '../profile/IndustrySectorPicker';
import SkillDomainPicker from '../profile/SkillDomainPicker';
import SkillPicker from '../profile/SkillPicker';
import IndustrySectorChip from '../profile/IndustrySectorChip';
import SkillChip from '../profile/SkillChip';
import SkillDomainChip from '../profile/SkillDomainChip';
import { HIGHEST_DEGREE_OPTIONS, highestDegreeLabel } from '../../../constants/highestDegree';
import { fireProfileCreatedConfetti } from '../../utils/profileCreatedConfetti';
import { shouldCelebrateProfileSave } from '../../utils/profileSaveCelebration';
import { MOST_SENIOR_OPTIONS } from '../../../constants/senioritySelectOptions';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import {
  profileSectionScrollMarginSx,
  scheduleProfileSectionScroll,
  scrollProfileSectionIntoView,
} from '../../utils/profileSectionScroll';
import ProfileSectionViewCarousel from '../profile/ProfileSectionViewCarousel';
import ProfileBulletList from '../profile/ProfileBulletList';
import {
  PROFILE_DISPLAY_MODE,
  getWhoAreYouNarratives,
  hasIdentityNarrative,
  isIdentityFieldNarrativeOutOfDate,
  parseIdentityFieldToBullets,
  parseIdentityFieldForEdit,
  formatIdentityFieldFromEdit,
  identityFieldDraftHasContent,
  identitySectionKey,
  readProfileSectionDisplayModes,
  persistProfileSectionDisplayMode,
  resolveSectionDisplayMode,
} from '../../utils/profileSectionDisplay';

function invalidateProfileCachesAfterMutation() {
  invalidateFullProfileQuery();
  invalidateProfileCompletionQuery();
  invalidateCareerIdentityQueries({ watchExploration: true });
}

const PROFILE_CHIP_GAP = 1.25;

const STRUCTURED_GOOD_AT_SECTIONS = [
  {
    uiKey: 'strengths',
    arrayKey: 'skillDomains',
    editorType: 'skillDomains',
    maxItems: getProfileStructuredListMaxItems('skillDomains'),
    titleKey: 'profilePage.structuredInfo.strengths.title',
    addLabelKey: 'profilePage.structuredInfo.strengths.addCta',
    emptyKey: 'profilePage.structuredInfo.strengths.empty',
  },
  {
    uiKey: 'industrySectors',
    arrayKey: 'domains',
    editorType: 'domains',
    maxItems: getProfileStructuredListMaxItems('domains'),
    titleKey: 'profilePage.structuredInfo.industrySectors.title',
    addLabelKey: 'profilePage.structuredInfo.industrySectors.addCta',
    emptyKey: 'profilePage.structuredInfo.industrySectors.empty',
  },
  {
    uiKey: 'responsibilities',
    arrayKey: 'keyResponsibilities',
    editorType: 'textList',
    maxItems: getProfileStructuredListMaxItems('keyResponsibilities'),
    titleKey: 'profilePage.structuredInfo.responsibilities.title',
    addLabelKey: 'profilePage.structuredInfo.responsibilities.addCta',
    emptyKey: 'profilePage.structuredInfo.responsibilities.empty',
    multiline: true,
    minRows: 3,
  },
  {
    uiKey: 'skills',
    arrayKey: 'skills',
    editorType: 'skills',
    maxItems: getProfileStructuredListMaxItems('skills'),
    titleKey: 'profilePage.structuredInfo.skills.title',
    addLabelKey: 'profilePage.structuredInfo.skills.addCta',
    emptyKey: 'profilePage.structuredInfo.skills.empty',
  },
  {
    uiKey: 'learningGoals',
    arrayKey: 'skillsInDevelopment',
    editorType: 'skillsInDevelopment',
    maxItems: getProfileStructuredListMaxItems('skillsInDevelopment'),
    titleKey: 'profilePage.structuredInfo.learningGoals.title',
    addLabelKey: 'profilePage.structuredInfo.learningGoals.addCta',
    emptyKey: 'profilePage.structuredInfo.learningGoals.empty',
  },
];

function normalizeStructuredList(items, max) {
  const next = [];
  for (const item of items || []) {
    const value = String(item || '').trim();
    if (!value) continue;
    if (next.includes(value)) continue;
    next.push(value);
    if (next.length >= max) break;
  }
  return next;
}

const Profile = ({
  showCareerSimulationInputs = true,
  showLoginSecuritySection = true,
}) => {
  const { t, i18n } = useTranslation('onboarding');
  const location = useLocation();
  const navigate = useNavigate();
  const currentLang = baseUILanguage();
  const profileFullKey = useMemo(() => getProfileFullQueryKeyFull(currentLang), [currentLang]);
  const { user, updateUser } = useAuth();
  const canEditProfile = Boolean(user?.isVerified || user?.emailVerified);
  const initialPageStateRef = useRef(null);
  if (initialPageStateRef.current == null) {
    initialPageStateRef.current = getProfilePageStateFromCache(baseUILanguage());
  }
  const [profile, setProfile] = useState(initialPageStateRef.current.profile);
  const [completion, setCompletion] = useState(initialPageStateRef.current.completion);
  /** Incomplete profiles must use /profile/fill — no per-field edits on this page. */
  const canEditProfileFields =
    canEditProfile
    && Number(completion?.overall || 0) >= MIN_PROFILE_COMPLETION_REQUIRED;
  const [loading, setLoading] = useState(initialPageStateRef.current.loading);
  const [error, setError] = useState(null);
  const [editSection, setEditSection] = useState(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [editCareerInputs, setEditCareerInputs] = useState(false);
  const [careerInputsDraft, setCareerInputsDraft] = useState(null);
  const [careerInputsLoading, setCareerInputsLoading] = useState(false);
  const [careerInputsError, setCareerInputsError] = useState(null);
  const [chipInputs, setChipInputs] = useState({});
  const [editingChip, setEditingChip] = useState(null);
  const [profilePictureDialogOpen, setProfilePictureDialogOpen] = useState(false);
  const [profilePictureKey, setProfilePictureKey] = useState(0);
  const [loginSecurityDialogOpen, setLoginSecurityDialogOpen] = useState(false);
  const [loginSecurity, setLoginSecurity] = useState({
    data: null,
    loading: true,
    error: null
  });
  const [editIdentityField, setEditIdentityField] = useState(null);
  const [identityFieldDraft, setIdentityFieldDraft] = useState(null);
  const [identityFieldLoading, setIdentityFieldLoading] = useState(false);
  const [identityFieldError, setIdentityFieldError] = useState(null);
  const [identityFieldCoachingActive, setIdentityFieldCoachingActive] = useState(false);
  const [identityCoachingRestartKey, setIdentityCoachingRestartKey] = useState(0);
  const [identityCoachingStructuredPatch, setIdentityCoachingStructuredPatch] = useState(null);
  /** When true, the next identity save came from coaching/restart and should regenerate the AI summary. */
  const [identitySaveShouldRegenerateNarrative, setIdentitySaveShouldRegenerateNarrative] = useState(false);
  const [whoAreYouNarrativeRegenLoading, setWhoAreYouNarrativeRegenLoading] = useState(false);
  const [editStructuredCategory, setEditStructuredCategory] = useState(null);
  const [structuredCategoryDraft, setStructuredCategoryDraft] = useState([]);
  const [structuredInfoLoading, setStructuredInfoLoading] = useState(false);
  const [structuredInfoError, setStructuredInfoError] = useState(null);
  const [profileNameDialogOpen, setProfileNameDialogOpen] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profileNameLoading, setProfileNameLoading] = useState(false);
  const [profileNameError, setProfileNameError] = useState(null);
  const [documentReviewDocId, setDocumentReviewDocId] = useState(null);
  const [savingCvReview, setSavingCvReview] = useState(false);
  const [cvReviewError, setCvReviewError] = useState(null);
  const prevProfileUiLangRef = useRef(null);
  /** Prevents double-fire (Strict Mode) and ties celebration to one history entry. */
  const profileCelebrationHandledKeyRef = useRef(null);
  const userIdentitySectionRef = useRef(null);
  const identityFieldSectionRefs = useRef({});
  const structuredInfoSectionRef = useRef(null);
  const structuredCategorySectionRefs = useRef({});
  const structuredInfoItemInputRefs = useRef({});
  const senioritySectionRef = useRef(null);
  const careerInputsSectionRef = useRef(null);
  const [structuredInfoFocusTarget, setStructuredInfoFocusTarget] = useState(null);
  const [sectionScrollTarget, setSectionScrollTarget] = useState(null);
  const profileOwnerId = String(user?.id || user?._id || '').trim();
  const [sectionDisplayModes, setSectionDisplayModes] = useState(() => (
    readProfileSectionDisplayModes(profileOwnerId)
  ));
  const [pendingNarrativeFields, setPendingNarrativeFields] = useState([]);
  const updatePendingNarrativeFields = useCallback((next) => {
    const nextPending = Array.isArray(next) ? next : [];
    setPendingNarrativeFields((prev) => {
      if (prev.length === nextPending.length && prev.every((value, index) => value === nextPending[index])) {
        return prev;
      }
      return nextPending;
    });
  }, []);
  const narrativePollTimerRef = useRef(null);
  const narrativePollActiveRef = useRef(false);
  const narrativeStatusBootstrapDoneRef = useRef(false);
  const isProfileReadOnlyView = !editSection && !editIdentityField && !editStructuredCategory && !editCareerInputs;
  const hasSimulationSession = hasActiveCareerSimulationSession();
  const lastSimulationQuery = useLastSimulationQuery({
    enabled:
      !!user &&
      !!completion &&
      Number(completion?.overall || 0) >= MIN_PROFILE_COMPLETION_REQUIRED &&
      !hasSimulationSession
  });
  const goToSimulationHref = useMemo(
    () =>
      resolveCareerSimulationPath({
        hasSimulationSession,
        isAuthenticated: !!user,
        queryEnabled:
          !!user &&
          !!completion &&
          Number(completion?.overall || 0) >= MIN_PROFILE_COMPLETION_REQUIRED &&
          !hasSimulationSession,
        lastSimQuery: lastSimulationQuery,
      }),
    [hasSimulationSession, user, completion, lastSimulationQuery]
  );
  const currentEmploymentStatusOptionsByValue = useMemo(
    () => Object.fromEntries(CURRENT_EMPLOYMENT_STATUS_OPTIONS.map((option) => [option.value, option.label])),
    []
  );
  const mostSeniorOptionsByValue = useMemo(
    () => Object.fromEntries(MOST_SENIOR_OPTIONS.map((option) => [option.value, option.label])),
    []
  );
  const getRawItems = (value) => {
    const raw = Array.isArray(value)
      ? value
      : (value && typeof value === 'object' && Array.isArray(value.raw_items) ? value.raw_items : []);
    return raw.map((item) => normalizeStructuredListItemLabel(item, currentLang)).filter(Boolean);
  };
  /** Chips expect a string label; CV overlay / legacy rows may store `{ name }` objects in raw_items. */
  const chipLabelFromGoodAtItem = (item) => normalizeStructuredListItemLabel(item, currentLang);
  const formatMostSeniorWorkExperience = (value) => {
    const key = String(value || '').trim();
    if (!key) return '';
    const translated = t(`profilePage.seniorityForm.options.mostSenior.${key}`);
    if (translated && translated !== `profilePage.seniorityForm.options.mostSenior.${key}`) {
      return translated;
    }
    return mostSeniorOptionsByValue[key] || key;
  };

  const formatCurrentEmploymentStatus = (value) => {
    const key = String(value || '').trim();
    if (!key) return '';
    const translated = t(`profilePage.seniorityForm.options.currentStatus.${key}`);
    if (translated && translated !== `profilePage.seniorityForm.options.currentStatus.${key}`) {
      return translated;
    }
    return currentEmploymentStatusOptionsByValue[key] || key;
  };

  const formatHighestDegree = (value) => {
    const key = String(value || '').trim();
    if (!key) return '';
    const translated = t(`profilePage.seniorityForm.options.highestDegree.${key}`);
    if (translated && translated !== `profilePage.seniorityForm.options.highestDegree.${key}`) {
      return translated;
    }
    return highestDegreeLabel(key);
  };

  useEffect(() => {
    setSectionDisplayModes(readProfileSectionDisplayModes(profileOwnerId));
  }, [profileOwnerId]);

  useEffect(() => {
    if (canEditProfileFields) return;
    setEditSection(null);
    setEditCareerInputs(false);
    setEditIdentityField(null);
    setEditStructuredCategory(null);
    setProfilePictureDialogOpen(false);
    setProfileNameDialogOpen(false);
    setDocumentReviewDocId(null);
  }, [canEditProfileFields]);

  /** Confetti once after profile creation or full update (ProfileCreation navigate + session fallback). */
  useEffect(() => {
    if (profileCelebrationHandledKeyRef.current === location.key) return;
    if (!shouldCelebrateProfileSave(location.state)) return;

    profileCelebrationHandledKeyRef.current = location.key;
    // Fire synchronously — deferring via rAF races with replace-state navigate cleanup on slower devices.
    fireProfileCreatedConfetti();

    const prev = location.state || {};
    const {
      celebrateProfileSaved: _dropSaved,
      celebrateProfileCreated: _dropCreated,
      ...rest
    } = prev;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: Object.keys(rest).length ? rest : undefined }
    );
  }, [location.key, location.pathname, location.search, location.hash, navigate]);

  useEffect(() => {
    if (loginSecurity?.data?.email && loginSecurity.data.email !== user?.email) {
      updateUser({ email: loginSecurity.data.email });
    }
  }, [loginSecurity?.data?.email, user?.email, updateUser]);

  const queueProfileSectionFocus = useCallback((sectionKey) => {
    setSectionScrollTarget(sectionKey);
  }, []);

  const queueStructuredCategoryFocus = useCallback((arrayKey) => {
    if (!arrayKey) return;
    setSectionScrollTarget({ kind: 'structuredCategory', arrayKey });
  }, []);

  const queueIdentityFieldFocus = useCallback((fieldKey) => {
    if (!fieldKey) return;
    setSectionScrollTarget({ kind: 'identityField', fieldKey });
  }, []);

  const handleSectionDisplayModeChange = useCallback((sectionKey, mode) => {
    setSectionDisplayModes((prev) => {
      const next = {
        ...prev,
        [sectionKey]: mode === PROFILE_DISPLAY_MODE.NARRATIVE
          ? PROFILE_DISPLAY_MODE.NARRATIVE
          : PROFILE_DISPLAY_MODE.BULLETS,
      };
      persistProfileSectionDisplayMode(profileOwnerId, sectionKey, mode, next);
      return next;
    });
  }, [profileOwnerId]);

  useLayoutEffect(() => {
    if (!structuredInfoFocusTarget) return undefined;
    const { arrayKey, index } = structuredInfoFocusTarget;
    const el = structuredInfoItemInputRefs.current[`${arrayKey}-${index}`];
    if (el) {
      el.focus({ preventScroll: false });
      el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
    setStructuredInfoFocusTarget(null);
    return undefined;
  }, [structuredInfoFocusTarget]);

  useEffect(() => {
    if (!sectionScrollTarget) return undefined;
    scheduleProfileSectionScroll(() => {
      if (typeof sectionScrollTarget === 'string') {
        const refBySection = {
          userIdentity: userIdentitySectionRef,
          structuredInfo: structuredInfoSectionRef,
          seniority: senioritySectionRef,
          careerInputs: careerInputsSectionRef,
        };
        scrollProfileSectionIntoView(refBySection[sectionScrollTarget]?.current);
      } else if (sectionScrollTarget?.kind === 'structuredCategory') {
        scrollProfileSectionIntoView(
          structuredCategorySectionRefs.current[sectionScrollTarget.arrayKey]
        );
      } else if (sectionScrollTarget?.kind === 'identityField') {
        scrollProfileSectionIntoView(
          identityFieldSectionRefs.current[sectionScrollTarget.fieldKey]
        );
      }
      setSectionScrollTarget(null);
    });
    return undefined;
  }, [sectionScrollTarget, editSection, editIdentityField, editStructuredCategory, editCareerInputs]);

  const stopNarrativeStatusPolling = useCallback(() => {
    if (narrativePollTimerRef.current) {
      window.clearTimeout(narrativePollTimerRef.current);
      narrativePollTimerRef.current = null;
    }
  }, []);

  const applyFullProfileToPage = useCallback((profileData) => {
    if (!profileData || typeof profileData !== 'object') return;
    setProfile(profileData);
    if (profileData.completion) {
      setCompletion(profileData.completion);
      seedProfileCompletionQueryData({ success: true, completion: profileData.completion });
    }
    const stillPending = resolveNarrativePendingFromProfileResponse(profileData, currentLang);
    if (stillPending.length === 0 && profileData.narrativesReady === true) {
      updatePendingNarrativeFields([]);
      narrativePollActiveRef.current = false;
      stopNarrativeStatusPolling();
    }
  }, [currentLang, stopNarrativeStatusPolling, updatePendingNarrativeFields]);

  /**
   * Loads profile + completion. Uses React Query cache so repeat visits avoid a second
   * full GET /api/profile round-trip (that endpoint is expensive on the server).
   * Use { force: true } after mutations or explicit refresh.
   * Use { background: true } with force to refresh without the full-page loading state.
   */
  const fetchProfile = useCallback(async (options = {}) => {
    const { force = false, background = false } = options;
    try {
      setError(null);

      if (!force) {
        const cachedProfile = readFullProfileCacheEntry(currentLang);
        // Do not reuse cache after mutations: invalidateQueries does not refetch inactive queries
        // (this page uses fetchQuery manually, so there is often no active observer).
        if (cachedProfile) {
          setProfile(cachedProfile);
          const cachedCompletionData = queryClient.getQueryData(profileCompletionQueryKey);
          const embeddedCompletion = cachedProfile?.completion || cachedCompletionData?.completion;
          if (embeddedCompletion) {
            setCompletion(embeddedCompletion);
            if (cachedProfile?.completion) {
              seedProfileCompletionQueryData({ success: true, completion: embeddedCompletion });
            }
          }
          setLoading(false);

          const refreshCompletionInBackground = () => {
            if (cachedProfile?.completion) return;
            queryClient
              .prefetchQuery(profileCompletionQueryKey, fetchProfileCompletion, {
                staleTime: PROFILE_QUERY_STALE_TIME_MS,
                cacheTime: PROFILE_QUERY_CACHE_TIME_MS
              })
              .then(() => {
                const latestCompletionData = queryClient.getQueryData(profileCompletionQueryKey);
                if (latestCompletionData?.completion) {
                  setCompletion(latestCompletionData.completion);
                  seedProfileCompletionQueryData(latestCompletionData);
                }
              })
              .catch((completionErr) => {
                console.error('Profile completion refresh failed:', completionErr);
              });
          };

          if (isReviewSaveProfileSeed(cachedProfile)) {
            void refreshSeededFullProfileInBackground(currentLang, {
              onUpdated: applyFullProfileToPage,
            }).catch((profileErr) => {
              console.error('Profile background refresh after review-save failed:', profileErr);
            });
            refreshCompletionInBackground();
            return cachedProfile;
          }

          if (cachedProfile.narrativesReady !== true
            || resolveNarrativePendingFromProfileResponse(cachedProfile, currentLang).length > 0) {
            void refetchFullProfileIntoCache(currentLang)
              .then(applyFullProfileToPage)
              .catch((profileErr) => {
                console.error('Profile background refresh for pending narratives failed:', profileErr);
              });
          }

          refreshCompletionInBackground();
          return cachedProfile;
        }
      } else {
        await queryClient.invalidateQueries(profileFullKey);
        await queryClient.invalidateQueries(profileCompletionQueryKey);
      }

      if (!background) {
        setLoading(true);
      }
      const profileData = await queryClient.fetchQuery(profileFullKey, () => fetchFullProfile(currentLang), {
        staleTime: PROFILE_QUERY_STALE_TIME_MS,
        cacheTime: PROFILE_QUERY_CACHE_TIME_MS
      });
      setProfile(profileData);
      if (profileData?.completion) {
        setCompletion(profileData.completion);
        seedProfileCompletionQueryData({ success: true, completion: profileData.completion });
      } else {
        const completionData = await queryClient.fetchQuery(profileCompletionQueryKey, fetchProfileCompletion, {
          staleTime: PROFILE_QUERY_STALE_TIME_MS,
          cacheTime: PROFILE_QUERY_CACHE_TIME_MS
        });
        setCompletion(completionData.completion);
        seedProfileCompletionQueryData(completionData);
      }
      if (!background) {
        setLoading(false);
      }
      return profileData;
    } catch (err) {
      setError(err.response?.data?.message || t('profilePage.errors.fetchProfileFailed'));
      console.error('Profile fetch error:', err);
      if (!background) {
        setLoading(false);
      }
      return null;
    }
  }, [applyFullProfileToPage, currentLang, profileFullKey, t]);

  useEffect(() => {
    const prev = prevProfileUiLangRef.current;
    const langChanged = prev != null && prev !== currentLang;
    prevProfileUiLangRef.current = currentLang;
    fetchProfile({ force: langChanged });
    if (showLoginSecuritySection) {
      fetchLoginSecurity();
    }
  }, [showLoginSecuritySection, currentLang, i18n.language, fetchProfile]);

  const fetchLoginSecurity = async () => {
    try {
      setLoginSecurity(prev => ({ ...prev, loading: true, error: null }));
      const res = await axios.get('/api/auth/login-security');
      setLoginSecurity({
        data: res.data,
        loading: false,
        error: null
      });
    } catch (err) {
      setLoginSecurity({
        data: null,
        loading: false,
        error: err.response?.data?.error || t('profilePage.loginSecurity.loadFailed')
      });
    }
  };

  const openLoginSecurityDialog = () => {
    setLoginSecurityDialogOpen(true);
    fetchLoginSecurity();
  };

  /**
   * This page manages `completion` locally instead of subscribing with `useProfileCompletionQuery()`.
   * After manual saves, invalidating the query alone leaves the local percentage stale until reload.
   */
  const handleDocumentsUpdate = async (updatedDocs) => {
    setProfile((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        documents: updatedDocs,
      },
    }));
    invalidateProfileCachesAfterMutation();
    await refreshCompletionAfterMutation();
  };

  const startNarrativeStatusPolling = useCallback((initialPending = null) => {
    stopNarrativeStatusPolling();
    narrativePollActiveRef.current = true;
    if (Array.isArray(initialPending) && initialPending.length > 0) {
      updatePendingNarrativeFields(initialPending);
    }
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const status = await fetchProfileNarrativesStatus({
          langQuery: getProfileApiLangQuery(),
          fetchImpl: fetch,
          getAuthToken: () => localStorage.getItem('token'),
        });
        if (status.ready) {
          const refreshedProfile = await fetchProfile({ force: true, background: true });
          const stillPending = resolveNarrativePendingFromProfileResponse(
            refreshedProfile || {},
            currentLang
          );
          if (stillPending.length === 0) {
            updatePendingNarrativeFields([]);
            narrativePollActiveRef.current = false;
            stopNarrativeStatusPolling();
            return;
          }
          updatePendingNarrativeFields(stillPending);
          if (attempts >= PROFILE_NARRATIVE_POLL_MAX_ATTEMPTS) {
            console.warn('Profile narratives marked ready but display text is still missing.');
            narrativePollActiveRef.current = false;
            stopNarrativeStatusPolling();
            return;
          }
          narrativePollTimerRef.current = window.setTimeout(poll, 2500);
          return;
        }
        updatePendingNarrativeFields(status.pending);
        if (attempts >= PROFILE_NARRATIVE_POLL_MAX_ATTEMPTS) {
          console.warn(
            'Profile narrative status poll timed out; showing available content.',
            { pending: status.pending, attempts }
          );
          updatePendingNarrativeFields([]);
          narrativePollActiveRef.current = false;
          stopNarrativeStatusPolling();
          await fetchProfile({ force: true, background: true });
          return;
        }
        narrativePollTimerRef.current = window.setTimeout(poll, 2500);
      } catch (pollErr) {
        console.warn('Profile narrative status poll failed:', pollErr);
        if (attempts >= PROFILE_NARRATIVE_POLL_MAX_ATTEMPTS) {
          updatePendingNarrativeFields([]);
          narrativePollActiveRef.current = false;
          stopNarrativeStatusPolling();
          return;
        }
        narrativePollTimerRef.current = window.setTimeout(poll, 5000);
      }
    };
    void poll();
  }, [currentLang, stopNarrativeStatusPolling, fetchProfile, updatePendingNarrativeFields]);

  const scheduleNarrativeRefreshAfterSectionSave = useCallback((narrativesReady, narrativePending) => {
    const pending = Array.isArray(narrativePending) ? narrativePending : [];
    if (narrativesReady !== false && pending.length === 0) return;
    startNarrativeStatusPolling(pending);
  }, [startNarrativeStatusPolling]);

  useEffect(() => () => {
    narrativePollActiveRef.current = false;
    stopNarrativeStatusPolling();
  }, [stopNarrativeStatusPolling]);

  useEffect(() => {
    narrativeStatusBootstrapDoneRef.current = false;
  }, [currentLang]);

  const narrativeLocalPendingKey = useMemo(() => {
    if (!profile) return '';
    return resolveNarrativePendingFromProfileResponse(profile, currentLang).join('|');
  }, [profile, currentLang]);

  useEffect(() => {
    if (loading || !profile) return undefined;

    if (narrativePollActiveRef.current) return undefined;

    const pendingFromNav = location.state?.narrativePending;
    if (Array.isArray(pendingFromNav) && pendingFromNav.length > 0) {
      startNarrativeStatusPolling(pendingFromNav);
      return undefined;
    }

    const localPending = narrativeLocalPendingKey
      ? narrativeLocalPendingKey.split('|')
      : [];
    if (localPending.length > 0) {
      startNarrativeStatusPolling(localPending);
      return undefined;
    }

    if (profile.narrativesReady === true && narrativeLocalPendingKey === '') {
      updatePendingNarrativeFields([]);
      narrativePollActiveRef.current = false;
      stopNarrativeStatusPolling();
      return undefined;
    }

    if (narrativeStatusBootstrapDoneRef.current) return undefined;
    narrativeStatusBootstrapDoneRef.current = true;

    void fetchProfileNarrativesStatus({
      langQuery: getProfileApiLangQuery(),
      fetchImpl: fetch,
      getAuthToken: () => localStorage.getItem('token'),
    })
      .then((status) => {
        if (!status.ready) {
          startNarrativeStatusPolling(status.pending);
          return;
        }
        updatePendingNarrativeFields([]);
      })
      .catch(() => undefined);
    return undefined;
  }, [
    loading,
    profile,
    profile?.narrativesReady,
    narrativeLocalPendingKey,
    currentLang,
    location.state?.narrativePending,
    startNarrativeStatusPolling,
    stopNarrativeStatusPolling,
  ]);

  const handleExtractedProfileReview = async (profileData) => {
    setSavingCvReview(true);
    setCvReviewError(null);
    const langQuery = getProfileApiLangQuery();
    const reviewUserId = String(user?.id || user?._id || '').trim();
    try {
      const saveResult = await saveExtractedProfileReview({
        profileData,
        fetchImpl: fetch,
        getAuthToken: () => localStorage.getItem('token'),
        langQuery,
        translate: t,
        prefetchProfile: false,
      });
      if (reviewUserId) clearCvReviewDraft(reviewUserId);
      setDocumentReviewDocId(null);

      const seededProfile = readFullProfileCacheEntry(currentLang);
      if (seededProfile) {
        applyFullProfileToPage(seededProfile);
      }

      scheduleNarrativeRefreshAfterSectionSave(
        saveResult?.reviewSaveData?.narrativesReady,
        saveResult?.reviewSaveData?.narrativePending
      );

      void refreshSeededFullProfileInBackground(currentLang, {
        onUpdated: applyFullProfileToPage,
      }).catch((profileErr) => {
        console.error('Profile background refresh after review-save failed:', profileErr);
      });

      if (!seededProfile?.completion) {
        void queryClient
          .prefetchQuery(profileCompletionQueryKey, fetchProfileCompletion, {
            staleTime: PROFILE_QUERY_STALE_TIME_MS,
            cacheTime: PROFILE_QUERY_CACHE_TIME_MS,
          })
          .then(() => {
            const latestCompletionData = queryClient.getQueryData(profileCompletionQueryKey);
            if (latestCompletionData?.completion) {
              setCompletion(latestCompletionData.completion);
              seedProfileCompletionQueryData(latestCompletionData);
            }
          })
          .catch((completionErr) => {
            console.error('Profile completion refresh after CV review save failed:', completionErr);
          });
      }
    } catch (err) {
      setCvReviewError(buildReviewSaveUserMessage(err, t));
      throw err;
    } finally {
      setSavingCvReview(false);
    }
  };

  const refreshCompletionAfterMutation = async () => {
    try {
      const completionData = await queryClient.fetchQuery(profileCompletionQueryKey, fetchProfileCompletion, {
        staleTime: 0,
        cacheTime: PROFILE_QUERY_CACHE_TIME_MS,
      });
      if (completionData?.completion) {
        setCompletion(completionData.completion);
        seedProfileCompletionQueryData(completionData);
      }
    } catch (refreshErr) {
      console.error('Profile completion refresh after mutation failed:', refreshErr);
    }
  };

  const profileCompletionHeader = useMemo(() => {
    if (!completion) return null;
    const pct = completion.overall ?? 0;
    const completionChipSx =
      pct >= 80
        ? {
            bgcolor: 'success.dark',
            color: 'var(--color-on-primary)',
            '& .MuiChip-icon': { color: 'var(--color-on-primary)' },
          }
        : pct >= 50
          ? {
              bgcolor: 'warning.dark',
              color: 'var(--color-on-primary)',
              '& .MuiChip-icon': { color: 'var(--color-on-primary)' },
            }
          : {
              bgcolor: 'error.dark',
              color: 'var(--color-on-primary)',
              '& .MuiChip-icon': { color: 'var(--color-on-primary)' },
            };
    return (
      <Tooltip
        title={<ProfileCompletionTooltipContent completion={completion} />}
        slotProps={{
          tooltip: {
            sx: {
              maxWidth: 400,
              px: 1.75,
              py: 1.25,
            },
          },
        }}
        arrow
        enterDelay={350}
      >
        <Chip
          icon={<AssessmentIcon fontSize="small" />}
          label={`${pct}%`}
          size="small"
          variant="filled"
          color={getCompletionChipColor(pct)}
          sx={{ cursor: 'help', fontWeight: 700, ...completionChipSx }}
        />
      </Tooltip>
    );
  }, [completion]);

  const effectiveStructuredLists = useMemo(() => {
    const profileData = profile?.profile || {};
    const profileStructured = profileData.structuredUserInfo || {};
    if (editCareerInputs) {
      const csiStructured = careerInputsDraft?.structuredUserInfo || {};
      return {
        skillDomains: getRawItems(csiStructured.skillDomains),
        domains: getRawItems(csiStructured.domains),
        keyResponsibilities: getRawItems(csiStructured.keyResponsibilities),
        skills: getRawItems(csiStructured.skills),
        skillsInDevelopment: getRawItems(csiStructured.skillsInDevelopment),
      };
    }
    const lists = {
      skillDomains: getRawItems(profileStructured.skillDomains),
      domains: getRawItems(profileStructured.domains),
      keyResponsibilities: getRawItems(profileStructured.keyResponsibilities),
      skills: getRawItems(profileStructured.skills),
      skillsInDevelopment: getRawItems(profileStructured.skillsInDevelopment),
    };
    if (editStructuredCategory) {
      lists[editStructuredCategory] = structuredCategoryDraft;
    }
    return lists;
  }, [
    profile,
    editStructuredCategory,
    structuredCategoryDraft,
    editCareerInputs,
    careerInputsDraft,
    currentLang,
  ]);

  const skillDomainRecommendationContext = useMemo(() => {
    const profileData = profile?.profile || {};
    const profileSeniority = profileData.seniority || {};
    const texts = [];
    Object.values(profileSeniority).forEach((value) => {
      if (value == null || value === '') return;
      texts.push(String(value).trim());
    });
    const userIdentity = profileData.userIdentity || {};
    [
      'workEnjoyMost',
      'topicsIndustriesInterest',
      'naturallyGoodAt',
      'workEnvironmentFit',
      'workingLifeAchievement',
    ].forEach((key) => {
      const value = userIdentity[key];
      if (value) texts.push(String(value).trim());
    });
    effectiveStructuredLists.domains.forEach((item) => texts.push(item));
    effectiveStructuredLists.keyResponsibilities.forEach((item) => texts.push(item));
    effectiveStructuredLists.skills.forEach((item) => texts.push(item));
    const seen = new Set();
    return texts
      .map((item) => String(item || '').trim())
      .filter((item) => {
        if (!item) return false;
        const dedupeKey = item.toLowerCase();
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      });
  }, [profile, effectiveStructuredLists]);

  const skillSelectionRecommendationContext = useMemo(() => {
    const texts = [...skillDomainRecommendationContext];
    effectiveStructuredLists.skillDomains.forEach((item) => texts.push(item));
    const seen = new Set();
    return texts
      .map((item) => String(item || '').trim())
      .filter((item) => {
        if (!item) return false;
        const dedupeKey = item.toLowerCase();
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      });
  }, [skillDomainRecommendationContext, effectiveStructuredLists]);

  const excludedSkillLabelsForLearning = useMemo(
    () => effectiveStructuredLists.skills,
    [effectiveStructuredLists]
  );

  const profilePageActions = useMemo(() => (
    !canEditProfile
      ? [
          {
            key: 'verify-email',
            label: t('profilePagePrompts.verifyEmail.cta'),
            shortLabel: t('profilePagePrompts.verifyEmail.ctaShort'),
            to: '/check-email',
            variant: 'contained',
            startIcon: <ArrowForwardIcon />,
          },
        ]
      : completion && completion.overall < MIN_PROFILE_COMPLETION_REQUIRED
        ? [
            {
              key: 'complete-profile',
              label: t('profilePagePrompts.incomplete.cta'),
              shortLabel: t('profilePagePrompts.incomplete.ctaShort'),
              to: '/profile/fill',
              variant: 'contained',
              startIcon: <ArrowForwardIcon />,
            },
          ]
        : [
            {
              key: 'full-profile-update',
              label: t('profilePagePrompts.fullUpdateCta'),
              shortLabel: t('profilePagePrompts.fullUpdateCtaShort'),
              to: '/profile/fill?mode=full-update',
              variant: 'outlined',
              startIcon: <ArrowForwardIcon />,
            },
            ...(completion && completion.overall >= MIN_PROFILE_COMPLETION_REQUIRED
              ? [
                  {
                    key: 'go-to-simulation',
                    label: t('profilePagePrompts.goToSimulationCta'),
                    shortLabel: t('profilePagePrompts.goToSimulationCtaShort'),
                    to: goToSimulationHref,
                    variant: 'contained',
                    startIcon: <PuzzlePieceIcon />,
                    nudge: Number(completion?.overall || 0) >= 100,
                  },
                ]
              : []),
          ]
  ), [canEditProfile, completion, goToSimulationHref, t]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button variant="contained" onClick={() => fetchProfile({ force: true })}>
          {t('profilePage.actions.retry')}
        </Button>
      </Box>
    );
  }

  const p = profile?.profile || {};
  const personal = p.personalInfo || {};
  const seniority = p.seniority || {};
  const whoAreYouNarratives = getWhoAreYouNarratives(p?.who_are_you || {}, currentLang);
  const userIdentityAnswers = p.userIdentity || {};
  const documents = p.documents || [];
  const structured = p.structuredUserInfo || {};
  const profileDisplayName = (profile?.name || user?.name || '').trim();
  const careerInputsIdentityEmbeddingText = String(
    p?.careerSimulationInputs?.embeddingOptimizedUserIdentityText || ''
  ).trim();

  const renderField = (
    label,
    value,
    isOptional = false,
    tooltip = '',
    labelGrid = { xs: 4, sm: 3, md: 2 },
    valueGrid = { xs: 8, sm: 9, md: 10 }
  ) => (
    <Grid container alignItems="center" spacing={1} sx={{ mb: 1 }}>
      <Grid item {...labelGrid}>
        <Typography variant="body1" sx={{ color: '#950202', fontWeight: 600 }}>
          {label}
          {tooltip && (
            <Tooltip title={tooltip}><span style={{ marginLeft: 4, color: 'var(--color-text-hint)' }}>?</span></Tooltip>
          )}
          {isOptional && (
            <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: 1 }}>(optional)</Typography>
          )}
        </Typography>
      </Grid>
      <Grid item {...valueGrid}>
        <Typography variant="body1" color={value ? 'text.primary' : 'text.disabled'}>
          {value || <span style={{ fontStyle: 'italic' }}>{t('profilePage.notProvided')}</span>}
        </Typography>
      </Grid>
    </Grid>
  );

  const buildStructuredUserInfoPayload = (structuredProfile, overrides = {}) => {
    const payload = {
      skillDomains: normalizeStructuredList(
        getRawItems(structuredProfile.skillDomains),
        getProfileStructuredListMaxItems('skillDomains')
      ),
      skills: normalizeStructuredList(
        getRawItems(structuredProfile.skills),
        getProfileStructuredListMaxItems('skills')
      ),
      skillsInDevelopment: normalizeStructuredList(
        getRawItems(structuredProfile.skillsInDevelopment),
        getProfileStructuredListMaxItems('skillsInDevelopment')
      ),
      keyResponsibilities: normalizeStructuredList(
        getRawItems(structuredProfile.keyResponsibilities),
        getProfileStructuredListMaxItems('keyResponsibilities')
      ),
      domains: normalizeIndustryDomains(
        normalizeStructuredList(
          getRawItems(structuredProfile.domains),
          getProfileStructuredListMaxItems('domains')
        ),
        { keepUnknown: true }
      ),
    };
    for (const [key, value] of Object.entries(overrides)) {
      const maxItems = getProfileStructuredListMaxItems(key);
      if (key === 'domains') {
        payload.domains = normalizeIndustryDomains(normalizeStructuredList(value, maxItems), { keepUnknown: true });
      } else {
        payload[key] = normalizeStructuredList(value, maxItems);
      }
    }
    return payload;
  };

  const handleEditStructuredCategory = (arrayKey) => {
    if (!canEditProfileFields) return;
    setStructuredInfoError(null);
    setStructuredCategoryDraft(getRawItems(structured[arrayKey]));
    setEditStructuredCategory(arrayKey);
    queueStructuredCategoryFocus(arrayKey);
  };

  const handleCancelStructuredCategory = () => {
    const arrayKey = editStructuredCategory;
    setEditStructuredCategory(null);
    setStructuredCategoryDraft([]);
    setStructuredInfoError(null);
    setStructuredInfoFocusTarget(null);
    queueStructuredCategoryFocus(arrayKey);
  };

  const handleSaveStructuredCategory = async (draftOverride) => {
    if (!editStructuredCategory) return;
    const draftToSave = draftOverride !== undefined ? draftOverride : structuredCategoryDraft;
    if (draftOverride !== undefined) {
      setStructuredCategoryDraft(draftOverride);
    }
    setStructuredInfoLoading(true);
    setStructuredInfoError(null);
    try {
      const payload = buildStructuredUserInfoPayload(structured, {
        [editStructuredCategory]: draftToSave,
      });
      const res = await axios.put(`/api/profile/structured-user-info?${getProfileApiLangQuery()}`, payload);
      setProfile((prev) => {
        const nextStructuredUserInfo = res.data?.structuredUserInfo ?? prev.profile.structuredUserInfo;
        return {
          ...prev,
          profile: {
            ...prev.profile,
            structuredUserInfo: nextStructuredUserInfo,
            careerSimulationInputs: res.data?.careerSimulationInputs ?? prev.profile.careerSimulationInputs,
          },
        };
      });
      invalidateProfileCachesAfterMutation();
      await refreshCompletionAfterMutation();
      const savedCategory = editStructuredCategory;
      setEditStructuredCategory(null);
      setStructuredCategoryDraft([]);
      queueStructuredCategoryFocus(savedCategory);
      scheduleNarrativeRefreshAfterSectionSave(
        res.data?.narrativesReady,
        res.data?.narrativePending
      );
    } catch (err) {
      const data = err.response?.data;
      const msg = data?.message || data?.error || t('profilePage.errors.saveStructuredInfoFailed');
      setStructuredInfoError(msg);
    } finally {
      setStructuredInfoLoading(false);
    }
  };

  const handleStructuredCategoryItemChange = (index, value) => {
    setStructuredCategoryDraft((prev) => prev.map((item, itemIdx) => (
      itemIdx === index ? value : item
    )));
  };

  const handleStructuredCategoryItemAdd = () => {
    if (!editStructuredCategory) return;
    const maxItems = getProfileStructuredListMaxItems(editStructuredCategory);
    let nextIndex = null;
    setStructuredCategoryDraft((prev) => {
      if (prev.length >= maxItems) return prev;
      nextIndex = prev.length;
      return [...prev, ''];
    });
    if (nextIndex != null) {
      setStructuredInfoFocusTarget({ arrayKey: editStructuredCategory, index: nextIndex });
    }
  };

  const handleStructuredCategoryItemRemove = (index) => {
    setStructuredCategoryDraft((prev) => prev.filter((_, itemIdx) => itemIdx !== index));
  };

  const handleStartEditProfileName = () => {
    if (!canEditProfileFields) return;
    setProfileNameError(null);
    setProfileNameDraft(profileDisplayName);
    setProfileNameDialogOpen(true);
  };

  const handleCancelEditProfileName = () => {
    if (profileNameLoading) return;
    setProfileNameDialogOpen(false);
    setProfileNameError(null);
  };

  const handleSaveProfileName = async () => {
    const trimmedName = profileNameDraft.trim();
    if (!trimmedName) {
      setProfileNameError(t('profilePage.nameEditor.errors.required'));
      return;
    }
    setProfileNameLoading(true);
    setProfileNameError(null);
    try {
      const res = await axios.put(`/api/profile/name?${getProfileApiLangQuery()}`, { name: trimmedName });
      setProfile(prev => ({ ...prev, name: res.data?.name || trimmedName }));
      updateUser({ name: res.data?.name || trimmedName });
      invalidateProfileCachesAfterMutation();
      setProfileNameDialogOpen(false);
    } catch (err) {
      const data = err.response?.data;
      const msg = data?.message || data?.error || t('profilePage.nameEditor.errors.saveFailed');
      setProfileNameError(typeof msg === 'string' ? msg : t('profilePage.nameEditor.errors.saveFailed'));
    } finally {
      setProfileNameLoading(false);
    }
  };

  const buildUserIdentitySavePayload = (overrides = {}) => {
    const answers = profile?.profile?.userIdentity || {};
    const payload = {};
    for (const { key } of USER_IDENTITY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        payload[key] = String(overrides[key] || '').trim();
      } else {
        payload[key] = String(answers[key] || '').trim();
      }
    }
    return payload;
  };

  const applyUserIdentitySaveResult = (savedIdentityAnswers, res) => {
    setProfile((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        userIdentity: res.data?.userIdentity ?? {
          ...(prev.profile.userIdentity || {}),
          ...savedIdentityAnswers,
        },
        userIdentityAnswers: {
          ...(prev.profile.userIdentityAnswers || {}),
          ...savedIdentityAnswers,
        },
        who_are_you: res.data?.who_are_you ?? prev.profile.who_are_you,
        careerSimulationInputs: res.data?.careerSimulationInputs ?? prev.profile.careerSimulationInputs,
      },
    }));
  };

  const handleEditIdentityField = (fieldKey) => {
    if (!canEditProfileFields) return;
    setIdentityFieldError(null);
    setIdentityFieldCoachingActive(false);
    setIdentityCoachingStructuredPatch(null);
    setIdentitySaveShouldRegenerateNarrative(false);
    setIdentityFieldDraft(parseIdentityFieldForEdit(fieldKey, userIdentityAnswers[fieldKey]));
    setEditIdentityField(fieldKey);
    queueIdentityFieldFocus(fieldKey);
  };

  const handleStartIdentityFieldCoaching = () => {
    if (!editIdentityField) return;
    setIdentityFieldError(null);
    setIdentityCoachingStructuredPatch(null);
    setIdentityCoachingRestartKey((prev) => prev + 1);
    setIdentityFieldCoachingActive(true);
    queueIdentityFieldFocus(editIdentityField);
  };

  const handleBackToIdentityManualEdit = () => {
    setIdentityFieldCoachingActive(false);
    if (editIdentityField) {
      queueIdentityFieldFocus(editIdentityField);
    }
  };

  const handleIdentityCoachingComplete = ({ formattedText, structuredPatch = null }) => {
    if (!editIdentityField) return;
    setIdentityFieldDraft(parseIdentityFieldForEdit(editIdentityField, formattedText));
    setIdentityCoachingStructuredPatch(structuredPatch);
    setIdentitySaveShouldRegenerateNarrative(true);
    setIdentityFieldCoachingActive(false);
    setIdentityFieldError(null);
    queueIdentityFieldFocus(editIdentityField);
  };

  const handleCancelIdentityField = () => {
    const fieldKey = editIdentityField;
    setEditIdentityField(null);
    setIdentityFieldDraft(null);
    setIdentityFieldError(null);
    setIdentityFieldCoachingActive(false);
    setIdentityCoachingStructuredPatch(null);
    setIdentitySaveShouldRegenerateNarrative(false);
    queueIdentityFieldFocus(fieldKey);
  };

  const handleSaveIdentityField = async () => {
    if (!editIdentityField || !identityFieldDraft) return;
    if (!identityFieldDraftHasContent(editIdentityField, identityFieldDraft)) {
      const question = t(USER_IDENTITY_FIELDS.find(({ key }) => key === editIdentityField)?.questionKey || '');
      setIdentityFieldError(t('documentUpload.review.errors.identityRequired', { question }));
      return;
    }
    const formatted = formatIdentityFieldFromEdit(editIdentityField, identityFieldDraft);
    if (formatted.length > PROFILE_REVIEW_USER_IDENTITY_MAX) {
      setIdentityFieldError(t('documentUpload.review.errors.identityMaxLength', { max: PROFILE_REVIEW_USER_IDENTITY_MAX }));
      return;
    }
    setIdentityFieldLoading(true);
    setIdentityFieldError(null);
    try {
      const payload = buildUserIdentitySavePayload({ [editIdentityField]: formatted });
      if (identitySaveShouldRegenerateNarrative) {
        payload.forceRegenerateWhoAreYouField = editIdentityField;
      }
      const res = await axios.put(`/api/profile/user-identity?${getProfileApiLangQuery()}`, payload);
      const savedIdentityAnswers = USER_IDENTITY_FIELDS.reduce((acc, { key }) => {
        acc[key] = payload[key];
        return acc;
      }, {});
      applyUserIdentitySaveResult(savedIdentityAnswers, res);

      let narrativesReady = res.data?.narrativesReady;
      let narrativePending = res.data?.narrativePending;

      if (identityCoachingStructuredPatch && Object.keys(identityCoachingStructuredPatch).length > 0) {
        const structuredPayload = buildStructuredUserInfoPayload(structured, identityCoachingStructuredPatch);
        const structuredRes = await axios.put(
          `/api/profile/structured-user-info?${getProfileApiLangQuery()}`,
          structuredPayload
        );
        setProfile((prev) => ({
          ...prev,
          profile: {
            ...prev.profile,
            structuredUserInfo: structuredRes.data?.structuredUserInfo ?? prev.profile.structuredUserInfo,
            careerSimulationInputs: structuredRes.data?.careerSimulationInputs ?? prev.profile.careerSimulationInputs,
          },
        }));
        setIdentityCoachingStructuredPatch(null);
        if (structuredRes.data?.narrativesReady === false) {
          narrativesReady = false;
          narrativePending = structuredRes.data?.narrativePending;
        }
      }

      invalidateProfileCachesAfterMutation();
      await refreshCompletionAfterMutation();
      const savedField = editIdentityField;
      setEditIdentityField(null);
      setIdentityFieldDraft(null);
      setIdentityFieldCoachingActive(false);
      setIdentitySaveShouldRegenerateNarrative(false);
      queueIdentityFieldFocus(savedField);
      scheduleNarrativeRefreshAfterSectionSave(narrativesReady, narrativePending);
    } catch (err) {
      const responseData = err.response?.data;
      const msg = responseData?.message || responseData?.error || t('profilePage.errors.saveChangesFailed');
      const errStr = typeof msg === 'string' ? msg : (Array.isArray(responseData?.errors) && responseData.errors[0]?.msg) ? responseData.errors[0].msg : t('profilePage.errors.saveChangesFailed');
      setIdentityFieldError(errStr);
    } finally {
      setIdentityFieldLoading(false);
    }
  };

  const handleRegenerateWhoAreYouNarrative = async (fieldKey) => {
    if (!canEditProfileFields || !fieldKey || whoAreYouNarrativeRegenLoading || identityFieldLoading) return;
    setWhoAreYouNarrativeRegenLoading(true);
    setIdentityFieldError(null);
    try {
      const payload = {
        ...buildUserIdentitySavePayload(),
        forceRegenerateWhoAreYouField: fieldKey,
      };
      const res = await axios.put(`/api/profile/user-identity?${getProfileApiLangQuery()}`, payload);
      const savedIdentityAnswers = USER_IDENTITY_FIELDS.reduce((acc, { key }) => {
        acc[key] = payload[key];
        return acc;
      }, {});
      applyUserIdentitySaveResult(savedIdentityAnswers, res);
      invalidateProfileCachesAfterMutation();
      scheduleNarrativeRefreshAfterSectionSave(
        res.data?.narrativesReady,
        res.data?.narrativePending
      );
    } catch (err) {
      const responseData = err.response?.data;
      const msg = responseData?.message || responseData?.error || t('profilePage.errors.saveChangesFailed');
      setIdentityFieldError(typeof msg === 'string' ? msg : t('profilePage.errors.saveChangesFailed'));
    } finally {
      setWhoAreYouNarrativeRegenLoading(false);
    }
  };

  const handleEditSeniority = () => {
    if (!canEditProfileFields) return;
    setEditSection('seniority');
    setFormError(null);
    setEditFormData({
      currentStatus: seniority.currentStatus || '',
      yearsOfExperience: seniority.yearsOfExperience,
      highestDegree: seniority.highestDegree || '',
      mostSeniorWorkExperience: seniority.mostSeniorWorkExperience || ''
    });
    queueProfileSectionFocus('seniority');
  };

  const handleCancel = () => {
    const sectionKey = editSection;
    setEditSection(null);
    setFormError(null);
    if (sectionKey === 'seniority') {
      queueProfileSectionFocus('seniority');
    }
  };

  const handleSaveSeniority = async (data) => {
    setFormLoading(true);
    setFormError(null);
    try {
      const res = await axios.put(`/api/profile/seniority?${getProfileApiLangQuery()}`, {
        currentStatus: data.currentStatus,
        yearsOfExperience: data.yearsOfExperience,
        highestDegree: data.highestDegree,
        mostSeniorWorkExperience: data.mostSeniorWorkExperience
      });
      setProfile(prev => ({
        ...prev,
        profile: {
          ...prev.profile,
          seniority: {
            ...prev.profile.seniority,
            ...(res.data?.seniority || {})
          },
          careerSimulationInputs: res.data?.careerSimulationInputs ?? prev.profile.careerSimulationInputs
        }
      }));
      invalidateProfileCachesAfterMutation();
      await refreshCompletionAfterMutation();
      setEditSection(null);
      queueProfileSectionFocus('seniority');
    } catch (err) {
      const responseData = err.response?.data;
      const msg = responseData?.message || responseData?.error || t('profilePage.errors.saveChangesFailed');
      const errStr = typeof msg === 'string' ? msg : (Array.isArray(responseData?.errors) && responseData.errors[0]?.msg) ? responseData.errors[0].msg : t('profilePage.errors.saveChangesFailed');
      setFormError(errStr);
    } finally {
      setFormLoading(false);
    }
  };

  // Handler for editing career simulation inputs (only fields used for user vectors)
  const handleEditCareerInputs = () => {
    if (!canEditProfileFields) return;
    setCareerInputsError(null);
    const raw = { ...(profile?.profile?.careerSimulationInputs || {}) };
    const structuredUserInfo = {
      skillDomains: getRawItems(raw.structuredUserInfo?.skillDomains),
      skills: getRawItems(raw.structuredUserInfo?.skills),
      skillsInDevelopment: getRawItems(raw.structuredUserInfo?.skillsInDevelopment),
      keyResponsibilities: getRawItems(raw.structuredUserInfo?.keyResponsibilities),
      domains: getRawItems(raw.structuredUserInfo?.domains)
    };
    const userIdentity = {
      workEnjoyMost: raw.userIdentity?.workEnjoyMost || '',
      topicsIndustriesInterest: raw.userIdentity?.topicsIndustriesInterest || '',
      naturallyGoodAt: raw.userIdentity?.naturallyGoodAt || '',
      workEnvironmentFit: raw.userIdentity?.workEnvironmentFit || '',
      workingLifeAchievement: raw.userIdentity?.workingLifeAchievement || ''
    };
    const seniority = raw.seniority && typeof raw.seniority === 'object' ? raw.seniority : {};
    setCareerInputsDraft({
      structuredUserInfo,
      userIdentity,
      seniority: {
        currentStatus: seniority.currentStatus || '',
        yearsOfExperience: seniority.yearsOfExperience ?? null,
        highestDegree: seniority.highestDegree || '',
        mostSeniorWorkExperience: seniority.mostSeniorWorkExperience || ''
      }
    });
    setChipInputs({});
    setEditingChip(null);
    setEditCareerInputs(true);
    queueProfileSectionFocus('careerInputs');
  };
  const handleCancelCareerInputs = () => {
    setEditCareerInputs(false);
    setCareerInputsDraft(null);
    setChipInputs({});
    setEditingChip(null);
    setCareerInputsError(null);
    queueProfileSectionFocus('careerInputs');
  };
  const handleChangeCareerInputs = (field, value) => {
    setCareerInputsDraft(prev => ({ ...prev, [field]: value }));
  };
  const handleSaveCareerInputs = async () => {
    setCareerInputsLoading(true);
    setCareerInputsError(null);
    try {
      const draft = careerInputsDraft || {};
      const ui = draft.userIdentity || {};
      if (USER_IDENTITY_FIELDS.some(({ key }) => !String(ui[key] || '').trim())) {
        setCareerInputsError(t('profilePage.errors.identityQuestionsRequired'));
        setCareerInputsLoading(false);
        return;
      }
      const payload = {
        structuredUserInfo: {
          skillDomains: draft.structuredUserInfo?.skillDomains || [],
          skills: draft.structuredUserInfo?.skills || [],
          skillsInDevelopment: draft.structuredUserInfo?.skillsInDevelopment || [],
          keyResponsibilities: draft.structuredUserInfo?.keyResponsibilities || [],
          domains: normalizeIndustryDomains(draft.structuredUserInfo?.domains || [], { keepUnknown: true })
        },
        userIdentity: {
          workEnjoyMost: draft.userIdentity?.workEnjoyMost || '',
          topicsIndustriesInterest: draft.userIdentity?.topicsIndustriesInterest || '',
          naturallyGoodAt: draft.userIdentity?.naturallyGoodAt || '',
          workEnvironmentFit: draft.userIdentity?.workEnvironmentFit || '',
          workingLifeAchievement: draft.userIdentity?.workingLifeAchievement || ''
        },
        seniority: draft.seniority && typeof draft.seniority === 'object' ? {
          currentStatus: draft.seniority.currentStatus || '',
          yearsOfExperience: draft.seniority.yearsOfExperience ?? null,
          highestDegree: draft.seniority.highestDegree || '',
          mostSeniorWorkExperience: draft.seniority.mostSeniorWorkExperience || ''
        } : undefined
      };

      const res = await axios.put(`/api/profile/career-simulation-inputs?${getProfileApiLangQuery()}`, payload);
      setProfile(prev => ({
        ...prev,
        profile: {
          ...prev.profile,
          careerSimulationInputs: res.data.careerSimulationInputs
        }
      }));
      invalidateProfileCachesAfterMutation();
      setEditCareerInputs(false);
      setCareerInputsDraft(null);
      queueProfileSectionFocus('careerInputs');
    } catch (err) {
      setCareerInputsError(err.response?.data?.error || t('profilePage.errors.saveChangesFailed'));
    } finally {
      setCareerInputsLoading(false);
    }
  };

  // Chip management functions
  const handleAddChip = (field, value) => {
    if (!value.trim()) return;
    
    setCareerInputsDraft(prev => {
      let currentArray;
      let newArray;
      
      if (field === 'structuredUserInfo.domains') {
        currentArray = prev.structuredUserInfo?.domains || [];
        newArray = [...currentArray, value.trim()];
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            domains: newArray
          }
        };
      } else if (field === 'structuredUserInfo.skillDomains') {
        currentArray = prev.structuredUserInfo?.skillDomains || [];
        newArray = [...currentArray, value.trim()];
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            skillDomains: newArray
          }
        };
      } else if (field === 'structuredUserInfo.skills') {
        currentArray = prev.structuredUserInfo?.skills || [];
        newArray = [...currentArray, value.trim()];
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            skills: newArray
          }
        };
      } else if (field === 'structuredUserInfo.skillsInDevelopment') {
        currentArray = prev.structuredUserInfo?.skillsInDevelopment || [];
        newArray = [...currentArray, value.trim()];
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            skillsInDevelopment: newArray
          }
        };
      } else if (field === 'structuredUserInfo.keyResponsibilities') {
        currentArray = prev.structuredUserInfo?.keyResponsibilities || [];
        newArray = [...currentArray, value.trim()];
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            keyResponsibilities: newArray
          }
        };
      } else {
        currentArray = prev[field] || [];
        newArray = [...currentArray, value.trim()];
      }
      
      return { ...prev, [field]: newArray };
    });
    
    // Clear the input
    setChipInputs(prev => ({ ...prev, [field]: '' }));
  };

  const handleDeleteChip = (field, index) => {
    setCareerInputsDraft(prev => {
      if (field === 'structuredUserInfo.domains') {
        const currentArray = prev.structuredUserInfo?.domains || [];
        const newArray = currentArray.filter((_, i) => i !== index);
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            domains: newArray
          }
        };
      } else if (field === 'structuredUserInfo.skillDomains') {
        const currentArray = prev.structuredUserInfo?.skillDomains || [];
        const newArray = currentArray.filter((_, i) => i !== index);
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            skillDomains: newArray
          }
        };
      } else if (field === 'structuredUserInfo.skills') {
        const currentArray = prev.structuredUserInfo?.skills || [];
        const newArray = currentArray.filter((_, i) => i !== index);
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            skills: newArray
          }
        };
      } else if (field === 'structuredUserInfo.skillsInDevelopment') {
        const currentArray = prev.structuredUserInfo?.skillsInDevelopment || [];
        const newArray = currentArray.filter((_, i) => i !== index);
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            skillsInDevelopment: newArray
          }
        };
      } else if (field === 'structuredUserInfo.keyResponsibilities') {
        const currentArray = prev.structuredUserInfo?.keyResponsibilities || [];
        const newArray = currentArray.filter((_, i) => i !== index);
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            keyResponsibilities: newArray
          }
        };
      } else {
        const currentArray = prev[field] || [];
        const newArray = currentArray.filter((_, i) => i !== index);
        return { ...prev, [field]: newArray };
      }
    });
  };

  const handleEditChip = (field, index, newValue) => {
    setCareerInputsDraft(prev => {
      if (field === 'structuredUserInfo.domains') {
        const currentArray = prev.structuredUserInfo?.domains || [];
        const newArray = [...currentArray];
        newArray[index] = newValue;
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            domains: newArray
          }
        };
      } else if (field === 'structuredUserInfo.skillDomains') {
        const currentArray = prev.structuredUserInfo?.skillDomains || [];
        const newArray = [...currentArray];
        newArray[index] = newValue;
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            skillDomains: newArray
          }
        };
      } else if (field === 'structuredUserInfo.skills') {
        const currentArray = prev.structuredUserInfo?.skills || [];
        const newArray = [...currentArray];
        newArray[index] = newValue;
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            skills: newArray
          }
        };
      } else if (field === 'structuredUserInfo.skillsInDevelopment') {
        const currentArray = prev.structuredUserInfo?.skillsInDevelopment || [];
        const newArray = [...currentArray];
        newArray[index] = newValue;
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            skillsInDevelopment: newArray
          }
        };
      } else if (field === 'structuredUserInfo.keyResponsibilities') {
        const currentArray = prev.structuredUserInfo?.keyResponsibilities || [];
        const newArray = [...currentArray];
        newArray[index] = newValue;
        return {
          ...prev,
          structuredUserInfo: {
            ...prev.structuredUserInfo,
            keyResponsibilities: newArray
          }
        };
      } else {
        const currentArray = prev[field] || [];
        const newArray = [...currentArray];
        newArray[index] = newValue;
        
        return { ...prev, [field]: newArray };
      }
    });
    setEditingChip(null);
  };

  const handleChipInputChange = (field, value) => {
    setChipInputs(prev => ({ ...prev, [field]: value }));
  };

  const handleChipInputKeyPress = (field, event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAddChip(field, chipInputs[field] || '');
    }
  };

  // Helper function to render editable chip sections
  const renderEditableChips = (field, label, placeholder, chipColor = 'primary') => {
    if (field === 'structuredUserInfo.domains') {
      const chips = careerInputsDraft.structuredUserInfo?.domains || [];
      return (
        <Box sx={{ mb: 2 }}>
          <IndustrySectorPicker
            value={chips}
            onChange={(nextDomains) => {
              setCareerInputsDraft((prev) => ({
                ...prev,
                structuredUserInfo: {
                  ...prev.structuredUserInfo,
                  domains: normalizeIndustryDomains(nextDomains, { keepUnknown: true }),
                },
              }));
            }}
            lang={currentLang}
            label={label}
            placeholder={placeholder}
            maxItems={getProfileStructuredListMaxItems('domains')}
          />
        </Box>
      );
    }

    if (field === 'structuredUserInfo.skillDomains') {
      const chips = careerInputsDraft.structuredUserInfo?.skillDomains || [];
      return (
        <Box sx={{ mb: 2 }}>
          <SkillDomainPicker
            value={chips}
            onChange={(nextSkillDomains) => {
              setCareerInputsDraft((prev) => ({
                ...prev,
                structuredUserInfo: {
                  ...prev.structuredUserInfo,
                  skillDomains: nextSkillDomains,
                },
              }));
            }}
            label={label}
            helperText={placeholder}
            maxItems={getProfileStructuredListMaxItems('skillDomains')}
            recommendationContextTexts={skillDomainRecommendationContext}
          />
        </Box>
      );
    }

    if (field === 'structuredUserInfo.skills') {
      const chips = careerInputsDraft.structuredUserInfo?.skills || [];
      return (
        <Box sx={{ mb: 2 }}>
          <SkillPicker
            value={chips}
            onChange={(nextSkills) => {
              setCareerInputsDraft((prev) => ({
                ...prev,
                structuredUserInfo: {
                  ...prev.structuredUserInfo,
                  skills: nextSkills,
                },
              }));
            }}
            label={label}
            helperText={placeholder}
            maxItems={getProfileStructuredListMaxItems('skills')}
            recommendationContextTexts={skillSelectionRecommendationContext}
          />
        </Box>
      );
    }

    if (field === 'structuredUserInfo.skillsInDevelopment') {
      const chips = careerInputsDraft.structuredUserInfo?.skillsInDevelopment || [];
      return (
        <Box sx={{ mb: 2 }}>
          <SkillPicker
            value={chips}
            onChange={(nextSkills) => {
              setCareerInputsDraft((prev) => ({
                ...prev,
                structuredUserInfo: {
                  ...prev.structuredUserInfo,
                  skillsInDevelopment: nextSkills,
                },
              }));
            }}
            label={label}
            helperText={placeholder}
            maxItems={getProfileStructuredListMaxItems('skillsInDevelopment')}
            translationKeyPrefix="skillsToLearnSelection"
          />
        </Box>
      );
    }

    let chips;
    
    if (field === 'structuredUserInfo.keyResponsibilities') {
      chips = careerInputsDraft.structuredUserInfo?.keyResponsibilities || [];
    } else {
      chips = careerInputsDraft[field] || [];
    }
    
    return (
      <Box sx={{ mb: 2 }}>
        {label ? <Typography variant="subtitle2" color="text.secondary">{label}</Typography> : null}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: PROFILE_CHIP_GAP, mb: 1 }}>
          {chips.map((chip, index) => {
            const chipKey = `${field}-${index}`;
            const isEditing = editingChip === chipKey;
            
            if (isEditing) {
              return (
                <TextField
                  key={chipKey}
                  size="small"
                  autoFocus
                  defaultValue={chipLabelFromGoodAtItem(chip)}
                  onBlur={(e) => handleEditChip(field, index, e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleEditChip(field, index, e.target.value);
                    } else if (e.key === 'Escape') {
                      setEditingChip(null);
                    }
                  }}
                  sx={{ minWidth: 120 }}
                />
              );
            }
            
            const label = field === 'languages'
              ? `${chip.language} (${chip.proficiency})`
              : chipLabelFromGoodAtItem(chip);

            return (
              <Chip
                key={chipKey}
                label={label}
                color={chipColor}
                variant="outlined"
                size="small"
                onDelete={() => handleDeleteChip(field, index)}
                onClick={() => setEditingChip(chipKey)}
                sx={{ cursor: 'pointer' }}
              />
            );
          })}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder={placeholder}
            value={chipInputs[field] || ''}
            onChange={(e) => handleChipInputChange(field, e.target.value)}
            onKeyPress={(e) => handleChipInputKeyPress(field, e)}
            sx={{ flexGrow: 1 }}
          />
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => handleAddChip(field, chipInputs[field] || '')}
            disabled={!chipInputs[field]?.trim()}
          >
            Add
          </Button>
        </Box>
      </Box>
    );
  };

  const seniorityDisplayFields = [
    {
      key: 'currentStatus',
      label: t('profilePage.seniority.currentEmploymentStatus'),
      value: formatCurrentEmploymentStatus(seniority.currentStatus),
    },
    {
      key: 'yearsOfExperience',
      label: t('profilePage.seniority.yearsOfWorkExperience'),
      value:
        seniority.yearsOfExperience !== undefined && seniority.yearsOfExperience !== null
          ? String(seniority.yearsOfExperience)
          : '',
    },
    {
      key: 'highestDegree',
      label: t('profilePage.seniority.highestEducationalDegree'),
      value: seniority.highestDegree ? formatHighestDegree(seniority.highestDegree) : '',
    },
    {
      key: 'mostSeniorWorkExperience',
      label: t('profilePage.seniority.mostSeniorWorkExperience'),
      value: formatMostSeniorWorkExperience(seniority.mostSeniorWorkExperience),
    },
  ];

  const renderStructuredCategoryDisplay = (section) => {
    const items = getRawItems(structured[section.arrayKey]);
    const emptyLabel = t(section.emptyKey);
    switch (section.editorType) {
      case 'skillDomains':
        return items.length > 0 ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: PROFILE_CHIP_GAP }}>
            {items.map((domain, idx) => {
              const label = chipLabelFromGoodAtItem(domain);
              return <SkillDomainChip key={idx} label={label} domainKey={label} />;
            })}
          </Box>
        ) : (
          <Typography variant="body1" color="text.disabled" sx={{ fontStyle: 'italic' }}>
            {emptyLabel}
          </Typography>
        );
      case 'domains':
        return items.length > 0 ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: PROFILE_CHIP_GAP }}>
            {items.map((domain, idx) => (
              <IndustrySectorChip key={idx} value={domain} lang={currentLang} />
            ))}
          </Box>
        ) : (
          <Typography variant="body1" color="text.disabled" sx={{ fontStyle: 'italic' }}>
            {emptyLabel}
          </Typography>
        );
      case 'skills':
      case 'skillsInDevelopment':
        return items.length > 0 ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: PROFILE_CHIP_GAP }}>
            {items.map((skill, idx) => {
              const label = chipLabelFromGoodAtItem(skill);
              return <SkillChip key={idx} label={label} skillKey={label} />;
            })}
          </Box>
        ) : (
          <Typography variant="body1" color="text.disabled" sx={{ fontStyle: 'italic' }}>
            {emptyLabel}
          </Typography>
        );
      case 'textList':
      default:
        return items.length > 0 ? (
          <Box component="ul" sx={{ pl: 2, m: 0 }}>
            {items.map((item, idx) => (
              <Typography key={idx} component="li" variant="body1" color="text.primary">
                {chipLabelFromGoodAtItem(item)}
              </Typography>
            ))}
          </Box>
        ) : (
          <Typography variant="body1" color="text.disabled" sx={{ fontStyle: 'italic' }}>
            {emptyLabel}
          </Typography>
        );
    }
  };

  const renderStructuredCategoryEditor = (section) => {
    const title = t(section.titleKey);
    const addLabel = t(section.addLabelKey);
    const helper = section.helperKey ? t(section.helperKey) : '';
    const draft = structuredCategoryDraft;
    const maxItems = section.maxItems;
    const handleDialogSave = (nextValues) => {
      void handleSaveStructuredCategory(nextValues);
    };

    switch (section.editorType) {
      case 'skillDomains':
        return (
          <>
            <SkillDomainPicker
              value={draft}
              onChange={setStructuredCategoryDraft}
              maxItems={maxItems}
              recommendationContextTexts={skillDomainRecommendationContext}
              defaultDialogOpen
              onDialogSave={handleDialogSave}
              onDialogCancel={handleCancelStructuredCategory}
            />
            {draft.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mt: 1 }}>
                {t(section.emptyKey)}
              </Typography>
            )}
          </>
        );
      case 'domains':
        return (
          <>
            <IndustrySectorPicker
              value={draft}
              onChange={(nextDomains) => {
                setStructuredCategoryDraft(normalizeIndustryDomains(nextDomains, { keepUnknown: true }));
              }}
              lang={currentLang}
              placeholder={addLabel}
              maxItems={maxItems}
              defaultDialogOpen
              onDialogSave={(nextDomains) => {
                handleDialogSave(normalizeIndustryDomains(nextDomains, { keepUnknown: true }));
              }}
              onDialogCancel={handleCancelStructuredCategory}
            />
            {draft.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mt: 1 }}>
                {t(section.emptyKey)}
              </Typography>
            )}
          </>
        );
      case 'skills':
        return (
          <>
            <SkillPicker
              value={draft}
              onChange={setStructuredCategoryDraft}
              helperText={helper}
              maxItems={maxItems}
              recommendationContextTexts={skillSelectionRecommendationContext}
              defaultDialogOpen
              onDialogSave={handleDialogSave}
              onDialogCancel={handleCancelStructuredCategory}
            />
            {draft.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mt: 1 }}>
                {t(section.emptyKey)}
              </Typography>
            )}
          </>
        );
      case 'skillsInDevelopment':
        return (
          <>
            <SkillPicker
              value={draft}
              onChange={setStructuredCategoryDraft}
              helperText={helper}
              maxItems={maxItems}
              recommendationContextTexts={skillSelectionRecommendationContext}
              excludeLabels={excludedSkillLabelsForLearning}
              translationKeyPrefix="skillsToLearnSelection"
              defaultDialogOpen
              onDialogSave={handleDialogSave}
              onDialogCancel={handleCancelStructuredCategory}
            />
            {draft.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mt: 1 }}>
                {t(section.emptyKey)}
              </Typography>
            )}
          </>
        );
      case 'textList':
      default:
        return (
          <>
            {helper ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {helper}
              </Typography>
            ) : null}
            {draft.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 1 }}>
                {t('profilePage.structuredInfo.emptyEntries')}
              </Typography>
            )}
            {draft.map((value, idx) => {
              const shouldAutoFocus =
                structuredInfoFocusTarget?.arrayKey === section.arrayKey
                && structuredInfoFocusTarget?.index === idx;
              const itemRefKey = `${section.arrayKey}-${idx}`;
              return (
                <Box key={itemRefKey} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                  <TextField
                    fullWidth
                    value={value}
                    onChange={(e) => handleStructuredCategoryItemChange(idx, e.target.value)}
                    multiline={section.multiline}
                    minRows={section.multiline ? section.minRows : undefined}
                    placeholder={`${title} ${idx + 1}`}
                    autoFocus={shouldAutoFocus}
                    inputRef={(el) => {
                      if (el) {
                        structuredInfoItemInputRefs.current[itemRefKey] = el;
                      } else {
                        delete structuredInfoItemInputRefs.current[itemRefKey];
                      }
                    }}
                  />
                  <IconButton
                    aria-label={`Remove ${title} ${idx + 1}`}
                    onClick={() => handleStructuredCategoryItemRemove(idx)}
                    sx={{ mt: section.multiline ? 0.5 : 0 }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Box>
              );
            })}
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={handleStructuredCategoryItemAdd}
              disabled={draft.length >= maxItems}
            >
              {addLabel}
            </Button>
          </>
        );
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      {/* Prompt to complete profile if below threshold */}
      {!canEditProfile ? (
        <ProfileSnapTarget snap>
          <Typography variant="h4" component="h1" sx={PAGE_TITLE_SX}>
            {t('profilePagePrompts.verifyEmail.title')}
          </Typography>
          <Typography variant="body1" sx={{ mb: 4, textAlign: 'center' }}>
            {t('profilePagePrompts.verifyEmail.description')}
          </Typography>
          <ProfilePageActionBar actions={profilePageActions} />
        </ProfileSnapTarget>
      ) : completion && completion.overall < MIN_PROFILE_COMPLETION_REQUIRED ? (
        <ProfileSnapTarget snap>
          <Typography variant="h4" component="h1" sx={PAGE_TITLE_SX}>
            {t('profilePagePrompts.incomplete.title')}
          </Typography>
          <Typography variant="body1" sx={{ mb: 4, textAlign: 'center' }}>
            {t('profilePagePrompts.incomplete.description')}
          </Typography>
          <ProfilePageActionBar actions={profilePageActions} />
        </ProfileSnapTarget>
      ) : (
        <ProfileSnapTarget snap>
          <ProfilePageActionBar actions={profilePageActions} />
        </ProfileSnapTarget>
      )}

      <Paper sx={{ p: { xs: 2, sm: 4 }, mb: 4 }} elevation={3}>
        <Grid container spacing={3} alignItems="center">
          <Grid item xs={12} sm={3} md={2}>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                mx: 'auto',
              }}
            >
              <Avatar
                src={personal.profilePicture ? `/uploads/${personal.profilePicture}?v=${profilePictureKey}` : null}
                alt={profileDisplayName || t('profilePage.photo.alt')}
                sx={{
                  width: 96,
                  height: 96,
                  fontSize: 40,
                  bgcolor: 'primary.main',
                  border: '2px solid',
                  borderColor: 'divider',
                }}
                imgProps={{
                  onError: (e) => {
                    console.error('Failed to load profile picture:', personal.profilePicture);
                    e.target.style.display = 'none';
                  },
                }}
              >
                {(!personal.profilePicture && profileDisplayName) ? profileDisplayName[0].toUpperCase() : (!personal.profilePicture && <PersonIcon fontSize="large" />)}
              </Avatar>
              <Tooltip
                title={
                  personal.profilePicture
                    ? t('profilePage.photo.edit')
                    : t('profilePage.photo.add')
                }
              >
                {canEditProfileFields ? (
                <IconButton
                  size="small"
                  onClick={() => setProfilePictureDialogOpen(true)}
                  aria-label={
                    personal.profilePicture
                      ? t('profilePage.photo.edit')
                      : t('profilePage.photo.add')
                  }
                  sx={{ mt: 0.5 }}
                >
                  {personal.profilePicture ? <EditIcon /> : <AddIcon />}
                </IconButton>
                ) : null}
              </Tooltip>
            </Box>
          </Grid>
          <Grid item xs={12} sm={9} md={10}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
                flexWrap: 'wrap',
                width: '100%',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
                <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
                  {profileDisplayName || t('profilePage.nameEditor.placeholderName')}
                </Typography>
                <Tooltip title={t('profilePage.nameEditor.editCta')}>
                  {canEditProfileFields ? (
                  <IconButton
                    size="small"
                    onClick={handleStartEditProfileName}
                    aria-label={t('profilePage.nameEditor.editCta')}
                  >
                    <EditIcon />
                  </IconButton>
                  ) : null}
                </Tooltip>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                {profileCompletionHeader}
                {showLoginSecuritySection && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<LockIcon />}
                    onClick={openLoginSecurityDialog}
                  >
                    {t('profilePage.loginSecurity.title')}
                  </Button>
                )}
              </Box>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* Who are you? (five identity prompts → embedding text) */}
      <Paper ref={userIdentitySectionRef} sx={{ p: { xs: 2, sm: 3 }, mb: 4, ...profileSectionScrollMarginSx }} elevation={1}>
        <ProfileSnapTarget snap>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            <PsychologyIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            {t('profilePage.sections.identity')}
          </Typography>
        </ProfileSnapTarget>
        {identityFieldError && !editIdentityField ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {identityFieldError}
          </Alert>
        ) : null}
        {USER_IDENTITY_FIELDS.map(({ key, questionKey }, idx) => {
          const isEditing = editIdentityField === key;
          const isAnotherFieldEditing = editIdentityField && !isEditing;
          const sectionKey = identitySectionKey(key);
          const bulletItems = parseIdentityFieldToBullets(key, userIdentityAnswers[key]);
          const hasAnswer = bulletItems.length > 0;
          const narrativeReady = hasIdentityNarrative(whoAreYouNarratives, idx);
          const narrativePending = (
            pendingNarrativeFields.includes('who_are_you')
            || whoAreYouNarrativeRegenLoading
          ) && hasAnswer && !narrativeReady;
          const narrativeAvailable = narrativeReady || narrativePending;
          const narrativeOutOfDate = isIdentityFieldNarrativeOutOfDate(
            key,
            userIdentityAnswers,
            p?.who_are_you,
            USER_IDENTITY_FIELDS
          );
          const displayMode = resolveSectionDisplayMode(
            sectionDisplayModes,
            sectionKey,
            narrativeAvailable
          );
          const narrativeText = String(whoAreYouNarratives[idx] || '').trim();
          const question = t(questionKey);
          return (
            <ProfileSnapTarget key={key} snap={idx > 0}>
              <Box
                ref={(el) => {
                  if (el) {
                    identityFieldSectionRefs.current[key] = el;
                  } else {
                    delete identityFieldSectionRefs.current[key];
                  }
                }}
                sx={{ mt: 2, mb: 1, ...profileSectionScrollMarginSx }}
              >
                <Typography
                  variant="body1"
                  sx={{
                    color: '#950202',
                    fontWeight: 600,
                    mb: 1.5,
                  }}
                >
                  {question}
                </Typography>
                {isEditing ? (
                  <>
                    {identityFieldError && (
                      <Alert severity="error" sx={{ mb: 2 }}>
                        {identityFieldError}
                      </Alert>
                    )}
                    {identityFieldCoachingActive ? (
                      <>
                        <ProfileIdentityCoachingEditor
                          fieldKey={key}
                          profileData={p}
                          recommendationContextTexts={
                            key === 'naturallyGoodAt' ? skillDomainRecommendationContext : []
                          }
                          restartKey={identityCoachingRestartKey}
                          onComplete={handleIdentityCoachingComplete}
                          disabled={identityFieldLoading}
                        />
                        <Box
                          sx={{
                            mt: 1.5,
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: 1,
                          }}
                        >
                          <Button
                            variant="outlined"
                            color="error"
                            size="small"
                            startIcon={<CancelIcon />}
                            onClick={handleCancelIdentityField}
                            disabled={identityFieldLoading}
                          >
                            {t('profilePage.actions.cancel')}
                          </Button>
                          <Button
                            variant="text"
                            size="small"
                            onClick={handleBackToIdentityManualEdit}
                            disabled={identityFieldLoading}
                          >
                            {t('profilePage.identityCoaching.backToManualEdit')}
                          </Button>
                        </Box>
                      </>
                    ) : (
                      <>
                        <ProfileIdentityFieldEditor
                          fieldKey={key}
                          draft={identityFieldDraft}
                          onDraftChange={(nextDraft) => {
                            setIdentityFieldDraft(nextDraft);
                            if (identityFieldError) setIdentityFieldError(null);
                          }}
                          disabled={identityFieldLoading}
                          onRestartCoachingChat={handleStartIdentityFieldCoaching}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                          {`${formatIdentityFieldFromEdit(key, identityFieldDraft).length}/${PROFILE_REVIEW_USER_IDENTITY_MAX}`}
                        </Typography>
                        <Box
                          sx={{
                            mt: 1.5,
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: 1,
                          }}
                        >
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<SaveIcon />}
                            onClick={handleSaveIdentityField}
                            disabled={identityFieldLoading}
                          >
                            {t('profilePage.actions.save')}
                          </Button>
                          <Button
                            variant="outlined"
                            color="error"
                            size="small"
                            startIcon={<CancelIcon />}
                            onClick={handleCancelIdentityField}
                            disabled={identityFieldLoading}
                          >
                            {t('profilePage.actions.cancel')}
                          </Button>
                        </Box>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <ProfileSectionViewCarousel
                      mode={displayMode}
                      onChange={(next) => handleSectionDisplayModeChange(sectionKey, next)}
                      narrativeAvailable={narrativeAvailable}
                      bulletsLabel={t('profilePage.displayMode.bullets')}
                      narrativeLabel={t('profilePage.displayMode.narrative')}
                      ariaLabel={t('profilePage.displayMode.ariaLabel')}
                      bulletsContent={(
                        <ProfileBulletList
                          items={bulletItems}
                          emptyLabel={t('profilePage.notProvided')}
                        />
                      )}
                      narrativeContent={(
                        <Box>
                          <Typography variant="body1" component="div">
                            {narrativePending ? (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
                                <CircularProgress size={20} />
                                <Box component="span" sx={{ color: 'text.secondary' }}>
                                  {t('profilePage.displayMode.narrativeLoading')}
                                </Box>
                              </Box>
                            ) : narrativeText || (
                              <Box component="span" sx={{ fontStyle: 'italic' }}>
                                {t('profilePage.notProvided')}
                              </Box>
                            )}
                          </Typography>
                          {canEditProfileFields && narrativeReady && !narrativePending ? (
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<AutoAwesomeIcon />}
                              onClick={() => handleRegenerateWhoAreYouNarrative(key)}
                              disabled={
                                !narrativeOutOfDate
                                || whoAreYouNarrativeRegenLoading
                                || identityFieldLoading
                                || Boolean(editIdentityField)
                                || Boolean(editStructuredCategory)
                              }
                              sx={{ mt: 1.5 }}
                            >
                              {t('profilePage.actions.regenerateAiSummary')}
                            </Button>
                          ) : null}
                        </Box>
                      )}
                    />
                    {canEditProfileFields && (
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<EditIcon />}
                        onClick={() => handleEditIdentityField(key)}
                        disabled={Boolean(isAnotherFieldEditing) || identityFieldLoading || Boolean(editStructuredCategory) || whoAreYouNarrativeRegenLoading}
                        sx={{ mt: 1 }}
                      >
                        {t('profilePage.actions.edit')}
                      </Button>
                    )}
                  </>
                )}
              </Box>
              {idx < USER_IDENTITY_FIELDS.length - 1 ? <Divider sx={{ my: 3 }} /> : null}
            </ProfileSnapTarget>
          );
        })}
      </Paper>

      {/* What are you good at? */}
      <Paper ref={structuredInfoSectionRef} sx={{ p: { xs: 2, sm: 3 }, mb: 4, ...profileSectionScrollMarginSx }} elevation={1}>
        <ProfileSnapTarget snap>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            <AccountTreeIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            {t('profilePage.sections.goodAt')}
          </Typography>
        </ProfileSnapTarget>
        {STRUCTURED_GOOD_AT_SECTIONS.map((section, sectionIdx) => {
          const isEditing = editStructuredCategory === section.arrayKey;
          const isAnotherCategoryEditing = editStructuredCategory && !isEditing;
          const usesDialogEditor = section.editorType !== 'textList';
          const showInlineEditActions = !usesDialogEditor || Boolean(structuredInfoError);
          return (
            <ProfileSnapTarget key={section.uiKey} snap={sectionIdx > 0}>
              <Box
                ref={(el) => {
                  if (el) {
                    structuredCategorySectionRefs.current[section.arrayKey] = el;
                  } else {
                    delete structuredCategorySectionRefs.current[section.arrayKey];
                  }
                }}
                sx={{ mt: 2, mb: 1, ...profileSectionScrollMarginSx }}
              >
                <Typography variant="body1" sx={{ color: '#950202', fontWeight: 600, mb: 1.5 }}>
                  {t(section.titleKey)}
                </Typography>
                {isEditing ? (
                  <>
                    {structuredInfoError && (
                      <Alert severity="error" sx={{ mb: 2 }}>
                        {structuredInfoError}
                      </Alert>
                    )}
                    {!usesDialogEditor ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                        {t('profilePage.structuredInfo.maxEntriesPerCategory', { max: section.maxItems })}
                      </Typography>
                    ) : null}
                    {renderStructuredCategoryEditor(section)}
                    {showInlineEditActions ? (
                      <Box
                        sx={{
                          mt: 1.5,
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 1,
                        }}
                      >
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<SaveIcon />}
                          onClick={() => handleSaveStructuredCategory()}
                          disabled={structuredInfoLoading}
                        >
                          {t('profilePage.actions.save')}
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          size="small"
                          startIcon={<CancelIcon />}
                          onClick={handleCancelStructuredCategory}
                          disabled={structuredInfoLoading}
                        >
                          {t('profilePage.actions.cancel')}
                        </Button>
                      </Box>
                    ) : null}
                  </>
                ) : (
                  <>
                    {renderStructuredCategoryDisplay(section)}
                    {canEditProfileFields && (
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<EditIcon />}
                        onClick={() => handleEditStructuredCategory(section.arrayKey)}
                        disabled={Boolean(isAnotherCategoryEditing) || structuredInfoLoading || Boolean(editIdentityField)}
                        sx={{ mt: 1 }}
                      >
                        {t('profilePage.actions.edit')}
                      </Button>
                    )}
                  </>
                )}
              </Box>
              {sectionIdx < STRUCTURED_GOOD_AT_SECTIONS.length - 1 ? <Divider sx={{ my: 3 }} /> : null}
            </ProfileSnapTarget>
          );
        })}
      </Paper>

      {/* How experienced are you? (seniority data) */}
      <Paper ref={senioritySectionRef} sx={{ p: { xs: 2, sm: 3 }, mb: 4, ...profileSectionScrollMarginSx }} elevation={1}>
        <ProfileSnapTarget snap>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            <WorkHistoryIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            {t('profilePage.sections.experience')}
          </Typography>
        </ProfileSnapTarget>
        {editSection === 'seniority' ? (
          <SeniorityForm
            initialData={editFormData}
            loading={formLoading}
            error={formError}
            onCancel={handleCancel}
            onSubmit={data => handleSaveSeniority(data)}
          />
        ) : (
          <>
            {seniorityDisplayFields.map((field) => (
              <React.Fragment key={field.key}>
                {renderField(
                  field.label,
                  field.value,
                  false,
                  '',
                  { xs: 12, sm: 5, md: 4 },
                  { xs: 12, sm: 7, md: 8 }
                )}
              </React.Fragment>
            ))}
            {canEditProfileFields && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<EditIcon />}
              onClick={handleEditSeniority}
              sx={{ mt: 1 }}
            >
              {t('profilePage.actions.edit')}
            </Button>
            )}
          </>
        )}
      </Paper>

      {/* Career Simulation Inputs */}
      {showCareerSimulationInputs && profile?.profile?.careerSimulationInputs && (
        <Paper ref={careerInputsSectionRef} sx={{ p: { xs: 2, sm: 3 }, mb: 4, ...profileSectionScrollMarginSx }} elevation={1}>
          <ProfileSnapTarget snap>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <PuzzlePieceIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">{t('profilePage.careerInputs.title')}</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('profilePage.careerInputs.description')}
              <br />
              <strong>{t('profilePage.careerInputs.tipLabel')}</strong> {t('profilePage.careerInputs.tipDescription')}
            </Typography>
            {!editCareerInputs && canEditProfileFields && (
              <Box sx={{ display: 'flex', gap: 1, mt: 1, mb: 2 }}>
                <Button
                  variant="outlined"
                  startIcon={<EditIcon />}
                  onClick={handleEditCareerInputs}
                >
                  Edit
                </Button>
              </Box>
            )}
          </ProfileSnapTarget>
          {careerInputsError && <Alert severity="error" sx={{ mb: 2 }}>{careerInputsError}</Alert>}
          {!editCareerInputs && (
            <ProfileSnapTarget snap={false}>
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                  {t('profilePage.careerInputs.embeddingIdentityLabel')}
                </Typography>
                <Typography
                  variant="body2"
                  color={careerInputsIdentityEmbeddingText ? 'text.primary' : 'text.disabled'}
                  sx={{ whiteSpace: 'pre-wrap' }}
                >
                  {careerInputsIdentityEmbeddingText || <span style={{ fontStyle: 'italic' }}>{t('profilePage.careerInputs.notAvailableYet')}</span>}
                </Typography>
              </Box>
            </ProfileSnapTarget>
          )}
          {editCareerInputs ? (
            <Box>
              {/* What are you good at? */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>{t('profilePage.sections.goodAt')}</Typography>
                {renderEditableChips(
                  'structuredUserInfo.skillDomains',
                  t('profilePage.structuredInfo.strengths.title'),
                  t('profilePage.careerInputs.editablePlaceholders.strengths'),
                  'default'
                )}
                {renderEditableChips(
                  'structuredUserInfo.domains',
                  t('profilePage.structuredInfo.industrySectors.title'),
                  t('profilePage.careerInputs.editablePlaceholders.industrySectors'),
                  'success'
                )}
              </Box>
              {renderEditableChips('structuredUserInfo.keyResponsibilities', t('profilePage.structuredInfo.responsibilities.title'), t('profilePage.careerInputs.editablePlaceholders.responsibilities'), 'secondary')}
              {renderEditableChips('structuredUserInfo.skills', t('profilePage.structuredInfo.skills.title'), t('profilePage.careerInputs.editablePlaceholders.skills'), 'primary')}
              {renderEditableChips('structuredUserInfo.skillsInDevelopment', t('profilePage.structuredInfo.learningGoals.title'), t('profilePage.careerInputs.editablePlaceholders.learningGoals'), 'secondary')}

              {/* Experience / seniority sub-vector (career simulation inputs) */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>{t('profilePage.sections.experience')}</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <TextField
                    select
                    label={t('profilePage.seniority.currentEmploymentStatus')}
                    size="small"
                    value={careerInputsDraft.seniority?.currentStatus || ''}
                    onChange={e => handleChangeCareerInputs('seniority', { ...careerInputsDraft.seniority, currentStatus: e.target.value })}
                    sx={{ minWidth: 140 }}
                  >
                    <MenuItem value="">—</MenuItem>
                    {CURRENT_EMPLOYMENT_STATUS_OPTIONS.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    type="number"
                    label="Years of Experience"
                    size="small"
                    value={careerInputsDraft.seniority?.yearsOfExperience ?? ''}
                    onChange={e => handleChangeCareerInputs('seniority', { ...careerInputsDraft.seniority, yearsOfExperience: e.target.value === '' ? null : Number(e.target.value) })}
                    inputProps={{ min: 0, max: 50 }}
                    sx={{ minWidth: 120 }}
                  />
                  <TextField
                    select
                    label="Highest Degree"
                    size="small"
                    value={careerInputsDraft.seniority?.highestDegree || ''}
                    onChange={e => handleChangeCareerInputs('seniority', { ...careerInputsDraft.seniority, highestDegree: e.target.value })}
                    sx={{ minWidth: 140 }}
                  >
                    <MenuItem value="">—</MenuItem>
                    {HIGHEST_DEGREE_OPTIONS.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {formatHighestDegree(opt.value)}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="Most Senior Role"
                    size="small"
                    value={careerInputsDraft.seniority?.mostSeniorWorkExperience || ''}
                    onChange={e => handleChangeCareerInputs('seniority', { ...careerInputsDraft.seniority, mostSeniorWorkExperience: e.target.value })}
                    sx={{ minWidth: 140 }}
                  >
                    <MenuItem value="">—</MenuItem>
                    <MenuItem value="intern">Intern</MenuItem>
                    <MenuItem value="entry_level">Entry level</MenuItem>
                    <MenuItem value="mid_level">Mid-level</MenuItem>
                    <MenuItem value="senior">Senior</MenuItem>
                    <MenuItem value="lead">Lead</MenuItem>
                    <MenuItem value="manager">Manager</MenuItem>
                    <MenuItem value="director">Director</MenuItem>
                    <MenuItem value="vp">VP</MenuItem>
                    <MenuItem value="c_suite">C-Suite</MenuItem>
                  </TextField>
                </Box>
              </Box>

              <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                <Button variant="contained" color="primary" onClick={handleSaveCareerInputs} disabled={careerInputsLoading}>{t('profilePage.actions.save')}</Button>
                <Button variant="outlined" onClick={handleCancelCareerInputs} disabled={careerInputsLoading}>{t('profilePage.actions.cancel')}</Button>
              </Box>
            </Box>
          ) : (
            <>
              {[
                {
                  key: 'strengths',
                  snap: true,
                  title: t('profilePage.careerInputs.strengthsLabel'),
                  content: (() => {
                    const csiStructured = profile.profile.careerSimulationInputs?.structuredUserInfo || {};
                    const strengthChips = getRawItems(csiStructured.skillDomains);
                    if (strengthChips.length === 0) {
                      return (
                        <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                          {t('profilePage.careerInputs.empty.strengths')}
                        </Typography>
                      );
                    }
                    return (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: PROFILE_CHIP_GAP }}>
                        {strengthChips.map((label, idx) => {
                          const resolvedLabel = chipLabelFromGoodAtItem(label);
                          return (
                            <SkillDomainChip
                              key={idx}
                              label={resolvedLabel}
                              domainKey={resolvedLabel}
                            />
                          );
                        })}
                      </Box>
                    );
                  })(),
                },
                {
                  key: 'occupationGroup',
                  snap: true,
                  title: t('profilePage.careerInputs.occupationGroupLabel'),
                  content: (() => {
                    const s = profile.profile.careerSimulationInputs.structuredUserInfo || {};
                    const csiDomains = getRawItems(s.domains);
                    if (csiDomains.length === 0) {
                      return (
                        <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                          {t('profilePage.careerInputs.empty.industrySectors')}
                        </Typography>
                      );
                    }
                    return (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: PROFILE_CHIP_GAP }}>
                        {csiDomains.map((domain, idx) => (
                          <IndustrySectorChip key={`domain-${idx}`} value={domain} lang={currentLang} />
                        ))}
                      </Box>
                    );
                  })(),
                },
                {
                  key: 'responsibilities',
                  snap: true,
                  title: t('profilePage.careerInputs.responsibilitiesLabel'),
                  content: getRawItems(profile.profile.careerSimulationInputs.structuredUserInfo?.keyResponsibilities).length > 0 ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {getRawItems(profile.profile.careerSimulationInputs.structuredUserInfo?.keyResponsibilities).map((resp, respIdx) => (
                        <Chip key={respIdx} label={resp} size="small" variant="outlined" />
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                      {t('profilePage.careerInputs.empty.responsibilities')}
                    </Typography>
                  ),
                },
                {
                  key: 'skills',
                  snap: true,
                  title: t('profilePage.careerInputs.requiredSkillsLabel'),
                  content: getRawItems(profile.profile.careerSimulationInputs.structuredUserInfo?.skills).length > 0 ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: PROFILE_CHIP_GAP }}>
                      {getRawItems(profile.profile.careerSimulationInputs.structuredUserInfo?.skills).map((skill, idx) => {
                        const label = chipLabelFromGoodAtItem(skill);
                        return (
                          <SkillChip key={idx} label={label} skillKey={label} />
                        );
                      })}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                      {t('profilePage.careerInputs.empty.skills')}
                    </Typography>
                  ),
                },
                {
                  key: 'learningGoals',
                  snap: true,
                  title: t('profilePage.careerInputs.skillsInDevelopmentLabel'),
                  content: getRawItems(profile.profile.careerSimulationInputs.structuredUserInfo?.skillsInDevelopment).length > 0 ? (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: PROFILE_CHIP_GAP }}>
                      {getRawItems(profile.profile.careerSimulationInputs.structuredUserInfo?.skillsInDevelopment).map((skill, idx) => {
                        const label = chipLabelFromGoodAtItem(skill);
                        return (
                          <SkillChip key={idx} label={label} skillKey={label} />
                        );
                      })}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                      {t('profilePage.careerInputs.empty.learningGoals')}
                    </Typography>
                  ),
                },
                {
                  key: 'optionalSkills',
                  snap: true,
                  title: t('profilePage.careerInputs.optionalSkillsLabel'),
                  content: (() => {
                    const required = getRawItems(profile.profile.careerSimulationInputs.structuredUserInfo?.skills);
                    const learning = getRawItems(profile.profile.careerSimulationInputs.structuredUserInfo?.skillsInDevelopment);
                    const merged = [...new Set(
                      [...required, ...learning]
                        .map((v) => normalizeStructuredListItemLabel(v, currentLang))
                        .filter(Boolean)
                    )];
                    if (merged.length === 0) {
                      return (
                        <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                          {t('profilePage.careerInputs.empty.optionalSkills')}
                        </Typography>
                      );
                    }
                    return (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: PROFILE_CHIP_GAP }}>
                        {merged.map((skill, idx) => {
                          const label = chipLabelFromGoodAtItem(skill);
                          return (
                            <SkillChip key={`optional-skill-${idx}`} label={label} skillKey={label} />
                          );
                        })}
                      </Box>
                    );
                  })(),
                },
                {
                  key: 'seniority',
                  snap: true,
                  title: t('profilePage.careerInputs.seniorityLabel'),
                  titleSx: { mb: 1 },
                  content: (() => {
                    const s = profile.profile.careerSimulationInputs.seniority;
                    const hasAny = s && (s.currentStatus || s.yearsOfExperience != null || s.highestDegree || s.mostSeniorWorkExperience);
                    if (!hasAny) {
                      return (
                        <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                          {t('profilePage.careerInputs.empty.experience')}
                        </Typography>
                      );
                    }
                    const parts = [];
                    if (s.currentStatus) parts.push(formatCurrentEmploymentStatus(s.currentStatus));
                    if (s.yearsOfExperience != null) parts.push(t('profilePage.seniority.yearsValue', { count: s.yearsOfExperience }));
                    if (s.highestDegree) parts.push(formatHighestDegree(s.highestDegree));
                    if (s.mostSeniorWorkExperience) parts.push(formatMostSeniorWorkExperience(s.mostSeniorWorkExperience));
                    return (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {parts.map((p, i) => (
                          <Chip key={i} label={p} size="small" variant="outlined" />
                        ))}
                      </Box>
                    );
                  })(),
                },
              ].map(({ key, snap, title, content, titleSx }) => (
                <ProfileSnapTarget key={key} snap={snap}>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5, ...titleSx }}>
                      {title}
                    </Typography>
                    {content}
                  </Box>
                </ProfileSnapTarget>
              ))}
              {profile.profile.careerSimulationInputs.lastManualEdit && (
                <Typography variant="caption" color="text.disabled">
                  {t('profilePage.careerInputs.lastManuallyEdited', { date: new Date(profile.profile.careerSimulationInputs.lastManualEdit).toLocaleString() })}
                </Typography>
              )}
              {profile.profile.careerSimulationInputs.lastCalculated && (
                <Typography variant="caption" color="text.disabled">
                  {t('profilePage.careerInputs.lastAutoCalculated', { date: new Date(profile.profile.careerSimulationInputs.lastCalculated).toLocaleString() })}
                </Typography>
              )}
            </>
          )}
        </Paper>
      )}

      {/* Documents */}
      <Paper
        sx={{ p: { xs: 2, sm: 3 }, mb: 4, width: '100%', maxWidth: '100%', overflow: 'hidden' }}
        elevation={1}
      >
        <ProfileSnapTarget snap>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            <DescriptionIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            {t('profilePage.documents.title')}
          </Typography>
        </ProfileSnapTarget>
        {cvReviewError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setCvReviewError(null)}>
            {cvReviewError}
          </Alert>
        )}
        <ProfileDocumentList
          documents={documents ? documents.map((doc) => ({ ...doc, id: doc.id || doc._id })) : []}
          onDocumentsUpdate={handleDocumentsUpdate}
          disabled={!canEditProfileFields || loading || savingCvReview}
          onOpenReview={canEditProfileFields ? (docId) => setDocumentReviewDocId(String(docId)) : undefined}
        />
      </Paper>

      {documentReviewDocId && (
        <Suspense fallback={null}>
          <DocumentUploadForm
            enableExtractionReview
            hideDocumentList
            openReviewForDocumentId={documentReviewDocId}
            restrictAutoResumeToDocumentId={documentReviewDocId}
            documents={documents ? documents.map((doc) => ({ ...doc, id: doc.id || doc._id })) : []}
            onDocumentsUpdate={handleDocumentsUpdate}
            onExtractedProfileReview={handleExtractedProfileReview}
            onReviewSessionEnd={() => setDocumentReviewDocId(null)}
            loading={loading}
            parentSavingReview={savingCvReview}
            showSectionTitle={false}
            reviewSaveMode="merge"
          />
        </Suspense>
      )}

      {showLoginSecuritySection && (
        <Dialog
          open={loginSecurityDialogOpen}
          onClose={() => setLoginSecurityDialogOpen(false)}
          maxWidth="sm"
          fullWidth
          scroll="paper"
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LockIcon color="primary" />
            {t('profilePage.loginSecurity.title')}
          </DialogTitle>
          <DialogContent dividers>
            <LoginSecuritySection
              layout="dialog"
              loginSecurity={loginSecurity.data}
              loading={loginSecurity.loading}
              error={loginSecurity.error}
              onRefresh={fetchLoginSecurity}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setLoginSecurityDialogOpen(false)}>{t('profilePage.actions.close')}</Button>
          </DialogActions>
        </Dialog>
      )}

      <Dialog
        open={profileNameDialogOpen}
        onClose={handleCancelEditProfileName}
        maxWidth="sm"
        fullWidth
        aria-labelledby="profile-name-dialog-title"
      >
        <DialogTitle id="profile-name-dialog-title">{t('profilePage.nameEditor.editCta')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label={t('profilePage.nameEditor.label')}
            fullWidth
            variant="outlined"
            value={profileNameDraft}
            onChange={(e) => {
              setProfileNameDraft(e.target.value);
              if (profileNameError) setProfileNameError(null);
            }}
            error={!!profileNameError}
            helperText={profileNameError || t('profilePage.nameEditor.helper')}
            disabled={profileNameLoading}
            sx={{ mb: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelEditProfileName} disabled={profileNameLoading}>
            {t('profilePage.actions.cancel')}
          </Button>
          <Button
            onClick={handleSaveProfileName}
            variant="contained"
            color="primary"
            disabled={!profileNameDraft.trim() || profileNameLoading}
          >
            {t('profilePage.actions.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Profile Picture Editor Dialog */}
      <ProfilePictureEditor
        open={profilePictureDialogOpen}
        onClose={() => setProfilePictureDialogOpen(false)}
        currentPicture={personal.profilePicture}
        onPictureUpdate={async (newPicture) => {
          // Close dialog first
          setProfilePictureDialogOpen(false);
          
          // Update cache key to force image reload
          setProfilePictureKey(prev => prev + 1);
          
          // Update profile state immediately with new picture
          setProfile(prev => ({
            ...prev,
            profile: {
              ...prev.profile,
              personalInfo: {
                ...prev.profile.personalInfo,
                profilePicture: newPicture
              }
            }
          }));

          await fetchProfile({ force: true });
          setProfilePictureKey(prev => prev + 1);
        }}
      />
    </Box>
  );
};

export default Profile; 