import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { queryClient } from '../queryClient';
import commonEn from './locales/en/common.json';
import onboardingEn from './locales/en/onboarding.json';
import dashboardEn from './locales/en/dashboard.json';
import commonDe from './locales/de/common.json';
import onboardingDe from './locales/de/onboarding.json';
import dashboardDe from './locales/de/dashboard.json';

const resources = {
  en: {
    common: commonEn,
    onboarding: onboardingEn,
    dashboard: dashboardEn,
  },
  de: {
    common: commonDe,
    onboarding: onboardingDe,
    dashboard: dashboardDe,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'onboarding', 'dashboard'],
    supportedLngs: ['en', 'de'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['querystring', 'localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
  });

i18n.on('languageChanged', () => {
  queryClient.invalidateQueries({ queryKey: ['profile'] });
});

export default i18n;
