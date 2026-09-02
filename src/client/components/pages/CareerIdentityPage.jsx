import React from 'react';
import { Container } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../common/PageHeader';
import ProfileCompletionRequiredScreen, {
  EmailVerificationRequiredScreen,
  ProfileCompletionGateLoading,
  useProfileCompletionGate,
} from '../common/ProfileCompletionRequiredScreen';
import CareerIdentity from '../careerIdentity/CareerIdentity';

/**
 * Page shell for the Career Identity Puzzle — who am I becoming?
 */
export default function CareerIdentityPage() {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const needsEmailVerification = !user?.isVerified && !user?.emailVerified;
  const profileGate = useProfileCompletionGate();

  if (needsEmailVerification) {
    return (
      <Container maxWidth="lg" disableGutters>
        <EmailVerificationRequiredScreen
          pageTitle={t('careerIdentity.pageTitle')}
          pageSubtitle={t('careerIdentity.pageSubtitle')}
          gateTitle={t('careerIdentity.emailVerificationGate.title')}
          gateDescription={t('careerIdentity.emailVerificationGate.description')}
        />
      </Container>
    );
  }

  if (profileGate.isLoading) {
    return (
      <Container maxWidth="lg" disableGutters>
        <ProfileCompletionGateLoading />
      </Container>
    );
  }

  if (profileGate.belowMin) {
    return (
      <Container maxWidth="lg" disableGutters>
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
    <Container maxWidth="lg" disableGutters>
      <PageHeader
        title={t('careerIdentity.pageTitle')}
        description={t('careerIdentity.pageSubtitle')}
      />
      <CareerIdentity />
    </Container>
  );
}
