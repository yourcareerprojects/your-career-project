import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import { useTranslation } from 'react-i18next';
import { requestCareerPathQuestionnaireConfig } from '../../utils/careerPathPlanningSession';
import {
  decodeOptionValue,
  encodeOptionValue,
  resolveOptionLabel,
  resolveQuestionKeyword,
} from '../../utils/careerPathQuestionnaireLabels';

function isAnswered(value) {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Lets the user review and tweak the answers behind an already-generated plan via
 * one dropdown per question, then recalculate the plan from the edited answers.
 * The question set + option values are loaded from the server (single source of
 * truth); dropdowns are pre-filled from the answers that produced the current plan.
 */
export default function CareerPathAnswersEditor({
  role,
  userContext,
  lang,
  answers,
  audience: initialAudience,
  recalculating = false,
  onRecalculate,
}) {
  const { t } = useTranslation('dashboard');

  const [questions, setQuestions] = useState([]);
  const [audience, setAudience] = useState(initialAudience || 'career');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState(() => ({ ...(answers || {}) }));

  // Re-sync the draft whenever the plan's answers change (e.g. after a recalculation).
  useEffect(() => {
    setDraft({ ...(answers || {}) });
  }, [answers]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setLoading(true);
      setLoadError('');
      try {
        const data = await requestCareerPathQuestionnaireConfig({ role, userContext, lang });
        if (cancelled) return;
        if (!data.questions.length) {
          throw new Error('no questions');
        }
        setQuestions(data.questions);
        if (data.audience) setAudience(data.audience);
      } catch {
        if (!cancelled) {
          setLoadError(t('careerPathPlanning.overview.adjustAnswers.loadFailed'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [role, userContext, lang, t]);

  const allAnswered = useMemo(
    () => questions.length > 0 && questions.every((q) => isAnswered(draft[q.id])),
    [questions, draft]
  );

  // The draft differs from the answers that produced the current plan. When it
  // matches (including after switching a value away and back), recalculation is a
  // no-op, so the button stays disabled.
  const hasChanges = useMemo(
    () => questions.some((q) => draft[q.id] !== (answers ? answers[q.id] : undefined)),
    [questions, draft, answers]
  );

  const handleChange = (questionId) => (event) => {
    const value = decodeOptionValue(event.target.value);
    setDraft((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleRecalculate = () => {
    if (!allAnswered || !hasChanges || recalculating || !onRecalculate) return;
    onRecalculate(draft);
  };

  if (loading) {
    return (
      <Card variant="outlined" sx={{ mt: 3, borderRadius: 2 }}>
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={26} />
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Alert severity="error" sx={{ mt: 3 }}>
        {loadError}
      </Alert>
    );
  }

  if (!questions.length) return null;

  return (
    <Card variant="outlined" sx={{ mt: 3, borderRadius: 2 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: { xs: 'stretch', md: 'flex-end' },
            gap: 2,
          }}
        >
          {questions.map((question) => {
            const labelId = `career-answer-${question.id}-label`;
            const currentValue = draft[question.id];
            const selectValue = isAnswered(currentValue)
              ? encodeOptionValue(currentValue)
              : '';
            const options = Array.isArray(question.options) ? question.options : [];
            return (
              <Box key={question.id} sx={{ flex: { md: 1 }, minWidth: 0 }}>
                <Typography
                  id={labelId}
                  variant="body1"
                  component="div"
                  sx={{ color: '#950202', fontWeight: 600, mb: 1.5 }}
                >
                  {resolveQuestionKeyword(t, audience, question.id)}
                </Typography>
                <FormControl fullWidth disabled={recalculating}>
                  <Select
                    labelId={labelId}
                    value={selectValue}
                    onChange={handleChange(question.id)}
                    variant="outlined"
                    displayEmpty
                  >
                    {options.map((optionValue) => (
                      <MenuItem
                        key={encodeOptionValue(optionValue)}
                        value={encodeOptionValue(optionValue)}
                        sx={{ whiteSpace: 'normal' }}
                      >
                        {resolveOptionLabel(t, audience, question.id, optionValue)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            );
          })}

          <Button
            variant="contained"
            startIcon={recalculating ? <CircularProgress size={16} color="inherit" /> : <ReplayIcon />}
            onClick={handleRecalculate}
            disabled={!allAnswered || !hasChanges || recalculating}
            sx={{
              flexShrink: 0,
              whiteSpace: 'nowrap',
              height: { md: 56 },
              px: 3,
            }}
          >
            {recalculating
              ? t('careerPathPlanning.overview.adjustAnswers.recalculating')
              : t('careerPathPlanning.overview.adjustAnswers.recalculate')}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
