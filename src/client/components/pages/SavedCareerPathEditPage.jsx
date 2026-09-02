import React, { useMemo } from 'react';
import { Alert, Box, Button, CircularProgress, Container } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, Navigate, useParams } from 'react-router-dom';
import PageHeader from '../common/PageHeader';
import CareerPuzzle from '../careerPuzzle/CareerPuzzle';
import {
  useCareerPuzzleQuery,
  deriveCareerPathTitle,
} from '../../hooks/useCareerPuzzleQueries';
import { baseUILanguage } from '../../hooks/useProfileQueries';

/**
 * Edit a saved Career Puzzle path (not the draft workspace).
 */
export default function SavedCareerPathEditPage() {
  const { t } = useTranslation('dashboard');
  const { pathId } = useParams();
  const lang = baseUILanguage();
  const puzzleQuery = useCareerPuzzleQuery();

  const path = useMemo(() => {
    const paths = puzzleQuery.data?.paths || [];
    return paths.find((p) => p.pathId === pathId) || null;
  }, [puzzleQuery.data?.paths, pathId]);

  const displayTitle =
    path?.title ||
    deriveCareerPathTitle(path, lang, t('savedLists.savedCareerPaths.unnamed'));

  if (puzzleQuery.isLoading) {
    return (
      <Container maxWidth="lg" disableGutters>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (puzzleQuery.isError) {
    return (
      <Container maxWidth="lg" disableGutters>
        <Alert severity="error">
          {puzzleQuery.error?.message || t('savedLists.savedCareerPaths.errors.fetchFailed')}
        </Alert>
      </Container>
    );
  }

  if (!path || !path.isFavorite) {
    return <Navigate to="/saved-paths" replace />;
  }

  return (
    <Container maxWidth="lg" disableGutters>
      <PageHeader
        title={displayTitle}
        description={t('savedLists.savedCareerPaths.editSubtitle')}
      />
      <Box sx={{ mb: 2 }}>
        <Button
          component={RouterLink}
          to="/saved-paths"
          startIcon={<ArrowBackIcon />}
          size="small"
        >
          {t('savedLists.savedCareerPaths.backToList')}
        </Button>
      </Box>
      <CareerPuzzle pathId={pathId} mode="saved" />
    </Container>
  );
}
