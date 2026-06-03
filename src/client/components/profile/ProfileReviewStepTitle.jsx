import React from 'react';
import { Typography } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import PsychologyIcon from '@mui/icons-material/Psychology';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import WorkHistoryIcon from '@mui/icons-material/WorkHistory';
import AssessmentIcon from '@mui/icons-material/Assessment';

/** Matches Profile.jsx main section headers (h6 + icon + title). */
const REVIEW_STEP_HEADER_CONFIG = {
  1: { Icon: CloudUploadIcon, titleKey: 'documentUpload.review.step1Title' },
  2: { Icon: PsychologyIcon, titleKey: 'profilePage.sections.identity' },
  3: { Icon: AccountTreeIcon, titleKey: 'profilePage.sections.goodAt' },
  4: { Icon: AssessmentIcon, titleKey: 'documentUpload.review.step4Title' },
  5: { Icon: WorkHistoryIcon, titleKey: 'documentUpload.review.step5Title' },
};

/**
 * Step title for the profile creation review dialog (aligned with /profile section styling).
 * @param {{ step: number, t: (key: string) => string, sx?: object }} props
 */
const ProfileReviewStepTitle = ({ step, t, sx }) => {
  const config = REVIEW_STEP_HEADER_CONFIG[step] || REVIEW_STEP_HEADER_CONFIG[2];
  const Icon = config.Icon;

  return (
    <Typography
      variant="h6"
      component="span"
      sx={{ display: 'block', fontWeight: 600, lineHeight: 1.3, ...sx }}
    >
      <Icon sx={{ mr: 1, verticalAlign: 'middle' }} aria-hidden />
      {t(config.titleKey)}
    </Typography>
  );
};

export default ProfileReviewStepTitle;
