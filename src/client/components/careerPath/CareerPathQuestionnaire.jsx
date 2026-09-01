import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  LinearProgress,
  Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useTranslation } from 'react-i18next';
import { baseUILanguage } from '../../hooks/useProfileQueries';
import { getProfileApiLangQuery } from '../../utils/profileApiLangQuery';
import { buildCareerPathRolePayload, buildCareerPathUserContext, prefetchCareerPathEnrichment } from '../../utils/careerPathPlanningSession';
import {
  resolveOptionLabel as resolveOptionLabelI18n,
  resolveQuestionText,
} from '../../utils/careerPathQuestionnaireLabels';

async function postCareerPathCoaching({ role, userContext, preferences, lang, token }) {
  const res = await fetch(`/api/profile/career-path-coaching?${getProfileApiLangQuery()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      role: buildCareerPathRolePayload(role),
      userContext,
      ...(preferences ? { preferences } : {}),
      lang,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.details || 'Career path planning request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Structured questionnaire before roadmap generation.
 * Question set is audience-aware and loaded from the server.
 */
export default function CareerPathQuestionnaire({
  role,
  fullProfile,
  initialAnswers = {},
  initialAudience = null,
  onComplete,
  onSessionPersist,
}) {
  const { t, i18n } = useTranslation('dashboard');
  const coachingLang = baseUILanguage() || String(i18n.language || 'de').toLowerCase().split('-')[0];
  const userContext = useMemo(() => buildCareerPathUserContext(fullProfile), [fullProfile]);

  const [audience, setAudience] = useState(initialAudience);
  const [questions, setQuestions] = useState([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');

  const [answers, setAnswers] = useState(initialAnswers);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadQuestionnaire() {
      setConfigLoading(true);
      setConfigError('');
      try {
        const token = localStorage.getItem('token');
        const data = await postCareerPathCoaching({
          role,
          userContext,
          lang: coachingLang,
          token,
        });
        if (cancelled) return;

        const nextQuestions = Array.isArray(data.questions) ? data.questions.filter((q) => q?.id) : [];
        if (!nextQuestions.length) {
          throw new Error(t('careerPathPlanning.questionnaire.errors.loadFailed'));
        }

        const ids = nextQuestions.map((q) => q.id);
        setAudience(data.audience || 'career');
        setQuestions(nextQuestions);

        const firstUnanswered = ids.findIndex((id) => {
          const value = initialAnswers[id];
          return value === undefined || value === null || value === '';
        });
        setCurrentIndex(firstUnanswered === -1 ? Math.max(0, ids.length - 1) : firstUnanswered);

        if (onSessionPersist) {
          onSessionPersist({
            answers: initialAnswers,
            audience: data.audience || 'career',
            questionIndex: firstUnanswered === -1 ? Math.max(0, ids.length - 1) : firstUnanswered,
          });
        }

        void prefetchCareerPathEnrichment({ role, lang: coachingLang });
      } catch (err) {
        if (!cancelled) {
          setConfigError(err.message || t('careerPathPlanning.questionnaire.errors.loadFailed'));
        }
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    }

    void loadQuestionnaire();
    return () => {
      cancelled = true;
    };
  }, [role, userContext, coachingLang, t]); // eslint-disable-line react-hooks/exhaustive-deps -- load once per profile/role

  const currentQuestionDef = questions[currentIndex] || null;
  const currentQuestionId = currentQuestionDef?.id;
  const isLastQuestion = questions.length > 0 && currentIndex === questions.length - 1;
  const progress = questions.length
    ? ((currentIndex + 1) / questions.length) * 100
    : 0;

  const resolveOptionLabel = useCallback(
    (questionId, value) => resolveOptionLabelI18n(t, audience, questionId, value),
    [audience, t]
  );

  const currentQuestion = useMemo(() => {
    if (!currentQuestionDef?.id || !audience) return null;
    const optionValues = Array.isArray(currentQuestionDef.options)
      ? currentQuestionDef.options
      : [];

    return {
      question: resolveQuestionText(t, audience, currentQuestionDef.id),
      options: optionValues.map((value) => ({
        value,
        label: resolveOptionLabel(currentQuestionDef.id, value),
      })),
    };
  }, [audience, currentQuestionDef, resolveOptionLabel, t]);

  const persistSession = useCallback((nextAnswers, nextIndex = currentIndex) => {
    if (!onSessionPersist) return;
    onSessionPersist({
      answers: nextAnswers,
      audience,
      questionIndex: nextIndex,
    });
  }, [audience, currentIndex, onSessionPersist]);

  const submitPlan = useCallback(async (finalAnswers) => {
    const token = localStorage.getItem('token');
    const data = await postCareerPathCoaching({
      role,
      userContext,
      preferences: finalAnswers,
      lang: coachingLang,
      token,
    });
    if (data.phase === 'summary' && data.pathPlan) {
      onComplete(data.pathPlan, finalAnswers, data.state || null, data.audience || audience);
      return;
    }
    throw new Error(t('careerPathPlanning.questionnaire.errors.noPlan'));
  }, [role, userContext, coachingLang, onComplete, audience, t]);

  const handleSelect = async (value) => {
    if (loading || !currentQuestionId) return;
    const nextAnswers = { ...answers, [currentQuestionId]: value };
    setAnswers(nextAnswers);
    setError('');

    if (!isLastQuestion) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      persistSession(nextAnswers, nextIndex);
      return;
    }

    setLoading(true);
    try {
      await submitPlan(nextAnswers);
    } catch (err) {
      setError(err.message || t('careerPathPlanning.questionnaire.errors.generateFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (configLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (configError) {
    return (
      <Alert severity="error">{configError}</Alert>
    );
  }

  if (!currentQuestion) {
    return (
      <Alert severity="error">{t('careerPathPlanning.questionnaire.errors.loadFailed')}</Alert>
    );
  }

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      ) : null}

      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('careerPathPlanning.questionnaire.progress', {
            current: currentIndex + 1,
            total: questions.length,
          })}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{ height: 8, borderRadius: 4 }}
        />
      </Box>

      <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 2.5, lineHeight: 1.4 }}>
            {currentQuestion.question}
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {currentQuestion.options.map((option) => {
              const selected = answers[currentQuestionId] === option.value;
              return (
                <Button
                  key={String(option.value)}
                  variant={selected ? 'contained' : 'outlined'}
                  onClick={() => void handleSelect(option.value)}
                  disabled={loading}
                  endIcon={loading && selected ? <CircularProgress size={16} color="inherit" /> : <ArrowForwardIcon />}
                  sx={{
                    justifyContent: 'space-between',
                    textAlign: 'left',
                    py: 1.5,
                    px: 2,
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: selected ? 600 : 500,
                    whiteSpace: 'normal',
                    lineHeight: 1.4,
                  }}
                >
                  {option.label}
                </Button>
              );
            })}
          </Box>
        </CardContent>
      </Card>

      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, justifyContent: 'center', py: 2 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">
            {t('careerPathPlanning.questionnaire.generating')}
          </Typography>
        </Box>
      ) : null}

      {currentIndex > 0 && !loading ? (
        <Button
          variant="text"
          onClick={() => {
            const nextIndex = Math.max(0, currentIndex - 1);
            setCurrentIndex(nextIndex);
            persistSession(answers, nextIndex);
          }}
          sx={{ mt: 1 }}
        >
          {t('careerPathPlanning.questionnaire.back')}
        </Button>
      ) : null}
    </Box>
  );
}
