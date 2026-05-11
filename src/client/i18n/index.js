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

export const DEFAULT_UI_LANGUAGE = 'de';
export const UI_LANGUAGE_STORAGE_KEY = 'careerPathExplorerUiLanguage';

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
    fallbackLng: DEFAULT_UI_LANGUAGE,
    defaultNS: 'common',
    ns: ['common', 'onboarding', 'dashboard'],
    supportedLngs: ['en', 'de'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      // Ignore legacy navigator-detected English so the app now defaults to German
      // unless the user explicitly picked a UI language or passed `?lng=`/`?lang=`.
      order: ['querystring', 'localStorage', 'htmlTag'],
      lookupLocalStorage: UI_LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

function syncDocumentLanguage(language) {
  if (typeof document === 'undefined') return;
  const resolved = String(language || DEFAULT_UI_LANGUAGE).toLowerCase().split('-')[0] || DEFAULT_UI_LANGUAGE;
  document.documentElement.lang = resolved;
}

syncDocumentLanguage(i18n.resolvedLanguage || i18n.language);

i18n.on('languageChanged', (language) => {
  syncDocumentLanguage(language);
  queryClient.invalidateQueries({ queryKey: ['profile'] });
});

export default i18n;
