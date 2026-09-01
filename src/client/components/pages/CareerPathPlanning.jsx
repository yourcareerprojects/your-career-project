import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CareerPathQuestionnaire from '../careerPath/CareerPathQuestionnaire';
import CareerPathOverview from '../careerPath/CareerPathOverview';
import CareerPathAnswersEditor from '../careerPath/CareerPathAnswersEditor';
import {
  useFullProfileQuery,
  useCareerPathPlansQuery,
  setCareerPathPlansQueryData,
} from '../../hooks/useProfileQueries';
import { getRoleTitleForLocale } from '../../utils/roleTitleDisplay';
import {
  clearCareerPathSession,
  loadCareerPathRoleSnapshot,
  loadCareerPathSession,
  storeCareerPathSession,
  findCareerPathPlan,
  findCareerPathPlanAnyLang,
  saveCareerPathPlanRemote,
  requestCareerPathPlan,
  buildCareerPathUserContext,
  normalizeEscoId,
  normalizeCareerPathLang,
} from '../../utils/careerPathPlanningSession';

/**
 * Career path planning flow: structured questionnaire → path overview.
 * A generated plan is persisted server-side keyed by escoId + language, so it is
 * recognized from every entry point and after reloads. Switching the UI language
 * regenerates the plan in the new language from the stored answers.
 */
