import React from 'react';
import { Button, ButtonGroup, Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

const SUPPORTED_LANGUAGES = ['en', 'de'];

/** Same neutral grey as MUI IconButton default (`color="default"`) — profile name edit icon on light surfaces. */
const SELECTED_LANGUAGE_SX = {
  bgcolor: 'grey.700',
  color: 'common.white',
  borderColor: 'grey.700',
  '&:hover': {
    bgcolor: 'grey.800',
    borderColor: 'grey.800',
    color: 'common.white',
  },
};

const LanguageSwitcher = () => {
  const { i18n, t } = useTranslation('common');
  const activeLanguage = SUPPORTED_LANGUAGES.includes(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : 'en';

  const handleSwitchLanguage = (language) => {
    i18n.changeLanguage(language);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="body2" component="span" color="inherit">
        {t('language.switchLabel')}
      </Typography>
      <ButtonGroup
        size="small"
        variant="outlined"
        color="inherit"
        aria-label={t('language.switchLabel')}
      >
        <Button
          onClick={() => handleSwitchLanguage('en')}
          variant="outlined"
          color="inherit"
          sx={activeLanguage === 'en' ? SELECTED_LANGUAGE_SX : undefined}
        >
          {t('language.englishShort')}
        </Button>
        <Button
          onClick={() => handleSwitchLanguage('de')}
          variant="outlined"
          color="inherit"
          sx={activeLanguage === 'de' ? SELECTED_LANGUAGE_SX : undefined}
        >
          {t('language.germanShort')}
        </Button>
      </ButtonGroup>
    </Box>
  );
};

export default LanguageSwitcher;
