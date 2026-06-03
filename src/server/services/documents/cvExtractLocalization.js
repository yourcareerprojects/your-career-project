const localizedContentService = require('../localization/localizedContentService');
const { normalizeStructuredListItemLabel } = require('../../../constants/structuredListItemLabel');
const { translateCvExtractBatch } = require('../ai/translateText');
const logger = require('../../utils/logger');
const { normalizeExternalApiError } = require('../../utils/httpTimeouts');
const { logTranslationSummary } = require('../../utils/metricsLogger');

const USER_IDENTITY_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

const STRUCTURED_LINE_FIELDS = ['skillDomains', 'domains', 'keyResponsibilities', 'skillsInDevelopment'];

/**
 * @param {object} profile
 * @returns {{ id: string, text: string }[]}
 */
function collectCvExtractLocalizationItems(profile) {
  const items = [];
  const identity = profile?.userIdentity && typeof profile.userIdentity === 'object' ? profile.userIdentity : {};

  for (const key of USER_IDENTITY_KEYS) {
    const text = String(identity[key] || '').trim();
    if (text) items.push({ id: `identity.${key}`, text });
  }

  const sui = profile?.structuredUserInfo && typeof profile.structuredUserInfo === 'object' ? profile.structuredUserInfo : {};

  for (const field of STRUCTURED_LINE_FIELDS) {
    const rows = Array.isArray(sui[field]) ? sui[field] : [];
    for (let i = 0; i < rows.length; i += 1) {
      const text = String(rows[i] || '').trim();
      if (text) items.push({ id: `structured.${field}.${i}`, text });
    }
  }

  const skillRows = Array.isArray(sui.skills) ? sui.skills : [];
  for (let i = 0; i < skillRows.length; i += 1) {
    const name = typeof skillRows[i] === 'string' ? skillRows[i] : skillRows[i]?.name || '';
    const text = String(name).trim();
    if (text) items.push({ id: `structured.skills.${i}`, text });
  }

  return items;
}

/**
 * @param {string} text
 * @param {string|undefined|null} translated
 * @param {'en'|'de'} documentLanguage
 * @param {{ partial?: boolean }} [state]
 */
function pairFromDocumentLanguage(text, translated, documentLanguage, state) {
  const raw = String(text || '').trim();
  if (!raw) return { en: '', de: '' };

  const docLang = documentLanguage === 'de' ? 'de' : 'en';
  const other = String(translated || '').trim();
  if (!other) {
    if (state) state.partial = true;
    return { en: raw, de: raw };
  }

  if (docLang === 'en') return { en: raw, de: other };
  return { en: other, de: raw };
}

/**
 * @param {object} profile
 * @param {Map<string, string>} translations
 * @param {'en'|'de'} documentLanguage
 * @param {{ partial?: boolean }} state
 */
function buildCvI18nFromBatchResults(profile, translations, documentLanguage, state) {
  const docLang = documentLanguage === 'de' ? 'de' : 'en';
  const identity = profile?.userIdentity && typeof profile.userIdentity === 'object' ? profile.userIdentity : {};
  const sui = profile?.structuredUserInfo && typeof profile.structuredUserInfo === 'object' ? profile.structuredUserInfo : {};

  const cvI18n = {
    documentLanguage: docLang,
    userIdentity: {},
    structuredUserInfo: {
      skillDomains: [],
      domains: [],
      keyResponsibilities: [],
      skillsInDevelopment: [],
      skills: [],
    },
  };

  for (const key of USER_IDENTITY_KEYS) {
    const raw = identity[key];
    cvI18n.userIdentity[key] = pairFromDocumentLanguage(
      raw,
      translations.get(`identity.${key}`),
      docLang,
      state
    );
  }

  for (const field of STRUCTURED_LINE_FIELDS) {
    const rows = Array.isArray(sui[field]) ? sui[field] : [];
    cvI18n.structuredUserInfo[field] = rows.map((row, idx) =>
      pairFromDocumentLanguage(row, translations.get(`structured.${field}.${idx}`), docLang, state)
    );
  }

  const skillRows = Array.isArray(sui.skills) ? sui.skills : [];
  cvI18n.structuredUserInfo.skills = skillRows.map((skill, idx) => {
    const name = typeof skill === 'string' ? skill : skill?.name || '';
    return {
      name: pairFromDocumentLanguage(name, translations.get(`structured.skills.${idx}`), docLang, state),
    };
  });

  return cvI18n;
}

