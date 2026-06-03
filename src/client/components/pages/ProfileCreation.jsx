import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Typography, Paper, Alert, Button } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import DocumentUploadForm from '../profile/DocumentUploadForm';
import { USER_IDENTITY_FIELDS } from '../../constants/userIdentityFields';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import { buildReviewSaveUserMessage, saveExtractedProfileReview } from '../../utils/profileReviewSaveFlow';
import { clearCvReviewDraft } from '../../utils/cvReviewDraftStorage';

const ProfileCreation = () => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const location = useLocation();
  const fullUpdateMode = new URLSearchParams(location.search).get('mode') === 'full-update';
  const { user, refreshUser } = useAuth();
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
      await saveExtractedProfileReview({
        profileData,
        refreshUser,
        fetchImpl: fetch,
        getAuthToken: () => localStorage.getItem('token'),
        langQuery,
        translate: t,
        prefetchProfile: true,
      });

      if (reviewUserId) clearCvReviewDraft(reviewUserId);
      setProfileExists(true);
      navigate('/profile');
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
          <Typography variant="h4" component="h1" gutterBottom>
            {t('profileCreation.alreadyCreated.title')}
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            {t('profileCreation.alreadyCreated.description')}
          </Typography>
          <Button variant="contained" onClick={() => navigate('/profile')}>
            {t('profileCreation.alreadyCreated.goToProfileCta')}
          </Button>
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
      <Typography variant="h4" component="h1" sx={{ mb: 3, fontWeight: 700, textAlign: 'center' }}>
        {fullUpdateMode ? t('profileCreation.fullUpdate.title') : t('profileCreation.default.title')}
      </Typography>
      <Typography variant="body1" sx={{ mb: 4, textAlign: 'center' }}>
        {fullUpdateMode
          ? t('profileCreation.fullUpdate.description')
          : t('profileCreation.default.description')}
      </Typography>
      <DocumentUploadForm
        onExtractedProfileReview={handleExtractedProfileReview}
        documents={documents}
        onDocumentsUpdate={setDocuments}
        loading={loading}
        parentSavingReview={savingProfile}
        enableExtractionReview
        defaultDocumentType="resume"
        rollbackOnReviewCancel
        showSectionTitle={false}
        reviewSaveMode={fullUpdateMode ? 'replace' : 'merge'}
      />
    </Box>
  );
};

export default ProfileCreation; 