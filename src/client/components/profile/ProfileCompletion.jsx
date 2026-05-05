import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, LinearProgress, Stack, Divider } from '@mui/material';
import AssessmentIcon from '@mui/icons-material/Assessment';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';

/** Section keys must match server `computeProfileCompletion` breakdown. */
export const PROFILE_COMPLETION_SECTIONS = [
  { key: 'userIdentity', labelKey: 'profileCompletionTooltip.sections.userIdentity' },
  { key: 'structuredUserInfo', labelKey: 'profileCompletionTooltip.sections.structuredUserInfo' },
  { key: 'seniority', labelKey: 'profileCompletionTooltip.sections.seniority' },
  { key: 'documents', labelKey: 'profileCompletionTooltip.sections.documents' },
];

export function getCompletionLinearColor(percentage) {
  if (percentage >= 80) return 'success';
  if (percentage >= 50) return 'warning';
  return 'error';
}

export function getCompletionChipColor(percentage) {
  if (percentage >= 80) return 'success';
  if (percentage >= 50) return 'warning';
  return 'default';
}

function StatusIcon({ percentage }) {
  const props = { sx: { fontSize: 18 } };
  if (percentage >= 80) return <CheckCircleIcon color="success" {...props} />;
  if (percentage >= 50) return <WarningIcon color="warning" {...props} />;
  return <ErrorIcon color="error" {...props} />;
}

function SectionRow({ label, value }) {
  const pct = value || 0;
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5, gap: 1 }}>
        <Typography variant="caption" sx={{ lineHeight: 1.3, color: 'var(--color-on-primary)', fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ color: 'var(--color-on-primary)', fontWeight: 700 }}>
          {pct}%
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={getCompletionLinearColor(pct)}
        sx={{
          height: 8,
          borderRadius: 1,
          bgcolor: 'var(--color-track-neutral)',
          '& .MuiLinearProgress-bar': { borderRadius: 1 }
        }}
      />
    </Box>
  );
}

/**
 * Rich content for a Tooltip — overall + per-section breakdown (same data as former full card).
 */
export function ProfileCompletionTooltipContent({ completion }) {
  const { t } = useTranslation('onboarding');
  if (!completion) return null;
  const overall = completion.overall || 0;
  const hint =
    overall >= 80
      ? t('profileCompletionTooltip.hints.high')
      : overall >= 50
        ? t('profileCompletionTooltip.hints.medium')
        : t('profileCompletionTooltip.hints.low');

  return (
    <Box sx={{ py: 0.25, minWidth: 268, maxWidth: 320, color: 'var(--color-on-primary)' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <AssessmentIcon color="primary" fontSize="small" />
        <Typography variant="subtitle2" fontWeight={700} sx={{ color: 'var(--color-on-primary)' }}>
          {t('profileCompletionTooltip.title')}
        </Typography>
      </Stack>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="body2" sx={{ color: 'var(--color-on-primary)' }} fontWeight={600}>
          {t('profileCompletionTooltip.overall')}
        </Typography>
        <Typography variant="body2" fontWeight={800} sx={{ color: 'var(--color-on-primary)' }}>
          {overall}%
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={overall}
        color={getCompletionLinearColor(overall)}
        sx={{
          height: 9,
          borderRadius: 1,
          mb: 1,
          bgcolor: 'var(--color-track-neutral)',
          '& .MuiLinearProgress-bar': { borderRadius: 1 }
        }}
      />
      <Divider sx={{ my: 1, borderColor: 'var(--color-on-primary-divider)' }} />
      <Stack spacing={1.25}>
        {PROFILE_COMPLETION_SECTIONS.map(({ key, labelKey }) => (
          <SectionRow key={key} label={t(labelKey)} value={completion[key]} />
        ))}
      </Stack>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 1.25 }}>
        <StatusIcon percentage={overall} />
        <Typography variant="caption" sx={{ lineHeight: 1.35, color: 'var(--color-on-primary)', fontWeight: 500 }}>
          {hint}
        </Typography>
      </Stack>
    </Box>
  );
}