/**
 * Last-resort flattening when batch localization throws: keep extracted strings, skip bilingual bundles.
 * @param {object} profile
 * @param {'en'|'de'} uiLanguage
 */
function fallbackCvProfileWithoutLocalization(profile, uiLanguage) {
  const uiLang = String(uiLanguage || 'en').toLowerCase().split('-')[0] || 'en';
  const identity = profile?.userIdentity && typeof profile.userIdentity === 'object' ? profile.userIdentity : {};
  const sui = profile?.structuredUserInfo && typeof profile.structuredUserInfo === 'object' ? profile.structuredUserInfo : {};

  const flatProfile = {
    ...profile,
    userIdentity: { ...identity },
    structuredUserInfo: {
      ...sui,
      skillDomains: Array.isArray(sui.skillDomains) ? sui.skillDomains.map((x) => String(x)) : [],
      domains: Array.isArray(sui.domains) ? sui.domains.map((x) => String(x)) : [],
      keyResponsibilities: Array.isArray(sui.keyResponsibilities)
        ? sui.keyResponsibilities.map((x) => String(x))
        : [],
      skillsInDevelopment: Array.isArray(sui.skillsInDevelopment)
        ? sui.skillsInDevelopment.map((x) => String(x))
        : [],
      skills: Array.isArray(sui.skills)
        ? sui.skills.map((s) =>
            typeof s === 'string' ? { name: s } : { name: String(s?.name || '') }
          )
        : [],
    },
  };

  for (const key of USER_IDENTITY_KEYS) {
    flatProfile.userIdentity[key] = pickUi(
      { en: String(identity[key] || '').trim(), de: String(identity[key] || '').trim() },
      uiLang
    );
  }

  return flatProfile;
}

function pickUi(pair, uiLang) {
  return localizedContentService.normalizeForResponse(pair, uiLang) || pair.en || pair.de || '';
}

/**
 * Builds `{ en, de }` pairs from CV-extracted strings (original lives in documentLanguage slot),
 * then returns a flattened profile for the requested UI language.
 *
 * @param {object} profile merged extraction profile slice
 * @param {'en'|'de'} documentLanguage detected CV language
 * @param {'en'|'de'} uiLanguage active UI locale for flattened strings
 */
async function localizeCvExtractedProfile(profile, documentLanguage, uiLanguage) {
  const uiLang = String(uiLanguage || 'en').toLowerCase().split('-')[0] || 'en';
  const docLang = documentLanguage === 'de' ? 'de' : 'en';

  const lineState = { partial: false };
  const batchItems = collectCvExtractLocalizationItems(profile);

  let translations = new Map();
  if (batchItems.length > 0) {
    try {
      translations = await translateCvExtractBatch(batchItems, docLang);
      const expectedIds = new Set(batchItems.map((item) => item.id));
      for (const id of expectedIds) {
        if (!translations.has(id)) lineState.partial = true;
      }
    } catch (err) {
      logger.warn(
        'CV batch localization failed; using document-language text for both locales',
        normalizeExternalApiError(err)
      );
      lineState.partial = true;
      translations = new Map();
    }
  }

  const cvI18n = buildCvI18nFromBatchResults(profile, translations, docLang, lineState);

  const identity = profile?.userIdentity && typeof profile.userIdentity === 'object' ? profile.userIdentity : {};
  const sui = profile?.structuredUserInfo && typeof profile.structuredUserInfo === 'object' ? profile.structuredUserInfo : {};

  const flatProfile = {
    ...profile,
    userIdentity: {
      ...identity,
    },
    structuredUserInfo: {
      ...sui,
      skillDomains: cvI18n.structuredUserInfo.skillDomains.map((p) => pickUi(p, uiLang)),
      domains: cvI18n.structuredUserInfo.domains.map((p) => pickUi(p, uiLang)),
      keyResponsibilities: cvI18n.structuredUserInfo.keyResponsibilities.map((p) => pickUi(p, uiLang)),
      skillsInDevelopment: cvI18n.structuredUserInfo.skillsInDevelopment.map((p) => pickUi(p, uiLang)),
      skills: cvI18n.structuredUserInfo.skills.map((row) => ({
        name: pickUi(row.name, uiLang),
      })),
    },
  };

  for (const key of USER_IDENTITY_KEYS) {
    if (cvI18n.userIdentity[key]) {
      flatProfile.userIdentity[key] = pickUi(cvI18n.userIdentity[key], uiLang);
    }
  }

  const localizationStatus = lineState.partial ? 'partial' : 'complete';

  logTranslationSummary();

  return {
    profile: flatProfile,
    cvI18n,
    localizationStatus,
  };
}

