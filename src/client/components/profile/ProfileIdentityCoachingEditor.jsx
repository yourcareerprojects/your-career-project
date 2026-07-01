import React, { useCallback, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import WorkEnjoyMostCoaching from './WorkEnjoyMostCoaching';
import TopicsIndustriesCoaching, { formatInterestTopicsAsText } from './TopicsIndustriesCoaching';
import NaturallyGoodAtCoaching, { formatNaturallyGoodAtAsText } from './NaturallyGoodAtCoaching';
import WorkEnvironmentCoaching from './WorkEnvironmentCoaching';
import WorkingLifeAchievementCoaching from './WorkingLifeAchievementCoaching';
import { getProfileStructuredListMaxItems } from '../../../constants/profileReviewFieldLimits';
import { normalizeIndustryDomains } from '../../../constants/industries';

const COACHING_INTRO_KEYS = {
  workEnjoyMost: 'workEnjoyCoaching.chat.intro',
  topicsIndustriesInterest: 'topicsIndustriesCoaching.chat.intro',
  naturallyGoodAt: 'naturallyGoodAtCoaching.chat.intro',
  workEnvironmentFit: 'workEnvironmentCoaching.chat.intro',
  workingLifeAchievement: 'workingLifeAchievementCoaching.chat.intro',
};

const COACHING_LAYOUT = 'page';

function capStructuredList(items, arrayKey) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, getProfileStructuredListMaxItems(arrayKey));
}

function buildCoachingCvContextFromProfile(profileData) {
  if (!profileData || typeof profileData !== 'object') return null;
  const userIdentity = profileData.userIdentity || profileData.userIdentityAnswers || {};
  const structuredUserInfo = profileData.structuredUserInfo || {};
  const seniority = profileData.seniority || {};
  const hasIdentityHints = Object.values(userIdentity).some((value) => String(value || '').trim());
  const hasStructured = ['skillDomains', 'domains', 'skills', 'keyResponsibilities', 'skillsInDevelopment']
    .some((key) => Array.isArray(structuredUserInfo[key]) && structuredUserInfo[key].length > 0);
  const hasSeniority = Object.values(seniority).some((value) => value != null && value !== '');
  if (!hasIdentityHints && !hasStructured && !hasSeniority) return null;
  return {
    seniority,
    structuredUserInfo,
    identityHints: userIdentity,
  };
}

/**
 * Coaching chat for a single "Who are you?" identity field on the profile page.
 */
const ProfileIdentityCoachingEditor = ({
  fieldKey,
  profileData,
  recommendationContextTexts = [],
  restartKey = 0,
  onComplete,
  disabled = false,
}) => {
  const { t } = useTranslation('onboarding');
  const seniority = profileData?.seniority || {};
  const cvContext = useMemo(() => buildCoachingCvContextFromProfile(profileData), [profileData]);
  const introKey = COACHING_INTRO_KEYS[fieldKey];

  const handleComplete = useCallback((formattedText, structuredPatch = null) => {
    onComplete?.({
      fieldKey,
      formattedText: String(formattedText || '').trim(),
      structuredPatch,
    });
  }, [fieldKey, onComplete]);

  const renderCoaching = () => {
    switch (fieldKey) {
      case 'workEnjoyMost':
        return (
          <WorkEnjoyMostCoaching
            layout={COACHING_LAYOUT}
            seniority={seniority}
            cvContext={cvContext}
            initialActivities={[]}
            initialMessages={[]}
            onComplete={(_activities, formattedText) => handleComplete(formattedText)}
          />
        );
      case 'topicsIndustriesInterest':
        return (
          <TopicsIndustriesCoaching
            layout={COACHING_LAYOUT}
            seniority={seniority}
            cvContext={cvContext}
            initialInterestTopics={[]}
            initialIndustries={[]}
            initialMessages={[]}
            onComplete={(summary) => {
              const interestTopics = (summary?.interestTopics || [])
                .map((item) => String(item || '').trim())
                .filter(Boolean);
              const industries = capStructuredList(summary?.industries, 'domains');
              handleComplete(
                formatInterestTopicsAsText(interestTopics),
                {
                  domains: normalizeIndustryDomains(industries, { keepUnknown: true }),
                }
              );
            }}
          />
        );
      case 'naturallyGoodAt':
        return (
          <NaturallyGoodAtCoaching
            layout={COACHING_LAYOUT}
            seniority={seniority}
            cvContext={cvContext}
            recommendationContextTexts={recommendationContextTexts}
            initialStrengths={[]}
            initialSkillDomains={[]}
            initialMessages={[]}
            onComplete={(summary, formattedText) => {
              const strengths = (summary?.strengths || [])
                .map((item) => String(item || '').trim())
                .filter(Boolean);
              const skillDomains = capStructuredList(summary?.skillDomains, 'skillDomains');
              handleComplete(
                formattedText || formatNaturallyGoodAtAsText({ strengths }),
                { skillDomains }
              );
            }}
          />
        );
      case 'workEnvironmentFit':
        return (
          <WorkEnvironmentCoaching
            layout={COACHING_LAYOUT}
            seniority={seniority}
            cvContext={cvContext}
            initialWorkStyles={[]}
            initialWorkEnvironments={[]}
            initialMessages={[]}
            onComplete={(_summary, formattedText) => handleComplete(formattedText)}
          />
        );
      case 'workingLifeAchievement':
        return (
          <WorkingLifeAchievementCoaching
            layout={COACHING_LAYOUT}
            seniority={seniority}
            cvContext={cvContext}
            initialCareerGoals={[]}
            initialPriorities={[]}
            initialMessages={[]}
            onComplete={(_summary, formattedText) => handleComplete(formattedText)}
          />
        );
      default:
        return null;
    }
  };

  if (!fieldKey || !COACHING_INTRO_KEYS[fieldKey]) return null;

  return (
    <Box
      sx={{
        opacity: disabled ? 0.7 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        minHeight: 0,
      }}
    >
      {introKey ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t(introKey)}
        </Typography>
      ) : null}
      <Box key={`${fieldKey}-${restartKey}`}>
        {renderCoaching()}
      </Box>
    </Box>
  );
};

export default ProfileIdentityCoachingEditor;