export default function CareerPathPlanning() {
  const { t, i18n } = useTranslation('dashboard');
  const navigate = useNavigate();
  const location = useLocation();
  const { stepId: rawStepId, simulationId: savedSimulationId } = useParams();
  const stepId = rawStepId ? decodeURIComponent(rawStepId) : '';
  const currentLang = normalizeCareerPathLang(i18n.language);
  const { data: fullProfile, isLoading: profileLoading } = useFullProfileQuery();
  const { data: careerPathPlans = [], isLoading: plansLoading } = useCareerPathPlansQuery();

  const roleSnapshot = useMemo(() => loadCareerPathRoleSnapshot(stepId), [stepId]);
  const role = roleSnapshot?.role || null;
  const userContext = useMemo(() => buildCareerPathUserContext(fullProfile), [fullProfile]);

  const planForCurrentLang = useMemo(
    () => findCareerPathPlan(careerPathPlans, stepId, currentLang),
    [careerPathPlans, stepId, currentLang]
  );
  const planAnyLang = useMemo(
    () => findCareerPathPlanAnyLang(careerPathPlans, stepId),
    [careerPathPlans, stepId]
  );
  const localSession = useMemo(() => loadCareerPathSession(stepId), [stepId]);

  // Only a real escoId is persisted server-side; roles without one fall back to local-only.
  const roleEscoId = normalizeEscoId(role?.escoId) || normalizeEscoId(planAnyLang?.escoId);

  const [phase, setPhase] = useState('loading');
  const [pathPlan, setPathPlan] = useState(null);
  const [answers, setAnswers] = useState(localSession?.answers || localSession?.state?.answers || {});
  const [audience, setAudience] = useState(localSession?.audience || localSession?.state?.audience || null);
  const [regenError, setRegenError] = useState('');
  const [recalculating, setRecalculating] = useState(false);

  // Guards against re-triggering regeneration for a language already handled.
  const regenLangRef = useRef(null);

  const upsertPlanCache = useCallback((saved) => {
    if (!saved) return;
    setCareerPathPlansQueryData((prev) => {
      const list = Array.isArray(prev) ? prev.slice() : [];
      const idx = list.findIndex(
        (p) =>
          normalizeEscoId(p?.escoId) === normalizeEscoId(saved.escoId) &&
          normalizeCareerPathLang(p?.language) === normalizeCareerPathLang(saved.language)
      );
      if (idx >= 0) list[idx] = saved;
      else list.push(saved);
      return list;
    });
  }, []);

  const savePlan = useCallback(
    async (plan, planAnswers, planAudience) => {
      if (!roleEscoId) {
        storeCareerPathSession(stepId, {
          phase: 'overview',
          pathPlan: plan,
          answers: planAnswers,
          audience: planAudience || null,
        });
        return;
      }
      try {
        const saved = await saveCareerPathPlanRemote({
          escoId: roleEscoId,
          pathPlan: plan,
          answers: planAnswers,
          audience: planAudience || null,
          roleTitle: role?.title ?? planAnyLang?.roleTitle ?? null,
          lang: currentLang,
        });
        upsertPlanCache(saved);
      } catch {
        storeCareerPathSession(stepId, {
          phase: 'overview',
          pathPlan: plan,
          answers: planAnswers,
          audience: planAudience || null,
        });
      }
    },
    [roleEscoId, stepId, role, planAnyLang, currentLang, upsertPlanCache]
  );

  const regenerate = useCallback(
    async (regenAnswers, regenAudience) => {
      try {
        const data = await requestCareerPathPlan({
          role,
          userContext,
          preferences: regenAnswers,
          lang: currentLang,
        });
        if (!data?.pathPlan) throw new Error('no plan');
        const resolvedAudience = data.audience || regenAudience || null;
        setPathPlan(data.pathPlan);
        setAnswers(regenAnswers);
        setAudience(resolvedAudience);
        setRegenError('');
        setPhase('overview');
        await savePlan(data.pathPlan, regenAnswers, resolvedAudience);
      } catch {
        setRegenError(t('careerPathPlanning.questionnaire.errors.generateFailed'));
        regenLangRef.current = null;
        if (planAnyLang?.pathPlan) {
          setPathPlan(planAnyLang.pathPlan);
          setAnswers(planAnyLang.answers || {});
          setAudience(planAnyLang.audience || null);
          setPhase('overview');
        } else {
          setPhase('questionnaire');
        }
      }
    },
    [role, userContext, currentLang, planAnyLang, savePlan, t]
  );

  useEffect(() => {
    if (plansLoading) return;

    // 1. A plan already exists in the current language → show it.
    if (planForCurrentLang?.pathPlan) {
      setPathPlan(planForCurrentLang.pathPlan);
      setAnswers(planForCurrentLang.answers || {});
      setAudience(planForCurrentLang.audience || null);
      setPhase('overview');
      regenLangRef.current = null;
      return;
    }

    // 2. A plan exists in another language → regenerate in the current language.
    if (planAnyLang?.pathPlan) {
      const regenAnswers =
        planAnyLang.answers && Object.keys(planAnyLang.answers).length ? planAnyLang.answers : null;
      if (role && regenAnswers) {
        if (regenLangRef.current !== currentLang) {
          regenLangRef.current = currentLang;
          setRegenError('');
          setPhase('regenerating');
          void regenerate(regenAnswers, planAnyLang.audience || null);
        }
        return;
      }
      // Can't regenerate (missing role snapshot or answers) → show the existing plan as-is.
      setPathPlan(planAnyLang.pathPlan);
      setAnswers(planAnyLang.answers || {});
      setAudience(planAnyLang.audience || null);
      setPhase('overview');
      return;
    }

    // 3. No plan anywhere → questionnaire.
    setPhase((prev) => (prev === 'regenerating' ? prev : 'questionnaire'));
  }, [plansLoading, planForCurrentLang, planAnyLang, role, currentLang, regenerate]);

  const roleTitle = getRoleTitleForLocale(role?.title || planAnyLang?.roleTitle, i18n.language);

  // Prefer the origin captured at navigation time so back returns to where the
  // user started (e.g. the role detail page), falling back to the ranking.
  const backPath = location.state?.from
    || (savedSimulationId ? `/simulation/${savedSimulationId}` : '/puzzle-job');

  const handleBack = () => {
    navigate(backPath);
  };

  const handleQuestionnaireComplete = useCallback(
    (plan, nextAnswers, nextState, nextAudience) => {
      const resolvedAudience = nextAudience || nextState?.audience || null;
      setPathPlan(plan);
      setAnswers(nextAnswers);
      setAudience(resolvedAudience);
      setPhase('overview');
      regenLangRef.current = currentLang;
      clearCareerPathSession(stepId);
      void savePlan(plan, nextAnswers, resolvedAudience);
    },
    [stepId, currentLang, savePlan]
  );

  const handleSessionPersist = useCallback(
    ({ answers: nextAnswers, audience: nextAudience }) => {
      setAnswers(nextAnswers);
      if (nextAudience) setAudience(nextAudience);
      storeCareerPathSession(stepId, {
        phase: 'questionnaire',
        pathPlan: null,
        answers: nextAnswers,
        audience: nextAudience || audience || null,
      });
    },
    [stepId, audience]
  );

  // Recalculate the plan from answers the user tweaked in the overview dropdowns.
  // Keeps the overview mounted (inline button spinner) instead of the full-page
  // regeneration spinner used when switching languages.
  const handleRecalculate = useCallback(
    async (nextAnswers) => {
      if (!nextAnswers || !role) return;
      setRegenError('');
      regenLangRef.current = currentLang;
      setRecalculating(true);
      try {
        await regenerate(nextAnswers, audience);
      } finally {
        setRecalculating(false);
      }
    },
    [regenerate, role, audience, currentLang]
  );

  if (!stepId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{t('careerPathPlanning.errors.missingStep')}</Alert>
      </Box>
    );
  }

  const isOverview = phase === 'overview' && pathPlan;
  const isRegenerating = phase === 'regenerating';
  const isBusy =
    plansLoading || phase === 'loading' || isRegenerating || (profileLoading && phase === 'questionnaire');

  // Questionnaire needs role data; overview renders from the persisted plan alone.
  if (!isOverview && !isRegenerating && !role && !plansLoading && phase !== 'loading' && !planAnyLang) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('careerPathPlanning.errors.missingRole')}
        </Alert>
        <Button variant="contained" onClick={handleBack}>
          {t('careerPathPlanning.actions.backToRanking')}
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      {!isOverview ? (
        <Tooltip title={t('careerPathPlanning.actions.back')}>
          <IconButton
            onClick={handleBack}
            aria-label={t('careerPathPlanning.actions.back')}
            sx={{ mb: 2 }}
          >
            <ArrowBackIcon />
          </IconButton>
        </Tooltip>
      ) : null}

      {regenError ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setRegenError('')}>
          {regenError}
        </Alert>
      ) : null}

      {isBusy && !isOverview ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 6 }}>
          <CircularProgress />
          {isRegenerating ? (
            <Typography variant="body2" color="text.secondary">
              {t('careerPathPlanning.questionnaire.generating')}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      {!plansLoading && phase === 'questionnaire' && !profileLoading && role ? (
        <CareerPathQuestionnaire
          key={Object.keys(answers).length === 0 ? 'fresh' : 'resume'}
          role={role}
          fullProfile={fullProfile}
          initialAnswers={answers}
          initialAudience={audience}
          onComplete={handleQuestionnaireComplete}
          onSessionPersist={handleSessionPersist}
        />
      ) : null}

      {isOverview ? (
        <>
          <CareerPathOverview pathPlan={pathPlan} roleTitle={roleTitle} onBack={handleBack} />
          {role ? (
            <CareerPathAnswersEditor
              role={role}
              userContext={userContext}
              lang={currentLang}
              answers={answers}
              audience={audience}
              recalculating={recalculating}
              onRecalculate={handleRecalculate}
            />
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
