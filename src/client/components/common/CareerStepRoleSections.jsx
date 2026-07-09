import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Button,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import { Insights, School, Work } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { getRequiredSkillLabels, getOptionalSkillLabels } from '../../utils/requiredSkillsUtils';
import { mergeResponsibilityTranslations } from '../../utils/mergeResponsibilityTranslations';
import localizedContentService from '../../utils/localizedContentService';
import { useFullProfileQuery } from '../../hooks/useProfileQueries';

export const MAX_VISIBLE_REQUIRED_SKILLS = 5;
export const MAX_VISIBLE_ALT_TITLES = 5;
export const MAX_VISIBLE_OPTIONAL_SKILLS = 5;

/** Wait after inputs settle before generating — absorbs profile fetch + occupation enrichment churn. */
const ROLE_FIT_EXPLANATION_DEBOUNCE_MS = 500;

export const getSeniorityColor = (level) => {
  if (typeof level !== 'number') return 'default';
  if (level <= 1) return 'default';
  if (level <= 3) return 'info';
  if (level <= 5) return 'warning';
  return 'error';
};

/**
 * Role Insights card — same structure as SavedCareerStepDetails / SavedSimulationCareerStepDetails.
 * @param {object} props
 * @param {object} props.stepDetails — career step / result payload (seniority, keyResponsibilities, skillDomains)
 * @param {number|null} [props.maxVisibleSkillDomains] — if set, collapse skill domains with show more (simulation results)
 */