function normalizePair(p) {
  if (!p || typeof p !== 'object') return { en: '', de: '' };
  return {
    en: p.en != null ? String(p.en) : '',
    de: p.de != null ? String(p.de) : '',
  };
}

/**
 * Deep-merge optional CV i18n patches from client (extraction review + profile save).
 * @param {object|null|undefined} existing
 * @param {object|null|undefined} patch
 */
function mergeCvExtractLocalizationPatch(existing, patch) {
  if (!patch || typeof patch !== 'object') return existing;

  const base =
    existing && typeof existing === 'object'
      ? JSON.parse(JSON.stringify(existing))
      : {};

  if (patch.documentLanguage === 'de' || patch.documentLanguage === 'en') {
    base.documentLanguage = patch.documentLanguage;
  }

  if (patch.userIdentity && typeof patch.userIdentity === 'object') {
    base.userIdentity = base.userIdentity || {};
    for (const k of USER_IDENTITY_KEYS) {
      if (patch.userIdentity[k] === undefined || patch.userIdentity[k] === null) continue;
      base.userIdentity[k] = normalizePair({
        ...normalizePair(base.userIdentity[k]),
        ...normalizePair(patch.userIdentity[k]),
      });
    }
  }

  if (patch.structuredUserInfo && typeof patch.structuredUserInfo === 'object') {
    base.structuredUserInfo = base.structuredUserInfo || {};
    const dims = ['skillDomains', 'domains', 'keyResponsibilities', 'skillsInDevelopment', 'skills'];
    for (const d of dims) {
      if (Array.isArray(patch.structuredUserInfo[d])) {
        base.structuredUserInfo[d] = patch.structuredUserInfo[d];
      }
    }
  }

  return base;
}

function pickLocalizedFromPair(pair, lang) {
  const code = String(lang || 'en').toLowerCase().split('-')[0] || 'en';
  const p = normalizePair(pair);
  return (
    localizedContentService.normalizeForResponse(p, code) ||
    String(p.en || '').trim() ||
    String(p.de || '').trim() ||
    ''
  );
}

/**
 * Replaces `raw_items` chip strings using parallel `{ en, de }` rows in
 * `cvRoot.structuredUserInfo` when the stored flat list matches the UI locale
 * the profile was last saved in (e.g. German) and the user switches to English.
 */
