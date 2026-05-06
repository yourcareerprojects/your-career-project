import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Typography, Paper, Alert, Button } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import DocumentUploadForm from '../profile/DocumentUploadForm';
import { USER_IDENTITY_FIELDS } from '../../constants/userIdentityFields';
import { invalidateFullProfileQuery, invalidateProfileCompletionQuery } from '../../hooks/useProfileQueries';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';

/** Ensures profile PUTs surface failures instead of navigating away with stale React Query cache. */
async function throwIfSaveNotOk(res) {
  if (res.ok) return;
  let message = `Request failed (${res.status})`;
  try {
    const data = await res.json();
    const fromServer =
      (typeof data?.message === 'string' && data.message.trim()) ||
      (typeof data?.error === 'string' && data.error.trim()) ||
      (Array.isArray(data?.errors) && data.errors[0] && String(data.errors[0].msg || '').trim());
    if (fromServer) message = fromServer;
  } catch (_) {
    /* ignore JSON parse errors */
  }
  throw new Error(message);
}

const ProfileCreation = () => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const location = useLocation();
  const fullUpdateMode = new URLSearchParams(location.search).get('mode') === 'full-update';
  const { user } = useAuth();
  const [error, setError] = useState(null);
  const [profileExists, setProfileExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState([]);
  const mergeUniqueStrings = (a = [], b = []) => [...new Set([...(a || []), ...(b || [])].map((v) => String(v || '').trim()).filter(Boolean))];
  const getRawItems = (value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && Array.isArray(value.raw_items)) return value.raw_items;
    return [];
  };

  useEffect(() => {
    // Check if user is verified
    if (!(user?.emailVerified || user?.isVerified)) {
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
    setLoading(true);
    setError(null);
    try {
      const structuredUserInfo = profileData?.structuredUserInfo || {};
      const extractedSeniority = profileData?.seniority || {};
      const userIdentity = profileData?.userIdentity || {};
      const reviewMode = profileData?.__reviewOptions?.mode || 'merge';
      const cvBlob =
        profileData?.__cvExtractLocalization && typeof profileData.__cvExtractLocalization === 'object'
          ? profileData.__cvExtractLocalization
          : null;
      const identityCvExtractPatch = cvBlob
        ? {
            ...(cvBlob.documentLanguage ? { documentLanguage: cvBlob.documentLanguage } : {}),
            ...(cvBlob.userIdentity && typeof cvBlob.userIdentity === 'object'
              ? { userIdentity: cvBlob.userIdentity }
              : {}),
          }
        : null;
      const structuredCvExtractPatch = cvBlob
        ? {
            ...(cvBlob.documentLanguage ? { documentLanguage: cvBlob.documentLanguage } : {}),
            ...(cvBlob.structuredUserInfo && typeof cvBlob.structuredUserInfo === 'object'
              ? { structuredUserInfo: cvBlob.structuredUserInfo }
              : {}),
          }
        : null;

      const currentProfileRes = await fetch(`/api/profile?${getProfileApiLangQuery()}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      await throwIfSaveNotOk(currentProfileRes);
      const currentProfileData = await currentProfileRes.json();
      const existingStructured = currentProfileData?.profile?.structuredUserInfo || {};
      const existingIdentity = currentProfileData?.profile?.userIdentity || {};
      const existingSeniority = currentProfileData?.profile?.seniority || {};
      if (!USER_IDENTITY_FIELDS.every(({ key }) => String(userIdentity[key] || '').trim())) {
        setError(t('profileCreation.errors.identityQuestionsRequired'));
        setLoading(false);
        return;
      }

      if (profileData?.name?.trim()) {
        const nameRes = await fetch(`/api/profile/name?${getProfileApiLangQuery()}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({ name: profileData.name.trim() })
        });
        await throwIfSaveNotOk(nameRes);
      }

      const structuredRes = await fetch(`/api/profile/structured-user-info?${getProfileApiLangQuery()}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          ...(structuredCvExtractPatch && Object.keys(structuredCvExtractPatch).length > 0
            ? { cvExtractLocalization: structuredCvExtractPatch }
            : {}),
          skillDomains: reviewMode === 'merge'
            ? mergeUniqueStrings(
              getRawItems(existingStructured.skillDomains),
              Array.isArray(structuredUserInfo.skillDomains) ? structuredUserInfo.skillDomains.filter(Boolean) : []
            )
            : (Array.isArray(structuredUserInfo.skillDomains) ? structuredUserInfo.skillDomains.filter(Boolean) : []),
          skills: reviewMode === 'merge'
            ? mergeUniqueStrings(
              getRawItems(existingStructured.skills),
              Array.isArray(structuredUserInfo.skills)
                ? structuredUserInfo.skills.map((skill) => (typeof skill === 'string' ? skill : skill?.name)).filter(Boolean)
                : []
            )
            : (Array.isArray(structuredUserInfo.skills)
            ? structuredUserInfo.skills.map((skill) => (typeof skill === 'string' ? skill : skill?.name)).filter(Boolean)
            : []),
          skillsInDevelopment: reviewMode === 'merge'
            ? mergeUniqueStrings(
              getRawItems(existingStructured.skillsInDevelopment),
              Array.isArray(structuredUserInfo.skillsInDevelopment) ? structuredUserInfo.skillsInDevelopment.filter(Boolean) : []
            )
            : (Array.isArray(structuredUserInfo.skillsInDevelopment)
            ? structuredUserInfo.skillsInDevelopment.filter(Boolean)
            : []),
          keyResponsibilities: reviewMode === 'merge'
            ? mergeUniqueStrings(
              getRawItems(existingStructured.keyResponsibilities),
              Array.isArray(structuredUserInfo.keyResponsibilities) && structuredUserInfo.keyResponsibilities.length > 0
                ? structuredUserInfo.keyResponsibilities.filter(Boolean)
                : (Array.isArray(structuredUserInfo.workExperience)
                  ? structuredUserInfo.workExperience.map((item) => String(item?.description || '').trim()).filter(Boolean)
                  : [])
            )
            : (Array.isArray(structuredUserInfo.keyResponsibilities) && structuredUserInfo.keyResponsibilities.length > 0
            ? structuredUserInfo.keyResponsibilities.filter(Boolean)
            : (Array.isArray(structuredUserInfo.workExperience)
              ? structuredUserInfo.workExperience
                .map((item) => String(item?.description || '').trim())
                .filter(Boolean)
              : [])),
          domains: reviewMode === 'merge'
            ? mergeUniqueStrings(
              getRawItems(existingStructured.domains),
              Array.isArray(structuredUserInfo.domains) ? structuredUserInfo.domains.filter(Boolean) : []
            )
            : (Array.isArray(structuredUserInfo.domains) ? structuredUserInfo.domains.filter(Boolean) : [])
        })
      });
      await throwIfSaveNotOk(structuredRes);

      const identityRes = await fetch(`/api/profile/user-identity?${getProfileApiLangQuery()}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          ...(identityCvExtractPatch && Object.keys(identityCvExtractPatch).length > 0
            ? { cvExtractLocalization: identityCvExtractPatch }
            : {}),
          workEnjoyMost: reviewMode === 'merge' ? (userIdentity.workEnjoyMost || existingIdentity.workEnjoyMost || '') : (userIdentity.workEnjoyMost || ''),
          topicsIndustriesInterest: reviewMode === 'merge' ? (userIdentity.topicsIndustriesInterest || existingIdentity.topicsIndustriesInterest || '') : (userIdentity.topicsIndustriesInterest || ''),
          naturallyGoodAt: reviewMode === 'merge' ? (userIdentity.naturallyGoodAt || existingIdentity.naturallyGoodAt || '') : (userIdentity.naturallyGoodAt || ''),
          workEnvironmentFit: reviewMode === 'merge' ? (userIdentity.workEnvironmentFit || existingIdentity.workEnvironmentFit || '') : (userIdentity.workEnvironmentFit || ''),
          workingLifeAchievement: reviewMode === 'merge' ? (userIdentity.workingLifeAchievement || existingIdentity.workingLifeAchievement || '') : (userIdentity.workingLifeAchievement || '')
        })
      });
      await throwIfSaveNotOk(identityRes);

      if (
        extractedSeniority.currentStatus ||
        extractedSeniority.yearsOfExperience !== undefined ||
        extractedSeniority.highestDegree ||
        extractedSeniority.mostSeniorWorkExperience
      ) {
        const seniorityRes = await fetch(`/api/profile/seniority?${getProfileApiLangQuery()}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({
            currentStatus: reviewMode === 'merge'
              ? (extractedSeniority.currentStatus || existingSeniority.currentStatus || 'other')
              : (extractedSeniority.currentStatus || 'other'),
            yearsOfExperience: reviewMode === 'merge'
              ? (extractedSeniority.yearsOfExperience ?? existingSeniority.yearsOfExperience)
              : extractedSeniority.yearsOfExperience,
            highestDegree: reviewMode === 'merge'
              ? (extractedSeniority.highestDegree || existingSeniority.highestDegree || '')
              : (extractedSeniority.highestDegree || ''),
            mostSeniorWorkExperience: reviewMode === 'merge'
              ? (extractedSeniority.mostSeniorWorkExperience || existingSeniority.mostSeniorWorkExperience || '')
              : (extractedSeniority.mostSeniorWorkExperience || '')
          })
        });
        await throwIfSaveNotOk(seniorityRes);
      }
      setProfileExists(true);
      invalidateProfileCompletionQuery();
      await invalidateFullProfileQuery();
      navigate('/profile');
    } catch (err) {
      const detail = err && typeof err.message === 'string' ? err.message : '';
      setError(detail ? `${t('profileCreation.errors.saveFailed')} ${detail}` : t('profileCreation.errors.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <Box sx={{ p: 3 }}><Typography>{t('profileCreation.loading')}</Typography></Box>;
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
      </Box>
    );
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