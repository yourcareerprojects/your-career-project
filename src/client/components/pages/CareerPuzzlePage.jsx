import React, { useEffect } from 'react';
import { Alert, Box, Button, CircularProgress, Container } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../common/PageHeader';
import ProfileCompletionRequiredScreen, {
  EmailVerificationRequiredScreen,
  ProfileCompletionGateLoading,
  useProfileCompletionGate,
} from '../common/ProfileCompletionRequiredScreen';
import CareerPuzzle from '../careerPuzzle/CareerPuzzle';
import {
  useCareerPuzzleQuery,
  useEnsurePuzzleDraftMutation,
} from '../../hooks/useCareerPuzzleQueries';

/**
 * Draft Career Puzzle workspace — always builds a new (non-favorite) path.
 */
export default function CareerPuzzlePage() {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const needsEmailVerification = !user?.isVerified && !user?.emailVerified;
  const profileGate = useProfileCompletionGate();
  const puzzleEnabled = !needsEmailVerification && profileGate.isReady;
  const puzzleQuery = useCareerPuzzleQuery({ enabled: puzzleEnabled });
  const ensureDraftMutation = useEnsurePuzzleDraftMutation();
  const activeIsFavorite = Boolean(puzzleQuery.data?.activePath?.isFavorite);

  useEffect(() => {
    if (!puzzleEnabled) return undefined;
    if (!puzzleQuery.isSuccess || !activeIsFavorite) return undefined;
    if (ensureDraftMutation.isLoading || ensureDraftMutation.isError) return undefined;
    ensureDraftMutation.mutate();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when active favorite path changes
  }, [puzzleEnabled, puzzleQuery.isSuccess, activeIsFavorite, puzzleQuery.data?.activePath?.pathId]);

  if (needsEmailVerification) {
    return (
      <Container maxWidth="lg" disableGutters>
        <EmailVerificationRequiredScreen
          pageTitle={t('careerPuzzle.pageTitle')}
          pageSubtitle={t('careerPuzzle.pageSubtitle')}
          gateTitle={t('careerPuzzle.emailVerificationGate.title')}
          gateDescription={t('careerPuzzle.emailVerificationGate.description')}
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
          pageTitle={t('careerPuzzle.pageTitle')}
          pageSubtitle={t('careerPuzzle.pageSubtitle')}
          gateTitle={t('careerPuzzle.profileGate.title')}
          gateDescription={({ current, min }) =>
            t('careerPuzzle.profileGate.description', { current, min })
          }
        />
      </Container>
    );
  }

  const showSpinner =
    puzzleQuery.isLoading ||
    ensureDraftMutation.isLoading ||
    (puzzleQuery.isSuccess && activeIsFavorite && !ensureDraftMutation.isError);

  return (
    <Container maxWidth="lg" disableGutters>
      <PageHeader
        title={t('careerPuzzle.pageTitle')}
        description={t('careerPuzzle.pageSubtitle')}
      />
      {ensureDraftMutation.isError ? (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                ensureDraftMutation.reset();
                ensureDraftMutation.mutate();
              }}
            >
              {t('savedLists.common.retry')}
            </Button>
          }
        >
          {ensureDraftMutation.error?.message || t('careerPuzzle.loadError')}
        </Alert>
      ) : null}
      {showSpinner ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <CareerPuzzle mode="draft" />
      )}
    </Container>
  );
}