function overlayStructuredUserInfoListsWithCvLocalization(structuredUserInfo, cvRoot, lang) {
  if (!structuredUserInfo || typeof structuredUserInfo !== 'object') return structuredUserInfo;
  const cvLoc = cvRoot?.structuredUserInfo;
  if (!cvLoc || typeof cvLoc !== 'object') return structuredUserInfo;

  const stringDims = ['skillDomains', 'domains', 'keyResponsibilities', 'skillsInDevelopment'];
  let out = { ...structuredUserInfo };

  for (const dim of stringDims) {
    const bucket = out[dim];
    if (!bucket || typeof bucket !== 'object') continue;
    const pairs = cvLoc[dim];
    if (!Array.isArray(pairs) || pairs.length === 0) continue;
    const raw = Array.isArray(bucket.raw_items) ? bucket.raw_items : [];
    const nextRaw = raw.map((item, idx) => {
      const row = pairs[idx];
      if (!row || typeof row !== 'object') return item;
      const picked = pickLocalizedFromPair(row, lang);
      if (typeof item === 'string') return picked || item;
      return item;
    });
    out[dim] = { ...bucket, raw_items: nextRaw };
  }

  const skillsBucket = out.skills;
  const skillPairs = cvLoc.skills;
  if (skillsBucket && typeof skillsBucket === 'object' && Array.isArray(skillPairs) && skillPairs.length > 0) {
    const raw = Array.isArray(skillsBucket.raw_items) ? skillsBucket.raw_items : [];
    const nextRaw = raw.map((item, idx) => {
      const row = skillPairs[idx];
      const namePair = row?.name;
      const fallbackLabel = normalizeStructuredListItemLabel(item, lang);
      if (!namePair || typeof namePair !== 'object') return fallbackLabel;
      const picked = String(pickLocalizedFromPair(namePair, lang) || '').trim();
      return picked || fallbackLabel;
    });
    out.skills = { ...skillsBucket, raw_items: nextRaw };
  }

  return out;
}

/** Prefers stored `{ en, de }` pairs for the active UI language when present. */
function overlayIdentityAnswersWithCvLocalization(mergedFlat, cvLocUserIdentity, lang) {
  if (!cvLocUserIdentity || typeof cvLocUserIdentity !== 'object') return mergedFlat;
  const flat = mergedFlat && typeof mergedFlat === 'object' ? { ...mergedFlat } : {};
  const code = String(lang || 'en').toLowerCase().split('-')[0] || 'en';
  for (const k of USER_IDENTITY_KEYS) {
    const pair = normalizePair(cvLocUserIdentity[k]);
    if (!String(pair.en || '').trim() && !String(pair.de || '').trim()) continue;
    const picked =
      localizedContentService.normalizeForResponse(pair, code) ||
      String(pair.en || '').trim() ||
      String(pair.de || '').trim() ||
      '';
    if (String(picked).trim()) flat[k] = String(picked).trim();
  }
  return flat;
}

/**
 * After manual edits to flat identity answers, mirror the edited text into cvExtractLocalization
 * so the user's locale stays the source of truth for that slice.
 *
 * @param {object|null|undefined} cvRoot Stored `profile.cvExtractLocalization`
 */
function syncCvExtractUserIdentityFromFlat(cvRoot, flatAnswers, uiLang) {
  if (!cvRoot || typeof cvRoot !== 'object') return false;
  if (!cvRoot.userIdentity || typeof cvRoot.userIdentity !== 'object') return false;

  const code = String(uiLang || 'en').toLowerCase().split('-')[0] || 'en';
  const slot = code === 'de' ? 'de' : 'en';
  let changed = false;
  for (const k of USER_IDENTITY_KEYS) {
    const v = String(flatAnswers[k] ?? '').trim();
    if (!v) continue;
    cvRoot.userIdentity[k] = normalizePair({
      ...normalizePair(cvRoot.userIdentity[k]),
      [slot]: v,
    });
    changed = true;
  }
  return changed;
}

module.exports = {
  USER_IDENTITY_KEYS,
  localizeCvExtractedProfile,
  fallbackCvProfileWithoutLocalization,
  mergeCvExtractLocalizationPatch,
  overlayIdentityAnswersWithCvLocalization,
  overlayStructuredUserInfoListsWithCvLocalization,
  syncCvExtractUserIdentityFromFlat,
  __testables: {
    collectCvExtractLocalizationItems,
    buildCvI18nFromBatchResults,
    pairFromDocumentLanguage,
  },
};
