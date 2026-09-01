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
import { WRAP_CHIP_LABEL_SX } from '../../constants/iconChipStyles';
import { getLocalizedAltTitles, getLocalizedHiddenTitles } from '../../utils/roleTitleDisplay';
import { splitDescriptionIntoParagraphs } from '../../utils/splitDescriptionIntoParagraphs';

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
 * Role Insights card shared by role and simulation detail pages.
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
              sx={{ mb: 1, ...WRAP_CHIP_LABEL_SX }}
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
                    sx={WRAP_CHIP_LABEL_SX}
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
 * Role Details card shared by role and simulation detail pages.
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
    return getLocalizedAltTitles(stepDetails, activeLang);
  }, [stepDetails, activeLang]);

  const hiddenTitles = useMemo(() => {
    return getLocalizedHiddenTitles(stepDetails, activeLang);
  }, [stepDetails, activeLang]);

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
                <Chip key={skill} label={skill} variant="outlined" sx={WRAP_CHIP_LABEL_SX} />
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
                  <Chip key={skill} label={skill} variant="outlined" size="small" sx={WRAP_CHIP_LABEL_SX} />
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
                <Chip key={t} label={t} variant="outlined" size="small" sx={WRAP_CHIP_LABEL_SX} />
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
                <Chip key={t} label={t} variant="outlined" size="small" sx={WRAP_CHIP_LABEL_SX} />
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
  const [bullets, setBullets] = useState([]);
  const [explanationBusy, setExplanationBusy] = useState(false);

  useEffect(() => {
    if (profileLoading) {
      return undefined;
    }

    setBullets([]);
    setExplanationBusy(true);

    let cancelled = false;
    const lang = i18n.resolvedLanguage || i18n.language || 'en';

    const timerId = window.setTimeout(() => {
      (async () => {
        try {
          const token =
            typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
          if (!token) {
            if (!cancelled) setBullets([]);
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
            if (!cancelled && data?.success) {
              const nextBullets = Array.isArray(data.bullets)
                ? data.bullets.map((b) => String(b || '').trim()).filter(Boolean)
                : [];
              setBullets(nextBullets);
            } else if (!cancelled) {
              setBullets([]);
            }
          }
        } catch {
          if (!cancelled) setBullets([]);
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
  if (!showLoading && bullets.length === 0) return null;

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
          <Box component="ul" sx={{ m: 0, pl: 2.25, '& li': { mb: 1 } }}>
            {bullets.map((bullet, index) => (
              <Box component="li" key={`${index}-${bullet.slice(0, 24)}`}>
                <Typography variant="body2" sx={{ lineHeight: 1.55, fontWeight: 500 }}>
                  {bullet}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

const NESTED_SECTION_CARD_SX = {
  mb: 2,
  boxShadow: 'none',
  border: '1px solid',
  borderColor: 'divider',
};

/**
 * Role description body with first paragraph visible and optional expand for the rest.
 */
export function RoleDescriptionContent({
  description,
  defaultExpanded = false,
  variant = 'body1',
  emphasizeFirstParagraph = true,
  firstParagraphWeight,
  color,
  paragraphSx,
}) {
  const { t } = useTranslation('dashboard');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const paragraphs = useMemo(() => splitDescriptionIntoParagraphs(description), [description]);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [description, defaultExpanded]);

  if (paragraphs.length === 0) {
    return (
      <Typography variant={variant} color={color} sx={{ mb: 2, ...paragraphSx }}>
        {t('details.labels.noDetailedDescription')}
      </Typography>
    );
  }

  const resolvedFirstWeight = firstParagraphWeight ?? (emphasizeFirstParagraph ? 700 : 400);
  const visibleParagraphs = expanded ? paragraphs : paragraphs.slice(0, 1);
  const canToggle = paragraphs.length > 1;

  return (
    <>
      {visibleParagraphs.map((paragraph, index) => (
        <Typography
          key={index}
          variant={variant}
          color={color}
          paragraph={variant === 'body1' && !emphasizeFirstParagraph}
          sx={{
            mb: variant === 'body2' ? 1.5 : 2,
            fontWeight: index === 0 ? resolvedFirstWeight : 400,
            lineHeight: variant === 'body1' && !emphasizeFirstParagraph ? 1.7 : undefined,
            ...paragraphSx,
          }}
        >
          {paragraph}
        </Typography>
      ))}
      {canToggle && (
        <Button
          size="small"
          onClick={() => setExpanded((value) => !value)}
          sx={{ mt: -0.5, mb: 1, textTransform: 'none', px: 0, minWidth: 0 }}
        >
          {expanded ? t('details.roleSections.showLess') : t('details.roleSections.more')}
        </Button>
      )}
    </>
  );
}

/**
 * Role Description card — shared across career step detail pages.
 */
export function CareerStepRoleDescriptionCard({
  description,
  title,
  unfolded = false,
  sx,
  showWorkIcon = true,
  variant = 'body1',
  emphasizeFirstParagraph = true,
  firstParagraphWeight,
  color,
  paragraphSx,
  nested = false,
  children,
}) {
  const { t } = useTranslation('dashboard');

  return (
    <Card sx={{ ...(nested ? NESTED_SECTION_CARD_SX : { mb: 3 }), ...sx }}>
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          {showWorkIcon ? <Work sx={{ mr: 1, verticalAlign: 'middle' }} /> : null}
          {title ?? t('details.labels.roleDescription')}
        </Typography>
        <RoleDescriptionContent
          description={description}
          defaultExpanded={unfolded}
          variant={variant}
          emphasizeFirstParagraph={emphasizeFirstParagraph}
          firstParagraphWeight={firstParagraphWeight}
          color={color}
          paragraphSx={paragraphSx}
        />
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Full role detail sections stacked for inline scroll in the simulation ranking wizard.
 */
export function CareerStepRoleInlineBody({ stepDetails, simulationScopeId = null }) {
  const { i18n } = useTranslation('dashboard');
  const { isLoading: profileLoading } = useFullProfileQuery();
  const uiLang = i18n.resolvedLanguage || i18n.language || 'en';
  const description = localizedContentService.getLocalizedWithFallback(
    stepDetails?.description,
    uiLang,
    ''
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0, mt: 1 }}>
      <Box sx={{ '& > .MuiCard-root': NESTED_SECTION_CARD_SX }}>
        <CareerStepRoleFitCard
          stepDetails={stepDetails}
          simulationScopeId={simulationScopeId || stepDetails?.simulationId || 'local'}
          profileLoading={profileLoading}
        />
      </Box>

      <CareerStepRoleDescriptionCard
        description={description}
        nested
        variant="body2"
        firstParagraphWeight={600}
        color="text.secondary"
      />

      <Box sx={{ '& .MuiCard-root': NESTED_SECTION_CARD_SX }}>
        <CareerStepRoleInsightsCard stepDetails={stepDetails} unfolded />
        <CareerStepRoleDetailsCard stepDetails={stepDetails} unfolded />
      </Box>
    </Box>
  );
}
