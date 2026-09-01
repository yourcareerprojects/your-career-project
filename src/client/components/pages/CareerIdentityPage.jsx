import React from 'react';
import { Box, Container } from '@mui/material';
import { useTranslation } from 'react-i18next';
import PageHeader from '../common/PageHeader';
import ProfileCompletionRequiredScreen, {
  ProfileCompletionGateLoading,
  useProfileCompletionGate,
} from '../common/ProfileCompletionRequiredScreen';
import CareerIdentity from '../careerIdentity/CareerIdentity';

/**
 * Page shell for the Career Identity Puzzle — who am I becoming?
 */
export default function CareerIdentityPage() {
  const { t } = useTranslation('dashboard');
  const profileGate = useProfileCompletionGate();

  if (profileGate.isLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: { xs: 2, md: 4 }, pb: { xs: 10, md: 4 } }}>
        <ProfileCompletionGateLoading />
      </Container>
    );
  }

  if (profileGate.belowMin) {
    return (
      <Container maxWidth="lg" sx={{ py: { xs: 2, md: 4 }, pb: { xs: 10, md: 4 } }}>
        <ProfileCompletionRequiredScreen
          pageTitle={t('careerIdentity.pageTitle')}
          pageSubtitle={t('careerIdentity.pageSubtitle')}
          gateTitle={t('careerIdentity.profileGate.title')}
          gateDescription={({ current, min }) =>
            t('careerIdentity.profileGate.description', { current, min })
          }
        />
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 4 }, pb: { xs: 10, md: 4 } }}>
      <Box sx={{ maxWidth: 640, mx: 'auto' }}>
        <PageHeader
          title={t('careerIdentity.pageTitle')}
          description={t('careerIdentity.pageSubtitle')}
        />
      </Box>
      <CareerIdentity />
    </Container>
  );
}
