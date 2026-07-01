const USER_IDENTITY_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

const WHO_ARE_YOU_PLACEHOLDER = 'No personal profile information available yet.';
const EMPTY_DIMENSION_PLACEHOLDER = 'No information available yet';

const STRUCTURED_DIMENSION_KEYS = [
  'skillDomains',
  'skills',
  'skillsInDevelopment',
  'keyResponsibilities',
  'domains',
];

function normalizeLangCode(lang = 'en') {
  return String(lang || 'en').toLowerCase().split('-')[0] || 'en';
}

function readWhoAreYouSummaryText(whoAreYou = {}, lang = 'en') {
  const summary = whoAreYou?.summary_text;
  if (typeof summary === 'string') return summary.trim();
  if (!summary || typeof summary !== 'object') return '';
  const code = normalizeLangCode(lang);
  const translations = summary.translations && typeof summary.translations === 'object'
    ? summary.translations
    : {};
  const slot = translations[code];
  if (typeof slot === 'string' && slot.trim()) return slot.trim();
  if (code !== 'en' && typeof translations.en === 'string' && translations.en.trim()) {
    return translations.en.trim();
  }
  const origLang = normalizeLangCode(summary.original_language);
  const orig = summary.original == null ? '' : String(summary.original).trim();
  if (orig && origLang === code) return orig;
  const hasTranslation = Object.values(translations).some((v) => v != null && String(v).trim());
  if (orig && !hasTranslation) return orig;
  return '';
}

function whoAreYouHasDisplayNarrative(whoAreYou = {}, lang = 'en') {
  const raw = readWhoAreYouSummaryText(whoAreYou, lang);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return false;
    return parsed.some((line) => {
      const text = String(line || '').trim();
      return text && text !== WHO_ARE_YOU_PLACEHOLDER;
    });
  } catch {
    return false;
  }
}

function readDimensionSummaryText(dimension = {}, lang = 'en') {
  const summary = dimension?.summary_text;
  if (typeof summary === 'string') return summary.trim();
  if (!summary || typeof summary !== 'object') return '';
  const code = normalizeLangCode(lang);
  const translations = summary.translations && typeof summary.translations === 'object'
    ? summary.translations
    : {};
  const slot = translations[code];
  if (typeof slot === 'string' && slot.trim()) return slot.trim();
  if (code !== 'en' && typeof translations.en === 'string' && translations.en.trim()) {
    return translations.en.trim();
  }
  const orig = summary.original == null ? '' : String(summary.original).trim();
  if (orig) return orig;
  return '';
}

function detectPendingNarrativesFromProfile(profileData, lang = 'en') {
  const pending = [];
  const profile = profileData?.profile && typeof profileData.profile === 'object'
    ? profileData.profile
    : {};
  const userIdentity = profile.userIdentity && typeof profile.userIdentity === 'object'
    ? profile.userIdentity
    : {};
  const hasIdentityAnswers = USER_IDENTITY_KEYS.some(
    (key) => String(userIdentity[key] || '').trim().length > 0
  );
  if (hasIdentityAnswers && !whoAreYouHasDisplayNarrative(profile.who_are_you || {}, lang)) {
    pending.push('who_are_you');
  }

  const structured = profile.structuredUserInfo || {};
  for (const key of STRUCTURED_DIMENSION_KEYS) {
    const dim = structured[key];
    const rawItems = Array.isArray(dim?.raw_items)
      ? dim.raw_items.map((v) => String(v || '').trim()).filter(Boolean)
      : [];
    if (rawItems.length === 0) continue;
    const summary = readDimensionSummaryText(dim, lang);
    if (!summary || summary === EMPTY_DIMENSION_PLACEHOLDER) {
      pending.push(`structuredUserInfo.${key}`);
    }
  }

  return pending;
}

function resolveNarrativePendingFromProfileResponse(profileData, lang = 'en') {
  const clientPending = detectPendingNarrativesFromProfile(profileData, lang);
  if (clientPending.length > 0) return clientPending;
  if (profileData?.narrativesReady === true) return [];
  if (Array.isArray(profileData?.narrativePending) && profileData.narrativePending.length > 0) {
    return profileData.narrativePending;
  }
  return clientPending;
}

module.exports = {
  detectPendingNarrativesFromProfile,
  resolveNarrativePendingFromProfileResponse,
};
