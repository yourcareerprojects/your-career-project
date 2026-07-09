import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Typography, Paper, Alert, Button } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import DocumentUploadForm from '../profile/DocumentUploadForm';
import { USER_IDENTITY_FIELDS } from '../../constants/userIdentityFields';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import {
  baseUILanguage,
  refreshSeededFullProfileInBackground,
} from '../../hooks/useProfileQueries';
import { buildReviewSaveUserMessage, saveExtractedProfileReview } from '../../utils/profileReviewSaveFlow';
import { clearCvReviewDraft } from '../../utils/cvReviewDraftStorage';
import { clearManualFillDraft } from '../../utils/manualFillDraftStorage';
import { markProfileSaveCelebration } from '../../utils/profileSaveCelebration';
import PageHeader from '../common/PageHeader';

const ProfileCreation = () => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const location = useLocation();
  const fullUpdateMode = new URLSearchParams(location.search).get('mode') === 'full-update';
  const { user } = useAuth();
  const [error, setError] = useState(null);
  const [profileExists, setProfileExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [documents, setDocuments] = useState([]);
  const getRawItems = (value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && Array.isArray(value.raw_items)) return value.raw_items;
    return [];
  };

  useEffect(() => {
    // Check if user is verified
    if (!user?.isVerified) {
      setError(t('profileCreation.errors.verifyEmailRequired'));
      setLoading(false);
      return;
    }
    // Check if user already has a profile
    const fetchProfile = async () => {
      try {
        const res = await fetch(`/api/profile?${getProfileApiLangQuery()}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (res.ok) {
          const data = await res.json();
          const p = data?.profile || {};
          const uid = p?.userIdentity && typeof p.userIdentity === 'object' ? p.userIdentity : {};
          const hasCompleteIdentity = USER_IDENTITY_FIELDS.every(({ key }) => String(uid[key] || '').trim());
          const structured = p?.structuredUserInfo || {};
          const hasStructuredData = Boolean(
            getRawItems(structured?.skills).length > 0 ||
            getRawItems(structured?.skillsInDevelopment).length > 0 ||
            getRawItems(structured?.keyResponsibilities).length > 0 ||
            getRawItems(structured?.domains).length > 0
          );
          const seniority = p?.seniority || {};
          const hasSeniorityData = Boolean(
            String(seniority?.currentStatus || '').trim() ||
            seniority?.yearsOfExperience !== null && seniority?.yearsOfExperience !== undefined ||
            String(seniority?.highestDegree || '').trim() ||
            String(seniority?.mostSeniorWorkExperience || '').trim()
          );
          const hasProfileData = hasCompleteIdentity && (hasStructuredData || hasSeniorityData);
          if (data.profile && hasProfileData) {
            setProfileExists(true);
          }
        }
      } catch (err) {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [user]);

  // Save reviewed profile payload coming from extraction dialog.
  const handleExtractedProfileReview = async (profileData) => {
    setSavingProfile(true);
    setError(null);
    const langQuery = getProfileApiLangQuery();
    const reviewUserId = String(user?.id || user?._id || '').trim();
    try {
      // Seed only (review-save response) — Profile page renders from cache immediately and
      // refetches GET /api/profile once in the background (_seededFromReviewSave path).
      const { reviewSaveData } = await saveExtractedProfileReview({
        profileData,
        fetchImpl: fetch,
        getAuthToken: () => localStorage.getItem('token'),
        langQuery,
        translate: t,
        prefetchProfile: false,
      });

      if (reviewUserId) {
        clearCvReviewDraft(reviewUserId);
        clearManualFillDraft(reviewUserId);
      }
      setProfileExists(true);
      markProfileSaveCelebration();
      void refreshSeededFullProfileInBackground(baseUILanguage()).catch((profileErr) => {
        console.error('Profile background refresh after review-save failed:', profileErr);
      });
      navigate('/profile', {
        replace: true,
        state: {
          celebrateProfileSaved: true,
          narrativePending: reviewSaveData?.narrativePending,
        },
      });
    } catch (err) {
      setError(buildReviewSaveUserMessage(err, t));
      throw err;
    } finally {
      setSavingProfile(false);
    }
  };

  if (loading) {
    return <Box sx={{ p: 3 }}><Typography>{t('profileCreation.loading')}</Typography></Box>;
  }

  if (profileExists && !fullUpdateMode) {
    return (
      <Box sx={{ p: 3 }}>
        <Paper sx={{ p: 3, mb: 3 }}>
          <PageHeader
            title={t('profileCreation.alreadyCreated.title')}
            description={t('profileCreation.alreadyCreated.description')}
          />
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <Button variant="contained" onClick={() => navigate('/profile')}>
              {t('profileCreation.alreadyCreated.goToProfileCta')}
            </Button>
          </Box>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {savingProfile && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('profileCreation.savingProfile')}
        </Alert>
      )}
      <PageHeader
        title={fullUpdateMode ? t('profileCreation.fullUpdate.title') : t('profileCreation.default.title')}
        description={
          fullUpdateMode
            ? t('profileCreation.fullUpdate.description')
            : t('profileCreation.default.description')
        }
      />
      <Box sx={{ maxWidth: 640, mx: 'auto', width: '100%' }}>
        <DocumentUploadForm
          onExtractedProfileReview={handleExtractedProfileReview}
          documents={documents}
          onDocumentsUpdate={setDocuments}
          loading={loading}
          parentSavingReview={savingProfile}
          enableExtractionReview
          defaultDocumentType="resume"
          showSectionTitle={false}
          reviewSaveMode={fullUpdateMode ? 'replace' : 'merge'}
          showManualFillOption
          manualFillOnly
        />
      </Box>
    </Box>
  );
};

export default ProfileCreation; 