import React, { useEffect, useMemo, useState } from 'react';
import { Button, List, ListItem, ListItemIcon, ListItemText, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import { useTranslation } from 'react-i18next';

const MAX_VISIBLE_EVIDENCE = 3;

/**
 * Explainable evidence list — always answers "why do we think this?"
 */
export default function IdentityEvidenceList({ evidence = [] }) {
  const { t } = useTranslation('dashboard');
  const [showAll, setShowAll] = useState(false);

  const sortedEvidence = useMemo(() => {
    return [...evidence].sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return bTime - aTime;
    });
  }, [evidence]);

  useEffect(() => {
    setShowAll(false);
  }, [evidence]);

  if (!sortedEvidence.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('careerIdentity.noEvidenceYet')}
      </Typography>
    );
  }

  const visibleEvidence = showAll
    ? sortedEvidence
    : sortedEvidence.slice(0, MAX_VISIBLE_EVIDENCE);
  const canToggle = sortedEvidence.length > MAX_VISIBLE_EVIDENCE;

  return (
    <>
      <List dense disablePadding>
        {visibleEvidence.map((item) => {
          const isAgainst = item.polarity === 'negative';
          return (
            <ListItem
              key={item.evidenceId}
              alignItems="flex-start"
              sx={{
                px: 0,
                py: 1.25,
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:last-child': { borderBottom: 'none' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, mt: 0.4 }}>
                {isAgainst ? (
                  <HighlightOffIcon sx={{ fontSize: 20, color: 'error.main', opacity: 0.8 }} />
                ) : (
                  <CheckCircleOutlineIcon sx={{ fontSize: 20, color: 'primary.main', opacity: 0.75 }} />
                )}
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography variant="body2" fontWeight={600}>
                    {item.label || item.sourceType}
                  </Typography>
                }
                secondary={
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                    {item.explanation}
                  </Typography>
                }
              />
            </ListItem>
          );
        })}
      </List>
      {canToggle ? (
        <Button
          size="small"
          onClick={() => setShowAll((value) => !value)}
          sx={{ mt: -0.5, mb: 0, textTransform: 'none', px: 0, minWidth: 0 }}
        >
          {showAll ? t('details.roleSections.showLess') : t('details.roleSections.more')}
        </Button>
      ) : null}
    </>
  );
}