export function CareerStepRoleInsightsCard({ stepDetails, maxVisibleSkillDomains = null, unfolded = false }) {
  const { t, i18n } = useTranslation('dashboard');
  const [showAllSkillDomains, setShowAllSkillDomains] = useState(unfolded);

  const activeLang = i18n.resolvedLanguage || i18n.language || 'en';

  const seniorityData = useMemo(() => stepDetails?.seniority || null, [stepDetails]);

  const responsibilities = useMemo(() => {
    const kr = stepDetails?.keyResponsibilities;
    const enList = Array.isArray(kr?.responsibilities) ? kr.responsibilities : [];
    const isDe = String(activeLang).toLowerCase().startsWith('de');
    const deNested = Array.isArray(kr?.responsibilitiesDe) ? kr.responsibilitiesDe : null;
    const deTop = Array.isArray(stepDetails?.keyResponsibilitiesDe) ? stepDetails.keyResponsibilitiesDe : null;
    const deList = deNested && deNested.length > 0 ? deNested : deTop && deTop.length > 0 ? deTop : [];
    if (isDe && deList.length > 0) {
      return mergeResponsibilityTranslations(enList, deList);
    }
    if (!Array.isArray(enList)) return [];
    return enList.filter(Boolean);
  }, [stepDetails, activeLang]);

  const skillDomainItems = useMemo(() => {
    const raw = Array.isArray(stepDetails?.skillDomains)
      ? stepDetails.skillDomains
      : Array.isArray(stepDetails?.skillDomains?.skill_domains)
        ? stepDetails.skillDomains.skill_domains
        : [];
    return [...raw];
  }, [stepDetails]);

  const hasRoleInsights =
    seniorityData ||
    responsibilities.length > 0 ||
    skillDomainItems.length > 0;

  const visibleSkillDomains =
    unfolded || maxVisibleSkillDomains == null || showAllSkillDomains
      ? skillDomainItems
      : skillDomainItems.slice(0, maxVisibleSkillDomains);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          <Insights sx={{ mr: 1, verticalAlign: 'middle' }} />
          {t('details.roleSections.roleInsights')}
        </Typography>

        {!hasRoleInsights && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0 }}>
            {t('details.roleSections.noRoleInsights')}
          </Typography>
        )}

        {seniorityData && seniorityData.seniority_label && (
          <Box sx={{ mb: responsibilities.length > 0 || skillDomainItems.length > 0 ? 3 : 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              {t('details.roleSections.seniority')}
            </Typography>
            <Chip
              label={`${seniorityData.seniority_label}${typeof seniorityData.seniority_level === 'number' ? ` (Level ${seniorityData.seniority_level})` : ''}`}
              color={getSeniorityColor(seniorityData.seniority_level)}
              sx={{ mb: 1 }}
            />
          </Box>
        )}

        {hasRoleInsights && responsibilities.length > 0 && (
          <Box sx={{ mb: skillDomainItems.length > 0 ? 3 : 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              {t('details.roleSections.keyResponsibilities')}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {responsibilities.map((resp, idx) => (
                <Box component="li" key={idx} sx={{ mb: 0.5 }}>
                  <Typography variant="body2">{resp}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {hasRoleInsights && skillDomainItems.length > 0 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              {t('details.roleSections.skillDomains')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {visibleSkillDomains.map((d, idx) => (
                <Tooltip
                  key={idx}
                  title={Array.isArray(d.items) && d.items.length > 0 ? t('details.roleSections.includes', { items: d.items.map((it) => it.label || it.key || '').filter(Boolean).join(', ') }) : ''}
                  arrow
                >
                  <Chip
                    label={d.label || d.domain}
                    color="primary"
                    variant="outlined"
                    size="small"
                  />
                </Tooltip>
              ))}
            </Box>
            {maxVisibleSkillDomains != null && skillDomainItems.length > maxVisibleSkillDomains && !unfolded && (
              <Button
                size="small"
                onClick={() => setShowAllSkillDomains((v) => !v)}
                sx={{ mt: 1, textTransform: 'none' }}
              >
                {showAllSkillDomains ? t('details.roleSections.showLess') : t('details.roleSections.showMore')}
              </Button>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Role Details card — same structure as SavedCareerStepDetails / SavedSimulationCareerStepDetails.
 */
export function CareerStepRoleDetailsCard({ stepDetails, unfolded = false }) {
  const { t, i18n } = useTranslation('dashboard');
  const [showAllAltTitles, setShowAllAltTitles] = useState(unfolded);
  const [showAllHiddenTitles, setShowAllHiddenTitles] = useState(unfolded);
  const [showAllRequiredSkills, setShowAllRequiredSkills] = useState(unfolded);
  const [showAllOptionalSkills, setShowAllOptionalSkills] = useState(unfolded);

  const activeLang = i18n.resolvedLanguage || i18n.language || 'en';

  const requiredSkills = useMemo(() => {
    return getRequiredSkillLabels(stepDetails, activeLang);
  }, [stepDetails, activeLang]);

  const altTitles = useMemo(() => {
    const raw = stepDetails?.altTitles;
    if (!Array.isArray(raw)) return [];
    return Array.from(new Set(raw.map((s) => String(s || '').trim()).filter(Boolean)));
  }, [stepDetails]);

  const hiddenTitles = useMemo(() => {
    const raw = stepDetails?.hiddenTitles;
    if (!Array.isArray(raw)) return [];
    return Array.from(new Set(raw.map((s) => String(s || '').trim()).filter(Boolean)));
  }, [stepDetails]);

  const optionalSkills = useMemo(() => {
    return getOptionalSkillLabels(stepDetails, activeLang);
  }, [stepDetails, activeLang]);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          <School sx={{ mr: 1, verticalAlign: 'middle' }} />
          {t('details.roleSections.roleDetails')}
        </Typography>

        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
          {t('details.roleSections.requiredSkills')}
        </Typography>
        {requiredSkills.length > 0 ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {(unfolded || showAllRequiredSkills
              ? requiredSkills
              : requiredSkills.slice(0, MAX_VISIBLE_REQUIRED_SKILLS)
            ).map(
              (skill) => (
                <Chip key={skill} label={skill} variant="outlined" />
              )
            )}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('details.roleSections.noRequiredSkills')}
          </Typography>
        )}
        {requiredSkills.length > MAX_VISIBLE_REQUIRED_SKILLS && !unfolded && (
          <Button
            size="small"
            onClick={() => setShowAllRequiredSkills((v) => !v)}
            sx={{ mt: 1, textTransform: 'none' }}
          >
            {showAllRequiredSkills ? t('details.roleSections.showLess') : t('details.roleSections.showMore')}
          </Button>
        )}

        {optionalSkills.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              {t('details.roleSections.optionalSkills')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {(unfolded || showAllOptionalSkills
                ? optionalSkills
                : optionalSkills.slice(0, MAX_VISIBLE_OPTIONAL_SKILLS)
              ).map(
                (skill) => (
                  <Chip key={skill} label={skill} variant="outlined" size="small" />
                )
              )}
            </Box>
            {optionalSkills.length > MAX_VISIBLE_OPTIONAL_SKILLS && !unfolded && (
              <Button
                size="small"
                onClick={() => setShowAllOptionalSkills((v) => !v)}
                sx={{ mt: 1, textTransform: 'none' }}
              >
                {showAllOptionalSkills ? t('details.roleSections.showLess') : t('details.roleSections.showMore')}
              </Button>
            )}
          </Box>
        )}

        {altTitles.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              {t('details.roleSections.alsoKnownAs')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {(unfolded || showAllAltTitles ? altTitles : altTitles.slice(0, MAX_VISIBLE_ALT_TITLES)).map((t) => (
                <Chip key={t} label={t} variant="outlined" size="small" />
              ))}
            </Box>
            {altTitles.length > MAX_VISIBLE_ALT_TITLES && !unfolded && (
              <Button
                size="small"
                onClick={() => setShowAllAltTitles((v) => !v)}
                sx={{ mt: 1, textTransform: 'none' }}
              >
                {showAllAltTitles ? t('details.roleSections.showLess') : t('details.roleSections.showMore')}
              </Button>
            )}
          </Box>
        )}

        {hiddenTitles.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              {t('details.roleSections.alsoKnownAsEscoHidden')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {(unfolded || showAllHiddenTitles ? hiddenTitles : hiddenTitles.slice(0, MAX_VISIBLE_ALT_TITLES)).map((t) => (
                <Chip key={t} label={t} variant="outlined" size="small" />
              ))}
            </Box>
            {hiddenTitles.length > MAX_VISIBLE_ALT_TITLES && !unfolded && (
              <Button
                size="small"
                onClick={() => setShowAllHiddenTitles((v) => !v)}
                sx={{ mt: 1, textTransform: 'none' }}
              >
                {showAllHiddenTitles ? t('details.roleSections.showLess') : t('details.roleSections.showMore')}
              </Button>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export function CareerStepRoleFitCard({
  stepDetails,
  simulationScopeId = null,
  profileLoading = false,
}) {
  const { t, i18n } = useTranslation('dashboard');
  const [explanation, setExplanation] = useState('');
  const [explanationBusy, setExplanationBusy] = useState(false);

  useEffect(() => {
    if (profileLoading) {
      return undefined;
    }

    setExplanation('');
    setExplanationBusy(true);

    let cancelled = false;
    const lang = i18n.resolvedLanguage || i18n.language || 'en';

    const timerId = window.setTimeout(() => {
      (async () => {
        try {
          const token =
            typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
          if (!token) {
            if (!cancelled) setExplanation('');
          } else {
            const { data } = await axios.post(
              '/api/profile/role-fit-explanation',
              {
                language: lang,
                role: stepDetails,
                simulationScopeId: simulationScopeId || undefined,
              },
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            if (
              !cancelled &&
              data?.success &&
              typeof data.text === 'string'
            ) {
              setExplanation(data.text || '');
            } else if (!cancelled) {
              setExplanation('');
            }
          }
        } catch {
          if (!cancelled) setExplanation('');
        } finally {
          if (!cancelled) setExplanationBusy(false);
        }
      })();
    }, ROLE_FIT_EXPLANATION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      setExplanationBusy(false);
    };
  }, [
    stepDetails,
    simulationScopeId,
    i18n.resolvedLanguage,
    i18n.language,
    profileLoading,
  ]);

  const showLoading = profileLoading || explanationBusy;
  if (!showLoading && !explanation) return null;

  const loadingLabel = t('details.actions.loading');

  return (
    <Card
      sx={{
        mb: 3,
        border: '1px solid',
        borderColor: 'primary.light',
        backgroundColor: 'var(--color-primary-muted-bg)',
      }}
    >
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 1.5 }}>
          {t('details.roleSections.whyThisRoleFitsYou')}
        </Typography>
        {showLoading ? (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 2,
              py: 3,
              minHeight: 72,
            }}
            aria-busy="true"
            aria-live="polite"
            aria-label={loadingLabel}
          >
            <CircularProgress size={28} thickness={4} />
            <Typography variant="body2" color="text.secondary">
              {loadingLabel}
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
            {explanation}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

const splitDescriptionIntoParagraphs = (text) => {
  const normalizedText = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalizedText) return [];

  const lineParagraphs = normalizedText
    .split(/\n\s*\n|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (lineParagraphs.length > 1) return lineParagraphs;

  const sentences = normalizedText.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!sentences || sentences.length <= 2) return [normalizedText];

  const paragraphs = [];
  const sentenceBatchSize = 3;
  for (let i = 0; i < sentences.length; i += sentenceBatchSize) {
    paragraphs.push(sentences.slice(i, i + sentenceBatchSize).join(' ').trim());
  }
  return paragraphs.filter(Boolean);
};

const NESTED_SECTION_CARD_SX = {
  mb: 2,
  boxShadow: 'none',
  border: '1px solid',
  borderColor: 'divider',
};

/**
 * Full role detail sections stacked for inline scroll in the simulation ranking wizard.
 */
export function CareerStepRoleInlineBody({ stepDetails, simulationScopeId = null }) {
  const { t, i18n } = useTranslation('dashboard');
  const { isLoading: profileLoading } = useFullProfileQuery();
  const uiLang = i18n.resolvedLanguage || i18n.language || 'en';
  const description = localizedContentService.getLocalizedWithFallback(
    stepDetails?.description,
    uiLang,
    ''
  );
  const paragraphs = splitDescriptionIntoParagraphs(description);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0, mt: 1 }}>
      <Box sx={{ '& > .MuiCard-root': NESTED_SECTION_CARD_SX }}>
        <CareerStepRoleFitCard
          stepDetails={stepDetails}
          simulationScopeId={simulationScopeId || stepDetails?.simulationId || 'local'}
          profileLoading={profileLoading}
        />
      </Box>

      <Card sx={NESTED_SECTION_CARD_SX}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            <Work sx={{ mr: 1, verticalAlign: 'middle' }} />
            {t('details.labels.roleDescription')}
          </Typography>
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph, index) => (
              <Typography
                key={index}
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5, fontWeight: index === 0 ? 600 : 400 }}
              >
                {paragraph}
              </Typography>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('details.labels.noDetailedDescription')}
            </Typography>
          )}
        </CardContent>
      </Card>

      <Box sx={{ '& .MuiCard-root': NESTED_SECTION_CARD_SX }}>
        <CareerStepRoleInsightsCard stepDetails={stepDetails} unfolded />
        <CareerStepRoleDetailsCard stepDetails={stepDetails} unfolded />
      </Box>
    </Box>
  );
}
